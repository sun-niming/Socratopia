"use strict";

// PN-005 — quality scoring and deterministic degradation.
//
// The point of these assertions is discrimination: a rich note must be
// accepted, a thin one must not, and a missing-evidence note must never be
// waved through.  Thresholds are therefore asserted on fixture-derived inputs,
// not on hand-tuned constants.
//
//   node resources/server/lib/post-class-notes/quality-smoke-test.js

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var quality = require("./quality.js");
var schema = require("./schema.js");

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name + ".json"), "utf8"));
}

function scenario(name, body) {
  try {
    body();
    console.log("  ok   " + name);
  } catch (error) {
    error.message = name + ": " + error.message;
    throw error;
  }
}

var LONG = fixture("long-80");

var TOPICS = [
  { name: "词法单元、模式与词素", facts: ["词法单元是输出的语法类别", "模式描述词素形式", "词素是实际字符序列"], example: "if 与 position 分属不同类别", sourceMessageIndexes: [0, 1, 3] },
  { name: "正则表达式与语言描述", facts: ["正则精确描述词法模式", "连接选择闭包是基本运算", "正则定义可命名"], example: "letter(letter|digit)*", sourceMessageIndexes: [5, 6] },
  { name: "非确定有限自动机", facts: ["NFA 允许同一输入多条转移", "含 epsilon 转移", "NFA 与正则等价"], example: "Thompson 构造", sourceMessageIndexes: [9, 11] },
  { name: "确定有限自动机与子集构造", facts: ["DFA 每状态每输入一条转移", "子集构造把状态集合变成状态", "最坏指数增长"], example: "epsilon-closure 计算", sourceMessageIndexes: [14, 16] },
  { name: "DFA 最小化", facts: ["合并不可区分状态", "划分细化迭代", "最小 DFA 唯一"], example: "先按接受性划分", sourceMessageIndexes: [20, 22] },
  { name: "词法分析器构造与缓冲", facts: ["双缓冲用哨兵", "前瞻把字符送回", "缓冲与回退是工程约束"], example: "读 <= 时前瞻一位", sourceMessageIndexes: [26, 28] },
  { name: "词法错误恢复", facts: ["需要可继续的恢复策略", "删除或插入字符", "恐慌模式依赖同步集"], example: "1x 删除数字", sourceMessageIndexes: [32, 34] }
];

var LEARNER_EVIDENCE = [
  { kind: "misconception", content: "我理解非确定有限自动机就是把它直接翻译成程序里的 if-else 吧", sourceMessageIndexes: [9] },
  { kind: "confusion", content: "到这里有点乱：DFA 最小化的中间结果到底要不要保留下来", sourceMessageIndexes: [20] },
  { kind: "shift", content: "原来我以为正则表达式和 NFA 是同一层的东西，现在看它们是不同抽象层级", sourceMessageIndexes: [11] },
  { kind: "correct", content: "所以关键在于把非确定的多个选择合并成一个确定的状态集合", sourceMessageIndexes: [16] }
];

var OPEN_QUESTIONS = [
  { content: "最小化之后的 DFA 是否唯一", sourceMessageIndexes: [22] },
  { content: "子集构造在什么输入下会爆炸", sourceMessageIndexes: [16] }
];

var KEY_INSIGHTS = [
  { content: "正则和 NFA 不是一回事，是不同抽象层级", sourceMessageIndexes: [11] }
];

var REVIEW_CANDIDATES = [
  { question: "词法单元与词素有什么区别？", answer: "类别与实例", sourceMessageIndexes: [1] },
  { question: "为什么子集构造能保证确定性？", answer: "把可能状态集合变成一个状态", sourceMessageIndexes: [14] },
  { question: "DFA 最小化合并的是什么状态？", answer: "不可区分的等价状态", sourceMessageIndexes: [20] },
  { question: "双缓冲区的哨兵字符解决什么问题？", answer: "省掉边界判断", sourceMessageIndexes: [26] },
  { question: "词法错误恢复为什么必须前进？", answer: "否则会死循环", sourceMessageIndexes: [32] }
];

