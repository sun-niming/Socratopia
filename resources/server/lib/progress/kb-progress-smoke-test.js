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
assert.strictEqual(accepted.windowComplete, false, "an intermediate card cannot complete the loaded window");
var finalCard = P.validateProgressMarker({ textbookId: "TB", sourceConversationId: "C1", activeConceptId: "c4", newlyCompletedConceptIds: ["c4"], lastTaughtPage: 14 }, {
  queue: queue, state: { activeConceptId: "c4", completedConceptIds: ["c1", "c2", "c3"] }, textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 }
});
assert.strictEqual(finalCard.ok, true, "the final loaded card can be completed");
assert.strictEqual(finalCard.windowComplete, true, "completing the final loaded card completes the window");
assert.strictEqual(finalCard.textbookComplete, true, "completing the final global card reports textbook completion");
var middleWindowQueue = [
  { cardId: "m1", conceptId: "m1", title: "Middle one", sourcePages: [10, 10] },
  { cardId: "m2", conceptId: "m2", title: "Middle two", sourcePages: [20, 20] },
];
var middleWindowState = P.validateProgressMarker({
  textbookId: "TB", sourceConversationId: "C1", activeConceptId: "m2", newlyCompletedConceptIds: ["m1"], lastTaughtPage: 10,
}, {
  queue: middleWindowQueue, state: { activeConceptId: "m1" }, textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 10 },
});
assert.strictEqual(middleWindowState.ok, true, "a window-tail card can complete before the next card is loaded");
assert.strictEqual(middleWindowState.activeConceptId, "m1", "the unloaded next card is not written as the active concept");
assert.strictEqual(middleWindowState.nextConceptId, "m2", "the next unloaded card is serialized as a deferred target");
assert.strictEqual(middleWindowState.windowComplete, true, "window-tail completion is explicit");

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
assert.strictEqual(P.isRecoverableForcedReason("non_contiguous_active_concept"), true, "stale active marker can use the two-check recovery path");
assert.strictEqual(P.isRecoverableForcedReason("missing_marker"), true, "missing weak-model marker can use the two-check recovery path");
assert.strictEqual(P.isRecoverableForcedReason("textbook_mismatch"), false, "cross-textbook marker can never use forced recovery");
assert.strictEqual(P.isRecoverableForcedReason("conversation_mismatch"), false, "cross-conversation marker can never use forced recovery");
assert.strictEqual(P.isRecoverableForcedReason("taught_page_outside_loaded_range"), false, "out-of-window page can never use forced recovery");
assert.strictEqual(P.isRecoverableForcedMarker("non_contiguous_active_concept", {
  textbookId: "TB", sourceConversationId: "C1", lastTaughtPage: 11,
}, { textbookId: "TB", conversationId: "C1" }, { startPage: 10, endPage: 14 }), true, "safe stale-active marker can recover at the hard cap");
assert.strictEqual(P.isRecoverableForcedMarker("non_contiguous_active_concept", {
  textbookId: "TB", sourceConversationId: "C1", lastTaughtPage: 99,
}, { textbookId: "TB", conversationId: "C1" }, { startPage: 10, endPage: 14 }), false, "stale-active marker with an out-of-window page cannot recover");
assert.strictEqual(P.isRecoverableForcedMarker("non_contiguous_active_concept", {
  textbookId: "OTHER", sourceConversationId: "C1", lastTaughtPage: 11,
}, { textbookId: "TB", conversationId: "C1" }, { startPage: 10, endPage: 14 }), false, "stale-active marker with a foreign textbook cannot recover");
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
assert.strictEqual(P.loadQueue(root).mode, "page_only", "an unfinished KB build degrades to page-level progress");
fs.writeFileSync(path.join(kb, "build_status.json"), JSON.stringify({ state: "done", activationEligible: true }));
assert.strictEqual(P.loadQueue(root).queue.length, 4, "healthy KB remains available to the progress protocol");
assert.strictEqual(P.loadQueue(root).mode, "kb", "a built queue reports concept mode");
R.writeState(root, { textbookId: "TB", activeConceptId: "c1", lastTaughtPage: 10, loadedCursor: { startPage: 10, endPage: 14 } });
var validatedOnly = P.commitAssistantProgress(root, { responseText: marker, textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 }, write: false });
assert.strictEqual(validatedOnly.ok, true, "valid marker can be validated for an authoritative commit");
assert.strictEqual(R.readState(root).activeConceptId, "c1", "validation-only mode does not mutate legacy state");
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

