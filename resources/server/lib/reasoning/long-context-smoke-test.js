// Smoke test for long-context (Graph-RAG prototype helper).
// Run: node resources/server/lib/reasoning/long-context-smoke-test.js
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); pass++; }

// ---- temp PROJECT_ROOT + fake textbookDir/knowledge_base ----
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "longctx-smoke-"));
process.env.PROJECT_ROOT = tmp;

var PID = "p1", WID = "w1", TID = "tb1";
var tbDir = path.join(tmp, "profiles", PID, "worlds", WID, "textbooks", TID);
var kbDir = path.join(tbDir, "knowledge_base");
var cardsDir = path.join(kbDir, "cards");
fs.mkdirSync(cardsDir, { recursive: true });

// cards: c_base (p1-5) <- c_mid (p6-10) <- c_top (p11-15)
function writeCard(c) { fs.writeFileSync(path.join(cardsDir, c.concept_id + ".json"), JSON.stringify(c), "utf-8"); }
writeCard({ concept_id: "c_base", title: "Base", definition: "base def", key_points: ["kp1"], examples: ["ex1"], source_pages: [1, 5], prerequisites: [] });
writeCard({ concept_id: "c_mid", title: "Mid", definition: "mid def", key_points: ["kp2"], examples: [], source_pages: [6, 10], prerequisites: ["Base"] });
writeCard({ concept_id: "c_top", title: "Top", definition: "top def about photosynthesis", key_points: [], examples: [], source_pages: [11, 15], prerequisites: ["Mid"] });
fs.writeFileSync(path.join(kbDir, "index.json"), JSON.stringify({
  title: "Demo TB",
  cards: [{ concept_id: "c_base" }, { concept_id: "c_mid" }, { concept_id: "c_top" }]
}), "utf-8");

// Load adaptive layers (populate globals) + the helper.
var AD = require("../adaptive/data-layer.js");
global.__ADAPTIVE_CONCEPT_GRAPH__ = require("../adaptive/concept-graph-builder.js");
var L = require("./long-context.js");

// ---- fake ConceptGraph with cross-page prerequisites + a missing prereq + a cycle target ----
var graph = {
  profileId: PID, worldId: WID, textbookId: TID, version: 1, concepts: [
    { conceptId: "c_base", title: "Base", description: "base", prerequisites: [], sourcePages: [1, 5],
      masteryCriteria: ["m"], commonMisconceptions: [], difficulty: 1,
      questions: [{ questionId: "c_base_q01", type: "diagnostic", difficulty: 1, question: "q", expectedAnswer: "a", misconceptionMapping: [], targetConcepts: ["c_base"] }] },
    { conceptId: "c_mid", title: "Mid", description: "mid", prerequisites: ["c_base"], sourcePages: [6, 10],
      masteryCriteria: ["m"], commonMisconceptions: [], difficulty: 1,
      questions: [{ questionId: "c_mid_q01", type: "diagnostic", difficulty: 1, question: "q", expectedAnswer: "a", misconceptionMapping: [], targetConcepts: ["c_mid"] }] },
    { conceptId: "c_top", title: "Top", description: "top about photosynthesis", prerequisites: ["c_mid", "c_ghost"], sourcePages: [11, 15],
      masteryCriteria: ["m"], commonMisconceptions: [], difficulty: 2,
      questions: [{ questionId: "c_top_q01", type: "diagnostic", difficulty: 2, question: "q", expectedAnswer: "a", misconceptionMapping: [], targetConcepts: ["c_top"] }] }
  ]
};
AD.saveConceptGraph(PID, WID, TID, graph);

function run(input, cb) {
  return L.buildLongReasoningContext(input).then(cb);
}

var tests = [];

