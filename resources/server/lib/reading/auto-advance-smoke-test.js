"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Auto = require("./auto-advance.js");

assert.strictEqual(Auto.pendingAdvanceVerified({ reason: "assistant_completion" }), false, "legacy pending without verification must fail closed");
assert.strictEqual(Auto.pendingAdvanceVerified({ teachingProgressVerified: false }), false, "rejected teaching progress must block advance");
assert.strictEqual(Auto.pendingAdvanceVerified({ teachingProgressVerified: true }), true, "only explicit verified completion may advance");

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
  write(path.join(world, "textbooks", "textbook_index.json"), JSON.stringify({ worldId: "w1", textbooks: [{ id: "tb1", currentPage: 31 }] }));
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
  var teaching1 = await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "u1",
    activeConceptId: "concept-33",
    activeIndex: 32,
    newlyCompletedConceptIds: ["concept-32"],
    newlyCompletedTitles: ["Previous concept"],
    lastTaughtPage: 33,
    loadedRange: { startPage: 32, endPage: 40 }
  }));
  assert.strictEqual(teaching1.readingRange.startPage, 32, "teaching progress keeps the authoritative reading window");
  var projectedTeaching = JSON.parse(fs.readFileSync(path.join(textbook, "progress_state.json"), "utf8"));
  assert.strictEqual(projectedTeaching.currentPage, 33, "authoritative teaching progress publishes the taught page");
  assert.strictEqual(projectedTeaching.activeConceptId, "concept-33", "authoritative teaching progress publishes the active concept");
  assert.deepStrictEqual(projectedTeaching.completedConceptIds, ["old", "concept-32"], "authoritative teaching progress preserves migrated completions");
  var teachingState = runtime._readCommitted(scope).conversations.c1;
  assert.strictEqual(teachingState.lastTaughtPage, 33, "taught page is durable in the authoritative generation");
  assert.strictEqual(teachingState.activeConceptId, "concept-33", "active concept is durable in the authoritative generation");
  await runtime.bootstrap(scope);
  projectedTeaching.currentPage = 34;
  projectedTeaching.lastTaughtPage = 34;
  projectedTeaching.activeConceptId = "concept-34";
  projectedTeaching.taughtCursor = { chunkId: "concept-concept-34", ordinal: 33, startPage: 34, endPage: 34, status: "active", ready: true };
  projectedTeaching.completedConceptIds.push("concept-33");
  fs.writeFileSync(path.join(textbook, "progress_state.json"), JSON.stringify(projectedTeaching, null, 2));
  var healedTeaching = await runtime.bootstrap(scope);
  assert.strictEqual(healedTeaching.readingRange.startPage, 32, "external legacy progress drift must not interrupt bootstrap");
  var repairRoot = path.join(textbook, ".reading-state-v2", "repair-backups");
  var repairDirs = fs.readdirSync(repairRoot).map(function (name) { return path.join(repairRoot, name); });
  assert.strictEqual(repairDirs.length, 1, "automatic repair creates one timestamped backup");
  assert.ok(fs.existsSync(path.join(repairDirs[0], "manifest.json")), "automatic repair creates a backup manifest");
  assert.ok(fs.existsSync(path.join(repairDirs[0], "progress_state.json")), "automatic repair backs up the legacy progress projection");
  var repairedState = runtime._readCommitted(scope).conversations.c1;
  assert.strictEqual(repairedState.lastTaughtPage, 34, "repair transcribes the latest taught page into the authoritative generation");
  assert.strictEqual(repairedState.activeConceptId, "concept-34", "repair transcribes the latest active concept");
  assert.deepStrictEqual(repairedState.completedConceptIds, ["old", "concept-32", "concept-33"], "repair merges legacy completions without deleting authoritative history");
  await runtime.bootstrap(scope);
  var stableGeneration = runtime._readCommitted(scope).stateGeneration;
  await runtime.bootstrap(scope);
  assert.strictEqual(runtime._readCommitted(scope).stateGeneration, stableGeneration, "a clean bootstrap must not publish a new generation");

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
    assistantMessageId: "a2", responseText: "当前部分已经讲完，我们进入下一部分。", decision: { recommendedAction: "advance" },
    requiresTeachingProgress: true
  }));
  assert.strictEqual(completed2.shouldPrefetch, true);
  await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "u2", activeConceptId: "concept-39", activeIndex: 38,
    newlyCompletedConceptIds: ["concept-38"], newlyCompletedTitles: ["Page 38"],
    lastTaughtPage: 39, loadedRange: { startPage: 32, endPage: 40 }, windowComplete: false
  }));
  await runtime.prefetchCandidate(Object.assign({}, scope, { loadRange: loader, timeoutMs: 5000 }));

  var turn3Envelope = envelope(scope, "u3", "a2", completed2.causalConversationRevision, completed2.readingVersion, "好", null);
  var turn3 = await runtime.beginTurn(Object.assign({}, scope, { advanceProtocolVersion: 2, clientTurnId: "u3", envelope: turn3Envelope, loadRange: loader }));
  assert.strictEqual(turn3.rangeChanged, false, "page 39 taught inside 32-40 must not skip the unfinished tail");
  assert.strictEqual(turn3.readingRange.startPage, 32, "unfinished structured progress keeps the current window");
  assert.strictEqual(loadCalls, 2, "prefetch may load the candidate but cannot commit it early");
  var completed3 = await runtime.completeTurn(Object.assign({}, scope, {
    clientTurnId: "u3", envelopeHash: turn3.envelopeHash, executorKey: turn3.executorKey, promptSnapshot: turn3.promptSnapshot,
    assistantMessageId: "a3", responseText: "第40页的最后一个知识点已经讲完。", decision: { recommendedAction: "advance" },
    requiresTeachingProgress: true
  }));
  await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "u3", activeConceptId: "concept-40", activeIndex: 39,
    newlyCompletedConceptIds: ["concept-39", "concept-40"], newlyCompletedTitles: ["Page 39", "Page 40"],
    lastTaughtPage: 40, loadedRange: { startPage: 32, endPage: 40 }, windowComplete: true
  }));
  var turn4Envelope = envelope(scope, "u4", "a3", completed3.causalConversationRevision, completed3.readingVersion, "好", null);
  var turn4 = await runtime.beginTurn(Object.assign({}, scope, { advanceProtocolVersion: 2, clientTurnId: "u4", envelope: turn4Envelope, loadRange: loader }));
  assert.strictEqual(turn4.rangeChanged, true, "verified completion may commit the adjacent prefetched window");
  assert.strictEqual(turn4.readingRange.startPage, 41);
  assert.strictEqual(loadCalls, 2, "verified completion reuses the prefetched candidate without another extraction");

  var pointerBefore = fs.readFileSync(path.join(textbook, ".reading-state-v2", "current-pointer.json"), "utf8");
  fs.writeFileSync(path.join(conversation, "current_reading.md"), "<!-- startPage: 99 endPage: 99 -->\nexternal mutation");
  var healedReading = await runtime.bootstrap(scope);
  assert.strictEqual(healedReading.readingRange.startPage, 41, "external reading-file drift must not replace the authoritative range");
  assert.notStrictEqual(fs.readFileSync(path.join(textbook, ".reading-state-v2", "current-pointer.json"), "utf8"), pointerBefore, "automatic repair publishes a new generation");
  assert.strictEqual(parseInt((fs.readFileSync(path.join(conversation, "current_reading.md"), "utf8").match(/startPage:\s*(\d+)/) || [])[1], 10), 41, "automatic repair republishes authoritative reading content");
  assert.strictEqual(fs.readdirSync(repairRoot).length, 2, "each distinct external drift creates an audit backup");
  fs.writeFileSync(path.join(textbook, "progress_state.json"), "{broken-json");
  await assert.rejects(function () { return runtime.bootstrap(scope); }, function (error) {
    return error && error.code === "EXTERNAL_LEGACY_MUTATION_DETECTED" && /corrupt/.test(error.message);
  });

  runtime.shutdown();
  console.log("auto-advance v2 smoke test: PASS");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

