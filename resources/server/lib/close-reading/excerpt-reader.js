"use strict";

var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var https = require("https");
var path = require("path");
var normalizer = require("./text-normalizer.js");

var pageCache = new Map();
var CACHE_MAX = 100;
var EXTRACT_VERSION = "close-reading-v1";

function workerPath() {
  var sourcePath = path.join(process.cwd(), "src", "lib", "pdf-worker.mjs");
  var packagedPath = path.join(process.cwd(), "lib", "pdf-worker.mjs");
  if (fs.existsSync(sourcePath)) return sourcePath;
  if (fs.existsSync(packagedPath)) return packagedPath;
  return path.join(__dirname, "..", "pdf-worker.mjs");
}

function runPdfWorker(command, filePath) {
  var args = Array.prototype.slice.call(arguments, 2).map(String);
  return new Promise(function (resolve, reject) {
    var deps = path.join(process.cwd(), "deps");
    var nodePath = fs.existsSync(deps)
      ? [deps, process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
      : process.env.NODE_PATH;
    childProcess.execFile(
      process.execPath,
      [workerPath(), command, filePath].concat(args),
      { maxBuffer: 50 * 1024 * 1024, env: Object.assign({}, process.env, { NODE_PATH: nodePath }) },
      function (error, stdout, stderr) {
        if (!error) return resolve(stdout);
        try {
          var parsed = JSON.parse(stderr || stdout || "{}");
          reject(new Error(parsed.error || error.message));
        } catch (_) {
          reject(new Error(String(stderr || error.message || error)));
        }
      }
    );
  });
}

function cacheKey(filePath, stat, page) {
  return crypto.createHash("sha256").update([
    EXTRACT_VERSION,
    path.resolve(filePath),
    stat.size,
    stat.mtimeMs,
    page,
  ].join("|")).digest("hex");
}

function setCache(key, value) {
  if (pageCache.has(key)) pageCache.delete(key);
  pageCache.set(key, value);
  while (pageCache.size > CACHE_MAX) pageCache.delete(pageCache.keys().next().value);
}

async function extractPages(filePath, startPage, endPage) {
  var stat = await fs.promises.stat(filePath);
  var pages = [];
  var missing = [];
  for (var page = startPage; page <= endPage; page++) {
    var key = cacheKey(filePath, stat, page);
    if (pageCache.has(key)) pages.push(Object.assign({}, pageCache.get(key), { cached: true }));
    else missing.push(page);
  }
  var metadata = null;
  if (missing.length) {
    var first = Math.min.apply(Math, missing);
    var last = Math.max.apply(Math, missing);
    var result = JSON.parse(await runPdfWorker("extract", filePath, first, last));
    metadata = result.metadata || null;
    (result.pages || []).forEach(function (item) {
      var normalized = { page: Number(item.page), text: normalizer.normalizeText(item.text), source: "text-layer", cached: false };
      setCache(cacheKey(filePath, stat, normalized.page), normalized);
    });
    pages = [];
    for (var page2 = startPage; page2 <= endPage; page2++) {
      var hit = pageCache.get(cacheKey(filePath, stat, page2));
      if (hit) pages.push(Object.assign({}, hit, { cached: !missing.includes(page2) }));
    }
  }
  return { pages: pages.sort(function (a, b) { return a.page - b.page; }), metadata: metadata };
}

function normalizedVisionConfig(config, source) {
  config = config || {};
  var baseUrl = config.baseUrl || config.baseURL || "";
  if (!baseUrl || !config.apiKey || !config.model) return null;
  if (/127\.0\.0\.1:9(?:\/|$)/.test(baseUrl)) return null;
  return {
    baseUrl: String(baseUrl).replace(/\/$/, ""),
    apiKey: config.apiKey,
    model: config.model,
    source: source || "vision",
  };
}

function visionConfigs() {
  var set = global.__SOCRATOPIA_SET__ || {};
  var candidates = [];
  var seen = new Set();
  [["vision", set.vision], ["premium", set.premium], ["strong", set.strong]].forEach(function (entry) {
    var config = normalizedVisionConfig(entry[1], entry[0]);
    if (!config) return;
    var key = config.baseUrl + "|" + config.model;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(config);
  });
  return candidates;
}

function visionConfig() {
  return visionConfigs()[0] || null;
}
function postJson(config, payload, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var cacheModel = String(payload && payload.model || "");
    if (/^gpt-5\.6/i.test(cacheModel)) {
      payload = Object.assign({}, payload, {
        prompt_cache_key: ("socratopia:close-reading-excerpt:" + cacheModel).toLowerCase().replace(/[^a-z0-9_.:-]/g, "-").slice(0, 64),
        prompt_cache_options: { mode: "implicit", ttl: "30m" },
      });
    }
    var url = new URL(config.baseUrl + "/chat/completions");
    var transport = url.protocol === "https:" ? https : http;
    var body = JSON.stringify(payload);
    var request = transport.request(url, {
      method: "POST",
      agent: false,
      headers: {
        Authorization: "Bearer " + config.apiKey,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        Connection: "close",
      },
    }, function (response) {
      var chunks = [];
      response.on("data", function (chunk) { chunks.push(chunk); });
      response.on("end", function () {
        var raw = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error("vision HTTP " + response.statusCode + ": " + raw.slice(0, 300)));
          return;
        }
        try {
          var parsed = JSON.parse(raw);
          if (parsed.usage) {
            var details = parsed.usage.prompt_tokens_details || {};
            console.log("[direct-llm-cache]", { model: cacheModel, purpose: "close-reading-excerpt", promptTokens: parsed.usage.prompt_tokens, cachedTokens: details.cached_tokens || 0, cacheWriteTokens: details.cache_write_tokens || 0 });
          }
          resolve(parsed);
        } catch (error) { reject(new Error("vision JSON: " + error.message)); }
      });
    });
    var timer = setTimeout(function () { request.destroy(new Error("vision timeout")); }, timeoutMs || 120000);
    request.on("close", function () { clearTimeout(timer); });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function transcribePage(filePath, pageNumber) {
  var configs = visionConfigs();
  if (!configs.length) return { text: "", attempted: false, error: "vision_not_configured" };
  var image;
  try {
    var rendered = JSON.parse(await runPdfWorker("render", filePath, pageNumber, pageNumber, 2));
    image = rendered.pages && rendered.pages[0];
    if (!image || !image.pngB64) return { text: "", attempted: true, error: "render_empty" };
  } catch (error) {
    return { text: "", attempted: true, error: "render_failed:" + (error && error.message || String(error)) };
  }
  var errors = [];
  for (var i = 0; i < configs.length; i++) {
    var config = configs[i];
    try {
      var response = await postJson(config, {
        model: config.model,
        max_tokens: 6000,
        stream: false,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "精确转录这张 PDF 教材页。保留段落、代码换行、注释、运算符、公式和表格结构；不要翻译，不要总结，不要猜测模糊字符。只输出 UTF-8 纯文本。" },
            { type: "image_url", image_url: { url: "data:image/png;base64," + image.pngB64 } },
          ],
        }],
      }, 120000);
      var message = response.choices && response.choices[0] && response.choices[0].message;
      var content = message && (message.content || message.reasoning_content) || "";
      if (Array.isArray(content)) content = content.map(function (part) { return part && (part.text || part.content) || ""; }).join("\n");
      var text = normalizer.normalizeText(content).trim();
      if (text) return { text: text, attempted: true, error: null, modelSource: config.source };
      errors.push(config.source + ":vision_empty");
    } catch (error) {
      errors.push(config.source + ":" + (error && error.message || String(error)));
    }
  }
  return { text: "", attempted: true, error: errors.join(" | ") || "vision_failed" };
}
function queryMatches(text, normalizedQuery) {
  if (!normalizedQuery) return true;
  var normalizedText = normalizer.normalizeForSearch(text);
  if (normalizedText.includes(normalizedQuery)) return true;
  return normalizedQuery.endsWith("()") && normalizedText.includes(normalizedQuery.slice(0, -1));
}

