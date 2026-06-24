/**
 * long-reasoning-long-edge-review-smoke-test.js
 *
 * Builds a fake textbookDir (knowledge_base/cards) + a fake candidates JSON
 * containing one strong "likely" candidate, one alias-only "noisy" candidate,
 * and one ambiguous "needs_human" candidate, runs the review CLI, and asserts
 * the parsed LONG_EDGE_REVIEW_JSON matches expectations.
 *
 * Run: node resources/server/lib/reasoning/long-reasoning-long-edge-review-smoke-test.js
 */
"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var cp = require("child_process");

var SCRIPT = path.join(__dirname, "long-reasoning-long-edge-review.js");
var fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.error("FAIL: " + msg); } }

function mkTmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "le-review-")); }
function writeJson(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8"); }

function buildFakeKB(root) {
  var kb = path.join(root, "knowledge_base");
  var cardsDir = path.join(kb, "cards");
  fs.mkdirSync(cardsDir, { recursive: true });
  writeJson(path.join(kb, "index.json"), { title: "Fake Book", card_count: 4 });
  writeJson(path.join(cardsDir, "c_ret.json"), { concept_id: "c_ret", title: "命令执行结果的整数返回值", source_pages: [1, 4] });
  writeJson(path.join(cardsDir, "c_quote.json"), { concept_id: "c_quote", title: "引号会阻止Shell展开通配符", source_pages: [9, 12] });
  writeJson(path.join(cardsDir, "c_if.json"), { concept_id: "c_if", title: "if条件判断结构", source_pages: [77, 80] });
  writeJson(path.join(cardsDir, "c_exec.json"), { concept_id: "c_exec", title: "exec命令", source_pages: [89, 92] });
  return root;
}

function buildFakeCandidates(file) {
  writeJson(file, {
    version: 1,
    type: "long_edge_candidates",
    method: "rules_only_no_model",
    minGap: 5,
    stats: { cards: 4, candidateCount: 3, buckets: {} },
    candidates: [
      // LIKELY: high score, real unmapped token overlap ("返回值"), not alias-only.
      {
        id: "le_001",
        from: { concept_id: "c_if", title: "if条件判断结构", pages: [77, 80] },
        to: { concept_id: "c_ret", title: "命令执行结果的整数返回值", pages: [1, 4] },
        rawPrerequisite: "命令返回值",
        absMaxGap: 79, minGap: 73, score: 0.8,
        reasons: ["prior_pages", "unmapped_prereq_token_overlap"],
        status: "candidate_unverified",
      },
      // NOISY: alias-only match onto the wildcard-quote sink.
      {
        id: "le_002",
        from: { concept_id: "c_exec", title: "exec命令", pages: [89, 92] },
        to: { concept_id: "c_quote", title: "引号会阻止Shell展开通配符", pages: [9, 12] },
        rawPrerequisite: "Shell内置命令",
        absMaxGap: 83, minGap: 77, score: 0.75,
        reasons: ["prior_pages", "alias_match"],
        status: "candidate_unverified",
      },
      // NEEDS_HUMAN: unmapped token overlap but score < 0.8, ambiguous semantic link.
      {
        id: "le_003",
        from: { concept_id: "c_exec", title: "exec命令", pages: [89, 92] },
        to: { concept_id: "c_ret", title: "命令执行结果的整数返回值", pages: [1, 4] },
        rawPrerequisite: "返回值处理",
        absMaxGap: 88, minGap: 85, score: 0.66,
        reasons: ["prior_pages", "unmapped_prereq_token_overlap"],
        status: "candidate_unverified",
      },
    ],
  });
}

function runCli(args) {
  var res = cp.spawnSync("node", [SCRIPT].concat(args), { encoding: "utf-8" });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function parseJson(stdout) {
  var lines = stdout.split(/\r?\n/);
  for (var i = lines.length - 1; i >= 0; i--) {
    var m = lines[i].match(/^LONG_EDGE_REVIEW_JSON:\s*(\{.*\})\s*$/);
    if (m) { try { return JSON.parse(m[1]); } catch (e) { return null; } }
  }
  return null;
}

function rmrf(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }

// --- Test 1: missing args exits 1 ------------------------------------------
var miss = runCli([]);
ok(miss.code === 1, "missing args exits 1 (got " + miss.code + ")");

var missTb = runCli(["--candidates", "x.json"]);
ok(missTb.code === 1, "missing --textbookDir exits 1 (got " + missTb.code + ")");

// --- Test 2: normal run -----------------------------------------------------
var tmp = mkTmpDir();
var candFile = path.join(tmp, "candidates.json");
var outFile = path.join(tmp, "review.json");
try {
  buildFakeKB(tmp);
  buildFakeCandidates(candFile);
  var run = runCli(["--candidates", candFile, "--textbookDir", tmp, "--limit", "30", "--out", outFile]);
  ok(run.code === 0, "normal run exits 0 (got " + run.code + ")");

  var j = parseJson(run.stdout);
  ok(j !== null, "LONG_EDGE_REVIEW_JSON parseable");
  if (j) {
    ok(j.type === "long_edge_review", "type is long_edge_review");
    ok(j.method === "rules_review_no_model", "method rules_review_no_model");
    ok(j.stats.total === 3, "stats.total === 3 (got " + j.stats.total + ")");
    ok(j.stats.likely === 1, "stats.likely === 1 (got " + j.stats.likely + ")");
    ok(j.stats.noisy === 1, "stats.noisy === 1 (got " + j.stats.noisy + ")");
    ok(j.stats.needs_human === 1, "stats.needs_human === 1 (got " + j.stats.needs_human + ")");

    var byId = {};
    j.items.forEach(function (it) { byId[it.candidateId] = it; });
    ok(byId.le_001 && byId.le_001.status === "likely", "le_001 is likely (got " + (byId.le_001 && byId.le_001.status) + ")");
    ok(byId.le_002 && byId.le_002.status === "noisy", "le_002 is noisy (got " + (byId.le_002 && byId.le_002.status) + ")");
    ok(byId.le_003 && byId.le_003.status === "needs_human", "le_003 is needs_human (got " + (byId.le_003 && byId.le_003.status) + ")");
  }

  ok(fs.existsSync(outFile), "--out file written");
  if (fs.existsSync(outFile)) {
    var parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(outFile, "utf-8")); } catch (e) {}
    ok(parsed !== null, "--out file is valid JSON");
    ok(parsed && parsed.type === "long_edge_review", "--out file has correct type");
  }
} finally {
  rmrf(tmp);
}

if (fails === 0) {
  console.log("passed");
  process.exit(0);
} else {
  console.error(fails + " assertion(s) failed");
  process.exit(1);
}
