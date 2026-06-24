#!/usr/bin/env node
/**
 * Smoke test for adaptive-teaching data layer.
 * Run:  node resources/server/lib/adaptive/smoke-test.js
 *
 * Sets a temporary PROJECT_ROOT, exercises every helper, and cleans up.
 * Zero external dependencies (no LLM, no webpack, no Next.js).
 */
"use strict";

var os = require("os");
var path = require("path");
var fs = require("fs");

var TMP = path.join(os.tmpdir(), "adaptive-smoke-" + Date.now());
process.env.PROJECT_ROOT = TMP;

// Load the data layer (IIFE self-sets global.__ADAPTIVE__)
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

console.log("Smoke test: " + TMP);
console.log("");

// ---- Learner Model ----
var lm = dl.loadLearnerModel("user_001", "world_math");
assert(lm.profileId === "user_001", "LearnerModel profileId");
assert(lm.conceptMastery && typeof lm.conceptMastery === "object", "conceptMastery exists");
assert(lm.teachingPreferences && lm.teachingPreferences.prefersExamples, "prefersExamples default");
assert(lm.errorPatterns && Array.isArray(lm.errorPatterns), "errorPatterns is array");
assert(lm.affectiveState && lm.affectiveState.confidence === 0.5, "affectiveState default");
assert(Array.isArray(lm.reviewQueue), "reviewQueue is array");
assert(Array.isArray(lm.snapshotHistory), "snapshotHistory is array");

// Modify and save
lm.conceptMastery["recursion_basics"] = { score: 0.8, lastUpdated: new Date().toISOString(), history: [] };
lm.conceptMastery["big_o"] = { score: 0.3, lastUpdated: new Date().toISOString(), history: [] };
dl.saveLearnerModel("user_001", "world_math", lm);
assert(lm.snapshotHistory.length === 1, "snapshot created on save");

// Reload
var lm2 = dl.loadLearnerModel("user_001", "world_math");
assert(lm2.conceptMastery["recursion_basics"].score === 0.8, "reload preserves score");
assert(lm2.snapshotHistory.length === 1, "reload preserves snapshot");

// Review queue
dl.updateReviewQueue(lm2);
assert(lm2.reviewQueue.length === 2, "both concepts enqueued (neither had lastReviewed)");
assert(lm2.reviewQueue[0].conceptId === "big_o", "reviewQueue sorts weak concept first");
assert(lm2.reviewQueue[0].priority >= 0.6, "reviewQueue priority matches low score");
assert(lm2.reviewQueue[1].conceptId === "recursion_basics", "reviewQueue has high-score concept (low priority)");
console.log("  Learner model: " + (failed === 0 ? "PASS" : "partial"));

// ---- Concept Graph ----
var cg = dl.loadConceptGraph("user_001", "world_math", "textbook_algo");
assert(cg.profileId === "user_001", "ConceptGraph profileId");
assert(cg.textbookId === "textbook_algo", "ConceptGraph textbookId");
assert(Array.isArray(cg.concepts) && cg.concepts.length === 0, "concepts starts empty");
assert(cg.version === 1, "ConceptGraph version starts 1");

cg.concepts.push({
  conceptId: "recursion_basics",
  title: "递归基础",
  prerequisites: [],
  masteryCriteria: ["能解释递归定义", "能写出终止条件"],
  commonMisconceptions: ["认为递归一定比迭代慢"],
  questions: [{
    type: "diagnostic",
    difficulty: 1,
    question: "什么是递归的终止条件？",
    expectedAnswer: "不再调用自身的基准情况",
    misconceptionMapping: [],
    targetConcepts: ["recursion_basics"]
  }]
});
dl.saveConceptGraph("user_001", "world_math", "textbook_algo", cg);
assert(cg.version === 2, "save increments version");

var cg2 = dl.loadConceptGraph("user_001", "world_math", "textbook_algo");
assert(cg2.version === 2, "reload ConceptGraph version");
assert(cg2.concepts[0].conceptId === "recursion_basics", "reload concept");
assert(cg2.concepts[0].questions[0].type === "diagnostic", "reload question");
console.log("  Concept graph: PASS");

// ---- Teaching Session ----
var sid = dl.genId("sess");
var sess = dl.initTeachingSession(sid, "user_001", "world_math", "textbook_algo");
assert(sess.phase === "idle", "session starts idle");
assert(sess.turnCount === 0, "session turnCount starts 0");

var sess2 = dl.getTeachingSession(sid);
assert(sess2.sessionId === sid, "getTeachingSession finds session");

