// progress-guard.js — Classroom-progression guard: separates loaded range from taught range,
// enforces adjacency, clamps end-class anchors, and adds structured observable logging.
// Loaded by server.js into global.__PROGRESS_GUARD__. Pure computation — no I/O.
"use strict";

// ---- range helpers ----

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

// ---- computeTeachingRange ----
// Extract the current "taught" range from progress_state.json fields.
// Priority: taughtCursor (complete → startPage, else → startPage) → lastTaughtPage → currentPage → loadedCursor.startPage.
function computeTeachingRange(state) {
  state = state || {};
  var taught = state.taughtCursor || {};
  var loaded = state.loadedCursor || {};
  var taughtPage = null;
  if (taught.startPage && taught.startPage > 0) {
    taughtPage = taught.startPage;
    if (taught.status === "complete" && taught.endPage && taught.endPage > taught.startPage) {
      taughtPage = taught.endPage;
    }
  }
  var lastTaught = firstPage(taughtPage, state.lastTaughtPage, state.currentPage, loaded.startPage, 1);
  return {
    startPage: firstPage(taught.startPage, loaded.startPage, state.windowStartPage, state.currentPage, 1),
    endPage: taughtPage || lastTaught || 1,
    lastTaughtPage: lastTaught || 1,
  };
}

// ---- allowedNextStart ----
// nextStart must fall in [current.start, current.end + 1] unless opts.jump.
// Returns { allowed, corrected, reason }.
function allowedNextStart(current, nextStart, opts) {
  opts = opts || {};
  current = current || {};
  nextStart = normalizePage(nextStart);
  if (!nextStart || nextStart < 1) return { allowed: false, corrected: null, reason: "invalid_page" };

  if (opts.jump) {
    return { allowed: true, corrected: nextStart, reason: "jump_explicit" };
  }

  var curStart = normalizePage(current.start) || 1;
  var curEnd = normalizePage(current.end) || curStart;

  if (nextStart >= curStart && nextStart <= curEnd + 1) {
    return { allowed: true, corrected: nextStart, reason: "adjacent" };
  }

  // Too far forward: clamp to current.end + 1
  if (nextStart > curEnd + 1) {
    return { allowed: false, corrected: curEnd + 1, reason: "too_far_forward" };
  }

  // Before current range: keep current start (don't go backward)
  return { allowed: false, corrected: curStart, reason: "before_current" };
}

// ---- evaluateCommit ----
// Decides whether an automatic trigger is allowed to commit loadedRange into taughtRange.
// signal.trigger values and their commit permission:
//   userPageAdvanceIntent, weakStallSignal, markdownReadyCommit → always allowed
//   cached-prefetch + threshold/secondHalf/TAE/windowEnd/assistantSignal → only if adjacent
function evaluateCommit(current, loadedRange, signal) {
  signal = signal || {};
  current = current || {};
  loadedRange = loadedRange || {};
  var trigger = signal.trigger || "";
  var isMarkdownLike = !!signal.isMarkdownLike;
  var fromPrefetch = !!signal.fromPrefetch;

  // Direct user-initiated or stall signals always commit
  if (trigger === "user_page_intent" || trigger === "weak_stall" || trigger === "markdown_ready_commit") {
    var checked = allowedNextStart(current, loadedRange.startPage, {});
    if (!checked.allowed) {
      return {
        allowed: false,
        reason: "direct_signal_non_adjacent",
        correctedStart: checked.corrected,
        correctedEnd: loadedRange.endPage,
      };
    }
    return { allowed: true, reason: trigger, correctedStart: checked.corrected, correctedEnd: loadedRange.endPage };
  }

  // Cached prefetch or auto triggers: must be adjacent
  if (fromPrefetch) {
    var adj = allowedNextStart(current, loadedRange.startPage, {});
    if (!adj.allowed) {
      return {
        allowed: false,
        reason: "cached_prefetch_non_adjacent",
        correctedStart: adj.corrected,
        correctedEnd: loadedRange.endPage,
      };
    }
    return { allowed: true, reason: "cached_prefetch_adjacent", correctedStart: adj.corrected, correctedEnd: loadedRange.endPage };
  }

  // Auto triggers (secondHalf, TAE, threshold, windowEnd, assistant): adjacency required
  var autoTriggers = { kb_second_half_prefetch: 1, tae_prefetch: 1, threshold_prefetch: 1, window_end_prefetch: 1, assistant_signal: 1, user_prefetch: 1, cached_prefetch_commit: 1 };
  if (autoTriggers[trigger]) {
    var autoAdj = allowedNextStart(current, loadedRange.startPage, {});
    if (!autoAdj.allowed) {
      return {
        allowed: false,
        reason: "auto_trigger_non_adjacent",
        correctedStart: autoAdj.corrected,
        correctedEnd: loadedRange.endPage,
      };
    }
    return { allowed: true, reason: "auto_trigger_adjacent", correctedStart: autoAdj.corrected, correctedEnd: loadedRange.endPage };
  }

  // Unknown trigger — allow with warning
  return { allowed: true, reason: "unknown_trigger_allowed", correctedStart: loadedRange.startPage, correctedEnd: loadedRange.endPage };
}

