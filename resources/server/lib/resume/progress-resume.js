// progress-resume.js -- structured lesson-resume state (progress_state.json) read/write + KB focus location.
// Loaded by server.js into global.__RESUME__. Pure Node context (may require fs/path/crypto directly).
// Goal: when a learner opens a new classroom to continue, resume from where the previous lesson actually
//       ended, instead of snapping back to teaching_map phase 1 of the current window.
//
// Design notes:
//  - progress_state.json is the structured source of truth; progress.md first line (zh/en) can repair
//    stale state; textbook.currentPage is only a last resort when no teaching progress exists.
//  - The resume anchor is lastTaughtPage; the KB focus phase is derived from the phase covering that page
//    (no need to persist phaseIndex).
//  - writeState merges over old state and never drops fields; completed* arrays are unioned.
//  - stateHash folds resumeState into the KB cache key so different progress never shares one "current
//    focus" render.
"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var SCHEMA_VERSION = 3;
var STATE_FILE = "progress_state.json";

// Parse the page number from progress.md first line (or whole text). Handles zh/en variants:
//   # 当前页码：第 148 页 / # 当前页：第 148 页 / 第 148 页
//   # Current Page: Page 148 / Current Page: 148 / Page 148
function parseProgressPage(text) {
  if (!text || typeof text !== "string") return null;
  var firstLine = text.split("\n")[0] || "";
  var candidates = [firstLine, text];
  var patterns = [
    /第\s*(\d+)\s*[页頁]/, // zh: 第 148 页 / 第 148 頁
    /(?:current\s*page|page)\s*[:：]?\s*(?:page\s*)?(\d+)/i, // en: Current Page: Page 148 / Page 148
    /\bpage\s*(\d+)/i,
  ];
  for (var ci = 0; ci < candidates.length; ci++) {
    var src = candidates[ci];
    if (!src) continue;
    for (var pi = 0; pi < patterns.length; pi++) {
      var m = patterns[pi].exec(src);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > 0) return n;
      }
    }
  }
  return null;
}

function statePath(textbookDir) {
  return path.join(String(textbookDir || ""), STATE_FILE);
}

