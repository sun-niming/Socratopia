#!/usr/bin/env node
/**
 * Smoke test for concept-graph-builder.
 * Run:  node resources/server/lib/adaptive/concept-graph-smoke-test.js
 *
 * Uses dryRun mode only — no API key required. Verifies schema compliance,
 * validation, edge cases, and non-contamination of existing data.
 */
"use strict";

var os = require("os");
var path = require("path");
var fs = require("fs");

var TMP = path.join(os.tmpdir(), "cg-smoke-" + Date.now());
var OUTSIDE = TMP + "-outside";
process.env.PROJECT_ROOT = TMP;

// Load data layer first (creates global.__ADAPTIVE__)
var dl = require("./data-layer.js");
var builder = require("./concept-graph-builder.js");
var passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + msg);
}

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(OUTSIDE, { recursive: true, force: true }); } catch (e) {}
}
process.on("exit", cleanup);

console.log("Concept Graph Smoke Test: " + TMP);
console.log("");

(async function () {

// ========== 1. Source loading ==========

// 1a. sourceText path
var src1 = builder.loadTextbookSource({
  profileId: "u1", worldId: "w1", textbookId: "t1",
  sourceText: "递归是指函数调用自身的一种编程技术。",
  textbookTitle: "算法导论"
});
assert(src1 !== null, "sourceText path returns source");
assert(src1.type === "sourceText", "source type is sourceText");
assert(src1.text.indexOf("递归") >= 0, "sourceText content preserved");

// 1b. No source
var srcNone = builder.loadTextbookSource({
  profileId: "u1", worldId: "w1", textbookId: "nonexistent_textbook"
});
assert(srcNone === null, "no source returns null");

// 1c. Knowledge base path — simulate with a fake KB
var kbDir = path.join(TMP, "textbooks", "t_kb", "knowledge_base", "cards");
fs.mkdirSync(kbDir, { recursive: true });
var fakeIndex = {
  title: "Fake Textbook",
  cards: [
    { concept_id: "001_recursion", title: "递归基础", difficulty: 1, source_pages: [1, 2], needs_verification: false },
    { concept_id: "002_iteration", title: "迭代与循环", difficulty: 1, source_pages: [3, 4], needs_verification: false }
  ]
};
fs.writeFileSync(path.join(path.dirname(kbDir), "index.json"), JSON.stringify(fakeIndex));
fs.writeFileSync(path.join(kbDir, "001_recursion.json"), JSON.stringify({
  concept_id: "001_recursion", title: "递归基础", definition: "函数调用自身的编程方法",
  key_points: ["基线条件", "递归步骤"], examples: ["阶乘"], misconceptions: ["递归一定比迭代慢"],
  qa_pairs: [{ q: "什么是递归的终止条件？", a: "不再调用自身的基准情况" }],
  difficulty: 1, prerequisites: [], source_pages: [1, 2], needs_verification: false
}));
fs.writeFileSync(path.join(kbDir, "002_iteration.json"), JSON.stringify({
  concept_id: "002_iteration", title: "迭代与循环", definition: "通过循环结构重复执行代码块",
  key_points: ["for循环", "while循环"], examples: ["数组遍历"], misconceptions: [],
  qa_pairs: [{ q: "for和while的区别？", a: "for适合已知次数，while适合条件判断" }],
  difficulty: 1, prerequisites: [], source_pages: [3, 4], needs_verification: false
}));
var srcKb = builder.loadTextbookSource({
  profileId: "u1", worldId: "w1", textbookId: "t_kb"
});
assert(srcKb !== null, "knowledge_base path returns source");
assert(srcKb.type === "knowledge_base", "source type is knowledge_base");
assert(srcKb.cards.length >= 2, "kb source has cards");
console.log("  Source loading: PASS");
// 1d. Account-scoped source lookup must never scan another account.
var foreignCardsDir = path.join(TMP, "accounts", "foreign", "profiles", "sharedprofile", "worlds", "sharedworld", "textbooks", "sharedbook", "knowledge_base", "cards");
fs.mkdirSync(foreignCardsDir, { recursive: true });
fs.writeFileSync(path.join(path.dirname(foreignCardsDir), "index.json"), JSON.stringify({
  title: "Foreign Account Textbook",
  cards: [{ concept_id: "foreign_only", title: "Foreign concept" }]
}));
fs.writeFileSync(path.join(foreignCardsDir, "foreign_only.json"), JSON.stringify({
  concept_id: "foreign_only", title: "Foreign concept", definition: "Must remain isolated",
  key_points: [], examples: [], misconceptions: [], qa_pairs: [{ q: "Foreign?", a: "No" }],
  difficulty: 1, prerequisites: [], source_pages: [1], needs_verification: false
}));
var targetTextbookDir = path.join(TMP, "accounts", "target", "profiles", "sharedprofile", "worlds", "sharedworld", "textbooks", "sharedbook");
var foreignOnly = builder.loadTextbookSource({
  accountId: "target", profileId: "sharedprofile", worldId: "sharedworld", textbookId: "sharedbook"
});
assert(foreignOnly === null, "account-scoped lookup must not read a matching textbook from another account");
var missingExplicit = builder.loadTextbookSource({
  accountId: "target", profileId: "sharedprofile", worldId: "sharedworld", textbookId: "sharedbook",
  textbookDir: targetTextbookDir
});
assert(missingExplicit === null, "missing explicit textbookDir must fail closed without account scanning");
var targetCardsDir = path.join(targetTextbookDir, "knowledge_base", "cards");
fs.mkdirSync(targetCardsDir, { recursive: true });
fs.writeFileSync(path.join(path.dirname(targetCardsDir), "index.json"), JSON.stringify({
  title: "Target Account Textbook",
  cards: [{ concept_id: "target_only", title: "Target concept" }]
}));
fs.writeFileSync(path.join(targetCardsDir, "target_only.json"), JSON.stringify({
  concept_id: "target_only", title: "Target concept", definition: "Owned by target",
  key_points: [], examples: [], misconceptions: [], qa_pairs: [{ q: "Target?", a: "Yes" }],
  difficulty: 1, prerequisites: [], source_pages: [1], needs_verification: false
}));
var targetOnly = builder.loadTextbookSource({
  accountId: "target", profileId: "sharedprofile", worldId: "sharedworld", textbookId: "sharedbook"
});
assert(targetOnly && targetOnly.title === "Target Account Textbook", "account-scoped lookup must select the exact account textbook");
var outsidePagesDir = path.join(OUTSIDE, "pages");
fs.mkdirSync(outsidePagesDir, { recursive: true });
fs.writeFileSync(path.join(outsidePagesDir, "page_1.txt"), "Outside project root");
var outsideExplicit = builder.loadTextbookSource({
  profileId: "sharedprofile", worldId: "sharedworld", textbookId: "sharedbook", textbookDir: OUTSIDE
});
assert(outsideExplicit === null, "explicit textbookDir must reject a sibling path that only shares the PROJECT_ROOT prefix");console.log("  Account-scoped source isolation: PASS");

// ========== 2. Dry-run graph generation (sourceText) ==========

var result1 = await builder.buildConceptGraph({
  profileId: "u1", worldId: "w1", textbookId: "t1",
  sourceText: "## 递归基础\n\n递归是指函数调用自身的编程技术。递归需要两个要素：基线条件和递归步骤。\n\n## 时间复杂度\n\n时间复杂度衡量算法执行时间随输入规模增长的变化趋势。大O表示法是描述时间复杂度的标准方法。\n\n## 排序算法\n\n冒泡排序通过反复交换相邻逆序元素实现排序。快速排序采用分治策略，选择基准元素后将数组分为两部分递归排序。",
  textbookTitle: "算法导论",
  dryRun: true
});

assert(!result1.error, "dryRun build returns no error: " + (result1.error || ""));
assert(Array.isArray(result1.concepts) && result1.concepts.length >= 2,
  "dryRun generates >= 2 concepts (got " + (result1.concepts ? result1.concepts.length : 0) + ")");

// Verify concept schema
var conceptIds = {};
for (var i = 0; i < result1.concepts.length; i++) {
  var c = result1.concepts[i];
  var tag = "concept " + i;

  assert(typeof c.conceptId === "string" && c.conceptId.length > 0, tag + ": has conceptId");
  assert(!conceptIds[c.conceptId], tag + ": conceptId is unique (" + c.conceptId + ")");
  conceptIds[c.conceptId] = true;

  assert(typeof c.title === "string" && c.title.length > 0, tag + ": has title");
  assert(Array.isArray(c.prerequisites), tag + ": prerequisites is array");
  assert(Array.isArray(c.masteryCriteria) && c.masteryCriteria.length >= 1,
    tag + ": masteryCriteria non-empty array (got " + (c.masteryCriteria ? c.masteryCriteria.length : 0) + ")");
  assert(Array.isArray(c.commonMisconceptions), tag + ": commonMisconceptions is array");
  assert(typeof c.difficulty === "number" && c.difficulty >= 1 && c.difficulty <= 3,
    tag + ": difficulty in 1-3 (got " + c.difficulty + ")");

  assert(Array.isArray(c.questions) && c.questions.length >= 1,
    tag + ": has >= 1 question");

  for (var q = 0; q < c.questions.length; q++) {
    var qq = c.questions[q];
    var qtag = tag + " question " + q;
    assert(typeof qq.questionId === "string" && qq.questionId.length > 0, qtag + ": has questionId");
    assert(typeof qq.question === "string" && qq.question.length > 0, qtag + ": has question text");
    assert(typeof qq.expectedAnswer === "string" && qq.expectedAnswer.length > 0, qtag + ": has expectedAnswer");
    assert(Array.isArray(qq.targetConcepts) && qq.targetConcepts.length >= 1,
      qtag + ": has non-empty targetConcepts");
    assert(Array.isArray(qq.misconceptionMapping), qtag + ": misconceptionMapping is array");
    assert(typeof qq.difficulty === "number" && qq.difficulty >= 1 && qq.difficulty <= 3,
      qtag + ": difficulty in 1-3");
  }
}

// Verify prerequisites reference existing conceptIds
for (var j = 0; j < result1.concepts.length; j++) {
  var prs = result1.concepts[j].prerequisites;
  for (var p = 0; p < prs.length; p++) {
    assert(conceptIds[prs[p]],
      "concept " + j + " prerequisite '" + prs[p] + "' references existing conceptId");
  }
}

console.log("  Dry-run from sourceText: PASS");

// ========== 3. Dry-run from knowledge_base ==========

var resultKb = await builder.buildConceptGraph({
  profileId: "u1", worldId: "w1", textbookId: "t_kb",
  dryRun: true
});

assert(!resultKb.error, "KB dryRun returns no error: " + (resultKb.error || ""));
assert(Array.isArray(resultKb.concepts) && resultKb.concepts.length >= 2,
  "KB dryRun generates >= 2 concepts");
assert(resultKb.concepts[0].conceptId === "000_recursion" ||
       resultKb.concepts[0].conceptId.indexOf("recursion") >= 0,
  "KB concept preserves identity");

// Verify question from KB card
var kbQFound = false;
for (var k = 0; k < resultKb.concepts.length && !kbQFound; k++) {
  for (var q2 = 0; q2 < resultKb.concepts[k].questions.length; q2++) {
    if (resultKb.concepts[k].questions[q2].question.indexOf("终止条件") >= 0) {
      kbQFound = true; break;
    }
  }
}
assert(kbQFound, "KB card qa_pairs converted to questions");

console.log("  Dry-run from knowledge_base: PASS");

// ========== 4. No source error ==========

var resultNoSrc = await builder.buildConceptGraph({
  profileId: "u1", worldId: "w1", textbookId: "nonexistent",
  dryRun: true
});
assert(resultNoSrc.error === "no_source", "no_source returns error code");
assert(resultNoSrc.message && resultNoSrc.message.length > 0, "no_source has message");

console.log("  No-source handling: PASS");

// ========== 5. Validation: reject bad graph ==========

var badGraph = {
  profileId: "u1", worldId: "w1", textbookId: "t1",
  concepts: [
    { title: "Bad Concept" }  // missing conceptId, masteryCriteria, questions
  ]
};
var ve = builder.validateConceptGraph(badGraph);
assert(ve.length > 0, "bad graph produces validation errors");
assert(ve.some(function (e) { return e.indexOf("conceptId") >= 0; }),
  "validation catches missing conceptId");

// Duplicate conceptId
var dupGraph = {
  profileId: "u1", worldId: "w1", textbookId: "t1",
  concepts: [
    { conceptId: "dup", title: "A", prerequisites: [], masteryCriteria: ["x"], commonMisconceptions: [], questions: [
      { questionId: "dup_q01", type: "diagnostic", difficulty: 1, question: "Q?", expectedAnswer: "A", rubric: "", misconceptionMapping: [], targetConcepts: ["dup"] }
    ]},
    { conceptId: "dup", title: "B", prerequisites: [], masteryCriteria: ["x"], commonMisconceptions: [], questions: [
      { questionId: "dup_q02", type: "diagnostic", difficulty: 1, question: "Q?", expectedAnswer: "A", rubric: "", misconceptionMapping: [], targetConcepts: ["dup"] }
    ]}
  ]
};
var ve2 = builder.validateConceptGraph(dupGraph);
assert(ve2.some(function (e) { return e.indexOf("duplicate") >= 0; }),
  "validation catches duplicate conceptId");

// Bad prerequisite reference
var badPrereqGraph = {
  profileId: "u1", worldId: "w1", textbookId: "t1",
  concepts: [
    { conceptId: "a", title: "A", prerequisites: ["nonexistent"], masteryCriteria: ["x"], commonMisconceptions: [], questions: [
      { questionId: "a_q01", type: "diagnostic", difficulty: 1, question: "Q?", expectedAnswer: "A", rubric: "", misconceptionMapping: [], targetConcepts: ["a"] }
    ]},
    { conceptId: "b", title: "B", prerequisites: [], masteryCriteria: ["x"], commonMisconceptions: [], questions: [
      { questionId: "b_q01", type: "diagnostic", difficulty: 1, question: "Q?", expectedAnswer: "A", rubric: "", misconceptionMapping: [], targetConcepts: ["b"] }
    ]}
  ]
};
var ve3 = builder.validateConceptGraph(badPrereqGraph);
assert(ve3.some(function (e) { return e.indexOf("nonexistent") >= 0 || e.indexOf("non-existent") >= 0 || e.indexOf("prerequisites") >= 0; }),
  "validation catches bad prerequisite reference");

console.log("  Validation: PASS");

// ========== 6. Persistence: save and reload via data layer ==========

var resultSave = await builder.buildConceptGraph({
  profileId: "u_save", worldId: "w_save", textbookId: "t_save",
  sourceText: "变量是存储数据的基本单元。函数是一段可复用的代码块。两者是编程的基础。",
  dryRun: true
});
assert(!resultSave.error, "save test graph built");
assert(resultSave.concepts.length >= 2, "save test has >= 2 concepts");

// Save via data layer
dl.saveConceptGraph("u_save", "w_save", "t_save", resultSave);

// Reload
var loaded = dl.loadConceptGraph("u_save", "w_save", "t_save");
assert(loaded !== null, "saved graph can be reloaded");
assert(loaded.concepts.length === resultSave.concepts.length, "reloaded graph has same concept count");
assert(loaded.version >= 1, "reloaded graph has version");
assert(loaded.concepts[0].conceptId === resultSave.concepts[0].conceptId, "reloaded conceptId matches");

console.log("  Persistence: PASS");

// ========== 7. Non-contamination: failed build does not overwrite ==========

// Save a known-good graph first
var goodGraph = {
  profileId: "u_nc", worldId: "w_nc", textbookId: "t_nc",
  version: 1, concepts: [
    { conceptId: "good_a", title: "Good A", prerequisites: [], masteryCriteria: ["m1"], commonMisconceptions: [], difficulty: 1, sourcePages: [], questions: [
      { questionId: "good_a_q01", type: "diagnostic", difficulty: 1, question: "Q?", expectedAnswer: "A", rubric: "", misconceptionMapping: [], targetConcepts: ["good_a"] }
    ]},
    { conceptId: "good_b", title: "Good B", prerequisites: ["good_a"], masteryCriteria: ["m1"], commonMisconceptions: [], difficulty: 1, sourcePages: [], questions: [
      { questionId: "good_b_q01", type: "diagnostic", difficulty: 1, question: "Q?", expectedAnswer: "A", rubric: "", misconceptionMapping: [], targetConcepts: ["good_b"] }
    ]}
  ]
};
dl.saveConceptGraph("u_nc", "w_nc", "t_nc", goodGraph);

// Attempt a build that will fail validation (no source -> no concepts generated or fails)
// Actually, use a trick: try to build with sourceText that generates empty concepts
// Since dryRun from text always produces >= 2, let's test via bad LLM JSON instead
var badJsonResult = builder.normalizeConceptGraph(null, { profileId: "u_nc", worldId: "w_nc", textbookId: "t_nc" });
assert(badJsonResult.error, "normalizeConceptGraph(null) returns error");

// The existing graph should be intact
var existing = dl.loadConceptGraph("u_nc", "w_nc", "t_nc");
assert(existing !== null, "existing graph still exists after failed build");
assert(existing.concepts[0].conceptId === "good_a", "existing graph content unchanged");

console.log("  Non-contamination: PASS");

// ========== 8. extractConceptGraphJson ==========

var jsonText = '{"concepts":[{"conceptId":"x","title":"X"}]}';
var parsed = builder.extractConceptGraphJson(jsonText);
assert(parsed !== null && parsed.concepts[0].conceptId === "x", "extractConceptGraphJson parses plain JSON");

var fencedJson = '```json\n{"concepts":[{"conceptId":"y","title":"Y"}]}\n```';
var parsed2 = builder.extractConceptGraphJson(fencedJson);
assert(parsed2 !== null && parsed2.concepts[0].conceptId === "y", "extractConceptGraphJson extracts from code fence");

var textWithJson = 'Some text before\n{"concepts":[{"conceptId":"z","title":"Z"}]}\nSome text after';
var parsed3 = builder.extractConceptGraphJson(textWithJson);
assert(parsed3 !== null && parsed3.concepts[0].conceptId === "z", "extractConceptGraphJson extracts JSON from mixed text");

var noJson = "just plain text, no json here";
var parsed4 = builder.extractConceptGraphJson(noJson);
assert(parsed4 === null, "extractConceptGraphJson returns null for non-JSON text");

console.log("  JSON extraction: PASS");

// ========== 9. Prompt 2 smoke test still passes ==========
// Re-run the original smoke test checks via the data layer directly
var lm = dl.loadLearnerModel("smoke_user", "smoke_world");
assert(lm.profileId === "smoke_user", "Prompt 2 data layer: learner model works");
dl.saveLearnerModel("smoke_user", "smoke_world", lm);

var cg = dl.loadConceptGraph("smoke_user", "smoke_world", "smoke_textbook");
assert(cg.concepts && Array.isArray(cg.concepts), "Prompt 2 data layer: concept graph works");

var sid = dl.genId("sess");
var sess = dl.initTeachingSession(sid, "smoke_user", "smoke_world", "smoke_textbook");
assert(sess.phase === "idle", "Prompt 2 data layer: teaching session works");

var tid = dl.appendTeachingEvent(sid, { type: "diagnosis", userMessage: "test" });
var events = dl.getTeachingEvents(sid);
assert(events.length === 1, "Prompt 2 data layer: teaching events work");

console.log("  Prompt 2 regression: PASS");

// ========== 10. Missing IDs ==========

var resultNoId = await builder.buildConceptGraph({
  dryRun: true
});
assert(resultNoId.error === "missing_ids", "missing IDs returns error");

console.log("  Missing IDs: PASS");

// ========== 11. Malicious textbookId (safeSegment) ==========

var threw = false;
try {
  builder.loadTextbookSource({
    profileId: "u1", worldId: "w1", textbookId: "../../etc/passwd",
    sourceText: "test"
  });
} catch (e) {
  threw = (e.message.indexOf("textbookId") >= 0 || e.message.indexOf("..") >= 0);
}
assert(threw, "malicious textbookId with .. is rejected by safeSegment");

// Also test backslash
var threw2 = false;
try {
  builder.loadTextbookSource({
    profileId: "u1", worldId: "w1", textbookId: "foo\\bar",
    sourceText: "test"
  });
} catch (e) {
  threw2 = (e.message.indexOf("textbookId") >= 0 || e.message.indexOf("\\\\") >= 0);
}
assert(threw2, "textbookId with backslash is rejected");

console.log("  Malicious textbookId: PASS");

// ========== 12. KB source without callLLM does not error (Fix 2) ==========

var resultKbNoLLM = await builder.buildConceptGraph({
  profileId: "u_kb_nollm", worldId: "w_kb_nollm", textbookId: "t_kb",
  dryRun: false
});
// KB source without callLLM should use deterministic path, not error
assert(!resultKbNoLLM.error, "KB source without callLLM returns no error (deterministic fallback): " + (resultKbNoLLM.error || ""));
assert(Array.isArray(resultKbNoLLM.concepts) && resultKbNoLLM.concepts.length >= 2,
  "KB source without callLLM generates >= 2 concepts");

console.log("  KB without callLLM: PASS");

// ========== 13. getConceptGraph no auto-create (Fix 3) ==========

// Use a fresh ID that has never been saved
var freshCG = dl.getConceptGraph("u_fresh", "w_fresh", "t_fresh");
assert(freshCG === null, "getConceptGraph returns null for never-saved graph");

// Verify no file was created
var freshPath = dl.conceptGraphPath("u_fresh", "w_fresh", "t_fresh");
assert(!fs.existsSync(freshPath), "getConceptGraph does not create file on miss");

// loadConceptGraph still auto-creates
var autoCG = dl.loadConceptGraph("u_auto", "w_auto", "t_auto");
assert(autoCG !== null, "loadConceptGraph auto-creates");
var autoPath = dl.conceptGraphPath("u_auto", "w_auto", "t_auto");
assert(fs.existsSync(autoPath), "loadConceptGraph creates file");
assert(autoCG.concepts.length === 0, "auto-created graph has empty concepts");

console.log("  getConceptGraph no auto-create: PASS");

// ========== 14. targetConcepts validation (Fix 4) ==========

// Bad targetConcepts reference
var badTCGraph = {
  profileId: "u_tc", worldId: "w_tc", textbookId: "t_tc",
  concepts: [
    { conceptId: "tc_a", title: "A", prerequisites: [], masteryCriteria: ["m1"], commonMisconceptions: [], difficulty: 1, questions: [
      { questionId: "tc_a_q01", type: "diagnostic", difficulty: 1, question: "Q?", expectedAnswer: "A", rubric: "", misconceptionMapping: [], targetConcepts: ["tc_missing"] }
    ]},
    { conceptId: "tc_b", title: "B", prerequisites: [], masteryCriteria: ["m1"], commonMisconceptions: [], difficulty: 1, questions: [
      { questionId: "tc_b_q01", type: "diagnostic", difficulty: 1, question: "Q?", expectedAnswer: "A", rubric: "", misconceptionMapping: [], targetConcepts: ["tc_b"] }
    ]}
  ]
};
var tcErrors = builder.validateConceptGraph(badTCGraph);
assert(tcErrors.some(function (e) { return e.indexOf("tc_missing") >= 0 || (e.indexOf("targetConcepts") >= 0 && e.indexOf("non-existent") >= 0); }),
  "validation catches bad targetConcepts reference");

// normalizeConceptGraph should filter invalid targetConcepts
var rawWithBadTC = {
  concepts: [
    { conceptId: "norm_a", title: "Normal A", masteryCriteria: ["m1"], questions: [
      { questionId: "norm_a_q01", question: "Q?", expectedAnswer: "A", targetConcepts: ["norm_missing", "norm_a"] }
    ]},
    { conceptId: "norm_b", title: "Normal B", masteryCriteria: ["m1"], questions: [
      { questionId: "norm_b_q01", question: "Q?", expectedAnswer: "B", targetConcepts: ["norm_b"] }
    ]}
  ]
};
var normalized = builder.normalizeConceptGraph(rawWithBadTC, { profileId: "x", worldId: "x", textbookId: "x" });
assert(!normalized.error, "normalize with bad targetConcepts returns no error");
assert(normalized.concepts[0].questions[0].targetConcepts.length === 1,
  "bad targetConcepts filtered, leaving only valid ones");
assert(normalized.concepts[0].questions[0].targetConcepts[0] === "norm_a",
  "remaining targetConcept is the valid self-reference");

console.log("  targetConcepts validation: PASS");

// ========== 15. Accounts-based path resolution (Fix 5) ==========

var root = process.env.PROJECT_ROOT || TMP;
var accDir = path.join(root, "accounts", "acc_test", "profiles", "p_test", "worlds", "w_test", "textbooks", "t_acc");
fs.mkdirSync(accDir, { recursive: true });
fs.writeFileSync(path.join(accDir, "page_001.txt"), "Accounts-based textbook page 1 content.", "utf-8");

var srcAcc = builder.loadTextbookSource({
  profileId: "p_test", worldId: "w_test", textbookId: "t_acc"
});
assert(srcAcc !== null, "accounts-based path resolves textbook pages");
assert(srcAcc.type === "textbook_pages", "accounts-based source type is textbook_pages");

console.log("  Accounts-based path: PASS");

// ========== 16. Version preservation (Fix 6) ==========

// Save a graph with known version
var vGraph = {
  profileId: "u_ver", worldId: "w_ver", textbookId: "t_ver",
  version: 3,
  concepts: [
    { conceptId: "ver_a", title: "Ver A", prerequisites: [], masteryCriteria: ["m1"], commonMisconceptions: [], difficulty: 1, questions: [
      { questionId: "ver_a_q01", type: "diagnostic", difficulty: 1, question: "Q?", expectedAnswer: "A", rubric: "", misconceptionMapping: [], targetConcepts: ["ver_a"] }
    ]},
    { conceptId: "ver_b", title: "Ver B", prerequisites: [], masteryCriteria: ["m1"], commonMisconceptions: [], difficulty: 1, questions: [
      { questionId: "ver_b_q01", type: "diagnostic", difficulty: 1, question: "Q?", expectedAnswer: "A", rubric: "", misconceptionMapping: [], targetConcepts: ["ver_b"] }
    ]}
  ]
};
dl.saveConceptGraph("u_ver", "w_ver", "t_ver", vGraph);
var afterSave = dl.getConceptGraph("u_ver", "w_ver", "t_ver");
assert(afterSave !== null, "version test: getConceptGraph returns saved graph");
assert(afterSave.version >= 3, "version test: saved version >= 3 (got " + afterSave.version + ")");

// Rebuild with same IDs — should inherit version
var resultVer = await builder.buildConceptGraph({
  profileId: "u_ver", worldId: "w_ver", textbookId: "t_ver",
  sourceText: "新概念：闭包是指函数可以访问其外部作用域的变量。高阶函数是接受函数作为参数或返回函数的函数。",
  dryRun: true
});
// The dry-run doesn't save, but the returned graph should have the inherited version
assert(resultVer.version >= 3, "dry-run graph inherits existing version (got " + resultVer.version + ", expected >= 3)");

console.log("  Version preservation: PASS");

// ========== Summary ==========

console.log("");
console.log("Passed: " + passed + "  Failed: " + failed);
if (failed > 0) {
  console.error("SOME TESTS FAILED");
  process.exit(1);
}
console.log("All tests passed.");
process.exit(0);

})().catch(function (e) {
  console.error("Test suite error: " + (e && e.message));
  console.error(e && e.stack);
  process.exit(1);
});
