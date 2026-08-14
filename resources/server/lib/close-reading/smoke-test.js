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
assert.ok(skillSource.includes("source=text-layer 时，说明证据来自 PDF 内嵌文字层/可复制文本，不是本轮视觉 OCR"));
assert.ok(skillSource.includes("source=mixed 时，分别说明文字层页和视觉转录页"));

var previousSet = global.__SOCRATOPIA_SET__;
try {
  global.__SOCRATOPIA_SET__ = {
    premium: { baseUrl: "https://example.invalid/v1", apiKey: "test", model: "premium-vision" },
    strong: { baseUrl: "https://example.invalid/v1", apiKey: "test", model: "strong-vision" },
  };
  assert.deepStrictEqual(reader.visionConfigs().map(function (item) { return item.source; }), ["premium", "strong"]);
  assert.strictEqual(reader.visionConfig().source, "premium");
  global.__SOCRATOPIA_SET__ = {
    vision: { baseUrl: "http://127.0.0.1:9", apiKey: "test", model: "disabled" },
    strong: { baseURL: "https://example.invalid/v1", apiKey: "test", model: "strong-vision" },
  };
  assert.strictEqual(reader.visionConfig().source, "strong");
} finally {
  if (previousSet === undefined) delete global.__SOCRATOPIA_SET__;
  else global.__SOCRATOPIA_SET__ = previousSet;
}

console.log("close-reading smoke test: ok");
