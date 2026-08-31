/**
 * Long-Distance Reasoning Context (Graph-RAG prototype, Demo only)
 *
 * Given a focus page / concept / query, recall cross-page prerequisite
 * concepts, related knowledge cards and evidence from an existing
 * ConceptGraph (saved -> dry-run -> KB fallback), and emit a hidden
 * classroom-context prompt block.
 *
 * READ-ONLY. This module does NOT touch the live classroom chain
 * (resume / normal page-turn / auto-advance / __KB_DISTILL__). It only
 * reads existing data and, at most, builds an in-memory dry-run graph
 * that is never persisted.
 *
 * CommonJS module, matching resources/server/lib/adaptive/*.js style.
 * Exports: buildLongReasoningContext(input)
 */
"use strict";

var fs = require("fs");
var path = require("path");

// ---- low-level read helpers (tolerant) ----

function readJSONSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    var text = fs.readFileSync(filePath, "utf-8");
    // Tolerate a leading UTF-8 BOM (some Windows tools prepend \uFEFF).
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// Build a concept_id -> KB card map from <textbookDir>/knowledge_base.
// Returns {} when KB is missing/unreadable (never throws).
function loadCardMap(textbookDir) {
  var map = {};
  if (!textbookDir || typeof textbookDir !== "string") return map;
  var kbDir = path.join(textbookDir, "knowledge_base");
  var index = readJSONSafe(path.join(kbDir, "index.json"));
  if (!index || !Array.isArray(index.cards)) return map;
  var cardsDir = path.join(kbDir, "cards");
  for (var i = 0; i < index.cards.length; i++) {
    var ref = index.cards[i] || {};
    var cid = ref.concept_id || "";
    if (!cid) continue;
    var card = readJSONSafe(path.join(cardsDir, cid + ".json"));
    if (card) {
      if (!card.concept_id) card.concept_id = cid;
      map[cid] = card;
    }
  }
  return map;
}

// ---- graph acquisition ----

function graphIsUsable(g) {
  return g && !g.error && Array.isArray(g.concepts) && g.concepts.length > 0;
}

// Build a minimal pseudo-graph directly from KB cards (last-resort fallback).
function kbFallbackGraph(cardMap) {
  var ids = Object.keys(cardMap);
  if (!ids.length) return null;
  // title -> concept_id, to map card.prerequisites (often titles) to ids.
  var titleToId = {};
  ids.forEach(function (cid) {
    var c = cardMap[cid];
    if (c && c.title != null) titleToId[String(c.title)] = cid;
  });
  var concepts = ids.map(function (cid) {
    var c = cardMap[cid] || {};
    var prereqs = [];
    if (Array.isArray(c.prerequisites)) {
      c.prerequisites.forEach(function (p) {
        var mapped = titleToId[String(p)] || (cardMap[p] ? String(p) : null);
        if (mapped && mapped !== cid) prereqs.push(mapped);
      });
    }
    return {
      conceptId: cid,
      title: c.title || cid,
      description: c.definition || "",
      prerequisites: prereqs,
      sourcePages: Array.isArray(c.source_pages) ? c.source_pages : []
    };
  });
  return { concepts: concepts, source: { type: "kb_fallback" } };
}

// ---- focus location ----

function pageCovered(sourcePages, page) {
  if (!Array.isArray(sourcePages) || sourcePages.length === 0) return false;
  var lo = sourcePages[0];
  var hi = sourcePages.length >= 2 ? sourcePages[1] : sourcePages[0];
  if (typeof lo !== "number" || typeof hi !== "number") return false;
  return lo <= page && page <= hi;
}

function locateFocus(concepts, cardMap, opts) {
  var i, c;
  // 1) explicit focusConceptId
  if (opts.focusConceptId) {
    var want = String(opts.focusConceptId);
    for (i = 0; i < concepts.length; i++) {
      if (String(concepts[i].conceptId) === want) return concepts[i];
    }
  }
  // 2) focusPage coverage
  if (opts.focusPage != null && opts.focusPage > 0) {
    for (i = 0; i < concepts.length; i++) {
      if (pageCovered(concepts[i].sourcePages, opts.focusPage)) return concepts[i];
    }
  }
  // 3) query contains match on title/description/card definition
  if (opts.query && typeof opts.query === "string" && opts.query.trim()) {
    var q = opts.query.trim().toLowerCase();
    for (i = 0; i < concepts.length; i++) {
      c = concepts[i];
      var hay = String(c.title || "") + "\n" + String(c.description || "");
      var card = cardMap[c.conceptId];
      if (card && card.definition) hay += "\n" + String(card.definition);
      if (hay.toLowerCase().indexOf(q) >= 0) return c;
    }
  }
  return null;
}