// ---- 3. focus by focusConceptId (saved_graph) ----
tests.push(run({ profileId: PID, worldId: WID, textbookId: TID, textbookDir: tbDir, focusConceptId: "c_top" }, function (r) {
  ok(r.ok, "focusConceptId: ok");
  eq(r.source, "saved_graph", "focusConceptId: source saved_graph");
  eq(r.focus.conceptId, "c_top", "focusConceptId: focus is c_top");
  // ---- 5. prerequisite chain to maxDepth=2: c_mid (d1) + c_base (d2) ----
  var depIds = r.dependencies.map(function (d) { return d.conceptId; });
  ok(depIds.indexOf("c_mid") >= 0, "deps include c_mid (depth 1)");
  ok(depIds.indexOf("c_base") >= 0, "deps include c_base (depth 2)");
  // ---- 7. missing prereq c_ghost ----
  ok(r.missingPrerequisites.indexOf("c_ghost") >= 0, "c_ghost in missingPrerequisites");
  // ---- 8. promptBlock content ----
  ok(r.promptBlock.indexOf("LONG_REASONING_CONTEXT") >= 0, "promptBlock has tag");
  ok(r.promptBlock.indexOf("当前焦点") >= 0, "promptBlock has 当前焦点");
  ok(r.promptBlock.indexOf("必要前置") >= 0, "promptBlock has 必要前置");
  ok(r.promptBlock.indexOf("跨页依据") >= 0, "promptBlock has 跨页依据");
  ok(r.promptBlock.indexOf("可能缺口") >= 0, "promptBlock has 可能缺口");
  ok(r.promptBlock.indexOf("本轮回答边界") >= 0, "promptBlock has 本轮回答边界");
  ok(r.promptBlock.indexOf("11-15") >= 0, "promptBlock has focus pages 11-15");
  ok(r.promptBlock.indexOf("c_ghost") >= 0, "promptBlock surfaces missing c_ghost");
  // no mojibake in the readable Chinese labels
  ok(!/褰撳墠|蹇呰|璺ㄩ|鏃/.test(r.promptBlock), "promptBlock has no mojibake");
  // evidenceCards for focus + deps
  var evIds = r.evidenceCards.map(function (e) { return e.concept_id; });
  ok(evIds.indexOf("c_top") >= 0 && evIds.indexOf("c_mid") >= 0 && evIds.indexOf("c_base") >= 0, "evidence covers focus+deps");
}));

// ---- 4. focus by focusPage ----
tests.push(run({ profileId: PID, worldId: WID, textbookId: TID, textbookDir: tbDir, focusPage: 8 }, function (r) {
  ok(r.ok, "focusPage: ok");
  eq(r.focus.conceptId, "c_mid", "focusPage 8 -> c_mid (covers 6-10)");
  var depIds = r.dependencies.map(function (d) { return d.conceptId; });
  ok(depIds.indexOf("c_base") >= 0, "focusPage: deps include c_base");
}));

// ---- maxDepth=1 stops at c_mid (not c_base) ----
tests.push(run({ profileId: PID, worldId: WID, textbookId: TID, textbookDir: tbDir, focusConceptId: "c_top", maxDepth: 1 }, function (r) {
  var depIds = r.dependencies.map(function (d) { return d.conceptId; });
  ok(depIds.indexOf("c_mid") >= 0, "maxDepth1: c_mid present");
  ok(depIds.indexOf("c_base") < 0, "maxDepth1: c_base NOT present");
}));

// ---- query match ----
tests.push(run({ profileId: PID, worldId: WID, textbookId: TID, textbookDir: tbDir, query: "photosynthesis" }, function (r) {
  ok(r.ok, "query: ok");
  eq(r.focus.conceptId, "c_top", "query 'photosynthesis' -> c_top");
}));

// ---- related: focus c_base should list c_mid as dependent ----
tests.push(run({ profileId: PID, worldId: WID, textbookId: TID, textbookDir: tbDir, focusConceptId: "c_base" }, function (r) {
  var relIds = r.related.map(function (x) { return x.conceptId; });
  ok(relIds.indexOf("c_mid") >= 0, "related of c_base includes c_mid (downstream)");
}));

