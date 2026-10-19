"use strict";

// Regression test for DEEPSEEK_V4_FLASH_CLASSROOM_CONTEXT_PLAN.md (§5.1, §5.3, §8.2, §9.1, §10, §11).
//
// Two regions of the compiled classroom route are covered:
//   * module 9716 (the POST handler) - the history trim block that runs once before the first
//     model call. It used to truncate every message over 1500 chars, including the current
//     student message, and logged `sysPLen` from the history array instead of the prompt.
//   * module 20375 (`zf`) - the model -> tool -> model loop. It used to append tool results
//     without any budget re-check, dedup, or size cap.
//
// The fragments are lifted out of route.js verbatim and evaluated in isolation, so the test
// stays hermetic: no server, no network, no API key, no user data. Budget helpers are lifted
// from chunks/9654.js (module 73358) rather than re-implemented, so the caps under test are
// the ones the route actually calls.

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var routeSrc = fs.readFileSync(path.join(__dirname, "route.js"), "utf8");
var toolsSrc = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "chunks", "9654.js"), "utf8");

// Slice out `from` up to the matching closing brace (brace counting is safe here: every `${`
// inside the template literals carries its own `}`).
function blockFrom(src, startIdx) {
  var open = src.indexOf("{", startIdx);
  assert.ok(open >= 0, "no block at " + startIdx);
  var depth = 0;
  for (var i = open; i < src.length; i++) {
    var ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error("unterminated block at " + startIdx);
}
function sliceBetween(src, fromAnchor, toAnchor, label) {
  var from = src.indexOf(fromAnchor);
  assert.ok(from >= 0, label + ": missing start anchor");
  var to = src.indexOf(toAnchor, from);
  assert.ok(to >= 0, label + ": missing end anchor");
  return src.slice(from, to + toAnchor.length);
}
function functionFrom(src, anchor) {
  var at = src.indexOf(anchor);
  assert.ok(at >= 0, "missing function anchor: " + anchor);
  var body = blockFrom(src, at);
  return src.slice(at, src.indexOf(body, at) + body.length);
}

// --- budget helpers, lifted from module 73358 ---
var budget = (function () {
  var o = functionFrom(toolsSrc, "function o(a){return a>=19968");
  var p = functionFrom(toolsSrc, "function p(a){let b=0;for(let c=0;c<a.length;)");
  var q = functionFrom(toolsSrc, "function q(a,b){let c=0;for(let d=0;d<a.length;)");
  return new Function(o + p + q + "; return { bP: p, Ui: q };")();
})();

// --- history trim block (module 9716) ---
var trimSrc = sliceBetween(routeSrc, "let f=ae.length>0?[...ae,...c]:c;{", "user=${_userLen}`)}", "trim block");
var historyTrim = new Function("ae", "c", "b", "X", trimSrc + "; return { f: f, b: b };");

// --- tool-result dedup / size-cap / window-duplicate block (module 20375) ---
var dedupSrc = blockFrom(routeSrc, routeSrc.indexOf('{let _ro="read_file"===a.name'));
// the window-duplicate helper is defined just before the loop; lift it with its state
var snapSrc = routeSrc.slice(routeSrc.indexOf('_snapT=""'),
  routeSrc.indexOf("};for(let a=0;a<(j?f.wT:1)") + 1);
// the helper now also needs the snapshot text in scope (the verdict line logs its length)
function dupEnv(prompt) {
  return new Function("r", "var _snapT;" + snapSrc + "; return { dup: _dupSnap, snapT: _snapT };") (prompt || []);
}
var noDupEnv = dupEnv([]);
var noDup = noDupEnv.dup; // no window in the prompt -> never a duplicate
function windowPrompt(snapshotBody) {
  return [{ role: "system", content: "RULES\n\n---\n\n[本课教材窗口 v2 · 权威且不可变]\n窗口：第 163–164 页。\n" + snapshotBody }];
}
function governWithWindow(call, args, result, seen, toolChars, prompt) {
  var env = dupEnv(prompt);
  var fn = new Function("a", "b", "c", "f", "_toolSeen", "_toolChars", "_dupSnap", "_snapT",
    dedupSrc + "; return { c: c, toolChars: _toolChars };");
  return fn(call, args, result, budget, seen, toolChars, env.dup, env.snapT);
}
var governToolResult = new Function("a", "b", "c", "f", "_toolSeen", "_toolChars", "_dupSnap", "_snapT",
  dedupSrc + "; return { c: c, toolChars: _toolChars };");

// --- in-loop re-trim block (module 20375) ---
var loopTrimSrc = blockFrom(routeSrc, routeSrc.indexOf("{_loopCount++;const _TML=24"));
var loopTrim = new Function("r", "_loopCount", "_ctxTrims", "_toolChars", "d",
  loopTrimSrc + "; return { r: r, loopCount: _loopCount, ctxTrims: _ctxTrims };");

function msg(role, content, extra) {
  var m = { role: role, content: content };
  if (extra) Object.keys(extra).forEach(function (k) { m[k] = extra[k]; });
  return m;
}
function chars(n) { return "字".repeat(n); }

var failures = [];
function check(name, fn) {
  try { fn(); console.log("  ok  " + name); }
  catch (error) { failures.push(name + ": " + (error && error.message)); console.log("  FAIL " + name + " - " + (error && error.message)); }
}

// ============================ §10 / §5.1 current student input ============================
check("long current student message is never truncated", function () {
  var current = chars(5000);
  var out = historyTrim([], [msg("user", chars(4000)), msg("assistant", chars(4000)), msg("user", current)], "sys", "chinese");
  var last = out.f[out.f.length - 1];
  assert.strictEqual(last.content.length, 5000, "current student input must survive the trim intact");
  assert.ok(out.f[0].content.endsWith("…[trimmed]"), "older over-long messages must still be trimmed");
});

check("long current student input is announced, not silently shortened", function () {
  var out = historyTrim([], [msg("user", chars(7000))], "sys", "chinese");
  assert.strictEqual(out.f[0].content.length, 7000, "input kept in full");
  assert.ok(out.b.indexOf("本轮学生输入较长") >= 0, "system prompt must carry the long-input directive");
  assert.ok(out.b.length > "sys".length, "directive must be appended to the prompt");
});

check("short current student message adds no directive", function () {
  var out = historyTrim([], [msg("user", "老师，这道题怎么做？")], "sys", "chinese");
  assert.strictEqual(out.b, "sys", "no directive below the hard cap");
  assert.strictEqual(out.f[0].content, "老师，这道题怎么做？");
});

check("history budget still cuts oldest messages and keeps the current one", function () {
  var history = [];
  for (var i = 0; i < 20; i++) history.push(msg(i % 2 ? "assistant" : "user", chars(1400)));
  var current = msg("user", chars(1400));
  var out = historyTrim([], history.concat([current]), "sys", "chinese");
  assert.strictEqual(out.f[out.f.length - 1].content, current.content, "current message must be the survivor");
  assert.ok(out.f.length < 21, "old history must be cut");
  var total = out.f.reduce(function (n, m) { return n + (m.content || "").length; }, 0);
  assert.ok(total <= 12000, "trim must bring history under the budget, got " + total);
});

check("an ordinary teaching reply is no longer cut by the per-message cap", function () {
  // Live data: histChars peaked around 7.5k against a 12k budget, yet the 1500-char
  // cap still fired on 37% of turns. The budget, not the cap, should be the binder.
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  var out;
  try {
    out = historyTrim([], [msg("user", "q"), msg("assistant", chars(2400)), msg("user", "now")], "sys", "chinese");
  } finally { console.error = original; }
  assert.strictEqual(out.f[1].content.length, 2400, "a 2400-char reply must survive intact");
  assert.strictEqual((/trimmed=(\d+)/.exec(logged[0]) || [])[1], "0", "nothing should be trimmed");
});

check("a reply over the per-message cap is still cut and reported", function () {
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  var out;
  try {
    out = historyTrim([], [msg("user", "q"), msg("assistant", chars(5000)), msg("user", "now")], "sys", "chinese");
  } finally { console.error = original; }
  assert.strictEqual(out.f[1].content.length, 3000 + "…[trimmed]".length, "over-cap replies must be cut");
  assert.ok(/reason=per-message/.test(logged[0]), "the cut must be reported, got: " + logged[0]);
  assert.ok(/trimmedWhat=assistant:5000/.test(logged[0]), "the role and original size must be named, got: " + logged[0]);
});

check("the 24-message cap is reported instead of silently dropping", function () {
  var history = [];
  for (var i = 0; i < 30; i++) history.push(msg(i % 2 ? "assistant" : "user", "x" + i));
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  var out;
  try {
    out = historyTrim([], history, "sys", "chinese");
  } finally { console.error = original; }
  assert.strictEqual(out.f.length, 24, "the message cap must still apply");
  assert.ok(/reason=msgs-cap/.test(logged[0]), "an uncapped reason hid this drop before, got: " + logged[0]);
  assert.ok(/trimmed=6/.test(logged[0]), "the 6 dropped messages must be counted, got: " + logged[0]);
  assert.strictEqual(out.f[out.f.length - 1].content, "x29", "the newest message must survive");
});

check("trim log reports per-region lengths, not the history array length", function () {
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  try {
    historyTrim([], [msg("user", "hi")], "SYS".repeat(100), "chinese");
  } finally { console.error = original; }
  var line = logged.filter(function (l) { return l.indexOf("[ctx-trim]") === 0; })[0] || "";
  ["reason=", "sysPLen=", "outline=", "memory=", "live=", "resource=", "user="].forEach(function (field) {
    assert.ok(line.indexOf(field) >= 0, "log must carry " + field + ", got: " + line);
  });
  assert.ok(line.indexOf("sysPLen=300") >= 0, "sysPLen must be the prompt length, got: " + line);
  assert.strictEqual(/sysPLen=\d+/.test(line), true);
});

check("region meter reads only the section it names", function () {
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  try {
    var prompt = "HEAD" + "\r\n\r\n---\r\n\r\n## 学习进度（当前教材）\r\n\r\n" + "A".repeat(300) +
      "\r\n\r\n---\r\n\r\n## 当前教材内容（本节课已读取）\r\n\r\n" + "B".repeat(700);
    historyTrim([], [msg("user", "hi")], prompt, "chinese");
  } finally { console.error = original; }
  var line = logged.filter(function (l) { return l.indexOf("[ctx-trim]") === 0; })[0] || "";
  assert.ok(/live=340/.test(line) || /live=3\d\d/.test(line), "live must measure only the progress section, got: " + line);
  assert.ok(/resource=7\d\d/.test(line), "resource must measure only the reading section, got: " + line);
});

check("region meter follows the live prompt's LF separators and reading snapshot", function () {
  // The real prompt is joined with LF (`\n\n---\n\n`), and the authoritative reading
  // snapshot is appended after the builder returns — under its own bracket marker,
  // not a `##` heading. Both must be measured, not swallowed by the region above them.
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  try {
    var prompt = "RULES" + "\n\n---\n\n" + "## 前序对话摘要\n\n" + "M".repeat(200) +
      "\n\n---\n\n" + "## 学习进度（当前教材）\n\n" + "A".repeat(300) +
      "\n\n---\n\n" + "[本课教材窗口 v2 · 权威且不可变]\n" + "S".repeat(5000);
    historyTrim([], [msg("user", "hi")], prompt, "chinese");
  } finally { console.error = original; }
  var line = logged.filter(function (l) { return l.indexOf("[ctx-trim]") === 0; })[0] || "";
  assert.ok(/memory=2\d\d/.test(line), "memory must stop at the progress section, got: " + line);
  assert.ok(/live=3\d\d/.test(line), "live must stop at the snapshot, got: " + line);
  assert.ok(/snapshot=50\d\d/.test(line), "the reading snapshot must be measured on its own, got: " + line);
});

// ============================ §8.2 / §5.3 tool results ============================
function toolCall(name, args) { return { id: "call_1", name: name, arguments: JSON.stringify(args) }; }
function freshSeen() { return new Map(); }

check("identical read-only tool calls are collapsed to a placeholder", function () {
  var seen = freshSeen();
  var call = toolCall("read_file", { path: "story.md" });
  var first = governToolResult(call, { path: "story.md" }, "FULL BODY", budget, seen, 0, noDup, "");
  assert.strictEqual(first.c, "FULL BODY", "first read passes through");
  var second = governToolResult(call, { path: "story.md" }, "FULL BODY", budget, seen, first.toolChars, noDup, "");
  assert.ok(/duplicate read_file/.test(second.c), "second identical read must be a placeholder, got: " + second.c);
  assert.ok(second.c.indexOf("call_1") >= 0, "placeholder must point at the original tool_call_id");
  assert.ok(second.c.length < 200, "placeholder must be short");
  assert.strictEqual(seen.size, 1, "only one entry per identical read");
});

check("writes are never deduped", function () {
  var seen = freshSeen();
  var call = toolCall("write_file", { path: "textbooks/T1/progress.md", content: "x" });
  var first = governToolResult(call, {}, "已成功写入。", budget, seen, 0, noDup, "");
  var second = governToolResult(call, {}, "已成功写入。", budget, seen, first.toolChars, noDup, "");
  assert.strictEqual(second.c, "已成功写入。", "write results must not be replaced by a placeholder");
  assert.strictEqual(seen.size, 0, "writes must not register in the dedup map");
});

check("a different read is not mistaken for a duplicate", function () {
  var seen = freshSeen();
  governToolResult(toolCall("read_file", { path: "story.md" }), {}, "A", budget, seen, 0, noDup, "");
  var other = governToolResult(toolCall("read_file", { path: "learner_profile.md" }), {}, "B", budget, seen, 0, noDup, "");
  assert.strictEqual(other.c, "B", "different paths must both reach the model");
  assert.strictEqual(seen.size, 2);
});

check("oversized read_file results are cut to the unit cap", function () {
  var seen = freshSeen();
  var huge = chars(20000); // CJK: ~1 unit/char
  var out = governToolResult(toolCall("read_file", { path: "toc.json" }), {}, huge, budget, seen, 0, noDup, "");
  assert.ok(out.c.length < huge.length, "result must be truncated");
  assert.ok(out.c.indexOf("tool result truncated") >= 0, "truncation must be labelled");
  assert.ok(budget.bP(out.c) < 8200, "truncated body must sit inside the cap, got " + budget.bP(out.c));
});

check("textbook page reads keep the executor's own budget", function () {
  var seen = freshSeen();
  var body = chars(12000);
  var out = governToolResult(toolCall("read_textbook_pages", { startPage: 10 }), {}, body, budget, seen, 0, noDup, "");
  assert.strictEqual(out.c, body, "the 20000-unit textbook budget must not be cut down to the read_file cap");
});

check("empty and error tool results pass through untouched", function () {
  var seen = freshSeen();
  assert.strictEqual(governToolResult(toolCall("read_file", { path: "nope.md" }), {}, "", budget, seen, 0, noDup, "").c, "");
  assert.strictEqual(governToolResult(toolCall("read_file", { path: "nope.md" }), {}, "文件不存在或为空。", budget, freshSeen(), 0, noDup, "").c, "文件不存在或为空。");
});

// ============================ §8.2 in-loop re-trim ============================
function toolTurn(index, size) {
  return [
    msg("assistant", null, { tool_calls: [{ id: "c" + index, type: "function", function: { name: "read_file", arguments: "{}" } }] }),
    msg("tool", chars(size), { tool_call_id: "c" + index })
  ];
}

check("loop trim drops whole tool groups and keeps the newest turn", function () {
  var r = [msg("system", "SYS")].concat(
    [msg("user", chars(2000)), msg("assistant", chars(2000))],
    toolTurn(1, 4000),
    toolTurn(2, 4000),
    [msg("user", "现在讲讲第二题"), msg("assistant", null, { tool_calls: [{ id: "c3", type: "function", function: { name: "read_file", arguments: "{}" } }] }), msg("tool", chars(4000), { tool_call_id: "c3" })]
  );
  var out = loopTrim(r, 2, 0, 0, "");
  assert.strictEqual(out.ctxTrims, 1, "the over-budget turn must trigger exactly one re-trim");
  assert.strictEqual(out.r[0].content, "SYS", "system prompt is never dropped");
  var users = out.r.filter(function (m) { return m.role === "user"; });
  assert.strictEqual(users.length, 1, "the current student turn must survive the re-trim");
  assert.strictEqual(users[0].content, "现在讲讲第二题", "and it must be the current one, not an older turn");
  assert.ok(out.r.length < r.length, "at least one whole group must be dropped, got " + out.r.length);
  assert.strictEqual(out.r[out.r.length - 1].tool_call_id, "c3", "the newest tool result must survive");
  out.r.forEach(function (m, i) {
    if (m.role !== "tool") return;
    var owner = out.r.slice(0, i).reverse().filter(function (x) { return x.tool_calls; })[0];
    assert.ok(owner, "tool message at " + i + " must still be paired with its assistant tool_calls");
    assert.strictEqual(owner.tool_calls[0].id, m.tool_call_id, "tool_call_id pairing must stay intact");
  });
});

check("loop trim never runs when the turn is inside budget", function () {
  var r = [msg("system", "SYS"), msg("user", "hi"), msg("assistant", "hello")];
  var out = loopTrim(r, 1, 0, 0, "");
  assert.strictEqual(out.ctxTrims, 0, "small turns must not be touched");
  assert.deepStrictEqual(out.r, r);
});

check("loop budget measures the conversation, not the system prompt", function () {
  // A 30k system prompt must not be charged against the 12k conversation budget:
  // a short turn riding on a huge prompt is still inside budget.
  var r = [msg("system", chars(30000)), msg("user", "hi"), msg("assistant", "hello")];
  var out = loopTrim(r, 1, 0, 0, "");
  assert.strictEqual(out.ctxTrims, 0,
    "system prompt length must not trigger a conversation re-trim");
  assert.strictEqual(out.r.length, 3, "nothing may be dropped when the conversation fits");
});

check("loop trim keeps the current student message even when nothing else can go", function () {
  var r = [msg("system", "SYS"), msg("user", chars(9000)), msg("assistant", null, { tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{}" } }] }), msg("tool", chars(9000), { tool_call_id: "c1" })];
  var out = loopTrim(r, 2, 0, 0, "");
  var user = out.r.filter(function (m) { return m.role === "user"; });
  assert.strictEqual(user.length, 1, "the current student message must never be cut to satisfy the budget");
  assert.strictEqual(user[0].content.length, 9000, "and must stay intact");
});

// ============================ §5.3 window duplication ============================
// The reading window is already in the stable context. A tool that re-fetches the
// same pages must not paste them a second time — measured at 94% of the conversation.
var WINDOW_BODY = ("--- 第 163 页 ---\n软件体系结构按照系统及其组合的形式将系统的总体结构分离。\n").repeat(20);

check("a tool result that duplicates the reading window is stubbed", function () {
  var out = governWithWindow(toolCall("read_textbook_pages", { startPage: 163 }), { startPage: 163 },
    WINDOW_BODY, freshSeen(), 0, windowPrompt(WINDOW_BODY));
  assert.ok(/already present verbatim in the reading window/.test(out.c), "must be stubbed, got: " + out.c.slice(0, 120));
  assert.ok(/read_textbook_pages/.test(out.c), "the stub must name the tool");
  assert.ok(out.c.length < 260, "the stub must be short, got " + out.c.length);
  assert.strictEqual(out.toolChars, out.c.length, "only the stub counts against the tool budget");
});

check("a tool result outside the reading window is kept in full", function () {
  var other = ("--- 第 200 页 ---\n完全不同的另一章内容，讲的是操作系统调度。\n").repeat(20);
  var out = governWithWindow(toolCall("read_textbook_pages", { startPage: 200 }), { startPage: 200 },
    other, freshSeen(), 0, windowPrompt(WINDOW_BODY));
  assert.strictEqual(out.c, other, "a genuinely new page range must pass through");
});

check("a result that only partly overlaps the window is kept", function () {
  // head is in the window, tail is past its end -> the tail would be lost by stubbing
  var out = governWithWindow(toolCall("read_textbook_pages", { startPage: 163 }), { startPage: 163 },
    WINDOW_BODY + "--- 第 200 页 ---\n窗口之外的后续内容。\n".repeat(20),
    freshSeen(), 0, windowPrompt(WINDOW_BODY));
  assert.strictEqual(out.c.length > WINDOW_BODY.length, true, "a partly-new result must stay whole");
});

check("the duplicate check ignores a leading page-range comment", function () {
  // The window blob opens with `<!-- startPage: N endPage: M -->`, so a naive prefix
  // probe would never match; the probe must start inside the body.
  var out = governWithWindow(toolCall("read_textbook_pages", { startPage: 163 }), { startPage: 163 },
    "<!-- startPage: 163 endPage: 164 -->\n" + WINDOW_BODY, freshSeen(), 0, windowPrompt(WINDOW_BODY));
  assert.ok(/already present verbatim/.test(out.c), "the comment header must not defeat the probe");
});

check("a short tool result is never treated as a window duplicate", function () {
  var out = governWithWindow(toolCall("read_file", { path: "progress.md" }), { path: "progress.md" },
    "short", freshSeen(), 0, windowPrompt("short"));
  assert.strictEqual(out.c, "short", "under 600 chars the probe is skipped");
});

check("without a reading window in the prompt nothing is stubbed", function () {
  var out = governWithWindow(toolCall("read_textbook_pages", { startPage: 163 }), { startPage: 163 },
    WINDOW_BODY, freshSeen(), 0, [{ role: "system", content: "RULES only" }]);
  assert.strictEqual(out.c, WINDOW_BODY, "no window snapshot means no duplicate");
});

// ============================ §9.1 cache contract ============================
check("only gpt-5.6 gets prompt cache parameters", function () {
  var at = routeSrc.indexOf("prompt_cache_key:");
  assert.ok(at > 0, "gpt-5.6 branch must still send a cache key");
  var before = routeSrc.slice(Math.max(0, at - 260), at);
  assert.ok(/gpt-5\\?\.6/i.test(before) || /gpt-5\.6/i.test(before), "cache key must stay gated on the gpt-5.6 test, got: " + before);
  var deepseekCache = /deepseek[\s\S]{0,200}prompt_cache_key/i.test(routeSrc);
  assert.strictEqual(deepseekCache, false, "no DeepSeek branch may send prompt_cache_key - the endpoint silently ignores it");
  var retention = routeSrc.split("prompt_cache_retention").length - 1;
  assert.strictEqual(retention, 1, "prompt_cache_retention must exist only in the gpt-5.6 branch, found " + retention);
});

check("DeepSeek native cache counters are logged", function () {
  assert.ok(routeSrc.indexOf("cacheHitTokens") > 0, "prompt_cache_hit_tokens must be recorded");
  assert.ok(routeSrc.indexOf("cacheMissTokens") > 0, "prompt_cache_miss_tokens must be recorded");
});

check("the old history-length misreported as prompt length is gone", function () {
  assert.strictEqual(routeSrc.indexOf("sysPLen=${c.length}"), -1, "sysPLen must no longer read the history array");
});

// ==================== §5.4 stable prefix, §13 no interruption ====================
var reorderSrc = blockFrom(routeSrc, routeSrc.indexOf('(function(){const _S="\\n\\n---\\n\\n",_M="<!--CTX_RESOURCE_BOUNDARY-->'));
var SENT = "<!--CTX_RESOURCE_BOUNDARY-->";
var SEP = "\n\n---\n\n";
// the block is an IIFE that reorders `o` into §5.4 bands, each wrapped in a §6 marker;
// run it and read `o` back
var reorderRaw = new Function("o", "_late", "(function()" + reorderSrc + ")(); return o;");
var BAND_TAG = /^<\/?CLASSROOM_[A-Z_]+( version="[^"]*")?>$/;
function flatten(bands) {
  var out = [];
  bands.forEach(function (band) {
    band.split(SEP).forEach(function (part) { if (!BAND_TAG.test(part)) out.push(part); });
  });
  return out;
}
var reorderJoin = function (o, late) { return reorderRaw(o, late || []).join(SEP); };
var reorder = function (o, late) { return flatten(reorderRaw(o, late || [])); };

function rankOf(section) {
  var ordered = reorder(["RULES"].concat(section), []);
  return ordered.indexOf(section[0]);
}

check("high-frequency sections are pushed behind the stable prefix", function () {
  var out = reorder(
    ["RULES", "## 学习者信息\n\nW", "## 当前关系状态\n\nR", "## 教材库\n\nL"],
    ["## 学习进度\n\nP", "## 世界背景\n\nG"]
  );
  assert.strictEqual(out[0], "RULES", "the rules block must stay first");
  assert.ok(out.indexOf("## 当前关系状态\n\nR") > out.indexOf("## 学习者信息\n\nW"),
    "live-state relationship must move behind stable learner info");
  assert.ok(out.indexOf("## 学习进度\n\nP") > out.indexOf("## 教材库\n\nL"),
    "live-state progress must move behind the stable textbook library");
  // story.md is rewritten by the companion in-lesson, so world background leaves the prefix
  assert.ok(out.indexOf("## 世界背景\n\nG") > out.indexOf("## 学习者信息\n\nW"),
    "world background must not sit in the stable prefix");
});

check("memory is the last band, behind live state", function () {
  var out = reorder(
    ["RULES", "## 前序对话摘要\n\nM", "## 学习进度\n\nP", "## 学习者信息\n\nW"],
    []
  );
  assert.ok(out.indexOf("## 前序对话摘要\n\nM") > out.indexOf("## 学习进度\n\nP"),
    "§5.4 puts the conversation summary after high-frequency state");
  assert.strictEqual(out[out.length - 1], "## 前序对话摘要\n\nM");
});

check("the band map cannot drift from the sections the builder emits", function () {
  // Every marker in the map must be a real section the builder pushes - a typo
  // would silently dump that section into the stable band.
  var mapSrc = reorderSrc.slice(reorderSrc.indexOf("const _mk="), reorderSrc.indexOf("];", reorderSrc.indexOf("const _mk=")) + 2);
  var map = new Function(mapSrc + "; return _mk;")();
  assert.ok(map.length >= 20, "the band map must cover both language branches, got " + map.length);
  var builderSrc = sliceBetween(routeSrc, 'function u(a,b,c,i,j="chinese"', 'async function v(a,b,c,d="chinese"', "builder");
  var missing = map.filter(function (e) { return builderSrc.indexOf(e[0]) < 0; })
    .map(function (e) { return e[0]; });
  assert.deepStrictEqual(missing, [], "map markers not found in the builder: " + missing.join(", "));
});

check("every ranked section is ranked in both languages", function () {
  var mapSrc = reorderSrc.slice(reorderSrc.indexOf("const _mk="), reorderSrc.indexOf("];", reorderSrc.indexOf("const _mk=")) + 2);
  var map = new Function(mapSrc + "; return _mk;")();
  var byRank = {};
  map.forEach(function (e) { (byRank[e[1]] = byRank[e[1]] || []).push(e[0]); });
  assert.deepStrictEqual(Object.keys(byRank).sort(), ["1", "2", "3"], "only the three non-stable bands may exist");
  Object.keys(byRank).forEach(function (rank) {
    var heads = byRank[rank];
    // a Chinese-only entry would silently leave the English classroom unordered
    assert.ok(heads.some(function (h) { return /[\u4e00-\u9fff]/.test(h); }),
      "rank " + rank + " has no Chinese marker");
    assert.ok(heads.some(function (h) { return /^## [A-Za-z]/.test(h); }),
      "rank " + rank + " has no English marker");
  });
});

check("§6 attention-layer markers wrap every band", function () {
  var joined = reorderJoin(
    ["RULES", "## 学习者信息\n\nW", "## 当前关系状态\n\nR", "## 前序对话摘要\n\nM"],
    ["## 学习进度\n\nP"]
  );
  var order = [
    '<CLASSROOM_STABLE_RULES version="ctxt-v1">', "</CLASSROOM_STABLE_RULES>",
    '<CLASSROOM_RESOURCE_CONTEXT version="ctxt-v1">', "</CLASSROOM_RESOURCE_CONTEXT>",
    "<CLASSROOM_LIVE_STATE>", "</CLASSROOM_LIVE_STATE>",
    "<CLASSROOM_RECENT_MEMORY>", "</CLASSROOM_RECENT_MEMORY>"
  ];
  order.forEach(function (tag) { assert.ok(joined.indexOf(tag) >= 0, "missing marker " + tag); });
  // each open tag must precede its close tag, and the bands must be in §5.4 order
  var at = order.map(function (tag) { return joined.indexOf(tag); });
  for (var i = 0; i < at.length; i += 2) {
    assert.ok(at[i] < at[i + 1], "band " + i / 2 + " must open before it closes");
  }
  assert.deepStrictEqual(at, at.slice().sort(function (a, b) { return a - b; }),
    "bands must appear in stable -> resource -> live -> memory order");
});

check("no live section sits inside the stable band", function () {
  // §13: the stable prefix must not be interrupted by high-frequency classroom state.
  var joined = reorderJoin(
    ["RULES", "## 学习者信息\n\nW", "## 学习进度\n\nP", "## 当前关系状态\n\nR"],
    ["## 伙伴精力状态：3/5\n\nE"]
  );
  var open = joined.indexOf('<CLASSROOM_STABLE_RULES version="ctxt-v1">');
  var close = joined.indexOf("</CLASSROOM_STABLE_RULES>");
  var stableBand = joined.slice(open, close);
  ["## 学习进度\n\nP", "## 当前关系状态\n\nR", "## 伙伴精力状态：3/5\n\nE"].forEach(function (s) {
    assert.strictEqual(stableBand.indexOf(s), -1, "live section leaked into the stable band: " + s.slice(0, 14));
  });
  assert.ok(stableBand.indexOf("## 学习者信息\n\nW") > 0, "stable content must be inside the stable band");
  assert.ok(stableBand.indexOf("RULES") > 0, "the rules are stable content too and belong in the band");
});

check("the resource boundary sits between stable content and live state", function () {
  var out = reorder(
    ["RULES", "## 学习者信息\n\nW", "## 世界背景\n\nG", "## 当前关系状态\n\nR"],
    ["## 学习进度\n\nP"]
  );
  var sent = out.indexOf(SENT);
  assert.ok(sent > 0, "the resource boundary marker must be present");
  assert.ok(sent > out.indexOf("## 学习者信息\n\nW"), "stable content must precede the resource band");
  assert.ok(sent < out.indexOf("## 世界背景\n\nG"), "the volatile world background must follow the resource band");
  assert.ok(sent < out.indexOf("## 当前关系状态\n\nR"), "the resource band must precede live state");
});

check("unknown sections default to the stable band", function () {
  // A section nobody classified must not break the stable prefix: it stays early.
  var out = reorder(["RULES", "## 未来新增小节\n\nX", "## 学习进度\n\nP"], []);
  assert.ok(out.indexOf("## 未来新增小节\n\nX") < out.indexOf(SENT),
    "unclassified sections must remain in the stable band, got order: " + out.join(" | "));
});

check("every known section lands in its §5.4 band", function () {
  // The whole band layout, with the sections in the order the builder pushes them.
  var out = reorder(
    ["RULES",
      "## 你的角色设定\n\nC", "## 当前关系状态\n\nR", "## 世界背景\n\nW",
      "## 与伙伴的相处片段（近期）\n\nM", "## 学习者信息\n\nL",
      "## 上次学习日期\n\nD", "## Socratopia 群（最近消息）\n\nG",
      "## 当前教材（本次教学对象）\n\nT", "## 教材库\n\nLIB",
      "<TEACHING_DIRECTIVE>x</TEACHING_DIRECTIVE>", "## 前序对话摘要\n\nSUM",
      "## 伙伴精力状态：3/5\n\nE", "**Hard rule: x**"],
    ["## 学习进度（当前教材）\n\nP"]
  );
  function bandOf(marker) { return out.indexOf(marker); }
  // story.md and the page number are rewritten in-lesson -> they ride with live state
  var live = ["## 当前关系状态\n\nR", "## 与伙伴的相处片段（近期）\n\nM", "## 上次学习日期\n\nD",
    "## Socratopia 群（最近消息）\n\nG", "## 伙伴精力状态：3/5\n\nE", "## 学习进度（当前教材）\n\nP",
    "## 世界背景\n\nW", "## 当前教材（本次教学对象）\n\nT"];
  var stable = ["## 你的角色设定\n\nC", "## 学习者信息\n\nL", "## 教材库\n\nLIB",
    "<TEACHING_DIRECTIVE>x</TEACHING_DIRECTIVE>", "**Hard rule: x**"];
  stable.forEach(function (s) {
    assert.ok(bandOf(s) < bandOf(SENT), "stable section must precede the resource band: " + s.slice(0, 12));
  });
  live.forEach(function (s) {
    assert.ok(bandOf(s) > bandOf(SENT), "high-frequency section must follow the resource band: " + s.slice(0, 12));
  });
  assert.ok(bandOf("## 前序对话摘要\n\nSUM") > Math.max.apply(null, live.map(bandOf)),
    "§5.4 puts the conversation summary behind all live state");
  assert.strictEqual(out[0], "RULES", "rules stay first");
  assert.strictEqual(stable.length + live.length + 3, out.length, "no section may be lost or duplicated");
});

// ---- handler-side splice: the reading snapshot lands in the resource band ----
var spliceSrc = blockFrom(routeSrc, routeSrc.indexOf('{const _CTX_SENT="<!--CTX_RESOURCE_BOUNDARY-->"'));
var splice = new Function("b", "_readingSnapshot", "_readingSnapshotPreamble", "_advanceTurn", "X", "_paceProfile",
  spliceSrc + "; return b;");
var preamble = function () { return "[WINDOW v2]"; };
var pace = { id: "normal", guidance: "", guidanceZhTw: "", guidanceEn: "" };

check("the reading snapshot is spliced into the resource band, not appended", function () {
  var b = "RULES" + SEP + "## 世界背景\n\nW" + SEP + SENT + SEP + "## 当前关系状态\n\nR";
  var prompt = splice(b, "PAGES 163-192", preamble, {}, "chinese", pace);
  assert.ok(prompt.indexOf("PAGES 163-192") < prompt.indexOf("## 当前关系状态\n\nR"),
    "the snapshot must come before live state");
  assert.ok(prompt.indexOf("RULES") < prompt.indexOf("PAGES 163-192"),
    "but after the stable rules");
  assert.strictEqual(prompt.indexOf(SENT), -1, "the boundary marker itself must be consumed");
  assert.strictEqual(prompt.split(SEP).length, 4, "exactly one separator between each band");
});

check("a missing snapshot drops the resource band without leaving a gap", function () {
  var withEmptySnapshot = splice("RULES" + SEP + "## 世界背景\n\nW" + SEP + "## 当前关系状态\n\nR",
    "", preamble, {}, "chinese", pace);
  assert.strictEqual(withEmptySnapshot, "RULES" + SEP + "## 世界背景\n\nW" + SEP + "## 当前关系状态\n\nR",
    "no snapshot must collapse cleanly, got: " + JSON.stringify(withEmptySnapshot));
});

check("a prompt without the boundary marker still gets the snapshot appended", function () {
  // nuwa mode builds the prompt through a different module and carries no marker.
  var prompt = splice("RULES", "PAGES 1-5", preamble, {}, "chinese", pace);
  assert.ok(prompt.indexOf("PAGES 1-5") > 0, "snapshot must still reach the prompt");
  assert.ok(prompt.indexOf(SEP + "[WINDOW v2]") >= 0, "appended with a separator, got: " + JSON.stringify(prompt));
});

check("the rules are the first thing inside the stable band", function () {
  // The rules are the longest stable block, so they must sit inside the band that
  // claims to be stable - otherwise a prompt with no other rank-0 section would
  // emit no stable marker at all.
  var joined = reorderJoin(["RULES", "## 当前关系状态\n\nR"], []);
  var open = joined.indexOf('<CLASSROOM_STABLE_RULES version="ctxt-v1">');
  var close = joined.indexOf("</CLASSROOM_STABLE_RULES>");
  assert.ok(open >= 0 && close > open, "the stable band must exist even with no stable section");
  assert.strictEqual(joined.slice(open, close).indexOf("RULES") > 0, true,
    "the rules must be inside the stable band, got: " + JSON.stringify(joined.slice(0, 140)));
});

check("the region meter reports a hash per band", function () {
  // Consecutive requests whose band hashes differ pin down which band invalidated
  // the prefix; that is how the volatile band gets identified from a live lesson.
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  try {
    var prompt = "RULES" + SEP + '<CLASSROOM_RESOURCE_CONTEXT version="ctxt-v1">' + SEP + "snapshot" +
      SEP + "<CLASSROOM_LIVE_STATE>" + SEP + "## 学习进度\n\nP" + SEP + "</CLASSROOM_LIVE_STATE>" +
      SEP + "<CLASSROOM_RECENT_MEMORY>" + SEP + "## 前序对话摘要\n\nM" + SEP + "</CLASSROOM_RECENT_MEMORY>";
    historyTrim([], [msg("user", "hi")], prompt, "chinese");
  } finally { console.error = original; }
  var line = logged.filter(function (l) { return l.indexOf("[ctx-trim]") === 0; })[0] || "";
  var bh = (/bh=(\S+)/.exec(line) || [])[1] || "";
  assert.strictEqual(bh.split(".").length, 4, "one hash per band, got: " + bh);
  assert.strictEqual(bh.split(".").filter(function (x) { return x === "-"; }).length, 0,
    "all four bands are present in this fixture, got: " + bh);
});

check("the duplicate probe reports a verdict when it does not stub", function () {
  // Without this line a live lesson cannot tell "no duplicate" from "probe missed",
  // which is exactly the ambiguity that hid the OCR-mismatch theory.
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  try {
    var other = chars(2000); // not in the window
    governWithWindow(toolCall("read_textbook_pages", { startPage: 200 }), { startPage: 200 },
      other, freshSeen(), 0, windowPrompt(WINDOW_BODY));
  } finally { console.error = original; }
  var line = logged.filter(function (l) { return l.indexOf("[ctx-dup]") === 0; })[0] || "";
  assert.ok(line.indexOf("read_textbook_pages") > 0, "the verdict must name the tool, got: " + line);
  assert.ok(/verdict=miss@/.test(line), "a non-duplicate must report which probe missed, got: " + line);
  assert.ok(/snapChars=\d+/.test(line), "the snapshot length must be reported, got: " + line);
});

check("a stub is also reported, so its rate is measurable from a live lesson", function () {
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  try {
    governWithWindow(toolCall("read_textbook_pages", { startPage: 163 }), { startPage: 163 },
      WINDOW_BODY, freshSeen(), 0, windowPrompt(WINDOW_BODY));            // stub -> reported
    governWithWindow(toolCall("read_file", { path: "p.md" }), {}, "tiny", freshSeen(), 0, windowPrompt(WINDOW_BODY)); // short -> quiet
  } finally { console.error = original; }
  var lines = logged.filter(function (l) { return l.indexOf("[ctx-dup]") === 0; });
  assert.strictEqual(lines.length, 1, "only the stubbed call may report, got: " + logged.join(" | "));
  assert.ok(/verdict=stub/.test(lines[0]), "the stub must be reported, got: " + lines[0]);
  assert.ok(/resultLen=\d+ stubLen=\d+/.test(lines[0]), "both lengths must be reported, got: " + lines[0]);
});

// ==================== §10 / §11 region budgets and metrics ====================
check("the region meter reports the stable-prefix length", function () {
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  try {
    var prompt = "RULES\n\n---\n\n## 学习者信息\n\nW" + SEP + "## 学习进度（当前教材）\n\nP";
    historyTrim([], [msg("user", "hi")], prompt, "chinese");
  } finally { console.error = original; }
  var line = logged.filter(function (l) { return l.indexOf("[ctx-trim]") === 0; })[0] || "";
  assert.ok(/stable=\d+/.test(line), "log must carry stable=, got: " + line);
  var stable = +(/stable=(\d+)/.exec(line) || [])[1];
  assert.strictEqual(stable, ("RULES" + SEP + "## 学习者信息\n\nW").length,
    "stable must cover every section up to the first high-frequency one, got: " + stable);
});

check("each region is checked against an explicit budget", function () {
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  try {
    var prompt = "RULES" + SEP + "## 学习进度（当前教材）\n\n" + chars(3000);
    historyTrim([], [msg("user", "hi")], prompt, "chinese");
  } finally { console.error = original; }
  var budgets = logged.filter(function (l) { return l.indexOf("[ctx-budget]") === 0; });
  assert.strictEqual(budgets.length, 1, "an over-budget region must produce exactly one budget line");
  assert.ok(/live=\d+>2000/.test(budgets[0]), "the live region must be named with its budget, got: " + budgets[0]);
});

check("a prompt inside every budget stays quiet", function () {
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  try {
    historyTrim([], [msg("user", "hi")], "RULES", "chinese");
  } finally { console.error = original; }
  assert.strictEqual(logged.filter(function (l) { return l.indexOf("[ctx-budget]") === 0; }).length, 0,
    "no budget line when everything fits");
});

check("the reading snapshot is charged once, to the resource budget", function () {
  // The stable prefix metric spans the snapshot, so a 20k window must not be
  // reported as a stable-band breach on top of its own resource budget.
  var logged = [];
  var original = console.error;
  console.error = function (line) { logged.push(String(line)); };
  try {
    var prompt = "RULES" + SEP + "[本课教材窗口 v2 · 权威且不可变]\n" + chars(20000) + SEP + "## 学习进度\n\nP";
    historyTrim([], [msg("user", "hi")], prompt, "chinese");
  } finally { console.error = original; }
  var budgets = logged.filter(function (l) { return l.indexOf("[ctx-budget]") === 0; });
  assert.deepStrictEqual(budgets, [], "a 20k snapshot inside every budget must stay quiet, got: " + budgets.join(""));
  var line = logged.filter(function (l) { return l.indexOf("[ctx-trim]") === 0; })[0] || "";
  assert.ok(/snapshot=2002\d/.test(line), "the snapshot must be measured, got: " + line);
});

if (failures.length) {
  console.error("\nchat classroom context governance smoke test: FAIL (" + failures.length + ")\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("chat classroom context governance smoke test: PASS");
}
