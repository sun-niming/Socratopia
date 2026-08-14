/**
 * long-reasoning-long-edge-review.js — READ-ONLY rule-based REVIEW of long-edge candidates.
 *
 * Section 29. The Section 28 linker emitted rule-only candidates
 * (long_edges.linux-staging.candidates.json). Those are NOT true edges — the
 * report flagged clear noise (e.g. alias_match dragging many Shell-ish concepts
 * onto "引号会阻止Shell展开通配符").
 *
 * This script triages those candidates with RULES ONLY (no model) into three
 * buckets so a later model/human pass only has to look at the promising ones:
 *   - likely      : strong rule evidence; safe to send to model/human confirm.
 *   - noisy       : almost certainly a false positive; should be filtered out.
 *   - needs_human : rules can't decide; needs model/human judgement.
 *
 * It NEVER calls a model, NEVER writes cards / index / teaching_map, NEVER
 * produces confirmed edges. Output is a separate review file for the next round.
 *
 * Usage:
 *   node long-reasoning-long-edge-review.js --candidates <file> --textbookDir <dir>
 *       [--out <file>] [--limit <N=30>]
 *
 * Reads the candidates JSON and <textbookDir>/knowledge_base/cards/*.json (BOM
 * tolerant, read-only). Emits a Markdown summary + a final line:
 *   LONG_EDGE_REVIEW_JSON: {...}
 */
"use strict";

var fs = require("fs");
var path = require("path");

var DEFAULT_LIMIT = 30;
var WEAK_TITLE_OVERLAP_THRESHOLD = 0.34;
var LIKELY_SCORE_THRESHOLD = 0.8;
var LIKELY_MIN_GAP = 5;
var STATUS_ORDER = Object.freeze({ likely: 0, needs_human: 1, noisy: 2 });
var CONFIDENCE = Object.freeze({
  aliasOnly: 0.1,
  wildcardSink: 0.12,
  weakTeachingMap: 0.15,
  likelyBase: 0.7,
  overlapBonus: 0.1,
  aliasPenalty: 0.1,
  needsHuman: 0.4
});

function usage(msg) {
  if (msg) console.error("ERROR: " + msg);
  console.error("Usage: node long-reasoning-long-edge-review.js --candidates <file> --textbookDir <dir> [--out <file>] [--limit <N>]");
}

function parseArgs(argv) {
  var out = { limit: DEFAULT_LIMIT };
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === "--candidates") out.candidates = argv[++i];
    else if (argv[i] === "--textbookDir") out.textbookDir = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--limit") out.limit = parseInt(argv[++i], 10);
  }
  if (!(out.limit >= 0)) out.limit = DEFAULT_LIMIT;
  return out;
}

