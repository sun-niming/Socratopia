"use strict";

var assert = require("assert");
var assessment = require("./assessment-engine.js");
var evidence = require("./evidence-ledger.js");
var replay = require("./stage-d-replay.js");
var migration = require("./stage-d-migration.js");
var metrics = require("./stage-d-metrics.js");
var exposureStore = require("./stage-d-exposure-store.js");
var fs = require("fs");
var os = require("os");
var path = require("path");

function verifiedAssessment() {
  return assessment.normalizeAssessment({
    assessmentId: "assessment-fixture",
    assessmentVersion: "assessment-fixture-v1",
    questionType: "choice",
    scoringMode: "external_deterministic",
    answerKey: 1,
    answerKeyProvenance: "external_verified",
    answerKeyValidationStatus: "verified",
    validatorType: "external_contract",
    validatorVersion: "validator-fixture-v1",
    graderVersion: "grader-fixture-v1",
    externalContract: { contractId: "contract-fixture", version: "1" }
  });
}

function eventFixture() {
  var assessmentValue = verifiedAssessment();
  var scoring = assessment.scoreExternalAssessment(assessmentValue, {
    outcome: "correct",
    contractVerified: true,
    graderVersion: "grader-fixture-v1"
  });
  return evidence.createEvidenceEvent({
    transactionId: "tx-evidence-1",
    accountId: "account-a",
    profileId: "profile-a",
    worldId: "world-a",
    textbookId: "textbook-a",
    source: "practice",
    sourceEventId: "sha256:source-event-1",
    conceptId: "concept-a",
    evidenceType: "basic",
    assistanceLevel: "none",
    scoringResult: scoring,
    assessment: assessmentValue,
    createdAt: "2026-08-25T00:00:00.000Z"
  });
}

function snapshotFixture() {
  var event = eventFixture();
  return {
    evaluationTime: "2026-08-26T00:00:00.000Z",
    transactions: [{ transactionId: "tx-evidence-1", status: "committed" }, { transactionId: "tx-decision-1", status: "committed" }],
    assessments: [verifiedAssessment()],
    evidenceEvents: [event],
    decisions: [{ schemaVersion: 1, transactionId: "tx-decision-1", decisionId: "decision-a", accountId: "account-a", profileId: "profile-a", worldId: "world-a", textbookId: "textbook-a" }],
    executions: [{ schemaVersion: 1, transactionId: "tx-decision-1", executionId: "execution-a", decisionId: "decision-a", outputStarted: true }],
    executionEvents: [{ schemaVersion: 1, transactionId: "tx-decision-1", executionId: "execution-a", eventType: "output_started" }],
    terminals: [{ schemaVersion: 1, transactionId: "tx-decision-1", executionId: "execution-a", terminalType: "completed" }]
  };
}

