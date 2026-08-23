#!/usr/bin/env node
"use strict";

var assert = require("assert");
var assessment = require("./assessment-engine.js");
var evidence = require("./evidence-ledger.js");
var mastery = require("./mastery-engine.js");
var policy = require("./policy-engine.js");

var passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS: " + name);
  } catch (error) {
    console.error("FAIL: " + name);
    throw error;
  }
}

function sourceAssessment(id, type, answerKey, extra) {
  return assessment.normalizeAssessment(Object.assign({
    schemaVersion: 1,
    assessmentId: id,
    assessmentVersion: "assessment-v1",
    conceptId: "concept-a",
    questionType: type,
    scoringMode: "deterministic",
    answerKey: answerKey,
    answerKeyProvenance: "source_anchored",
    answerKeyValidationStatus: "verified",
    validatorType: "template_rule",
    validatorVersion: "template-v1",
    graderVersion: "grader-v1",
    sourceRefs: [{ sourceId: "book", pageOrCardId: "p1", contentHash: "content-hash", excerptHash: "excerpt-hash" }]
  }, extra || {}));
}

function scoreEvent(args) {
  var scored = assessment.scoreAssessment(args.assessment, args.answer, args.scoreOptions);
  return evidence.createEvidenceEvent({
    eventId: args.eventId,
    transactionId: args.transactionId || "tx-" + args.eventId,
    accountId: "account-a",
    profileId: "profile-a",
    worldId: "world-a",
    textbookId: "textbook-a",
    sessionId: args.sessionId || "session-a",
    turnId: args.turnId || args.eventId,
    assessmentId: args.assessment.assessmentId,
    conceptId: args.assessment.conceptId,
    source: "classroom",
    evidenceType: args.evidenceType || "basic",
    assistanceLevel: args.assistanceLevel || "none",
    scoringResult: scored,
    assessment: args.assessment,
    misconceptionId: args.misconceptionId,
    verifiedByEventIds: args.verifiedByEventIds || [],
    createdAt: args.createdAt || "2026-01-01T00:00:00.000Z"
  });
}

