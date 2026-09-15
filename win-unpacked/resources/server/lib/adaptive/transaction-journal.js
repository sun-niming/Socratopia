"use strict";

var crypto = require("crypto");

function JournalError(code, message, status, details) {
  Error.call(this, message);
  this.name = "JournalError";
  this.code = code || "journal_error";
  this.status = status || 500;
  this.message = message || this.code;
  if (details) this.details = details;
  if (Error.captureStackTrace) Error.captureStackTrace(this, JournalError);
}
JournalError.prototype = Object.create(Error.prototype);
JournalError.prototype.constructor = JournalError;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    var output = {};
    Object.keys(value).sort().forEach(function (key) {
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    });
    return output;
  }
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number" && !Number.isFinite(value)) throw new JournalError("invalid_number", "Canonical JSON cannot contain a non-finite number", 400);
  return value;
}

function canonicalJson(value) { return JSON.stringify(stableValue(value)); }
function hashCanonical(value) { return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }
function payloadForHash(value) {
  var copy = {};
  Object.keys(value || {}).forEach(function (key) { if (key !== "payloadHash") copy[key] = value[key]; });
  return copy;
}
function payloadHash(value) { return hashCanonical(payloadForHash(value || {})); }

function safeId(value, label) {
  value = String(value || "").normalize("NFC");
  if (!value || value.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new JournalError("invalid_id", (label || "id") + " is invalid", 400);
  }
  return value;
}

function transactionIdFor(mutationScopeKey, operation, requestId) {
  safeId(operation, "operation");
  safeId(requestId, "requestId");
  return "tx_" + hashCanonical([String(mutationScopeKey || ""), operation, requestId]).slice(0, 40);
}

function transactionKey(transactionId) { return "transactions/" + safeId(transactionId, "transactionId") + ".json"; }

