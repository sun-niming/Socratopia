/**
 * Daimon Control WebSocket Bridge
 *
 * Phase 3 implementation: automated bridge to Kimi Desktop via the Daimon
 * agent framework's local control WebSocket.
 *
 * Discovery:
 *   Reads runner.state.json to find the WebSocket endpoint URL, port, and
 *   loopback-dev-token. The token regenerates on each daemon start, so it
 *   is captured dynamically per-connection.
 *
 * Protocol:
 *   JSON-RPC 2.0 over WebSocket (ws library — Node.js built-in WebSocket
 *   does not support custom headers required for Daimon auth).
 *   Auth is via HTTP Upgrade header (Authorization: Bearer <token>), NOT
 *   as a JSON-RPC first message. The Daimon control server validates the
 *   token during the WebSocket upgrade handshake and rejects non-loopback
 *   or unauthenticated connections.
 *
 *   Available JSON-RPC methods (confirmed by reverse-engineering the
 *   methods/index.js imports):
 *     conversations.send, conversations.list, conversations.getMessages,
 *     conversations.getActive, conversations.getContextStatus,
 *     conversations.cancel, conversations.create, conversations.delete,
 *     conversations.goal.*, conversations.getMessageTrace,
 *     conversations.setActive,
 *     runtime.status, capabilities.get, config.get, config.set,
 *     and many more (30+ namespaces: files, workspace, cron, etc.)
 *
 * Lifecycle:
 *   - discoverEndpoint()      probe runner.state.json, return endpoint config
 *   - connect()               open WS with auth header, return connection handle
 *   - simpleQuery()           probe: connect → runtime.status → capabilities.get
 *   - conversationQuery()     full query: connect → create conv → send → poll → delete
 *   - isDaemonRunning()       daemon reachability check (state + PID alive)
 *   - detectVersion()         read bundle.json version info
 *
 * All methods are defensive: every error is caught and returned as a structured
 * result. This bridge is best-effort — the Daimon control protocol is a private
 * interface that may change with Kimi Desktop version upgrades.
 */

