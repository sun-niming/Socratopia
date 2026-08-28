"use strict";

var fs = require("fs");
var crypto = require("crypto");
var path = require("path");
var normalizer = require("./text-normalizer.js");
var responsesCompat = require("../responses-api-compat.js");

function scopeFrom(options) {
  var scope = {
    accountId: options && options.accountId,
    profileId: options && options.profileId,
    worldId: options && options.worldId,
    textbookId: options && options.textbookId,
    sessionEpoch: options && options.sessionEpoch,
  };
  if (!scope.accountId || !scope.profileId || !scope.worldId || !scope.textbookId || !Number.isSafeInteger(scope.sessionEpoch)) throw new Error("ocr_scope_invalid");
  return scope;
}

async function runCoordinator(command, filePath, options, extra) {
  var coordinator = global.__PDF_OCR_COORDINATOR__;
  if (!coordinator || typeof coordinator.run !== "function") throw new Error("ocr_coordinator_unavailable");
  return coordinator.run(Object.assign({
    command: command,
    filePath: filePath,
    scope: scopeFrom(options),
    expectedLanguage: options.expectedLanguage || "zh-Hans-CN",
    signal: options.signal,
    deadlineAt: options.deadlineAt,
  }, extra || {}));
}

function normalizedVisionConfig(config, source) {
  config = config || {};
  if (config.enabled !== true || config.userConsent !== true) return null;
  var baseUrl = config.baseUrl || config.baseURL || "";
  if (!baseUrl || !config.apiKey || !config.model) return null;
  if (/127\.0\.0\.1:9(?:\/|$)/.test(baseUrl)) return null;
  return { baseUrl: String(baseUrl).replace(/\/$/, ""), apiKey: config.apiKey, model: config.model, source: source || "vision" };
}

function assertVisionRequestActive(options) {
  if (options && options.signal && options.signal.aborted) {
    var aborted = new Error("vision_request_cancelled");
    aborted.code = "vision_request_cancelled";
    throw aborted;
  }
  if (options && Number.isFinite(Number(options.deadlineAt)) && Number(options.deadlineAt) <= Date.now()) {
    var deadline = new Error("vision_request_deadline");
    deadline.code = "vision_request_deadline";
    throw deadline;
  }
}

function isVisionFenceError(error) {
  return /^(?:vision_(?:request_(?:cancelled|deadline)|account_changed|scope_cancelled)|ocr_(?:request_(?:aborted|deadline)|delivery_scope_stale|scope_(?:stale|invalid|tombstoned)|account_state_unavailable)|request_(?:aborted|deadline|stale))$/.test(String(error && error.code || ""));
}

function visionConfigs() {
  var set = global.__SOCRATOPIA_SET__ || {};
  var config = normalizedVisionConfig(set.ocrVision, "ocrVision");
  return config ? [config] : [];
}

function visionConfig() {
  return visionConfigs()[0] || null;
}

async function postJson(config, payload, timeoutMs, signal, budgetMeta) {
  budgetMeta = budgetMeta || { operationId: crypto.randomBytes(16).toString("hex"), page: 1 };
  var cacheModel = String(payload && payload.model || "");
  if (/^gpt-5\.6/i.test(cacheModel)) {
    payload = Object.assign({}, payload, {
      prompt_cache_key: ("socratopia:close-reading-excerpt:" + cacheModel).toLowerCase().replace(/[^a-z0-9_.:-]/g, "-").slice(0, 64),
      prompt_cache_retention: "24h",
    });
  }
  var budget = global.__OCR_VISION_BUDGET__;
  if (!budget || typeof budget.run !== "function") {
    var unavailable = new Error("vision_budget_unavailable");
    unavailable.code = "vision_budget_unavailable";
    throw unavailable;
  }
  var rawPayload = JSON.stringify(payload);
  var parsed = await budget.run({
    purpose: "close-reading",
    imageCount: 1,
    inputBytes: Buffer.byteLength(rawPayload, "utf8"),
    maxOutputTokens: Math.max(1, Number(payload.max_tokens) || 6000),
    operationId: budgetMeta.operationId,
    page: budgetMeta.page,
    expectedAccountId: budgetMeta.accountId,
    expectedSessionEpoch: budgetMeta.sessionEpoch,
    scope: { profileId: budgetMeta.profileId, worldId: budgetMeta.worldId, textbookId: budgetMeta.textbookId },
    deadlineAt: Math.min(Number.isFinite(Number(budgetMeta.deadlineAt)) ? Number(budgetMeta.deadlineAt) : Infinity, Date.now() + Math.min(120000, Math.max(1, Number(timeoutMs) || 120000))),
    signal: signal,
    execute: function (signal) {
      return responsesCompat.postChatCompletionsJson(new URL(config.baseUrl + "/chat/completions"), payload, {
        headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json; charset=utf-8", Connection: "close" },
        timeoutMs: timeoutMs || 120000,
        timeoutMessage: "vision timeout",
        signal: signal,
      });
    },
  });
  if (parsed.usage) {
    var details = parsed.usage.prompt_tokens_details || {};
    console.log("[direct-llm-cache]", { model: cacheModel, purpose: "close-reading-excerpt", promptTokens: parsed.usage.prompt_tokens, cachedTokens: details.cached_tokens || 0, cacheWriteTokens: details.cache_write_tokens || 0 });
  }
  return parsed;
}