// Tolerate UTF-8 BOM.
function readJson(file) {
  var s = fs.readFileSync(file, "utf-8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return JSON.parse(s);
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

function cidOf(c) { return c.concept_id != null ? c.concept_id : c.conceptId; }
function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

// Lightweight token split: CJK chars become single tokens; ascii words grouped.
function tokenize(s) {
  s = String(s == null ? "" : s).toLowerCase();
  var toks = [], re = /[a-z0-9]+|[\u3400-\u9fff]/g, m;
  while ((m = re.exec(s)) !== null) toks.push(m[0]);
  return toks;
}

// Generic filler tokens that carry no concept identity on their own.
var GENERIC = {
  "基": 1, "本": 1, "础": 1, "的": 1, "了": 1, "与": 1, "和": 1, "及": 1,
  "知": 1, "识": 1, "内": 1, "容": 1, "等": 1,
};
// Alias keywords — overlap on these alone is not a real semantic link.
var ALIAS_TOK = { "shell": 1, "bash": 1 };

// Significant overlap: shared tokens excluding generic filler + alias keywords.
function significantOverlap(aStr, bStr) {
  var a = tokenize(aStr), b = tokenize(bStr);
  var set = {}, i, hits = [];
  for (i = 0; i < a.length; i++) {
    if (GENERIC[a[i]] || ALIAS_TOK[a[i]]) continue;
    set[a[i]] = 1;
  }
  var seen = {};
  for (i = 0; i < b.length; i++) {
    var t = b[i];
    if (set[t] && !seen[t]) { hits.push(t); seen[t] = 1; }
  }
  return hits; // array of shared significant tokens
}

// Plain Jaccard-ish title overlap (for teaching_map-only candidates).
function titleOverlapRatio(aStr, bStr) {
  var a = tokenize(aStr), b = tokenize(bStr);
  if (!a.length || !b.length) return 0;
  var set = {}, i;
  for (i = 0; i < a.length; i++) set[a[i]] = 1;
  var hit = 0, seen = {};
  for (i = 0; i < b.length; i++) {
    if (set[b[i]] && !seen[b[i]]) { hit++; seen[b[i]] = 1; }
  }
  var denom = Math.min(Object.keys(set).length, b.length) || 1;
  return hit / denom;
}

// matching reasons = reasons that assert a content link (drop the position tag).
function matchingReasons(reasons) {
  return (reasons || []).filter(function (r) { return r !== "prior_pages"; });
}
function isAliasOnly(reasons) {
  var mr = matchingReasons(reasons);
  if (!mr.length) return false;
  return mr.every(function (r) { return r === "alias_match"; });
}

// The notorious noise sink: "引号会阻止Shell展开通配符".
function isWildcardQuoteCard(toTitle) {
  return /引号.*阻止.*shell.*展开.*通配符/i.test(String(toTitle || "").toLowerCase());
}

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

function classify(cand) {
  var reasons = cand.reasons || [];
  var mr = matchingReasons(reasons);
  var rawPrereq = cand.rawPrerequisite;
  var toTitle = cand.to && cand.to.title;
  var fromTitle = cand.from && cand.from.title;
  var score = typeof cand.score === "number" ? cand.score : 0;
  var gap = typeof cand.absMaxGap === "number" ? cand.absMaxGap : 0;

  var sig = significantOverlap(rawPrereq, toTitle);
  var aliasOnly = isAliasOnly(reasons);
  var decision = [];

  // ---- NOISY ----------------------------------------------------------------
  // 1. matched only via alias keyword (Shell/Bash) — no concept link.
  if (aliasOnly) {
    decision.push("alias_only_match");
    if (isWildcardQuoteCard(toTitle)) decision.push("points_to_wildcard_quote_sink");
    return { status: "noisy", confidence: CONFIDENCE.aliasOnly, decisionReasons: decision, sig: sig };
  }
  // 2. points at the wildcard-quote sink with no significant token overlap.
  if (isWildcardQuoteCard(toTitle) && sig.length === 0) {
    decision.push("wildcard_quote_sink_no_significant_overlap");
    return { status: "noisy", confidence: CONFIDENCE.wildcardSink, decisionReasons: decision, sig: sig };
  }
  // 3. raw prereq empty + only teaching_map ordering + weak title overlap.
  if ((rawPrereq == null || String(rawPrereq).trim() === "") &&
      mr.length === 1 && mr[0] === "teaching_map_prior_phase" &&
      titleOverlapRatio(fromTitle, toTitle) < WEAK_TITLE_OVERLAP_THRESHOLD) {
    decision.push("teaching_map_only_weak_title_overlap");
    return { status: "noisy", confidence: CONFIDENCE.weakTeachingMap, decisionReasons: decision, sig: sig };
  }

  // ---- LIKELY ---------------------------------------------------------------
  // strong: high score + a real unmapped-prereq token match + semantic overlap.
  if (score >= LIKELY_SCORE_THRESHOLD &&
      mr.indexOf("unmapped_prereq_token_overlap") !== -1 &&
      gap >= LIKELY_MIN_GAP && sig.length >= 1) {
    decision.push("score>=0.8");
    decision.push("unmapped_prereq_token_overlap");
    decision.push("significant_overlap:" + sig.join("/"));
    var conf = CONFIDENCE.likelyBase +
      (sig.length >= 3 ? CONFIDENCE.overlapBonus : 0) -
      (reasons.indexOf("alias_match") !== -1 ? CONFIDENCE.aliasPenalty : 0);
    if (reasons.indexOf("alias_match") !== -1) decision.push("alias_present_lowers_confidence");
    return { status: "likely", confidence: clamp01(conf), decisionReasons: decision, sig: sig };
  }

  // ---- NEEDS_HUMAN ----------------------------------------------------------
  if (sig.length >= 1) decision.push("some_overlap:" + sig.join("/"));
  if (mr.indexOf("unmapped_prereq_token_overlap") !== -1 && score < LIKELY_SCORE_THRESHOLD) decision.push("unmapped_overlap_but_low_score");
  if (mr.indexOf("title_overlap_prior_concept") !== -1) decision.push("title_ordering_heuristic_only");
  if (mr.indexOf("teaching_map_prior_phase") !== -1) decision.push("teaching_map_ordering");
  if (!decision.length) decision.push("rules_inconclusive");
  return { status: "needs_human", confidence: CONFIDENCE.needsHuman, decisionReasons: decision, sig: sig };
}

function run(opts) {
  var doc = readJson(opts.candidates);
  var cands = Array.isArray(doc.candidates) ? doc.candidates : [];
  var textbookDir = opts.textbookDir;

  // Read-only cross-check against KB cards (presence + authoritative title).
  var kbDir = path.join(textbookDir, "knowledge_base");
  var cards = loadCards(kbDir);
  var byConcept = {};
  cards.forEach(function (c) {
    var cid = cidOf(c);
    if (cid != null) byConcept[norm(cid)] = c;
  });

  var items = cands.map(function (c) {
    var r = classify(c);
    var fromKnown = c.from && byConcept[norm(c.from.concept_id)] !== undefined;
    var toKnown = c.to && byConcept[norm(c.to.concept_id)] !== undefined;
    if (cards.length && (!fromKnown || !toKnown)) {
      r.decisionReasons = r.decisionReasons.concat(["card_not_found_in_kb"]);
    }
    return {
      candidateId: c.id || null,
      status: r.status,
      confidence: +r.confidence.toFixed(3),
      decisionReasons: r.decisionReasons,
      from: c.from || null,
      to: c.to || null,
      rawPrerequisite: c.rawPrerequisite != null ? c.rawPrerequisite : null,
      absMaxGap: typeof c.absMaxGap === "number" ? c.absMaxGap : null,
      score: typeof c.score === "number" ? c.score : null,
      originalReasons: c.reasons || [],
    };
  });

  var stats = { total: items.length, likely: 0, needs_human: 0, noisy: 0 };
  items.forEach(function (it) { if (stats[it.status] !== undefined) stats[it.status]++; });

  // Sort: likely (by confidence/score desc) → needs_human → noisy; then cap at limit.
  items.sort(function (a, b) {
    if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (b.score || 0) - (a.score || 0);
  });
  var limited = items.slice(0, opts.limit);

  var result = {
    version: 1,
    type: "long_edge_review",
    sourceCandidates: opts.candidates,
    textbookDir: textbookDir,
    generatedAt: new Date().toISOString(),
    method: "rules_review_no_model",
    note: "review only — items are NOT confirmed edges; not used by runtime/long-context",
    limit: opts.limit,
    stats: stats,
    items: limited,
  };

  printReport(result, doc);
  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify(result, null, 2), "utf-8");
    console.log("WROTE: " + opts.out);
  }
  return result;
}

