"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var parser = require("./command-parser.js");
var normalizer = require("./text-normalizer.js");
var reader = require("./excerpt-reader.js");

assert.strictEqual(parser.isCommand("/Close_Reading 第125页 void sort"), true);
assert.strictEqual(parser.isCommand("/close-reading page 125"), true);
assert.strictEqual(parser.isCommand("解释第125页"), false);

var direct = parser.parseCommand("/Close_Reading 第125页 `void sort()`，完整翻译注释", { messages: [] });
assert.strictEqual(direct.startPage, 125);
assert.strictEqual(direct.query, "void sort()");
assert.strictEqual(direct.maxPages, 3);
assert.strictEqual(direct.allowOcr, true);
assert.strictEqual(direct.allowRemoteVision, false);
var consented = parser.parseCommand("/Close_Reading 第125页，允许远程视觉 OCR，完整翻译注释", { messages: [] });
assert.strictEqual(consented.allowRemoteVision, true);
assert(!consented.query.includes("允许远程视觉"));
[
  "/精读 第1页 不同意云端转录",
  "/精读 第1页 不允许远程视觉 OCR",
  "/精读 第1页 未授权远程OCR",
  "/Close_Reading page 1 do not allow remote vision OCR",
  "/Close_Reading page 1 never authorize cloud transcription",
  "/精读 第1页 不 allow remote vision OCR",
  "/精读 第1页 不允许 allow remote vision OCR",
  "/精读 第1页 不同意 allow remote vision OCR",
  "/Close_Reading page 1 don't 允许远程视觉OCR",
].forEach(function (command) {
  assert.strictEqual(parser.parseCommand(command, { messages: [] }).allowRemoteVision, false, command);
});

var contextual = parser.parseCommand("/Close_Reading 翻译这个函数", {
  messages: [
    { role: "user", content: "我想看 void sort() 的注释，第126页" },
    { role: "assistant", content: "好的" },
    { role: "user", content: "/Close_Reading 翻译这个函数" },
  ],
  windowStartPage: 20,
});
assert.strictEqual(contextual.startPage, 126);

assert.strictEqual(normalizer.normalizeText("\uFEFFa\r\nb\u0000"), "a\nb");
assert.strictEqual(normalizer.normalizeForSearch("Void\n  Sort ( )"), "void sort()");
assert.strictEqual(normalizer.looksGarbled("正常文字"), false);
assert.strictEqual(reader.queryMatches("void sort(int data[], size_t size)", normalizer.normalizeForSearch("void sort()")), true);
assert.strictEqual(reader.queryMatches("void sortable(int value)", normalizer.normalizeForSearch("void sort()")), false);

var skillSource = fs.readFileSync(path.join(__dirname, "skill.js"), "utf8");
var serverSource = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");
assert.ok(skillSource.includes("source=text-layer 时，说明证据来自 PDF 内嵌文字层/可复制文本，不是本轮视觉 OCR"));
assert.ok(skillSource.includes("source=rapidocr-v5 时，说明证据来自随软件离线运行的 PP-OCRv5"));
assert.ok(skillSource.includes("source=mixed 时，按 sourcesByPage 分别说明"));
assert.ok(serverSource.includes("function normalizeOcrVision(raw)"), "server must use a strict OCR-only configuration normalizer");
assert.ok(serverSource.includes("ocrVision=normalizeOcrVision(cfg.ocrVision)"));
assert.ok(!serverSource.includes('ocrVision=normalize(cfg.ocrVision'), "ocrVision must never inherit teaching provider credentials/models");

var previousSet = global.__SOCRATOPIA_SET__;
try {
  global.__SOCRATOPIA_SET__ = {
    premium: { baseUrl: "https://example.invalid/v1", apiKey: "test", model: "premium-vision" },
    strong: { baseUrl: "https://example.invalid/v1", apiKey: "test", model: "strong-vision" },
  };
  assert.deepStrictEqual(reader.visionConfigs(), []);
  assert.strictEqual(reader.visionConfig(), null);
  global.__SOCRATOPIA_SET__ = {
    ocrVision: { enabled: true, userConsent: false, baseUrl: "https://example.invalid/v1", apiKey: "test", model: "ocr-vision" },
  };
  assert.deepStrictEqual(reader.visionConfigs(), []);
  global.__SOCRATOPIA_SET__.ocrVision.userConsent = true;
  assert.deepStrictEqual(reader.visionConfigs().map(function (item) { return item.source; }), ["ocrVision"]);
  assert.strictEqual(reader.visionConfig().source, "ocrVision");
  global.__SOCRATOPIA_SET__.ocrVision = { enabled: true, userConsent: true, group: "gpt" };
  assert.deepStrictEqual(reader.visionConfigs(), [], "ocrVision must not inherit teaching provider credentials or models");
} finally {
  if (previousSet === undefined) delete global.__SOCRATOPIA_SET__;
  else global.__SOCRATOPIA_SET__ = previousSet;
}

console.log("close-reading smoke test: ok");