dl.updateTeachingSession(sid, {
  phase: "teaching",
  currentObjective: "理解递归基础",
  activeConceptIds: ["recursion_basics"],
  turnCount: 1
});
var sess3 = dl.getTeachingSession(sid);
assert(sess3.phase === "teaching", "updateTeachingSession phase");
assert(sess3.currentObjective === "理解递归基础", "updateTeachingSession objective");
assert(sess3.activeConceptIds[0] === "recursion_basics", "updateTeachingSession concepts");
assert(sess3.turnCount === 1, "updateTeachingSession turnCount");
assert(sess3.sessionId === sid, "sessionId preserved after update");
assert(sess3.profileId === "user_001", "profileId preserved after update");
console.log("  Teaching session: PASS");

// ---- Teaching Events ----
var t1 = dl.appendTeachingEvent(sid, {
  type: "diagnosis",
  userMessage: "什么是递归？",
  diagnosis: { errorType: "no_error_detected", confidence: 0.9 },
  strategy: null,
  tutorReply: "递归是一种编程技术...",
  evaluatorResult: null,
  studentResponseQuality: "no_answer"
});
assert(typeof t1 === "string" && t1.startsWith("turn_"), "appendTeachingEvent returns turnId");

var t2 = dl.appendTeachingEvent(sid, {
  type: "assessment",
  question: "写出阶乘的递归式",
  studentAnswer: "f(n) = n * f(n-1), f(0)=1",
  verdict: "correct",
  errorType: null,
  masteryDelta: { "recursion_basics": 0.12 },
  evidence: "用户正确写出了递归式和终止条件"
});

var events = dl.getTeachingEvents(sid);
assert(events.length === 2, "getTeachingEvents count");
assert(events[0].type === "diagnosis", "first event type");
assert(events[1].type === "assessment", "second event type");
assert(events[1].verdict === "correct", "assessment verdict");
assert(events[1].masteryDelta["recursion_basics"] === 0.12, "masteryDelta");

// Limit
var limited = dl.getTeachingEvents(sid, 1);
assert(limited.length === 1 && limited[0].type === "assessment", "getTeachingEvents limit");
console.log("  Teaching events: PASS");

// ---- Assessment ----
var aid = dl.recordAssessment(sid, {
  question: "什么是O(1)？",
  studentAnswer: "常数时间复杂度",
  verdict: "correct",
  conceptIds: ["big_o"],
  masteryDelta: { "big_o": 0.1 },
  evidence: "答案正确"
});
assert(typeof aid === "string", "recordAssessment returns turnId");

// ---- Missing files safe init ----
var lmNew = dl.loadLearnerModel("new_user", "new_world");
assert(lmNew.profileId === "new_user", "missing LM safe init");
assert(Object.keys(lmNew.conceptMastery).length === 0, "fresh LM has empty mastery");

var cgNew = dl.loadConceptGraph("new_user", "new_world", "new_textbook");
assert(cgNew.concepts.length === 0, "missing CG safe init");

var noSess = dl.getTeachingSession("nonexistent");
assert(noSess === null, "nonexistent session returns null");

var noEvents = dl.getTeachingEvents("nonexistent");
assert(Array.isArray(noEvents) && noEvents.length === 0, "nonexistent events returns []");
console.log("  Safe init: PASS");

// ---- Read-back isolation ----
// Verify data files are under adaptive-teaching/ subdirectory
var root = dl.DATA_ROOT();
var entries = fs.readdirSync(root);
assert(entries.indexOf("learner-models") >= 0, "learner-models dir exists");
assert(entries.indexOf("concept-graphs") >= 0, "concept-graphs dir exists");
assert(entries.indexOf("sessions") >= 0, "sessions dir exists");
assert(entries.indexOf("events") >= 0, "events dir exists");

// No data leaked outside adaptive-teaching/
var projectFiles = fs.readdirSync(TMP);
assert(projectFiles.length === 1 && projectFiles[0] === "adaptive-teaching", "data isolated in adaptive-teaching/");
console.log("  Isolation: PASS");

// ---- Malicious ID validation (safeSegment) ----
// Path traversal via ..
var blocked = true;
try { dl.loadLearnerModel("../etc", "passwd"); blocked = false; } catch (e) {}
assert(blocked, "path traversal blocked: .. in profileId");

blocked = true;
try { dl.loadLearnerModel("user", "../../etc"); blocked = false; } catch (e) {}
assert(blocked, "path traversal blocked: ../.. in worldId");

// Backslash in ID
blocked = true;
try { dl.loadLearnerModel("user", "world\\hidden"); blocked = false; } catch (e) {}
assert(blocked, "backslash in ID blocked");

