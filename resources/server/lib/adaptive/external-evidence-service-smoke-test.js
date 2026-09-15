"use strict";

var assert = require("assert");
var facadeModule = require("./external-evidence-service.js");

function coded(code, status) {
  var error = new Error(code);
  error.code = code;
  error.status = status || 403;
  return error;
}

function request(token) {
  return { headers: { get: function (name) { return name.toLowerCase() === "authorization" ? token : null; } } };
}

function makeHarness(overrides) {
  overrides = overrides || {};
  var current = { accountId: "account-a", sessionEpoch: 7, active: true };
  var calls = [];
  var contexts = [];
  var seen = new Map();
  var graph = overrides.graph || { concepts: [{ conceptId: "concept-a", title: "Algebra", aliases: ["linear equations"] }] };
  var verifier = {
    verifyRequest: async function (req) {
      var token = req.headers.get("Authorization");
      if (token === "Socratopia expired-token-000") throw coded("auth_token_expired", 401);
      if (token === "Socratopia invalid-token-000") throw coded("auth_invalid_token", 401);
      if (token === "Socratopia wrong-epoch-token") return { accountId: "account-a", sessionEpoch: 6 };
      if (token === "Socratopia account-b-token-00") return { accountId: "account-b", sessionEpoch: 3 };
      if (token !== "Socratopia valid-token-00000") throw coded("auth_missing_capability", 401);
      return { accountId: "account-a", sessionEpoch: 7 };
    },
    assertCurrentContext: function (ctx) {
      if (ctx.accountId === "account-a" && current.accountId === "account-a" && ctx.sessionEpoch === current.sessionEpoch) return;
      if (ctx.accountId === "account-b" && current.accountId === "account-b" && ctx.sessionEpoch === current.sessionEpoch) return;
      throw coded("auth_epoch_mismatch", 403);
    }
  };
  var orchestrator = {
    awaitReady: async function () { return { ok: true }; },
    createServiceContext: function (ctx) { return { accountId: ctx.accountId }; },
    storage: { resolveScope: function () { return { storageTextbookId: "tb-storage" }; } },
    journal: { readCommitted: function () { return graph; } },
    recordExternalEvidence: async function (payload, serviceContext) {
      calls.push({ payload: payload, serviceContext: serviceContext });
      var prior = seen.get(payload.sourceEventId);
      if (prior && prior !== payload.eventInputHash) throw coded("evidence_conflict", 409);
      if (prior) return { duplicateEvidence: true };
      seen.set(payload.sourceEventId, payload.eventInputHash);
      return { duplicateEvidence: false };
    }
  };
  var service = facadeModule.createExternalEvidenceService({
    verifier: verifier,
    orchestrator: overrides.noOrchestrator ? null : orchestrator,
    readinessPromise: overrides.readiness || Promise.resolve({ ok: true }),
    accountRequestContext: {
      run: function (accountId, callback) { contexts.push(accountId); return callback(); }
    },
    getAccountContext: async function (input) {
      var id = input.requestContext.accountId;
      if (id === "account-b" && current.accountId === "account-b") return current;
      return current;
    },
    isEligible: async function () { return overrides.eligible !== false; }
  });
  return {
    service: service,
    calls: calls,
    contexts: contexts,
    setCurrent: function (value) { current = value; },
    setGraph: function (value) { graph = value; }
  };
}

function verifiedSpec(extra) {
  return Object.assign({
    source: "practice",
    profileId: "profile-a",
    worldId: "world-a",
    textbookId: "textbook-a",
    itemId: "problem-set-a",
    subItemId: "problem-a",
    conceptCandidates: ["Algebra"],
    gradingMode: "deterministic",
    outcome: "correct",
    questionType: "choice",
    answerKey: 1,
    answerKeyProvenance: "external_verified",
    answerKeyValidationStatus: "verified",
    validatorType: "external_contract",
    validatorVersion: "fixture-validator-v1",
    assessmentVersion: "fixture-assessment-v1",
    graderVersion: "fixture-grader-v1",
    externalContract: { contractId: "fixture-contract", version: "1" },
    contractVerified: true,
    assistanceLevel: "none",
    evidenceType: "basic"
  }, extra || {});
}

function finalize(service, handle, spec, revision) {
  var draft = service.prepareObservation(handle, spec);
  return service.finalizeObservation(handle, draft, {
    domainRevision: revision || 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    businessReceipt: { kind: "fixture", revision: revision || 1 }
  });
}

async function expectCode(promise, code) {
  var failure = null;
  try { await promise; } catch (error) { failure = error; }
  assert(failure, "expected failure " + code);
  assert.strictEqual(failure.code, code);
}

