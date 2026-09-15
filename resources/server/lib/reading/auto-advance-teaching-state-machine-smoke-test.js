"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Auto = require("./auto-advance.js");
var Kb = require("../progress/kb-progress.js");
var Resume = require("../resume/progress-resume.js");

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
  var textbook = path.join(world, "textbooks", scope.textbookId);
  return {
    world: world,
    textbook: textbook,
    conversation: path.join(world, "conversations", scope.conversationId),
    index: path.join(world, "textbooks", "textbook_index.json"),
  };
}

function seed(root, scope, options) {
  options = options || {};
  var files = filesFor(root, scope);
  var startPage = Number(options.startPage || 1);
  var endPage = Number(options.endPage || startPage + 1);
  var progress = {
    schemaVersion: 3,
    textbookId: scope.textbookId,
    sourceConversationId: scope.conversationId,
    activeConceptId: options.activeConceptId || "c1",
    loadedCursor: { startPage: startPage, endPage: endPage },
    currentPage: Number(options.currentPage || startPage),
    lastTaughtPage: Number(options.lastTaughtPage || startPage),
    completedConceptIds: options.completedConceptIds || [],
    completedTitles: [],
  };
  if (Number.isInteger(Number(options.totalPages)) && Number(options.totalPages) > 0) {
    progress.totalPages = Number(options.totalPages);
  }
  write(path.join(files.conversation, "current_reading.md"), "<!-- startPage: " + startPage + " endPage: " + endPage + " -->\nwindow " + startPage + "-" + endPage);
  write(path.join(files.textbook, "progress_state.json"), JSON.stringify(progress));
  var textbookEntry = { id: scope.textbookId, currentPage: startPage };
  if (Number.isInteger(Number(options.totalPages)) && Number(options.totalPages) > 0) textbookEntry.numPages = Number(options.totalPages);
  write(files.index, JSON.stringify({ textbooks: [textbookEntry] }));
  write(path.join(files.world, "chats", scope.conversationId + ".json"), JSON.stringify({ messages: [{ id: "a0", role: "assistant", content: "ready" }] }));

  if (options.knowledgeBase) {
    var kb = path.join(files.textbook, "knowledge_base");
    var cards = [
      { concept_id: "c1", title: "One", source_pages: [1, 2], definition: "one" },
      { concept_id: "c2", title: "Two", source_pages: [3, 4], definition: "two" },
    ];
    write(path.join(kb, "index.json"), JSON.stringify({ cards: cards }));
    cards.forEach(function (card) { write(path.join(kb, "cards", card.concept_id + ".json"), JSON.stringify(card)); });
    write(path.join(kb, "teaching_map.json"), JSON.stringify({ segments: [{ sequence: [{ card_ids: ["c1", "c2"] }] }] }));
    write(path.join(kb, "build_status.json"), JSON.stringify({ state: "done", activationEligible: true }));
  }
  return files;
}

function makeRuntime(root) {
  return Auto.createAutoAdvance({
    projectRoot: root,
    bootId: "teaching-state-machine",
    getAccountContext: function () { return { active: true, accountId: "local", sessionEpoch: 1 }; },
  });
}

function envelope(scope, id, snapshot, text, action) {
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
    readingAction: action || null,
  };
}

async function begin(runtime, scope, id, snapshot, text, action, loadRange) {
  return runtime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: id,
    envelope: envelope(scope, id, snapshot, text, action),
    loadRange: loadRange || async function () { throw new Error("unexpected range load"); },
  }));
}

async function complete(runtime, scope, id, turn, responseText, decision, requiresTeachingProgress) {
  return runtime.completeTurn(Object.assign({}, scope, {
    clientTurnId: id,
    envelopeHash: turn.envelopeHash,
    executorKey: turn.executorKey,
    promptSnapshot: turn.promptSnapshot,
    assistantMessageId: id + "-assistant",
    responseText: responseText,
    decision: decision || null,
    requiresTeachingProgress: requiresTeachingProgress === true,
  }));
}

async function createVerifiedPending(options) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-teaching-pending-"));
  var scope = scopeFor(options && options.conversationId);
  var files = seed(root, scope, Object.assign({ startPage: 1, endPage: 2, totalPages: 4 }, options || {}));
  var runtime = makeRuntime(root);
  var initial = await runtime.bootstrap(scope);
  var turn = await begin(runtime, scope, "pending-u1", initial, "讲解当前窗口", null);
  var completed = await complete(runtime, scope, "pending-u1", turn, options && options.responseText || "窗口内容已经掌握。", options && options.decision, true);
  var teaching = await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "pending-u1",
    activeConceptId: "next-card",
    activeIndex: 1,
    newlyCompletedConceptIds: ["current-card"],
    newlyCompletedTitles: ["Current card"],
    lastTaughtPage: 2,
    loadedRange: { startPage: 1, endPage: 2 },
    windowComplete: true,
  }));
  assert.strictEqual(Auto.pendingAdvanceVerified(runtime._readCommitted(scope).conversations[scope.conversationId].pendingAdvance), true, "fixture must create a verified pending advance");
  return { root: root, scope: scope, files: files, runtime: runtime, snapshot: teaching, initial: initial };
}

