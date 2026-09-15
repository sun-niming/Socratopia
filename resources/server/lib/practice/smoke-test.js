#!/usr/bin/env node
/**
 * Smoke test for practice data layer.
 * Run:  node resources/server/lib/practice/smoke-test.js
 *
 * Sets a temporary PROJECT_ROOT, exercises every helper, cleans up.
 * Zero external dependencies (no LLM, no webpack, no Next.js).
 */
"use strict";

var os = require("os");
var path = require("path");
var fs = require("fs");

var TMP = path.join(os.tmpdir(), "practice-smoke-" + Date.now());
process.env.PROJECT_ROOT = TMP;

var dl = require("./data-layer.js");
var passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + msg);
}

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}
process.on("exit", cleanup);

console.log("Practice Smoke Test: " + TMP);
console.log("");

// ========== 1. Problem set write / read round-trip ==========

var ps = {
  id: "ps_test1",
  source: { profileId: "u1", worldId: "w1", textbookId: "tb1", pages: [1, 3] },
  problems: [
    dl.normalizeProblem({
      type: "choice", question: "1+1=?", choices: ["1", "2", "3", "4"],
      correctAnswer: "2", correctIndex: 1, solution: "基础加法", knowledgePoints: ["加法"], difficulty: 1
    }, 0),
    dl.normalizeProblem({
      type: "short-answer", question: "什么是递归？",
      correctAnswer: "函数调用自身", solution: "...", knowledgePoints: ["递归"], difficulty: 2
    }, 1)
  ]
};
var written = dl.writeProblemSet("u1", "w1", ps);
assert(written.id === "ps_test1", "writeProblemSet returns set with id");
assert(typeof written.createdAt === "string", "writeProblemSet sets createdAt");
assert(typeof written.updatedAt === "string", "writeProblemSet sets updatedAt");

var loaded = dl.readProblemSet("u1", "w1", "ps_test1");
assert(loaded !== null, "readProblemSet returns saved set");
assert(loaded.problems.length === 2, "reload preserves problem count");
assert(loaded.problems[0].type === "choice", "reload preserves problem type");
assert(loaded.problems[0].correctIndex === 1, "reload preserves correctIndex");
console.log("  1. Problem set round-trip: PASS");

// ========== 2. readProblemSet miss returns null (no auto-create) ==========

var missing = dl.readProblemSet("u1", "w1", "ps_never");
assert(missing === null, "readProblemSet returns null on miss");
var missPath = dl.problemSetPath("u1", "w1", "ps_never");
assert(!fs.existsSync(missPath), "readProblemSet does not create file on miss");
console.log("  2. Read miss no auto-create: PASS");

// ========== 3. writeProblemSet auto-generates id when missing ==========

var psNoId = { source: {}, problems: [] };
var w2 = dl.writeProblemSet("u1", "w1", psNoId);
assert(typeof w2.id === "string" && w2.id.indexOf("ps_") === 0, "writeProblemSet auto-generates id");
console.log("  3. Auto-generate problem set id: PASS");

// ========== 4. listProblemSets ==========

var sets = dl.listProblemSets("u1", "w1");
assert(Array.isArray(sets) && sets.length >= 2, "listProblemSets returns >= 2 sets (got " + sets.length + ")");
var found = false;
for (var i = 0; i < sets.length; i++) {
  if (sets[i].id === "ps_test1") { found = true; assert(sets[i].problemCount === 2, "list includes problemCount"); break; }
}
assert(found, "listProblemSets includes ps_test1");
console.log("  4. List problem sets: PASS");

// ========== 5. appendAnswerRecord ==========

var rec1 = dl.appendAnswerRecord("u1", "w1", "ps_test1", written.problems[0].id, {
  userAnswer: "2", correct: true, score: 1.0
});
assert(rec1.correct === true, "appendAnswerRecord records correct");
assert(typeof rec1.timestamp === "string", "appendAnswerRecord sets timestamp");

var rec2 = dl.appendAnswerRecord("u1", "w1", "ps_test1", written.problems[0].id, {
  userAnswer: "3", correct: false, score: 0, mistakeType: "calculation", feedback: "算错了"
});
assert(rec2.correct === false, "second record marked incorrect");

var reloaded = dl.readProblemSet("u1", "w1", "ps_test1");
var prob0 = reloaded.problems[0];
assert(prob0.history.length === 2, "answer history has 2 entries (got " + prob0.history.length + ")");
assert(prob0.history[0].userAnswer === "2", "first answer preserved");
assert(prob0.history[1].mistakeType === "calculation", "mistakeType preserved");
console.log("  5. Answer record append: PASS");

// ========== 6. appendAnswerRecord on missing set/problem throws ==========

var threw = false;
try { dl.appendAnswerRecord("u1", "w1", "ps_nope", "pb_x", { userAnswer: "x" }); } catch (e) { threw = true; }
assert(threw, "appendAnswerRecord throws on missing set");

