// Read-only KB inventory for long-distance reasoning validation prep.
//
// Recursively scans a --root directory for textbook knowledge bases
// (knowledge_base/index.json + cards/*.json) and reports, per KB, how
// suitable it is for *long-distance* (cross-page / cross-chapter)
// reasoning validation: card count, page-span, mappable prerequisites,
// whether a teaching_map.json exists, and the original source file.
//
// Usage:
//   node resources/server/lib/reasoning/long-reasoning-kb-inventory.js \
//     --root "C:/Users/ASUS/AppData/Roaming/socratopia"
//
// Properties:
//   - READ-ONLY: never writes/moves/deletes anything; never builds a KB.
//   - No --root => prints usage and exits 1 (never auto-scans the disk).
//   - No network, no new dependencies, CommonJS.
//   - Tolerates a leading UTF-8 BOM in index.json / cards / teaching_map.
//   - Prints a Markdown table (paste-ready for report.md) plus a final
//     "INVENTORY_JSON: [...]" line for downstream scripts to parse.
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
    "  node long-reasoning-kb-inventory.js --root <dir to scan>",
    "",
    "Recursively finds knowledge_base/index.json under <dir>, then reports",
    "card count, page-span, mappable prerequisites, teaching_map presence",
    "and source file per KB. READ-ONLY; never writes or builds anything.",
    "A --root is REQUIRED so the tool never auto-scans your whole disk."
  ].join("\n"));
}

// ---- read helpers (tolerant) ----

function readJSONSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    var text = fs.readFileSync(filePath, "utf-8");
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// Recursively collect directories that contain knowledge_base/index.json.
// Skips node_modules / dot-dirs, never follows into a found KB's cards,
// and is depth-limited so a huge tree can't run away. Read-only.
function findKbDirs(root, maxDepth) {
  var found = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    var entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return; // unreadable dir -> skip
    }
    // Is THIS dir a knowledge_base with an index.json?
    if (path.basename(dir).toLowerCase() === "knowledge_base"
        && fs.existsSync(path.join(dir, "index.json"))) {
      found.push(dir);
      return; // don't descend into cards/
    }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.isDirectory()) continue;
      var name = e.name;
      if (name === "node_modules" || name.charAt(0) === ".") continue;
      walk(path.join(dir, name), depth + 1);
    }
  }
  walk(root, 0);
  return found;
}

// ---- per-KB analysis ----

var SOURCE_EXTS = [".pdf", ".md", ".pptx", ".ppt", ".qbook", ".epub"];

function findSourceFiles(textbookDir) {
  var hits = [];
  try {
    var entries = fs.readdirSync(textbookDir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.isFile()) continue;
      var ext = path.extname(e.name).toLowerCase();
      if (SOURCE_EXTS.indexOf(ext) >= 0) hits.push(e.name);
    }
  } catch (e) { /* ignore */ }
  return hits;
}

// Analyze one knowledge_base dir. Read-only; never throws.
function analyzeKb(kbDir) {
  var textbookDir = path.dirname(kbDir);
  var index = readJSONSafe(path.join(kbDir, "index.json")) || {};
  var cardsDir = path.join(kbDir, "cards");

  var refs = Array.isArray(index.cards) ? index.cards : [];
  var cards = [];
  for (var i = 0; i < refs.length; i++) {
    var cid = (refs[i] && refs[i].concept_id) || "";
    if (!cid) continue;
    var card = readJSONSafe(path.join(cardsDir, cid + ".json"));
    if (card) {
      if (!card.concept_id) card.concept_id = cid;
      cards.push(card);
    }
  }
  // Fallback: if index had no usable refs, read cards/*.json directly.
  if (cards.length === 0) {
    try {
      var files = fs.readdirSync(cardsDir);
      for (var j = 0; j < files.length; j++) {
        if (path.extname(files[j]).toLowerCase() !== ".json") continue;
        var c2 = readJSONSafe(path.join(cardsDir, files[j]));
        if (c2) {
          if (!c2.concept_id) c2.concept_id = path.basename(files[j], ".json");
          cards.push(c2);
        }
      }
    } catch (e) { /* no cards dir */ }
  }

  // Page span across all cards' source_pages.
  var minPage = null, maxPage = null;
  cards.forEach(function (c) {
    if (!Array.isArray(c.source_pages)) return;
    c.source_pages.forEach(function (p) {
      if (typeof p !== "number" || !isFinite(p)) return;
      if (minPage === null || p < minPage) minPage = p;
      if (maxPage === null || p > maxPage) maxPage = p;
    });
  });
  var span = (minPage === null || maxPage === null) ? 0 : (maxPage - minPage + 1);

  // Build title + concept_id lookup for prerequisite mapping.
  var known = {};
  cards.forEach(function (c) {
    if (c.title != null) known[String(c.title)] = true;
    if (c.concept_id != null) known[String(c.concept_id)] = true;
  });

  var prereqTotal = 0, prereqMappable = 0;
  var cardsWithPrereq = 0;
  cards.forEach(function (c) {
    if (!Array.isArray(c.prerequisites) || c.prerequisites.length === 0) return;
    cardsWithPrereq++;
    c.prerequisites.forEach(function (p) {
      prereqTotal++;
      if (known[String(p)]) prereqMappable++;
    });
  });

  var hasTeachingMap = fs.existsSync(path.join(kbDir, "teaching_map.json"));
  var sourceFiles = findSourceFiles(textbookDir);

  var level = recommend({
    cards: cards.length,
    span: span,
    prereqMappable: prereqMappable
  });

  return {
    textbookDir: textbookDir,
    title: index.title || index.textbook_title || "",
    cards: cards.length,
    minPage: minPage,
    maxPage: maxPage,
    span: span,
    hasTeachingMap: hasTeachingMap,
    cardsWithPrereq: cardsWithPrereq,
    prereqTotal: prereqTotal,
    prereqMappable: prereqMappable,
    sourceFiles: sourceFiles,
    level: level
  };
}

