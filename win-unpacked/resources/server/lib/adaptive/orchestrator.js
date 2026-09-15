"use strict";

var crypto = require("crypto");
var authModule = require("../local-request-auth.js");
var storageModule = require("./storage-v2.js");
var journalModule = require("./transaction-journal.js");
var evidenceModule = require("./evidence-ledger.js");
var masteryModule = require("./mastery-engine.js");
var policyModule = require("./policy-engine.js");
var assessmentModule = require("./assessment-engine.js");
var defaultBuilder = require("./concept-graph-builder.js");
var defaultDiagnostician = require("./diagnostician.js");

function OrchestratorError(code, message, status, details) {
  Error.call(this, message);
  this.name = "OrchestratorError";
  this.code = code || "adaptive_error";
  this.status = status || 500;
  this.message = message || this.code;
  if (details) this.details = details;
  if (Error.captureStackTrace) Error.captureStackTrace(this, OrchestratorError);
}
OrchestratorError.prototype = Object.create(Error.prototype);
OrchestratorError.prototype.constructor = OrchestratorError;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function hash(value) { return journalModule.hashCanonical(value); }
function stableId(prefix, value) { return prefix + "_" + hash(value).slice(0, 32); }
function iso(value) {
  var date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new OrchestratorError("invalid_time", "Clock returned an invalid time", 500);
  return date.toISOString();
}
function requiredString(value, name) {
  if (typeof value !== "string" || !value.normalize("NFC").trim()) throw new OrchestratorError("invalid_request", name + " is required", 400);
  return value.normalize("NFC");
}
function requestId(value) {
  var id = requiredString(value, "requestId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(id)) throw new OrchestratorError("invalid_request", "requestId is invalid", 400);
  return id;
}
function storageId(value, name) { return storageModule.safeSegment(requiredString(value, name), name); }

function executionContractString(value, name, maxLength) {
  if (typeof value !== "string") throw new OrchestratorError("invalid_execution_contract", name + " must be a string", 500);
  var normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    throw new OrchestratorError("invalid_execution_contract", name + " is outside its allowed bounds", 500);
  }
  return normalized;
}

function executionContractEnum(value, name, allowed) {
  if (allowed.indexOf(value) < 0) throw new OrchestratorError("invalid_execution_contract", name + " is invalid", 500);
  return value;
}

function executionContractView(decision) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) throw new OrchestratorError("invalid_execution_contract", "Committed decision is invalid", 500);
  var reasonCodes = decision.reasonCodes;
  if (!Array.isArray(reasonCodes) || reasonCodes.length < 1 || reasonCodes.length > 16) {
    throw new OrchestratorError("invalid_execution_contract", "reasonCodes are invalid", 500);
  }
  reasonCodes = reasonCodes.map(function (code) {
    var value = executionContractString(code, "reasonCode", 64);
    if (!/^[A-Z0-9][A-Z0-9_:-]*$/.test(value)) throw new OrchestratorError("invalid_execution_contract", "reasonCode is invalid", 500);
    return value;
  });
  var source = decision.tutorContract;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new OrchestratorError("invalid_execution_contract", "tutorContract is invalid", 500);
  if (!Array.isArray(source.forbiddenMoves) || source.forbiddenMoves.length < 1 || source.forbiddenMoves.length > 16) {
    throw new OrchestratorError("invalid_execution_contract", "forbiddenMoves are invalid", 500);
  }
  var maxQuestions = source.maxQuestions;
  if (!Number.isSafeInteger(maxQuestions) || maxQuestions !== 1) throw new OrchestratorError("invalid_execution_contract", "maxQuestions must be 1", 500);
  return {
    decisionId: executionContractString(decision.decisionId, "decisionId", 512),
    sessionId: executionContractString(decision.sessionId, "sessionId", 512),
    conceptId: executionContractString(decision.conceptId, "conceptId", 512),
    action: executionContractEnum(decision.action, "action", ["check", "explain", "remediate", "assess_transfer", "advance", "review"]),
    difficulty: executionContractEnum(decision.difficulty, "difficulty", ["lower", "same", "higher"]),
    reasonCodes: reasonCodes,
    assessmentId: decision.assessmentId == null ? null : executionContractString(decision.assessmentId, "assessmentId", 512),
    rulesVersion: executionContractString(decision.rulesVersion, "rulesVersion", 128),
    tutorContract: {
      objective: executionContractString(source.objective, "tutorContract.objective", 512),
      requiredMove: executionContractString(source.requiredMove, "tutorContract.requiredMove", 512),
      forbiddenMoves: source.forbiddenMoves.map(function (move) { return executionContractString(move, "tutorContract.forbiddenMove", 256); }),
      hintLevel: executionContractEnum(source.hintLevel, "tutorContract.hintLevel", ["none", "light", "heavy"]),
      expectedEvidenceType: executionContractEnum(source.expectedEvidenceType, "tutorContract.expectedEvidenceType", ["basic", "transfer", "misconception", "retention"]),
      maxQuestions: maxQuestions
    }
  };
}

