"use strict";

var assert = require("assert");
var fs = require("fs");
var http = require("http");
var path = require("path");

var definers = [
  path.resolve(__dirname, "..", ".next", "server", "chunks", "4092.js"),
  path.resolve(__dirname, "..", ".next", "server", "chunks", "1576.js"),
  path.resolve(__dirname, "..", ".next", "server", "app", "api", "concept-summary", "route.js"),
  path.resolve(__dirname, "..", ".next", "server", "app", "api", "flashcard", "route.js"),
  path.resolve(__dirname, "..", ".next", "server", "app", "api", "companion", "reconcile-persona", "route.js"),
  path.resolve(__dirname, "..", ".next", "server", "app", "api", "custom-companions", "merge-persona", "route.js"),
];

definers.forEach(function (file) {
  var source = fs.readFileSync(file, "utf8");
  assert(source.includes("responseFormat:p,signal:_externalSignal,deadlineAt:_deadlineAt"), file + " must accept external signal/deadlineAt");
  assert(source.includes("_externalSignal.addEventListener(\"abort\",_externalAbort,{once:!0})"), file + " must forward external abort");
  assert(source.includes("_externalSignal.removeEventListener(\"abort\",_externalAbort)"), file + " must clean up the abort listener");
  assert(source.includes("_deadlineWins"), file + " must combine timeout with absolute deadline");
  assert(source.includes("b.code=\"request_aborted\""), file + " must preserve a stable abort code");
  assert(source.includes("a.code=\"request_deadline\""), file + " must preserve a stable deadline code");
});

function listen(server) {
  return new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise(function (resolve) {
    server.close(resolve);
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  });
}

function instantiateCallLLM() {
  var chunkPath = path.resolve(__dirname, "..", ".next", "server", "chunks", "4092.js");
  delete require.cache[chunkPath];
  var chunk = require(chunkPath);
  var exported = {};
  chunk.modules[64092]({}, exported, {
    d: function (target, getters) {
      Object.keys(getters).forEach(function (key) {
        Object.defineProperty(target, key, { enumerable: true, get: getters[key] });
      });
    },
  });
  return exported.callLLM;
}

async function main() {
  var requests = [];
  var closed = 0;
  var server = http.createServer(function (request, response) {
    requests.push(request);
    request.on("close", function () { closed++; });
    var chunks = [];
    request.on("data", function (chunk) { chunks.push(chunk); });
    request.on("end", function () {
      var body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (body.model === "success-model") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
      }
    });
  });
  await listen(server);
  var callLLM = instantiateCallLLM();
  var base = {
    provider: "gpt",
    apiKey: "test-only",
    baseURL: "http://127.0.0.1:" + server.address().port,
    systemPrompt: "test",
    messages: [{ role: "user", content: "test" }],
    timeoutMs: 5000,
  };
  try {
    var controller = new AbortController();
    var aborted = callLLM(Object.assign({}, base, { model: "hang-abort", signal: controller.signal, deadlineAt: Date.now() + 5000 }));
    while (requests.length < 1) await new Promise(function (resolve) { setTimeout(resolve, 5); });
    controller.abort();
    await assert.rejects(aborted, function (error) { return error && error.code === "request_aborted"; });

    var deadlineStart = Date.now();
    await assert.rejects(callLLM(Object.assign({}, base, { model: "hang-deadline", deadlineAt: deadlineStart + 40 })), function (error) {
      return error && error.code === "request_deadline";
    });
    assert(Date.now() - deadlineStart < 1000, "absolute deadline must interrupt the provider promptly");

    var success = await callLLM(Object.assign({}, base, { model: "success-model" }));
    assert.strictEqual(success, "ok", "legacy callers without signal/deadline must remain compatible");
    assert(requests.length >= 3);
    assert(closed >= 2, "aborted/deadline requests must close their provider connections");
    console.log("callLLM request fence smoke: PASS");
  } finally {
    await close(server);
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
