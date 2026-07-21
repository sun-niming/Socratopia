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
  ];
  fs.writeFileSync(path.join(kb, "index.json"), JSON.stringify({ cards: cards }));
  cards.forEach(function (card) { fs.writeFileSync(path.join(kb, "cards", card.concept_id + ".json"), JSON.stringify(card)); });
  fs.writeFileSync(path.join(kb, "teaching_map.json"), JSON.stringify({ segments: [{ sequence: [{ card_ids: ["c1", "c2"] }] }] }));
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
  var index = JSON.parse(fs.readFileSync(path.join(world, "textbooks", "textbook_index.json"), "utf-8"));
  assert.strictEqual(index.textbooks[0].currentPage, 11, "textbook index syncs validated taught page");

  fs.rmSync(root, { recursive: true, force: true });
  console.log("kb progress SSE smoke: PASS");
})().catch(function (error) {
  console.error(error && error.stack || error);
  process.exit(1);
});
