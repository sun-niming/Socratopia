/**
 * Knowledge Source Router
 *
 * Central orchestration point for knowledge source queries.
 * Loaded by server.js into global.__KNOWLEDGE_SOURCE__.
 *
 * Responsibilities:
 *   - Register and enumerate providers
 *   - Route queries to the right provider(s) based on task type
 *   - Apply evidence caching
 *   - Apply trust policy (local-first, conflict detection)
 *   - Gracefully handle provider failures (never throw)
 *
 * Router strategy (from plan Section 7):
 *   课堂讲解 / 教材内问答  → local-textbook -> local-kb -> external only if insufficient
 *   教材外背景扩展        → local-kb -> external -> verifier
 *   事实核验 / 最新知识    → external -> verifier -> composer
 *   练习出题              → local-textbook -> local-kb -> external examples only
 *   错因诊断              → learner model -> local-kb -> external only for supplementary
 */

(function () {
  "use strict";

  var normalizer = require("./evidence-normalizer.js");
  var trustPolicy = require("./trust-policy.js");
  var cache = require("./evidence-cache.js");
  var contract = require("./provider-contract.js");

  // Registered providers, keyed by canonical id
  var providers = {};
  var providerAliases = { "kimi-client": "kimi-desktop" };

  // Configuration (mutable via configure())
  var config = {
    defaultMaxLatencyMs: 45000,
    maxRetries: 1,
    disabledProviders: {},  // providerId -> true means disabled
    defaultPolicy: "local_first",  // local_first | external_first | concurrent
  };

  /**
   * Register a provider. Returns true on success.
   */
  function register(provider) {
    if (!contract.validateContract(provider)) return false;
    providers[provider.id] = provider;
    (provider.aliases || []).forEach(function (alias) {
      if (alias && alias !== provider.id) providerAliases[alias] = provider.id;
    });
    return true;
  }

  function canonicalProviderId(id) {
    return providerAliases[id] || id;
  }

  function isProviderDisabled(id) {
    var canonical = canonicalProviderId(id);
    if (config.disabledProviders[id] || config.disabledProviders[canonical]) return true;
    return Object.keys(providerAliases).some(function (alias) {
      return providerAliases[alias] === canonical && config.disabledProviders[alias];
    });
  }

  /**
   * Get a provider by id. Returns null if not found.
   */
  function getProvider(id) {
    return providers[canonicalProviderId(id)] || null;
  }

  // Only the textbook-local KB is guaranteed to stay on-device. Search,
  // RAG, database adapters, and desktop LLM bridges may all transmit the
  // question/context to another process or endpoint, so fail closed when
  // allowExternal is explicitly false.
  function isExternalProvider(id) {
    var provider = getProvider(id);
    return !provider || provider.kind !== "local_kb";
  }

  /**
   * List all registered providers.
   */
  function listProviders() {
    return Object.keys(providers).map(function (id) { return providers[id]; });
  }

  /**
   * Resolve the provider(s) to use for a given request mode and context.
   * Returns an ordered array of provider IDs.
   *
   * Phase 4: includes search/rag/database providers alongside local-kb
   * and kimi-desktop. The query() method now supports concurrent mode.
   */
  function resolveRoute(mode, context) {
    switch (mode) {
      case "search":
        // Background expansion: try local KB first, then external sources
        return ["local-kb", "search", "rag", "database", "kimi-desktop"];

      case "expand":
        // Context expansion: same as search
        return ["local-kb", "search", "rag", "database", "kimi-desktop"];

      case "explain":
        // Explanation: local KB first, external for supplementary
        return ["local-kb", "rag", "search", "database", "kimi-desktop"];

      case "verify":
        // Fact-check: external first (local KB may not have the latest)
        return ["search", "rag", "kimi-desktop", "database", "local-kb"];

      case "compare":
        // Comparison: query all and merge
        return ["local-kb", "search", "rag", "database", "kimi-desktop"];

      default:
        return ["local-kb", "search", "rag", "database", "kimi-desktop"];
    }
  }

  /**
   * Create a timeout promise that rejects after ms milliseconds.
   */
  async function queryWithTimeout(provider, request, safeCtx, ms, label) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var attemptCtx = Object.assign({}, safeCtx || {});
    if (controller) attemptCtx.signal = controller.signal;
    var timer = null;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(new Error("[" + label + "] query timed out after " + ms + "ms"));
      }, ms);
    });
    try {
      return await Promise.race([
        Promise.resolve().then(function () { return provider.query(request, attemptCtx); }),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Configure the router. Accepts an options object:
   *   {
   *     defaultMaxLatencyMs: 45000,   // per-query timeout
   *     maxRetries: 1,                // retries per provider on timeout
   *     disabledProviders: {},        // { "kimi-desktop": true } to disable
   *     disableCache: false           // toggle evidence cache
   *     defaultPolicy: "local_first"  // local_first | external_first | concurrent
   *   }
   */
  function configure(opts) {
    if (!opts || typeof opts !== "object") return;
    if (typeof opts.defaultMaxLatencyMs === "number") config.defaultMaxLatencyMs = opts.defaultMaxLatencyMs;
    if (typeof opts.maxRetries === "number") config.maxRetries = Math.max(0, opts.maxRetries);
    if (opts.disabledProviders && typeof opts.disabledProviders === "object") {
      config.disabledProviders = opts.disabledProviders;
    }
    if (typeof opts.disableCache === "boolean") {
      cache.setEnabled(!opts.disableCache);
    }
    if (typeof opts.defaultPolicy === "string") {
      config.defaultPolicy = opts.defaultPolicy;
    }
  }

  /**
   * Sleep helper between retries.
   */
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function cacheConfiguration(ctx) {
    var settings = (typeof global !== "undefined" && global.__SOCRATOPIA_SETTINGS__) || {};
    return {
      providerMode: ctx && ctx.mode ? ctx.mode : null,
      requestConfig: ctx && ctx.config ? ctx.config : null,
      configuredSources: settings.knowledgeSources || null,
    };
  }

  function providerContext(ctx) {
    ctx = ctx || {};
    var safe = {};
    Object.keys(ctx).forEach(function (key) {
      if (key !== "config") safe[key] = ctx[key];
    });
    return safe;
  }

  /**
   * Query a single provider by ID with retry support.
   * Returns normalized evidence package.
   * Never throws — all errors are caught and returned as error-status packages.
   */
  async function queryProvider(providerId, request, ctx) {
    var startTime = Date.now();
    providerId = canonicalProviderId(providerId);
    var safeCtx = providerContext(ctx);
    try {
      var provider = providers[providerId];
      if (!provider) {
        return logAndReturn(startTime, providerId, request, normalizer.emptyPackage(providerId, request ? request.mode : "search", "unavailable"));
      }
      if (request && request.constraints && request.constraints.allowExternal === false && isExternalProvider(providerId)) {
        return logAndReturn(startTime, providerId, request, normalizer.emptyPackage(providerId, request.mode, "unavailable"));
      }

      var available = await provider.isAvailable(safeCtx);
      if (!available) {
        return logAndReturn(startTime, providerId, request, normalizer.emptyPackage(providerId, request ? request.mode : "search", "unavailable"));
      }

      // Check cache first
      var cacheConfig = cacheConfiguration(safeCtx);
      var cached = cache.get(providerId, request.mode, request.context, request.question, cacheConfig);
      if (cached) {
        cached.raw = cached.raw || {};
        cached.raw.adapterMeta = cached.raw.adapterMeta || {};
        cached.raw.adapterMeta.cacheHit = true;
        return logAndReturn(startTime, providerId, request, cached);
      }

      // Attempt loop with retry
      var timeoutMs = (request.constraints && request.constraints.maxLatencyMs) || config.defaultMaxLatencyMs;
      var maxAttempts = 1 + config.maxRetries;
      var lastError = null;

      for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          var response = await queryWithTimeout(provider, request, safeCtx, timeoutMs, providerId);

          var pkg = normalizer.normalizeResponse(response, providerId, request.mode);

          // Cache if successful
          if (pkg.status === "ok" || pkg.status === "partial") {
            var ttl = cache.ttlForMode(request.mode);
            cache.set(providerId, request.mode, request.context, request.question, pkg, ttl, cacheConfig);
          }

          return logAndReturn(startTime, providerId, request, pkg);
        } catch (e) {
          lastError = e;
          var isTimeout = e && typeof e.message === "string" && e.message.indexOf("timed out") >= 0;
          console.log("[knowledge] provider=" + providerId + " attempt=" + attempt +
            " status=" + (isTimeout ? "timeout" : "error") + " msg=" + (e.message || ""));
          if (attempt < maxAttempts) {
            // Exponential backoff: 500ms, 1000ms, 2000ms...
            var backoff = 500 * Math.pow(2, attempt - 1);
            await sleep(backoff);
          }
        }
      }

      // All attempts exhausted
      var isTimeout = lastError && typeof lastError.message === "string" && lastError.message.indexOf("timed out") >= 0;
      return logAndReturn(startTime, providerId, request,
        normalizer.emptyPackage(providerId, request ? request.mode : "search", isTimeout ? "timeout" : "error"));
    } catch (e) {
      return logAndReturn(startTime, providerId, request,
        normalizer.emptyPackage(providerId, request ? request.mode : "search", "error"));
    }
  }

  /**
   * Log a structured query record and return the package.
   */
  function logAndReturn(startTime, providerId, request, pkg) {
    var latencyMs = Date.now() - startTime;
    var mode = request ? request.mode : "search";
    console.log("[knowledge] provider=" + providerId + " mode=" + mode +
      " status=" + pkg.status + " latencyMs=" + latencyMs);
    return pkg;
  }

  /**
   * Main entry point. Query knowledge sources for the given request.
   *
   * Three query policies (set via configure() or ctx.policy):
   *   "local_first" (default): query providers sequentially, stop early on
   *     high-confidence local answer. Best for classroom Q&A — minimizes
   *     latency when local knowledge suffices.
   *   "external_first": query external providers first for fact-checking,
   *     then supplement with local. Best for verify mode.
   *   "concurrent": query ALL available (non-disabled) providers in parallel.
   *     Best for compare/explain modes where breadth is valued over latency.
   *
   * Strategy:
   *   1. Resolve provider route for the mode
   *   2. Apply provider ordering, sorting, and concurrency per policy
   *   3. Apply trust policy
   *   4. Return merged evidence
   */
  async function query(request, ctx) {
    if (!contract.validateRequest(request)) {
      return normalizer.emptyPackage("router", request ? request.mode : "search", "error");
    }

    ctx = ctx || {};
    var policy = ctx.policy || config.defaultPolicy;
    var route = resolveRoute(request.mode, request.context);
    // Filter out disabled providers
    route = route.filter(function (id) { return !isProviderDisabled(id); });
    if (request.constraints && request.constraints.allowExternal === false) {
      route = route.filter(function (id) { return !isExternalProvider(id); });
    }

    var results = [];

    if (policy === "concurrent") {
      // Phase 4: query all available providers in parallel
      var queryPromises = route.map(function (providerId) {
        return queryProvider(providerId, request, ctx);
      });
      results = await Promise.all(queryPromises);

      // Sort results: local KB and database first (highest trust),
      // then search and rag, then kimi-desktop
      var sortOrder = { "local-kb": 0, "database": 1, "search": 2, "rag": 3, "kimi-desktop": 4 };
      results.sort(function (a, b) {
        var orderA = sortOrder[a.providerId] !== undefined ? sortOrder[a.providerId] : 99;
        var orderB = sortOrder[b.providerId] !== undefined ? sortOrder[b.providerId] : 99;
        return orderA - orderB;
      });
    } else {
      // Sequential: original Phase 1 behavior, with policy-aware ordering
      if (policy === "external_first") {
        // Reorder: put external providers before local
        var localFirst = route;
        route = [];
        localFirst.forEach(function (id) {
          if (id === "local-kb" || id === "database") return; // skip local, add later
          route.push(id);
        });
        // Add local providers at end
        if (localFirst.indexOf("local-kb") >= 0) route.push("local-kb");
        if (localFirst.indexOf("database") >= 0) route.push("database");
      }

      for (var i = 0; i < route.length; i++) {
        var pkg = await queryProvider(route[i], request, ctx);
        results.push(pkg);

        // If local KB returned a confident answer, stop (local-first strategy)
        if (pkg.providerId === "local-kb" && pkg.status === "ok" && pkg.answer) {
          break;
        }
        // If in external_first mode and we got a confident external answer,
        // still continue to let local providers supplement
      }
    }

    // Merge results
    return mergeResults(results, request, policy);
  }

  /**
   * Merge multiple evidence packages into one final response.
   * Phase 4: enhanced with policy-specific summarization and conflict display.
   */
  function mergeResults(packages, request, policy) {
    var allClaims = [];
    var allSources = [];
    var totalLatency = 0;
    var overallStatus = "error";
    var providerStatuses = {};

    packages.forEach(function (pkg) {
      if (!pkg) return;
      allClaims = allClaims.concat(pkg.claims || []);
      allSources = allSources.concat(pkg.sources || []);
      totalLatency += pkg.cost ? pkg.cost.latencyMs : 0;
      providerStatuses[pkg.providerId] = pkg.status;

      if (pkg.status === "ok" && overallStatus !== "ok") overallStatus = "ok";
      else if (pkg.status === "partial" && overallStatus !== "ok") overallStatus = "partial";
      else if (pkg.status === "unavailable" && overallStatus !== "ok" && overallStatus !== "partial") overallStatus = "unavailable";
    });

    // Detect conflicts between local (kb/database) and external claims
    var localClaims = [];
    var externalClaims = [];
    packages.forEach(function (pkg) {
      if (!pkg) return;
      if (pkg.providerId === "local-kb" || pkg.providerId === "database") {
        localClaims = localClaims.concat(pkg.claims || []);
      } else {
        externalClaims = externalClaims.concat(pkg.claims || []);
      }
    });

    var conflicts = trustPolicy.detectConflict(externalClaims, localClaims);

    // Build answer: prefer best available, or concatenate from multiple providers
    var bestAnswer = null;
    // Try local-kb first, then database, then any provider with ok status
    packages.forEach(function (pkg) {
      if (!pkg || bestAnswer) return;
      if (pkg.providerId === "local-kb" && pkg.status === "ok" && pkg.answer) {
        bestAnswer = pkg;
      }
    });
    if (!bestAnswer) {
      packages.forEach(function (pkg) {
        if (!pkg || bestAnswer) return;
        if (pkg.providerId === "database" && pkg.status === "ok" && pkg.answer) {
          bestAnswer = pkg;
        }
      });
    }
    if (!bestAnswer) {
      packages.forEach(function (pkg) {
        if (!pkg || bestAnswer) return;
        if (pkg.status === "ok" && pkg.answer) {
          bestAnswer = pkg;
        }
      });
    }

    // In concurrent mode, if there's no single best answer but multiple
    // providers returned partial results, concatenate them
    if (!bestAnswer && policy === "concurrent") {
      var partialAnswers = packages
        .filter(function (p) { return p && p.status === "partial" && p.answer; })
        .map(function (p) { return "[" + p.providerId + "] " + p.answer; });
      if (partialAnswers.length) {
        bestAnswer = { answer: partialAnswers.join("\n\n") };
      }
    }
    if (!bestAnswer) {
      packages.forEach(function (pkg) {
        if (!pkg || bestAnswer) return;
        if (pkg.status === "partial" && pkg.answer) bestAnswer = pkg;
      });
    }

    return {
      providerId: "router",
      status: overallStatus,
      mode: request.mode,
      answer: bestAnswer ? bestAnswer.answer : (packages.length ? packages[packages.length - 1].answer : ""),
      claims: allClaims,
      sources: allSources,
      conflicts: conflicts,
      raw: {
        excerpt: (bestAnswer ? bestAnswer.answer : "").slice(0, 500),
        adapterMeta: {
          providersQueried: packages.filter(Boolean).map(function (p) { return p.providerId; }),
          providerCount: packages.length,
          policy: policy || "local_first",
          providerStatuses: providerStatuses,
          conflictCount: conflicts ? conflicts.length : 0,
        },
      },
      cost: {
        latencyMs: totalLatency,
        tokens: null,
      },
    };
  }

  // Auto-register built-in providers on first load.
  // Failures are non-fatal — a provider that can't load simply won't be available.
  (function () {
    try {
      var kimi = require("./providers/kimi-desktop-provider.js");
      if (contract.validateContract(kimi)) {
        register(kimi);
        console.log("[knowledge] Auto-registered provider: " + kimi.id);
      }
    } catch (e) {
      console.warn("[knowledge] Failed to load kimi-desktop-provider: " + e.message);
    }
    try {
      var localKb = require("./providers/local-kb-provider.js");
      if (contract.validateContract(localKb)) {
        register(localKb);
        console.log("[knowledge] Auto-registered provider: " + localKb.id);
      }
    } catch (e) {
      console.warn("[knowledge] Failed to load local-kb-provider: " + e.message);
    }
    try {
      var search = require("./providers/search-provider.js");
      if (contract.validateContract(search)) {
        register(search);
        console.log("[knowledge] Auto-registered provider: " + search.id);
      }
    } catch (e) {
      console.warn("[knowledge] Failed to load search-provider: " + e.message);
    }
    try {
      var rag = require("./providers/rag-provider.js");
      if (contract.validateContract(rag)) {
        register(rag);
        console.log("[knowledge] Auto-registered provider: " + rag.id);
      }
    } catch (e) {
      console.warn("[knowledge] Failed to load rag-provider: " + e.message);
    }
    try {
      var db = require("./providers/database-provider.js");
      if (contract.validateContract(db)) {
        register(db);
        console.log("[knowledge] Auto-registered provider: " + db.id);
      }
    } catch (e) {
      console.warn("[knowledge] Failed to load database-provider: " + e.message);
    }
  })();

  module.exports = {
    register: register,
    getProvider: getProvider,
    listProviders: listProviders,
    resolveRoute: resolveRoute,
    canonicalProviderId: canonicalProviderId,
    isExternalProvider: isExternalProvider,
    query: query,
    queryProvider: queryProvider,
    configure: configure,
  };
})();