function readState(textbookDir) {
  try {
    var p = statePath(textbookDir);
    if (!fs.existsSync(p)) return null;
    var obj = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function uniqMerge(oldArr, newArr) {
  var out = [];
  var seen = {};
  [oldArr, newArr].forEach(function (arr) {
    if (!Array.isArray(arr)) return;
    arr.forEach(function (v) {
      if (v == null) return;
      var k = String(v);
      if (!seen[k]) { seen[k] = 1; out.push(v); }
    });
  });
  return out;
}

function normalizePage(n) {
  n = Number(n);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function firstPage() {
  for (var i = 0; i < arguments.length; i++) {
    var p = normalizePage(arguments[i]);
    if (p) return p;
  }
  return null;
}

function parseFirstProgressRange(text) {
  if (!text || typeof text !== "string") return null;
  var m = /\bp\.(\d+)\s*-\s*(\d+)/i.exec(text);
  if (!m) return null;
  var startPage = parseInt(m[1], 10);
  var endPage = parseInt(m[2], 10);
  if (!(startPage > 0 && endPage > 0)) return null;
  return { startPage: startPage, endPage: endPage };
}

function readWindowBounds(state) {
  state = state || {};
  var loaded = state.loadedCursor || {};
  var taught = state.taughtCursor || {};
  return {
    startPage: firstPage(state.windowStartPage, loaded.startPage, taught.startPage),
    endPage: firstPage(state.windowEndPage, loaded.endPage, taught.endPage),
  };
}

function looksLikeWindowTail(page, state) {
  page = normalizePage(page);
  if (!page) return false;
  var w = readWindowBounds(state);
  return !!(w.startPage && w.endPage && w.endPage > w.startPage && page === w.endPage);
}

function dewindowedPage(page, state) {
  page = normalizePage(page);
  if (!page) return null;
  var w = readWindowBounds(state);
  if (looksLikeWindowTail(page, state) && w.startPage) return w.startPage;
  return page;
}

function looksLikeProgressRangeTail(page, progressMdText, currentPage) {
  page = normalizePage(page);
  var range = parseFirstProgressRange(progressMdText);
  if (!page || !range || !(range.endPage > range.startPage)) return false;
  if (page !== range.endPage) return false;
  currentPage = normalizePage(currentPage);
  return !currentPage || currentPage === range.startPage;
}

// End-class should persist the actual teaching anchor, not the tail of the
// preloaded reading window. Prefer already-recorded teaching progress, then the
// active window start. Use windowEndPage only as a last resort.
// If global.__PROGRESS_GUARD__ is available, delegates to it; otherwise falls back
// to the built-in logic.
function resolveEndClassAnchor(opts) {
  opts = opts || {};
  // Use progress-guard if available
  if (typeof global !== "undefined" && global.__PROGRESS_GUARD__ && global.__PROGRESS_GUARD__.endClassAnchor) {
    try {
      var state = opts.state || (opts.textbookDir ? readState(opts.textbookDir) : null) || {};
      var fromMd = parseProgressPage(opts.progressMdText);
      var result = global.__PROGRESS_GUARD__.endClassAnchor({
        state: state,
        progressMdPage: fromMd,
        windowStartPage: opts.windowStartPage,
        windowEndPage: opts.windowEndPage,
        currentPage: opts.currentPage,
      });
      if (result) return result;
    } catch (e) {
      console.warn("[resume] progress-guard endClassAnchor failed, using fallback:", e.message);
    }
  }
  // Fallback: original logic
  var state = opts.state || (opts.textbookDir ? readState(opts.textbookDir) : null) || {};
  var fromMd = parseProgressPage(opts.progressMdText);
  var w = readWindowBounds({
    windowStartPage: opts.windowStartPage,
    windowEndPage: opts.windowEndPage,
    loadedCursor: state.loadedCursor,
    taughtCursor: state.taughtCursor,
  });
  var windowState = { windowStartPage: w.startPage, windowEndPage: w.endPage };
  var mdPage = looksLikeWindowTail(fromMd, windowState) ? null : fromMd;
  var rawStatePage = firstPage(state.lastTaughtPage, state.currentPage);
  var statePage = dewindowedPage(rawStatePage, {
    windowStartPage: w.startPage,
    windowEndPage: w.endPage,
    loadedCursor: state.loadedCursor,
    taughtCursor: state.taughtCursor,
  });
  var page = firstPage(mdPage, statePage, w.startPage, opts.currentPage, w.endPage, 1);
  var source = mdPage ? "progress.md"
             : (rawStatePage && statePage && rawStatePage !== statePage) ? "progress_state_window_start"
             : statePage ? "progress_state"
             : w.startPage ? "windowStartPage"
             : opts.currentPage ? "currentPage"
             : "windowEndPage";
  return { page: page, source: source, windowStartPage: w.startPage, windowEndPage: w.endPage };
}

function normalizeProgressMdPage(text, page, startPage) {
  page = normalizePage(page);
  if (!text || typeof text !== "string" || !page) return text;
  startPage = normalizePage(startPage) || page;
  var lines = text.split(/\r?\n/);
  var firstHeading = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*#/.test(lines[i])) { firstHeading = i; break; }
  }
  if (firstHeading < 0) {
    lines.unshift("# Current Page: Page " + page);
  } else if (/current\s*page/i.test(lines[firstHeading])) {
    lines[firstHeading] = "# Current Page: Page " + page;
  } else if (/\d+/.test(lines[firstHeading])) {
    lines[firstHeading] = lines[firstHeading].replace(/\d+/, String(page));
  } else {
    lines.splice(firstHeading, 0, "# Current Page: Page " + page);
  }
  var out = lines.join("\n");
  return out.replace(/\bp\.(\d+)\s*-\s*(\d+)/, "p." + startPage + "-" + page);
}

// Merge write: read old state -> shallow-merge partial (only fields explicitly present in partial)
//   -> union completed* arrays -> write to disk. Missing fields in partial keep old values; never
//   clears existing progress.
function writeState(textbookDir, partial) {
  try {
    if (!textbookDir) return null;
    var prev = readState(textbookDir) || {};
    var next = {};
    Object.keys(prev).forEach(function (k) { next[k] = prev[k]; });
    if (partial && typeof partial === "object") {
      Object.keys(partial).forEach(function (k) {
        var v = partial[k];
        if (v === undefined) return; // missing field: do not overwrite
        if (k === "completedConceptIds" || k === "completedTitles" || k === "resetCompleted") return; // arrays handled below
        next[k] = v;
      });
      if (partial.resetCompleted) {
        next.completedConceptIds = uniqMerge([], partial.completedConceptIds);
        next.completedTitles = uniqMerge([], partial.completedTitles);
      } else {
        next.completedConceptIds = uniqMerge(prev.completedConceptIds, partial.completedConceptIds);
        next.completedTitles = uniqMerge(prev.completedTitles, partial.completedTitles);
      }
    } else {
      next.completedConceptIds = uniqMerge(prev.completedConceptIds, null);
      next.completedTitles = uniqMerge(prev.completedTitles, null);
    }
    next.schemaVersion = SCHEMA_VERSION;
    next.updatedAt = new Date().toISOString();
    var p = statePath(textbookDir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    var tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
    try { fs.renameSync(tmp, p); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) {} throw e; }
    return next;
  } catch (e) {
    return null;
  }
}

// Administrative repair/migration helper. Unlike writeState(), this replaces
// the whole document so contaminated legacy fields cannot survive a reset.
function replaceState(textbookDir, value) {
  try {
    if (!textbookDir || !value || typeof value !== "object") return null;
    var next = {};
    Object.keys(value).forEach(function (key) {
      if (value[key] !== undefined && key !== "resetCompleted") next[key] = value[key];
    });
    next.completedConceptIds = uniqMerge([], next.completedConceptIds);
    next.completedTitles = uniqMerge([], next.completedTitles);
    next.schemaVersion = SCHEMA_VERSION;
    next.updatedAt = new Date().toISOString();
    var p = statePath(textbookDir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    var tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
    fs.renameSync(tmp, p);
    return next;
  } catch (e) {
    return null;
  }
}

// Convenience wrapper: update taughtCursor + mirror lastTaughtPage/currentPage.
// Range must have { start, end }. Also writes loadedCursor from range if not already set.
function updateTeachingRange(textbookDir, range, source) {
  range = range || {};
  var startPage = normalizePage(range.start);
  var endPage = normalizePage(range.end);
  if (!startPage || !endPage) return null;
  var prev = readState(textbookDir) || {};
  var taughtCursor = {
    chunkId: "taught-" + String(startPage).padStart(4, "0"),
    ordinal: startPage,
    startPage: startPage,
    endPage: endPage,
    status: "complete",
    coverage: 1,
    ready: true,
    committedAt: new Date().toISOString(),
    reason: source || "teaching_range_update",
  };
  var partial = {
    taughtCursor: taughtCursor,
    lastTaughtPage: startPage,
    currentPage: startPage,
  };
  // Also fill loadedCursor if missing
  if (!prev.loadedCursor || !prev.loadedCursor.startPage) {
    partial.loadedCursor = {
      chunkId: "loaded-" + String(startPage).padStart(4, "0"),
      ordinal: startPage,
      startPage: startPage,
      endPage: endPage,
      updatedAt: new Date().toISOString(),
    };
  }
  return writeState(textbookDir, partial);
}

// Resolve resume start page + resumeState. Priority: progress_state.json -> progress.md first line
//   -> currentPage -> 1. Always returns a resumeState (at least lastTaughtPage) so KB can locate the
//   focus phase by page; when there is no progress at all, resumeState=null.
function resolveStartPage(opts) {
  opts = opts || {};
  var textbookDir = opts.textbookDir;
  var progressMdText = opts.progressMdText;
  var currentPage = opts.currentPage;
  var fromMd = parseProgressPage(progressMdText);

  var state = textbookDir ? readState(textbookDir) : null;
  if (state) {
    var rawStatePage = (state.lastTaughtPage && state.lastTaughtPage > 0) ? state.lastTaughtPage
                     : (state.currentPage && state.currentPage > 0) ? state.currentPage
                     : null;
    var statePage = dewindowedPage(rawStatePage, state);
    var cp = (currentPage && currentPage > 0) ? currentPage : null;
    var sp = statePage || fromMd || cp || 1;
    var source = "progress_state";

    // progress_state.json is normally the richest source, but progress.md is the
    // human-readable teaching record and may be newer after older builds or a failed
    // structured write. textbook.currentPage can represent a preloaded/visible window,
    // so it must not leapfrog a real teaching-progress anchor.
    if (fromMd && fromMd > (statePage || 0)
        && !looksLikeWindowTail(fromMd, state)
        && !looksLikeProgressRangeTail(fromMd, progressMdText, statePage || cp)) {
      sp = fromMd;
      source = "progress.md+state";
    } else if (!statePage && cp) {
      sp = fromMd || cp;
      source = fromMd ? "progress.md+state" : "currentPage+state";
    } else if (rawStatePage && statePage && rawStatePage !== statePage) {
      sp = statePage;
      source = "progress_state_window_start";
    }

    if (source !== "progress_state") {
      var merged = {};
      Object.keys(state).forEach(function (k) { merged[k] = state[k]; });
      merged.currentPage = sp;
      merged.lastTaughtPage = sp;
      merged.source = source;
      return { startPage: sp, resumeState: merged, source: merged.source };
    }

    return { startPage: sp, resumeState: state, source: source };
  }

  if (fromMd && fromMd > 0) {
    var range = parseFirstProgressRange(progressMdText);
    var cpNoState = (currentPage && currentPage > 0) ? currentPage : null;
    if (looksLikeProgressRangeTail(fromMd, progressMdText, cpNoState) && range) {
      return {
        startPage: range.startPage,
        resumeState: {
          schemaVersion: SCHEMA_VERSION,
          lastTaughtPage: range.startPage,
          currentPage: range.startPage,
          windowStartPage: range.startPage,
          windowEndPage: range.endPage,
          source: "progress.md_window_start",
        },
        source: "progress.md_window_start",
      };
    }
    return {
      startPage: fromMd,
      resumeState: { schemaVersion: SCHEMA_VERSION, lastTaughtPage: fromMd, source: "progress.md" },
      source: "progress.md",
    };
  }

  var cp = (currentPage && currentPage > 0) ? currentPage : 1;
  return {
    startPage: cp,
    resumeState: (currentPage && currentPage > 0)
      ? { schemaVersion: SCHEMA_VERSION, lastTaughtPage: cp, source: "currentPage" }
      : null,
    source: "currentPage",
  };
}

// Locate the KB focus phase from resumeState + teachingMap + cardMap.
// Returns { phaseIndex, completedSet:{idx:true}, lastFocusText, lastTaughtPage } or null (cannot locate).
// Priority: explicit phaseIndex > explicit title/conceptId (exact match) > page coverage.
// NOTE: currentFocus is freeform text and is NEVER used for exact phase matching (it would mismatch
//       arbitrary card ids/titles); it is only surfaced as lastFocusText for the soft-resume directive.
function focusFromState(teachingMap, cardMap, resumeState) {
  if (!resumeState || !teachingMap || !teachingMap.sequence || !teachingMap.sequence.length) return null;
  var seq = teachingMap.sequence;
  cardMap = cardMap || {};

  // Completed lookups from resumeState (only used when explicitly provided).
  var completedTitles = {};
  (resumeState.completedTitles || []).forEach(function (t) { if (t != null) completedTitles[String(t)] = true; });
  var completedConcepts = {};
  (resumeState.completedConceptIds || []).forEach(function (c) { if (c != null) completedConcepts[String(c)] = true; });
  var hasCompleted = Object.keys(completedTitles).length > 0 || Object.keys(completedConcepts).length > 0;

  var queue = [];
  for (var qi = 0; qi < seq.length; qi++) {
    var qids = seq[qi].card_ids || [];
    for (var qci = 0; qci < qids.length; qci++) {
      var qid = qids[qci];
      var qcard = cardMap[qid] || null;
      queue.push({
        phaseIndex: qi,
        cardIndex: qci,
        queueIndex: queue.length,
        cardId: qid,
        activeConceptId: String(qcard && qcard.concept_id || qid),
        card: qcard,
      });
    }
  }

  function queueMatch(entry, want) {
    if (!entry) return false;
    want = String(want);
    var c = entry.card;
    return String(entry.cardId) === want || String(entry.activeConceptId) === want ||
      !!(c && c.title != null && String(c.title) === want);
  }

  // Does a phase contain a card matching `want` by card_id, card.title, or card.concept_id?
  function phaseMatchesId(phase, want) {
    var ids = phase.card_ids || [];
    for (var k = 0; k < ids.length; k++) {
      var cid = ids[k];
      if (String(cid) === want) return true;
      var c = cardMap[cid];
      if (c) {
        if (c.title != null && String(c.title) === want) return true;
        if (c.concept_id != null && String(c.concept_id) === want) return true;
      }
    }
    return false;
  }

  // Is every card in a phase present in the completed sets (by title/concept_id/card_id)?
  function phaseCompleted(phase) {
    if (!hasCompleted) return false;
    var ids = phase.card_ids || [];
    if (!ids.length) return false;
    for (var k = 0; k < ids.length; k++) {
      var cid = ids[k];
      var c = cardMap[cid];
      var title = (c && c.title != null) ? String(c.title) : null;
      var concept = (c && c.concept_id != null) ? String(c.concept_id) : null;
      var done = (title && completedTitles[title]) || (concept && completedConcepts[concept])
              || completedTitles[String(cid)] || completedConcepts[String(cid)];
      if (!done) return false;
    }
    return true;
  }

  var phaseIndex = null;
  var activeEntry = null;

  // 1) schema-v3 exact active card. This is the strongest resume anchor.
  if (resumeState.activeConceptId) {
    for (var aq = 0; aq < queue.length; aq++) {
      if (queueMatch(queue[aq], resumeState.activeConceptId)) {
        activeEntry = queue[aq];
        phaseIndex = activeEntry.phaseIndex;
        break;
      }
    }
  }

  // 2) explicit legacy phaseIndex
  if (typeof resumeState.phaseIndex === "number" && resumeState.phaseIndex >= 0 && resumeState.phaseIndex < seq.length) {
    if (phaseIndex === null) phaseIndex = resumeState.phaseIndex;
  }

  // 3) explicit legacy title / conceptId -> find owning phase (exact match, NOT currentFocus)
  if (phaseIndex === null && (resumeState.title || resumeState.conceptId)) {
    var want = String(resumeState.title || resumeState.conceptId);
    for (var i = 0; i < seq.length; i++) {
      if (phaseMatchesId(seq[i], want)) { phaseIndex = i; break; }
    }
  }

  // 4) page coverage: among phases whose card source_pages cover lastTaughtPage, pick the first
  //    not-yet-completed phase when completed* is known; otherwise keep the last covering phase.
  //    Explicit page starts are different from resume anchors: if a learner asks to start at p.N,
  //    begin with the earliest matching phase instead of the last broad/cross-page phase.
  var page = (resumeState.lastTaughtPage && resumeState.lastTaughtPage > 0) ? resumeState.lastTaughtPage
           : (resumeState.currentPage && resumeState.currentPage > 0) ? resumeState.currentPage : null;
  var explicitStartPage = !!(resumeState.explicitStartPage || resumeState.requestedStartPage || resumeState.jumpLoaded);
  if (phaseIndex === null && page != null && cardMap) {
    var covering = [];
    for (var pi = 0; pi < seq.length; pi++) {
      var cids = seq[pi].card_ids || [];
      for (var ci = 0; ci < cids.length; ci++) {
        var c = cardMap[cids[ci]];
        var spages = c && c.source_pages;
        if (spages && spages.length >= 2 && spages[0] <= page && spages[1] >= page) { covering.push(pi); break; }
      }
    }
    if (covering.length) {
      if (hasCompleted) {
        var picked = null;
        for (var x = 0; x < covering.length; x++) {
          if (!phaseCompleted(seq[covering[x]])) { picked = covering[x]; break; }
        }
        phaseIndex = (picked !== null) ? picked : covering[covering.length - 1];
      } else {
        phaseIndex = explicitStartPage ? covering[0] : covering[covering.length - 1]; // no completed info: keep legacy resume fallback
      }
    }
  }

  if (phaseIndex === null) {
    // Cannot pin a phase; still surface page/lastFocus so the caller can emit a soft-resume directive.
    return { phaseIndex: null, cardIndex: null, queueIndex: null, activeConceptId: null, completedSet: null, lastFocusText: resumeState.lastFocus || resumeState.currentFocus || null, lastTaughtPage: page };
  }

  if (!activeEntry) {
    for (var qe = 0; qe < queue.length; qe++) {
      var entry = queue[qe];
      if (entry.phaseIndex !== phaseIndex) continue;
      var ec = entry.card || {};
      var eid = String(ec.concept_id || entry.cardId);
      var etitle = ec.title != null ? String(ec.title) : String(entry.cardId);
      if (!completedConcepts[eid] && !completedConcepts[String(entry.cardId)] &&
          !completedTitles[etitle] && !completedTitles[String(entry.cardId)]) {
        activeEntry = entry;
        break;
      }
    }
    if (!activeEntry) {
      for (var qf = 0; qf < queue.length; qf++) {
        if (queue[qf].phaseIndex === phaseIndex) { activeEntry = queue[qf]; break; }
      }
    }
  }

  // Mark phases before the focus as completed, plus any phase explicitly fully completed.
  var completed = {};
  for (var j = 0; j < phaseIndex; j++) completed[j] = true;
  if (hasCompleted) {
    for (var p2 = 0; p2 < seq.length; p2++) { if (p2 !== phaseIndex && phaseCompleted(seq[p2])) completed[p2] = true; }
  }
  return {
    phaseIndex: phaseIndex,
    cardIndex: activeEntry ? activeEntry.cardIndex : null,
    queueIndex: activeEntry ? activeEntry.queueIndex : null,
    activeConceptId: activeEntry ? activeEntry.activeConceptId : null,
    completedSet: completed,
    lastFocusText: resumeState.lastFocus || resumeState.currentFocus || null,
    lastTaughtPage: page,
  };
}

// Stable short hash of resumeState, folded into the KB cache key. No resumeState -> "" (legacy behavior).
function stateHash(resumeState) {
  if (!resumeState) return "";
  try {
    var completedLen = (Array.isArray(resumeState.completedTitles) ? resumeState.completedTitles.length : 0)
                     + (Array.isArray(resumeState.completedConceptIds) ? resumeState.completedConceptIds.length : 0);
    var taught = resumeState.taughtCursor || {};
    var loaded = resumeState.loadedCursor || {};
    var key = [
      resumeState.lastTaughtPage || resumeState.currentPage || "",
      resumeState.phaseIndex != null ? resumeState.phaseIndex : "",
      resumeState.activeConceptId || resumeState.title || resumeState.conceptId || resumeState.currentFocus || "",
      completedLen || "",
      resumeState.textbookId || "",
      resumeState.sourceConversationId || "",
      taught.chunkId || "",
      taught.status || "",
      loaded.chunkId || "",
    ].join("|");
    if (!key.replace(/\|/g, "")) return "";
    return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
  } catch (e) {
    return "";
  }
}

// One-shot resume stash: the chat first turn calls setPending(convId, resumeState) before invoking the
//   read_textbook_pages tool; inside the tool (chunk 9654) takePending(convId) retrieves and clears it
//   when calling __KB_DISTILL__. One-shot by design: read-and-delete, so later normal page turns never
//   carry a stale resume focus.
var _pending = new Map();
function setPending(convId, resumeState) {
  if (!convId) return;
  if (resumeState) _pending.set(String(convId), resumeState);
  else _pending.delete(String(convId));
}
function takePending(convId) {
  if (!convId) return null;
  var k = String(convId);
  var v = _pending.has(k) ? _pending.get(k) : null;
  _pending.delete(k);
  return v;
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  STATE_FILE: STATE_FILE,
  parseProgressPage: parseProgressPage,
  parseFirstProgressRange: parseFirstProgressRange,
  statePath: statePath,
  readState: readState,
  writeState: writeState,
  replaceState: replaceState,
  updateTeachingRange: updateTeachingRange,
  resolveStartPage: resolveStartPage,
  resolveEndClassAnchor: resolveEndClassAnchor,
  normalizeProgressMdPage: normalizeProgressMdPage,
  focusFromState: focusFromState,
  stateHash: stateHash,
  setPending: setPending,
  takePending: takePending,
};
