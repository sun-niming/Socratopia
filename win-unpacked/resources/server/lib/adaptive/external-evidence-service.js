"use strict";

var crypto = require("crypto");
var assessmentEngine = require("./assessment-engine.js");
var evidence = require("./evidence-ledger.js");

function ExternalEvidenceError(code, message, status) {
  Error.call(this, message);
  this.name = "ExternalEvidenceError";
  this.code = code || "external_evidence_error";
  this.status = Number.isInteger(status) ? status : 500;
  this.statusCode = this.status;
  this.message = message || this.code;
  if (Error.captureStackTrace) Error.captureStackTrace(this, ExternalEvidenceError);
}
ExternalEvidenceError.prototype = Object.create(Error.prototype);
ExternalEvidenceError.prototype.constructor = ExternalEvidenceError;

function isRecord(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function sha256(value) { return "sha256:" + crypto.createHash("sha256").update(String(value), "utf8").digest("hex"); }
function canonicalHash(value) { return evidence.hashCanonical(value); }

function boundedString(value, name, maxLength) {
  if (typeof value !== "string") throw new ExternalEvidenceError("invalid_external_evidence", name + " must be a string", 400);
  var normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > maxLength || /[\x00-\x1F\x7F]/.test(normalized)) {
    throw new ExternalEvidenceError("invalid_external_evidence", name + " is outside its allowed bounds", 400);
  }
  return normalized;
}

function optionalString(value, name, maxLength) {
  return value == null || value === "" ? null : boundedString(value, name, maxLength);
}

function normalizeLookup(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function safeCode(error, fallback) {
  var value = error && error.code;
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value) ? value : fallback;
}

function readAuthorization(request) {
  try {
    var value = request && request.headers && request.headers.get("Authorization");
    return typeof value === "string" && value.trim() !== "" ? value : null;
  } catch (_) {
    return null;
  }
}

