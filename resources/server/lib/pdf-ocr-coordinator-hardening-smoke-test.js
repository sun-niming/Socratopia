"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var coordinatorModule = require("./pdf-ocr-coordinator.js");

async function main() {
  var previousCanary = process.env.SOCRATOPIA_OPENAI_API_KEY;
  process.env.SOCRATOPIA_OPENAI_API_KEY = "CANARY_MUST_NOT_REACH_PDF_WORKER";
  var workerEnv = coordinatorModule.minimalWorkerEnvironment("C:\\deps");
  assert.strictEqual(workerEnv.SOCRATOPIA_OPENAI_API_KEY, undefined);
  assert.strictEqual(workerEnv.NODE_PATH, "C:\\deps");
  if (previousCanary === undefined) delete process.env.SOCRATOPIA_OPENAI_API_KEY;
  else process.env.SOCRATOPIA_OPENAI_API_KEY = previousCanary;

  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-ocr-hardening-"));
  var dir = path.join(root, "accounts", "account-a", "profiles", "p", "worlds", "w", "textbooks", "t");
  fs.mkdirSync(dir, { recursive: true });
  var pdf = path.join(dir, "book.pdf");
  fs.writeFileSync(pdf, "synthetic-pdf");
  var batches = [];
  var cacheWrites = 0;
  var coordinator = coordinatorModule.createCoordinator({
    projectRoot: root,
    getAccountContext: function () { return { active: true, accountId: "account-a", sessionEpoch: 1 }; },
    cache: {
      initialize: async function () { throw Object.assign(new Error("disk denied"), { code: "EACCES" }); },
      read: async function () { throw new Error("disabled cache must not be read"); },
      write: async function () { cacheWrites++; throw new Error("disabled cache must not be written"); },
      purgeScope: async function () {},
    },
    workerRunner: async function (request) {
      if (request.command !== "extract") throw new Error("unexpected worker command");
      return {
        pages: Array.from({ length: 13 }, function (_, index) { return { page: index + 1, text: "" }; }),
        metadata: { numPages: 13 },
      };
    },
    ocrRunner: async function (request) {
      batches.push(request.pages.slice());
      return { pages: request.pages.map(function (page) { return { page: page, text: "扫描正文第" + page + "页", language: "zh-Hans-CN" }; }) };
    },
  });
  var readiness = await coordinator.initialize();
  assert.strictEqual(readiness.ok, true);
  assert.strictEqual(readiness.cacheDisabled, true, "cache failure must degrade to no-cache OCR");
  var result = await coordinator.run({
    command: "extract",
    filePath: pdf,
    startPage: 1,
    endPage: 13,
    scope: { accountId: "account-a", profileId: "p", worldId: "w", textbookId: "t", sessionEpoch: 1 },
    expectedLanguage: "zh-Hans-CN",
  });
  assert.deepStrictEqual(batches.map(function (batch) { return batch.length; }), [6, 6, 1]);
  assert.strictEqual(result.contiguousUsableEndPage, 13);
  assert.strictEqual(cacheWrites, 0);
  await coordinator.shutdown();

  var abortController = new AbortController();
  var abortObserved = false;
  var abortStartedResolve;
  var abortStarted = new Promise(function (resolve) { abortStartedResolve = resolve; });
  var abortCoordinator = coordinatorModule.createCoordinator({
    projectRoot: root,
    getAccountContext: function () { return { active: true, accountId: "account-a", sessionEpoch: 1 }; },
    cache: {
      initialize: async function () {},
      read: async function () { return null; },
      write: async function () {},
      purgeScope: async function () {},
    },
    workerRunner: function (request) {
      assert.strictEqual(request.signal, abortController.signal, "request signal must reach the active PDF worker runner");
      abortStartedResolve();
      return new Promise(function (resolve, reject) {
        request.signal.addEventListener("abort", function () {
          abortObserved = true;
          reject(Object.assign(new Error("ocr_request_aborted"), { code: "ocr_request_aborted" }));
        }, { once: true });
      });
    },
  });
  await abortCoordinator.initialize();
  var abortPending = abortCoordinator.run({
    command: "meta",
    filePath: pdf,
    scope: { accountId: "account-a", profileId: "p", worldId: "w", textbookId: "t", sessionEpoch: 1 },
    signal: abortController.signal,
    deadlineAt: Date.now() + 10000,
  });
  await abortStarted;
  abortController.abort();
  await Promise.race([
    assert.rejects(abortPending, function (error) { return error && error.code === "ocr_request_aborted"; }),
    new Promise(function (_, reject) { setTimeout(function () { reject(new Error("active PDF worker did not abort")); }, 500); }),
  ]);
  assert.strictEqual(abortObserved, true);
  await abortCoordinator.shutdown();

  var ocrAbortController = new AbortController();
  var ocrStartedResolve;
  var ocrStarted = new Promise(function (resolve) { ocrStartedResolve = resolve; });
  var ocrCacheWrites = 0;
  var ocrAbortCoordinator = coordinatorModule.createCoordinator({
    projectRoot: root,
    getAccountContext: function () { return { active: true, accountId: "account-a", sessionEpoch: 1 }; },
    cache: {
      initialize: async function () {},
      read: async function () { return null; },
      write: async function () { ocrCacheWrites++; },
      purgeScope: async function () {},
    },
    workerRunner: async function () { return { pages: [{ page: 1, text: "" }], metadata: { numPages: 1 } }; },
    ocrRunner: function (request) {
      assert.strictEqual(request.signal, ocrAbortController.signal);
      ocrStartedResolve();
      return new Promise(function (_, reject) {
        request.signal.addEventListener("abort", function () {
          reject(Object.assign(new Error("ocr_request_aborted"), { code: "ocr_request_aborted" }));
        }, { once: true });
      });
    },
  });
  await ocrAbortCoordinator.initialize();
  var ocrAbortPending = ocrAbortCoordinator.run({
    command: "extract",
    filePath: pdf,
    startPage: 1,
    endPage: 1,
    scope: { accountId: "account-a", profileId: "p", worldId: "w", textbookId: "t", sessionEpoch: 1 },
    signal: ocrAbortController.signal,
    deadlineAt: Date.now() + 10000,
  });
  await ocrStarted;
  ocrAbortController.abort();
  await assert.rejects(ocrAbortPending, function (error) { return error && error.code === "ocr_request_aborted"; });
  assert.strictEqual(ocrCacheWrites, 0, "aborted final OCR batches must never write cache");
  await ocrAbortCoordinator.shutdown();
  fs.rmSync(root, { recursive: true, force: true });

  var workerSource = fs.readFileSync(path.join(__dirname, "pdf-worker.mjs"), "utf8");
  var runnerSource = fs.readFileSync(path.join(__dirname, "ocr", "local-ocr-runner.mjs"), "utf8");
  assert(workerSource.includes("225 / 72"), "Windows OCR render must use 225 DPI");
  assert(workerSource.includes("slice(0, 6)"), "PDF OCR worker must cap each batch at six pages");
  assert(runnerSource.includes("MAX_ITEMS = 6"), "PowerShell OCR runner must cap each batch at six pages");
  var runtimeManifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "release-runtime-manifest.json"), "utf8"));
  assert.strictEqual(runtimeManifest.generatedFrom, ".next/node_modules");
  assert.strictEqual(runtimeManifest.packageVersions["@napi-rs/canvas"], "1.0.0");
  assert.strictEqual(runtimeManifest.packageVersions["pdfjs-dist"], "5.5.207");
  console.log("pdf OCR coordinator hardening smoke: PASS");
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
