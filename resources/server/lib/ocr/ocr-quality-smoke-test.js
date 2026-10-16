"use strict";

var assert = require("assert");
var quality = require("./ocr-quality.js");

assert.strictEqual(quality.assess("这是合法的中文标题", { expectedCjk: true, source: "windows-ocr" }).usable, true);
assert.strictEqual(quality.assess("锟斤拷锟斤拷", { expectedCjk: true, source: "windows-ocr" }).usable, false);
assert.strictEqual(quality.assess("\u0000\u0000正文", { expectedCjk: true, source: "windows-ocr" }).usable, false);
assert.strictEqual(quality.assess("字", { expectedCjk: true, source: "windows-ocr" }).usable, false, "one OCR glyph is not a complete page transcription");
assert.strictEqual(quality.assess("字", { expectedCjk: true, source: "rapidocr-v5" }).usable, false, "offline fallback uses the same minimum OCR completeness gate");
assert.strictEqual(quality.assess("□□□□□□□ Socratopia OCR Test 2026", { expectedCjk: true, source: "rapidocr-v5" }).usable, false, "missing-glyph boxes must invalidate otherwise plausible OCR text");
assert.strictEqual(quality.assess("WRONG", { expectedCjk: false, source: "text-layer" }).placeholders, 0);
assert.strictEqual(
  quality.assess("实际上不应该执行从L到R的归约。\n□\n如果在状态中包含更多的信息，我们就可能排除掉一些这样的不正确的归约。", { expectedCjk: true, source: "rapidocr-v5" }).usable,
  true,
  "the textbook's stray end-of-example box is a layout glyph, not a missing glyph"
);
assert.strictEqual(
  quality.assess("有效项。\n□\n如果在状态中包含更多的信息，我们就可能排除掉一些\n□\n又一段正文继续写下去。", { expectedCjk: true, source: "rapidocr-v5" }).usable,
  true,
  "two stray boxes on one page still do not mean a failed transcription"
);
assert.strictEqual(
  quality.assess("正文\n□□\n后半段", { expectedCjk: true, source: "rapidocr-v5" }).usable,
  false,
  "a run of two boxes is still treated as a missing glyph"
);
assert.strictEqual(quality.assess("111111111111111", { expectedCjk: false, source: "windows-ocr" }).usable, false, "highly repetitive OCR output is not reliable text");
assert.strictEqual(quality.assess("Chapter 1\nIntroduction", { expectedCjk: true, source: "windows-ocr" }).usable, true, "an English page in a Chinese textbook remains valid");
assert.strictEqual(quality.assess("x = y + 1", { expectedCjk: false, source: "windows-ocr" }).usable, true);
assert.strictEqual(quality.assess("序", { expectedCjk: true, source: "text-layer" }).usable, true, "a genuine short text-layer title remains usable");
assert.strictEqual(quality.assess("", { expectedCjk: true }).usable, false);
assert.strictEqual(quality.normalize("汉 字 之 间\r\n  多余空格"), "汉字之间\n多余空格");
console.log("ocr-quality smoke: PASS");