function visionErrorCode(error) {
  var code = String(error && error.code || "");
  if (/^vision_[a-z_]+$/.test(code)) return code;
  var status = Number(error && (error.statusCode || error.status));
  if (status === 401 || status === 403) return "vision_auth_failed";
  if (status === 429) return "vision_rate_limited";
  if (status >= 500 && status <= 599) return "vision_provider_unavailable";
  if (status >= 400 && status <= 499) return "vision_request_rejected";
  if (/^(?:ABORT_ERR|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)$/i.test(code)) return "vision_network_failed";
  if (/timeout/i.test(String(error && error.message || ""))) return "vision_timeout";
  return "vision_failed";
}

var visionInFlight = new Map();

async function transcribePageUnshared(filePath, pageNumber, options) {
  if (!options || options.allowRemoteVision !== true) return { text: "", attempted: false, error: "vision_not_authorized" };
  assertVisionRequestActive(options);
  var config = visionConfig();
  if (!config) return { text: "", attempted: false, error: "vision_not_configured" };
  var coordinator = global.__PDF_OCR_COORDINATOR__;
  if (coordinator && typeof coordinator.readVisionCache === "function") {
    try {
      var hit = await coordinator.readVisionCache({ filePath: filePath, scope: scopeFrom(options), page: pageNumber, model: config.model, signal: options.signal, deadlineAt: options.deadlineAt });
      assertVisionRequestActive(options);
      if (hit && hit.hit && hit.text) return { text: hit.text, attempted: false, cached: true, error: null, modelSource: config.source };
    } catch (cacheReadError) { if (isVisionFenceError(cacheReadError)) throw cacheReadError; }
  }
  var rendered;
  try {
    rendered = await runCoordinator("render", filePath, options, { startPage: pageNumber, endPage: pageNumber, scale: 2 });
    assertVisionRequestActive(options);
  } catch (error) {
    if (isVisionFenceError(error)) throw error;
    return { text: "", attempted: true, error: "render_failed" };
  }
  var image = rendered.pages && rendered.pages[0];
  if (!image || !image.pngB64) return { text: "", attempted: true, error: "render_empty" };
  try {
    var response = await postJson(config, {
      model: config.model,
      max_tokens: 6000,
      stream: false,
      messages: [{ role: "user", content: [
        { type: "text", text: "精确转录这张 PDF 教材页。保留段落、代码换行、注释、运算符、公式和表格结构；不要翻译，不要总结，不要猜测模糊字符。只输出 UTF-8 纯文本。" },
        { type: "image_url", image_url: { url: "data:image/png;base64," + image.pngB64 } },
      ] }],
    }, 120000, options.signal, { operationId: options.operationId || crypto.randomBytes(16).toString("hex"), page: pageNumber, accountId: options.accountId, sessionEpoch: options.sessionEpoch, profileId: options.profileId, worldId: options.worldId, textbookId: options.textbookId, deadlineAt: options.deadlineAt });
    assertVisionRequestActive(options);
    var message = response.choices && response.choices[0] && response.choices[0].message;
    var content = message && (message.content || message.reasoning_content) || "";
    if (Array.isArray(content)) content = content.map(function (part) { return part && (part.text || part.content) || ""; }).join("\n");
    var text = normalizer.normalizeText(content).trim();
    if (!text || normalizer.looksGarbled(text)) return { text: "", attempted: true, error: "vision_empty" };
    if (coordinator && typeof coordinator.writeVisionCache === "function") {
      try {
        await coordinator.writeVisionCache({ filePath: filePath, scope: scopeFrom(options), page: pageNumber, model: config.model, text: text, expectedPdfHash: rendered.pdfHash, imageHash: image.imageHash, signal: options.signal, deadlineAt: options.deadlineAt });
        assertVisionRequestActive(options);
      } catch (cacheError) {
        if (isVisionFenceError(cacheError)) throw cacheError;
        return { text: "", attempted: true, cached: false, error: visionErrorCode(cacheError) };
      }
    }
    assertVisionRequestActive(options);
    return { text: text, attempted: true, cached: false, error: null, modelSource: config.source };
  } catch (error) {
    if (isVisionFenceError(error)) throw error;
    return { text: "", attempted: true, error: visionErrorCode(error) };
  }
}

