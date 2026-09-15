/**
 * Provider Contract
 *
 * Defines the uniform interface that every knowledge-source provider must
 * satisfy. This file serves as the specification / reference — providers do
 * NOT extend a base class. Instead, each provider exports a plain object
 * that satisfies the contract shape documented below.
 *
 * Contract shape (a provider module exports exactly this):
 *
 *   {
 *     id: "kimi-desktop",                       // unique provider ID
 *     label: "Kimi Desktop",                    // human-readable label
 *     kind: "external_llm",                     // category tag
 *     capabilities: { search, expand, explain, verify, citations },
 *     isAvailable: async function (ctx) {},     // true if configured & usable
 *     query: async function (request, ctx) {},  // the main knowledge lookup
 *     healthCheck: async function (ctx) {}      // optional liveliness probe
 *   }
 *
 * request shape:
 *   {
 *     mode: "search" | "expand" | "explain" | "verify" | "compare",
 *     question: "",                              // user's natural-language query
 *     context: {
 *       textbookTitle: "",
 *       currentPage: null,
 *       selectedText: "",
 *       learnerLevel: "",
 *       courseLanguage: "zh-CN"
 *     },
 *     constraints: {
 *       requireCitations: true,
 *       maxLatencyMs: 30000,
 *       maxTokens: 3000,
 *       allowExternal: true
 *     },
 *     trace: {
 *       sessionId: "",
 *       userAction: "",
 *       requestedAt: ""
 *     }
 *   }
 *
 * response shape (what query() must return):
 *   {
 *     providerId: "kimi-desktop",
 *     status: "ok" | "partial" | "unavailable" | "error" | "timeout",
 *     mode: "verify",
 *     answer: "",                                // concise answer text
 *     claims: [{
 *       text: "",                                // claim statement
 *       type: "fact" | "opinion" | "summary" | "definition",
 *       confidence: 0.72,                        // 0-1 or null
 *       support: ["source-1"],                   // source IDs backing this claim
 *       conflicts: []                            // source IDs contradicting
 *     }],
 *     sources: [{
 *       id: "source-1",
 *       title: "",
 *       url: "",
 *       origin: "kimi-desktop",
 *       quotedText: "",
 *       retrievedAt: "",
 *       reliability: "unknown"                   // see trust-policy.js
 *     }],
 *     raw: {                                     // adapter-specific metadata
 *       excerpt: "",
 *       adapterMeta: {}
 *     },
 *     cost: {
 *       latencyMs: 0,
 *       tokens: null
 *     }
 *   }
 *
 * Every field above must be present (use null / [] / "" for missing values).
 * query() must never throw — catch all errors and return { status: "error" }.
 */

var CONTRACT = {
  VALID_MODES: ["search", "expand", "explain", "verify", "compare"],
  VALID_STATUSES: ["ok", "partial", "unavailable", "error", "timeout"],
  VALID_KINDS: ["external_llm", "local_kb", "search_engine", "database", "rag"],
};

function validateRequest(req) {
  if (!req || typeof req !== "object") return false;
  if (CONTRACT.VALID_MODES.indexOf(req.mode) < 0) return false;
  if (!req.question || typeof req.question !== "string") return false;
  return true;
}

function validateContract(provider) {
  if (!provider || typeof provider.id !== "string") return false;
  if (!provider.query || typeof provider.query !== "function") return false;
  return true;
}

module.exports = {
  CONTRACT: CONTRACT,
  validateRequest: validateRequest,
  validateContract: validateContract,
};
