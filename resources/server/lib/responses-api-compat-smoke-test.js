"use strict";

var assert = require("assert");
var http = require("http");
var compat = require("./responses-api-compat.js");

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

function sseResponse(events) {
  var encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      events.forEach(function (event) {
        controller.enqueue(encoder.encode("event: " + event.type + "\n"));
        controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
      });
      controller.close();
    }
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function collectSse(response) {
  var text = await response.text();
  return text.split(/\r?\n/).filter(function (line) {
    return line.startsWith("data: ") && line !== "data: [DONE]";
  }).map(function (line) {
    return JSON.parse(line.slice(6));
  });
}

function listen(handler) {
  return new Promise(function (resolve, reject) {
    var server = http.createServer(handler);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", function () {
      resolve(server);
    });
  });
}

function close(server) {
  return new Promise(function (resolve, reject) {
    server.close(function (error) { if (error) reject(error); else resolve(); });
  });
}

function readRequest(request) {
  return new Promise(function (resolve) {
    var chunks = [];
    request.on("data", function (chunk) { chunks.push(chunk); });
    request.on("end", function () {
      resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
    });
  });
}

async function testNativeHttpFallback() {
  var calls = [];
  var server = await listen(async function (request, response) {
    var body = await readRequest(request);
    calls.push({ path: request.url, authorization: request.headers.authorization, body: body });
    if (request.url === "/normal/v1/chat/completions") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "normal" } }] }));
      return;
    }
    if (request.url === "/codex/v1/chat/completions") {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "codex channel: only /v1/responses are supported" } }));
      return;
    }
    if (request.url === "/codex/v1/responses") {
      if (body.max_output_tokens !== undefined) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Unsupported parameter: max_output_tokens" } }));
        return;
      }
      if (body.prompt_cache_retention !== undefined) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Unsupported parameter: prompt_cache_retention" } }));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("data: " + JSON.stringify({ type: "response.output_text.delta", delta: "native fallback" }) + "\n\n");
      response.end("data: " + JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 2 } } }) + "\n\n");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  try {
    var base = "http://127.0.0.1:" + server.address().port;
    var normal = await compat.postChatCompletionsJson(base + "/normal/v1/chat/completions", {
      model: "normal-model", messages: [{ role: "user", content: "Hi" }], stream: false
    }, { headers: { Authorization: "Bearer native-test" }, timeoutMs: 5000, logger: { warn: function () {} } });
    assert.strictEqual(normal.choices[0].message.content, "normal");
    assert.deepStrictEqual(calls.map(function (call) { return call.path; }), ["/normal/v1/chat/completions"]);

    calls = [];
    var fallback = await compat.postChatCompletionsJson(base + "/codex/v1/chat/completions", {
      model: "gpt-5.6-sol", max_tokens: 19, prompt_cache_retention: "24h", messages: [{ role: "user", content: "Hi" }], stream: false
    }, { headers: { Authorization: "Bearer native-test" }, timeoutMs: 5000, logger: { warn: function () {} } });
    assert.strictEqual(fallback.choices[0].message.content, "native fallback");
    assert.strictEqual(fallback.usage.prompt_tokens, 5);
    assert.deepStrictEqual(calls.map(function (call) { return call.path; }), ["/codex/v1/chat/completions", "/codex/v1/responses", "/codex/v1/responses", "/codex/v1/responses"]);
    assert(calls.every(function (call) { return call.authorization === "Bearer native-test"; }));
    assert.strictEqual(calls[1].body.stream, true);
    assert.strictEqual(calls[1].body.max_output_tokens, 19);
    assert.strictEqual(calls[2].body.max_output_tokens, undefined);
    assert.strictEqual(calls[2].body.prompt_cache_retention, "24h");
    assert.strictEqual(calls[3].body.prompt_cache_retention, undefined);
  } finally {
    await close(server);
  }
}

async function testNativeTruncatedResponseRejects() {
  var server = await listen(async function (request, response) {
    await readRequest(request);
    response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "100" });
    response.flushHeaders();
    response.write("{\"choices\":");
    setTimeout(function () { response.destroy(); }, 10);
  });
  try {
    var url = "http://127.0.0.1:" + server.address().port + "/v1/chat/completions";
    var outcome = await Promise.race([
      compat.postChatCompletionsJson(url, { model: "test", messages: [], stream: false }, {
        timeoutMs: 100,
        logger: { warn: function () {} }
      }).then(function () { return "resolved"; }, function (error) { return error; }),
      new Promise(function (resolve) { setTimeout(function () { resolve("hung"); }, 500); })
    ]);
    assert.notStrictEqual(outcome, "hung", "truncated native response must settle within the request timeout");
    assert.notStrictEqual(outcome, "resolved", "truncated native response must reject");
    assert(outcome instanceof Error);
  } finally {
    await close(server);
  }
}

