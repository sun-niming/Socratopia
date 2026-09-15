"use strict";

// Post-class notes v2 — single upstream call with text-first response reading.
//
// Why this exists instead of reusing the compiled `callLLM` (webpack module
// 64092): that helper calls `response.json()` directly, so an HTML
// interception page becomes `Unexpected token '<'` and every downstream retry
// decision is made on a lie.  Plan §6.1 mandates: read text, record status /
// content-type / bytes, classify, and only then parse the provider envelope.
//
// Scope boundary: provider *resolution* (which key, which baseURL, which
// hosted headers) stays in the compiled route, because it depends on
// `__SOCRATOPIA_SETTINGS__` plus per-request hosted context.  This module only
// sends the request and interprets the answer.
//
// Plan: POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md §6.1, §9.2.

var errors = require("./errors.js");

var CHAT_PATH = "/chat/completions";
var DEFAULT_TIMEOUT_MS = 90000;
var DEFAULT_MAX_TOKENS = 4096;

function joinUrl(baseURL, suffix) {
  var base = String(baseURL || "").replace(/\/+$/, "");
  return base + suffix;
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  var lower = String(name).toLowerCase();
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === lower) return headers[keys[i]] || "";
  }
  return "";
}

function messageOf(choice) {
  return (choice && (choice.message || choice.delta)) || {};
}

// Kept separate so smoke tests can assert the request shape (json mode,
// thinking toggle, token budget) without any network.
function buildRequestBody(request, model) {
  var body = {
    model: model,
    max_tokens: Number(request.maxTokens) > 0 ? Math.floor(Number(request.maxTokens)) : DEFAULT_MAX_TOKENS,
    stream: false,
    messages: [
      { role: "system", content: String(request.systemPrompt || "") },
      { role: "user", content: String(request.userContent || "") }
    ]
  };
  if (typeof request.thinking === "boolean") body.thinking = { type: request.thinking ? "enabled" : "disabled" };
  if (request.responseFormat === "json_object") body.response_format = { type: "json_object" };
  if (Number(request.temperature) >= 0) body.temperature = Number(request.temperature);
  return body;
}

