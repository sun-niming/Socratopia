"use strict";

var crypto = require("crypto");
var evidence = require("./evidence-ledger.js");
var mastery = require("./mastery-engine.js");

var REPLAY_VERSION = "stage-d-replay-v1";

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(name + " must be a non-empty string");
  return value.normalize("NFC");
}

function iso(value, name) {
  var text = requiredString(value, name);
  if (!Number.isFinite(Date.parse(text))) throw new Error(name + " must be an ISO-compatible timestamp");
  return new Date(Date.parse(text)).toISOString();
}

function hash(value) {
  return evidence.hashCanonical(value);
}

function subjectKey(value, salt) {
  return hash({ schemaVersion: 1, salt: requiredString(salt || "stage-d-default-redaction", "salt"), value: requiredString(value, "subject") });
}

function committedTransactionSet(snapshot) {
  var transactions = Array.isArray(snapshot.transactions) ? snapshot.transactions : [];
  var committed = new Set();
  transactions.forEach(function (transaction) {
    if (!isRecord(transaction) || typeof transaction.transactionId !== "string") return;
    if (transaction.status === "committed" || transaction.committed === true) committed.add(transaction.transactionId);
  });
  return committed;
}

function isCommitted(record, committed) {
  if (!record || typeof record !== "object") return false;
  if (record.transactionStatus === "committed" || record.committed === true) return true;
  if (typeof record.transactionId !== "string") return committed.size === 0;
  return committed.has(record.transactionId);
}

function assertNoModelAccess(options) {
  options = options || {};
  ["model", "modelInvoker", "callLLM", "llm", "fetchModel"].forEach(function (key) {
    if (options[key] !== undefined && options[key] !== null) throw new Error("replay_model_access_forbidden:" + key);
  });
}

function validateSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new Error("replay_snapshot_must_be_object");
  ["transactions", "decisions", "executions", "executionEvents", "terminals", "evidenceEvents", "assessments"].forEach(function (key) {
    if (snapshot[key] !== undefined && !Array.isArray(snapshot[key])) throw new Error("replay_" + key + "_must_be_array");
  });
  return snapshot;
}

function committedRecords(snapshot, key, committed) {
  return (Array.isArray(snapshot[key]) ? snapshot[key] : []).filter(function (record) {
    return isRecord(record) && isCommitted(record, committed);
  }).map(clone);
}

function summarizeExecutions(executions, events, terminals, salt) {
  var output = { total: executions.length, outputStarted: 0, terminal: 0, completed: 0, failed: 0, indeterminate: 0, abandoned: 0 };
  var executionIds = new Set();
  executions.forEach(function (execution) {
    if (typeof execution.executionId === "string") executionIds.add(execution.executionId);
    if (execution.outputStarted === true) output.outputStarted += 1;
  });
  events.forEach(function (event) {
    if (event.eventType === "output_started") output.outputStarted += 1;
    if (typeof event.executionId === "string") executionIds.add(event.executionId);
  });
  terminals.forEach(function (terminal) {
    output.terminal += 1;
    var type = terminal.terminalType || terminal.status;
    if (type === "completed") output.completed += 1;
    else if (type === "failed") output.failed += 1;
    else if (type === "indeterminate") output.indeterminate += 1;
    else if (type === "abandoned") output.abandoned += 1;
    if (typeof terminal.executionId === "string") executionIds.add(terminal.executionId);
  });
  output.uniqueExecutions = executionIds.size;
  output.executionKeys = Array.from(executionIds).sort().map(function (id) { return subjectKey(id, salt); });
  return output;
}

function replaySnapshot(input, options) {
  options = options || {};
  assertNoModelAccess(options);
  var snapshot = validateSnapshot(input);
  var evaluationTime = iso(options.evaluationTime || snapshot.evaluationTime, "evaluationTime");
  var salt = requiredString(options.redactionSalt || "stage-d-default-redaction", "redactionSalt");
  var committed = committedTransactionSet(snapshot);
  var events = committedRecords(snapshot, "evidenceEvents", committed);
  var assessments = {};
  (Array.isArray(snapshot.assessments) ? snapshot.assessments : []).forEach(function (assessment) {
    if (isRecord(assessment) && typeof assessment.assessmentId === "string") assessments[assessment.assessmentId] = clone(assessment);
  });
  var ledgerView = evidence.buildLedgerView(events);
  var masteryView = mastery.replayMastery(events, { rulesVersion: options.rulesVersion, assessments: assessments });
  var decisions = committedRecords(snapshot, "decisions", committed);
  var executions = committedRecords(snapshot, "executions", committed);
  var executionEvents = committedRecords(snapshot, "executionEvents", committed);
  var terminals = committedRecords(snapshot, "terminals", committed);
  var scopeKeys = new Set();
  events.concat(decisions).forEach(function (record) {
    if (!record) return;
    var scope = [record.accountId, record.profileId, record.worldId, record.textbookId].map(function (value) { return value || ""; }).join("\u0000");
    if (scope.replace(/\u0000/g, "")) scopeKeys.add(scope);
  });
  var concepts = Object.keys(masteryView || {}).sort().map(function (conceptId) {
    var value = mastery.deriveEffectiveProjection(masteryView[conceptId], evaluationTime);
    return {
      conceptKey: subjectKey(conceptId, salt),
      baseState: value && value.baseState || null,
      effectiveState: value && value.effectiveState || null,
      score: value && typeof value.score === "number" ? value.score : null,
      nextReviewAt: value && value.nextReviewAt || null,
      evidenceCount: value && value.evidenceCount || 0
    };
  });
  return Object.freeze({
    schemaVersion: 1,
    replayVersion: REPLAY_VERSION,
    evaluationTime: evaluationTime,
    sourceSnapshotHash: hash(snapshot),
    committedTransactionCount: committed.size,
    scopeCount: scopeKeys.size,
    counts: {
      evidence: events.length,
      decisions: decisions.length,
      executions: executions.length,
      executionEvents: executionEvents.length,
      terminals: terminals.length,
      verifiedEvidence: events.filter(function (event) { return event.verificationStatus === "verified"; }).length,
      unverifiedEvidence: events.filter(function (event) { return event.verificationStatus === "unverified"; }).length
    },
    ledgerViewHash: ledgerView.ledgerViewHash,
    mastery: concepts,
    executionSummary: summarizeExecutions(executions, executionEvents, terminals, salt),
    decisionSummary: {
      total: decisions.length,
      decisionKeys: decisions.filter(function (decision) { return typeof decision.decisionId === "string"; }).map(function (decision) { return subjectKey(decision.decisionId, salt); }).sort()
    },
    redaction: { subjectKey: "sha256", rawIdentifiersEmitted: false }
  });
}

module.exports = {
  REPLAY_VERSION: REPLAY_VERSION,
  replaySnapshot: replaySnapshot,
  subjectKey: subjectKey
};
