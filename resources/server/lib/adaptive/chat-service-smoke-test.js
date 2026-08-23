"use strict";

var assert = require("assert");
var chatModule = require("./chat-service.js");
var createAccountRequestContext = require("../account-request-context.js").createAccountRequestContext;

function contract(decisionId) {
  return {
    decisionId: decisionId,
    sessionId: "session-1",
    conceptId: "concept-1",
    action: "check",
    difficulty: "same",
    reasonCodes: ["CONSERVATIVE_CHECK"],
    assessmentId: "assessment-1",
    rulesVersion: "policy-v1",
    ignored: "must not cross the boundary",
    tutorContract: {
      objective: "Collect independently scored evidence.",
      requiredMove: "Ask exactly one check question.",
      forbiddenMoves: ["DO_NOT_DECLARE_MASTERY"],
      hintLevel: "none",
      expectedEvidenceType: "basic",
      maxQuestions: 1,
      ignored: "must not cross the boundary"
    }
  };
}

function createHarness(overrides) {
  overrides = overrides || {};
  var calls = [];
  var authState = { active: true, accountId: "Alice", sessionEpoch: 7 };
  var requestContext = Object.freeze({ accountId: "Alice", sessionEpoch: 7 });
  var duplicate = false;
  var eligible = true;
  var accountRequestContext = createAccountRequestContext();
  var verifier = {
    verifyRequest: async function (_request, body) {
      calls.push("verify");
      if (body && Object.prototype.hasOwnProperty.call(body, "accountId")) {
        var rawError = new Error("raw account selector");
        rawError.code = "raw_account_selector";
        rawError.status = 400;
        throw rawError;
      }
      return requestContext;
    },
    assertCurrentContext: function (context) {
      calls.push("assert-current");
      if (context.accountId !== authState.accountId || context.sessionEpoch !== authState.sessionEpoch) {
        var stale = new Error("stale context");
        stale.code = "auth_epoch_mismatch";
        stale.status = 403;
        throw stale;
      }
      return context;
    }
  };
  var orchestrator = {
    awaitReady: async function () { calls.push("ready"); return { ok: true }; },
    createServiceContext: function (context) { calls.push("service-context"); return Object.freeze({ requestContext: context }); },
    claimDecision: async function (input) {
      calls.push("claim");
      if (duplicate) return { ok: true, alreadyClaimed: true, executionGranted: false, decisionId: input.decisionId, executionId: "execution-existing" };
      return { ok: true, executionGranted: true, decisionId: input.decisionId, executionId: "execution-1", executionContract: contract(input.decisionId) };
    },
    markDecisionOutputStarted: async function () { calls.push("mark"); return { ok: true, eventId: "event-output", outputStartedAt: "2026-08-19T00:00:00.000Z" }; },
    recordTutorResponse: async function (input) {
      calls.push("terminal:" + input.status);
      calls.push({ record: input });
      return { ok: true, executionId: input.executionId, terminalType: input.status };
    }
  };
  if (overrides.orchestrator) Object.assign(orchestrator, overrides.orchestrator);
  var service = chatModule.createChatService({
    verifier: verifier,
    orchestrator: orchestrator,
    getAccountContext: async function () { calls.push("account-context"); return Object.assign({}, authState); },
    accountRequestContext: accountRequestContext,
    isEligible: async function () { calls.push("eligible"); return eligible; }
  });
  return {
    service: service,
    calls: calls,
    authState: authState,
    accountRequestContext: accountRequestContext,
    setDuplicate: function (value) { duplicate = value; },
    setEligible: function (value) { eligible = value; }
  };
}

var nextRequest = 0;
function beginInput() {
  nextRequest += 1;
  return {
    requestId: "chat-send-" + nextRequest,
    profileId: "Profile",
    worldId: "World",
    adaptiveDecisionId: "decision-" + nextRequest
  };
}

function chatRequest(body, extraHeaders) {
  var headers = new Headers(extraHeaders || {});
  headers.set("Content-Type", "application/json");
  return new Request("http://127.0.0.1:3000/api/chat", {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body)
  });
}

function adaptiveBody(overrides) {
  return Object.assign({
    messages: [{ role: "user", content: "hello" }],
    profileId: "Profile",
    worldId: "World",
    adaptiveDecisionId: "decision-dispatch",
    adaptiveRequestId: "request-dispatch"
  }, overrides || {});
}

async function expectCode(promise, code) {
  var caught = null;
  try { await promise; } catch (error) { caught = error; }
  assert(caught, "expected error " + code);
  assert.strictEqual(caught.code, code);
}

