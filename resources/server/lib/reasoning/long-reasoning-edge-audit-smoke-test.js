/**
 * long-reasoning-edge-audit-smoke-test.js
 *
 * Builds a fake textbookDir with a hand-crafted knowledge_base (index.json +
 * cards/*.json) containing edges at known page distances, runs the edge-audit
 * CLI, and asserts the parsed EDGE_AUDIT_JSON matches expectations.
 *
 * Run: node resources/server/lib/reasoning/long-reasoning-edge-audit-smoke-test.js
 */
"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var cp = require("child_process");

var SCRIPT = path.join(__dirname, "long-reasoning-edge-audit.js");
var fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.error("FAIL: " + msg); } }

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "edge-audit-"));
}
function writeJson(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8"); }

function buildFakeKB(root) {
  var kb = path.join(root, "knowledge_base");
  var cardsDir = path.join(kb, "cards");
  fs.mkdirSync(cardsDir, { recursive: true });
  writeJson(path.join(kb, "index.json"), { title: "Fake Book", card_count: 4 });

  // c_base: page 1-2, no prereqs (the target for near + long edges).
  writeJson(path.join(cardsDir, "c_base.json"), {
    concept_id: "c_base", title: "Base", source_pages: [1, 2], prerequisites: [],
  });
  // c_mid: page 8, prereq c_base -> gap ~6-7 (5-10 bucket).
  writeJson(path.join(cardsDir, "c_mid.json"), {
    concept_id: "c_mid", title: "Mid", source_pages: [8], prerequisites: ["c_base"],
  });
  // c_far: page 90, prereq c_base -> gap ~88-89 (>30 bucket). Also a near prereq c_mid (gap ~82 too...) — keep single to control.
  writeJson(path.join(cardsDir, "c_far.json"), {
    concept_id: "c_far", title: "Far", source_pages: [90], prerequisites: ["c_base"],
  });
  // c_near: page 3, prereq c_base (gap 1-2 => 0-4 bucket) AND an unmappable prereq.
  writeJson(path.join(cardsDir, "c_near.json"), {
    concept_id: "c_near", title: "Near", source_pages: [3, 4],
    prerequisites: ["c_base", "nonexistent_concept_xyz"],
  });

  return root;
}

function runCli(args) {
  var res = cp.spawnSync("node", [SCRIPT].concat(args), { encoding: "utf-8" });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function parseAuditJson(stdout) {
  var lines = stdout.split(/\r?\n/);
  for (var i = lines.length - 1; i >= 0; i--) {
    var m = lines[i].match(/^EDGE_AUDIT_JSON:\s*(\{.*\})\s*$/);
    if (m) { try { return JSON.parse(m[1]); } catch (e) { return null; } }
  }
  return null;
}

function rmrf(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }

// --- Test 1: missing --textbookDir exits 1 ---------------------------------
var miss = runCli([]);
ok(miss.code === 1, "missing --textbookDir exits 1 (got " + miss.code + ")");

// --- Test 2: normal run ----------------------------------------------------
var tmp = mkTmpDir();
var cleanup = [tmp];
try {
  buildFakeKB(tmp);
  var run = runCli(["--textbookDir", tmp]);
  ok(run.code === 0, "normal run exits 0 (got " + run.code + ")");

  var j = parseAuditJson(run.stdout);
  ok(j !== null, "EDGE_AUDIT_JSON parseable");
  if (j) {
    ok(j.cards === 4, "cards === 4 (got " + j.cards + ")");
    // prereqs: c_mid(1) + c_far(1) + c_near(2) = 4 total.
    ok(j.prereqTotal === 4, "prereqTotal === 4 (got " + j.prereqTotal + ")");
    // mappable: c_mid->c_base, c_far->c_base, c_near->c_base = 3.
    ok(j.prereqMappable === 3, "prereqMappable === 3 (got " + j.prereqMappable + ")");
    ok(j.prereqUnmapped === 1, "prereqUnmapped === 1 (got " + j.prereqUnmapped + ")");

    // distance buckets:
    //  c_near(3,4)->c_base(1,2): absMaxGap = max(|4-1|,|2-3|)=3 -> 0-4
    //  c_mid(8)->c_base(1,2):    absMaxGap = max(|8-1|,|2-8|)=7 -> 5-10
    //  c_far(90)->c_base(1,2):   absMaxGap = max(|90-1|,|2-90|)=89 -> >30
    ok(j.distanceBuckets["0-4"] === 1, "bucket 0-4 === 1 (got " + j.distanceBuckets["0-4"] + ")");
    ok(j.distanceBuckets["5-10"] === 1, "bucket 5-10 === 1 (got " + j.distanceBuckets["5-10"] + ")");
    ok(j.distanceBuckets["11-30"] === 0, "bucket 11-30 === 0 (got " + j.distanceBuckets["11-30"] + ")");
    ok(j.distanceBuckets[">30"] === 1, "bucket >30 === 1 (got " + j.distanceBuckets[">30"] + ")");

    ok(j.maxEdge && j.maxEdge.from.concept_id === "c_far", "maxEdge.from is c_far (got " + (j.maxEdge && j.maxEdge.from.concept_id) + ")");
    ok(j.maxEdge && j.maxEdge.to.concept_id === "c_base", "maxEdge.to is c_base");
    ok(j.maxEdge && j.maxEdge.absMaxGap === 89, "maxEdge.absMaxGap === 89 (got " + (j.maxEdge && j.maxEdge.absMaxGap) + ")");

    ok(j.unmappedSamples.indexOf("nonexistent_concept_xyz") !== -1, "unmappedSamples includes the bad prereq");
  }
} finally {
  cleanup.forEach(rmrf);
}

if (fails === 0) {
  console.log("passed");
  process.exit(0);
} else {
  console.error(fails + " assertion(s) failed");
  process.exit(1);
}
