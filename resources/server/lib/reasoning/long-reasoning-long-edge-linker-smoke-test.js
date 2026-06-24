/**
 * long-reasoning-long-edge-linker-smoke-test.js
 *
 * Builds a fake textbookDir with a hand-crafted knowledge_base (index.json +
 * cards/*.json + teaching_map.json), runs the long-edge linker CLI, and asserts
 * the parsed LONG_EDGE_LINKER_JSON matches expectations:
 *   - a >30 candidate from an unmapped prereq that fuzzy-maps to an earlier card
 *   - an already-mappable existing edge is deduped (not a candidate)
 *   - a near-distance candidate is filtered by minGap
 *   - a teaching_map prior-phase candidate appears
 *
 * Run: node resources/server/lib/reasoning/long-reasoning-long-edge-linker-smoke-test.js
 */
"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var cp = require("child_process");

var SCRIPT = path.join(__dirname, "long-reasoning-long-edge-linker.js");
var fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.error("FAIL: " + msg); } }

function mkTmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "le-linker-")); }
function writeJson(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8"); }

function buildFakeKB(root) {
  var kb = path.join(root, "knowledge_base");
  var cardsDir = path.join(kb, "cards");
  fs.mkdirSync(cardsDir, { recursive: true });
  writeJson(path.join(kb, "index.json"), { title: "Fake Book", card_count: 5 });

  // c_shell: Shell基础, page 5 — the earlier target for the unmapped prereq.
  writeJson(path.join(cardsDir, "c_shell.json"), {
    concept_id: "c_shell", title: "Shell基础", source_pages: [5, 6], prerequisites: [],
  });
  // c_base: 命令基础, page 2 — earlier basic card for teaching_map / high-order rule.
  writeJson(path.join(cardsDir, "c_base.json"), {
    concept_id: "c_base", title: "命令基础", source_pages: [2, 3], prerequisites: [],
  });
  // c_app: 综合命令程序 page 90, unmapped prereq "Shell 基础" -> should map to c_shell (gap ~85 >30).
  //        Also high-order (综合/程序) -> token overlap with c_base (命令) earlier.
  writeJson(path.join(cardsDir, "c_app.json"), {
    concept_id: "c_app", title: "综合命令程序实现", source_pages: [90, 92],
    prerequisites: ["Shell的基础知识"],
  });
  // c_near: page 8, unmapped prereq "Shell" -> maps to c_shell(5,6) gap ~3 (<5) -> filtered.
  writeJson(path.join(cardsDir, "c_near.json"), {
    concept_id: "c_near", title: "Shell近距应用", source_pages: [8],
    prerequisites: ["Shell"],
  });
  // c_dup: page 40, prereq "Shell基础" exact-maps to c_shell -> existing edge -> deduped.
  writeJson(path.join(cardsDir, "c_dup.json"), {
    concept_id: "c_dup", title: "已映射卡片", source_pages: [40],
    prerequisites: ["Shell基础"],
  });

  // teaching_map: phase1 has c_base+c_shell, later phase has c_app -> prior-phase candidate.
  writeJson(path.join(kb, "teaching_map.json"), {
    segments: [{
      page_range: [1, 92],
      sequence: [
        { phase: 1, label: "基础", card_ids: ["命令基础", "Shell基础"] },
        { phase: 2, label: "进阶", card_ids: ["综合命令程序实现"] },
      ],
    }],
  });
  return root;
}

function runCli(args) {
  var res = cp.spawnSync("node", [SCRIPT].concat(args), { encoding: "utf-8" });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function parseJson(stdout) {
  var lines = stdout.split(/\r?\n/);
  for (var i = lines.length - 1; i >= 0; i--) {
    var m = lines[i].match(/^LONG_EDGE_LINKER_JSON:\s*(\{.*\})\s*$/);
    if (m) { try { return JSON.parse(m[1]); } catch (e) { return null; } }
  }
  return null;
}

function rmrf(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }

// --- Test 1: missing --textbookDir exits 1 ---------------------------------
var miss = runCli([]);
ok(miss.code === 1, "missing --textbookDir exits 1 (got " + miss.code + ")");

// --- Test 2: normal run + --out --------------------------------------------
var tmp = mkTmpDir();
var outFile = path.join(tmp, "candidates.json");
try {
  buildFakeKB(tmp);
  var run = runCli(["--textbookDir", tmp, "--minGap", "5", "--limit", "50", "--out", outFile]);
  ok(run.code === 0, "normal run exits 0 (got " + run.code + ")");

  var j = parseJson(run.stdout);
  ok(j !== null, "LONG_EDGE_LINKER_JSON parseable");
  if (j) {
    ok(j.type === "long_edge_candidates", "type is long_edge_candidates");
    ok(j.method === "rules_only_no_model", "method rules_only_no_model");
    ok(j.stats.cards === 5, "cards === 5 (got " + j.stats.cards + ")");
    ok(j.stats.candidateCount >= 1, "at least 1 candidate (got " + j.stats.candidateCount + ")");

    var byPair = {};
    j.candidates.forEach(function (c) { byPair[c.from.concept_id + "=>" + c.to.concept_id] = c; });

    // c_app -> c_shell via unmapped "Shell 基础", gap >30.
    var appShell = byPair["c_app=>c_shell"];
    ok(!!appShell, "candidate c_app->c_shell exists");
    if (appShell) {
      ok(appShell.absMaxGap > 30, "c_app->c_shell gap >30 (got " + appShell.absMaxGap + ")");
      ok(appShell.rawPrerequisite === "Shell的基础知识", "rawPrerequisite preserved");
    }
    // at least one >30 candidate overall.
    ok(j.stats.buckets[">30"] >= 1, ">30 bucket >=1 (got " + j.stats.buckets[">30"] + ")");

    // dedup: c_dup->c_shell is an existing edge -> must NOT be a candidate.
    ok(!byPair["c_dup=>c_shell"], "existing edge c_dup->c_shell deduped");

    // near-distance: c_near->c_shell gap ~3 < minGap 5 -> filtered.
    ok(!byPair["c_near=>c_shell"], "near edge c_near->c_shell filtered by minGap");

    // teaching_map prior-phase: c_app->c_base or c_app->c_shell should carry the reason.
    var hasTmReason = j.candidates.some(function (c) {
      return c.reasons.indexOf("teaching_map_prior_phase") !== -1;
    });
    ok(hasTmReason, "at least one teaching_map_prior_phase candidate");
  }

  // --out file exists and is valid JSON.
  ok(fs.existsSync(outFile), "--out file written");
  if (fs.existsSync(outFile)) {
    var parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(outFile, "utf-8")); } catch (e) {}
    ok(parsed !== null, "--out file is valid JSON");
    ok(parsed && parsed.type === "long_edge_candidates", "--out file has correct type");
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
