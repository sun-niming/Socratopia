"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var Q = require("./kb-quality.js");

var goodZh = Q.assessPdfText("第 1 章 C++ 和标准库速成 初始化列表允许函数接收可变数量的同类型参数。");
assert.strictEqual(goodZh.garbled, false, "readable Chinese text is not garbled");

var goodEn = Q.assessPdfText("Structured bindings let a program decompose arrays, structures, pairs, and tuples into named variables.");
assert.strictEqual(goodEn.garbled, false, "readable English text is not garbled");

var missingZh = Q.assessPdfText("std::vector optional array initializer_list template class public private const auto include namespace concept requires repeated identifiers 0123456789", { expectedCjk: true });
assert.strictEqual(missingZh.renderRecommended, true, "Chinese textbook page with only surviving ASCII requests rendering");

var broken = Q.assessPdfText("C ++ • C ++ ( Standard Library ) • • • const ■ I • CM C ++ union volatile C — f");
assert.strictEqual(broken.renderRecommended, true, "fragmented PDF text requests rendering");

function fragmentedSample(asciiCount, cjkCount, punctuationCount) {
  return new Array(asciiCount).fill("a")
    .concat(new Array(cjkCount).fill("中"), new Array(punctuationCount).fill("•"))
    .join(" ");
}
assert.strictEqual(Q.assessPdfText(fragmentedSample(55, 0, 64)).garbled, false,
  "generic fragmentation excludes 119 compact characters");
assert.strictEqual(Q.assessPdfText(fragmentedSample(55, 0, 65)).garbled, true,
  "generic fragmentation includes 120 compact characters");
assert.strictEqual(Q.assessPdfText(fragmentedSample(52, 3, 65)).garbled, true,
  "generic fragmentation includes three CJK characters");
assert.strictEqual(Q.assessPdfText(fragmentedSample(51, 4, 65)).garbled, false,
  "generic fragmentation excludes four CJK characters");
assert.strictEqual(Q.assessPdfText("a".repeat(119), { expectedCjk: true }).missingExpectedCjk, false,
  "missing-CJK detection excludes 119 compact characters");
assert.strictEqual(Q.assessPdfText("a".repeat(120), { expectedCjk: true }).missingExpectedCjk, true,
  "missing-CJK detection includes 120 compact characters");
assert.strictEqual(Q.assessPdfText("中".repeat(3) + "a".repeat(117), { expectedCjk: true }).missingExpectedCjk, true,
  "missing-CJK detection includes three CJK characters");
assert.strictEqual(Q.assessPdfText("中".repeat(4) + "a".repeat(116), { expectedCjk: true }).missingExpectedCjk, false,
  "missing-CJK detection excludes four CJK characters");

var toc = "目 录 9.3 与方法有关的更多内容 9.3.1 static 方法 9.3.2 const 方法 9.3.3 方法重载 9.3.4 内联方法 9.3.5 默认参数 9.4 数据成员 9.4.1 静态成员 9.4.2 const static 数据成员 9.5 嵌套类 9.6 本章小结 9.7 练习";
assert.strictEqual(Q.likelyTeachableChunk(toc, true), false, "table-of-contents chunks stay legitimate zero-card chunks even with a sparse image page");

var cards = [
  { concept_id: "091_access", title: "access", source_pages: [61, 64], _chunk_pages: [61, 64] },
  { concept_id: "088_initializer", title: "initializer", source_pages: [62, 63], _chunk_pages: [61, 64] },
  { concept_id: "083_binding", title: "binding", source_pages: [61, 64], _chunk_pages: [61, 64] },
];
assert.deepStrictEqual(Q.sortCards(cards).map(function (c) { return c.concept_id; }), [
  "083_binding", "088_initializer", "091_access",
], "same-chunk concepts keep extraction ordinal instead of broad page-range order");

var parallelCards = [
  { concept_id: "003_late", _chunk_pages: [9, 12], source_pages: [9, 12] },
  { concept_id: "001_first", _chunk_pages: [1, 4], source_pages: [1, 4] },
  { concept_id: "002_middle", _chunk_pages: [5, 8], source_pages: [5, 8] },
];
assert.deepStrictEqual(Q.sortCards(parallelCards).map(function (c) { return c.concept_id; }), [
  "001_first", "002_middle", "003_late",
], "parallel completion order cannot reorder source chunks");
assert.strictEqual(Q.teachingPhasesPreserveOrder(parallelCards.slice().sort(Q.compareCards), [
  { card_ids: ["001_first"] },
  { card_ids: ["003_late", "002_middle"] },
]), false, "phase grouping cannot move a later card before an earlier card");
assert.strictEqual(Q.teachingPhasesPreserveOrder(parallelCards.slice().sort(Q.compareCards), [
  { card_ids: ["001_first", "002_middle"] },
  { card_ids: ["003_late"] },
]), true, "phase grouping may partition the source sequence without reordering it");

