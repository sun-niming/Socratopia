// assets-serialize-smoke-test.js — self-contained tests for lib/assets/serialize.js.
// Run: node <this file>
"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var serialize = require("./serialize.js");

var results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name: name, ok: true });
    console.log("  PASS  " + name);
  } catch (error) {
    results.push({ name: name, ok: false });
    console.log("  FAIL  " + name);
    console.log("        " + (error && error.stack ? error.stack.split("\n").slice(0, 5).join("\n        ") : error));
  }
}

var PNG_BASE64 = Buffer.from("fake-png-bytes-0123456789").toString("base64");
var DATA_URL = "data:image/png;base64," + PNG_BASE64;

function imageBlock(extra) {
  var block = { type: "image", assetId: "ast_0123456789abcdef" };
  if (extra) Object.keys(extra).forEach(function (key) { block[key] = extra[key]; });
  return block;
}

function contentOf(result, index) {
  return result[index || 0].content;
}

// An image part is always preceded by its anchor text, so the tutor keeps the id
// and can cite the picture back.  Helpers keep that contract readable.
function imageParts(content) {
  return Array.isArray(content) ? content.filter(function (part) { return part.type === "image_url"; }) : [];
}
function anchorTextOf(content, index) {
  return (content || [])[(index || 0) * 2] && content[(index || 0) * 2].text;
}
function anchorText(id) {
  return "![图片](asset://" + id + ")";
}

console.log("assets/serialize.js");

test("case 1: string content is returned byte-identical and by reference", function () {
  var messages = [
    { role: "user", content: "纯文本历史消息，含 emoji 😀 与\n换行" },
    { role: "assistant", content: "" },
    { role: "system", content: "  spaced  " },
  ];
  var out = serialize.messagesToLlmInput(messages, { visionEnabled: true });
  assert.strictEqual(out.length, 3);
  for (var i = 0; i < messages.length; i += 1) {
    assert.strictEqual(out[i], messages[i], "message " + i + " must be the same object");
    assert.strictEqual(out[i].content, messages[i].content);
    assert.strictEqual(Buffer.from(out[i].content, "utf8").equals(Buffer.from(messages[i].content, "utf8")), true);
  }
  assert.deepStrictEqual(messages[0].content, "纯文本历史消息，含 emoji 😀 与\n换行");
});

test("case 1b: extra message fields survive and the input is not mutated", function () {
  var messages = [{ role: "user", content: [{ type: "text", text: "hi" }], name: "learner", meta: { a: 1 } }];
  var out = serialize.messagesToLlmInput(messages, {});
  assert.strictEqual(out[0].name, "learner");
  assert.deepStrictEqual(out[0].meta, { a: 1 });
  assert.deepStrictEqual(messages[0].content, [{ type: "text", text: "hi" }], "input array untouched");
  assert.strictEqual(out[0].content, "hi", "text-only blocks collapse to a string");
});

test("case 2: caption flattens the image block to its anchor form", function () {
  var messages = [{
    role: "user",
    content: [
      { type: "text", text: "这张图里第二步的响应为什么也是异步的？" },
      imageBlock({ caption: "图 12-10 双向异步消息通信模式" }),
    ],
  }];
  var content = contentOf(serialize.messagesToLlmInput(messages, { visionEnabled: true, images: { ast_0123456789abcdef: { base64: PNG_BASE64 } } }));
  assert.strictEqual(content, "这张图里第二步的响应为什么也是异步的？\n![图 12-10 双向异步消息通信模式](asset://ast_0123456789abcdef)");
  assert.strictEqual(typeof content, "string", "no multimodal part when text is reliable");
});

