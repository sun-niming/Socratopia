"use strict";

var crypto = require("crypto");

function ChatServiceError(code, message, status) {
  Error.call(this, message);
  this.name = "ChatServiceError";
  this.code = code || "adaptive_chat_error";
  this.status = status || 500;
  this.message = message || this.code;
  if (Error.captureStackTrace) Error.captureStackTrace(this, ChatServiceError);
}
ChatServiceError.prototype = Object.create(Error.prototype);
ChatServiceError.prototype.constructor = ChatServiceError;

function isRecord(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

function boundedString(value, name, maxLength) {
  if (typeof value !== "string") throw new ChatServiceError("invalid_request", name + " must be a string", 400);
  var normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    throw new ChatServiceError("invalid_request", name + " is outside its allowed bounds", 400);
  }
  return normalized;
}

function optionalString(value, name, maxLength) {
  return value == null ? null : boundedString(value, name, maxLength);
}

function enumValue(value, name, allowed) {
  if (allowed.indexOf(value) < 0) throw new ChatServiceError("invalid_execution_contract", name + " is invalid", 500);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}

function executionContractView(source) {
  if (!isRecord(source)) throw new ChatServiceError("invalid_execution_contract", "Execution contract is missing", 500);
  if (!Array.isArray(source.reasonCodes) || source.reasonCodes.length < 1 || source.reasonCodes.length > 16) {
    throw new ChatServiceError("invalid_execution_contract", "reasonCodes are invalid", 500);
  }
  if (!isRecord(source.tutorContract) || !Array.isArray(source.tutorContract.forbiddenMoves) || source.tutorContract.forbiddenMoves.length < 1 || source.tutorContract.forbiddenMoves.length > 16) {
    throw new ChatServiceError("invalid_execution_contract", "Tutor Contract is invalid", 500);
  }
  var maxQuestions = source.tutorContract.maxQuestions;
  if (!Number.isSafeInteger(maxQuestions) || maxQuestions !== 1) throw new ChatServiceError("invalid_execution_contract", "maxQuestions must be 1", 500);
  var reasonCodes = source.reasonCodes.map(function (code) {
    var value = boundedString(code, "reasonCode", 64);
    if (!/^[A-Z0-9][A-Z0-9_:-]*$/.test(value)) throw new ChatServiceError("invalid_execution_contract", "reasonCode is invalid", 500);
    return value;
  });
  return deepFreeze({
    decisionId: boundedString(source.decisionId, "decisionId", 512),
    sessionId: boundedString(source.sessionId, "sessionId", 512),
    conceptId: boundedString(source.conceptId, "conceptId", 512),
    action: enumValue(source.action, "action", ["check", "explain", "remediate", "assess_transfer", "advance", "review"]),
    difficulty: enumValue(source.difficulty, "difficulty", ["lower", "same", "higher"]),
    reasonCodes: reasonCodes,
    assessmentId: optionalString(source.assessmentId, "assessmentId", 512),
    rulesVersion: boundedString(source.rulesVersion, "rulesVersion", 128),
    tutorContract: {
      objective: boundedString(source.tutorContract.objective, "tutorContract.objective", 512),
      requiredMove: boundedString(source.tutorContract.requiredMove, "tutorContract.requiredMove", 512),
      forbiddenMoves: source.tutorContract.forbiddenMoves.map(function (move) { return boundedString(move, "tutorContract.forbiddenMove", 256); }),
      hintLevel: enumValue(source.tutorContract.hintLevel, "tutorContract.hintLevel", ["none", "light", "heavy"]),
      expectedEvidenceType: enumValue(source.tutorContract.expectedEvidenceType, "tutorContract.expectedEvidenceType", ["basic", "transfer", "misconception", "retention"]),
      maxQuestions: maxQuestions
    }
  });
}

function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function stableRequestId(state, phase, payload) {
  return "chat_" + digest(JSON.stringify([state.accountId, state.profileId, state.worldId, state.decisionId, state.requestKey, phase, payload || null])).slice(0, 48);
}

function takeSseFrame(buffer) {
  var match = /\r?\n\r?\n/.exec(buffer);
  if (!match) return null;
  var end = match.index + match[0].length;
  return { frame: buffer.slice(0, end), rest: buffer.slice(end) };
}

