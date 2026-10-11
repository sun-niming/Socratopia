"use strict";

// BUG-0021 (2026-10-11): a chat turn whose textbook window must be OCR'd can run
// past the request fence. Before this fix the whole call's OCR output was cached
// only *after* the batch loop, so a deadline/abort in a later batch threw away
// every finished page. The conversation therefore retried from a cold cache,
// died at the same place, and never committed a window -- surfacing
// `**ocr_request_deadline**` as the assistant reply while `empty_window_reload`
// re-ran on every turn.
//
// This test drives the coordinator with two OCR batches where the second one
// fails with the deadline code and asserts the first batch still reached the
// cache, so the next attempt converges instead of livelocking.

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var coordinatorModule = require("./pdf-ocr-coordinator.js");

function text(page) {
  return "第" + page + "页 编译原理 词法分析 语法分析 语义分析 中间代码 优化 目标代码 生成 符号表 类型检查";
}

function fakeCache() {
  var entries = new Map();
  var writes = [];
  return {
    entries: entries,
    writes: writes,
    initialize: async function () {},
    read: async function (key) {
      var hit = entries.get(JSON.stringify(key));
      return hit ? { text: hit.text, source: hit.source, language: hit.language } : null;
    },
    write: async function (key, value) {
      writes.push(value.page);
      entries.set(JSON.stringify(key), { text: value.text, source: value.source, language: value.language });
    },
    purgeScope: async function () {},
    purgeProfile: async function () {},
    purgeAccount: async function () {}
  };
}

function buildFixture() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-batch-flush-"));
  var textbook = path.join(root, "accounts", "a", "profiles", "p", "worlds", "w", "textbooks", "t");
  fs.mkdirSync(textbook, { recursive: true });
  var pdf = path.join(textbook, "book.pdf");
  fs.writeFileSync(pdf, "pdf");
  return { root: root, pdf: pdf };
}

var SCOPE = { accountId: "a", sessionEpoch: 1, profileId: "p", worldId: "w", textbookId: "t" };
var PAGES = 12;

function createCoordinator(fixture, cache, failSecondBatch) {
  var ocrBatches = 0;
  var runner = async function (request) {
    if (request.command === "extract") {
      var pages = [];
      for (var page = request.startPage; page <= request.endPage; page++) pages.push({ page: page, text: "" });
      return { pages: pages };
    }
    if (request.command === "ocr_pages") {
      ocrBatches += 1;
      if (failSecondBatch && ocrBatches === 2) throw coordinatorModule.codedError("ocr_request_deadline");
      return { pages: request.pages.map(function (page) { return { page: page, text: text(page), engine: "windows-ocr" }; }) };
    }
    return { pages: [] };
  };
  return coordinatorModule.createCoordinator({
    projectRoot: fixture.root,
    getAccountContext: function () { return { active: true, accountId: "a", sessionEpoch: 1 }; },
    workerRunner: runner,
    cache: cache
  });
}

function runExtract(coordinator, fixture) {
  return coordinator.run({
    command: "extract",
    filePath: fixture.pdf,
    startPage: 1,
    endPage: PAGES,
    scope: SCOPE,
    expectedLanguage: "zh-Hans-CN",
    deadlineAt: Date.now() + 30000
  });
}

async function main() {
  var fixture = buildFixture();
  try {
    // Scenario 1: the second batch dies on the request deadline. The first
    // batch must already be in the cache when the rejection surfaces.
    var cache = fakeCache();
    var failing = createCoordinator(fixture, cache, true);
    await failing.initialize();
    await assert.rejects(runExtract(failing, fixture), function (error) {
      return error && error.code === "ocr_request_deadline";
    });
    assert.deepStrictEqual(cache.writes.slice().sort(function (a, b) { return a - b; }), [1, 2, 3, 4, 5, 6],
      "every completed OCR batch must be flushed before the failure propagates");
    await failing.shutdown();

    // Scenario 2: the retry reuses that cache and converges.
    var retry = createCoordinator(fixture, cache, false);
    await retry.initialize();
    var result = await runExtract(retry, fixture);
    assert.strictEqual(result.successfulPages.length, PAGES, "the retry must complete the whole window from the warm cache");
    assert.deepStrictEqual(cache.writes.slice().sort(function (a, b) { return a - b; }), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      "pages already flushed by the failed attempt must not be OCR'd or written twice");
    await retry.shutdown();

    // Scenario 3: the fully successful path writes each page exactly once.
    var cleanCache = fakeCache();
    var clean = createCoordinator(fixture, cleanCache, false);
    await clean.initialize();
    await runExtract(clean, fixture);
    assert.strictEqual(cleanCache.writes.length, PAGES, "a successful extract must cache each page exactly once");
    await clean.shutdown();
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
  console.log("pdf OCR batch cache flush smoke: PASS");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
