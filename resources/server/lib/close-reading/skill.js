"use strict";

var parser = require("./command-parser.js");
var reader = require("./excerpt-reader.js");
var memory = require("./memory-candidate.js");
var AsyncLocalStorage = require("async_hooks").AsyncLocalStorage;
var memoryRequestContext = new AsyncLocalStorage();
var resultsByConversation = new Map();

function memoryKey(paths) {
  return [paths && paths.worldDir || "", paths && paths.conversationId || ""].join("|");
}

function prepareMemoryRequest(body, paths) {
  var messages = body && Array.isArray(body.messages) ? body.messages : [];
  var last = messages[messages.length - 1];
  var commandText = last && last.role === "user" ? String(last.content || "") : "";
  if (!paths || !parser.isCommand(commandText) || !/(?:记住|保存|笔记|remember|note)/i.test(commandText)) return false;
  return { commandText: commandText, key: memoryKey(paths) };
}

function runWithMemoryRequest(pending, callback) {
  if (!pending) return callback();
  return memoryRequestContext.run(pending, callback);
}

function rememberResponse(paths, answer) {
  var key = memoryKey(paths);
  var seed = resultsByConversation.get(key);
  resultsByConversation.delete(key);
  if (!seed || !String(answer || "").trim()) return null;
  var candidate = memory.buildCandidate(seed.result, answer, seed.parsed);
  memory.saveLatest(paths, candidate);
  return memory.rememberLatest(paths, candidate);
}

function augmentEndClassRequest(request, body, paths) {
  var augmented = memory.augmentEndClassBody(body, paths);
  if (!augmented) return request;
  var headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return new Request(request.url, {
    method: request.method,
    headers: headers,
    body: JSON.stringify(augmented),
  });
}

function failurePrompt(error, parsed) {
  var detail = error && error.message || String(error || "unknown_error");
  if (detail === "page_out_of_range") detail += " (totalPages=" + (error.totalPages || "unknown") + ")";
  return [
    "## /Close_Reading Skill（本轮临时规则）",
    "精读工具未能取得可靠原文。请简短说明失败原因，不得猜写教材内容，也不要宣称整本教材不存在目标。",
    "请求页码：" + (parsed.startPage || "未能确定"),
    "失败代码：" + detail,
  ].join("\n");
}

async function execute(options) {
  options = options || {};
  var parsed = parser.parseCommand(options.commandText, {
    messages: options.messages,
    currentPage: options.currentPage,
    windowStartPage: options.windowStartPage,
  });
  if (!parsed) return { active: false };
  if (!parsed.startPage) {
    return {
      active: true,
      ok: false,
      parsed: parsed,
      prompt: failurePrompt(new Error("page_required"), parsed),
      metadata: { error: "page_required" },
    };
  }
  var pending = memoryRequestContext.getStore();
  if (pending && pending.commandText !== String(options.commandText || "")) pending = null;
  try {
    var result = await reader.readTextbookExcerpt({
      filePath: options.filePath,
      startPage: parsed.startPage,
      query: parsed.query,
      visualHint: parsed.request,
      maxPages: parsed.maxPages,
      allowOcr: parsed.allowOcr,
      maxChars: 24000,
    });
    var meta = result.metadata;
    var prompt = [
      "## /Close_Reading Skill（仅本轮生效）",
      "你正在执行 PDF 精读辅助任务。下面的 PDF_EVIDENCE 是本轮唯一可当作教材原文的证据；知识卡片只是摘要。",
      "严格要求：",
      "- 直接完成用户在 /Close_Reading 后提出的解释、翻译或逐行分析，不要讨论指令本身。",
      "- 引用、翻译和代码解释必须以证据为准，并标注 PDF 实际页码。",
      "- 不调用 read_textbook_pages，不改变课堂进度，不把精读页视为已学习页。",
      "- queryFound=false 时，只能说在已检查的页码范围内未找到；不得扩张为整本教材不存在。",
      "- source=text-layer 时，说明证据来自 PDF 内嵌文字层/可复制文本，不是本轮视觉 OCR；若代码、公式或页码明显错位，表述为 PDF 文字层可能有误，并建议对照页面图像核验。",
      "- source=ocr 时，说明证据来自本轮视觉转录，提示符号、大小写、下划线和代码换行可能有误，不得静默修正不确定代码字符。",
      "- source=mixed 时，分别说明文字层页和视觉转录页；不要把所有问题笼统说成 OCR 转录问题。",
      "- ocrErrors 非空时，明确说明视觉转录未配置或执行失败，不能把文字层未命中表述为页面视觉层也不存在。",
      "- 原文证据与常识性补充要明确区分；证据不完整时不得续写或猜测。",
      "元数据：" + JSON.stringify(meta),
      result.evidence,
    ].join("\n");
    if (pending) resultsByConversation.set(pending.key, { result: result, parsed: parsed });
    return { active: true, ok: true, parsed: parsed, prompt: prompt, metadata: meta };
  } catch (error) {
    return {
      active: true,
      ok: false,
      parsed: parsed,
      prompt: failurePrompt(error, parsed),
      metadata: { error: error && error.message || String(error), totalPages: error && error.totalPages },
    };
  }
}

module.exports = {
  isCommand: parser.isCommand,
  parseCommand: parser.parseCommand,
  execute: execute,
  readTextbookExcerpt: reader.readTextbookExcerpt,
  prepareMemoryRequest: prepareMemoryRequest,
  runWithMemoryRequest: runWithMemoryRequest,
  rememberResponse: rememberResponse,
  augmentEndClassRequest: augmentEndClassRequest,
};
