#!/usr/bin/env node
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var auth = require("../local-request-auth.js");
var storageModule = require("./storage-v2.js");
var orchestratorModule = require("./orchestrator.js");
var evidenceModule = require("./evidence-ledger.js");
var masteryModule = require("./mastery-engine.js");

function conceptGraph() {
  function sourceRef(page) {
    return { sourceId: "physics-book", pageOrCardId: page, contentHash: "content-" + page, excerptHash: "excerpt-" + page };
  }
  return {
    schemaVersion: 1,
    version: 1,
    textbookId: "Physics",
    concepts: [{
      conceptId: "force",
      title: "Force",
      prerequisites: [],
      qaPairs: [
        {
          questionId: "force-basic",
          question: "What is the relation between force, mass, and acceleration?",
          expectedAnswer: "F=ma",
          questionType: "short_answer",
          evidenceType: "basic",
          scoringMode: "deterministic",
          answerKeyProvenance: "source_anchored",
          answerKeyValidationStatus: "verified",
          validatorType: "template_rule",
          validatorVersion: "template-v1",
          graderVersion: "grader-v1",
          sourceRefs: [sourceRef("p1")],
          scoringRules: { caseSensitive: false, trim: true }
        },
        {
          questionId: "force-transfer",
          question: "A 2kg body accelerates at 3m/s2. What force acts on it?",
          expectedAnswer: "6",
          questionType: "numeric",
          evidenceType: "transfer",
          scoringMode: "deterministic",
          answerKeyProvenance: "source_anchored",
          answerKeyValidationStatus: "verified",
          validatorType: "template_rule",
          validatorVersion: "template-v1",
          graderVersion: "numeric-v1",
          sourceRefs: [sourceRef("p2")],
          scoringRules: { tolerance: 0 }
        }
      ]
    }]
  };
}

function createAuth(accountId) {
  var issuer = auth.createInMemoryIssuer({
    testOnly: true,
    issuer: "socratopia-test",
    audience: "adaptive-teaching",
    secret: Buffer.alloc(32, 7),
    currentAuthState: { accountId: accountId, sessionEpoch: 1 },
    nowSeconds: function () { return 1_787_100_000; }
  });
  var request = { headers: { authorization: issuer.authorizationHeader() }, url: "http://127.0.0.1/api/adaptive-teaching" };
  return { issuer: issuer, context: issuer.verifier.verifyRequest(request, {}) };
}

function createHarness(root, settings) {
  settings = settings || {};
  var generation = settings.generation || { count: 0 };
  var storage = settings.storage || storageModule.createStorage({ rootDir: root });
  var timeIndex = settings.timeIndex || { value: 0 };
  var times = settings.times || ["2026-08-19T08:00:00.000Z", "2026-08-19T09:00:00.000Z", "2026-08-19T10:00:00.000Z"];
  var orchestrator = orchestratorModule.createOrchestrator({
    storage: storage,
    serverInstanceId: settings.serverInstanceId || "server-a",
    failureInjector: settings.failureInjector,
    validateTrustedContext: settings.validateTrustedContext,
    clock: function () {
      var selected = times[Math.min(timeIndex.value, times.length - 1)];
      timeIndex.value += 1;
      return new Date(selected);
    },
    builder: {
      buildConceptGraph: async function (input) {
        generation.count += 1;
        if (typeof settings.onBuild === "function") await settings.onBuild(input);
        assert.strictEqual(input.persist, false);
        return conceptGraph();
      }
    },
    diagnostician: {
      diagnose: async function (input) {
        if (typeof settings.onDiagnose === "function") await settings.onDiagnose(input);
        assert.strictEqual(input.persist, false);
        return { outcome: "correct", diagnosticConfidence: 0.99, misconceptionId: null };
      }
    }
  });
  return { orchestrator: orchestrator, storage: storage, generation: generation, timeIndex: timeIndex };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, function (error) { return error && error.code === code; });
}

