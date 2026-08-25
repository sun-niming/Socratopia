"use strict";

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

async function main() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-deadline-race-"));
  var textbook = path.join(root, "accounts", "a", "profiles", "p", "worlds", "w", "textbooks", "t");
  fs.mkdirSync(textbook, { recursive: true });
  var pdf = path.join(textbook, "book.pdf");
  fs.writeFileSync(pdf, "pdf");
  var scope = { accountId: "a", sessionEpoch: 1, profileId: "p", worldId: "w", textbookId: "t" };
  var firstStarted = deferred();
  var firstRelease = deferred();
  var calls = 0;
  var coordinator = coordinatorModule.createCoordinator({
    projectRoot: root,
    getAccountContext: function () { return { active: true, accountId: "a", sessionEpoch: 1 }; },
    workerRunner: async function () {
      calls += 1;
      firstStarted.resolve();
      await firstRelease.promise;
      return { pages: [{ page: 1, pngB64: Buffer.from("late").toString("base64") }] };
    }
  });
  await coordinator.initialize();

  var running = coordinator.run({ command: "render", filePath: pdf, startPage: 1, endPage: 1, scope: scope, deadlineAt: Date.now() + 60 });
  await firstStarted.promise;
  await assert.rejects(Promise.race([
    running,
    new Promise(function (_, reject) { setTimeout(function () { reject(new Error("running deadline was not enforced")); }, 250); })
  ]), function (error) { return error && error.code === "ocr_request_deadline"; });

  var queued = coordinator.run({ command: "render", filePath: pdf, startPage: 1, endPage: 1, scope: scope, cachePolicy: "bypass", deadlineAt: Date.now() + 40 });
  await assert.rejects(queued, function (error) { return error && error.code === "ocr_request_deadline"; });
  assert.strictEqual(calls, 1, "a queued job that expires must never start");

  firstRelease.resolve();
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  await coordinator.shutdown();

  var sharedStarted = deferred();
  var sharedRelease = deferred();
  var sharedCalls = 0;
  var sharedCoordinator = coordinatorModule.createCoordinator({
    projectRoot: root,
    getAccountContext: function () { return { active: true, accountId: "a", sessionEpoch: 1 }; },
    workerRunner: async function () {
      sharedCalls += 1;
      sharedStarted.resolve();
      await sharedRelease.promise;
      return { pages: [{ page: 1, pngB64: Buffer.from("shared").toString("base64") }] };
    }
  });
  await sharedCoordinator.initialize();
  var sharedFirst = sharedCoordinator.run({ command: "render", filePath: pdf, startPage: 1, endPage: 1, scope: scope, deadlineAt: Date.now() + 1000 });
  await sharedStarted.promise;
  var sharedSecond = sharedCoordinator.run({ command: "render", filePath: pdf, startPage: 1, endPage: 1, scope: scope, deadlineAt: Date.now() + 40 });
  await assert.rejects(Promise.race([
    sharedSecond,
    new Promise(function (_, reject) { setTimeout(function () { reject(new Error("single-flight observer deadline was not enforced")); }, 250); })
  ]), function (error) { return error && error.code === "ocr_request_deadline"; });
  assert.strictEqual(sharedCalls, 1, "the shorter independent deadline must expire while queued");
  sharedRelease.resolve();
  await sharedFirst;
  await sharedCoordinator.shutdown();

  var reverseStarted = deferred();
  var reverseRelease = deferred();
  var reverseCalls = 0;
  var reverseCoordinator = coordinatorModule.createCoordinator({
    projectRoot: root,
    getAccountContext: function () { return { active: true, accountId: "a", sessionEpoch: 1 }; },
    workerRunner: async function () {
      reverseCalls += 1;
      reverseStarted.resolve();
      await reverseRelease.promise;
      return { pages: [{ page: 1, pngB64: Buffer.from("reverse").toString("base64") }] };
    }
  });
  await reverseCoordinator.initialize();
  var reverseFirst = reverseCoordinator.run({ command: "render", filePath: pdf, startPage: 1, endPage: 1, scope: scope, deadlineAt: Date.now() + 50 });
  await reverseStarted.promise;
  var reverseSecond = reverseCoordinator.run({ command: "render", filePath: pdf, startPage: 1, endPage: 1, scope: scope, deadlineAt: Date.now() + 800 });
  await assert.rejects(reverseFirst, function (error) { return error && error.code === "ocr_request_deadline"; });
  reverseRelease.resolve();
  await reverseSecond;
  assert.strictEqual(reverseCalls, 2, "requests with different absolute deadlines must not share a deadline-bound task");
  await reverseCoordinator.shutdown();

  fs.rmSync(root, { recursive: true, force: true });
  console.log("pdf OCR deadline race smoke: PASS");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
