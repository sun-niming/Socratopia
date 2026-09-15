"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var budgetModule = require("./vision-budget.js");

function deferred() {
  var resolve;
  var reject;
  var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
  return { promise: promise, resolve: resolve, reject: reject };
}

function expectCode(promise, code) {
  return promise.then(function () {
    assert.fail("expected rejection: " + code);
  }, function (error) {
    assert.strictEqual(error && error.code, code);
  });
}

var requestSequence = 0;
function request(execute, extra) {
  requestSequence += 1;
  return Object.assign({
    purpose: "close-reading",
    imageCount: 1,
    inputBytes: 1024,
    maxOutputTokens: 6000,
    operationId: "operation-test-" + String(requestSequence).padStart(4, "0"),
    page: 1,
    scope: { profileId: "profile", worldId: "world", textbookId: "book" },
    execute: execute,
  }, extra || {});
}

async function main() {
  var ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-vision-budget-"));
  var account = { active: true, accountId: "account-a", sessionEpoch: 1 };
  var budget = budgetModule.createVisionBudget({
    getAccountContext: function () { return account; },
    maxConcurrent: 1,
    maxQueued: 1,
    maxQueueWaitMs: 30,
    maxRuntimeMs: 2000,
    ledgerRoot: ledgerRoot,
    maxDailyAttempts: 20,
  });

  var invalidCalled = false;
  await expectCode(budget.run(request(function () { invalidCalled = true; }, { purpose: "builder" })), "vision_purpose_denied");
  assert.strictEqual(invalidCalled, false);

  var staleCalled = false;
  await expectCode(budget.run(request(function () { staleCalled = true; }, {
    expectedAccountId: "account-a",
    expectedSessionEpoch: 0,
  })), "vision_account_changed");
  assert.strictEqual(staleCalled, false, "a stale render must be rejected before reserving or executing vision");

  var firstStarted = deferred();
  var releaseFirst = deferred();
  var order = [];
  var first = budget.run(request(async function () {
    order.push("first-start");
    firstStarted.resolve();
    await releaseFirst.promise;
    order.push("first-end");
    return "first";
  }));
  await firstStarted.promise;
  var second = budget.run(request(async function () {
    order.push("second-start");
    return "second";
  }));
  await expectCode(budget.run(request(async function () { return "third"; })), "vision_queue_full");
  releaseFirst.resolve();
  assert.deepStrictEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepStrictEqual(order, ["first-start", "first-end", "second-start"]);
  assert.strictEqual(budget.stats().peakActive, 1);

  var blockingStarted = deferred();
  var blockingRelease = deferred();
  var blocking = budget.run(request(async function () {
    blockingStarted.resolve();
    await blockingRelease.promise;
    return "blocking";
  }));
  await blockingStarted.promise;
  var alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await expectCode(budget.run(request(async function () { return "cancelled"; }, { signal: alreadyAborted.signal })), "vision_request_cancelled");
  assert.strictEqual(budget.stats().queued, 0, "an already-aborted request must not remain queued");
  await expectCode(budget.run(request(async function () { return "late"; })), "vision_queue_timeout");
  blockingRelease.resolve();
  assert.strictEqual(await blocking, "blocking");

  var deadlineStarted = deferred();
  var deadlineRequest = budget.run(request(function (signal) {
    deadlineStarted.resolve();
    return new Promise(function (_resolve, reject) {
      signal.addEventListener("abort", function () { reject(signal.reason || new Error("deadline")); }, { once: true });
    });
  }, { deadlineAt: Date.now() + 40 }));
  await deadlineStarted.promise;
  await expectCode(deadlineRequest, "vision_request_deadline");

  var scopeStarted = deferred();
  var scoped = budget.run(request(function (signal) {
    scopeStarted.resolve();
    return new Promise(function (_resolve, reject) {
      signal.addEventListener("abort", function () { reject(signal.reason || new Error("scope")); }, { once: true });
    });
  }));
  await scopeStarted.promise;
  await budget.cancelScope({ accountId: "account-a", sessionEpoch: 1, profileId: "profile", worldId: "world", textbookId: "book" });
  await expectCode(scoped, "vision_scope_cancelled");

  var abortStarted = deferred();
  var active = budget.run(request(function (signal) {
    abortStarted.resolve();
    return new Promise(function (_resolve, reject) {
      signal.addEventListener("abort", function () {
        var error = new Error("aborted");
        error.code = "ABORT_ERR";
        reject(error);
      }, { once: true });
    });
  }));
  await abortStarted.promise;
  account = { active: true, accountId: "account-b", sessionEpoch: 2 };
  budget.syncAccount(account);
  await expectCode(active, "vision_account_changed");

  var shutdownStarted = deferred();
  var current = budget.run(request(function (signal) {
    shutdownStarted.resolve();
    return new Promise(function (_resolve, reject) {
      signal.addEventListener("abort", function () { reject(signal.reason || new Error("shutdown")); }, { once: true });
    });
  }));
  await shutdownStarted.promise;
  var queued = budget.run(request(async function () { return "never"; }));
  await budget.shutdown();
  await expectCode(current, "vision_budget_shutdown");
  await expectCode(queued, "vision_budget_shutdown");
  await expectCode(budget.run(request(async function () { return "never"; })), "vision_budget_shutdown");
  assert.strictEqual(budget.stats().stopped, true);

  account = { active: true, accountId: "daily-account", sessionEpoch: 1 };
  var daily = budgetModule.createVisionBudget({
    getAccountContext: function () { return account; },
    ledgerRoot: ledgerRoot,
    maxDailyAttempts: 2,
  });
  assert.strictEqual(await daily.run(request(async function () { return "one"; }, { operationId: "daily-operation-1", page: 1 })), "one");
  assert.strictEqual(await daily.run(request(async function () { return "two"; }, { operationId: "daily-operation-1", page: 2 })), "two");
  await daily.shutdown();
  var reopened = budgetModule.createVisionBudget({
    getAccountContext: function () { return account; },
    ledgerRoot: ledgerRoot,
    maxDailyAttempts: 2,
  });
  await expectCode(reopened.run(request(async function () { return "three"; }, { operationId: "daily-operation-2", page: 1 })), "vision_daily_budget_exhausted");
  await reopened.shutdown();
  fs.rmSync(ledgerRoot, { recursive: true, force: true });
  console.log("vision budget smoke: PASS");
}

var testKeepAlive = setInterval(function () {}, 1000);
main().then(function () { clearInterval(testKeepAlive); }).catch(function (error) {
  clearInterval(testKeepAlive);
  console.error(error.stack || error);
  process.exitCode = 1;
});
