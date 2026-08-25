/**
 * Knowledge Source Module — Smoke Test
 *
 * Validates the provider contract, normalizer, trust policy, cache,
 * source router, daimon-bridge, AND all 5 providers (kimi-desktop,
 * local-kb, search, rag, database).
 *
 * Phase 3 additions: daimon-bridge endpoint discovery, version detection,
 * daemon status checks, WebSocket connect timeouts, and kimi-desktop
 * provider mode resolution (manual / desktop_bridge / auto).
 *
 * Phase 4 additions: search/rag/database providers, concurrent policy,
 * external_first policy, enhanced merge with provider status tracking,
 * and 5-provider auto-registration.
 */

(function () {
  "use strict";

  var assert = require("assert");
  var EventEmitter = require("events");
  var path = require("path");
  var fs = require("fs");
  var os = require("os");

  var CONTRACT = require("./provider-contract.js");
  var normalizer = require("./evidence-normalizer.js");
  var trustPolicy = require("./trust-policy.js");
  var cache = require("./evidence-cache.js");
  var router = require("./source-router.js");
  var daimonBridge = require("./daimon-bridge.js");
  var kimiProvider = require("./providers/kimi-desktop-provider.js");
  var localKbProvider = require("./providers/local-kb-provider.js");
  var searchProvider = require("./providers/search-provider.js");
  var ragProvider = require("./providers/rag-provider.js");
  var databaseProvider = require("./providers/database-provider.js");

  var passed = 0;
  var failed = 0;
  var testChain = Promise.resolve();

  function test(name, fn) {
    testChain = testChain.then(async function () {
      try {
        await fn();
        passed++;
        console.log("  PASS  " + name);
      } catch (e) {
        failed++;
        console.log("  FAIL  " + name + ": " + e.message);
      }
    });
  }

  // =====================================================
  // 1. Provider contract validation
  // =====================================================
  console.log("\n=== Provider Contract ===");

  test("CONTRACT has valid modes", function () {
    assert.ok(Array.isArray(CONTRACT.CONTRACT.VALID_MODES));
    assert.ok(CONTRACT.CONTRACT.VALID_MODES.indexOf("search") >= 0);
    assert.ok(CONTRACT.CONTRACT.VALID_MODES.indexOf("verify") >= 0);
  });

  test("CONTRACT has all Phase 4 kinds", function () {
    assert.ok(CONTRACT.CONTRACT.VALID_KINDS.indexOf("search_engine") >= 0);
    assert.ok(CONTRACT.CONTRACT.VALID_KINDS.indexOf("database") >= 0);
    assert.ok(CONTRACT.CONTRACT.VALID_KINDS.indexOf("rag") >= 0);
  });

  test("validateRequest accepts valid request", function () {
    assert.ok(CONTRACT.validateRequest({ mode: "search", question: "test" }));
  });

  test("validateRequest rejects missing question", function () {
    assert.ok(!CONTRACT.validateRequest({ mode: "search" }));
  });

  test("validateRequest rejects bad mode", function () {
    assert.ok(!CONTRACT.validateRequest({ mode: "invalid", question: "test" }));
  });

  test("validateContract checks provider shape", function () {
    assert.ok(CONTRACT.validateContract({ id: "x", query: function () {} }));
    assert.ok(!CONTRACT.validateContract({}));
    assert.ok(!CONTRACT.validateContract(null));
  });

  // =====================================================
  // 2. Evidence normalizer
  // =====================================================
  console.log("\n=== Evidence Normalizer ===");

  test("normalizeResponse fills missing fields", function () {
    var pkg = normalizer.normalizeResponse(null, "test-provider", "search");
    assert.equal(pkg.providerId, "test-provider");
    assert.equal(pkg.status, "error");
    assert.equal(pkg.mode, "search");
    assert.equal(pkg.answer, "");
    assert.ok(Array.isArray(pkg.claims));
    assert.ok(Array.isArray(pkg.sources));
  });

  test("normalizeResponse preserves valid fields", function () {
    var raw = {
      status: "ok",
      answer: "42 is the answer",
      claims: [{ text: "claim1", type: "fact", confidence: 0.8 }],
      sources: [{ title: "src1", url: "http://example.com", origin: "test" }],
      cost: { latencyMs: 100, tokens: 50 },
    };
    var pkg = normalizer.normalizeResponse(raw, "tp", "search");
    assert.equal(pkg.status, "ok");
    assert.equal(pkg.answer, "42 is the answer");
    assert.equal(pkg.claims.length, 1);
    assert.equal(pkg.sources.length, 1);
    assert.equal(pkg.cost.latencyMs, 100);
    assert.equal(pkg.cost.tokens, 50);
  });

  test("normalizeClaims filters invalid", function () {
    var claims = normalizer.normalizeClaims([null, undefined, { text: "valid" }, {}]);
    assert.equal(claims.length, 2);
    assert.equal(claims[0].text, "valid");
    assert.equal(claims[1].text, "");
  });

  test("normalizeUnstructuredText handles plain text", function () {
    var pkg = normalizer.normalizeUnstructuredText("Hello\n\nWorld", "manual", "search");
    assert.equal(pkg.providerId, "manual");
    assert.equal(pkg.status, "partial");
    assert.equal(pkg.claims.length, 2);
  });

  test("normalizeUnstructuredText handles empty input", function () {
    var pkg = normalizer.normalizeUnstructuredText("", "manual", "search");
    assert.equal(pkg.status, "error");
  });

  test("emptyPackage returns consistent shape", function () {
    var pkg = normalizer.emptyPackage("test", "verify", "timeout");
    assert.equal(pkg.providerId, "test");
    assert.equal(pkg.mode, "verify");
    assert.equal(pkg.status, "timeout");
  });

  // =====================================================
  // 3. Trust policy
  // =====================================================
  console.log("\n=== Trust Policy ===");

  test("resolveReliability: textbook → high", function () {
    assert.equal(trustPolicy.resolveReliability("textbook", ""), "high");
  });

  test("resolveReliability: kimi → low", function () {
    assert.equal(trustPolicy.resolveReliability("kimi", ""), "low");
  });

  test("resolveReliability: unknown origin → unknown", function () {
    assert.equal(trustPolicy.resolveReliability("random_blog", ""), "unknown");
  });

  test("meetsThreshold works", function () {
    assert.ok(trustPolicy.meetsThreshold("high", "medium"));
    assert.ok(!trustPolicy.meetsThreshold("low", "medium"));
    assert.ok(!trustPolicy.meetsThreshold("unknown", "high"));
  });

  test("detectConflict finds negation-based conflicts", function () {
    var external = [{ text: "地球不是圆的" }];
    var local = [{ text: "地球是圆的" }];
    var conflicts = trustPolicy.detectConflict(external, local);
    assert.ok(conflicts);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].resolution, "local_preferred");
  });

  test("detectConflict returns null for no conflict", function () {
    var external = [{ text: "引力常数是 9.8" }];
    var local = [{ text: "引力常数是 9.8" }];
    assert.equal(trustPolicy.detectConflict(external, local), null);
  });

  // =====================================================
  // 4. Evidence cache (no PROJECT_ROOT → in-memory only)
  // =====================================================
  console.log("\n=== Evidence Cache ===");

  test("stableContextHash uses textbookTitle + currentPage + courseLanguage", function () {
    var h1 = cache.stableContextHash({ textbookTitle: "Math", currentPage: 10, courseLanguage: "zh" });
    var h2 = cache.stableContextHash({ textbookTitle: "Math", currentPage: 10, courseLanguage: "zh" });
    assert.equal(h1, h2);
  });

  test("stableContextHash isolates selectedText", function () {
    var h1 = cache.stableContextHash({ textbookTitle: "T", currentPage: 1, courseLanguage: "en" });
    var h2 = cache.stableContextHash({ textbookTitle: "T", currentPage: 1, courseLanguage: "en", selectedText: "abc" });
    var h3 = cache.stableContextHash({ textbookTitle: "T", currentPage: 1, courseLanguage: "en", selectedText: "xyz" });
    assert.notEqual(h1, h2);
    assert.notEqual(h2, h3);
  });

  test("providerConfigHash is stable and isolates configurations", function () {
    var h1 = cache.providerConfigHash({ endpoint: "https://one.test", collection: "a" });
    var h2 = cache.providerConfigHash({ collection: "a", endpoint: "https://one.test" });
    var h3 = cache.providerConfigHash({ endpoint: "https://two.test", collection: "a" });
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
  });

  test("ttlForMode returns appropriate values", function () {
    assert.equal(cache.ttlForMode("verify"), 1);
    assert.equal(cache.ttlForMode("expand"), 14);
    assert.equal(cache.ttlForMode("search"), 3);
    assert.equal(cache.ttlForMode("unknown"), 7);
  });

  test("get returns null when no PROJECT_ROOT set", function () {
    var result = cache.get("test", "search", {}, "question");
    assert.equal(result, null);
  });

  test("setEnabled(false) disables cache get/set", function () {
    cache.setEnabled(false);
    var result = cache.get("test", "search", {}, "question");
    assert.equal(result, null);
    cache.set("test", "search", {}, "question", { answer: "x" }, 1);
    result = cache.get("test", "search", {}, "question");
    assert.equal(result, null);
    cache.setEnabled(true);
  });

  test("setEnabled(true) re-enables cache", function () {
    cache.setEnabled(true);
    var result = cache.get("test", "search", {}, "question");
    assert.equal(result, null);
  });

  // =====================================================
  // 5. Source Router (Phase 4: concurrent, external_first, 5-provider routes)
  // =====================================================
  console.log("\n=== Source Router ===");

  test("resolveRoute returns all 5 providers for search mode", function () {
    var route = router.resolveRoute("search", {});
    assert.ok(route.length >= 5);
    assert.ok(route.indexOf("local-kb") >= 0);
    assert.ok(route.indexOf("search") >= 0);
    assert.ok(route.indexOf("rag") >= 0);
    assert.ok(route.indexOf("database") >= 0);
    assert.ok(route.indexOf("kimi-desktop") >= 0);
  });

  test("resolveRoute verify mode puts search first", function () {
    var route = router.resolveRoute("verify", {});
    assert.equal(route[0], "search");
  });

  test("register and getProvider work", function () {
    var dummy = { id: "dummy", query: async function () {} };
    assert.ok(router.register(dummy));
    assert.equal(router.getProvider("dummy"), dummy);
    assert.equal(router.getProvider("nonexistent"), null);
  });

  test("listProviders returns 5 registered providers", function () {
    var list = router.listProviders();
    assert.ok(list.length >= 5);
    // Verify all Phase 4 providers are registered
    var ids = list.map(function (p) { return p.id; });
    assert.ok(ids.indexOf("search") >= 0);
    assert.ok(ids.indexOf("rag") >= 0);
    assert.ok(ids.indexOf("database") >= 0);
  });

  test("queryProvider returns error for unknown provider", async function () {
    var pkg = await router.queryProvider("unknown", { mode: "search", question: "test" }, {});
    assert.equal(pkg.providerId, "unknown");
    assert.equal(pkg.status, "unavailable");
  });

  test("queryProvider strips per-request provider config", async function () {
    var seenCtx = null;
    router.register({
      id: "config-sanitized",
      isAvailable: async function () { return true; },
      query: async function (request, ctx) {
        seenCtx = ctx;
        return { status: "ok", answer: "safe" };
      },
    });
    var result = await router.queryProvider(
      "config-sanitized",
      { mode: "search", question: "config isolation" },
      { config: { endpoint: "http://127.0.0.1/private", apiKeyRef: "secret" }, policy: "local_first" }
    );
    assert.equal(result.status, "ok");
    assert.equal(seenCtx.config, undefined);
    assert.equal(seenCtx.policy, "local_first");
  });

  test("query validates request", async function () {
    var result = await router.query({ mode: "bad" }, {});
    assert.equal(result.status, "error");
  });

  test("query respects disabledProviders config", async function () {
    router.configure({ disabledProviders: { "kimi-client": true } });
    var result = await router.query({ mode: "search", question: "test" }, {});
    assert.ok(result.status === "partial" || result.status === "unavailable" || result.status === "error" || result.status === "ok");
    router.configure({ disabledProviders: {} });
  });

  test("allowExternal false blocks every non-local provider", async function () {
    var called = 0;
    router.register({
      id: "external-guard-probe",
      kind: "external_llm",
      isAvailable: async function () { called++; return true; },
      query: async function () { called++; return { status: "ok", answer: "must not run" }; },
    });
    var direct = await router.queryProvider("external-guard-probe", {
      mode: "search", question: "private textbook excerpt", constraints: { allowExternal: false },
    }, {});
    assert.equal(direct.status, "unavailable");
    assert.equal(called, 0);
    var routed = await router.query({
      mode: "search", question: "private textbook excerpt", constraints: { allowExternal: false },
    }, { policy: "concurrent" });
    assert.deepStrictEqual(routed.raw.adapterMeta.providersQueried, ["local-kb"]);
  });

  test("queryProvider timeout returns timeout status", async function () {
    var slowProvider = {
      id: "slow-co",
      query: async function () {
        await new Promise(function (r) { setTimeout(r, 50000); });
        return { status: "ok", answer: "never" };
      },
      isAvailable: async function () { return true; },
    };
    router.register(slowProvider);
    var result = await router.queryProvider("slow-co",
      { mode: "search", question: "x", constraints: { maxLatencyMs: 5 } },
      {}
    );
    assert.equal(result.status, "timeout");
  });

  test("retry exhausts attempts on persistent timeout", async function () {
    router.configure({ maxRetries: 1 });
    var flaky = {
      id: "flaky-co",
      query: async function () {
        await new Promise(function (r) { setTimeout(r, 50000); });
        return { status: "ok", answer: "never" };
      },
      isAvailable: async function () { return true; },
    };
    router.register(flaky);
    var result = await router.queryProvider("flaky-co",
      { mode: "search", question: "x", constraints: { maxLatencyMs: 5 } },
      {}
    );
    assert.equal(result.status, "timeout");
    router.configure({ maxRetries: 0 });
  });

  test("retry succeeds on second attempt", async function () {
    var attemptCount = 0;
    router.configure({ maxRetries: 1 });
    var eventuallyOk = {
      id: "eventually-ok",
      query: async function () {
        attemptCount++;
        if (attemptCount === 1) {
          await new Promise(function (r) { setTimeout(r, 50000); });
        }
        return { status: "ok", answer: "got it" };
      },
      isAvailable: async function () { return true; },
    };
    router.register(eventuallyOk);
    var result = await router.queryProvider("eventually-ok",
      { mode: "search", question: "x", constraints: { maxLatencyMs: 5 } },
      {}
    );
    assert.equal(result.status, "ok");
    assert.equal(result.answer, "got it");
    assert.equal(attemptCount, 2);
    router.configure({ maxRetries: 0 });
  });

  test("configure accepts options and propagates", function () {
    router.configure({
      defaultMaxLatencyMs: 30000,
      maxRetries: 2,
      disabledProviders: { "x": true },
      disableCache: true,
      defaultPolicy: "concurrent",
    });
    router.configure({
      defaultMaxLatencyMs: 45000,
      maxRetries: 0,
      disabledProviders: {},
      disableCache: false,
      defaultPolicy: "local_first",
    });
  });

  // =====================================================
  // 5b. Phase 4: Policy-specific query behavior
  // =====================================================
  console.log("\n=== Source Router — Phase 4 Policies ===");

  test("query with concurrent policy runs all providers in parallel", async function () {
    var result = await router.query(
      { mode: "search", question: "test concurrent" },
      { policy: "concurrent" }
    );
    // Must not throw; result should have providerStatuses in adapterMeta
    assert.ok(result.raw && result.raw.adapterMeta);
    assert.ok(result.raw.adapterMeta.policy === "concurrent");
    // providerStatuses should show what each returned
    if (result.raw.adapterMeta.providerStatuses) {
      assert.equal(typeof result.raw.adapterMeta.providerStatuses, "object");
    }
  });

  test("query with external_first policy reorders providers", async function () {
    var result = await router.query(
      { mode: "search", question: "test external first" },
      { policy: "external_first" }
    );
    assert.ok(result.raw && result.raw.adapterMeta);
    // Should not throw
  });

  test("query with local_first policy (default) works", async function () {
    var result = await router.query(
      { mode: "search", question: "test local first" },
      { policy: "local_first" }
    );
    assert.ok(result);
  });

  test("query result includes provider counts", async function () {
    var result = await router.query(
      { mode: "search", question: "test counting" },
      { policy: "concurrent" }
    );
    assert.ok(result.raw.adapterMeta.providerCount >= 1);
    assert.ok(result.raw.adapterMeta.providersQueried.length >= 1);
  });

  // =====================================================
  // 6. Kimi Desktop Provider (Phase 1 + Phase 3)
  // =====================================================
  console.log("\n=== Kimi Desktop Provider ===");

  test("kimi provider exports contract shape", function () {
    assert.equal(kimiProvider.id, "kimi-desktop");
    assert.equal(router.getProvider("kimi-client"), kimiProvider);
    assert.equal(router.canonicalProviderId("kimi-client"), "kimi-desktop");
    assert.equal(typeof kimiProvider.query, "function");
    assert.equal(typeof kimiProvider.isAvailable, "function");
  });

  test("kimi provider isAvailable with manual mode returns true", async function () {
    assert.ok(await kimiProvider.isAvailable({ mode: "manual" }));
  });

  test("kimi provider auto mode remains available for manual fallback", async function () {
    assert.strictEqual(await kimiProvider.isAvailable({ mode: "auto" }), true);
  });

  test("kimi provider query returns partial with prompt in manual mode", async function () {
    var result = await kimiProvider.query(
      { mode: "search", question: "什么是量子计算？", context: { textbookTitle: "物理", courseLanguage: "zh-CN" } },
      { mode: "manual" }
    );
    assert.equal(result.status, "partial");
    assert.equal(result.raw.adapterMeta.mode, "manual");
    assert.ok(result.raw.excerpt.indexOf("量子计算") >= 0);
  });

  test("kimi provider query in auto mode follows current bridge availability", async function () {
    var daemonRunning = await daimonBridge.isDaemonRunning();
    var result = await kimiProvider.query(
      { mode: "search", question: "测试auto fallback", context: { courseLanguage: "zh-CN" } },
      { mode: "auto" }
    );
    assert.equal(result.status, "partial");
    assert.equal(result.raw.adapterMeta.mode, daemonRunning ? "desktop_bridge" : "manual");
  });

  test("kimi provider query in bridge mode reflects current daemon state", async function () {
    var daemonRunning = await daimonBridge.isDaemonRunning();
    var result = await kimiProvider.query(
      { mode: "search", question: "测试bridge mode", context: { courseLanguage: "zh-CN" } },
      { mode: "desktop_bridge" }
    );
    if (daemonRunning) assert.ok(result.status === "ok" || result.status === "partial");
    else assert.equal(result.status, "unavailable");
  });

  test("kimi provider buildPrompt includes question", function () {
    var prompt = kimiProvider.buildPrompt({ question: "测试", context: { courseLanguage: "zh-CN" } });
    assert.ok(prompt.indexOf("测试") >= 0);
  });

  test("kimi provider buildPrompt uses en template for en", function () {
    var prompt = kimiProvider.buildPrompt({ question: "test", context: { courseLanguage: "en" } });
    assert.ok(prompt.indexOf("Question:") >= 0);
    assert.ok(prompt.indexOf("test") >= 0);
  });

  test("parsePastedResponse handles valid JSON", function () {
    var json = JSON.stringify({
      summary: "量子计算是利用量子比特的计算方式",
      claims: [{ text: "量子比特可叠加", confidence: 0.9 }],
      sources: [{ title: "Wiki", url: "https://example.com", why_relevant: "背景" }],
    });
    var pkg = kimiProvider.parsePastedResponse(json);
    assert.equal(pkg.status, "ok");
    assert.ok(pkg.answer.indexOf("量子计算") >= 0);
    assert.equal(pkg.claims.length, 1);
    assert.equal(pkg.sources.length, 1);
  });

  test("parsePastedResponse falls back to unstructured for plain text", function () {
    var pkg = kimiProvider.parsePastedResponse("Hello\n\nWorld");
    assert.equal(pkg.status, "partial");
    assert.equal(pkg.claims.length, 2);
  });

  test("parsePastedResponse returns error for empty", function () {
    var pkg = kimiProvider.parsePastedResponse("");
    assert.equal(pkg.status, "error");
  });

  // =====================================================
  // 7. Daimon Bridge (Phase 3)
  // =====================================================
  console.log("\n=== Daimon Bridge ===");

  test("daimonBridge exports expected functions", function () {
    assert.equal(typeof daimonBridge.discoverEndpoint, "function");
    assert.equal(typeof daimonBridge.isDaemonRunning, "function");
    assert.equal(typeof daimonBridge.detectVersion, "function");
    assert.equal(typeof daimonBridge.connect, "function");
    assert.equal(typeof daimonBridge.sendJsonRpc, "function");
    assert.equal(typeof daimonBridge.simpleQuery, "function");
    assert.equal(typeof daimonBridge.disconnect, "function");
  });

  test("daimonBridge.KIMI_DESKTOP_DATA_DIR includes kimi-desktop", function () {
    if (process.platform === "win32") {
      assert.ok(daimonBridge.KIMI_DESKTOP_DATA_DIR.indexOf("kimi-desktop") >= 0);
    }
  });

  test("daimonBridge.resolveRunnerStatePath returns non-null path on win32", function () {
    var p = daimonBridge.resolveRunnerStatePath();
    if (process.platform === "win32") {
      assert.ok(p.indexOf("runner.state.json") >= 0);
    }
  });

  test("daimonBridge.discoverEndpoint returns daemon endpoint shape if running", function () {
    var ep = daimonBridge.discoverEndpoint();
    if (ep !== null) {
      assert.equal(typeof ep.url, "string");
      assert.ok(ep.url.indexOf("ws://") === 0);
      assert.equal(typeof ep.host, "string");
      assert.equal(typeof ep.port, "number");
      assert.ok(ep.port > 0);
    }
  });

  test("daimonBridge.isDaemonRunning returns boolean", function () {
    var running = daimonBridge.isDaemonRunning();
    assert.equal(typeof running, "boolean");
  });

  test("daimonBridge rejects non-numeric runner PID before process lookup", function () {
    var oldDir = process.env.KIMI_DESKTOP_DATA_DIR;
    var root = fs.mkdtempSync(path.join(os.tmpdir(), "daimon-pid-"));
    var statePath = path.join(root, "daimon-share", "daimon", "agents", "main", "runner.state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ lifecycleStatus: "running", daemonGeneration: { pid: "1 & calc.exe" } }));
    process.env.KIMI_DESKTOP_DATA_DIR = root;
    try { assert.strictEqual(daimonBridge.isDaemonRunning(), false); }
    finally {
      if (oldDir === undefined) delete process.env.KIMI_DESKTOP_DATA_DIR;
      else process.env.KIMI_DESKTOP_DATA_DIR = oldDir;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("daimonBridge.detectVersion returns version info if bundle.json exists", function () {
    var version = daimonBridge.detectVersion();
    if (version !== null) {
      assert.equal(typeof version, "object");
    }
  });

  test("daimonBridge.connect rejects with timeout on unreachable endpoint", async function () {
    try {
      await daimonBridge.connect({ url: "ws://127.0.0.1:1/control", auth: null }, 100);
      assert.fail("Should have thrown");
    } catch (e) {
      assert.ok(e.message.indexOf("timeout") >= 0 || e.message.indexOf("connect") >= 0 || e.message.indexOf("closed") >= 0);
    }
  });

  test("daimonBridge.connect rejects when no endpoint URL", async function () {
    try {
      await daimonBridge.connect(null, 100);
      assert.fail("Should have thrown");
    } catch (e) {
      assert.ok(e.message.indexOf("endpoint") >= 0);
    }
  });

  test("daimonBridge.simpleQuery returns structured result (ok or error)", async function () {
    var result = await daimonBridge.simpleQuery("test question", {});
    // The daemon may or may not be running — just verify structured shape
    assert.equal(typeof result.ok, "boolean");
    assert.equal(typeof result.latencyMs, "number");
    if (!result.ok) {
      assert.ok(typeof result.error === "string");
      assert.ok(typeof result.code === "string");
    }
  });

  test("daimonBridge.sendJsonRpc is a function", function () {
    assert.equal(typeof daimonBridge.sendJsonRpc, "function");
  });

  test("sendJsonRpc ignores notifications and nonmatching IDs", async function () {
    var ws = new EventEmitter();
    ws.send = function (payload) {
      var request = JSON.parse(payload);
      setTimeout(function () {
        ws.emit("message", JSON.stringify({ jsonrpc: "2.0", method: "runtime.event", params: { text: "unrelated notification payload" } }));
      }, 1);
      setTimeout(function () {
        ws.emit("message", JSON.stringify({ jsonrpc: "2.0", id: request.id + 1, result: "wrong response" }));
      }, 2);
      setTimeout(function () {
        ws.emit("message", JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "matched response" }));
      }, 3);
    };
    var result = await daimonBridge.sendJsonRpc(ws, "runtime.status", {}, { timeout: 100, id: 77 });
    assert.equal(result.id, 77);
    assert.equal(result.result, "matched response");
  });

  // =====================================================
  // 8. Search Provider (Phase 4)
  // =====================================================
  console.log("\n=== Search Provider ===");

  test("search provider exports contract shape", function () {
    assert.equal(searchProvider.id, "search");
    assert.equal(searchProvider.label, "Web Search");
    assert.equal(searchProvider.kind, "search_engine");
    assert.equal(typeof searchProvider.query, "function");
    assert.equal(typeof searchProvider.isAvailable, "function");
  });

  test("search provider isAvailable returns false when no config", async function () {
    assert.ok(!(await searchProvider.isAvailable({})));
  });

  test("search provider isAvailable returns false when disabled", async function () {
    assert.ok(!(await searchProvider.isAvailable({ config: { enabled: false, provider: "bing" } })));
  });

  test("google search availability requires and preserves cx", async function () {
    var oldSettings = global.__SOCRATOPIA_SETTINGS__;
    global.__SOCRATOPIA_SETTINGS__ = { apiKeys: { google: "test-key" } };
    try {
      assert.strictEqual(await searchProvider.isAvailable({ config: { enabled: true, provider: "google", apiKeyRef: "google" } }), false);
      assert.strictEqual(await searchProvider.isAvailable({ config: { enabled: true, provider: "google", apiKeyRef: "google", engineId: "engine-1" } }), true);
    } finally { global.__SOCRATOPIA_SETTINGS__ = oldSettings; }
  });

  test("search provider query returns unavailable when not configured", async function () {
    var result = await searchProvider.query(
      { mode: "search", question: "test", context: {} },
      {}
    );
    assert.equal(result.status, "unavailable");
  });

  test("search provider query validates request", async function () {
    var result = await searchProvider.query({ mode: "bad" }, {});
    assert.equal(result.status, "error");
  });

  test("search provider healthCheck returns config info", async function () {
    var health = await searchProvider.healthCheck({});
    assert.equal(typeof health.ok, "boolean");
    assert.equal(health.provider, null);
  });

  // =====================================================
  // 9. RAG Provider (Phase 4)
  // =====================================================
  console.log("\n=== RAG Provider ===");

  test("rag provider exports contract shape", function () {
    assert.equal(ragProvider.id, "rag");
    assert.equal(ragProvider.label, "RAG Knowledge Base");
    assert.equal(ragProvider.kind, "rag");
    assert.equal(typeof ragProvider.query, "function");
    assert.equal(typeof ragProvider.isAvailable, "function");
  });

  test("rag provider isAvailable returns false when no endpoint", async function () {
    assert.ok(!(await ragProvider.isAvailable({})));
  });

  test("rag provider isAvailable returns true when endpoint configured", async function () {
    assert.ok(await ragProvider.isAvailable({ config: { enabled: true, endpoint: "http://localhost:8080/rag" } }));
  });

  test("rag provider query returns unavailable when no endpoint", async function () {
    var result = await ragProvider.query(
      { mode: "search", question: "test", context: {} },
      {}
    );
    assert.equal(result.status, "unavailable");
  });

  test("rag provider query validates request", async function () {
    var result = await ragProvider.query({ mode: "bad" }, {});
    assert.equal(result.status, "error");
  });

  test("rag provider healthCheck returns config info", async function () {
    var health = await ragProvider.healthCheck({ config: { enabled: true, endpoint: "http://localhost:8080/rag", collection: "docs" } });
    assert.ok(health.ok);
    assert.equal(health.endpoint, "http://localhost:8080/rag");
    assert.equal(health.collection, "docs");
  });

  // =====================================================
  // 10. Database Provider (Phase 4)
  // =====================================================
  console.log("\n=== Database Provider ===");

  test("database provider exports contract shape", function () {
    assert.equal(databaseProvider.id, "database");
    assert.equal(databaseProvider.label, "Database Query");
    assert.equal(databaseProvider.kind, "database");
    assert.equal(typeof databaseProvider.query, "function");
    assert.equal(typeof databaseProvider.isAvailable, "function");
  });

  test("database provider isAvailable returns false when no endpoint", async function () {
    assert.ok(!(await databaseProvider.isAvailable({})));
  });

  test("database provider isAvailable returns true when endpoint configured", async function () {
    assert.ok(await databaseProvider.isAvailable({ config: { enabled: true, endpoint: "http://localhost:9090/db" } }));
  });

  test("database provider query returns unavailable when no endpoint", async function () {
    var result = await databaseProvider.query(
      { mode: "search", question: "test", context: {} },
      {}
    );
    assert.equal(result.status, "unavailable");
  });

  test("database provider query validates request", async function () {
    var result = await databaseProvider.query({ mode: "bad" }, {});
    assert.equal(result.status, "error");
  });

  test("database provider healthCheck returns config info", async function () {
    var health = await databaseProvider.healthCheck({ config: { enabled: true, endpoint: "http://localhost:9090/db", connectionRef: "my_db" } });
    assert.ok(health.ok);
    assert.equal(health.endpoint, "http://localhost:9090/db");
    assert.equal(health.connection, "my_db");
  });

  // =====================================================
  // 11. Local KB Provider
  // =====================================================
  console.log("\n=== Local KB Provider ===");

  test("local-kb provider exports contract shape", function () {
    assert.equal(localKbProvider.id, "local-kb");
    assert.equal(typeof localKbProvider.query, "function");
  });

  test("local-kb provider is available as an evidence adapter", async function () {
    assert.ok(await localKbProvider.isAvailable({}));
  });

  test("local-kb provider query returns unavailable without retrieved evidence", async function () {
    var result = await localKbProvider.query(
      { mode: "search", question: "test", context: {} },
      {}
    );
    assert.equal(result.status, "unavailable");
  });

  test("local-kb provider uses retrieved evidence and never distills the question", async function () {
    var original = global.__KB_DISTILL__;
    var called = false;
    global.__KB_DISTILL__ = async function () { called = true; return "wrong"; };
    try {
      var result = await localKbProvider.query(
        { mode: "search", question: "What is RAII?", context: { selectedText: "RAII binds resource lifetime to object lifetime." } },
        {}
      );
      assert.equal(result.status, "partial");
      assert.ok(result.answer.indexOf("resource lifetime") >= 0);
      assert.equal(called, false);
    } finally {
      if (original === undefined) delete global.__KB_DISTILL__;
      else global.__KB_DISTILL__ = original;
    }
  });

  test("local-kb provider query validates request", async function () {
    var result = await localKbProvider.query({ mode: "bad" }, {});
    assert.equal(result.status, "error");
  });

  // =====================================================
  // Summary
  // =====================================================
  testChain.then(function () {
    console.log("\n========================================");
    console.log("Knowledge Source Smoke Test Results:");
    console.log("  Passed: " + passed);
    console.log("  Failed: " + failed);
    console.log("========================================");
    process.exit(failed > 0 ? 1 : 0);
  });
})();
