"use strict";

// Post-class notes v2 — message cleaning, token estimation and turn-preserving
// slicing.
//
// Hard criteria from the plan:
//  - §3.2 short path:  <= 40 usable messages AND <= 8000 estimated tokens;
//  - §3.3 long path:   slice on complete learner/companion turns, 3500-5000
//                      target input tokens per slice, 1 whole turn of overlap;
//  - §7.1 length policy is driven by usable-message count.
//
// A turn is one learner message plus everything the companion said before the
// learner spoke again.  A turn is never split across chunks, because a
// question and its answer must stay in the same slice.
//
// Plan: POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md §3.2, §3.3, §7.1.

var SHORT_MAX_MESSAGES = 40;
var SHORT_MAX_TOKENS = 8000;
var CHUNK_TARGET_TOKENS = 4200;
var CHUNK_MAX_TOKENS = 5000;
var OVERLAP_TURNS = 1;
var DEFAULT_MAX_MESSAGES = 400;

// Mirrors lib/progress/kb-progress `[下课] / [下課] / [End Class]` markers,
// which are bookkeeping turns rather than teachable content.
var END_CLASS_MARKER = /^\s*\[(下课|下課|End Class)\]/i;

var CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

// Deliberately coarse: ~1 token per CJK glyph, ~1 token per 3.5 latin chars.
// Calibrated against the production sample (20,003 chars -> 14,078 tokens
// measured by the gateway).
function estimateTokens(text) {
  var value = String(text == null ? "" : text);
  if (!value) return 0;
  var cjk = 0;
  var other = 0;
  for (var i = 0; i < value.length; i++) {
    if (CJK.test(value[i])) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 3.5);
}

function isEndClassMarker(content) {
  return END_CLASS_MARKER.test(String(content == null ? "" : content));
}

// Keeps the original array index so evidence can cite `sourceMessageIndexes`
// that survive every later transformation.
function normalizeMessages(messages, options) {
  var opts = options || {};
  var list = Array.isArray(messages) ? messages : [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var message = list[i];
    if (!message) continue;
    var role = message.role;
    if (role !== "user" && role !== "assistant") continue;
    var content = typeof message.content === "string" ? message.content : "";
    content = content.replace(/\r\n/g, "\n").trim();
    if (!content) continue;
    if (role === "user" && isEndClassMarker(content) && !opts.keepEndClassMarkers) continue;
    out.push({ sourceIndex: i, role: role, content: content, tokens: estimateTokens(content) + 4 });
  }
  return out;
}

function countTokens(messages) {
  var total = 0;
  for (var i = 0; i < messages.length; i++) total += Number(messages[i].tokens) || estimateTokens(messages[i].content) + 4;
  return total;
}

function substantiveUserCount(messages) {
  var count = 0;
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role === "user" && !isEndClassMarker(messages[i].content)) count += 1;
  }
  return count;
}

// A turn opens at a learner message; the companion's reply (one or more
// assistant messages) belongs to the turn that precedes it.
function groupTurns(messages) {
  var turns = [];
  var current = null;
  for (var i = 0; i < messages.length; i++) {
    var message = messages[i];
    if (message.role === "user") {
      current = { start: i, end: i, tokens: message.tokens };
      turns.push(current);
      continue;
    }
    if (!current) {
      current = { start: i, end: i, tokens: message.tokens };
      turns.push(current);
      continue;
    }
    current.end = i;
    current.tokens += message.tokens;
  }
  return turns;
}

function routeFor(messages, options) {
  var opts = options || {};
  var normalized = Array.isArray(messages) && messages.length && messages[0].sourceIndex !== undefined
    ? messages
    : normalizeMessages(messages, opts);
  var tokens = countTokens(normalized);
  var shortMaxMessages = Number(opts.shortMaxMessages) || SHORT_MAX_MESSAGES;
  var shortMaxTokens = Number(opts.shortMaxTokens) || SHORT_MAX_TOKENS;
  var useShort = normalized.length <= shortMaxMessages && tokens <= shortMaxTokens;
  return {
    mode: useShort ? "short" : "chunked",
    messageCount: normalized.length,
    estimatedTokens: tokens,
    substantiveUserCount: substantiveUserCount(normalized),
    reason: useShort
      ? "within short-path budget"
      : (normalized.length > shortMaxMessages ? "too many messages" : "input tokens above short-path budget")
  };
}

function pad(number, width) {
  var value = String(number);
  while (value.length < width) value = "0" + value;
  return value;
}

