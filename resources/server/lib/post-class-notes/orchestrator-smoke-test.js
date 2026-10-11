"use strict";

// PN-006 — orchestrator: path selection, map/reduce, retry matrix, checkpoint
// resume, deterministic degradation, idempotency and trace hygiene.
//
// Fault injection drives `callModel` directly (fast, deterministic) plus one
// scenario that runs the real `provider.js` against the shared MockLLM over
// HTTP, so the transport path is exercised end to end.
//
//   node resources/server/lib/post-class-notes/orchestrator-smoke-test.js

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var errors = require("./errors.js");
var orchestration = require("./orchestrator.js");
var partitioner = require("./partitioner.js");
var providerModule = require("./provider.js");
var quality = require("./quality.js");
var schema = require("./schema.js");
var storeModule = require("./checkpoint-store.js");
var MockLLM = require("../../smoke-test-utils.js").MockLLM;

var FIXTURES = path.join(__dirname, "fixtures");
var tempDirs = [];

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name + ".json"), "utf8"));
}

function tmpRoot(label) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcn-orch-" + label + "-"));
  tempDirs.push(dir);
  return dir;
}

function scenario(name, body) {
  return Promise.resolve().then(body).then(function () {
    console.log("  ok   " + name);
  }, function (error) {
    error.message = name + ": " + error.message;
    throw error;
  });
}

// ---------------------------------------------------------------- fake model

function providerResult(content, extra) {
  return Object.assign({
    content: content,
    reasoning: "",
    finishReason: "stop",
    httpStatus: 200,
    contentType: "application/json",
    elapsedMs: 5,
    promptTokens: 1200,
    completionTokens: 640,
    truncated: false
  }, extra || {});
}

function httpError(code, message) {
  return errors.codedError(code, message || code);
}

// Canned evidence per slice. Splitting the topic list across slices is what the
// real map stage would do, and it makes the reduce stage do actual dedup work.
var SLICE_TOPICS = [
  { name: "词法单元、模式与词素", facts: ["词法单元是词法分析器输出的语法类别", "模式是描述词素形式的规则"], examples: ["if、position、<= 分属不同词法单元"] },
  { name: "正则表达式与语言描述", facts: ["正则表达式精确描述词法单元的模式", "连接、选择、闭包是三个基本运算"], examples: ["letter(letter|digit)*"] },
  { name: "非确定有限自动机", facts: ["NFA 允许同一状态对同一输入有多个转移", "含 epsilon 转移"], examples: ["Thompson 构造"] },
  { name: "确定有限自动机与子集构造", facts: ["DFA 每个状态对每个输入最多一条转移", "子集构造把状态子集变成 DFA 状态"], examples: ["epsilon-closure 的计算"] },
  { name: "DFA 最小化", facts: ["最小化合并不可区分的等价状态", "划分细化算法迭代分组"], examples: ["先按接受性划分再细化"] },
  { name: "词法分析器构造与缓冲", facts: ["双缓冲区用哨兵字符减少边界判断", "前瞻把已读字符送回输入流"], examples: ["读 <= 时前瞻一位"] },
  { name: "词法错误恢复", facts: ["词法错误需要可继续的恢复策略", "恐慌模式恢复依赖同步字符集"], examples: ["遇到 1x 删除数字"] }
];

var SLICE_LEARNER = [
  { kind: "misconception", content: "我理解非确定有限自动机就是把它直接翻译成程序里的 if-else" },
  { kind: "confusion", content: "到这里有点乱：DFA 最小化的中间结果到底要不要保留下来" },
  { kind: "shift", content: "原来我以为正则表达式和 NFA 是同一层的东西，现在看它们是不同抽象层级" },
  { kind: "correct", content: "所以关键在于把非确定的多个选择合并成一个确定的状态集合" }
];

// The transcript is labelled `[n][role]: ...`, so a stand-in model can cite real
// indexes instead of making them up — same constraint the real prompt imposes.
function indexesFromTranscript(content) {
  var out = [];
  var pattern = /^\[(\d+)\]/gm;
  var match;
  while ((match = pattern.exec(String(content || "")))) out.push(Number(match[1]));
  return out;
}

function evidenceForChunk(chunkId, availableIndexes) {
  var pool = (availableIndexes && availableIndexes.length) ? availableIndexes : [0, 1, 2, 3, 4, 5];
  var ordinal = Number(String(chunkId).replace(/\D/g, "")) || 1;
  var start = ordinal === 1 ? 0 : 3;
  function cite(offset, count) {
    var picked = [];
    for (var i = 0; i < count; i++) picked.push(pool[(offset + i) % pool.length]);
    return picked.filter(function (value, index, all) { return all.indexOf(value) === index; }).sort(function (a, b) { return a - b; });
  }

  var topics = SLICE_TOPICS.slice(start, start + 4).map(function (topic, index) {
    return {
      name: topic.name,
      facts: topic.facts.slice(),
      examples: topic.examples.slice(),
      sourceMessageIndexes: cite(index * 2, 2)
    };
  });
  var learnerStart = start === 0 ? 0 : 2;
  var learners = SLICE_LEARNER.slice(learnerStart, learnerStart + 2).map(function (item, index) {
    return { kind: item.kind, content: item.content, sourceMessageIndexes: cite(index + 1, 1) };
  });

  return {
    chunkId: chunkId,
    topics: topics,
    learnerEvidence: learners,
    keyInsights: start === 0 ? [] : [{ content: "正则和 NFA 不是一回事，是不同抽象层级", sourceMessageIndexes: cite(0, 1) }],
    openQuestions: [{ content: "最小化之后的 DFA 是否唯一", sourceMessageIndexes: cite(1, 1) }],
    reviewCandidates: topics.slice(0, 2).map(function (topic) {
      return { question: "关于「" + topic.name + "」的关键点是什么？", answer: topic.facts[0], sourceMessageIndexes: topic.sourceMessageIndexes.slice(0, 1) };
    })
  };
}

