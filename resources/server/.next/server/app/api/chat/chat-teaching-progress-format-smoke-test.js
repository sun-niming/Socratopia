"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var workspaceRoot = path.resolve(__dirname, "..", "..", "..", "..", "..", "..", "..");
var TestEnvironment = require(path.join(workspaceRoot, "resources", "server", "smoke-test-utils.js")).TestEnvironment;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function eventTypes(raw) {
  return String(raw || "").split(/\r?\n/).map(function (line) {
    if (!line.startsWith("data: ")) return null;
    try { return JSON.parse(line.slice(6)).type || null; }
    catch (_) { return null; }
  }).filter(Boolean);
}

function readCommitted(baseDir, textbookId) {
  var stateDir = path.join(baseDir, "textbooks", textbookId, ".reading-state-v2");
  var pointer = JSON.parse(fs.readFileSync(path.join(stateDir, "current-pointer.json"), "utf8"));
  return JSON.parse(fs.readFileSync(path.join(stateDir, "generations", path.basename(pointer.manifest)), "utf8"));
}

function seedCase(env, format) {
  var textbookId = "format-" + format;
  var conversationId = "format-conversation-" + format;
  var baseDir = path.join(env.tmpDir, "accounts", "test", "profiles", "test", "worlds", "test");
  var indexPath = path.join(baseDir, "textbooks", "textbook_index.json");
  var index = { worldId: "test", textbooks: [] };
  try { index = JSON.parse(fs.readFileSync(indexPath, "utf8")); }
  catch (_) {}
  index.worldId = "test";
  index.textbooks = (Array.isArray(index.textbooks) ? index.textbooks : []).filter(function (book) {
    return !book || book.id !== textbookId;
  });
  index.textbooks.push({ id: textbookId, title: "Format " + format, currentPage: 1, numPages: 2, format: format });
  write(indexPath, JSON.stringify(index, null, 2));
  write(path.join(baseDir, "textbooks", textbookId, "pages.json"), JSON.stringify({
    format: format,
    pages: [{ pageNum: 1, title: "Page one" }, { pageNum: 2, title: "Page two" }]
  }, null, 2));
  write(path.join(baseDir, "textbooks", textbookId, "progress_state.json"), JSON.stringify({
    schemaVersion: 3,
    textbookId: textbookId,
    sourceConversationId: conversationId,
    loadedCursor: { startPage: 1, endPage: 1 },
    currentPage: 1
  }, null, 2));
  write(path.join(baseDir, "conversations", conversationId, "current_reading.md"), "<!-- startPage: 1 endPage: 1 -->\n# Page one\nFixture content.");
  write(path.join(baseDir, "chats", conversationId + ".json"), JSON.stringify({ id: conversationId, messages: [] }, null, 2));
  return { baseDir: baseDir, textbookId: textbookId, conversationId: conversationId };
}

function requestBody(fixture) {
  var clientTurnId = "format-turn-" + fixture.textbookId;
  var userContent = "Please continue " + fixture.textbookId + ".";
  return {
    messages: [
      { role: "assistant", content: "Previous teaching reply." },
      { role: "user", content: userContent }
    ],
    apiKey: "mock-key",
    provider: "openai",
    model: "mock",
    profileId: "test",
    worldId: "test",
    textbookId: fixture.textbookId,
    conversationId: fixture.conversationId,
    teachingLanguage: "english",
    advanceProtocolVersion: 2,
    clientTurnId: clientTurnId,
    assistantMessageId: "assistant-" + fixture.textbookId,
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
  };
}

function modelRequestCount(env, fixture) {
  var userContent = "Please continue " + fixture.textbookId + ".";
  return env.mockLLM.requests.filter(function (request) {
    return Array.isArray(request.messages) && request.messages.some(function (message) {
      return message && message.role === "user" && message.content === userContent;
    });
  }).length;
}