async function mainFlow(root) {
  var harness = createHarness(root, { serverInstanceId: "server-a" });
  var orch = harness.orchestrator;
  var alice = createAuth("Alice");
  var context = alice.context;
  var service = orch.createServiceContext(context);
  await orch.initialize();

  var startInput = { requestId: "start-1", profileId: "Profile", worldId: "World", textbookId: "Physics" };
  var started = await orch.startSession(startInput, context);
  assert.strictEqual(started.conceptState.score, 0);
  assert.strictEqual(started.conceptState.baseState, "unseen");
  assert.strictEqual(harness.generation.count, 1);
  var replay = await orch.startSession(startInput, context);
  assert.deepStrictEqual(replay, started, "committed request replay returns the durable result verbatim");
  assert.strictEqual(harness.generation.count, 1, "request replay must not regenerate the graph");
  await expectCode(orch.startSession(Object.assign({}, startInput, { sourceText: "different" }), context), "idempotency_conflict");

  var publicStarted = await orch.handlePublicRequest(context, "POST", "startSession", {
    requestId: "public-start-1",
    profileId: "Profile",
    worldId: "World",
    textbookId: "Physics"
  });
  assert.strictEqual(publicStarted.assessment.question, "What is the relation between force, mass, and acceleration?");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(publicStarted.assessment, "answerKey"), false, "public assessment must not disclose its answer key");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(publicStarted.assessment, "answerKeyHash"), false, "public assessment must not disclose answer-key metadata");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(publicStarted.assessment, "scoringRules"), false, "public assessment must not disclose scoring rules");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(publicStarted.decision, "tutorContract"), false, "public decision must not disclose the server-only Tutor Contract");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(publicStarted.conceptState, "inputEventIds"), false, "public concept state must not disclose ledger internals");
  assert.strictEqual(publicStarted.decision.decisionId, publicStarted.decisionId);

  var publicState = await orch.handlePublicRequest(context, "GET", "state", {
    profileId: "Profile",
    worldId: "World",
    sessionId: publicStarted.sessionId
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(publicState.decision, "tutorContract"), false, "public GET state must use the same safe decision view");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(publicState.conceptState, "ledgerViewHash"), false, "public GET state must not disclose projection hashes");
  var publicBuildInput = null;
  var publicDiagnoseInput = null;
  var publicInputHarness = createHarness(root, {
    storage: harness.storage,
    serverInstanceId: "server-public-input",
    onBuild: async function (input) { publicBuildInput = input; },
    onDiagnose: async function (input) { publicDiagnoseInput = input; }
  });
  await publicInputHarness.orchestrator.initialize();
  var publicInputScope = publicInputHarness.storage.resolveScope({ accountId: "Alice", profileId: "Profile", worldId: "World", textbookId: "PublicInputBook" });
  var publicInputPayload = {
    requestId: "public-input-start",
    profileId: "Profile",
    worldId: "World",
    textbookId: "PublicInputBook",
    conceptGraph: conceptGraph(),
    sourceText: "CLIENT-CONTROLLED SOURCE",
    textbookTitle: "CLIENT-CONTROLLED TITLE",
    textbookDir: path.join(root, "accounts", "bob", "profiles", "profile", "worlds", "world", "textbooks", "publicinputbook"),
    dryRun: true
  };
  var publicInputStarted = await publicInputHarness.orchestrator.handlePublicRequest(context, "POST", "startSession", publicInputPayload);
  assert.strictEqual(publicInputHarness.generation.count, 1, "public start must not accept a client-supplied concept graph");
  assert(publicBuildInput, "public start must call the server-owned graph builder");
  assert.strictEqual(publicBuildInput.sourceText, undefined, "public start must not forward client source text");
  assert.strictEqual(publicBuildInput.textbookTitle, undefined, "public start must not forward a client textbook title");
  assert.strictEqual(publicBuildInput.textbookDir, publicInputScope.contentTextbookRoot, "builder must receive only the trusted account-scoped textbook directory");
  assert.strictEqual(publicBuildInput.dryRun, false, "public start must not enable dryRun");
  var publicInputReplay = await publicInputHarness.orchestrator.handlePublicRequest(context, "POST", "startSession", Object.assign({}, publicInputPayload, {
    conceptGraph: { client: "different" },
    sourceText: "DIFFERENT CLIENT SOURCE",
    textbookDir: path.join(root, "accounts", "mallory")
  }));
  assert.deepStrictEqual(publicInputReplay, publicInputStarted, "rejected public fields must not alter the idempotency hash");

  await publicInputHarness.orchestrator.handlePublicRequest(context, "POST", "prepareTurn", {
    requestId: "public-input-turn",
    profileId: "Profile",
    worldId: "World",
    sessionId: publicInputStarted.sessionId,
    turnId: "public-input-turn-1",
    assessmentId: publicInputStarted.assessment.assessmentId,
    learnerMessage: "wrong",
    assistanceLevel: "full",
    misconceptionId: "client-forged",
    dryRun: true,
    textbookId: "ForgedBook"
  });
  assert(publicDiagnoseInput, "public prepareTurn must invoke the diagnostician");
  assert.strictEqual(publicDiagnoseInput.dryRun, false, "public prepareTurn must not enable dryRun");
  var publicEvidence = publicInputHarness.storage.listArtifacts(publicInputScope, "evidence/").map(function (entry) { return entry.value; }).find(function (event) {
    return event.turnId === "public-input-turn-1";
  });
  assert(publicEvidence, "public prepareTurn must commit its evidence event");
  assert.strictEqual(publicEvidence.assistanceLevel, "none", "public prepareTurn must not accept a client-forged assistance level");
  assert.notStrictEqual(publicEvidence.misconceptionId, "client-forged", "public prepareTurn must not accept a client-forged misconception id");

  var state0 = await orch.getState({ profileId: "Profile", worldId: "World", sessionId: started.sessionId }, context);
  assert.strictEqual(state0.pendingDecisionId, started.decisionId);

  var self = await orch.prepareTurn({
    requestId: "turn-self",
    profileId: "Profile",
    worldId: "World",
    sessionId: started.sessionId,
    turnId: "turn-1",
    assessmentId: started.assessment.assessmentId,
    learnerMessage: "我理解了"
  }, context);
  assert.strictEqual(self.conceptState.score, 0);
  assert.strictEqual(self.decision.action, "check");

  var correctInput = {
    requestId: "turn-correct",
    profileId: "Profile",
    worldId: "World",
    sessionId: started.sessionId,
    turnId: "turn-2",
    assessmentId: self.assessment.assessmentId,
    learnerMessage: "F=ma"
  };
  var correct = await orch.prepareTurn(correctInput, context);
  assert(correct.conceptState.score > 0, "verified deterministic evidence changes mastery");
  assert.strictEqual(correct.conceptState.hasIndependentBasic, true);
  assert.strictEqual(correct.decision.action, "assess_transfer");
  var aliceScope = harness.storage.resolveScope({ accountId: "Alice", profileId: "Profile", worldId: "World", textbookId: "Physics" });
  var correctTransactionId = orch.journal.transactionIdFor(aliceScope.mutationScopeKey, "prepareTurn", correctInput.requestId);
  var correctTransaction = orch.journal.readTransaction(aliceScope, correctTransactionId);
  var committedEvents = harness.storage.listArtifacts(aliceScope, "evidence/").map(function (entry) { return entry.value; }).filter(function (event) {
    return event.textbookId === aliceScope.textbookId && orch.journal.isCommitted(aliceScope, event.producingTransactionId);
  });
  assert.strictEqual(correctTransaction.prospectiveLedgerHash, evidenceModule.buildLedgerView(committedEvents).ledgerViewHash);
  assert.strictEqual(correctTransaction.targetProjectionHash, masteryModule.replayConcept(committedEvents, "force").projectionHash, "pre-commit projection equals committed-ledger replay");

  var duplicate = await orch.prepareTurn(Object.assign({}, correctInput, { requestId: "turn-correct-duplicate" }), context);
  assert.strictEqual(duplicate.duplicateEvidence, true);
  assert.strictEqual(duplicate.evidenceEventId, correct.evidenceEventId);
  await expectCode(orch.prepareTurn(Object.assign({}, correctInput, { requestId: "turn-correct-conflict", learnerMessage: "wrong" }), context), "evidence_conflict");

  await expectCode(orch.prepareTurn(Object.assign({}, correctInput, { learnerMessage: "changed after commit" }), context), "idempotency_conflict");

  var bobHarness = createHarness(root, { storage: harness.storage, serverInstanceId: "server-bob" });
  await bobHarness.orchestrator.initialize();
  var bob = createAuth("Bob");
  var bobStart = await bobHarness.orchestrator.startSession({ requestId: "start-1", profileId: "Profile", worldId: "World", textbookId: "Physics" }, bob.context);
  assert.notStrictEqual(bobStart.sessionId, started.sessionId);
  var bobState = await bobHarness.orchestrator.getState({ profileId: "Profile", worldId: "World", sessionId: bobStart.sessionId }, bob.context);
  assert.strictEqual(bobState.conceptState.score, 0, "accounts with identical child ids remain isolated");

  var concurrent = await Promise.all([
    orch.startSession({ requestId: "start-concurrent-a", profileId: "Profile", worldId: "World", textbookId: "Physics" }, context),
    orch.startSession({ requestId: "start-concurrent-b", profileId: "Profile", worldId: "World", textbookId: "Physics" }, context)
  ]);
  assert.notStrictEqual(concurrent[0].sessionId, concurrent[1].sessionId);
  var concurrentTurns = await Promise.all([
    orch.prepareTurn({ requestId: "same-session-a", profileId: "Profile", worldId: "World", sessionId: started.sessionId, turnId: "turn-2a", assessmentId: duplicate.assessment.assessmentId, learnerMessage: "6" }, context),
    orch.prepareTurn({ requestId: "same-session-b", profileId: "Profile", worldId: "World", sessionId: started.sessionId, turnId: "turn-2b", assessmentId: duplicate.assessment.assessmentId, learnerMessage: "6" }, context)
  ]);
  assert.notStrictEqual(concurrentTurns[0].evidenceEventId, concurrentTurns[1].evidenceEventId);
  var stateForClaim = await orch.getState({ profileId: "Profile", worldId: "World", sessionId: started.sessionId }, context);
  var decisionForClaim = stateForClaim.pendingDecisionId;

  var claims = await Promise.all([
    orch.claimDecision({ requestId: "claim-a", profileId: "Profile", worldId: "World", decisionId: decisionForClaim }, service),
    orch.claimDecision({ requestId: "claim-b", profileId: "Profile", worldId: "World", decisionId: decisionForClaim }, service)
  ]);
  assert.strictEqual(claims[0].executionId, claims[1].executionId);
  assert.strictEqual([claims[0].alreadyClaimed, claims[1].alreadyClaimed].filter(Boolean).length, 1);
  var firstClaim = claims.find(function (claim) { return !claim.alreadyClaimed; });
  var duplicateClaim = claims.find(function (claim) { return claim.alreadyClaimed; });
  assert.strictEqual(firstClaim.executionGranted, true, "only the first claim receives execution authority");
  assert.strictEqual(duplicateClaim.executionGranted, false, "duplicate claims expose status without execution authority");
  assert(firstClaim.executionContract, "the first claim receives a server-only execution contract");
  assert.deepStrictEqual(Object.keys(firstClaim.executionContract).sort(), ["action", "assessmentId", "conceptId", "decisionId", "difficulty", "reasonCodes", "rulesVersion", "sessionId", "tutorContract"].sort());
  assert.deepStrictEqual(Object.keys(firstClaim.executionContract.tutorContract).sort(), ["expectedEvidenceType", "forbiddenMoves", "hintLevel", "maxQuestions", "objective", "requiredMove"].sort());
  assert.strictEqual(firstClaim.executionContract.decisionId, decisionForClaim);
  assert.strictEqual(firstClaim.executionContract.tutorContract.maxQuestions, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(duplicateClaim, "executionContract"), false, "duplicate claims never receive the Tutor Contract or execution authority");
  var executionId = claims[0].executionId;
  await orch.markDecisionOutputStarted({ requestId: "output-a", profileId: "Profile", worldId: "World", executionId: executionId }, service);
  var completed = await orch.recordTutorResponse({ requestId: "response-a", profileId: "Profile", worldId: "World", executionId: executionId, status: "completed", contentHash: "sha256:content-a", actualStrategy: "assess_transfer" }, service);
  assert.strictEqual(completed.terminalType, "completed");
  await expectCode(orch.recordTutorResponse({ requestId: "response-conflict", profileId: "Profile", worldId: "World", executionId: executionId, status: "failed", errorCode: "late" }, service), "execution_terminal_conflict");
  var raceClaim = await orch.claimDecision({ requestId: "claim-terminal-race", profileId: "Profile", worldId: "World", decisionId: concurrent[0].decisionId }, service);
  await orch.markDecisionOutputStarted({ requestId: "output-terminal-race", profileId: "Profile", worldId: "World", executionId: raceClaim.executionId }, service);
  var terminalRace = await Promise.allSettled([
    orch.recordTutorResponse({ requestId: "terminal-race-complete", profileId: "Profile", worldId: "World", executionId: raceClaim.executionId, status: "completed", contentHash: "sha256:race" }, service),
    orch.recordTutorResponse({ requestId: "terminal-race-fail", profileId: "Profile", worldId: "World", executionId: raceClaim.executionId, status: "failed", errorCode: "race" }, service)
  ]);
  assert.strictEqual(terminalRace.filter(function (entry) { return entry.status === "fulfilled"; }).length, 1, "only one terminal can commit");
  assert.strictEqual(terminalRace.filter(function (entry) { return entry.status === "rejected" && entry.reason && entry.reason.code === "execution_terminal_conflict"; }).length, 1);

  var next = await orch.prepareTurn({
    requestId: "turn-next",
    profileId: "Profile",
    worldId: "World",
    sessionId: started.sessionId,
    turnId: "turn-3",
    assessmentId: duplicate.assessment.assessmentId,
    learnerMessage: "6"
  }, context);
  var failedClaim = await orch.claimDecision({ requestId: "claim-failed", profileId: "Profile", worldId: "World", decisionId: next.decisionId }, service);
  var failed = await orch.recordTutorResponse({ requestId: "response-failed", profileId: "Profile", worldId: "World", executionId: failedClaim.executionId, status: "failed", errorCode: "model_failed" }, service);
  assert(failed.replacementDecisionId);
  var failedState = await orch.getState({ profileId: "Profile", worldId: "World", sessionId: started.sessionId }, context);
  assert.strictEqual(failedState.pendingDecisionId, failed.replacementDecisionId);
  assert.notStrictEqual(failedState.pendingDecisionId, next.decisionId);
  var failedReplay = await orch.recordTutorResponse({ requestId: "response-failed-retry", profileId: "Profile", worldId: "World", executionId: failedClaim.executionId, status: "failed", errorCode: "model_failed" }, service);
  assert.strictEqual(failedReplay.duplicate, true);

  var restartClaim = await orch.claimDecision({ requestId: "claim-restart", profileId: "Profile", worldId: "World", decisionId: failed.replacementDecisionId }, service);
  var restartHarness = createHarness(root, { storage: harness.storage, serverInstanceId: "server-restart" });
  var restarted = restartHarness.orchestrator;
  var restartReady = await restarted.initialize();
  assert.strictEqual(restartReady.ok, true);
  var restartContext = createAuth("Alice").context;
  var restartService = restarted.createServiceContext(restartContext);
  var abandonedState = await restarted.getState({ profileId: "Profile", worldId: "World", sessionId: started.sessionId }, restartContext);
  assert.notStrictEqual(abandonedState.pendingDecisionId, failed.replacementDecisionId, "startup reconciler replaces an unstarted old execution");
  var abandonedReplacement = abandonedState.pendingDecisionId;

  var indeterminateClaim = await restarted.claimDecision({ requestId: "claim-indeterminate", profileId: "Profile", worldId: "World", decisionId: abandonedReplacement }, restartService);
  await restarted.markDecisionOutputStarted({ requestId: "output-indeterminate", profileId: "Profile", worldId: "World", executionId: indeterminateClaim.executionId }, restartService);
  var finalHarness = createHarness(root, { storage: harness.storage, serverInstanceId: "server-final" });
  await finalHarness.orchestrator.initialize();
  var finalContext = createAuth("Alice").context;
  var finalState = await finalHarness.orchestrator.getState({ profileId: "Profile", worldId: "World", sessionId: started.sessionId }, finalContext);
  assert.notStrictEqual(finalState.pendingDecisionId, abandonedReplacement, "output_started from a dead instance becomes indeterminate and gets one recovery target");

  await expectCode(orch.handlePublicRequest(context, "POST", "claimDecision", { decisionId: started.decisionId }), "forbidden");
  assert(restartClaim.executionId);
  console.log("PASS: adaptive orchestrator public loop, idempotency, account isolation, execution state, and restart reconcile");
}

