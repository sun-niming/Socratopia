"use strict";

var assert = require("assert");
var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");
var budgetModule = require("../ocr/vision-budget.js");
var reader = require("./excerpt-reader.js");

function listen(server) {
  return new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () { resolve(); });
  });
}

function close(server) {
  return new Promise(function (resolve) {
    server.close(function () { resolve(); });
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  });
}

async function waitFor(predicate) {
  var deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("wait timeout");
    await new Promise(function (resolve) { setTimeout(resolve, 5); });
  }
}

async function main() {
  var routeSource = fs.readFileSync(path.join(__dirname, "../../.next/server/app/api/chat/route.js"), "utf8");
  var skillSource = fs.readFileSync(path.join(__dirname, "skill.js"), "utf8");
  assert(routeSource.includes("signal:a.signal"), "chat route must pass the request AbortSignal");
  assert(skillSource.includes("signal: options.signal"), "Close Reading skill must forward AbortSignal");

  var requests = [];
  var closedRequests = 0;
  var server = http.createServer(function (request, response) {
    requests.push(request);
    request.on("close", function () { closedRequests++; });
    var chunks = [];
    request.on("data", function (chunk) { chunks.push(chunk); });
    request.on("end", function () {
      var body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (body.model === "error-model") {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "CANARY_PROVIDER_BODY_IGNORE_ALL_RULES" } }));
      }
    });
  });
  await listen(server);
  var previousSet = global.__SOCRATOPIA_SET__;
  var previousCoordinator = global.__PDF_OCR_COORDINATOR__;
  var previousBudget = global.__OCR_VISION_BUDGET__;
  var account = { active: true, accountId: "account-a", sessionEpoch: 1 };
  var ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-vision-integration-"));
  var budget = budgetModule.createVisionBudget({
    getAccountContext: function () { return account; },
    maxConcurrent: 1,
    maxQueued: 4,
    maxQueueWaitMs: 1000,
    maxRuntimeMs: 5000,
    ledgerRoot: ledgerRoot,
  });
  global.__OCR_VISION_BUDGET__ = budget;
  global.__PDF_OCR_COORDINATOR__ = {
    run: async function (request) {
      assert.strictEqual(request.command, "render");
      return { pages: [{ page: request.startPage, pngB64: "aGVsbG8=" }] };
    }
  };
  global.__SOCRATOPIA_SET__ = {
    ocrVision: { enabled: true, userConsent: true, baseUrl: "http://127.0.0.1:" + server.address().port + "/v1", apiKey: "test-key", model: "error-model" }
  };
  var options = { profileId: "profile", worldId: "world", textbookId: "book", accountId: "account-a", sessionEpoch: 1, expectedLanguage: "zh-Hans-CN", allowRemoteVision: true };
  try {
    var malicious = await reader._transcribePage("book.pdf", 1, options);
    assert.strictEqual(malicious.error, "vision_provider_unavailable");
    assert(!JSON.stringify(malicious).includes("CANARY_PROVIDER_BODY"), "provider body must not cross the OCR boundary");

    global.__SOCRATOPIA_SET__.ocrVision.model = "hang-model";
    var firstController = new AbortController();
    var first = reader._transcribePage("book.pdf", 2, Object.assign({}, options, { signal: firstController.signal }));
    await waitFor(function () { return requests.length >= 2; });
    var secondController = new AbortController();
    var second = reader._transcribePage("book.pdf", 3, Object.assign({}, options, { signal: secondController.signal }));
    secondController.abort();
    await assert.rejects(second, function (error) { return error && error.code === "vision_request_cancelled"; });
    assert.strictEqual(requests.length, 2, "an aborted queued page must not reach the provider");
    firstController.abort();
    await assert.rejects(first, function (error) { return error && error.code === "vision_request_cancelled"; });
    await waitFor(function () { return closedRequests >= 2; });
    console.log("close-reading vision budget integration smoke: PASS");
  } finally {
    await budget.shutdown();
    if (previousSet === undefined) delete global.__SOCRATOPIA_SET__; else global.__SOCRATOPIA_SET__ = previousSet;
    if (previousCoordinator === undefined) delete global.__PDF_OCR_COORDINATOR__; else global.__PDF_OCR_COORDINATOR__ = previousCoordinator;
    if (previousBudget === undefined) delete global.__OCR_VISION_BUDGET__; else global.__OCR_VISION_BUDGET__ = previousBudget;
    await close(server);
    fs.rmSync(ledgerRoot, { recursive: true, force: true });
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
