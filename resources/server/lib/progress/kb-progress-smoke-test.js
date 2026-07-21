"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var P = require("./kb-progress.js");
var R = require("../resume/progress-resume.js");

var marker = '<!-- kbProgress:{"schemaVersion":1,"textbookId":"TB","sourceConversationId":"C1","activeConceptId":"c2","newlyCompletedConceptIds":["c1"],"lastTaughtPage":11} -->';
assert.strictEqual(P.parseProgressMarker("answer\n" + marker).activeConceptId, "c2", "marker parses");
assert.strictEqual(P.stripProgressMarkers("answer\n" + marker), "answer", "marker strips from full text");

var stripper = P.createStreamStripper();
var pieces = ["ans<!-- kbPro", "gress:{\"textbookId\":\"TB\"}", " -->wer<!-- mdPro", "gress: {\"status\":\"complete\"} -->!"];
var visible = pieces.map(function (piece) { return stripper.push(piece); }).join("") + stripper.flush();
assert.strictEqual(visible, "answer!", "both hidden markers strip across stream boundaries");
var spacedStripper = P.createStreamStripper();
var spacedPieces = ["answer<!--  kbPro", "gress :{\"textbookId\":\"TB\"}", " -->!"];
var spacedVisible = spacedPieces.map(function (piece) { return spacedStripper.push(piece); }).join("") + spacedStripper.flush();
assert.strictEqual(spacedVisible, "answer!", "parser-compatible marker whitespace strips across stream boundaries");
var splitCloseStripper = P.createStreamStripper();
var splitClosePieces = ["answer<!-- kbProgress:{\"textbookId\":\"TB\"} --", ">after"];
var splitCloseVisible = splitClosePieces.map(function (piece) { return splitCloseStripper.push(piece); }).join("") + splitCloseStripper.flush();
assert.strictEqual(splitCloseVisible, "answerafter", "marker closing delimiter strips safely across stream boundaries");

var queue = [
  { cardId: "c1", conceptId: "c1", title: "One", sourcePages: [10, 11] },
  { cardId: "c2", conceptId: "c2", title: "Two", sourcePages: [11, 12] },
  { cardId: "c3", conceptId: "c3", title: "Three", sourcePages: [12, 13] },
  { cardId: "c4", conceptId: "c4", title: "Four", sourcePages: [13, 14] },
];
var base = { queue: queue, state: { activeConceptId: "c1" }, textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 } };
var accepted = P.validateProgressMarker(P.parseProgressMarker(marker), base);
assert.strictEqual(accepted.ok, true, "contiguous current-card completion is accepted");
assert.strictEqual(accepted.activeConceptId, "c2", "cursor advances to immediate next card");

var skip = P.validateProgressMarker({ textbookId: "TB", sourceConversationId: "C1", activeConceptId: "c3", newlyCompletedConceptIds: ["c1"], lastTaughtPage: 11 }, base);
assert.strictEqual(skip.ok, false, "skipping c2 is rejected");
assert.strictEqual(skip.reason, "non_contiguous_active_concept");
var reversed = P.validateProgressMarker({ textbookId: "TB", sourceConversationId: "C1", activeConceptId: "c2", newlyCompletedConceptIds: ["c2"], lastTaughtPage: 11 }, base);
assert.strictEqual(reversed.ok, false, "completing unseen c2 before c1 is rejected");
assert.strictEqual(reversed.reason, "non_contiguous_completion");
var outside = P.validateProgressMarker({ textbookId: "TB", sourceConversationId: "C1", activeConceptId: "c1", newlyCompletedConceptIds: [], lastTaughtPage: 99 }, base);
assert.strictEqual(outside.reason, "taught_page_outside_loaded_range", "page outside loaded range is rejected");
var wrongBook = P.validateProgressMarker({ textbookId: "OTHER", activeConceptId: "c1", newlyCompletedConceptIds: [], lastTaughtPage: 10 }, base);
assert.strictEqual(wrongBook.reason, "textbook_mismatch", "cross-textbook marker is rejected");
var missingConversation = P.validateProgressMarker({ textbookId: "TB", activeConceptId: "c1", newlyCompletedConceptIds: [], lastTaughtPage: 10 }, base);
assert.strictEqual(missingConversation.reason, "conversation_mismatch", "marker without sourceConversationId is rejected");
var tooFast = P.validateProgressMarker({ textbookId: "TB", sourceConversationId: "C1", activeConceptId: "c4", newlyCompletedConceptIds: ["c1", "c2", "c3", "c4"], lastTaughtPage: 14 }, base);
assert.strictEqual(tooFast.reason, "pace_limit_exceeded", "more than three completed cards in one turn is rejected");
var jumpedWindowQueue = [
  { cardId: "old", conceptId: "old", title: "Old", sourcePages: [1, 1] },
  { cardId: "new", conceptId: "new", title: "New", sourcePages: [20, 20] },
];
assert.strictEqual(P.initialQueueIndex(jumpedWindowQueue, { activeConceptId: "old", lastTaughtPage: 1 }, { startPage: 20, endPage: 20 }), 1,
  "an active concept outside the loaded window falls back to the loaded card");
