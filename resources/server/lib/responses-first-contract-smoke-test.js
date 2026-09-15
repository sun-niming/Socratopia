"use strict";

var assert = require("assert");
var http = require("http");
var compat = require("./responses-api-compat.js");

function sse(events) {
  return new Response(events.map(function (event) {
    return "data: " + JSON.stringify(event) + "\n\n";
  }).join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function listen(handler) {
  return new Promise(function (resolve, reject) {
    var server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

function close(server) {
  return new Promise(function (resolve) { server.close(function () { resolve(); }); });
}

function readJson(request) {
  return new Promise(function (resolve) {
    var chunks = [];
    request.on("data", function (chunk) { chunks.push(chunk); });
    request.on("end", function () {
      resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
    });
  });
}

async function testFetchResponsesFirst() {
  var calls = [];
  var wrapped = compat.createResponsesFallbackFetch(async function (url, init) {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).endsWith("/responses")) {
      return sse([
        { type: "response.output_text.delta", delta: "Responses first" },
        { type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 3, input_tokens_details: { cached_tokens: 8 } } } }
      ]);
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "wrong path" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }, console);

  var response = await wrapped("https://example.test/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-sol",
      stream: true,
      max_tokens: 512,
      prompt_cache_key: "scope-key",
      messages: [{ role: "system", content: "rules" }, { role: "user", content: "hello" }]
    })
  });

  assert.deepStrictEqual(calls.map(function (call) { return new URL(call.url).pathname; }), ["/v1/responses"]);
  assert.strictEqual(calls[0].body.model, "gpt-5.6-sol");
  assert.strictEqual(calls[0].body.max_output_tokens, 512);
  assert.strictEqual(calls[0].body.prompt_cache_key, "scope-key");
  assert.strictEqual(calls[0].body.store, false);
  assert(Array.isArray(calls[0].body.input));
  var translated = await response.text();
  assert(translated.includes('"content":"Responses first"'));
  assert(translated.includes('"cached_tokens":8'));
}

async function testNonCodexCompatibility() {
  var calls = [];
  var wrapped = compat.createResponsesFallbackFetch(async function (url) {
    calls.push(String(url));
    return new Response(JSON.stringify({ choices: [{ message: { content: "deepseek chat" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }, console);
  var response = await wrapped("https://example.test/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "deepseek-v4-flash", stream: false, messages: [{ role: "user", content: "hello" }] })
  });
  assert.deepStrictEqual(calls.map(function (url) { return new URL(url).pathname; }), ["/v1/chat/completions"]);
  assert.strictEqual(response.ok, true);
}

async function testNativeResponsesFirst() {
  var paths = [];
  var bodies = [];
  var server = await listen(async function (request, response) {
    var body = await readJson(request);
    paths.push(request.url);
    bodies.push(body);
    if (request.url === "/v1/responses") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("data: " + JSON.stringify({ type: "response.output_text.delta", delta: "native responses" }) + "\n\n");
      response.end("data: " + JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 7, output_tokens: 2 } } }) + "\n\n");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "wrong native path" } }] }));
  });
  try {
    var result = await compat.postChatCompletionsJson(
      "http://127.0.0.1:" + server.address().port + "/v1/chat/completions",
      { model: "gpt-5.6-sol", stream: false, max_tokens: 128, messages: [{ role: "user", content: "hello" }] },
      { timeoutMs: 5000, headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" } }
    );
    assert.deepStrictEqual(paths, ["/v1/responses"]);
    assert.strictEqual(bodies[0].stream, true);
    assert.strictEqual(result.choices[0].message.content, "native responses");
    assert.strictEqual(result.usage.prompt_tokens, 7);
  } finally {
    await close(server);
  }
}

async function main() {
  await testFetchResponsesFirst();
  await testNonCodexCompatibility();
  await testNativeResponsesFirst();
  console.log("responses-first contract smoke: PASS");
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
