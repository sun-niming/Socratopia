"use strict";

// PN-003 — upstream failure taxonomy and the §6.2 retry matrix.
//
//   node resources/server/lib/post-class-notes/errors-smoke-test.js

var assert = require("assert");
var errors = require("./errors.js");

var HTML_403 = "<!DOCTYPE html>\n<html><head><title>403 Forbidden</title></head><body>blocked</body></html>";

function scenario(name, body) {
  try {
    body();
    console.log("  ok   " + name);
  } catch (error) {
    error.message = name + ": " + error.message;
    throw error;
  }
}

function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error.code;
  }
}

// --- classification --------------------------------------------------------

function htmlPage() {
  var error = errors.classifyHttp({ status: 403, contentType: "text/html; charset=utf-8", text: HTML_403 });
  assert.strictEqual(error.code, errors.CODES.upstream_html_response, "403 + text/html is an interception page");
  assert.strictEqual(errors.classifyHttp({ status: 403, contentType: "text/html", text: HTML_403 }).code, errors.CODES.upstream_html_response);

  // Some gateways answer 200 with the interception page.
  assert.strictEqual(errors.looksLikeHtml(HTML_403), true, "html body detected without a content type");
  assert.strictEqual(errors.looksLikeHtml("{\"a\":1}"), false, "json body is not html");
  assert.strictEqual(errors.classifyHttp({ status: 200, contentType: "text/html", text: HTML_403 }).code, errors.CODES.upstream_html_response);
}

function jsonAuth() {
  var error = errors.classifyHttp({ status: 401, contentType: "application/json", text: '{"error":"unauthorized"}' });
  assert.strictEqual(error.code, errors.CODES.upstream_auth, "json 401 is a configuration bug, not an interception page");
  assert.strictEqual(errors.classifyHttp({ status: 403, contentType: "application/json", text: '{"error":"forbidden"}' }).code, errors.CODES.upstream_auth);
}

function gatewayStatuses() {
  [408, 502, 503, 504].forEach(function (status) {
    assert.strictEqual(errors.classifyHttp({ status: status, contentType: "application/json", text: "{}" }).code, errors.CODES.upstream_server,
      "status " + status + " is a transient gateway error");
  });
  assert.strictEqual(errors.classifyHttp({ status: 500, contentType: "application/json", text: "{}" }).code, errors.CODES.upstream_server);
  assert.strictEqual(errors.classifyHttp({ status: 400, contentType: "application/json", text: "{}" }).code, errors.CODES.upstream_bad_request);
}

function rateLimit() {
  var error = errors.classifyHttp({ status: 429, contentType: "application/json", text: "{}", retryAfter: "12" });
  assert.strictEqual(error.code, errors.CODES.upstream_rate_limit);
  assert.strictEqual(error.retryAfterMs, 12000, "Retry-After seconds are honoured");

  var capped = errors.classifyHttp({ status: 429, contentType: "application/json", text: "{}", retryAfter: "600" });
  assert.strictEqual(capped.retryAfterMs, 30000, "Retry-After is capped at 30s");

  assert.strictEqual(errors.classifyHttp({ status: 429, contentType: "application/json", text: "{}", retryAfter: "garbage" }).retryAfterMs, 0);
}

function network() {
  assert.strictEqual(errors.classifyNetwork(Object.assign(new Error("getaddrinfo ENOTFOUND host"), { code: "ENOTFOUND" })).code, errors.CODES.upstream_network);
  assert.strictEqual(errors.classifyNetwork(new Error("fetch failed")).code, errors.CODES.upstream_network);
  assert.strictEqual(errors.classifyNetwork(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })).code, errors.CODES.upstream_network);
  assert.strictEqual(errors.classifyNetwork(Object.assign(new Error("deadline"), { code: "request_deadline" })).code, errors.CODES.upstream_timeout);
  assert.strictEqual(errors.classifyNetwork(Object.assign(new Error("aborted"), { name: "AbortError" })).code, errors.CODES.cancelled);
  assert.strictEqual(errors.classifyNetwork(errors.codedError(errors.CODES.cancelled, "x")).code, errors.CODES.cancelled, "already-coded errors pass through");
}

// --- retry matrix (§6.2) ---------------------------------------------------

function retryMatrix() {
  var cases = [
    [errors.CODES.upstream_network, true, 1],
    [errors.CODES.upstream_timeout, true, 1],
    [errors.CODES.upstream_server, true, 1],
    [errors.CODES.upstream_rate_limit, true, 1],
    [errors.CODES.upstream_html_response, true, 1],
    [errors.CODES.upstream_malformed_body, true, 1],
    [errors.CODES.upstream_empty_content, true, 1],
    [errors.CODES.output_truncated, true, 1],
    [errors.CODES.schema_invalid, true, 1],
    [errors.CODES.upstream_auth, false, 0],
    [errors.CODES.upstream_bad_request, false, 0],
    [errors.CODES.cancelled, false, 0]
  ];
  cases.forEach(function (entry) {
    var plan = errors.retryPlan(errors.codedError(entry[0], "x"));
    assert.strictEqual(plan.retry, entry[1], entry[0] + " retry decision");
    assert.strictEqual(plan.attempts, entry[2], entry[0] + " retry budget");
  });
}

