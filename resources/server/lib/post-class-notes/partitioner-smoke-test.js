"use strict";

// PN-001 — partitioner contract: path decision, turn-preserving slices,
// overlap, token calibration, cleaning.
//
//   node resources/server/lib/post-class-notes/partitioner-smoke-test.js

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var partitioner = require("./partitioner.js");

var FIXTURES = path.join(__dirname, "fixtures");

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name + ".json"), "utf8"));
}

function setup() {
  var out = {};
  out.short = fixture("short-20");
  out.long = fixture("long-80");
  out.stress = fixture("stress-160");
  out.edges = fixture("edge-messages");
  out.multilingual = fixture("multilingual");
  return out;
}

function scenario(name, body) {
  try {
    body();
    console.log("  ok   " + name);
  } catch (error) {
    error.message = name + ": " + error.message;
    throw error;
  }
}

// --- 1. token estimate is calibrated against the measured production sample --

var MEASURED = { chars: 20003, promptTokens: 14078 };

function productionShape() {
  // 20,003 chars of Chinese-dominant classroom text must land within 25% of the
  // 14,078 tokens the gateway actually billed.
  var text = "这是一个中文课堂片段，含少量 latin words 与 \\(x^2\\) 公式。".repeat(Math.ceil(MEASURED.chars / 30)).slice(0, MEASURED.chars);
  var estimate = partitioner.estimateTokens(text);
  var drift = Math.abs(estimate - MEASURED.promptTokens) / MEASURED.promptTokens;
  assert.ok(drift <= 0.25, "production-scale estimate drifted " + (drift * 100).toFixed(1) + "% (estimate " + estimate + ")");
}

// --- 2. path selection -----------------------------------------------------

function pathSelection(f) {
  assert.strictEqual(partitioner.routeFor(partitioner.normalizeMessages(f.short.messages)).mode, "short", "20-message lesson uses the single-call path");
  assert.strictEqual(partitioner.routeFor(partitioner.normalizeMessages(f.long.messages)).mode, "chunked", "80-message lesson must be sliced");
  assert.strictEqual(partitioner.routeFor(partitioner.normalizeMessages(f.stress.messages)).mode, "chunked", "160-message lesson must be sliced");
  assert.strictEqual(partitioner.routeFor(partitioner.normalizeMessages(f.long.messages), { shortMaxTokens: 1e6 }).reason, "too many messages",
    "message count alone can force the chunked path");
}

// --- 3. turns are never split and overlap is exactly one turn --------------

function chunkIntegrity(f) {
  var normalized = partitioner.normalizeMessages(f.long.messages);
  var chunks = partitioner.buildChunks(normalized);
  assert.ok(chunks.length >= 2, "80-message lesson yields at least two chunks");

  chunks.forEach(function (chunk) {
    assert.strictEqual(chunk.messages[0].role, "user",
      chunk.chunkId + " must open on a learner message (a turn boundary)");
    // A single oversized turn may push past the ceiling, but never twice over.
    assert.ok(chunk.tokens <= partitioner.CHUNK_MAX_TOKENS * 2,
      chunk.chunkId + " stayed near the token ceiling (got " + chunk.tokens + ")");
  });

  for (var i = 1; i < chunks.length; i++) {
    var previous = chunks[i - 1];
    var current = chunks[i];
    var lastSource = previous.sourceIndexes[previous.sourceIndexes.length - 1];
    assert.ok(current.sourceIndexes.indexOf(lastSource) >= 0,
      chunks[i].chunkId + " must repeat the previous chunk's final message so a boundary concept is seen twice");
    var overlapCount = current.sourceIndexes.filter(function (index) { return previous.sourceIndexes.indexOf(index) >= 0; }).length;
    assert.ok(overlapCount >= 2, chunks[i].chunkId + " should overlap by one whole turn, got " + overlapCount + " message(s)");
  }
}

