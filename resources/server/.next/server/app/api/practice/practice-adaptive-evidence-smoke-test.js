"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-stage-c-practice-"));
var oldProjectRoot = process.env.PROJECT_ROOT;
process.env.PROJECT_ROOT = tempRoot;

function intent(revision, receipt, state, binding) {
  return {
    schemaVersion: 1,
    source: "practice",
    sourceEventId: "sha256:event-" + revision,
    domainRevision: revision,
    accountBindingHash: binding || "sha256:account-a",
    conceptResolution: { status: "missing", conceptId: null, resolverVersion: "external-concept-resolver-v1" },
    gradingMode: "deterministic",
    observationInputHash: "sha256:observation-" + revision,
    eventInputHash: null,
    payload: { sourceEventId: "sha256:event-" + revision },
    businessReceipt: receipt,
    createdAt: "2026-08-20T00:00:0" + revision + ".000Z",
    sync: { state: state || "pending", attempts: 0, lastReasonCode: "concept_mapping_missing", updatedAt: "2026-08-20T00:00:00.000Z" }
  };
}

function main() {
  var count = 0;
  function ok(value, message) { assert(value, message); count += 1; }
  var data = require("../../../../../lib/practice/data-layer.js");
  var profileId = "profile-a", worldId = "world-a", setId = "set-a", problemId = "problem-a";
  data.writeProblemSet(profileId, worldId, {
    id: setId,
    source: { textbookId: "textbook-a" },
    problems: [{
      id: problemId,
      type: "choice",
      question: "2 + 2?",
      choices: ["3", "4"],
      correctIndex: 1,
      correctAnswer: "4",
      difficulty: 1,
      knowledgePoints: ["Arithmetic"],
      history: [{ timestamp: "legacy", correct: true }]
    }]
  });

  var buildCalls = 0;
  var first = data.appendAnswerRecord(profileId, worldId, setId, problemId, { userAnswer: "4", correct: true, score: 1 }, {
    buildAdaptiveIntent: function (meta) {
      buildCalls += 1;
      return intent(meta.domainRevision, meta.businessReceipt);
    }
  });
  ok(first.schemaVersion === 2 && first.domainRevision === 1 && buildCalls === 1, "legacy history must not consume domain revision");
  ok(first.adaptiveEvidence && first.adaptiveEvidence.businessReceipt.answerRecordHash, "answer and pending intent must share one persisted entry");
  var persisted = data.readProblemSet(profileId, worldId, setId);
  ok(persisted.problems[0].history.length === 2 && persisted.problems[0].history[1].adaptiveEvidence, "business answer and pending must be written together");

  var facadeCalls = 0;
  var failed = null;
  try {
    data.appendAnswerRecord(profileId, worldId, setId, "missing-problem", { userAnswer: "x" }, {
      buildAdaptiveIntent: function () { facadeCalls += 1; return {}; }
    });
  } catch (error) { failed = error; }
  ok(failed && facadeCalls === 0, "append failure before commit must not call facade intent builder");

  var second = data.appendAnswerRecord(profileId, worldId, setId, problemId, { userAnswer: "3", correct: false, score: 0 }, {
    buildAdaptiveIntent: function (meta) { return intent(meta.domainRevision, meta.businessReceipt, "retryable"); }
  });
  ok(second.domainRevision === 2, "revisions must increase monotonically");
  var pending = data.listPendingAnswerEvidence(profileId, worldId, setId, problemId, "sha256:account-a", 10);
  ok(pending.map(function (entry) { return entry.domainRevision; }).join(",") === "1,2", "pending recovery must be account-filtered and revision ordered");
  ok(data.listPendingAnswerEvidence(profileId, worldId, setId, problemId, "sha256:account-b", 10).length === 0, "another account must not see pending evidence");

  var resolvedPayload = Object.assign({}, first.adaptiveEvidence.payload, {
    sourceEventId: first.adaptiveEvidence.sourceEventId,
    eventInputHash: "sha256:resolved-1",
    conceptId: "concept-a"
  });
  data.updateAnswerAdaptiveSync(profileId, worldId, setId, problemId, first.adaptiveEvidence.sourceEventId, first.adaptiveEvidence.observationInputHash, {
    state: "committed",
    reasonCode: null,
    intentPatch: {
      conceptResolution: { status: "resolved", conceptId: "concept-a", resolverVersion: "external-concept-resolver-v1" },
      eventInputHash: "sha256:resolved-1",
      payload: resolvedPayload
    }
  });
  var committed = data.readProblemSet(profileId, worldId, setId).problems[0].history[1].adaptiveEvidence;
  ok(committed.sync.state === "committed" && committed.eventInputHash === "sha256:resolved-1", "mapping resolution may freeze payload and event hash once");
  data.updateAnswerAdaptiveSync(profileId, worldId, setId, problemId, committed.sourceEventId, committed.observationInputHash, { state: "retryable", reasonCode: "late_failure" });
  committed = data.readProblemSet(profileId, worldId, setId).problems[0].history[1].adaptiveEvidence;
  ok(committed.sync.state === "committed", "terminal sync state must not be overwritten by a late retry");

  var markerFailure = null;
  try {
    data.updateAnswerAdaptiveSync(profileId, worldId, setId, problemId, second.adaptiveEvidence.sourceEventId, "sha256:wrong", { state: "committed" });
  } catch (error) { markerFailure = error; }
  var stillPending = data.readProblemSet(profileId, worldId, setId).problems[0].history[2].adaptiveEvidence;
  ok(markerFailure && stillPending.sync.state === "retryable", "marker failure must preserve retryable business record");

  var buildFailure = data.appendAnswerRecord(profileId, worldId, setId, problemId, { userAnswer: "4", correct: true, score: 1 }, {
    buildAdaptiveIntent: function () { throw new Error("fixture failure"); }
  });
  ok(buildFailure.adaptiveEvidenceBuildError === "intent_build_failed" && !buildFailure.adaptiveEvidence, "intent construction failure must not roll back answer");

  var previousAccountContext = global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__;
  var currentAccount = "account-a";
  global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__ = { getAccountId: function () { return currentAccount; } };
  data.writeProblemSet("shared-profile", "shared-world", {
    id: "account-scoped-set", source: { textbookId: "textbook-a" },
    problems: [{ id: "account-a-problem", type: "fill", question: "A", correctAnswer: "A", difficulty: 1, history: [] }]
  });
  currentAccount = "account-b";
  ok(data.readProblemSet("shared-profile", "shared-world", "account-scoped-set") === null, "account B must not read account A Practice data");
  data.writeProblemSet("shared-profile", "shared-world", {
    id: "account-scoped-set", source: { textbookId: "textbook-b" },
    problems: [{ id: "account-b-problem", type: "fill", question: "B", correctAnswer: "B", difficulty: 1, history: [] }]
  });
  currentAccount = "account-a";
  ok(data.readProblemSet("shared-profile", "shared-world", "account-scoped-set").problems[0].id === "account-a-problem", "account switch must restore the original isolated Practice view");
  if (previousAccountContext === undefined) delete global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__;
  else global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__ = previousAccountContext;

  var routePath = path.join(__dirname, "route.js");
  var route = fs.readFileSync(routePath, "utf8");
  ok(route.indexOf("return await _doGrade(b, h, null, null)") >= 0, "unsigned legacy grade must not create evidence");
  ok(route.indexOf("return _doGrade(b, h, service, handle)") >= 0, "signed grade must run through authorized facade handle");
  var saveStart = route.indexOf("async function _doSavePracticeRecord");
  var saveEnd = route.indexOf("async function", saveStart + 20);
  var saveBlock = route.slice(saveStart, saveEnd);
  ok(saveBlock.indexOf("prepareObservation") < 0 && saveBlock.indexOf("recordPending") < 0, "client aggregate save must never create evidence");
  var prepareStart = route.indexOf("stageCService.prepareObservation");
  var prepareBlock = route.slice(prepareStart, prepareStart + 2200);
  ok(prepareBlock.indexOf("body.correctCount") < 0 && prepareBlock.indexOf("body.score") < 0 && prepareBlock.indexOf("body.conceptId") < 0, "evidence fields must be derived from saved server problem");
  ok(route.indexOf('gradingMode = "llm_assisted"') >= 0 && route.indexOf('answerKeyProvenance: sourceMeta.answerKeyProvenance || "llm_generated"') >= 0, "LLM grading and generated keys must remain unverified inputs");

  console.log("practice adaptive evidence smoke: " + count + "/" + count + " passed");
}

try {
  main();
} finally {
  if (oldProjectRoot === undefined) delete process.env.PROJECT_ROOT;
  else process.env.PROJECT_ROOT = oldProjectRoot;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
