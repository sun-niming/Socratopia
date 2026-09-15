"use strict";

// Regression test for the ch13 incident: the reading window (pages 163-192) exceeded the
// 14000-char prompt budget, and the fallback kept head(9000)+tail(3000) joined by an
// unlabelled "[content trimmed, middle omitted]" marker. The model read the two disjoint
// fragments as continuous, went from the end of ch12 straight into the second half of ch13,
// and taught 13.5 on premises (13.1-13.4) it never saw.
//
// Module 7788 is the classroom prompt builder. The truncation branch now anchors on the page
// cursor and labels the omitted page ranges. This test lifts the compiled module out of the
// route and asserts on the emitted reading section directly, so it stays hermetic (no server,
// no network, no real user data).

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var routePath = path.join(__dirname, "route.js");
var rulesDir = path.resolve(__dirname, "..", "..", "..", "..", "..", "..", "..", "resources", "rules");
var src = fs.readFileSync(routePath, "utf8");

global.__RULES_DIR__ = rulesDir;
global.__FS__ = fs;

function extractModule(id) {
  var start = src.indexOf(id + ":");
  if (start < 0) throw new Error("module not found: " + id);
  var arrowStart = start + (id + ":").length;
  var i = src.indexOf("{", arrowStart);
  var depth = 0;
  for (var j = i; j < src.length; j++) {
    var ch = src[j];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(arrowStart, j + 1); }
  }
  throw new Error("unterminated module " + id);
}

// --- fixture: pages 163..192, chapter 13 laid out so 13.1-13.5 fall in the old dropped middle ---
var FILLER_12 = "第12章 软件体系结构基础（续）本章讨论构件、连接件与配置风格。";
function pageBody(p) {
  var fill = function (t, n) { return t.repeat(n); };
  if (p <= 172) return fill(FILLER_12, 20);
  if (p === 173) return fill("第13章 体系结构模式 本章引入分层、调用/返回、异步消息等模式。", 20);
  if (p === 174) return fill("13.1 分层模式 分层模式把系统组织为若干层次，每层只依赖下一层。", 20);
  if (p === 175) return fill("13.2 调用/返回模式 调用/返回模式刻画同步调用与结果返回的控制流。", 20);
  if (p === 176) return fill("13.3 异步消息模式 异步消息模式通过消息中间件解耦发送者与接收者。", 20);
  if (p <= 178) return fill("13.4 模式组合与选择准则 选择模式需权衡耦合度、性能与可演化性。", 20);
  if (p <= 180) return fill("13.5 子系统分解与接口设计 子系统分解以职责与信息隐藏为准绳。", 20);
  return fill("13.6 本章小结与练习 复习题。", 20);
}
function buildWindow() {
  var pages = [];
  for (var p = 163; p <= 192; p++) pages.push("--- 第 " + p + " 页 ---\n" + pageBody(p));
  return pages.join("\n\n");
}

var WINDOW = buildWindow();
var FILES = { "conversations/conv1/current_reading.md": WINDOW };
var LANDMARKS = [
  "第13章 体系结构模式", "13.1 分层模式", "13.2 调用/返回模式",
  "13.3 异步消息模式", "13.4 模式组合与选择准则", "13.5 子系统分解与接口设计", "13.6 本章小结与练习"
];
var INCIDENT_SECTIONS = ["13.1 分层模式", "13.2 调用/返回模式", "13.3 异步消息模式", "13.4 模式组合与选择准则"];

var state = { currentPage: 163, books: true };
var stubs = {
  79748: { readFile: async function (p) { return FILES[p] || ""; }, existsSync: function () { return true; } },
  29021: { existsSync: function () { return true; } },
  70829: {
    Dp: async function (b, c, rel) { return FILES[rel] || ""; },
    I0: async function () { return null; },
    sk: async function () { return {}; },
    vV: function (cid, tid) { return cid ? "conversations/" + cid + "/current_reading.md" : "textbooks/" + tid + "/current_reading.md"; }
  },
  82751: {
    sd: async function () {
      return state.books ? [{ id: "T1", title: "软件建模与设计", format: "pdf", numPages: 446, currentPage: state.currentPage, author: "作者", field: "软件工程" }] : [];
    },
    $g: async function () { return "（此世界暂无教材）"; },
    P_: function () { return "progress.md"; }
  },
  74039: { SLOT_IDS: ["npc_a", "npc_b", "npc_c", "npc_d"] },
  81788: { p8: 10, $8: 1e6 }
};

