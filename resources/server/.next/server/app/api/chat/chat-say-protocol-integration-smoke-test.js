"use strict";

// Black-box test for the 【内联朗读标注 v1】 wiring in the compiled classroom route.
//
// Boots the real server.js against a mock provider and asserts, over HTTP:
//   * the prompt block is injected for a classroom turn with a catalog voice, in the turn's own
//     language branch, without touching the voice/emotion block
//   * an annotated formula reaches the reader as clean `text` and as a `speech_hint` event
//     carrying the clean-text anchor — and the hint is emitted BEFORE the text delta whose
//     sentence punctuation releases that formula (the §5.2 ordering the frontend depends on)
//   * clean text and hints are identical whether the provider frames the reply in one piece or
//     splits it every three characters
//   * a misplaced or unclosed annotation degrades to the deterministic pipeline and never
//     reaches the reader as markup
//   * voice/emotion and say offsets agree, and a legacy voice stays on the old behaviour
//
// Self-contained: local mock LLM, no real API key, no real user data.
// Matrix skips .next/, so run it by hand:
//   node resources/server/.next/server/app/api/chat/chat-say-protocol-integration-smoke-test.js

var fs = require("fs");
var path = require("path");
var workspaceRoot = path.resolve(__dirname, "..", "..", "..", "..", "..", "..", "..");
var TestEnvironment = require(path.join(workspaceRoot, "resources", "server", "smoke-test-utils.js")).TestEnvironment;

var results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name: name, ok: true });
  } catch (error) {
    results.push({ name: name, ok: false, error: String((error && error.message) || error) });
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function events(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .filter(function (line) { return line.indexOf("data: ") === 0; })
    .map(function (line) {
      try { return JSON.parse(line.slice(6)); } catch (_) { return null; }
    })
    .filter(Boolean);
}

function eventsOfType(raw, type) {
  return events(raw).filter(function (e) { return e.type === type; });
}

function hints(raw) {
  return eventsOfType(raw, "speech_hint");
}

function cleanText(raw) {
  return eventsOfType(raw, "text").map(function (e) { return e.text; }).join("");
}

// Position of the first SSE frame of `type` in the raw stream, for ordering assertions.
function frameIndex(raw, type) {
  var lines = String(raw || "").split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("data: ") !== 0) continue;
    try {
      if (JSON.parse(lines[i].slice(6)).type === type) return i;
    } catch (_) {}
  }
  return -1;
}

function teachingPrompt(env, userContent) {
  var matching = env.mockLLM.requests.filter(function (request) {
    return (request.messages || []).some(function (m) {
      return m && m.role === "user" && typeof m.content === "string" && m.content === userContent;
    });
  });
  if (!matching.length) throw new Error("no model request carried the student message");
  return matching[matching.length - 1].messages
    .filter(function (m) { return m && m.role === "system"; })
    .map(function (m) { return String(m.content || ""); })
    .join("\n\n");
}

var CASE_SEQ = 0;
function seedCase(env) {
  CASE_SEQ += 1;
  var textbookId = "say-" + CASE_SEQ;
  var conversationId = "say-conversation-" + CASE_SEQ;
  var baseDir = path.join(env.tmpDir, "accounts", "test", "profiles", "test", "worlds", "test");
  var indexPath = path.join(baseDir, "textbooks", "textbook_index.json");
  var index = { worldId: "test", textbooks: [] };
  try { index = JSON.parse(fs.readFileSync(indexPath, "utf8")); } catch (_) {}
  index.worldId = "test";
  index.textbooks = (Array.isArray(index.textbooks) ? index.textbooks : []).filter(function (book) {
    return !book || book.id !== textbookId;
  });
  index.textbooks.push({ id: textbookId, title: "Say " + textbookId, currentPage: 1, numPages: 2, format: "markdown" });
  write(indexPath, JSON.stringify(index, null, 2));
  write(path.join(baseDir, "textbooks", textbookId, "pages.json"), JSON.stringify({
    format: "markdown",
    pages: [{ pageNum: 1, title: "Page one" }, { pageNum: 2, title: "Page two" }]
  }, null, 2));
  write(path.join(baseDir, "textbooks", textbookId, "progress_state.json"), JSON.stringify({
    schemaVersion: 3, textbookId: textbookId, sourceConversationId: conversationId,
    loadedCursor: { startPage: 1, endPage: 1 }, currentPage: 1
  }, null, 2));
  write(path.join(baseDir, "world_meta.json"), JSON.stringify({
    worldId: "test", language: "chinese",
    companions: [{ candidateId: "fixture_a", name: "赛飞儿", companionInstanceId: "ci_aaaaaaaaaaaaaaaa" }, null, null, null]
  }, null, 2));
  write(path.join(baseDir, "npc_a.md"), "# 赛飞儿\n\n聪明、爱玩。", "utf-8");
  write(path.join(baseDir, "relation_npc_a.md"), "", "utf-8");
  write(path.join(baseDir, "conversations", conversationId, "current_reading.md"), "<!-- startPage: 1 endPage: 1 -->\n# Page one\nFixture content.");
  write(path.join(baseDir, "chats", conversationId + ".json"), JSON.stringify({ id: conversationId, messages: [] }, null, 2));
  return { baseDir: baseDir, textbookId: textbookId, conversationId: conversationId, turn: 0, userContent: null };
}

