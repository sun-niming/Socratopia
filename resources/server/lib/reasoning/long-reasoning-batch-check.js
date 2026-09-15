// Batch validation CLI for the long-distance reasoning Demo.
//
// Reads a cases JSON file and runs the SAME helper
// (lib/reasoning/long-context.js) used by /api/long-reasoning-demo against
// each case, then prints a per-case summary and a PASS/FAIL verdict, so a
// developer can validate that a real knowledge_base/ recalls the correct
// long-distance prerequisite concepts for several scenarios at once.
//
// Usage:
//   node resources/server/lib/reasoning/long-reasoning-batch-check.js \
//     --cases resources/server/lib/reasoning/long-reasoning-cases.example.json
//
// Cases JSON shape (see long-reasoning-cases.example.json):
//   { profileId, worldId, textbookId, textbookDir, cases: [ {
//       id, name, focusPage?, focusConceptId?, query?, maxDepth?,
//       expectedFocusAny?:[], expectedDependenciesAny?:[], forbiddenDependencies?:[]
//   } ] }
//
// Properties:
//   - READ-ONLY: never writes into the textbook dir, never persists a dry-run graph.
//   - No network, no new dependencies, CommonJS.
//   - Tolerates a leading UTF-8 BOM in the cases JSON.
//   - Like long-reasoning-real-kb-check.js, this dev tool calls the helper
//     directly and does NOT enforce the route's PROJECT_ROOT containment check.
//   - exitCode = 1 if any case FAILs, or on missing/invalid --cases.
"use strict";

var fs = require("fs");

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
    "  node long-reasoning-batch-check.js --cases <path to cases.json>",
    "",
    "Cases JSON: { profileId, worldId, textbookId, textbookDir, cases: [...] }",
    "Each case: { id, name, focusPage?, focusConceptId?, query?, maxDepth?,",
    "             expectedFocusAny?, expectedDependenciesAny?, forbiddenDependencies? }"
  ].join("\n"));
}

function readCasesFile(filePath) {
  var text = fs.readFileSync(filePath, "utf-8");
  // Tolerate a leading UTF-8 BOM.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return JSON.parse(text);
}

// Case-insensitive substring match: does `haystack` contain `needle`?
function ciIncludes(haystack, needle) {
  if (haystack == null || needle == null) return false;
  return String(haystack).toLowerCase().indexOf(String(needle).toLowerCase()) >= 0;
}

// Does any keyword appear in any of the provided text fields?
function anyKeywordHits(keywords, texts) {
  for (var i = 0; i < keywords.length; i++) {
    for (var j = 0; j < texts.length; j++) {
      if (ciIncludes(texts[j], keywords[i])) return true;
    }
  }
  return false;
}

function depTexts(dependencies) {
  var texts = [];
  (dependencies || []).forEach(function (d) {
    if (d && d.title != null) texts.push(d.title);
    if (d && d.conceptId != null) texts.push(d.conceptId);
  });
  return texts;
}

// Evaluate one case result against its expectations.
// Returns { pass:Boolean, reasons:[String] }.
function evaluateCase(c, result) {
  var reasons = [];
  if (!result || result.ok !== true) {
    reasons.push("helper returned ok:false (" + ((result && result.error) || "unknown") + ")");
    return { pass: false, reasons: reasons };
  }

  var focus = result.focus || {};
  var focusTexts = [focus.title, focus.conceptId];
  var deps = depTexts(result.dependencies);

  var expFocus = Array.isArray(c.expectedFocusAny) ? c.expectedFocusAny.filter(Boolean) : [];
  if (expFocus.length && !anyKeywordHits(expFocus, focusTexts)) {
    reasons.push("expectedFocusAny missed: none of [" + expFocus.join(", ") + "] in focus \"" + (focus.title || "") + "\"/" + (focus.conceptId || ""));
  }

  var expDeps = Array.isArray(c.expectedDependenciesAny) ? c.expectedDependenciesAny.filter(Boolean) : [];
  if (expDeps.length && !anyKeywordHits(expDeps, deps)) {
    reasons.push("expectedDependenciesAny missed: none of [" + expDeps.join(", ") + "] in dependencies");
  }

  var forbidden = Array.isArray(c.forbiddenDependencies) ? c.forbiddenDependencies.filter(Boolean) : [];
  for (var i = 0; i < forbidden.length; i++) {
    if (anyKeywordHits([forbidden[i]], deps)) {
      reasons.push("forbiddenDependencies hit: \"" + forbidden[i] + "\" present in dependencies");
    }
  }

  return { pass: reasons.length === 0, reasons: reasons };
}

