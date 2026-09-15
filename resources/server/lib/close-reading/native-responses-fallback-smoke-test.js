"use strict";

var assert = require("assert");
var http = require("http");
var reader = require("./excerpt-reader.js");
var transcriber = require("./vision-transcriber.js");

function readJson(request) {
  return new Promise(function (resolve) {
    var chunks = [];
    request.on("data", function (chunk) { chunks.push(chunk); });
    request.on("end", function () {
      resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
    });
  });
}

function listen(handler) {
  return new Promise(function (resolve, reject) {
    var server = http.createServer(handler);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

function close(server) {
  return new Promise(function (resolve, reject) {
    server.close(function (error) { if (error) reject(error); else resolve(); });
  });
}

async function main() {
  var calls = [];
  var budgetCalls = [];
  var previousBudget = global.__OCR_VISION_BUDGET__;
  global.__OCR_VISION_BUDGET__ = {
    run: function (request) {
      budgetCalls.push(request);
      return request.execute(new AbortController().signal);
    }
  };
  var server = await listen(async function (request, response) {
    var body = await readJson(request);
    calls.push({ path: request.url, authorization: request.headers.authorization, body: body });
    if (request.url === "/v1/chat/completions") {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "codex channel: only /v1/responses are supported" } }));
      return;
    }
    if (request.url === "/v1/responses") {
      var output = body.model === "vision-model" ? "vision output" : "excerpt output";
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("data: " + JSON.stringify({ type: "response.output_text.delta", delta: output }) + "\n\n");
      response.end("data: " + JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 4, output_tokens: 2 } } }) + "\n\n");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  try {
    var baseUrl = "http://127.0.0.1:" + server.address().port + "/v1";
    var vision = await transcriber.postJSON(baseUrl, "test-key", {
      model: "vision-model", stream: false, messages: [{ role: "user", content: "read" }]
    }, { timeoutMs: 5000 });
    assert.strictEqual(vision.text, "vision output");

    var excerpt = await reader._postJson({ baseUrl: baseUrl, apiKey: "test-key" }, {
      model: "excerpt-model", stream: false, messages: [{ role: "user", content: "read" }]
    }, 5000);
    assert.strictEqual(excerpt.choices[0].message.content, "excerpt output");
    assert.deepStrictEqual(calls.map(function (call) { return call.path; }), [
      "/v1/chat/completions", "/v1/responses", "/v1/chat/completions", "/v1/responses"
    ]);
    assert(calls.every(function (call) { return call.authorization === "Bearer test-key"; }));
    assert.strictEqual(calls[1].body.stream, true);
    assert.strictEqual(calls[3].body.stream, true);
    assert.deepStrictEqual(budgetCalls.map(function (call) { return call.purpose; }), ["close-reading", "close-reading"]);
    assert(budgetCalls.every(function (call) { return call.imageCount === 1 && call.maxOutputTokens > 0 && call.inputBytes > 0; }));
    console.log("close-reading native Responses fallback smoke: PASS");
  } finally {
    if (previousBudget === undefined) delete global.__OCR_VISION_BUDGET__;
    else global.__OCR_VISION_BUDGET__ = previousBudget;
    await close(server);
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
