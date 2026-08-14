"use strict";

var COMMAND_RE = /^\s*\/(?:close[_-]?reading|closereading|精读)(?=\s|$)/i;
var PAGE_PATTERNS = [
  /第\s*(\d{1,6})\s*页/i,
  /(?:^|\s)(\d{1,6})\s*页/i,
  /\bp(?:age)?\.?\s*[=:]?\s*(\d{1,6})\b/i,
];

function textContent(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter(function (part) { return part && part.type === "text"; })
      .map(function (part) { return String(part.text || ""); })
      .join(" ");
  }
  return "";
}

function pageFromText(text) {
  for (var i = 0; i < PAGE_PATTERNS.length; i++) {
    var match = String(text || "").match(PAGE_PATTERNS[i]);
    if (match) return Math.max(1, parseInt(match[1], 10));
  }
  return null;
}

function queryFromText(text) {
  var body = String(text || "").replace(COMMAND_RE, "").trim();
  var quoted = body.match(/[`“”"']([^`“”"']{2,160})[`“”"']/);
  if (quoted) return quoted[1].trim();
  var signature = body.match(/\b(?:void|int|long|double|float|char|bool|string|class|struct|def|function|func)\s+[A-Za-z_$][\w$]*(?:\s*\([^)]*\))?/i);
  if (signature) return signature[0].trim();
  var identifier = body.match(/\b[A-Za-z_$][\w$]*\s*\([^)]*\)/);
  if (identifier) return identifier[0].trim();
  var cleaned = body
    .replace(/第\s*\d{1,6}\s*页/gi, " ")
    .replace(/(?:^|\s)\d{1,6}\s*页/gi, " ")
    .replace(/\bp(?:age)?\.?\s*[=:]?\s*\d{1,6}\b/gi, " ")
    .replace(/(?:帮我|请|现在|一下|完整|逐句|逐行|解释|翻译|转录|原文|英文|中文|注释|代码|函数|公式|表格)/g, " ")
    .replace(/[，。！？,:;；]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 160) : "";
}

function isCommand(text) {
  return COMMAND_RE.test(String(text || ""));
}

function parseCommand(text, options) {
  options = options || {};
  var current = String(text || "");
  if (!isCommand(current)) return null;
  var page = pageFromText(current);
  var query = queryFromText(current);
  var recent = Array.isArray(options.messages) ? options.messages : [];
  for (var i = recent.length - 2, seen = 0; i >= 0 && seen < 4 && (!page || !query); i--) {
    if (recent[i] && recent[i].role !== "user") continue;
    seen++;
    var previous = textContent(recent[i]);
    if (!page) page = pageFromText(previous);
    if (!query) query = queryFromText("/Close_Reading " + previous);
  }
  if (!page) page = Number(options.currentPage) || Number(options.windowStartPage) || null;
  var complete = /(完整|全部|跨页|逐句|逐行|complete|entire|full)/i.test(current);
  return {
    command: "Close_Reading",
    raw: current,
    request: current.replace(COMMAND_RE, "").trim(),
    startPage: page,
    query: query,
    maxPages: complete ? 3 : 3,
    allowOcr: true,
  };
}

module.exports = {
  COMMAND_RE: COMMAND_RE,
  isCommand: isCommand,
  parseCommand: parseCommand,
  pageFromText: pageFromText,
  queryFromText: queryFromText,
};
