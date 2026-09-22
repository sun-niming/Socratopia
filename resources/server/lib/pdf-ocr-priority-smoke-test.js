"use strict";

// Reproduces the interactive-read starvation seen with scanned PDFs:
// an auto-advance background prefetch (up to 30 OCR pages, ~90s deadline)
// occupies the per-account slot, and an interactive read queued behind it
// expires with ocr_request_deadline before it ever starts.
//
// Expected behavior after the fix:
// - interactive jobs may start even while a same-account background job runs
//   (the global cap of 2 and the per-batch runOcrExclusive lock still bound
//   actual engine contention);
// - queued interactive jobs are preferred over queued background jobs;
// - background jobs keep working when no interactive job competes.

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var coordinatorModule = require("./pdf-ocr-coordinator.js");

function deferred() {
  var resolve;
  var promise = new Promise(function (done) { resolve = done; });
  return { promise: promise, resolve: resolve };
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function makeHarness(root, workerBehavior) {
  var textbook = path.join(root, "accounts", "a", "profiles", "p", "worlds", "w", "textbooks", "t");
  fs.mkdirSync(textbook, { recursive: true });
  var pdf = path.join(textbook, "book.pdf");
  fs.writeFileSync(pdf, "pdf");
  var coordinator = coordinatorModule.createCoordinator({
    projectRoot: root,
    getAccountContext: function () { return { active: true, accountId: "a", sessionEpoch: 1 }; },
    workerRunner: workerBehavior
  });
  return {
    coordinator: coordinator,
    scope: { accountId: "a", sessionEpoch: 1, profileId: "p", worldId: "w", textbookId: "t" },
    pdf: pdf
  };
}

async function scenarioInteractiveBypassesRunningBackground() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-priority-running-"));
  try {
    var backgroundStarted = deferred();
    var backgroundRelease = deferred();
    var workerCalls = 0;
    var harness = makeHarness(root, async function () {
      workerCalls += 1;
      if (workerCalls === 1) {
        backgroundStarted.resolve();
        await backgroundRelease.promise;
        return { pages: [{ page: 1, pngB64: Buffer.from("bg").toString("base64") }] };
      }
      return { pages: [{ page: 1, pngB64: Buffer.from("fg").toString("base64") }] };
    });
    await harness.coordinator.initialize();

    var background = harness.coordinator.run({
      command: "render", filePath: harness.pdf, startPage: 1, endPage: 1,
      scope: harness.scope, deadlineAt: Date.now() + 60000, priority: "background"
    });
    background.catch(function () {});
    await backgroundStarted.promise;

    // Same account, short interactive deadline: must complete without waiting
    // for the background job to finish.
    var interactive = await harness.coordinator.run({
      command: "render", filePath: harness.pdf, startPage: 1, endPage: 1,
      scope: harness.scope, cachePolicy: "bypass", deadlineAt: Date.now() + 3000, priority: "interactive"
    });
    assert.ok(interactive && Array.isArray(interactive.pages), "interactive read must complete while a background job is running");

    backgroundRelease.resolve();
    await background;
    await harness.coordinator.shutdown();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function scenarioQueuedInteractiveJumpsAheadOfQueuedBackground() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-priority-queue-"));
  try {
    var order = [];
    var firstStarted = deferred();
    var firstRelease = deferred();
    var harness = makeHarness(root, async function (request) {
      var tag = request.startPage;
      order.push("start:" + tag);
      if (tag === 1) { firstStarted.resolve(); await firstRelease.promise; }
      order.push("end:" + tag);
      return { pages: [{ page: tag, pngB64: Buffer.from("x").toString("base64") }] };
    });
    await harness.coordinator.initialize();

    // Occupy BOTH global slots so everything else queues.
    // One slot occupied (default = interactive priority), two jobs queue behind it.
    var slotA = harness.coordinator.run({ command: "render", filePath: harness.pdf, startPage: 1, endPage: 1, scope: harness.scope, cachePolicy: "bypass", deadlineAt: Date.now() + 60000 });
    slotA.catch(function () {});
    var queuedBackground = harness.coordinator.run({ command: "render", filePath: harness.pdf, startPage: 2, endPage: 2, scope: harness.scope, cachePolicy: "bypass", deadlineAt: Date.now() + 60000, priority: "background" });
    queuedBackground.catch(function () {});
    var queuedInteractive = harness.coordinator.run({ command: "render", filePath: harness.pdf, startPage: 3, endPage: 3, scope: harness.scope, cachePolicy: "bypass", deadlineAt: Date.now() + 60000, priority: "interactive" });
    queuedInteractive.catch(function () {});
    await firstStarted.promise;
    await delay(30); // let both jobs enqueue
    firstRelease.resolve();
    await Promise.all([slotA, queuedBackground, queuedInteractive]);

    var interactiveEnd = order.indexOf("end:3");
    var backgroundEnd = order.indexOf("end:2");
    assert.ok(interactiveEnd >= 0 && backgroundEnd >= 0, "both queued jobs must complete");
    assert.ok(interactiveEnd < backgroundEnd, "queued interactive job must finish before queued background job; got order: " + order.join(","));
    await harness.coordinator.shutdown();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function scenarioBackgroundStillRunsAlone() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-priority-solo-"));
  try {
    var harness = makeHarness(root, async function () {
      return { pages: [{ page: 1, pngB64: Buffer.from("bg").toString("base64") }] };
    });
    await harness.coordinator.initialize();
    var result = await harness.coordinator.run({
      command: "render", filePath: harness.pdf, startPage: 1, endPage: 1,
      scope: harness.scope, deadlineAt: Date.now() + 5000, priority: "background"
    });
    assert.ok(result && result.pages && result.pages.length === 1, "background job must still run when uncontended");
    await harness.coordinator.shutdown();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  await scenarioBackgroundStillRunsAlone();
  await scenarioQueuedInteractiveJumpsAheadOfQueuedBackground();
  await scenarioInteractiveBypassesRunningBackground();
  console.log("pdf OCR priority smoke: PASS");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