function createOrchestrator(options) {
  options = options || {};
  var storage = options.storage || storageModule.createStorage({ rootDir: options.rootDir });
  var journal = options.journal || journalModule.createJournal({ storage: storage, clock: options.clock, failureInjector: options.failureInjector });
  var evidence = options.evidence || evidenceModule;
  var mastery = options.mastery || masteryModule;
  var policy = options.policy || policyModule;
  var assessment = options.assessment || assessmentModule;
  var builder = options.builder || defaultBuilder;
  var diagnostician = options.diagnostician || defaultDiagnostician;
  var assertTrustedAccount = options.assertTrustedAccount || authModule.assertTrustedAccount;
  var clock = typeof options.clock === "function" ? options.clock : function () { return new Date(); };
  var serverInstanceId = options.serverInstanceId || "server_" + crypto.randomBytes(16).toString("hex");
  var activeExecutions = new Set();
  var serviceContexts = new WeakSet();
  var readinessPromise = null;
  var readinessState = { status: "new", error: null };

  function now() { return iso(clock()); }
  function graphKey(scope) { return "textbooks/" + scope.storageTextbookId + "/concept-graph.json"; }
  function projectionKey(scope) { return "textbooks/" + scope.storageTextbookId + "/concept-states.json"; }
  function reviewKey(scope) { return "textbooks/" + scope.storageTextbookId + "/review-queue.json"; }
  function sessionKey(id) { return "sessions/" + storageId(id, "sessionId") + ".json"; }
  function sessionLocatorKey(id) { return "locators/sessions/" + storageId(id, "sessionId") + ".json"; }
  function decisionKey(id) { return "decisions/" + storageId(id, "decisionId") + ".json"; }
  function decisionLocatorKey(id) { return "locators/decisions/" + storageId(id, "decisionId") + ".json"; }
  function assessmentKey(id) { return "assessments/" + storageId(id, "assessmentId") + ".json"; }
  function evidenceKey(id) { return "evidence/" + storageId(id, "eventId") + ".json"; }
  function claimKey(id) { return "decision-claims/" + storageId(id, "decisionId") + ".json"; }
  function executionLocatorKey(id) { return "locators/executions/" + storageId(id, "executionId") + ".json"; }
  function executionEventKey(id, eventId) { return "decision-executions/" + storageId(id, "executionId") + "/events/" + storageId(eventId, "eventId") + ".json"; }
  function terminalKey(id) { return "decision-executions/" + storageId(id, "executionId") + "/terminal.json"; }
  function tutorResponseKey(id) { return "tutor-responses/" + storageId(id, "responseId") + ".json"; }

  function publicContext(context) {
    if (!context || typeof context.accountId !== "string") throw new OrchestratorError("untrusted_request_context", "A trusted request context is required", 403);
    assertTrustedAccount(context, context.accountId);
    return context;
  }

  function createServiceContext(context) {
    context = publicContext(context);
    var service = Object.freeze({ accountId: context.accountId, requestContext: context, serverInstanceId: serverInstanceId });
    serviceContexts.add(service);
    return service;
  }

  function serviceContext(context) {
    if (!context || !serviceContexts.has(context)) throw new OrchestratorError("forbidden", "Trusted service context is required", 403);
    assertTrustedAccount(context.requestContext, context.accountId);
    return context;
  }

  function resolvePublicScope(context, input, includeTextbook) {
    publicContext(context);
    var raw = {
      accountId: context.accountId,
      profileId: storageId(input.profileId, "profileId"),
      worldId: storageId(input.worldId, "worldId")
    };
    if (includeTextbook) raw.textbookId = storageId(input.textbookId, "textbookId");
    var scope = storage.resolveScope(raw);
    assertTrustedAccount(context, scope.accountId);
    return scope;
  }

  function makeArtifact(kind, type, id, key, base, payload) {
    var revision = base ? Number(base.revision) + 1 : 1;
    return {
      artifactKind: kind,
      artifactType: type,
      artifactId: id,
      storageKey: key,
      expectedBaseRevision: base ? base.revision : "ABSENT",
      expectedBasePayloadHash: base ? journalModule.payloadHash(base) : "ABSENT",
      targetRevision: revision,
      payload: Object.assign({}, clone(payload), { schemaVersion: 1, revision: revision })
    };
  }

  function loadCommittedEvidence(scope) {
    return storage.listArtifacts(scope, "evidence/").map(function (entry) { return entry.value; }).filter(function (event) {
      return event && event.textbookId === scope.textbookId && event.producingTransactionId && journal.isCommitted(scope, event.producingTransactionId);
    }).map(function (event) {
      var validation = evidence.validateEvent(event);
      if (!validation.valid) throw new OrchestratorError("invalid_committed_evidence", "Committed evidence failed validation", 500, { eventId: event.eventId, errors: validation.errors });
      return event;
    });
  }

  function projectionEnvelope(scope, conceptId, events, transactionId, base, evaluationTime) {
    var projection = mastery.replayConcept(events, conceptId);
    var ledgerView = evidence.buildLedgerView(events);
    var envelope = {
      textbookId: scope.textbookId,
      throughTransactionId: transactionId,
      ledgerViewHash: ledgerView.ledgerViewHash,
      projections: {}
    };
    if (base && base.projections) Object.keys(base.projections).forEach(function (key) { envelope.projections[key] = base.projections[key]; });
    envelope.projections[conceptId] = clone(projection);
    envelope.projectedAt = evaluationTime;
    return { projection: projection, ledgerView: ledgerView, envelope: envelope };
  }

  function prepareEvidenceForStorage(event, transactionId) {
    var value = clone(event);
    value.revision = 1;
    value.producingTransactionId = transactionId;
    delete value.payloadHash;
    value.payloadHash = evidence.hashCanonical(value);
    return value;
  }

  function reviewEnvelope(scope, projections, transactionId, evaluationTime) {
    var due = [];
    Object.keys(projections || {}).sort().forEach(function (conceptId) {
      var projection = projections[conceptId];
      if (projection.nextReviewAt) due.push({ conceptId: conceptId, nextReviewAt: projection.nextReviewAt, baseState: projection.baseState });
    });
    return { textbookId: scope.textbookId, throughTransactionId: transactionId, generatedAt: evaluationTime, items: due };
  }

  async function validateProspective(scope, transaction) {
    if (!transaction.prospectiveLedgerHash && !transaction.targetProjectionHash) return;
    var committed = loadCommittedEvidence(scope);
    var current = transaction.writeSet.artifacts.filter(function (artifact) { return artifact.artifactType === "evidence"; }).map(function (artifact) { return artifact.payload; });
    var ledgerView = evidence.buildLedgerView(committed.concat(current));
    if (transaction.prospectiveLedgerHash && ledgerView.ledgerViewHash !== transaction.prospectiveLedgerHash) {
      throw new OrchestratorError("prospective_ledger_mismatch", "Prospective ledger hash changed before commit", 409);
    }
    if (transaction.targetProjectionHash) {
      var stateArtifact = transaction.writeSet.artifacts.find(function (artifact) { return artifact.artifactType === "concept_state"; });
      var conceptId = transaction.resultPayload && transaction.resultPayload.conceptId;
      var stored = stateArtifact && stateArtifact.payload && stateArtifact.payload.projections && stateArtifact.payload.projections[conceptId];
      var replayed = conceptId && mastery.replayConcept(ledgerView.events, conceptId);
      if (!stored || !replayed || stored.projectionHash !== transaction.targetProjectionHash || replayed.projectionHash !== transaction.targetProjectionHash) {
        throw new OrchestratorError("prospective_projection_mismatch", "Prospective projection hash changed before commit", 409);
      }
    }
  }

  async function recoverScopeLocked(scope) {
    return journal.recoverScope(scope, { validateProspective: function (transaction) { return validateProspective(scope, transaction); } });
  }

  function normalizeRequest(scope, action, input) {
    var excluded = { action: true, traceId: true, timestamp: true, evaluationTime: true, accountId: true, enabled: true, adaptiveEnabled: true };
    var business = {};
    Object.keys(input || {}).sort().forEach(function (key) { if (!excluded[key]) business[key] = input[key]; });
    return {
      schemaVersion: 1,
      action: action,
      accountId: scope.accountId,
      profileId: scope.profileId,
      worldId: scope.worldId,
      textbookId: scope.textbookId,
      business: business
    };
  }

  async function runTransactionLocked(scope, action, input, build, trustedContext) {
    var rid = requestId(input.requestId);
    var normalized = normalizeRequest(scope, action, input);
    var requestHash = hash(normalized);
    var transactionId = journal.transactionIdFor(scope.mutationScopeKey, action, rid);
    var existing = journal.readTransaction(scope, transactionId);
    if (trustedContext && typeof options.validateTrustedContext === "function") options.validateTrustedContext(trustedContext);
    var hooks = { validateProspective: function (transaction) { return validateProspective(scope, transaction); } };
    if (existing) {
      if (existing.requestHash !== requestHash) throw new OrchestratorError("idempotency_conflict", "requestId was already used with different business input", 409);
      return journal.execute(scope, { operation: action, requestId: rid, mutationScopeKey: scope.mutationScopeKey, requestHash: requestHash }, hooks);
    }
    var evaluationTime = now();
    var built = await build({ transactionId: transactionId, evaluationTime: evaluationTime, requestHash: requestHash });
    if (trustedContext && typeof options.validateTrustedContext === "function") options.validateTrustedContext(trustedContext);
    return journal.execute(scope, {
      operation: action,
      requestId: rid,
      requestHash: requestHash,
      normalizedRequest: normalized,
      evaluationTime: evaluationTime,
      mutationScopeKey: scope.mutationScopeKey,
      sessionId: built.sessionId || input.sessionId || null,
      turnId: input.turnId || null,
      baseRevisions: built.baseRevisions || {},
      artifacts: built.artifacts || [],
      committedSnapshotHash: built.committedSnapshotHash || null,
      prospectiveLedgerHash: built.prospectiveLedgerHash || null,
      targetProjectionHash: built.targetProjectionHash || null,
      resultPayload: built.resultPayload || {}
    }, hooks);
  }

  function concepts(graph) { return Array.isArray(graph && graph.concepts) ? graph.concepts : []; }
  function conceptId(concept) { return concept && (concept.conceptId || concept.id); }
  function conceptQuestions(concept) { return (concept && (concept.qaPairs || concept.questions)) || []; }
  function chooseConcept(graph, preferred) {
    var list = concepts(graph);
    var selected = preferred && list.find(function (item) { return conceptId(item) === preferred; });
    selected = selected || list[0];
    if (!selected || !conceptId(selected)) throw new OrchestratorError("concept_graph_empty", "Concept graph has no usable concepts", 422);
    return selected;
  }

  function makeAssessment(concept, seed, evaluationTime, evidenceType) {
    var questions = conceptQuestions(concept);
    var question = questions.find(function (item) { return !evidenceType || item.evidenceType === evidenceType; }) || questions[0] || {};
    var type = question.questionType || question.type || "open";
    if (type === "diagnostic") type = "short_answer";
    return assessment.normalizeAssessment({
      schemaVersion: 1,
      assessmentId: question.assessmentId || stableId("assessment", [seed, question.questionId || 0, evidenceType || "basic"]),
      assessmentVersion: question.assessmentVersion || "assessment-v1",
      conceptId: conceptId(concept),
      question: question.question || "请用自己的话说明这个概念，并回答一个可核验的问题。",
      questionType: type,
      evidenceType: question.evidenceType || evidenceType || "basic",
      scoringMode: question.scoringMode,
      answerKey: question.answerKey === undefined ? question.expectedAnswer : question.answerKey,
      answerKeyProvenance: question.answerKeyProvenance || "llm_generated",
      answerKeyValidationStatus: question.answerKeyValidationStatus || "unverified",
      validatorType: question.validatorType || "none",
      validatorVersion: question.validatorVersion || "none",
      graderVersion: question.graderVersion || "assessment-engine-v1",
      sourceRefs: question.sourceRefs || [],
      scoringRules: question.scoringRules || {},
      solver: question.solver,
      humanVerification: question.humanVerification,
      externalContract: question.externalContract,
      createdAt: evaluationTime
    });
  }

  function makeDecision(scope, sessionId, turnId, concept, projection, assessmentCandidate, evaluationTime, extra) {
    extra = extra || {};
    var decision = policy.selectNextAction({
      conceptId: conceptId(concept),
      sessionId: sessionId,
      turnId: turnId || null,
      projection: projection,
      evaluationTime: evaluationTime,
      learnerSignal: extra.learnerSignal,
      diagnosisStatus: extra.diagnosisStatus,
      assessmentCandidates: assessmentCandidate ? [assessmentCandidate] : [],
      decisionId: extra.decisionId
    });
    var output = Object.assign({}, clone(decision), {
      profileId: scope.profileId,
      worldId: scope.worldId,
      textbookId: scope.textbookId,
      assessmentId: decision.assessmentId || assessmentCandidate && assessmentCandidate.assessmentId || null
    });
    return output;
  }

  function scopeBinding(scope, kind, id) {
    return hash({ kind: kind, id: id, accountId: scope.storageAccountId, profileId: scope.storageProfileId, worldId: scope.storageWorldId, textbookId: scope.storageTextbookId });
  }

  function locatorPayload(scope, kind, id, transactionId, extra) {
    return Object.assign({
      locatorType: kind,
      entityId: id,
      accountId: scope.accountId,
      profileId: scope.profileId,
      worldId: scope.worldId,
      textbookId: scope.textbookId,
      storageAccountId: scope.storageAccountId,
      storageProfileId: scope.storageProfileId,
      storageWorldId: scope.storageWorldId,
      storageTextbookId: scope.storageTextbookId,
      scopeBindingHash: scopeBinding(scope, kind, id),
      createdByTransactionId: transactionId
    }, extra || {});
  }

  function verifyLocator(scope, locator, kind, id) {
    if (!locator || locator.locatorType !== kind || locator.entityId !== id || locator.accountId !== scope.accountId || locator.profileId !== scope.profileId || locator.worldId !== scope.worldId || locator.textbookId !== scope.textbookId || locator.storageAccountId !== scope.storageAccountId || locator.storageProfileId !== scope.storageProfileId || locator.storageWorldId !== scope.storageWorldId || locator.storageTextbookId !== scope.storageTextbookId || locator.scopeBindingHash !== scopeBinding(scope, kind, id)) {
      throw new OrchestratorError("scope_binding_mismatch", "Locator scope binding is invalid", 403);
    }
    return locator;
  }

  async function locateAndLock(context, input, kind, id, callback) {
    await awaitReady();
    var parent = resolvePublicScope(context, input, false);
    var key = kind === "session" ? sessionLocatorKey(id) : kind === "decision" ? decisionLocatorKey(id) : executionLocatorKey(id);
    var first = await storage.withScopeLock(parent.locatorScopeKey, async function () {
      var locator = journal.readCommitted(parent, key);
      if (!locator) throw new OrchestratorError("locator_not_found", kind + " locator was not found", 404);
      if (locator.storageAccountId !== parent.storageAccountId || locator.storageProfileId !== parent.storageProfileId || locator.storageWorldId !== parent.storageWorldId) {
        throw new OrchestratorError("scope_binding_mismatch", "Locator parent scope is invalid", 403);
      }
      return locator;
    });
    var full = storage.resolveScope({ accountId: context.accountId, profileId: input.profileId, worldId: input.worldId, textbookId: first.textbookId });
    return storage.withScopeLock(full.mutationScopeKey, async function () {
      await recoverAndReconcileLocked(full);
      var second = journal.readCommitted(full, key);
      verifyLocator(full, second, kind, id);
      return callback(full, second);
    });
  }

  async function startSession(input, context) {
    await awaitReady();
    var scope = resolvePublicScope(context, input, true);
    return storage.withScopeLock(scope.mutationScopeKey, async function () {
      await recoverAndReconcileLocked(scope);
      var result = await runTransactionLocked(scope, "startSession", input, async function (tx) {
        var existingGraph = journal.readCommitted(scope, graphKey(scope));
        var graph = existingGraph;
        if (!graph) {
          graph = input.conceptGraph ? clone(input.conceptGraph) : await builder.buildConceptGraph({
            accountId: scope.accountId,
            profileId: scope.profileId,
            worldId: scope.worldId,
            textbookId: scope.textbookId,
            textbookDir: scope.contentTextbookRoot,
            sourceText: input.sourceText,
            textbookTitle: input.textbookTitle,
            existingGraph: null,
            persist: false,
            dryRun: input.dryRun === true
          }, options.builderCallLLM || options.callLLM);
          if (!graph || graph.error) throw new OrchestratorError(graph && graph.error || "concept_graph_failed", graph && graph.message || "Concept graph generation failed", 422);
        }
        var selected = chooseConcept(graph, input.conceptId);
        var id = stableId("session", [scope.mutationScopeKey, input.requestId]);
        var assessmentValue = makeAssessment(selected, [id, "initial"], tx.evaluationTime, "basic");
        var committedEvents = loadCommittedEvidence(scope);
        var projectionBase = journal.readCommitted(scope, projectionKey(scope));
        var projectionData = projectionEnvelope(scope, conceptId(selected), committedEvents, tx.transactionId, projectionBase, tx.evaluationTime);
        var decision = makeDecision(scope, id, null, selected, projectionData.projection, assessmentValue, tx.evaluationTime, {});
        var session = {
          sessionId: id,
          accountId: scope.accountId,
          profileId: scope.profileId,
          worldId: scope.worldId,
          textbookId: scope.textbookId,
          scopeBindingHash: scopeBinding(scope, "session", id),
          status: "active",
          activeConceptId: conceptId(selected),
          currentAssessmentId: assessmentValue.assessmentId,
          pendingDecisionId: decision.decisionId,
          turnCount: 0,
          recentTurns: [],
          startedAt: tx.evaluationTime,
          updatedAt: tx.evaluationTime
        };
        var artifacts = [];
        if (!existingGraph) artifacts.push(makeArtifact("mutable", "concept_graph", scope.storageTextbookId, graphKey(scope), null, graph));
        artifacts.push(makeArtifact("mutable", "concept_state", scope.storageTextbookId, projectionKey(scope), projectionBase, projectionData.envelope));
        artifacts.push(makeArtifact("mutable", "review_queue", scope.storageTextbookId, reviewKey(scope), journal.readCommitted(scope, reviewKey(scope)), reviewEnvelope(scope, projectionData.envelope.projections, tx.transactionId, tx.evaluationTime)));
        artifacts.push(makeArtifact("mutable", "session", id, sessionKey(id), null, session));
        artifacts.push(makeArtifact("immutable", "scope_locator", id, sessionLocatorKey(id), null, locatorPayload(scope, "session", id, tx.transactionId)));
        artifacts.push(makeArtifact("immutable", "assessment", assessmentValue.assessmentId, assessmentKey(assessmentValue.assessmentId), null, assessmentValue));
        artifacts.push(makeArtifact("immutable", "decision", decision.decisionId, decisionKey(decision.decisionId), null, decision));
        artifacts.push(makeArtifact("immutable", "scope_locator", decision.decisionId, decisionLocatorKey(decision.decisionId), null, locatorPayload(scope, "decision", decision.decisionId, tx.transactionId, { sessionId: id })));
        return {
          sessionId: id,
          artifacts: artifacts,
          committedSnapshotHash: hash(evidence.buildLedgerView(committedEvents)),
          prospectiveLedgerHash: projectionData.ledgerView.ledgerViewHash,
          targetProjectionHash: projectionData.projection.projectionHash,
          resultPayload: {
            ok: true,
            action: "startSession",
            requestId: input.requestId,
            sessionId: id,
            decisionId: decision.decisionId,
            conceptId: conceptId(selected),
            decision: decision,
            assessment: clone(assessmentValue),
            conceptState: mastery.deriveEffectiveProjection(projectionData.projection, tx.evaluationTime)
          }
        };
      }, context);
      return result.resultPayload;
    });
  }

  function selfReport(message) { return /(^|\s)(i understand|got it)(\s|$)/i.test(message) || /我(已经)?(理解|懂|明白)了/.test(message); }

  async function prepareTurn(input, context) {
    var sessionId = storageId(input.sessionId, "sessionId");
    return locateAndLock(context, input, "session", sessionId, async function (scope) {
      var result = await runTransactionLocked(scope, "prepareTurn", input, async function (tx) {
        var session = journal.readCommitted(scope, sessionKey(sessionId));
        if (!session || session.status !== "active") throw new OrchestratorError("session_not_active", "Session is not active", 409);
        var graph = journal.readCommitted(scope, graphKey(scope));
        if (!graph) throw new OrchestratorError("concept_graph_missing", "Committed concept graph is missing", 500);
        var selected = chooseConcept(graph, session.activeConceptId);
        var currentAssessmentId = input.assessmentId || session.currentAssessmentId;
        var currentAssessment = currentAssessmentId && journal.readCommitted(scope, assessmentKey(currentAssessmentId));
        var message = requiredString(input.learnerMessage, "learnerMessage");
        var diagnosis;
        try {
          diagnosis = await diagnostician.diagnose({
            profileId: scope.profileId,
            worldId: scope.worldId,
            textbookId: scope.textbookId,
            sessionId: sessionId,
            userMessage: message,
            conceptGraph: graph,
            learnerModel: journal.readCommitted(scope, projectionKey(scope)) || { projections: {} },
            recentTurns: session.recentTurns || [],
            activeConceptIds: [conceptId(selected)],
            persist: false,
            dryRun: input.dryRun === true
          }, options.diagnosisCallLLM || options.callLLM);
        } catch (error) {
          diagnosis = { error: "diagnosis_error", outcome: "unknown", diagnosticConfidence: 0 };
        }
        var scored = currentAssessment && !selfReport(message) ? assessment.scoreAssessment(currentAssessment, message) : null;
        var candidate = prepareEvidenceForStorage(evidence.createEvidenceEvent({
          transactionId: tx.transactionId,
          accountId: scope.accountId,
          profileId: scope.profileId,
          worldId: scope.worldId,
          textbookId: scope.textbookId,
          sessionId: sessionId,
          turnId: requiredString(input.turnId, "turnId"),
          assessmentId: currentAssessmentId || "self_report",
          conceptId: conceptId(selected),
          source: "classroom",
          evidenceType: selfReport(message) ? "self_report" : currentAssessment && currentAssessment.evidenceType || "basic",
          assistanceLevel: input.assistanceLevel || "none",
          learnerAnswer: message,
          scoringResult: scored || undefined,
          assessment: currentAssessment || undefined,
          diagnosis: scored ? undefined : diagnosis,
          misconceptionId: input.misconceptionId || diagnosis && diagnosis.misconceptionId,
          createdAt: tx.evaluationTime
        }), tx.transactionId);
        var committedEvents = loadCommittedEvidence(scope);
        var prior = committedEvents.find(function (event) { return event.eventKey === candidate.eventKey; });
        if (prior && prior.eventInputHash !== candidate.eventInputHash) throw new OrchestratorError("evidence_conflict", "eventKey already exists with different input", 409);
        var events = prior ? committedEvents : committedEvents.concat([candidate]);
        var projectionBase = journal.readCommitted(scope, projectionKey(scope));
        var projectionData = projectionEnvelope(scope, conceptId(selected), events, tx.transactionId, projectionBase, tx.evaluationTime);
        var nextAssessment = makeAssessment(selected, [sessionId, input.turnId, tx.transactionId], tx.evaluationTime, projectionData.projection.hasIndependentBasic ? "transfer" : "basic");
        var diagnosisStatus = diagnosis && diagnosis.error ? (diagnosis.error === "llm_error" ? "timeout" : "invalid") : undefined;
        var decision = makeDecision(scope, sessionId, input.turnId, selected, projectionData.projection, nextAssessment, tx.evaluationTime, {
          learnerSignal: selfReport(message) ? "self_report" : undefined,
          diagnosisStatus: diagnosisStatus
        });
        var recent = (session.recentTurns || []).concat([{ turnId: input.turnId, learnerMessageHash: hash({ learnerMessage: message }), evidenceEventId: prior ? prior.eventId : candidate.eventId, decisionId: decision.decisionId, at: tx.evaluationTime }]).slice(-20);
        var updatedSession = Object.assign({}, session, {
          currentAssessmentId: nextAssessment.assessmentId,
          pendingDecisionId: decision.decisionId,
          fallbackStatus: null,
          turnCount: Number(session.turnCount || 0) + 1,
          recentTurns: recent,
          updatedAt: tx.evaluationTime
        });
        delete updatedSession.payloadHash;
        delete updatedSession.producingTransactionId;
        var artifacts = [];
        if (!prior) artifacts.push(makeArtifact("immutable", "evidence", candidate.eventId, evidenceKey(candidate.eventId), null, candidate));
        artifacts.push(makeArtifact("mutable", "concept_state", scope.storageTextbookId, projectionKey(scope), projectionBase, projectionData.envelope));
        artifacts.push(makeArtifact("mutable", "review_queue", scope.storageTextbookId, reviewKey(scope), journal.readCommitted(scope, reviewKey(scope)), reviewEnvelope(scope, projectionData.envelope.projections, tx.transactionId, tx.evaluationTime)));
        artifacts.push(makeArtifact("immutable", "assessment", nextAssessment.assessmentId, assessmentKey(nextAssessment.assessmentId), null, nextAssessment));
        artifacts.push(makeArtifact("immutable", "decision", decision.decisionId, decisionKey(decision.decisionId), null, decision));
        artifacts.push(makeArtifact("immutable", "scope_locator", decision.decisionId, decisionLocatorKey(decision.decisionId), null, locatorPayload(scope, "decision", decision.decisionId, tx.transactionId, { sessionId: sessionId })));
        artifacts.push(makeArtifact("mutable", "session", sessionId, sessionKey(sessionId), session, updatedSession));
        return {
          sessionId: sessionId,
          artifacts: artifacts,
          committedSnapshotHash: hash(evidence.buildLedgerView(committedEvents)),
          prospectiveLedgerHash: projectionData.ledgerView.ledgerViewHash,
          targetProjectionHash: projectionData.projection.projectionHash,
          resultPayload: {
            ok: true,
            action: "prepareTurn",
            requestId: input.requestId,
            sessionId: sessionId,
            decisionId: decision.decisionId,
            conceptId: conceptId(selected),
            evidenceEventId: prior ? prior.eventId : candidate.eventId,
            duplicateEvidence: !!prior,
            decision: decision,
            assessment: clone(nextAssessment),
            conceptState: mastery.deriveEffectiveProjection(projectionData.projection, tx.evaluationTime),
            safeFallback: !!diagnosisStatus
          }
        };
      }, context);
      return result.resultPayload;
    });
  }

  async function endSession(input, context) {
    var id = storageId(input.sessionId, "sessionId");
    return locateAndLock(context, input, "session", id, async function (scope) {
      var result = await runTransactionLocked(scope, "endSession", input, async function (tx) {
        var session = journal.readCommitted(scope, sessionKey(id));
        if (!session) throw new OrchestratorError("session_not_found", "Session was not found", 404);
        var target = Object.assign({}, session, { status: "ended", endedAt: tx.evaluationTime, updatedAt: tx.evaluationTime });
        delete target.payloadHash;
        delete target.producingTransactionId;
        return {
          sessionId: id,
          artifacts: [makeArtifact("mutable", "session", id, sessionKey(id), session, target)],
          resultPayload: { ok: true, action: "endSession", requestId: input.requestId, sessionId: id, status: "ended" }
        };
      }, context);
      return result.resultPayload;
    });
  }

  function recoveryDecision(scope, original, session, terminalType, evaluationTime) {
    return {
      schemaVersion: 1,
      decisionId: stableId("decision", [original.decisionId, "recovery", terminalType]),
      sessionId: session.sessionId,
      profileId: scope.profileId,
      worldId: scope.worldId,
      textbookId: scope.textbookId,
      conceptId: original.conceptId,
      action: "check",
      difficulty: "same",
      reasonCodes: ["EXECUTION_" + terminalType.toUpperCase(), "RECOVERY_CHECK"],
      assessmentId: session.currentAssessmentId || original.assessmentId || null,
      tutorContract: {
        objective: "Resume safely with one independently scorable check.",
        requiredMove: "Acknowledge the interruption and ask exactly one check question.",
        forbiddenMoves: ["DO_NOT_REPLAY_FAILED_OUTPUT", "DO_NOT_DECLARE_MASTERY"],
        hintLevel: "none",
        expectedEvidenceType: "basic",
        maxQuestions: 1
      },
      rulesVersion: policy.RULES_VERSION,
      evaluationTime: evaluationTime,
      createdAt: evaluationTime,
      recoveryOfDecisionId: original.decisionId,
      recoveryTerminalType: terminalType
    };
  }

  function recoveryArtifacts(scope, transactionId, decision, session, terminalType, evaluationTime) {
    var replacement = recoveryDecision(scope, decision, session, terminalType, evaluationTime);
    var target = Object.assign({}, session, { pendingDecisionId: replacement.decisionId, fallbackStatus: null, updatedAt: evaluationTime });
    delete target.payloadHash;
    delete target.producingTransactionId;
    return {
      replacement: replacement,
      artifacts: [
        makeArtifact("immutable", "decision", replacement.decisionId, decisionKey(replacement.decisionId), null, replacement),
        makeArtifact("immutable", "scope_locator", replacement.decisionId, decisionLocatorKey(replacement.decisionId), null, locatorPayload(scope, "decision", replacement.decisionId, transactionId, { sessionId: session.sessionId, recoveryOfDecisionId: decision.decisionId })),
        makeArtifact("mutable", "session", session.sessionId, sessionKey(session.sessionId), session, target)
      ]
    };
  }

  function executionState(scope, executionId) {
    var locator = journal.readCommitted(scope, executionLocatorKey(executionId));
    if (!locator) throw new OrchestratorError("execution_not_found", "Execution was not found", 404);
    var claim = journal.readCommitted(scope, claimKey(locator.decisionId));
    if (!claim || claim.executionId !== executionId || claim.decisionId !== locator.decisionId) throw new OrchestratorError("execution_claim_mismatch", "Execution claim is invalid", 409);
    var outputId = stableId("event", [executionId, "output_started"]);
    var outputStarted = journal.readCommitted(scope, executionEventKey(executionId, outputId));
    var terminal = journal.readCommitted(scope, terminalKey(executionId));
    return { locator: locator, claim: claim, outputStarted: outputStarted, terminal: terminal };
  }

  async function claimDecision(input, context) {
    context = serviceContext(context);
    var id = storageId(input.decisionId, "decisionId");
    return locateAndLock(context.requestContext, input, "decision", id, async function (scope) {
      var existingClaim = journal.readCommitted(scope, claimKey(id));
      if (existingClaim) return { ok: true, action: "claimDecision", alreadyClaimed: true, executionGranted: false, decisionId: id, executionId: existingClaim.executionId, serverInstanceId: existingClaim.serverInstanceId };
      var result = await runTransactionLocked(scope, "claimDecision", input, async function (tx) {
        var decision = journal.readCommitted(scope, decisionKey(id));
        if (!decision) throw new OrchestratorError("decision_not_found", "Decision was not found", 404);
        var decisionSession = journal.readCommitted(scope, sessionKey(decision.sessionId));
        if (!decisionSession || decisionSession.status !== "active" || decisionSession.pendingDecisionId !== id) throw new OrchestratorError("decision_not_current", "Decision is not the active session target", 409);
        var executionContract = executionContractView(decision);
        var executionId = stableId("execution", [id, "unique"]);
        var claimedAt = tx.evaluationTime;
        var claim = {
          decisionId: id,
          executionId: executionId,
          sessionId: decision.sessionId,
          scopeBindingHash: scopeBinding(scope, "decision", id),
          serverInstanceId: serverInstanceId,
          claimedAt: claimedAt,
          requestHash: tx.requestHash
        };
        var locator = locatorPayload(scope, "execution", executionId, tx.transactionId, {
          decisionId: id,
          sessionId: decision.sessionId,
          claimTransactionId: tx.transactionId,
          serverInstanceId: serverInstanceId,
          claimedAt: claimedAt
        });
        return {
          sessionId: decision.sessionId,
          artifacts: [
            makeArtifact("immutable", "decision_claim", id, claimKey(id), null, claim),
            makeArtifact("immutable", "scope_locator", executionId, executionLocatorKey(executionId), null, locator)
          ],
          resultPayload: { ok: true, action: "claimDecision", requestId: input.requestId, decisionId: id, executionId: executionId, serverInstanceId: serverInstanceId, claimedAt: claimedAt, executionGranted: true, executionContract: executionContract }
        };
      }, context.requestContext);
      activeExecutions.add(result.resultPayload.executionId);
      return result.resultPayload;
    });
  }

  async function markDecisionOutputStarted(input, context) {
    context = serviceContext(context);
    var executionId = storageId(input.executionId, "executionId");
    return locateAndLock(context.requestContext, input, "execution", executionId, async function (scope) {
      var state = executionState(scope, executionId);
      if (state.terminal) throw new OrchestratorError("execution_terminal_conflict", "Execution is already terminal", 409);
      if (state.outputStarted) return { ok: true, action: "markDecisionOutputStarted", duplicate: true, executionId: executionId, eventId: state.outputStarted.eventId };
      var result = await runTransactionLocked(scope, "markDecisionOutputStarted", input, async function (tx) {
        state = executionState(scope, executionId);
        if (state.terminal) throw new OrchestratorError("execution_terminal_conflict", "Execution is already terminal", 409);
        var eventId = stableId("event", [executionId, "output_started"]);
        var eventInputHash = hash({ executionId: executionId, eventType: "output_started" });
        var event = { eventId: eventId, executionId: executionId, decisionId: state.claim.decisionId, eventType: "output_started", eventKey: hash([executionId, "output_started"]), eventInputHash: eventInputHash, serverInstanceId: state.claim.serverInstanceId, occurredAt: tx.evaluationTime };
        return {
          sessionId: state.claim.sessionId,
          artifacts: [makeArtifact("immutable", "decision_execution_event", eventId, executionEventKey(executionId, eventId), null, event)],
          resultPayload: { ok: true, action: "markDecisionOutputStarted", requestId: input.requestId, executionId: executionId, eventId: eventId, outputStartedAt: tx.evaluationTime }
        };
      }, context.requestContext);
      activeExecutions.add(executionId);
      return result.resultPayload;
    });
  }

  async function terminalTransactionLocked(scope, input, executionId, terminalType, includeResponse, trustedContext) {
    var normalizedTerminal = {
      executionId: executionId,
      terminalType: terminalType,
      responseId: input.responseId || null,
      messageRef: input.messageRef || null,
      contentHash: input.contentHash || null,
      actualStrategy: input.actualStrategy || null,
      errorCode: input.errorCode || null
    };
    var terminalInputHash = hash(normalizedTerminal);
    var before = executionState(scope, executionId);
    if (before.terminal) {
      if (before.terminal.terminalType === terminalType && before.terminal.terminalInputHash === terminalInputHash) return { resultPayload: { ok: true, action: includeResponse ? "recordTutorResponse" : "reconcileExecution", duplicate: true, executionId: executionId, terminalType: terminalType, replacementDecisionId: before.terminal.replacementDecisionId || null } };
      throw new OrchestratorError("execution_terminal_conflict", "Execution already has a different terminal", 409);
    }
    if (terminalType === "completed" && !before.outputStarted) throw new OrchestratorError("invalid_execution_transition", "completed requires output_started", 409);
    var action = includeResponse ? "recordTutorResponse" : "reconcileExecution";
    var result = await runTransactionLocked(scope, action, input, async function (tx) {
      var state = executionState(scope, executionId);
      if (state.terminal) throw new OrchestratorError("execution_terminal_conflict", "Execution already has a terminal", 409);
      if (terminalType === "completed" && !state.outputStarted) throw new OrchestratorError("invalid_execution_transition", "completed requires output_started", 409);
      var decision = journal.readCommitted(scope, decisionKey(state.claim.decisionId));
      var session = journal.readCommitted(scope, sessionKey(state.claim.sessionId));
      if (!decision || !session) throw new OrchestratorError("execution_state_incomplete", "Execution decision or session is missing", 500);
      var eventId = stableId("event", [executionId, "terminal", terminalType]);
      var event = { eventId: eventId, executionId: executionId, decisionId: decision.decisionId, eventType: terminalType, eventKey: hash([executionId, "terminal"]), eventInputHash: terminalInputHash, serverInstanceId: state.claim.serverInstanceId, occurredAt: tx.evaluationTime };
      var terminal = { executionId: executionId, decisionId: decision.decisionId, sessionId: session.sessionId, terminalType: terminalType, terminalEventKey: hash([executionId, "terminal"]), terminalInputHash: terminalInputHash, terminalAt: tx.evaluationTime };
      var artifacts = [makeArtifact("immutable", "decision_execution_event", eventId, executionEventKey(executionId, eventId), null, event)];
      if (includeResponse) {
        var responseId = input.responseId || stableId("response", [executionId, terminalType]);
        var response = { responseId: responseId, executionId: executionId, decisionId: decision.decisionId, sessionId: session.sessionId, status: terminalType, messageRef: input.messageRef || null, contentHash: input.contentHash || null, actualStrategy: input.actualStrategy || decision.action, errorCode: input.errorCode || null, completedAt: tx.evaluationTime };
        artifacts.push(makeArtifact("immutable", "tutor_response", responseId, tutorResponseKey(responseId), null, response));
        terminal.responseId = responseId;
      }
      var replacement = null;
      if (terminalType !== "completed") {
        if (session.pendingDecisionId && session.pendingDecisionId !== decision.decisionId) {
          replacement = journal.readCommitted(scope, decisionKey(session.pendingDecisionId));
          if (!replacement) throw new OrchestratorError("session_target_incomplete", "Existing session recovery target is not committed", 503);
          terminal.replacementDecisionId = replacement.decisionId;
        } else {
          var recovery = recoveryArtifacts(scope, tx.transactionId, decision, session, terminalType, tx.evaluationTime);
          replacement = recovery.replacement;
          terminal.replacementDecisionId = replacement.decisionId;
          artifacts = artifacts.concat(recovery.artifacts);
        }
      }
      artifacts.push(makeArtifact("immutable", "decision_execution_terminal", executionId, terminalKey(executionId), null, terminal));
      return {
        sessionId: session.sessionId,
        artifacts: artifacts,
        resultPayload: { ok: true, action: action, requestId: input.requestId, executionId: executionId, decisionId: decision.decisionId, terminalType: terminalType, replacementDecisionId: replacement && replacement.decisionId || null }
      };
    }, trustedContext);
    activeExecutions.delete(executionId);
    return result;
  }

  async function recordTutorResponse(input, context) {
    context = serviceContext(context);
    var executionId = storageId(input.executionId, "executionId");
    var terminalType = input.status;
    if (terminalType !== "completed" && terminalType !== "failed") throw new OrchestratorError("invalid_terminal_type", "recordTutorResponse accepts completed or failed", 400);
    return locateAndLock(context.requestContext, input, "execution", executionId, async function (scope) {
      var result = await terminalTransactionLocked(scope, input, executionId, terminalType, true, context.requestContext);
      return result.resultPayload;
    });
  }

  async function reconcileExecutionLocked(scope, locator) {
    var executionId = locator.entityId;
    var state;
    try { state = executionState(scope, executionId); } catch (error) { if (error.code === "execution_not_found") return null; throw error; }
    if (state.terminal || state.claim.serverInstanceId === serverInstanceId || activeExecutions.has(executionId)) return state.terminal ? { status: state.terminal.terminalType } : { status: "active" };
    var terminalType = state.outputStarted ? "indeterminate" : "abandoned";
    var internalInput = {
      requestId: stableId("reconcile", [executionId, terminalType]),
      executionId: executionId,
      profileId: scope.profileId,
      worldId: scope.worldId,
      status: terminalType,
      errorCode: "previous_server_instance_ended"
    };
    var result = await terminalTransactionLocked(scope, internalInput, executionId, terminalType, false, null);
    return result.resultPayload;
  }

  async function recoverAndReconcileLocked(scope) {
    await recoverScopeLocked(scope);
    var locators = storage.listArtifacts(scope, "locators/executions/").map(function (entry) { return entry.value; }).filter(function (locator) {
      return locator && locator.textbookId === scope.textbookId && locator.producingTransactionId && journal.isCommitted(scope, locator.producingTransactionId);
    });
    for (var index = 0; index < locators.length; index += 1) await reconcileExecutionLocked(scope, locators[index]);
  }

  async function reconcileExecution(input, context) {
    context = serviceContext(context);
    var executionId = storageId(input.executionId, "executionId");
    return locateAndLock(context.requestContext, input, "execution", executionId, async function (scope, locator) {
      var value = await reconcileExecutionLocked(scope, locator);
      return Object.assign({ ok: true, action: "reconcileExecution", executionId: executionId }, value || {});
    });
  }

  async function recordExternalEvidence(input, context) {
    context = serviceContext(context);
    await awaitReady();
    var scope = resolvePublicScope(context.requestContext, input, true);
    return storage.withScopeLock(scope.mutationScopeKey, async function () {
      await recoverAndReconcileLocked(scope);
      var result = await runTransactionLocked(scope, "recordExternalEvidence", input, async function (tx) {
        var assessmentValue = assessment.normalizeAssessment(input.assessment);
        var scored = assessment.scoreExternalAssessment(assessmentValue, input.externalResult || {});
        var event = prepareEvidenceForStorage(evidence.createEvidenceEvent({
          transactionId: tx.transactionId,
          accountId: scope.accountId,
          profileId: scope.profileId,
          worldId: scope.worldId,
          textbookId: scope.textbookId,
          source: requiredString(input.source, "source"),
          sourceEventId: requiredString(input.sourceEventId, "sourceEventId"),
          conceptId: requiredString(input.conceptId || assessmentValue.conceptId, "conceptId"),
          evidenceType: input.evidenceType || "basic",
          assistanceLevel: input.assistanceLevel || "none",
          scoringResult: scored,
          assessment: assessmentValue,
          createdAt: tx.evaluationTime
        }), tx.transactionId);
        var committed = loadCommittedEvidence(scope);
        var prior = committed.find(function (value) { return value.eventKey === event.eventKey; });
        if (prior && prior.eventInputHash !== event.eventInputHash) throw new OrchestratorError("evidence_conflict", "External event key already has different input", 409);
        var events = prior ? committed : committed.concat([event]);
        var base = journal.readCommitted(scope, projectionKey(scope));
        var projectionData = projectionEnvelope(scope, event.conceptId, events, tx.transactionId, base, tx.evaluationTime);
        var artifacts = [];
        if (!prior) artifacts.push(makeArtifact("immutable", "evidence", event.eventId, evidenceKey(event.eventId), null, event));
        artifacts.push(makeArtifact("mutable", "concept_state", scope.storageTextbookId, projectionKey(scope), base, projectionData.envelope));
        artifacts.push(makeArtifact("mutable", "review_queue", scope.storageTextbookId, reviewKey(scope), journal.readCommitted(scope, reviewKey(scope)), reviewEnvelope(scope, projectionData.envelope.projections, tx.transactionId, tx.evaluationTime)));
        return {
          artifacts: artifacts,
          committedSnapshotHash: hash(evidence.buildLedgerView(committed)),
          prospectiveLedgerHash: projectionData.ledgerView.ledgerViewHash,
          targetProjectionHash: projectionData.projection.projectionHash,
          resultPayload: { ok: true, action: "recordExternalEvidence", requestId: input.requestId, eventId: prior ? prior.eventId : event.eventId, duplicateEvidence: !!prior, conceptId: event.conceptId, conceptState: mastery.deriveEffectiveProjection(projectionData.projection, tx.evaluationTime) }
        };
      }, context.requestContext);
      return result.resultPayload;
    });
  }

  async function getState(input, context) {
    var sessionId = storageId(input.sessionId, "sessionId");
    return locateAndLock(context, input, "session", sessionId, async function (scope) {
      var session = journal.readCommitted(scope, sessionKey(sessionId));
      if (!session) throw new OrchestratorError("session_not_found", "Session was not found", 404);
      var decision = session.pendingDecisionId && journal.readCommitted(scope, decisionKey(session.pendingDecisionId));
      if (session.pendingDecisionId && !decision) throw new OrchestratorError("materialization_incomplete", "Session target decision is not committed", 503);
      var events = loadCommittedEvidence(scope);
      var baseProjection = mastery.replayConcept(events, session.activeConceptId);
      var responseAsOf = now();
      return {
        ok: true,
        action: "getState",
        sessionId: sessionId,
        status: session.status,
        textbookId: scope.textbookId,
        conceptId: session.activeConceptId,
        pendingDecisionId: session.pendingDecisionId || null,
        fallbackStatus: session.fallbackStatus || null,
        decision: decision,
        conceptState: mastery.deriveEffectiveProjection(baseProjection, responseAsOf),
        responseAsOf: responseAsOf
      };
    });
  }

  async function initialize() {
    if (readinessPromise) return readinessPromise;
    readinessState = { status: "initializing", error: null };
    readinessPromise = (async function () {
      var scopes = storage.listScopes();
      for (var index = 0; index < scopes.length; index += 1) {
        var scope = scopes[index];
        await storage.withScopeLock(scope.mutationScopeKey, function () { return recoverAndReconcileLocked(scope); });
      }
      readinessState = { status: "ready", error: null };
      return { ok: true, recoveredScopes: scopes.length, serverInstanceId: serverInstanceId };
    })().catch(function (error) {
      readinessState = { status: "degraded", error: { code: error && error.code || "adaptive_unavailable" } };
      return { ok: false, code: readinessState.error.code };
    });
    return readinessPromise;
  }

  async function awaitReady() {
    var result = await initialize();
    if (!result.ok) throw new OrchestratorError("adaptive_unavailable", "Adaptive teaching is unavailable", 503, { causeCode: result.code });
    return result;
  }

  function publicFields(value, fields) {
    if (!value || typeof value !== "object") return null;
    return fields.reduce(function (output, key) {
      if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) output[key] = clone(value[key]);
      return output;
    }, {});
  }

  function publicRequestInput(action, input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new OrchestratorError("invalid_request", "Request input must be an object", 400);
    var fields;
    if (action === "startSession") fields = ["requestId", "profileId", "worldId", "textbookId"];
    else if (action === "prepareTurn") fields = ["requestId", "profileId", "worldId", "sessionId", "turnId", "learnerMessage", "assessmentId"];
    else if (action === "endSession") fields = ["requestId", "profileId", "worldId", "sessionId"];
    else if (action === "state" || action === "getState") fields = ["profileId", "worldId", "sessionId"];
    else fields = [];
    return publicFields(input, fields);
  }
  function publicDecisionView(value) {
    return publicFields(value, ["decisionId", "sessionId", "conceptId", "action", "difficulty", "reasonCodes", "assessmentId", "rulesVersion", "evaluationTime", "createdAt", "recoveryOfDecisionId", "recoveryTerminalType"]);
  }

  function publicAssessmentView(value) {
    return publicFields(value, ["assessmentId", "assessmentVersion", "conceptId", "question", "questionType", "evidenceType", "scoringMode", "createdAt"]);
  }

  function publicConceptStateView(value) {
    return publicFields(value, ["conceptId", "baseState", "effectiveState", "score", "nextReviewAt", "reasonCodes", "hasIndependentBasic", "hasIndependentTransfer", "hasIndependentRetention", "lastEvidenceOutcome", "lastEvidenceType", "responseAsOf"]);
  }

  function publicActionResult(action, value) {
    if (action === "startSession") {
      var started = publicFields(value, ["ok", "action", "requestId", "sessionId", "decisionId", "conceptId", "evaluationTime"]);
      started.decision = publicDecisionView(value.decision);
      started.assessment = publicAssessmentView(value.assessment);
      started.conceptState = publicConceptStateView(value.conceptState);
      return started;
    }
    if (action === "prepareTurn") {
      var prepared = publicFields(value, ["ok", "action", "requestId", "sessionId", "decisionId", "conceptId", "evidenceEventId", "duplicateEvidence", "safeFallback", "evaluationTime"]);
      prepared.decision = publicDecisionView(value.decision);
      prepared.assessment = publicAssessmentView(value.assessment);
      prepared.conceptState = publicConceptStateView(value.conceptState);
      return prepared;
    }
    if (action === "state" || action === "getState") {
      var state = publicFields(value, ["ok", "action", "sessionId", "status", "textbookId", "conceptId", "pendingDecisionId", "fallbackStatus", "responseAsOf"]);
      state.decision = publicDecisionView(value.decision);
      state.conceptState = publicConceptStateView(value.conceptState);
      return state;
    }
    return publicFields(value, ["ok", "action", "requestId", "sessionId", "status", "evaluationTime"]);
  }

  async function handlePublicRequest(context, method, action, input) {
    publicContext(context);
    if (method === "GET" && (action === "state" || action === "getState")) return publicActionResult(action, await getState(publicRequestInput(action, input), context));
    if (method === "POST" && action === "startSession") return publicActionResult(action, await startSession(publicRequestInput(action, input), context));
    if (method === "POST" && action === "prepareTurn") return publicActionResult(action, await prepareTurn(publicRequestInput(action, input), context));
    if (method === "POST" && action === "endSession") return publicActionResult(action, await endSession(publicRequestInput(action, input), context));
    if (["claimDecision", "markDecisionOutputStarted", "recordTutorResponse", "reconcileExecution", "recordExternalEvidence"].indexOf(action) >= 0) throw new OrchestratorError("forbidden", "Action is service-only", 403);
    throw new OrchestratorError("unknown_action", "Unknown adaptive teaching action", 400);
  }

  return Object.freeze({
    serverInstanceId: serverInstanceId,
    storage: storage,
    journal: journal,
    initialize: initialize,
    awaitReady: awaitReady,
    readiness: function () { return clone(readinessState); },
    createServiceContext: createServiceContext,
    handlePublicRequest: handlePublicRequest,
    startSession: startSession,
    prepareTurn: prepareTurn,
    endSession: endSession,
    getState: getState,
    claimDecision: claimDecision,
    markDecisionOutputStarted: markDecisionOutputStarted,
    recordTutorResponse: recordTutorResponse,
    reconcileExecution: reconcileExecution,
    recordExternalEvidence: recordExternalEvidence,
    _activeExecutions: activeExecutions
  });
}

module.exports = {
  OrchestratorError: OrchestratorError,
  createOrchestrator: createOrchestrator
};
