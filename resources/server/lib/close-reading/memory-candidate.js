"use strict";

var fs = require("fs");
var path = require("path");
var Normalizer = require("./text-normalizer.js");
var latestByConversation = new Map();

function safeRead(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, "")); } catch (_) { return fallback; }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function conversationDir(paths) {
  return path.join(paths.worldDir, "conversations", paths.conversationId);
}

function candidatesPath(paths) { return path.join(conversationDir(paths), "close_reading_candidates.json"); }
function latestKey(paths) {
  return [paths && paths.worldDir || "", paths && paths.conversationId || ""].join("|");
}

function shortExcerpt(result) {
  var text = (result.pages || []).map(function (page) { return "PDF 第 " + page.page + " 页：" + page.text; }).join("\n");
  return Normalizer.cleanText(text).slice(0, 1200);
}

function buildCandidate(result, answer, command) {
  return {
    createdAt: new Date().toISOString(),
    conclusion: Normalizer.cleanText(answer).slice(0, 2400),
    excerpt: shortExcerpt(result),
    startPage: result.startPage,
    endPage: result.endPage,
    source: result.source,
    query: command.query || null,
    visionCaution: result.source === "vision-transcription",
  };
}

function saveLatest(paths, candidate) {
  latestByConversation.set(latestKey(paths), candidate);
  if (latestByConversation.size > 200) latestByConversation.delete(latestByConversation.keys().next().value);
  return candidate;
}

function rememberLatest(paths, candidate) {
  candidate = candidate || latestByConversation.get(latestKey(paths)) || null;
  if (!candidate) return null;
  var list = safeRead(candidatesPath(paths), []);
  if (!Array.isArray(list)) list = [];
  var key = [candidate.startPage, candidate.endPage, candidate.query, candidate.conclusion].join("|");
  if (!list.some(function (item) { return [item.startPage, item.endPage, item.query, item.conclusion].join("|") === key; })) list.push(candidate);
  atomicJson(candidatesPath(paths), list.slice(-20));
  return candidate;
}

function hasLatest(paths) {
  return latestByConversation.has(latestKey(paths));
}

function loadCandidates(paths) {
  var value = safeRead(candidatesPath(paths), []);
  return Array.isArray(value) ? value : [];
}

function augmentEndClassBody(body, paths) {
  var candidates = loadCandidates(paths);
  if (!candidates.length) return null;
  var note = [
    "[系统提供的课后笔记候选：这些内容来自学习者明确要求记住的 PDF 精读。请把结论、短摘、PDF 页码和来源类型纳入本次 DIARY_ENTRY 或其他既有课后记忆；不要据此改变 PROGRESS_MD 的页码或已学范围。]",
    JSON.stringify(candidates),
  ].join("\n");
  var next = Object.assign({}, body, { messages: (body.messages || []).slice() });
  next.messages.splice(Math.max(0, next.messages.length - 1), 0, { role: "user", content: note });
  return next;
}

module.exports = {
  candidatesPath: candidatesPath,
  buildCandidate: buildCandidate,
  saveLatest: saveLatest,
  hasLatest: hasLatest,
  rememberLatest: rememberLatest,
  loadCandidates: loadCandidates,
  augmentEndClassBody: augmentEndClassBody,
};
