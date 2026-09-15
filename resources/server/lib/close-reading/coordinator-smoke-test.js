"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var reader = require("./excerpt-reader.js");

async function main() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-close-reading-"));
  var pdf = path.join(root, "book.pdf");
  fs.writeFileSync(pdf, "%PDF-test");
  var previous = global.__PDF_OCR_COORDINATOR__;
  var previousSet = global.__SOCRATOPIA_SET__;
  var calls = [];
  global.__PDF_OCR_COORDINATOR__ = {
    run: async function (request) {
      calls.push(request);
      if (request.command === "meta") return { numPages: 20 };
      if (request.command === "extract") return {
        metadata: { numPages: 20 },
        pageResults: [
          { page: 10, text: "", source: "unresolved", error: "windows_ocr_failed" },
          { page: 11, text: "target() appears on an adjacent page", source: "text-layer", error: null },
          { page: 12, text: "local OCR body", source: "rapidocr-v5", confidence: 0.9, error: null },
        ],
        failedPages: [{ page: 10, reason: "windows_ocr_failed" }],
        sourcesByPage: { "10": "unresolved", "11": "text-layer", "12": "rapidocr-v5" },
      };
      throw new Error("unexpected_command:" + request.command);
    }
  };
  global.__SOCRATOPIA_SET__ = {
    ocrVision: { enabled: true, userConsent: true, baseUrl: "https://example.invalid/v1", apiKey: "test", model: "ocr-vision" }
  };
  var visualCalls = [];
  try {
    var controller = new AbortController();
    var deadlineAt = Date.now() + 60000;
    var result = await reader.readTextbookExcerpt({
      filePath: pdf,
      accountId: "account",
      profileId: "profile",
      worldId: "world",
      textbookId: "book",
      sessionEpoch: 1,
      signal: controller.signal,
      deadlineAt: deadlineAt,
      startPage: 10,
      endPage: 12,
      query: "target()",
      allowOcr: true,
      transcribePage: async function (_file, page) {
        visualCalls.push(page);
        return { text: "target() on requested page", attempted: true, error: null, modelSource: "vision" };
      }
    });
    assert.deepStrictEqual(calls.map(function (call) { return call.command; }), ["meta", "extract"]);
    assert(calls.every(function (call) { return call.scope.accountId === "account" && call.scope.profileId === "profile" && call.scope.worldId === "world" && call.scope.textbookId === "book" && call.scope.sessionEpoch === 1; }));
    assert(calls.every(function (call) { return call.signal === controller.signal && call.deadlineAt === deadlineAt; }), "Close Reading must forward abort and deadline fences to every coordinator request");
    assert.deepStrictEqual(visualCalls, [], "remote vision must stay off without per-command consent");
    assert.strictEqual(result.metadata.textLayerFound, true, "adjacent text-layer match remains independently reported");
    assert.deepStrictEqual(result.metadata.queryFoundPages, [11]);
    assert.strictEqual(result.metadata.sourcesByPage["10"], "unresolved");
    assert.strictEqual(result.metadata.sourcesByPage["11"], "text-layer");
    assert.strictEqual(result.metadata.sourcesByPage["12"], "rapidocr-v5");
    assert.deepStrictEqual(result.metadata.failedPages, [{ page: 10, reason: "windows_ocr_failed" }]);
    assert.strictEqual(result.metadata.status, "processed_with_failures");
    assert.strictEqual(result.metadata.processingComplete, true);
    assert.strictEqual(result.metadata.transcriptionComplete, false);

    var consented = await reader.readTextbookExcerpt({
      filePath: pdf, accountId: "account", profileId: "profile", worldId: "world", textbookId: "book", sessionEpoch: 1,
      startPage: 10, endPage: 12, query: "target()", allowOcr: true, allowRemoteVision: true,
      transcribePage: async function (_file, page) {
        visualCalls.push(page);
        return { text: "target() on requested page", attempted: true, error: null, modelSource: "ocrVision" };
      }
    });
    assert.deepStrictEqual(visualCalls, [10], "only the unresolved page may use explicitly consented remote vision");
    assert.deepStrictEqual(consented.metadata.failedPages, []);
    assert.strictEqual(consented.metadata.status, "transcription_complete");
    assert.strictEqual(consented.metadata.transcriptionComplete, true);
  } finally {
    if (previous === undefined) delete global.__PDF_OCR_COORDINATOR__;
    else global.__PDF_OCR_COORDINATOR__ = previous;
    if (previousSet === undefined) delete global.__SOCRATOPIA_SET__;
    else global.__SOCRATOPIA_SET__ = previousSet;
    fs.rmSync(root, { recursive: true, force: true });
  }
  var source = fs.readFileSync(path.join(__dirname, "excerpt-reader.js"), "utf8");
  assert(!source.includes('require("child_process")'), "Close Reading must not spawn an independent PDF worker");
  assert(source.includes("global.__PDF_OCR_COORDINATOR__"), "Close Reading must use the shared coordinator");
  console.log("close-reading coordinator smoke: PASS");
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