function transcribePage(filePath, pageNumber, options) {
  assertVisionRequestActive(options);
  var config = visionConfig();
  var scope = scopeFrom(options);
  var key = crypto.createHash("sha256").update([
    path.resolve(filePath), scope.accountId, scope.profileId, scope.worldId, scope.textbookId,
    scope.sessionEpoch, Number(pageNumber), config && config.baseUrl || "", config && config.model || ""
  ].join("\u001f")).digest("hex");
  var shareable = !options.signal && !Number.isFinite(Number(options.deadlineAt));
  if (shareable && visionInFlight.has(key)) return visionInFlight.get(key);
  var promise = Promise.resolve().then(function () {
    return transcribePageUnshared(filePath, pageNumber, options);
  });
  if (shareable) {
    visionInFlight.set(key, promise);
    promise.finally(function () { if (visionInFlight.get(key) === promise) visionInFlight.delete(key); }).catch(function () {});
  }
  return promise;
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

function pageSource(value) {
  return ["text-layer", "windows-ocr", "rapidocr-v5", "vision-transcription", "unresolved"].includes(value) ? value : "unresolved";
}

async function readTextbookExcerpt(options) {
  options = Object.assign({}, options || {}, { operationId: crypto.randomBytes(16).toString("hex") });
  var filePath = options.filePath;
  if (!filePath || !fs.existsSync(filePath)) throw new Error("textbook_file_unavailable");
  if (path.extname(filePath).toLowerCase() !== ".pdf") throw new Error("close_reading_pdf_only");
  var startPage = Math.max(1, Number(options.startPage) || 1);
  var maxPages = Math.min(5, Math.max(1, Number(options.maxPages) || 3));
  var metadata = await runCoordinator("meta", filePath, options);
  if (startPage > metadata.numPages) {
    var rangeError = new Error("page_out_of_range");
    rangeError.totalPages = metadata.numPages;
    throw rangeError;
  }
  var endPage = Math.min(metadata.numPages, Math.max(startPage, Number(options.endPage) || startPage + maxPages - 1));
  endPage = Math.min(endPage, startPage + maxPages - 1);
  var extracted = await runCoordinator("extract", filePath, options, { startPage: startPage, endPage: endPage });
  var byPage = new Map((extracted.pageResults || extracted.pages || []).map(function (item) { return [Number(item.page), item]; }));
  var pages = [];
  for (var pageNumber = startPage; pageNumber <= endPage; pageNumber++) {
    var item = byPage.get(pageNumber) || { page: pageNumber, text: "", source: "unresolved", error: "page_missing" };
    pages.push({
      page: pageNumber,
      text: normalizer.normalizeText(item.text).trim(),
      source: pageSource(item.source),
      cached: !!item.cached,
      error: item.error || null,
    });
  }
  var query = String(options.query || "").trim();
  var normalizedQuery = normalizer.normalizeForSearch(query);
  var textLayerFoundPages = normalizedQuery ? pages.filter(function (page) {
    return page.source === "text-layer" && queryMatches(page.text, normalizedQuery);
  }).map(function (page) { return page.page; }) : [];
  var visualAttempted = false;
  var visualErrors = [];
  var pageTranscriber = typeof options.transcribePage === "function" ? options.transcribePage : transcribePage;
  if (options.allowRemoteVision === true && visionConfig()) {
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].source !== "unresolved") continue;
      var visual = await pageTranscriber(filePath, pages[i].page, options);
      assertVisionRequestActive(options);
      visualAttempted = visualAttempted || !!visual.attempted;
      if (visual.error) visualErrors.push("p." + pages[i].page + ":" + visual.error);
      var visualText = normalizer.normalizeText(visual.text).trim();
      if (visualText && !normalizer.looksGarbled(visualText)) {
        pages[i] = Object.assign({}, pages[i], { text: visualText, source: "vision-transcription", cached: !!visual.cached, error: null });
      }
    }
  }
  var queryFoundPages = !normalizedQuery ? pages.filter(function (page) { return !!page.text; }).map(function (page) { return page.page; }) : pages.filter(function (page) {
    return queryMatches(page.text, normalizedQuery);
  }).map(function (page) { return page.page; });
  var failedPages = pages.filter(function (page) { return page.source === "unresolved" || !page.text; }).map(function (page) {
    return { page: page.page, reason: page.error || "unresolved" };
  });
  var successfulPages = pages.filter(function (page) { return page.source !== "unresolved" && !!page.text; }).map(function (page) { return page.page; });
  var sourcesByPage = {};
  pages.forEach(function (page) { sourcesByPage[String(page.page)] = page.source; });
  var trimmed = trimEvidence(pages, query, Math.min(32000, Math.max(4000, Number(options.maxChars) || 24000)));
  pages = trimmed.pages;
  var sources = Array.from(new Set(pages.map(function (page) { return page.source; })));
  var source = sources.length > 1 ? "mixed" : (sources[0] || "unresolved");
  var suffixes = { "text-layer": "文字层", "windows-ocr": "Windows OCR", "rapidocr-v5": "离线 PP-OCRv5", "vision-transcription": "视觉转录", unresolved: "未解析" };
  var evidence = '<PDF_EVIDENCE source="' + source + '" startPage="' + startPage + '" endPage="' + endPage + '">\n' + pages.map(function (page) {
    return "--- PDF 第 " + page.page + " 页（" + suffixes[page.source] + "） ---\n" + page.text;
  }).join("\n\n") + "\n</PDF_EVIDENCE>";
  assertVisionRequestActive(options);
  return {
    evidence: evidence,
    metadata: {
      source: source,
      startPage: startPage,
      endPage: endPage,
      totalPages: metadata.numPages,
      requestedPages: Array.from({ length: endPage - startPage + 1 }, function (_, index) { return startPage + index; }),
      successfulPages: successfulPages,
      failedPages: failedPages,
      status: failedPages.length ? "processed_with_failures" : "transcription_complete",
      processingComplete: true,
      transcriptionComplete: failedPages.length === 0,
      sourcesByPage: sourcesByPage,
      query: query,
      queryFound: !normalizedQuery || queryFoundPages.length > 0,
      queryFoundPages: queryFoundPages,
      textLayerFound: textLayerFoundPages.length > 0,
      textLayerFoundPages: textLayerFoundPages,
      truncated: trimmed.truncated,
      cached: successfulPages.length > 0 && pages.filter(function (page) { return page.source !== "unresolved"; }).every(function (page) { return page.cached; }),
      ocrAttempted: visualAttempted || pages.some(function (page) { return page.source === "windows-ocr" || page.source === "rapidocr-v5"; }),
      visualAttempted: visualAttempted,
      ocrErrors: visualErrors.concat(failedPages.map(function (page) { return "p." + page.page + ":" + page.reason; })),
      encoding: "UTF-8/NFC",
    },
  };
}

module.exports = {
  readTextbookExcerpt: readTextbookExcerpt,
  runPdfCoordinator: runCoordinator,
  visionConfig: visionConfig,
  visionConfigs: visionConfigs,
  queryMatches: queryMatches,
  _postJson: postJson,
  _transcribePage: transcribePage,
  _visionErrorCode: visionErrorCode,
};
