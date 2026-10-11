// figure-adoption-report-smoke-test.js — self-contained test for the report tool.
// Run: node tools/figure-adoption-report-smoke-test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const report = require("./figure-adoption-report.js");

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name: name, ok: true }); console.log("  PASS  " + name); }
  catch (error) { results.push({ name: name, ok: false }); console.log("  FAIL  " + name + "\n        " + error.message); }
}

const SINCE = Date.parse("2026-10-11T00:00:00Z");

test("scanLog counts turns, figure replies and persisted figures after the window start", function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "figreport-"));
  try {
    const log = path.join(root, "x.log");
    fs.writeFileSync(log, [
      "[2026-10-10T23:59:00.000Z] [Next] [assets] figure catalogue chars=500",              // before window
      "[2026-10-11T06:13:02.331Z] [Next] [assets] figure catalogue chars=712",
      "[2026-10-11T06:20:11.000Z] [Next] [assets] figure catalogue chars=712",
      "[2026-10-11T06:24:58.997Z] [Next] [assets] materialized figure orders in 2 message(s)",
      "[2026-10-11T06:24:58.881Z] [Next:err] [assets-http] GET /api/assets/__probe?stage=pre-probe&cls=hljs+language-svg",
      "[2026-10-11T06:25:10.000Z] [Next:err] [assets-http] GET /api/assets/__probe?stage=sweep-found&src=http%3A%2F%2Flocalhost%3A13713%2Fapi%2Ftextbook%3Fpage-image%3D1%26page%3D168",
      "[2026-10-11T06:42:45.063Z] [Next] [chat-trash] moved AbC0E to chats/.trash",
      "garbage line without a timestamp",
    ].join("\n"));
    const stats = report.scanLog(log, SINCE);
    assert.strictEqual(stats.turns, 2, "only in-window turns");
    assert.strictEqual(stats.figureReplies, 2, "pre-probe (svg) + page-image sweep (crop) = ordered figures");
    assert.strictEqual(stats.materialized, 2, "sum of N, not the line count");
    assert.strictEqual(stats.trashed, 1);
    assert.strictEqual(stats.promptCharsLast, 712);
    assert.strictEqual(stats.promptCharsMax, 712);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("scanChats separates anchored figures from dead leftovers", function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "figreport-chats-"));
  try {
    const chats = path.join(root, "chats");
    fs.mkdirSync(chats, { recursive: true });
    fs.writeFileSync(path.join(chats, "a.json"), JSON.stringify({
      messages: [
        { role: "user", content: "问", timestamp: "2026-10-11T06:00:00Z" },
        { role: "assistant", content: "看 ![图](asset://ast_0946bb980579c88c)", timestamp: "2026-10-11T06:01:00Z" },
        { role: "assistant", content: "死文本 [图片: 系统通信图示意]", timestamp: "2026-10-11T06:02:00Z" },
        { role: "assistant", content: "窗口外", timestamp: "2026-10-10T06:00:00Z" },
      ],
    }));
    fs.writeFileSync(path.join(chats, "b.json"), "{ broken");
    const stats = report.scanChats(root, SINCE);
    assert.strictEqual(stats.assistantMessages, 2, "in-window assistant messages only");
    assert.strictEqual(stats.withAnchor, 1);
    assert.strictEqual(stats.deadLeftovers, 1);
    assert.strictEqual(stats.samples.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("worldDirs walks account/profile/world and honours filters", function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "figreport-worlds-"));
  try {
    const dir = path.join(root, "accounts", "local", "profiles", "p1", "worlds", "KU");
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(root, "accounts", "local", "profiles", "p1", "worlds", "KZ"), { recursive: true });
    assert.strictEqual(report.worldDirs(root, {}).length, 2);
    assert.strictEqual(report.worldDirs(root, { world: "KU" }).length, 1);
    assert.strictEqual(report.worldDirs(root, { profile: "nope" }).length, 0);
    assert.strictEqual(report.worldDirs(path.join(root, "missing"), {}).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("scanAssets counts textbook crops created in the window", function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "figreport-assets-"));
  try {
    const dir = path.join(root, "assets");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.jsonl"), [
      JSON.stringify({ id: "ast_0000000000000001", kind: "textbook-figure", createdAt: Date.parse("2026-10-11T07:00:00Z"), ref: { page: 182 } }),
      JSON.stringify({ id: "ast_0000000000000002", kind: "svg", createdAt: Date.parse("2026-10-11T07:10:00Z") }),
      JSON.stringify({ id: "ast_0000000000000003", kind: "textbook-figure", createdAt: Date.parse("2026-10-10T07:00:00Z"), ref: { page: 3 } }),
      "{ broken",
    ].join("\n"));
    const out = report.scanAssets(root, SINCE);
    assert.strictEqual(out.crops, 1, "only in-window crops");
    assert.strictEqual(out.samples.length, 1);
    assert.strictEqual(report.scanAssets(path.join(root, "nope"), SINCE).crops, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("scanLog counts crop failures", function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "figreport-cropfail-"));
  try {
    const log = path.join(root, "x.log");
    fs.writeFileSync(log, "[2026-10-11T07:00:00.000Z] [Next] [assets] book order p1 failed: No PDF in textbooks\\tidnone\n");
    assert.strictEqual(report.scanLog(log, SINCE).cropFailures, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("pct and parseArgs behave", function () {
  assert.strictEqual(report.pct(1, 4), "25.0%");
  assert.strictEqual(report.pct(0, 0), "n/a");
  const args = report.parseArgs(["node", "tool", "--days=2", "--world=KU"]);
  assert.strictEqual(args.days, "2");
  assert.strictEqual(args.world, "KU");
});

console.log("");
const passed = results.filter(function (r) { return r.ok; }).length;
console.log("figure-adoption-report: " + passed + " passed, " + (results.length - passed) + " failed");
if (passed !== results.length) process.exit(1);
