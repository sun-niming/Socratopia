#!/usr/bin/env node
"use strict";

var assert = require("assert");
var journalModule = require("./transaction-journal.js");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMemoryStorage() {
  var scopes = new Map();
  function bucket(scope) {
    var key = String(scope.mutationScopeKey || [scope.accountId, scope.profileId, scope.worldId, scope.textbookId].join("/"));
    if (!scopes.has(key)) scopes.set(key, new Map());
    return scopes.get(key);
  }
  return {
    readArtifact: function (scope, storageKey) {
      return clone(bucket(scope).get(storageKey) || null);
    },
    writeArtifactAtomic: function (scope, storageKey, value) {
      bucket(scope).set(storageKey, clone(value));
    },
    listArtifacts: function (scope, prefix) {
      var output = [];
      bucket(scope).forEach(function (value, key) {
        if (!prefix || key.indexOf(prefix) === 0) output.push({ storageKey: key, value: clone(value) });
      });
      return output;
    },
    raw: function (scope, storageKey) { return bucket(scope).get(storageKey); }
  };
}

function artifact(kind, type, id, storageKey, base, revision, payload) {
  return {
    artifactKind: kind,
    artifactType: type,
    artifactId: id,
    storageKey: storageKey,
    expectedBaseRevision: base ? base.revision : "ABSENT",
    expectedBasePayloadHash: base ? journalModule.payloadHash(base) : "ABSENT",
    targetRevision: revision,
    payload: Object.assign({ schemaVersion: 1, revision: revision }, payload)
  };
}

var scope = {
  accountId: "account-a",
  profileId: "profile-a",
  worldId: "world-a",
  textbookId: "textbook-a",
  mutationScopeKey: "scope-a"
};

function spec(requestId, base, suffix) {
  suffix = suffix || "one";
  var evidenceId = "event-" + suffix;
  var sessionId = "session-a";
  return {
    operation: "prepareTurn",
    requestId: requestId,
    mutationScopeKey: scope.mutationScopeKey,
    normalizedRequest: { action: "prepareTurn", message: suffix },
    evaluationTime: "2026-08-19T08:00:00.000Z",
    sessionId: sessionId,
    artifacts: [
      artifact("immutable", "evidence", evidenceId, "evidence/" + evidenceId + ".json", null, 1, {
        eventId: evidenceId,
        eventKey: "classroom:" + suffix,
        eventInputHash: journalModule.hashCanonical({ message: suffix })
      }),
      artifact("mutable", "session", sessionId, "sessions/" + sessionId + ".json", base, base ? base.revision + 1 : 1, {
        sessionId: sessionId,
        turnCount: base ? base.turnCount + 1 : 1
      })
    ],
    resultPayload: { ok: true, requestId: requestId, suffix: suffix }
  };
}

async function expectCrash(promise, point) {
  await assert.rejects(promise, function (error) {
    return error && error.code === "injected_crash" && error.details && error.details.point === point;
  });
}

