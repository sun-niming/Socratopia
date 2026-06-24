// Smoke test for long-reasoning-kb-inventory.js (read-only KB inventory CLI).
// Run: node resources/server/lib/reasoning/long-reasoning-kb-inventory-smoke-test.js
//
// Builds two fake textbookDir/knowledge_base trees with Node (NOT PowerShell):
//   - a "high" candidate: 35 cards, page span 1-80, several mappable
//     prerequisites, a teaching_map.json, and a fake.pdf source file
//   - a "low" candidate: 3 cards, page span 10-12, no prerequisites
// then runs the inventory CLI as a child process and verifies:
//   - exit=0
//   - both KBs are listed
//   - the high candidate is graded "high", the low candidate "low"
//   - the INVENTORY_JSON tail line parses
//   - missing --root exits 1
//
// READ-ONLY demo path; never touches the live classroom chain. Cleans up temp.
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var child_process = require("child_process");

var CLI = path.join(__dirname, "long-reasoning-kb-inventory.js");

var pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); pass++; }

// ---- temp root with two fake textbookDirs ----
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lr-inv-smoke-"));

function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj), "utf-8"); }

function buildKb(textbookDir, cards, opts) {
  opts = opts || {};
  var kbDir = path.join(textbookDir, "knowledge_base");
  var cardsDir = path.join(kbDir, "cards");
  fs.mkdirSync(cardsDir, { recursive: true });
  var refs = cards.map(function (c) { return { concept_id: c.concept_id }; });
  writeJSON(path.join(kbDir, "index.json"), { title: opts.title || "Demo", cards: refs });
  cards.forEach(function (c) { writeJSON(path.join(cardsDir, c.concept_id + ".json"), c); });
  if (opts.teachingMap) writeJSON(path.join(kbDir, "teaching_map.json"), { phases: [] });
  if (opts.sourceFile) fs.writeFileSync(path.join(textbookDir, opts.sourceFile), "x", "utf-8");
}

// --- high candidate: 35 cards, pages 1..80, chained prerequisites by title ---
var highDir = path.join(tmp, "highbook");
var highCards = [];
for (var i = 0; i < 35; i++) {
  var startPage = 1 + Math.round(i * (79 / 34)); // spreads 1..80
  var card = {
    concept_id: "h_" + i,
    title: "HC " + i,
    definition: "def " + i,
    key_points: [], examples: [],
    source_pages: [startPage, startPage],
    prerequisites: i > 0 ? ["HC " + (i - 1)] : [] // each maps to the previous card's title
  };
  highCards.push(card);
}
buildKb(highDir, highCards, { title: "High Book", teachingMap: true, sourceFile: "fake.pdf" });

// --- low candidate: 3 cards, pages 10..12, no prerequisites ---
var lowDir = path.join(tmp, "lowbook");
var lowCards = [
  { concept_id: "l_0", title: "LC 0", definition: "d0", key_points: [], examples: [], source_pages: [10, 10], prerequisites: [] },
  { concept_id: "l_1", title: "LC 1", definition: "d1", key_points: [], examples: [], source_pages: [11, 11], prerequisites: [] },
  { concept_id: "l_2", title: "LC 2", definition: "d2", key_points: [], examples: [], source_pages: [12, 12], prerequisites: [] }
];
buildKb(lowDir, lowCards, { title: "Low Book" });

function cleanup() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}

function runCli(rootArg) {
  var argv = rootArg == null ? [CLI] : [CLI, "--root", rootArg];
  var res = child_process.spawnSync(process.execPath, argv, { encoding: "utf-8" });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function parseInventoryJson(stdout) {
  var lines = stdout.split(/\r?\n/);
  for (var i = lines.length - 1; i >= 0; i--) {
    var m = lines[i].indexOf("INVENTORY_JSON:");
    if (m >= 0) return JSON.parse(lines[i].slice(m + "INVENTORY_JSON:".length).trim());
  }
  return null;
}

function main() {
  try {
    // 1. missing --root -> exit 1 + usage
    var rNo = runCli(null);
    eq(rNo.status, 1, "missing --root: exit 1");
    ok(/Usage:/.test(rNo.stderr), "missing --root: prints usage");

    // 2. real scan of tmp root
    var r = runCli(tmp);
    eq(r.status, 0, "scan: exit 0");
    ok(/KBs found : 2/.test(r.stdout), "scan: found 2 KBs");

    var inv = parseInventoryJson(r.stdout);
    ok(Array.isArray(inv), "INVENTORY_JSON parses to array");
    eq(inv.length, 2, "INVENTORY_JSON has 2 entries");

    var byDir = {};
    inv.forEach(function (e) { byDir[path.basename(e.textbookDir)] = e; });

    ok(byDir.highbook, "high candidate present");
    ok(byDir.lowbook, "low candidate present");

    eq(byDir.highbook.level, "high", "high candidate graded high");
    eq(byDir.highbook.cards, 35, "high candidate has 35 cards");
    ok(byDir.highbook.span >= 30, "high candidate span >= 30");
    ok(byDir.highbook.prereqMappable >= 2, "high candidate has mappable prereqs");
    eq(byDir.highbook.hasTeachingMap, true, "high candidate has teaching_map");
    ok(byDir.highbook.sourceFiles.indexOf("fake.pdf") >= 0, "high candidate sees fake.pdf");

    eq(byDir.lowbook.level, "low", "low candidate graded low");
    eq(byDir.lowbook.cards, 3, "low candidate has 3 cards");
    eq(byDir.lowbook.prereqTotal, 0, "low candidate has no prereqs");
    eq(byDir.lowbook.hasTeachingMap, false, "low candidate has no teaching_map");

    console.log("long-reasoning-kb-inventory smoke test: " + pass + " assertions passed");
  } catch (e) {
    console.error("long-reasoning-kb-inventory smoke test FAILED:", e && e.stack || e);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}
main();
