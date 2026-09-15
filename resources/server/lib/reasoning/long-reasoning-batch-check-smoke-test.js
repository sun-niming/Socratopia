// Smoke test for long-reasoning-batch-check.js (batch validation CLI).
// Run: node resources/server/lib/reasoning/long-reasoning-batch-check-smoke-test.js
//
// Builds a fake textbookDir/knowledge_base with Node (NOT PowerShell), writes
// temp cases JSON files, and runs the batch-check CLI as a child process to
// verify:
//   - a normal case PASSes and exit=0
//   - an expectedFocusAny miss FAILs and exit=1
//   - a forbiddenDependencies hit FAILs and exit=1
//   - a cases JSON with a leading UTF-8 BOM still parses (PASS, exit=0)
//
// READ-ONLY demo path; never touches the live classroom chain.
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var child_process = require("child_process");

var CLI = path.join(__dirname, "long-reasoning-batch-check.js");

var pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); pass++; }

// ---- temp textbookDir/knowledge_base (built with Node) ----
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lr-batch-smoke-"));
var tbDir = path.join(tmp, "textbook");
var kbDir = path.join(tbDir, "knowledge_base");
var cardsDir = path.join(kbDir, "cards");
fs.mkdirSync(cardsDir, { recursive: true });

function writeCard(c) { fs.writeFileSync(path.join(cardsDir, c.concept_id + ".json"), JSON.stringify(c), "utf-8"); }
// c_base (p1-5) <- c_mid (p6-10) <- c_top (p11-15) via title prerequisites
writeCard({ concept_id: "c_base", title: "Base", definition: "base def", key_points: ["kp1"], examples: ["ex1"], source_pages: [1, 5], prerequisites: [] });
writeCard({ concept_id: "c_mid", title: "Mid", definition: "mid def", key_points: ["kp2"], examples: [], source_pages: [6, 10], prerequisites: ["Base"] });
writeCard({ concept_id: "c_top", title: "Top", definition: "top def", key_points: [], examples: [], source_pages: [11, 15], prerequisites: ["Mid"] });
fs.writeFileSync(path.join(kbDir, "index.json"), JSON.stringify({
  title: "Demo TB",
  cards: [{ concept_id: "c_base" }, { concept_id: "c_mid" }, { concept_id: "c_top" }]
}), "utf-8");

function cleanup() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}

// Run the CLI as a child process; returns { status, stdout, stderr }.
function runCli(casesPath) {
  // Force kb_fallback by NOT wiring the concept-graph builder. The CLI tries
  // require("../adaptive/concept-graph-builder.js"); if it loads, dry-run with
  // no real LLM still yields no usable graph, so kb_fallback is used anyway.
  var res = child_process.spawnSync(process.execPath, [CLI, "--cases", casesPath], {
    encoding: "utf-8",
    cwd: path.resolve(__dirname, "..", "..", "..", "..")
  });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function writeCases(name, obj, withBom) {
  var p = path.join(tmp, name);
  var text = JSON.stringify(obj, null, 2);
  if (withBom) text = "\uFEFF" + text;
  fs.writeFileSync(p, text, "utf-8");
  return p;
}

function baseDoc(caseObj) {
  return {
    profileId: "p", worldId: "w", textbookId: "t", textbookDir: tbDir,
    cases: [caseObj]
  };
}

// ---- 0. missing --cases / invalid JSON / empty cases gating ----
function testGating() {
  var r1 = child_process.spawnSync(process.execPath, [CLI], { encoding: "utf-8" });
  eq(r1.status, 1, "missing --cases: exit 1");
  ok(/Usage:/.test(r1.stderr), "missing --cases: prints usage");

  var badPath = writeCases("bad.json", {}, false);
  fs.writeFileSync(badPath, "{ not valid json", "utf-8");
  var r2 = runCli(badPath);
  eq(r2.status, 1, "invalid JSON: exit 1");

  var emptyPath = writeCases("empty.json", { profileId: "p", worldId: "w", textbookId: "t", textbookDir: tbDir, cases: [] }, false);
  var r3 = runCli(emptyPath);
  eq(r3.status, 1, "empty cases: exit 1");
}

// ---- 1. normal case PASSes, exit 0 ----
function testPass() {
  var p = writeCases("pass.json", baseDoc({
    id: "ok-1", name: "top recalls mid+base",
    focusConceptId: "c_top", maxDepth: 2,
    expectedFocusAny: ["Top", "c_top"],
    expectedDependenciesAny: ["Mid", "Base"],
    forbiddenDependencies: []
  }), false);
  var r = runCli(p);
  eq(r.status, 0, "pass case: exit 0");
  ok(/verdict\s+:\s+PASS/.test(r.stdout), "pass case: verdict PASS");
  ok(/passed : 1/.test(r.stdout), "pass case: summary passed 1");
  ok(/failed : 0/.test(r.stdout), "pass case: summary failed 0");
  ok(/kb_fallback/.test(r.stdout), "pass case: source kb_fallback");
}

// ---- 2. expectedFocusAny miss -> FAIL, exit 1 ----
function testFocusMiss() {
  var p = writeCases("focusmiss.json", baseDoc({
    id: "miss-1", name: "focus keyword absent",
    focusConceptId: "c_top", maxDepth: 2,
    expectedFocusAny: ["NoSuchFocusKeyword"],
    expectedDependenciesAny: [],
    forbiddenDependencies: []
  }), false);
  var r = runCli(p);
  eq(r.status, 1, "focus miss: exit 1");
  ok(/verdict\s+:\s+FAIL/.test(r.stdout), "focus miss: verdict FAIL");
  ok(/expectedFocusAny missed/.test(r.stdout), "focus miss: reason printed");
}

// ---- 3. forbiddenDependencies hit -> FAIL, exit 1 ----
function testForbidden() {
  var p = writeCases("forbidden.json", baseDoc({
    id: "forbid-1", name: "forbidden dep present",
    focusConceptId: "c_top", maxDepth: 2,
    expectedFocusAny: [],
    expectedDependenciesAny: [],
    forbiddenDependencies: ["Mid"]
  }), false);
  var r = runCli(p);
  eq(r.status, 1, "forbidden: exit 1");
  ok(/verdict\s+:\s+FAIL/.test(r.stdout), "forbidden: verdict FAIL");
  ok(/forbiddenDependencies hit/.test(r.stdout), "forbidden: reason printed");
}

// ---- 4. cases JSON with BOM still parses (PASS, exit 0) ----
function testBom() {
  var p = writeCases("bom.json", baseDoc({
    id: "bom-1", name: "bom-prefixed cases file",
    focusConceptId: "c_top", maxDepth: 2,
    expectedFocusAny: ["Top"],
    expectedDependenciesAny: ["Mid"],
    forbiddenDependencies: []
  }), true);
  // sanity: file really starts with BOM
  var raw = fs.readFileSync(p, "utf-8");
  ok(raw.charCodeAt(0) === 0xFEFF, "bom: file has leading BOM");
  var r = runCli(p);
  eq(r.status, 0, "bom: exit 0");
  ok(/verdict\s+:\s+PASS/.test(r.stdout), "bom: verdict PASS");
}

function main() {
  try {
    testGating();
    testPass();
    testFocusMiss();
    testForbidden();
    testBom();
    console.log("long-reasoning-batch-check smoke test: " + pass + " assertions passed");
  } catch (e) {
    console.error("long-reasoning-batch-check smoke test FAILED:", e && e.stack || e);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}
main();