function printReport(r, srcDoc) {
  console.log("# long-edge review — rule-based triage (no model)");
  console.log("");
  console.log("- sourceCandidates: " + r.sourceCandidates);
  console.log("- textbookDir: " + r.textbookDir);
  console.log("- candidates in source: " + ((srcDoc && srcDoc.candidates && srcDoc.candidates.length) || 0));
  console.log("- reviewed (stats.total): " + r.stats.total);
  console.log("");
  console.log("| status | count |");
  console.log("|---|---|");
  console.log("| likely | " + r.stats.likely + " |");
  console.log("| needs_human | " + r.stats.needs_human + " |");
  console.log("| noisy | " + r.stats.noisy + " |");
  console.log("");
  console.log("## Items (capped at limit=" + r.limit + ")");
  console.log("");
  console.log("| id | status | conf | from | to | gap | rawPrereq | decision |");
  console.log("|---|---|---|---|---|---|---|---|");
  r.items.forEach(function (it) {
    console.log("| " + it.candidateId + " | " + it.status + " | " + it.confidence + " | " +
      ((it.from && it.from.title) || "") + " | " + ((it.to && it.to.title) || "") + " | " +
      it.absMaxGap + " | " + (it.rawPrerequisite || "") + " | " + it.decisionReasons.join(",") + " |");
  });
  console.log("");
  console.log("LONG_EDGE_REVIEW_JSON: " + JSON.stringify(r));
}

function main() {
  var args = parseArgs(process.argv.slice(2));
  if (!args.candidates || !args.textbookDir) {
    usage("--candidates and --textbookDir are required");
    process.exit(1);
  }
  run(args);
}

if (require.main === module) main();

module.exports = {
  run: run,
  _classify: classify,
  _significantOverlap: significantOverlap,
  _isAliasOnly: isAliasOnly,
  _isWildcardQuoteCard: isWildcardQuoteCard,
};
