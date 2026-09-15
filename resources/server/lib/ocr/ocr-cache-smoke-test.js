"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var cacheModule = require("./ocr-cache.js");

async function main() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-ocr-cache-"));
  var cache = cacheModule.createCache({ root: root, maxTextbookBytes: 600 * 1024, maxProfileBytes: 800 * 1024, maxGlobalBytes: 1024 * 1024, ttlMs: 60000 });
  await cache.initialize();

  var commitStartedResolve;
  var commitReleaseResolve;
  var commitStarted = new Promise(function (resolve) { commitStartedResolve = resolve; });
  var commitRelease = new Promise(function (resolve) { commitReleaseResolve = resolve; });
  var guardedRoot = path.join(root, "guarded");
  var guardedCache = cacheModule.createCache({
    root: guardedRoot,
    beforeCommit: async function () { commitStartedResolve(); await commitRelease; },
  });
  await guardedCache.initialize();
  var active = true;
  var guardedWrite = guardedCache.write(key(99), { text: "不得在取消后提交的缓存", language: "zh-Hans-CN" }, { guard: function () {
    if (!active) { var error = new Error("ocr_request_aborted"); error.code = "ocr_request_aborted"; throw error; }
  }});
  await commitStarted;
  active = false;
  commitReleaseResolve();
  await assert.rejects(guardedWrite, function (error) { return error && error.code === "ocr_request_aborted"; });
  assert.strictEqual(fs.existsSync(guardedCache._entryPath(key(99))), false, "an aborted write must delete its temp file and never rename a formal cache entry");
  function key(page, textbook) {
    return { accountId: "account-secret", profileId: "profile-secret", worldId: "world-secret", textbookId: textbook || "book-secret", pdfHash: "a".repeat(64), page: page, schema: "windows-ocr-v1", language: "zh-Hans-CN", dpi: 150, qualityVersion: "quality-v1", engineMarker: "engine" };
  }
  var text = "汉" + "a".repeat(190 * 1024);
  for (var page = 1; page <= 4; page++) {
    await cache.write(key(page), { text: text + page, language: "zh-Hans-CN" });
    await new Promise(function (resolve) { setTimeout(resolve, 5); });
  }
  assert.strictEqual(await cache.read(key(1)), null, "textbook LRU must evict the oldest entry before exceeding 64MiB-equivalent configured quota");
  assert((await cache.read(key(4))).text.endsWith("4"), "newest entry must survive LRU enforcement");
  await cache.write(key(8), { text: "离线模型缓存", language: "zh-Hans-CN", source: "rapidocr-v5", confidence: 0.92 });
  var rapidHit = await cache.read(key(8));
  assert.strictEqual(rapidHit.source, "rapidocr-v5", "cache must preserve the actual local OCR engine");
  assert.strictEqual(rapidHit.confidence, 0.92, "cache must preserve local model confidence");
  var allPaths = [];
  (function walk(directory) { fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) { var item = path.join(directory, entry.name); if (entry.isDirectory()) walk(item); else allPaths.push(item); }); })(root);
  assert(!allPaths.some(function (item) { return /account-secret|profile-secret|world-secret|book-secret/.test(item); }), "cache paths must not expose raw scope identifiers");
  var oldKey = key(9, "old-book");
  await cache.write(oldKey, { text: "过期内容", language: "zh-Hans-CN" });
  var oldFile = cache._entryPath(oldKey);
  var oldDate = new Date(Date.now() - 120000);
  fs.utimesSync(oldFile, oldDate, oldDate);
  var reopened = cacheModule.createCache({ root: root, ttlMs: 60000 });
  await reopened.initialize();
  assert.strictEqual(await reopened.read(oldKey), null, "startup TTL sweep must remove expired cache entries");
  await reopened.purgeScope(key(1));
  assert.strictEqual(await reopened.read(key(4)), null, "scope purge must remove only exact cache files through the private index");
  fs.rmSync(root, { recursive: true, force: true });
  console.log("ocr cache smoke: PASS");
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