async function intermediateWindowBoundary() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-kb-boundary-"));
  var scope = scopeFor();
  var files = seed(root, scope, { startPage: 1, endPage: 2, totalPages: 4, knowledgeBase: true });
  var queue = Kb.loadQueue(files.textbook).queue;
  var marker = {
    schemaVersion: 1,
    textbookId: "tb",
    sourceConversationId: "c1",
    activeConceptId: "c2",
    newlyCompletedConceptIds: ["c1"],
    lastTaughtPage: 2,
  };
  var initialState = Resume.readState(files.textbook);
  var validated = Kb.validateProgressMarker(marker, {
    queue: queue,
    state: initialState,
    textbookId: "tb",
    conversationId: "c1",
    loadedRange: { startPage: 1, endPage: 2 },
  });
  assert.strictEqual(validated.ok, true, "the final card in an intermediate loaded window is valid");
  assert.strictEqual(validated.activeConceptId, "c1", "the completed card remains the active projection until the next window is loaded");
  assert.strictEqual(validated.nextConceptId, "c2", "the unloaded next card is represented separately");
  assert.strictEqual(validated.windowComplete, true, "the marker closes the loaded window");
  var implicitBoundary = Kb.validateProgressMarker({
    schemaVersion: 1,
    textbookId: "tb",
    sourceConversationId: "c1",
    newlyCompletedConceptIds: ["c1"],
    lastTaughtPage: 2,
  }, {
    queue: queue,
    state: initialState,
    textbookId: "tb",
    conversationId: "c1",
    loadedRange: { startPage: 1, endPage: 2 },
  });
  assert.strictEqual(implicitBoundary.ok, true, "omitting activeConceptId still permits a legal window-tail completion");
  assert.strictEqual(implicitBoundary.nextConceptId, "c2", "the implicit boundary form preserves the deferred next card");

  var runtime = makeRuntime(root);
  var initial = await runtime.bootstrap(scope);
  var turn = await begin(runtime, scope, "boundary-u1", initial, "讲解最后一张卡", null);
  var completed = await complete(runtime, scope, "boundary-u1", turn, "很好，这个窗口的最后一张卡已经掌握。", null, true);
  var validationOnly = Kb.commitAssistantProgress(files.textbook, {
    marker: marker,
    textbookId: "tb",
    conversationId: "c1",
    loadedRange: { startPage: 1, endPage: 2 },
    write: false,
  });
  assert.strictEqual(validationOnly.ok, true, "the production marker validator accepts the boundary marker");
  global.__AUTO_ADVANCE__ = runtime;
  try {
    var sseResponse = new Response(
      "data: " + JSON.stringify({ type: "text", text: "回答<!-- kbProgress:" + JSON.stringify(marker).replace(/\\/g, "") + " -->" }) + "\n\n" +
      "data: {\"type\":\"done\"}\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
    var transformed = await Kb.transformSseResponse(sseResponse, {
      body: { textbookId: "tb", conversationId: "c1", profileId: "p", worldId: "w", clientTurnId: "boundary-u1", advanceProtocolVersion: 2 },
      paths: {
        worldDir: files.world,
        textbookDir: files.textbook,
        textbookId: "tb",
        conversationId: "c1",
        textbookIndex: files.index,
        worldConfig: path.join(files.world, "world.json"),
      },
      endClass: false,
      trackProgress: true,
      conversationMeta: { textbookId: "tb" },
    });
    var transformedText = await transformed.text();
    assert.ok(transformedText.includes('"text":"回答"'), "production SSE transformation preserves visible text");
  } finally {
    delete global.__AUTO_ADVANCE__;
  }
  var boundaryProgress = Object.assign({}, scope, {
    clientTurnId: "boundary-u1",
    activeConceptId: validationOnly.activeConceptId,
    activeIndex: validationOnly.activeIndex,
    nextConceptId: validationOnly.nextConceptId,
    newlyCompletedConceptIds: validationOnly.newlyCompletedConceptIds,
    newlyCompletedTitles: validationOnly.newlyCompletedTitles,
    lastTaughtPage: validationOnly.lastTaughtPage,
    loadedRange: { startPage: 1, endPage: 2 },
    windowComplete: validationOnly.windowComplete,
    textbookComplete: validationOnly.textbookComplete,
  });
  await runtime.commitTeachingProgress(boundaryProgress);
  var stateAfterTeaching = runtime._readCommitted(scope).conversations.c1;
  assert.deepStrictEqual(stateAfterTeaching.completedConceptIds, ["c1"], "the boundary card is completed exactly once");
  assert.strictEqual(stateAfterTeaching.activeConceptId, "c1", "the unloaded card is not made active prematurely");
  assert.strictEqual(stateAfterTeaching.nextConceptId, "c2", "the next card remains a deferred target");
  assert.ok(!stateAfterTeaching.completedConceptIds.includes("c2"), "the next card is not recorded as taught");
  var replay = await runtime.beginTurn(Object.assign({}, scope, {
    advanceProtocolVersion: 2,
    clientTurnId: "boundary-u1",
    envelope: envelope(scope, "boundary-u1", initial, "讲解最后一张卡", null),
    loadRange: async function () { throw new Error("same turn replay must not load"); },
  }));
  assert.strictEqual(replay.replay, true, "replaying a completed boundary turn is idempotent");
  var nextTurn = await begin(runtime, scope, "boundary-u2", scopeSnapshot(completed), "继续", null, async function (request) {
    assert.strictEqual(request.startPage, 3, "the next load starts at the first page of the next window");
    return { startPage: 3, endPage: 4, content: "next window" };
  });
  assert.strictEqual(nextTurn.rangeChanged, true, "a verified window completion advances on the next valid turn");
  assert.deepStrictEqual([nextTurn.readingRange.startPage, nextTurn.readingRange.endPage], [3, 4]);
  var afterLoad = runtime._readCommitted(scope).conversations.c1;
  assert.strictEqual(afterLoad.activeConceptId, "c2", "the active card is relocated after the next window is committed");
  assert.ok(!afterLoad.completedConceptIds.includes("c2"), "relocation does not count the next card as taught");
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

function scopeSnapshot(snapshot) {
  return snapshot;
}

async function structuredCompletionWithoutKeyword() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-structured-completion-"));
  var scope = scopeFor();
  seed(root, scope, { startPage: 1, endPage: 2, totalPages: 4 });
  var runtime = makeRuntime(root);
  var initial = await runtime.bootstrap(scope);
  var turn = await begin(runtime, scope, "structured-u1", initial, "继续讲", null);
  var completed = await complete(runtime, scope, "structured-u1", turn, "很好，这个窗口的最后一张卡已经掌握。", null, true);
  assert.strictEqual(completed.readingVersion, initial.readingVersion, "completing a turn does not itself change the reading range");
  var teaching = await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "structured-u1",
    activeConceptId: "next-card",
    activeIndex: 1,
    newlyCompletedConceptIds: ["current-card"],
    newlyCompletedTitles: ["Current card"],
    lastTaughtPage: 2,
    loadedRange: { startPage: 1, endPage: 2 },
    windowComplete: true,
  }));
  assert.strictEqual(Auto.pendingAdvanceVerified(runtime._readCommitted(scope).conversations.c1.pendingAdvance), true, "structured completion creates a consumable pending advance without a response keyword");
  var pendingState = runtime._readCommitted(scope).conversations.c1;
  assert.strictEqual(pendingState.pendingAdvance.conversationId, "c1", "pending advance is bound to its conversation");
  assert.strictEqual(Auto.pendingAdvanceVerified(pendingState.pendingAdvance, pendingState), true, "aligned pending advance passes the authoritative fence");
  assert.strictEqual(Auto.pendingAdvanceVerified(Object.assign({}, pendingState.pendingAdvance, { conversationId: "other" }), pendingState), false, "cross-conversation pending advance fails closed");
  var next = await begin(runtime, scope, "structured-u2", teaching, "好", null, async function () {
    return { startPage: 3, endPage: 4, content: "next window" };
  });
  assert.strictEqual(next.rangeChanged, true, "the structured completion advances on the following turn");
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