async function main() {
  var count = 0;
  function ok(value, message) { assert(value, message); count += 1; }

  var h = makeHarness();
  var handle = await h.service.authorizeRequest(request("Socratopia valid-token-00000"), {});
  ok(h.service.statusForHandle(handle).active, "valid capability should activate facade");
  await expectCode(h.service.authorizeRequest(request("Socratopia invalid-token-000"), {}), "auth_invalid_token"); count += 1;
  await expectCode(h.service.authorizeRequest(request("Socratopia expired-token-000"), {}), "auth_token_expired"); count += 1;
  await expectCode(h.service.authorizeRequest(request("Socratopia wrong-epoch-token"), {}), "auth_epoch_mismatch"); count += 1;

  var verified = finalize(h.service, handle, verifiedSpec(), 1);
  ok(/^sha256:/.test(verified.businessReceipt.businessReceiptHash), "receipt should carry canonical hash");
  ok(verified.conceptResolution.status === "resolved" && verified.conceptResolution.conceptId === "concept-a", "unique concept should resolve");
  var committed = await h.service.recordPending(handle, verified);
  ok(committed.state === "committed", "verified fixture should commit verified evidence");
  var duplicate = await h.service.recordPending(handle, verified);
  ok(duplicate.state === "duplicate", "same event and input should deduplicate");

  var conflicting = finalize(h.service, handle, verifiedSpec({ outcome: "incorrect" }), 1);
  var conflict = await h.service.recordPending(handle, conflicting);
  ok(conflict.state === "conflict", "same event with different hash should conflict");

  h.setGraph({ concepts: [] });
  var missing = finalize(h.service, handle, verifiedSpec(), 2);
  var missingResult = await h.service.recordPending(handle, missing);
  ok(missing.conceptResolution.status === "missing" && missingResult.state === "pending" && h.calls.length === 3, "missing mapping must not call orchestrator");

  h.setGraph({ concepts: [
    { conceptId: "concept-a", title: "A", aliases: ["shared"] },
    { conceptId: "concept-b", title: "B", aliases: ["shared"] }
  ] });
  var ambiguous = finalize(h.service, handle, verifiedSpec({ conceptCandidates: ["shared"] }), 3);
  ok(ambiguous.conceptResolution.status === "ambiguous" && ambiguous.eventInputHash === null, "ambiguous mapping must not freeze ledger hash");

  h.setGraph({ concepts: [{ conceptId: "concept-a", title: "Algebra" }] });
  var llmKey = finalize(h.service, handle, verifiedSpec({
    answerKeyProvenance: "llm_generated",
    answerKeyValidationStatus: "verified",
    validatorType: "external_contract"
  }), 4);
  var llmKeyResult = await h.service.recordPending(handle, llmKey);
  ok(llmKeyResult.state === "unverified" && llmKeyResult.reasonCode === "answer_key_unverified", "LLM answer key must stay unverified");

  var beforeSubjective = h.calls.length;
  var subjective = finalize(h.service, handle, verifiedSpec({ gradingMode: "llm_assisted" }), 5);
  var subjectiveResult = await h.service.recordPending(handle, subjective);
  ok(subjectiveResult.state === "unverified" && h.calls.length === beforeSubjective, "subjective LLM grading must remain local observation");

  var inactiveHarness = makeHarness({ eligible: false });
  var inactiveHandle = await inactiveHarness.service.authorizeRequest(request("Socratopia valid-token-00000"), {});
  ok(!inactiveHarness.service.statusForHandle(inactiveHandle).active && inactiveHarness.service.prepareObservation(inactiveHandle, verifiedSpec()) === null, "ineligible request should preserve business-only mode");

  await h.service.runAuthorized(handle, function () { return true; });
  var accountAIntent = verified;
  h.setCurrent({ accountId: "account-b", sessionEpoch: 3, active: true });
  var accountBHandle = await h.service.authorizeRequest(request("Socratopia account-b-token-00"), {});
  await expectCode(h.service.recordPending(accountBHandle, accountAIntent), "auth_account_mismatch"); count += 1;
  ok(h.service.bindingForHandle(handle) !== h.service.bindingForHandle(accountBHandle), "account bindings must be opaque and isolated");

  var lockOrder = [];
  var first = h.service.withSourceLock(accountBHandle, { profileId: "p", worldId: "w", textbookId: "t", source: "flashcard", itemId: "c" }, async function () {
    lockOrder.push("first-start");
    await new Promise(function (resolve) { setTimeout(resolve, 15); });
    lockOrder.push("first-end");
  });
  var second = h.service.withSourceLock(accountBHandle, { profileId: "p", worldId: "w", textbookId: "t", source: "flashcard", itemId: "c" }, async function () {
    lockOrder.push("second");
  });
  await Promise.all([first, second]);
  ok(lockOrder.join(",") === "first-start,first-end,second", "source lock should serialize same source");

  await h.service.runAuthorized(accountBHandle, function () { return true; });
  ok(h.contexts.indexOf("account-a") >= 0 && h.contexts.indexOf("account-b") >= 0, "authorized callbacks should run in the verified account context");

  console.log("external-evidence-service smoke: " + count + "/" + count + " passed");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