async function markerRecovery(root) {
  var storage = storageModule.createStorage({ rootDir: root });
  var crashPoint = "after_commit_marker";
  var generation = { count: 0 };
  var first = createHarness(root, { storage: storage, serverInstanceId: "server-crash", generation: generation, failureInjector: function (point) { return point === crashPoint; } });
  var trusted = createAuth("CrashAccount").context;
  var input = { requestId: "crash-start", profileId: "Profile", worldId: "World", textbookId: "Physics" };
  await assert.rejects(first.orchestrator.startSession(input, trusted), function (error) { return error && error.code === "injected_crash"; });
  assert.strictEqual(generation.count, 1);
  crashPoint = null;
  var second = createHarness(root, { storage: storage, serverInstanceId: "server-after-crash", generation: generation });
  await second.orchestrator.initialize();
  var sessionId = "session_" + require("./transaction-journal.js").hashCanonical([storage.resolveScope({ accountId: "CrashAccount", profileId: "Profile", worldId: "World", textbookId: "Physics" }).mutationScopeKey, input.requestId]).slice(0, 32);
  var state = await second.orchestrator.getState({ profileId: "Profile", worldId: "World", sessionId: sessionId }, trusted);
  assert.strictEqual(state.status, "active");
  assert.strictEqual(generation.count, 1, "marker recovery must use durable payload without regeneration");
  console.log("PASS: marker-after-commit recovery is locator-routable and generation-free");
}