var staleActive = P.validateProgressMarker({
  textbookId: "TB", sourceConversationId: "C1", activeConceptId: "old", newlyCompletedConceptIds: [], lastTaughtPage: 20,
}, { queue: jumpedWindowQueue, state: { activeConceptId: "old", lastTaughtPage: 1 }, textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 20, endPage: 20 } });
assert.strictEqual(staleActive.reason, "non_contiguous_active_concept", "a stale active concept cannot be paired with a new loaded page window");

assert.strictEqual(P.validateTextbookBinding("TB", "TB", { textbookId: "TB" }).ok, true, "matching binding passes");
assert.strictEqual(P.validateTextbookBinding("TB", "TB", { textbookId: "OTHER" }).code, "TEXTBOOK_CONTEXT_MISMATCH", "conversation mismatch blocks writes");

var oldProgress = "# 当前页码：第 8 页\n\n---\n\n## 2026-07-01 | A\np.1-8 | Old\nOld material.\n\n---\n\n## 2026-06-30 | A\np.1-4 | Older\nOlder material.\n";
var polluted = "# 当前页码：第 999 页\n\n## 2026-07-18 | B\np.500-999 | 操作系统\n本节实际学习模块导入。\n\n## 2020-01-01 | X\np.1-999 | copied history\nshould disappear";
var merged = P.mergeProgressMd(oldProgress, polluted, { startPage: 61, endPage: 64, currentPage: 64, date: "2026-07-18", companionName: "B", title: "C++ 模块", lang: "chinese" });
assert.ok(merged.startsWith("# 当前页码：第 64 页"), "backend owns current-page header");
assert.ok(merged.includes("p.61-64 | C++ 模块"), "backend owns session range");
assert.ok(merged.includes("本节实际学习模块导入。"), "current session body is retained");
assert.ok(!merged.includes("操作系统"), "model-supplied title is discarded");
assert.ok(!merged.includes("copied history"), "model-supplied history is discarded");
assert.ok(merged.includes("Old material."), "existing legitimate history is preserved");
assert.ok(!/\n---\s*\n\s*---\n/.test(merged), "existing separators are normalized instead of duplicated");
var firstSameDay = P.mergeProgressMd("", "First class", { startPage: 10, endPage: 11, currentPage: 11, date: "2026-07-18", companionName: "B", title: "First", sessionId: "C1" });
var secondSameDay = P.mergeProgressMd(firstSameDay, "Second class", { startPage: 12, endPage: 13, currentPage: 13, date: "2026-07-18", companionName: "B", title: "Second", sessionId: "C2" });
assert.ok(secondSameDay.includes("First class") && secondSameDay.includes("Second class"), "same companion can retain two sessions on one date");
var retriedSameSession = P.mergeProgressMd(secondSameDay, "Second class updated", { startPage: 12, endPage: 13, currentPage: 13, date: "2026-07-18", companionName: "B", title: "Second", sessionId: "C2" });
assert.strictEqual((retriedSameSession.match(/sourceConversationId:C2/g) || []).length, 1, "retry replaces only the same conversation entry");
assert.strictEqual(P.localDateString(new Date(2026, 0, 2, 1, 0, 0)), "2026-01-02", "progress date uses local calendar fields");
assert.strictEqual(P.isEndClassRequest({ messages: [{ content: "[下课] 请执行课后更新" }] }), true, "end-class suffix remains guarded");
assert.strictEqual(P.shouldTrackTeachingProgress({ autoReply: true }, false), false, "auto reply cannot submit teaching progress");
assert.strictEqual(P.shouldTrackTeachingProgress({ nuwaMode: true }, false), false, "Nuwa mode cannot submit teaching progress");
var serverSource = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf-8");
assert.strictEqual(serverSource.includes("conversationId: resumeState && resumeState.sourceConversationId"), false, "prebuilt KB prompt does not embed the previous conversation id");

