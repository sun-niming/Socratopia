/**
 * Trust Policy
 *
 * Assigns reliability labels to sources and determines how external
 * evidence should be treated relative to local (textbook/KB) knowledge.
 *
 * Reliability levels (from plan):
 *   high    — official docs, legal text, peer-reviewed, textbook, local KB
 *   medium  — reputable orgs, reliable encyclopedias, corroborated sources
 *   low     — community answers, forums, model summaries, uncited claims
 *   unknown — no source, inaccessible source, cannot verify
 *
 * Core rule: local textbook/KB evidence always outranks external sources.
 * External evidence can supplement but never override local knowledge.
 */

(function () {
  "use strict";

  var RELIABILITY_ORDER = { high: 4, medium: 3, low: 2, unknown: 1 };

  /**
   * Determine whether external evidence conflicts with local knowledge.
   * Returns null if no conflict, or a conflict descriptor.
   */
  function detectConflict(externalClaims, localClaims) {
    if (!Array.isArray(externalClaims) || !externalClaims.length) return null;
    if (!Array.isArray(localClaims) || !localClaims.length) return null;

    var conflicts = [];
    externalClaims.forEach(function (ec) {
      if (!ec || !ec.text) return;
      localClaims.forEach(function (lc) {
        if (!lc || !lc.text) return;
        // Simple contradiction heuristic: if both exist and differ
        if (claimsContradict(ec.text, lc.text)) {
          conflicts.push({
            externalClaim: ec.text,
            localClaim: lc.text,
            externalConfidence: ec.confidence,
            localConfidence: lc.confidence,
            resolution: "local_preferred",
          });
        }
      });
    });

    return conflicts.length ? conflicts : null;
  }

  /**
   * Simple contradiction check — two claims contradict if they use negating
   * language about the same topic. This is intentionally a heuristic;
   * full semantic contradiction detection would require an LLM call.
   */
  function claimsContradict(a, b) {
    if (!a || !b) return false;
    var aLow = a.toLowerCase();
    var bLow = b.toLowerCase();
    // If one asserts and the other denies, flag as potential conflict
    var negations = ["不", "没", "非", "否", "not ", "never ", "no ", "cannot "];
    var hasNegationA = negations.some(function (n) { return aLow.indexOf(n) >= 0; });
    var hasNegationB = negations.some(function (n) { return bLow.indexOf(n) >= 0; });
    return hasNegationA !== hasNegationB;
  }

  /**
   * Resolve the effective reliability for a source based on its origin field.
   */
  function resolveReliability(origin, sourceTitle) {
    var o = (origin || "").toLowerCase();
    var t = (sourceTitle || "").toLowerCase();

    // High-reliability origins
    if (o === "textbook" || o === "local_kb" || o === "official" || o === "legal") return "high";
    if (t.indexOf("法规") >= 0 || t.indexOf("law") >= 0 || t.indexOf("standard") >= 0) return "high";

    // Medium-reliability origins
    if (o === "encyclopedia" || o === "academic" || o === "news") return "medium";
    if (t.indexOf("百科") >= 0 || t.indexOf("wiki") >= 0) return "medium";

    // Low-reliability origins
    if (o === "forum" || o === "social" || o === "blog") return "low";
    if (o === "kimi" || o === "kimi-desktop" || o === "llm" || o === "model_summary") return "low";

    return "unknown";
  }

  /**
   * Should we trust this source at the given minimum level?
   */
  function meetsThreshold(reliability, minimum) {
    var r = RELIABILITY_ORDER[reliability] || 0;
    var m = RELIABILITY_ORDER[minimum] || 0;
    return r >= m;
  }

  module.exports = {
    detectConflict: detectConflict,
    resolveReliability: resolveReliability,
    meetsThreshold: meetsThreshold,
    RELIABILITY_ORDER: RELIABILITY_ORDER,
  };
})();