// ---- endClassAnchor ----
// Compute the safest anchor page for end-class saving.
// Priority: taughtCursor → lastTaughtPage → progress.md (dewindowed) → windowStartPage → currentPage.
// Never returns > currentTeachingEnd + 1.
function endClassAnchor(opts) {
  opts = opts || {};
  var state = opts.state || {};
  var taught = state.taughtCursor || {};
  var progressMdPage = normalizePage(opts.progressMdPage);
  var windowStart = normalizePage(opts.windowStartPage);
  var windowEnd = normalizePage(opts.windowEndPage);
  var currentPage = normalizePage(opts.currentPage);

  var teachingRange = computeTeachingRange(state);
  var taughtPage = teachingRange.lastTaughtPage;

  var candidate = null;
  var source = "none";

  // 1) taughtCursor / lastTaughtPage
  if (taughtPage && taughtPage > 0) {
    candidate = taughtPage;
    source = "taught_cursor";
  }

  // 2) progress.md page — dewindowed (must not be the raw window tail)
  if (progressMdPage && progressMdPage > 0) {
    var isWindowTail = windowStart && windowEnd && windowEnd > windowStart && progressMdPage === windowEnd;
    if (!isWindowTail && (!candidate || progressMdPage > candidate)) {
      candidate = progressMdPage;
      source = "progress_md";
    }
  }

  // 3) windowStartPage
  if (!candidate && windowStart && windowStart > 0) {
    candidate = windowStart;
    source = "window_start";
  }

  // 4) currentPage
  if (!candidate && currentPage && currentPage > 0) {
    candidate = currentPage;
    source = "current_page";
  }

  // 5) last resort
  if (!candidate || candidate < 1) {
    candidate = 1;
    source = "fallback_1";
  }

  // Clamp: never go beyond current teaching end + 1
  var maxPage = Math.max(taughtPage || windowStart || 1, (windowStart || 1));
  if (candidate > maxPage + 1) {
    candidate = maxPage + 1;
    source = source + "_clamped";
  }

  return { page: candidate, source: source, windowStartPage: windowStart, windowEndPage: windowEnd };
}

// ---- log ----
function log(tag, data) {
  try {
    var parts = ["[progress-guard]", tag];
    if (data && typeof data === "object") {
      Object.keys(data).forEach(function (k) {
        var v = data[k];
        if (v !== undefined && v !== null) parts.push(k + "=" + String(v));
      });
    }
    console.log(parts.join(" "));
  } catch (e) {
    // never let logging break the flow
  }
}

module.exports = {
  computeTeachingRange: computeTeachingRange,
  allowedNextStart: allowedNextStart,
  evaluateCommit: evaluateCommit,
  endClassAnchor: endClassAnchor,
  log: log,
};
