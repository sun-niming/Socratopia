"use strict";

function positiveInt(value) {
  var n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function cleanRange(value, fallback) {
  var nums = Array.isArray(value)
    ? value.map(positiveInt).filter(Boolean)
    : [];
  if (!nums.length && Array.isArray(fallback)) {
    nums = fallback.map(positiveInt).filter(Boolean);
  }
  var start = nums.length ? Math.min.apply(Math, nums) : 1;
  var end = nums.length ? Math.max.apply(Math, nums) : start;
  return [start, end];
}

function conceptOrdinal(card) {
  var id = String(card && card.concept_id || "");
  var match = id.match(/^(\d+)/);
  return match ? Number(match[1]) : 999999;
}

// The builder processes non-overlapping chunks in source order. Within a
// chunk, concept ids preserve the model's original card order. Prefer that
// stable evidence over broad source_pages ranges, which often cover the whole
// four-page chunk and previously moved later concepts ahead of earlier ones.
function cardOrderKey(card) {
  var source = cleanRange(card && card.source_pages, null);
  var chunk = cleanRange(card && card._chunk_pages, source);
  return {
    chunkStart: chunk[0],
    chunkEnd: chunk[1],
    ordinal: conceptOrdinal(card),
    sourceStart: source[0],
    sourceEnd: source[1],
    difficulty: Number(card && card.difficulty) || 9,
    title: String(card && (card.title || card.concept_id) || ""),
  };
}

function compareCards(a, b) {
  var ka = cardOrderKey(a);
  var kb = cardOrderKey(b);
  return (ka.chunkStart - kb.chunkStart) ||
    (ka.chunkEnd - kb.chunkEnd) ||
    (ka.ordinal - kb.ordinal) ||
    (ka.sourceStart - kb.sourceStart) ||
    (ka.sourceEnd - kb.sourceEnd) ||
    (ka.difficulty - kb.difficulty) ||
    ka.title.localeCompare(kb.title);
}

function sortCards(cards) {
  return (cards || []).slice().sort(compareCards);
}

function teachingPhasesPreserveOrder(cards, phases) {
  var expected = (cards || []).map(function (card) { return String(card && card.concept_id || ""); });
  var flattened = [];
  (phases || []).forEach(function (phase) {
    (phase && phase.card_ids || []).forEach(function (id) { flattened.push(String(id || "")); });
  });
  return flattened.length === expected.length && flattened.every(function (id, index) {
    return id === expected[index];
  });
}

function assessPdfText(text, opts) {
  opts = opts || {};
  text = String(text || "");
  var compact = text.replace(/\s+/g, "");
  var length = compact.length;
  var cjk = (compact.match(/[\u3400-\u9fff]/g) || []).length;
  var bad = (compact.match(/[\uFFFD\uE000-\uF8FF]/g) || []).length;
  var controls = (compact.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  var wordish = (compact.match(/[A-Za-z0-9_]/g) || []).length;
  var tokens = text.trim() ? text.trim().split(/\s+/) : [];
  var singletonTokens = tokens.filter(function (token) {
    return token.replace(/[^A-Za-z0-9\u3400-\u9fff]/g, "").length <= 1;
  }).length;
  var singletonRatio = tokens.length ? singletonTokens / tokens.length : 0;
  var wordishRatio = length ? (wordish + cjk) / length : 0;
  var sparse = length < 80;
  var brokenEncoding = bad > 0 || controls > 0;
  var substantialLowCjk = length >= 120 && cjk < 4;
  var fragmented = substantialLowCjk && wordishRatio < 0.48 && singletonRatio > 0.42;
  // A broken Chinese CMap can leave apparently healthy C++ identifiers and
  // punctuation behind. The old generic fragmentation check missed those
  // pages because their ASCII ratio was high. Only enable this language-aware
  // signal for textbooks that are expected to contain Chinese.
  var missingExpectedCjk = !!opts.expectedCjk && substantialLowCjk && wordish >= 60;
  return {
    length: length,
    cjk: cjk,
    bad: bad,
    controls: controls,
    singletonRatio: singletonRatio,
    wordishRatio: wordishRatio,
    sparse: sparse,
    missingExpectedCjk: missingExpectedCjk,
    garbled: brokenEncoding || fragmented || missingExpectedCjk,
    renderRecommended: sparse || brokenEncoding || fragmented || missingExpectedCjk,
  };
}

function likelyTeachableChunk(text, hasImages) {
  text = String(text || "");
  var compact = text.replace(/\s+/g, "");
  var head = compact.slice(0, 500).toLowerCase();
  var dotLeaders = (text.match(/\.{4,}|…{2,}/g) || []).length;
  var numberedSections = (text.match(/(?:^|\s)\d{1,2}\.\s*\d+(?:\.\s*\d+)*/gm) || []).length;
  var tocLike = /目录|contents/.test(head) || numberedSections >= 8 ||
    ((text.match(/本章小结|练习/g) || []).length >= 4 && numberedSections >= 4);
  if (tocLike) return false;
  if (hasImages) return true;
  if (compact.length < 160) return false;
  var cjk = (compact.match(/[\u3400-\u9fff]/g) || []).length;
  var sentenceMarks = (text.match(/[。！？；:：]/g) || []).length;
  var codeSignals = (text.match(/(?:#include|std::|\bclass\s+\w+|\btemplate\s*<|\bint\s+\w+|\bauto\s+\w+|[{};]\s*$)/gm) || []).length;
  return (cjk >= 20 && sentenceMarks >= 2) || codeSignals >= 2;
}

function contiguousHealthyChunks(events, total) {
  var lastByChunk = {};
  (events || []).forEach(function (event) {
    if (event && event.type === "chunk_done" && event.chunk != null) lastByChunk[String(event.chunk)] = event;
  });
  var limit = positiveInt(total) || Number.MAX_SAFE_INTEGER;
  var count = 0;
  for (var chunk = 1; chunk <= limit; chunk++) {
    var event = lastByChunk[String(chunk)];
    if (!event || event.terminalFailure) break;
    count = chunk;
  }
  return count;
}

function assessBuild(cards, chunks, events, startPage, endPage, teachingMap) {
  cards = cards || [];
  chunks = chunks || [];
  events = events || [];
  startPage = positiveInt(startPage) || 1;
  endPage = positiveInt(endPage) || startPage;
  var doneByChunk = {};
  events.forEach(function (event) {
    if (event && event.type === "chunk_done" && event.chunk != null) doneByChunk[String(event.chunk)] = event;
  });
  var done = Object.keys(doneByChunk).map(function (key) { return doneByChunk[key]; })
    .sort(function (a, b) { return Number(a.chunk || 0) - Number(b.chunk || 0); });
  var zero = done.filter(function (event) { return Number(event.cardCount) === 0; });
  var none = done.filter(function (event) { return event.method === "none"; });
  var terminal = done.filter(function (event) { return !!event.terminalFailure; });
  var failedEvents = events.filter(function (event) { return event && /_fail$/.test(String(event.type || "")); });
  var trailingEmpty = 0;
  for (var i = done.length - 1; i >= 0 && Number(done[i].cardCount) === 0; i--) trailingEmpty++;
  var pageEnds = cards.map(function (card) { return cleanRange(card && card.source_pages, card && card._chunk_pages)[1]; });
  var lastCardPage = pageEnds.length ? Math.max.apply(Math, pageEnds) : null;
  var requestedSpan = Math.max(1, endPage - startPage + 1);
  var coveredSpan = lastCardPage ? Math.max(0, Math.min(endPage, lastCardPage) - startPage + 1) : 0;
  var coverageRatio = Math.max(0, Math.min(1, coveredSpan / requestedSpan));
  var noneRatio = done.length ? none.length / done.length : 1;
  var mapSegments = teachingMap && Array.isArray(teachingMap.segments) ? teachingMap.segments : [];
  var fallbackSegments = teachingMap && Number(teachingMap.fallback_segments) || 0;
  var mapDegraded = !!(mapSegments.length && fallbackSegments === mapSegments.length);
  var processedIds = {};
  done.forEach(function (event) { if (event && event.chunk != null) processedIds[String(event.chunk)] = true; });
  var chunksProcessed = Object.keys(processedIds).length;
  var chunksExpected = chunks.length;
  var incomplete = chunksProcessed < chunksExpected;
  var partial = !cards.length || incomplete || terminal.length > 0 || trailingEmpty >= 3 ||
    coverageRatio < 0.9 || noneRatio >= 0.25 || mapDegraded;
  return {
    state: partial ? "partial" : "done",
    requestedPageRange: [startPage, endPage],
    lastCardPage: lastCardPage,
    coverageRatio: Number(coverageRatio.toFixed(4)),
    chunkCount: chunks.length || done.length,
    zeroCardChunks: zero.length,
    failedChunks: none.length,
    terminalFailedChunks: terminal.length,
    failedEvents: failedEvents.length,
    trailingEmptyChunks: trailingEmpty,
    teachingMapDegraded: mapDegraded,
    chunksProcessed: chunksProcessed,
    chunksExpected: chunksExpected,
    activationEligible: !partial,
  };
}

module.exports = {
  cleanRange: cleanRange,
  conceptOrdinal: conceptOrdinal,
  cardOrderKey: cardOrderKey,
  compareCards: compareCards,
  sortCards: sortCards,
  teachingPhasesPreserveOrder: teachingPhasesPreserveOrder,
  assessPdfText: assessPdfText,
  likelyTeachableChunk: likelyTeachableChunk,
  contiguousHealthyChunks: contiguousHealthyChunks,
  assessBuild: assessBuild,
};