function delayedRetries() {
  assert.strictEqual(errors.retryPlan(errors.codedError(errors.CODES.upstream_html_response, "x")).delayMs, 3000,
    "an interception page gets a 3s breather before the single retry");
  assert.strictEqual(errors.retryPlan(errors.codedError(errors.CODES.upstream_auth, "x")).delayMs, 0);
  assert.strictEqual(errors.retryPlan(errors.codedError(errors.CODES.output_truncated, "x")).shortenTarget, true,
    "a truncated answer is retried with a shorter target, not the same request");
  assert.strictEqual(errors.retryPlan(errors.codedError(errors.CODES.upstream_empty_content, "x")).shortenTarget, true);
  assert.strictEqual(errors.retryPlan(errors.codedError(errors.CODES.schema_invalid, "x")).repairOnly, true);

  var rateLimited = errors.codedError(errors.CODES.upstream_rate_limit, "x");
  rateLimited.retryAfterMs = 25000;
  assert.ok(errors.retryPlan(rateLimited).delayMs >= 25000, "Retry-After wins over the default backoff");
}

function networkBackoffIsJittered() {
  var seen = {};
  for (var i = 0; i < 40; i++) seen[errors.retryPlan(errors.codedError(errors.CODES.upstream_network, "x")).delayMs] = true;
  assert.ok(Object.keys(seen).length > 1, "backoff jitters so two chunks do not retry in lockstep");
  Object.keys(seen).forEach(function (delay) {
    assert.ok(Number(delay) >= 1500 && Number(delay) <= 3000, "jitter stays inside 1.5-3s, got " + delay);
  });
}

// --- user-facing text ------------------------------------------------------

function publicText() {
  var fallback = errors.toPublicError(new Error("raw upstream noise"), "chinese");
  assert.strictEqual(fallback.code, errors.CODES.internal_error, "an uncoded error never leaks its message");
  assert.ok(fallback.message.length > 0);

  assert.strictEqual(errors.publicMessage(errors.CODES.upstream_html_response, "chinese"), "模型服务当前被网关拦截，请稍后重试。");
  assert.strictEqual(errors.publicMessage(errors.CODES.upstream_auth, "english"), "The model endpoint and API key do not match.");
  assert.ok(/閘道/.test(errors.publicMessage(errors.CODES.upstream_html_response, "chinese-traditional")), "traditional chinese variant exists");

  Object.keys(errors.CODES).forEach(function (key) {
    var code = errors.CODES[key];
    ["chinese", "chinese-traditional", "english"].forEach(function (language) {
      assert.ok(errors.publicMessage(code, language).length > 0, "message missing for " + code + "/" + language);
    });
  });
}

function codedErrorShape() {
  var error = errors.codedError(errors.CODES.upstream_timeout, "slow", { httpStatus: 0 });
  assert.strictEqual(error.code, errors.CODES.upstream_timeout);
  assert.strictEqual(error.retryable, true);
  assert.strictEqual(error.httpStatus, 0);
  assert.strictEqual(errors.codedError(errors.CODES.upstream_auth, "x").retryable, false);
  assert.strictEqual(errors.isCodedError(error), true);
  assert.strictEqual(errors.isCodedError(new Error("x")), false);
  assert.strictEqual(errors.isCancellation(errors.codedError(errors.CODES.cancelled, "x")), true);
}

function bodyPreviewIsNotTheWholePage() {
  var error = errors.classifyHttp({ status: 403, contentType: "text/html", text: HTML_403 + "x".repeat(5000) });
  assert.ok(error.bodyPreview.length <= 200, "preview is clamped so trace lines stay short");
  assert.strictEqual(/[\n\r]/.test(error.bodyPreview), false, "preview is single-line");
}

console.log("errors smoke:");
scenario("HTML interception page gets its own code", htmlPage);
scenario("JSON 401/403 is an auth configuration error", jsonAuth);
scenario("transient gateway statuses are retryable server errors", gatewayStatuses);
scenario("429 honours Retry-After within 30s", rateLimit);
scenario("transport failures are classified, not leaked", network);
scenario("retry matrix matches the plan table", retryMatrix);
scenario("retry delays and strategies match the plan", delayedRetries);
scenario("network backoff jitters within budget", networkBackoffIsJittered);
scenario("user-facing text never leaks raw upstream noise", publicText);
scenario("coded errors carry retryability", codedErrorShape);
scenario("body preview stays short and single line", bodyPreviewIsNotTheWholePage);
console.log("errors smoke: PASS");