function createProvider(options) {
  var opts = options || {};
  // An explicit `fetch: null` means "no transport available" (used by tests to
  // assert the dependency error); only an absent option falls back to global.
  var fetchImpl = Object.prototype.hasOwnProperty.call(opts, "fetch")
    ? opts.fetch
    : (typeof fetch === "function" ? fetch : null);
  var now = opts.now || function () { return Date.now(); };
  var sleep = opts.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };

  if (!fetchImpl) throw errors.codedError(errors.CODES.missing_dependency, "global fetch is unavailable");

  var baseURL = String(opts.baseURL || "");
  var apiKey = String(opts.apiKey || "");
  var model = String(opts.model || "");
  var extraHeaders = opts.extraHeaders || {};
  var purpose = String(opts.purpose || "summary");

  function resolveTimeout(request) {
    var configured = Number(request.timeoutMs) > 0 ? Number(request.timeoutMs) : (Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS);
    var deadlineAt = Number(request.deadlineAt);
    if (!Number.isFinite(deadlineAt)) return configured;
    var remaining = deadlineAt - now();
    if (remaining <= 0) throw errors.codedError(errors.CODES.upstream_timeout, "deadline already elapsed");
    return Math.max(1, Math.min(configured, remaining));
  }

  function attachExternalSignal(controller, signal) {
    if (!signal) return function () {};
    if (signal.aborted) {
      controller.abort(errors.codedError(errors.CODES.cancelled, "request cancelled"));
      return function () {};
    }
    var onAbort = function () {
      controller.abort(errors.codedError(errors.CODES.cancelled, "request cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return function () { signal.removeEventListener("abort", onAbort); };
  }

  async function readResponse(response, startedAt) {
    var text = "";
    try {
      text = await response.text();
    } catch (readError) {
      throw errors.codedError(errors.CODES.upstream_network, "upstream body could not be read: " + (readError && readError.message));
    }
    return {
      text: text,
      httpStatus: response.status,
      contentType: String(headerValue(response.headers, "content-type") || ""),
      retryAfter: headerValue(response.headers, "retry-after"),
      bodyBytes: Buffer.byteLength(text, "utf8"),
      elapsedMs: now() - startedAt
    };
  }

  // Performs exactly one upstream request.  Never retries — the orchestrator
  // owns the §6.2 retry matrix so that retry accounting lives in one place.
  async function call(request) {
    var req = request || {};
    var timeoutMs = resolveTimeout(req);
    var startedAt = now();
    var controller = new AbortController();
    var timedOut = false;
    var detach = attachExternalSignal(controller, req.signal);
    var timer = setTimeout(function () {
      timedOut = true;
      controller.abort(errors.codedError(errors.CODES.upstream_timeout, "upstream timeout after " + timeoutMs + "ms"));
    }, timeoutMs);

    var headers = { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" };
    var extraKeys = Object.keys(extraHeaders);
    for (var i = 0; i < extraKeys.length; i++) headers[extraKeys[i]] = extraHeaders[extraKeys[i]];
    headers["X-Socratopia-Purpose"] = String(req.purpose || purpose);

    var body = buildRequestBody(req, req.model || model);
    var info = null;

    try {
      var response = await fetchImpl(joinUrl(req.baseURL || baseURL, CHAT_PATH), {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      info = await readResponse(response, startedAt);

      if (!response.ok) throw errors.classifyHttp(info);
      // A gateway can answer 200 with an HTML page too.
      if (errors.looksLikeHtml(info.text) || info.contentType.toLowerCase().indexOf("text/html") >= 0) {
        throw errors.classifyHttp(info);
      }

      var envelope;
      try {
        envelope = JSON.parse(info.text);
      } catch (parseError) {
        throw errors.codedError(errors.CODES.upstream_malformed_body, "provider envelope is not JSON", {
          httpStatus: info.httpStatus,
          bodyPreview: info.text.slice(0, 160)
        });
      }

      var choice = envelope && envelope.choices && envelope.choices[0];
      if (!choice) throw errors.codedError(errors.CODES.upstream_malformed_body, "provider envelope has no choices[0]", { httpStatus: info.httpStatus });
      if (choice.error || envelope.error) {
        throw errors.classifyHttp({ status: info.httpStatus, contentType: info.contentType, text: JSON.stringify(envelope.error || choice.error) });
      }

      var message = messageOf(choice);
      var content = typeof message.content === "string" ? message.content : "";
      var reasoning = typeof message.reasoning === "string" ? message.reasoning
        : (typeof message.reasoning_content === "string" ? message.reasoning_content : "");
      var usage = envelope.usage || {};

      return {
        content: content,
        reasoning: reasoning,
        finishReason: String(choice.finish_reason || ""),
        model: String(envelope.model || body.model),
        promptTokens: Number(usage.prompt_tokens) || 0,
        completionTokens: Number(usage.completion_tokens) || 0,
        httpStatus: info.httpStatus,
        contentType: info.contentType,
        elapsedMs: info.elapsedMs,
        bodyBytes: info.bodyBytes,
        truncated: choice.finish_reason === "length"
      };
    } catch (error) {
      if (errors.isCodedError(error)) throw error;
      if (req.signal && req.signal.aborted) throw errors.codedError(errors.CODES.cancelled, "request cancelled");
      if (timedOut) throw errors.codedError(errors.CODES.upstream_timeout, "upstream timeout after " + timeoutMs + "ms");
      throw errors.classifyNetwork(error);
    } finally {
      clearTimeout(timer);
      detach();
    }
  }

  return {
    call: call,
    sleep: sleep,
    describe: function () { return { model: model, purpose: purpose, baseURL: baseURL }; }
  };
}

module.exports = {
  CHAT_PATH: CHAT_PATH,
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  buildRequestBody: buildRequestBody,
  createProvider: createProvider
};
