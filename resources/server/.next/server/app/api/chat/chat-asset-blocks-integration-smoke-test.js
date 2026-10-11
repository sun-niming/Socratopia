// chat-asset-blocks-integration-smoke-test.js — proves the /api/chat route turns
// structured image blocks into LLM input per plan §5.4, and that legacy string
// messages are untouched.
//
// Runs the REAL server against a mock provider, so it covers the compiled route
// patch (lib/assets/serialize.js is unit-tested separately in
// resources/server/lib/assets/assets-serialize-smoke-test.js).
//
// Run by hand (the matrix skips .next/):
//   node resources/server/.next/server/app/api/chat/chat-asset-blocks-integration-smoke-test.js
"use strict";

var fs = require("fs");
var path = require("path");

var { TestEnvironment } = require(path.join(__dirname, "..", "..", "..", "..", "..", "smoke-test-utils.js"));

var results = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: ok });
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (ok ? "" : "  -> " + detail));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function crc32(buffer) {
  var table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (var n = 0; n < 256; n += 1) {
      var c = n;
      for (var k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  var crc = 0xffffffff;
  for (var i = 0; i < buffer.length; i += 1) crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  var typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

// A real 32x16 PNG so sharp can actually decode it and mint a thumbnail.
function makePng() {
  var zlib = require("zlib");
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(32, 0);
  ihdr.writeUInt32BE(16, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  var raw = Buffer.alloc((32 * 3 + 1) * 16);
  for (var y = 0; y < 16; y += 1) raw[y * (32 * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

var SEQ = 0;
function seedCase(env) {
  SEQ += 1;
  var textbookId = "assets-" + SEQ;
  var conversationId = "assets-conversation-" + SEQ;
  var baseDir = path.join(env.tmpDir, "accounts", "test", "profiles", "test", "worlds", "test");
  var indexPath = path.join(baseDir, "textbooks", "textbook_index.json");
  var index = { worldId: "test", textbooks: [] };
  try { index = JSON.parse(fs.readFileSync(indexPath, "utf8")); } catch (_) {}
  index.worldId = "test";
  index.textbooks = (Array.isArray(index.textbooks) ? index.textbooks : []).filter(function (book) {
    return !book || book.id !== textbookId;
  });
  index.textbooks.push({ id: textbookId, title: "Assets " + textbookId, currentPage: 1, numPages: 2, format: "markdown" });
  write(indexPath, JSON.stringify(index, null, 2));
  write(path.join(baseDir, "textbooks", textbookId, "pages.json"), JSON.stringify({
    format: "markdown",
    pages: [{ pageNum: 1, title: "Page one" }, { pageNum: 2, title: "Page two" }],
  }, null, 2));
  write(path.join(baseDir, "textbooks", textbookId, "progress_state.json"), JSON.stringify({
    schemaVersion: 3, textbookId: textbookId, sourceConversationId: conversationId,
    loadedCursor: { startPage: 1, endPage: 1 }, currentPage: 1,
  }, null, 2));
  write(path.join(baseDir, "world_meta.json"), JSON.stringify({
    worldId: "test", language: "chinese",
    companions: [{ candidateId: "fixture_a", name: "赛飞儿", companionInstanceId: "ci_aaaaaaaaaaaaaaaa" }, null, null, null],
  }, null, 2));
  write(path.join(baseDir, "npc_a.md"), "# 赛飞儿\n\n聪明、爱玩。", "utf8");
  write(path.join(baseDir, "relation_npc_a.md"), "", "utf8");
  write(path.join(baseDir, "conversations", conversationId, "current_reading.md"), "<!-- startPage: 1 endPage: 1 -->\n# Page one\nFixture content.");
  write(path.join(baseDir, "chats", conversationId + ".json"), JSON.stringify({ id: conversationId, messages: [] }, null, 2));
  return { textbookId: textbookId, conversationId: conversationId, turn: 0 };
}

function requestBody(fixture, userContent) {
  fixture.turn += 1;
  var clientTurnId = "asset-turn-" + fixture.textbookId + "-" + fixture.turn;
  // The client-side "sanitized" view of this turn; only the shape matters here.
  var sanitized = typeof userContent === "string"
    ? userContent
    : userContent.map(function (block) {
      return block && block.type === "text" ? block.text : "[图片]";
    }).join("\n");
  return {
    messages: [
      { role: "assistant", content: "Previous teaching reply." },
      { role: "user", content: userContent },
    ],
    apiKey: "mock-key",
    provider: "openai",
    model: "mock",
    character: "npc_a",
    profileId: "test",
    worldId: "test",
    textbookId: fixture.textbookId,
    conversationId: fixture.conversationId,
    teachingLanguage: "chinese",
    // The route rejects older clients with %%CLIENT_REFRESH_REQUIRED%%; the
    // auto-advance runtime requires protocolVersion 2 on both fields.
    advanceProtocolVersion: 2,
    clientTurnId: clientTurnId,
    assistantMessageId: "assistant-" + clientTurnId,
    turnEnvelope: {
      protocolVersion: 2,
      accountId: "test",
      profileId: "test",
      worldId: "test",
      textbookId: fixture.textbookId,
      conversationId: fixture.conversationId,
      clientTurnId: clientTurnId,
      baseCausalConversationRevision: 0,
      baseReadingVersion: 0,
      parentAssistantMessageId: null,
      sanitizedUserContent: sanitized,
      readingAction: null,
    },
  };
}

// Every user message ever sent to the provider, as a plain string, so an
// assertion does not care whether the route collapsed it or kept parts.
function userTexts(env) {
  var out = [];
  env.mockLLM.requests.forEach(function (request) {
    (request.messages || []).forEach(function (message) {
      if (!message || message.role !== "user") return;
      if (typeof message.content === "string") out.push(message.content);
      else if (Array.isArray(message.content)) {
        out.push(message.content.map(function (part) {
          return part && part.type === "text" ? part.text : part && part.type === "image_url" ? "[[IMAGE_URL]]" : "";
        }).join("\n"));
      }
    });
  });
  return out;
}

function rawUserParts(env) {
  var out = [];
  env.mockLLM.requests.forEach(function (request) {
    (request.messages || []).forEach(function (message) {
      if (message && message.role === "user" && Array.isArray(message.content)) out.push(message.content);
    });
  });
  return out;
}

async function send(env, fixture, content, auth, label) {
  env.mockLLM.resetRequests();
  env.mockLLM.setResponse({ choices: [{ message: { content: "ok" } }] });
  var response = await env.postSSE("/api/chat", requestBody(fixture, content), auth);
  if (process.env.ASSET_TEST_DEBUG) {
    console.log("    [debug:" + label + "] status=" + response.status + " mock=" + env.mockLLM.requests.length +
      " raw=" + String(response.raw || "").slice(0, 260).replace(/\n+/g, " "));
  }
  return response;
}

async function visionOffRun() {
  var env = new TestEnvironment({ silent: true });
  try {
    await env.setup();
    var auth = { Authorization: env.capabilityHeader() };

    // Each case gets its own conversation: a fresh conversation has revision 0,
    // which is what the envelope pins (the first turn of a conversation).
    // --- legacy string message: must pass through untouched -------------------
    var legacy = "这是一条纯文本历史消息 😀";
    var legacyResponse = await send(env, seedCase(env), legacy, auth, "legacy");
    check("legacy string message still reaches the provider byte-identically",
      legacyResponse.status === 200 && userTexts(env).indexOf(legacy) !== -1,
      "status=" + legacyResponse.status + " texts=" + JSON.stringify(userTexts(env).slice(-3)));

    // --- image block WITH caption: flatten to text, no multimodal part --------
    var captionResponse = await send(env, seedCase(env), [
      { type: "text", text: "这张图里第二步的响应为什么也是异步的？" },
      { type: "image", assetId: "ast_0123456789abcdef", caption: "图 12-10 双向异步消息通信模式" },
    ], auth, "caption");
    var texts = userTexts(env);
    check("captioned image block is flattened to a citable anchor",
      captionResponse.status === 200 &&
        texts.some(function (t) { return t.indexOf("这张图里第二步") === 0 && /!\[图 12-10 双向异步消息通信模式\]\(asset:\/\/ast_[0-9a-f]{16}\)/.test(t); }),
      "status=" + captionResponse.status + " texts=" + JSON.stringify(texts.slice(-2)) +
        " raw=" + String(captionResponse.raw || "").slice(0, 200));
    check("no multimodal part is emitted while vision is off", rawUserParts(env).length === 0,
      "parts=" + JSON.stringify(rawUserParts(env)));

    // --- image block WITHOUT caption: placeholder ----------------------------
    var blankResponse = await send(env, seedCase(env), [
      { type: "text", text: "看这张图" },
      { type: "image", assetId: "ast_0000000000000001" },
    ], auth, "blank");
    var blankTexts = userTexts(env);
    check("captionless image block degrades to [图片: 未识别] with vision off",
      blankResponse.status === 200 && blankTexts.some(function (t) { return t.indexOf("[图片: 未识别]") !== -1; }),
      "status=" + blankResponse.status + " texts=" + JSON.stringify(blankTexts.slice(-2)) +
        " raw=" + String(blankResponse.raw || "").slice(0, 200));

    // --- string anchor with a captioned record: flatten inline -----------------
    // The frontend inserts `![图片](asset://<id>)` as plain text (report §4.2),
    // so the string path must walk the same confidence ladder (review T10b).
    var captioned = await env.post("/api/assets?profileId=test&worldId=test", {
      kind: "screenshot", pngBase64: makePng().toString("base64"),
      caption: "图 12-10 双向异步消息通信模式",
    }, auth);
    var captionedId = null;
    try { captionedId = JSON.parse(captioned.body).assetId; } catch (_) {}
    check("captioned asset created for the string-anchor run", captioned.status === 201 && !!captionedId,
      "status=" + captioned.status + " body=" + String(captioned.body || "").slice(0, 200));

    var anchorResponse = await send(env, seedCase(env),
      "这张图的第二步为什么也是异步的？![图片](asset://" + captionedId + ")", auth, "string-anchor");
    var anchorTexts = userTexts(env);
    check("string asset:// anchor flattens to a citable anchor inline",
      anchorResponse.status === 200 && anchorTexts.some(function (t) {
        return /!\[图 12-10 双向异步消息通信模式\]\(asset:\/\/ast_[0-9a-f]{16}\)/.test(t) && t.indexOf("[图片: ") === -1;
      }),
      "status=" + anchorResponse.status + " texts=" + JSON.stringify(anchorTexts.slice(-2)) +
        " raw=" + String(anchorResponse.raw || "").slice(0, 200));

    // --- string anchor with an unknown id: placeholder, nothing leaks ----------
    var missingResponse = await send(env, seedCase(env),
      "看这里 ![图片](asset://ast_0000000000000000)", auth, "string-anchor-missing");
    var missingTexts = userTexts(env);
    check("unknown string anchor degrades to [图片: 未识别]",
      missingResponse.status === 200 && missingTexts.some(function (t) {
        return t.indexOf("[图片: 未识别]") !== -1 && t.indexOf("asset://") === -1;
      }),
      "status=" + missingResponse.status + " texts=" + JSON.stringify(missingTexts.slice(-2)));

    check("no asset-layer error was logged", String(env.serverStderr || "").indexOf("[assets] message serialization failed") === -1,
      String(env.serverStderr || "").slice(-400));
  } finally {
    try { await env.teardown(); } catch (_) {}
  }
}

async function visionOnRun() {
  var env = new TestEnvironment({ silent: true, set: { assets: { visionEnabled: true, maxImagesPerTurn: 2 } } });
  try {
    await env.setup();
    var fixture = seedCase(env);
    var auth = { Authorization: env.capabilityHeader() };

    // Real asset, no caption, so the vision branch is the only option.
    var png = makePng();
    var created = await env.post("/api/assets?profileId=test&worldId=test", {
      kind: "screenshot", pngBase64: png.toString("base64"),
    }, auth);
    var assetId = null;
    try { assetId = JSON.parse(created.body).assetId; } catch (_) {}
    check("asset created for the vision run", created.status === 201 && /^ast_[0-9a-f]{16}$/.test(assetId || ""),
      "status=" + created.status + " body=" + created.body.slice(0, 200));

    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: "ok" } }] });
    var body = requestBody(fixture, [{ type: "text", text: "看这张图" }, { type: "image", assetId: assetId }]);
    var response = await env.postSSE("/api/chat", body, auth);

    var parts = rawUserParts(env);
    var imagePart = null;
    parts.forEach(function (list) {
      list.forEach(function (part) {
        if (part && part.type === "image_url") imagePart = part;
      });
    });
    check("captionless image block becomes an image_url content part when vision is on",
      response.status === 200 && !!imagePart && /^data:image\/(png|jpeg);base64,/.test(imagePart.image_url.url),
      "status=" + response.status + " parts=" + JSON.stringify(parts).slice(0, 300));

    check("the inlined bytes are a real payload", !!imagePart && imagePart.image_url.url.length > 200,
      "urlLen=" + (imagePart ? imagePart.image_url.url.length : 0));

    // --- string anchor + vision on: upgrades the string to a parts array -------
    // Fresh conversation: the envelope pins revision 0, so the fixture from the
    // blocks turn above is stale by now.
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: "ok" } }] });
    var anchorBody = requestBody(seedCase(env), "看这张图 ![图片](asset://" + assetId + ")");
    var anchorResponse = await env.postSSE("/api/chat", anchorBody, auth);
    var anchorParts = rawUserParts(env);
    var anchorImage = null;
    anchorParts.forEach(function (list) {
      list.forEach(function (part) {
        if (part && part.type === "image_url") anchorImage = part;
      });
    });
    check("captionless string anchor becomes an image_url part when vision is on",
      anchorResponse.status === 200 && !!anchorImage && /^data:image\/(png|jpeg);base64,/.test(anchorImage.image_url.url),
      "status=" + anchorResponse.status + " parts=" + JSON.stringify(anchorParts).slice(0, 300) +
        " texts=" + JSON.stringify(userTexts(env).slice(-2)));

    check("server logs the vision serialization",
      String(env.serverStdout || "").indexOf("[assets] vision serialization") !== -1,
      "stdout tail=" + String(env.serverStdout || "").slice(-300));
  } finally {
    try { await env.teardown(); } catch (_) {}
  }
}

(async function main() {
  try {
    await visionOffRun();
    await visionOnRun();
  } catch (error) {
    check("harness completed", false, error && error.stack);
  }
  var failed = results.filter(function (r) { return !r.ok; }).length;
  console.log("");
  console.log("chat-asset-blocks-integration: " + (results.length - failed) + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();
