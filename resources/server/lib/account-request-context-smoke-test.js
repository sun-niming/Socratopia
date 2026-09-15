"use strict";

var assert = require("assert");
var createAccountRequestContext = require("./account-request-context.js").createAccountRequestContext;

function deferred() {
  var resolve;
  var promise = new Promise(function (done) { resolve = done; });
  return { promise: promise, resolve: resolve };
}

async function main() {
  var context = createAccountRequestContext();
  assert.strictEqual(context.getAccountId(), null);

  var releaseA = deferred();
  var releaseB = deferred();
  var seen = [];
  var taskA = context.run("account_a", async function () {
    seen.push("a:start:" + context.getAccountId());
    await releaseA.promise;
    seen.push("a:end:" + context.getAccountId());
  });
  var taskB = context.run("account_b", async function () {
    seen.push("b:start:" + context.getAccountId());
    releaseA.resolve();
    await releaseB.promise;
    seen.push("b:end:" + context.getAccountId());
  });
  await taskA;
  releaseB.resolve();
  await taskB;
  assert.deepStrictEqual(seen.sort(), [
    "a:end:account_a",
    "a:start:account_a",
    "b:end:account_b",
    "b:start:account_b"
  ]);
  assert.strictEqual(context.getAccountId(), null);

  await context.run("outer", async function () {
    assert.strictEqual(context.getAccountId(), "outer");
    await context.run("inner", async function () {
      await Promise.resolve();
      assert.strictEqual(context.getAccountId(), "inner");
    });
    assert.strictEqual(context.getAccountId(), "outer");
  });

  await assert.rejects(context.run("throws", async function () {
    await Promise.resolve();
    assert.strictEqual(context.getAccountId(), "throws");
    throw new Error("expected");
  }), /expected/);
  assert.strictEqual(context.getAccountId(), null);

  var controller = new AbortController();
  await context.run("aborted", async function () {
    controller.abort();
    await Promise.resolve();
    assert.strictEqual(controller.signal.aborted, true);
    assert.strictEqual(context.getAccountId(), "aborted");
  });
  assert.strictEqual(context.getAccountId(), null);

  function routeWrapper(headerAccountId, callback) {
    var existing = context.getAccountId();
    if (existing) return callback();
    return context.run(headerAccountId, callback);
  }
  var releaseMixed = deferred();
  var mixed = [];
  var ordinary = routeWrapper("ordinary", async function () {
    await releaseMixed.promise;
    mixed.push("ordinary:" + context.getAccountId());
  });
  var adaptive = context.run("adaptive", async function () {
    await routeWrapper(null, async function () {
      await Promise.resolve();
      mixed.push("adaptive:" + context.getAccountId());
    });
    releaseMixed.resolve();
  });
  await Promise.all([ordinary, adaptive]);
  assert.deepStrictEqual(mixed.sort(), ["adaptive:adaptive", "ordinary:ordinary"]);
  assert.strictEqual(context.getAccountId(), null);

  assert.throws(function () { context.run("../escape", function () {}); }, /Invalid accountId/);
  assert.throws(function () { context.run("valid", null); }, /callback/);
  console.log("account request context smoke test passed");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
