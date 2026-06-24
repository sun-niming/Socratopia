#!/usr/bin/env node
/**
 * Smoke test for the practice source adapter.
 * Run:  node resources/server/lib/practice/source-adapter-smoke-test.js
 *
 * Sets a temporary PROJECT_ROOT, seeds the on-disk layout the real routes write
 * (textbook pages, chapter files, concept-summary, lesson-summary, chat history),
 * exercises every sourceType + ConceptGraph context, and verifies path safety.
 * Zero external deps (no LLM, no webpack, no Next.js).
 */
"use strict";

var os = require("os");
var path = require("path");
var fs = require("fs");

var TMP = path.join(os.tmpdir(), "practice-source-smoke-" + Date.now());
process.env.PROJECT_ROOT = TMP;

var SA = require("./source-adapter.js");
var passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + msg);
}
function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }
process.on("exit", cleanup);

function writeFile(rel, content) {
  var fp = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, "utf-8");
  return fp;
}

console.log("Practice Source Adapter Smoke Test: " + TMP);
console.log("");

var PID = "u1", WID = "w1", TID = "tb1";
var worldRel = path.join("profiles", PID, "worlds", WID);

// ========== 1. explicit sourceText wins over any sourceType ==========

var r1 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "textbook-page", sourceText: "  hello world  " });
assert(!r1.error, "sourceText: no error");
assert(r1.text === "hello world", "sourceText: trimmed");
assert(r1.kind === "textbook-page:provided-sourceText", "sourceText: kind preserves sourceType (got " + r1.kind + ")");
console.log("  1. Explicit sourceText priority: PASS");

// ========== 2. textbook-page single page ==========

writeFile(path.join(worldRel, "textbooks", TID, "pages", "5.txt"), "Page five content about recursion.");
var r2 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "textbook-page", textbookId: TID, page: 5 });
assert(!r2.error, "textbook-page single: no error (got " + (r2.error ? r2.message : "") + ")");
assert(r2.text.indexOf("Page five content") >= 0, "textbook-page single: reads page text");
assert(r2.kind === "textbook-page:pages", "textbook-page single: kind");
console.log("  2. textbook-page single page: PASS");

// ========== 3. textbook-page pageRange concatenation ==========

writeFile(path.join(worldRel, "textbooks", TID, "pages", "page_006.txt"), "Sixth page about big-O.");
writeFile(path.join(worldRel, "textbooks", TID, "pages", "page_0007.txt"), "Seventh page about sorting.");
var r3 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "textbook-page", textbookId: TID, pageRange: [5, 7] });
assert(!r3.error, "textbook-page range: no error");
assert(r3.text.indexOf("Page five") >= 0 && r3.text.indexOf("Sixth page") >= 0 && r3.text.indexOf("Seventh page") >= 0,
  "textbook-page range: concatenates 5,6,7 (padded names too)");
assert(r3.text.indexOf("[p.5]") >= 0 && r3.text.indexOf("[p.7]") >= 0, "textbook-page range: page markers present");
console.log("  3. textbook-page pageRange: PASS");

// ========== 4. textbook-page json page + current_reading fallback ==========

var TID2 = "tb2";
writeFile(path.join(worldRel, "textbooks", TID2, "pages", "3.json"), JSON.stringify({ page: 3, text: "JSON page text here." }));
var r4 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "textbook-page", textbookId: TID2, page: 3 });
assert(!r4.error && r4.text.indexOf("JSON page text") >= 0, "textbook-page: reads .json page text field");

var TID3 = "tb3";
writeFile(path.join(worldRel, "textbooks", TID3, "current_reading.md"), "Recently taught window text.");
var r4b = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "textbook-page", textbookId: TID3, page: 99 });
assert(!r4b.error && r4b.kind === "textbook-page:current_reading", "textbook-page: falls back to current_reading.md");
console.log("  4. textbook-page json + current_reading fallback: PASS");