async function falseStructuredCompletionBlocksNaturalLanguage() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-structured-false-"));
  var scope = scopeFor();
  seed(root, scope, { startPage: 1, endPage: 2, totalPages: 4 });
  var runtime = makeRuntime(root);
  var initial = await runtime.bootstrap(scope);
  var turn = await begin(runtime, scope, "false-u1", initial, "继续讲", null);
  var completed = await complete(runtime, scope, "false-u1", turn, "当前部分已经讲完，但请再想想这个问题。", null, true);
  await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "false-u1",
    activeConceptId: "next-card",
    activeIndex: 1,
    newlyCompletedConceptIds: ["current-card"],
    newlyCompletedTitles: ["Current card"],
    lastTaughtPage: 2,
    loadedRange: { startPage: 1, endPage: 2 },
    windowComplete: false,
  }));
  var calls = 0;
  var next = await begin(runtime, scope, "false-u2", completed, "好", null, async function () {
    calls += 1;
    return { startPage: 3, endPage: 4, content: "must not load" };
  });
  assert.strictEqual(next.rangeChanged, false, "windowComplete=false blocks a natural-language completion claim");
  assert.strictEqual(calls, 0, "a false structured completion never calls the range loader");
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

async function negatedAssistantCompletion() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-negated-assistant-"));
  var scope = scopeFor();
  seed(root, scope, { startPage: 1, endPage: 2, totalPages: 4 });
  var runtime = makeRuntime(root);
  var initial = await runtime.bootstrap(scope);
  var turn = await begin(runtime, scope, "negative-u1", initial, "继续", null);
  var completed = await complete(runtime, scope, "negative-u1", turn, "我们先不要进入下一知识点。", null, true);
  await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "negative-u1",
    activeConceptId: "next-card",
    activeIndex: 1,
    newlyCompletedConceptIds: ["current-card"],
    newlyCompletedTitles: ["Current card"],
    lastTaughtPage: 2,
    loadedRange: { startPage: 1, endPage: 2 },
    windowComplete: true,
  }));
  var state = runtime._readCommitted(scope).conversations.c1;
  assert.strictEqual(Auto.pendingAdvanceVerified(state.pendingAdvance), false, "a negated assistant phrase cannot create a verified pending advance");
  assert.strictEqual(state.turns["negative-u1"].completionDecision, "stay", "negated assistant completion is classified as stay");
  var calls = 0;
  var next = await begin(runtime, scope, "negative-u2", completed, "好", null, async function () {
    calls += 1;
    return { startPage: 3, endPage: 4, content: "must not load" };
  });
  assert.strictEqual(next.rangeChanged, false, "a negated assistant phrase cannot advance the next turn");
  assert.strictEqual(calls, 0);
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

