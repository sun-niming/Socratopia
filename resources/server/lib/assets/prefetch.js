// lib/assets/prefetch.js — warms the page raster cache for pages the tutor is
// about to cite, off the turn's critical path.
//
// Why: a `book://<tid>/p<page>#rect` order has to rasterize the page before it can
// crop.  The reading window advances in the background already (lib/reading/
// auto-advance.js), so the pages just past the window are exactly the ones a figure
// order will land on.  Rendering them early turns a ~600ms stall into a crop.
//
// Contract: never throws, never blocks, de-duplicates, and is safe to call on every
// turn.  Pages already in the raster cache cost one map lookup.
"use strict";

var store = require("./store.js");

var MAX_PAGES_PER_RUN = 3;
var LOOKAHEAD_PAGES = 2;

var inFlight = Object.create(null);
var recent = Object.create(null);
var THROTTLE_MS = 30 * 1000;

function log(message) {
  console.log("[assets] " + message);
}

function renderer() {
  return global.__PDF_PAGE_RENDER__ || require("../pdf-page-render.js");
}

// `pages` may be given directly, or derived from `endPage` (window end) + lookahead.
function resolvePages(input) {
  var pages = [];
  if (Array.isArray(input.pages)) {
    pages = input.pages.map(Number);
  } else if (Number.isInteger(Number(input.endPage))) {
    var end = Number(input.endPage);
    for (var i = 1; i <= LOOKAHEAD_PAGES; i += 1) pages.push(end + i);
  }
  var seen = Object.create(null);
  return pages
    .filter(function (page) { return Number.isInteger(page) && page >= 1; })
    .filter(function (page) {
      if (seen[page]) return false;
      seen[page] = true;
      return true;
    })
    .slice(0, MAX_PAGES_PER_RUN);
}

function resolvePdf(input) {
  if (input.pdfPath) return input.pdfPath;
  var worldDir = input.worldDir || store.resolveScope(input).worldDir;
  if (!input.textbookId) return null;
  var target = renderer().resolveTextbookPdf(worldDir, input.textbookId);
  return typeof target === "string" ? target : target && (target.path || target.pdfPath);
}

// Returns a promise that always resolves to a small report.
async function schedule(input) {
  input = input && typeof input === "object" ? input : {};
  var report = { scheduled: 0, rendered: 0, cached: 0, failed: 0, skipped: null };
  var pages;
  try {
    pages = resolvePages(input);
  } catch (error) {
    report.skipped = "bad_pages";
    return report;
  }
  if (!pages.length) {
    report.skipped = "no_pages";
    return report;
  }

  var pdfPath;
  try {
    pdfPath = resolvePdf(input);
  } catch (error) {
    report.skipped = "no_pdf";
    return report;
  }
  if (!pdfPath) {
    report.skipped = "no_pdf";
    return report;
  }

  var now = Date.now();
  var fresh = pages.filter(function (page) { return !recent[pdfPath + "|" + page] || now - recent[pdfPath + "|" + page] > THROTTLE_MS; });
  if (!fresh.length) {
    report.skipped = "throttled";
    return report;
  }
  if (inFlight[pdfPath]) {
    report.skipped = "in_flight";
    return report;
  }
  report.scheduled = fresh.length;

  inFlight[pdfPath] = true;
  var started = Date.now();
  try {
    var outcome = await renderer().prefetchPages(pdfPath, fresh, input.opts);
    report.rendered = outcome.rendered;
    report.cached = outcome.cached;
    report.failed = outcome.failed;
    fresh.forEach(function (page) { recent[pdfPath + "|" + page] = Date.now(); });
    if (outcome.rendered) {
      log("page prefetch rendered=" + outcome.rendered + " cached=" + outcome.cached +
        " failed=" + outcome.failed + " pages=" + outcome.pages.join(",") +
        " in " + (Date.now() - started) + "ms");
    }
  } catch (error) {
    report.failed += 1;
    log("page prefetch failed: " + (error && (error.message || error.code)));
  } finally {
    delete inFlight[pdfPath];
  }
  return report;
}

// Fire-and-forget wrapper for the chat route.
function scheduleInBackground(input) {
  try {
    schedule(input).catch(function () {});
  } catch (_) { /* never break a turn */ }
}

function stats() {
  return { inFlight: Object.keys(inFlight).length, recent: Object.keys(recent).length, throttleMs: THROTTLE_MS };
}

function reset() {
  inFlight = Object.create(null);
  recent = Object.create(null);
}

module.exports = {
  schedule: schedule,
  scheduleInBackground: scheduleInBackground,
  resolvePages: resolvePages,
  stats: stats,
  reset: reset,
  MAX_PAGES_PER_RUN: MAX_PAGES_PER_RUN,
  LOOKAHEAD_PAGES: LOOKAHEAD_PAGES,
};