// ========== 5. textbook-page miss → clear no_source ==========

var r5 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "textbook-page", textbookId: "tb_empty", page: 1 });
assert(r5.error === "no_source", "textbook-page miss: no_source");
assert(/page text or sourceText/.test(r5.message), "textbook-page miss: clear message");
console.log("  5. textbook-page miss no_source: PASS");

// ========== 6. chapter pageRange fallback ==========

var r6 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "chapter", textbookId: TID, pageRange: [5, 6] });
assert(!r6.error, "chapter pageRange: no error");
assert(r6.kind === "chapter:pages", "chapter pageRange: kind");
assert(r6.text.indexOf("Page five") >= 0 && r6.text.indexOf("Sixth page") >= 0, "chapter pageRange: reads pages");
console.log("  6. chapter pageRange fallback: PASS");

// ========== 7. chapter file (json with pages array) ==========

writeFile(path.join(worldRel, "textbooks", TID, "chapters", "ch1.json"),
  JSON.stringify({ pages: [{ text: "Chapter one part A." }, { content: "Chapter one part B." }] }));
var r7 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "chapter", textbookId: TID, chapterId: "ch1" });
assert(!r7.error, "chapter file: no error");
assert(r7.text.indexOf("part A") >= 0 && r7.text.indexOf("part B") >= 0, "chapter file: joins pages array");
console.log("  7. chapter file json: PASS");

// ========== 8. chapter miss ==========

var r8 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "chapter", textbookId: TID });
assert(r8.error === "no_source", "chapter miss: no_source");
console.log("  8. chapter miss no_source: PASS");

// ========== 9. conversation concept-summary ==========

var CID = "conv1";
writeFile(path.join(worldRel, "concept-summaries", CID + ".json"), JSON.stringify({
  conversationId: CID,
  sections: [
    { type: "tldr", content: "Recursion is self-reference." },
    { type: "concepts", items: [{ name: "Base case", body: "Stops the recursion." }] }
  ]
}));
var r9 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "conversation", conversationId: CID });
assert(!r9.error, "conversation concept-summary: no error");
assert(r9.kind === "conversation:concept-summary", "conversation: prefers concept-summary");
assert(r9.text.indexOf("self-reference") >= 0 && r9.text.indexOf("Base case") >= 0, "conversation: concept-summary content");
console.log("  9. conversation concept-summary: PASS");

// ========== 10. conversation lesson-summary fallback ==========

var CID2 = "conv2";
writeFile(path.join(worldRel, "lesson_summaries", CID2 + ".md"), "<!-- windowStart: 12 -->\nToday we covered loops and arrays.");
var r10 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "conversation", conversationId: CID2 });
assert(!r10.error, "conversation lesson-summary: no error");
assert(r10.kind === "conversation:lesson-summary", "conversation: falls back to lesson-summary");
assert(r10.text.indexOf("loops and arrays") >= 0, "conversation: lesson-summary content");
assert(r10.text.indexOf("windowStart") < 0, "conversation: strips windowStart marker");
console.log("  10. conversation lesson-summary fallback: PASS");

// ========== 11. conversation recent-messages fallback ==========

var CID3 = "conv3";
writeFile(path.join(worldRel, "chats", CID3 + ".json"), JSON.stringify({
  id: CID3, createdAt: new Date().toISOString(),
  messages: [
    { role: "user", content: "What is a pointer?" },
    { role: "assistant", content: "A pointer holds a memory address." },
    { role: "system", content: "ignored" }
  ]
}));
var r11 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "conversation", conversationId: CID3 });
assert(!r11.error, "conversation recent-messages: no error");
assert(r11.kind === "conversation:recent-messages", "conversation: falls back to recent messages");
assert(r11.text.indexOf("pointer") >= 0 && r11.text.indexOf("memory address") >= 0, "conversation: message content present");
assert(r11.text.indexOf("ignored") < 0, "conversation: non user/assistant roles filtered");
console.log("  11. conversation recent-messages fallback: PASS");