test("case 2b: learner note, visual description and high-confidence OCR all count as reliable", function () {
  var cases = [
    { text: "用户手写说明" },
    { visualDescription: "视觉描述内容" },
    { alt: "alt 文本" },
    { ocrText: "高置信 OCR 文本", ocrConfidence: 0.95 },
  ];
  cases.forEach(function (extra) {
    var messages = [{ role: "user", content: [imageBlock(extra)] }];
    var content = contentOf(serialize.messagesToLlmInput(messages, { visionEnabled: true, ocrThreshold: 0.6 }));
    assert.match(content, /^!\[/, JSON.stringify(extra));
    assert.ok(content.indexOf("未识别") === -1, JSON.stringify(extra));
  });
});

test("case 2c: low-confidence OCR does not count as reliable", function () {
  var messages = [{ role: "user", content: [imageBlock({ ocrText: "低置信文本", ocrConfidence: 0.2 })] }];
  var noVision = contentOf(serialize.messagesToLlmInput(messages, { visionEnabled: false }));
  assert.strictEqual(noVision, "[图片: 未识别]");
  var withVision = contentOf(serialize.messagesToLlmInput(messages, {
    visionEnabled: true,
    images: { ast_0123456789abcdef: { base64: PNG_BASE64 } },
  }));
  assert.ok(Array.isArray(withVision));
  assert.strictEqual(withVision[0].text, anchorText("ast_0123456789abcdef"));
  assert.strictEqual(withVision[1].type, "image_url");
});

test("case 3: no caption + visionEnabled=true emits an OpenAI image_url part", function () {
  var messages = [{ role: "user", content: [imageBlock()] }];
  var content = contentOf(serialize.messagesToLlmInput(messages, {
    visionEnabled: true,
    images: { ast_0123456789abcdef: { base64: PNG_BASE64, mimeType: "image/png" } },
  }));
  assert.ok(Array.isArray(content), "must be a content array");
  assert.strictEqual(content.length, 2);
  assert.strictEqual(content[0].text, anchorText("ast_0123456789abcdef"));
  assert.deepStrictEqual(content[1], { type: "image_url", image_url: { url: DATA_URL } });
});

test("case 3b: resolver functions and inline base64 both work", function () {
  var messages = [{ role: "user", content: [imageBlock()] }];
  var viaResolver = contentOf(serialize.messagesToLlmInput(messages, {
    visionEnabled: true,
    resolveImage: function () { return { base64: PNG_BASE64 }; },
  }));
  assert.strictEqual(imageParts(viaResolver)[0].image_url.url, DATA_URL);

  var inline = contentOf(serialize.messagesToLlmInput([{ role: "user", content: [imageBlock({ base64: PNG_BASE64 })] }], { visionEnabled: true }));
  assert.strictEqual(imageParts(inline)[0].image_url.url, DATA_URL);

  var dataUrl = contentOf(serialize.messagesToLlmInput([{ role: "user", content: [imageBlock({ dataUrl: DATA_URL })] }], { visionEnabled: true }));
  assert.strictEqual(imageParts(dataUrl)[0].image_url.url, DATA_URL);
});

test("case 3c: visionEnabled=true but no injected bytes degrades to the placeholder", function () {
  var messages = [{ role: "user", content: [imageBlock()] }];
  assert.strictEqual(contentOf(serialize.messagesToLlmInput(messages, { visionEnabled: true })), "[图片: 未识别]");
  assert.strictEqual(contentOf(serialize.messagesToLlmInput(messages, {
    visionEnabled: true,
    images: { ast_0123456789abcdef: { base64: PNG_BASE64 } },
    maxImageBytes: 4,
  })), "[图片: 未识别]", "oversized image degrades");
});

test("case 4: no caption + visionEnabled=false emits the placeholder", function () {
  var messages = [{ role: "user", content: [imageBlock()] }];
  var content = contentOf(serialize.messagesToLlmInput(messages, { visionEnabled: false }));
  assert.strictEqual(content, "[图片: 未识别]");
  assert.strictEqual(typeof content, "string");
});

test("case 4b: vision defaults to OFF when options are omitted", function () {
  var messages = [{ role: "user", content: [imageBlock()] }];
  assert.strictEqual(contentOf(serialize.messagesToLlmInput(messages)), "[图片: 未识别]");
  assert.strictEqual(serialize.DEFAULTS.visionEnabled, false);
});

test("case 5: blocks beyond maxImagesPerTurn degrade to the placeholder", function () {
  var blocks = [
    { type: "image", assetId: "ast_0000000000000001" },
    { type: "image", assetId: "ast_0000000000000002" },
    { type: "image", assetId: "ast_0000000000000003" },
    { type: "image", assetId: "ast_0000000000000004" },
  ];
  var images = {};
  blocks.forEach(function (block) { images[block.assetId] = { base64: PNG_BASE64 }; });
  var content = contentOf(serialize.messagesToLlmInput([{ role: "user", content: blocks }], {
    visionEnabled: true,
    maxImagesPerTurn: 2,
    images: images,
  }));
  var imagePartsList = content.filter(function (part) { return part.type === "image_url"; });
  var textParts = content.filter(function (part) { return part.type === "text"; });
  assert.strictEqual(imagePartsList.length, 2);
  assert.strictEqual(textParts.length, 4, "two placeholders + two anchors");
  assert.deepStrictEqual(textParts.map(function (p) { return p.text; }), [
    "[图片: 未识别]",
    "[图片: 未识别]",
    anchorText("ast_0000000000000003"),
    anchorText("ast_0000000000000004"),
  ]);
});

test("case 5b: the image budget is shared across the whole turn and spent on the newest picture", function () {
  var images = {
    ast_0000000000000001: { base64: PNG_BASE64 },
    ast_0000000000000002: { base64: PNG_BASE64 },
  };
  var out = serialize.messagesToLlmInput([
    { role: "user", content: [{ type: "image", assetId: "ast_0000000000000001" }] },
    { role: "user", content: [{ type: "image", assetId: "ast_0000000000000002" }] },
  ], { visionEnabled: true, maxImagesPerTurn: 1, images: images });
  assert.strictEqual(out[0].content, "[图片: 未识别]");
  assert.strictEqual(out[1].content[0].text, anchorText("ast_0000000000000002"));
  assert.strictEqual(out[1].content[1].type, "image_url");
  assert.strictEqual(out.visionUsed, 1);
});

test("svg blocks always take the text channel, even with vision on", function () {
  var messages = [{
    role: "assistant",
    content: [
      { type: "text", text: "看这张图：" },
      { type: "image", assetId: "ast_00000000000000ff", kind: "svg", svgSource: "<svg/>", svgTitle: "时序图：三次握手" },
    ],
  }];
  var content = contentOf(serialize.messagesToLlmInput(messages, { visionEnabled: true, images: {} }));
  assert.strictEqual(content, "看这张图：\n![时序图：三次握手](asset://ast_00000000000000ff)");
  assert.strictEqual(typeof content, "string");
});

test("unknown block types pass through verbatim", function () {
  var weird = { type: "audio", assetId: "x" };
  var content = contentOf(serialize.messagesToLlmInput([{ role: "user", content: [{ type: "text", text: "a" }, weird] }], {}));
  assert.deepStrictEqual(content, [{ type: "text", text: "a" }, weird]);
});

test("malformed image blocks degrade instead of throwing", function () {
  var messages = [{ role: "user", content: [{ type: "image" }, null, 42, imageBlock()] }];
  var content = contentOf(serialize.messagesToLlmInput(messages, { visionEnabled: false }));
  assert.strictEqual(content, "[图片: 未识别]\n[图片: 未识别]");
});

test("textOnly forces flattened text even when vision is enabled", function () {
  var messages = [{ role: "user", content: [imageBlock()] }];
  var content = contentOf(serialize.messagesToLlmInput(messages, {
    visionEnabled: true,
    textOnly: true,
    images: { ast_0123456789abcdef: { base64: PNG_BASE64 } },
  }));
  assert.strictEqual(content, "[图片: 未识别]");
});

test("blocksToText flattens one content value to a plain string", function () {
  assert.strictEqual(serialize.blocksToText("plain"), "plain");
  assert.strictEqual(serialize.blocksToText([{ type: "text", text: "a" }, imageBlock({ caption: "b" })]), "a\n![b](asset://ast_0123456789abcdef)");
  assert.strictEqual(serialize.blocksToText([imageBlock()]), "[图片: 未识别]");
});

test("hasBlocks detects structured content", function () {
  assert.strictEqual(serialize.hasBlocks([{ content: "s" }, { content: [{ type: "text", text: "t" }] }]), true);
  assert.strictEqual(serialize.hasBlocks([{ content: "s" }]), false);
  assert.strictEqual(serialize.hasBlocks([]), false);
  assert.strictEqual(serialize.hasBlocks(null), false);
});

test("non-array / non-record inputs are tolerated", function () {
  // `visionUsed` is attached as a non-index property of the returned array (a
  // handy log field), so plain-array comparisons go through plain().
  function plain(value) { return Array.prototype.slice.call(value); }
  assert.deepStrictEqual(plain(serialize.messagesToLlmInput(null)), []);
  assert.deepStrictEqual(plain(serialize.messagesToLlmInput(undefined)), []);
  assert.deepStrictEqual(plain(serialize.messagesToLlmInput([null, 7])), [null, 7]);
});

test("visionUsed reports how many image parts were emitted", function () {
  var out = serialize.messagesToLlmInput([{ role: "user", content: [imageBlock()] }], {
    visionEnabled: true,
    images: { ast_0123456789abcdef: { base64: PNG_BASE64 } },
  });
  assert.strictEqual(out.visionUsed, 1);
  assert.strictEqual(serialize.messagesToLlmInput([{ role: "user", content: [imageBlock()] }], {}).visionUsed, 0);
});

test("dataUrlBytes measures decoded payload size", function () {
  assert.strictEqual(serialize._internals.dataUrlBytes(DATA_URL), Buffer.from("fake-png-bytes-0123456789").length);
  assert.strictEqual(serialize._internals.dataUrlBytes("nope"), 0);
});

// ---- T10b: asset:// anchors inside plain string messages --------------------
// The frontend inserts `![图片](asset://<id>)` as plain text, so the confidence
// ladder must also fire on strings, not only on structured blocks.

var ANCHOR_ID = "ast_aaaabbbbccccdddd";
var ANCHOR = "![图片](asset://" + ANCHOR_ID + ")";

function recordResolver(records) {
  return function (assetId) { return records[assetId] || null; };
}

test("anchor 1: a captioned record flattens the anchor inline", function () {
  var messages = [{ role: "user", content: "这步为什么异步？" + ANCHOR, name: "learner" }];
  var out = serialize.messagesToLlmInput(messages, {
    resolveRecord: recordResolver({
      "ast_aaaabbbbccccdddd": { id: ANCHOR_ID, kind: "screenshot", caption: "图 12-10 双向异步消息通信模式" },
    }),
  });
  assert.strictEqual(out[0].content, "这步为什么异步？![图 12-10 双向异步消息通信模式](asset://" + ANCHOR_ID + ")");
  assert.strictEqual(out[0].name, "learner", "extra fields survive");
  assert.notStrictEqual(out[0], messages[0], "anchored strings produce a copy");
  assert.strictEqual(messages[0].content.indexOf("asset://") !== -1, true, "input not mutated");
});

test("anchor 1b: anchor-free strings stay reference-identical even with a resolver attached", function () {
  var messages = [{ role: "user", content: "没有任何锚点的纯文本 😀" }];
  var out = serialize.messagesToLlmInput(messages, { resolveRecord: recordResolver({}) });
  assert.strictEqual(out[0], messages[0], "same object, zero cost for legacy history");
});

test("anchor 2: unknown and deleted records degrade to the placeholder", function () {
  var out = serialize.messagesToLlmInput([
    { role: "user", content: ANCHOR },
    { role: "user", content: "![图片](asset://ast_ffffffffffffffff)" },
  ], {
    resolveRecord: recordResolver({
      "ast_ffffffffffffffff": { id: "ast_ffffffffffffffff", kind: "screenshot", deleted: true },
    }),
  });
  assert.strictEqual(out[0].content, "[图片: 未识别]");
  assert.strictEqual(out[1].content, "[图片: 未识别]");
});

test("anchor 2b: malformed anchors are not matched and pass through verbatim", function () {
  var message = { role: "user", content: "![图片](asset://not-a-real-id)" };
  var out = serialize.messagesToLlmInput([message], { resolveRecord: recordResolver({}) });
  assert.strictEqual(out[0], message, "regex never matched, same object");
});

test("anchor 3: no reliable text + vision on upgrades the string to a parts array", function () {
  var messages = [{ role: "user", content: "看这里 " + ANCHOR + " 结束" }];
  var out = serialize.messagesToLlmInput(messages, {
    visionEnabled: true,
    resolveRecord: recordResolver({ "ast_aaaabbbbccccdddd": { id: ANCHOR_ID, kind: "screenshot" } }),
    images: { "ast_aaaabbbbccccdddd": { base64: PNG_BASE64 } },
  });
  var content = out[0].content;
  assert.ok(Array.isArray(content), "multimodal message");
  assert.deepStrictEqual(content[0], { type: "text", text: "看这里 " });
  assert.deepStrictEqual(content[1], { type: "text", text: anchorText(ANCHOR_ID) });
  assert.deepStrictEqual(content[2], { type: "image_url", image_url: { url: DATA_URL } });
  assert.deepStrictEqual(content[3], { type: "text", text: " 结束" });
  assert.strictEqual(out.visionUsed, 1);
});

test("anchor 3b: vision on but unreadable bytes degrade to the page-aware anchor", function () {
  // textbook-figure records have no file, so the resolver yields nothing — the
  // page still has to survive, otherwise the tutor cannot refer to the figure.
  var out = serialize.messagesToLlmInput([{ role: "user", content: ANCHOR }], {
    visionEnabled: true,
    resolveRecord: recordResolver({ "ast_aaaabbbbccccdddd": { id: ANCHOR_ID, kind: "textbook-figure", ref: { bookId: "b", page: 12, rect: [0, 0, 1, 1] } } }),
  });
  assert.strictEqual(out[0].content, "![教材 第 12 页插图](asset://" + ANCHOR_ID + ")");
  assert.strictEqual(out.visionUsed, 0);
});

test("anchor 4: low-confidence OCR + vision off degrades to the placeholder", function () {
  var out = serialize.messagesToLlmInput([{ role: "user", content: ANCHOR }], {
    visionEnabled: false,
    ocrThreshold: 0.6,
    resolveRecord: recordResolver({
      "ast_aaaabbbbccccdddd": { id: ANCHOR_ID, kind: "screenshot", ocrText: "低置信文本", ocrConfidence: 0.2 },
    }),
  });
  assert.strictEqual(out[0].content, "[图片: 未识别]");
});

test("anchor 4b: high-confidence OCR flattens without any vision", function () {
  var out = serialize.messagesToLlmInput([{ role: "user", content: ANCHOR }], {
    ocrThreshold: 0.6,
    resolveRecord: recordResolver({
      "ast_aaaabbbbccccdddd": { id: ANCHOR_ID, kind: "screenshot", ocrText: "x = (-b ± √(b²-4ac)) / 2a", ocrConfidence: 0.91 },
    }),
  });
  assert.strictEqual(out[0].content, "![x = (-b ± √(b²-4ac)) / 2a](asset://" + ANCHOR_ID + ")");
});

test("anchor 5: svg records take the text channel via their semantic title", function () {
  var out = serialize.messagesToLlmInput([{ role: "assistant", content: "见 " + ANCHOR }], {
    visionEnabled: true,
    resolveRecord: recordResolver({
      "ast_aaaabbbbccccdddd": { id: ANCHOR_ID, kind: "svg", svgTitle: "时序图：三次握手" },
    }),
  });
  assert.strictEqual(out[0].content, "见 ![时序图：三次握手](asset://" + ANCHOR_ID + ")");
});

test("anchor 6: the per-turn image budget also covers string anchors", function () {
  var content = ANCHOR + " 和 " + "![图片](asset://ast_bbbbccccddddeeee)";
  var out = serialize.messagesToLlmInput([{ role: "user", content: content }], {
    visionEnabled: true,
    maxImagesPerTurn: 1,
    resolveRecord: recordResolver({
      "ast_aaaabbbbccccdddd": { id: ANCHOR_ID, kind: "screenshot" },
      "ast_bbbbccccddddeeee": { id: "ast_bbbbccccddddeeee", kind: "screenshot" },
    }),
    images: {
      "ast_aaaabbbbccccdddd": { base64: PNG_BASE64 },
      "ast_bbbbccccddddeeee": { base64: PNG_BASE64 },
    },
  });
  var parts = out[0].content;
  assert.ok(Array.isArray(parts));
  var imageParts = parts.filter(function (part) { return part.type === "image_url"; });
  assert.strictEqual(imageParts.length, 1);
  // the budget goes to the later anchor; the earlier one degrades in place
  assert.strictEqual(parts[0].text, "[图片: 未识别]");
  assert.strictEqual(parts[parts.length - 1].type, "image_url");
  assert.strictEqual(out.visionUsed, 1);
});

test("anchor 7: no resolver at all degrades every anchor to the placeholder", function () {
  var out = serialize.messagesToLlmInput([{ role: "user", content: ANCHOR }], { visionEnabled: true });
  assert.strictEqual(out[0].content, "[图片: 未识别]");
});

// ---- figureCatalogue: the ids the tutor may echo back into its own reply ----
function withIndex(fake, fn) {
  var previous = global.__ASSETS_INDEX__;
  global.__ASSETS_INDEX__ = fake;
  try { return fn(); } finally {
    if (previous === undefined) delete global.__ASSETS_INDEX__;
    else global.__ASSETS_INDEX__ = previous;
  }
}

function fakeIndex(records) {
  var calls = [];
  return {
    calls: calls,
    get: function (id) {
      var hit = records.filter(function (record) { return record.id === id && !record.deleted; })[0];
      return hit || null;
    },
    list: function (filter, scope) {
      calls.push({ filter: filter, scope: scope });
      var kind = filter && filter.kind;
      var conversationId = filter && filter.conversationId;
      var limit = filter && filter.limit;
      var out = records.filter(function (record) {
        if (record.deleted) return false;
        if (kind && record.kind !== kind) return false;
        if (conversationId && record.conversationId !== conversationId) return false;
        return true;
      });
      return limit ? out.slice(0, limit) : out;
    },
  };
}

test("catalogue 1: no index global still ships the ordering guide", function () {
  var block = serialize.figureCatalogue({ conversationId: "c1" });
  assert.ok(block.indexOf("## 插图（配角：主体是知识点）") === 0, block);
  assert.ok(block.indexOf("book://") > 0, "the crop form must be taught: " + block);
  assert.ok(block.indexOf("```svg") > 0, "the draw form must be taught: " + block);
  assert.ok(block.indexOf("## 可引用的现成图（复用清单，不是待办）") < 0, "no list when there is nothing to cite");
  assert.ok(block.indexOf("<!-- title:") > 0, "the svg title convention must be taught");
  assert.ok(block.indexOf("viewBox") > 0);
  assert.ok(block.indexOf("96KB") > 0 || block.indexOf("96 KB") > 0, "the size ceiling must be taught");
});

test("catalogue 1b: the guide names the current textbook when known", function () {
  var block = serialize.figureCatalogue({ conversationId: "c1", textbookId: "KUbm" });
  assert.ok(block.indexOf("book://KUbm/p174") > 0, block);
  var unnamed = serialize.figureCatalogue({ conversationId: "c1" });
  assert.ok(unnamed.indexOf("默认当前教材") > 0, unnamed);
});

test("catalogue 2: a conversation without figures falls back to the world, an empty world stays empty", function () {
  withIndex(fakeIndex([{ id: ANCHOR_ID, kind: "textbook-figure", conversationId: "other", ref: { page: 3 } }]), function () {
    var block = serialize.figureCatalogue({ conversationId: "c1" });
    assert.ok(block.indexOf("asset://" + ANCHOR_ID) > 0, "an earlier chat's figure is still citable: " + block);
  });
  withIndex(fakeIndex([{ id: ANCHOR_ID, kind: "screenshot", conversationId: null }]), function () {
    var screenshotsOnly = serialize.figureCatalogue({ conversationId: "c1" });
    assert.ok(screenshotsOnly.indexOf("## 可引用的现成图（复用清单，不是待办）") < 0, "screenshots are not figures");
    assert.ok(screenshotsOnly.indexOf("## 插图（配角：主体是知识点）") === 0);
    assert.ok(serialize.figureCatalogue({}).indexOf("## 插图（配角：主体是知识点）") === 0);

  // The guide must carry the *timing* policy, not only the syntax: the model was
  // never told when to reach for a figure, which is why figures stayed rare.
  var guideZh = serialize.figureCatalogue({ conversationId: "c1" });
  assert.ok(guideZh.indexOf("该配") > 0 && guideZh.indexOf("不必配") > 0, "zh guide needs a when-to / when-not policy");
  assert.ok(guideZh.indexOf("主动配一张") > 0, "zh guide must ask for a proactive figure");
  assert.ok(guideZh.indexOf("不要只写") > 0, "zh guide must crop a figure it merely mentions");
  // The rule alone was not enough: the tutor still wrote "见图 4-30" with no order twice in a
  // row, so the guide must make it a self-check and name the single allowed exception.
  assert.ok(guideZh.indexOf("必须自查") > 0 || guideZh.indexOf("自查：") > 0, "zh guide needs the self-check");
  assert.ok(serialize.figureCatalogue({ conversationId: "c1", lang: "english" }).indexOf("Self-check:") > 0, "en guide needs the self-check");
  assert.ok(guideZh.indexOf("每轮最多 4 张新图") > 0, "zh guide keeps the per-turn budget");
  // The model sees `[图片: …]` in its own history (the serialized form) and imitates it,
  // which persists a dead placeholder with no asset.  The guide must warn about it.
  assert.ok(guideZh.indexOf("本来就是") > 0 && guideZh.indexOf("简写") > 0, "zh guide must say the history form is the anchor, not the placeholder");
  var guideEn = serialize.figureCatalogue({ conversationId: "c1", lang: "english" });
  assert.ok(guideEn.indexOf("Do order one") > 0 && guideEn.indexOf("Do not:") > 0, "en guide needs the same policy");
  assert.ok(guideEn.indexOf("do not just write") > 0, "en guide must crop a figure it merely mentions");
  assert.ok(guideEn.indexOf("copy that anchor") > 0, "en guide needs the same history-form note");
  assert.ok(guideEn.indexOf("at most 4 new figures") > 0, "en guide keeps the per-turn budget");
  });
});

test("catalogue 3: figures become ready-to-copy anchors with their page", function () {
  withIndex(fakeIndex([{ id: ANCHOR_ID, kind: "textbook-figure", conversationId: "c1", ref: { bookId: "b", page: 174 } }]), function () {
    var block = serialize.figureCatalogue({ conversationId: "c1", profileId: "p", worldId: "w" });
    assert.ok(block.indexOf("## 可引用的现成图（复用清单，不是待办）") === 0, block);
    assert.ok(block.indexOf("![图 p.174](asset://" + ANCHOR_ID + ")") > 0, block);
    assert.ok(block.indexOf("asset://") > 0);
    assert.ok(block.indexOf("不要每轮都贴") > 0);
  });
});

test("catalogue 4: english gets the english header and page wording", function () {
  withIndex(fakeIndex([{ id: ANCHOR_ID, kind: "textbook-figure", conversationId: "c1", ref: { page: 7 } }]), function () {
    var block = serialize.figureCatalogue({ conversationId: "c1", lang: "english" });
    assert.ok(block.indexOf("## Figures you may cite (reusable, not a to-do)") === 0, block);
    assert.ok(block.indexOf("page 7: ![figure p.7](asset://" + ANCHOR_ID + ")") > 0, block);
  });
});

test("catalogue 5: caption is carried, a caption-less figure still works", function () {
  withIndex(fakeIndex([
    { id: ANCHOR_ID, kind: "textbook-figure", conversationId: "c1", ref: { page: 12 }, caption: "  图 4-10 预测分析表  " },
    { id: "ast_bbbbccccddddeeee", kind: "textbook-figure", conversationId: "c1", ref: { page: 13 } },
    { id: "ast_ccccddddeeeeffff", kind: "textbook-figure", conversationId: "c1", ref: {} },
  ]), function () {
    var block = serialize.figureCatalogue({ conversationId: "c1" });
    assert.ok(block.indexOf("（图 4-10 预测分析表）") > 0, block);
    assert.ok(block.indexOf("第 13 页") > 0, block);
    assert.ok(block.indexOf("![图](asset://ast_ccccddddeeeeffff)") > 0, "a ref without a page keeps a generic label");
  });
});

test("catalogue 6: conversation figures first, world fallback second, hard cap", function () {
  var many = [];
  for (var i = 0; i < 20; i += 1) {
    many.push({ id: "ast_" + String(i).padStart(16, "0"), kind: "textbook-figure", conversationId: "c1", ref: { page: i + 1 } });
  }
  many.push({ id: "ast_ffffffffffffffff", kind: "textbook-figure", conversationId: "other", ref: { page: 99 } });
  var index = fakeIndex(many);
  withIndex(index, function () {
    var block = serialize.figureCatalogue({ conversationId: "c1", profileId: "p1", worldId: "w1" });
    assert.strictEqual(index.calls.length, 1, "a full conversation list needs no fallback query");
    assert.strictEqual(index.calls[0].filter.kind, "textbook-figure");
    assert.strictEqual(index.calls[0].filter.conversationId, "c1");
    assert.strictEqual(index.calls[0].filter.limit, 6);
    assert.strictEqual(index.calls[0].scope.profileId, "p1");
    assert.strictEqual(index.calls[0].scope.worldId, "w1");
    // Count real anchors only: the guide itself shows the `asset://ast_…` placeholder.
    assert.strictEqual((block.match(/asset:\/\/ast_[0-9a-f]{16}/g) || []).length, 6, "the block never exceeds the cap");
  });

  // a conversation with one figure still gets the world's newest as filler, once each
  var index2 = fakeIndex([
    { id: "ast_0000000000000001", kind: "textbook-figure", conversationId: "c1", ref: { page: 10 } },
    { id: "ast_0000000000000002", kind: "textbook-figure", conversationId: "other", ref: { page: 20 } },
    { id: "ast_0000000000000002", kind: "textbook-figure", conversationId: "other", ref: { page: 20 } },
  ]);
  withIndex(index2, function () {
    var block = serialize.figureCatalogue({ conversationId: "c1" });
    assert.strictEqual(index2.calls.length, 2, "a short conversation list falls back to the world");
    assert.strictEqual(index2.calls[1].filter.conversationId, undefined);
    assert.strictEqual((block.match(/asset:\/\/ast_[0-9a-f]{16}/g) || []).length, 2, block);
    assert.ok(block.indexOf("ast_0000000000000001") > 0 && block.indexOf("ast_0000000000000002") > 0);
  });
});

test("catalogue 7: a throwing index degrades to the ordering guide", function () {
  withIndex({ list: function () { throw new Error("boom"); } }, function () {
    assert.ok(serialize.figureCatalogue({ conversationId: "c1" }).indexOf("## 插图（配角：主体是知识点）") === 0);
  });
});

test("catalogue 8: the byte budget prefers the newest anchors, not the oldest", function () {
  var OLD = "ast_aaaabbbbccccdddd";
  var NEW = "ast_bbbbccccddddeeee";
  var records = {};
  records[OLD] = { id: OLD, kind: "screenshot" };
  records[NEW] = { id: NEW, kind: "screenshot" };
  var images = {};
  images[OLD] = { base64: PNG_BASE64 };
  images[NEW] = { base64: PNG_BASE64 };
  var out = serialize.messagesToLlmInput([
    { role: "user", content: "![图片](asset://" + OLD + ")" },
    { role: "assistant", content: "嗯" },
    { role: "user", content: "![图片](asset://" + NEW + ") 这张呢" },
  ], { visionEnabled: true, maxImagesPerTurn: 1, resolveRecord: recordResolver(records), images: images });
  assert.strictEqual(typeof out[0].content, "string", "the oldest anchor degrades to text");
  assert.strictEqual(out[0].content, "[图片: 未识别]");
  assert.ok(Array.isArray(out[2].content), "the newest anchor keeps its parts");
  var imageParts = out[2].content.filter(function (part) { return part.type === "image_url"; });
  assert.strictEqual(imageParts.length, 1);
  assert.strictEqual(out.visionUsed, 1);
});

test("catalogue 9: structured blocks obey the same newest-first budget", function () {
  var OLD = "ast_aaaabbbbccccdddd";
  var NEW = "ast_bbbbccccddddeeee";
  var records = {};
  records[OLD] = { id: OLD, kind: "screenshot" };
  records[NEW] = { id: NEW, kind: "screenshot" };
  var images = {};
  images[OLD] = { base64: PNG_BASE64 };
  images[NEW] = { base64: PNG_BASE64 };
  var out = serialize.messagesToLlmInput([
    { role: "user", content: [{ type: "image", assetId: OLD }] },
    { role: "user", content: [{ type: "image", assetId: NEW }] },
  ], { visionEnabled: true, maxImagesPerTurn: 1, resolveRecord: recordResolver(records), images: images });
  assert.strictEqual(out[0].content, "[图片: 未识别]");
  assert.strictEqual(out[1].content[0].text, anchorText(NEW));
  assert.strictEqual(out[1].content[1].type, "image_url");
});

test("catalogue 10: with vision off the budget order is irrelevant", function () {
  var OLD = "ast_aaaabbbbccccdddd";
  var out = serialize.messagesToLlmInput([{ role: "user", content: "![图片](asset://" + OLD + ")" }], {
    visionEnabled: false,
    resolveRecord: recordResolver({}),
    images: {},
  });
  assert.strictEqual(out[0].content, "[图片: 未识别]");
  assert.strictEqual(out.visionUsed, 0);
});

test("catalogue 11: a screenshot pasted in the transcript is citable too", function () {
  // The screenshot has no conversationId (that field only exists for figures), so
  // the only way the tutor can cite it back is by finding the anchor in messages.
  var index = fakeIndex([
    { id: "ast_00000000000000aa", kind: "screenshot", conversationId: null, width: 1013, height: 1289 },
    { id: "ast_00000000000000bb", kind: "textbook-figure", conversationId: "c1", ref: { page: 174 } },
  ]);
  withIndex(index, function () {
    var block = serialize.figureCatalogue({
      conversationId: "c1",
      messages: [
        { role: "user", content: "![图片](asset://ast_00000000000000aa) 这张" },
        { role: "assistant", content: "嗯" },
      ],
    });
    assert.ok(block.indexOf("截图：![截图](asset://ast_00000000000000aa)") > 0, block);
    assert.ok(block.indexOf("第 174 页") > 0, block);
    assert.strictEqual((block.match(/asset:\/\/ast_[0-9a-f]{16}/g) || []).length, 2, "each picture once");
  });
  // an unknown / deleted anchor id is skipped instead of throwing
  withIndex(fakeIndex([{ id: "ast_00000000000000bb", kind: "textbook-figure", conversationId: "c1", ref: { page: 1 } }]), function () {
    var block = serialize.figureCatalogue({
      conversationId: "c1",
      messages: [{ role: "user", content: "![图片](asset://ast_ffffffffffffffff)" }],
    });
    assert.ok(block.indexOf("ast_ffffffffffffffff") < 0, block);
  });
});

// The rules are what the model reads first; they must point at the guide block so a
// normal conversation does not depend on the learner asking for a figure.
test("the classroom rules point at the figure guide", function () {
  var rulesDir = path.join(__dirname, "..", "..", "..", "rules");
  ["rules_zh.md", "rules_zh_classroom_compact.md"].forEach(function (name) {
    var text = fs.readFileSync(path.join(rulesDir, name), "utf8");
    assert.ok(text.indexOf("插图下单") > 0, name + " must point at the 插图下单 block");
    assert.ok(text.indexOf("主动") > 0, name + " must ask for a proactive figure");
  });
  var en = fs.readFileSync(path.join(rulesDir, "rules_en_classroom_compact.md"), "utf8");
  assert.ok(en.indexOf("Ordering a figure") > 0, "en rules must point at the guide");
});

console.log("");
var passed = results.filter(function (r) { return r.ok; }).length;
var failed = results.length - passed;
test("catalogue 10: the current book's figures come first, another book's are labelled", function () {
  // Live bug: a web-deck crop (book KUao) was listed inside a 编译原理 chat (KUyw) with no
  // marker, so the model cited the web figure as if it belonged to the textbook.
  var index = fakeIndex([
    { id: "ast_000000000000000a", kind: "textbook-figure", conversationId: "other", ref: { bookId: "KUao", page: 162 } },
    { id: "ast_000000000000000b", kind: "textbook-figure", conversationId: "other", ref: { bookId: "KUyw", page: 162 } },
  ]);
  withIndex(index, function () {
    var block = serialize.figureCatalogue({ conversationId: "c1", textbookId: "KUyw" });
    var foreign = block.indexOf("ast_000000000000000a");
    var own = block.indexOf("ast_000000000000000b");
    assert.ok(own > 0 && foreign > own, "the current book's figure must come first: " + block);
    assert.strictEqual((block.match(/另一本书/g) || []).length, 1, "exactly the foreign figure is labelled: " + block);
  });
});

test("catalogue 11: without a known book nothing is labelled-foreign", function () {
  var index = fakeIndex([
    { id: "ast_000000000000000a", kind: "textbook-figure", conversationId: "other", ref: { bookId: "KUao", page: 3 } },
  ]);
  withIndex(index, function () {
    var block = serialize.figureCatalogue({ conversationId: "c1" });
    assert.ok(block.indexOf("ast_000000000000000a") > 0);
    assert.strictEqual((block.match(/另一本书/g) || []).length, 0, block);
  });
});

console.log("assets-serialize: " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