function evidenceFor(chunks) {
  var count = chunks || 2;
  var out = [];
  for (var i = 0; i < count; i++) {
    out.push({
      chunkId: "chunk-00" + (i + 1),
      messageRange: [0, 79],
      sourceIndexes: Array.apply(null, Array(80)).map(function (_, index) { return index; }),
      topics: i === 0 ? TOPICS.slice(0, 4) : TOPICS.slice(3),
      learnerEvidence: i === 0 ? LEARNER_EVIDENCE.slice(0, 2) : LEARNER_EVIDENCE.slice(2),
      keyInsights: i === 0 ? [] : KEY_INSIGHTS,
      openQuestions: i === 0 ? OPEN_QUESTIONS.slice(0, 1) : OPEN_QUESTIONS.slice(1),
      reviewCandidates: i === 0 ? REVIEW_CANDIDATES.slice(0, 3) : REVIEW_CANDIDATES.slice(3)
    });
  }
  return out;
}

function bodyFor(topic) {
  return [
    topic.facts.map(function (fact) { return "- " + fact; }).join("\n"),
    "",
    "**例子**：" + topic.example,
    "",
    "**边界**：这一层的推导必须逐格填状态表，机械执行比凭直觉可靠；把中间结果写下来，后面最小化还要用。",
    "",
    "**易错点**：等价与相等不是一回事。等价是可区分的反面，不等同于形式相同；把两者混起来会在细化划分时走偏。",
    "",
    "**推导步骤**：先把输入符号表列全，再对每个状态逐个符号求后继；遇到集合就展开成新的行，重复的行合并。整张表填完之后，接受状态与起点状态单独标出来，这样后续的细化才有明确的锚点。",
    "",
    "**应用**：把这张表交给表驱动扫描器即可直接跑，不需要额外解释；验证时用一组正例与一组反例各自过一遍，反例必须落在拒绝状态上才算正确。",
    "",
    "**与相邻概念的关系**：这一层是上一层的机械化形式，输入输出对象都没变，变的只是表示；它又是下一层的输入，所以这里漏掉一个状态，后面的构造会把错误放大成整片不可达区域。",
    "",
    "**为什么值得单独拿出来讲**：课堂上学习者在这里卡住过一次，误以为可以跳过中间表示直接写代码，结果在边界输入上漏判，回头补表花了更多时间。"
  ].join("\n");
}

function richSummary(evidence) {
  var concepts = TOPICS.map(function (topic) {
    return { name: topic.name, body: bodyFor(topic), sourceMessageIndexes: topic.sourceMessageIndexes };
  });
  return schema.normalizeSummary({
    sections: [
      { type: "tldr", content: "本节课从词法单元的定义出发，完整走了一遍正则→NFA→DFA→最小化的构造链路。" },
      { type: "narrative", content: "从把模式当成串的误解开始，先把类别与实例分清，再逐层走到最小化，最后落回工程上的缓冲与错误恢复。" },
      { type: "concepts", items: concepts },
      { type: "key-insight", content: KEY_INSIGHTS[0].content, sourceMessageIndexes: KEY_INSIGHTS[0].sourceMessageIndexes },
      { type: "notes", title: "学习轨迹", content: LEARNER_EVIDENCE.map(function (item) { return "- **" + item.kind + "**：" + item.content; }).join("\n") },
      { type: "open-question", content: OPEN_QUESTIONS[0].content },
      { type: "review-questions", items: REVIEW_CANDIDATES }
    ]
  }).summary;
}

function scoreRich(evidence) {
  return quality.score({ summary: richSummary(evidence), evidence: evidence, sourceMessageCount: 80, language: "chinese" });
}

// --- the good case ---------------------------------------------------------

function richIsAccepted() {
  var evidence = evidenceFor(2);
  var result = scoreRich(evidence);
  assert.strictEqual(result.decision, "accept", "a complete note is accepted, warnings: " + result.warnings.join("; "));
  assert.ok(result.score >= quality.ACCEPT_THRESHOLD, "score " + result.score + " clears the accept threshold");
  assert.strictEqual(result.metrics.topicCoverage, 1, "every evidence topic is represented");
  assert.strictEqual(result.metrics.sourceIntegrity, 1, "every concept and insight carries a source index");
  assert.strictEqual(result.metrics.learnerEvidenceCoverage, 1, "learner misconceptions survive into the note");
}

// --- the thin cases --------------------------------------------------------