async function main() {
  assert.throws(function () { chatModule.createChatService({}); }, /verifier/);

  var ordinaryHarness = createHarness();
  var ordinaryCalls = 0;
  var ordinaryRequest = chatRequest({ messages: [{ role: "user", content: "ordinary" }] });
  var ordinaryResponse = await ordinaryHarness.service.dispatch(ordinaryRequest, function (request) {
    ordinaryCalls++;
    assert.strictEqual(request, ordinaryRequest, "ordinary request must reach the original core unchanged");
    return new Response("ordinary");
  });
  assert.strictEqual(await ordinaryResponse.text(), "ordinary");
  assert.strictEqual(ordinaryCalls, 1);
  assert.strictEqual(ordinaryHarness.calls.indexOf("verify"), -1);
  assert.strictEqual(ordinaryHarness.calls.indexOf("claim"), -1);

  var malformedHarness = createHarness();
  var malformedCoreCalls = 0;
  var malformedResponse = await malformedHarness.service.dispatch(chatRequest(adaptiveBody({
    adaptiveDecisionId: null
  })), function () {
    malformedCoreCalls++;
  });
  assert.strictEqual(malformedResponse.status, 400);
  assert.strictEqual(malformedCoreCalls, 0);
  assert.strictEqual(malformedHarness.calls.indexOf("claim"), -1);

  var specialHarness = createHarness();
  var specialCoreCalls = 0;
  var specialResponse = await specialHarness.service.dispatch(chatRequest(adaptiveBody({
    autoReply: true
  })), function () {
    specialCoreCalls++;
  });
  assert.strictEqual(specialResponse.status, 409);
  assert.strictEqual((await specialResponse.json()).safeToFallback, true);
  assert.strictEqual(specialCoreCalls, 0);
  assert.strictEqual(specialHarness.calls.indexOf("claim"), -1);

  var closeHarnessDispatch = createHarness();
  global.__CLOSE_READING__ = { isCommand: function () { return true; } };
  var closeResponse = await closeHarnessDispatch.service.dispatch(chatRequest(adaptiveBody()), function () {
    throw new Error("close-reading must not call core");
  });
  delete global.__CLOSE_READING__;
  assert.strictEqual(closeResponse.status, 409);
  assert.strictEqual(closeHarnessDispatch.calls.indexOf("claim"), -1);

  var dispatchHarness = createHarness();
  var dispatchCoreCalls = 0;
  var dispatched = await dispatchHarness.service.dispatch(chatRequest(adaptiveBody()), async function (request) {
    dispatchCoreCalls++;
    assert.strictEqual(dispatchHarness.accountRequestContext.getAccountId(), "Alice");
    var coreBody = await request.json();
    assert.strictEqual(coreBody.messages[0].role, "system");
    assert(coreBody.messages[0].content.indexOf("Committed Adaptive Tutor Contract") >= 0);
    assert(coreBody.messages[0].content.indexOf("must not cross the boundary") < 0);
    return new Response("data: {\"type\":\"text\",\"text\":\"answer\"}\n\ndata: {\"type\":\"done\"}\n\n", {
      headers: { "Content-Type": "text/event-stream" }
    });
  });
  assert.strictEqual(await dispatched.text(), "data: {\"type\":\"text\",\"text\":\"answer\"}\n\ndata: {\"type\":\"done\"}\n\n");
  assert.strictEqual(dispatchCoreCalls, 1);
  assert.strictEqual(dispatchHarness.calls.filter(function (entry) { return entry === "claim"; }).length, 1);
  assert.strictEqual(dispatchHarness.calls.filter(function (entry) { return entry === "terminal:completed"; }).length, 1);

  var duplicateDispatchHarness = createHarness();
  duplicateDispatchHarness.setDuplicate(true);
  var duplicateCoreCalls = 0;
  var duplicateResponse = await duplicateDispatchHarness.service.dispatch(chatRequest(adaptiveBody()), function () {
    duplicateCoreCalls++;
  });
  assert.strictEqual(duplicateResponse.status, 409);
  assert.strictEqual(duplicateCoreCalls, 0);
  assert.strictEqual(duplicateDispatchHarness.calls.indexOf("mark"), -1);
  assert.strictEqual(duplicateDispatchHarness.calls.filter(function (entry) { return typeof entry === "string" && entry.indexOf("terminal:") === 0; }).length, 0);

  var harness = createHarness();
  var input = beginInput();
  var begun = await harness.service.begin({ headers: {} }, { messages: [{ role: "user", content: "hello" }] }, input);
  assert.strictEqual(Object.keys(begun.handle).length, 0, "execution handle must be opaque");
  assert.strictEqual(Object.isFrozen(begun.handle), true);
  assert.deepStrictEqual(Object.keys(begun.executionContract).sort(), ["action", "assessmentId", "conceptId", "decisionId", "difficulty", "reasonCodes", "rulesVersion", "sessionId", "tutorContract"].sort());
  assert.strictEqual(Object.prototype.hasOwnProperty.call(begun.executionContract, "ignored"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(begun.executionContract.tutorContract, "ignored"), false);
  assert.strictEqual(Object.isFrozen(begun.executionContract.tutorContract.forbiddenMoves), true);
  assert.strictEqual(harness.accountRequestContext.getAccountId(), null);
  var runAccount = await harness.service.run(begun.handle, async function () {
    await Promise.resolve();
    return harness.accountRequestContext.getAccountId();
  });
  assert.strictEqual(runAccount, "Alice");
  assert.strictEqual(harness.accountRequestContext.getAccountId(), null);
  await expectCode(harness.service.run(begun.handle, function () {}), "execution_already_started");
  assert.deepStrictEqual(harness.calls.slice(0, 9), ["verify", "ready", "verify", "assert-current", "account-context", "eligible", "assert-current", "account-context", "service-context"]);
  assert.strictEqual(harness.calls[9], "claim");

  await expectCode(Promise.resolve().then(function () { return harness.service.markOutputStarted(Object.freeze({})); }), "invalid_execution_handle");

  var streamEvents = [];
  var gate = harness.service.createStreamGate(begun.handle, {
    emit: async function (event) { harness.calls.push("sink:" + event.type); streamEvents.push(event.type + (event.value || "")); },
    close: function () { streamEvents.push("closed"); }
  });
  var first = gate.emit({ type: "text", value: "1" });
  var second = gate.emit({ type: "text", value: "2" });
  await Promise.all([first, second]);
  var completed = await gate.done({ content: "answer text", messageRef: "message-1" });
  await gate.close();
  assert.strictEqual(completed.terminalType, "completed");
  assert.deepStrictEqual(streamEvents, ["text1", "text2", "done", "closed"]);
  var markIndex = harness.calls.indexOf("mark");
  var terminalIndex = harness.calls.indexOf("terminal:completed");
  assert(markIndex >= 0 && harness.calls.indexOf("sink:text") > markIndex, "mark must commit before the first sink event");
  assert(terminalIndex > markIndex && harness.calls.indexOf("sink:done") > terminalIndex, "completed terminal must commit before done");
  var completedRecord = harness.calls.find(function (entry) { return entry && entry.record && entry.record.status === "completed"; }).record;
  assert(/^sha256:[a-f0-9]{64}$/.test(completedRecord.contentHash));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(completedRecord, "content"), false, "raw tutor content must not enter the transaction API");
  assert.strictEqual(completedRecord.actualStrategy, "check");

  var wrappedHarness = createHarness();
  var wrappedBegin = await wrappedHarness.service.begin({ headers: {} }, { messages: [] }, beginInput());
  var encoded = new TextEncoder();
  var source = new ReadableStream({
    start: function (controller) {
      controller.enqueue(encoded.encode("data: {\"type\":\"text\",\"text\":\"hel"));
      controller.enqueue(encoded.encode("lo\"}\n\ndata: {\"type\":\"done\"}\n\n"));
      controller.close();
    }
  });
  var wrapped = await wrappedHarness.service.wrapResponse(wrappedBegin.handle, new Response(source, {
    headers: { "Content-Type": "text/event-stream", "Content-Length": "99" }
  }));
  assert.strictEqual(wrapped.headers.has("content-length"), false);
  assert.strictEqual(await wrapped.text(), "data: {\"type\":\"text\",\"text\":\"hello\"}\n\ndata: {\"type\":\"done\"}\n\n");
  assert(wrappedHarness.calls.indexOf("terminal:completed") > wrappedHarness.calls.indexOf("mark"));
  var wrappedRecord = wrappedHarness.calls.find(function (entry) { return entry && entry.record && entry.record.status === "completed"; }).record;
  assert.strictEqual(wrappedRecord.contentHash, "sha256:" + require("crypto").createHash("sha256").update("hello").digest("hex"));

  var rejectedHarness = createHarness();
  var rejectedBegin = await rejectedHarness.service.begin({ headers: {} }, { messages: [] }, beginInput());
  var rejected = new Response("bad request", { status: 400, headers: { "Content-Type": "application/json" } });
  assert.strictEqual(await rejectedHarness.service.wrapResponse(rejectedBegin.handle, rejected), rejected);
  assert.strictEqual(rejectedHarness.calls.filter(function (entry) { return entry === "terminal:failed"; }).length, 1);

  var closeHarness = createHarness();
  var closeBegin = await closeHarness.service.begin({ headers: {} }, { messages: [] }, beginInput());
  var closeGate = closeHarness.service.createStreamGate(closeBegin.handle, { emit: function () {}, close: function () {} });
  await expectCode(closeGate.close(), "execution_not_terminal");
  await closeGate.error({ errorCode: "cancelled_before_output" });
  await closeGate.close();

  var missingHarness = createHarness();
  var missing = await missingHarness.service.begin({ headers: {} }, { messages: [] }, beginInput());
  await missingHarness.service.markOutputStarted(missing.handle);
  await expectCode(missingHarness.service.complete(missing.handle, {}), "invalid_terminal_input");
  var missingFailed = await missingHarness.service.fail(missing.handle, { errorCode: "empty_response" });
  assert.strictEqual(missingFailed.terminalType, "failed", "invalid completion input must not reserve the first-winner terminal");

  var winnerHarness = createHarness();
  var winner = await winnerHarness.service.begin({ headers: {} }, { messages: [] }, beginInput());
  await winnerHarness.service.markOutputStarted(winner.handle);
  var completePromise = winnerHarness.service.complete(winner.handle, { content: "winner" });
  var failPromise = winnerHarness.service.fail(winner.handle, { errorCode: "late_failure" });
  assert.strictEqual(completePromise, failPromise, "all terminal contenders must receive the first-winner promise");
  var winnerResult = await completePromise;
  assert.strictEqual(winnerResult.terminalType, "completed");
  assert.strictEqual(winnerHarness.calls.filter(function (entry) { return entry === "terminal:completed" || entry === "terminal:failed"; }).length, 1);

  var failedHarness = createHarness();
  var failed = await failedHarness.service.begin({ headers: {} }, { messages: [] }, beginInput());
  var failedResult = await failedHarness.service.fail(failed.handle, { errorCode: "prompt_build_failed" });
  assert.strictEqual(failedResult.terminalType, "failed");
  assert.strictEqual(failedHarness.calls.indexOf("mark"), -1, "failure before output does not invent output_started");

  var errorHarness = createHarness();
  var errorBegin = await errorHarness.service.begin({ headers: {} }, { messages: [] }, beginInput());
  var errorEvents = [];
  var failFirstWrite = true;
  var errorGate = errorHarness.service.createStreamGate(errorBegin.handle, {
    emit: function (event) {
      if (failFirstWrite) { failFirstWrite = false; throw new Error("enqueue failed"); }
      errorEvents.push(event.type);
    }
  });
  await expectCode(errorGate.emit({ type: "text" }), undefined);
  var streamFailed = await errorGate.error({ errorCode: "stream_enqueue_failed" }, { type: "error" });
  assert.strictEqual(streamFailed.terminalType, "failed");
  assert.deepStrictEqual(errorEvents, ["error"], "SSE error is emitted only after failed terminal wins");
  assert(errorHarness.calls.indexOf("terminal:failed") > errorHarness.calls.indexOf("mark"));

  var duplicateHarness = createHarness();
  duplicateHarness.setDuplicate(true);
  await expectCode(duplicateHarness.service.begin({ headers: {} }, { messages: [] }, beginInput()), "decision_already_claimed");

  var ineligibleHarness = createHarness();
  ineligibleHarness.setEligible(false);
  await expectCode(ineligibleHarness.service.begin({ headers: {} }, { messages: [] }, beginInput()), "adaptive_not_eligible");
  assert.strictEqual(ineligibleHarness.calls.indexOf("claim"), -1, "eligibility must fail before claim");

  var rawHarness = createHarness();
  await expectCode(rawHarness.service.begin({ headers: {} }, { accountId: "Mallory" }, beginInput()), "raw_account_selector");
  assert.strictEqual(rawHarness.calls.indexOf("claim"), -1, "raw account selectors fail before claim");

  var staleHarness = createHarness();
  var stale = await staleHarness.service.begin({ headers: {} }, { messages: [] }, beginInput());
  staleHarness.authState.sessionEpoch += 1;
  await expectCode(staleHarness.service.markOutputStarted(stale.handle), "auth_epoch_mismatch");
  assert.strictEqual(staleHarness.calls.indexOf("mark"), -1, "stale handles fail before execution mutation");

  console.log("adaptive chat service smoke test passed");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