test("1 self report is zero-weight unverified and policy asks a check", function () {
  var event = evidence.createEvidenceEvent({
    eventId: "event-self",
    transactionId: "tx-self",
    accountId: "account-a",
    profileId: "profile-a",
    worldId: "world-a",
    textbookId: "textbook-a",
    sessionId: "session-a",
    turnId: "turn-self",
    conceptId: "concept-a",
    source: "classroom",
    evidenceType: "self_report",
    assistanceLevel: "none",
    learnerAnswer: "我理解了",
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  assert.strictEqual(event.verificationStatus, "unverified");
  var projection = mastery.replayConcept([event], "concept-a");
  assert.strictEqual(projection.score, 0);
  assert.strictEqual(projection.baseState, "unseen");
  var decision = policy.selectNextAction({
    conceptId: "concept-a",
    projection: projection,
    learnerSignal: "self_report",
    evaluationTime: "2026-01-01T00:00:00.000Z"
  });
  assert.strictEqual(decision.action, "check");
  assert.deepStrictEqual(decision.reasonCodes, ["SELF_REPORT_NEEDS_CHECK"]);
});

test("2 high-confidence LLM diagnosis remains unverified and cannot change mastery", function () {
  var llmAssessment = assessment.normalizeAssessment({
    schemaVersion: 1,
    assessmentId: "open-1",
    assessmentVersion: "assessment-v1",
    conceptId: "concept-a",
    questionType: "open",
    scoringMode: "llm_assisted",
    answerKey: "LLM suggestion",
    answerKeyProvenance: "llm_generated",
    answerKeyValidationStatus: "unverified",
    validatorType: "none",
    validatorVersion: "none",
    graderVersion: "diagnostician-v1",
    sourceRefs: []
  });
  var event = evidence.createEvidenceEvent({
    eventId: "event-llm",
    transactionId: "tx-llm",
    accountId: "account-a",
    profileId: "profile-a",
    worldId: "world-a",
    textbookId: "textbook-a",
    sessionId: "session-a",
    turnId: "turn-llm",
    assessmentId: llmAssessment.assessmentId,
    conceptId: "concept-a",
    source: "classroom",
    evidenceType: "basic",
    assistanceLevel: "none",
    assessment: llmAssessment,
    diagnosis: { outcome: "correct", diagnosticConfidence: 0.99 },
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  assert.strictEqual(event.graderType, "llm_assisted");
  assert.strictEqual(event.verificationStatus, "unverified");
  assert.strictEqual(mastery.replayConcept([event], "concept-a").score, 0);
});

test("3 LLM-generated answer keys cannot become verified through string comparison", function () {
  var untrusted = assessment.normalizeAssessment({
    schemaVersion: 1,
    assessmentId: "llm-key",
    assessmentVersion: "assessment-v1",
    conceptId: "concept-a",
    questionType: "short_answer",
    scoringMode: "deterministic",
    answerKey: "wrong expected answer",
    answerKeyProvenance: "llm_generated",
    answerKeyValidationStatus: "verified",
    validatorType: "none",
    validatorVersion: "none",
    graderVersion: "grader-v1",
    sourceRefs: []
  });
  var result = assessment.scoreAssessment(untrusted, "wrong expected answer");
  assert.strictEqual(result.correct, true);
  assert.strictEqual(result.verificationStatus, "unverified");
  var event = scoreEvent({ assessment: untrusted, answer: "wrong expected answer", eventId: "event-llm-key" });
  assert.strictEqual(mastery.replayConcept([event], "concept-a").score, 0);
});

test("4 source and solver provenance must validate before deterministic scoring is verified", function () {
  var source = sourceAssessment("source-key", "choice", "A");
  assert.strictEqual(assessment.scoreAssessment(source, "A").verificationStatus, "verified");
  var solver = assessment.normalizeAssessment({
    schemaVersion: 1,
    assessmentId: "solver-key",
    assessmentVersion: "assessment-v1",
    conceptId: "concept-a",
    questionType: "numeric",
    scoringMode: "deterministic",
    answerKey: 42,
    answerKeyProvenance: "solver_derived",
    answerKeyValidationStatus: "verified",
    validatorType: "solver",
    validatorVersion: "solver-v2",
    graderVersion: "numeric-v1",
    solver: { name: "exact-solver", version: "2", normalizedInput: "6*7", resultHash: "solver-result-hash" },
    sourceRefs: []
  });
  assert.strictEqual(assessment.scoreAssessment(solver, "42").verificationStatus, "verified");
  var invalid = assessment.normalizeAssessment(Object.assign({}, source, { sourceRefs: [] }));
  assert.strictEqual(assessment.scoreAssessment(invalid, "A").verificationStatus, "unverified");
});

test("5 independent verified check links to but does not mutate the LLM observation", function () {
  var open = Object.freeze({
    eventId: "open-observation",
    eventKey: "open-key",
    eventInputHash: "open-input",
    conceptId: "concept-a",
    verificationStatus: "unverified",
    graderType: "llm_assisted",
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  var check = scoreEvent({
    assessment: sourceAssessment("independent-check", "boolean", true),
    answer: true,
    eventId: "verified-check",
    verifiedByEventIds: [open.eventId]
  });
  assert.strictEqual(check.verificationStatus, "verified");
  assert.deepStrictEqual(check.verifiedByEventIds, ["open-observation"]);
  assert.strictEqual(open.verificationStatus, "unverified");
  assert.strictEqual(mastery.replayConcept([open, check], "concept-a").score, 0.1);
});

test("6 repeated verified misconception selects lower-difficulty remediation", function () {
  var a = sourceAssessment("misconception-check", "boolean", true);
  var first = scoreEvent({ assessment: a, answer: false, eventId: "mis-1", turnId: "turn-mis-1", misconceptionId: "sign-error" });
  var second = scoreEvent({ assessment: a, answer: false, eventId: "mis-2", turnId: "turn-mis-2", misconceptionId: "sign-error" });
  var projection = mastery.replayConcept([first, second], "concept-a");
  var decision = policy.selectNextAction({ conceptId: "concept-a", projection: projection, evaluationTime: "2026-01-01T00:00:00.000Z" });
  assert.strictEqual(decision.action, "remediate");
  assert.strictEqual(decision.difficulty, "lower");
  assert(decision.reasonCodes.indexOf("REPEATED_MISCONCEPTION") >= 0);
});

test("7 heavy-hint correct answer is not independent mastery and schedules no-hint check", function () {
  var event = scoreEvent({ assessment: sourceAssessment("heavy-hint", "choice", "A"), answer: "A", eventId: "heavy", assistanceLevel: "heavy" });
  var projection = mastery.replayConcept([event], "concept-a");
  assert.notStrictEqual(projection.baseState, "provisional");
  assert.notStrictEqual(projection.baseState, "mastered");
  var decision = policy.selectNextAction({ conceptId: "concept-a", projection: projection, evaluationTime: "2026-01-01T00:00:00.000Z" });
  assert.strictEqual(decision.action, "check");
  assert(decision.reasonCodes.indexOf("HEAVY_HINT_NEEDS_INDEPENDENT_CHECK") >= 0);
  assert.strictEqual(decision.tutorContract.hintLevel, "none");
});

test("8 independent basic plus transfer evidence permits advance", function () {
  var basic = scoreEvent({ assessment: sourceAssessment("basic", "choice", "A"), answer: "A", eventId: "basic" });
  var transfer = scoreEvent({ assessment: sourceAssessment("transfer", "choice", "B"), answer: "B", eventId: "transfer", evidenceType: "transfer", createdAt: "2026-01-02T00:00:00.000Z" });
  var projection = mastery.replayConcept([basic, transfer], "concept-a");
  assert.strictEqual(projection.baseState, "mastered");
  var decision = policy.selectNextAction({ conceptId: "concept-a", projection: projection, evaluationTime: "2026-01-03T00:00:00.000Z" });
  assert.strictEqual(decision.action, "advance");
});

test("9 verified retention evidence can enter or restore mastered", function () {
  var retention = scoreEvent({ assessment: sourceAssessment("retention", "boolean", true), answer: true, eventId: "retention", evidenceType: "retention", createdAt: "2026-01-10T00:00:00.000Z" });
  var projection = mastery.replayConcept([retention], "concept-a");
  assert.strictEqual(projection.baseState, "mastered");
  assert(projection.nextReviewAt);
});

test("10 timeout and invalid diagnostician output select a conservative check", function () {
  ["timeout", "invalid"].forEach(function (status) {
    var decision = policy.selectNextAction({
      conceptId: "concept-a",
      projection: mastery.replayConcept([], "concept-a"),
      diagnosisStatus: status,
      evaluationTime: "2026-01-01T00:00:00.000Z"
    });
    assert.strictEqual(decision.action, "check");
    assert.strictEqual(decision.difficulty, "same");
    assert.strictEqual(decision.tutorContract.maxQuestions, 1);
    assert(decision.reasonCodes.indexOf("DIAGNOSIS_UNAVAILABLE_CONSERVATIVE_CHECK") >= 0);
  });
});

test("13 same event key and input hash replays one immutable event", function () {
  var a = sourceAssessment("dedupe", "choice", "A");
  var original = scoreEvent({ assessment: a, answer: "A", eventId: "dedupe-original", transactionId: "tx-original", turnId: "same-turn" });
  var retry = scoreEvent({ assessment: a, answer: "A", eventId: "dedupe-retry", transactionId: "tx-retry", turnId: "same-turn" });
  assert.strictEqual(original.eventKey, retry.eventKey);
  assert.strictEqual(original.eventInputHash, retry.eventInputHash);
  var appended = evidence.appendImmutableEvent([original], retry);
  assert.strictEqual(appended.replayed, true);
  assert.strictEqual(appended.events.length, 1);
  assert.strictEqual(appended.event.eventId, original.eventId);
});

test("14 same event key with different input hash raises evidence_conflict", function () {
  var a = sourceAssessment("conflict", "choice", "A");
  var original = scoreEvent({ assessment: a, answer: "A", eventId: "conflict-original", turnId: "conflict-turn" });
  var changed = scoreEvent({ assessment: a, answer: "B", eventId: "conflict-changed", turnId: "conflict-turn" });
  assert.strictEqual(original.eventKey, changed.eventKey);
  assert.notStrictEqual(original.eventInputHash, changed.eventInputHash);
  assert.throws(function () { evidence.appendImmutableEvent([original], changed); }, function (error) {
    return error && error.code === "evidence_conflict";
  });
});

test("34 review_due is an asOf-only view and never changes base projection or ledger hash", function () {
  var basic = scoreEvent({ assessment: sourceAssessment("time-basic", "choice", "A"), answer: "A", eventId: "time-basic" });
  var transfer = scoreEvent({ assessment: sourceAssessment("time-transfer", "choice", "B"), answer: "B", eventId: "time-transfer", evidenceType: "transfer", createdAt: "2026-01-02T00:00:00.000Z" });
  var beforeReplay = mastery.replayConcept([basic, transfer], "concept-a");
  var afterReplay = mastery.replayConcept([basic, transfer], "concept-a");
  assert.deepStrictEqual(beforeReplay, afterReplay);
  assert.strictEqual(beforeReplay.ledgerViewHash, afterReplay.ledgerViewHash);
  var before = mastery.deriveEffectiveProjection(beforeReplay, "2026-01-03T00:00:00.000Z");
  var after = mastery.deriveEffectiveProjection(afterReplay, "2026-02-03T00:00:00.000Z");
  assert.strictEqual(before.effectiveState, "mastered");
  assert.strictEqual(after.effectiveState, "review_due");
  assert.strictEqual(before.baseState, after.baseState);
  assert.strictEqual(before.ledgerViewHash, after.ledgerViewHash);
});

test("deterministic scorers cover choice, boolean, order, set, numeric and constrained short answer", function () {
  assert.strictEqual(assessment.scoreAssessment(sourceAssessment("choice-type", "choice", "A"), "a").correct, true);
  assert.strictEqual(assessment.scoreAssessment(sourceAssessment("boolean-type", "boolean", true), "true").correct, true);
  assert.strictEqual(assessment.scoreAssessment(sourceAssessment("order-type", "order", ["first", "second"]), ["first", "second"]).correct, true);
  assert.strictEqual(assessment.scoreAssessment(sourceAssessment("set-type", "set", ["red", "blue"]), ["blue", "red"]).correct, true);
  assert.strictEqual(assessment.scoreAssessment(sourceAssessment("numeric-type", "numeric", 3.14, { scoringRules: { absoluteTolerance: 0.01 } }), "3.145").correct, true);
  assert.strictEqual(assessment.scoreAssessment(sourceAssessment("short-type", "short_answer", ["base case", "termination case"]), "  Base   Case ").correct, true);
});

console.log("");
console.log("Adaptive domain smoke test passed: " + passed + " scenarios.");
