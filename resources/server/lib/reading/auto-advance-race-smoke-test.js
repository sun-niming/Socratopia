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

function deferred() {
  var resolve;
  var promise = new Promise(function (done) { resolve = done; });
  return { promise: promise, resolve: resolve };
}

function turnEnvelope(scope, id, snapshot, text, action) {
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
    readingAction: action || null
  };
}

function seed(root, scope) {
  var world = path.join(root, "accounts", scope.accountId, "profiles", scope.profileId, "worlds", scope.worldId);
  var textbook = path.join(world, "textbooks", scope.textbookId);
  var conversation = path.join(world, "conversations", scope.conversationId);
  write(path.join(conversation, "current_reading.md"), "<!-- startPage: 1 endPage: 3 -->\ninitial");
  write(path.join(textbook, "progress_state.json"), JSON.stringify({ schemaVersion: 3, textbookId: scope.textbookId, sourceConversationId: scope.conversationId, loadedCursor: { startPage: 1, endPage: 3 }, currentPage: 1 }));
  write(path.join(world, "textbooks", "textbook_index.json"), JSON.stringify({ textbooks: [{ id: scope.textbookId, currentPage: 1 }] }));
  write(path.join(world, "chats", scope.conversationId + ".json"), JSON.stringify({ messages: [{ id: "a0", role: "assistant", content: "ready" }] }));
  return { world: world, textbook: textbook, conversation: conversation };
}

