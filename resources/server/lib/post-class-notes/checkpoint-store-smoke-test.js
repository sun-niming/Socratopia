"use strict";

// PN-004 — checkpoint store: atomic writes under Windows EPERM pressure,
// resumable state, retention cleanup and single-flight.
//
//   node resources/server/lib/post-class-notes/checkpoint-store-smoke-test.js

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var storeModule = require("./checkpoint-store.js");

var created = [];

function tmpRoot(label) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcn-" + label + "-"));
  created.push(dir);
  return dir;
}

function cleanupAll() {
  created.forEach(function (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
}

// Rename is the half that actually fails on Windows; make it fail N times.
function flakyFs(failures, options) {
  var opts = options || {};
  var state = { renames: 0 };
  return {
    state: state,
    promises: Object.assign({}, fs.promises, {
      rename: async function (from, to) {
        state.renames += 1;
        if (state.renames <= failures) {
          var error = new Error("EPERM: operation not permitted, rename");
          error.code = "EPERM";
          throw error;
        }
        if (opts.failHardCode) {
          var hard = new Error("boom");
          hard.code = opts.failHardCode;
          throw hard;
        }
        return fs.promises.rename(from, to);
      }
    })
  };
}

function scenario(name, body) {
  return Promise.resolve().then(body).then(function () {
    console.log("  ok   " + name);
  }, function (error) {
    error.message = name + ": " + error.message;
    throw error;
  });
}

function noTempLeftovers(dir) {
  var entries = fs.readdirSync(dir, { recursive: true });
  return entries.filter(function (entry) { return String(entry).indexOf(".tmp-") >= 0; });
}

async function main() {
  await scenario("a job survives the full lifecycle on disk", async function () {
    var store = storeModule.createStore(tmpRoot("lifecycle"));
    await store.writeJob("conv1", "pn_1", { jobId: "pn_1", conversationId: "conv1", status: "running", createdAt: 1 });
    await store.writePartition("conv1", "pn_1", [{ chunkId: "chunk-001" }]);
    await store.writeChunk("conv1", "pn_1", "chunk-001", { chunkId: "chunk-001", topics: [] });
    await store.writeChunk("conv1", "pn_1", "chunk-002", { chunkId: "chunk-002", topics: [] });
    await store.writeQuality("conv1", "pn_1", { score: 0.9 });
    await store.appendTrace("conv1", "pn_1", { event: "a" });
    await store.appendTrace("conv1", "pn_1", { event: "b" });

    assert.strictEqual((await store.readJob("conv1", "pn_1")).status, "running");
    assert.strictEqual((await store.readPartition("conv1", "pn_1")).length, 1);
    var chunks = await store.listChunks("conv1", "pn_1");
    assert.deepStrictEqual(chunks.map(function (c) { return c.chunkId; }), ["chunk-001", "chunk-002"], "chunks come back in slice order");
    assert.strictEqual((await store.readTrace("conv1", "pn_1")).length, 2);
    assert.strictEqual((await store.readJson(path.join(store.jobDir("conv1", "pn_1"), "quality.json"))).score, 0.9);
  });

  await scenario("missing or corrupt files read as absent, never throw", async function () {
    var root = tmpRoot("corrupt");
    var store = storeModule.createStore(root);
    assert.strictEqual(await store.readJob("conv1", "pn_missing"), null);
    assert.strictEqual(await store.readFinal("conv1"), null);
    assert.deepStrictEqual(await store.listChunks("conv1", "pn_missing"), []);
    assert.deepStrictEqual(await store.readTrace("conv1", "pn_missing"), []);

    fs.mkdirSync(path.join(root, "conv1.jobs-dir"), { recursive: true });
    fs.writeFileSync(store.finalPath("conv1"), "{not json", "utf8");
    assert.strictEqual(await store.readFinal("conv1"), null, "an unparsable note is reported as absent");
    fs.writeFileSync(store.finalPath("conv1"), JSON.stringify({ sections: "nope" }), "utf8");
    assert.strictEqual(await store.readFinal("conv1"), null, "a note without sections is not a note");
  });

  await scenario("an EPERM burst is ridden out inside the retry budget", async function () {
    var root = tmpRoot("eperm-ok");
    var fake = flakyFs(6);
    var store = storeModule.createStore(root, { fs: fake, sleep: function () { return Promise.resolve(); } });
    await store.atomicWriteJson(path.join(root, "x.json"), { ok: true });
    assert.strictEqual(fake.state.renames, 7, "six failures then the seventh attempt succeeded");
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, "x.json"), "utf8")).ok, true);
    assert.deepStrictEqual(noTempLeftovers(root), [], "the temp file is cleaned up after a failure");
  });

  await scenario("an EPERM storm beyond the budget fails as persist_failed", async function () {
    var root = tmpRoot("eperm-fail");
    var fake = flakyFs(99);
    var store = storeModule.createStore(root, { fs: fake, sleep: function () { return Promise.resolve(); } });
    var error = await store.atomicWriteJson(path.join(root, "y.json"), { ok: false }).then(function () { return null; }, function (e) { return e; });
    assert.strictEqual(error.code, "persist_failed");
    assert.strictEqual(fake.state.renames, storeModule.ATOMIC_ATTEMPTS, "exactly ten attempts, matching the project baseline");
    assert.strictEqual(fs.existsSync(path.join(root, "y.json")), false);
    assert.deepStrictEqual(noTempLeftovers(root), []);
  });

  await scenario("a non-EPERM failure is not retried", async function () {
    var root = tmpRoot("hard");
    var fake = flakyFs(0, { failHardCode: "ENOSPC" });
    var store = storeModule.createStore(root, { fs: fake, sleep: function () { return Promise.resolve(); } });
    var error = await store.atomicWriteJson(path.join(root, "z.json"), {}).then(function () { return null; }, function (e) { return e; });
    assert.strictEqual(error.code, "ENOSPC", "disk-full is surfaced immediately");
    assert.strictEqual(fake.state.renames, 1);
  });

  await scenario("a failed note write leaves the previous note readable", async function () {
    var root = tmpRoot("previous-note");
    var good = storeModule.createStore(root);
    await good.writeFinal("conv1", { conversationId: "conv1", sections: [{ type: "tldr", content: "旧笔记" }] });

    var fake = flakyFs(99);
    var broken = storeModule.createStore(root, { fs: fake, sleep: function () { return Promise.resolve(); } });
    var error = await broken.writeFinal("conv1", { conversationId: "conv1", sections: [{ type: "tldr", content: "新笔记" }] }).then(function () { return null; }, function (e) { return e; });
    assert.strictEqual(error.code, "persist_failed");
    var still = await good.readFinal("conv1");
    assert.strictEqual(still.sections[0].content, "旧笔记", "the previous note was never destroyed");
  });

  await scenario("path segments cannot escape the store", async function () {
    var store = storeModule.createStore(tmpRoot("traversal"));
    ["../outside", "a/b", "a\\b", "", ".."].forEach(function (bad) {
      assert.throws(function () { store.finalPath(bad); }, /unsafe path segment/, "rejected: " + JSON.stringify(bad));
      assert.throws(function () { store.jobDir("conv1", bad); }, /unsafe path segment/, "rejected jobId: " + JSON.stringify(bad));
    });
    await store.removeTree(path.dirname(store.rootDir)).then(function () {
      throw new Error("removing outside the store must be refused");
    }, function (error) {
      assert.strictEqual(error.code, "refusing_path_outside_store");
    });
  });

  await scenario("cleanup expires finished jobs, keeping failures longer", async function () {
    var root = tmpRoot("cleanup-retention");
    var now = Date.now();
    var day = 24 * 60 * 60 * 1000;
    var store = storeModule.createStore(root, { now: function () { return now; } });
    await store.writeFinal("conv1", { conversationId: "conv1", sections: [{ type: "tldr", content: "note" }] });

    await store.writeJob("conv1", "pn_old_ok", { jobId: "pn_old_ok", conversationId: "conv1", status: "ready", createdAt: now - 8 * day, updatedAt: now - 8 * day });
    await store.writeJob("conv1", "pn_old_fail", { jobId: "pn_old_fail", conversationId: "conv1", status: "failed", createdAt: now - 13 * day, updatedAt: now - 13 * day });
    await store.writeJob("conv1", "pn_new_fail", { jobId: "pn_new_fail", conversationId: "conv1", status: "failed", createdAt: now - 1 * day, updatedAt: now - 1 * day });

    var result = await store.cleanup({ now: now });
    var removedIds = result.removed.map(function (item) { return item.jobId; });
    assert.deepStrictEqual(removedIds, ["pn_old_ok"], "an 8-day-old success expires, a 13-day-old failure does not");
    assert.ok(await store.readFinal("conv1"), "cleanup never deletes the final note");
  });

  await scenario("cleanup caps jobs per conversation at the newest five", async function () {
    var root = tmpRoot("cleanup-cap");
    var now = Date.now();
    var store = storeModule.createStore(root, { now: function () { return now; } });
    for (var i = 0; i < 7; i++) {
      await store.writeJob("conv2", "pn_recent_" + i, { jobId: "pn_recent_" + i, conversationId: "conv2", status: "failed", createdAt: now - i * 1000, updatedAt: now - i * 1000 });
    }
    var result = await store.cleanup({ now: now });
    assert.strictEqual(result.removed.length, 2, "the two oldest are dropped");
    var remaining = await store.listJobs("conv2");
    assert.strictEqual(remaining.length, 5);
    assert.strictEqual(remaining[0].jobId, "pn_recent_0", "the newest job survives");
  });

  await scenario("single-flight collapses concurrent work for one key", async function () {
    var store = storeModule.createStore(tmpRoot("single-flight"));
    var calls = 0;
    var factory = function () {
      calls += 1;
      return new Promise(function (resolve) { setTimeout(function () { resolve("done"); }, 20); });
    };
    var key = "conv1|source";
    var a = store.singleFlight(key, factory);
    var b = store.singleFlight(key, factory);
    assert.strictEqual(a, b, "the second caller receives the first promise");
    assert.strictEqual(await a, "done");
    assert.strictEqual(await b, "done");
    assert.strictEqual(calls, 1, "the factory ran once");

    var c = store.singleFlight(key, factory);
    assert.notStrictEqual(c, a, "after settling, a new call starts fresh work");
    await c;
    assert.strictEqual(calls, 2);
    assert.strictEqual(store.hasInflight(key + "-absent"), false);
  });

  await scenario("a rejected single-flight releases its slot", async function () {
    var store = storeModule.createStore(tmpRoot("single-flight-fail"));
    var attempts = 0;
    var failing = function () { attempts += 1; return Promise.reject(new Error("first")); };
    await store.singleFlight("k", failing).catch(function () {});
    await store.singleFlight("k", function () { attempts += 1; return Promise.resolve("ok"); });
    assert.strictEqual(attempts, 2, "the key is not poisoned by a failure");
  });

  await scenario("an empty store cleans up without throwing", async function () {
    var store = storeModule.createStore(tmpRoot("empty-cleanup"));
    var result = await store.cleanup();
    assert.deepStrictEqual(result.removed, []);
  });

  cleanupAll();
  console.log("checkpoint store smoke: PASS");
}

main().catch(function (error) {
  cleanupAll();
  console.error("checkpoint store smoke: FAIL — " + error.message);
  process.exitCode = 1;
});
