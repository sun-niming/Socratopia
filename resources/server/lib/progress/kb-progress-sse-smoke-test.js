"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var P = require("./kb-progress.js");
var R = require("../resume/progress-resume.js");

(async function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-progress-sse-"));
  var world = path.join(root, "accounts", "test", "profiles", "p", "worlds", "w");
  var textbook = path.join(world, "textbooks", "TB");
  var kb = path.join(textbook, "knowledge_base");
  fs.mkdirSync(path.join(kb, "cards"), { recursive: true });
  var cards = [
    { concept_id: "c1", title: "One", source_pages: [10, 11], definition: "one" },
    { concept_id: "c2", title: "Two", source_pages: [11, 12], definition: "two" },
    { concept_id: "c3", title: "Three", source_pages: [20, 21], definition: "three" },
    { concept_id: "c4", title: "Four", source_pages: [21, 22], definition: "four" },
  ];
  fs.writeFileSync(path.join(kb, "index.json"), JSON.stringify({ cards: cards }));
  cards.forEach(function (card) { fs.writeFileSync(path.join(kb, "cards", card.concept_id + ".json"), JSON.stringify(card)); });
  fs.writeFileSync(path.join(kb, "teaching_map.json"), JSON.stringify({ segments: [{ sequence: [{ card_ids: ["c1", "c2", "c3", "c4"] }] }] }));
  fs.writeFileSync(path.join(kb, "build_status.json"), JSON.stringify({ state: "done", activationEligible: true }));
  fs.writeFileSync(path.join(world, "textbooks", "textbook_index.json"), JSON.stringify({ textbooks: [{ id: "TB", currentPage: 10 }] }));
  R.writeState(textbook, { textbookId: "TB", activeConceptId: "c1", lastTaughtPage: 10, loadedCursor: { startPage: 10, endPage: 12 } });

  var directivePaths = {
    worldDir: world,
    textbookDir: textbook,
    textbookId: "TB",
    conversationId: "C1",
    textbookIndex: path.join(world, "textbooks", "textbook_index.json"),
    worldConfig: path.join(world, "world.json"),
  };
  var longUserContent = "继续" + "x".repeat(2000);
  var directiveBody = { textbookId: "TB", conversationId: "C1", messages: [{ role: "user", content: longUserContent }] };
  var injectedRequest = P.requestWithProgressDirective(
    new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(directiveBody) }),
    directiveBody,
    directivePaths,
  );
  var injectedBody = await injectedRequest.json();
  assert.strictEqual(injectedBody.messages.length, 2, "directive is carried in a separate internal message");
  assert.strictEqual(injectedBody.messages[0].role, "system", "internal directive is not appended to trimmable user content");
  assert.strictEqual(injectedBody.messages[1].role, "user", "original user message remains last");
  assert.strictEqual(injectedBody.messages[1].content, longUserContent, "long user content is not rewritten by directive injection");
  assert.ok(injectedBody.messages[0].content.indexOf("kbProgress:") >= 0, "directive contains hidden kbProgress protocol");
  assert.ok(injectedBody.messages[0].content.indexOf('"sourceConversationId":"C1"') >= 0, "directive binds conversation");
  assert.ok(injectedBody.messages[0].content.length < 1500, "internal directive survives the chat route per-message limit");

  function event(obj) { return "data: " + JSON.stringify(obj) + "\n\n"; }
  var markerJson = '{"schemaVersion":1,"textbookId":"TB","sourceConversationId":"C1","activeConceptId":"c2","newlyCompletedConceptIds":["c1"],"lastTaughtPage":11}';
  var original = new Response(
    event({ type: "reading_range", startPage: 10, endPage: 12, loadedStartPage: 10, loadedEndPage: 12 }) +
    event({ type: "text", text: "Answer<!-- kbPro" }) +
    event({ type: "text", text: "gress:" + markerJson + " -->" }) +
    event({ type: "done" }),
    { headers: { "Content-Type": "text/event-stream" } }
  );
  var wrapped = P.transformSseResponse(original, {
    body: { textbookId: "TB", conversationId: "C1", profileId: "p", worldId: "w" },
    paths: {
      worldDir: world,
      textbookDir: textbook,
      textbookId: "TB",
      conversationId: "C1",
      textbookIndex: path.join(world, "textbooks", "textbook_index.json"),
      worldConfig: path.join(world, "world.json"),
    },
    endClass: false,
    conversationMeta: { textbookId: "TB" },
  });
  var text = await wrapped.text();
  assert.ok(text.includes('"text":"Answer"'), "visible answer is preserved");
  assert.ok(!text.includes("kbProgress"), "hidden marker never reaches SSE client");
  assert.ok(text.indexOf('"type":"done"') > text.indexOf('"text":"Answer"'), "done remains last");
  var state = R.readState(textbook);
  assert.strictEqual(state.activeConceptId, "c2", "SSE completion commits the next active concept");
  assert.deepStrictEqual(state.completedConceptIds, ["c1"], "SSE completion commits contiguous completion");
  assert.strictEqual(state.lastTaughtPage, 11, "SSE completion commits actual page");
  assert.deepStrictEqual([state.loadedCursor.startPage, state.loadedCursor.endPage], [10, 12], "accepted marker persists the authoritative loaded window");
  var index = JSON.parse(fs.readFileSync(path.join(world, "textbooks", "textbook_index.json"), "utf-8"));
  assert.strictEqual(index.textbooks[0].currentPage, 11, "textbook index syncs validated taught page");

  R.replaceState(textbook, { textbookId: "TB", sourceConversationId: "C1", activeConceptId: "c1", completedConceptIds: [], completedTitles: [], lastTaughtPage: 10, currentPage: 10, loadedCursor: { startPage: 10, endPage: 12 } });
  var authoritativeCalls = [];
  global.__AUTO_ADVANCE__ = {
    version: 2,
    commitTeachingProgress: async function (input) { authoritativeCalls.push(input); return { ok: true }; }
  };
  var v2Response = new Response(
    event({ type: "reading_range", startPage: 10, endPage: 12, loadedStartPage: 10, loadedEndPage: 12 }) +
    event({ type: "text", text: "V2 answer<!-- kbProgress:" + markerJson + " -->" }) +
    event({ type: "done" }),
    { headers: { "Content-Type": "text/event-stream" } }
  );
  await P.transformSseResponse(v2Response, {
    body: { textbookId: "TB", conversationId: "C1", profileId: "p", worldId: "w", clientTurnId: "v2-turn", advanceProtocolVersion: 2 },
    paths: directivePaths,
    endClass: false,
    trackProgress: true,
    conversationMeta: { textbookId: "TB" },
  }).text();
  delete global.__AUTO_ADVANCE__;
  assert.strictEqual(authoritativeCalls.length, 1, "v2 SSE completion delegates teaching progress to the authoritative runtime");
  assert.strictEqual(authoritativeCalls[0].clientTurnId, "v2-turn", "authoritative progress is fenced to the completed client turn");
  assert.strictEqual(authoritativeCalls[0].activeConceptId, "c2", "validated active concept is forwarded to the authoritative runtime");
  assert.deepStrictEqual(authoritativeCalls[0].newlyCompletedConceptIds, ["c1"], "validated completions are forwarded to the authoritative runtime");
  assert.strictEqual(authoritativeCalls[0].windowComplete, false, "an unfinished validated window is forwarded as non-advancing");
  assert.strictEqual(R.readState(textbook).activeConceptId, "c1", "v2 bridge does not directly mutate the legacy progress state");

  R.replaceState(textbook, { textbookId: "TB", sourceConversationId: "C2", activeConceptId: "c3", completedConceptIds: [], completedTitles: [], lastTaughtPage: 20, currentPage: 20, loadedCursor: { startPage: 20, endPage: 22 } });
  var refreshedCalls = [];
  global.__AUTO_ADVANCE__ = {
    version: 2,
    readSnapshot: async function () { return { readingRange: { startPage: 20, endPage: 22 } }; },
    commitTeachingProgress: async function (input) { refreshedCalls.push(input); return { ok: true }; },
  };
  var refreshedMarker = { schemaVersion: 1, textbookId: "TB", sourceConversationId: "C2", activeConceptId: "c4", newlyCompletedConceptIds: ["c3"], lastTaughtPage: 21 };
  await P.transformSseResponse(new Response(
    event({ type: "text", text: "Fresh window<!-- kbProgress:" + JSON.stringify(refreshedMarker) + " -->" }) + event({ type: "done" }),
    { headers: { "Content-Type": "text/event-stream" } },
  ), {
    body: { textbookId: "TB", conversationId: "C2", profileId: "p", worldId: "w", clientTurnId: "refresh-turn", advanceProtocolVersion: 2 },
    paths: Object.assign({}, directivePaths, { conversationId: "C2" }),
    endClass: false,
    trackProgress: true,
    conversationMeta: { textbookId: "TB" },
    progressContext: { loadedRange: { startPage: 10, endPage: 12 }, activeConceptId: "c2" },
  }).text();
  delete global.__AUTO_ADVANCE__;
  assert.strictEqual(refreshedCalls.length, 1, "v2 progress refresh accepts a marker from the range committed earlier in the same request");
  assert.deepStrictEqual([refreshedCalls[0].loadedRange.startPage, refreshedCalls[0].loadedRange.endPage], [20, 22], "v2 progress uses the authoritative post-begin range instead of the stale wrapper context");

  var currentReadingDir = path.join(world, "conversations", "C2");
  fs.mkdirSync(currentReadingDir, { recursive: true });
  fs.writeFileSync(path.join(currentReadingDir, "current_reading.md"), "<!-- startPage: 20 endPage: 22 -->\nnew lesson window");
  var stalePaths = Object.assign({}, directivePaths, { conversationId: "C2" });
  var staleBody = { textbookId: "TB", conversationId: "C2", profileId: "p", worldId: "w", messages: [{ role: "user", content: "我先说我的判断：Three 的连接过程是先建立连接，再传输数据。" }] };
  var firstPrepared = P.prepareProgressContext(stalePaths);
  assert.strictEqual(firstPrepared.loadedRange.source, "conversation_current_reading", "conversation current_reading is authoritative over stale textbook state");
  assert.strictEqual(firstPrepared.activeConceptId, "c3", "old-conversation active concept rebases to the first card in the current window");
  var rebasedState = R.readState(textbook);
  assert.strictEqual(rebasedState.sourceConversationId, "C2", "rebased state binds the current conversation");
  assert.deepStrictEqual([rebasedState.loadedCursor.startPage, rebasedState.loadedCursor.endPage], [20, 22], "rebased state persists the current conversation window");
  var staleRequest = P.requestWithProgressDirective(
    new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(staleBody) }),
    staleBody,
    stalePaths,
    firstPrepared,
  );
  var staleInjected = await staleRequest.json();
  assert.ok(staleInjected.messages[0].content.includes('"activeConceptId":"c3"'), "new lesson directive never repeats the stale active concept");

  async function rejectedCheckTurn(prepared, markerOverride, replyText, bodyOverride) {
    var invalidMarker = markerOverride || '{"schemaVersion":1,"textbookId":"TB","sourceConversationId":"C2","activeConceptId":"c1","newlyCompletedConceptIds":[],"lastTaughtPage":20}';
    var response = new Response(
      event({ type: "reading_range", startPage: 20, endPage: 22, loadedStartPage: 20, loadedEndPage: 22 }) +
      event({ type: "text", text: (replyText || "那么 Three 的连接过程分几步？") + "<!-- kbProgress:" + invalidMarker + " -->" }) +
      event({ type: "done" }),
      { headers: { "Content-Type": "text/event-stream" } }
    );
    await P.transformSseResponse(response, {
      body: bodyOverride || staleBody,
      paths: stalePaths,
      endClass: false,
      trackProgress: true,
      conversationMeta: { textbookId: "TB" },
      progressContext: prepared,
    }).text();
  }

  await rejectedCheckTurn(firstPrepared);
  assert.strictEqual(R.readState(textbook).activeConceptCheckCount, 1, "a concept-bound question answered by the learner counts as one check");
  await rejectedCheckTurn(firstPrepared, null, "这个概念还有别的说法吗？");
  assert.strictEqual(R.readState(textbook).activeConceptCheckCount, 1, "a trailing question mark alone never increments the check counter");
  await rejectedCheckTurn(firstPrepared, null, "那么 Three 的连接过程分几步？", {
    textbookId: "TB", conversationId: "C2", profileId: "p", worldId: "w", messages: [{ role: "user", content: "继续" }],
  });
  assert.strictEqual(R.readState(textbook).activeConceptCheckCount, 1, "a short ack is not a valid answer and cannot reach the two-check cap");
  var secondPrepared = P.prepareProgressContext(stalePaths);
  await rejectedCheckTurn(secondPrepared);
  assert.strictEqual(R.readState(textbook).activeConceptCheckCount, 2, "second rejected check reaches the hard cap");
  R.writeState(textbook, { lastTaughtPage: 21, currentPage: 21 });
  var forcedPrepared = P.prepareProgressContext(stalePaths);
  assert.strictEqual(forcedPrepared.activeConceptId, "c4", "third turn deterministically advances to the adjacent card");
  assert.strictEqual(forcedPrepared.forcedFrom.conceptId, "c3", "forced advance records which repeated concept was closed");
  var forcedRequest = P.requestWithProgressDirective(
    new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(staleBody) }),
    staleBody,
    stalePaths,
    forcedPrepared,
  );
  var forcedInjected = await forcedRequest.json();
  assert.ok(forcedInjected.messages[0].content.includes("TWO_CHECK_LIMIT_REACHED"), "third-turn directive requires summary then advancement");
  assert.ok(forcedInjected.messages[0].content.includes('"activeConceptId":"c4"'), "third-turn marker is anchored to the adjacent card");
  assert.ok(forcedInjected.messages[0].content.includes('"newlyCompletedConceptIds":["c3"]'), "third-turn marker must close the capped concept");
  assert.strictEqual(R.readState(textbook).activeConceptId, "c3", "forced advance remains pending until a successful assistant response");
  var crossTextbookMarker = '{"schemaVersion":1,"textbookId":"OTHER","sourceConversationId":"C2","activeConceptId":"c4","newlyCompletedConceptIds":["c3"],"lastTaughtPage":21}';
  await rejectedCheckTurn(forcedPrepared, crossTextbookMarker);
  var unsafeState = R.readState(textbook);
  assert.strictEqual(unsafeState.activeConceptId, "c3", "cross-textbook marker cannot trigger forced recovery");
  assert.strictEqual(unsafeState.activeConceptCheckCount, 2, "unsafe rejection preserves the hard-cap state for retry");
  assert.ok(!unsafeState.completedConceptIds.includes("c3"), "cross-textbook marker produces zero completion writes");
  var recoveryPrepared = P.prepareProgressContext(stalePaths);
  await rejectedCheckTurn(recoveryPrepared);
  assert.strictEqual(R.readState(textbook).activeConceptId, "c4", "successful third response advances even when the weak model repeats an invalid marker");
  assert.ok(R.readState(textbook).completedConceptIds.includes("c3"), "forced cap closes the repeated card exactly once");
  assert.strictEqual(R.readState(textbook).activeConceptCheckCount, 0, "a repeated old-card question is not charged to the newly active card");
  assert.strictEqual(R.readState(textbook).lastTaughtPage, 21, "forced recovery never moves the taught page backward");

  fs.rmSync(root, { recursive: true, force: true });
  console.log("kb progress SSE smoke: PASS");
})().catch(function (error) {
  console.error(error && error.stack || error);
  process.exit(1);
});
