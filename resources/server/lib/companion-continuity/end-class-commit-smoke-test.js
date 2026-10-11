"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Commit = require("./end-class-commit.js");

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function makeWorld() {
  var world = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-end-class-"));
  write(path.join(world, "world_meta.json"), JSON.stringify({
    worldId: "world_a",
    companions: [{ candidateId: "preset_a", name: "A", companionInstanceId: "ci_a" }, null, null, null],
  }, null, 2));
  write(path.join(world, "pal_moments.md"), "## 2026-08-30 | A\n\nold pal\n");
  write(path.join(world, "diary", "2026-08.md"), "old diary\n");
  write(path.join(world, "relation_npc_a.md"), "old relation\n");
  write(path.join(world, "textbooks", "book_a", "progress.md"), "# 当前页码：第 1 页\n");
  write(path.join(world, "textbooks", "textbook_index.json"), JSON.stringify({ textbooks: [{ id: "book_a", currentPage: 1 }, { id: "book_b", currentPage: 9 }] }, null, 2));
  write(path.join(world, "world_records.md"), "");
  write(path.join(world, "conversations", "conv_a", "current_reading_summary.json"), "{}\n");
  write(path.join(world, "conversations", "conv_a", "handoff.json"), "{}\n");
  write(path.join(world, "lesson_summaries", "conv_a.md"), "<!-- windowStart: 0 -->\nlesson summary\n");
  write(path.join(world, "conversations", "conv_a", "close_reading_candidates.json"), JSON.stringify([
    { schemaVersion: 1, conclusion: "remembered fact", scope: { accountId: "acct_a", profileId: "profile_a", worldId: "world_a", conversationId: "conv_a", companionInstanceId: "ci_a" } },
    { schemaVersion: 1, conclusion: "other companion", scope: { accountId: "acct_a", profileId: "profile_a", worldId: "world_a", conversationId: "conv_a", companionInstanceId: "ci_other" } },
  ], null, 2));
  return world;
}

function baseInput(world) {
  return {
    worldDir: world,
    scope: { accountId: "acct_a", profileId: "profile_a", worldId: "world_a", conversationId: "conv_a" },
    clientOperationId: "stable-ui-click-id",
    companion: { slotId: "npc_a", slotIndex: 0, companionInstanceId: "ci_a", candidateId: "preset_a", displayName: "A" },
    date: "2026-08-31",
    textbookId: "book_a",
    textbookTitle: "《测试教材》",
    endingPage: 50,
    teachingLanguage: "chinese",
    handoffMessages: [{ role: "user", content: "I learned a fact" }, { role: "assistant", content: "Great" }],
    cleanupPaths: ["conversations/conv_a/current_reading_summary.json", "conversations/conv_a/handoff.json"],
    output: {
      farewell: "再见",
      palMomentsMd: "## 2026-08-31 | A\n\n学习者掌握了测试事实。",
      progressMd: "# 当前页码：第 50 页\n\n## 2026-08-31 | A\n\np.43-50 | 测试\n",
      diaryEntry: "今天记住了测试事实。",
      relationMd: "更信任学习者。",
      companionNote: "下次见。",
    },
  };
}

async function run() {
  var world = makeWorld();
  try {
    var first = await Commit.commitEndClass(baseInput(world));
    assert.strictEqual(first.committed, true);
    assert.strictEqual(first.replayed, false);
    assert.strictEqual(first.payload.farewell, "再见");
    var pal = fs.readFileSync(path.join(world, "pal_moments.md"), "utf8");
    assert(pal.indexOf("continuityEvent:") >= 0);
    assert(pal.indexOf("学习者掌握了测试事实") >= 0);
    var diary = fs.readFileSync(path.join(world, "diary", "2026-08.md"), "utf8");
    assert(diary.indexOf("continuityEvent:") >= 0);
    assert.strictEqual(fs.readFileSync(path.join(world, "relation_npc_a.md"), "utf8"), "更信任学习者。\n");
    assert.strictEqual(fs.readFileSync(path.join(world, "textbooks", "book_a", "progress.md"), "utf8"), baseInput(world).output.progressMd);
    var textbookIndex = JSON.parse(fs.readFileSync(path.join(world, "textbooks", "textbook_index.json"), "utf8"));
    assert.strictEqual(textbookIndex.textbooks[0].currentPage, 50, "end-class commit persists the taught anchor in the world-level textbook index");
    assert.strictEqual(textbookIndex.textbooks[1].currentPage, 9, "end-class commit does not change other textbooks");
    var meta = JSON.parse(fs.readFileSync(path.join(world, "world_meta.json"), "utf8"));
    assert.strictEqual(meta.lastStudyDate, "2026-08-31");
    var handoff = JSON.parse(fs.readFileSync(path.join(world, "textbooks", "book_a", "handoff", "last_meta.json"), "utf8"));
    assert.strictEqual(handoff.companionInstanceId, "ci_a");
    assert.strictEqual(handoff.operationId, first.operationId);
    assert.strictEqual(handoff.endingPage, 50, "handoff carries the taught anchor instead of a loaded-window tail");
    assert.strictEqual(fs.existsSync(path.join(world, "conversations", "conv_a", "current_reading_summary.json")), false);
    assert.strictEqual(fs.existsSync(path.join(world, "conversations", "conv_a", "handoff.json")), false);
    assert.strictEqual(fs.existsSync(path.join(world, "lesson_summaries", "conv_a.md")), true);
    var candidates = JSON.parse(fs.readFileSync(path.join(world, "conversations", "conv_a", "close_reading_candidates.json"), "utf8"));
    assert.strictEqual(candidates[0].consumedByOperationId, first.operationId);
    assert.strictEqual(candidates[1].consumedByOperationId, undefined);

    var second = await Commit.commitEndClass(baseInput(world));
    assert.strictEqual(second.replayed, true);
    assert.strictEqual(fs.readFileSync(path.join(world, "pal_moments.md"), "utf8"), pal);
    assert.strictEqual(fs.readFileSync(path.join(world, "diary", "2026-08.md"), "utf8"), diary);

    var mismatch = baseInput(world);
    mismatch.clientOperationId = "different-click";
    mismatch.companion = Object.assign({}, mismatch.companion, { companionInstanceId: "ci_other" });
    var thrown = null;
    try { await Commit.commitEndClass(mismatch); } catch (error) { thrown = error; }
    assert(thrown);
    assert.strictEqual(thrown.code, "COMPANION_CONTEXT_MISMATCH");

    var stale = baseInput(world);
    stale.clientOperationId = "stale-account-click";
    stale.scope.sessionEpoch = 7;
    stale.assertAccountContext = function () {
      var error = new Error("Account session changed");
      error.code = "SCOPE_STALE";
      error.status = 409;
      throw error;
    };
    thrown = null;
    try { await Commit.commitEndClass(stale); } catch (error) { thrown = error; }
    assert(thrown, "stale account must fence the end-class transaction");
    assert.strictEqual(thrown.code, "SCOPE_STALE");
    console.log("PASS end-class commit targets, candidate consumption, cleanup, receipt replay, and identity mismatch");
  } finally {
    fs.rmSync(world, { recursive: true, force: true });
  }
}

run().catch(function (error) {
  console.error("FAIL end-class commit smoke:", error && error.stack || error);
  process.exitCode = 1;
});