// Each body is built around the topic's own name and facts, so the fake note
// has the structure a real model produces without pretending every concept
// shares the same prose.
function conceptBody(topic) {
  return [
    "**定义**：" + topic.facts[0] + "。这是「" + topic.name + "」这一层最核心的一句，先把它的输入和输出各是什么说清楚。",
    topic.facts[1] ? "**进一步**：" + topic.facts[1] + "。补上这一句之后，「" + topic.name + "」就不再只是一个名字，而是一条可以机械执行的规则。" : "",
    "",
    "**例子**：" + (topic.examples[0] || topic.facts[0]) + "。把这个例子代进去走一遍，就能看出定义边界在哪里。",
    "",
    "**为什么重要**：在「" + topic.name + "」这一步，只记住结论而不写下中间状态，后面的推导会失去锚点；课堂上学习者正是在这里卡住过一次，回头补表花了更多时间。",
    "",
    "**容易混淆**：" + topic.name + " 与相邻概念不在同一个抽象层级上，它们的输入输出对象并不相同，混用会在边界输入上漏判，而且错误会被后续步骤放大。",
    "",
    "**怎么练**：先把「" + topic.name + "」对应的表手工填一遍，再准备一组正例和一组反例各自过一遍；反例必须落在拒绝状态上，才算真的掌握了这一步。",
    "",
    "**复习提示**：整理笔记时把「" + topic.name + "」的结论写成一句话放在最前面，细节放在后面，这样日后回看能先抓住骨架再补血肉。"
  ].filter(Boolean).join("\n");
}

function extractJsonArray(content) {
  var start = content.indexOf("[");
  var end = content.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try { return JSON.parse(content.slice(start, end + 1)); } catch (_) { return []; }
}

function extractJsonObject(content) {
  var start = content.indexOf("{");
  var end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  var parsed = schema.parseJsonLoose(content.slice(start, end + 1));
  return parsed.ok ? parsed.value : {};
}

function summaryFromEvidence(evidence) {
  var topics = quality.dedupeTopics(evidence);
  var sections = [
    { type: "tldr", content: "本节课从词法单元的定义出发，完整走了一遍正则到最小化的构造链路。" },
    { type: "narrative", content: "从把模式当成串的误解开始，先把类别与实例分清，再逐层走到最小化，最后落回工程上的缓冲与错误恢复。" },
    {
      type: "concepts",
      items: topics.map(function (topic) {
        return { name: topic.name, body: conceptBody(topic), sourceMessageIndexes: topic.sourceMessageIndexes.slice(0, 6) };
      })
    }
  ];

  var learners = [];
  var insights = [];
  var questions = [];
  evidence.forEach(function (chunk) {
    (chunk.learnerEvidence || []).forEach(function (item) { learners.push(item); });
    (chunk.keyInsights || []).forEach(function (item) { insights.push(item); });
    (chunk.openQuestions || []).forEach(function (item) { questions.push(item); });
  });
  if (learners.length) {
    sections.push({
      type: "notes",
      title: "学习轨迹",
      content: learners.map(function (item) { return "- **" + item.kind + "**：" + item.content; }).join("\n")
    });
  }
  if (insights.length) {
    sections.push({ type: "key-insight", content: insights[0].content, sourceMessageIndexes: insights[0].sourceMessageIndexes });
  }
  if (questions.length) sections.push({ type: "open-question", content: questions[0].content });

  var reviews = [];
  evidence.forEach(function (chunk) {
    (chunk.reviewCandidates || []).forEach(function (item) { reviews.push(item); });
  });
  if (reviews.length) {
    sections.push({
      type: "review-questions",
      items: reviews.slice(0, 5).map(function (item) { return { question: item.question, answer: item.answer }; })
    });
  }
  return { pagesRange: null, sections: sections };
}

// ---------------------------------------------------------------- harness

function harness(options) {
  var opts = options || {};
  var root = tmpRoot(opts.label || "run");
  var store = storeModule.createStore(root, { sleep: function () { return Promise.resolve(); } });
  var requests = [];
  var callModel = opts.callModel || (async function (request) {
    requests.push(request);
    return providerResult(JSON.stringify(defaultContent(request)));
  });
  var slept = [];
  var sleep = opts.sleep || function (ms) { slept.push(ms); return Promise.resolve(); };
  var orchestrator = orchestration.createOrchestrator({
    store: store,
    sleep: sleep,
    // PCN_DEBUG=1 prints the orchestrator's stage log, which is the fastest way
    // to see why a note was repaired or degraded.
    log: process.env.PCN_DEBUG ? function (line) { console.log("        " + line); } : function () {},
    limits: Object.assign({
      softBudgetMs: 60000,
      hardBudgetMs: 120000,
      maxCallsPerJob: 12,
      directTimeoutMs: 1000,
      mapTimeoutMs: 1000,
      reduceTimeoutMs: 1000,
      repairTimeoutMs: 1000
    }, opts.limits || {})
  });
  return { root: root, store: store, orchestrator: orchestrator, requests: requests, callModel: callModel, slept: slept };
}

function defaultContent(request) {
  if (request.stage === "map") return evidenceForChunk(mapChunkId(request), indexesFromTranscript(request.userContent));
  if (request.stage === "repair") return summaryFromEvidence(extractJsonArray(request.userContent));
  // The direct path is given the raw transcript, so the fake stands in for the
  // model producing a note straight from the lesson.
  if (request.stage === "direct") {
    var cited = indexesFromTranscript(request.userContent);
    return summaryFromEvidence([evidenceForChunk("chunk-001", cited), evidenceForChunk("chunk-002", cited)]);
  }
  var evidence = extractJsonArray(request.userContent);
  if (!evidence.length) return { sections: [{ type: "tldr", content: "空" }] };
  return summaryFromEvidence(evidence);
}

function mapChunkId(request) {
  var match = String(request.userContent).match(/chunk-\d+/);
  return match ? match[0] : "chunk-001";
}

async function waitFor(orchestrator, scope, jobId, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 5000);
  for (;;) {
    var view = await orchestrator.status(Object.assign({}, scope, { jobId: jobId }));
    if (orchestration.TERMINAL[view.status]) return view;
    if (Date.now() > deadline) throw new Error("job did not settle; last status " + view.status + "/" + view.stage);
    await new Promise(function (resolve) { setTimeout(resolve, 5); });
  }
}

