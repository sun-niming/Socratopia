"use strict";

// 章末习题训练阶段的提示上下文压缩（2026-09-13）。
//
// 背景：进入习题训练后，每轮仍然发送整段教材窗口（真实会话实测 12,160 字），
// 而题目本身常常落在窗口中间被裁掉的位置——模型看不到题干，只能凭印象，
// 这正是"跑题"的第二个成因。
//
// 本模块把习题模式的教材块换成两段确定性的内容：
//   1. 当前题的完整题干（从已读取的原书窗口里按题号定位，容忍 OCR 噪声）；
//   2. 该题的教材依据（从本地知识库卡片里按词面匹配挑出，含定义/要点/易错/参考问答）；
// 并明确告知：全文没有随本轮发送，需要时调用 read_textbook_pages 读取对应页。
//
// 不做模型调用、不做摘要、不改文件。找不到题干或知识库不可用时返回 ok:false，
// 调用方保持原来的整段窗口，绝不因为压缩而让学生看到更差的内容。

var fs = require("fs");
var path = require("path");

var DEFAULT_LIMIT = 5200;
var DEFAULT_EXCERPT_BUDGET = 2800;
var MAX_STEM_CHARS = 1200;
var MAX_SELECTION_ITEMS = 12;
var MAX_CARDS = 2;
var MAX_CARD_CHARS = 800;
var MAX_DEFINITION = 300;
var MAX_KEY_POINT = 140;
var MAX_MISCONCEPTION = 180;
var MAX_QA = 220;

// OCR 常见混淆：l/I/| 与 1、O/Q/D 与 0、S 与 5、B 与 8、Z 与 2、G 与 6、T 与 7、A 与 4。
var OCR_CONFUSION = {
  l: "1", L: "1", I: "1", i: "1", "|": "1", "!": "1",
  O: "0", o: "0", Q: "0", D: "0",
  S: "5", s: "5", B: "8", Z: "2", z: "2", G: "6", T: "7", A: "4",
};

var MARKER_RE = /(?:^|\n)[ \t]{0,6}([A-Z][A-Za-z]{0,2}[0-9lLiIoOQDSBZGTA]{0,3})[ \t]{0,2}[.．、]/g;
var EXERCISE_ID_RE = /^([RPEQC])(\d{1,3})$/;
var PAGE_MARKER_RE = /---\s*(?:第\s*(\d+)\s*[页頁]|Page\s*(\d+))\s*---/g;
var SECTION_HEADING_RE = /^\s*(?:课后习题和问题|课后习题|章末习题|复习题|练习题|习题|问题|Exercises|Problems)\s*$/;

// 这些词几乎出现在每张网络课卡片里，不能作为"这张卡片就是本题依据"的信号。
var GENERIC_LATIN_TOKENS = (function () {
  var out = Object.create(null);
  ["tcp", "udp", "ip", "http", "web", "url", "html", "www", "com", "dns", "rtt", "ftp", "smtp", "pop3", "p2p", "cdn"].forEach(function (token) { out[token] = 1; });
  return out;
})();

var LATIN_STOP = {
  the: 1, and: 1, for: 1, with: 1, that: 1, this: 1, from: 1, are: 1, was: 1,
  not: 1, you: 1, your: 1, can: 1, will: 1, one: 1, two: 1, all: 1, how: 1,
  what: 1, when: 1, which: 1, why: 1, does: 1, is: 1, of: 1, in: 1, on: 1,
  to: 1, be: 1, it: 1, if: 1, or: 1, an: 1, as: 1, at: 1, by: 1, do: 1,
};