// ---- 6. cyclic prerequisites: A<->B must not infinite-loop ----
var cyclicGraph = {
  profileId: PID, worldId: WID, textbookId: "tbCycle", version: 1, concepts: [
    { conceptId: "A", title: "A", description: "a", prerequisites: ["B"], sourcePages: [1, 2], masteryCriteria: ["m"], commonMisconceptions: [], difficulty: 1, questions: [{ questionId: "A_q01", type: "diagnostic", difficulty: 1, question: "q", expectedAnswer: "a", misconceptionMapping: [], targetConcepts: ["A"] }] },
    { conceptId: "B", title: "B", description: "b", prerequisites: ["A"], sourcePages: [3, 4], masteryCriteria: ["m"], commonMisconceptions: [], difficulty: 1, questions: [{ questionId: "B_q01", type: "diagnostic", difficulty: 1, question: "q", expectedAnswer: "a", misconceptionMapping: [], targetConcepts: ["B"] }] }
  ]
};
AD.saveConceptGraph(PID, WID, "tbCycle", cyclicGraph);
tests.push(run({ profileId: PID, worldId: WID, textbookId: "tbCycle", focusConceptId: "A", maxDepth: 5 }, function (r) {
  ok(r.ok, "cycle: ok (did not hang)");
  var depIds = r.dependencies.map(function (d) { return d.conceptId; });
  ok(depIds.indexOf("B") >= 0, "cycle: B traced once");
  ok(depIds.length === 1, "cycle: A not re-added (dedupe), only B");
}));

// ---- 10. kb_fallback: no saved graph + no concept-graph builder global ----
var savedBuilder = global.__ADAPTIVE_CONCEPT_GRAPH__;
global.__ADAPTIVE_CONCEPT_GRAPH__ = null;
// use a textbookId that has NO saved graph but DOES have KB on disk (tbDir is for TID;
// point textbookDir at the KB but use a fresh textbookId so getConceptGraph misses).
tests.push(run({ profileId: PID, worldId: WID, textbookId: "tbNoGraph", textbookDir: tbDir, focusConceptId: "c_top" }, function (r) {
  ok(r.ok, "kb_fallback: ok");
  eq(r.source, "kb_fallback", "kb_fallback: source");
  eq(r.focus.conceptId, "c_top", "kb_fallback: focus c_top");
  var depIds = r.dependencies.map(function (d) { return d.conceptId; });
  ok(depIds.indexOf("c_mid") >= 0 && depIds.indexOf("c_base") >= 0, "kb_fallback: prereq chain via card titles");
  ok(r.evidenceCards.length >= 1, "kb_fallback: evidence cards present");
}).then(function () { global.__ADAPTIVE_CONCEPT_GRAPH__ = savedBuilder; }));

// ---- focus_not_found ----
tests.push(run({ profileId: PID, worldId: WID, textbookId: TID, textbookDir: tbDir, focusConceptId: "nope" }, function (r) {
  ok(!r.ok, "focus_not_found: not ok");
  eq(r.error, "focus_not_found", "focus_not_found error code");
}));

// ---- no_graph: no saved, no builder, no KB ----
tests.push((function () {
  var savedB = global.__ADAPTIVE_CONCEPT_GRAPH__;
  global.__ADAPTIVE_CONCEPT_GRAPH__ = null;
  return run({ profileId: PID, worldId: WID, textbookId: "emptyTb", textbookDir: path.join(tmp, "no-such-dir"), focusConceptId: "x" }, function (r) {
    ok(!r.ok, "no_graph: not ok");
    eq(r.error, "no_graph", "no_graph error code");
  }).then(function () { global.__ADAPTIVE_CONCEPT_GRAPH__ = savedB; });
})());

Promise.all(tests).then(function () {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log("long-context smoke test: " + pass + " assertions passed");
}).catch(function (e) {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e2) {}
  console.error("long-context smoke test FAILED:", e && e.message);
  process.exit(1);
});
