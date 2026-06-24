// Smoke test for long-reasoning-build-preflight.js (read-only build preflight).
// Run: node resources/server/lib/reasoning/long-reasoning-build-preflight-smoke-test.js
//
// Builds temp fixtures with Node (NOT PowerShell): a fake PDF file (with a few
// "/Type /Page" markers so the byte-scan finds pages), a fresh staging dir, and
// an "existing KB" dir containing knowledge_base/index.json. Then runs the CLI
// as a child process and verifies:
//   - missing --src => exit 1 + usage
//   - missing --textbookDir AND --outputDir => exit 1 + usage
//   - normal preflight on a fresh outputDir => exit 0, PREFLIGHT_JSON parses,
//     does NOT create outputDir, estimatedChunks computed from --endPage
//   - outputDir already has knowledge_base => wouldOverwriteExistingKb=true,
//     exit 2 (unsafe)
//
// READ-ONLY tool; this test asserts the CLI never creates the outputDir. Cleans up temp.
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var child_process = require("child_process");

var CLI = path.join(__dirname, "long-reasoning-build-preflight.js");

var pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); pass++; }

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lr-preflight-smoke-"));

// --- fake PDF with 3 "/Type /Page" markers (byte-scan should find 3) ---
var fakePdf = path.join(tmp, "fake.pdf");
fs.writeFileSync(
  fakePdf,
  "%PDF-1.4\n/Type /Page x\n/Type /Page y\n/Type /Page z\n/Type /Pages kids\n%%EOF",
  "utf-8"
);

// --- fresh staging dir (parent exists, the dir itself does NOT) ---
var freshOut = path.join(tmp, "staging-fresh");

// --- existing-KB dir ---
var existingDir = path.join(tmp, "existingbook");
fs.mkdirSync(path.join(existingDir, "knowledge_base"), { recursive: true });
fs.writeFileSync(path.join(existingDir, "knowledge_base", "index.json"), "{\"cards\":[]}", "utf-8");

function cleanup() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}

function runCli(argv) {
  var res = child_process.spawnSync(process.execPath, [CLI].concat(argv), { encoding: "utf-8" });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function parsePreflightJson(stdout) {
  var lines = stdout.split(/\r?\n/);
  for (var i = lines.length - 1; i >= 0; i--) {
    var m = lines[i].indexOf("PREFLIGHT_JSON:");
    if (m >= 0) return JSON.parse(lines[i].slice(m + "PREFLIGHT_JSON:".length).trim());
  }
  return null;
}

function main() {
  try {
    // 1. missing --src
    var rNoSrc = runCli([]);
    eq(rNoSrc.status, 1, "missing --src: exit 1");
    ok(/Usage:/.test(rNoSrc.stderr), "missing --src: prints usage");

    // 2. missing both --textbookDir and --outputDir
    var rNoDir = runCli(["--src", fakePdf]);
    eq(rNoDir.status, 1, "missing dir: exit 1");
    ok(/Usage:/.test(rNoDir.stderr), "missing dir: prints usage");

    // 3. normal preflight on a fresh outputDir, explicit page range
    var rOk = runCli([
      "--src", fakePdf, "--format", "pdf",
      "--outputDir", freshOut,
      "--startPage", "1", "--endPage", "8", "--pagesPerChunk", "4"
    ]);
    eq(rOk.status, 0, "fresh preflight: exit 0");
    var inv = parsePreflightJson(rOk.stdout);
    ok(inv && typeof inv === "object", "PREFLIGHT_JSON parses");
    eq(inv.srcExists, true, "src exists");
    eq(inv.wouldOverwriteExistingKb, false, "fresh: no overwrite");
    eq(inv.plannedPageCount, 8, "planned page count = 8 (pages 1..8)");
    eq(inv.estimatedChunks, 2, "estimated chunks = 2 (8 pages / 4)");
    ok(typeof inv.nextStepCommandDraft === "string" && inv.nextStepCommandDraft.indexOf("kb-builder.mjs") >= 0, "draft command mentions kb-builder");

    // CRITICAL: preflight must NOT create the outputDir
    ok(!fs.existsSync(freshOut), "preflight did NOT create outputDir");

    // 4. outputDir already has a knowledge_base => overwrite risk + exit 2
    var rOver = runCli([
      "--src", fakePdf, "--format", "pdf",
      "--outputDir", existingDir,
      "--startPage", "1", "--endPage", "10"
    ]);
    eq(rOver.status, 2, "overwrite: exit 2");
    var invOver = parsePreflightJson(rOver.stdout);
    eq(invOver.wouldOverwriteExistingKb, true, "overwrite flag set");
    ok(invOver.risks.some(function (r) { return /WOULD overwrite/.test(r); }), "overwrite risk listed");

    // 5. PDF byte-scan estimate present (3 markers) when no --endPage
    var rEst = runCli(["--src", fakePdf, "--format", "pdf", "--outputDir", freshOut, "--startPage", "1"]);
    eq(rEst.status, 0, "estimate-only preflight: exit 0");
    var invEst = parsePreflightJson(rEst.stdout);
    ok(invEst.pdfPageEstimate && invEst.pdfPageEstimate.count === 3, "byte-scan found 3 pages");
    eq(invEst.plannedPageCount, 3, "planned from estimate = 3");

    console.log("long-reasoning-build-preflight smoke test: " + pass + " assertions passed");
  } catch (e) {
    console.error("long-reasoning-build-preflight smoke test FAILED:", e && e.stack || e);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}
main();