async function negatedDecisionCannotAdvanceStructuredPath() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-negated-decision-"));
  var scope = scopeFor();
  seed(root, scope, { startPage: 1, endPage: 2, totalPages: 4 });
  var runtime = makeRuntime(root);
  var initial = await runtime.bootstrap(scope);
  var turn = await begin(runtime, scope, "negative-decision-u1", initial, "继续", null);
  var completed = await complete(runtime, scope, "negative-decision-u1", turn, "当前部分已经讲完，但还不能进入下一部分。", { recommendedAction: "advance" }, true);
  assert.strictEqual(completed.shouldPrefetch, false, "a negated assistant decision cannot queue an advance");
  var state = runtime._readCommitted(scope).conversations.c1;
  assert.strictEqual(state.pendingAdvance, null, "a negated assistant decision leaves pendingAdvance empty");
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

async function pausedPendingStaysUntilContinue() {
  var holdPhrases = [
    "先别继续",
    "暂停一下",
    "等一下",
    "不要跳到第10页",
    "先停在这里",
    "先不要翻页",
    "不要进入下一知识点",
    "还不能进入下一部分",
    "don't continue",
    "do not move on",
    "not yet",
    "wait",
    "pause here",
    "don't go to page 10",
  ];
  for (var i = 0; i < holdPhrases.length; i += 1) {
    var fixture = await createVerifiedPending({ conversationId: "hold" + i });
    var calls = 0;
    var paused = await begin(fixture.runtime, fixture.scope, "hold-u2", fixture.snapshot, holdPhrases[i], null, async function () {
      calls += 1;
      return { startPage: 3, endPage: 4, content: "must wait" };
    });
    assert.strictEqual(paused.rangeChanged, false, "hold phrase does not change range: " + holdPhrases[i]);
    assert.strictEqual(calls, 0, "hold phrase does not call loader: " + holdPhrases[i]);
    assert.strictEqual(Auto.pendingAdvanceVerified(fixture.runtime._readCommitted(fixture.scope).conversations[fixture.scope.conversationId].pendingAdvance), true, "hold phrase preserves verified pending: " + holdPhrases[i]);
    var pausedCompleted = await complete(fixture.runtime, fixture.scope, "hold-u2", paused, "当前部分已经讲完，但先停在这里。", null, true);
    assert.strictEqual(Auto.pendingAdvanceVerified(fixture.runtime._readCommitted(fixture.scope).conversations[fixture.scope.conversationId].pendingAdvance), true, "completing a hold turn preserves pending: " + holdPhrases[i]);
    var continued = await begin(fixture.runtime, fixture.scope, "hold-u3", pausedCompleted, "继续", null, async function (request) {
      calls += 1;
      assert.strictEqual(request.startPage, 3);
      return { startPage: 3, endPage: 4, content: "next window" };
    });
    assert.strictEqual(continued.rangeChanged, true, "explicit continuation consumes delayed pending: " + holdPhrases[i]);
    assert.strictEqual(calls, 1, "continuation advances once: " + holdPhrases[i]);
    fixture.runtime.shutdown();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }

  var questionFixture = await createVerifiedPending({ conversationId: "hold-question" });
  var questionCalls = 0;
  var questionTurn = await begin(questionFixture.runtime, questionFixture.scope, "question-u2", questionFixture.snapshot, "为什么这一步要 wait for the result?", null, async function () {
    questionCalls += 1;
    return { startPage: 3, endPage: 4, content: "next window" };
  });
  assert.strictEqual(questionTurn.rangeChanged, true, "an ordinary teaching question containing wait is not a pause command");
  assert.strictEqual(questionCalls, 1, "an ordinary teaching question may consume a valid pending advance");
  questionFixture.runtime.shutdown();
  fs.rmSync(questionFixture.root, { recursive: true, force: true });
}

