/**
 * long-reasoning-long-edge-linker.js — READ-ONLY rule-based long-edge CANDIDATE generator.
 *
 * Section 28 demo. The edge-audit (Section 27) proved the staging KB's mappable
 * prerequisite edges all cluster in the 0-4 page-distance bucket: the build only
 * creates intra-chunk edges, never cross-chunk / cross-chapter back-links.
 *
 * This script MINES candidate long-distance prerequisite edges from the existing
 * KB using RULES ONLY (no model). It NEVER asserts a candidate is a true edge.
 * Output is a separate candidates file for later model / human confirmation
 * (Section 29). It NEVER writes cards / index / teaching_map, and is NOT wired
 * into the runtime long-context helper.
 *
 * Usage:
 *   node long-reasoning-long-edge-linker.js --textbookDir <dir>
 *       [--out <file>] [--minGap <N=5>] [--limit <N=50>]
 *
 * Reads <textbookDir>/knowledge_base/{index.json, cards/*.json, teaching_map.json?}.
 * Emits a Markdown summary + a final line: LONG_EDGE_LINKER_JSON: {...}
 */
"use strict";

var fs = require("fs");
var path = require("path");

function usage(msg) {
  if (msg) console.error("ERROR: " + msg);
  console.error("Usage: node long-reasoning-long-edge-linker.js --textbookDir <dir> [--out <file>] [--minGap <N>] [--limit <N>]");
}

function parseArgs(argv) {
  var out = { minGap: 5, limit: 50 };
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === "--textbookDir") out.textbookDir = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--minGap") out.minGap = parseInt(argv[++i], 10);
    else if (argv[i] === "--limit") out.limit = parseInt(argv[++i], 10);
  }
  if (!(out.minGap >= 0)) out.minGap = 5;
  if (!(out.limit >= 0)) out.limit = 50;
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

function absMaxGap(aPages, bPages) {
  if (!aPages.length || !bPages.length) return null;
  var aMin = Math.min.apply(null, aPages), aMax = Math.max.apply(null, aPages);
  var bMin = Math.min.apply(null, bPages), bMax = Math.max.apply(null, bPages);
  return Math.max(Math.abs(aMax - bMin), Math.abs(bMax - aMin));
}

