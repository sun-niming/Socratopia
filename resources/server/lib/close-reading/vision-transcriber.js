"use strict";

var http = require("http");
var https = require("https");
var Normalizer = require("./text-normalizer.js");

var TRANSCRIPTION_PROMPT = [
  "Transcribe this PDF page verbatim. Do not summarize or explain.",
  "Preserve the original language, paragraph boundaries, code indentation, identifiers, commands, operators, formulas and punctuation.",
  "Do not translate code, variable names, commands or comments.",
  "For an unreadable character, write [无法识别] instead of guessing.",
  "Return only the transcription.",
].join("\n");

function postJSON(baseUrl, apiKey, payload, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    var cacheModel = String(payload && payload.model || "");
    if (/^gpt-5\.6/i.test(cacheModel)) {
      payload = Object.assign({}, payload, {
        prompt_cache_key: ("socratopia:close-reading-vision:" + cacheModel).toLowerCase().replace(/[^a-z0-9_.:-]/g, "-").slice(0, 64),
        prompt_cache_options: { mode: "implicit", ttl: "30m" },
      });
    }
    var url = new URL(String(baseUrl || "").replace(/\/$/, "") + "/chat/completions");
    var transport = url.protocol === "https:" ? https : http;
    var body = JSON.stringify(payload);
    var headers = Object.assign({
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (apiKey || ""),
      "Content-Length": Buffer.byteLength(body),
      "Connection": "close",
    }, options.headers || {});
    var req = transport.request(url, { method: "POST", headers: headers, agent: false }, function (res) {
      var chunks = [];
      res.on("data", function (chunk) { chunks.push(chunk); });
      res.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf-8");
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error("HTTP " + res.statusCode + ": " + text.slice(0, 300)));
        try {
          var parsed = JSON.parse(text);
          if (parsed.usage) {
            var details = parsed.usage.prompt_tokens_details || {};
            console.log("[direct-llm-cache]", { model: cacheModel, purpose: "close-reading-vision", promptTokens: parsed.usage.prompt_tokens, cachedTokens: details.cached_tokens || 0, cacheWriteTokens: details.cache_write_tokens || 0 });
          }
          var message = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
          if (!message) return reject(new Error("Model response has no choices[0].message"));
          resolve({ text: Normalizer.cleanText(message.content || message.reasoning_content || ""), usage: parsed.usage || null });
        } catch (error) { reject(new Error("Invalid model JSON: " + error.message)); }
      });
    });
    var timeout = setTimeout(function () { req.destroy(new Error("timeout")); }, options.timeoutMs || 120000);
    req.on("close", function () { clearTimeout(timeout); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
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