function chunkRecord(position, messages, startIndex, endIndex, overlapTurnsCount) {
  var sourceIndexes = [];
  for (var i = startIndex; i <= endIndex; i++) sourceIndexes.push(messages[i].sourceIndex);
  return {
    chunkId: "chunk-" + pad(position, 3),
    position: position,
    messageRange: [sourceIndexes[0], sourceIndexes[sourceIndexes.length - 1]],
    sourceIndexes: sourceIndexes,
    overlapTurns: overlapTurnsCount,
    tokens: countTokens(messages.slice(startIndex, endIndex + 1)),
    messages: messages.slice(startIndex, endIndex + 1)
  };
}

// Packs whole turns; the first turn of chunk N+1 repeats the last turn of
// chunk N so a concept introduced at a boundary is seen twice.
function buildChunks(messages, options) {
  var opts = options || {};
  var normalized = Array.isArray(messages) && messages.length && messages[0].sourceIndex !== undefined
    ? messages
    : normalizeMessages(messages, opts);
  if (!normalized.length) return [];
  var target = Number(opts.targetTokens) || CHUNK_TARGET_TOKENS;
  var max = Number(opts.maxTokens) || CHUNK_MAX_TOKENS;
  var overlap = opts.overlapTurns === undefined ? OVERLAP_TURNS : Math.max(0, Number(opts.overlapTurns) || 0);
  var turns = groupTurns(normalized);

  var chunks = [];
  var cursor = 0;
  while (cursor < turns.length) {
    var start = cursor;
    var tokens = 0;
    var end = start;
    while (end < turns.length) {
      var turnTokens = turns[end].tokens;
      if (end > start && tokens + turnTokens > target) break;
      tokens += turnTokens;
      if (tokens >= max) { end += 1; break; }
      end += 1;
    }
    if (end <= start) end = start + 1;
    chunks.push(chunkRecord(chunks.length + 1, normalized, turns[start].start, turns[end - 1].end, start === 0 ? 0 : overlap));
    if (end >= turns.length) break;
    cursor = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function summarizePartition(chunks) {
  return {
    chunkCount: chunks.length,
    totalTokens: chunks.reduce(function (sum, chunk) { return sum + chunk.tokens; }, 0),
    messageCount: chunks.length
      ? chunks.reduce(function (sum, chunk) { return sum + chunk.messages.length; }, 0)
      : 0
  };
}

// §7.1 adaptive visible length, keyed on usable message count.
function visibleTargetRange(messageCount, language) {
  var count = Number(messageCount) || 0;
  var english = language === "english";
  var bands = english
    ? [[15, 450, 900], [40, 700, 1400], [80, 1500, 2000], [160, 2000, 2500], [Infinity, 2500, 2500]]
    : [[15, 800, 1500], [40, 1500, 2500], [80, 3000, 4000], [160, 4000, 5000], [Infinity, 5000, 5000]];
  for (var i = 0; i < bands.length; i++) {
    if (count <= bands[i][0]) return { min: bands[i][1], max: bands[i][2], unit: english ? "words" : "chars" };
  }
  return { min: 3000, max: 5000, unit: english ? "words" : "chars" };
}

function countVisible(text, language) {
  var value = String(text == null ? "" : text);
  if (language === "english") {
    var words = value.split(/\s+/).filter(Boolean);
    return words.length;
  }
  return value.length;
}

// Transcript handed to the model.  Explicit `[n]` prefixes are what make
// `sourceMessageIndexes` citable.
function formatTranscript(messages, options) {
  var opts = options || {};
  var learner = opts.learnerLabel || "学习者";
  var companion = opts.companionLabel || "伙伴";
  var clamp = Number(opts.maxMessageChars) || 1500;
  var lines = [];
  for (var i = 0; i < messages.length; i++) {
    var message = messages[i];
    var label = message.role === "assistant" ? companion : learner;
    var content = message.content.length > clamp ? message.content.slice(0, clamp) + "…" : message.content;
    lines.push("[" + message.sourceIndex + "][" + label + "]: " + content);
  }
  return lines.join("\n\n");
}

module.exports = {
  SHORT_MAX_MESSAGES: SHORT_MAX_MESSAGES,
  SHORT_MAX_TOKENS: SHORT_MAX_TOKENS,
  CHUNK_TARGET_TOKENS: CHUNK_TARGET_TOKENS,
  CHUNK_MAX_TOKENS: CHUNK_MAX_TOKENS,
  DEFAULT_MAX_MESSAGES: DEFAULT_MAX_MESSAGES,
  estimateTokens: estimateTokens,
  isEndClassMarker: isEndClassMarker,
  normalizeMessages: normalizeMessages,
  countTokens: countTokens,
  substantiveUserCount: substantiveUserCount,
  groupTurns: groupTurns,
  routeFor: routeFor,
  buildChunks: buildChunks,
  summarizePartition: summarizePartition,
  visibleTargetRange: visibleTargetRange,
  countVisible: countVisible,
  formatTranscript: formatTranscript
};