function requestBody(fixture, extra) {
  fixture.turn += 1;
  var clientTurnId = "say-turn-" + fixture.textbookId + "-" + fixture.turn;
  var userContent = "Please continue " + fixture.textbookId + " (turn " + fixture.turn + ").";
  fixture.userContent = userContent;
  return Object.assign({
    messages: [
      { role: "assistant", content: "Previous teaching reply." },
      { role: "user", content: userContent }
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
      sanitizedUserContent: userContent,
      readingAction: null
    }
  }, extra || {});
}

var ANNOTATED = "$P(A|B)$<say>p 条件下 a 的概率</say> 表示在 b 发生时 a 的概率。";
var ANNOTATED_CLEAN = "$P(A|B)$ 表示在 b 发生时 a 的概率。";
var ANCHOR_END = "$P(A|B)$".length;
var MIXED = '<voice emotion="happy">看 $x^2$<say>x 平方</say> 就够用了。</voice>';

async function run() {
  var env = new TestEnvironment();
  try {
    await env.setup();

    // --- 1. prompt injection + hint event on the happy path -----------------------------
    var fixture = seedCase(env);
    var body = requestBody(fixture, { voiceId: "cipher", emotionMode: "auto", emotionFixed: null });
    env.mockLLM.resetRequests();
    env.mockLLM.setStreamFrameSize(0);
    env.mockLLM.setResponse({ choices: [{ message: { content: ANNOTATED } }] });
    var response = await env.postSSE("/api/chat", body, { Authorization: env.capabilityHeader() });
    var raw = response.raw;

    check("the classroom turn carries the zh protocol block", function () {
      var prompt = teachingPrompt(env, fixture.userContent);
      if (prompt.indexOf("【内联朗读标注 v1】") < 0) throw new Error("say block missing from the system prompt");
      if (prompt.indexOf("<say>") < 0) throw new Error("grammar example missing");
      if (prompt.indexOf("句末标点之前") < 0) throw new Error("anchor rule missing");
      if (prompt.indexOf("【语音表达协议 v1】") < 0) throw new Error("the orthogonal voice block was lost");
    });

    check("a short trailing reminder is the last message sent to the model", function () {
      var matching = env.mockLLM.requests.filter(function (request) {
        return (request.messages || []).some(function (m) {
          return m && m.role === "user" && typeof m.content === "string" && m.content === fixture.userContent;
        });
      });
      if (!matching.length) throw new Error("no model request carried the student message");
      var messages = matching[matching.length - 1].messages;
      var last = messages[messages.length - 1];
      if (!last || last.role !== "system") throw new Error("the last message is not the reminder: " + (last && last.role));
      if (last.content.indexOf("[格式提醒]") < 0 || last.content.indexOf("<say>") < 0) {
        throw new Error("reminder content: " + JSON.stringify(last.content));
      }
      if (String(last.content).length > 120) throw new Error("the reminder must stay cheap: " + String(last.content).length);
      var lastUserIndex = -1;
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i] && messages[i].role === "user") { lastUserIndex = i; break; }
      }
      if (lastUserIndex < 0 || lastUserIndex !== messages.length - 2) {
        throw new Error("the reminder must sit right after the last user message, index " + lastUserIndex + " of " + messages.length);
      }
    });

    check("the annotation is stripped and the reader sees clean text", function () {
      if (response.status !== 200) throw new Error("status " + response.status);
      if (cleanText(raw) !== ANNOTATED_CLEAN) throw new Error("clean text drifted: " + JSON.stringify(cleanText(raw)));
      if (raw.indexOf("<say>") >= 0) throw new Error("control markup leaked into the stream");
      if (raw.indexOf("</say>") >= 0) throw new Error("control markup leaked into the stream");
    });

    check("the hint carries the anchor, the speech and the protocol version", function () {
      var found = hints(raw);
      if (found.length !== 1) throw new Error("expected exactly 1 hint, saw " + found.length);
      var hint = found[0];
      if (hint.protocol !== "say-protocol-v1") throw new Error("protocol: " + hint.protocol);
      if (hint.speech !== "p 条件下 a 的概率") throw new Error("speech: " + JSON.stringify(hint.speech));
      if (hint.anchorEnd !== ANCHOR_END) throw new Error("anchorEnd: " + hint.anchorEnd);
      if (!/^assistant-say-turn-.*:h0$/.test(hint.messageId + ":h0") && hint.messageId.indexOf("assistant-say-turn-") !== 0) {
        throw new Error("messageId: " + hint.messageId);
      }
      if (ANNOTATED_CLEAN.slice(hint.anchorEnd - 4, hint.anchorEnd) !== "$P(A|B)$".slice(-4)) {
        throw new Error("the anchor does not point at the formula close");
      }
    });

    check("the hint frame is emitted before the punctuation that releases the formula", function () {
      var hintAt = frameIndex(raw, "speech_hint");
      if (hintAt < 0) throw new Error("no hint frame");
      var textLines = String(raw).split(/\r?\n/);
      var punctuationAt = -1;
      for (var i = 0; i < textLines.length; i++) {
        if (textLines[i].indexOf("data: ") !== 0) continue;
        var frame;
        try { frame = JSON.parse(textLines[i].slice(6)); } catch (_) { continue; }
        if (frame.type === "text" && String(frame.text).indexOf("。") >= 0) { punctuationAt = i; break; }
      }
      if (punctuationAt < 0) throw new Error("no text frame carried the sentence punctuation");
      if (hintAt > punctuationAt) throw new Error("hint arrived after the sentence was released");
    });

    // A lesson has to be auditable afterwards: the hint and the parse notices must reach the
    // server log, otherwise "did it actually fire in production" is unanswerable from the log.
    await new Promise(function (resolve) { setTimeout(resolve, 300); });
    check("the emitted hint reaches the operator log", function () {
      var out = String(env.serverStdout || "");
      if (out.indexOf("[say] hint anchorEnd=" + ANCHOR_END) < 0) throw new Error("[say] hint line missing");
      if (out.indexOf("p 条件下 a 的概率") < 0) throw new Error("the accepted speech was not logged");
      // Both ends of the feature must be audible in the log: that the block went out at all, and
      // how many hints the turn produced (0 because none vs 0 because nothing ran).
      if (out.indexOf("[say] prompt injected lang=chinese") < 0) throw new Error("the injection was not logged");
      if (!/\[say\] turn hints=1 /.test(out)) throw new Error("the per-turn hint count was not logged");
    });

    // --- 2. frame-boundary independence through the real route --------------------------
    var splitFixture = seedCase(env);
    var splitBody = requestBody(splitFixture, { voiceId: "cipher", emotionMode: "auto", emotionFixed: null });
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: ANNOTATED } }] });
    env.mockLLM.setStreamFrameSize(3);
    var splitResponse = await env.postSSE("/api/chat", splitBody, { Authorization: env.capabilityHeader() });
    env.mockLLM.setStreamFrameSize(0);

    check("a reply split into 3-character frames parses identically", function () {
      if (splitResponse.status !== 200) throw new Error("status " + splitResponse.status);
      if (cleanText(splitResponse.raw) !== ANNOTATED_CLEAN) {
        throw new Error("clean text drifted: " + JSON.stringify(cleanText(splitResponse.raw)));
      }
      var a = hints(splitResponse.raw);
      if (a.length !== 1 || a[0].anchorEnd !== ANCHOR_END || a[0].speech !== "p 条件下 a 的概率") {
        throw new Error("hints drifted: " + JSON.stringify(a));
      }
      if (eventsOfType(splitResponse.raw, "text").length < 5) throw new Error("the reply was not delivered incrementally");
    });

    // --- 3. the english branch gets its own wording --------------------------------------
    var enFixture = seedCase(env);
    var enBody = requestBody(enFixture, { teachingLanguage: "english", voiceId: "cipher", emotionMode: "auto", emotionFixed: null });
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: "Read the page first." } }] });
    await env.postSSE("/api/chat", enBody, { Authorization: env.capabilityHeader() });

    check("an english turn gets the english block and not the zh one", function () {
      var prompt = teachingPrompt(env, enFixture.userContent);
      if (prompt.indexOf("【Inline speech annotation v1】") < 0) throw new Error("english block missing");
      if (prompt.indexOf("【内联朗读标注 v1】") >= 0) throw new Error("the zh block leaked into an english turn");
    });

    // --- 4. violations degrade without polluting the display -----------------------------
    var strayFixture = seedCase(env);
    var strayBody = requestBody(strayFixture, { voiceId: "cipher", emotionMode: "auto", emotionFixed: null });
    var strayReply = "$x$。<say>艾克斯</say> 后面还有字。";
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: strayReply } }] });
    var strayResponse = await env.postSSE("/api/chat", strayBody, { Authorization: env.capabilityHeader() });

    check("a say placed after the punctuation is stripped from the display", function () {
      if (cleanText(strayResponse.raw) !== "$x$。 后面还有字。") {
        throw new Error("clean text: " + JSON.stringify(cleanText(strayResponse.raw)));
      }
      if (hints(strayResponse.raw).length !== 0) throw new Error("a misplaced hint was published");
    });
    await new Promise(function (resolve) { setTimeout(resolve, 200); });
    check("a violation leaves an auditable notice", function () {
      if (String(env.serverStdout || "").indexOf("[say] notice stray_say") < 0) {
        throw new Error("the stray_say notice never reached the log");
      }
    });

    var unclosedFixture = seedCase(env);
    var unclosedBody = requestBody(unclosedFixture, { voiceId: "cipher", emotionMode: "auto", emotionFixed: null });
    var unclosedReply = "$x$<say>艾克斯 后面还有字。";
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: unclosedReply } }] });
    var unclosedResponse = await env.postSSE("/api/chat", unclosedBody, { Authorization: env.capabilityHeader() });

    check("an unclosed say is dropped and never published", function () {
      if (cleanText(unclosedResponse.raw) !== "$x$") {
        throw new Error("clean text: " + JSON.stringify(cleanText(unclosedResponse.raw)));
      }
      if (hints(unclosedResponse.raw).length !== 0) throw new Error("an unclosed say published a hint");
    });

    // --- 5. voice and say share one offset system ----------------------------------------
    var mixedFixture = seedCase(env);
    var mixedBody = requestBody(mixedFixture, { voiceId: "cipher", emotionMode: "auto", emotionFixed: null });
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: MIXED } }] });
    var mixedResponse = await env.postSSE("/api/chat", mixedBody, { Authorization: env.capabilityHeader() });

    check("a hint inside a voice segment lands in that segment's offset range", function () {
      var clean = cleanText(mixedResponse.raw);
      if (clean !== "看 $x^2$ 就够用了。") throw new Error("clean text: " + JSON.stringify(clean));
      var hint = hints(mixedResponse.raw)[0];
      if (!hint) throw new Error("no hint published");
      var deltas = eventsOfType(mixedResponse.raw, "speech_segment_delta");
      var owner = deltas.filter(function (d) { return d.start <= hint.anchorEnd && d.end >= hint.anchorEnd; })[0];
      if (!owner) throw new Error("the anchor falls outside every speech segment");
      if (clean.slice(hint.anchorEnd, hint.anchorEnd + 1) !== " ") {
        throw new Error("the anchor does not sit right after the formula");
      }
      deltas.forEach(function (d) {
        if (clean.slice(d.start, d.end) !== d.text) throw new Error("segment offsets drifted at " + d.start);
      });
    });

    // --- 6. a voice-less configuration stays consistent ----------------------------------
    var legacyFixture = seedCase(env);
    var legacyBody = requestBody(legacyFixture, { voiceId: "soft_girl", emotionMode: "auto", emotionFixed: null });
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: ANNOTATED } }] });
    var legacyResponse = await env.postSSE("/api/chat", legacyBody, { Authorization: env.capabilityHeader() });

    check("a legacy voice is told about say only when its parser is live", function () {
      var prompt = teachingPrompt(env, legacyFixture.userContent);
      var hinted = hints(legacyResponse.raw).length;
      // Either both are on (block injected, tags parsed) or both are off (no leak), never one.
      if (prompt.indexOf("【内联朗读标注 v1】") >= 0 !== hinted > 0) {
        throw new Error("prompt block and parser disagree: block=" + (prompt.indexOf("【内联朗读标注 v1】") >= 0) + " hints=" + hinted);
      }
      if (cleanText(legacyResponse.raw).indexOf("<say>") >= 0 && hinted > 0) {
        throw new Error("control markup leaked into the stream");
      }
    });
  } catch (error) {
    results.push({ name: "harness", ok: false, error: String((error && error.stack) || error) });
  } finally {
    try { await env.teardown(); } catch (_) {}
  }

  var failures = results.filter(function (r) { return !r.ok; });
  console.log(JSON.stringify({
    result: failures.length ? "FAIL" : "PASS",
    total: results.length, failed: failures.length, failures: failures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
}

run();