function tldrOnlyIsRemerged() {
  var evidence = evidenceFor(2);
  var summary = schema.normalizeSummary({ sections: [{ type: "tldr", content: "本节讲了词法分析。" }] }).summary;
  var result = quality.score({ summary: summary, evidence: evidence, sourceMessageCount: 80, language: "chinese" });
  assert.strictEqual(result.metrics.topicCoverage, 0, "no concepts means no topic coverage");
  assert.strictEqual(result.decision, "remerge", "a tldr-only note is re-merged");
}

function missingSourcesBlocksAcceptance() {
  var evidence = evidenceFor(2);
  var summary = richSummary(evidence);
  summary.sections.forEach(function (section) {
    delete section.sourceMessageIndexes;
    (section.items || []).forEach(function (item) { delete item.sourceMessageIndexes; });
  });
  var result = quality.score({ summary: summary, evidence: evidence, sourceMessageCount: 80, language: "chinese" });
  assert.strictEqual(result.metrics.sourceIntegrity, 0, "no item carries a source");
  assert.strictEqual(result.decision, "repair", "sourceIntegrity below 1.0 can never be a straight accept");
  assert.ok(result.warnings.some(function (warning) { return /sourceIntegrity/.test(warning); }));
}

function inventedTopicsArePenalized() {
  var evidence = evidenceFor(2);
  var summary = richSummary(evidence);
  summary.sections[2].items.push({ name: "带余除法", body: "教材标题里有但课堂没讲过。" + "补充说明。".repeat(12) });
  var result = quality.score({ summary: summary, evidence: evidence, sourceMessageCount: 80, language: "chinese" });
  assert.ok(result.metrics.unsupportedTopicRatio > 0, "an unbacked concept is detected");
  assert.ok(result.warnings.some(function (warning) { return /no chunk-evidence source/.test(warning); }), "and reported");
  assert.ok(result.score < scoreRich(evidence).score, "an invented topic lowers the score");
}

function duplicatesArePenalized() {
  var evidence = evidenceFor(2);
  var summary = richSummary(evidence);
  var clone = JSON.parse(JSON.stringify(summary.sections[2].items[0]));
  clone.name = "词法单元、模式与词素（重复）";
  summary.sections[2].items.push(clone);
  var result = quality.score({ summary: summary, evidence: evidence, sourceMessageCount: 80, language: "chinese" });
  assert.ok(result.metrics.duplicationRatio >= 0.2, "a duplicated body is measured");
  assert.ok(result.warnings.some(function (warning) { return /duplicate/.test(warning); }));
}

function repetitiveReviewQuestionsLoseDiversity() {
  var evidence = evidenceFor(2);
  var summary = richSummary(evidence);
  summary.sections[summary.sections.length - 1].items = [
    { question: "什么是词素？" },
    { question: "什么是词素？" },
    { question: "什么是词素？" }
  ];
  var result = quality.score({ summary: summary, evidence: evidence, sourceMessageCount: 80, language: "chinese" });
  assert.ok(result.metrics.reviewQuestionDiversity <= 0.01, "identical questions score zero diversity");
}

function lengthFitnessTracksTheBand() {
  var evidence = evidenceFor(2);
  var short = quality.score({ summary: schema.normalizeSummary({ sections: [{ type: "tldr", content: "短。" }] }).summary, evidence: evidence, sourceMessageCount: 80, language: "chinese" });
  var rich = scoreRich(evidence);
  assert.ok(rich.metrics.lengthFitness > short.metrics.lengthFitness, "the richer note fits the 80-message band better");
  assert.ok(rich.metrics.lengthChars >= 3000 && rich.metrics.lengthChars <= 5000, "rich note length " + rich.metrics.lengthChars + " is inside the 80-message band");
}

// --- deterministic degradation (§3.5) -------------------------------------

