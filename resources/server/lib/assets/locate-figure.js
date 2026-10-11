// locate-figure.js — where on the page is that figure, really?
//
// A `book://p<page>` crop with no rect used to become the whole page: readable enough to see
// *something*, useless for reading a dense textbook page (measured: p168 crop = 405 KB and the
// figure was ~1/6 of it).  The PDF is a pure scan (no text layer, 0 text items on p168), so the
// position has to come from pixels: render the page and ask the vision model for a tight box.
//
// Called from lib/assets/intents.js only when the order has no usable rect.  Never throws.
"use strict";

var MAX_WIDTH = 900;
var CACHE_LIMIT = 24;
var cache = new Map();

function locatePrompt(page, hint) {
  return [
    "This is page " + page + " of a scanned textbook, rendered as one image.",
    hint
      ? "Find the figure or table whose caption mentions: " + hint
      : "Find the largest figure/table drawing on the page.",
    "Reply with ONLY compact JSON, no prose and no code fence, using the REAL coordinates",
    "(do not echo the example below):",
    '{"x0":0.08,"y0":0.22,"x1":0.92,"y1":0.55}',
    "Coordinates are normalized 0..1, origin top-left, and must be the TIGHT box around that",
    "figure's drawing INCLUDING its caption line, excluding unrelated body text and the page header.",
    'If there is no figure at all, reply {"none":true}.',
  ].join("\n");
}

// "…{a}" or a fenced block → the first balanced JSON object.
function extractJson(text) {
  var s = String(text || "");
  var fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fenced) s = fenced[1];
  var start = s.indexOf("{");
  if (start < 0) return null;
  var depth = 0;
  for (var i = start; i < s.length; i += 1) {
    var ch = s[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

// Loose JSON: bare keys, single quotes, trailing commas.
function coerceJson(raw) {
  var text = String(raw || "").trim().replace(/,\s*([}\]])/g, "$1");
  if (text.indexOf('"') < 0) text = text.replace(/([A-Za-z_]\w*)\s*:/g, '"$1":');
  text = text.replace(/'/g, '"');
  try { return JSON.parse(text); } catch (_) { return null; }
}

// Last resort: pull the four numbers out of prose ("x0=0.1 y0=0.2 ...", "[0.1,0.2,0.9,0.8]").
function numbersRect(text) {
  var raw = String(text || "");
  var labelled = {};
  ["x0", "y0", "x1", "y1"].forEach(function (k) {
    var m = new RegExp(k + '"?\\s*[:=]\\s*(-?\\d*\\.?\\d+)', "i").exec(raw);
    if (m) labelled[k] = Number(m[1]);
  });
  if (Object.keys(labelled).length === 4) return sanitizeRect([labelled.x0, labelled.y0, labelled.x1, labelled.y1]);
  var arr = /\[\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\]/.exec(raw);
  if (arr) return sanitizeRect([Number(arr[1]), Number(arr[2]), Number(arr[3]), Number(arr[4])]);
  var nums = (raw.match(/-?\d*\.?\d+/g) || []).map(Number).filter(function (v) { return v >= 0 && v <= 1; });
  if (nums.length === 4) return sanitizeRect(nums);
  return null;
}

// Every JSON object in the reply, in order (models like to restate the shape first).
function objectsIn(text) {
  var s = String(text || "");
  var fenced = /\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i.exec(s);
  if (fenced) s = fenced[1];
  var out = [];
  var depth = 0, start = -1;
  for (var i = 0; i < s.length; i += 1) {
    var ch = s[i];
    if (ch === "{") { if (depth === 0) start = i; depth += 1; }
    else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        var slice = s.slice(start, i + 1);
        var parsed = null;
        try { parsed = JSON.parse(slice); } catch (_) { parsed = coerceJson(slice); }
        if (parsed) out.push(parsed);
        start = -1;
      }
    }
  }
  return out;
}

function parseRect(text) {
  var all = objectsIn(text);
  if (!all.length) return numbersRect(text);
  // Last usable object wins: an echoed example is usually followed by the real answer.
  for (var i = all.length - 1; i >= 0; i -= 1) {
    if (all[i] && all[i].none === true) return null;
    var rect = rectFromObject(all[i]);
    if (rect) return rect;
  }
  return numbersRect(text);
}

function rectFromObject(json) {
  if (!json) return null;
  var keys = ["x0", "y0", "x1", "y1"];
  var out = [];
  for (var i = 0; i < keys.length; i += 1) {
    var v = Number(json[keys[i]]);
    if (!Number.isFinite(v)) return null;
    out.push(v);
  }
  return sanitizeRect(out);
}

