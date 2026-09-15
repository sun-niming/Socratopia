"use strict";

// PN-013 — provider contract: text-first response reading, so an HTML gateway
// page is classified instead of blowing up inside `JSON.parse`.
//
// Runs against the shared MockLLM over real HTTP; no app, no API key.
//
//   node resources/server/lib/post-class-notes/provider-smoke-test.js

var assert = require("assert");
var http = require("http");
var providerModule = require("./provider.js");
var errors = require("./errors.js");
var MockLLM = require("../../smoke-test-utils.js").MockLLM;

var HTML_PAGE = "<!DOCTYPE html>\n<html><head><title>403 Forbidden</title></head><body><h1>Blocked by gateway</h1></body></html>";

function envelope(content, extra) {
  var message = { role: "assistant", content: content };
  if (extra && extra.reasoning !== undefined) message.reasoning = extra.reasoning;
  var body = {
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "mock-strong",
    choices: [{ index: 0, message: message, finish_reason: (extra && extra.finishReason) || "stop" }],
    usage: { prompt_tokens: 4210, completion_tokens: 1320 }
  };
  return body;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function scenario(name, body) {
  return Promise.resolve().then(body).then(function () {
    console.log("  ok   " + name);
  }, function (error) {
    error.message = name + ": " + error.message;
    throw error;
  });
}

function makeProvider(mock, overrides) {
  var opts = Object.assign({
    baseURL: "http://127.0.0.1:" + mock.port + "/v1",
    apiKey: "mock-key",
    model: "mock-strong",
    purpose: "summary",
    timeoutMs: 3000
  }, overrides || {});
  return providerModule.createProvider(opts);
}

function request(overrides) {
  return Object.assign({
    systemPrompt: "system",
    userContent: "user",
    maxTokens: 4096,
    responseFormat: "json_object",
    thinking: false
  }, overrides || {});
}

async function main() {
  var mock = new MockLLM();
  await mock.start();

  try {
    await scenario("happy path returns content, finish reason and usage", async function () {
      mock.setResponse(envelope('{"sections":[]}'));
      var result = await makeProvider(mock).call(request());
      assert.strictEqual(result.content, '{"sections":[]}');
      assert.strictEqual(result.finishReason, "stop");
      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.httpStatus, 200);
      assert.strictEqual(result.promptTokens, 4210);
      assert.strictEqual(result.completionTokens, 1320);
    });

    await scenario("request carries json mode, thinking off and the token budget", async function () {
      mock.setResponse(envelope("{}"));
      mock.resetRequests();
      await makeProvider(mock).call(request({ maxTokens: 2048 }));
      var sent = mock.requests[0];
      assert.deepStrictEqual(sent.response_format, { type: "json_object" });
      assert.deepStrictEqual(sent.thinking, { type: "disabled" });
      assert.strictEqual(sent.max_tokens, 2048);
      assert.strictEqual(sent.stream, false);
      assert.strictEqual(sent.headers.authorization, "Bearer mock-key");
      assert.strictEqual(sent.headers["x-socratopia-purpose"], "summary");
      assert.strictEqual(sent.messages.length, 2);
    });

    await scenario("a trailing slash in the base url is normalized", async function () {
      mock.setResponse(envelope("{}"));
      var result = await makeProvider(mock, { baseURL: "http://127.0.0.1:" + mock.port + "/v1/" }).call(request());
      assert.strictEqual(result.httpStatus, 200);
    });

    await scenario("HTML 403 is classified as an interception page", async function () {
      mock.setRawResponse(HTML_PAGE, 403, "text/html; charset=utf-8");
      var error = await makeProvider(mock).call(request()).then(function () { return null; }, function (e) { return e; });
      assert.ok(error, "call rejected");
      assert.strictEqual(error.code, errors.CODES.upstream_html_response);
      assert.strictEqual(error.httpStatus, 403);
      assert.strictEqual(/[\n\r]/.test(error.bodyPreview), false, "the preview stays single-line");
    });

    await scenario("HTTP 200 with an HTML body is still an interception page", async function () {
      mock.setRawResponse(HTML_PAGE, 200, "text/html");
      var error = await makeProvider(mock).call(request()).then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.upstream_html_response);
    });

    await scenario("a JSON 401 is an auth error, not an interception page", async function () {
      mock.setResponse({ error: { message: "invalid api key" } }, 401);
      var error = await makeProvider(mock).call(request()).then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.upstream_auth);
    });

    await scenario("a 503 is a retryable gateway error", async function () {
      mock.setResponse({ error: "upstream down" }, 503);
      var error = await makeProvider(mock).call(request()).then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.upstream_server);
      assert.strictEqual(errors.retryPlan(error).retry, true);
    });

    await scenario("a non-JSON 200 body is malformed, not a crash", async function () {
      mock.setRawResponse("not json at all", 200, "application/json");
      var error = await makeProvider(mock).call(request()).then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.upstream_malformed_body);
    });

    await scenario("an envelope without choices is malformed", async function () {
      mock.setResponse({ id: "x", usage: {} });
      var error = await makeProvider(mock).call(request()).then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.upstream_malformed_body);
    });

    await scenario("empty content is returned, not thrown (recovery needs the schema)", async function () {
      mock.setResponse(envelope(null, { reasoning: '{"sections":[]}' }));
      var result = await makeProvider(mock).call(request());
      assert.strictEqual(result.content, "");
      assert.strictEqual(result.reasoning, '{"sections":[]}');
      assert.strictEqual(result.finishReason, "stop");
    });

    await scenario("reasoning_content is read as a fallback field name", async function () {
      mock.setResponse({ choices: [{ message: { content: "", reasoning_content: "think" }, finish_reason: "stop" }] });
      var result = await makeProvider(mock).call(request());
      assert.strictEqual(result.reasoning, "think");
    });

    await scenario("finish_reason=length is surfaced as truncated", async function () {
      mock.setResponse(envelope('{"sections":[', { finishReason: "length" }));
      var result = await makeProvider(mock).call(request());
      assert.strictEqual(result.truncated, true);
      assert.strictEqual(result.finishReason, "length");
    });

    await scenario("a slow provider trips the timeout with a coded error", async function () {
      mock.setResponseGenerator(async function () {
        await sleep(400);
        return { body: envelope("{}") };
      });
      var error = await makeProvider(mock, { timeoutMs: 100 }).call(request()).then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.upstream_timeout);
      assert.strictEqual(errors.retryPlan(error).retry, true, "a timeout is retried once per the stage budget");
    });

    await scenario("a deadline shorter than the timeout wins", async function () {
      mock.setResponseGenerator(async function () {
        await sleep(300);
        return { body: envelope("{}") };
      });
      var error = await makeProvider(mock, { timeoutMs: 5000 })
        .call(request({ deadlineAt: Date.now() + 80 }))
        .then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.upstream_timeout);
    });

    await scenario("an already-elapsed deadline fails before any request", async function () {
      mock.resetRequests();
      var error = await makeProvider(mock).call(request({ deadlineAt: Date.now() - 1 })).then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.upstream_timeout);
      assert.strictEqual(mock.requests.length, 0, "no request was issued");
    });

    await scenario("an external abort propagates as cancelled and is never retried", async function () {
      mock.setResponseGenerator(async function () {
        await sleep(500);
        return { body: envelope("{}") };
      });
      var controller = new AbortController();
      setTimeout(function () { controller.abort(); }, 60);
      var error = await makeProvider(mock).call(request({ signal: controller.signal })).then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.cancelled);
      assert.strictEqual(errors.retryPlan(error).retry, false);
    });

    await scenario("an abort before the call resolves immediately", async function () {
      var controller = new AbortController();
      controller.abort();
      var error = await makeProvider(mock).call(request({ signal: controller.signal })).then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.cancelled);
    });

    await scenario("a refused connection is a retryable network error", async function () {
      var dead = await freePort();
      var error = await providerModule.createProvider({ baseURL: "http://127.0.0.1:" + dead + "/v1", apiKey: "k", model: "m" })
        .call(request()).then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.upstream_network);
      assert.strictEqual(errors.retryPlan(error).retry, true);
    });

    await scenario("an unresolvable host is a network error", async function () {
      var error = await providerModule.createProvider({ baseURL: "http://no-such-host.invalid/v1", apiKey: "k", model: "m", timeoutMs: 5000 })
        .call(request()).then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.upstream_network);
    });

    await scenario("the api key never appears in the returned trace fields", async function () {
      mock.setResponse(envelope("{}"));
      var result = await makeProvider(mock).call(request());
      var serialized = JSON.stringify(result);
      assert.strictEqual(serialized.indexOf("mock-key"), -1);
    });

    await scenario("buildRequestBody is inspectable without a network", async function () {
      var body = providerModule.buildRequestBody({ systemPrompt: "s", userContent: "u", maxTokens: 100 }, "m");
      assert.strictEqual(body.model, "m");
      assert.strictEqual(body.max_tokens, 100);
      assert.strictEqual(body.messages[0].role, "system");
      assert.strictEqual(body.response_format, undefined, "json mode is opt-in");
      var json = providerModule.buildRequestBody({ systemPrompt: "s", userContent: "u", responseFormat: "json_object", thinking: true }, "m");
      assert.deepStrictEqual(json.response_format, { type: "json_object" });
      assert.deepStrictEqual(json.thinking, { type: "enabled" });
    });

    await scenario("a missing fetch is a coded dependency error", async function () {
      // Thrown by the factory itself, so the rejection has to be captured there.
      var error = await Promise.resolve()
        .then(function () {
          return providerModule.createProvider({ baseURL: "http://x", apiKey: "k", model: "m", fetch: null }).call(request());
        })
        .then(function () { return null; }, function (e) { return e; });
      assert.strictEqual(error.code, errors.CODES.missing_dependency);
    });
  } finally {
    await mock.stop();
  }

  console.log("provider smoke: PASS");
}

function freePort() {
  return new Promise(function (resolve) {
    var server = http.createServer();
    server.listen(0, "127.0.0.1", function () {
      var port = server.address().port;
      server.close(function () { resolve(port); });
    });
  });
}

main().catch(function (error) {
  console.error("provider smoke: FAIL — " + error.message);
  if (error.stack) console.error(error.stack.split("\n").slice(1, 4).join("\n"));
  // Set the code instead of calling process.exit(): exiting while the mock
  // server is still closing trips a libuv assertion on Windows.
  process.exitCode = 1;
});
