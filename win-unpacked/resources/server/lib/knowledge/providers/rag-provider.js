/**
 * RAG Provider
 *
 * Generic RAG (Retrieval-Augmented Generation) endpoint adapter.
 * Supports any HTTP-based RAG service that accepts a question and returns
 * passages / context chunks with optional relevance scores.
 *
 * Configuration (via global.__SOCRATOPIA_SETTINGS__.knowledgeSources or ctx):
 *   {
 *     enabled: true,
 *     endpoint: "http://localhost:8080/rag/query",
 *     collection: "my_docs",
 *     apiKeyRef: "rag_api_key",
 *     topK: 5,
 *     minScore: 0.0
 *   }
 *
 * The provider POSTs to {endpoint} with JSON body:
 *   { question: "...", collection: "...", topK: 5 }
 *
 * And expects a JSON response:
 *   { results: [{ text: "...", score: 0.85, source: "...", metadata: {} }] }
 *
 * Alternative format: the endpoint may also return:
 *   { passages: [...], chunks: [...], contexts: [...] }
 * with per-item { text, score, source, title, metadata } fields.
 */

(function () {
  "use strict";

  var normalizer = require("../evidence-normalizer.js");
  var contract = require("../provider-contract.js");

  // ---- Config resolution ----

  function resolveConfig(ctx) {
    ctx = ctx || {};
    var settings = (typeof global !== "undefined" && global.__SOCRATOPIA_SETTINGS__) || {};
    var ks = settings.knowledgeSources || {};
    var rc = ks.providers && ks.providers.rag ? ks.providers.rag : {};
    var ctxConfig = ctx.config || {};

    return {
      endpoint: ctxConfig.endpoint || rc.endpoint || "",
      collection: ctxConfig.collection || rc.collection || "",
      apiKeyRef: ctxConfig.apiKeyRef || rc.apiKeyRef || "",
      topK: ctxConfig.topK || rc.topK || 5,
      minScore: ctxConfig.minScore !== undefined ? ctxConfig.minScore : (rc.minScore !== undefined ? rc.minScore : 0.0),
      enabled: ctxConfig.enabled !== undefined ? ctxConfig.enabled : (rc.enabled !== false),
    };
  }

  function resolveApiKey(keyRef) {
    if (!keyRef) return null;
    var settings = (typeof global !== "undefined" && global.__SOCRATOPIA_SETTINGS__) || {};
    var apiKeys = settings.apiKeys || {};
    return apiKeys[keyRef] || null;
  }

  // ---- RAG query ----

  /**
   * Query the RAG endpoint.
   * Accepts various response formats and normalizes to a uniform results array.
   */
  async function queryRag(question, config) {
    if (!config.endpoint) throw new Error("RAG endpoint not configured");

    var headers = { "Content-Type": "application/json" };
    var apiKey = resolveApiKey(config.apiKeyRef);
    if (apiKey) headers["Authorization"] = "Bearer " + apiKey;

    var body = JSON.stringify({
      question: question,
      collection: config.collection || undefined,
      topK: config.topK || 5,
    });

    var response = await fetch(config.endpoint, {
      method: "POST",
      headers: headers,
      body: body,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error("RAG endpoint returned HTTP " + response.status);
    }

    var data = await response.json();

    // Normalize various response formats
    var items = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (Array.isArray(data.results)) {
      items = data.results;
    } else if (Array.isArray(data.passages)) {
      items = data.passages;
    } else if (Array.isArray(data.chunks)) {
      items = data.chunks;
    } else if (Array.isArray(data.contexts)) {
      items = data.contexts;
    } else if (Array.isArray(data.documents)) {
      items = data.documents;
    }

    // Filter by minScore if available
    if (config.minScore > 0) {
      items = items.filter(function (item) {
        var score = item.score !== undefined ? item.score :
                    (item.relevance !== undefined ? item.relevance :
                     item.confidence !== undefined ? item.confidence : 1.0);
        return score >= config.minScore;
      });
    }

    return items.map(function (item) {
      return {
        text: item.text || item.content || item.snippet || item.pageContent || JSON.stringify(item),
        score: item.score !== undefined ? item.score :
              (item.relevance !== undefined ? item.relevance :
               item.confidence !== undefined ? item.confidence : null),
        source: item.source || item.url || item.title || item.document_id || "",
        title: item.title || item.document_title || "",
        metadata: item.metadata || {},
      };
    });
  }

  // ---- Provider definition ----

  var provider = {
    id: "rag",
    label: "RAG Knowledge Base",
    kind: "rag",
    capabilities: {
      search: true,
      expand: true,
      explain: true,
      verify: true,
      citations: "source",
    },

    isAvailable: async function (ctx) {
      var config = resolveConfig(ctx);
      return config.enabled && !!config.endpoint;
    },

    query: async function (request, ctx) {
      if (!contract.validateRequest(request)) {
        return normalizer.emptyPackage("rag", request ? request.mode : "search", "error");
      }

      var config = resolveConfig(ctx);
      if (!config.enabled || !config.endpoint) {
        return normalizer.emptyPackage("rag", request.mode, "unavailable");
      }

      try {
        var results = await queryRag(request.question, config);

        if (!results || !results.length) {
          return normalizer.emptyPackage("rag", request.mode, "partial");
        }

        var sources = results.map(function (r, i) {
          return {
            id: "rag-" + i,
            title: r.title || "",
            url: r.source || "",
            origin: "rag",
            quotedText: r.text.slice(0, 300),
            retrievedAt: new Date().toISOString(),
            reliability: "medium",
          };
        });

        return {
          providerId: "rag",
          status: "ok",
          mode: request.mode || "search",
          answer: sources.map(function (s) { return s.title ? s.title + ": " + s.quotedText : s.quotedText; }).join("\n"),
          claims: results.map(function (r, i) {
            return {
              text: r.text.slice(0, 500),
              type: "fact",
              confidence: r.score !== null ? Math.min(1, Math.max(0, r.score)) : 0.7,
              support: ["rag-" + i],
              conflicts: [],
            };
          }),
          sources: sources,
          raw: { excerpt: (results[0] ? results[0].text : "").slice(0, 200), adapterMeta: { resultCount: results.length, collection: config.collection } },
          cost: { latencyMs: 0, tokens: null },
        };
      } catch (e) {
        return normalizer.emptyPackage("rag", request.mode, "error");
      }
    },

    healthCheck: async function (ctx) {
      var config = resolveConfig(ctx);
      return {
        ok: config.enabled && !!config.endpoint,
        endpoint: config.endpoint || null,
        collection: config.collection || null,
      };
    },
  };

  module.exports = provider;
})();
