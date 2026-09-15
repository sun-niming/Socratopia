"use strict";

var assert = require("assert");
var http = require("http");
var compat = require("./responses-api-compat.js");

function listen(server) {
  return new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () { resolve(); });
  });
}

function close(server) {
  return new Promise(function (resolve) { server.close(function () { resolve(); }); });
}

async function main() {
  var sawRequest = false;
  var sawClose = false;
  var server = http.createServer(function (request) {
    sawRequest = true;
    request.on("close", function () { sawClose = true; });
  });
  await listen(server);
  var controller = new AbortController();
  var expected = new Error("vision shutdown");
  expected.code = "vision_budget_shutdown";
  var call = compat.postChatCompletionsJson(new URL("http://127.0.0.1:" + server.address().port + "/v1/chat/completions"), {
    model: "vision-model",
    messages: [],
  }, {
    timeoutMs: 5000,
    signal: controller.signal,
  });
  await new Promise(function (resolve) {
    var timer = setInterval(function () {
      if (!sawRequest) return;
      clearInterval(timer);
      resolve();
    }, 2);
  });
  controller.abort(expected);
  await call.then(function () {
    assert.fail("aborted native request must reject");
  }, function (error) {
    assert.strictEqual(error.code, "vision_budget_shutdown");
  });
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  assert.strictEqual(sawClose, true, "abort must destroy the native HTTP request");
  await close(server);
  console.log("responses API native abort smoke: PASS");
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