function minGapOf(aPages, bPages) {
  if (!aPages.length || !bPages.length) return null;
  var aMin = Math.min.apply(null, aPages), aMax = Math.max.apply(null, aPages);
  var bMin = Math.min.apply(null, bPages), bMax = Math.max.apply(null, bPages);
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

function minPage(pages) { return pages.length ? Math.min.apply(null, pages) : Infinity; }

function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

// Aggressive title normalization: drop spaces, punctuation, and bracketed asides.
function normTitle(s) {
  s = String(s == null ? "" : s).toLowerCase();
  // strip bracketed content (both ascii and cjk brackets)
  s = s.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "");
  // strip whitespace and common punctuation/separators
  s = s.replace(/[\s\u3000，。、：:；;,.\-_/\\|·•“”"'’]/g, "");
  return s.trim();
}

// Lightweight token split: CJK chars become single tokens; ascii words grouped.
function tokenize(s) {
  s = String(s == null ? "" : s).toLowerCase();
  var toks = [];
  var re = /[a-z0-9]+|[\u3400-\u9fff]/g, m;
  while ((m = re.exec(s)) !== null) toks.push(m[0]);
  return toks;
}

function tokenOverlap(aToks, bToks) {
  if (!aToks.length || !bToks.length) return 0;
  var set = {}, i;
  for (i = 0; i < aToks.length; i++) set[aToks[i]] = 1;
  var hit = 0, seen = {};
  for (i = 0; i < bToks.length; i++) {
    if (set[bToks[i]] && !seen[bToks[i]]) { hit++; seen[bToks[i]] = 1; }
  }
  // Jaccard-ish: overlap / smaller-set size.
  var denom = Math.min(Object.keys(set).length, bToks.length) || 1;
  return hit / denom;
}

// Lightweight alias table: maps a normalized alias -> canonical token bag.
var ALIASES = [
  ["shell", ["shell"]],
  ["bash", ["bash", "shell"]],
  ["bashshell", ["bash", "shell"]],
  ["变量", ["shell", "变量"]],
  ["shell变量", ["shell", "变量"]],
  ["位置参数", ["位置", "参数"]],
  ["test", ["test"]],
  ["路径", ["路径", "path"]],
  ["path变量", ["path", "变量"]],
];
function aliasTokens(s) {
  var key = normTitle(s);
  for (var i = 0; i < ALIASES.length; i++) {
    if (key.indexOf(ALIASES[i][0]) !== -1) return ALIASES[i][1];
  }
  return null;
}

// High-order / application focus keywords (rule B).
var HIGH_ORDER = ["综合", "实现", "程序", "例题", "应用", "比较", "优先级", "控制语句", "函数", "调试", "脚本", "案例"];
function isHighOrder(title) {
  var t = String(title || "");
  for (var i = 0; i < HIGH_ORDER.length; i++) if (t.indexOf(HIGH_ORDER[i]) !== -1) return true;
  return false;
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

function bucketOf(gap) {
  if (gap <= 4) return "0-4";
  if (gap <= 10) return "5-10";
  if (gap <= 30) return "11-30";
  return ">30";
}

function cidOf(c) { return c.concept_id != null ? c.concept_id : c.conceptId; }

function run(opts) {
  var textbookDir = opts.textbookDir;
  var minGap = opts.minGap, limit = opts.limit;
  var kbDir = path.join(textbookDir, "knowledge_base");

  var index = null;
  try { index = readJson(path.join(kbDir, "index.json")); } catch (e) {}
  var title = (index && (index.title || index.textbook_title)) || "";

  var cards = loadCards(kbDir);
  var teachingMap = null;
  try { teachingMap = readJson(path.join(kbDir, "teaching_map.json")); } catch (e) {}

  // concept_id -> card, normalized-title -> card.
  var byConcept = {}, byTitle = {};
  cards.forEach(function (c) {
    var cid = cidOf(c);
    if (cid != null && byConcept[norm(cid)] === undefined) byConcept[norm(cid)] = c;
    if (c.title != null && byTitle[normTitle(c.title)] === undefined) byTitle[normTitle(c.title)] = c;
  });
  function resolveExact(p) {
    var k = norm(p);
    if (byConcept[k] !== undefined) return byConcept[k];
    var kt = normTitle(p);
    if (byTitle[kt] !== undefined) return byTitle[kt];
    return null;
  }

  // Track edges already expressible by the KB (for dedup).
  var existingEdges = {};
  cards.forEach(function (c) {
    var fromId = cidOf(c);
    asArray(c.prerequisites != null ? c.prerequisites : c.prereqs).forEach(function (p) {
      var pStr = (p && typeof p === "object") ? (p.concept_id || p.title || "") : p;
      var t = resolveExact(pStr);
      if (t) existingEdges[fromId + "=>" + cidOf(t)] = 1;
    });
  });

  var candidatesByKey = {}; // "from=>to" -> best candidate

  function consider(fromCard, toCard, rawPrereq, baseScore, reason) {
    if (!fromCard || !toCard) return;
    var fromId = cidOf(fromCard), toId = cidOf(toCard);
    if (fromId === toId) return;
    var key = fromId + "=>" + toId;
    if (existingEdges[key]) return; // already a KB edge
    var fromPages = cardPages(fromCard), toPages = cardPages(toCard);
    var g = absMaxGap(fromPages, toPages);
    if (g == null || g < minGap) return; // same-chunk / near edge filtered
    var mg = minGapOf(fromPages, toPages);
    var existing = candidatesByKey[key];
    if (existing && existing.score >= baseScore) {
      if (existing.reasons.indexOf(reason) === -1) existing.reasons.push(reason);
      return;
    }
    candidatesByKey[key] = {
      from: { concept_id: fromId, title: fromCard.title || null, pages: fromPages },
      to: { concept_id: toId, title: toCard.title || null, pages: toPages },
      rawPrerequisite: rawPrereq != null ? String(rawPrereq) : null,
      absMaxGap: g,
      minGap: mg,
      score: +baseScore.toFixed(3),
      reasons: existing ? existing.reasons.concat([reason]).filter(function (r, i, a) { return a.indexOf(r) === i; }) : [reason],
      status: "candidate_unverified",
    };
  }

  // ---- Rule A: unmapped prerequisite -> best fuzzy target on an earlier page.
  cards.forEach(function (c) {
    var fromPages = cardPages(c);
    asArray(c.prerequisites != null ? c.prerequisites : c.prereqs).forEach(function (p) {
      var pStr = (p && typeof p === "object") ? (p.concept_id || p.title || "") : p;
      if (!pStr) return;
      if (resolveExact(pStr)) return; // already mappable — not a long-edge gap
      var pNorm = normTitle(pStr), pToks = tokenize(pStr), pAlias = aliasTokens(pStr);
      var best = null, bestScore = 0, bestReasons = null;
      cards.forEach(function (t) {
        if (cidOf(t) === cidOf(c)) return;
        // candidate target should generally precede the focus card
        if (minPage(cardPages(t)) > minPage(fromPages)) return;
        var tNorm = normTitle(t.title), tToks = tokenize(t.title);
        var reasons = [], score = 0;
        if (pNorm && tNorm && (pNorm.indexOf(tNorm) !== -1 || tNorm.indexOf(pNorm) !== -1)) {
          score = Math.max(score, 0.7); reasons.push("title_contains");
        }
        var ov = tokenOverlap(pToks, tToks);
        if (ov >= 0.5) { score = Math.max(score, 0.4 + ov * 0.4); reasons.push("unmapped_prereq_token_overlap"); }
        if (pAlias) {
          var av = tokenOverlap(pAlias, tToks);
          if (av >= 0.5) { score = Math.max(score, 0.45 + av * 0.3); reasons.push("alias_match"); }
        }
        if (score > bestScore) { bestScore = score; best = t; bestReasons = reasons; }
      });
      if (best && bestScore > 0) {
        consider(c, best, pStr, bestScore, "prior_pages");
        var key = cidOf(c) + "=>" + cidOf(best);
        if (candidatesByKey[key]) {
          bestReasons.forEach(function (r) {
            if (candidatesByKey[key].reasons.indexOf(r) === -1) candidatesByKey[key].reasons.push(r);
          });
        }
      }
    });
  });

  // ---- Rule B: high-order/application card -> earlier basic card by token overlap.
  cards.forEach(function (c) {
    if (!isHighOrder(c.title)) return;
    var fromPages = cardPages(c), fToks = tokenize(c.title);
    var best = null, bestScore = 0;
    cards.forEach(function (t) {
      if (cidOf(t) === cidOf(c)) return;
      if (minPage(cardPages(t)) >= minPage(fromPages)) return; // strictly earlier
      var ov = tokenOverlap(fToks, tokenize(t.title));
      if (ov >= 0.34 && ov > bestScore) { bestScore = ov; best = t; }
    });
    if (best) consider(c, best, null, 0.35 + bestScore * 0.3, "title_overlap_prior_concept");
  });

  // ---- Rule C: teaching_map later phase -> earlier phase (cross-page only).
  if (teachingMap && Array.isArray(teachingMap.segments)) {
    var ordered = []; // flat list of {card, phaseRank}
    var rank = 0;
    teachingMap.segments.forEach(function (seg) {
      asArray(seg.sequence).forEach(function (ph) {
        asArray(ph.card_ids).forEach(function (cidOrTitle) {
          var card = resolveExact(cidOrTitle);
          if (card) ordered.push({ card: card, rank: rank });
        });
        rank++;
      });
    });
    // For each later-phase card, link to the immediately-prior-phase card that is page-far.
    ordered.forEach(function (later) {
      ordered.forEach(function (earlier) {
        if (earlier.rank >= later.rank) return;
        var ov = tokenOverlap(tokenize(later.card.title), tokenize(earlier.card.title));
        if (ov < 0.34) return; // need some topical link to avoid explosion
        consider(later.card, earlier.card, null, 0.3 + ov * 0.25, "teaching_map_prior_phase");
      });
    });
  }

  // ---- Rule D: finalize — sort by score desc then gap desc, cap at limit.
  var candidates = Object.keys(candidatesByKey).map(function (k) { return candidatesByKey[k]; });
  candidates.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return b.absMaxGap - a.absMaxGap;
  });
  var total = candidates.length;
  candidates = candidates.slice(0, limit);
  // assign stable ids after sort
  candidates.forEach(function (c, i) { c.id = "le_" + String(i + 1).padStart(3, "0"); });

  var buckets = { "5-10": 0, "11-30": 0, ">30": 0 };
  candidates.forEach(function (c) { var b = bucketOf(c.absMaxGap); if (buckets[b] !== undefined) buckets[b]++; });

  var result = {
    version: 1,
    type: "long_edge_candidates",
    textbookDir: textbookDir,
    generatedAt: new Date().toISOString(),
    method: "rules_only_no_model",
    minGap: minGap,
    stats: {
      cards: cards.length,
      candidateCount: candidates.length,
      candidateTotalBeforeLimit: total,
      buckets: buckets,
    },
    candidates: candidates,
  };

  printReport(result, title);
  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify(result, null, 2), "utf-8");
    console.log("WROTE: " + opts.out);
  }
  return result;
}