function createExternalEvidenceService(options) {
  options = options || {};
  var verifier = options.verifier;
  var orchestrator = options.orchestrator || null;
  var accountRequestContext = options.accountRequestContext;
  var getAccountContext = options.getAccountContext;
  var isEligible = options.isEligible;
  if (!verifier || typeof verifier.verifyRequest !== "function" || typeof verifier.assertCurrentContext !== "function") {
    throw new TypeError("external-evidence-service requires verifier.verifyRequest/assertCurrentContext");
  }
  if (!accountRequestContext || typeof accountRequestContext.run !== "function") {
    throw new TypeError("external-evidence-service requires accountRequestContext.run");
  }
  if (typeof getAccountContext !== "function") throw new TypeError("external-evidence-service requires getAccountContext");
  if (typeof isEligible !== "function") throw new TypeError("external-evidence-service requires isEligible");

  var handles = new WeakMap();
  var drafts = new WeakMap();
  var sourceLocks = new Map();

  function error(code, message, status) { return new ExternalEvidenceError(code, message, status); }

  function stateFor(handle) {
    var state = handle && handles.get(handle);
    if (!state) throw error("invalid_external_evidence_handle", "A branded external evidence handle is required", 403);
    return state;
  }

  async function currentAccount(requestContext) {
    verifier.assertCurrentContext(requestContext);
    var account = await getAccountContext({ requestContext: requestContext });
    if (!isRecord(account) || account.active === false || account.accountId !== requestContext.accountId || account.sessionEpoch !== requestContext.sessionEpoch) {
      throw error("auth_account_mismatch", "The current account context changed", 403);
    }
    return account;
  }

  async function readyResult() {
    if (!orchestrator) return { ok: false, code: "adaptive_unavailable" };
    try {
      var value = options.readinessPromise ? await options.readinessPromise : await orchestrator.awaitReady();
      return value && value.ok === true ? value : { ok: false, code: value && value.code || "adaptive_unavailable" };
    } catch (failure) {
      return { ok: false, code: safeCode(failure, "adaptive_unavailable") };
    }
  }

  function accountBindingHash(accountId) {
    return sha256("socratopia:external-evidence:account:v1\u0000" + accountId);
  }

  async function authorizeRequest(request, input) {
    if (!isRecord(input)) throw error("invalid_external_evidence", "request body is required", 400);
    var first = await verifier.verifyRequest(request, input);
    await currentAccount(first);
    var eligible = false;
    var inactiveReason = null;
    try {
      var value = await isEligible({ requestContext: first, request: request, input: input });
      eligible = value === true || isRecord(value) && value.eligible === true;
      if (!eligible) inactiveReason = "adaptive_not_eligible";
    } catch (eligibilityFailure) {
      if (safeCode(eligibilityFailure, "") !== "adaptive_not_eligible") throw eligibilityFailure;
      inactiveReason = "adaptive_not_eligible";
    }

    var requestContext = first;
    if (eligible) {
      var readiness = await readyResult();
      if (!readiness.ok) {
        eligible = false;
        inactiveReason = readiness.code || "adaptive_unavailable";
      } else {
        requestContext = await verifier.verifyRequest(request, input);
        if (requestContext.accountId !== first.accountId || requestContext.sessionEpoch !== first.sessionEpoch) {
          throw error("auth_epoch_mismatch", "The account context changed during readiness", 403);
        }
        await currentAccount(requestContext);
      }
    }

    var handle = Object.freeze(Object.create(null));
    handles.set(handle, {
      requestContext: requestContext,
      accountId: requestContext.accountId,
      sessionEpoch: requestContext.sessionEpoch,
      accountBindingHash: accountBindingHash(requestContext.accountId),
      active: eligible && !!orchestrator,
      inactiveReason: eligible && orchestrator ? null : inactiveReason || "adaptive_unavailable",
      serviceContext: eligible && orchestrator ? orchestrator.createServiceContext(requestContext) : null
    });
    return handle;
  }

  async function assertLive(state) {
    verifier.assertCurrentContext(state.requestContext);
    await currentAccount(state.requestContext);
  }

  async function runAuthorized(handle, callback) {
    var state = stateFor(handle);
    if (typeof callback !== "function") throw error("invalid_external_evidence", "authorized callback is required", 500);
    await assertLive(state);
    return accountRequestContext.run(state.accountId, callback);
  }

  function statusForHandle(handle) {
    var state = stateFor(handle);
    return Object.freeze({ active: state.active, reasonCode: state.inactiveReason });
  }

  function sourceLockKey(state, binding) {
    if (!isRecord(binding)) throw error("invalid_external_evidence", "source lock binding is required", 400);
    return canonicalHash({
      schemaVersion: 1,
      accountBindingHash: state.accountBindingHash,
      profileId: boundedString(binding.profileId, "profileId", 128),
      worldId: boundedString(binding.worldId, "worldId", 128),
      textbookId: boundedString(binding.textbookId, "textbookId", 128),
      source: boundedString(binding.source, "source", 32),
      itemId: boundedString(binding.itemId, "itemId", 256)
    });
  }

  function withSourceLock(handle, binding, callback) {
    var state = stateFor(handle);
    if (typeof callback !== "function") return Promise.reject(error("invalid_external_evidence", "source lock callback is required", 500));
    var key = sourceLockKey(state, binding);
    var previous = sourceLocks.get(key) || Promise.resolve();
    var run = previous.then(async function () {
      await assertLive(state);
      return accountRequestContext.run(state.accountId, callback);
    });
    var tail = run.then(function () {}, function () {});
    sourceLocks.set(key, tail);
    tail.finally(function () { if (sourceLocks.get(key) === tail) sourceLocks.delete(key); });
    return run;
  }

  function graphFor(state, scopeInput) {
    if (!orchestrator || !orchestrator.storage || !orchestrator.journal) return null;
    var scope = orchestrator.storage.resolveScope({
      accountId: state.accountId,
      profileId: scopeInput.profileId,
      worldId: scopeInput.worldId,
      textbookId: scopeInput.textbookId
    });
    var key = "textbooks/" + scope.storageTextbookId + "/concept-graph.json";
    return orchestrator.journal.readCommitted(scope, key);
  }

  function resolveConcept(state, scopeInput, explicitConceptId, candidates) {
    var graph = graphFor(state, scopeInput);
    var concepts = Array.isArray(graph && graph.concepts) ? graph.concepts : [];
    if (!concepts.length) return { status: "missing", conceptId: null, resolverVersion: "external-concept-resolver-v1" };
    var byLookup = new Map();
    concepts.forEach(function (concept) {
      var conceptId = concept && (concept.conceptId || concept.id);
      if (typeof conceptId !== "string" || !conceptId) return;
      [conceptId, concept.title].concat(Array.isArray(concept.aliases) ? concept.aliases : []).forEach(function (value) {
        var key = normalizeLookup(value);
        if (!key) return;
        var matches = byLookup.get(key) || new Set();
        matches.add(conceptId);
        byLookup.set(key, matches);
      });
    });
    var lookups = [];
    if (explicitConceptId) lookups.push(explicitConceptId);
    (Array.isArray(candidates) ? candidates : []).forEach(function (value) {
      if (typeof value === "string" && value.trim()) lookups.push(value);
    });
    var found = new Set();
    lookups.forEach(function (value) {
      var matches = byLookup.get(normalizeLookup(value));
      if (matches) matches.forEach(function (conceptId) { found.add(conceptId); });
    });
    return {
      status: found.size === 1 ? "resolved" : found.size > 1 ? "ambiguous" : "missing",
      conceptId: found.size === 1 ? Array.from(found)[0] : null,
      resolverVersion: "external-concept-resolver-v1"
    };
  }

  function normalizedAssessment(spec, conceptId) {
    var provenance = spec.answerKeyProvenance || "llm_generated";
    var answerKey = spec.answerKey;
    if (provenance === "llm_generated") {
      answerKey = { redacted: true, contentHash: canonicalHash({ answerKey: answerKey }) };
    }
    return assessmentEngine.normalizeAssessment({
      schemaVersion: 1,
      assessmentId: "pending",
      assessmentVersion: spec.assessmentVersion || "external-assessment-v1",
      conceptId: conceptId || "unresolved",
      questionType: spec.questionType || "short_answer",
      scoringMode: "external_deterministic",
      answerKey: answerKey,
      answerKeyProvenance: provenance,
      answerKeyValidationStatus: spec.answerKeyValidationStatus || "unverified",
      validatorType: spec.validatorType || "none",
      validatorVersion: spec.validatorVersion || "none",
      graderVersion: spec.graderVersion || "external-evidence-v1",
      sourceRefs: Array.isArray(spec.sourceRefs) ? clone(spec.sourceRefs) : [],
      scoringRules: isRecord(spec.scoringRules) ? clone(spec.scoringRules) : {},
      solver: isRecord(spec.solver) ? clone(spec.solver) : undefined,
      humanVerification: isRecord(spec.humanVerification) ? clone(spec.humanVerification) : undefined,
      externalContract: isRecord(spec.externalContract) ? clone(spec.externalContract) : undefined
    });
  }

  function prepareObservation(handle, spec) {
    var state = stateFor(handle);
    if (!state.active) return null;
    if (!isRecord(spec)) throw error("invalid_external_evidence", "observation spec is required", 400);
    var source = boundedString(spec.source, "source", 32);
    if (source !== "practice" && source !== "flashcard") throw error("invalid_external_evidence", "source must be practice or flashcard", 400);
    var scope = {
      profileId: boundedString(spec.profileId, "profileId", 128),
      worldId: boundedString(spec.worldId, "worldId", 128),
      textbookId: boundedString(spec.textbookId, "textbookId", 128)
    };
    var itemId = boundedString(spec.itemId, "itemId", 256);
    var candidates = (Array.isArray(spec.conceptCandidates) ? spec.conceptCandidates : []).filter(function (value) {
      return typeof value === "string" && value.trim() && value.length <= 256;
    }).slice(0, 16).map(function (value) { return value.normalize("NFC").trim(); });
    var explicitConceptId = optionalString(spec.conceptId, "conceptId", 256);
    var conceptResolution = resolveConcept(state, scope, explicitConceptId, candidates);
    var draft = Object.freeze(Object.create(null));
    drafts.set(draft, {
      source: source,
      scope: scope,
      itemId: itemId,
      subItemId: optionalString(spec.subItemId, "subItemId", 256),
      gradingMode: spec.gradingMode === "llm_assisted" ? "llm_assisted" : "deterministic",
      conceptCandidates: candidates,
      explicitConceptId: explicitConceptId,
      conceptResolution: conceptResolution,
      assessment: normalizedAssessment(spec, conceptResolution.conceptId),
      externalResult: {
        outcome: spec.outcome === "correct" ? "correct" : spec.outcome === "incorrect" ? "incorrect" : "unknown",
        graderVersion: spec.graderVersion || "external-evidence-v1",
        contractVerified: spec.contractVerified === true
      },
      evidenceType: ["basic", "transfer", "misconception", "retention"].indexOf(spec.evidenceType) >= 0 ? spec.evidenceType : "basic",
      assistanceLevel: ["none", "light", "heavy"].indexOf(spec.assistanceLevel) >= 0 ? spec.assistanceLevel : "heavy"
    });
    return draft;
  }

  function eventInput(state, payload) {
    var scored = assessmentEngine.scoreExternalAssessment(payload.assessment, payload.externalResult);
    return {
      accountId: state.accountId,
      profileId: payload.profileId,
      worldId: payload.worldId,
      textbookId: payload.textbookId,
      source: payload.source,
      sourceEventId: payload.sourceEventId,
      conceptId: payload.conceptId,
      evidenceType: payload.evidenceType,
      assistanceLevel: payload.assistanceLevel,
      scoringResult: scored,
      assessment: payload.assessment
    };
  }

  function resolvedPayload(state, basePayload, conceptResolution) {
    var payload = clone(basePayload);
    payload.conceptId = conceptResolution.conceptId;
    payload.assessment.conceptId = conceptResolution.conceptId;
    payload.eventInputHash = evidence.deriveEventInputHash(eventInput(state, payload));
    payload.requestId = "external_" + canonicalHash({
      accountBindingHash: state.accountBindingHash,
      sourceEventId: payload.sourceEventId,
      eventInputHash: payload.eventInputHash
    }).slice("sha256:".length, "sha256:".length + 48);
    return payload;
  }

  function finalizeObservation(handle, draft, meta) {
    var state = stateFor(handle);
    var value = draft && drafts.get(draft);
    if (!value || !isRecord(meta)) throw error("invalid_external_evidence", "branded draft and commit metadata are required", 400);
    if (!Number.isSafeInteger(meta.domainRevision) || meta.domainRevision < 1) throw error("invalid_external_evidence", "domainRevision is invalid", 400);
    if (!isRecord(meta.businessReceipt)) throw error("invalid_external_evidence", "businessReceipt is required", 400);
    var createdAt = boundedString(meta.createdAt, "createdAt", 64);
    var businessReceipt = clone(meta.businessReceipt);
    if (!businessReceipt.businessReceiptHash) businessReceipt.businessReceiptHash = canonicalHash(businessReceipt);
    var sourceEventId = canonicalHash({
      schemaVersion: 1,
      accountBindingHash: state.accountBindingHash,
      profileId: value.scope.profileId,
      worldId: value.scope.worldId,
      textbookId: value.scope.textbookId,
      source: value.source,
      itemId: value.itemId,
      subItemId: value.subItemId,
      domainRevision: meta.domainRevision
    });
    var assessment = clone(value.assessment);
    assessment.assessmentId = "external_assessment_" + sourceEventId.slice("sha256:".length, "sha256:".length + 32);
    var payload = {
      profileId: value.scope.profileId,
      worldId: value.scope.worldId,
      textbookId: value.scope.textbookId,
      source: value.source,
      sourceEventId: sourceEventId,
      conceptId: value.conceptResolution.conceptId,
      assessment: assessment,
      externalResult: clone(value.externalResult),
      evidenceType: value.evidenceType,
      assistanceLevel: value.assistanceLevel
    };
    var eventInputHash = null;
    if (value.gradingMode === "deterministic" && value.conceptResolution.status === "resolved") {
      payload = resolvedPayload(state, payload, value.conceptResolution);
      eventInputHash = payload.eventInputHash;
    }
    var observationInputHash = canonicalHash({
      schemaVersion: 1,
      accountBindingHash: state.accountBindingHash,
      source: value.source,
      scope: value.scope,
      itemId: value.itemId,
      subItemId: value.subItemId,
      domainRevision: meta.domainRevision,
      conceptCandidates: value.conceptCandidates,
      explicitConceptId: value.explicitConceptId,
      gradingMode: value.gradingMode,
      assessment: assessment,
      externalResult: value.externalResult,
      evidenceType: value.evidenceType,
      assistanceLevel: value.assistanceLevel,
      businessReceipt: businessReceipt,
      createdAt: createdAt
    });
    var initialState = value.gradingMode === "llm_assisted" ? "unverified" : "pending";
    var initialReason = value.gradingMode === "llm_assisted"
      ? "llm_assisted_unverified"
      : value.conceptResolution.status === "resolved" ? null : "concept_mapping_" + value.conceptResolution.status;
    return {
      schemaVersion: 1,
      source: value.source,
      sourceEventId: sourceEventId,
      domainRevision: meta.domainRevision,
      accountBindingHash: state.accountBindingHash,
      conceptCandidates: value.conceptCandidates.slice(),
      explicitConceptId: value.explicitConceptId,
      conceptResolution: clone(value.conceptResolution),
      gradingMode: value.gradingMode,
      observationInputHash: observationInputHash,
      eventInputHash: eventInputHash,
      payload: payload,
      businessReceipt: businessReceipt,
      createdAt: createdAt,
      sync: {
        state: initialState,
        attempts: 0,
        lastReasonCode: initialReason,
        updatedAt: createdAt
      }
    };
  }

  function validateIntent(state, intent) {
    if (!isRecord(intent) || intent.schemaVersion !== 1) throw error("invalid_external_evidence", "pending intent is invalid", 400);
    if (intent.accountBindingHash !== state.accountBindingHash) throw error("auth_account_mismatch", "pending intent belongs to another account", 403);
    boundedString(intent.sourceEventId, "sourceEventId", 128);
    boundedString(intent.observationInputHash, "observationInputHash", 128);
    if (!isRecord(intent.payload) || !isRecord(intent.sync)) throw error("invalid_external_evidence", "pending payload is invalid", 400);
  }

  function resolvePendingIntent(state, intent) {
    var copy = clone(intent);
    if (copy.gradingMode === "llm_assisted") return copy;
    if (copy.conceptResolution && copy.conceptResolution.status === "resolved" && copy.eventInputHash) return copy;
    var scope = {
      profileId: copy.payload.profileId,
      worldId: copy.payload.worldId,
      textbookId: copy.payload.textbookId
    };
    var resolution = resolveConcept(state, scope, copy.explicitConceptId, copy.conceptCandidates);
    copy.conceptResolution = resolution;
    if (resolution.status === "resolved") {
      copy.payload = resolvedPayload(state, copy.payload, resolution);
      copy.eventInputHash = copy.payload.eventInputHash;
    }
    return copy;
  }

  async function recordPending(handle, pendingIntent) {
    var state = stateFor(handle);
    validateIntent(state, pendingIntent);
    if (!state.active) return { state: "retryable", reasonCode: state.inactiveReason || "adaptive_unavailable" };
    if (pendingIntent.gradingMode === "llm_assisted") return { state: "unverified", reasonCode: "llm_assisted_unverified" };
    var intent = resolvePendingIntent(state, pendingIntent);
    if (!intent.conceptResolution || intent.conceptResolution.status !== "resolved") {
      return {
        state: "pending",
        reasonCode: "concept_mapping_" + (intent.conceptResolution && intent.conceptResolution.status || "missing"),
        intentPatch: { conceptResolution: intent.conceptResolution }
      };
    }
    await assertLive(state);
    try {
      var result = await orchestrator.recordExternalEvidence(intent.payload, state.serviceContext);
      var scoring = assessmentEngine.scoreExternalAssessment(intent.payload.assessment, intent.payload.externalResult);
      return {
        state: result && result.duplicateEvidence ? "duplicate" : scoring.verificationStatus === "verified" ? "committed" : "unverified",
        reasonCode: scoring.verificationStatus === "verified" ? null : "answer_key_unverified",
        intentPatch: {
          conceptResolution: intent.conceptResolution,
          eventInputHash: intent.eventInputHash,
          payload: intent.payload
        }
      };
    } catch (failure) {
      var code = safeCode(failure, "external_evidence_failed");
      if (code === "evidence_conflict") return { state: "conflict", reasonCode: code };
      return { state: "retryable", reasonCode: code };
    }
  }

  function publicSyncResult(result) {
    var state = result && result.state;
    var allowed = ["committed", "duplicate", "unverified", "pending", "retryable", "conflict"];
    if (allowed.indexOf(state) < 0) state = "retryable";
    return Object.freeze({
      adaptiveSyncStatus: state === "unverified" ? "unverified_committed" : state,
      adaptiveSyncReason: result && typeof result.reasonCode === "string" && /^[a-z0-9_]{1,64}$/.test(result.reasonCode) ? result.reasonCode : null
    });
  }

  return Object.freeze({
    hasAuthorization: function (request) { return !!readAuthorization(request); },
    authorizeRequest: authorizeRequest,
    runAuthorized: runAuthorized,
    statusForHandle: statusForHandle,
    bindingForHandle: function (handle) { return stateFor(handle).accountBindingHash; },
    withSourceLock: withSourceLock,
    prepareObservation: prepareObservation,
    finalizeObservation: finalizeObservation,
    recordPending: recordPending,
    retryPending: recordPending,
    publicSyncResult: publicSyncResult
  });
}

module.exports = {
  ExternalEvidenceError: ExternalEvidenceError,
  createExternalEvidenceService: createExternalEvidenceService
};