threw = false;
try { dl.appendAnswerRecord("u1", "w1", "ps_test1", "pb_nonexistent", { userAnswer: "x" }); } catch (e) { threw = true; }
assert(threw, "appendAnswerRecord throws on missing problem");
console.log("  6. Append on missing target throws: PASS");

// ========== 7. saveMistake + idempotent update ==========

var m1 = dl.saveMistake("u1", "w1", {
  problemId: "pb_mistake1",
  wrongAnswer: "3", correctAnswer: "2",
  diagnosis: "计算错误", knowledgePoints: ["加法"],
  source: { textbookId: "tb1" }
});
assert(m1.problemId === "pb_mistake1", "saveMistake returns mistake");
assert(m1.wrongAnswer === "3", "saveMistake preserves wrongAnswer");

// Save again with same problemId — should update, not duplicate
var m2 = dl.saveMistake("u1", "w1", {
  problemId: "pb_mistake1",
  wrongAnswer: "5", diagnosis: "再次错误"
});
assert(m2.wrongAnswer === "5", "saveMistake updates wrongAnswer idempotently");
assert(m2.correctAnswer === "2", "saveMistake preserves untouched correctAnswer");

// Verify only ONE mistake file exists for this problemId
var mDir = path.join(dl.practiceDir("u1", "w1"), "mistakes");
var mFiles = fs.readdirSync(mDir).filter(function (f) { return f.indexOf("pb_mistake1") === 0 && /\.json$/.test(f); });
assert(mFiles.length === 1, "only one mistake file per problemId (got " + mFiles.length + ")");
console.log("  7. Idempotent mistake save: PASS");

// ========== 8. saveMistake reviewEntry append ==========

var m3 = dl.saveMistake("u1", "w1", {
  problemId: "pb_mistake1",
  reviewEntry: { correct: true, note: "复习对了" }
});
assert(Array.isArray(m3.reviewHistory) && m3.reviewHistory.length === 1, "reviewEntry appended");
assert(m3.reviewHistory[0].correct === true, "review entry preserves correct");

var m4 = dl.saveMistake("u1", "w1", {
  problemId: "pb_mistake1",
  reviewEntry: { correct: false }
});
assert(m4.reviewHistory.length === 2, "second reviewEntry appended (got " + m4.reviewHistory.length + ")");
console.log("  8. Review history append: PASS");

// ========== 9. readMistake ==========

var readM = dl.readMistake("u1", "w1", "pb_mistake1");
assert(readM !== null, "readMistake returns saved mistake");
assert(readM.wrongAnswer === "5", "readMistake reflects latest update");

var noM = dl.readMistake("u1", "w1", "pb_never");
assert(noM === null, "readMistake returns null on miss");
console.log("  9. Read mistake: PASS");

// ========== 10. readMistakes + filters ==========

// Add a few more mistakes for filter testing
dl.saveMistake("u1", "w1", {
  problemId: "pb_mastered", wrongAnswer: "x", correctAnswer: "y",
  knowledgePoints: ["乘法"], source: { textbookId: "tb2" }, status: "mastered"
});
dl.saveMistake("u1", "w1", {
  problemId: "pb_due", wrongAnswer: "a", correctAnswer: "b",
  knowledgePoints: ["除法"], source: { textbookId: "tb1" },
  nextReview: new Date(Date.now() - 86400000).toISOString()  // due yesterday
});
dl.saveMistake("u1", "w1", {
  problemId: "pb_future", wrongAnswer: "c", correctAnswer: "d",
  knowledgePoints: ["除法"], source: { textbookId: "tb1" },
  nextReview: new Date(Date.now() + 86400000).toISOString()  // due tomorrow
});

// Default: excludes mastered
var allMistakes = dl.readMistakes("u1", "w1");
var hasMastered = allMistakes.some(function (m) { return m.problemId === "pb_mastered"; });
assert(!hasMastered, "readMistakes excludes mastered by default");

// includeMastered
var withMastered = dl.readMistakes("u1", "w1", { includeMastered: true });
assert(withMastered.some(function (m) { return m.problemId === "pb_mastered"; }), "includeMastered shows mastered");

// Filter by textbookId
var tb1Mistakes = dl.readMistakes("u1", "w1", { textbookId: "tb1" });
assert(tb1Mistakes.every(function (m) { return m.source.textbookId === "tb1"; }), "textbookId filter works");
assert(tb1Mistakes.length >= 2, "textbookId=tb1 returns expected count");

// Filter by knowledgePoint
var divMistakes = dl.readMistakes("u1", "w1", { knowledgePoint: "除法" });
assert(divMistakes.length === 2, "knowledgePoint filter returns 2 (got " + divMistakes.length + ")");

// Filter by reviewDue
var dueMistakes = dl.readMistakes("u1", "w1", { reviewDue: true });
var hasDue = dueMistakes.some(function (m) { return m.problemId === "pb_due"; });
var hasFuture = dueMistakes.some(function (m) { return m.problemId === "pb_future"; });
assert(hasDue, "reviewDue includes past-due mistake");
assert(!hasFuture, "reviewDue excludes future mistake");
console.log("  10. Mistake filters: PASS");

