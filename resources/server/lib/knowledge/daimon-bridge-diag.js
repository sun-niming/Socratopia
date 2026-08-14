#!/usr/bin/env node
/**
 * Daimon Control Bridge — Full Diagnostics
 *
 * Standalone script that exercises every function in daimon-bridge.js
 * and reports PASS/FAIL per step with colored output.
 *
 * Usage:  node daimon-bridge-diag.js
 * Exit:   0 = all pass, 1 = any fail
 *
 * No external dependencies — uses only Node built-ins + daimon-bridge.js.
 */

(function () {
  "use strict";

  // ---- ANSI coloring ----

  var GREEN = "\x1b[32m";
  var RED = "\x1b[31m";
  var YELLOW = "\x1b[33m";
  var CYAN = "\x1b[36m";
  var BOLD = "\x1b[1m";
  var RESET = "\x1b[0m";

  function pass(msg) {
    return GREEN + "  ✅ PASS" + RESET + "  " + msg;
  }

  function fail(msg) {
    return RED + "  ❌ FAIL" + RESET + "  " + msg;
  }

  function partial(msg) {
    return YELLOW + "  ⚠️ PARTIAL" + RESET + "  " + msg;
  }

  function info(msg) {
    return CYAN + "  ℹ️  " + RESET + msg;
  }

  // ---- Results tracking ----

  var results = [];

  function record(step, label, status, detail) {
    results.push({ step: step, label: label, status: status, detail: detail });
    switch (status) {
      case "pass":    console.log(pass(label));    break;
      case "fail":    console.log(fail(label));    break;
      case "partial": console.log(partial(label)); break;
      default:        console.log(info(label));    break;
    }
    if (detail) {
      console.log("        " + detail.replace(/\n/g, "\n        "));
    }
  }

  // ---- Import daimon-bridge ----

  var daimonBridge;
  try {
    daimonBridge = require("./daimon-bridge.js");
  } catch (e) {
    console.log(fail("Failed to load daimon-bridge.js: " + e.message));
    process.exit(1);
  }

  // ---- Helper: safe async wrapper ----

  async function runStep(step, label, fn) {
    try {
      var result = await fn();
      if (result && result.status) {
        record(step, label, result.status, result.detail);
        return result.status;
      }
      record(step, label, "pass", null);
      return "pass";
    } catch (e) {
      record(step, label, "fail", "Unhandled exception: " + (e.message || e));
      return "fail";
    }
  }

  // ---- Banner ----

  console.log("");
  console.log(BOLD + "╔══════════════════════════════════════════════════╗" + RESET);
  console.log(BOLD + "║   Daimon Control Bridge — Full Diagnostics      ║" + RESET);
  console.log(BOLD + "╚══════════════════════════════════════════════════╝" + RESET);
  console.log("");
  console.log(info("KIMI_DESKTOP_DATA_DIR = " + (daimonBridge.KIMI_DESKTOP_DATA_DIR || "(not set)")));
  console.log(info("Platform               = " + process.platform));
  console.log(info("Runner state path      = " + (daimonBridge.resolveRunnerStatePath() || "(not resolvable)")));
  console.log(info("Bundle path            = " + (daimonBridge.resolveBundlePath() || "(not resolvable)")));
  console.log("");

  // =====================================================
  // Step 1: Detect version from bundle.json
  // =====================================================

  async function step1() {
    var v = daimonBridge.detectVersion();
    if (!v) {
      return { status: "partial", detail: "bundle.json not found or unreadable — Kimi Desktop may not be installed" };
    }
    var lines = [];
    if (v.kimiDesktop)   lines.push("Kimi Desktop: " + v.kimiDesktop);
    if (v.daimonBundle)  lines.push("Daimon bundle: " + v.daimonBundle);
    if (v.python)        lines.push("Python: " + v.python);
    if (v.kimiCode)      lines.push("Kimi Code: " + v.kimiCode);
    if (lines.length === 0) {
      return { status: "partial", detail: "bundle.json read but no version fields found" };
    }
    return { status: "pass", detail: lines.join("\n                ") };
  }

  // =====================================================
  // Step 2: Discover WebSocket endpoint
  // =====================================================

  async function step2() {
    var ep = daimonBridge.discoverEndpoint();
    if (!ep) {
      return { status: "partial", detail: "runner.state.json not found or Daemon not started — bridge unavailable" };
    }
    var lines = [
      "URL:   " + ep.url,
      "Host:  " + ep.host,
      "Port:  " + ep.port,
      "PID:   " + ep.pid,
      "Auth:  " + (ep.auth && ep.auth.mode ? ep.auth.mode : "none"),
    ];
    if (ep.daemonPid)         lines.push("Daemon PID:     " + ep.daemonPid);
    if (ep.startedAt)         lines.push("Started at:     " + ep.startedAt);
    if (ep.daemonStartedAt)   lines.push("Daemon started: " + ep.daemonStartedAt);
    var status = ep.auth && ep.auth.token ? "pass" : "partial";
    return { status: status, detail: lines.join("\n                ") };
  }

  // =====================================================
  // Step 3: Check if daemon is actually running (PID)
  // =====================================================

  async function step3() {
    var running = daimonBridge.isDaemonRunning();
    if (running) {
      return { status: "pass", detail: "Daemon PID is alive according to tasklist/process.kill" };
    }
    return { status: "fail", detail: "Daemon not running — runner.state.json may be stale or PID dead" };
  }

  // =====================================================
  // Step 4: Attempt WebSocket connection with timeout
  // =====================================================

  async function step4() {
    var ep = daimonBridge.discoverEndpoint();
    if (!ep) {
      return { status: "skip", detail: "No endpoint — skipping WebSocket connect" };
    }
    var ws;
    try {
      ws = await daimonBridge.connect(ep, 5000);
    } catch (e) {
      return { status: "fail", detail: "WebSocket connect failed: " + e.message };
    }
    // Got a connection — immediately disconnect
    daimonBridge.disconnect(ws);
    return { status: "pass", detail: "WebSocket connected to " + ep.url };
  }

  // =====================================================
  // Step 5: Try simple RPC calls (runtime.status, capabilities.get)
  // =====================================================

  async function step5() {
    var ep = daimonBridge.discoverEndpoint();
    if (!ep) {
      return { status: "skip", detail: "No endpoint — skipping RPC calls" };
    }
    var ws;
    try {
      ws = await daimonBridge.connect(ep, 5000);
    } catch (e) {
      return { status: "skip", detail: "Cannot connect — skipping RPC calls (" + e.message + ")" };
    }

    var rpcResults = [];
    var rpcStatus = "pass";
    var methods = ["runtime.status", "capabilities.get"];

    for (var i = 0; i < methods.length; i++) {
      try {
        var resp = await daimonBridge.sendJsonRpc(ws, methods[i], {}, { timeout: 5000 });
        if (resp && resp.error) {
          rpcResults.push(methods[i] + " → error: " + (resp.error.message || JSON.stringify(resp.error)));
          rpcStatus = "partial";
        } else if (resp && resp.result) {
          rpcResults.push(methods[i] + " → ok (" + summarizeResponse(resp.result) + ")");
        } else {
          rpcResults.push(methods[i] + " → ok (response received)");
        }
      } catch (e) {
        rpcResults.push(methods[i] + " → exception: " + e.message);
        rpcStatus = "partial";
      }
    }

    daimonBridge.disconnect(ws);
    return { status: rpcStatus, detail: rpcResults.join("\n                ") };
  }

  function summarizeResponse(obj) {
    if (!obj || typeof obj !== "object") return String(obj);
    var keys = Object.keys(obj);
    if (keys.length === 0) return "empty object";
    return keys.slice(0, 4).join(", ") + (keys.length > 4 ? ", …" : "");
  }

  // =====================================================
  // Step 6: Try full simpleQuery
  // =====================================================

  async function step6() {
    var running = daimonBridge.isDaemonRunning();
    if (!running) {
      return { status: "skip", detail: "Daemon not running — skipping simpleQuery" };
    }
    var result = await daimonBridge.simpleQuery("Daimon bridge diagnostics ping", {}, 15000);
    if (result.ok) {
      var preview = result.text ? result.text.substring(0, 120).replace(/\n/g, " ") : "(empty)";
      return { status: "pass", detail: "Method: " + result.method + " | Latency: " + result.latencyMs + "ms | Text: \"" + preview + (result.text && result.text.length > 120 ? "…" : "") + "\"" };
    }
    return { status: "fail", detail: "simpleQuery failed: [" + result.code + "] " + result.error };
  }

  // =====================================================
  // Step 7: Try full conversationQuery (create → send → poll → delete)
  // =====================================================

  async function step7() {
    var running = daimonBridge.isDaemonRunning();
    if (!running) {
      return { status: "skip", detail: "Daemon not running — skipping conversationQuery" };
    }
    var result = await daimonBridge.conversationQuery("What is the capital of France? Answer in one sentence.", {}, 60000);
    if (result.ok) {
      var preview = result.text ? result.text.substring(0, 200).replace(/\n/g, " ") : "(empty)";
      return { status: "pass", detail: "Method: conversationQuery | Latency: " + result.latencyMs + "ms | Polls: " + result.pollCount + " | Text: \"" + preview + (result.text && result.text.length > 200 ? "…" : "") + "\"" };
    }
    return { status: "fail", detail: "conversationQuery failed: [" + result.code + "] " + result.error };
  }

  // ---- Main diagnostic runner ----

  async function main() {
    var steps = [
      { num: "1", label: "Detect version from bundle.json",          fn: step1 },
      { num: "2", label: "Discover WebSocket endpoint",               fn: step2 },
      { num: "3", label: "Check daemon PID is alive",                 fn: step3 },
      { num: "4", label: "WebSocket connection attempt (5s timeout)", fn: step4 },
      { num: "5", label: "JSON-RPC calls (runtime.status, caps.get)", fn: step5 },
      { num: "6", label: "Full simpleQuery round-trip",               fn: step6 },
      { num: "7", label: "Full conversationQuery e2e (60s)",          fn: step7 },
    ];

    for (var si = 0; si < steps.length; si++) {
      var s = steps[si];
      console.log(BOLD + "─── Step " + s.num + ": " + s.label + " " + RESET);
      await runStep(s.num, s.label, s.fn);
      console.log("");
    }

    // ---- Summary ----

    var passCount = 0;
    var failCount = 0;
    var partialCount = 0;
    var skipCount = 0;

    results.forEach(function (r) {
      if (r.status === "pass")    passCount++;
      else if (r.status === "fail")    failCount++;
      else if (r.status === "partial") partialCount++;
      else if (r.status === "skip")    skipCount++;
    });

    console.log(BOLD + "╔══════════════════════════════════════════════════╗" + RESET);
    console.log(BOLD + "║                 DIAGNOSTIC SUMMARY              ║" + RESET);
    console.log(BOLD + "╠══════════════════════════════════════════════════╣" + RESET);

    results.forEach(function (r) {
      var icon = r.status === "pass"    ? GREEN + "  ✅" + RESET :
                 r.status === "fail"    ? RED   + "  ❌" + RESET :
                 r.status === "partial" ? YELLOW + "  ⚠️ " + RESET :
                                          CYAN  + "  ⏭ " + RESET;
      console.log("║ " + icon + "  Step " + r.step + "  " + r.label.padEnd(40) + "║");
    });

    console.log(BOLD + "╠══════════════════════════════════════════════════╣" + RESET);
    console.log("║  " + GREEN + "✅ Passed:  " + passCount + RESET + "                           ║");
    if (failCount > 0)    console.log("║  " + RED + "❌ Failed:  " + failCount + RESET + "                           ║");
    if (partialCount > 0) console.log("║  " + YELLOW + "⚠️ Partial: " + partialCount + RESET + "                           ║");
    if (skipCount > 0)    console.log("║  " + CYAN + "⏭ Skipped: " + skipCount + RESET + "                           ║");
    console.log(BOLD + "╚══════════════════════════════════════════════════╝" + RESET);
    console.log("");

    process.exit(failCount > 0 ? 1 : 0);
  }

  main().catch(function (e) {
    console.log(fail("Diagnostic script crashed: " + (e.message || e)));
    console.log(e.stack || "");
    process.exit(1);
  });
})();