async function positiveNavigation() {
  var cases = [
    { text: "下一页", startPage: 3 },
    { text: "跳到第10页", startPage: 10 },
    { text: "next page", startPage: 3 },
    { text: "go to page 10", startPage: 10 },
  ];
  for (var i = 0; i < cases.length; i += 1) {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-navigation-"));
    var scope = scopeFor("nav" + i);
    seed(root, scope, { startPage: 1, endPage: 2, totalPages: 20 });
    var runtime = makeRuntime(root);
    var initial = await runtime.bootstrap(scope);
    var calls = 0;
    var turn = await begin(runtime, scope, "nav-u1", initial, cases[i].text, null, async function (request) {
      calls += 1;
      return { startPage: request.startPage, endPage: request.startPage + 1, content: "navigated" };
    });
    assert.strictEqual(turn.rangeChanged, true, "positive navigation still advances: " + cases[i].text);
    assert.strictEqual(turn.readingRange.startPage, cases[i].startPage, "positive navigation target is preserved: " + cases[i].text);
    assert.strictEqual(calls, 1);
    runtime.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function textbookEndState() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-textbook-end-"));
  var scope = scopeFor();
  var files = seed(root, scope, { startPage: 9, endPage: 10, totalPages: 10 });
  var runtime = makeRuntime(root);
  var initial = await runtime.bootstrap(scope);
  var turn = await begin(runtime, scope, "end-u1", initial, "继续最后一页", null);
  var completed = await complete(runtime, scope, "end-u1", turn, "当前部分已经讲完，最后一页的内容已经掌握。", null, true);
  var prefetchCalls = 0;
  var terminalPrefetch = await runtime.prefetchCandidate(Object.assign({}, scope, {
    loadRange: async function () {
      prefetchCalls += 1;
      throw new Error("terminal prefetch must not call the loader");
    },
  }));
  assert.deepStrictEqual(terminalPrefetch, { skipped: true, reason: "textbook_complete" }, "known totalPages stops terminal prefetch before extraction");
  assert.strictEqual(prefetchCalls, 0, "known totalPages prevents background EOF extraction");
  var teaching = await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "end-u1",
    activeConceptId: "last-card",
    activeIndex: 1,
    newlyCompletedConceptIds: ["last-card"],
    newlyCompletedTitles: ["Last card"],
    lastTaughtPage: 10,
    loadedRange: { startPage: 9, endPage: 10 },
    windowComplete: true,
    textbookComplete: true,
  }));
  assert.strictEqual(runtime._readCommitted(scope).conversations.c1.pendingAdvance, null, "an EOF teaching marker must not create a retryable pending advance");
  var beforeEnd = runtime._readCommitted(scope).conversations.c1;
  var calls = 0;
  var afterEnd = await begin(runtime, scope, "end-u2", teaching, "好", null, async function () {
    calls += 1;
    throw new Error("EOF at 11");
  });
  assert.strictEqual(afterEnd.rangeChanged, false, "EOF completion is a normal chat turn");
  assert.deepStrictEqual([afterEnd.readingRange.startPage, afterEnd.readingRange.endPage], [9, 10], "EOF keeps the final loaded range");
  assert.strictEqual(afterEnd.readingVersion, beforeEnd.readingVersion, "EOF does not increment readingVersion");
  assert.strictEqual(afterEnd.atEndOfTextbook, true, "EOF publishes an explicit terminal state");
  assert.strictEqual(afterEnd.textbookComplete, true, "EOF publishes textbookComplete");
  assert.strictEqual(Auto.pendingAdvanceVerified(runtime._readCommitted(scope).conversations.c1.pendingAdvance), false, "EOF consumes pending advance");
  assert.strictEqual(calls, 0, "known totalPages prevents the EOF loader call");
  var projectedEnd = JSON.parse(fs.readFileSync(path.join(files.textbook, "progress_state.json"), "utf8"));
  assert.strictEqual(projectedEnd.totalPages, 10, "terminal totalPages is included in the compatibility projection");
  assert.strictEqual(projectedEnd.atEndOfTextbook, true, "terminal state is included in the compatibility projection");

  var ordinary = await complete(runtime, scope, "end-u2", afterEnd, "当前部分已经讲完；你还可以继续问最后一页的问题。", null, true);
  assert.strictEqual(runtime._readCommitted(scope).conversations.c1.pendingAdvance, null, "a completion phrase after EOF cannot create a new pending advance");
  await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "end-u2",
    activeConceptId: "last-card",
    activeIndex: 1,
    newlyCompletedConceptIds: [],
    newlyCompletedTitles: [],
    lastTaughtPage: 10,
    loadedRange: { startPage: 9, endPage: 10 },
    windowComplete: false,
    textbookComplete: false,
  }));
  var retainedTerminal = runtime._readCommitted(scope).conversations.c1;
  assert.strictEqual(retainedTerminal.textbookComplete, true, "ordinary post-EOF teaching markers cannot clear the terminal state");
  assert.strictEqual(retainedTerminal.pendingAdvance, null, "ordinary post-EOF teaching markers cannot recreate pending advance");
  var terminalReplay = await begin(runtime, scope, "end-u2", teaching, "好", null, async function () {
    throw new Error("terminal replay must not load");
  });
  assert.strictEqual(terminalReplay.replay, true, "replaying a post-EOF turn is idempotent");
  assert.strictEqual(terminalReplay.textbookComplete, true, "terminal state survives a replay response");
  var ordinary2 = await begin(runtime, scope, "end-u3", ordinary, "这个公式是什么意思？", null, async function () {
    calls += 1;
    throw new Error("terminal state must not load");
  });
  assert.strictEqual(ordinary2.rangeChanged, false);
  var ordinary3 = await complete(runtime, scope, "end-u3", ordinary2, "我来解释最后一页的公式。", null, true);
  var ordinary4 = await begin(runtime, scope, "end-u4", ordinary3, "再举一个例子", null, async function () {
    calls += 1;
    throw new Error("terminal state must not load");
  });
  assert.strictEqual(ordinary4.rangeChanged, false);
  assert.strictEqual(ordinary4.readingVersion, afterEnd.readingVersion, "later questions remain in the terminal range");
  assert.strictEqual(calls, 0, "later questions never retry EOF");
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

