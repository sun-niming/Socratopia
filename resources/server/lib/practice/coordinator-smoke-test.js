"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

async function main() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-practice-coordinator-"));
  process.env.PROJECT_ROOT = root;
  var rel = path.join("profiles", "profile", "worlds", "world", "textbooks", "book");
  var accountA = path.join(root, "accounts", "account-a", rel);
  var accountB = path.join(root, "accounts", "account-b", rel);
  fs.mkdirSync(accountA, { recursive: true });
  fs.mkdirSync(accountB, { recursive: true });
  fs.writeFileSync(path.join(accountA, "scan.pdf"), "account-a-pdf");
  fs.writeFileSync(path.join(accountB, "scan.pdf"), "account-b-pdf");
  global.__SOCRATOPIA_ACCOUNT_CONTEXT__ = function () { return { active: true, accountId: "account-b", sessionEpoch: 9 }; };
  var calls = [];
  global.__PDF_OCR_COORDINATOR__ = {
    run: async function (request) {
      calls.push(request);
      await new Promise(function (resolve) { setImmediate(resolve); });
      var pages = [];
      for (var page = request.startPage; page <= request.endPage; page++) {
        if (page === 51) pages.push({ page: page, text: "", source: "unresolved", error: "ocr_failed" });
        else pages.push({ page: page, text: "OCR page " + page, source: "windows-ocr" });
      }
      var failedPages = pages.filter(function (item) { return item.source === "unresolved"; }).map(function (item) { return item.page; });
      var successfulPages = pages.filter(function (item) { return item.source !== "unresolved"; }).map(function (item) { return item.page; });
      return {
        pageResults: pages,
        requestedPages: pages.map(function (item) { return item.page; }),
        successfulPages: successfulPages,
        failedPages: failedPages,
        status: failedPages.length ? "processed_with_failures" : "transcription_complete",
        processingComplete: true,
        transcriptionComplete: failedPages.length === 0,
        contiguousUsableEndPage: failedPages.length ? 50 : request.endPage,
        sourcesByPage: {}
      };
    }
  };
  var adapter = require("./source-adapter.js");
  var body = { profileId: "profile", worldId: "world", sourceType: "textbook-page", textbookId: "book", page: 7 };
  var pair = await Promise.all([adapter.resolveSourceTextAsync(body), adapter.resolveSourceTextAsync(body)]);
  assert.strictEqual(calls.length, 1, "identical concurrent practice extraction must coalesce before the coordinator");
  assert.strictEqual(path.resolve(calls[0].filePath), path.resolve(path.join(accountB, "scan.pdf")), "practice must resolve only the authenticated account PDF");
  assert.deepStrictEqual(calls[0].scope, { accountId: "account-b", profileId: "profile", worldId: "world", textbookId: "book", sessionEpoch: 9 });
  assert(pair.every(function (result) { return result.text.includes("OCR page 7") && result.kind === "textbook-page:pdf-extracted"; }));
  calls.length = 0;
  var rangeAbort = new AbortController();
  var deadlineAt = Date.now() + 60000;
  var range = await adapter.resolveSourceTextAsync(
    { profileId: "profile", worldId: "world", sourceType: "textbook-page", textbookId: "book", pageRange: [1, 31] },
    { signal: rangeAbort.signal, deadlineAt: deadlineAt, accountContext: { active: true, accountId: "account-b", sessionEpoch: 9 } }
  );
  assert(!range.error && range.text.includes("[p.30]") && !range.text.includes("[p.31]"));
  assert.deepStrictEqual(calls.map(function (call) { return [call.startPage, call.endPage]; }), [[1, 30]], "one practice request must be hard-capped to 30 pages");
  assert.strictEqual(calls[0].signal, rangeAbort.signal);
  assert.strictEqual(calls[0].deadlineAt, deadlineAt);
  assert(calls[0].timeoutMs > 0 && calls[0].timeoutMs <= 60000);
  assert(range.provenance && range.provenance.pages.every(function (page) { return page.source === "windows-ocr"; }), "practice must retain page-level OCR provenance");
  assert.deepStrictEqual(range.requestedPages, Array.from({ length: 30 }, function (_, index) { return index + 1; }));
  assert.deepStrictEqual(range.successfulPages, range.requestedPages);
  assert.deepStrictEqual(range.failedPages, []);
  assert.strictEqual(range.status, "transcription_complete");
  assert.strictEqual(range.processingComplete, true);
  assert.strictEqual(range.transcriptionComplete, true);
  calls.length = 0;
  var partial = await adapter.resolveSourceTextAsync(
    { profileId: "profile", worldId: "world", sourceType: "textbook-page", textbookId: "book", pageRange: [50, 51] },
    { deadlineAt: Date.now() + 60000, accountContext: { active: true, accountId: "account-b", sessionEpoch: 9 } }
  );
  assert.strictEqual(partial.error, "source_incomplete", "p1 success/p2 failure must fail closed before question generation");
  assert.deepStrictEqual(partial.requestedPages, [50, 51]);
  assert.deepStrictEqual(partial.successfulPages, [50]);
  assert.deepStrictEqual(partial.failedPages, [51]);
  assert.strictEqual(partial.status, "processed_with_failures");
  assert.strictEqual(partial.processingComplete, true);
  assert.strictEqual(partial.transcriptionComplete, false);
  assert(!partial.text, "partial source text must not be exposed as a complete practice source");
  var practiceRoute = require(path.join(__dirname, "..", "..", ".next", "server", "app", "api", "practice", "route.js"));
  var previousPractice = global.__PRACTICE__;
  var previousPracticeSource = global.__PRACTICE_SOURCE__;
  var previousFetch = global.fetch;
  var llmCalls = 0;
  try {
    global.__PRACTICE__ = {};
    global.__PRACTICE_SOURCE__ = adapter;
    global.fetch = async function () { llmCalls++; throw new Error("LLM must not run for incomplete OCR source"); };
    var response = await practiceRoute.routeModule.userland.POST({
      signal: new AbortController().signal,
      json: async function () {
        return { action: "generate", profileId: "profile", worldId: "world", sourceType: "textbook-page", textbookId: "book", pageRange: [50, 51] };
      }
    });
    var responseBody = await response.json();
    assert.strictEqual(response.status, 422, "Practice route must reject incomplete page transcription");
    assert.strictEqual(responseBody.error, "source_incomplete");
    assert.deepStrictEqual(responseBody.requestedPages, [50, 51]);
    assert.deepStrictEqual(responseBody.successfulPages, [50]);
    assert.deepStrictEqual(responseBody.failedPages, [51]);
    assert.strictEqual(responseBody.status, "processed_with_failures");
    assert.strictEqual(responseBody.processingComplete, true);
    assert.strictEqual(responseBody.transcriptionComplete, false);
    assert.strictEqual(llmCalls, 0, "Practice route must fail closed before any LLM question generation");
  } finally {
    if (previousPractice === undefined) delete global.__PRACTICE__; else global.__PRACTICE__ = previousPractice;
    if (previousPracticeSource === undefined) delete global.__PRACTICE_SOURCE__; else global.__PRACTICE_SOURCE__ = previousPracticeSource;
    global.fetch = previousFetch;
  }
  calls.length = 0;
  var preAborted = new AbortController();
  preAborted.abort();
  var aborted = await adapter.resolveSourceTextAsync(
    { profileId: "profile", worldId: "world", sourceType: "textbook-page", textbookId: "book", page: 40 },
    { signal: preAborted.signal, deadlineAt: Date.now() + 60000, accountContext: { active: true, accountId: "account-b", sessionEpoch: 9 } }
  );
  assert.strictEqual(aborted.error, "request_aborted");
  assert.strictEqual(calls.length, 0, "pre-aborted practice request must not enter the Coordinator");
  var source = fs.readFileSync(path.join(__dirname, "source-adapter.js"), "utf8");
  assert(!source.includes('require("child_process")'));
  assert(!source.includes("readdirSync(accountsDir)"));
  var route = fs.readFileSync(path.join(__dirname, "..", "..", ".next", "server", "app", "api", "practice", "route.js"), "utf8");
  assert(route.includes("_doGenerate(b,h,a.signal"), "Practice route must pass request.signal into generate");
  assert(route.includes("accountId: requestContext.accountId"), "Practice route must bind the request-entry account id");
  assert(route.includes("sessionEpoch:requestContext.sessionEpoch"), "Practice route must bind the request-entry session epoch");
  assert(route.includes('sourceError === "source_incomplete" ? 422 : 404'), "Practice route must surface incomplete transcription as an explicit 422");
  assert(route.includes("requestedPages: source.requestedPages"), "Practice route must propagate requested OCR pages");
  assert(route.includes("successfulPages: source.successfulPages"), "Practice route must propagate successful OCR pages");
  assert(route.includes("failedPages: source.failedPages"), "Practice route must propagate failed OCR pages");
  assert(route.includes("pages: Array.isArray(source.successfulPages) ? source.successfulPages"), "Practice source metadata must use resolved successful pages, not blindly claim the requested pageRange");
  fs.rmSync(root, { recursive: true, force: true });
  console.log("practice coordinator smoke: PASS");
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