var mod = { exports: {} };
var factory = eval("(" + extractModule("7788") + ")");
var requireStub = function (id) {
  if (!stubs[id]) throw new Error("unstubbed module " + id);
  return stubs[id];
};
requireStub.d = function (exports, defs) {
  Object.keys(defs).forEach(function (key) { Object.defineProperty(exports, key, { get: defs[key], enumerable: true }); });
};
factory(mod, mod.exports, requireStub);
var Ex = mod.exports.Ex;

var HEADING = "## 当前教材内容（本节课已读取）";

function readingBody(prompt) {
  var start = prompt.indexOf(HEADING);
  assert.ok(start >= 0, "prompt must carry the reading-window section");
  var body = prompt.slice(start + HEADING.length).replace(/^\r?\n\r?\n/, "");
  var cut = body.indexOf("\n\n---\n\n");
  return cut >= 0 ? body.slice(0, cut) : body;
}
function markersIn(text) { return text.match(/\.\.\.\[[^\]]*\]/g) || []; }
// A contiguous passage is one verbatim slice of the source window: strip the labelled
// elision markers, then the remainder must appear in the window as-is.
function isContiguous(body) {
  var passage = body.replace(/\.\.\.\[[^\]]*\]\n\n/, "").replace(/\n\n\.\.\.\[[^\]]*\]$/, "");
  return WINDOW.indexOf(passage) >= 0;
}
// What the pre-fix branch produced from the same input.
function oldBranch(plain) {
  return plain.slice(0, 9000) + "\n\n...[content trimmed, middle omitted]\n\n" + plain.slice(-3000);
}

async function build(cursorPage) {
  state.currentPage = cursorPage;
  return Ex("npc_a", "p1", "w1", 600000, "chinese", "conv1", "", "T1", "");
}

async function main() {
  assert.ok(WINDOW.length > 14000, "fixture must exceed the truncation threshold, got " + WINDOW.length);

  // --- the incident: class starts at page 163, ch13's sections sit past the head(9000) cut ---
  var body = readingBody(await build(163));
  var markers = markersIn(body);
  assert.strictEqual(markers.length, 1, "cursor branch must emit exactly one labelled elision marker, got " + JSON.stringify(markers));
  assert.ok(/pages \d+\+ are NOT included in this prompt/.test(markers[0]), "the cut must name the pages that follow, got " + markers[0]);
  assert.ok(isContiguous(body), "cursor branch must hand over one contiguous slice, not head+tail fragments");
  var dropped = INCIDENT_SECTIONS.filter(function (s) { return oldBranch(WINDOW).indexOf(s) < 0; });
  assert.ok(dropped.length > 0, "fixture must actually drop sections in the old branch");
  dropped.forEach(function (s) {
    assert.ok(body.indexOf(s) >= 0, "cursor branch must keep " + s + ", which the head+tail branch dropped");
  });
  assert.ok(body.indexOf("--- 第 163 页 ---") >= 0, "cursor branch must start from the class-start page");

  // --- cursor deep in the window: the omitted range is the one before the passage ---
  var back = readingBody(await build(179));
  var backMarkers = markersIn(back);
  assert.strictEqual(backMarkers.length, 1, "back-context case must emit exactly one marker, got " + JSON.stringify(backMarkers));
  assert.ok(/pages \d+-\d+ omitted, this passage starts at page \d+/.test(backMarkers[0]), "the cut must name the omitted pages and the passage start, got " + backMarkers[0]);
  assert.ok(isContiguous(back), "back-context case must stay contiguous");
  assert.ok(back.indexOf("13.6 本章小结与练习") >= 0, "back-context case must reach the end of the window");

  // --- unknown cursor keeps the pre-fix fallback byte for byte ---
  var fallback = readingBody(await build(999));
  assert.deepStrictEqual(markersIn(fallback), ["...[content trimmed, middle omitted]"], "unknown cursor must keep the unlabelled head+tail fallback");
  assert.strictEqual(fallback, oldBranch(WINDOW), "unknown cursor must not change the previous output");

  // --- no textbook metadata keeps the fallback too ---
  state.books = false;
  var noBook = readingBody(await build(163));
  assert.deepStrictEqual(markersIn(noBook), ["...[content trimmed, middle omitted]"], "no textbook metadata must keep the head+tail fallback");
  assert.strictEqual(noBook, oldBranch(WINDOW), "no textbook metadata must not change the previous output");

  // --- a window that fits is passed through untouched ---
  state.books = true;
  var small = "conversations/conv1/current_reading.md";
  FILES[small] = WINDOW;
  var shortWindow = "--- 第 163 页 ---\n短内容。";
  FILES[small] = shortWindow;
  var shortBody = readingBody(await build(163));
  assert.strictEqual(shortBody, shortWindow, "an under-threshold window must pass through untouched");
  FILES[small] = WINDOW;

  console.log("chat reading-window truncation smoke test: PASS");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
