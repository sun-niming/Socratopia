// Real-KB validation CLI for the long-distance reasoning Demo.
//
// Points the SAME helper (lib/reasoning/long-context.js) used by
// /api/long-reasoning-demo at a real textbook directory, so a developer can
// verify that a real knowledge_base/ recalls long-distance prerequisite
// concepts and produces a usable LONG_REASONING_CONTEXT prompt block.
//
// Usage:
//   node resources/server/lib/reasoning/long-reasoning-real-kb-check.js \
//     --profileId p --worldId w --textbookId t --textbookDir "..." --focusPage 80
//   node resources/server/lib/reasoning/long-reasoning-real-kb-check.js \
//     --profileId p --worldId w --textbookId t --textbookDir "..." --focusConceptId "xxx"
//   (--query "..." is also a valid focus selector; --maxDepth defaults to the helper's 2)
//
// Properties:
//   - READ-ONLY: never writes into the textbook dir, never persists a dry-run graph.
//   - No network, no new dependencies, CommonJS.
//   - Accepts EXPLICIT args only; never scans the filesystem for textbooks.
//   - Unlike the HTTP route, this dev tool calls the helper directly and does NOT
//     enforce the route's PROJECT_ROOT containment check. When --textbookDir is
//     given it is used for helper-layer validation regardless of PROJECT_ROOT.
//     (The route still enforces invalid_textbook_dir for HTTP callers.)
"use strict";

var path = require("path");

var KNOWN = ["profileId", "worldId", "textbookId", "textbookDir", "focusPage", "focusConceptId", "query", "maxDepth"];

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
      // consume the next token as value unless it's another flag
      if (i + 1 < argv.length && argv[i + 1].indexOf("--") !== 0) {
        val = argv[++i];
      } else {
        val = "true";
      }
    }
    if (KNOWN.indexOf(key) >= 0) out[key] = val;
  }
  return out;
}

function usage(msg) {
  if (msg) console.error("Error: " + msg + "\n");
  console.error([
    "Usage:",
    "  node long-reasoning-real-kb-check.js --profileId P --worldId W --textbookId T \\",
    "       --textbookDir \"<abs path>\" (--focusPage N | --focusConceptId ID | --query \"text\") [--maxDepth N]",
    "",
    "Required: --profileId --worldId --textbookId",
    "At least one focus selector: --focusPage | --focusConceptId | --query",
    "Optional: --textbookDir (real KB dir), --maxDepth (default 2)"
  ].join("\n"));
}

function previewPromptBlock(block, n) {
  if (typeof block !== "string" || !block) return "(none)";
  var lines = block.split("\n");
  var head = lines.slice(0, n);
  var tail = lines.length > n ? "\n  ... (" + (lines.length - n) + " more lines)" : "";
  return head.map(function (l) { return "  " + l; }).join("\n") + tail;
}

async function main() {
  var args = parseArgs(process.argv.slice(2));

  if (!args.profileId || !args.worldId || !args.textbookId) {
    usage("missing required --profileId / --worldId / --textbookId");
    process.exitCode = 1;
    return;
  }
  var hasFocus = (args.focusPage != null && args.focusPage !== "")
    || (args.focusConceptId != null && args.focusConceptId !== "")
    || (args.query != null && args.query !== "");
  if (!hasFocus) {
    usage("provide at least one focus selector: --focusPage / --focusConceptId / --query");
    process.exitCode = 1;
    return;
  }

  // Best-effort global wiring so source resolution mirrors the route:
  // saved_graph (via __ADAPTIVE__) -> dry_graph (via __ADAPTIVE_CONCEPT_GRAPH__)
  // -> kb_fallback. Missing globals are fine; the helper still does kb_fallback.
  try { global.__ADAPTIVE__ = require("../adaptive/data-layer.js"); } catch (e) { /* optional */ }
  try { global.__ADAPTIVE_CONCEPT_GRAPH__ = require("../adaptive/concept-graph-builder.js"); } catch (e) { /* optional */ }

  var L = require("./long-context.js");

  var input = {
    profileId: args.profileId,
    worldId: args.worldId,
    textbookId: args.textbookId
  };
  if (args.textbookDir != null && args.textbookDir !== "") input.textbookDir = args.textbookDir;
  if (args.focusConceptId != null && args.focusConceptId !== "") input.focusConceptId = args.focusConceptId;
  if (args.query != null && args.query !== "") input.query = args.query;
  if (args.focusPage != null && args.focusPage !== "") {
    var fp = Number(args.focusPage);
    if (isFinite(fp)) input.focusPage = fp;
  }
  if (args.maxDepth != null && args.maxDepth !== "") {
    var md = Number(args.maxDepth);
    if (isFinite(md)) input.maxDepth = md;
  }

  var result;
  try {
    result = await L.buildLongReasoningContext(input);
  } catch (e) {
    console.error("buildLongReasoningContext threw:", e && e.stack || e);
    process.exitCode = 1;
    return;
  }

  result = result || {};
  console.log("=== long-reasoning real-KB check ===");
  console.log("input.textbookDir : " + (input.textbookDir || "(derived/none)"));
  console.log("ok                : " + result.ok);
  if (!result.ok) {
    console.log("error             : " + result.error);
    console.log("message           : " + (result.message || ""));
    if (result.source) console.log("source            : " + result.source);
    process.exitCode = 1;
    return;
  }

  console.log("source            : " + result.source);
  var f = result.focus || {};
  console.log("focus             : " + f.conceptId + "  \"" + (f.title || "") + "\"  pages=" + JSON.stringify(f.sourcePages || []));

  var deps = result.dependencies || [];
  console.log("dependencies (" + deps.length + ") : " + deps.map(function (d) { return d.conceptId; }).join(", "));
  var related = result.related || [];
  console.log("related (" + related.length + ")      : " + related.map(function (d) { return d.conceptId; }).join(", "));
  var missing = result.missingPrerequisites || [];
  console.log("missingPrereqs (" + missing.length + "): " + missing.join(", "));
  var ev = result.evidenceCards || [];
  console.log("evidenceCards     : " + ev.length);
  console.log("promptBlock (head):");
  console.log(previewPromptBlock(result.promptBlock, 8));
}

main();