function scopeFor(conversationId) {
  return { accountId: "test", profileId: "p1", worldId: "w1", conversationId: conversationId };
}

// Waits for the *durable* job record to go terminal, which lags the in-memory
// status by one write.
async function waitForDisk(store, conversationId, jobId, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 5000);
  for (;;) {
    var job = await store.readJob(conversationId, jobId);
    if (job && orchestration.TERMINAL[job.status]) return job;
    if (Date.now() > deadline) throw new Error("disk record never settled, last " + (job && job.status));
    await new Promise(function (resolve) { setTimeout(resolve, 5); });
  }
}

async function runShort(label, options) {
  var h = harness(Object.assign({ label: label }, options));
  var data = fixture("short-20");
  var scope = scopeFor("conv-" + label);
  var start = await h.orchestrator.start(Object.assign({
    conversationId: scope.conversationId,
    profileId: scope.profileId,
    worldId: scope.worldId,
    messages: data.messages,
    language: "chinese",
    companionName: "Luna",
    callModel: h.callModel
  }, (options && options.startOverrides) || {}));
  var view = await waitFor(h.orchestrator, scope, start.jobId);
  return { harness: h, scope: scope, start: start, view: view };
}

async function runLong(label, options) {
  var h = harness(Object.assign({ label: label }, options));
  var data = fixture("long-80");
  var scope = scopeFor("conv-" + label);
  var start = await h.orchestrator.start(Object.assign({
    conversationId: scope.conversationId,
    profileId: scope.profileId,
    worldId: scope.worldId,
    messages: data.messages,
    language: "chinese",
    companionName: "Luna",
    callModel: h.callModel
  }, (options && options.startOverrides) || {}));
  var view = await waitFor(h.orchestrator, scope, start.jobId, 8000);
  return { harness: h, scope: scope, start: start, view: view };
}

// ---------------------------------------------------------------- scenarios

async function happyShort() {
  var run = await runShort("short-ok");
  assert.strictEqual(run.view.status, "ready", "short lesson ends ready");
  assert.strictEqual(run.view.mode, "short");
  assert.strictEqual(run.harness.requests.length, 1, "short lesson uses exactly one model call");
  assert.strictEqual(run.harness.requests[0].stage, "direct");
  assert.strictEqual(run.view.summary.sections.length >= 3, true, "note has content");

  var onDisk = await run.harness.store.readFinal(run.scope.conversationId);
  assert.strictEqual(onDisk.sections.length, run.view.summary.sections.length, "the note is on disk");
  assert.strictEqual(onDisk.generationMeta.pipelineVersion, "post-class-v2");
  assert.strictEqual(schema.validateSummary(onDisk).ok, true, "the persisted note renders");
}

async function happyLong() {
  var run = await runLong("long-ok");
  assert.strictEqual(run.view.status, "ready", "long lesson ends ready, got " + run.view.status + "/" + JSON.stringify(run.view.error));
  assert.strictEqual(run.view.mode, "chunked");
  assert.strictEqual(run.view.totalChunks, 2, "80-message fixture slices into two chunks");
  assert.strictEqual(run.view.completedChunks, 2);
  assert.strictEqual(run.view.progress, 1);

  var stages = run.harness.requests.map(function (request) { return request.stage; });
  assert.deepStrictEqual(stages, ["map", "map", "reduce"], "one map per slice then a single reduce");

  var evidence = await run.harness.store.listChunks(run.scope.conversationId, run.start.jobId);
  assert.strictEqual(evidence.length, 2, "both slice checkpoints are on disk");
  var quality$ = await run.harness.store.readFinal(run.scope.conversationId);
  assert.strictEqual(quality$.generationMeta.decision, "accept", "quality accepted the merged note");
  assert.ok(quality$.generationMeta.quality.score >= 0.8, "score " + quality$.generationMeta.quality.score);
  assert.ok(quality$.generationMeta.evidenceIndex.length >= 7, "the shipped note keeps an evidence index");
  assert.strictEqual(JSON.stringify(quality$).indexOf("Luna"), -1, "metadata does not leak the transcript");

  var job = await run.harness.store.readJob(run.scope.conversationId, run.start.jobId);
  assert.strictEqual(JSON.stringify(job).indexOf("词法单元"), -1, "job.json stores state, not classroom text");
  var trace = await run.harness.store.readTrace(run.scope.conversationId, run.start.jobId);
  var events = trace.map(function (entry) { return entry.event; });
  ["job_created", "partition_completed", "chunk_started", "chunk_completed", "reduce_started", "quality_decision", "persist_started", "persist_completed", "job_completed"]
    .forEach(function (event) {
      assert.ok(events.indexOf(event) >= 0, "trace records " + event + "; saw: " + events.join(", "));
    });
}

async function traceHygiene() {
  var run = await runLong("trace-hygiene");
  var trace = await run.harness.store.readTrace(run.scope.conversationId, run.start.jobId);
  var serialized = JSON.stringify(trace);
  var data = fixture("long-80");
  var leaked = data.messages
    .map(function (message) { return String(message.content).slice(0, 24); })
    .filter(function (snippet) { return snippet.length > 8 && serialized.indexOf(snippet) >= 0; });
  assert.deepStrictEqual(leaked.slice(0, 3), [], "trace must not contain classroom text");
  trace.forEach(function (entry) {
    assert.ok(entry.traceId && entry.jobId && entry.stage && entry.event, "every trace line is structured");
    assert.strictEqual(entry.reasoning, undefined, "trace must not contain model reasoning");
  });
  assert.strictEqual(/mock-key|Authorization|Bearer/.test(serialized), false, "no credentials in the trace");
}

async function htmlOnFirstMapCall() {
  var h = harness({
    label: "html-403",
    callModel: async function (request) {
      h.requests.push(request);
      if (request.stage === "map" && h.requests.filter(function (r) { return r.stage === "map"; }).length === 1) {
        throw httpError(errors.CODES.upstream_html_response, "gateway returned HTML");
      }
      return providerResult(JSON.stringify(defaultContent(request)));
    }
  });
  var data = fixture("long-80");
  var scope = scopeFor("conv-html");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(view.status, "ready", "an interception page is retried once and then succeeds");
  var errorsLogged = (await h.store.readTrace(scope.conversationId, start.jobId)).filter(function (entry) { return entry.event === "provider_error"; });
  assert.strictEqual(errorsLogged.length, 1);
  assert.strictEqual(errorsLogged[0].outcome, "upstream_html_response");
}

