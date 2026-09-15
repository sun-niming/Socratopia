// Read-only PRE-FLIGHT for long-distance reasoning strong-validation KB builds.
//
// Purpose: before anyone runs `kb-builder.mjs` to generate a larger-page-span
// knowledge base for long-distance reasoning *strong* validation, this tool
// inspects the inputs and reports what such a build WOULD do — without calling
// any model, without generating a KB, and without creating the output dir.
//
// kb-builder.mjs (the real worker) reads its job from env vars:
//   KB_TEXTBOOK_DIR  KB_SRC_PATH  KB_FORMAT  KB_START_PAGE  KB_END_PAGE
//   KB_PAGES_PER_CHUNK  KB_MAX_CHUNKS  (+ KB_CARD_* / KB_VISION_*)
// and ALWAYS writes to <KB_TEXTBOOK_DIR>/knowledge_base (no custom outputDir,
// no dry-run flag). So the only safe way to avoid clobbering an existing KB is
// to point KB_TEXTBOOK_DIR at a fresh staging dir. This preflight surfaces that
// overwrite risk explicitly.
//
// Usage:
//   node resources/server/lib/reasoning/long-reasoning-build-preflight.js \
//     --src "C:/.../Linux.pdf" --format pdf \
//     --textbookDir "C:/.../KUbm" \
//     --startPage 1 --endPage 95 --pagesPerChunk 4 \
//     --outputDir "C:/.../staging-linux-strong"
//
// Properties:
//   - READ-ONLY: never writes/moves/deletes; never creates outputDir; never
//     calls a model; no network; no new dependencies; CommonJS.
//   - Explicit args only — never auto-scans the disk.
//   - PDF page count is read via pdfjs *only if* it resolves cleanly; otherwise
//     it honestly reports "page count unknown (pdfjs unavailable in preflight)".
//   - Prints a Markdown summary plus a final "PREFLIGHT_JSON: {...}" line.
"use strict";

var fs = require("fs");
var path = require("path");

// ---- args ----

function parseArgs(argv) {
  var out = {};
  for (var i = 0; i < argv.length; i++) {
    var tok = argv[i];
    if (tok.indexOf("--") !== 0) continue;
    var key, val;
    var eq = tok.indexOf("=");
    if (eq >= 0) {
      key = tok.slice(2, eq);
      val = tok.slice(eq + 1);
    } else {
      key = tok.slice(2);
      if (i + 1 < argv.length && argv[i + 1].indexOf("--") !== 0) {
        val = argv[++i];
      } else {
        val = "true";
      }
    }
    out[key] = val;
  }
  return out;
}

function usage(msg) {
  if (msg) console.error("Error: " + msg + "\n");
  console.error([
    "Usage:",
    "  node long-reasoning-build-preflight.js --src <file> --format pdf|markdown \\",
    "    --textbookDir <dir> [--startPage N] [--endPage N] \\",
    "    [--pagesPerChunk N] [--outputDir <dir>]",
    "",
    "READ-ONLY preflight: inspects a planned kb-builder run and reports page",
    "range, estimated chunks, and whether the output would overwrite an existing",
    "knowledge_base. Never calls a model, never writes, never creates outputDir.",
    "",
    "Required: --src and (--textbookDir or --outputDir).",
    "If neither --endPage nor a readable PDF page count is available, the page",
    "count is reported as unknown (no fabrication)."
  ].join("\n"));
}

// ---- helpers ----

function statSafe(p) {
  try { return fs.statSync(p); } catch (e) { return null; }
}

function dirHasKnowledgeBase(dir) {
  try {
    var kb = path.join(dir, "knowledge_base");
    return fs.existsSync(path.join(kb, "index.json"));
  } catch (e) { return false; }
}