function text(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function clamp(value, max) {
  var s = text(value).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function normalizeIdToken(raw) {
  var out = "";
  var source = text(raw);
  for (var i = 0; i < source.length; i++) {
    var ch = source[i];
    out += OCR_CONFUSION[ch] || ch;
  }
  return out.toUpperCase();
}

function normalizeExerciseId(raw) {
  var normalized = normalizeIdToken(raw).replace(/\s+/g, "");
  var match = EXERCISE_ID_RE.exec(normalized);
  return match ? match[1] + match[2] : null;
}

// 收集正文里的题号标记（容忍 OCR 噪声），按出现顺序返回。
function collectMarkers(source) {
  var out = [];
  var input = text(source);
  MARKER_RE.lastIndex = 0;
  var match;
  while ((match = MARKER_RE.exec(input))) {
    var id = normalizeExerciseId(match[1]);
    if (!id) continue;
    out.push({ id: id, start: match.index + (match[0][0] === "\n" ? 1 : 0), bodyStart: match.index + match[0].length });
  }
  return out;
}

function stripPageMarkers(value) {
  return text(value).replace(PAGE_MARKER_RE, " ");
}

function pageBefore(input, index) {
  var source = text(input).slice(0, Math.max(0, index));
  PAGE_MARKER_RE.lastIndex = 0;
  var match;
  var page = 0;
  while ((match = PAGE_MARKER_RE.exec(source))) page = Number(match[1] || match[2]) || page;
  return page;
}

// 从窗口里取出某个题号的完整题干：从题号标记到下一个题号标记（或页边界）为止。
function findExerciseStem(readingText, rawId) {
  var id = normalizeExerciseId(rawId);
  if (!id) return null;
  var input = text(readingText);
  var markers = collectMarkers(input);
  var index = -1;
  for (var i = 0; i < markers.length; i++) {
    if (markers[i].id === id) { index = i; break; }
  }
  if (index < 0) return null;
  var marker = markers[index];
  var stop = markers[index + 1] ? markers[index + 1].start : Math.min(input.length, marker.bodyStart + MAX_STEM_CHARS);
  if (stop - marker.bodyStart > MAX_STEM_CHARS) stop = marker.bodyStart + MAX_STEM_CHARS;
  var stem = stripPageMarkers(input.slice(marker.bodyStart, stop)).replace(/\s+/g, " ").trim();
  if (!stem) return null;
  if (stem.length > MAX_STEM_CHARS) stem = stem.slice(0, MAX_STEM_CHARS) + "…";
  return { id: id, stem: stem, page: pageBefore(input, marker.start) };
}

function exerciseSectionStart(input) {
  var lines = text(input).split(/\r?\n/);
  var offset = 0;
  for (var i = 0; i < lines.length; i++) {
    if (SECTION_HEADING_RE.test(lines[i])) return offset;
    offset += lines[i].length + 1;
  }
  return -1;
}

// 选题阶段：给出本批题目的题干清单（按队列顺序，找不到题干的题号只保留题号）。
function listQueueStems(readingText, queue, limit) {
  var out = [];
  var budget = Math.max(600, Number(limit) || DEFAULT_LIMIT);
  var used = 0;
  var page = 0;
  (queue || []).slice(0, MAX_SELECTION_ITEMS).forEach(function (rawId) {
    var id = normalizeExerciseId(rawId);
    if (!id) return;
    var found = findExerciseStem(readingText, id);
    if (found && !page) page = found.page;
    var line = found ? "- " + id + "：" + clamp(found.stem, 420) : "- " + id + "：（窗口内未找到题干，需要时调用 read_textbook_pages 读取该题所在页）";
    if (used + line.length > budget) return;
    used += line.length;
    out.push(line);
  });
  return { lines: out, page: page };
}

// ------------------------------------------------------------------ 知识库证据

function tokenize(value) {
  var source = text(value);
  var latin = source.toLowerCase().match(/[a-z][a-z0-9_\-]{1,}/g) || [];
  var latinSet = Object.create(null);
  latin.forEach(function (token) {
    if (token.length < 2 || LATIN_STOP[token]) return;
    latinSet[token] = 1;
  });
  var cjk = Object.create(null);
  (source.match(/[\u4e00-\u9fff]{2,}/g) || []).forEach(function (run) {
    for (var i = 0; i < run.length - 1; i++) cjk[run.slice(i, i + 2)] = 1;
  });
  return { latin: latinSet, cjk: cjk };
}

function countOverlap(a, b) {
  var hits = 0;
  Object.keys(a).forEach(function (key) { if (b[key]) hits++; });
  return hits;
}

function cardSearchText(card) {
  return [
    card.title,
    card.definition,
    (card.key_points || []).join(" "),
    (card.misconceptions || []).join(" "),
    (card.qa_pairs || []).map(function (pair) { return text(pair && pair.q) + " " + text(pair && pair.a); }).join(" "),
  ].join(" ");
}

function scoreCard(card, stemTokens, exercisePage) {
  var titleTokens = tokenize(card.title);
  var bodyTokens = tokenize(cardSearchText(card));
  var titleCjkHits = countOverlap(stemTokens.cjk, titleTokens.cjk);
  var titleLatinHits = countOverlap(stemTokens.latin, titleTokens.latin);
  var genericLatinHits = countOverlap(stemTokens.latin, GENERIC_LATIN_TOKENS);
  var bodyHits = countOverlap(stemTokens.cjk, bodyTokens.cjk) + countOverlap(stemTokens.latin, bodyTokens.latin);
  var score = bodyHits + 4 * titleCjkHits + 4 * titleLatinHits;
  var pages = Array.isArray(card.source_pages) ? card.source_pages.map(Number) : [];
  if (exercisePage && pages.length && Math.abs(pages[0] - exercisePage) <= 4) score += 3;
  return {
    score: score,
    bodyHits: bodyHits,
    titleCjkHits: titleCjkHits,
    titleLatinHits: Math.max(0, titleLatinHits - genericLatinHits),
    titleLatinRaw: titleLatinHits,
  };
}

// 什么算"足够强"的匹配：标题层面有实质重合，才允许把卡片当作本题依据。
// TCP/UDP/HTTP 这类通用词出现在几乎每张卡片里，不构成依据。
function isStrongMatch(score) {
  if (score.titleCjkHits >= 2) return true;
  if (score.titleLatinHits >= 1 && score.bodyHits >= 4) return true;
  if (score.bodyHits >= 8 && score.titleCjkHits >= 1) return true;
  return false;
}

// 知识库只能通过读取器访问：路由里没有任何绝对路径，卡片文件由调用方
// 用自己已有的文件助手读出来（见 buildExerciseContext 的 readKbFile）。
function kbReaderForDir(kbDir) {
  var dir = text(kbDir);
  if (!dir) return null;
  return function (relative) {
    try {
      return fs.readFileSync(path.join(dir, relative), "utf-8");
    } catch (error) {
      return null;
    }
  };
}

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

async function loadCardEntry(readKbFile, entry) {
  var parsed = parseJson(await readKbFile("cards/" + text(entry.concept_id) + ".json"));
  return parsed && typeof parsed === "object" ? parsed : entry;
}

async function mineEvidence(readKbFile, stem, exercisePage, options) {
  var limit = (options && options.maxCards) || MAX_CARDS;
  if (typeof readKbFile !== "function") return [];
  var index = parseJson(await readKbFile("index.json"));
  var cards = (index && index.cards) || [];
  if (!cards.length) return [];
  var stemTokens = tokenize(stem);
  var scored = [];
  cards.forEach(function (entry) {
    var score = scoreCard(entry, stemTokens, exercisePage);
    if (!isStrongMatch(score)) return;
    scored.push({ entry: entry, score: score });
  });
  scored.sort(function (a, b) { return b.score.score - a.score.score; });
  // 第二张卡只有和第一名旗鼓相当时才带上：宁可少给依据，也不给跑偏的依据。
  var kept = scored.filter(function (item, index) {
    return index < limit && (index === 0 || item.score.score >= scored[0].score.score * 0.8);
  });
  var out = [];
  for (var i = 0; i < kept.length; i++) out.push(await loadCardEntry(readKbFile, kept[i].entry));
  return out;
}

function renderCard(card) {
  var lines = [];
  var pages = Array.isArray(card.source_pages) && card.source_pages.length ? "（原书第 " + card.source_pages.join("–") + " 页）" : "";
  lines.push("- 概念：" + text(card.title).trim() + pages);
  if (text(card.definition).trim()) lines.push("  定义：" + clamp(card.definition, MAX_DEFINITION));
  var points = (card.key_points || []).slice(0, 3).filter(function (item) { return text(item).trim(); });
  if (points.length) lines.push("  要点：" + points.map(function (item) { return clamp(item, MAX_KEY_POINT); }).join("；"));
  var misconceptions = (card.misconceptions || []).slice(0, 1).filter(function (item) { return text(item).trim(); });
  if (misconceptions.length) lines.push("  易错：" + clamp(misconceptions[0], MAX_MISCONCEPTION));
  var pairs = (card.qa_pairs || []).slice(0, 1).filter(function (pair) { return pair && (text(pair.q).trim() || text(pair.a).trim()); });
  if (pairs.length) lines.push("  参考问答：问：" + clamp(pairs[0].q, MAX_QA) + " 答：" + clamp(pairs[0].a, MAX_QA));
  var out = lines.join("\n");
  return out.length > MAX_CARD_CHARS ? out.slice(0, MAX_CARD_CHARS) + "…" : out;
}

// ------------------------------------------------------------------ 页窗口兜底

// 只带一小段原书内容：默认以当前题所在页为锚点；如果这一页在习题区里，
// 就把窗口放在习题区之前的讲解正文上（题目要考的概念在那里，而不是在题号列表里）。
// 知识库依据可能缺失或对不上，这段兜底保证模型手上始终有一点真实教材文字，
// 同时明确告诉它其余页没有发送、需要时按需读取。
function pageExcerpt(readingText, page, opts) {
  var options = opts || {};
  var budget = Number(options.budget) || DEFAULT_EXCERPT_BUDGET;
  var input = text(readingText);
  if (!input.trim() || !page) return null;
  var marks = [];
  PAGE_MARKER_RE.lastIndex = 0;
  var match;
  while ((match = PAGE_MARKER_RE.exec(input))) {
    marks.push({ page: Number(match[1] || match[2]) || 0, index: match.index, length: match[0].length });
  }
  if (!marks.length) return null;
  var at = -1;
  for (var i = 0; i < marks.length; i++) {
    if (marks[i].page === Number(page)) { at = i; break; }
  }
  if (at < 0) {
    for (var j = 0; j < marks.length; j++) if (marks[j].page <= Number(page)) at = j;
    if (at < 0) at = 0;
  }
  var start;
  var end;
  var sectionStart = exerciseSectionStart(input);
  if (sectionStart > 0 && marks[at].index >= sectionStart) {
    end = sectionStart;
    start = Math.max(0, end - budget);
  } else {
    start = Math.max(0, marks[at].index - Math.round(budget * 0.6));
    end = Math.min(input.length, marks[at].index + marks[at].length + Math.round(budget * 0.4));
  }
  var firstPage = 0;
  var lastPage = 0;
  for (var k = 0; k < marks.length; k++) {
    if (marks[k].index < start) continue;
    if (marks[k].index > end) break;
    if (!firstPage) firstPage = marks[k].page;
    lastPage = marks[k].page;
  }
  var label = firstPage ? "第 " + firstPage + "–" + lastPage + " 页" : "第 " + marks[at].page + " 页附近";
  var head = "[原书 " + label + "；完整窗口的第 " + marks[0].page + "–" + marks[marks.length - 1].page + " 页并未全部发送]";
  var body = input.slice(start, end).trim();
  body = stripPageMarkers(body).replace(/\s+/g, " ").trim();
  if (!body) return null;
  var out = head + "\n\n" + body;
  return out.length > budget + 200 ? out.slice(0, budget) + "…" : out;
}

// ------------------------------------------------------------------ 组装

async function buildExerciseContext(opts) {
  var options = opts || {};
  var readingText = text(options.readingText);
  var task = options.task || null;
  var limit = Number(options.limit) || DEFAULT_LIMIT;
  var readKbFile = typeof options.readKbFile === "function" ? options.readKbFile : kbReaderForDir(options.kbDir);
  if (!readingText.trim()) return { ok: false, reason: "no-reading" };
  if (!task || task.mode !== "exercise") return { ok: false, reason: "not-exercise" };

  var queue = Array.isArray(task.exerciseQueue) ? task.exerciseQueue : [];
  var currentId = normalizeExerciseId(task.currentExerciseId);
  var stage = currentId && task.phase !== "selecting" ? "per-item" : "selection";
  var lines = [];
  var stats = { stage: stage, exerciseId: currentId || null, stemChars: 0, evidenceCards: 0, evidenceChars: 0, excerptChars: 0 };
  var anchorPage = 0;

  if (stage === "per-item") {
    var found = findExerciseStem(readingText, currentId);
    if (!found) return { ok: false, reason: "stem-not-found" };
    anchorPage = found.page;
    stats.stemChars = found.stem.length;
    lines.push("当前题：" + found.id + (found.page ? "（原书第 " + found.page + " 页）" : ""));
    lines.push("");
    lines.push("题干（原书原文，完整）：");
    lines.push(found.stem);
    if (readKbFile) {
      var evidence = await mineEvidence(readKbFile, found.stem + " " + found.id, found.page, { maxCards: MAX_CARDS });
      if (evidence.length) {
        var rendered = evidence.map(renderCard);
        stats.evidenceCards = rendered.length;
        stats.evidenceChars = rendered.join("\n").length;
        lines.push("");
        lines.push("本题教材依据（本地知识库卡片，供判断对错与给提示；可能与题目不完全对应，以题干为准）：");
        lines.push(rendered.join("\n"));
      }
    }
  } else {
    var listed = listQueueStems(readingText, queue.length ? queue : [], limit);
    if (!listed.lines.length) return { ok: false, reason: "no-queue-stems" };
    anchorPage = listed.page;
    stats.stemChars = listed.lines.join("\n").length;
    lines.push("当前阶段：选题。下面是本批题目在原书窗口中的题干（按已约定的顺序）：");
    lines.push(listed.lines.join("\n"));
    lines.push("");
    lines.push("与学生确认从哪一题开始；学生选定后，本提示会自动只带当前题。");
  }

  lines.push("");
  lines.push("原书全文没有随本轮发送。只有当学生的问题需要上面材料覆盖不到的内容时，才调用 read_textbook_pages 读取对应页；不要凭印象讲看不到的内容，也不要一次读完整个窗口。");

  var excerpt = pageExcerpt(readingText, anchorPage, { budget: Number(options.excerptBudget) || DEFAULT_EXCERPT_BUDGET }) || "";
  stats.excerptChars = excerpt.length;

  var block = lines.join("\n");
  if (block.length > limit) {
    // 先丢证据卡，再截断；题干本身优先保留。
    if (stats.evidenceCards) {
      var markerIndex = block.indexOf("\n本题教材依据");
      if (markerIndex > 0) {
        block = block.slice(0, markerIndex) + "\n（本题的知识库依据未随本轮发送：需要时调用 read_textbook_pages 读取对应页。）" + block.slice(block.lastIndexOf("\n\n原书全文"));
        stats.evidenceCards = 0;
        stats.evidenceChars = 0;
      }
    }
    if (block.length > limit) {
      var tailIndex = block.lastIndexOf("\n\n原书全文");
      var head = tailIndex > 0 ? block.slice(0, tailIndex) : block;
      var tail = tailIndex > 0 ? block.slice(tailIndex) : "";
      block = head.slice(0, Math.max(400, limit - tail.length)) + "…" + tail;
    }
  }
  stats.chars = block.length;
  return { ok: true, block: block, excerpt: excerpt, stats: stats };
}

module.exports = {
  buildExerciseContext: buildExerciseContext,
  findExerciseStem: findExerciseStem,
  listQueueStems: listQueueStems,
  pageExcerpt: pageExcerpt,
  collectMarkers: collectMarkers,
  normalizeExerciseId: normalizeExerciseId,
  mineEvidence: mineEvidence,
  scoreCard: scoreCard,
  isStrongMatch: isStrongMatch,
  kbReaderForDir: kbReaderForDir,
  renderCard: renderCard,
  DEFAULT_LIMIT: DEFAULT_LIMIT,
  DEFAULT_EXCERPT_BUDGET: DEFAULT_EXCERPT_BUDGET,
};