function createJournal(options) {
  options = options || {};
  var storage = options.storage;
  if (!storage) throw new TypeError("createJournal requires storage");
  ["readArtifact", "writeArtifactAtomic", "listArtifacts"].forEach(function (name) {
    if (typeof storage[name] !== "function") throw new TypeError("storage." + name + " is required");
  });
  var clock = typeof options.clock === "function" ? options.clock : function () { return new Date(); };
  var failureInjector = typeof options.failureInjector === "function" ? options.failureInjector : null;

  function nowIso() {
    var value = clock();
    value = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(value.getTime())) throw new JournalError("invalid_clock", "Clock returned an invalid time", 500);
    return value.toISOString();
  }

  function inject(point, context) {
    if (!failureInjector) return;
    var result = failureInjector(point, context || {});
    if (result === true) {
      var error = new JournalError("injected_crash", "Injected crash at " + point, 500, { point: point });
      error.isInjectedCrash = true;
      throw error;
    }
  }

  function readTransaction(scope, transactionId) {
    return storage.readArtifact(scope, transactionKey(transactionId));
  }

  function writeTransaction(scope, transaction) {
    transaction.updatedAt = nowIso();
    storage.writeArtifactAtomic(scope, transactionKey(transaction.transactionId), transaction);
    return transaction;
  }

  function baseMatches(current, artifact) {
    if (artifact.expectedBaseRevision === "ABSENT" || artifact.expectedBasePayloadHash === "ABSENT") return current == null;
    if (!current) return false;
    return Number(current.revision) === Number(artifact.expectedBaseRevision) && payloadHash(current) === artifact.expectedBasePayloadHash;
  }

  function targetMatches(current, artifact) {
    return !!current && Number(current.revision) === Number(artifact.targetRevision) && payloadHash(current) === artifact.payloadHash && current.producingTransactionId === artifact.payload.producingTransactionId;
  }

  function normalizeArtifact(transactionId, raw, index) {
    raw = raw || {};
    var kind = raw.artifactKind;
    if (kind !== "immutable" && kind !== "mutable") throw new JournalError("invalid_write_set", "artifactKind must be immutable or mutable", 400, { index: index });
    var artifactType = safeId(raw.artifactType, "artifactType");
    var immutableTypes = { evidence: true, scope_locator: true, assessment: true, decision: true, decision_claim: true, decision_execution_event: true, decision_execution_terminal: true, tutor_response: true };
    var mutableTypes = { concept_graph: true, concept_state: true, review_queue: true, session: true };
    var expectedKind = immutableTypes[artifactType] ? "immutable" : mutableTypes[artifactType] ? "mutable" : null;
    if (!expectedKind || expectedKind !== kind) throw new JournalError("invalid_write_set", "artifactType has an invalid Stage A classification", 400, { index: index, artifactType: artifactType, artifactKind: kind });
    var storageKey = String(raw.storageKey || "").replace(/\\/g, "/");
    if (!storageKey || storageKey[0] === "/" || storageKey.indexOf("../") >= 0 || storageKey.indexOf("/..") >= 0 || /^[A-Za-z]:/.test(storageKey)) {
      throw new JournalError("invalid_storage_key", "write set contains an unsafe storageKey", 400, { index: index });
    }
    var value = stableValue(Object.assign({}, raw.payload || {}, { producingTransactionId: transactionId }));
    var targetRevision = Number(raw.targetRevision);
    if (!Number.isInteger(targetRevision) || targetRevision < 1) throw new JournalError("invalid_revision", "targetRevision must be a positive integer", 400, { index: index });
    if (value.revision == null) value.revision = targetRevision;
    if (Number(value.revision) !== targetRevision) throw new JournalError("invalid_revision", "payload revision must equal targetRevision", 400, { index: index });
    var computedHash = payloadHash(value);
    if (raw.payloadHash && raw.payloadHash !== computedHash) throw new JournalError("payload_hash_mismatch", "Artifact payload hash is invalid", 400, { index: index });
    value.payloadHash = "sha256:" + computedHash;
    return {
      artifactType: artifactType,
      artifactKind: kind,
      artifactId: safeId(raw.artifactId, "artifactId"),
      storageKey: storageKey,
      expectedBaseRevision: raw.expectedBaseRevision == null ? "ABSENT" : raw.expectedBaseRevision,
      expectedBasePayloadHash: raw.expectedBasePayloadHash == null ? "ABSENT" : raw.expectedBasePayloadHash,
      targetRevision: targetRevision,
      payloadHash: computedHash,
      payload: value,
    };
  }

  function buildPrepared(scope, spec) {
    spec = spec || {};
    var operation = safeId(spec.operation, "operation");
    var requestId = safeId(spec.requestId, "requestId");
    var mutationScopeKey = String(spec.mutationScopeKey || "");
    if (!mutationScopeKey) throw new JournalError("missing_scope", "mutationScopeKey is required", 400);
    var transactionId = spec.transactionId || transactionIdFor(mutationScopeKey, operation, requestId);
    safeId(transactionId, "transactionId");
    var requestHash = spec.requestHash || hashCanonical(spec.normalizedRequest || {});
    var evaluationTime = spec.evaluationTime || nowIso();
    if (!Number.isFinite(new Date(evaluationTime).getTime())) throw new JournalError("invalid_evaluation_time", "evaluationTime is invalid", 400);
    var artifacts = (spec.artifacts || []).map(function (artifact, index) { return normalizeArtifact(transactionId, artifact, index); });
    artifacts.sort(function (left, right) {
      return left.storageKey.localeCompare(right.storageKey) || left.artifactType.localeCompare(right.artifactType) || left.artifactId.localeCompare(right.artifactId);
    });
    var keys = Object.create(null);
    artifacts.forEach(function (artifact) {
      if (keys[artifact.storageKey]) throw new JournalError("duplicate_storage_key", "write set contains duplicate storageKey", 400, { storageKey: artifact.storageKey });
      keys[artifact.storageKey] = true;
    });
    var resultPayload = stableValue(Object.assign({}, spec.resultPayload || {}, { evaluationTime: evaluationTime }));
    var createdAt = nowIso();
    return {
      schemaVersion: 1,
      transactionId: transactionId,
      requestId: requestId,
      requestHash: requestHash,
      evaluationTime: evaluationTime,
      operation: operation,
      status: "prepared",
      accountId: scope.accountId,
      profileId: scope.profileId,
      worldId: scope.worldId,
      textbookId: scope.textbookId,
      mutationScopeKey: mutationScopeKey,
      sessionId: spec.sessionId || null,
      turnId: spec.turnId || null,
      baseRevisions: stableValue(spec.baseRevisions || {}),
      writeSet: { artifacts: artifacts },
      writeSetHash: hashCanonical(artifacts),
      committedSnapshotHash: spec.committedSnapshotHash || null,
      prospectiveLedgerHash: spec.prospectiveLedgerHash || null,
      targetProjectionHash: spec.targetProjectionHash || null,
      appliedSteps: [],
      resultPayload: resultPayload,
      resultPayloadHash: hashCanonical(resultPayload),
      materializationStatus: "pending",
      createdAt: createdAt,
      updatedAt: createdAt,
      committedAt: null,
      materializedAt: null,
    };
  }

  function validateDurableTransaction(transaction) {
    if (!transaction || transaction.schemaVersion !== 1) throw new JournalError("invalid_transaction", "Transaction schema is invalid", 500);
    if (hashCanonical(transaction.writeSet.artifacts) !== transaction.writeSetHash) throw new JournalError("write_set_hash_mismatch", "Durable transaction write set hash is invalid", 500);
    if (hashCanonical(transaction.resultPayload) !== transaction.resultPayloadHash) throw new JournalError("result_hash_mismatch", "Durable transaction result hash is invalid", 500);
    transaction.writeSet.artifacts.forEach(function (artifact) {
      if (payloadHash(artifact.payload) !== artifact.payloadHash) throw new JournalError("payload_hash_mismatch", "Durable artifact payload hash is invalid", 500, { storageKey: artifact.storageKey });
    });
    return transaction;
  }

  function applyImmutable(scope, transaction) {
    var immutable = transaction.writeSet.artifacts.filter(function (artifact) { return artifact.artifactKind === "immutable"; });
    immutable.forEach(function (artifact, index) {
      var current = storage.readArtifact(scope, artifact.storageKey);
      if (targetMatches(current, artifact)) return;
      if (current) throw new JournalError("immutable_conflict", "Immutable artifact already exists with different content", 409, { storageKey: artifact.storageKey });
      storage.writeArtifactAtomic(scope, artifact.storageKey, artifact.payload);
      var written = storage.readArtifact(scope, artifact.storageKey);
      if (!targetMatches(written, artifact)) throw new JournalError("immutable_apply_failed", "Immutable artifact did not verify after write", 500, { storageKey: artifact.storageKey });
      transaction.appliedSteps.push({ storageKey: artifact.storageKey, artifactType: artifact.artifactType, artifactId: artifact.artifactId, payloadHash: artifact.payloadHash, appliedAt: nowIso() });
      writeTransaction(scope, transaction);
      inject("after_immutable:" + index, { transaction: transaction, artifact: artifact });
    });
  }

  function validateMutableBases(scope, transaction) {
    transaction.writeSet.artifacts.filter(function (artifact) { return artifact.artifactKind === "mutable"; }).forEach(function (artifact) {
      var current = storage.readArtifact(scope, artifact.storageKey);
      if (!baseMatches(current, artifact)) throw new JournalError("mutable_cas_conflict", "Mutable artifact base revision/hash changed before commit", 409, { storageKey: artifact.storageKey });
    });
  }

  function materializeMutable(scope, transaction) {
    var mutable = transaction.writeSet.artifacts.filter(function (artifact) { return artifact.artifactKind === "mutable"; });
    mutable.forEach(function (artifact, index) {
      var current = storage.readArtifact(scope, artifact.storageKey);
      if (targetMatches(current, artifact)) return;
      if (!baseMatches(current, artifact)) throw new JournalError("mutable_cas_conflict", "Mutable artifact base revision/hash changed", 409, { storageKey: artifact.storageKey });
      storage.writeArtifactAtomic(scope, artifact.storageKey, artifact.payload);
      var written = storage.readArtifact(scope, artifact.storageKey);
      if (!targetMatches(written, artifact)) throw new JournalError("materialization_failed", "Mutable artifact did not verify after write", 500, { storageKey: artifact.storageKey });
      transaction.appliedSteps.push({ storageKey: artifact.storageKey, artifactType: artifact.artifactType, artifactId: artifact.artifactId, payloadHash: artifact.payloadHash, appliedAt: nowIso() });
      writeTransaction(scope, transaction);
      inject("after_mutable:" + index, { transaction: transaction, artifact: artifact });
    });
    transaction.materializationStatus = "complete";
    transaction.materializedAt = transaction.materializedAt || nowIso();
    writeTransaction(scope, transaction);
    inject("after_materialization", { transaction: transaction });
  }

  async function finish(scope, transaction, hooks) {
    hooks = hooks || {};
    validateDurableTransaction(transaction);
    if (transaction.status === "committed") {
      if (transaction.materializationStatus !== "complete") materializeMutable(scope, transaction);
      return { transaction: transaction, resultPayload: transaction.resultPayload, duplicate: true };
    }
    transaction.status = "applying";
    writeTransaction(scope, transaction);
    applyImmutable(scope, transaction);
    validateMutableBases(scope, transaction);
    inject("before_prospective", { transaction: transaction });
    if (typeof hooks.validateProspective === "function") await hooks.validateProspective(transaction);
    inject("after_prospective", { transaction: transaction });
    transaction.status = "committed";
    transaction.committedAt = transaction.committedAt || nowIso();
    writeTransaction(scope, transaction);
    inject("after_commit_marker", { transaction: transaction });
    materializeMutable(scope, transaction);
    return { transaction: transaction, resultPayload: transaction.resultPayload, duplicate: false };
  }

  async function execute(scope, spec, hooks) {
    var expectedId = spec.transactionId || transactionIdFor(spec.mutationScopeKey, spec.operation, spec.requestId);
    var existing = readTransaction(scope, expectedId);
    if (existing) {
      validateDurableTransaction(existing);
      var candidateHash = spec.requestHash || hashCanonical(spec.normalizedRequest || {});
      if (existing.requestHash !== candidateHash) throw new JournalError("idempotency_conflict", "requestId was already used with different business input", 409);
      return finish(scope, existing, hooks);
    }
    var prepared = buildPrepared(scope, Object.assign({}, spec, { transactionId: expectedId }));
    storage.writeArtifactAtomic(scope, transactionKey(expectedId), prepared);
    inject("after_prepare", { transaction: prepared });
    try {
      return await finish(scope, prepared, hooks);
    } catch (error) {
      if (error && error.isInjectedCrash) throw error;
      var durable = readTransaction(scope, expectedId);
      if (durable && durable.status !== "committed") {
        durable.status = "recovery_failed";
        durable.recoveryError = { code: error && error.code || "recovery_failed", message: error && error.message || String(error) };
        try { writeTransaction(scope, durable); } catch (_) {}
      }
      throw error;
    }
  }

  async function recoverTransaction(scope, transactionId, hooks) {
    var transaction = readTransaction(scope, transactionId);
    if (!transaction) throw new JournalError("transaction_not_found", "Transaction was not found", 404);
    if (transaction.status === "aborted") throw new JournalError("transaction_aborted", "Transaction was aborted", 409);
    if (transaction.status === "recovery_failed") {
      transaction.status = "prepared";
      delete transaction.recoveryError;
      writeTransaction(scope, transaction);
    }
    return finish(scope, transaction, hooks);
  }

  async function recoverScope(scope, hooks) {
    var entries = storage.listArtifacts(scope, "transactions/") || [];
    var transactions = entries.map(function (entry) { return entry.value || entry; }).filter(function (value) {
      return value && value.schemaVersion === 1 && value.transactionId;
    }).sort(function (left, right) {
      return String(left.createdAt || "").localeCompare(String(right.createdAt || "")) || String(left.transactionId).localeCompare(String(right.transactionId));
    });
    var results = [];
    for (var index = 0; index < transactions.length; index++) {
      var transaction = transactions[index];
      if (transaction.status === "aborted") continue;
      if (transaction.status !== "committed" || transaction.materializationStatus !== "complete") {
        results.push(await recoverTransaction(scope, transaction.transactionId, hooks));
      }
    }
    return results;
  }

  function isCommitted(scope, transactionId) {
    var transaction = readTransaction(scope, transactionId);
    return !!transaction && transaction.status === "committed";
  }

  function readCommitted(scope, storageKey) {
    var value = storage.readArtifact(scope, storageKey);
    if (!value || !value.producingTransactionId) return null;
    return isCommitted(scope, value.producingTransactionId) ? value : null;
  }

  return {
    execute: execute,
    recoverTransaction: recoverTransaction,
    recoverScope: recoverScope,
    readTransaction: readTransaction,
    readCommitted: readCommitted,
    isCommitted: isCommitted,
    transactionIdFor: transactionIdFor,
  };
}

module.exports = {
  JournalError: JournalError,
  canonicalJson: canonicalJson,
  hashCanonical: hashCanonical,
  payloadHash: payloadHash,
  transactionIdFor: transactionIdFor,
  createJournal: createJournal,
};