var builderSource = fs.readFileSync(path.join(__dirname, "kb-builder.mjs"), "utf-8");
assert.ok(builderSource.includes("KBQuality.assessPdfText(text, { expectedCjk: /^chinese/.test(LANG) })"),
  "the full KB builder enables missing-Chinese detection for Chinese textbooks");
assert.ok(builderSource.includes('import ResponsesCompat from "./responses-api-compat.js"'),
  "the standalone ESM builder imports the shared native Responses compatibility transport");
assert.ok(builderSource.includes("ResponsesCompat.postChatCompletionsJson(url, payload"),
  "the standalone builder routes model requests through the shared native fallback");
assert.strictEqual(builderSource.includes("mod.request(url"), false,
  "the standalone builder cannot bypass the Responses fallback with a raw request");

var events = [];
for (var i = 1; i <= 10; i++) {
  events.push({ type: "chunk_done", chunk: i, cardCount: i <= 5 ? 3 : 0, method: i <= 5 ? "text-only" : "none" });
}
var coverage = Q.assessBuild([{ source_pages: [1, 20] }], new Array(10), events, 1, 40, null);
assert.strictEqual(coverage.state, "partial", "truncated build is marked partial");
assert.strictEqual(coverage.trailingEmptyChunks, 5, "trailing empty chunks are reported");

var failed = Q.assessBuild(
  [{ source_pages: [1, 40] }],
  new Array(2),
  [
    { type: "chunk_done", chunk: 1, cardCount: 2, method: "text-only", terminalFailure: false },
    { type: "chunk_done", chunk: 2, cardCount: 0, method: "none", terminalFailure: true },
  ],
  1, 40,
  { segments: [{ generated_by: "fallback-page-order" }], fallback_segments: 1 }
);
assert.strictEqual(failed.state, "partial", "terminal chunk or fully degraded map blocks activation");
assert.strictEqual(failed.terminalFailedChunks, 1, "terminal failures are reported separately");
assert.strictEqual(failed.activationEligible, false, "partial build is not activation eligible");

var missingMiddlePage = Q.assessBuild(
  [{ source_pages: [1, 4] }],
  [{ start_page: 1, end_page: 4 }],
  [{ type: "chunk_done", chunk: 1, cardCount: 1, method: "text-only", terminalFailure: false }],
  1, 4,
  { segments: [{ generated_by: "llm-validated" }], fallback_segments: 0 },
  { requestedPages: 4, successfulPages: [1, 3, 4], failedPages: [{ page: 2, reason: "windows_ocr_failed" }], transcriptionComplete: false }
);
assert.strictEqual(missingMiddlePage.coverageRatio, 1, "span coverage alone would otherwise hide a missing middle page");
assert.strictEqual(missingMiddlePage.state, "partial", "any unresolved OCR page must prevent a done KB");
assert.strictEqual(missingMiddlePage.activationEligible, false);
assert.deepStrictEqual(missingMiddlePage.failedPages, [{ page: 2, reason: "windows_ocr_failed" }]);

var recoveredRetry = Q.assessBuild(
  [{ source_pages: [1, 40] }],
  [{}, {}],
  [
    { type: "chunk_done", chunk: 1, cardCount: 0, method: "none", terminalFailure: true },
    { type: "chunk_retry", chunk: 1, attempt: 1 },
    { type: "chunk_done", chunk: 1, cardCount: 2, method: "text-only", terminalFailure: false },
    { type: "chunk_done", chunk: 2, cardCount: 2, method: "text-only", terminalFailure: false },
  ],
  1, 40,
  { segments: [{ generated_by: "llm-validated" }], fallback_segments: 0 }
);
assert.strictEqual(recoveredRetry.terminalFailedChunks, 0, "a successful whole-chunk retry supersedes its earlier terminal event");
assert.strictEqual(Q.contiguousHealthyChunks([
  { type: "chunk_done", chunk: 1, terminalFailure: false },
  { type: "chunk_done", chunk: 2, terminalFailure: true },
  { type: "chunk_retry", chunk: 2 },
  { type: "chunk_done", chunk: 2, terminalFailure: false },
  { type: "chunk_start", chunk: 3 },
], 5), 2, "resume checkpoint stops before an interrupted in-flight chunk");

console.log("kb-quality smoke: PASS");
