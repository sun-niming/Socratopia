"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Transaction = require("./transaction.js");

var passed = 0;

function tempWorld() {
  var world = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-continuity-tx-"));
  fs.mkdirSync(path.join(world, "textbooks", "book", "handoff"), { recursive: true });
  fs.writeFileSync(path.join(world, "pal_moments.md"), "old pal\n", "utf8");
  fs.writeFileSync(path.join(world, "diary.md"), "old diary\n", "utf8");
  fs.writeFileSync(path.join(world, "relation_npc_a.md"), "old relation\n", "utf8");
  return world;
}

function targets() {
  return [
    { relativePath: "pal_moments.md", content: "new pal\n" },
    { relativePath: "diary.md", content: "old diary\n\n---\n\nnew diary\n" },
    { relativePath: "relation_npc_a.md", content: "new relation\n" },
  ];
}

function oldState(world) {
  assert.strictEqual(fs.readFileSync(path.join(world, "pal_moments.md"), "utf8"), "old pal\n");
  assert.strictEqual(fs.readFileSync(path.join(world, "diary.md"), "utf8"), "old diary\n");
  assert.strictEqual(fs.readFileSync(path.join(world, "relation_npc_a.md"), "utf8"), "old relation\n");
}

function newState(world) {
  assert.strictEqual(fs.readFileSync(path.join(world, "pal_moments.md"), "utf8"), "new pal\n");
  assert.strictEqual(fs.readFileSync(path.join(world, "diary.md"), "utf8"), "old diary\n\n---\n\nnew diary\n");
  assert.strictEqual(fs.readFileSync(path.join(world, "relation_npc_a.md"), "utf8"), "new relation\n");
}

async function withWorld(run) {
  var world = tempWorld();
  try {
    await run(world);
  } finally {
    fs.rmSync(world, { recursive: true, force: true });
  }
}

async function testCommitAndReplay() {
  await withWorld(async function (world) {
    var operationId = "endclass:v1:test:commit-and-replay";
    var first = await Transaction.commit({
      worldDir: world,
      operationId: operationId,
      scope: { accountId: "acct_a", profileId: "p", worldId: "w", conversationId: "c" },
      targets: targets(),
      receiptPayload: { farewell: "bye", companionNote: "note" },
    });
    assert.strictEqual(first.committed, true);
    assert.strictEqual(first.replayed, false);
    newState(world);
    var second = await Transaction.commit({
      worldDir: world,
      operationId: operationId,
      scope: { accountId: "acct_a", profileId: "p", worldId: "w", conversationId: "c" },
      targets: [{ relativePath: "pal_moments.md", content: "must not replace receipt state\n" }],
    });
    assert.strictEqual(second.replayed, true);
    assert.strictEqual(second.receipt.payload.farewell, "bye");
    newState(world);
    passed += 1;
    console.log("PASS transaction commit + receipt replay");
  });
}

async function testEveryFaultPointRollsBack() {
  var phases = ["before_backup", "after_backup", "after_apply"];
  for (var phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
    for (var targetIndex = 0; targetIndex < targets().length; targetIndex += 1) {
     await withWorld(async function (world) {
       var phase = phases[phaseIndex];
       var operationId = "endclass:v1:test:" + phase + ":" + targetIndex;
       var thrown = null;
        try {
          await Transaction.commit({
            worldDir: world,
            operationId: operationId,
            targets: targets(),
            faultInjector: function (info) {
              return info.phase === phase && info.index === targetIndex;
            },
          });
        } catch (error) {
          thrown = error;
        }
        assert(thrown, "fault injector must abort the transaction");
        assert.strictEqual(thrown.code, "CONTINUITY_FAULT_INJECTED");
        await Transaction.recoverWorld(world);
        // A crash after the final rename has a complete target set. Recovery
        // rolls it forward and writes a receipt; all other points roll back.
        if (phase === "after_apply" && targetIndex === targets().length - 1) {
          newState(world);
          assert(await Transaction.readReceipt(world, operationId));
        } else {
          oldState(world);
          assert.strictEqual(await Transaction.readReceipt(world, operationId), null);
        }
        assert.deepStrictEqual(Transaction.diagnostics(world), []);
        passed += 1;
      });
    }
  }
  console.log("PASS transaction fault points rollback without partial visible state");
}

async function testRestartRecovery() {
  await withWorld(async function (world) {
    var operationId = "endclass:v1:test:restart-recovery";
    var interrupted = null;
    try {
      await Transaction.commit({
        worldDir: world,
        operationId: operationId,
        targets: targets(),
        testOnlyLeaveJournal: true,
        faultInjector: function (info) { return info.phase === "after_apply" && info.index === 1; },
      });
    } catch (error) {
      interrupted = error;
    }
    assert(interrupted, "interrupted commit must throw");
    assert.strictEqual(interrupted.code, "CONTINUITY_FAULT_INJECTED");
    assert.strictEqual(Transaction.diagnostics(world).length, 1);
    await Transaction.recoverWorld(world);
    oldState(world);
    assert.strictEqual(await Transaction.readReceipt(world, operationId), null);
    assert.deepStrictEqual(Transaction.diagnostics(world), []);
    passed += 1;
    console.log("PASS restart recovery rolls back prepared partial transaction");
  });
}

async function testPreconditionConflict() {
  await withWorld(async function (world) {
    var operationId = "endclass:v1:test:precondition";
    var thrown = null;
    try {
      await Transaction.commit({
        worldDir: world,
        operationId: operationId,
        targets: targets(),
        faultInjector: function (info) {
          if (info.phase === "before_backup" && info.index === 0) fs.writeFileSync(path.join(world, "pal_moments.md"), "manual edit\n", "utf8");
          return false;
        },
      });
    } catch (error) {
      thrown = error;
    }
    assert(thrown, "manual edit must be rejected");
    assert.strictEqual(thrown.code, "CONTINUITY_PRECONDITION_FAILED");
    assert.strictEqual(fs.readFileSync(path.join(world, "pal_moments.md"), "utf8"), "manual edit\n");
    assert.strictEqual(await Transaction.readReceipt(world, operationId), null);
    passed += 1;
    console.log("PASS transaction detects manual precondition conflict");
  });
}

async function testAuthorizationFenceRollsBack() {
  await withWorld(async function (world) {
    var operationId = "endclass:v1:test:authorization-fence";
    var calls = 0;
    var thrown = null;
    try {
      await Transaction.commit({
        worldDir: world,
        operationId: operationId,
        targets: targets(),
        assertStillAuthorized: function (info) {
          calls += 1;
          if (info.phase === "before_target" && info.index === 1) {
            var error = new Error("Account session changed");
            error.code = "SCOPE_STALE";
            error.status = 409;
            throw error;
          }
        },
      });
    } catch (error) {
      thrown = error;
    }
    assert(thrown, "authorization fence must stop the commit");
    assert.strictEqual(thrown.code, "SCOPE_STALE");
    assert(calls >= 2, "authorization callback runs before multiple mutation boundaries");
    oldState(world);
    assert.strictEqual(await Transaction.readReceipt(world, operationId), null);
    passed += 1;
    console.log("PASS transaction authorization fence rolls back stale writes");
  });
}

(async function () {
  await testCommitAndReplay();
  await testEveryFaultPointRollsBack();
  await testRestartRecovery();
  await testPreconditionConflict();
  await testAuthorizationFenceRollsBack();
  console.log("ALL PASS transaction smoke (" + passed + " cases)");
})().catch(function (error) {
  console.error("FAIL transaction smoke:", error && error.stack || error);
  process.exitCode = 1;
});
