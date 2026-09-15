/**
 * long-reasoning-edge-audit.js — READ-ONLY prerequisite-edge page-distance audit.
 *
 * Quantifies how far apart (in source pages) each mappable prerequisite edge
 * reaches in a knowledge base, so we can tell whether prerequisites stay inside
 * a single ~4-page build chunk or genuinely span chapters / chunks.
 *
 * NEVER writes anything: does not touch cards/index/teaching_map, does not emit
 * long_edges.json. Pure inspection + a Markdown table + a single JSON line.
 *
 * Usage:
 *   node long-reasoning-edge-audit.js --textbookDir <dir>
 *
 * Reads <textbookDir>/knowledge_base/index.json and cards/*.json.
 */
"use strict";

var fs = require("fs");
var path = require("path");

function usage(msg) {
  if (msg) console.error("ERROR: " + msg);
  console.error("Usage: node long-reasoning-edge-audit.js --textbookDir <dir>");
}

function parseArgs(argv) {
  var out = {};
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === "--textbookDir") { out.textbookDir = argv[++i]; }
  }
  return out;
}

// Tolerate UTF-8 BOM.
function readJson(file) {
  var s = fs.readFileSync(file, "utf-8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return JSON.parse(s);
}

function asArray(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

// Pull a flat list of integer page numbers from a card's source_pages-ish field.
function cardPages(card) {
  if (!card) return [];
  var raw = card.source_pages != null ? card.source_pages
    : (card.sourcePages != null ? card.sourcePages
    : (card.pages != null ? card.pages : []));
  var pages = [];
  asArray(raw).forEach(function (p) {
    if (typeof p === "number" && isFinite(p)) { pages.push(p); return; }
    if (p && typeof p === "object") {
      // {start,end} or {from,to}
      var a = p.start != null ? p.start : p.from;
      var b = p.end != null ? p.end : p.to;
      if (typeof a === "number") pages.push(a);
      if (typeof b === "number") pages.push(b);
      return;
    }
    var n = parseInt(p, 10);
    if (!isNaN(n)) pages.push(n);
  });
  return pages;
}

// Max absolute page gap across any pairing of the two page lists.
function absMaxGap(aPages, bPages) {
  if (!aPages.length || !bPages.length) return null;
  var aMin = Math.min.apply(null, aPages), aMax = Math.max.apply(null, aPages);
  var bMin = Math.min.apply(null, bPages), bMax = Math.max.apply(null, bPages);
  return Math.max(Math.abs(aMax - bMin), Math.abs(bMax - aMin));
}

// Min interval gap between the two page ranges (0 if they overlap/touch).
function minGap(aPages, bPages) {
  if (!aPages.length || !bPages.length) return null;
  var aMin = Math.min.apply(null, aPages), aMax = Math.max.apply(null, aPages);
  var bMin = Math.min.apply(null, bPages), bMax = Math.max.apply(null, bPages);
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

function loadCards(kbDir) {
  var cardsDir = path.join(kbDir, "cards");
  var cards = [];
  if (!fs.existsSync(cardsDir)) return cards;
  fs.readdirSync(cardsDir).forEach(function (f) {
    if (!/\.json$/i.test(f)) return;
    try { cards.push(readJson(path.join(cardsDir, f))); } catch (e) {}
  });
  return cards;
}

function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

function run(textbookDir) {
  var kbDir = path.join(textbookDir, "knowledge_base");
  var indexPath = path.join(kbDir, "index.json");
  var index = null;
  try { index = readJson(indexPath); } catch (e) {}
  var title = (index && (index.title || index.textbook_title)) || "";

  var cards = loadCards(kbDir);

  // Build concept_id -> card and title -> card maps.
  var byConcept = {}, byTitle = {};
  cards.forEach(function (c) {
    var cid = c.concept_id != null ? c.concept_id : c.conceptId;
    if (cid != null && byConcept[norm(cid)] === undefined) byConcept[norm(cid)] = c;
    if (c.title != null && byTitle[norm(c.title)] === undefined) byTitle[norm(c.title)] = c;
  });

  function resolvePrereq(p) {
    var key = norm(p);
    if (byConcept[key] !== undefined) return byConcept[key];
    if (byTitle[key] !== undefined) return byTitle[key];
    return null;
  }

  var buckets = { "0-4": 0, "5-10": 0, "11-30": 0, ">30": 0 };
  function bucketOf(gap) {
    if (gap <= 4) return "0-4";
    if (gap <= 10) return "5-10";
    if (gap <= 30) return "11-30";
    return ">30";
  }

  var prereqTotal = 0, prereqMappable = 0, prereqUnmapped = 0;
  var unmappedSamples = [];
  var maxEdge = null;

  cards.forEach(function (c) {
    var prereqs = asArray(c.prerequisites != null ? c.prerequisites : c.prereqs);
    var fromPages = cardPages(c);
    prereqs.forEach(function (p) {
      var pStr = (p && typeof p === "object") ? (p.concept_id || p.title || JSON.stringify(p)) : p;
      prereqTotal++;
      var target = resolvePrereq(pStr);
      if (!target) {
        prereqUnmapped++;
        if (unmappedSamples.length < 20) unmappedSamples.push(String(pStr));
        return;
      }
      prereqMappable++;
      var toPages = cardPages(target);
      var g = absMaxGap(fromPages, toPages);
      var mg = minGap(fromPages, toPages);
      if (g == null) return; // missing page data on one side
      buckets[bucketOf(g)]++;
      if (!maxEdge || g > maxEdge.absMaxGap) {
        maxEdge = {
          from: {
            concept_id: (c.concept_id != null ? c.concept_id : c.conceptId) || null,
            title: c.title || null,
            pages: fromPages,
          },
          to: {
            concept_id: (target.concept_id != null ? target.concept_id : target.conceptId) || null,
            title: target.title || null,
            pages: toPages,
          },
          prerequisite: String(pStr),
          absMaxGap: g,
          minGap: mg,
        };
      }
    });
  });

  var result = {
    ok: true,
    textbookDir: textbookDir,
    title: title,
    cards: cards.length,
    prereqTotal: prereqTotal,
    prereqMappable: prereqMappable,
    prereqUnmapped: prereqUnmapped,
    distanceBuckets: buckets,
    maxEdge: maxEdge,
    unmappedSamples: unmappedSamples,
  };

  printReport(result);
  return result;
}

function printReport(r) {
  console.log("# Prerequisite edge page-distance audit");
  console.log("");
  console.log("- textbookDir: " + r.textbookDir);
  console.log("- title: " + (r.title || "(none)"));
  console.log("- cards: " + r.cards);
  console.log("- prereqTotal: " + r.prereqTotal);
  console.log("- prereqMappable: " + r.prereqMappable);
  console.log("- prereqUnmapped: " + r.prereqUnmapped);
  console.log("");
  console.log("| page-distance bucket | mappable edges |");
  console.log("|---|---|");
  console.log("| 0-4 (same-chunk likely) | " + r.distanceBuckets["0-4"] + " |");
  console.log("| 5-10 | " + r.distanceBuckets["5-10"] + " |");
  console.log("| 11-30 | " + r.distanceBuckets["11-30"] + " |");
  console.log("| >30 | " + r.distanceBuckets[">30"] + " |");
  console.log("");
  if (r.maxEdge) {
    console.log("## Max page-distance edge");
    console.log("");
    console.log("| field | from | to |");
    console.log("|---|---|---|");
    console.log("| concept_id | " + (r.maxEdge.from.concept_id || "") + " | " + (r.maxEdge.to.concept_id || "") + " |");
    console.log("| title | " + (r.maxEdge.from.title || "") + " | " + (r.maxEdge.to.title || "") + " |");
    console.log("| pages | " + JSON.stringify(r.maxEdge.from.pages) + " | " + JSON.stringify(r.maxEdge.to.pages) + " |");
    console.log("");
    console.log("- prerequisite (raw): " + r.maxEdge.prerequisite);
    console.log("- absMaxGap: " + r.maxEdge.absMaxGap + ", minGap: " + r.maxEdge.minGap);
  } else {
    console.log("## Max page-distance edge: (none — no mappable edges with page data)");
  }
  console.log("");
  console.log("EDGE_AUDIT_JSON: " + JSON.stringify(r));
}

function main() {
  var args = parseArgs(process.argv.slice(2));
  if (!args.textbookDir) { usage("--textbookDir is required"); process.exit(1); }
  run(args.textbookDir);
}

if (require.main === module) main();

module.exports = { run: run, _absMaxGap: absMaxGap, _minGap: minGap, _cardPages: cardPages };