async function structuredEofSignal() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-structured-eof-"));
  var scope = scopeFor();
  seed(root, scope, { startPage: 9, endPage: 10 });
  var runtime = makeRuntime(root);
  var initial = await runtime.bootstrap(scope);
  var turn = await begin(runtime, scope, "signal-u1", initial, "继续", null);
  var completed = await complete(runtime, scope, "signal-u1", turn, "最后窗口已完成。", null, true);
  var teaching = await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "signal-u1",
    activeConceptId: "last-card",
    activeIndex: 1,
    newlyCompletedConceptIds: ["last-card"],
    newlyCompletedTitles: ["Last card"],
    lastTaughtPage: 10,
    loadedRange: { startPage: 9, endPage: 10 },
    windowComplete: true,
  }));
  var calls = 0;
  var terminal = await begin(runtime, scope, "signal-u2", teaching, "继续", null, async function (request) {
    calls += 1;
    assert.strictEqual(request.startPage, 11);
    return { eof: true, metadata: { numPages: 10 }, startPage: 11, endPage: 10, content: "" };
  });
  assert.strictEqual(calls, 1, "structured EOF is observed when metadata was not known at bootstrap");
  assert.strictEqual(terminal.rangeChanged, false, "structured EOF is not a range transition");
  assert.strictEqual(terminal.atEndOfTextbook, true, "structured EOF enters the terminal state");
  assert.strictEqual(terminal.readingVersion, completed.readingVersion, "structured EOF does not increment readingVersion");
  assert.deepStrictEqual([terminal.readingRange.startPage, terminal.readingRange.endPage], [9, 10], "structured EOF preserves the final range");
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

async function eofWithoutMetadataStopsSafely() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-eof-without-metadata-"));
  var scope = scopeFor();
  seed(root, scope, { startPage: 1, endPage: 2 });
  var runtime = makeRuntime(root);
  var initial = await runtime.bootstrap(scope);
  var turn = await begin(runtime, scope, "unknown-eof-u1", initial, "继续", null);
  var completed = await complete(runtime, scope, "unknown-eof-u1", turn, "窗口完成。", null, true);
  await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "unknown-eof-u1",
    activeConceptId: "current-card",
    activeIndex: 0,
    newlyCompletedConceptIds: ["current-card"],
    newlyCompletedTitles: ["Current card"],
    lastTaughtPage: 2,
    loadedRange: { startPage: 1, endPage: 2 },
    windowComplete: true,
  }));
  var calls = 0;
  var terminal = await begin(runtime, scope, "unknown-eof-u2", completed, "继续", null, async function () {
    calls += 1;
    return { eof: true, startPage: 3, endPage: 2, content: "" };
  });
  assert.strictEqual(terminal.textbookComplete, true, "an explicit EOF without page metadata still enters a terminal state");
  assert.strictEqual(terminal.totalPages, null, "missing page metadata remains explicit instead of being guessed");
  assert.strictEqual(terminal.textbookCompletionReason, "eof_metadata_missing", "missing page metadata has a diagnostic terminal reason");
  var later = await begin(runtime, scope, "unknown-eof-u3", terminal, "再问一个问题", null, async function () {
    calls += 1;
    throw new Error("unknown EOF must not be retried");
  });
  assert.strictEqual(later.rangeChanged, false, "unknown EOF keeps the final loaded range for ordinary chat");
  assert.strictEqual(calls, 1, "unknown EOF is consumed once and is not retried");
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

