"use strict";

var assert = require("assert");
var quality = require("./ocr-quality.js");

assert.strictEqual(quality.assess("这是合法的中文标题", { expectedCjk: true, source: "windows-ocr" }).usable, true);
assert.strictEqual(quality.assess("锟斤拷锟斤拷", { expectedCjk: true, source: "windows-ocr" }).usable, false);
assert.strictEqual(quality.assess("\u0000\u0000正文", { expectedCjk: true, source: "windows-ocr" }).usable, false);
assert.strictEqual(quality.assess("字", { expectedCjk: true, source: "windows-ocr" }).usable, false, "one OCR glyph is not a complete page transcription");
assert.strictEqual(quality.assess("字", { expectedCjk: true, source: "rapidocr-v5" }).usable, false, "offline fallback uses the same minimum OCR completeness gate");
assert.strictEqual(quality.assess("□□□□□□□ Socratopia OCR Test 2026", { expectedCjk: true, source: "rapidocr-v5" }).usable, false, "missing-glyph boxes must invalidate otherwise plausible OCR text");
assert.strictEqual(quality.assess("111111111111111", { expectedCjk: false, source: "windows-ocr" }).usable, false, "highly repetitive OCR output is not reliable text");
assert.strictEqual(quality.assess("Chapter 1\nIntroduction", { expectedCjk: true, source: "windows-ocr" }).usable, true, "an English page in a Chinese textbook remains valid");
assert.strictEqual(quality.assess("x = y + 1", { expectedCjk: false, source: "windows-ocr" }).usable, true);
assert.strictEqual(quality.assess("序", { expectedCjk: true, source: "text-layer" }).usable, true, "a genuine short text-layer title remains usable");
assert.strictEqual(quality.assess("", { expectedCjk: true }).usable, false);
assert.strictEqual(quality.normalize("汉 字 之 间\r\n  多余空格"), "汉字之间\n多余空格");
console.log("ocr-quality smoke: PASS");
