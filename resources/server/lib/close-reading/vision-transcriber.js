"use strict";

var Normalizer = require("./text-normalizer.js");
var ResponsesCompat = require("../responses-api-compat.js");

var TRANSCRIPTION_PROMPT = [
  "Transcribe this PDF page verbatim. Do not summarize or explain.",
  "Preserve the original language, paragraph boundaries, code indentation, identifiers, commands, operators, formulas and punctuation.",
  "Do not translate code, variable names, commands or comments.",
  "For an unreadable character, write [无法识别] instead of guessing.",
  "Return only the transcription.",
].join("\n");

async function postJSON(baseUrl, apiKey, payload, options) {
  options = options || {};
  var cacheModel = String(payload && payload.model || "");
  if (/^gpt-5\.6/i.test(cacheModel)) {
    payload = Object.assign({}, payload, {
      prompt_cache_key: ("socratopia:close-reading-vision:" + cacheModel).toLowerCase().replace(/[^a-z0-9_.:-]/g, "-").slice(0, 64),
      prompt_cache_retention: "24h",
    });
  }
  var url = new URL(String(baseUrl || "").replace(/\/$/, "") + "/chat/completions");
  var parsed = await ResponsesCompat.postChatCompletionsJson(url, payload, {
    headers: Object.assign({
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (apiKey || ""),
      "Connection": "close",
    }, options.headers || {}),
    timeoutMs: options.timeoutMs || 120000,
    timeoutMessage: "timeout",
  });
  if (parsed.usage) {
    var details = parsed.usage.prompt_tokens_details || {};
    console.log("[direct-llm-cache]", { model: cacheModel, purpose: "close-reading-vision", promptTokens: parsed.usage.prompt_tokens, cachedTokens: details.cached_tokens || 0, cacheWriteTokens: details.cache_write_tokens || 0 });
  }
  var message = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
  if (!message) throw new Error("Model response has no choices[0].message");
  return { text: Normalizer.normalizeText(message.content || message.reasoning_content || ""), usage: parsed.usage || null };
}

function visionConfig(override) {
  var block = override || (global.__SOCRATOPIA_SET__ && global.__SOCRATOPIA_SET__.vision) || {};
  return { baseUrl: block.baseUrl || block.baseURL || "", apiKey: block.apiKey || "", model: block.model || "" };
}

async function transcribePage(pngB64, options) {
  options = options || {};
  var config = visionConfig(options.config);
  if (!config.baseUrl || !config.apiKey || !config.model) return { ok: false, reason: "vision_not_configured", text: "" };
  try {
    var result = await postJSON(config.baseUrl, config.apiKey, {
      model: config.model,
      max_tokens: 4096,
      stream: false,
      messages: [{ role: "user", content: [
        { type: "text", text: TRANSCRIPTION_PROMPT },
        { type: "image_url", image_url: { url: "data:image/png;base64," + pngB64 } },
      ] }],
    }, { timeoutMs: options.timeoutMs || 120000 });
    var assessed = Normalizer.assessTextLayer(result.text);
    if (!assessed.text.trim()) return { ok: false, reason: "vision_empty", text: "" };
    return { ok: true, text: assessed.text, encodingQuality: assessed.encodingQuality };
  } catch (error) {
    return { ok: false, reason: "vision_failed", error: error.message, text: "" };
  }
}

module.exports = { TRANSCRIPTION_PROMPT: TRANSCRIPTION_PROMPT, postJSON: postJSON, transcribePage: transcribePage, visionConfig: visionConfig };