// ---- prerequisite tracing ----

// Trace prerequisites upward from focus, BFS to maxDepth. Dedupe + cycle-guard.
// Returns { dependencies:[concept], missing:[conceptId] }.
function tracePrerequisites(focus, byId, maxDepth) {
  var dependencies = [];
  var missing = [];
  var visited = {};
  visited[String(focus.conceptId)] = true;
  var queue = [{ id: String(focus.conceptId), depth: 0 }];
  while (queue.length) {
    var node = queue.shift();
    if (node.depth >= maxDepth) continue;
    var concept = byId[node.id];
    if (!concept || !Array.isArray(concept.prerequisites)) continue;
    for (var i = 0; i < concept.prerequisites.length; i++) {
      var pid = String(concept.prerequisites[i]);
      if (visited[pid]) continue; // dedupe + cycle guard
      visited[pid] = true;
      var pConcept = byId[pid];
      if (pConcept) {
        dependencies.push(pConcept);
        queue.push({ id: pid, depth: node.depth + 1 });
      } else {
        missing.push(pid);
      }
    }
  }
  return { dependencies: dependencies, missing: missing };
}

// Direct downstream dependents (concepts that list focus as a prerequisite).
function findRelated(concepts, focusId, excludeIds) {
  var out = [];
  for (var i = 0; i < concepts.length; i++) {
    var c = concepts[i];
    if (String(c.conceptId) === focusId) continue;
    if (excludeIds[String(c.conceptId)]) continue;
    if (Array.isArray(c.prerequisites) && c.prerequisites.map(String).indexOf(focusId) >= 0) {
      out.push(c);
    }
  }
  return out;
}

// ---- evidence + prompt rendering ----

function toEvidenceCard(card) {
  return {
    concept_id: card.concept_id || "",
    title: card.title || "",
    definition: card.definition || "",
    key_points: Array.isArray(card.key_points) ? card.key_points : [],
    examples: Array.isArray(card.examples) ? card.examples : [],
    source_pages: Array.isArray(card.source_pages) ? card.source_pages : []
  };
}

function pagesLabel(sourcePages) {
  if (!Array.isArray(sourcePages) || sourcePages.length === 0) return "?";
  if (sourcePages.length === 1) return String(sourcePages[0]);
  return sourcePages[0] + "-" + sourcePages[1];
}

function renderPromptBlock(focus, dependencies, evidenceCards, missingPrerequisites) {
  var depLine = dependencies.length
    ? dependencies.map(function (d) { return d.title + "(p." + pagesLabel(d.sourcePages) + ")"; }).join("；")
    : "无";
  var evLine = evidenceCards.length
    ? evidenceCards.map(function (e) { return e.title + "(p." + pagesLabel(e.source_pages) + ")"; }).join("；")
    : "无";
  var gapLine = missingPrerequisites.length ? missingPrerequisites.join("、") : "无";
  return [
    '<LONG_REASONING_CONTEXT hidden_from_student="true">',
    "当前焦点：" + focus.title + " (" + focus.conceptId + ", p." + pagesLabel(focus.sourcePages) + ")",
    "必要前置：" + depLine,
    "跨页依据：" + evLine,
    "可能缺口：" + gapLine,
    "本轮回答边界：仅围绕当前焦点与其前置展开，不展开未列出的内容。",
    "</LONG_REASONING_CONTEXT>"
  ].join("\n");
}

// ---- main entry ----

