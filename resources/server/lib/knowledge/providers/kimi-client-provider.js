/**
 * Kimi Desktop Provider (manual + desktop_bridge modes)
 *
 * Phase 1 implementation: manual mode — generates structured prompts for
 * the user to copy into Kimi, parses pasted responses into evidence.
 *
 * Phase 3 addition: desktop_bridge mode — auto-queries Kimi Desktop via
 * the Daimon Control WebSocket (local JSON-RPC interface). Falls back to
 * manual mode when the WebSocket is unavailable.
 *
 * Configuration (via router context or settings):
 *   mode: "manual" | "desktop_bridge" | "auto" (default: "auto")
 *   - "manual": always generate copy-paste prompt (Phase 1 behavior)
 *   - "desktop_bridge": use WebSocket, fall back to manual on failure
 *   - "auto" (default): try desktop_bridge, fall back to manual
 *
 * See plan Section 6 and 7 for full design.
 */

(function () {
  "use strict";

  var normalizer = require("../evidence-normalizer.js");
  var contract = require("../provider-contract.js");
  var daimonBridge = require("../daimon-bridge.js");

  var PROMPT_TEMPLATES = {};

  // zh template
  PROMPT_TEMPLATES["zh-CN"] = [
    "你是 Socratopia 的外部知识核验源。",
    "请围绕以下问题提供候选资料、关键结论、可能争议和可追溯来源。",
    "",
    "问题：",
    "{{question}}",
    "",
    "本地教材上下文：",
    "{{context}}",
    "",
    '请按 JSON 结构回答：',
    '{',
    '  "summary": "...",',
    '  "claims": [',
    '    {"text": "...", "confidence": 0.0, "reason": "..."}',
    '  ],',
    '  "sources": [',
    '    {"title": "...", "url": "...", "why_relevant": "..."}',
    '  ],',
    '  "uncertainties": ["..."],',
    '  "suggested_queries": ["..."]',
    '}',
    "",
    "如果无法确认来源，请明确写 unknown，不要编造 URL。",
  ].join("\n");

  // zh-TW template (same structure, traditional characters)
  PROMPT_TEMPLATES["zh-TW"] = [
    "你是 Socratopia 的外部知識核驗源。",
    "請圍繞以下問題提供候選資料、關鍵結論、可能爭議和可追溯來源。",
    "",
    "問題：",
    "{{question}}",
    "",
    "本地教材上下文：",
    "{{context}}",
    "",
    '請按 JSON 結構回答：',
    '{',
    '  "summary": "...",',
    '  "claims": [',
    '    {"text": "...", "confidence": 0.0, "reason": "..."}',
    '  ],',
    '  "sources": [',
    '    {"title": "...", "url": "...", "why_relevant": "..."}',
    '  ],',
    '  "uncertainties": ["..."],',
    '  "suggested_queries": ["..."]',
    '}',
    "",
    "如果無法確認來源，請明確寫 unknown，不要編造 URL。",
  ].join("\n");

  // en template
  PROMPT_TEMPLATES["en"] = [
    "You are Socratopia's external knowledge verification source.",
    "Provide candidate information, key conclusions, potential disputes, and traceable sources for the following question.",
    "",
    "Question:",
    "{{question}}",
    "",
    "Local textbook context:",
    "{{context}}",
    "",
    "Respond in the following JSON structure:",
    '{',
    '  "summary": "...",',
    '  "claims": [',
    '    {"text": "...", "confidence": 0.0, "reason": "..."}',
    '  ],',
    '  "sources": [',
    '    {"title": "...", "url": "...", "why_relevant": "..."}',
    '  ],',
    '  "uncertainties": ["..."],',
    '  "suggested_queries": ["..."]',
    '}',
    "",
    "If you cannot confirm a source, explicitly write unknown. Do not fabricate URLs.",
  ].join("\n");

  // Override legacy mojibake template literals with readable product text.
  PROMPT_TEMPLATES["zh-CN"] = [
    "你是 Socratopia 的外部知识核验源。",
    "请围绕以下问题提供候选资料、关键结论、可能争议和可追溯来源。",
    "",
    "问题：",
    "{{question}}",
    "",
    "本地教材上下文：",
    "{{context}}",
    "",
    "请按 JSON 结构回答：",
    "{",
    '  "summary": "...",',
    '  "claims": [',
    '    {"text": "...", "confidence": 0.0, "reason": "..."}',
    "  ],",
    '  "sources": [',
    '    {"title": "...", "url": "...", "why_relevant": "..."}',
    "  ],",
    '  "uncertainties": ["..."],',
    '  "suggested_queries": ["..."]',
    "}",
    "",
    "如果无法确认来源，请明确写 unknown，不要编造 URL。",
  ].join("\n");

  PROMPT_TEMPLATES["zh-TW"] = [
    "你是 Socratopia 的外部知識核驗源。",
    "請圍繞以下問題提供候選資料、關鍵結論、可能爭議和可追溯來源。",
    "",
    "問題：",
    "{{question}}",
    "",
    "本地教材上下文：",
    "{{context}}",
    "",
    "請按 JSON 結構回答：",
    "{",
    '  "summary": "...",',
    '  "claims": [',
    '    {"text": "...", "confidence": 0.0, "reason": "..."}',
    "  ],",
    '  "sources": [',
    '    {"title": "...", "url": "...", "why_relevant": "..."}',
    "  ],",
    '  "uncertainties": ["..."],',
    '  "suggested_queries": ["..."]',
    "}",
    "",
    "如果無法確認來源，請明確寫 unknown，不要編造 URL。",
  ].join("\n");

  // ---- Prompt building (manual mode helpers) ----

  function getTemplate(lang) {
    return PROMPT_TEMPLATES[lang] || PROMPT_TEMPLATES["zh-CN"];
  }

  function renderPrompt(template, question, contextText) {
    return template
      .replace(/\{\{question\}\}/g, question || "")
      .replace(/\{\{context\}\}/g, contextText || "");
  }

  /**
   * Build a structured Kimi query prompt from a request (manual mode).
   */
  function buildPrompt(request) {
    var lang = (request.context && request.context.courseLanguage) || "zh-CN";
    var template = getTemplate(lang);
    var contextLines = [];
    var ctx = request.context || {};
    if (ctx.textbookTitle) contextLines.push("教材: " + ctx.textbookTitle);
    if (ctx.currentPage != null) contextLines.push("当前页: " + ctx.currentPage);
    if (ctx.selectedText) contextLines.push("选中文本: " + ctx.selectedText.slice(0, 300));
    return renderPrompt(template, request.question, contextLines.join("\n"));
  }

  /**
   * Parse a user-pasted Kimi response (JSON or free text) into evidence.
   */
  function parsePastedResponse(text) {
    if (!text || typeof text !== "string") {
      return normalizer.emptyPackage("kimi-desktop", "search", "error");
    }

    text = text.trim();

    // Try JSON parse first
    try {
      var parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        return normalizer.normalizeResponse(
          {
            status: "ok",
            answer: parsed.summary || "",
            claims: (parsed.claims || []).map(function (c) {
              return { text: c.text, type: "fact", confidence: c.confidence, support: [], conflicts: [] };
            }),
            sources: (parsed.sources || []).map(function (s) {
              return { title: s.title, url: s.url, origin: "kimi-desktop", quotedText: s.why_relevant || "" };
            }),
            raw: {
              adapterMeta: {
                uncertainties: parsed.uncertainties || [],
                suggestedQueries: parsed.suggested_queries || [],
              },
            },
          },
          "kimi-desktop",
          "search"
        );
      }
    } catch (e) {
      // Not JSON; fall through to unstructured parse
    }

    // Fallback: treat as free text
    var pkg = normalizer.normalizeUnstructuredText(text, "kimi-desktop", "search");
    pkg.raw.adapterMeta.parseFallback = "not_json";
    return pkg;
  }

  // ---- Desktop bridge helpers ----

  /**
   * Attempt a query via the Daimon Control WebSocket.
   * Returns an evidence package on success, or null on failure.
   */
  var BRIDGE_TIMEOUT_MS = 45000; // 45s for conversation queries (kernel needs time to respond)

  async function queryViaBridge(request, ctx, queryTimeoutMs) {
    try {
      var questionText = request.question || "";
      var context = {
        textbookTitle: request.context ? request.context.textbookTitle : "",
        currentPage: request.context ? request.context.currentPage : null,
      };

      queryTimeoutMs = queryTimeoutMs || BRIDGE_TIMEOUT_MS;
      var bridgeResult = await daimonBridge.conversationQuery(questionText, context, queryTimeoutMs);
      if (!bridgeResult.ok || !bridgeResult.text) {
        return null;
      }

      // Try to parse bridge response as JSON (Kimi may reply in structured format)
      var parsedAnswer = bridgeResult.text;
      try {
        var parsed = JSON.parse(bridgeResult.text);
        if (parsed && typeof parsed === "object") {
          // Use normalizer with structured fields
          return normalizer.normalizeResponse(
            {
              status: parsed.summary ? "ok" : "partial",
              answer: parsed.summary || "",
              claims: (parsed.claims || []).map(function (c) {
                return { text: c.text, type: "fact", confidence: c.confidence, support: [], conflicts: [] };
              }),
              sources: (parsed.sources || []).map(function (s) {
                return { title: s.title, url: s.url, origin: "kimi-desktop", quotedText: s.why_relevant || "" };
              }),
              raw: {
                adapterMeta: {
                  mode: "desktop_bridge",
                  endpointPort: bridgeResult.endpoint ? bridgeResult.endpoint.port : null,
                  uncertainties: parsed.uncertainties || [],
                  suggestedQueries: parsed.suggested_queries || [],
                },
              },
              cost: { latencyMs: bridgeResult.latencyMs, tokens: null },
            },
            "kimi-desktop",
            request.mode
          );
        }
      } catch (_) {
        // Not JSON — use as free text
      }

      // Bridge returned unstructured text
      var pkg = normalizer.normalizeUnstructuredText(parsedAnswer, "kimi-desktop", request.mode);
      pkg.cost.latencyMs = bridgeResult.latencyMs;
      pkg.raw.adapterMeta.mode = "desktop_bridge";
      pkg.raw.adapterMeta.endpointPort = bridgeResult.endpoint ? bridgeResult.endpoint.port : null;

      // Try to get version info for the adapterMeta
      try {
        var versionInfo = daimonBridge.detectVersion();
        if (versionInfo) {
          pkg.raw.adapterMeta.kimiDesktopVersion = versionInfo.kimiDesktop;
        }
      } catch (_) {}

      return pkg;
    } catch (e) {
      return null;
    }
  }

  /**
   * Resolve the effective query mode from context config.
   * Order: ctx.mode → "auto" (default)
   */
  function resolveMode(ctx) {
    if (ctx && ctx.mode) {
      return ctx.mode; // "manual" | "desktop_bridge" | "auto"
    }
    return "auto";
  }

  // ---- Provider definition ----

  var provider = {
    id: "kimi-desktop",
    aliases: ["kimi-client"],
    label: "Kimi Desktop",
    kind: "external_llm",
    capabilities: {
      search: true,
      expand: true,
      explain: true,
      verify: true,
      citations: "best_effort",
    },

    /**
     * Check if this provider is available.
     * - manual mode: always true
     * - desktop_bridge / auto: true if manual OR daemon is running
     */
    isAvailable: async function (ctx) {
      ctx = ctx || {};
      var mode = resolveMode(ctx);
      if (mode === "desktop_bridge") return daimonBridge.isDaemonRunning();
      // manual is always usable, and auto must remain routable so query()
      // can fall back to the manual copy/paste workflow when the daemon is
      // absent or fails between availability probing and the actual query.
      return true;
    },

    /**
     * Query Kimi Desktop:
     *   manual mode  → return copy-paste prompt
     *   bridge mode  → query via Daimon WebSocket, fall back to manual
     *   auto mode    → try bridge, fall back to manual
     */
    query: async function (request, ctx) {
      if (!contract.validateRequest(request)) {
        return normalizer.emptyPackage("kimi-desktop", request ? request.mode : "search", "error");
      }

      ctx = ctx || {};
      var mode = resolveMode(ctx);

      if (mode === "desktop_bridge") {
        // Bridge-only mode: try WebSocket, return error on failure
        var bridgePkg = await queryViaBridge(request, ctx);
        if (bridgePkg) return bridgePkg;
        return normalizer.emptyPackage("kimi-desktop", request.mode, "unavailable");
      }

      if (mode === "manual") {
        // Manual-only mode: generate prompt (Phase 1 behavior)
        return manualQuery(request);
      }

      // "auto" mode: try bridge first, fall back to manual
      var autoPkg = await queryViaBridge(request, ctx);
      if (autoPkg) {
        return autoPkg;
      }

      // Bridge failed — fall back to manual mode with a log notice
      console.log("[knowledge] kimi-desktop bridge unavailable for mode=" + request.mode +
        ", falling back to manual mode");
      return manualQuery(request);
    },

    healthCheck: async function (ctx) {
      ctx = ctx || {};
      var info = {
        mode: resolveMode(ctx),
        daemonRunning: daimonBridge.isDaemonRunning(),
        manualAvailable: true,
      };

      try {
        var versionInfo = daimonBridge.detectVersion();
        if (versionInfo) info.version = versionInfo;
      } catch (_) {}

      try {
        var endpoint = daimonBridge.discoverEndpoint();
        if (endpoint) {
          info.endpoint = { host: endpoint.host, port: endpoint.port, pid: endpoint.pid };
        }
      } catch (_) {}

      return info;
    },
  };

  /**
   * Manual-mode query: generate copy-paste prompt (extracted from Phase 1 code).
   */
  function manualQuery(request) {
    var prompt = buildPrompt(request);

    return {
      providerId: "kimi-desktop",
      status: "partial",
      mode: request.mode || "search",
      answer: "",
      claims: [],
      sources: [],
      raw: {
        excerpt: prompt,
        adapterMeta: {
          mode: "manual",
          instructions: "copy_prompt_to_kimi",
          language: (request.context && request.context.courseLanguage) || "zh-CN",
        },
      },
      cost: { latencyMs: 0, tokens: null },
    };
  }

  // Expose utility functions for testing and external use
  provider.buildPrompt = buildPrompt;
  provider.parsePastedResponse = parsePastedResponse;
  provider.queryViaBridge = queryViaBridge;
  provider.resolveMode = resolveMode;

  module.exports = provider;
})();