async function jsonAuthIsNotRetried() {
  var calls = 0;
  var h = harness({
    label: "auth",
    callModel: async function (request) {
      calls += 1;
      throw httpError(errors.CODES.upstream_auth, "bad key");
    }
  });
  var data = fixture("short-20");
  var scope = scopeFor("conv-auth");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId);
  assert.strictEqual(view.status, "failed");
  assert.strictEqual(view.error.code, "upstream_auth");
  assert.strictEqual(calls, 1, "an auth failure is never retried");
}

async function transientErrorsRetryOnce() {
  // DNS on the first upstream call, success on the retry.
  var dns = harness({
    label: "dns",
    callModel: async function (request) {
      dns.requests.push(request);
      if (dns.requests.length === 1) throw errors.codedError(errors.CODES.upstream_network, "getaddrinfo ENOTFOUND");
      return providerResult(JSON.stringify(defaultContent(request)));
    }
  });
  var dnsScope = scopeFor("conv-dns");
  var dnsData = fixture("short-20");
  var dnsStart = await dns.orchestrator.start({ conversationId: dnsScope.conversationId, messages: dnsData.messages, language: "chinese", callModel: dns.callModel });
  var dnsView = await waitFor(dns.orchestrator, dnsScope, dnsStart.jobId);
  assert.strictEqual(dnsView.status, "ready", "a DNS failure is retried once");
  assert.strictEqual(dns.requests.length, 2);

  // 429 carrying Retry-After, success on the retry, and the wait is honoured.
  var limited = harness({
    label: "429",
    callModel: async function (request) {
      limited.requests.push(request);
      if (limited.requests.length === 1) {
        var error = errors.codedError(errors.CODES.upstream_rate_limit, "429");
        error.retryAfterMs = 12000;
        throw error;
      }
      return providerResult(JSON.stringify(defaultContent(request)));
    }
  });
  var limitedScope = scopeFor("conv-429");
  var limitedStart = await limited.orchestrator.start({ conversationId: limitedScope.conversationId, messages: dnsData.messages, language: "chinese", callModel: limited.callModel });
  var limitedView = await waitFor(limited.orchestrator, limitedScope, limitedStart.jobId);
  assert.strictEqual(limitedView.status, "ready", "a 429 is retried once");
  assert.ok(limited.slept.some(function (ms) { return ms >= 12000; }), "Retry-After is honoured, sleeps were " + JSON.stringify(limited.slept));
}

async function atMostTwoUpstreamCallsPerRequest() {
  // §6.2: "单个片段最多发生两次上游调用". A second transient failure on the
  // same request must give up rather than keep hammering the gateway.
  var h = harness({
    label: "two-strikes",
    callModel: async function (request) {
      h.requests.push(request);
      if (h.requests.length === 1) throw errors.codedError(errors.CODES.upstream_network, "ENOTFOUND");
      throw errors.codedError(errors.CODES.upstream_rate_limit, "429");
    }
  });
  var data = fixture("short-20");
  var scope = scopeFor("conv-two-strikes");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId);
  assert.strictEqual(view.status, "failed");
  assert.strictEqual(view.error.code, "upstream_rate_limit", "the last failure is the one reported");
  assert.strictEqual(h.requests.length, 2, "exactly two upstream calls for the request, got " + h.requests.length);
}

async function emptyContentRecoversFromReasoning() {
  var h = harness({
    label: "reasoning-recovery",
    callModel: async function (request) {
      h.requests.push(request);
      var payload = JSON.stringify(defaultContent(request));
      return providerResult("", { reasoning: payload });
    }
  });
  var data = fixture("short-20");
  var scope = scopeFor("conv-reasoning");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId);
  assert.strictEqual(view.status, "ready", "an empty content with valid reasoning is recovered");
  assert.strictEqual(h.requests.length, 1, "no extra call was needed");
  var trace = await h.store.readTrace(scope.conversationId, start.jobId);
  assert.ok(trace.some(function (entry) { return entry.event === "reasoning_recovered"; }), "recovery is recorded");
}

async function emptyReasoningIsRetriedShorter() {
  var sizes = [];
  var h = harness({
    label: "empty-content",
    callModel: async function (request) {
      h.requests.push(request);
      sizes.push(request.maxTokens);
      if (h.requests.length === 1) return providerResult("", { reasoning: "不是 JSON，只是思考过程" });
      return providerResult(JSON.stringify(defaultContent(request)));
    }
  });
  var data = fixture("short-20");
  var scope = scopeFor("conv-empty");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId);
  assert.strictEqual(view.status, "ready");
  assert.strictEqual(h.requests.length, 2, "an unusable empty response is retried once");
  assert.ok(sizes[1] < sizes[0], "the retry asks for a shorter answer (" + sizes[0] + " -> " + sizes[1] + ")");
  assert.ok(String(h.requests[1].userContent).length > String(h.requests[0].userContent).length, "and says so explicitly");
}

async function truncatedOutputIsRetried() {
  var h = harness({
    label: "truncated",
    callModel: async function (request) {
      h.requests.push(request);
      if (h.requests.length === 1) {
        return providerResult('{"sections":[{"type":"tldr","content":"开头",', { finishReason: "length", truncated: true });
      }
      return providerResult(JSON.stringify(defaultContent(request)));
    }
  });
  var data = fixture("short-20");
  var scope = scopeFor("conv-truncated");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId);
  assert.strictEqual(view.status, "ready", "a truncated answer never reaches the learner");
  var trace = await h.store.readTrace(scope.conversationId, start.jobId);
  assert.ok(trace.some(function (entry) { return entry.outcome === "output_truncated"; }), "truncation is classified");
}