(function () {
  "use strict";

  var path = require("path");
  var fs = require("fs");
  var wsLib = require("ws");

  // ---- Config ----

  var KIMI_DESKTOP_DATA_DIR = process.env.KIMI_DESKTOP_DATA_DIR ||
    (process.platform === "win32"
      ? (process.env.APPDATA + "\\kimi-desktop")
      : null);

  var RUNNER_STATE_RELATIVE = "daimon-share/daimon/agents/main/runner.state.json";
  var BUNDLE_RELATIVE = "daimon-bundle/bundle.json";
  var DEFAULT_WS_TIMEOUT_MS = 10000;
  var DEFAULT_QUERY_TIMEOUT_MS = 45000;

  function clipped(value, maxLength) {
    if (value === null || value === undefined) return "";
    return String(value).trim().slice(0, maxLength);
  }

  function buildConversationPrompt(questionText, context) {
    context = context || {};
    var title = clipped(context.textbookTitle || context.title, 200);
    var pageValue = context.currentPage != null ? context.currentPage : context.page;
    var page = clipped(pageValue, 40);
    var selectedText = clipped(context.selectedText, 2000);
    var pageText = clipped(context.pageText, 3000);
    var question = clipped(questionText, 4000);

    function render() {
      var lines = [];
      if (title) lines.push("教材标题：" + title);
      if (page) lines.push("当前页：" + page);
      if (selectedText) lines.push("选中文本：" + selectedText);
      if (pageText) lines.push("页面正文：" + pageText);
      lines.push("问题：" + question);
      return lines.join("\n\n");
    }

    var prompt = render();
    var overflow = Math.max(0, prompt.length - 9000);
    if (overflow && pageText) {
      pageText = pageText.slice(0, Math.max(0, pageText.length - overflow));
      prompt = render();
      overflow = Math.max(0, prompt.length - 9000);
    }
    if (overflow && selectedText) {
      selectedText = selectedText.slice(0, Math.max(0, selectedText.length - overflow));
      prompt = render();
    }
    return prompt;
  }

  // ---- Path resolution ----

  function resolveKimiDesktopDir() {
    return process.env.KIMI_DESKTOP_DATA_DIR || KIMI_DESKTOP_DATA_DIR;
  }

  function resolveRunnerStatePath() {
    var dir = resolveKimiDesktopDir();
    if (!dir) return null;
    return path.join(dir, RUNNER_STATE_RELATIVE);
  }

  function resolveBundlePath() {
    var dir = resolveKimiDesktopDir();
    if (!dir) return null;
    return path.join(dir, BUNDLE_RELATIVE);
  }

  // ---- Discovery ----

  /**
   * Read runner.state.json and discover the Daimon control WebSocket endpoint.
   * Endpoint data cached for `cacheTtlMs` (default: 5s). Pass true to force.
   */
  var _endpointCache = null;
  var _endpointCacheTime = 0;

  function discoverEndpoint(forceRefresh, cacheTtlMs) {
    cacheTtlMs = cacheTtlMs || 5000;

    if (!forceRefresh && _endpointCache && (Date.now() - _endpointCacheTime) < cacheTtlMs) {
      return _endpointCache;
    }

    var statePath = resolveRunnerStatePath();
    if (!statePath) {
      _endpointCache = null;
      return null;
    }

    try {
      var raw = fs.readFileSync(statePath, "utf-8");
      var state = JSON.parse(raw);
      var control = state.control || state.endpoint;

      if (!control) {
        _endpointCache = null;
        return null;
      }

      var ep = {
        url: control.url || (control.endpoint && control.endpoint.url),
        host: control.host || (control.endpoint && control.endpoint.host) || "127.0.0.1",
        port: control.port || (control.endpoint && control.endpoint.port),
        auth: control.auth || (control.endpoint && control.endpoint.auth) || null,
      };

      // Fallback: parse url if no explicit port
      if (!ep.port && ep.url) {
        var match = ep.url.match(/:(\d+)\//);
        if (match) ep.port = parseInt(match[1], 10);
      }

      // Attach daemon PID/timestamp from parent
      ep.daemonPid = (state.daemonGeneration && state.daemonGeneration.pid) || null;
      ep.daemonStartedAt = (state.daemonGeneration && state.daemonGeneration.startedAt) || null;

      if (!ep.url) {
        _endpointCache = null;
        return null;
      }

      _endpointCache = ep;
      _endpointCacheTime = Date.now();
      return ep;
    } catch (e) {
      _endpointCache = null;
      return null;
    }
  }

  /**
   * Check if the Daimon daemon is actually running. Uses both:
   *   1. Valid runner.state.json with lifecycleStatus === "running"
   *   2. PID is alive (tasklist on win32, process.kill on posix)
   */
  function isDaemonRunning() {
    var statePath = resolveRunnerStatePath();
    if (!statePath) return false;

    var state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    } catch (e) {
      return false;
    }

    if (!state || state.lifecycleStatus !== "running") return false;

    var pid;
    try {
      pid = (state.daemonGeneration && state.daemonGeneration.pid) ||
            (state.control && state.control.pid) ||
            (state.control && state.control.endpoint && state.control.endpoint.pid);
    } catch (e) {
      return false;
    }

    pid = Number(pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;

    // Verify PID is alive
    try {
      if (process.platform === "win32") {
        var result = require("child_process").execFileSync(
          "tasklist",
          ["/FI", "PID eq " + String(pid), "/NH"],
          { encoding: "utf-8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }
        );
        return result.indexOf(pid.toString()) >= 0;
      } else {
        process.kill(pid, 0);
        return true;
      }
    } catch (e) {
      return false;
    }
  }

  /**
   * Read the Kimi Desktop version from bundle.json (no WS needed).
   */
  function detectVersion() {
    var bundlePath = resolveBundlePath();
    if (!bundlePath) {
      return { ok: false, error: "Bundle path not resolvable" };
    }
    try {
      var bundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));
      return {
        ok: true,
        version: bundle.version || bundle.appVersion || "unknown",
        build: bundle.build || null,
        channel: bundle.channel || bundle.releaseChannel || null,
      };
    } catch (e) {
      return { ok: false, error: "Failed to read bundle.json: " + e.message };
    }
  }

  // ---- WebSocket connection ----

  /**
   * Open a WebSocket connection to the Daimon control endpoint.
   * The loopback-dev-token is sent as an Authorization: Bearer header
   * during the HTTP upgrade handshake (required by the Daimon control server).
   *
   * Uses the `ws` library — Node.js built-in WebSocket does not support
   * custom headers, which are essential for auth.
   *
   * Returns a Promise that resolves to the open WebSocket instance.
   * Rejects with an Error on timeout, WS error, or auth failure.
   */
  function connect(endpoint, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var settleTimeout = timeoutMs || DEFAULT_WS_TIMEOUT_MS;
      if (!endpoint || !endpoint.url) {
        return reject(new Error("No endpoint URL"));
      }

      var ws;
      try {
        var wsOptions = {};
        if (endpoint.auth && endpoint.auth.mode === "loopback-dev-token" && endpoint.auth.token) {
          wsOptions.headers = { "Authorization": "Bearer " + endpoint.auth.token };
        }
        ws = new wsLib.WebSocket(endpoint.url, wsOptions);
      } catch (e) {
        return reject(new Error("WebSocket construction failed: " + e.message));
      }

      var settled = false;

      var timer = setTimeout(function () {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch (_) {}
          reject(new Error("WebSocket connect timeout after " + settleTimeout + "ms"));
        }
      }, settleTimeout);

      ws.on("open", function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ws);
      });

      ws.on("error", function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("WebSocket error: " + (err.message || "unknown")));
      });

      ws.on("close", function (code, reason) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("WebSocket closed before open: code=" + code + " reason=" + (reason || "")));
        }
      });
    });
  }

  // ---- JSON-RPC messaging ----

  /**
   * Send a JSON-RPC 2.0 request over an established WebSocket and return
   * the response. Uses a single-message listener: the first JSON-RPC
   * response with a matching id resolves the promise.
   *
   * For methods that return streaming/progressive results, set
   * opts.collectAll=true to collect ALL messages within the timeout and
   * return an array.
   *
   * Returns a raw JSON-RPC response object or an array of messages.
   */
  function sendJsonRpc(ws, method, params, opts) {
    return new Promise(function (resolve, reject) {
      opts = opts || {};
      var maxWait = opts.timeout || DEFAULT_QUERY_TIMEOUT_MS;
      var collectAll = opts.collectAll || false;
      var id = opts.id || nextId();

      var settled = false;
      var messages = [];

      var timer = setTimeout(function () {
        if (!settled) {
          if (collectAll && messages.length > 0) {
            settled = true;
            resolve(messages);
          } else {
            settled = true;
            reject(new Error("JSON-RPC response timeout after " + maxWait + "ms"));
          }
        }
      }, maxWait);

      var handler = function (data) {
        if (settled) return;
        if (typeof data !== "string") {
          try { data = data.toString("utf-8"); } catch (_) { data = ""; }
        }

        // Try to parse as JSON
        var parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          // Non-JSON message — store as raw text
          if (collectAll) {
            messages.push({ raw: data, type: "text" });
            return;
          }
        }

        if (collectAll) {
          messages.push(parsed || { raw: data, type: "text" });
          return;
        }

        // Single-response mode: only match by id (exact match)
        if (parsed && typeof parsed === "object" && parsed.id === id) {
          settled = true;
          clearTimeout(timer);
          ws.off("message", handler);
          return resolve(parsed);
        }

        // Ignore notifications and responses for other request IDs. Resolving
        // them here would attach an unrelated daemon event to this RPC call.
      };

      ws.on("message", handler);

      // Send the request
      var request = JSON.stringify({
        jsonrpc: "2.0",
        method: method,
        params: params || {},
        id: id,
      });

      try {
        ws.send(request);
      } catch (e) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          ws.off("message", handler);
          reject(new Error("Failed to send JSON-RPC: " + e.message));
        }
      }
    });
  }

  /**
   * Allocate a monotonically increasing request ID.
   */
  function nextId() {
    return 100 + (nextId._counter = (nextId._counter || 0) + 1);
  }

  // ---- Simple status probe ----

  /**
   * One-shot status probe: discover → connect → status → capabilities → disconnect.
   *
   * Tries runtime.status first for a quick daemon health check, then
   * capabilities.get for protocol info. Both are lightweight RPC methods
   * that require no conversation context.
   *
   * Returns a result object with:
   *   { ok: true, text: "...", method: "...", endpoint: {...}, latencyMs: N }
   *   { ok: false, error: "...", code: "not_running|connect_failed|...", endpoint: {...}|null }
   *
   * Never throws.
   */
  async function simpleQuery(questionText, context, queryTimeoutMs) {
    var startTime = Date.now();
    context = context || {};
    queryTimeoutMs = queryTimeoutMs || DEFAULT_QUERY_TIMEOUT_MS;

    // 1. Discover endpoint
    var endpoint = discoverEndpoint();
    if (!endpoint) {
      return { ok: false, error: "Kimi Desktop daemon not running or runner.state.json not found", code: "not_running", endpoint: null, latencyMs: Date.now() - startTime };
    }

    // 2. Connect
    var ws;
    try {
      ws = await connect(endpoint, DEFAULT_WS_TIMEOUT_MS);
    } catch (e) {
      return { ok: false, error: "WebSocket connect failed: " + e.message, code: "connect_failed", endpoint: endpoint, latencyMs: Date.now() - startTime };
    }

    try {
      // 3. Try method chain: runtime.status → capabilities.get
      var response;
      var usedMethod = null;

      var attempts = [
        { method: "runtime.status", params: {}, timeout: 5000 },
        { method: "capabilities.get", params: {}, timeout: 5000 },
      ];

      for (var ai = 0; ai < attempts.length; ai++) {
        var attempt = attempts[ai];
        try {
          response = await sendJsonRpc(ws, attempt.method, attempt.params, {
            timeout: attempt.timeout,
            id: nextId(),
          });
          usedMethod = attempt.method;
          break;
        } catch (rpcErr) {
          if (ai < attempts.length - 1) {
            continue;
          }
          return { ok: false, error: "Daimon probe failed: " + rpcErr.message, code: "query_failed", endpoint: endpoint, latencyMs: Date.now() - startTime };
        }
      }

      if (!response) {
        return { ok: false, error: "All Daimon methods returned no response", code: "empty_response", endpoint: endpoint, latencyMs: Date.now() - startTime };
      }

      // 4. Extract text from response
      var text = "";
      if (response.result) {
        text = typeof response.result === "string" ? response.result : JSON.stringify(response.result);
      } else if (response.raw) {
        text = response.raw;
      } else {
        text = JSON.stringify(response);
      }

      if (!text.trim()) {
        return { ok: false, error: "Daimon returned empty response", code: "empty_response", endpoint: endpoint, latencyMs: Date.now() - startTime };
      }

      return {
        ok: true,
        text: text,
        method: usedMethod,
        endpoint: endpoint,
        latencyMs: Date.now() - startTime,
        messageCount: 1,
      };
    } finally {
      disconnect(ws);
    }
  }

  // ---- Conversation query ----

  var AGENT_ID = "main";
  var SESSION_KEY = "agent:main:main";
  var POLL_INTERVAL_MS = 2000;

  /**
   * Full conversation query: create → send → poll response → delete.
   *
   * This is the primary method for knowledge-source queries via Kimi Desktop.
   * It creates a temporary conversation, sends the question to the Daimon
   * kernel, polls for the assistant response, then cleans up.
   *
   * Returns:
   *   { ok: true, text: "...", conversationKey: "...", latencyMs: N, messageCount: N }
   *   { ok: false, error: "...", code: "..." }
   *
   * Never throws.
   */
  async function conversationQuery(questionText, context, queryTimeoutMs) {
    var startTime = Date.now();
    context = context || {};
    var promptText = buildConversationPrompt(questionText, context);
    queryTimeoutMs = queryTimeoutMs || DEFAULT_QUERY_TIMEOUT_MS;

    // 1. Discover endpoint
    var endpoint = discoverEndpoint();
    if (!endpoint) {
      return { ok: false, error: "Kimi Desktop daemon not running", code: "not_running", endpoint: null, latencyMs: Date.now() - startTime };
    }

    // 2. Connect
    var ws;
    try {
      ws = await connect(endpoint, DEFAULT_WS_TIMEOUT_MS);
    } catch (e) {
      return { ok: false, error: "WebSocket connect failed: " + e.message, code: "connect_failed", endpoint: endpoint, latencyMs: Date.now() - startTime };
    }

    var conversationKey = null;
    try {
      // 3. Create a temporary conversation
      var createResult;
      try {
        createResult = await sendJsonRpc(ws, "conversations.create", {
          agentId: AGENT_ID,
          sessionKey: SESSION_KEY,
          title: "Knowledge Query",
          metadata: { source: "socratopia-external-knowledge-query" },
        }, { timeout: 10000, id: nextId() });
      } catch (e) {
        return { ok: false, error: "Failed to create conversation: " + e.message, code: "create_failed", endpoint: endpoint, latencyMs: Date.now() - startTime };
      }

      var createData = createResult && (createResult.result || createResult);
      conversationKey = createData && (
        createData.conversationKey ||
        createData.activeConversationKey ||
        (createData.session && createData.session.activeConversationKey) ||
        (createData.conversation && createData.conversation.conversationKey)
      );
      if (!conversationKey) {
        return { ok: false, error: "No conversationKey in create response", code: "create_failed", endpoint: endpoint, latencyMs: Date.now() - startTime };
      }

      // 4. Send the query
      try {
        await sendJsonRpc(ws, "conversations.send", {
          agentId: AGENT_ID,
          conversationKey: conversationKey,
          text: promptText,
          source: "socratopia-external-knowledge-query",
        }, { timeout: 15000, id: nextId() });
      } catch (e) {
        // If send "fails" with timeout, the message might still be queued — continue polling
        console.log("[daimon-bridge] conversations.send: " + e.message + " (still polling for response)");
      }

      // 5. Poll for assistant response
      var deadline = Date.now() + queryTimeoutMs;
      var pollCount = 0;
      var assistantText = null;
      var collectedMessages = [];

      while (Date.now() < deadline) {
        pollCount++;
        var pollStart = Date.now();

        try {
          var messagesResult = await sendJsonRpc(ws, "conversations.getMessages", {
            agentId: AGENT_ID,
            conversationKey: conversationKey,
          }, { timeout: 5000, id: nextId() });

          var messagesData = messagesResult && (messagesResult.result || messagesResult);
          var messages = messagesData && (messagesData.messages || messagesData.items || []);
          if (messages && messages.length > 0) {
            collectedMessages = messages;

            for (var mi = messages.length - 1; mi >= 0; mi--) {
              var msg = messages[mi];
              var role = (msg.role || msg.type || "").toLowerCase();
              if (role === "assistant" || role === "ai" || msg.role === "agent") {
                var text = extractMessageText(msg);
                if (text && text.length > 5) {
                  assistantText = text;
                  break;
                }
              }
            }

            if (assistantText) {
              break;
            }
          }
        } catch (_) {
          // Poll errors are non-fatal
        }

        var elapsed = Date.now() - pollStart;
        var waitTime = Math.max(100, POLL_INTERVAL_MS - elapsed);
        await sleep(waitTime);
      }

      if (!assistantText) {
        return { ok: false, error: "No assistant response received within timeout", code: "no_response", endpoint: endpoint, latencyMs: Date.now() - startTime };
      }

      return {
        ok: true,
        text: assistantText,
        conversationKey: conversationKey,
        endpoint: endpoint,
        latencyMs: Date.now() - startTime,
        messageCount: collectedMessages.length,
        pollCount: pollCount,
      };
    } finally {
      // 6. Clean up: delete the temporary conversation
      if (conversationKey) {
        try {
          await sendJsonRpc(ws, "conversations.delete", {
            agentId: AGENT_ID,
            conversationKey: conversationKey,
          }, { timeout: 5000, id: nextId() });
        } catch (_) {
          // Cleanup errors are non-fatal
        }
      }
      disconnect(ws);
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * Extract text from a Daimon conversation message.
   * Messages use a `parts` array with `kind` (text, reasoning, etc.)
   * and `text` fields. Falls back to direct text/content/message fields.
   */
  function extractMessageText(msg) {
    if (!msg) return "";
    if (msg.parts && Array.isArray(msg.parts)) {
      var texts = [];
      for (var pi = 0; pi < msg.parts.length; pi++) {
        var part = msg.parts[pi];
        if (part && part.kind === "text" && part.text) {
          texts.push(part.text);
        }
      }
      if (texts.length > 0) return texts.join("\n");
    }
    return msg.text || msg.content || msg.message || "";
  }

  // ---- Disconnect ----

  /**
   * Clean up a WebSocket connection.
   */
  function disconnect(ws) {
    try {
      if (ws && typeof ws.close === "function") {
        ws.close(1000, "bridge-closed");
      }
    } catch (_) {}
    try {
      if (ws && typeof ws.terminate === "function") {
        ws.terminate();
      }
    } catch (_) {}
  }

  // ---- Exports ----

  module.exports = {
    KIMI_DESKTOP_DATA_DIR: KIMI_DESKTOP_DATA_DIR,
    resolveRunnerStatePath: resolveRunnerStatePath,
    resolveBundlePath: resolveBundlePath,
    discoverEndpoint: discoverEndpoint,
    isDaemonRunning: isDaemonRunning,
    detectVersion: detectVersion,
    connect: connect,
    sendJsonRpc: sendJsonRpc,
    simpleQuery: simpleQuery,
    conversationQuery: conversationQuery,
    buildConversationPrompt: buildConversationPrompt,
    extractMessageText: extractMessageText,
    disconnect: disconnect,
  };
})();