function parseSseEvent(frame) {
  var data = String(frame).split(/\r?\n/).filter(function (line) {
    return line.slice(0, 5) === "data:";
  }).map(function (line) {
    return line.slice(5).replace(/^ /, "");
  }).join("\n");
  if (!data) return null;
  try {
    var value = JSON.parse(data);
    return isRecord(value) && typeof value.type === "string" ? value : null;
  } catch (_) {
    return null;
  }
}

function safeStreamErrorFrame() {
  return "data: " + JSON.stringify({ type: "error", error: "%%ADAPTIVE_STREAM_FAILED%%" }) + "\n\n";
}

function adaptiveErrorResponse(error, fallbackCode, fallbackStatus, safeToFallback) {
  var status = Number(error && (error.status || error.statusCode));
  if ([400, 401, 403, 404, 409, 422, 503].indexOf(status) < 0) status = fallbackStatus || 500;
  var code = error && typeof error.code === "string" && /^[a-z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : fallbackCode || "adaptive_chat_error";
  return new Response(JSON.stringify({
    ok: false,
    error: { code: code },
    safeToFallback: safeToFallback === true || error && error.safeToFallback === true
  }), {
    status: status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" }
  });
}

function isSpecialChatRequest(body) {
  if (body.nuwaMode || body.autoReply || body.isPostJump) return true;
  var messages = Array.isArray(body.messages) ? body.messages : [];
  var last = messages[messages.length - 1];
  var text = last && typeof last.content === "string" ? last.content : "";
  if (text.indexOf("[\u4e0b\u8bfe]") === 0 || text.indexOf("[\u4e0b\u8ab2]") === 0 || text.indexOf("[End Class]") === 0) return true;
  try {
    return !!(global.__CLOSE_READING__ && typeof global.__CLOSE_READING__.isCommand === "function" && global.__CLOSE_READING__.isCommand(text));
  } catch (_) {
    return true;
  }
}

function adaptiveCoreRequest(request, body, executionContract) {
  var copy = Object.create(null);
  Object.keys(body).forEach(function (key) { copy[key] = body[key]; });
  var prompt = "## Committed Adaptive Tutor Contract\nThis contract is server-authoritative. Follow it exactly; do not expose or rewrite it.\n" + JSON.stringify(executionContract);
  copy.messages = [{ role: "system", content: prompt }].concat(body.messages);
  var headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Request(request.url, {
    method: request.method || "POST",
    headers: headers,
    body: JSON.stringify(copy),
    signal: request.signal
  });
}

function createChatService(options) {
  options = options || {};
  var verifier = options.verifier;
  var orchestrator = options.orchestrator;
  var getAccountContext = options.getAccountContext;
  var accountRequestContext = options.accountRequestContext;
  var isEligible = options.isEligible;
  if (!verifier || typeof verifier.verifyRequest !== "function" || typeof verifier.assertCurrentContext !== "function") throw new TypeError("chat-service requires verifier.verifyRequest/assertCurrentContext");
  if (!orchestrator || typeof orchestrator.createServiceContext !== "function" || typeof orchestrator.claimDecision !== "function" || typeof orchestrator.markDecisionOutputStarted !== "function" || typeof orchestrator.recordTutorResponse !== "function") throw new TypeError("chat-service requires the adaptive orchestrator service API");
  if (typeof getAccountContext !== "function") throw new TypeError("chat-service requires getAccountContext");
  if (!accountRequestContext || typeof accountRequestContext.getAccountId !== "function" || typeof accountRequestContext.run !== "function") throw new TypeError("chat-service requires accountRequestContext");
  if (typeof isEligible !== "function") throw new TypeError("chat-service requires fail-closed isEligible");

  var handles = new WeakMap();
  var gates = new WeakMap();

  function error(code, message, status) { return new ChatServiceError(code, message, status); }

  async function awaitReady() {
    var result;
    if (options.readinessPromise) result = await options.readinessPromise;
    else if (typeof orchestrator.awaitReady === "function") result = await orchestrator.awaitReady();
    else throw error("adaptive_unavailable", "Adaptive readiness is unavailable", 503);
    if (!result || result.ok !== true) throw error(result && result.code || "adaptive_unavailable", "Adaptive teaching is unavailable", 503);
    return result;
  }

  async function currentAccount(requestContext, request, input) {
    verifier.assertCurrentContext(requestContext);
    var account = await getAccountContext({ requestContext: requestContext, request: request, input: input });
    if (!isRecord(account) || account.active === false || account.accountId !== requestContext.accountId || account.sessionEpoch !== requestContext.sessionEpoch) {
      throw error("auth_account_mismatch", "The current account context changed", 403);
    }
    return deepFreeze({ accountId: account.accountId, sessionEpoch: account.sessionEpoch });
  }

  function stateFor(handle) {
    var state = handle && handles.get(handle);
    if (!state) throw error("invalid_execution_handle", "A branded execution handle is required", 403);
    return state;
  }

  function enqueue(state, operation) {
    var scheduled = state.queue.then(operation);
    scheduled.catch(function () {});
    state.queue = scheduled.then(function () {}, function (failure) {
      if (!state.queueError) state.queueError = failure;
    });
    return scheduled;
  }

  async function assertLive(state) {
    verifier.assertCurrentContext(state.requestContext);
    var account = await getAccountContext({ requestContext: state.requestContext, request: state.request, input: state.input });
    if (!isRecord(account) || account.active === false || account.accountId !== state.accountId || account.sessionEpoch !== state.sessionEpoch) {
      throw error("auth_account_mismatch", "The current account context changed", 403);
    }
  }

  async function begin(request, body, input) {
    if (!isRecord(body) || !isRecord(input)) throw error("invalid_request", "body and claim input are required", 400);
    var normalized = {
      requestId: boundedString(input.requestId, "requestId", 180),
      profileId: boundedString(input.profileId, "profileId", 512),
      worldId: boundedString(input.worldId, "worldId", 512),
      decisionId: boundedString(input.adaptiveDecisionId, "adaptiveDecisionId", 512)
    };
    var firstContext = await verifier.verifyRequest(request, body);
    await awaitReady();
    var requestContext = await verifier.verifyRequest(request, body);
    if (!firstContext || !requestContext || firstContext.accountId !== requestContext.accountId || firstContext.sessionEpoch !== requestContext.sessionEpoch) {
      throw error("auth_epoch_mismatch", "The account context changed during readiness", 403);
    }
    var accountContext = await currentAccount(requestContext, request, normalized);
    var eligibility = await isEligible({ requestContext: requestContext, accountContext: accountContext, request: request, input: deepFreeze(Object.assign({}, normalized)) });
    if (!(eligibility === true || isRecord(eligibility) && eligibility.eligible === true)) throw error("adaptive_not_eligible", "Adaptive teaching is not enabled for this account or session", 403);
    await currentAccount(requestContext, request, normalized);
    var serviceContext = orchestrator.createServiceContext(requestContext);
    var claimInput = {
      requestId: "chat_" + digest(JSON.stringify([requestContext.accountId, normalized.profileId, normalized.worldId, normalized.decisionId, normalized.requestId, "claim"])).slice(0, 48),
      profileId: normalized.profileId,
      worldId: normalized.worldId,
      decisionId: normalized.decisionId
    };
    var claim = await orchestrator.claimDecision(claimInput, serviceContext);
    if (!claim || claim.alreadyClaimed || claim.executionGranted !== true) throw error("decision_already_claimed", "The adaptive decision already has an execution", 409);
    if (claim.decisionId !== normalized.decisionId || typeof claim.executionId !== "string") throw error("invalid_execution_claim", "The execution claim is invalid", 500);
    var contract = executionContractView(claim.executionContract);
    if (contract.decisionId !== normalized.decisionId) throw error("invalid_execution_contract", "The execution contract does not match the claim", 500);
    var handle = Object.freeze(Object.create(null));
    handles.set(handle, {
      request: request,
      input: deepFreeze(Object.assign({}, normalized)),
      requestContext: requestContext,
      serviceContext: serviceContext,
      accountId: requestContext.accountId,
      sessionEpoch: requestContext.sessionEpoch,
      profileId: normalized.profileId,
      worldId: normalized.worldId,
      decisionId: normalized.decisionId,
      executionId: claim.executionId,
      requestKey: normalized.requestId,
      contract: contract,
      runStarted: false,
      queue: Promise.resolve(),
      queueError: null,
      markPromise: null,
      markSucceeded: false,
      terminalType: null,
      terminalPromise: null,
      gate: null
    });
    return Object.freeze({ handle: handle, executionContract: contract });
  }

  function markOutputStarted(handle) {
    var state = stateFor(handle);
    if (state.terminalPromise) return Promise.reject(error("execution_terminal_conflict", "Execution is already terminal", 409));
    if (state.markPromise) return state.markPromise;
    state.markPromise = enqueue(state, async function () {
      await assertLive(state);
      var result = await orchestrator.markDecisionOutputStarted({
        requestId: stableRequestId(state, "output_started"),
        profileId: state.profileId,
        worldId: state.worldId,
        executionId: state.executionId
      }, state.serviceContext);
      state.markSucceeded = true;
      return result;
    });
    return state.markPromise;
  }

  async function run(handle, callback) {
    var state = stateFor(handle);
    if (typeof callback !== "function") throw error("invalid_execution_callback", "Execution callback is required", 500);
    if (state.runStarted) throw error("execution_already_started", "Execution callback has already started", 409);
    state.runStarted = true;
    await assertLive(state);
    return accountRequestContext.run(state.accountId, callback);
  }

  function terminal(handle, terminalType, input) {
    var state = stateFor(handle);
    if (state.terminalPromise) return state.terminalPromise;
    input = isRecord(input) ? input : {};
    if (terminalType === "completed" && !state.markSucceeded) return Promise.reject(error("output_not_started", "Completed execution requires a committed output_started event", 409));
    if (terminalType === "completed" && (typeof input.content !== "string" || input.content.length > 4194304)) {
      return Promise.reject(error("invalid_terminal_input", "Completed response content must be a string within 4 MiB", 400));
    }
    var failureCode = terminalType === "failed" ? optionalString(input.errorCode || "chat_stream_failed", "errorCode", 128) : null;
    if (failureCode && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(failureCode)) return Promise.reject(error("invalid_terminal_input", "errorCode is invalid", 400));
    var payload = terminalType === "completed" ? {
      contentHash: "sha256:" + digest(input.content),
      messageRef: optionalString(input.messageRef, "messageRef", 512)
    } : {
      errorCode: failureCode
    };
    state.terminalType = terminalType;
    state.terminalPromise = enqueue(state, async function () {
      await assertLive(state);
      var record = {
        requestId: stableRequestId(state, "terminal_" + terminalType, payload),
        profileId: state.profileId,
        worldId: state.worldId,
        executionId: state.executionId,
        status: terminalType,
        actualStrategy: state.contract.action
      };
      if (terminalType === "completed") {
        record.responseId = "response_" + digest(JSON.stringify([state.executionId, terminalType])).slice(0, 32);
        record.messageRef = payload.messageRef;
        record.contentHash = payload.contentHash;
      } else record.errorCode = payload.errorCode;
      return orchestrator.recordTutorResponse(record, state.serviceContext);
    });
    return state.terminalPromise;
  }

  function complete(handle, input) { return terminal(handle, "completed", input); }
  function fail(handle, input) { return terminal(handle, "failed", input); }

  function createStreamGate(handle, sink) {
    var state = stateFor(handle);
    if (!isRecord(sink) || typeof sink.emit !== "function") throw error("invalid_stream_sink", "Stream sink.emit is required", 500);
    if (state.gate) throw error("stream_gate_exists", "Execution already has a stream gate", 409);
    var gate = Object.freeze(Object.create(null));
    var gateState = { handle: handle, sink: sink };
    gates.set(gate, gateState);
    state.gate = gate;

    function emit(value) {
      if (state.terminalPromise) {
        var rejected = Promise.reject(error("execution_terminal_conflict", "Cannot emit after terminal selection", 409));
        rejected.catch(function () {});
        return rejected;
      }
      var marked = markOutputStarted(handle);
      return enqueue(state, async function () {
        await marked;
        return sink.emit(value);
      });
    }

    async function flush() {
      await state.queue;
      if (state.queueError) throw state.queueError;
    }

    async function done(input, doneEvent) {
      await flush();
      var result = await complete(handle, input);
      if (!result || result.terminalType !== "completed") throw error("execution_terminal_conflict", "Completed terminal did not win", 409);
      await enqueue(state, function () { return sink.emit(doneEvent === undefined ? { type: "done" } : doneEvent); });
      return result;
    }

    async function streamError(input, errorEvent) {
      await state.queue;
      var result = await fail(handle, input);
      if (!result || result.terminalType !== "failed") throw error("execution_terminal_conflict", "Failed terminal did not win", 409);
      if (errorEvent !== undefined) await enqueue(state, function () { return sink.emit(errorEvent); });
      return result;
    }

    async function close() {
      if (!state.terminalPromise) throw error("execution_not_terminal", "The stream cannot close before a terminal is committed", 409);
      await state.terminalPromise;
      await state.queue;
      if (typeof sink.close === "function") return sink.close();
    }

    return Object.freeze({ emit: emit, flush: flush, done: done, error: streamError, close: close });
  }

  async function wrapResponse(handle, response) {
    stateFor(handle);
    var contentType = response && response.headers && response.headers.get("content-type") || "";
    if (!response || !response.body || response.ok !== true || contentType.toLowerCase().indexOf("text/event-stream") < 0) {
      await fail(handle, { errorCode: response && response.ok ? "chat_response_not_sse" : "chat_response_rejected" });
      return response;
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var encoder = new TextEncoder();
    var cancelled = false;
    var stream = new ReadableStream({
      start: async function (controller) {
        var gate = createStreamGate(handle, {
          emit: function (frame) { controller.enqueue(encoder.encode(frame)); },
          close: function () { controller.close(); }
        });
        var buffer = "";
        var content = "";
        var terminalSeen = false;
        try {
          streamLoop: for (;;) {
            var next = await reader.read();
            buffer += decoder.decode(next.value || new Uint8Array(), { stream: !next.done });
            for (;;) {
              var taken = takeSseFrame(buffer);
              if (!taken) break;
              buffer = taken.rest;
              var event = parseSseEvent(taken.frame);
              if (event && event.type === "done") {
                await gate.done({ content: content }, taken.frame);
                terminalSeen = true;
                try { await reader.cancel(); } catch (_) {}
                break streamLoop;
              }
              if (event && event.type === "error") {
                await gate.error({ errorCode: "chat_stream_error" }, taken.frame);
                terminalSeen = true;
                try { await reader.cancel(); } catch (_) {}
                break streamLoop;
              }
              if (event && event.type === "text" && typeof event.text === "string") content += event.text;
              await gate.emit(taken.frame);
            }
            if (next.done) break;
          }
          if (!terminalSeen) {
            await gate.error({ errorCode: "chat_stream_incomplete" }, safeStreamErrorFrame());
            terminalSeen = true;
          }
          await gate.close();
        } catch (streamError) {
          if (cancelled) return;
          try {
            await gate.error({ errorCode: "chat_stream_failed" }, safeStreamErrorFrame());
            await gate.close();
          } catch (_) {
            try { controller.error(streamError); } catch (_) {}
          }
        }
      },
      cancel: async function (reason) {
        cancelled = true;
        var terminal = fail(handle, { errorCode: "client_aborted" });
        try { await reader.cancel(reason); } catch (_) {}
        await terminal;
      }
    });
    var headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
  }

  async function dispatch(request, core) {
    if (!request || typeof request.clone !== "function" || typeof core !== "function") {
      return adaptiveErrorResponse(null, "adaptive_unavailable", 503, false);
    }
    var body;
    try {
      body = await request.clone().json();
    } catch (_) {
      return core(request);
    }
    if (!isRecord(body) || !hasOwn(body, "adaptiveDecisionId")) return core(request);

    var input;
    try {
      if (!Array.isArray(body.messages) || !body.messages.length) throw error("invalid_request", "messages are required", 400);
      input = {
        requestId: boundedString(body.adaptiveRequestId, "adaptiveRequestId", 180),
        profileId: boundedString(body.profileId, "profileId", 512),
        worldId: boundedString(body.worldId, "worldId", 512),
        adaptiveDecisionId: boundedString(body.adaptiveDecisionId, "adaptiveDecisionId", 512)
      };
    } catch (validationError) {
      return adaptiveErrorResponse(validationError, "invalid_adaptive_request", 400, false);
    }
    if (isSpecialChatRequest(body)) {
      return adaptiveErrorResponse(null, "adaptive_special_path", 409, true);
    }

    var begun;
    try {
      begun = await begin(request, body, input);
    } catch (beginError) {
      return adaptiveErrorResponse(beginError, "adaptive_chat_rejected", 500, false);
    }
    try {
      var coreRequest = adaptiveCoreRequest(request, body, begun.executionContract);
      var response = await run(begun.handle, function () { return core(coreRequest); });
      return await wrapResponse(begun.handle, response);
    } catch (dispatchError) {
      try { await fail(begun.handle, { errorCode: "chat_dispatch_failed" }); } catch (_) {}
      return adaptiveErrorResponse(dispatchError, "adaptive_chat_failed", 500, false);
    }
  }

  return Object.freeze({
    begin: begin,
    run: run,
    dispatch: dispatch,
    wrapResponse: wrapResponse,
    createStreamGate: createStreamGate,
    markOutputStarted: markOutputStarted,
    complete: complete,
    fail: fail
  });
}

module.exports = {
  ChatServiceError: ChatServiceError,
  createChatService: createChatService
};