async function unparsableOutputTriggersOneRepair() {
  var h = harness({
    label: "repair",
    callModel: async function (request) {
      h.requests.push(request);
      if (request.stage === "direct" && h.requests.filter(function (r) { return r.stage === "direct"; }).length === 1) {
        return providerResult("这不是 JSON，只是一段散文。");
      }
      return providerResult(JSON.stringify(defaultContent(request)));
    }
  });
  var data = fixture("short-20");
  var scope = scopeFor("conv-repair");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId);
  assert.strictEqual(view.status, "ready", "a targeted repair recovered the note");
  var repairCalls = h.requests.filter(function (request) { return request.stage === "repair"; });
  assert.strictEqual(repairCalls.length, 1, "exactly one repair call is made");
  assert.ok(String(repairCalls[0].userContent).indexOf("invalid notes") >= 0, "the repair prompt carries the bad output");
}

async function cancelDuringMap() {
  var h = harness({
    label: "cancel",
    callModel: async function (request) {
      h.requests.push(request);
      if (request.stage === "map") {
        await new Promise(function (resolve) { setTimeout(resolve, 30); });
        return providerResult(JSON.stringify(defaultContent(request)));
      }
      return providerResult(JSON.stringify(defaultContent(request)));
    }
  });
  var data = fixture("long-80");
  var scope = scopeFor("conv-cancel");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  await h.orchestrator.cancel({ conversationId: scope.conversationId, jobId: start.jobId });
  var view = await waitFor(h.orchestrator, scope, start.jobId, 4000);
  assert.strictEqual(view.status, "cancelled");
  assert.strictEqual(view.error.code, "cancelled");
  var callsAtCancel = h.requests.length;
  await new Promise(function (resolve) { setTimeout(resolve, 60); });
  assert.ok(h.requests.length <= callsAtCancel + 1, "cancellation stops new work");
  var finalNote = await h.store.readFinal(scope.conversationId);
  assert.strictEqual(finalNote, null, "a cancelled job never writes a note");
}