async function buildLongReasoningContext(input) {
  input = input || {};
  var maxDepth = (typeof input.maxDepth === "number" && input.maxDepth >= 0) ? input.maxDepth : 2;

  var cardMap = loadCardMap(input.textbookDir);

  // 1. Acquire graph: saved -> dry-run -> kb fallback.
  var graph = null;
  var source = null;

  try {
    if (global.__ADAPTIVE__ && typeof global.__ADAPTIVE__.getConceptGraph === "function"
        && input.profileId && input.worldId && input.textbookId) {
      var saved = global.__ADAPTIVE__.getConceptGraph(input.profileId, input.worldId, input.textbookId);
      if (graphIsUsable(saved)) { graph = saved; source = "saved_graph"; }
    }
  } catch (e) { /* ignore, fall through */ }

  if (!graph) {
    try {
      if (global.__ADAPTIVE_CONCEPT_GRAPH__ && typeof global.__ADAPTIVE_CONCEPT_GRAPH__.buildConceptGraph === "function"
          && input.profileId && input.worldId && input.textbookId) {
        var dry = await global.__ADAPTIVE_CONCEPT_GRAPH__.buildConceptGraph({
          profileId: input.profileId,
          worldId: input.worldId,
          textbookId: input.textbookId,
          textbookDir: input.textbookDir,
          dryRun: true
        });
        if (graphIsUsable(dry)) { graph = dry; source = "dry_graph"; }
      }
    } catch (e) { /* ignore, fall through */ }
  }

  if (!graph) {
    var fb = kbFallbackGraph(cardMap);
    if (graphIsUsable(fb)) { graph = fb; source = "kb_fallback"; }
  }

  if (!graphIsUsable(graph)) {
    return { ok: false, error: "no_graph", message: "No ConceptGraph available (saved/dry-run/KB all unavailable)." };
  }

  var concepts = graph.concepts;
  var byId = {};
  concepts.forEach(function (c) { if (c && c.conceptId != null) byId[String(c.conceptId)] = c; });

  // 2. Locate focus.
  var focus = locateFocus(concepts, cardMap, {
    focusConceptId: input.focusConceptId,
    focusPage: input.focusPage,
    query: input.query
  });
  if (!focus) {
    return { ok: false, error: "focus_not_found", message: "Could not locate a focus concept from focusConceptId / focusPage / query.", source: source };
  }

  // 3. Trace prerequisites.
  var traced = tracePrerequisites(focus, byId, maxDepth);
  var dependencies = traced.dependencies;
  var missingPrerequisites = traced.missing;

  // 4. Related (direct dependents), excluding focus + dependencies.
  var exclude = {};
  exclude[String(focus.conceptId)] = true;
  dependencies.forEach(function (d) { exclude[String(d.conceptId)] = true; });
  var related = findRelated(concepts, String(focus.conceptId), exclude);

  // 5. Evidence cards for focus + dependencies (when a KB card exists).
  var evidenceCards = [];
  var seenEvidence = {};
  [focus].concat(dependencies).forEach(function (c) {
    var cid = String(c.conceptId);
    if (seenEvidence[cid]) return;
    seenEvidence[cid] = true;
    var card = cardMap[cid];
    if (card) evidenceCards.push(toEvidenceCard(card));
  });

  // 6. Prompt block.
  var focusOut = {
    conceptId: focus.conceptId,
    title: focus.title || "",
    sourcePages: Array.isArray(focus.sourcePages) ? focus.sourcePages : []
  };
  var promptBlock = renderPromptBlock(focusOut, dependencies, evidenceCards, missingPrerequisites);

  return {
    ok: true,
    source: source,
    focus: focusOut,
    dependencies: dependencies.map(function (d) {
      return { conceptId: d.conceptId, title: d.title || "", sourcePages: Array.isArray(d.sourcePages) ? d.sourcePages : [] };
    }),
    related: related.map(function (r) {
      return { conceptId: r.conceptId, title: r.title || "", sourcePages: Array.isArray(r.sourcePages) ? r.sourcePages : [] };
    }),
    evidenceCards: evidenceCards,
    missingPrerequisites: missingPrerequisites,
    promptBlock: promptBlock
  };
}

module.exports = {
  buildLongReasoningContext: buildLongReasoningContext,
  // internal helpers exposed for testing
  _loadCardMap: loadCardMap,
  _kbFallbackGraph: kbFallbackGraph,
  _locateFocus: locateFocus,
  _tracePrerequisites: tracePrerequisites
};
