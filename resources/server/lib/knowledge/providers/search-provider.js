/**
 * Search Provider
 *
 * Wraps a configurable web search API (Bing, Google Custom Search, or a
 * generic JSON search endpoint) as a knowledge-source provider.
 *
 * Configuration (via global.__SOCRATOPIA_SETTINGS__.knowledgeSources or ctx):
 *   {
 *     enabled: true,
 *     provider: "bing" | "google" | "generic",
 *     endpoint: "https://api.bing.microsoft.com/v7.0/search",
 *     apiKeyRef: "search_api_key",   // key name in settings.apiKeys
 *     maxResults: 5
 *   }
 *
 * The provider reads config first from ctx.config, then falls back to
 * global settings. All API key lookups go through settings, never hardcoded.
 */

(function () {
  "use strict";

  var normalizer = require("../evidence-normalizer.js");
  var contract = require("../provider-contract.js");

  // ---- Config resolution ----

  /**
   * Read search provider config from ctx or global settings.
   * Returns a config object with defaults filled in.
   */
  function resolveConfig(ctx) {
    ctx = ctx || {};
    var settings = (typeof global !== "undefined" && global.__SOCRATOPIA_SETTINGS__) || {};
    var ks = settings.knowledgeSources || {};
    var sc = ks.providers && ks.providers.search ? ks.providers.search : {};
    var ctxConfig = ctx.config || {};

    return {
      provider: ctxConfig.provider || sc.provider || "",
      endpoint: ctxConfig.endpoint || sc.endpoint || "",
      apiKeyRef: ctxConfig.apiKeyRef || sc.apiKeyRef || "",
      cx: ctxConfig.cx || ctxConfig.engineId || sc.cx || sc.engineId || "",
      maxResults: ctxConfig.maxResults || sc.maxResults || 5,
      enabled: ctxConfig.enabled !== undefined ? ctxConfig.enabled : (sc.enabled !== false),
    };
  }

  /**
   * Resolve an API key from settings by reference name.
   */
  function resolveApiKey(keyRef) {
    if (!keyRef) return null;
    var settings = (typeof global !== "undefined" && global.__SOCRATOPIA_SETTINGS__) || {};
    var apiKeys = settings.apiKeys || {};
    return apiKeys[keyRef] || null;
  }

  // ---- Search implementations ----

  /**
   * Generic JSON search endpoint.
   * POST to endpoint with { question, maxResults } and expect a JSON response
   * with { results: [{ title, url, snippet }] }.
   */
  async function genericSearch(question, config) {
    var apiKey = resolveApiKey(config.apiKeyRef);
    var headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = "Bearer " + apiKey;

    var body = JSON.stringify({
      question: question,
      maxResults: config.maxResults,
    });

    var response = await fetch(config.endpoint, {
      method: "POST",
      headers: headers,
      body: body,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error("Search API returned HTTP " + response.status);
    }

    var data = await response.json();
    var results = [];
    if (Array.isArray(data)) {
      results = data;
    } else if (Array.isArray(data.results)) {
      results = data.results;
    } else if (Array.isArray(data.items)) {
      results = data.items;
    }

    return results.map(function (r) {
      return {
        title: r.title || r.name || "",
        url: r.url || r.link || "",
        snippet: r.snippet || r.description || r.content || "",
      };
    });
  }

  /**
   * Bing Web Search API v7.
   */
  async function bingSearch(question, config) {
    var apiKey = resolveApiKey(config.apiKeyRef);
    if (!apiKey) throw new Error("Bing Search requires apiKeyRef");

    var endpoint = config.endpoint || "https://api.bing.microsoft.com/v7.0/search";
    var url = endpoint + "?q=" + encodeURIComponent(question) + "&count=" + config.maxResults + "&mkt=zh-CN";

    var response = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error("Bing Search returned HTTP " + response.status);
    }

    var data = await response.json();
    var webPages = data && data.webPages && data.webPages.value;
    if (!Array.isArray(webPages)) return [];

    return webPages.map(function (r) {
      return {
        title: r.name || "",
        url: r.url || "",
        snippet: r.snippet || "",
      };
    });
  }

  /**
   * Google Custom Search API.
   */
  async function googleSearch(question, config) {
    var apiKey = resolveApiKey(config.apiKeyRef);
    if (!apiKey) throw new Error("Google Search requires apiKeyRef");

    var cx = config.cx || config.engineId || "";
    if (!cx) throw new Error("Google Search requires cx (engine ID)");

    var endpoint = config.endpoint || "https://www.googleapis.com/customsearch/v1";
    var url = endpoint + "?key=" + encodeURIComponent(apiKey) + "&cx=" + encodeURIComponent(cx) +
      "&q=" + encodeURIComponent(question) + "&num=" + config.maxResults;

    var response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error("Google Search returned HTTP " + response.status);
    }

    var data = await response.json();
    var items = data && data.items;
    if (!Array.isArray(items)) return [];

    return items.map(function (r) {
      return {
        title: r.title || "",
        url: r.link || "",
        snippet: r.snippet || "",
      };
    });
  }

  // ---- Provider definition ----

  var provider = {
    id: "search",
    label: "Web Search",
    kind: "search_engine",
    capabilities: {
      search: true,
      expand: true,
      explain: false,
      verify: true,
      citations: "url",
    },

    isAvailable: async function (ctx) {
      var config = resolveConfig(ctx);
      if (!config.enabled) return false;
      if (config.provider === "generic") return !!config.endpoint;
      if (config.provider === "bing") return !!resolveApiKey(config.apiKeyRef);
      if (config.provider === "google") return !!resolveApiKey(config.apiKeyRef) && !!config.cx;
      // Unknown provider type — not available
      return false;
    },

    query: async function (request, ctx) {
      if (!contract.validateRequest(request)) {
        return normalizer.emptyPackage("search", request ? request.mode : "search", "error");
      }

      var config = resolveConfig(ctx);
      if (!config.enabled || !config.provider) {
        return normalizer.emptyPackage("search", request.mode, "unavailable");
      }

      try {
        var results;
        switch (config.provider) {
          case "bing":
            results = await bingSearch(request.question, config);
            break;
          case "google":
            results = await googleSearch(request.question, config);
            break;
          case "generic":
            results = await genericSearch(request.question, config);
            break;
          default:
            return normalizer.emptyPackage("search", request.mode, "unavailable");
        }

        if (!results || !results.length) {
          return normalizer.emptyPackage("search", request.mode, "partial");
        }

        var sources = results.map(function (r, i) {
          return {
            id: "search-" + i,
            title: r.title || "",
            url: r.url || "",
            origin: "search",
            quotedText: (r.snippet || "").slice(0, 300),
            retrievedAt: new Date().toISOString(),
            reliability: "medium",
          };
        });

        return {
          providerId: "search",
          status: "ok",
          mode: request.mode || "search",
          answer: sources.map(function (s) { return s.title + ": " + s.quotedText; }).join("\n"),
          claims: results.map(function (r) {
            return {
              text: r.snippet || r.title || "",
              type: "fact",
              confidence: 0.6,
              support: ["search-" + results.indexOf(r)],
              conflicts: [],
            };
          }),
          sources: sources,
          raw: { excerpt: results[0] ? (results[0].snippet || "").slice(0, 200) : "", adapterMeta: { resultCount: results.length } },
          cost: { latencyMs: 0, tokens: null },
        };
      } catch (e) {
        return normalizer.emptyPackage("search", request.mode, "error");
      }
    },

    healthCheck: async function (ctx) {
      var config = resolveConfig(ctx);
      return {
        ok: config.enabled && !!config.provider,
        provider: config.provider || null,
        endpoint: config.endpoint || null,
        hasApiKey: !!resolveApiKey(config.apiKeyRef),
      };
    },
  };

  module.exports = provider;
})();
