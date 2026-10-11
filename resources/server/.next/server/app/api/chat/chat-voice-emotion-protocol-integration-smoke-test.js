"use strict";

// Black-box test for the 【语音表达协议 v1】 wiring in the compiled classroom route.
//
// Boots the real server.js against a mock provider and asserts, over HTTP:
//   * the runtime prompt block is injected only in 自动情绪 (auto) mode, and only for a
//     catalog voice — the prompt carries the voice's own allowed tags and default description
//   * tagged replies reach the reader as clean `text` events, with `speech_segment_*` events
//     carrying the emotion, the stable ids and the clean-text offsets
//   * the clean text is identical whether the provider frames the reply in one piece or splits
//     it every few characters
//   * a forbidden tag (生气/厌恶) never reaches audio, and falls back to the voice default
//   * a legacy style voice keeps the previous behaviour: prompt untouched, no segment events
//
// Self-contained: local mock LLM, no real API key, no real user data.
// Run: node resources/server/.next/server/app/api/chat/chat-voice-emotion-protocol-integration-smoke-test.js

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

function cleanText(raw) {
  return eventsOfType(raw, "text").map(function (e) { return e.text; }).join("");
}

// The teaching call for a turn is the model request that carries that turn's student message.
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
  var textbookId = "voice-" + CASE_SEQ;
  var conversationId = "voice-conversation-" + CASE_SEQ;
  var baseDir = path.join(env.tmpDir, "accounts", "test", "profiles", "test", "worlds", "test");
  var indexPath = path.join(baseDir, "textbooks", "textbook_index.json");
  var index = { worldId: "test", textbooks: [] };
  try { index = JSON.parse(fs.readFileSync(indexPath, "utf8")); } catch (_) {}
  index.worldId = "test";
  index.textbooks = (Array.isArray(index.textbooks) ? index.textbooks : []).filter(function (book) {
    return !book || book.id !== textbookId;
  });
  index.textbooks.push({ id: textbookId, title: "Voice " + textbookId, currentPage: 1, numPages: 2, format: "markdown" });
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
  var clientTurnId = "voice-turn-" + fixture.textbookId + "-" + fixture.turn;
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
    teachingLanguage: "english",
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

// 赛飞儿 (cipher) is the only catalog voice whose default reference is 开心, and its
// playful_angry reference is still disabled pending audition — so its allowed list is exactly
// default / surprised / happy / sad.
var HEAD = "对，你已经找到关键条件了！";
var MIDDLE = "可惜这一步代入之后结果并不成立。";
var TAIL = "最后我们把两段合起来看。";
var TAGGED_REPLY = [
  '<voice emotion="happy">' + HEAD + "</voice>",
  '<voice emotion="sad">' + MIDDLE + "</voice>",
  TAIL,
].join("");
var CLEAN_REPLY = HEAD + MIDDLE + TAIL;
var MIDDLE_AT = CLEAN_REPLY.indexOf(MIDDLE);
var TAIL_AT = CLEAN_REPLY.indexOf(TAIL);

