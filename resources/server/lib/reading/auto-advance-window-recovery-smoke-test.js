"use strict";

// Covers two window-recovery paths added on 2026-09-11:
//   C2  an authoritative window seeded header-only from an empty
//       current_reading.md projection is reloaded at the next beginTurn
//   C4  a page window written to the legacy projection file by the reading
//       tool is stashed by recover() and adopted at the next beginTurn instead
//       of being quarantined and reverted

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Auto = require("./auto-advance.js");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function scopeFor(conversationId) {
  return {
    accountId: "local",
    profileId: "p",
    worldId: "w",
    textbookId: "tb",
    conversationId: conversationId || "c1",
  };
}

function filesFor(root, scope) {
  var world = path.join(root, "accounts", scope.accountId, "profiles", scope.profileId, "worlds", scope.worldId);
  return {
    world: world,
    textbook: path.join(world, "textbooks", scope.textbookId),
    conversation: path.join(world, "conversations", scope.conversationId),
    reading: path.join(world, "conversations", scope.conversationId, "current_reading.md"),
  };
}

function seed(root, scope, options) {
  options = options || {};
  var files = filesFor(root, scope);
  var startPage = Number(options.startPage || 1);
  var endPage = Number(options.endPage || startPage + 1);
  write(files.reading, options.reading !== undefined
    ? options.reading
    : "<!-- startPage: " + startPage + " endPage: " + endPage + " -->\r\nwindow " + startPage + "-" + endPage);
  write(path.join(files.textbook, "progress_state.json"), JSON.stringify({
    schemaVersion: 3,
    textbookId: scope.textbookId,
    sourceConversationId: scope.conversationId,
    activeConceptId: "c1",
    loadedCursor: { startPage: startPage, endPage: endPage },
    currentPage: startPage,
    lastTaughtPage: startPage,
  }));
  write(path.join(files.world, "textbooks", "textbook_index.json"), JSON.stringify({
    textbooks: [{ id: scope.textbookId, currentPage: startPage, numPages: 40 }],
  }));
  write(path.join(files.world, "chats", scope.conversationId + ".json"), JSON.stringify({
    messages: [{ id: "a0", role: "assistant", content: "ready" }],
  }));
  return files;
}

function makeRuntime(root) {
  return Auto.createAutoAdvance({
    projectRoot: root,
    bootId: "window-recovery",
    getAccountContext: function () { return { active: true, accountId: "local", sessionEpoch: 1 }; },
  });
}

function envelope(scope, id, snapshot, text) {
  return {
    protocolVersion: 2,
    clientTurnId: id,
    accountId: scope.accountId,
    profileId: scope.profileId,
    worldId: scope.worldId,
    textbookId: scope.textbookId,
    conversationId: scope.conversationId,
    parentAssistantMessageId: snapshot.parentAssistantMessageId,
    baseCausalConversationRevision: snapshot.causalConversationRevision,
    baseReadingVersion: snapshot.readingVersion,
    sanitizedUserContent: text,
    attachments: [],
    readingAction: null,
  };
}

function begin(runtime, scope, id, snapshot, text, loadRange) {
  return runtime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: id,
    envelope: envelope(scope, id, snapshot, text),
    loadRange: loadRange || async function () { throw new Error("unexpected range load"); },
  }));
}

function complete(runtime, scope, id, turn, responseText) {
  return runtime.completeTurn(Object.assign({}, scope, {
    clientTurnId: id,
    envelopeHash: turn.envelopeHash,
    executorKey: turn.executorKey,
    promptSnapshot: turn.promptSnapshot,
    assistantMessageId: id + "-assistant",
    responseText: responseText,
    decision: null,
    requiresTeachingProgress: false,
  }));
}