function chunkCoverage(f) {
  var normalized = partitioner.normalizeMessages(f.stress.messages);
  var chunks = partitioner.buildChunks(normalized);
  var first = normalized[0].sourceIndex;
  var last = normalized[normalized.length - 1].sourceIndex;
  assert.strictEqual(chunks[0].messageRange[0], first, "first chunk starts at the first usable message");
  assert.strictEqual(chunks[chunks.length - 1].messageRange[1], last, "last chunk reaches the final usable message");
  var seen = {};
  chunks.forEach(function (chunk) {
    chunk.sourceIndexes.forEach(function (index) { seen[index] = true; });
  });
  assert.strictEqual(Object.keys(seen).length, normalized.length, "every usable message appears in at least one chunk");
}

// --- 4. cleaning -----------------------------------------------------------

function cleaning(f) {
  var normalized = partitioner.normalizeMessages(f.edges.messages);
  assert.strictEqual(normalized.length, 7, "empty, whitespace and [下课]/[End Class] turns are dropped");
  normalized.forEach(function (message) {
    assert.ok(message.content.trim().length > 0, "no blank content survives");
    assert.ok(message.role === "user" || message.role === "assistant", "system turns are dropped");
  });
  assert.strictEqual(partitioner.substantiveUserCount(normalized), 3, "end-class markers are not counted as substantive learner turns");
  assert.strictEqual(partitioner.isEndClassMarker("[下課]"), true, "traditional marker recognized");
  assert.strictEqual(partitioner.isEndClassMarker("[End Class]"), true, "english marker recognized");
  assert.strictEqual(partitioner.isEndClassMarker("结束语"), false, "ordinary text is not a marker");
}

function indexStability(f) {
  var normalized = partitioner.normalizeMessages(f.edges.messages);
  normalized.forEach(function (message) {
    assert.strictEqual(f.edges.messages[message.sourceIndex].role, message.role,
      "sourceIndex still points at the original message");
  });
}

// --- 5. adaptive length bands (§7.1) ---------------------------------------

function lengthBands() {
  assert.deepStrictEqual(pick(5), { min: 800, max: 1500, unit: "chars" });
  assert.deepStrictEqual(pick(20), { min: 1500, max: 2500, unit: "chars" });
  assert.deepStrictEqual(pick(80), { min: 3000, max: 4000, unit: "chars" });
  assert.deepStrictEqual(pick(120), { min: 4000, max: 5000, unit: "chars" });
  assert.deepStrictEqual(pick(900), { min: 5000, max: 5000, unit: "chars" });
  assert.strictEqual(partitioner.visibleTargetRange(20, "english").unit, "words");
  assert.strictEqual(partitioner.countVisible("a b c", "english"), 3);
  assert.strictEqual(partitioner.countVisible("课堂", "chinese"), 2);

  function pick(count) { return partitioner.visibleTargetRange(count, "chinese"); }
}

// --- 6. transcript formatting carries citable indexes ----------------------

function transcript(f) {
  var normalized = partitioner.normalizeMessages(f.multilingual.messages);
  var text = partitioner.formatTranscript(normalized, { learnerLabel: "Learner", companionLabel: "Companion", maxMessageChars: 40 });
  assert.ok(text.indexOf("[0][Learner]:") === 0, "first line is numbered and labelled");
  assert.ok(/\[3\]\[Companion\]:/.test(text), "companion lines are labelled too");
  assert.ok(text.split("\n\n").length === normalized.length, "one block per message");
}

// --- 7. determinism --------------------------------------------------------

function determinism(f) {
  var a = JSON.stringify(partitioner.buildChunks(partitioner.normalizeMessages(f.stress.messages)));
  var b = JSON.stringify(partitioner.buildChunks(partitioner.normalizeMessages(f.stress.messages)));
  assert.strictEqual(a, b, "two runs produce identical slices");
}

var data = setup();
console.log("partitioner smoke:");
scenario("token estimate calibrated to the measured production sample", productionShape);
scenario("short vs chunked path selection", function () { pathSelection(data); });
scenario("chunks never split a turn and overlap by one turn", function () { chunkIntegrity(data); });
scenario("chunks cover every usable message", function () { chunkCoverage(data); });
scenario("message cleaning drops blanks, markers and system turns", function () { cleaning(data); });
scenario("sourceIndex survives normalization", function () { indexStability(data); });
scenario("adaptive length bands match the plan table", lengthBands);
scenario("transcript exposes sourceIndex for citation", function () { transcript(data); });
scenario("partitioning is deterministic", function () { determinism(data); });
console.log("partitioner smoke: PASS");
