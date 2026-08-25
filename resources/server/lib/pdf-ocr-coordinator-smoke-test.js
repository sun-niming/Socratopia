"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var coordinatorModule = require("./pdf-ocr-coordinator.js");

function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }

async function main() {
  var workerEnvironment = coordinatorModule.minimalWorkerEnvironment("");
  if (/\.exe$/i.test(process.execPath)) assert.strictEqual(workerEnvironment.ELECTRON_RUN_AS_NODE, "1", "packaged Electron workers must inherit Node mode");
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-ocr-coordinator-"));
  var active = { active: true, accountId: "account-a", sessionEpoch: 7 };
  var runningGlobal = 0;
  var maxGlobal = 0;
  var runningByAccount = new Map();
  var maxByAccount = new Map();
  var workerCalls = 0;
  var ocrCalls = 0;

  function textbook(accountId) {
    var dir = path.join(root, "accounts", accountId, "profiles", "p", "worlds", "w", "textbooks", "t");
    mkdirp(dir);
    var pdf = path.join(dir, "book.pdf");
    if (!fs.existsSync(pdf)) fs.writeFileSync(pdf, "synthetic-pdf-" + accountId);
    return pdf;
  }

  var pdfA = textbook("account-a");
  var pdfB = textbook("account-b");

  var coordinator = coordinatorModule.createCoordinator({
    projectRoot: root,
    cacheRoot: path.join(root, ".private", "ocr-cache-v1"),
    getAccountContext: function () { return Object.assign({}, active); },
    workerRunner: async function (request) {
      workerCalls += 1;
      runningGlobal += 1;
      maxGlobal = Math.max(maxGlobal, runningGlobal);
      var accountId = request.accountId;
      var accountRunning = (runningByAccount.get(accountId) || 0) + 1;
      runningByAccount.set(accountId, accountRunning);
      maxByAccount.set(accountId, Math.max(maxByAccount.get(accountId) || 0, accountRunning));
      await new Promise(function (resolve) { setTimeout(resolve, 20); });
      runningGlobal -= 1;
      runningByAccount.set(accountId, accountRunning - 1);
      if (request.command === "extract_adaptive") {
        return {
          pages: [
            { page: request.startPage, text: "" },
            { page: request.startPage + 1, text: "第二页文字层" }
          ],
          metadata: { numPages: 2 }
        };
      }
      return { pages: [], metadata: { numPages: 2 } };
    },
    ocrRunner: async function (request) {
      ocrCalls += 1;
      return {
        pages: request.pages.map(function (page) {
          return { page: page, text: "第一页本地OCR", language: "zh-Hans-CN", engine: "rapidocr-v5", confidence: 0.93 };
        })
      };
    }
  });
  await coordinator.initialize();

  var scope = { accountId: "account-a", profileId: "p", worldId: "w", textbookId: "t", sessionEpoch: 7 };
  var result = await coordinator.run({
    command: "extract_adaptive",
    filePath: pdfA,
    startPage: 1,
    targetChars: 40000,
    maxPages: 30,
    scope: scope,
    expectedLanguage: "zh-Hans-CN"
  });
  assert.strictEqual(result.pages[0].source, "rapidocr-v5");
  assert.strictEqual(result.pages[0].confidence, 0.93);
  assert.strictEqual(result.pages[1].source, "text-layer");
  assert.strictEqual(result.contiguousUsableEndPage, 2);
  assert.strictEqual(result.text.includes("第一页本地OCR"), true);
  assert.deepStrictEqual(result.failedPages, []);
  assert.strictEqual(ocrCalls, 1);

  var cached = await coordinator.run({
    command: "extract_adaptive",
    filePath: pdfA,
    startPage: 1,
    targetChars: 40000,
    maxPages: 30,
    scope: scope,
    expectedLanguage: "zh-Hans-CN"
  });
  assert.strictEqual(cached.pages[0].source, "rapidocr-v5");
  assert.strictEqual(cached.pages[0].confidence, 0.93);
  assert.strictEqual(cached.pages[0].cached, true);
  assert.strictEqual(ocrCalls, 1, "valid OCR cache must avoid duplicate recognition");

  var visionPdfHash = await coordinatorModule.digestFile(pdfA);
  await coordinator.writeVisionCache({ filePath: pdfA, scope: scope, page: 1, model: "vision-test-model", text: "远程视觉缓存正文", expectedPdfHash: visionPdfHash });
  var visionHit = await coordinator.readVisionCache({ filePath: pdfA, scope: scope, page: 1, model: "vision-test-model" });
  assert.strictEqual(visionHit.hit, true);
  assert.strictEqual(visionHit.text, "远程视觉缓存正文");
  var otherModelMiss = await coordinator.readVisionCache({ filePath: pdfA, scope: scope, page: 1, model: "other-model" });
  assert.strictEqual(otherModelMiss.hit, false, "vision model changes must invalidate the paid-result cache");
  fs.writeFileSync(pdfA, "replaced-pdf");
  await assert.rejects(function () {
    return coordinator.writeVisionCache({ filePath: pdfA, scope: scope, page: 2, model: "vision-test-model", text: "旧图不得写入新文件哈希", expectedPdfHash: visionPdfHash });
  }, function (error) { return error && error.code === "vision_cache_snapshot_stale"; });

  var failing = coordinatorModule.createCoordinator({
    projectRoot: root,
    cacheRoot: path.join(root, ".private", "ocr-cache-failing"),
    getAccountContext: function () { return Object.assign({}, active); },
    workerRunner: async function () {
      return { pages: [{ page: 1, text: "" }, { page: 2, text: "后页不能冒充目标页" }], metadata: { numPages: 2 } };
    },
    ocrRunner: async function () { return { pages: [{ page: 1, text: "", error: "ocr_timeout" }] }; }
  });
  await failing.initialize();
  var failed = await failing.run({ command: "extract_adaptive", filePath: pdfA, startPage: 1, targetChars: 40000, maxPages: 30, scope: scope, expectedLanguage: "zh-Hans-CN" });
  assert.strictEqual(failed.contiguousUsableEndPage, 0);
  assert.strictEqual(failed.text, "");
  assert.deepStrictEqual(failed.failedPages, [{ page: 1, reason: "ocr_timeout" }]);
  assert.strictEqual(failed.supplementalPages[0].page, 2);

  await assert.rejects(function () {
    return coordinator.run({ command: "extract_adaptive", filePath: pdfB, startPage: 1, targetChars: 1000, maxPages: 2, scope: scope, expectedLanguage: "zh-Hans-CN" });
  }, function (error) { return error && error.code === "pdf_scope_mismatch"; });

  workerCalls = 0;
  await Promise.all([
    coordinator.run({ command: "extract_adaptive", filePath: pdfA, startPage: 1, targetChars: 1000, maxPages: 2, scope: scope, expectedLanguage: "zh-Hans-CN", cachePolicy: "bypass" }),
    coordinator.run({ command: "extract_adaptive", filePath: pdfA, startPage: 1, targetChars: 1000, maxPages: 2, scope: scope, expectedLanguage: "zh-Hans-CN", cachePolicy: "bypass" })
  ]);
  assert.ok(maxGlobal <= 2, "global PDF worker limit must be <= 2");
  assert.ok((maxByAccount.get("account-a") || 0) <= 1, "per-account PDF worker limit must be <= 1");

  active.sessionEpoch = 8;
  await assert.rejects(function () {
    return coordinator.run({ command: "extract_adaptive", filePath: pdfA, startPage: 1, targetChars: 1000, maxPages: 2, scope: scope, expectedLanguage: "zh-Hans-CN" });
  }, function (error) { return error && error.code === "ocr_delivery_scope_stale"; });

  await coordinator.shutdown();
  await failing.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
  console.log("pdf-ocr-coordinator smoke: PASS");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exit(1);
});
