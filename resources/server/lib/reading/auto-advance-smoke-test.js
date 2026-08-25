"use strict";

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
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-v2-"));
  var scope = { accountId: "local", profileId: "p1", worldId: "w1", textbookId: "tb1", conversationId: "c1" };
  var world = path.join(root, "accounts", "local", "profiles", "p1", "worlds", "w1");
  var textbook = path.join(world, "textbooks", "tb1");
  var conversation = path.join(world, "conversations", "c1");
  write(path.join(conversation, "current_reading.md"), "<!-- startPage: 22 endPage: 31 -->\nlegacy pages 22-31");
  write(path.join(textbook, "progress_state.json"), JSON.stringify({ schemaVersion: 3, textbookId: "tb1", sourceConversationId: "c1", loadedCursor: { startPage: 22, endPage: 31 }, currentPage: 31, lastTaughtPage: 31, completedConceptIds: ["old"] }));
  write(path.join(world, "textbook_index.json"), JSON.stringify({ worldId: "w1", textbooks: [{ id: "tb1", currentPage: 31 }] }));
  write(path.join(world, "chats", "c1.json"), JSON.stringify({ id: "c1", messages: [{ id: "a0", role: "assistant", content: "question" }] }));

  var account = { active: true, accountId: "local", sessionEpoch: 1 };
  var runtime = Auto.createAutoAdvance({ projectRoot: root, bootId: "test-boot", getAccountContext: function () { return account; } });
  var initial = await runtime.bootstrap(scope);
  assert.deepStrictEqual([initial.readingRange.startPage, initial.readingRange.endPage], [22, 31]);
  assert.strictEqual(initial.parentAssistantMessageId, "a0");
  assert.ok(fs.existsSync(path.join(textbook, ".reading-state-v2", "current-pointer.json")));

  var turn1Envelope = envelope(scope, "u1", "a0", initial.causalConversationRevision, initial.readingVersion, "我们继续从32页看起", { type: "page", page: 32 });
  var loadCalls = 0;
  async function loader(request) {
    loadCalls += 1;
    return { startPage: request.startPage, endPage: request.startPage + 8, content: "page window from " + request.startPage };
  }
  var turn1 = await runtime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "u1",
    envelope: turn1Envelope,
    loadRange: loader,
    deadlineAt: Date.now() + 10000
  }));
  assert.strictEqual(turn1.rangeChanged, true);
  assert.deepStrictEqual([turn1.readingRange.startPage, turn1.readingRange.endPage], [32, 40]);
  assert.strictEqual(loadCalls, 1);
  assert.ok(turn1.promptSnapshot.content.indexOf("page window from 32") >= 0);

  var completed1 = await runtime.completeTurn(Object.assign({}, scope, {
    clientTurnId: "u1",
    envelopeHash: turn1.envelopeHash,
    executorKey: turn1.executorKey,
    promptSnapshot: turn1.promptSnapshot,
    assistantMessageId: "a1",
    responseText: "第32页已经开始。",
    decision: null
  }));
  assert.strictEqual(completed1.readingVersion, 1);

  var replay = await runtime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "u1",
    envelope: turn1Envelope,
    loadRange: loader
  }));
  assert.strictEqual(replay.replay, true);
  assert.strictEqual(replay.responseText, "第32页已经开始。");
  assert.strictEqual(loadCalls, 1, "replay must not load or advance again");

  var conflicting = Object.assign({}, turn1Envelope, { sanitizedUserContent: "different" });
  await assert.rejects(function () {
    return runtime.beginTurn(Object.assign({}, scope, { advanceProtocolVersion: 2, clientTurnId: "u1", envelope: conflicting, loadRange: loader }));
  }, function (error) { return error && error.code === "TURN_CONFLICT"; });

  var turn2Envelope = envelope(scope, "u2", "a1", completed1.causalConversationRevision, completed1.readingVersion, "继续解释这个概念", null);
  var turn2 = await runtime.beginTurn(Object.assign({}, scope, { advanceProtocolVersion: 2, clientTurnId: "u2", envelope: turn2Envelope, loadRange: loader }));
  assert.strictEqual(turn2.rangeChanged, false, "bare continue with an object must not page-turn");
  assert.strictEqual(loadCalls, 1);
  var completed2 = await runtime.completeTurn(Object.assign({}, scope, {
    clientTurnId: "u2", envelopeHash: turn2.envelopeHash, executorKey: turn2.executorKey, promptSnapshot: turn2.promptSnapshot,
    assistantMessageId: "a2", responseText: "当前部分已经讲完，我们进入下一部分。", decision: { recommendedAction: "advance" }
  }));
  assert.strictEqual(completed2.shouldPrefetch, true);
  await runtime.prefetchCandidate(Object.assign({}, scope, { loadRange: loader, timeoutMs: 5000 }));

  var turn3Envelope = envelope(scope, "u3", "a2", completed2.causalConversationRevision, completed2.readingVersion, "好", null);
  var turn3 = await runtime.beginTurn(Object.assign({}, scope, { advanceProtocolVersion: 2, clientTurnId: "u3", envelope: turn3Envelope, loadRange: loader }));
  assert.strictEqual(turn3.rangeChanged, true, "durable pending must commit in next pre-turn");
  assert.strictEqual(turn3.readingRange.startPage, 41);
  assert.strictEqual(loadCalls, 2, "candidate should be reused without a second foreground extraction");

  var pointerBefore = fs.readFileSync(path.join(textbook, ".reading-state-v2", "current-pointer.json"), "utf8");
  fs.writeFileSync(path.join(conversation, "current_reading.md"), "<!-- startPage: 99 endPage: 99 -->\nexternal mutation");
  await assert.rejects(function () { return runtime.bootstrap(scope); }, function (error) {
    return error && error.code === "EXTERNAL_LEGACY_MUTATION_DETECTED";
  });
  assert.strictEqual(fs.readFileSync(path.join(textbook, ".reading-state-v2", "current-pointer.json"), "utf8"), pointerBefore, "fail-closed recovery must not overwrite the pointer");

  runtime.shutdown();
  console.log("auto-advance v2 smoke test: PASS");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