// C3 stage 1: textbooks without a concept-card queue keep page-level position.
var bare = fs.mkdtempSync(path.join(os.tmpdir(), "kb-progress-page-only-"));
assert.strictEqual(P.loadQueue(bare).mode, "page_only", "a textbook without knowledge_base/ is page-only");
var pageMarker = { schemaVersion: 1, textbookId: "TB", sourceConversationId: "C1", lastTaughtPage: 12 };
assert.strictEqual(P.validateProgressMarker(pageMarker, {
  queue: [], textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 },
}).reason, "empty_queue", "a queue-less marker is still rejected when no mode is supplied");
var pageDecision = P.validateProgressMarker(pageMarker, {
  queue: [], mode: "page_only", state: { sourceConversationId: "C1", lastTaughtPage: 11 },
  textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 },
});
assert.strictEqual(pageDecision.ok, true, "page-only mode accepts a page inside the loaded window");
assert.strictEqual(pageDecision.progressMode, "page_only", "the decision is labelled page-only");
assert.strictEqual(pageDecision.activeConceptId, null, "page-only progress never invents a concept id");
assert.strictEqual(pageDecision.windowComplete, false, "stage 1 never reports window completion");
assert.strictEqual(pageDecision.lastTaughtPage, 12, "the reported page is carried through");
var regressed = P.validatePageMarker({ textbookId: "TB", sourceConversationId: "C1", lastTaughtPage: 10 }, {
  state: { sourceConversationId: "C1", lastTaughtPage: 12 },
  textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 },
});
assert.strictEqual(regressed.reason, "taught_page_regressed", "position may not walk backwards inside one window");
var movedBack = P.validatePageMarker({ textbookId: "TB", sourceConversationId: "C1", lastTaughtPage: 10 }, {
  state: { sourceConversationId: "C1", lastTaughtPage: 12 },
  textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 8, endPage: 14 },
});
assert.strictEqual(movedBack.ok, false, "a moved window still rejects a page behind the old reported position in the same range");
var jumpWindow = P.validatePageMarker({ textbookId: "TB", sourceConversationId: "C1", lastTaughtPage: 10 }, {
  state: { sourceConversationId: "C1", lastTaughtPage: 40 },
  textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 8, endPage: 14 },
});
assert.strictEqual(jumpWindow.ok, true, "a jump window resets the regression guard");
var staleConcept = P.validatePageMarker({ textbookId: "TB", sourceConversationId: "C1", lastTaughtPage: 12, activeConceptId: "ghost-card" }, {
  state: {}, textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 },
});
assert.strictEqual(staleConcept.ok, true, "leftover concept fields are ignored, not rejected");
var outOfWindow = P.validatePageMarker({ textbookId: "TB", sourceConversationId: "C1", lastTaughtPage: 99 }, {
  state: {}, textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 },
});
assert.strictEqual(outOfWindow.reason, "taught_page_outside_loaded_range", "pages outside the loaded window stay invalid");
var stageTwo = P.validatePageMarker({ textbookId: "TB", sourceConversationId: "C1", lastTaughtPage: 14 }, {
  state: {}, textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 }, allowWindowComplete: true,
});
assert.strictEqual(stageTwo.windowComplete, true, "stage 2 accepts window completion at the last loaded page");
var partialWindow = P.validatePageMarker({ textbookId: "TB", sourceConversationId: "C1", lastTaughtPage: 13 }, {
  state: {}, textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 }, allowWindowComplete: true,
});
assert.strictEqual(partialWindow.windowComplete, false, "stage 2 still requires reaching the last loaded page");
var pageCommitted = P.commitAssistantProgress(bare, {
  responseText: "讲完了这一页。<!-- kbProgress:" + JSON.stringify(pageMarker) + " -->",
  textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 },
});
assert.strictEqual(pageCommitted.ok, true, "page-only progress commits without a knowledge base");
assert.strictEqual(pageCommitted.progressMode, "page_only", "the commit is labelled page-only");
var bareState = R.readState(bare);
assert.strictEqual(bareState.lastTaughtPage, 12, "page-only progress persists the taught page");
assert.strictEqual(bareState.currentPage, 12, "page-only progress mirrors the legacy current page");
assert.strictEqual(bareState.windowComplete, false, "page-only state never claims window completion in stage 1");
assert.strictEqual(bareState.progressMode, "page_only", "page-only state is labelled for downstream readers");
assert.ok(!bareState.activeConceptId, "page-only commits do not write a concept id");
var validatedPage = P.commitAssistantProgress(bare, {
  responseText: "讲完了这一页。<!-- kbProgress:" + JSON.stringify(pageMarker) + " -->",
  textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 }, write: false,
});
assert.strictEqual(validatedPage.ok, true, "page-only markers validate for the authoritative commit path");
assert.strictEqual(validatedPage.validatedOnly, true, "validation-only page markers do not write state");
var pageDirective = P.markerDirective({ progressMode: "page_only", textbookId: "TB", conversationId: "C1" });
assert.ok(pageDirective.indexOf('"lastTaughtPage":ACTUAL_PAGE_NUMBER') >= 0, "the page-only directive asks for an actual page");
assert.ok(pageDirective.indexOf('"windowComplete":true|false') >= 0, "the page-only directive names the completion flag");
assert.strictEqual(pageDirective.indexOf("activeConceptId"), -1, "the page-only directive never mentions concept ids");
assert.ok(P.markerDirective({ textbookId: "TB", conversationId: "C1", activeConceptId: "c1" }).indexOf("activeConceptId") >= 0, "the concept directive is unchanged for knowledge-base textbooks");
var brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-progress-broken-"));
fs.mkdirSync(path.join(brokenDir, "knowledge_base"), { recursive: true });
fs.writeFileSync(path.join(brokenDir, "knowledge_base", "build_status.json"), JSON.stringify({ state: "done", activationEligible: true }));
assert.strictEqual(P.loadQueue(brokenDir).mode, "kb_broken", "a done build without index data is kb_broken, not page-only");
assert.strictEqual(P.validateProgressMarker(pageMarker, {
  queue: [], mode: "kb_broken", textbookId: "TB", conversationId: "C1", loadedRange: { startPage: 10, endPage: 14 },
}).reason, "empty_queue", "broken KB data keeps rejecting markers loudly");
fs.rmSync(bare, { recursive: true, force: true });
fs.rmSync(brokenDir, { recursive: true, force: true });
console.log("kb progress smoke: PASS");
