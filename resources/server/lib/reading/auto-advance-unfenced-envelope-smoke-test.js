"use strict";

// A reloaded client sends base 0/0 until its /api/reading-context bootstrap
// resolves. That unfenced envelope must be accepted (and answered with the
// authoritative revisions) instead of failing with STALE_TURN, while a
// genuinely stale non-zero base must still be rejected.

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Auto = require("./auto-advance.js");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function envelope(scope, turnId, parent, causal, reading, text, action) {
  return {
    protocolVersion: 2,
    clientTurnId: turnId,
    accountId: scope.accountId,
    profileId: scope.profileId,
    worldId: scope.worldId,
    textbookId: scope.textbookId,
    conversationId: scope.conversationId,
    parentAssistantMessageId: parent,
    baseCausalConversationRevision: causal,
    baseReadingVersion: reading,
    sanitizedUserContent: text,
    attachments: [],
    readingAction: action || null
  };
}

async function main() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-unfenced-"));
  var scope = { accountId: "local", profileId: "p1", worldId: "w1", textbookId: "tb1", conversationId: "c1" };
  var world = path.join(root, "accounts", "local", "profiles", "p1", "worlds", "w1");
  var textbook = path.join(world, "textbooks", "tb1");
  var conversation = path.join(world, "conversations", "c1");
  write(path.join(conversation, "current_reading.md"), "<!-- startPage: 22 endPage: 31 -->\nlegacy pages 22-31");
  write(path.join(textbook, "progress_state.json"), JSON.stringify({ schemaVersion: 3, textbookId: "tb1", sourceConversationId: "c1", loadedCursor: { startPage: 22, endPage: 31 }, currentPage: 31, lastTaughtPage: 31, completedConceptIds: ["old"] }));
  write(path.join(world, "textbooks", "textbook_index.json"), JSON.stringify({ worldId: "w1", textbooks: [{ id: "tb1", currentPage: 31 }] }));
  write(path.join(world, "chats", "c1.json"), JSON.stringify({ id: "c1", messages: [{ id: "a0", role: "assistant", content: "question" }] }));

  var account = { active: true, accountId: "local", sessionEpoch: 1 };
  var runtime = Auto.createAutoAdvance({ projectRoot: root, bootId: "unfenced-boot", getAccountContext: function () { return account; } });
  async function loader(request) {
    return { startPage: request.startPage, endPage: request.startPage + 8, content: "page window from " + request.startPage };
  }

  var initial = await runtime.bootstrap(scope);
  var turn1 = await runtime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "u1",
    envelope: envelope(scope, "u1", "a0", initial.causalConversationRevision, initial.readingVersion, "我们继续从32页看起", { type: "page", page: 32 }),
    loadRange: loader,
    deadlineAt: Date.now() + 10000
  }));
  await runtime.completeTurn(Object.assign({}, scope, {
    clientTurnId: "u1",
    envelopeHash: turn1.envelopeHash,
    executorKey: turn1.executorKey,
    promptSnapshot: turn1.promptSnapshot,
    assistantMessageId: "a1",
    responseText: "第32页已经开始。",
    decision: null
  }));

  var before = await runtime.readSnapshot(scope);
  assert.ok(before.causalConversationRevision > 0 && before.readingVersion > 0, "the conversation must have advanced past 0/0");

  // 1. Unfenced envelope (reloaded client): accepted, and the response teaches it the truth.
  var unfenced = await runtime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "u2",
    envelope: envelope(scope, "u2", "a1", 0, 0, "接着说"),
    loadRange: loader,
    deadlineAt: Date.now() + 10000
  }));
  assert.ok(unfenced.causalConversationRevision >= before.causalConversationRevision, "an unfenced turn must be accepted like any other turn");
  assert.strictEqual(unfenced.readingVersion, before.readingVersion, "an unfenced envelope must not force a range change");
  assert.strictEqual(unfenced.parentAssistantMessageId, "a1");
  assert.ok(Number.isSafeInteger(unfenced.stateGeneration), "the accepted turn must hand back a rebasable snapshot");
  await runtime.completeTurn(Object.assign({}, scope, {
    clientTurnId: "u2",
    envelopeHash: unfenced.envelopeHash,
    executorKey: unfenced.executorKey,
    promptSnapshot: unfenced.promptSnapshot,
    assistantMessageId: "a2",
    responseText: "好。",
    decision: null
  }));

  // 2. A stale non-zero base is still rejected (0/0 must not become a blanket bypass).
  await assert.rejects(function () {
    return runtime.beginTurn(Object.assign({}, scope, {
      advanceProtocolVersion: 2,
      clientTurnId: "u3",
      envelope: envelope(scope, "u3", "a2", 999, 999, "过期客户端"),
      loadRange: async function () { throw new Error("a stale turn must not load a range"); }
    }));
  }, function (error) { return !!error && error.code === "STALE_TURN" && /revision is stale/.test(error.message); });

  var after = await runtime.readSnapshot(scope);
  await assert.rejects(function () {
    return runtime.beginTurn(Object.assign({}, scope, {
      advanceProtocolVersion: 2,
      clientTurnId: "u4",
      envelope: envelope(scope, "u4", "a2", after.causalConversationRevision, after.readingVersion - 1, "只错一个版本"),
      loadRange: async function () { throw new Error("a stale turn must not load a range"); }
    }));
  }, function (error) { return !!error && error.code === "STALE_TURN"; });

  // 3. A rejected stale turn must not have written a turn record.
  var committed = JSON.parse(fs.readFileSync(path.join(textbook, ".reading-state-v2", "current-pointer.json"), "utf8"));
  var manifest = JSON.parse(fs.readFileSync(path.join(textbook, ".reading-state-v2", "generations", committed.manifest), "utf8"));
  assert.deepStrictEqual(Object.keys(manifest.conversations.c1.turns).sort(), ["u1", "u2"], "rejected turns must leave no record");

  runtime.shutdown();
  console.log("auto-advance unfenced envelope smoke: PASS");
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