// Try to read a PDF's page count WITHOUT a hard dependency. pdfjs is bundled
// for the real worker but loading it from a CommonJS preflight is fragile, so
// we (a) try a cheap byte-scan for "/Type /Page" markers as a rough estimate,
// and (b) clearly flag it as approximate. We never claim an exact count we
// cannot verify.
function estimatePdfPageCount(srcPath) {
  try {
    var buf = fs.readFileSync(srcPath);
    var txt = buf.toString("latin1");
    // Count "/Type /Page" not followed by "s" (avoid /Pages tree node).
    var re = /\/Type\s*\/Page(?![\w])/g;
    var n = 0;
    while (re.exec(txt) !== null) n++;
    if (n > 0) return { count: n, method: "byte-scan (approx)", exact: false };
    return { count: null, method: "byte-scan found no /Type /Page markers", exact: false };
  } catch (e) {
    return { count: null, method: "unreadable: " + (e && e.message), exact: false };
  }
}

// ---- main ----

function main() {
  var args = parseArgs(process.argv.slice(2));

  var src = args.src && args.src !== "true" ? args.src : null;
  var format = (args.format && args.format !== "true" ? args.format : "").toLowerCase();
  var textbookDir = args.textbookDir && args.textbookDir !== "true" ? args.textbookDir : null;
  var outputDir = args.outputDir && args.outputDir !== "true" ? args.outputDir : null;

  if (!src) { usage("missing required --src <file>"); process.exitCode = 1; return; }
  if (!textbookDir && !outputDir) {
    usage("missing required --textbookDir or --outputDir");
    process.exitCode = 1;
    return;
  }

  // Infer format from extension if not given.
  if (!format) {
    var ext = path.extname(src).toLowerCase();
    if (ext === ".pdf") format = "pdf";
    else if (ext === ".md" || ext === ".markdown") format = "markdown";
    else format = "unknown";
  }

  var startPage = args.startPage ? Number(args.startPage) : 1;
  if (!isFinite(startPage) || startPage < 1) startPage = 1;
  var endPage = args.endPage ? Number(args.endPage) : 0; // 0 = to end
  if (!isFinite(endPage) || endPage < 0) endPage = 0;
  var pagesPerChunk = args.pagesPerChunk ? Number(args.pagesPerChunk) : 4;
  if (!isFinite(pagesPerChunk) || pagesPerChunk < 1) pagesPerChunk = 4;

  // The kb-builder ALWAYS writes to <KB_TEXTBOOK_DIR>/knowledge_base.
  // The effective build target is outputDir if given, else textbookDir.
  var buildTarget = outputDir || textbookDir;

  var report = {
    src: src,
    format: format,
    srcExists: false,
    srcSizeBytes: null,
    textbookDir: textbookDir,
    outputDir: outputDir,
    buildTarget: buildTarget,
    buildTargetExists: false,
    wouldOverwriteExistingKb: false,
    startPage: startPage,
    endPage: endPage || null,
    pagesPerChunk: pagesPerChunk,
    pdfPageEstimate: null,
    plannedPageCount: null,
    estimatedChunks: null,
    risks: [],
    nextStepCommandDraft: null
  };

  // --- source file ---
  var srcStat = statSafe(src);
  if (!srcStat || !srcStat.isFile()) {
    report.risks.push("source file does NOT exist or is not a file: " + src);
  } else {
    report.srcExists = true;
    report.srcSizeBytes = srcStat.size;
  }

  // --- build target / overwrite risk ---
  var btStat = statSafe(buildTarget);
  report.buildTargetExists = !!(btStat && btStat.isDirectory());
  if (report.buildTargetExists && dirHasKnowledgeBase(buildTarget)) {
    report.wouldOverwriteExistingKb = true;
    report.risks.push(
      "buildTarget already contains knowledge_base/index.json — running kb-builder " +
      "against this dir WOULD overwrite the existing KB: " + path.join(buildTarget, "knowledge_base")
    );
  }
  if (outputDir && !report.buildTargetExists) {
    report.risks.push(
      "outputDir does not exist yet (preflight will NOT create it); kb-builder " +
      "creates <dir>/knowledge_base via mkdirSync at build time"
    );
  }

  // --- page count + chunk estimate ---
  if (format === "pdf" && report.srcExists) {
    report.pdfPageEstimate = estimatePdfPageCount(src);
  }

  var lastPage = null;
  if (endPage > 0) {
    lastPage = endPage;
  } else if (report.pdfPageEstimate && report.pdfPageEstimate.count) {
    lastPage = report.pdfPageEstimate.count;
  }

  if (lastPage != null) {
    var pageCount = Math.max(0, lastPage - startPage + 1);
    report.plannedPageCount = pageCount;
    report.estimatedChunks = pageCount > 0 ? Math.ceil(pageCount / pagesPerChunk) : 0;
    if (report.pdfPageEstimate && !report.pdfPageEstimate.exact && endPage <= 0) {
      report.risks.push(
        "plannedPageCount/estimatedChunks are APPROXIMATE (derived from a byte-scan " +
        "PDF page estimate, not an exact pdfjs count). Pass --endPage to pin the range."
      );
    }
  } else {
    report.risks.push(
      "page count unknown (no --endPage and no readable PDF page estimate); " +
      "cannot estimate chunks — pass --endPage to plan precisely"
    );
  }

  if (format === "unknown") {
    report.risks.push("format could not be inferred; pass --format pdf|markdown");
  }

  // --- next-step command draft (NOT executed) ---
  if (report.srcExists && buildTarget) {
    report.nextStepCommandDraft =
      "node resources/server/lib/kb-builder.mjs   " +
      "# with env: KB_TEXTBOOK_DIR=\"" + buildTarget + "\" " +
      "KB_SRC_PATH=\"" + src + "\" KB_FORMAT=" + format +
      " KB_START_PAGE=" + startPage +
      (endPage > 0 ? " KB_END_PAGE=" + endPage : "") +
      " KB_PAGES_PER_CHUNK=" + pagesPerChunk +
      " (+ KB_CARD_BASEURL/KB_CARD_APIKEY/KB_CARD_MODEL from set.json/settings.json)";
  }

  // ---- output ----
  console.log("=== long-reasoning build preflight (READ-ONLY) ===");
  console.log("");
  console.log("| field | value |");
  console.log("|---|---|");
  console.log("| src | " + mdEscape(src) + " |");
  console.log("| format | " + mdEscape(format) + " |");
  console.log("| srcExists | " + report.srcExists + " |");
  console.log("| srcSizeBytes | " + (report.srcSizeBytes == null ? "-" : report.srcSizeBytes) + " |");
  console.log("| buildTarget | " + mdEscape(buildTarget) + " |");
  console.log("| buildTargetExists | " + report.buildTargetExists + " |");
  console.log("| wouldOverwriteExistingKb | " + report.wouldOverwriteExistingKb + " |");
  console.log("| startPage | " + report.startPage + " |");
  console.log("| endPage | " + (report.endPage == null ? "(to end)" : report.endPage) + " |");
  console.log("| pagesPerChunk | " + report.pagesPerChunk + " |");
  console.log("| pdfPageEstimate | " + (report.pdfPageEstimate ? mdEscape((report.pdfPageEstimate.count == null ? "?" : report.pdfPageEstimate.count) + " / " + report.pdfPageEstimate.method) : "-") + " |");
  console.log("| plannedPageCount | " + (report.plannedPageCount == null ? "unknown" : report.plannedPageCount) + " |");
  console.log("| estimatedChunks | " + (report.estimatedChunks == null ? "unknown" : report.estimatedChunks) + " |");
  console.log("");

  console.log("Risks:");
  if (report.risks.length === 0) console.log("  (none detected)");
  report.risks.forEach(function (r) { console.log("  - " + r); });
  console.log("");

  console.log("Next-step command draft (NOT executed):");
  console.log("  " + (report.nextStepCommandDraft || "(unavailable — fix the risks above first)"));
  console.log("");

  console.log("PREFLIGHT_JSON: " + JSON.stringify(report));

  // Exit non-zero if the planned build is unsafe/unrunnable as-is.
  if (!report.srcExists || report.wouldOverwriteExistingKb) {
    process.exitCode = 2;
  }
}

function mdEscape(v) {
  return String(v == null ? "" : v).replace(/\|/g, "\\|");
}

main();