function printReport(r, title) {
  console.log("# long-edge linker — rule-based candidates (no model)");
  console.log("");
  console.log("- textbookDir: " + r.textbookDir);
  console.log("- title: " + (title || "(none)"));
  console.log("- cards: " + r.stats.cards);
  console.log("- minGap: " + r.minGap);
  console.log("- candidateCount: " + r.stats.candidateCount + " (before limit: " + r.stats.candidateTotalBeforeLimit + ")");
  console.log("");
  console.log("| gap bucket | candidates |");
  console.log("|---|---|");
  console.log("| 5-10 | " + r.stats.buckets["5-10"] + " |");
  console.log("| 11-30 | " + r.stats.buckets["11-30"] + " |");
  console.log("| >30 | " + r.stats.buckets[">30"] + " |");
  console.log("");
  if (r.candidates.length) {
    console.log("## Top candidates");
    console.log("");
    console.log("| id | from | to | gap | score | reasons |");
    console.log("|---|---|---|---|---|---|");
    r.candidates.slice(0, 10).forEach(function (c) {
      console.log("| " + c.id + " | " + (c.from.title || c.from.concept_id) + " | " +
        (c.to.title || c.to.concept_id) + " | " + c.absMaxGap + " | " + c.score +
        " | " + c.reasons.join(",") + " |");
    });
  } else {
    console.log("## Top candidates: (none — rules found no cross-chunk candidate >= minGap)");
  }
  console.log("");
  console.log("LONG_EDGE_LINKER_JSON: " + JSON.stringify(r));
}

function main() {
  var args = parseArgs(process.argv.slice(2));
  if (!args.textbookDir) { usage("--textbookDir is required"); process.exit(1); }
  run(args);
}

if (require.main === module) main();

module.exports = {
  run: run,
  _absMaxGap: absMaxGap,
  _minGap: minGapOf,
  _cardPages: cardPages,
  _normTitle: normTitle,
  _tokenize: tokenize,
  _tokenOverlap: tokenOverlap,
};