// Empty ID
blocked = true;
try { dl.loadLearnerModel("", "world"); blocked = false; } catch (e) {}
assert(blocked, "empty profileId blocked");

blocked = true;
try { dl.loadLearnerModel("user", ""); blocked = false; } catch (e) {}
assert(blocked, "empty worldId blocked");

// Null ID
blocked = true;
try { dl.loadLearnerModel(null, "world"); blocked = false; } catch (e) {}
assert(blocked, "null profileId blocked");

// sessionId path traversal
blocked = true;
try { dl.getTeachingSession("../../etc/passwd"); blocked = false; } catch (e) {}
assert(blocked, "sessionId path traversal blocked");

// Verify no files written outside adaptive-teaching/
var projectFiles2 = fs.readdirSync(TMP);
assert(projectFiles2.length === 1 && projectFiles2[0] === "adaptive-teaching", "no files leaked outside adaptive-teaching/ after malicious ID attempts");
console.log("  Malicious ID validation: PASS");

// ---- Corrupt JSON handling ----
var corruptLM = path.join(root, "learner-models", "corrupt_corruptWorld.json");
fs.mkdirSync(path.dirname(corruptLM), { recursive: true });
fs.writeFileSync(corruptLM, "this is { not @ valid ||| json }", "utf-8");
// readJSON should rename corrupt file and trigger re-init
var lmCorrupt = dl.loadLearnerModel("corrupt", "corruptWorld");
assert(lmCorrupt.profileId === "corrupt", "corrupt JSON triggers safe re-init with correct profileId");
assert(typeof lmCorrupt.conceptMastery === "object", "corrupt JSON re-init has empty mastery");

// Verify corrupt backup exists
var dirEntries = fs.readdirSync(path.dirname(corruptLM));
var foundCorrupt = false;
for (var di = 0; di < dirEntries.length; di++) {
  if (dirEntries[di].indexOf("corrupt_corruptWorld.json.corrupt-") === 0) { foundCorrupt = true; break; }
}
assert(foundCorrupt, "corrupt backup file created (.corrupt-<timestamp>)");

// Verify new default file was re-created
var freshExists = fs.existsSync(corruptLM);
assert(freshExists, "fresh default file re-created after corrupt rename");

console.log("  Corrupt JSON: PASS");

// ---- Review queue: remove mastered, update existing ----
// Fresh model with 2 concepts
var rqLm = dl.loadLearnerModel("rq_user", "rq_world");
var yesterday = new Date(Date.now() - 86400000).toISOString();
rqLm.conceptMastery["topic_a"] = { score: 0.3, lastReviewed: yesterday, history: [] };
rqLm.conceptMastery["topic_b"] = { score: 0.9, lastReviewed: yesterday, history: [] };
dl.saveLearnerModel("rq_user", "rq_world", rqLm);
dl.updateReviewQueue(rqLm);
// topic_a (score 0.3) should be in queue; topic_b (score 0.9, reviewed yesterday) should not
assert(rqLm.reviewQueue.length === 1, "reviewQueue: only weak concept enqueued");
assert(rqLm.reviewQueue[0].conceptId === "topic_a", "reviewQueue: weak concept is topic_a");
assert(rqLm.reviewQueue[0].priority >= 0.7, "reviewQueue: priority matches low score");

// Now "master" topic_a — raise score to 0.8 and set lastReviewed to now
rqLm.conceptMastery["topic_a"].score = 0.85;
rqLm.conceptMastery["topic_a"].lastReviewed = new Date().toISOString();
dl.updateReviewQueue(rqLm);
assert(rqLm.reviewQueue.length === 0, "reviewQueue: mastered concept removed");

// Add back a weak topic, verify priority updates when score changes
rqLm.conceptMastery["topic_c"] = { score: 0.5, lastReviewed: yesterday, history: [] };
dl.updateReviewQueue(rqLm);
assert(rqLm.reviewQueue.length === 1, "reviewQueue: topic_c enqueued");
assert(rqLm.reviewQueue[0].priority === 0.5, "reviewQueue: topic_c initial priority 0.5");

rqLm.conceptMastery["topic_c"].score = 0.2;
dl.updateReviewQueue(rqLm);
assert(rqLm.reviewQueue[0].priority === 0.8, "reviewQueue: priority updated when score drops");
assert(rqLm.reviewQueue[0].score === 0.2, "reviewQueue: score updated in queue entry");
console.log("  Review queue enhanced: PASS");

// ---- Summary ----
console.log("");
console.log("Passed: " + passed + "  Failed: " + failed);
if (failed > 0) {
  console.error("SOME TESTS FAILED");
  process.exit(1);
}
console.log("All tests passed.");
process.exit(0);