function trimEvidence(pages, query, maxChars) {
  var total = pages.reduce(function (sum, page) { return sum + page.text.length; }, 0);
  if (total <= maxChars) return { pages: pages, truncated: false };
  var perPage = Math.max(1200, Math.floor(maxChars / Math.max(1, pages.length)));
  var normalizedQuery = normalizer.normalizeForSearch(query);
  return {
    truncated: true,
    pages: pages.map(function (page) {
      if (page.text.length <= perPage) return page;
      var index = normalizedQuery ? normalizer.normalizeForSearch(page.text).indexOf(normalizedQuery) : -1;
      var rawIndex = index >= 0 ? Math.min(index, page.text.length - 1) : 0;
      var start = Math.max(0, rawIndex - Math.floor(perPage / 3));
      var text = page.text.slice(start, start + perPage);
      return Object.assign({}, page, { text: (start ? "…\n" : "") + text + (start + perPage < page.text.length ? "\n…" : "") });
    }),
  };
}

async function readTextbookExcerpt(options) {
  options = options || {};
  var filePath = options.filePath;
  if (!filePath || !fs.existsSync(filePath)) throw new Error("textbook_file_unavailable");
  if (path.extname(filePath).toLowerCase() !== ".pdf") throw new Error("close_reading_pdf_only");
  var startPage = Math.max(1, Number(options.startPage) || 1);
  var maxPages = Math.min(5, Math.max(1, Number(options.maxPages) || 3));
  var metadata = JSON.parse(await runPdfWorker("meta", filePath));
  if (startPage > metadata.numPages) {
    var rangeError = new Error("page_out_of_range");
    rangeError.totalPages = metadata.numPages;
    throw rangeError;
  }
  var endPage = Math.min(metadata.numPages, Math.max(startPage, Number(options.endPage) || startPage + maxPages - 1));
  endPage = Math.min(endPage, startPage + maxPages - 1);
  var extracted = await extractPages(filePath, startPage, endPage);
  var pages = extracted.pages;
  var query = String(options.query || "").trim();
  var normalizedQuery = normalizer.normalizeForSearch(query);
  var visualHint = String(options.visualHint || "");
  var visualVerification = /(?:代码|函数|注释|公式|定理|表格|图示|逐句|逐行|原文|code|function|comment|formula|table)/i.test(visualHint) || /[(){};]/.test(query);
  var verifyAllPages = /(?:完整|全部|跨页|逐句|逐行|complete|entire|full)/i.test(visualHint);
  var textLayerFound = normalizedQuery && pages.some(function (page) {
    return queryMatches(page.text, normalizedQuery);
  });
  var ocrAttempted = false;
  var ocrErrors = [];
  if (options.allowOcr !== false) {
    for (var i = 0; i < pages.length; i++) {
      var page = pages[i];
      var sparse = normalizer.effectiveLength(page.text) < 80 || normalizer.looksGarbled(page.text);
      var missedTarget = !!(normalizedQuery && !textLayerFound && page.page === startPage);
      var verifyVisual = visualVerification && (page.page === startPage || verifyAllPages);
      if (!sparse && !missedTarget && !verifyVisual) continue;
      var ocr = await transcribePage(filePath, page.page);
      ocrAttempted = ocrAttempted || ocr.attempted;
      if (ocr.error) ocrErrors.push("p." + page.page + ":" + ocr.error);
      var ocrFound = normalizedQuery && queryMatches(ocr.text, normalizedQuery);
      if (ocr.text && (sparse || ocrFound || verifyVisual)) pages[i] = Object.assign({}, page, { text: ocr.text, source: "ocr", cached: false });
    }
  }
  var queryFound = !normalizedQuery || pages.some(function (page) {
    return queryMatches(page.text, normalizedQuery);
  });
  var trimmed = trimEvidence(pages, query, Math.min(32000, Math.max(4000, Number(options.maxChars) || 24000)));
  pages = trimmed.pages;
  var sources = Array.from(new Set(pages.map(function (page) { return page.source; })));
  var source = sources.length > 1 ? "mixed" : (sources[0] || "text-layer");
  var evidence = '<PDF_EVIDENCE source="' + source + '" startPage="' + startPage + '" endPage="' + endPage + '">\n' +
    pages.map(function (page) {
      var suffix = page.source === "ocr" ? "（视觉转录）" : "（文字层）";
      return "--- PDF 第 " + page.page + " 页" + suffix + " ---\n" + page.text;
    }).join("\n\n") +
    "\n</PDF_EVIDENCE>";
  return {
    evidence: evidence,
    metadata: {
      source: source,
      startPage: startPage,
      endPage: endPage,
      totalPages: metadata.numPages,
      query: query,
      queryFound: !!queryFound,
      textLayerFound: !!textLayerFound,
      truncated: trimmed.truncated,
      cached: pages.length > 0 && pages.every(function (page) { return page.cached; }),
      ocrAttempted: ocrAttempted,
      ocrErrors: ocrErrors,
      encoding: "UTF-8/NFC",
    },
  };
}

module.exports = {
  readTextbookExcerpt: readTextbookExcerpt,
  runPdfWorker: runPdfWorker,
  visionConfig: visionConfig,
  visionConfigs: visionConfigs,
  queryMatches: queryMatches,
  _pageCache: pageCache,
};
