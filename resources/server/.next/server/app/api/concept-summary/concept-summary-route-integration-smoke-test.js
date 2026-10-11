"use strict";

// PN-008 — route adapter contract, exercised against the real forked server.
//
// Proves the whole D seam end to end: server.js injects
// `global.__POST_CLASS_NOTES__`, the compiled route reaches it, the async job
// runs against a mock provider over real HTTP, and the note lands on disk in the
// legacy `concept-summaries/<conversationId>.json` shape.
//
//   node resources/server/.next/server/app/api/concept-summary/concept-summary-route-integration-smoke-test.js

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var workspaceRoot = path.resolve(__dirname, "..", "..", "..", "..", "..", "..", "..");
var TestEnvironment = require(path.join(workspaceRoot, "resources", "server", "smoke-test-utils.js")).TestEnvironment;

var PROFILE_ID = "test";
var WORLD_ID = "test";

// Every route except /api/account/init is behind the capability fence.
function auth(env) {
  return { Authorization: env.capabilityHeader() };
}

var TOPICS = [
  { name: "词法单元、模式与词素", facts: ["词法单元是输出的语法类别", "模式描述词素形式"], examples: ["if、position 分属不同类别"] },
  { name: "正则表达式与语言描述", facts: ["正则精确描述词法模式", "连接选择闭包是基本运算"], examples: ["letter(letter|digit)*"] },
  { name: "非确定有限自动机", facts: ["NFA 允许同一输入多条转移", "含 epsilon 转移"], examples: ["Thompson 构造"] }
];

function bodyFor(topic) {
  return [
    "**定义**：" + topic.facts[0] + "。",
    "**例子**：" + topic.examples[0] + "。",
    "",
    "**边界**：这一步要逐格填表，机械执行比凭直觉可靠，把中间结果写下来后面还要用。",
    "",
    "**易错点**：等价与相等不是一回事，混起来会在边界输入上漏判，而且会被后续步骤放大。"
  ].join("\n");
}

var DIRECT_REPLY = JSON.stringify({
  pagesRange: null,
  sections: [
    { type: "tldr", content: "本节课围绕词法分析的构造链路展开。" },
    { type: "concepts", items: TOPICS.map(function (topic) {
      return { name: topic.name, body: bodyFor(topic), sourceMessageIndexes: [0, 1] };
    }) },
    { type: "review-questions", items: [{ question: "词法单元与词素的区别？", answer: "类别与实例" }] }
  ]
});

function dialogue(turns) {
  var messages = [];
  for (var i = 0; i < turns; i++) {
    messages.push({ role: "user", content: "第 " + (i + 1) + " 个问题：这一步的边界条件是什么？" });
    messages.push({ role: "assistant", content: "先明确输入输出，再逐格推导；" + "细节说明。".repeat(6) });
  }
  return messages;
}

function request(messages, extra) {
  return Object.assign({
    action: "start",
    profileId: PROFILE_ID,
    worldId: WORLD_ID,
    conversationId: "conv-" + Math.random().toString(36).slice(2, 10),
    messages: messages,
    companionName: "Luna",
    teachingLanguage: "chinese"
  }, extra || {});
}

function notePath(env, conversationId) {
  return path.join(env.tmpDir, "accounts", "test", "profiles", PROFILE_ID, "worlds", WORLD_ID, "concept-summaries", conversationId + ".json");
}

async function poll(env, conversationId, jobId, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 15000);
  for (;;) {
    var response = await env.post("/api/concept-summary", {
      action: "status", profileId: PROFILE_ID, worldId: WORLD_ID, conversationId: conversationId, jobId: jobId
    }, auth(env));
    var body = JSON.parse(response.body);
    if (response.status !== 200) throw new Error("status poll failed: " + response.body);
    if (["ready", "degraded", "failed", "cancelled"].indexOf(body.status) >= 0) return body;
    if (Date.now() > deadline) throw new Error("job never settled, last " + body.status + "/" + body.stage);
    await new Promise(function (resolve) { setTimeout(resolve, 25); });
  }
}

async function happyPath(env) {
  var conversationId = "conv-happy-" + Date.now().toString(36);
  var messages = dialogue(12);
  var start = await env.post("/api/concept-summary", request(messages, { conversationId: conversationId }), auth(env));
  assert.strictEqual(start.status, 200, "POST start returns 200: " + start.body);
  var started = JSON.parse(start.body);
  assert.ok(started.jobId, "start returns a jobId");
  assert.ok(started.traceId, "start returns a traceId for support");
  assert.ok(["created", "running", "ready"].indexOf(started.status) >= 0, "start reports a job, not a summary (async contract)");

  // Re-entry: the page forgets the jobId but must find the job again.
  var adopted = JSON.parse((await env.post("/api/concept-summary", {
    action: "status", profileId: PROFILE_ID, worldId: WORLD_ID, conversationId: conversationId
  }, auth(env))).body);
  assert.strictEqual(adopted.jobId, started.jobId, "status without a jobId adopts the conversation's job");

  var settled = await poll(env, conversationId, started.jobId);
  assert.strictEqual(settled.status, "ready", "job completes: " + JSON.stringify(settled));
  assert.strictEqual(settled.progress, 1);
  assert.ok(settled.summary, "the terminal status carries the note");
  assert.ok(settled.summary.sections.length >= 3, "note has content");
  assert.ok(settled.summary.generationMeta, "generationMeta is attached for traceability");

  var onDisk = JSON.parse(fs.readFileSync(notePath(env, conversationId), "utf8"));
  assert.strictEqual(onDisk.conversationId, conversationId, "note keeps the legacy file layout");
  assert.ok(Array.isArray(onDisk.sections) && onDisk.sections.length, "note is readable by the old shape");

  // GET is unchanged by stage D.
  var got = await env.get("/api/concept-summary?profileId=" + PROFILE_ID + "&worldId=" + WORLD_ID + "&conversationId=" + conversationId, auth(env))
    .catch(function () { return null; });
  if (got) {
    assert.strictEqual(got.status, 200);
    assert.ok(JSON.parse(got.body).summary, "GET single still returns { summary }");
  }

  var requestsBefore = env.mockLLM.requests.length;
  var again = await env.post("/api/concept-summary", request(messages, { conversationId: conversationId }), auth(env));
  var reused = JSON.parse(again.body);
  assert.strictEqual(reused.jobId, started.jobId, "the same source reuses the finished job");
  assert.strictEqual(reused.reused, true);
  assert.ok(reused.summary, "the reused response carries the note");
  assert.strictEqual(env.mockLLM.requests.length, requestsBefore, "reuse costs no model call");

  return { conversationId: conversationId, jobId: started.jobId };
}

