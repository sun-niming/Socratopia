"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var reader = require("./excerpt-reader.js");
var skill = require("./skill.js");

async function main() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-close-reading-memory-"));
  var command = "/Close_Reading page 1 remember";
  var pathsA = { worldDir: path.join(root, "world-a"), conversationId: "conversation-a" };
  var pathsB = { worldDir: path.join(root, "world-b"), conversationId: "conversation-b" };
  var body = { messages: [{ role: "user", content: command }] };
  var requestA = skill.prepareMemoryRequest(body, pathsA);
  var requestB = skill.prepareMemoryRequest(body, pathsB);
  var originalRead = reader.readTextbookExcerpt;
  var invocation = 0;

  reader.readTextbookExcerpt = async function () {
    invocation++;
    var marker = invocation === 1 ? "evidence-b" : "evidence-a";
    return {
      evidence: marker,
      startPage: 1,
      endPage: 1,
      source: "text-layer",
      metadata: { startPage: 1, endPage: 1, source: "text-layer" },
    };
  };

  try {
    // Execute B before A with identical command text. A process-global FIFO
    // swaps these seeds; AsyncLocalStorage keeps each request isolated.
    await skill.runWithMemoryRequest(requestB, function () {
      return skill.execute({ commandText: command, messages: body.messages });
    });
    await skill.runWithMemoryRequest(requestA, function () {
      return skill.execute({ commandText: command, messages: body.messages });
    });
    skill.rememberResponse(pathsA, "answer-a");
    skill.rememberResponse(pathsB, "answer-b");

    var candidateA = JSON.parse(fs.readFileSync(path.join(pathsA.worldDir, "conversations", pathsA.conversationId, "close_reading_candidates.json"), "utf8"))[0];
    var candidateB = JSON.parse(fs.readFileSync(path.join(pathsB.worldDir, "conversations", pathsB.conversationId, "close_reading_candidates.json"), "utf8"))[0];
    assert.strictEqual(candidateA.excerpt, "evidence-a");
    assert.strictEqual(candidateB.excerpt, "evidence-b");
    assert.strictEqual(candidateA.conclusion, "answer-a");
    assert.strictEqual(candidateB.conclusion, "answer-b");
    console.log("close-reading memory context smoke test: PASS");
  } finally {
    reader.readTextbookExcerpt = originalRead;
    if (root.startsWith(os.tmpdir() + path.sep)) fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