async function runFormatCase(env, format, expectsTeachingProgress) {
  var fixture = seedCase(env, format);
  var body = requestBody(fixture);
  var response = await env.postSSE("/api/chat", body, { Authorization: env.capabilityHeader() });
  var types = eventTypes(response.raw);
  assert.strictEqual(response.status, 200, format + " route request must succeed");
  assert.ok(types.includes("text"), format + " must stream model text");
  assert.ok(types.includes("done"), format + " must reach done after completeTurn");
  assert.ok(!types.includes("error"), format + " must not emit a stream error");
  assert.ok(!response.raw.includes("isMarkdownLike is not defined"), format + " must not reference an out-of-scope format variable");
  var state = readCommitted(fixture.baseDir, fixture.textbookId);
  var conversation = state.conversations[fixture.conversationId];
  assert.strictEqual(conversation.turns["format-turn-" + fixture.textbookId].turnState, "COMPLETED", format + " must durably complete its accepted turn");
  assert.strictEqual(conversation.structuredTeachingProgress === true, expectsTeachingProgress, format + " must persist the expected requiresTeachingProgress protocol value");
  var requestCountBeforeReplay = modelRequestCount(env, fixture);
  var replay = await env.postSSE("/api/chat", body, { Authorization: env.capabilityHeader() });
  assert.strictEqual(replay.status, 200, format + " replay must succeed");
  assert.ok(eventTypes(replay.raw).includes("done"), format + " replay must reach done");
  assert.ok(!eventTypes(replay.raw).includes("error"), format + " replay must not emit an error");
  assert.strictEqual(modelRequestCount(env, fixture), requestCountBeforeReplay, format + " replay must not invoke the model again");
  assert.strictEqual(readCommitted(fixture.baseDir, fixture.textbookId).stateGeneration, state.stateGeneration, format + " replay must not publish another reading-state generation");
}

async function runUnsupportedFormatCleanupCase(env) {
  var fixture = seedCase(env, "epub");
  var response = await env.postSSE("/api/chat", requestBody(fixture), { Authorization: env.capabilityHeader() });
  var types = eventTypes(response.raw);
  assert.strictEqual(response.status, 200, "unsupported format stream must return a controlled SSE response");
  assert.ok(types.includes("error"), "unsupported format must emit an explicit stream error");
  assert.ok(response.raw.includes("textbook_format_unsupported"), "unsupported format must use the explicit error code");
  assert.ok(!response.raw.includes("isMarkdownLike is not defined"), "unsupported format must not fall through to a free variable");
  var state = readCommitted(fixture.baseDir, fixture.textbookId);
  var turn = state.conversations[fixture.conversationId].turns["format-turn-" + fixture.textbookId];
  assert.strictEqual(turn.turnState, "CANCELLED_RETRYABLE", "unsupported format must clean up its accepted turn");
}

async function runUnsupportedFormatPreflightCase(env) {
  var fixture = seedCase(env, "epub-preflight");
  var body = requestBody(fixture);
  body.messages[1].content = "Please jump to page 2 " + fixture.textbookId + ".";
  body.turnEnvelope.sanitizedUserContent = body.messages[1].content;
  body.turnEnvelope.readingAction = { type: "page", page: 2 };
  var response = await env.postSSE("/api/chat", body, { Authorization: env.capabilityHeader() });
  var types = eventTypes(response.raw);
  assert.strictEqual(response.status, 200, "unsupported format preflight must return a controlled SSE response");
  assert.ok(types.includes("error"), "unsupported format preflight must emit an explicit stream error");
  assert.ok(response.raw.includes("textbook_format_unsupported"), "range loading must reject an unsupported format before use");
  assert.ok(!types.includes("text"), "unsupported format preflight must not start the model stream");
  assert.strictEqual(modelRequestCount(env, fixture), 0, "unsupported format preflight must not invoke the model");
  var state = readCommitted(fixture.baseDir, fixture.textbookId);
  var conversation = state.conversations[fixture.conversationId];
  assert.ok(!conversation || !conversation.turns["format-turn-" + fixture.textbookId], "unsupported format preflight must not accept a turn");
}

async function main() {
  var env = new TestEnvironment({
    rules: {
      "rules_en_classroom_compact.md": "# Test classroom rules\n\nTeach from the provided textbook content. Keep replies concise, accurate, and grounded in the current reading range."
    }
  });
  try {
    await env.setup();
    env.mockLLM.setResponse({ choices: [{ message: { content: "A normal teaching reply." } }] });
    await Promise.all([
      runFormatCase(env, "pdf", true),
      runFormatCase(env, "markdown", false)
    ]);
    await runFormatCase(env, "qbook", false);
    await runUnsupportedFormatPreflightCase(env);
    await runUnsupportedFormatCleanupCase(env);
  } finally {
    await env.teardown();
  }
  console.log("chat teaching-progress format smoke test: PASS");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
