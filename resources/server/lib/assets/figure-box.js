// figure-box.js — turn "somewhere around here" into the figure's actual rectangle.
//
// Why this exists: on a scanned textbook the only previous signal was a vision model
// regressing a rectangle, good to ±5-10% — measured on KUyw p173 that meant the left edge cut
// through the neighbouring text column and the bottom ate four lines of body copy.  The OCR
// already knows every body line's box, and the ink profile knows where the drawing is, so the
// rough box can be *snapped*:
//
//   bottom  -> the caption line's bottom (Chinese textbooks caption the figure from below)
//   left/right -> the columns that the figure actually covers (drops neighbouring text)
//   top     -> the rough top, but never above the previous caption/heading, then blank rows
//              are trimmed
//
// Everything here is pure; the ink profile arrives through an injected sampler.
"use strict";

var CAPTION_RE = /(?:^|[\s(（])([图表])\s*(\d+)\s*[-–—.．]\s*(\d+)/;
var HEADING_RE = /^\s*(?:\d+(?:\.\d+)*\s*[.、]?\s*)?[\u4e00-\u9fffA-Za-z].{0,40}$/;

function normalizeText(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function isCaption(line) {
  return CAPTION_RE.test(normalizeText(line && line.text));
}

function captionLabel(line) {
  var match = CAPTION_RE.exec(normalizeText(line && line.text));
  return match ? match[1] + " " + match[2] + "-" + match[3] : null;
}

// Pick the caption the order refers to.  `hint` is the order's alt text, e.g. "图 4-34 id*id 的语法分析".
function findCaption(lines, hint) {
  var list = Array.isArray(lines) ? lines : [];
  var wanted = normalizeText(hint);
  var label = null;
  var hintMatch = /([图表])\s*(\d+)\s*[-–—.．]\s*(\d+)/.exec(wanted);
  if (hintMatch) label = hintMatch[1] + " " + hintMatch[2] + "-" + hintMatch[3];
  var candidates = [];
  for (var i = 0; i < list.length; i += 1) {
    var line = list[i];
    if (!line || !Array.isArray(line.box) || !isCaption(line)) continue;
    if (!label) { candidates.push({ index: i, line: line, exact: false }); continue; }
    if (captionLabel(line) === label) candidates.push({ index: i, line: line, exact: true });
  }
  if (!candidates.length) return null;
  var exact = candidates.filter(function (c) { return c.exact; });
  var pool = exact.length ? exact : candidates;
  // lowest on the page: the caption sits under its figure
  pool.sort(function (a, b) { return b.line.box[1] - a.line.box[1]; });
  return pool[0];
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

// Median spacing between consecutive lines: the page's line pitch.
function linePitch(lines) {
  var tops = lines.map(function (line) { return line.box[1]; }).sort(function (a, b) { return a - b; });
  var gaps = [];
  for (var i = 1; i < tops.length; i += 1) {
    var gap = tops[i] - tops[i - 1];
    if (gap > 0.004) gaps.push(gap);
  }
  if (!gaps.length) return 0.02;
  gaps.sort(function (a, b) { return a - b; });
  return clamp(gaps[Math.floor(gaps.length / 2)], 0.008, 0.045);
}

// Walk up from the caption while the lines stay tight: those are the figure's own labels and
// table rows.  The first real gap means the paragraph above has started.
function blockTop(lines, index, captionTop, captionX0) {
  var above = lines.filter(function (line, at) {
    return at !== index && line.box[3] <= captionTop + 1e-9;
  }).sort(function (a, b) { return b.box[3] - a.box[3]; });
  var pitch = linePitch(lines);
  var tolerance = Math.max(0.03, pitch * 3);
  var neighbour = Number.isFinite(captionX0) ? Math.max(0.02, pitch * 1.4) : tolerance;
  var top = captionTop;
  var previousBottom = captionTop;
  for (var i = 0; i < above.length; i += 1) {
    var gap = previousBottom - above[i].box[3];
    // a line hanging in a different column is only part of the figure while it is tight
    var sameColumn = !Number.isFinite(captionX0) || above[i].box[0] >= captionX0 - 0.03;
    if (gap > (sameColumn ? tolerance : neighbour)) break;
    top = above[i].box[1];
    previousBottom = above[i].box[1];
  }
  return top;
}

// The nearest caption/heading above `top` bounds how far up a figure may reach.
function upperBound(lines, index, captionTop) {
  var list = Array.isArray(lines) ? lines : [];
  var bound = 0;
  for (var i = 0; i < list.length; i += 1) {
    if (i === index) continue;
    var line = list[i];
    if (!line || !Array.isArray(line.box)) continue;
    var bottom = line.box[3];
    if (bottom > captionTop - 0.005) continue;
    var text = normalizeText(line && line.text);
    var isStructure = isCaption(line) || (text.length <= 28 && HEADING_RE.test(text) && !/[。；，,]/.test(text));
    if (isStructure && bottom > bound) bound = bottom;
  }
  return bound;
}

// Column coverage inside the band tells the figure from the text column beside it.
function trimToCovered(box, colCoverage, minCoverage) {
  if (!Array.isArray(colCoverage) || !colCoverage.length) return box;
  var width = (box[2] - box[0]) / colCoverage.length;
  var first = -1;
  var last = -1;
  for (var i = 0; i < colCoverage.length; i += 1) {
    if (colCoverage[i] >= minCoverage) { if (first < 0) first = i; last = i; }
  }
  if (first < 0) return box;
  return [box[0] + first * width, box[1], box[0] + (last + 1) * width, box[3]];
}

// A figure's own blank lines (code listings, tables with spacing) must not end the band: walk
// upward while the row just above the box still has ink, stopping at a real gap.
function extendTopThroughInk(box, ink, options) {
  if (typeof ink !== "function") return box;
  var limit = Number(options && options.limit) || 0.08;
  var strip = Number(options && options.strip) || 0.012;
  var top = box[1];
  for (var guard = 0; guard < 12; guard += 1) {
    if (top <= 0.002 || box[1] - top >= limit) break;
    var next = Math.max(0, top - strip);
    var probe = null;
    try { probe = ink([box[0], next, box[2], top]); } catch (_) { break; }
    if (!probe || !probe.rowCoverage || !probe.rowCoverage.length) break;
    var covered = probe.rowCoverage.reduce(function (sum, value) { return sum + value; }, 0) / probe.rowCoverage.length;
    if (covered < 0.04) break;
    top = next;
  }
  if (top >= box[1]) return box;
  return [box[0], Math.round(top * 1000) / 1000, box[2], box[3]];
}

// Trim blank rows off the top of the band.
function trimBlankTop(box, rowCoverage) {
  if (!Array.isArray(rowCoverage) || !rowCoverage.length) return box;
  var height = (box[3] - box[1]) / rowCoverage.length;
  var first = 0;
  while (first < rowCoverage.length - 1 && rowCoverage[first] < 0.02) first += 1;
  return [box[0], box[1] + first * height, box[2], box[3]];
}

function sane(rect) {
  if (!Array.isArray(rect) || rect.length !== 4) return null;
  var values = rect.map(Number);
  if (!values.every(Number.isFinite)) return null;
  var out = [clamp(values[0], 0, 1), clamp(values[1], 0, 1), clamp(values[2], 0, 1), clamp(values[3], 0, 1)];
  if (out[2] - out[0] < 0.15 || out[3] - out[1] < 0.05) return null;
  if ((out[2] - out[0]) * (out[3] - out[1]) > 0.95) return null;
  return out.map(function (v) { return Math.round(v * 1000) / 1000; });
}

// snapBox({ lines, hint, rough, ink })
//   lines : OCR lines [{text, box}] page-relative, any order
//   hint  : the order's alt text ("图 4-34 …"); decides which caption to use
//   rough : optional rough rect (model or vision) to snap, in preference to a guess
//   ink   : optional sync sampler (rect) -> { colCoverage: number[], rowCoverage: number[] }
// -> { rect, caption, reason } | { rect: null, reason }
function snapBox(input) {
  input = input || {};
  var lines = (Array.isArray(input.lines) ? input.lines : []).filter(function (line) {
    return line && Array.isArray(line.box) && line.box.length === 4 && line.box.every(Number.isFinite);
  });
  if (!lines.length) return { rect: null, caption: null, reason: "no_lines" };
  var sorted = lines.slice().sort(function (a, b) { return a.box[1] - b.box[1]; });
  var found = findCaption(sorted, input.hint);
  if (!found) return { rect: null, caption: null, reason: "no_caption" };
  var caption = found.line;
  var captionTop = caption.box[1];
  var captionBottom = caption.box[3];
  // Keep the figure's top border: start a hair above its first tight line, never below.
  // Without a rough box, start wide and let the ink decide both edges: a figure can extend well
  // past its caption (a listing, a wide table).
  var captionX0 = Math.min(Math.max(caption.box[0] - 0.02, 0), 0.85);
  var reach = Math.max(0, blockTop(sorted, found.index, captionTop, caption.box[0]) - 0.014);
  var bound = Math.max(reach, upperBound(sorted, found.index, reach));

  var rough = sane(input.rough);
  var top = rough ? Math.max(bound, Math.min(rough[1], captionTop - 0.025)) : bound;
  var box = [
    rough ? rough[0] : (input.ink ? 0.04 : captionX0),
    top,
    rough ? rough[2] : (input.ink ? 0.98 : 0.97),
    Math.min(1, captionBottom + 0.012),
  ];
  if (input.debug) return { rect: box, caption: captionLabel(caption), reason: "debug", debug: { reach: reach, bound: bound, top: top, box: box } };
  box = sane(box);
  if (!box) return { rect: null, caption: captionLabel(caption), reason: "degenerate" };

  var profile = null;
  try { profile = input.ink ? input.ink(box) : null; } catch (_) { profile = null; }
  if (profile) {
    box = sane(trimBlankTop(box, profile.rowCoverage)) || box;
    box = sane(extendTopThroughInk(box, input.ink, { limit: captionTop - box[1] })) || box;
    // Keep the text column beside the figure out of the crop: a real figure covers its
    // columns over most of the band, prose does not.
    box = sane(trimToCovered(box, profile.colCoverage, Number(input.minCoverage) || 0.2)) || box;
  }
  var rect = sane(box);
  if (!rect) return { rect: null, caption: captionLabel(caption), reason: "degenerate_after_trim" };
  return { rect: rect, caption: captionLabel(caption), reason: input.rough ? "snapped" : "geometry" };
}

module.exports = {
  CAPTION_RE: CAPTION_RE,
  findCaption: findCaption,
  captionLabel: captionLabel,
  upperBound: upperBound,
  snapBox: snapBox,
  sane: sane,
};
