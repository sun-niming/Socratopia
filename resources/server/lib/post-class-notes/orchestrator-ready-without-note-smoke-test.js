"use strict";

// PN-007 — regression: a terminal job whose final note is unreadable must
// never be published as `ready`/`degraded` without a summary, and a job left
// `running` by a dead process must not stay "running" forever.
//
// Background: the concept-review page trusts `status === "ready"` to imply a
// usable summary and reads `summary.sections` unguarded in the poll path. When
// `readFinal` could not read the note back (file missing/invalid), the route
// omitted `summary` while still saying "ready" and the whole page crashed with
// `Cannot read properties of undefined (reading 'sections')`. Separately, a
// job whose process died mid-run stayed "running" on disk and was surfaced by
// `latest()` indefinitely.
//
//   node resources/server/lib/post-class-notes/orchestrator-ready-without-note-smoke-test.js

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var errors = require("./errors.js");
var orchestration = require("./orchestrator.js");
var storeModule = require("./checkpoint-store.js");

var tempDirs = [];

function tmpRoot(label) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcn-now-note-" + label + "-"));
  tempDirs.push(dir);
  return dir;
}

function scenario(name, body) {
  return Promise.resolve().then(body).then(function () {
    console.log("  ok   " + name);
  }, function (error) {
    error.message = name + ": " + error.message;
    throw error;
  });
}

var SCOPE = { accountId: "acct", profileId: "p", worldId: "w", conversationId: "conv" };

function forgeJob(root, overrides) {
  var job = Object.assign({
    jobId: "pn_" + Math.random().toString(36).slice(2),
    traceId: "tr_forge",
    conversationId: SCOPE.conversationId,
    accountId: SCOPE.accountId,
    profileId: SCOPE.profileId,
    worldId: SCOPE.worldId,
    idempotencyKey: "forge",
    sourceHash: "sha256:forge",
    pipelineVersion: orchestration.PIPELINE_VERSION,
    status: "ready",
    stage: "ready",
    createdAt: 1,
    updatedAt: 2,
    mode: "short",
    language: "chinese"
  }, overrides || {});
  var dir = path.join(root, ".jobs", SCOPE.conversationId, job.jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(job));
  return job;
}

// Short conversations never reach the model — `callModel` is never invoked —
// so a resumed/restarted job still completes deterministically with a
// placeholder note.
function shortInput(extra) {
  return Object.assign({}, SCOPE, extra, {
    language: "chinese",
    messages: [
      { role: "user", content: "嗯" },
      { role: "assistant", content: "你好，想聊点什么？" }
    ],
    callModel: function () {
      throw new Error("callModel must not be invoked for placeholder jobs");
    }
  });
}

async function main() {
  await scenario("status() never publishes ready when the final note is unreadable", async function () {
    var root = tmpRoot("status");
    var job = forgeJob(root, { status: "ready", stage: "ready" });
    // No <conversationId>.json on disk: readFinal() must come back null.
    var orch = orchestration.getOrchestrator({ storeRoot: root });
    var view = await orch.status(Object.assign({}, SCOPE, { jobId: job.jobId }));
    assert.notStrictEqual(view.status, "ready", "ready published without a readable note");
    assert.notStrictEqual(view.status, "degraded", "degraded published without a readable note");
    assert.strictEqual(view.status, "failed");
    assert.ok(view.error && view.error.code, "failed view carries an error code");
    // The demotion is persisted, so a later poll can never see the bogus ready.
    var reread = await orch.status(Object.assign({}, SCOPE, { jobId: job.jobId }));
    assert.strictEqual(reread.status, "failed");
  });

  await scenario("latest() never publishes ready when the final note is unreadable", async function () {
    var root = tmpRoot("latest");
    forgeJob(root, { status: "degraded", stage: "degraded" });
    var orch = orchestration.getOrchestrator({ storeRoot: root });
    var view = await orch.latest(SCOPE);
    assert.ok(view, "latest() returns a view");
    assert.strictEqual(view.status, "failed");
    assert.ok(!view.summary, "no summary is attached");
  });

  await scenario("start() does not reuse a ready job whose note is unreadable — it regenerates", async function () {
    var root = tmpRoot("reuse");
    var orch = orchestration.getOrchestrator({ storeRoot: root });
    // First run completes with a real note, establishing the idempotency key.
    var first = await orch.start(shortInput());
    assert.strictEqual(first.status, "ready");
    assert.ok(first.summary && Array.isArray(first.summary.sections));
    // Simulate the note being lost/corrupted after the job went ready.
    fs.unlinkSync(path.join(root, SCOPE.conversationId + ".json"));
    var second = await orch.start(shortInput());
    assert.ok(second.summary && Array.isArray(second.summary.sections),
      "regeneration returned a usable summary instead of a bare ready");
    assert.strictEqual(second.status, "ready");
    // The note is back on disk, so plain status polls carry the summary again.
    var polled = await orch.status(Object.assign({}, SCOPE, { jobId: second.jobId }));
    assert.ok(polled.summary && Array.isArray(polled.summary.sections));
  });

  await scenario("a job left running by a dead process is failed as resumable, not stuck", async function () {
    var root = tmpRoot("stale");
    var job = forgeJob(root, { status: "running", stage: "mapping", completedChunks: 1, totalChunks: 8 });
    var orch = orchestration.getOrchestrator({ storeRoot: root });
    // No runtime exists for this job (fresh orchestrator) — it is stale.
    var latest = await orch.latest(SCOPE);
    assert.strictEqual(latest.status, "failed", "stale running job must not surface as running");
    assert.ok(latest.error && latest.error.code, "stale demotion carries an error code");
    var stored = await storeModule.createStore(root).readJob(SCOPE.conversationId, job.jobId);
    assert.strictEqual(stored.status, "failed", "demotion persisted to job.json");
    // And a status poll by jobId agrees.
    var polled = await orch.status(Object.assign({}, SCOPE, { jobId: job.jobId }));
    assert.strictEqual(polled.status, "failed");
    // A failed resumable job can be retried — short conversation completes
    // without any model call.
    var retried = await orch.retry(shortInput({ jobId: job.jobId }));
    assert.strictEqual(retried.status, "ready");
    assert.ok(retried.summary && Array.isArray(retried.summary.sections));
  });

  await scenario("a ready job with an intact note still returns its summary (no false demotion)", async function () {
    var root = tmpRoot("healthy");
    var orch = orchestration.getOrchestrator({ storeRoot: root });
    var first = await orch.start(shortInput());
    assert.strictEqual(first.status, "ready");
    var polled = await orch.status(Object.assign({}, SCOPE, { jobId: first.jobId }));
    assert.strictEqual(polled.status, "ready");
    assert.ok(polled.summary && Array.isArray(polled.summary.sections));
    var latest = await orch.latest(SCOPE);
    assert.strictEqual(latest.status, "ready");
    assert.ok(latest.summary && Array.isArray(latest.summary.sections));
  });

  console.log("orchestrator ready-without-note smoke: PASS");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

process.on("exit", function () {
  tempDirs.forEach(function (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });
});