// high  : cards >= 30 && span >= 30 && prereqMappable >= 2 (multi cross-card links)
// medium: cards >= 10 && span >= 10 && prereqMappable >= 1
// low   : everything else (few cards / pages concentrated, like Linux.pdf today)
function recommend(s) {
  if (s.cards >= 30 && s.span >= 30 && s.prereqMappable >= 2) return "high";
  if (s.cards >= 10 && s.span >= 10 && s.prereqMappable >= 1) return "medium";
  return "low";
}

// ---- output ----

function mdEscape(v) {
  return String(v == null ? "" : v).replace(/\|/g, "\\|");
}

function printMarkdown(rows) {
  console.log("");
  console.log("| textbookDir | title | cards | pageMin | pageMax | span | teaching_map | cardsWithPrereq | prereqTotal | prereqMappable | sourceFiles | level |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
  rows.forEach(function (r) {
    console.log("| " + [
      mdEscape(r.textbookDir),
      mdEscape(r.title),
      r.cards,
      r.minPage == null ? "-" : r.minPage,
      r.maxPage == null ? "-" : r.maxPage,
      r.span,
      r.hasTeachingMap ? "yes" : "no",
      r.cardsWithPrereq,
      r.prereqTotal,
      r.prereqMappable,
      mdEscape(r.sourceFiles.join(", ") || "-"),
      r.level
    ].join(" | ") + " |");
  });
  console.log("");
}

function main() {
  var args = parseArgs(process.argv.slice(2));
  if (!args.root || args.root === "true") {
    usage("missing required --root <dir>");
    process.exitCode = 1;
    return;
  }
  var root = path.resolve(args.root);
  if (!fs.existsSync(root)) {
    usage("root does not exist: " + root);
    process.exitCode = 1;
    return;
  }

  var maxDepth = args.maxDepth ? Number(args.maxDepth) : 12;
  if (!isFinite(maxDepth) || maxDepth < 1) maxDepth = 12;

  console.log("=== long-reasoning KB inventory ===");
  console.log("root      : " + root);
  console.log("maxDepth  : " + maxDepth);

  var kbDirs = findKbDirs(root, maxDepth);
  console.log("KBs found : " + kbDirs.length);

  var rows = kbDirs.map(analyzeKb);
  // Sort best candidates first: level rank, then cards, then span.
  var rank = { high: 0, medium: 1, low: 2 };
  rows.sort(function (a, b) {
    if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
    if (b.cards !== a.cards) return b.cards - a.cards;
    return b.span - a.span;
  });

  printMarkdown(rows);

  var counts = { high: 0, medium: 0, low: 0 };
  rows.forEach(function (r) { counts[r.level]++; });
  console.log("levels    : high=" + counts.high + " medium=" + counts.medium + " low=" + counts.low);

  // Final machine-readable line for downstream parsing.
  console.log("INVENTORY_JSON: " + JSON.stringify(rows));
}

main();