async function run() {
  var env = new TestEnvironment();
  try {
    await env.setup();

    // --- 1. auto mode: prompt block + clean text + segment events -----------------------
    var autoFixture = seedCase(env);
    var autoBody = requestBody(autoFixture, { voiceId: "cipher", emotionMode: "auto", emotionFixed: null });
    env.mockLLM.resetRequests();
    env.mockLLM.setStreamFrameSize(0);
    env.mockLLM.setResponse({ choices: [{ message: { content: TAGGED_REPLY } }] });
    var autoResponse = await env.postSSE("/api/chat", autoBody, { Authorization: env.capabilityHeader() });
    var autoRaw = autoResponse.raw;

    check("auto mode injects the verbatim protocol block for the requested voice", function () {
      var prompt = teachingPrompt(env, autoFixture.userContent);
      if (prompt.indexOf("【语音表达协议 v1】") < 0) throw new Error("protocol header missing from the system prompt");
      if (prompt.indexOf("当前角色：赛飞儿") < 0) throw new Error("current character line missing");
      if (prompt.indexOf("当前语音模式：auto") < 0) throw new Error("speech mode line missing");
      if (prompt.indexOf("当前允许的情绪标签：default, surprised, happy, sad") < 0) {
        throw new Error("allowed tag list is not the voice's own list");
      }
      if (prompt.indexOf("默认标签：default，实际对应 开心。") < 0) throw new Error("default description missing");
      if (prompt.indexOf("禁止使用厌恶、disgust、disgusted、angry、生气") < 0) throw new Error("forbidden tag line missing");
      if (prompt.indexOf("playful_angry") >= 0) throw new Error("must not advertise a disabled emotion");
    });

    check("the reader only receives the clean text", function () {
      if (autoResponse.status !== 200) throw new Error("status " + autoResponse.status);
      var seen = cleanText(autoRaw);
      if (seen !== CLEAN_REPLY) throw new Error("clean text drifted: " + JSON.stringify(seen));
      if (autoRaw.indexOf("<voice") >= 0) throw new Error("control markup leaked into the stream");
      if (autoRaw.indexOf("</voice>") >= 0) throw new Error("control markup leaked into the stream");
    });

    check("speech segments carry the emotion, the ids and the clean-text offsets", function () {
      var starts = eventsOfType(autoRaw, "speech_segment_start");
      var emotions = starts.map(function (e) { return e.emotion; });
      // The unlabelled tail inherits the voice default, so a third run follows the sad one.
      if (emotions.join(",") !== "happy,sad,happy") throw new Error("emotions: " + emotions.join(","));
      var ids = starts.map(function (e) { return e.segmentId; });
      if (new Set(ids).size !== ids.length) throw new Error("segment ids collide");
      starts.forEach(function (s) {
        if (s.voiceId !== "cipher") throw new Error("voiceId not echoed: " + s.voiceId);
        if (s.speakerId !== "npc_a") throw new Error("speakerId not the companion slot: " + s.speakerId);
        if (s.protocol !== "voice-protocol-v1") throw new Error("protocol version missing");
      });
      if (!/^assistant-voice-turn-.*:s0$/.test(ids[0])) throw new Error("unstable segment id: " + ids[0]);

      var expected = function (start) {
        return start >= TAIL_AT ? ids[2] : start >= MIDDLE_AT ? ids[1] : ids[0];
      };
      var rebuilt = "";
      eventsOfType(autoRaw, "speech_segment_delta").forEach(function (d) {
        if (CLEAN_REPLY.slice(d.start, d.end) !== d.text) {
          throw new Error("delta range drifted at " + d.start + ": " + JSON.stringify(d.text));
        }
        if (d.segmentId !== expected(d.start)) throw new Error("delta attributed to the wrong segment at " + d.start);
        rebuilt += d.text;
      });
      if (rebuilt !== CLEAN_REPLY) throw new Error("deltas do not rebuild the clean text");

      var ends = eventsOfType(autoRaw, "speech_segment_end");
      if (ends.length !== 3) throw new Error("expected 3 segment ends, saw " + ends.length);
      if (ends[2].end !== CLEAN_REPLY.length) throw new Error("the last segment did not close at the end of the text");
      if (ends[0].end !== MIDDLE_AT) throw new Error("the happy run did not close at the first tag boundary");
    });

    // --- 2. frame-boundary independence through the real route --------------------------
    var splitFixture = seedCase(env);
    var splitBody = requestBody(splitFixture, { voiceId: "cipher", emotionMode: "auto", emotionFixed: null });
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: TAGGED_REPLY } }] });
    env.mockLLM.setStreamFrameSize(3);
    var splitResponse = await env.postSSE("/api/chat", splitBody, { Authorization: env.capabilityHeader() });
    env.mockLLM.setStreamFrameSize(0);

    check("a reply split into 3-character frames parses identically", function () {
      if (splitResponse.status !== 200) throw new Error("status " + splitResponse.status);
      if (cleanText(splitResponse.raw) !== CLEAN_REPLY) {
        throw new Error("clean text drifted: " + JSON.stringify(cleanText(splitResponse.raw)));
      }
      var emotions = eventsOfType(splitResponse.raw, "speech_segment_start").map(function (e) { return e.emotion; });
      if (emotions.join(",") !== "happy,sad,happy") throw new Error("emotions drifted: " + emotions.join(","));
      if (splitResponse.raw.indexOf("<voice") >= 0) throw new Error("control markup leaked into the stream");
      // The frames must actually have been split, otherwise this case proves nothing.
      var textEvents = eventsOfType(splitResponse.raw, "text");
      if (textEvents.length < 5) throw new Error("the reply was not delivered incrementally (" + textEvents.length + " text events)");
      var rebuilt = "";
      eventsOfType(splitResponse.raw, "speech_segment_delta").forEach(function (d) {
        if (CLEAN_REPLY.slice(d.start, d.end) !== d.text) throw new Error("delta range drifted at " + d.start);
        rebuilt += d.text;
      });
      if (rebuilt !== CLEAN_REPLY) throw new Error("deltas do not rebuild the clean text");
    });

    // --- 3. forbidden tags fall back to the voice default -------------------------------
    var forbiddenFixture = seedCase(env);
    var forbiddenBody = requestBody(forbiddenFixture, { voiceId: "cipher", emotionMode: "auto", emotionFixed: null });
    var forbiddenReply = '<voice emotion="生气">你这样做是不对的。</voice><voice emotion="厌恶">我不喜欢。</voice>我们继续。';
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: forbiddenReply } }] });
    var forbiddenResponse = await env.postSSE("/api/chat", forbiddenBody, { Authorization: env.capabilityHeader() });

    check("厌恶 and 生气 never become a usable emotion", function () {
      if (forbiddenResponse.status !== 200) throw new Error("status " + forbiddenResponse.status);
      if (cleanText(forbiddenResponse.raw) !== "你这样做是不对的。我不喜欢。我们继续。") {
        throw new Error("clean text: " + JSON.stringify(cleanText(forbiddenResponse.raw)));
      }
      var emotions = eventsOfType(forbiddenResponse.raw, "speech_segment_start").map(function (e) { return e.emotion; });
      if (!emotions.length) throw new Error("no segment events emitted");
      emotions.forEach(function (emotion) {
        if (emotion !== "happy") throw new Error("forbidden tag became " + emotion);
      });
      if (forbiddenResponse.raw.indexOf("生气") >= 0 && cleanText(forbiddenResponse.raw).indexOf("生气") < 0) {
        throw new Error("the forbidden tag was echoed into the stream");
      }
    });

    // --- 4. default (默认音色) mode is untouched -----------------------------------------
    var defaultFixture = seedCase(env);
    var defaultBody = requestBody(defaultFixture, { voiceId: "cipher", emotionMode: "default", emotionFixed: null });
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: "先把题目读完。" } }] });
    var defaultResponse = await env.postSSE("/api/chat", defaultBody, { Authorization: env.capabilityHeader() });

    check("默认音色 mode leaves the prompt alone", function () {
      var prompt = teachingPrompt(env, defaultFixture.userContent);
      if (prompt.indexOf("【语音表达协议 v1】") >= 0) throw new Error("protocol block must not be injected outside auto mode");
      if (cleanText(defaultResponse.raw) !== "先把题目读完。") {
        throw new Error("clean text: " + JSON.stringify(cleanText(defaultResponse.raw)));
      }
    });

    // --- 5. legacy style voices keep their exact previous behaviour ----------------------
    var legacyFixture = seedCase(env);
    var legacyBody = requestBody(legacyFixture, { voiceId: "soft_girl", emotionMode: "auto", emotionFixed: null });
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: "我们先看这道题。" } }] });
    var legacyResponse = await env.postSSE("/api/chat", legacyBody, { Authorization: env.capabilityHeader() });

    check("a legacy style voice gets no protocol block and no segment events", function () {
      var prompt = teachingPrompt(env, legacyFixture.userContent);
      if (prompt.indexOf("【语音表达协议 v1】") >= 0) throw new Error("protocol block must not be injected for a legacy voice");
      if (cleanText(legacyResponse.raw) !== "我们先看这道题。") {
        throw new Error("clean text: " + JSON.stringify(cleanText(legacyResponse.raw)));
      }
      if (eventsOfType(legacyResponse.raw, "speech_segment_start").length !== 0) {
        throw new Error("legacy voice must not emit segment events");
      }
    });

    // --- 6. an unknown voice id must not break the turn ----------------------------------
    var unknownFixture = seedCase(env);
    var unknownBody = requestBody(unknownFixture, { voiceId: "not_a_voice", emotionMode: "auto", emotionFixed: null });
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({ choices: [{ message: { content: "先读题。" } }] });
    var unknownResponse = await env.postSSE("/api/chat", unknownBody, { Authorization: env.capabilityHeader() });

    check("an unknown voice id degrades to the previous behaviour", function () {
      if (unknownResponse.status !== 200) throw new Error("status " + unknownResponse.status);
      if (cleanText(unknownResponse.raw) !== "先读题。") throw new Error("clean text drifted");
      if (teachingPrompt(env, unknownFixture.userContent).indexOf("【语音表达协议 v1】") >= 0) {
        throw new Error("protocol block injected for an unknown voice");
      }
      if (eventsOfType(unknownResponse.raw, "speech_segment_start").length !== 0) throw new Error("unexpected segment events");
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