// Reject nonsense before it reaches the cropper: inverted, slivers, or "the whole page again".
function sanitizeRect(rect) {
  if (!Array.isArray(rect) || rect.length !== 4) return null;
  var x0 = Math.min(Math.max(Number(rect[0]), 0), 1);
  var y0 = Math.min(Math.max(Number(rect[1]), 0), 1);
  var x1 = Math.min(Math.max(Number(rect[2]), 0), 1);
  var y1 = Math.min(Math.max(Number(rect[3]), 0), 1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  if (x1 - x0 < 0.15 || y1 - y0 < 0.06) return null;
  if (x1 * y1 === 0 && x0 + y0 + x1 + y1 === 0) return null;
  var area = (x1 - x0) * (y1 - y0);
  if (area > 0.92) return null; // nothing gained over the whole page
  var rounded = [x0, y0, x1, y1].map(function (v) { return Math.round(v * 1000) / 1000; });
  return rounded;
}

function isWholePage(rect) {
  if (!Array.isArray(rect) || rect.length !== 4) return true;
  return (rect[2] - rect[0]) * (rect[3] - rect[1]) >= 0.9;
}

function config() {
  var set = global.__SOCRATOPIA_SET__ || {};
  var block = set.ocrVision || {};
  var settings = global.__SOCRATOPIA_SETTINGS__ || {};
  var endpoint = block.baseUrl || block.baseURL || settings.endpoint || "";
  var keys = settings.apiKeys || {};
  var apiKey = block.apiKey || keys[block.keyName || "codex"] || Object.keys(keys).map(function (k) { return keys[k]; })[0] || "";
  var model = block.model || (set.strong && set.strong.model) || (set.weak && set.weak.model) || "";
  return { baseUrl: String(endpoint).replace(/\/$/, ""), apiKey: apiKey, model: model };
}

async function defaultPost(conf, payload, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, Math.max(1000, timeoutMs || 12000));
  try {
    var res = await fetch(conf.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + conf.apiKey, Connection: "close" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("locate_http_" + res.status);
    var json = await res.json();
    var message = (json && json.choices && json.choices[0] && json.choices[0].message) || {};
    // Reasoning models fill reasoning_content first; the JSON we want usually ends up in content.
    return String(message.content || "").trim() || String(message.reasoning_content || "");
  } finally {
    clearTimeout(timer);
  }
}

// deps: { render(pdfPath, page, rect, opts) -> {png}, post(conf, payload, timeoutMs) -> text, config() }
async function locateFigure(deps, input) {
  deps = deps || {};
  input = input || {};
  var page = Number(input.page);
  var pdfPath = input.pdfPath;
  if (!Number.isInteger(page) || page < 1 || !pdfPath) return { rect: null, reason: "bad_request" };
  var hint = String(input.hint || "").replace(/\s+/g, " ").trim().slice(0, 80);
  var key = pdfPath + "|" + page + "|" + hint;
  if (cache.has(key)) return cache.get(key);

  var conf = (deps.config || config)();
  if (!conf.baseUrl || !conf.apiKey || !conf.model) return { rect: null, reason: "vision_not_configured" };

  var reply;
  try {
    var rendered = await (deps.render || defaultRender)(pdfPath, page, null, { maxWidth: MAX_WIDTH });
    if (!rendered || !rendered.png) return { rect: null, reason: "render_failed" };
    reply = await (deps.post || defaultPost)(conf, {
      model: conf.model,
      max_tokens: 700,
      stream: false,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: locatePrompt(page, hint) },
          { type: "image_url", image_url: { url: "data:image/png;base64," + Buffer.from(rendered.png).toString("base64") } },
        ],
      }],
    }, input.timeoutMs || 12000);
  } catch (error) {
    var failed = { rect: null, reason: "locate_failed:" + String((error && error.message) || error).slice(0, 40) };
    return failed;
  }
  var rect = parseRect(reply);
  var out = rect ? { rect: rect, reason: "ok" } : { rect: null, reason: "unusable_reply(" + String(reply || "").length + "):" + String(reply || "").replace(/\s+/g, " ").slice(-90) };
  if (rect) cache.set(key, out);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return out;
}

function defaultRender(pdfPath, page, rect, opts) {
  return require("../pdf-page-render.js").renderPageRegion(pdfPath, page, rect, opts);
}

function resetCache() { cache.clear(); }

module.exports = {
  locateFigure: locateFigure,
  locatePrompt: locatePrompt,
  parseRect: parseRect,
  sanitizeRect: sanitizeRect,
  isWholePage: isWholePage,
  config: config,
  extractJson: extractJson,
  resetCache: resetCache,
};