async function emptyWindowIsReloaded() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-empty-window-"));
  var scope = scopeFor("empty");
  var files = seed(root, scope, { startPage: 8, endPage: 9, reading: "<!-- startPage: 8 endPage: 9 -->\r\n" });
  var runtime = makeRuntime(root);
  var snapshot = await runtime.bootstrap(scope);
  assert.strictEqual(snapshot.readingRange.startPage, 8, "the seeded range survives an empty window");
  assert.strictEqual(snapshot.readingRange.lastTaughtPage, 8, "the committed position is exposed to the prompt layer");

  var calls = [];
  var turn = await begin(runtime, scope, "empty-u1", snapshot, "我们继续", async function (request) {
    calls.push({ startPage: request.startPage, explicitPage: request.explicitPage, reason: request.reason });
    return { content: "body of pages 8-9", startPage: 8, endPage: 9 };
  });
  assert.strictEqual(calls.length, 1, "an empty window triggers exactly one reload");
  assert.strictEqual(calls[0].startPage, 8, "the reload starts at the seeded window start");
  assert.strictEqual(calls[0].reason, "empty_window_reload", "the reload is labelled for the logs");
  assert.ok(turn.promptSnapshot.content.indexOf("body of pages 8-9") >= 0, "the reloaded text reaches the prompt snapshot");
  assert.strictEqual(turn.readingRange.startPage, 8, "the reloaded window keeps its range");
  assert.strictEqual(turn.readingRange.endPage, 9, "the reloaded window keeps its range");

  var projection = fs.readFileSync(files.reading, "utf8");
  assert.ok(projection.indexOf("body of pages 8-9") >= 0, "the projection is repaired with the reloaded content");
}

async function externalWindowIsAdopted() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-external-window-"));
  var scope = scopeFor("jump");
  var files = seed(root, scope, { startPage: 1, endPage: 2 });
  var runtime = makeRuntime(root);
  var snapshot = await runtime.bootstrap(scope);
  var turn = await begin(runtime, scope, "jump-u1", snapshot, "讲解当前窗口", async function () {
    throw new Error("the seeded window must not be reloaded");
  });
  await complete(runtime, scope, "jump-u1", turn, "这一部分讲完了。");

  write(files.reading, "<!-- startPage: 20 endPage: 22 -->\r\nexternal body of pages 20-22");
  var refreshed = await runtime.readSnapshot(scope);
  assert.strictEqual(refreshed.readingRange.startPage, 1, "the stash is not applied mid-turn; the snapshot still reports the old window");

  var loaded = [];
  var adopted = await begin(runtime, scope, "jump-u2", refreshed, "继续", async function () {
    loaded.push(true);
    throw new Error("an adopted window must not be re-extracted");
  });
  assert.strictEqual(loaded.length, 0, "adoption reuses the stashed content instead of calling the range loader");
  assert.strictEqual(adopted.readingRange.startPage, 20, "the external window becomes authoritative");
  assert.strictEqual(adopted.readingRange.endPage, 22, "the external window becomes authoritative");
  assert.ok(adopted.promptSnapshot.content.indexOf("external body of pages 20-22") >= 0, "the adopted text reaches the prompt snapshot");
  assert.strictEqual(fs.readFileSync(files.reading, "utf8").indexOf("external body of pages 20-22") >= 0, true, "the projection keeps the adopted window");

  var conversation = runtime._readCommitted(scope).conversations[scope.conversationId];
  assert.ok(!conversation.pendingExternalReading, "the stash is consumed exactly once");
  assert.strictEqual(conversation.loadedRange.startPage, 20, "the committed conversation state carries the adopted range");
}

async function damagedWindowIsStillQuarantined() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-damaged-window-"));
  var scope = scopeFor("damaged");
  var files = seed(root, scope, { startPage: 1, endPage: 2 });
  var runtime = makeRuntime(root);
  await runtime.bootstrap(scope);

  write(files.reading, "this is not a wrapped reading window");
  var refreshed = await runtime.readSnapshot(scope);
  assert.strictEqual(refreshed.readingRange.startPage, 1, "damaged legacy content never becomes the window");
  var repaired = fs.readFileSync(files.reading, "utf8");
  assert.ok(repaired.indexOf("window 1-2") >= 0, "the projection is restored from the authoritative blob");
  var conversation = runtime._readCommitted(scope).conversations[scope.conversationId];
  assert.ok(!conversation.pendingExternalReading, "damaged content is not stashed for adoption");
}

async function main() {
  await emptyWindowIsReloaded();
  await externalWindowIsAdopted();
  await damagedWindowIsStillQuarantined();
  console.log("auto-advance-window-recovery-smoke-test: PASS");
}

main().catch(function (error) {
  console.error("auto-advance-window-recovery-smoke-test: FAIL", error && error.stack || error);
  process.exit(1);
});
