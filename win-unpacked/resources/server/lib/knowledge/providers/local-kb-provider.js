/**
 * Local KB Provider
 *
 * Exposes already-retrieved local textbook evidence as a knowledge source.
 * This provider deliberately does not call global.__KB_DISTILL__: that helper
 * summarizes supplied page text and is not a retrieval/search API.
 *
 * See plan Section 3.2 for the design rationale.
 */

(function () {
  "use strict";

  var normalizer = require("../evidence-normalizer.js");
  var contract = require("../provider-contract.js");

  var provider = {
    id: "local-kb",
    label: "Local Knowledge Base",
    kind: "local_kb",
    capabilities: {
      search: true,
      expand: true,
      explain: false,
      verify: true,
      citations: "local",
    },

    isAvailable: async function (ctx) {
      return true;
    },

    query: async function (request, ctx) {
      if (!contract.validateRequest(request)) {
        return normalizer.emptyPackage("local-kb", request ? request.mode : "search", "error");
      }

      try {
        var requestContext = request.context || {};
        var result = String(
          (ctx && ctx.localEvidenceText) ||
          requestContext.pageText ||
          requestContext.selectedText ||
          ""
        ).trim();

        if (!result) {
          return normalizer.emptyPackage("local-kb", request.mode, "unavailable");
        }

        return {
          providerId: "local-kb",
          status: "partial",
          mode: request.mode || "search",
          answer: result,
          claims: [
            {
              text: result.slice(0, 500),
              type: "summary",
              confidence: 0.8,
              support: ["local-kb-source"],
              conflicts: [],
            },
          ],
          sources: [
            {
              id: "local-kb-source",
              title: (request.context && request.context.textbookTitle) || "Local Knowledge Base",
              url: "",
              origin: "local_kb",
              quotedText: result.slice(0, 200),
              retrievedAt: new Date().toISOString(),
              reliability: "high",
            },
          ],
          raw: { excerpt: result.slice(0, 500), adapterMeta: {} },
          cost: { latencyMs: 0, tokens: null },
        };
      } catch (e) {
        return normalizer.emptyPackage("local-kb", request.mode, "error");
      }
    },

    healthCheck: async function (ctx) {
      return { ok: true, requiresEvidenceText: true };
    },
  };

  module.exports = provider;
})();
