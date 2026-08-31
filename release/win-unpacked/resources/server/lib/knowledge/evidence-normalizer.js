/**
 * Evidence Normalizer
 *
 * Transforms raw provider output into a structured evidence package.
 * Every provider's query() response passes through this normalizer before
 * it reaches the router or any consumer. This ensures downstream code
 * always sees a consistent shape regardless of provider internals.
 */

(function () {
  "use strict";

  var CONTRACT = require("./provider-contract.js").CONTRACT;

  /**
   * Normalize a provider query() response into the standard evidence package.
   * Fills in missing fields so consumers never trip on undefined.
   */
  function normalizeResponse(raw, providerId, mode) {
    if (!raw || typeof raw !== "object") {
      return emptyPackage(providerId, mode, "error");
    }

    var status = CONTRACT.VALID_STATUSES.indexOf(raw.status) >= 0
      ? raw.status : "error";

    var out = {
      providerId: providerId || raw.providerId || "unknown",
      status: status,
      mode: mode || raw.mode || "search",
      answer: typeof raw.answer === "string" ? raw.answer : "",
      claims: normalizeClaims(raw.claims),
      sources: normalizeSources(raw.sources),
      raw: {
        excerpt: (raw.raw && raw.raw.excerpt) || "",
        adapterMeta: (raw.raw && raw.raw.adapterMeta) || {},
      },
      cost: {
        latencyMs: typeof raw.cost === "number" ? raw.cost
          : (raw.cost && typeof raw.cost.latencyMs === "number" ? raw.cost.latencyMs : 0),
        tokens: (raw.cost && typeof raw.cost.tokens === "number") ? raw.cost.tokens : null,
      },
    };
    return out;
  }

  /**
   * Parse unstructured text (e.g. a user-pasted Kimi reply) into an evidence
   * package. Best-effort: splits by paragraph, treats each as an unverified claim.
   * Never throws.
   */
  function normalizeUnstructuredText(text, providerId, mode) {
    if (!text || typeof text !== "string") {
      return emptyPackage(providerId || "manual", mode || "search", "error");
    }

    text = text.trim();
    if (!text.length) {
      return emptyPackage(providerId || "manual", mode || "search", "error");
    }

    var paragraphs = text.split(/\n{2,}/).filter(Boolean);
    var claims = paragraphs.map(function (p, i) {
      return {
        text: p.trim(),
        type: "summary",
        confidence: null,
        support: [],
        conflicts: [],
      };
    });

    return {
      providerId: providerId || "manual",
      status: "partial",
      mode: mode || "search",
      answer: paragraphs[0] || text,
      claims: claims,
      sources: [],
      raw: {
        excerpt: text.slice(0, 500),
        adapterMeta: { charCount: text.length, paragraphCount: paragraphs.length },
      },
      cost: { latencyMs: 0, tokens: null },
    };
  }

  function normalizeClaims(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean).map(function (c) {
      return {
        text: typeof c.text === "string" ? c.text : "",
        type: ["fact", "opinion", "summary", "definition"].indexOf(c.type) >= 0
          ? c.type : "summary",
        confidence: typeof c.confidence === "number" ? Math.min(1, Math.max(0, c.confidence)) : null,
        support: Array.isArray(c.support) ? c.support : [],
        conflicts: Array.isArray(c.conflicts) ? c.conflicts : [],
      };
    });
  }

  function normalizeSources(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean).map(function (s) {
      return {
        id: typeof s.id === "string" ? s.id : "",
        title: typeof s.title === "string" ? s.title : "",
        url: typeof s.url === "string" ? s.url : "",
        origin: typeof s.origin === "string" ? s.origin : "unknown",
        quotedText: typeof s.quotedText === "string" ? s.quotedText : "",
        retrievedAt: typeof s.retrievedAt === "string" ? s.retrievedAt : "",
        reliability: typeof s.reliability === "string" ? s.reliability : "unknown",
      };
    });
  }

  function emptyPackage(providerId, mode, status) {
    return {
      providerId: providerId || "unknown",
      status: status || "error",
      mode: mode || "search",
      answer: "",
      claims: [],
      sources: [],
      raw: { excerpt: "", adapterMeta: {} },
      cost: { latencyMs: 0, tokens: null },
    };
  }

  module.exports = {
    normalizeResponse: normalizeResponse,
    normalizeUnstructuredText: normalizeUnstructuredText,
    normalizeClaims: normalizeClaims,
    normalizeSources: normalizeSources,
    emptyPackage: emptyPackage,
  };
})();