async function transientLoaderErrorRetainsPending() {
  var fixture = await createVerifiedPending({ conversationId: "retry" });
  var before = fixture.runtime._readCommitted(fixture.scope).conversations[fixture.scope.conversationId];
  var retryEnvelopeSnapshot = fixture.snapshot;
  var calls = 0;
  var retryInput = {
    accountId: fixture.scope.accountId,
    profileId: fixture.scope.profileId,
    worldId: fixture.scope.worldId,
    textbookId: fixture.scope.textbookId,
    conversationId: fixture.scope.conversationId,
    advanceProtocolVersion: 2,
    clientTurnId: "retry-u2",
    envelope: envelope(fixture.scope, "retry-u2", retryEnvelopeSnapshot, "继续", null),
    loadRange: async function () {
      calls += 1;
      if (calls === 1) {
        var error = new Error("OCR timed out");
        error.code = "OCR_TIMEOUT";
        throw error;
      }
      return { startPage: 3, endPage: 4, content: "recovered next window" };
    },
  };
  await assert.rejects(function () { return fixture.runtime.beginTurn(retryInput); }, function (error) {
    return error && error.code === "OCR_TIMEOUT";
  }, "transient extraction errors are not EOF");
  var afterFailure = fixture.runtime._readCommitted(fixture.scope).conversations[fixture.scope.conversationId];
  assert.deepStrictEqual(afterFailure.loadedRange, before.loadedRange, "transient failure does not commit a new range");
  assert.strictEqual(afterFailure.readingVersion, before.readingVersion, "transient failure does not increment readingVersion");
  assert.strictEqual(afterFailure.atEndOfTextbook, false, "transient failure is not interpreted as EOF");
  assert.strictEqual(Auto.pendingAdvanceVerified(afterFailure.pendingAdvance), true, "transient failure preserves pending advance");
  var recovered = await fixture.runtime.beginTurn(retryInput);
  assert.strictEqual(recovered.rangeChanged, true, "a retry can recover the pending advance");
  assert.strictEqual(calls, 2, "recovery invokes the loader exactly once after the failed attempt");
  assert.strictEqual(fixture.runtime._readCommitted(fixture.scope).conversations[fixture.scope.conversationId].readingVersion, before.readingVersion + 1, "recovery advances exactly once");
  assert.strictEqual(fixture.runtime._readCommitted(fixture.scope).conversations[fixture.scope.conversationId].pendingAdvance, null, "recovery consumes pending exactly once");
  fixture.runtime.shutdown();
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

async function legacySnapshotDefaultsAndPendingFence() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-legacy-defaults-"));
  var scope = scopeFor("legacy-defaults");
  seed(root, scope, { startPage: 1, endPage: 2 });
  var runtime = makeRuntime(root);
  var initial = await runtime.bootstrap(scope);
  assert.strictEqual(initial.atEndOfTextbook, false, "a legacy snapshot without EOF fields defaults to an open textbook");
  assert.strictEqual(initial.textbookComplete, false, "a legacy snapshot without completion fields defaults to incomplete");
  assert.strictEqual(initial.totalPages, null, "a legacy snapshot without page metadata remains diagnostically unknown");
  var turn = await begin(runtime, scope, "legacy-u1", initial, "继续", null);
  await complete(runtime, scope, "legacy-u1", turn, "普通教学回答。", null, true);
  await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "legacy-u1",
    activeConceptId: "current-card",
    activeIndex: 0,
    newlyCompletedConceptIds: ["current-card"],
    newlyCompletedTitles: ["Current card"],
    lastTaughtPage: 2,
    loadedRange: { startPage: 1, endPage: 2 },
    windowComplete: true,
    textbookComplete: false,
  }));
  var state = runtime._readCommitted(scope).conversations[scope.conversationId];
  assert.strictEqual(Auto.pendingAdvanceVerified(state.pendingAdvance, state), true, "legacy-shaped state can create an aligned pending advance");
  assert.strictEqual(Auto.pendingAdvanceVerified(Object.assign({}, state.pendingAdvance, { baseReadingVersion: state.readingVersion + 1 }), state), false, "a pending advance with a stale reading version fails closed");
  assert.strictEqual(Auto.pendingAdvanceVerified(Object.assign({}, state.pendingAdvance, { conversationId: "other" }), state), false, "a pending advance from another conversation fails closed");
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