function degradeKeepsEverything() {
  var built = quality.assembleDegraded({ evidence: evidenceFor(2), language: "chinese" });
  var check = schema.validateSummary(built);
  assert.strictEqual(check.ok, true, "assembled note is renderable: " + check.errors.join("; "));

  var types = built.sections.map(function (section) { return section.type; });
  assert.ok(types.indexOf("tldr") >= 0, "tldr is synthesized");
  assert.ok(types.indexOf("concepts") >= 0, "topics become concepts");
  assert.ok(types.indexOf("notes") >= 0, "learner evidence is preserved");
  assert.ok(types.indexOf("key-insight") >= 0, "the learner's insight survives");
  assert.ok(types.indexOf("review-questions") >= 0, "review candidates survive");

  var concepts = built.sections.filter(function (section) { return section.type === "concepts"; })[0].items;
  assert.strictEqual(concepts.length, TOPICS.length, "overlapping chunk topics are deduplicated, not stacked");
  concepts.forEach(function (concept) {
    assert.ok(concept.sourceMessageIndexes && concept.sourceMessageIndexes.length, concept.name + " keeps a source index");
  });
  var review = built.sections.filter(function (section) { return section.type === "review-questions"; })[0].items;
  assert.ok(review.length <= 5, "review questions stay within the 3-5 target");
  assert.strictEqual(built.degraded, true, "the note is marked degraded for the UI");
}

function degradeScoresAcceptably() {
  var evidence = evidenceFor(2);
  var built = quality.assembleDegraded({ evidence: evidence, language: "chinese" });
  var result = quality.score({ summary: built, evidence: evidence, sourceMessageCount: 80, language: "chinese" });
  assert.ok(result.score >= quality.REPAIR_THRESHOLD, "a degraded note scores " + result.score + ", above the remerge floor");
  assert.strictEqual(result.metrics.topicCoverage, 1, "degradation loses no topic");
}

function degradeWithoutEvidence() {
  var built = quality.assembleDegraded({ evidence: [], language: "chinese" });
  assert.strictEqual(schema.validateSummary(built).ok, false, "an empty note is flagged rather than shipped blank");
}

function degradeIsLanguageAware() {
  var built = quality.assembleDegraded({ evidence: evidenceFor(1), language: "english" });
  assert.ok(/This lesson covered/.test(built.sections[0].content), "english tldr, got: " + built.sections[0].content);
}

// --- metrics never escape 0..1 --------------------------------------------

function metricsAreBounded() {
  var evidence = evidenceFor(2);
  var summary = schema.normalizeSummary({
    sections: [
      { type: "concepts", items: [{ name: "x", body: "y", sourceMessageIndexes: [999] }] },
      { type: "review-questions", items: [{ question: "q1" }, { question: "q2" }] }
    ]
  }).summary;
  var result = quality.score({ summary: summary, evidence: evidence, sourceMessageCount: 80, language: "chinese" });
  Object.keys(result.metrics).forEach(function (key) {
    if (/Ratio$|Coverage$|Integrity$|Fitness$|Validity$|Diversity$|^score$/.test(key)) {
      assert.ok(result.metrics[key] >= 0 && result.metrics[key] <= 1, key + " out of range: " + result.metrics[key]);
    }
  });
  assert.strictEqual(result.metrics.sourceIntegrity, 0, "an out-of-range source index does not count");
  assert.ok(result.score >= 0 && result.score <= 1);
}

function longFixtureThroughAllSteps() {
  assert.strictEqual(LONG.messages.length, 80, "fixture shape");
  var evidence = evidenceFor(2);
  var built = quality.assembleDegraded({ evidence: evidence, language: "chinese" });
  assert.strictEqual(schema.normalizeSummary(built).summary.sections.length, built.sections.length, "every assembled section renders");
}

console.log("quality smoke:");
scenario("a complete note is accepted", richIsAccepted);
scenario("a tldr-only note is re-merged", tldrOnlyIsRemerged);
scenario("missing source indexes block acceptance", missingSourcesBlocksAcceptance);
scenario("invented topics are penalized and reported", inventedTopicsArePenalized);
scenario("duplicated concepts are penalized", duplicatesArePenalized);
scenario("repetitive review questions lose diversity", repetitiveReviewQuestionsLoseDiversity);
scenario("length fitness tracks the message-count band", lengthFitnessTracksTheBand);
scenario("degraded assembly preserves every topic and insight", degradeKeepsEverything);
scenario("degraded assembly still scores above the floor", degradeScoresAcceptably);
scenario("degradation without evidence is flagged", degradeWithoutEvidence);
scenario("degradation follows the lesson language", degradeIsLanguageAware);
scenario("all ratio metrics stay inside 0..1", metricsAreBounded);
scenario("fixture-driven end-to-end", longFixtureThroughAllSteps);
console.log("quality smoke: PASS");