// ========== 11. Path safety (safeSegment) ==========

var blocked;

blocked = false;
try { dl.readProblemSet("../etc", "w1", "ps1"); } catch (e) { blocked = true; }
// readProblemSet returns null for falsy, but path traversal in segment throws via problemSetPath
// Actually readProblemSet calls problemSetPath which calls safeSegment -> throws
assert(blocked, "path traversal in profileId blocked (readProblemSet)");

blocked = false;
try { dl.writeProblemSet("u1", "../../w", { id: "ps1", problems: [] }); } catch (e) { blocked = true; }
assert(blocked, "path traversal in worldId blocked (writeProblemSet)");

blocked = false;
try { dl.writeProblemSet("u1", "w1", { id: "../../../evil", problems: [] }); } catch (e) { blocked = true; }
assert(blocked, "path traversal in problemSetId blocked");

blocked = false;
try { dl.saveMistake("u1", "w1", { problemId: "foo/bar" }); } catch (e) { blocked = true; }
assert(blocked, "slash in problemId blocked");

blocked = false;
try { dl.saveMistake("u1", "w1", { problemId: "foo\\bar" }); } catch (e) { blocked = true; }
assert(blocked, "backslash in problemId blocked");

blocked = false;
try { dl.writeProblemSet("", "w1", { id: "ps1", problems: [] }); } catch (e) { blocked = true; }
assert(blocked, "empty profileId blocked");
console.log("  11. Path safety: PASS");

// ========== 12. Corrupt JSON handling ==========

var corruptPath = dl.problemSetPath("u1", "w1", "ps_corrupt");
fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
fs.writeFileSync(corruptPath, "{ this is @ not valid json !!!", "utf-8");

var corruptResult = dl.readProblemSet("u1", "w1", "ps_corrupt");
assert(corruptResult === null, "corrupt JSON returns null (not throw)");

// Verify corrupt backup created
var psDir = path.join(dl.practiceDir("u1", "w1"), "problem_sets");
var backups = fs.readdirSync(psDir).filter(function (f) { return f.indexOf("ps_corrupt.json.corrupt-") === 0; });
assert(backups.length === 1, "corrupt backup file created (.corrupt-<ts>)");

// Verify original corrupt file no longer in place (renamed)
assert(!fs.existsSync(corruptPath), "corrupt file renamed aside, not left in place");
console.log("  12. Corrupt JSON handling: PASS");

// ========== 13. Atomic write leaves no .tmp files ==========

dl.writeProblemSet("u1", "w1", { id: "ps_atomic", problems: [] });
var psDir2 = path.join(dl.practiceDir("u1", "w1"), "problem_sets");
var tmpFiles = fs.readdirSync(psDir2).filter(function (f) { return f.indexOf(".tmp-") >= 0; });
assert(tmpFiles.length === 0, "no leftover .tmp files after atomic write");
console.log("  13. Atomic write cleanup: PASS");

// ========== 14. validateProblem ==========

var goodP = dl.normalizeProblem({
  type: "choice", question: "Q?", choices: ["a", "b"], correctAnswer: "a", difficulty: 1
}, 0);
assert(dl.validateProblem(goodP).length === 0, "valid problem passes validation");

var badP1 = { type: "choice", question: "Q?", choices: ["a"], correctAnswer: "a", difficulty: 1, id: "x" };
assert(dl.validateProblem(badP1).length > 0, "choice with 1 choice fails validation");

var badP2 = dl.normalizeProblem({ type: "short-answer", question: "", correctAnswer: "", difficulty: 1 }, 0);
var badErrors = dl.validateProblem(badP2);
assert(badErrors.some(function (e) { return e.indexOf("question") >= 0; }), "missing question caught");
assert(badErrors.some(function (e) { return e.indexOf("correctAnswer") >= 0; }), "missing correctAnswer caught");
console.log("  14. Problem validation: PASS");

// ========== 15. Data isolation — practice dir not in adaptive-teaching ==========

var practiceRoot = dl.practiceDir("u1", "w1");
assert(practiceRoot.indexOf("adaptive-teaching") < 0, "practice dir is NOT under adaptive-teaching");
assert(practiceRoot.indexOf(path.join("profiles", "u1", "worlds", "w1", "practice")) >= 0,
  "practice dir follows profiles/{pid}/worlds/{wid}/practice layout");
// Verify no adaptive-teaching dir was created
assert(!fs.existsSync(path.join(TMP, "adaptive-teaching")), "no adaptive-teaching dir created by practice layer");
console.log("  15. Data isolation: PASS");

// ========== Summary ==========

console.log("");
console.log("Passed: " + passed + "  Failed: " + failed);
if (failed > 0) {
  console.error("SOME TESTS FAILED");
  process.exit(1);
}
console.log("All tests passed.");
process.exit(0);
