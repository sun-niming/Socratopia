/**
 * Teaching pace profiles (教学节奏).
 *
 * Three named paces turn "how fast should the class move" into concrete numbers
 * that the chat route already uses as hard thresholds.  Without this the pace
 * setting would be nothing but prose in the prompt: the advance trigger in
 * `.next/server/app/api/chat/route.js` compares `turnsSinceAdvance` against
 * hard-coded constants (10 for markdown textbooks, 12 otherwise, 6 turns before
 * the window end forces a prefetch).
 *
 * The chosen pace travels in the chat request body as `teachingPace` and is
 * resolved here.  Everything is a pure function: no clock, no LLM, no I/O, and
 * unknown values fall back to `normal` so an older client can never wedge the
 * classroom.
 */
(function () {
  "use strict";

  var DEFAULT_PACE = "normal";

  // `settings.teachingPace` values, in the order the settings UI shows them.
  var PACE_IDS = ["slow", "normal", "brisk"];

  var PROFILES = {
    // 慢工细活 — spend many turns on one window; only a deliberate page jump
    // moves on early.
    slow: {
      id: "slow",
      // Turns since the last advance before a *threshold* prefetch fires.
      thresholds: { markdown: 16, other: 18 },
      // Turns since the last advance before the window end alone forces a move.
      windowEndTurns: 10,
      // Minimum turns before a bare "next page" intent is honoured.
      intentAdvanceMinTurns: 3,
      // Rules-side line injected with the window snapshot (one per language).
      guidance: "当前节奏：慢工细活。宁可在同一页多停留，也要把学习者真正讲懂；例子给足，卡住时退回更小的步子。",
      guidanceZhTw: "當前節奏：慢工細活。寧可在同一頁多停留，也要把學習者真正講懂；例子給足，卡住時退回更小的步子。",
      guidanceEn: "Current pace: slow and thorough. Stay on the same page as long as it takes for the learner to actually understand; give plenty of examples, and drop to smaller steps when they stall."
    },
    normal: {
      id: "normal",
      thresholds: { markdown: 10, other: 12 },
      windowEndTurns: 6,
      intentAdvanceMinTurns: 1,
      guidance: "",
      guidanceZhTw: "",
      guidanceEn: ""
    },
    // 主线速通 — only the main line; the window drains quickly.
    brisk: {
      id: "brisk",
      thresholds: { markdown: 6, other: 7 },
      windowEndTurns: 3,
      intentAdvanceMinTurns: 1,
      guidance: "当前节奏：主线速通。只讲主线，例子从简，一个知识点讲完立刻推进；细节留给学习者自己问。",
      guidanceZhTw: "當前節奏：主線速通。只講主線，例子從簡，一個知識點講完立刻推進；細節留給學習者自己問。",
      guidanceEn: "Current pace: brisk main line. Cover only the main line, keep examples brief, and move on as soon as a point is told; leave details for the learner to ask about."
    }
  };

  /** Guidance line for a language tag ("english" / "chinese-traditional" / else). */
  function guidanceFor(profile, language) {
    var active = profile || PROFILES[DEFAULT_PACE];
    if (language === "english") return active.guidanceEn || "";
    if (language === "chinese-traditional") return active.guidanceZhTw || "";
    return active.guidance || "";
  }

  function normalize(raw) {
    var value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return Object.prototype.hasOwnProperty.call(PROFILES, value) ? value : DEFAULT_PACE;
  }

  function isValid(raw) {
    var value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return Object.prototype.hasOwnProperty.call(PROFILES, value);
  }

  /** Resolve a request's pace to a frozen profile. Unknown input yields normal. */
  function resolve(raw) {
    return PROFILES[normalize(raw)];
  }

  /**
   * Threshold for the textbook's reading format.  Markdown textbooks advance in
   * "commit" mode and can afford a faster threshold than page-raster ones.
   */
  function thresholdFor(profile, isMarkdownLike) {
    var active = profile || PROFILES[DEFAULT_PACE];
    return isMarkdownLike ? active.thresholds.markdown : active.thresholds.other;
  }

  module.exports = {
    DEFAULT_PACE: DEFAULT_PACE,
    PACE_IDS: PACE_IDS.slice(),
    PROFILES: PROFILES,
    normalize: normalize,
    isValid: isValid,
    resolve: resolve,
    thresholdFor: thresholdFor,
    guidanceFor: guidanceFor
  };
})();