async function pageOnlyProgressWithoutKnowledgeBase() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-advance-page-only-"));
  var scope = scopeFor("pageonly");
  var files = seed(root, scope, { startPage: 1, endPage: 2, totalPages: 4 });
  assert.strictEqual(Kb.loadQueue(files.textbook).mode, "page_only", "the fixture has no concept-card queue");
  var runtime = makeRuntime(root);
  var initial = await runtime.bootstrap(scope);
  var turn = await begin(runtime, scope, "page-u1", initial, "讲解当前窗口", null);
  await complete(runtime, scope, "page-u1", turn, "这一页讲到这里。", null, false);
  var marker = "讲到这里。<!-- kbProgress:" + JSON.stringify({
    schemaVersion: 1, textbookId: "tb", sourceConversationId: "pageonly", lastTaughtPage: 1,
  }) + " -->";
  var decision = Kb.commitAssistantProgress(files.textbook, {
    responseText: marker, textbookId: "tb", conversationId: "pageonly",
    loadedRange: { startPage: 1, endPage: 2 }, write: false,
  });
  assert.strictEqual(decision.ok, true, "a page-only marker validates without a knowledge base");
  assert.strictEqual(decision.progressMode, "page_only", "the decision travels as page-only");
  var snapshot = await runtime.commitTeachingProgress(Object.assign({}, scope, {
    clientTurnId: "page-u1",
    progressMode: decision.progressMode,
    activeConceptId: decision.activeConceptId,
    activeIndex: decision.activeIndex,
    newlyCompletedConceptIds: decision.newlyCompletedConceptIds,
    newlyCompletedTitles: decision.newlyCompletedTitles,
    lastTaughtPage: decision.lastTaughtPage,
    loadedRange: { startPage: 1, endPage: 2 },
    windowComplete: decision.windowComplete,
    textbookComplete: decision.textbookComplete,
  }));
  assert.strictEqual(snapshot.readingRange.lastTaughtPage, 1, "page-only progress reaches the prompt snapshot");
  var state = runtime._readCommitted(scope).conversations.pageonly;
  assert.strictEqual(state.lastTaughtPage, 1, "the taught page is committed into the conversation state");
  assert.strictEqual(state.pageOnlyTeachingProgress, true, "the conversation is labelled page-only");
  assert.notStrictEqual(state.structuredTeachingProgress, true, "page-only progress does not arm the C5 gate by itself");
  assert.strictEqual(state.activeConceptId, "c1", "page-only progress leaves concept state untouched");
  assert.strictEqual(state.taughtCursor.chunkId, "page-1", "the taught cursor is a page anchor, not a concept");
  assert.strictEqual(Auto.pendingAdvanceVerified(state.pendingAdvance, state), false, "stage 1 page-only progress cannot verify a pending advance");

  var second = await begin(runtime, scope, "page-u2", snapshot, "继续讲", null);
  await complete(runtime, scope, "page-u2", second, "这一页的最后一页也讲完了。", null, true);
  // Drive the second turn through the real SSE handshake so the route wiring
  // (progressMode travelling from kb-progress into commitTeachingProgress) is
  // covered, not just the direct commit.
  var endMarker = { schemaVersion: 1, textbookId: "tb", sourceConversationId: "pageonly", lastTaughtPage: 2 };
  global.__AUTO_ADVANCE__ = runtime;
  try {
    var sseResponse = new Response(
      "data: " + JSON.stringify({ type: "text", text: "讲完了。<!-- kbProgress:" + JSON.stringify(endMarker) + " -->" }) + "\n\n" +
      "data: {\"type\":\"done\"}\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
    var transformed = await Kb.transformSseResponse(sseResponse, {
      body: { textbookId: "tb", conversationId: "pageonly", profileId: "p", worldId: "w", clientTurnId: "page-u2", advanceProtocolVersion: 2 },
      paths: {
        worldDir: files.world,
        textbookDir: files.textbook,
        textbookId: "tb",
        conversationId: "pageonly",
        textbookIndex: files.index,
        worldConfig: path.join(files.world, "world.json"),
      },
      endClass: false,
      trackProgress: true,
      conversationMeta: { textbookId: "tb" },
    });
    await transformed.text();
  } finally {
    delete global.__AUTO_ADVANCE__;
  }
  var endState = runtime._readCommitted(scope).conversations.pageonly;
  assert.strictEqual(endState.lastTaughtPage, 2, "the SSE handshake carries page-only progress into the conversation state");
  assert.strictEqual(endState.windowComplete, false, "stage 1 keeps window completion disabled for page-only textbooks");
  assert.strictEqual(Auto.pendingAdvanceVerified(endState.pendingAdvance, endState), false, "no advance is triggered while stage 2 is off");
  var refreshed = await runtime.readSnapshot(scope);
  assert.strictEqual(refreshed.readingRange.lastTaughtPage, 2, "the reported page keeps advancing");
  var next = await begin(runtime, scope, "page-u3", refreshed, "继续", null, async function () {
    throw new Error("stage 1 must not advance a page-only window");
  });
  assert.strictEqual(next.rangeChanged, false, "the window stays put with stage 2 disabled");
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

async function main() {
  await intermediateWindowBoundary();
  await structuredCompletionWithoutKeyword();
  await falseStructuredCompletionBlocksNaturalLanguage();
  await negatedAssistantCompletion();
  await negatedDecisionCannotAdvanceStructuredPath();
  await pausedPendingStaysUntilContinue();
  await positiveNavigation();
  await textbookEndState();
  await structuredEofSignal();
  await transientLoaderErrorRetainsPending();
  await legacySnapshotDefaultsAndPendingFence();
  await eofWithoutMetadataStopsSafely();
  await pageOnlyProgressWithoutKnowledgeBase();
  console.log("auto-advance teaching state-machine smoke: PASS (13 scenarios)");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
