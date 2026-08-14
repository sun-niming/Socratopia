/**
 * Database Provider
 *
 * Wraps a generic SQL / NoSQL query endpoint as a knowledge-source provider.
 * Designed for use with structured internal databases — user data stores,
 * concept graphs, learning records, or any queryable data service.
 *
 * This is NOT a direct SQL client. It delegates queries to a configured HTTP
 * endpoint that returns JSON, keeping Socratopia loosely coupled from any
 * specific database technology.
 *
 * Configuration (via global.__SOCRATOPIA_SETTINGS__.knowledgeSources or ctx):
 *   {
 *     enabled: true,
 *     endpoint: "http://localhost:8080/db/query",
 *     connectionRef: "my_db",
 *     apiKeyRef: "db_api_key",
 *     defaultCollection: "concepts",
 *     maxResults: 10
 *   }
 *
 * The provider POSTs to {endpoint} with:
 *   {
 *     question: "...",
 *     collection: "...",
 *     connectionRef: "...",
 *     maxResults: 10,
 *     mode: "search" | "expand" | "explain" | "verify" | "compare"
 *   }
 *
 * Expected response:
 *   { results: [{ id, title, content, metadata, score }] }
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
    var dc = ks.providers && ks.providers.database ? ks.providers.database : {};
    var ctxConfig = ctx.config || {};

    return {
      endpoint: ctxConfig.endpoint || dc.endpoint || "",
      connectionRef: ctxConfig.connectionRef || dc.connectionRef || "",
      apiKeyRef: ctxConfig.apiKeyRef || dc.apiKeyRef || "",
      defaultCollection: ctxConfig.defaultCollection || dc.defaultCollection || "",
      maxResults: ctxConfig.maxResults || dc.maxResults || 10,
      enabled: ctxConfig.enabled !== undefined ? ctxConfig.enabled : (dc.enabled !== false),
    };
  }

  function resolveApiKey(keyRef) {
    if (!keyRef) return null;
    var settings = (typeof global !== "undefined" && global.__SOCRATOPIA_SETTINGS__) || {};
    var apiKeys = settings.apiKeys || {};
    return apiKeys[keyRef] || null;
  }

  // ---- Database query ----

  async function queryDatabase(question, config, mode) {
    if (!config.endpoint) throw new Error("Database endpoint not configured");

    var headers = { "Content-Type": "application/json" };
    var apiKey = resolveApiKey(config.apiKeyRef);
    if (apiKey) headers["Authorization"] = "Bearer " + apiKey;

    var body = JSON.stringify({
      question: question,
      collection: config.defaultCollection || undefined,
      connectionRef: config.connectionRef || undefined,
      maxResults: config.maxResults || 10,
      mode: mode || "search",
    });

    var response = await fetch(config.endpoint, {
      method: "POST",
      headers: headers,
      body: body,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error("Database endpoint returned HTTP " + response.status);
    }

    var data = await response.json();

    // Normalize various response formats
    var items = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (Array.isArray(data.results)) {
      items = data.results;
    } else if (Array.isArray(data.records)) {
      items = data.records;
    } else if (Array.isArray(data.rows)) {
      items = data.rows;
    } else if (Array.isArray(data.documents)) {
      items = data.documents;
    } else if (Array.isArray(data.data)) {
      items = data.data;
    }

    return items.map(function (item) {
      return {
        id: item.id || item._id || "",
        title: item.title || item.name || "",
        content: item.content || item.text || item.description || item.value || JSON.stringify(item),
        score: item.score !== undefined ? item.score :
              (item.relevance !== undefined ? item.relevance : null),
        metadata: item.metadata || {},
      };
    });
  }

  // ---- Provider definition ----

  var provider = {
    id: "database",
    label: "Database Query",
    kind: "database",
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
        return normalizer.emptyPackage("database", request ? request.mode : "search", "error");
      }

      var config = resolveConfig(ctx);
      if (!config.enabled || !config.endpoint) {
        return normalizer.emptyPackage("database", request.mode, "unavailable");
      }

      try {
        var results = await queryDatabase(request.question, config, request.mode);

        if (!results || !results.length) {
          return normalizer.emptyPackage("database", request.mode, "partial");
        }

        var sources = results.map(function (r, i) {
          return {
            id: "db-" + i,
            title: r.title || r.id || "",
            url: "",
            origin: "database",
            quotedText: r.content.slice(0, 300),
            retrievedAt: new Date().toISOString(),
            reliability: "high",
          };
        });

        return {
          providerId: "database",
          status: "ok",
          mode: request.mode || "search",
          answer: sources.map(function (s) { return s.title ? s.title + ": " + s.quotedText : s.quotedText; }).join("\n"),
          claims: results.map(function (r, i) {
            return {
              text: r.content.slice(0, 500),
              type: "fact",
              confidence: r.score !== null ? Math.min(1, Math.max(0, r.score)) : 0.85,
              support: ["db-" + i],
              conflicts: [],
            };
          }),
          sources: sources,
          raw: { excerpt: (results[0] ? results[0].content : "").slice(0, 200), adapterMeta: { resultCount: results.length, connection: config.connectionRef } },
          cost: { latencyMs: 0, tokens: null },
        };
      } catch (e) {
        return normalizer.emptyPackage("database", request.mode, "error");
      }
    },

    healthCheck: async function (ctx) {
      var config = resolveConfig(ctx);
      return {
        ok: config.enabled && !!config.endpoint,
        endpoint: config.endpoint || null,
        connection: config.connectionRef || null,
      };
    },
  };

  module.exports = provider;
})();