var root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-progress-"));
fs.writeFileSync(path.join(root, "world_meta.json"), JSON.stringify({
  companions: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "青衣" }]
}));
assert.strictEqual(P.companionName({
  worldDir: root,
  worldConfig: path.join(root, "world.json"),
}, { character: "npc_d" }), "青衣", "world_meta companion name replaces internal npc slot id");
var kb = path.join(root, "knowledge_base");
fs.mkdirSync(path.join(kb, "cards"), { recursive: true });
fs.writeFileSync(path.join(kb, "index.json"), JSON.stringify({ cards: queue.map(function (entry) { return { concept_id: entry.conceptId, title: entry.title, source_pages: entry.sourcePages }; }) }));
queue.forEach(function (entry) {
  fs.writeFileSync(path.join(kb, "cards", entry.conceptId + ".json"), JSON.stringify({ concept_id: entry.conceptId, title: entry.title, source_pages: entry.sourcePages, definition: entry.title }));
});
fs.writeFileSync(path.join(kb, "teaching_map.json"), JSON.stringify({ segments: [{ sequence: [{ card_ids: ["c1", "c2", "c3", "c4"] }] }] }));
fs.writeFileSync(path.join(kb, "build_status.json"), JSON.stringify({ state: "partial", activationEligible: false }));
assert.deepStrictEqual(P.loadQueue(root).queue, [], "partial KB is unavailable to the progress protocol");
fs.writeFileSync(path.join(kb, "build_status.json"), JSON.stringify({ state: "done", activationEligible: true }));
assert.strictEqual(P.loadQueue(root).queue.length, 4, "healthy KB remains available to the progress protocol");
R.writeState(root, { textbookId: "TB", activeConceptId: "c1", lastTaughtPage: 10, loadedCursor: { startPage: 10, endPage: 14 } });
var committed = P.commitAssistantProgress(root, { responseText: marker, textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 } });
assert.strictEqual(committed.ok, true, "valid marker commits structured state");
var state = R.readState(root);
assert.strictEqual(state.schemaVersion, 3, "committed state uses schema v3");
assert.strictEqual(state.activeConceptId, "c2", "active concept persists");
assert.deepStrictEqual(state.completedConceptIds, ["c1"], "completed concept persists");
assert.strictEqual(state.lastTaughtPage, 11, "actual taught page persists");
var before = JSON.stringify(state);
var missing = P.commitAssistantProgress(root, { responseText: "no marker", textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 } });
assert.strictEqual(missing.unchanged, true, "missing marker is a no-op");
assert.strictEqual(JSON.stringify(R.readState(root)), before, "missing marker does not mutate state");

fs.rmSync(root, { recursive: true, force: true });
console.log("kb progress smoke: PASS");