async function testNativeRetriesShareTimeoutBudget() {
  var server = await listen(async function (request, response) {
    await readRequest(request);
    if (request.url === "/v1/chat/completions") {
      setTimeout(function () {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "codex channel: only /v1/responses are supported" } }));
      }, 80);
      return;
    }
    setTimeout(function () {
      if (response.destroyed) return;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("data: " + JSON.stringify({ type: "response.output_text.delta", delta: "too late" }) + "\n\n");
      response.end("data: " + JSON.stringify({ type: "response.completed", response: {} }) + "\n\n");
    }, 80);
  });
  try {
    var url = "http://127.0.0.1:" + server.address().port + "/v1/chat/completions";
    await assert.rejects(compat.postChatCompletionsJson(url, {
      model: "test", messages: [], stream: false
    }, { timeoutMs: 120, logger: { warn: function () {} } }), /timeout/i);
  } finally {
    await close(server);
  }
}

async function main() {
  assert.strictEqual(
    compat.responsesUrl("https://example.test/v1/chat/completions"),
    "https://example.test/v1/responses"
  );
  assert(compat.isResponsesOnlyError(500, JSON.stringify({
    error: { message: "get request url failed: codex channel: only /v1/responses, /v1/responses/compact and /v1/alpha/search are supported" }
  })));
  assert(!compat.isResponsesOnlyError(401, "invalid token"));

  var converted = compat.chatRequestToResponses({
    model: "gpt-5.6-sol",
    max_tokens: 123,
    stream: true,
    messages: [
      { role: "system", content: "Teach carefully." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read_page", arguments: "{\"page\":3}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "Page text" }
    ],
    tools: [{ type: "function", function: { name: "read_page", description: "Read a page", parameters: { type: "object" } } }],
    response_format: { type: "json_object" },
    prompt_cache_key: "lesson-1",
    prompt_cache_retention: "24h",
    prompt_cache_options: { mode: "implicit" }
  });
  assert.strictEqual(converted.instructions, undefined);
  assert.strictEqual(converted.max_output_tokens, 123);
  assert.strictEqual(converted.store, false);
  assert.strictEqual(converted.input[0].role, "system");
  assert.strictEqual(converted.input[1].role, "user");
  assert.strictEqual(converted.input[2].type, "function_call");
  assert.strictEqual(converted.input[3].type, "function_call_output");
  assert.strictEqual(converted.tools[0].name, "read_page");
  assert.deepStrictEqual(converted.text, { format: { type: "json_object" } });
  assert.strictEqual(converted.prompt_cache_options, undefined);
  assert.strictEqual(converted.prompt_cache_retention, "24h");

  var calls = [];
  var wrapped = compat.createResponsesFallbackFetch(async function (url, init) {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) return jsonResponse({ error: { message: "codex channel: only /v1/responses, /v1/responses/compact and /v1/alpha/search are supported" } }, 500);
    return jsonResponse({
      id: "resp_1",
      model: "gpt-5.6-sol",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello back" }] }],
      usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 4 } }
    });
  }, { warn: function () {} });
  var nonStream = await wrapped("https://example.test/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer test" },
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "Hi" }], stream: false })
  });
  var nonStreamBody = await nonStream.json();
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].url, "https://example.test/v1/responses");
  assert.strictEqual(nonStreamBody.choices[0].message.content, "Hello back");
  assert.strictEqual(nonStreamBody.usage.prompt_tokens_details.cached_tokens, 4);

  calls = [];
  wrapped = compat.createResponsesFallbackFetch(async function (url, init) {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) return jsonResponse({ error: { message: "codex channel: only /v1/responses are supported" } }, 500);
    return sseResponse([
      { type: "response.output_text.delta", delta: "Collected" },
      { type: "response.completed", response: { id: "resp_collected", usage: { input_tokens: 7, output_tokens: 1 } } }
    ]);
  }, { warn: function () {} });
  var collected = await wrapped("https://example.test/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "Hi" }], stream: false })
  });
  var collectedBody = await collected.json();
  assert.strictEqual(calls[1].body.stream, true);
  assert.strictEqual(collectedBody.choices[0].message.content, "Collected");
  assert.strictEqual(collectedBody.usage.prompt_tokens, 7);

  calls = [];
  wrapped = compat.createResponsesFallbackFetch(async function (url, init) {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) return jsonResponse({ error: { message: "codex channel: only /v1/responses are supported" } }, 500);
    if (calls.length === 2) return jsonResponse({ error: { message: "Unsupported parameter: max_output_tokens" } }, 400);
    if (calls.length === 3) return jsonResponse({ error: { message: "Unsupported parameter: prompt_cache_retention" } }, 400);
    return sseResponse([
      { type: "response.output_text.delta", delta: "Gateway fallback" },
      { type: "response.completed", response: { id: "resp_unlimited", usage: { input_tokens: 4, output_tokens: 2 } } }
    ]);
  }, { warn: function () {} });
  var unsupportedLimit = await wrapped("https://example.test/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.6-sol", max_completion_tokens: 17, prompt_cache_retention: "24h", messages: [{ role: "user", content: "Hi" }], stream: false })
  });
  var unsupportedLimitBody = await unsupportedLimit.json();
  assert.strictEqual(calls.length, 4);
  assert.strictEqual(calls[1].body.max_output_tokens, 17);
  assert.strictEqual(calls[2].body.max_output_tokens, undefined);
  assert.strictEqual(calls[2].body.prompt_cache_retention, "24h");
  assert.strictEqual(calls[3].body.prompt_cache_retention, undefined);
  assert.strictEqual(unsupportedLimitBody.choices[0].message.content, "Gateway fallback");

  calls = [];
  wrapped = compat.createResponsesFallbackFetch(async function (url, init) {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) return jsonResponse({ error: { message: "codex channel: only /v1/responses are supported" } }, 500);
    return sseResponse([
      { type: "response.created", response: { id: "resp_stream" } },
      { type: "response.output_text.delta", delta: "Hel" },
      { type: "response.output_text.delta", delta: "lo" },
      { type: "response.completed", response: { id: "resp_stream", usage: { input_tokens: 8, output_tokens: 2 } } }
    ]);
  }, { warn: function () {} });
  var stream = await wrapped("https://example.test/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "Hi" }], stream: true })
  });
  var streamEvents = await collectSse(stream);
  assert.strictEqual(streamEvents[0].choices[0].delta.content, "Hel");
  assert.strictEqual(streamEvents[1].choices[0].delta.content, "lo");
  assert.strictEqual(streamEvents[2].usage.prompt_tokens, 8);

  calls = [];
  wrapped = compat.createResponsesFallbackFetch(async function (url, init) {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) return jsonResponse({ error: { message: "codex channel: only /v1/responses are supported" } }, 500);
    return sseResponse([
      { type: "response.output_item.added", output_index: 0, item: { id: "fc_1", call_id: "call_1", type: "function_call", name: "read_page", arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "{\"page\":" },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "3}" },
      { type: "response.output_item.done", output_index: 0, item: { id: "fc_1", call_id: "call_1", type: "function_call", name: "read_page", arguments: "{\"page\":3}" } },
      { type: "response.completed", response: { id: "resp_tool", usage: { input_tokens: 9, output_tokens: 4 } } }
    ]);
  }, { warn: function () {} });
  var toolStream = await wrapped("https://example.test/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "Read page 3" }], tools: converted.tools, stream: true })
  });
  var toolEvents = await collectSse(toolStream);
  assert.strictEqual(toolEvents[0].choices[0].delta.tool_calls[0].function.name, "read_page");
  assert.strictEqual(toolEvents.slice(0, 3).map(function (event) {
    return event.choices[0].delta.tool_calls[0].function.arguments || "";
  }).join(""), "{\"page\":3}");

  calls = [];
  wrapped = compat.createResponsesFallbackFetch(async function (url, init) {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return jsonResponse({ error: { message: "invalid token" } }, 401);
  }, { warn: function () {} });
  var untouched = await wrapped("https://example.test/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [], stream: false })
  });
  assert.strictEqual(untouched.status, 401);
  assert.strictEqual(calls.length, 1);

  calls = [];
  wrapped = compat.createResponsesFallbackFetch(async function (input, init) {
    var bodyText = init && init.body;
    if (input instanceof Request && !bodyText) bodyText = await input.text();
    calls.push({ url: String(input.url || input), body: JSON.parse(bodyText || "{}"), signal: init && init.signal });
    if (calls.length === 1) return jsonResponse({ error: { message: "codex channel: only /v1/responses are supported" } }, 500);
    return sseResponse([
      { type: "response.output_text.delta", delta: "Request fallback" },
      { type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 2 } } }
    ]);
  }, { warn: function () {} });
  var requestController = new AbortController();
  var requestInput = new Request("https://example.test/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "Hi" }], stream: false }),
    signal: requestController.signal
  });
  var requestFallback = await wrapped(requestInput);
  assert.strictEqual((await requestFallback.json()).choices[0].message.content, "Request fallback");
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].signal, requestInput.signal);

  await testNativeHttpFallback();
  await testNativeTruncatedResponseRejects();
  await testNativeRetriesShareTimeoutBudget();

  console.log("responses-api-compat smoke test: PASS");
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