async function main() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-race-"));
  var scope = { accountId: "local", profileId: "p", worldId: "w", textbookId: "t", conversationId: "c1" };
  var files = seed(root, scope);
  var account = { active: true, accountId: "local", sessionEpoch: 1 };
  var clock = 100000;
  var runtime = Auto.createAutoAdvance({
    projectRoot: root,
    bootId: "boot-1",
    leaseMs: 100,
    now: function () { return clock; },
    getAccountContext: function () { return account; }
  });
  var snapshot = await runtime.bootstrap(scope);

  var loadStarted = deferred();
  var loadRelease = deferred();
  var firstEnvelope = turnEnvelope(scope, "u1", snapshot, "下一页", { type: "next" });
  var first = runtime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "u1",
    envelope: firstEnvelope,
    loadRange: async function () {
      loadStarted.resolve();
      await loadRelease.promise;
      return { startPage: 4, endPage: 6, content: "next" };
    }
  }));
  await loadStarted.promise;
  var duplicate = runtime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "u1",
    envelope: firstEnvelope,
    loadRange: async function () { throw new Error("duplicate loader must not run"); }
  }));
  loadRelease.resolve();
  var accepted = await first;
  await assert.rejects(duplicate, function (error) { return error && error.code === "TURN_IN_PROGRESS"; });

  clock += 101;
  var takeover = await runtime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "u1",
    envelope: firstEnvelope,
    loadRange: async function () { throw new Error("takeover must reuse the committed range effect"); }
  }));
  assert.strictEqual(takeover.retry, true);
  assert.notDeepStrictEqual(takeover.executorKey, accepted.executorKey);
  await assert.rejects(function () {
    return runtime.completeTurn(Object.assign({}, scope, {
      clientTurnId: "u1",
      envelopeHash: accepted.envelopeHash,
      executorKey: accepted.executorKey,
      promptSnapshot: accepted.promptSnapshot,
      assistantMessageId: "old-a1",
      responseText: "late old result"
    }));
  }, function (error) { return error && error.code === "SCOPE_STALE"; });
  var completed = await runtime.completeTurn(Object.assign({}, scope, {
    clientTurnId: "u1",
    envelopeHash: takeover.envelopeHash,
    executorKey: takeover.executorKey,
    promptSnapshot: takeover.promptSnapshot,
    assistantMessageId: "a1",
    responseText: "current result"
  }));
  assert.strictEqual(completed.parentAssistantMessageId, "a1");

  var beforeCandidate = runtime._readCommitted(scope).conversations.c1.readingVersion;
  await runtime.prefetchCandidate(Object.assign({}, scope, {
    timeoutMs: 1000,
    loadRange: async function () { return { startPage: 7, endPage: 9, content: "candidate" }; }
  }));
  var afterCandidate = runtime._readCommitted(scope).conversations.c1.readingVersion;
  assert.strictEqual(afterCandidate, beforeCandidate, "background candidate must not change readingVersion");

  var pendingEnvelope = turnEnvelope(scope, "u2", completed, "继续解释", null);
  var pendingTurn = await runtime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "u2",
    envelope: pendingEnvelope,
    loadRange: async function () { throw new Error("hold turn must not load"); }
  }));
  account = { active: true, accountId: "local", sessionEpoch: 2 };
  var epochSnapshot = await runtime.bootstrap(scope);
  assert.ok(epochSnapshot.causalConversationRevision >= completed.causalConversationRevision);
  await assert.rejects(function () {
    return runtime.completeTurn(Object.assign({}, scope, {
      clientTurnId: "u2",
      envelopeHash: pendingTurn.envelopeHash,
      executorKey: pendingTurn.executorKey,
      promptSnapshot: pendingTurn.promptSnapshot,
      assistantMessageId: "stale-after-login",
      responseText: "must not commit"
    }));
  }, function (error) { return error && error.code === "SCOPE_STALE"; });

  var authoritativeBeforeDrift = runtime._readCommitted(scope).conversations.c1.loadedRange.startPage;
  write(path.join(files.textbook, "progress_state.json"), JSON.stringify({ schemaVersion: 3, textbookId: "t", sourceConversationId: "c1", loadedCursor: { startPage: 99, endPage: 100 }, currentPage: 99 }));
  var healedProgress = await runtime.bootstrap(scope);
  assert.strictEqual(healedProgress.readingRange.startPage, authoritativeBeforeDrift, "legacy progress drift must preserve the authoritative range");
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(files.textbook, "progress_state.json"), "utf8")).loadedCursor.startPage, authoritativeBeforeDrift, "legacy progress drift is overwritten by the authoritative projection");

  assert.strictEqual(Auto.canonicalize({ z: 1, a: [true, null, "中"] }), '{"a":[true,null,"中"],"z":1}');
  assert.strictEqual(runtime.hashEnvelope({ b: 2, a: 1 }), runtime.hashEnvelope({ a: 1, b: 2 }));
  runtime.shutdown();

  var optimisticRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-optimistic-parent-"));
  try {
    var optimisticFiles = seed(optimisticRoot, scope);
    write(path.join(optimisticFiles.world, "chats", "c1.json"), JSON.stringify({ messages: [
      { id: "optimistic-u1", role: "user", content: "我们继续吧" },
      { id: "optimistic-a1", role: "assistant", content: "" }
    ] }));
    var optimisticRuntime = Auto.createAutoAdvance({ bootId: "optimistic", projectRoot: optimisticRoot, getAccountContext: function () { return { active: true, accountId: "local", sessionEpoch: 1 }; } });
    var optimisticSnapshot = await optimisticRuntime.bootstrap(scope);
    assert.strictEqual(optimisticSnapshot.parentAssistantMessageId, null, "an empty optimistic assistant must never become the authoritative parent");
    var optimisticEnvelope = turnEnvelope(scope, "optimistic-u1", optimisticSnapshot, "我们继续吧", null);
    var optimisticTurn = await optimisticRuntime.beginTurn(Object.assign({}, scope, {
      advanceProtocolVersion: 2,
      clientTurnId: "optimistic-u1",
      envelope: optimisticEnvelope,
      loadRange: async function () { throw new Error("first ordinary turn must not load"); }
    }));
    assert.strictEqual(optimisticTurn.replay, false, "the first turn must be accepted after optimistic persistence");
    optimisticRuntime.shutdown();
  } finally {
    fs.rmSync(optimisticRoot, { recursive: true, force: true });
  }

  var poisonedParentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-poisoned-parent-"));
  try {
    var poisonedFiles = seed(poisonedParentRoot, scope);
    write(path.join(poisonedFiles.world, "chats", "c1.json"), JSON.stringify({ messages: [
      { id: "poison-u1", role: "user", content: "我们继续吧" },
      { id: "poison-a1", role: "assistant", content: "Parent assistant message is stale" }
    ] }));
    var poisonedRuntime = Auto.createAutoAdvance({ bootId: "poisoned", projectRoot: poisonedParentRoot, getAccountContext: function () { return { active: true, accountId: "local", sessionEpoch: 1 }; } });
    var poisonedSnapshot = await poisonedRuntime.bootstrap(scope);
    assert.strictEqual(poisonedSnapshot.parentAssistantMessageId, "poison-a1", "fixture must first reproduce a polluted authoritative parent");
    write(path.join(poisonedFiles.world, "chats", "c1.json"), JSON.stringify({ messages: [
      { id: "poison-u1", role: "user", content: "我们继续吧" },
      { id: "poison-a1", role: "assistant", content: "Parent assistant message is stale", failed: true, notAccepted: true }
    ] }));
    var recoveredEnvelope = turnEnvelope(scope, "recovered-u1", Object.assign({}, poisonedSnapshot, { parentAssistantMessageId: null }), "重新发送", null);
    var recoveredTurn = await poisonedRuntime.beginTurn(Object.assign({}, scope, {
      advanceProtocolVersion: 2,
      clientTurnId: "recovered-u1",
      envelope: recoveredEnvelope,
      loadRange: async function () { throw new Error("recovered ordinary turn must not load"); }
    }));
    assert.strictEqual(recoveredTurn.parentAssistantMessageId, null, "a rejected stale card must be removed from the authoritative parent chain");
    poisonedRuntime.shutdown();
  } finally {
    fs.rmSync(poisonedParentRoot, { recursive: true, force: true });
  }

  var conflictRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-migration-conflict-"));
  var conflictFiles = seed(conflictRoot, scope);
  write(path.join(conflictFiles.textbook, "progress_state.json"), JSON.stringify({ schemaVersion: 3, textbookId: "t", sourceConversationId: "c1", loadedCursor: { startPage: 2, endPage: 4 }, currentPage: 2 }));
  var conflictRuntime = Auto.createAutoAdvance({ projectRoot: conflictRoot, getAccountContext: function () { return { active: true, accountId: "local", sessionEpoch: 1 }; } });
  await assert.rejects(function () { return conflictRuntime.bootstrap(scope); }, function (error) { return error && error.code === "MIGRATION_REPAIR_REQUIRED"; });
  assert.strictEqual(fs.existsSync(path.join(conflictFiles.textbook, ".reading-state-v2", "current-pointer.json")), false, "conflicted migration must not publish a pointer");
  conflictRuntime.shutdown();

  var coldRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-cold-prefetch-"));
  var coldFiles = seed(coldRoot, scope);
  var coldRuntime = Auto.createAutoAdvance({ projectRoot: coldRoot, getAccountContext: function () { return { active: true, accountId: "local", sessionEpoch: 1 }; } });
  var coldLoadCount = 0;
  var coldPrefetch = await coldRuntime.prefetchCandidate(Object.assign({}, scope, {
    loadRange: async function () {
      coldLoadCount += 1;
      return { startPage: 4, endPage: 6, content: "cold candidate" };
    }
  }));
  assert.deepStrictEqual(coldPrefetch, { skipped: true, reason: "state_unavailable" }, "cold background prefetch must not create authoritative state");
  assert.strictEqual(coldLoadCount, 0, "cold background prefetch must not start extraction");
  assert.strictEqual(fs.existsSync(path.join(coldFiles.textbook, ".reading-state-v2", "current-pointer.json")), false, "cold background prefetch must not publish an owner");
  coldRuntime.shutdown();

  var crossRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-cross-runtime-"));
  seed(crossRoot, scope);
  var crossOptions = {
    projectRoot: crossRoot,
    getAccountContext: function () { return { active: true, accountId: "local", sessionEpoch: 1 }; }
  };
  var runtimeA = Auto.createAutoAdvance(Object.assign({ bootId: "boot-a" }, crossOptions));
  var runtimeB = Auto.createAutoAdvance(Object.assign({ bootId: "boot-b" }, crossOptions));
  var crossSnapshot = await runtimeA.bootstrap(scope);
  await runtimeB.bootstrap(scope);
  var crossEnvelope = turnEnvelope(scope, "cross-u1", crossSnapshot, "下一页", { type: "next" });
  var bothLoading = deferred();
  var releaseBoth = deferred();
  var loadCount = 0;
  async function racingLoader() {
    loadCount += 1;
    if (loadCount === 2) bothLoading.resolve();
    await releaseBoth.promise;
    return { startPage: 4, endPage: 6, content: "cross-runtime" };
  }
  var racingArgs = Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "cross-u1",
    envelope: crossEnvelope,
    loadRange: racingLoader
  });
  var raceA = runtimeA.beginTurn(racingArgs);
  var raceB = runtimeB.beginTurn(racingArgs);
  await bothLoading.promise;
  releaseBoth.resolve();
  var crossResults = await Promise.allSettled([raceA, raceB]);
  assert.strictEqual(crossResults.filter(function (result) { return result.status === "fulfilled"; }).length, 1, "only one runtime may publish the turn");
  assert.strictEqual(crossResults.filter(function (result) {
    return result.status === "rejected" && result.reason && result.reason.code === "SCOPE_STALE";
  }).length, 1, "the losing runtime must fail its pointer CAS");
  runtimeA.shutdown();
  runtimeB.shutdown();

  var corruptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-corrupt-pointer-"));
  var corruptFiles = seed(corruptRoot, scope);
  var corruptRuntime = Auto.createAutoAdvance(Object.assign({ bootId: "corrupt-a" }, crossOptions, { projectRoot: corruptRoot }));
  await corruptRuntime.bootstrap(scope);
  corruptRuntime.shutdown();
  write(path.join(corruptFiles.textbook, ".reading-state-v2", "current-pointer.json"), "{");
  var recoveryRuntime = Auto.createAutoAdvance(Object.assign({ bootId: "corrupt-b" }, crossOptions, { projectRoot: corruptRoot }));
  await assert.rejects(function () { return recoveryRuntime.bootstrap(scope); }, function (error) {
    return error && error.code === "advance_pointer_invalid";
  });
  recoveryRuntime.shutdown();

  var immutableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-immutable-retry-"));
  seed(immutableRoot, scope);
  var immutableRuntime = Auto.createAutoAdvance(Object.assign({ bootId: "immutable" }, crossOptions, { projectRoot: immutableRoot }));
  var immutableStart = await immutableRuntime.bootstrap(scope);
  var immutableEnvelope = turnEnvelope(scope, "immutable-u1", immutableStart, "继续解释", null);
  var immutableTurn = await immutableRuntime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "immutable-u1",
    envelope: immutableEnvelope,
    loadRange: async function () { throw new Error("hold turn must not load"); }
  }));
  await immutableRuntime.failTurn(Object.assign({}, scope, {
    clientTurnId: "immutable-u1",
    executorKey: immutableTurn.executorKey,
    errorCode: "network",
    retryable: true
  }));
  var immutableCommitBase = await immutableRuntime.readSnapshot(scope);
  await immutableRuntime.commitRange(Object.assign({}, scope, { startPage: 9, endPage: 10, content: "newer range", reason: "explicit_page_jump", expectedSnapshot: immutableCommitBase }));
  await assert.rejects(function () {
    return immutableRuntime.beginTurn(Object.assign({}, scope, {
      advanceProtocolVersion: 2,
      clientTurnId: "immutable-u1",
      envelope: immutableEnvelope,
      loadRange: async function () { throw new Error("stale retry must not load"); }
    }));
  }, function (error) { return error && error.code === "SCOPE_STALE"; });
  var immutableStored = immutableRuntime._readCommitted(scope).conversations.c1.turns["immutable-u1"];
  assert.strictEqual(immutableStored.turnState, "CANCELLED_RETRYABLE", "stale retry must be rejected before acquiring an executor");
  assert.strictEqual(immutableStored.promptSnapshot.readingVersion, immutableTurn.promptSnapshot.readingVersion);
  immutableRuntime.shutdown();

  var beginFailureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-begin-cleanup-"));
  var beginFailureFiles = seed(beginFailureRoot, scope);
  var beginFailureRuntime = Auto.createAutoAdvance(Object.assign({ bootId: "begin-cleanup" }, crossOptions, { projectRoot: beginFailureRoot }));
  var beginFailureStart = await beginFailureRuntime.bootstrap(scope);
  var beginFailureEnvelope = turnEnvelope(scope, "begin-failure-u1", beginFailureStart, "下一页", { type: "next" });
  await assert.rejects(function () {
    return beginFailureRuntime.beginTurn(Object.assign({}, scope, {
      advanceProtocolVersion: 2,
      clientTurnId: "begin-failure-u1",
      envelope: beginFailureEnvelope,
      loadRange: async function () {
        fs.rmSync(path.join(beginFailureFiles.conversation, "current_reading.md"));
        fs.mkdirSync(path.join(beginFailureFiles.conversation, "current_reading.md"));
        return { startPage: 4, endPage: 6, content: "projection failure" };
      }
    }));
  });
  var failedBeginTurn = beginFailureRuntime._readCommitted(scope).conversations.c1.turns["begin-failure-u1"];
  assert.strictEqual(failedBeginTurn.turnState, "CANCELLED_RETRYABLE", "beginTurn failure after persistence must release the execution lease");
  assert.strictEqual(failedBeginTurn.executor, null, "beginTurn failure after persistence must clear the executor");
  beginFailureRuntime.shutdown();

  var ownerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-rejected-owner-"));
  var ownerFiles = seed(ownerRoot, scope);
  var scope2 = Object.assign({}, scope, { conversationId: "c2" });
  write(path.join(ownerFiles.world, "conversations", "c2", "current_reading.md"), "<!-- startPage: 4 endPage: 6 -->\nsecond");
  write(path.join(ownerFiles.world, "chats", "c2.json"), JSON.stringify({ messages: [{ id: "b0", role: "assistant", content: "second" }] }));
  var ownerRuntime = Auto.createAutoAdvance(Object.assign({ bootId: "owner" }, crossOptions, { projectRoot: ownerRoot }));
  var ownerC1 = await ownerRuntime.bootstrap(scope);
  var ownerC2 = await ownerRuntime.bootstrap(scope2);
  var ownerC2Envelope = turnEnvelope(scope2, "owner-c2-u1", ownerC2, "继续解释", null);
  var ownerC2Turn = await ownerRuntime.beginTurn(Object.assign({}, scope2, {
    advanceProtocolVersion: 2,
    clientTurnId: "owner-c2-u1",
    envelope: ownerC2Envelope,
    loadRange: async function () { throw new Error("hold turn must not load"); }
  }));
  var inactivePrefetchLoadCount = 0;
  var inactivePrefetch = await ownerRuntime.prefetchCandidate(Object.assign({}, scope, {
    timeoutMs: 1000,
    loadRange: async function () {
      inactivePrefetchLoadCount += 1;
      return { startPage: 4, endPage: 6, content: "inactive candidate" };
    }
  }));
  assert.deepStrictEqual(inactivePrefetch, { skipped: true, reason: "inactive_owner" }, "background prefetch from an inactive conversation must be skipped");
  assert.strictEqual(inactivePrefetchLoadCount, 0, "inactive background prefetch must not start extraction");
  assert.strictEqual(ownerRuntime._readCommitted(scope2).owner.conversationId, "c2", "inactive background prefetch must not take ownership");
  var lateRead = await ownerRuntime.readSnapshot(scope);
  assert.strictEqual(lateRead.readingVersion, ownerC1.readingVersion);
  assert.strictEqual(ownerRuntime._readCommitted(scope2).owner.conversationId, "c2", "readSnapshot must never change owner");
  await ownerRuntime.completeTurn(Object.assign({}, scope2, {
    clientTurnId: "owner-c2-u1",
    envelopeHash: ownerC2Turn.envelopeHash,
    executorKey: ownerC2Turn.executorKey,
    promptSnapshot: ownerC2Turn.promptSnapshot,
    assistantMessageId: "owner-c2-a1",
    responseText: "still current"
  }));
  var rejectedEnvelope = turnEnvelope(scope, "rejected-u1", ownerC1, "late", null);
  rejectedEnvelope.baseCausalConversationRevision = 999;
  await assert.rejects(function () {
    return ownerRuntime.beginTurn(Object.assign({}, scope, {
      advanceProtocolVersion: 2,
      clientTurnId: "rejected-u1",
      envelope: rejectedEnvelope,
      loadRange: async function () { throw new Error("stale turn must not load"); }
    }));
  }, function (error) { return error && error.code === "STALE_TURN"; });
  assert.strictEqual(ownerRuntime._readCommitted(scope2).owner.conversationId, "c2", "rejected request must not change owner");
  var lateJumpBase = await ownerRuntime.bootstrap(scope);
  var c1BeforeLateJump = ownerRuntime._readCommitted(scope).conversations.c1;
  await ownerRuntime.bootstrap(scope2);
  await assert.rejects(function () {
    return ownerRuntime.commitRange(Object.assign({}, scope, {
      startPage: 40,
      endPage: 42,
      content: "late jump result",
      reason: "explicit_page_jump",
      expectedSnapshot: lateJumpBase
    }));
  }, function (error) { return error && error.code === "SCOPE_STALE"; });
  var afterLateJump = ownerRuntime._readCommitted(scope2);
  assert.strictEqual(afterLateJump.owner.conversationId, "c2", "late jump must not reclaim ownership");
  assert.deepStrictEqual(afterLateJump.conversations.c1.loadedRange, c1BeforeLateJump.loadedRange, "late jump must not overwrite the inactive range");
  assert.strictEqual(afterLateJump.conversations.c1.readingVersion, c1BeforeLateJump.readingVersion, "late jump must not advance the inactive reading version");
  write(path.join(ownerFiles.world, "conversations", "c1", "current_reading.md"), "<!-- startPage: 99 endPage: 99 -->\nexternal inactive mutation");
  var healedInactive = await ownerRuntime.bootstrap(scope);
  assert.strictEqual(healedInactive.readingRange.startPage, c1BeforeLateJump.loadedRange.startPage, "activating a mutated inactive conversation restores its authoritative range");
  assert.strictEqual(ownerRuntime._readCommitted(scope).owner.conversationId, "c1", "successful bootstrap activates the requested conversation after quarantining its stale projection");
  assert.notStrictEqual(Auto.parseRange(fs.readFileSync(path.join(ownerFiles.world, "conversations", "c1", "current_reading.md"), "utf8")).startPage, 99, "inactive reading drift is overwritten on activation");
  ownerRuntime.shutdown();

  var fenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-jump-fence-"));
  var fenceFiles = seed(fenceRoot, scope);
  var seededFenceProgress = JSON.parse(fs.readFileSync(path.join(fenceFiles.textbook, "progress_state.json"), "utf8"));
  seededFenceProgress.taughtCursor = { chunkId: "md-0001", ordinal: 1, startPage: 1, endPage: 3 };
  write(path.join(fenceFiles.textbook, "progress_state.json"), JSON.stringify(seededFenceProgress));
  var fenceRuntime = Auto.createAutoAdvance(Object.assign({ bootId: "jump-fence" }, crossOptions, { projectRoot: fenceRoot }));
  var rangeFence = await fenceRuntime.bootstrap(scope);
  assert.throws(function () {
    return fenceRuntime.commitRange(Object.assign({}, scope, {
      startPage: 4,
      endPage: 6,
      content: "unfenced jump",
      reason: "explicit_page_jump"
    }));
  }, function (error) { return error && error.code === "advance_commit_fence_required"; });
  await fenceRuntime.commitRange(Object.assign({}, scope, {
    startPage: 4,
    endPage: 6,
    content: "current jump",
    reason: "explicit_page_jump",
    expectedSnapshot: rangeFence,
    rangeMetadata: { chunkId: "md-0004", ordinal: 4, loadedOnly: true, jumpLoaded: true }
  }));
  var projectedCursor = JSON.parse(fs.readFileSync(path.join(fenceRoot, "accounts", "local", "profiles", "p", "worlds", "w", "textbooks", "t", "progress_state.json"), "utf8")).loadedCursor;
  assert.strictEqual(projectedCursor.chunkId, "md-0004", "authoritative projection must preserve markdown chunk identity");
  assert.strictEqual(projectedCursor.ordinal, 4, "authoritative projection must preserve markdown ordinal");
  assert.strictEqual(projectedCursor.loadedOnly, true, "authoritative projection must preserve loaded-only state");
  assert.strictEqual(projectedCursor.jumpLoaded, true, "authoritative projection must preserve jump-loaded state");
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(fenceFiles.textbook, "progress_state.json"), "utf8")).currentPage, 1, "loaded-only markdown jump must not advance taught progress");
  await assert.rejects(function () {
    return fenceRuntime.commitRange(Object.assign({}, scope, {
      startPage: 7,
      endPage: 9,
      content: "stale range jump",
      reason: "explicit_page_jump",
      expectedSnapshot: rangeFence
    }));
  }, function (error) { return error && error.code === "SCOPE_STALE"; });
  var turnFence = await fenceRuntime.readSnapshot(scope);
  var fenceEnvelope = turnEnvelope(scope, "fence-u1", turnFence, "继续解释", null);
  var fenceTurn = await fenceRuntime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "fence-u1",
    envelope: fenceEnvelope,
    loadRange: async function () { throw new Error("hold turn must not load"); }
  }));
  await assert.rejects(function () {
    return fenceRuntime.commitRange(Object.assign({}, scope, {
      startPage: 7,
      endPage: 9,
      content: "stale turn jump",
      reason: "explicit_page_jump",
      expectedSnapshot: turnFence
    }));
  }, function (error) { return error && error.code === "SCOPE_STALE"; });
  await fenceRuntime.failTurn(Object.assign({}, scope, {
    clientTurnId: "fence-u1",
    executorKey: fenceTurn.executorKey,
    errorCode: "test_cleanup",
    retryable: true
  }));
  assert.deepStrictEqual(fenceRuntime._readCommitted(scope).conversations.c1.loadedRange, {
    startPage: 4,
    endPage: 6,
    chunkId: "md-0004",
    ordinal: 4,
    loadedOnly: true,
    jumpLoaded: true
  }, "stale jump fences must preserve the current range and projection metadata");
  var tamperedProjection = JSON.parse(fs.readFileSync(path.join(fenceFiles.textbook, "progress_state.json"), "utf8"));
  tamperedProjection.loadedCursor.chunkId = "md-tampered";
  write(path.join(fenceFiles.textbook, "progress_state.json"), JSON.stringify(tamperedProjection));
  var healedChunk = await fenceRuntime.bootstrap(scope);
  assert.strictEqual(healedChunk.readingRange.chunkId, "md-0004", "tampered markdown chunk identity must self-heal from authoritative state");
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(fenceFiles.textbook, "progress_state.json"), "utf8")).loadedCursor.chunkId, "md-0004", "self-healing republishes the authoritative markdown chunk identity");
  fenceRuntime.shutdown();

  var epochRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-epoch-rollback-"));
  seed(epochRoot, scope);
  var oldEpochRuntime = Auto.createAutoAdvance({
    projectRoot: epochRoot,
    bootId: "epoch-old",
    getAccountContext: function () { return { active: true, accountId: "local", sessionEpoch: 1 }; }
  });
  var newEpochRuntime = Auto.createAutoAdvance({
    projectRoot: epochRoot,
    bootId: "epoch-new",
    getAccountContext: function () { return { active: true, accountId: "local", sessionEpoch: 2 }; }
  });
  await oldEpochRuntime.bootstrap(scope);
  await newEpochRuntime.bootstrap(scope);
  await assert.rejects(function () { return oldEpochRuntime.bootstrap(scope); }, function (error) {
    return error && error.code === "SCOPE_STALE";
  });
  assert.strictEqual(newEpochRuntime._readCommitted(Object.assign({}, scope, { sessionEpoch: 2 })).scope.sessionEpoch, 2, "session epoch must never roll back");
  oldEpochRuntime.shutdown();
  newEpochRuntime.shutdown();

  var queuedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-queued-session-"));
  seed(queuedRoot, scope);
  var queuedAccount = { active: true, accountId: "local", sessionEpoch: 1 };
  var queuedRuntime = Auto.createAutoAdvance({
    projectRoot: queuedRoot,
    bootId: "queued-session",
    getAccountContext: function () { return queuedAccount; }
  });
  var queuedBase = await queuedRuntime.bootstrap(scope);
  var queuedLoadStarted = deferred();
  var queuedLoadRelease = deferred();
  var queuedEnvelope = turnEnvelope(scope, "queued-u1", queuedBase, "下一页", { type: "next" });
  var blockingTurn = queuedRuntime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "queued-u1",
    envelope: queuedEnvelope,
    loadRange: async function () {
      queuedLoadStarted.resolve();
      await queuedLoadRelease.promise;
      throw new Error("forced queued loader failure");
    }
  }));
  await queuedLoadStarted.promise;
  var queuedCommit = queuedRuntime.commitRange(Object.assign({}, scope, {
    startPage: 4,
    endPage: 6,
    content: "must not commit after session switch",
    reason: "explicit_page_jump",
    expectedSnapshot: queuedBase
  }));
  queuedAccount = { active: true, accountId: "local", sessionEpoch: 2 };
  queuedLoadRelease.resolve();
  await assert.rejects(blockingTurn, /forced queued loader failure/);
  await assert.rejects(queuedCommit, function (error) { return error && error.code === "SCOPE_STALE"; });
  assert.strictEqual(queuedRuntime._readCommitted(Object.assign({}, scope, { sessionEpoch: 2 })).conversations.c1.readingVersion, queuedBase.readingVersion, "queued stale commit must not change readingVersion");
  queuedRuntime.shutdown();

  var lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-corrupt-lock-"));
  var lockFiles = seed(lockRoot, scope);
  var lockRuntime = Auto.createAutoAdvance(Object.assign({ bootId: "lock" }, crossOptions, { projectRoot: lockRoot }));
  var lockBase = await lockRuntime.bootstrap(scope);
  var corruptLock = path.join(lockFiles.textbook, ".reading-state-v2", "commit.lock");
  write(corruptLock, "");
  var oldLockTime = new Date(Date.now() - 5000);
  fs.utimesSync(corruptLock, oldLockTime, oldLockTime);
  var lockCommit = await lockRuntime.commitRange(Object.assign({}, scope, { startPage: 7, endPage: 8, content: "after lock recovery", expectedSnapshot: lockBase }));
  assert.strictEqual(lockCommit.readingVersion, 1, "stale malformed lock must be reclaimed");
  lockRuntime.shutdown();

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(conflictRoot, { recursive: true, force: true });
  fs.rmSync(coldRoot, { recursive: true, force: true });
  fs.rmSync(crossRoot, { recursive: true, force: true });
  fs.rmSync(corruptRoot, { recursive: true, force: true });
  fs.rmSync(immutableRoot, { recursive: true, force: true });
  fs.rmSync(beginFailureRoot, { recursive: true, force: true });
  fs.rmSync(ownerRoot, { recursive: true, force: true });
  fs.rmSync(fenceRoot, { recursive: true, force: true });
  fs.rmSync(epochRoot, { recursive: true, force: true });
  fs.rmSync(queuedRoot, { recursive: true, force: true });
  fs.rmSync(lockRoot, { recursive: true, force: true });
  console.log("auto-advance v2 race smoke test: PASS");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