async function placeholderPath(env) {
  var conversationId = "conv-short-" + Date.now().toString(36);
  var start = await env.post("/api/concept-summary", request([
    { role: "user", content: "老师好" },
    { role: "assistant", content: "你好呀" },
    { role: "user", content: "[下课]" }
  ], { conversationId: conversationId }), auth(env));
  assert.strictEqual(start.status, 200, "a too-short conversation is not an error");
  var body = JSON.parse(start.body);
  assert.strictEqual(body.status, "ready", "the placeholder resolves synchronously");
  assert.strictEqual(body.placeholder, true);
  assert.ok(body.summary.sections[0].type === "tldr", "placeholder is a tldr");
}

async function validationPath(env) {
  var missing = await env.post("/api/concept-summary", { action: "start", profileId: PROFILE_ID }, auth(env));
  assert.strictEqual(missing.status, 400);
  assert.strictEqual(JSON.parse(missing.body).code, "bad_request");

  var tooFew = await env.post("/api/concept-summary", request([{ role: "user", content: "只有一条" }]), auth(env));
  assert.strictEqual(tooFew.status, 400);
  assert.strictEqual(JSON.parse(tooFew.body).code, "bad_request");

  var unknown = await env.post("/api/concept-summary", request(dialogue(8), { action: "nonsense" }), auth(env));
  assert.strictEqual(unknown.status, 400);
  assert.ok(/Unknown action/.test(JSON.parse(unknown.body).error), "unknown actions are rejected explicitly");

  // status without a jobId is the re-entry path: adopt whatever job the page
  // left behind. With none, that is a clean 404 rather than a validation error.
  var noJob = await env.post("/api/concept-summary", { action: "status", profileId: PROFILE_ID, worldId: WORLD_ID, conversationId: "conv-without-jobs" }, auth(env));
  assert.strictEqual(noJob.status, 404);
  assert.strictEqual(JSON.parse(noJob.body).code, "not_found");

  // cancel still needs an explicit jobId.
  var cancelNoJob = await env.post("/api/concept-summary", { action: "cancel", profileId: PROFILE_ID, worldId: WORLD_ID, conversationId: "c1" }, auth(env));
  assert.strictEqual(cancelNoJob.status, 400);
  assert.strictEqual(JSON.parse(cancelNoJob.body).code, "bad_request");

  var notFound = await env.post("/api/concept-summary", { action: "status", profileId: PROFILE_ID, worldId: WORLD_ID, conversationId: "c1", jobId: "pn_missing" }, auth(env));
  assert.strictEqual(notFound.status, 404);
  assert.strictEqual(JSON.parse(notFound.body).code, "not_found");
  assert.ok(JSON.parse(notFound.body).error.length > 0, "not-found carries a human message");
}

async function upstreamHtmlPath(env) {
  var conversationId = "conv-html-" + Date.now().toString(36);
  env.mockLLM.setRawResponse("<!DOCTYPE html>\n<html><body>403 blocked</body></html>", 403, "text/html");
  var start = await env.post("/api/concept-summary", request(dialogue(10), { conversationId: conversationId }), auth(env));
  var started = JSON.parse(start.body);
  assert.strictEqual(start.status, 200, "an upstream outage is a job-level failure, not a route crash");
  var settled = await poll(env, conversationId, started.jobId);
  assert.strictEqual(settled.status, "failed", "an HTML interception page fails the job");
  assert.strictEqual(settled.code, "upstream_html_response", "with the stable error code, not a JSON syntax error");
  assert.ok(!/Unexpected token/.test(JSON.stringify(settled)), "the old '<' symptom is gone");
}

var ENV = null;

async function main() {
  var env = new TestEnvironment({});
  ENV = env;
  try {
    await env.setup();
    env.mockLLM.setResponse({ choices: [{ message: { role: "assistant", content: DIRECT_REPLY }, finish_reason: "stop" }] });
    await happyPath(env);
    await placeholderPath(env);
    await validationPath(env);
    await upstreamHtmlPath(env);
  } finally {
    await env.teardown();
  }
  console.log("concept-summary route integration smoke: PASS");
}

main().catch(function (error) {
  console.error("concept-summary route integration smoke: FAIL — " + (error && error.message));
  if (error && error.stack) console.error(error.stack.split("\n").slice(1, 5).join("\n"));
  // The forked server's output is the only window into a 500 from the route.
  if (ENV && ENV.serverStderr) console.error("--- server stderr ---\n" + ENV.serverStderr.split("\n").slice(-60).join("\n"));
  if (ENV && ENV.serverStdout) console.error("--- server stdout ---\n" + ENV.serverStdout.split("\n").slice(-60).join("\n"));
  process.exitCode = 1;
});