async function run() {
  var storage = createMemoryStorage();
  var crashPoint = null;
  var generationCount = 0;
  var journal = journalModule.createJournal({
    storage: storage,
    clock: function () { return new Date("2026-08-19T08:00:00.000Z"); },
    failureInjector: function (point) { return point === crashPoint; }
  });

  crashPoint = "after_prepare";
  generationCount += 1;
  var firstSpec = spec("request-prepare", null, "prepare");
  await expectCrash(journal.execute(scope, firstSpec), "after_prepare");
  var firstId = journal.transactionIdFor(scope.mutationScopeKey, firstSpec.operation, firstSpec.requestId);
  var prepared = journal.readTransaction(scope, firstId);
  assert.strictEqual(prepared.status, "prepared");
  assert.strictEqual(journal.readCommitted(scope, "evidence/event-prepare.json"), null);
  var writeSetHash = prepared.writeSetHash;
  var resultHash = prepared.resultPayloadHash;

  crashPoint = null;
  var recovered = await journal.recoverTransaction(scope, firstId);
  assert.strictEqual(generationCount, 1, "recovery must not call generation logic");
  assert.strictEqual(recovered.transaction.writeSetHash, writeSetHash);
  assert.strictEqual(recovered.transaction.resultPayloadHash, resultHash);
  assert.strictEqual(recovered.transaction.status, "committed");
  assert.strictEqual(recovered.transaction.materializationStatus, "complete");
  assert.strictEqual(journal.readCommitted(scope, "evidence/event-prepare.json").eventId, "event-prepare");

  var base = storage.readArtifact(scope, "sessions/session-a.json");
  crashPoint = "after_immutable:0";
  var immutableSpec = spec("request-immutable", base, "immutable");
  await expectCrash(journal.execute(scope, immutableSpec), "after_immutable:0");
  var immutableId = journal.transactionIdFor(scope.mutationScopeKey, immutableSpec.operation, immutableSpec.requestId);
  assert(storage.readArtifact(scope, "evidence/event-immutable.json"), "immutable payload may exist before marker");
  assert.strictEqual(journal.readCommitted(scope, "evidence/event-immutable.json"), null, "marker gates visibility");
  crashPoint = null;
  await journal.recoverTransaction(scope, immutableId);
  assert.strictEqual(journal.readCommitted(scope, "evidence/event-immutable.json").eventId, "event-immutable");

  base = storage.readArtifact(scope, "sessions/session-a.json");
  var prospectiveCalls = 0;
  var prospectiveSpec = spec("request-prospective", base, "prospective");
  await assert.rejects(journal.execute(scope, prospectiveSpec, {
    validateProspective: function () {
      prospectiveCalls += 1;
      var error = new Error("projection mismatch");
      error.code = "prospective_mismatch";
      throw error;
    }
  }), function (error) { return error && error.code === "prospective_mismatch"; });
  var prospectiveId = journal.transactionIdFor(scope.mutationScopeKey, prospectiveSpec.operation, prospectiveSpec.requestId);
  assert.strictEqual(journal.readTransaction(scope, prospectiveId).status, "recovery_failed");
  assert.strictEqual(journal.readCommitted(scope, "evidence/event-prospective.json"), null);
  assert.strictEqual(prospectiveCalls, 1);

  base = storage.readArtifact(scope, "sessions/session-a.json");
  crashPoint = "after_commit_marker";
  var markerSpec = spec("request-marker", base, "marker");
  await expectCrash(journal.execute(scope, markerSpec), "after_commit_marker");
  var markerId = journal.transactionIdFor(scope.mutationScopeKey, markerSpec.operation, markerSpec.requestId);
  var marked = journal.readTransaction(scope, markerId);
  assert.strictEqual(marked.status, "committed");
  assert.strictEqual(marked.materializationStatus, "pending");
  assert.strictEqual(journal.readCommitted(scope, "evidence/event-marker.json").eventId, "event-marker");
  assert.strictEqual(storage.readArtifact(scope, "sessions/session-a.json").revision, base.revision);
  crashPoint = null;
  var markerRecovered = await journal.recoverTransaction(scope, markerId);
  assert.strictEqual(markerRecovered.transaction.materializationStatus, "complete");
  assert.strictEqual(storage.readArtifact(scope, "sessions/session-a.json").revision, base.revision + 1);

  base = storage.readArtifact(scope, "sessions/session-a.json");
  crashPoint = "after_mutable:0";
  var mutableSpec = spec("request-mutable", base, "mutable");
  await expectCrash(journal.execute(scope, mutableSpec), "after_mutable:0");
  var mutableId = journal.transactionIdFor(scope.mutationScopeKey, mutableSpec.operation, mutableSpec.requestId);
  var targetAfterCrash = storage.readArtifact(scope, "sessions/session-a.json");
  assert.strictEqual(targetAfterCrash.revision, base.revision + 1);
  crashPoint = null;
  await journal.recoverTransaction(scope, mutableId);
  assert.strictEqual(storage.readArtifact(scope, "sessions/session-a.json").revision, base.revision + 1, "target CAS is idempotent");

  var replaySpec = spec("request-replay", storage.readArtifact(scope, "sessions/session-a.json"), "replay");
  var initial = await journal.execute(scope, replaySpec);
  var replay = await journal.execute(scope, replaySpec);
  assert.strictEqual(replay.duplicate, true);
  assert.deepStrictEqual(replay.resultPayload, initial.resultPayload);
  assert.strictEqual(storage.listArtifacts(scope, "evidence/event-replay.json").length, 1);
  var conflicting = Object.assign({}, replaySpec, { normalizedRequest: { action: "prepareTurn", message: "changed" } });
  await assert.rejects(journal.execute(scope, conflicting), function (error) { return error && error.code === "idempotency_conflict" && error.status === 409; });

  var current = storage.readArtifact(scope, "sessions/session-a.json");
  var nextSpec = spec("request-next", current, "next");
  await journal.execute(scope, nextSpec);
  assert.strictEqual(storage.readArtifact(scope, "sessions/session-a.json").revision, current.revision + 1, "continuous mutable CAS uses committed base");

  var matrixPoints = ["after_immutable:0", "after_immutable:1", "after_immutable:2", "after_immutable:3", "after_immutable:4", "after_immutable:5", "after_immutable:6", "after_immutable:7", "before_prospective", "after_prospective", "after_commit_marker", "after_mutable:0", "after_mutable:1", "after_mutable:2", "after_mutable:3", "after_materialization"];
  for (var matrixIndex = 0; matrixIndex < matrixPoints.length; matrixIndex += 1) {
    var matrixPoint = matrixPoints[matrixIndex];
    var matrixStorage = createMemoryStorage();
    var matrixScope = Object.assign({}, scope, { mutationScopeKey: "matrix-scope-" + matrixIndex });
    var activePoint = matrixPoint;
    var matrixJournal = journalModule.createJournal({
      storage: matrixStorage,
      clock: function () { return new Date("2026-08-19T08:00:00.000Z"); },
      failureInjector: function (point) { return point === activePoint; }
    });
    var immutableTypes = ["evidence", "scope_locator", "assessment", "decision", "decision_claim", "decision_execution_event", "decision_execution_terminal", "tutor_response"];
    var mutableTypes = ["concept_graph", "concept_state", "review_queue", "session"];
    var matrixArtifacts = immutableTypes.map(function (type, index) {
      return artifact("immutable", type, type + "-" + matrixIndex, "matrix/immutable/" + index + ".json", null, 1, { value: type });
    }).concat(mutableTypes.map(function (type, index) {
      return artifact("mutable", type, type + "-" + matrixIndex, "matrix/mutable/" + index + ".json", null, 1, { value: type });
    }));
    var matrixSpec = {
      operation: "prepareTurn",
      requestId: "matrix-" + matrixIndex,
      mutationScopeKey: matrixScope.mutationScopeKey,
      normalizedRequest: { action: "prepareTurn", matrixIndex: matrixIndex },
      evaluationTime: "2026-08-19T08:00:00.000Z",
      artifacts: matrixArtifacts,
      resultPayload: { ok: true, matrixIndex: matrixIndex }
    };
    await expectCrash(matrixJournal.execute(matrixScope, matrixSpec), matrixPoint);
    activePoint = null;
    var recoveryJournal = journalModule.createJournal({ storage: matrixStorage, clock: function () { return new Date("2026-08-19T08:00:00.000Z"); } });
    await recoveryJournal.recoverScope(matrixScope);
    var matrixId = recoveryJournal.transactionIdFor(matrixScope.mutationScopeKey, matrixSpec.operation, matrixSpec.requestId);
    var matrixTransaction = recoveryJournal.readTransaction(matrixScope, matrixId);
    assert.strictEqual(matrixTransaction.status, "committed", matrixPoint);
    assert.strictEqual(matrixTransaction.materializationStatus, "complete", matrixPoint);
    assert(recoveryJournal.readCommitted(matrixScope, "matrix/immutable/0.json"), matrixPoint + " immutable visible after recovery");
    assert(matrixStorage.readArtifact(matrixScope, "matrix/mutable/3.json"), matrixPoint + " mutable materialized after recovery");
  }

  console.log("PASS: transaction journal crash recovery, visibility, idempotency, CAS, and all write-boundary injection points");
}

run().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