async function persistFailureKeepsCheckpoints() {
  var realStore = storeModule.createStore(tmpRoot("persist-fail"), { sleep: function () { return Promise.resolve(); } });
  var failWrites = false;
  var guarded = Object.assign({}, realStore, {
    writeFinal: function (conversationId, summary) {
      if (failWrites) {
        return Promise.reject(errors.codedError(errors.CODES.persist_failed, "EPERM storm"));
      }
      return realStore.writeFinal(conversationId, summary);
    }
  });
  var requests = [];
  var orchestrator = orchestration.createOrchestrator({
    store: guarded,
    sleep: function () { return Promise.resolve(); },
    log: function () {},
    limits: { softBudgetMs: 60000, hardBudgetMs: 120000 }
  });
  var data = fixture("long-80");
  var scope = scopeFor("conv-persist");
  var callModel = async function (request) {
    requests.push(request);
    return providerResult(JSON.stringify(defaultContent(request)));
  };
  var start = await orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: callModel });
  // The final write is the only one guarded, so the whole job runs first.
  failWrites = true;
  var view = await waitFor(orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(view.status, "failed");
  assert.strictEqual(view.error.code, "persist_failed");
  var checkpoints = await realStore.listChunks(scope.conversationId, start.jobId);
  assert.strictEqual(checkpoints.length, 2, "checkpoints survive a persistence failure");
  var callsBefore = requests.length;

  // Retrying with the checkpoint intact must not re-run the map stage.
  failWrites = false;
  await orchestrator.retry({ conversationId: scope.conversationId, jobId: start.jobId, messages: data.messages, language: "chinese", callModel: callModel });
  var retried = await waitFor(orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(retried.status, "ready", "retry after a save failure completes, got " + retried.status + " (error " + JSON.stringify(retried.error) + ")");
  var newCalls = requests.slice(callsBefore);
  assert.deepStrictEqual(newCalls.map(function (request) { return request.stage; }), ["reduce"], "only the reduce stage is re-run");
}

async function reduceFailureDegradesFromEvidence() {
  var h = harness({
    label: "degrade-reduce",
    callModel: async function (request) {
      h.requests.push(request);
      if (request.stage === "reduce") throw httpError(errors.CODES.upstream_timeout, "reduce never answers");
      return providerResult(JSON.stringify(defaultContent(request)));
    }
  });
  var data = fixture("long-80");
  var scope = scopeFor("conv-degrade-reduce");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(view.status, "degraded", "a failed merge degrades instead of failing");
  assert.strictEqual(view.degraded, true);

  var note = await h.store.readFinal(scope.conversationId);
  assert.strictEqual(schema.validateSummary(note).ok, true, "the degraded note renders");
  assert.strictEqual(note.generationMeta.decision, "degraded");
  assert.ok(note.sections.some(function (section) { return section.type === "concepts" && section.items.length >= 6; }),
    "the degraded note still carries the lesson's concepts");
  assert.ok(note.sections.some(function (section) { return section.type === "notes"; }), "and the learner's trajectory");
}

async function chunkFailureDegradesAndKeepsGoodSlices() {
  var mapAttempts = 0;
  var h = harness({
    label: "degrade-chunk",
    callModel: async function (request) {
      h.requests.push(request);
      if (request.stage === "map") {
        mapAttempts += 1;
        if (mapChunkId(request) === "chunk-002") throw httpError(errors.CODES.upstream_timeout, "slice two never answers");
      }
      return providerResult(JSON.stringify(defaultContent(request)));
    }
  });
  var data = fixture("long-80");
  var scope = scopeFor("conv-degrade-chunk");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(view.status, "degraded", "one dead slice degrades the job rather than losing the lesson");
  assert.strictEqual(h.requests.filter(function (request) { return request.stage === "reduce"; }).length, 0, "the merge is skipped when a slice is missing");
  var note = await h.store.readFinal(scope.conversationId);
  assert.ok(note.sections.some(function (section) { return section.type === "concepts"; }), "the surviving slice still produces a note");
  var job = await h.store.readJob(scope.conversationId, start.jobId);
  assert.strictEqual(job.degradedReason, "chunk_failures");

  // The note must say it is incomplete, and the score must be discounted for
  // the missing slice rather than reading as healthy.
  assert.ok(
    (note.generationMeta.warnings || []).some(function (w) { return /chunk-002/.test(w); }),
    "the note names the missing slice, got " + JSON.stringify(note.generationMeta.warnings)
  );
  assert.ok(
    (note.generationMeta.warnings || []).some(function (w) { return /scored against/i.test(w); }),
    "and says the score covers only part of the lesson"
  );
  var meta = note.generationMeta.quality.metrics;
  assert.ok(meta.chunkCompleteness < 1, "completeness is reported, got " + meta.chunkCompleteness);
  assert.ok(note.generationMeta.quality.score < meta.topicCoverage, "the score is discounted below its own coverage ratio");
}

async function resumeRerunsOnlyMissingSlices() {
  var failSecondSlice = true;
  var h = harness({
    label: "resume",
    callModel: async function (request) {
      h.requests.push(request);
      if (request.stage === "map" && mapChunkId(request) === "chunk-002" && failSecondSlice) {
        throw httpError(errors.CODES.upstream_auth, "slice two is blocked");
      }
      return providerResult(JSON.stringify(defaultContent(request)));
    }
  });
  var data = fixture("long-80");
  var scope = scopeFor("conv-resume");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var first = await waitFor(h.orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(first.status, "degraded", "the job degrades while slice two is blocked");

  var mapCallsBefore = h.requests.filter(function (request) { return request.stage === "map"; }).length;
  failSecondSlice = false;
  h.requests.length = 0;
  var resumed = await h.orchestrator.retry({ conversationId: scope.conversationId, jobId: start.jobId, messages: data.messages, language: "chinese", callModel: h.callModel });
  assert.strictEqual(resumed.jobId, start.jobId, "retry reuses the same job and its checkpoints");
  var view = await waitFor(h.orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(view.status, "ready", "the resumed job completes, got " + view.status);

  var mapStages = h.requests.filter(function (request) { return request.stage === "map"; });
  assert.strictEqual(mapStages.length, 1, "only the missing slice is re-extracted (previous run made " + mapCallsBefore + " map calls)");
  assert.strictEqual(mapChunkId(mapStages[0]), "chunk-002");
  assert.strictEqual(h.requests.filter(function (request) { return request.stage === "reduce"; }).length, 1);
}

async function idempotentDoubleClick() {
  var h = harness({ label: "idempotent" });
  var data = fixture("long-80");
  var scope = scopeFor("conv-idempotent");
  var payload = { conversationId: scope.conversationId, messages: data.messages, language: "chinese", companionName: "Luna", callModel: h.callModel };
  var first = await h.orchestrator.start(payload);
  var second = await h.orchestrator.start(payload);
  assert.strictEqual(second.jobId, first.jobId, "a second click joins the running job");
  assert.strictEqual(second.reused, true);
  var view = await waitFor(h.orchestrator, scope, first.jobId, 8000);
  assert.strictEqual(view.status, "ready");
  assert.strictEqual(h.requests.filter(function (request) { return request.stage === "reduce"; }).length, 1, "the lesson was merged exactly once");

  var third = await h.orchestrator.start(payload);
  assert.strictEqual(third.jobId, first.jobId, "a finished job is reused");
  assert.strictEqual(third.reused, true);
  assert.ok(third.summary, "the finished note is returned directly");
  assert.strictEqual(h.requests.filter(function (request) { return request.stage === "reduce"; }).length, 1, "no extra model call for a cached note");
}

async function differentSourceStartsANewJob() {
  var h = harness({ label: "new-source" });
  var data = fixture("long-80");
  var scope = scopeFor("conv-new-source");
  var first = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  await waitFor(h.orchestrator, scope, first.jobId, 8000);
  var grown = data.messages.concat([{ role: "user", content: "再讲讲最小化时的等价类怎么划分。" }, { role: "assistant", content: "按可区分性迭代分组，直到划分不再变化。" }]);
  var second = await h.orchestrator.start({ conversationId: scope.conversationId, messages: grown, language: "chinese", callModel: h.callModel });
  assert.notStrictEqual(second.jobId, first.jobId, "new source content means a new job");
  await waitFor(h.orchestrator, scope, second.jobId, 8000);
}

async function shortConversationPlaceholder() {
  var h = harness({ label: "placeholder" });
  var scope = scopeFor("conv-placeholder");
  var start = await h.orchestrator.start({
    conversationId: scope.conversationId,
    messages: [{ role: "user", content: "老师好" }, { role: "assistant", content: "你好呀" }, { role: "user", content: "[下课]" }],
    language: "chinese",
    companionName: "Luna",
    callModel: h.callModel
  });
  var view = await waitFor(h.orchestrator, scope, start.jobId);
  assert.strictEqual(view.status, "ready");
  assert.strictEqual(start.placeholder, true);
  assert.strictEqual(h.requests.length, 0, "a placeholder costs no model call");
  assert.strictEqual((await h.store.readFinal(scope.conversationId)).sections[0].type, "tldr");
}

async function callBudgetIsEnforced() {
  var attempts = 0;
  var h = harness({
    label: "budget",
    // One call allowed: the first attempt is spent, and the retry must be
    // refused by the budget rather than by the provider.
    limits: { maxCallsPerJob: 1 },
    callModel: async function () {
      attempts += 1;
      throw httpError(errors.CODES.upstream_timeout, "always slow");
    }
  });
  var data = fixture("long-80");
  var scope = scopeFor("conv-budget");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(view.status, "failed");
  assert.strictEqual(attempts, 1, "the budget stops the retry after the allowed call");
  assert.strictEqual(view.error.code, "budget_exceeded", "and it is the budget that stopped it, not the provider");
}

async function modelCallCounterStartsAtZero() {
  // A new job must carry a numeric `modelCalls`. With the property missing the
  // first increment yields NaN, `NaN >= maxCallsPerJob` is always false, and the
  // per-job budget silently never fires.
  var h = harness({ label: "counter" });
  var data = fixture("short-20");
  var scope = scopeFor("conv-counter");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var onDisk = await h.store.readJob(scope.conversationId, start.jobId);
  assert.strictEqual(typeof onDisk.modelCalls, "number", "modelCalls is a number from the very first write, got " + JSON.stringify(onDisk.modelCalls));
  assert.strictEqual(onDisk.modelCalls, 0);

  await waitFor(h.orchestrator, scope, start.jobId, 8000);
  var after = await h.store.readJob(scope.conversationId, start.jobId);
  assert.strictEqual(typeof after.modelCalls, "number", "and stays numeric after calls happen");
  assert.ok(after.modelCalls >= 1, "the counter actually counts, got " + after.modelCalls);
}

async function repairOnlyNoteStillFailsSchema() {
  var h = harness({
    label: "repair-hopeless",
    callModel: async function (request) {
      h.requests.push(request);
      if (request.stage === "map") return providerResult(JSON.stringify(evidenceForChunk(mapChunkId(request), indexesFromTranscript(request.userContent))));
      return providerResult("仍然不是 JSON。");
    }
  });
  var data = fixture("long-80");
  var scope = scopeFor("conv-repair-hopeless");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(view.status, "degraded", "an unparsable merge degrades to the evidence-based note");
  var repairCalls = h.requests.filter(function (request) { return request.stage === "repair"; });
  assert.strictEqual(repairCalls.length, 1, "exactly one repair is attempted before giving up");
  assert.ok(schema.validateSummary(await h.store.readFinal(scope.conversationId)).ok, "the degraded note still renders");
}

// One end-to-end run through the real transport, against the shared MockLLM.
async function realProviderAgainstMockLLM() {
  var mock = new MockLLM();
  await mock.start();
  try {
    mock.setResponseGenerator(function (data) {
      var userContent = String(data.messages[1].content || "");
      var isMap = userContent.indexOf("课堂片段") >= 0;
      var content = isMap
        ? JSON.stringify(evidenceForChunk((userContent.match(/chunk-\d+/) || ["chunk-001"])[0], indexesFromTranscript(userContent)))
        : JSON.stringify(summaryFromEvidence(extractJsonArray(userContent)));
      return {
        body: {
          id: "chatcmpl-mock",
          model: data.model,
          choices: [{ index: 0, message: { role: "assistant", content: content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 4200, completion_tokens: 1300 }
        }
      };
    });

    var provider = providerModule.createProvider({
      baseURL: "http://127.0.0.1:" + mock.port + "/v1",
      apiKey: "mock-key",
      model: "mock-strong",
      timeoutMs: 5000
    });

    var root = tmpRoot("real-provider");
    var store = storeModule.createStore(root, { sleep: function () { return Promise.resolve(); } });
    var orchestrator = orchestration.createOrchestrator({ store: store, sleep: function () { return Promise.resolve(); }, log: function () {}, limits: { softBudgetMs: 20000, hardBudgetMs: 30000 } });
    var data = fixture("long-80");
    var scope = scopeFor("conv-real");
    var start = await orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", companionName: "Luna", callModel: provider.call });
    var view = await waitFor(orchestrator, scope, start.jobId, 15000);
    assert.strictEqual(view.status, "ready", "the real transport path completes, got " + view.status + "/" + JSON.stringify(view.error));
    assert.strictEqual(mock.requests.length, 3, "two slices plus one merge over real HTTP");

    var trace = await store.readTrace(scope.conversationId, start.jobId);
    var responses = trace.filter(function (entry) { return entry.event === "provider_response"; });
    assert.strictEqual(responses.length, 3);
    responses.forEach(function (entry) {
      assert.strictEqual(entry.httpStatus, 200);
      assert.strictEqual(entry.promptTokens, 4200, "usage is recorded for cost/visibility");
      assert.ok(entry.elapsedMs >= 0);
    });
    assert.strictEqual(JSON.stringify(trace).indexOf("mock-key"), -1, "no key in the trace");
  } finally {
    await mock.stop();
  }
}

// Re-entry and recovery: what the UI sees when it comes back to a job it did
// not start, or to a job whose result it can no longer read.
async function latestPrefersTheRunningJob() {
  var h = harness({
    label: "latest",
    callModel: async function (request) {
      h.requests.push(request);
      if (request.stage === "map") await new Promise(function (resolve) { setTimeout(resolve, 20); });
      return providerResult(JSON.stringify(defaultContent(request)));
    }
  });
  var data = fixture("long-80");
  var scope = scopeFor("conv-latest");
  assert.strictEqual(await h.orchestrator.latest({ conversationId: "conv-empty" }), null, "no jobs means no latest");

  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var duringRun = await h.orchestrator.latest(scope);
  assert.strictEqual(duringRun.jobId, start.jobId, "the in-flight job is what a returning page must be shown");

  var settled = await waitFor(h.orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(settled.status, "ready");
  var afterRun = await h.orchestrator.latest(scope);
  assert.strictEqual(afterRun.jobId, start.jobId);
  assert.ok(afterRun.summary, "and once finished it carries the note");
}

async function aStaleRunningJobIsDemotedNotWedged() {
  var h = harness({ label: "stale" });
  var data = fixture("long-80");
  var scope = scopeFor("conv-stale");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  await waitFor(h.orchestrator, scope, start.jobId, 8000);

  // The in-memory status goes terminal *before* the durable record is written
  // (deliberate: a caller that sees `ready` must be able to trust the note and
  // the trace). Rewriting the record too early would race the run's own final
  // write, so wait for the disk copy to settle first.
  var job = await waitForDisk(h.store, scope.conversationId, start.jobId);
  job.status = "running";
  job.stage = "mapping";
  await h.store.writeJob(scope.conversationId, start.jobId, job);

  var restarted = orchestration.createOrchestrator({ store: h.store, sleep: function () { return Promise.resolve(); }, log: function () {} });
  var seen = await restarted.status({ conversationId: scope.conversationId, jobId: start.jobId });
  assert.strictEqual(seen.status, "failed", "an orphaned running job is not left wedged forever");
  assert.strictEqual(seen.error.code, "internal_error");

  var onDisk = await h.store.readJob(scope.conversationId, start.jobId);
  assert.strictEqual(onDisk.resumable, true, "and it is marked resumable so the checkpoints are reused");
  var trace = await h.store.readTrace(scope.conversationId, start.jobId);
  assert.ok(trace.some(function (entry) { return entry.event === "job_interrupted"; }), "the interruption is traced");
}

async function anUnreadableNoteIsNotPublishedBare() {
  var h = harness({ label: "unreadable" });
  var data = fixture("short-20");
  var scope = scopeFor("conv-unreadable");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  await waitFor(h.orchestrator, scope, start.jobId, 8000);

  fs.unlinkSync(h.store.finalPath(scope.conversationId));
  var seen = await h.orchestrator.status({ conversationId: scope.conversationId, jobId: start.jobId });
  assert.strictEqual(seen.status, "failed", "a ready job whose note vanished is demoted");
  assert.strictEqual(seen.error.code, "persist_failed");
  assert.strictEqual(seen.summary, undefined, "and no summary is handed to a renderer that would crash on it");
  assert.strictEqual((await h.store.readJob(scope.conversationId, start.jobId)).resumable, true, "resumable, so a retry only re-saves");
}

function tick(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms || 5); });
}

async function aTerminalJobTriggersCheckpointCleanup() {
  var h = harness({ label: "cleanup-wired" });
  var calls = 0;
  var original = h.store.cleanup;
  h.store.cleanup = function (options) { calls += 1; return original.call(h.store, options); };

  var data = fixture("short-20");
  var scope = scopeFor("conv-cleanup-wired");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(view.status, "ready");
  await tick(30);
  assert.ok(calls >= 1, "a finished job must trigger the retention sweep, calls=" + calls);

  // And the sweep must not eat the job that just finished.
  assert.ok(await h.store.readJob(scope.conversationId, start.jobId), "the finishing job survives its own sweep");
  assert.ok(await h.store.readFinal(scope.conversationId), "and so does the note");

  // A failed job must trigger it too.
  var failing = harness({
    label: "cleanup-wired-fail",
    callModel: async function () { throw httpError(errors.CODES.upstream_auth, "nope"); }
  });
  var failCalls = 0;
  var originalFail = failing.store.cleanup;
  failing.store.cleanup = function (options) { failCalls += 1; return originalFail.call(failing.store, options); };
  var failScope = scopeFor("conv-cleanup-fail");
  var failStart = await failing.orchestrator.start({ conversationId: failScope.conversationId, messages: data.messages, language: "chinese", callModel: failing.callModel });
  assert.strictEqual((await waitFor(failing.orchestrator, failScope, failStart.jobId, 8000)).status, "failed");
  await tick(30);
  assert.ok(failCalls >= 1, "a failed job triggers the sweep too, calls=" + failCalls);
}

async function aFailingCleanupDoesNotBreakTheJob() {
  var h = harness({ label: "cleanup-throws" });
  h.store.cleanup = function () { return Promise.reject(new Error("cleanup boom")); };
  var data = fixture("short-20");
  var scope = scopeFor("conv-cleanup-throws");
  var start = await h.orchestrator.start({ conversationId: scope.conversationId, messages: data.messages, language: "chinese", callModel: h.callModel });
  var view = await waitFor(h.orchestrator, scope, start.jobId, 8000);
  assert.strictEqual(view.status, "ready", "a throwing sweep is contained, job=" + view.status);
  await tick(30);
  assert.strictEqual((await h.orchestrator.status({ conversationId: scope.conversationId, jobId: start.jobId })).status, "ready");
}

async function main() {
  console.log("orchestrator smoke:");
  await scenario("a short lesson takes one call and ends ready", happyShort);
  await scenario("a long lesson maps each slice then merges once", happyLong);
  await scenario("traces carry counters, never classroom text", traceHygiene);
  await scenario("an HTML interception page is retried once", htmlOnFirstMapCall);
  await scenario("a JSON auth failure is never retried", jsonAuthIsNotRetried);
  await scenario("DNS and 429 each recover on the single retry", transientErrorsRetryOnce);
  await scenario("at most two upstream calls per model request", atMostTwoUpstreamCallsPerRequest);
  await scenario("empty content with valid reasoning is recovered", emptyContentRecoversFromReasoning);
  await scenario("empty content without reasoning retries shorter", emptyReasoningIsRetriedShorter);
  await scenario("a truncated answer is retried and never shipped", truncatedOutputIsRetried);
  await scenario("unparsable output gets exactly one targeted repair", unparsableOutputTriggersOneRepair);
  await scenario("cancelling mid-map stops work and writes nothing", cancelDuringMap);
  await scenario("a save failure keeps checkpoints and re-runs only the merge", persistFailureKeepsCheckpoints);
  await scenario("a failed merge degrades to the evidence note", reduceFailureDegradesFromEvidence);
  await scenario("a dead slice degrades without losing the lesson", chunkFailureDegradesAndKeepsGoodSlices);
  await scenario("resume re-extracts only the missing slice", resumeRerunsOnlyMissingSlices);
  await scenario("double clicking one lesson starts a single job", idempotentDoubleClick);
  await scenario("grown source content starts a new job", differentSourceStartsANewJob);
  await scenario("a too-short conversation becomes a placeholder", shortConversationPlaceholder);
  await scenario("the per-job call budget bounds retries", callBudgetIsEnforced);
  await scenario("a new job starts with a numeric model-call counter", modelCallCounterStartsAtZero);
  await scenario("a merge that never parses gets one repair then degrades", repairOnlyNoteStillFailsSchema);
  await scenario("latest() shows a returning page the job it actually needs", latestPrefersTheRunningJob);
  await scenario("a job orphaned by a restart is demoted, not wedged", aStaleRunningJobIsDemotedNotWedged);
  await scenario("a ready job with an unreadable note is not published bare", anUnreadableNoteIsNotPublishedBare);
  await scenario("reaching a terminal state triggers the retention sweep", aTerminalJobTriggersCheckpointCleanup);
  await scenario("a throwing sweep never breaks the job", aFailingCleanupDoesNotBreakTheJob);
  await scenario("real provider over HTTP against MockLLM", realProviderAgainstMockLLM);
  console.log("orchestrator smoke: PASS");
}

main().catch(function (error) {
  console.error("orchestrator smoke: FAIL — " + error.message);
  if (error.stack) console.error(error.stack.split("\n").slice(1, 5).join("\n"));
  process.exitCode = 1;
});