function previewPromptBlock(block, n) {
  if (typeof block !== "string" || !block) return "  (none)";
  var lines = block.split("\n");
  var head = lines.slice(0, n);
  var tail = lines.length > n ? "\n  ... (" + (lines.length - n) + " more lines)" : "";
  return head.map(function (l) { return "    " + l; }).join("\n") + tail;
}

function buildInput(top, c) {
  var input = {
    profileId: top.profileId,
    worldId: top.worldId,
    textbookId: top.textbookId
  };
  if (top.textbookDir != null && top.textbookDir !== "") input.textbookDir = top.textbookDir;
  if (c.focusConceptId != null && c.focusConceptId !== "") input.focusConceptId = c.focusConceptId;
  if (c.query != null && c.query !== "") input.query = c.query;
  if (c.focusPage != null && c.focusPage !== "") {
    var fp = Number(c.focusPage);
    if (isFinite(fp) && fp > 0) input.focusPage = fp;
  }
  if (c.maxDepth != null && c.maxDepth !== "") {
    var md = Number(c.maxDepth);
    if (isFinite(md)) input.maxDepth = md;
  }
  return input;
}

async function main() {
  var args = parseArgs(process.argv.slice(2));

  if (!args.cases || args.cases === "true") {
    usage("missing required --cases <path>");
    process.exitCode = 1;
    return;
  }

  var doc;
  try {
    doc = readCasesFile(args.cases);
  } catch (e) {
    usage("could not read/parse cases JSON: " + (e && e.message));
    process.exitCode = 1;
    return;
  }

  if (!doc || !Array.isArray(doc.cases) || doc.cases.length === 0) {
    usage("cases JSON must contain a non-empty \"cases\" array");
    process.exitCode = 1;
    return;
  }

  // Best-effort global wiring so source resolution mirrors the route:
  // saved_graph -> dry_graph -> kb_fallback. Missing globals are fine.
  try { global.__ADAPTIVE__ = require("../adaptive/data-layer.js"); } catch (e) { /* optional */ }
  try { global.__ADAPTIVE_CONCEPT_GRAPH__ = require("../adaptive/concept-graph-builder.js"); } catch (e) { /* optional */ }

  var L = require("./long-context.js");

  var top = {
    profileId: doc.profileId,
    worldId: doc.worldId,
    textbookId: doc.textbookId,
    textbookDir: doc.textbookDir
  };

  var total = 0, passed = 0, failed = 0;

  console.log("=== long-reasoning batch check ===");
  console.log("cases file        : " + args.cases);
  console.log("textbookDir       : " + (top.textbookDir || "(derived/none)"));
  console.log("total cases       : " + doc.cases.length);

  for (var i = 0; i < doc.cases.length; i++) {
    var c = doc.cases[i] || {};
    total++;
    var input = buildInput(top, c);

    var result;
    try {
      result = await L.buildLongReasoningContext(input);
    } catch (e) {
      result = { ok: false, error: "threw", message: e && e.message };
    }
    result = result || {};

    var verdict = evaluateCase(c, result);
    if (verdict.pass) passed++; else failed++;

    var focus = result.focus || {};
    var deps = result.dependencies || [];
    var missing = result.missingPrerequisites || [];
    var ev = result.evidenceCards || [];

    console.log("\n--- case " + (i + 1) + "/" + doc.cases.length + " ---");
    console.log("id                : " + (c.id || "(no id)"));
    console.log("name              : " + (c.name || ""));
    console.log("ok                : " + result.ok + (result.ok ? "" : "  error=" + (result.error || "")));
    console.log("source            : " + (result.source || "(none)"));
    console.log("focus             : " + (focus.conceptId || "") + "  \"" + (focus.title || "") + "\"  pages=" + JSON.stringify(focus.sourcePages || []));
    console.log("dependencies (" + deps.length + ") : " + deps.map(function (d) { return (d.title || "") + "[" + d.conceptId + "]"; }).join(", "));
    console.log("missingPrereqs (" + missing.length + "): " + missing.join(", "));
    console.log("evidenceCards     : " + ev.length);
    console.log("promptBlock (head):");
    console.log(previewPromptBlock(result.promptBlock, 6));
    console.log("verdict           : " + (verdict.pass ? "PASS" : "FAIL"));
    if (!verdict.pass) {
      verdict.reasons.forEach(function (r) { console.log("  - " + r); });
    }
  }

  console.log("\n=== summary ===");
  console.log("total  : " + total);
  console.log("passed : " + passed);
  console.log("failed : " + failed);

  if (failed > 0) process.exitCode = 1;
}

main();