function main() {
  var count = 0;
  function ok(value, message) { assert(value, message); count += 1; }

  var snapshot = snapshotFixture();
  var result = replay.replaySnapshot(snapshot, { redactionSalt: "fixture-redaction" });
  ok(result.replayVersion === "stage-d-replay-v1", "replay version is explicit");
  ok(result.counts.evidence === 1 && result.counts.verifiedEvidence === 1, "committed evidence is replayed");
  ok(result.mastery.length === 1 && result.mastery[0].baseState === "provisional", "mastery transition is replayed deterministically");
  ok(result.executionSummary.completed === 1 && result.executionSummary.terminal === 1, "execution terminal is replayed");
  ok(JSON.stringify(result).indexOf("account-a") < 0 && JSON.stringify(result).indexOf("profile-a") < 0, "replay output redacts raw identifiers");
  var modelFailure = null;
  try { replay.replaySnapshot(snapshot, { callLLM: function () {} }); } catch (error) { modelFailure = error; }
  ok(modelFailure && modelFailure.message.indexOf("replay_model_access_forbidden") === 0, "replay forbids model access");

  var noOp = migration.planMigration(snapshot, { targetSchemaVersion: 1 });
  ok(noOp.changed === false && noOp.writesPerformed === 0 && noOp.productionWrite === false, "no-op migration is dry-run only");
  var migratedPlan = migration.planMigration(snapshot, {
    targetSchemaVersion: 2,
    migrations: { "1->2": function (record) { record.migratedFixture = true; return record; } }
  });
  ok(migratedPlan.changed === true && migratedPlan.beforeHash !== migratedPlan.afterHash, "migration manifest captures before/after hashes");
  var migrated = migration.applyInMemory(snapshot, {
    targetSchemaVersion: 2,
    migrations: { "1->2": function (record) { record.migratedFixture = true; return record; } }
  });
  ok(migrated.evidenceEvents[0].schemaVersion === 2 && snapshot.evidenceEvents[0].schemaVersion === 1, "migration only changes an in-memory clone");
  ok(migratedPlan.scopeKeys.every(function (value) { return /^sha256:/.test(value); }), "migration scopes are redacted");

  var assignment = metrics.assignCohort({ experimentId: "adaptive-stage-d", experimentVersion: "v1", accountId: "account-a", profileId: "profile-a", arms: ["control", "adaptive"], redactionSalt: "cohort-fixture" });
  var sameAssignment = metrics.assignCohort({ experimentId: "adaptive-stage-d", experimentVersion: "v1", accountId: "account-a", profileId: "profile-a", arms: ["control", "adaptive"], redactionSalt: "cohort-fixture" });
  ok(assignment.arm === sameAssignment.arm && assignment.subjectKey === sameAssignment.subjectKey, "cohort assignment is stable");
  var exposure = metrics.createExposure({ assignment: assignment, eligible: true, exposed: true, fallback: false, executionId: "execution-a", verifiedEvidenceCount: 1, latencyMs: 120, exposedAt: "2026-08-25T00:00:00.000Z" });
  var aggregate = metrics.aggregateMetrics([exposure]);
  ok(aggregate.totalRecords === 1 && aggregate.arms[assignment.arm].verifiedEvidence === 1, "metrics aggregate verified evidence without raw IDs");
  ok(JSON.stringify(exposure).indexOf("account-a") < 0 && JSON.stringify(aggregate).indexOf("execution-a") < 0, "exposure and metrics redact identifiers");
  var safe = metrics.evaluateThresholds(aggregate, { minExposures: 1, minVerifiedEvidence: 1, maxFallbackRate: 0, maxCrossArmSubjects: 0, maxP95LatencyMs: 1000 });
  ok(safe.safeToExpand === true, "thresholds pass for safe fixture");
  var contaminated = Object.assign({}, exposure, { arm: assignment.arm === "control" ? "adaptive" : "control" });
  var unsafe = metrics.evaluateThresholds(metrics.aggregateMetrics([exposure, contaminated]), { minExposures: 1, minVerifiedEvidence: 1, maxCrossArmSubjects: 0 });
  ok(unsafe.safeToExpand === false && unsafe.failures.indexOf("cross_arm_contamination") >= 0, "cross-arm contamination blocks expansion");

  var exposureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stage-d-exposure-"));
  try {
    var store = exposureStore.createExposureStore({ rootDir: exposureRoot, experimentId: "adaptive-stage-d", allowWrite: true, writeToken: "stage-d-explicit" });
    var committed = store.append(exposure);
    var duplicate = store.append(exposure);
    ok(committed.state === "committed" && duplicate.state === "duplicate" && store.list().length === 1, "durable exposure store is append-only and idempotent");
    var rawRejected = null;
    try { store.append(Object.assign({}, exposure, { exposureId: "sha256:raw-reject", accountId: "account-a" })); } catch (error) { rawRejected = error; }
    ok(rawRejected && rawRejected.message.indexOf("raw exposure identifier forbidden") === 0, "durable store rejects raw account identifiers");
  } finally {
    fs.rmSync(exposureRoot, { recursive: true, force: true });
  }

  console.log("stage-d smoke: " + count + "/" + count + " passed");
}

try { main(); } catch (error) { console.error(error && error.stack || error); process.exitCode = 1; }