async function epochCommitGate(root) {
  var identity = createAuth("EpochAccount");
  var harness = createHarness(root, {
    serverInstanceId: "server-epoch",
    validateTrustedContext: identity.issuer.verifier.assertCurrentContext,
    onBuild: async function () {
      identity.issuer.setCurrentAuthState({ accountId: "EpochAccount", sessionEpoch: 2 });
    }
  });
  await harness.orchestrator.initialize();
  await expectCode(harness.orchestrator.startSession({ requestId: "epoch-start", profileId: "Profile", worldId: "World", textbookId: "Physics" }, identity.context), "auth_epoch_mismatch");
  var scope = harness.storage.resolveScope({ accountId: "EpochAccount", profileId: "Profile", worldId: "World", textbookId: "Physics" });
  assert.strictEqual(harness.storage.listArtifacts(scope, "transactions/").length, 0, "epoch change during generation is rejected before prepared write");
  console.log("PASS: capability epoch is revalidated after generation and before prepared write");
}

async function run() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-adaptive-teaching-"));
  var crashRoot = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-adaptive-crash-"));
  var epochRoot = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-adaptive-epoch-"));
  try {
    await mainFlow(root);
    await markerRecovery(crashRoot);
    await epochCommitGate(epochRoot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(crashRoot, { recursive: true, force: true });
    fs.rmSync(epochRoot, { recursive: true, force: true });
  }
}

run().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