// ========== 12. conversation miss → no_source, no file created ==========

var r12 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "conversation", conversationId: "conv_never" });
assert(r12.error === "no_source", "conversation miss: no_source");
assert(!fs.existsSync(path.join(TMP, worldRel, "concept-summaries", "conv_never.json")), "conversation miss: creates no file");
console.log("  12. conversation miss no_source: PASS");

// ========== 13. manual without sourceText ==========

var r13 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "manual" });
assert(r13.error === "no_source", "manual without text: no_source");
console.log("  13. manual requires sourceText: PASS");

// ========== 14. path traversal blocked ==========

var blocked;
blocked = false;
try { SA.resolveSourceText({ profileId: "../etc", worldId: WID, sourceType: "textbook-page", textbookId: TID, page: 1 }); } catch (e) { blocked = true; }
var r14a = SA.resolveSourceText({ profileId: "../etc", worldId: WID, sourceType: "textbook-page", textbookId: TID, page: 1 });
assert(r14a.error === "no_source", "traversal in profileId → no_source (not crash)");

var r14b = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "textbook-page", textbookId: "../../../evil", page: 1 });
assert(r14b.error === "no_source", "traversal in textbookId → no_source");

var r14c = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "textbook-page", textbookId: "tb\\evil", page: 1 });
assert(r14c.error === "no_source", "backslash in textbookId → no_source");

var r14d = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "conversation", conversationId: "../../secret" });
assert(r14d.error === "no_source", "traversal in conversationId → no_source");
console.log("  14. Path traversal blocked: PASS");

// ========== 15. account-scoped layout (accounts/<id>/profiles/...) ==========

var ACC = "acc1";
var accWorldRel = path.join("accounts", ACC, "profiles", PID, "worlds", WID);
writeFile(path.join(accWorldRel, "textbooks", "tb_acc", "pages", "1.txt"), "Account-scoped page one.");
var r15 = SA.resolveSourceText({ profileId: PID, worldId: WID, sourceType: "textbook-page", textbookId: "tb_acc", page: 1 });
assert(!r15.error, "account-scoped: no error");
assert(r15.text.indexOf("Account-scoped page one") >= 0, "account-scoped: reads under accounts/<id>/profiles/...");
console.log("  15. Account-scoped layout: PASS");

// ========== 16. ConceptGraph context optional (absent → empty, never throws) ==========

var ctxEmpty = SA.conceptGraphContext({ profileId: PID, worldId: WID, textbookId: TID }, 8);
assert(ctxEmpty === "", "conceptGraphContext: empty when no __ADAPTIVE__");

global.__ADAPTIVE__ = {
  getConceptGraph: function (pid, wid, tid) {
    return { concepts: [
      { conceptId: "recursion", title: "Recursion", description: "A function calling itself.", masteryCriteria: ["Identify base case"], commonMisconceptions: ["Infinite loop confusion"] },
      { conceptId: "big_o", title: "Big-O", description: "Asymptotic complexity." }
    ] };
  }
};
var ctx = SA.conceptGraphContext({ profileId: PID, worldId: WID, textbookId: TID }, 8);
assert(ctx.indexOf("Recursion") >= 0 && ctx.indexOf("Big-O") >= 0, "conceptGraphContext: summarizes concepts when available");
assert(ctx.indexOf("掌握标准") >= 0, "conceptGraphContext: includes masteryCriteria");

// Missing textbookId → empty, never throws
var ctxNoTid = SA.conceptGraphContext({ profileId: PID, worldId: WID }, 8);
assert(ctxNoTid === "", "conceptGraphContext: empty without textbookId");
delete global.__ADAPTIVE__;
console.log("  16. ConceptGraph optional context: PASS");

// ========== Summary ==========

console.log("");
console.log("Passed: " + passed + "  Failed: " + failed);
if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
console.log("All tests passed.");
process.exit(0);
