"use strict";

// Post-class notes v2 — quality scoring and deterministic degradation.
//
// Two jobs:
//  1. `score()` turns a candidate note into numbers so "generated but
//     incomplete" is distinguishable from "generated well" (plan §7.3);
//  2. `assembleDegraded()` builds a note straight from chunk evidence when the
//     merge step cannot be trusted, so a failed merge never loses the lesson.
//
// Thresholds are calibrated on the fixtures under `fixtures/`, not guessed.
//
// Plan: POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md §3.5, §7.

var partitioner = require("./partitioner.js");
var schema = require("./schema.js");

var WEIGHTS = {
  topicCoverage: 0.30,
  learnerEvidenceCoverage: 0.20,
  explanationCoverage: 0.15,
  sourceIntegrity: 0.10,
  reviewQuestionDiversity: 0.10,
  structureValidity: 0.10,
  lengthFitness: 0.05
};

var ACCEPT_THRESHOLD = 0.80;
var REPAIR_THRESHOLD = 0.65;
var DUP_MAX = 0.12;
var DUP_BODY_MATCH = 0.85;
var UNSUPPORTED_MAX = 0.18;

var TOPIC_MATCH = 0.45;
var PHRASE_MATCH = 0.34;

function bigrams(text) {
  var value = String(text || "").replace(/\s+/g, "");
  var set = {};
  if (value.length < 2) {
    if (value) set[value] = true;
    return set;
  }
  for (var i = 0; i < value.length - 1; i++) set[value.slice(i, i + 2)] = true;
  return set;
}

function jaccard(a, b) {
  var keysA = Object.keys(a);
  var keysB = Object.keys(b);
  if (!keysA.length || !keysB.length) return 0;
  var hits = 0;
  for (var i = 0; i < keysA.length; i++) if (b[keysA[i]]) hits += 1;
  return hits / (keysA.length + keysB.length - hits);
}

function similar(left, right, threshold) {
  var a = String(left || "").trim();
  var b = String(right || "").trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 0.9;
  return jaccard(bigrams(a), bigrams(b));
}

function bestMatch(needle, candidates) {
  var best = 0;
  for (var i = 0; i < candidates.length; i++) best = Math.max(best, similar(needle, candidates[i], TOPIC_MATCH));
  return best;
}

function sectionsOf(summary, types) {
  var wanted = {};
  types.forEach(function (type) { wanted[type] = true; });
  return ((summary && summary.sections) || []).filter(function (section) { return wanted[section.type]; });
}

function itemsOf(summary, type) {
  var out = [];
  sectionsOf(summary, [type]).forEach(function (section) {
    (section.items || []).forEach(function (item) { out.push(item); });
  });
  return out;
}

function allTextOf(summary) {
  var chunks = [];
  ((summary && summary.sections) || []).forEach(function (section) {
    if (typeof section.content === "string") chunks.push(section.content);
    (section.items || []).forEach(function (item) {
      if (typeof item.body === "string") chunks.push(item.body);
      if (typeof item.definition === "string") chunks.push(item.definition);
      if (typeof item.answer === "string") chunks.push(item.answer);
      if (typeof item.name === "string") chunks.push(item.name);
      if (typeof item.term === "string") chunks.push(item.term);
      if (typeof item.question === "string") chunks.push(item.question);
    });
  });
  return chunks;
}

function isValidIndex(indexes, min, max) {
  if (!Array.isArray(indexes) || !indexes.length) return false;
  if (typeof min !== "number" || typeof max !== "number") return true;
  return indexes.some(function (index) { return index >= min && index <= max; });
}

function sourceRange(evidence) {
  var min = Infinity;
  var max = -Infinity;
  (evidence || []).forEach(function (chunk) {
    (chunk.sourceIndexes || []).forEach(function (index) {
      if (index < min) min = index;
      if (index > max) max = index;
    });
  });
  return { min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null };
}

function emptyMetrics() {
  return {
    topicCoverage: 0,
    learnerEvidenceCoverage: 0,
    explanationCoverage: 0,
    sourceIntegrity: 0,
    reviewQuestionDiversity: 0,
    structureValidity: 0,
    lengthFitness: 0,
    duplicationRatio: 0,
    unsupportedTopicRatio: 0,
    lengthChars: 0,
    conceptCount: 0,
    evidenceTopicCount: 0
  };
}

function topicNames(evidence) {
  var names = [];
  (evidence || []).forEach(function (chunk) {
    (chunk.topics || []).forEach(function (topic) { if (topic.name) names.push(topic.name); });
  });
  return names;
}

function collectLearnerEvidence(evidence) {
  var out = [];
  (evidence || []).forEach(function (chunk) {
    (chunk.learnerEvidence || []).forEach(function (item) { out.push(item); });
  });
  return out;
}

// A concept counts as supported when its name matches an evidence topic OR its
// body quotes a phrase that appears in the evidence facts/examples.
function isSupported(concept, evidence) {
  var names = topicNames(evidence);
  if (bestMatch(concept.name, names) >= TOPIC_MATCH) return true;
  var body = String(concept.body || "");
  var facts = [];
  (evidence || []).forEach(function (chunk) {
    (chunk.topics || []).forEach(function (topic) {
      (topic.facts || []).forEach(function (fact) { facts.push(fact); });
      (topic.examples || []).forEach(function (example) { facts.push(example); });
    });
  });
  return bestMatch(body.slice(0, 240), facts) >= PHRASE_MATCH;
}

function score(input) {
  var summary = (input && input.summary) || { sections: [] };
  var evidence = (input && input.evidence) || [];
  var requireSources = !(input && input.requireSources === false);
  var metrics = emptyMetrics();
  var warnings = [];
  var range = sourceRange(evidence);

  var concepts = itemsOf(summary, "concepts") || [];
  var conceptNames = concepts.map(function (concept) { return concept.name; });
  var evidenceTopics = topicNames(evidence);
  metrics.evidenceTopicCount = evidenceTopics.length;
  metrics.conceptCount = concepts.length;

  metrics.topicCoverage = evidenceTopics.length
    ? evidenceTopics.filter(function (name) { return bestMatch(name, conceptNames) >= TOPIC_MATCH; }).length / evidenceTopics.length
    : 1;

  var learnerEvidence = collectLearnerEvidence(evidence);
  if (learnerEvidence.length) {
    var corpus = allTextOf(summary);
    var hits = learnerEvidence.filter(function (item) {
      return bestMatch(String(item.content).slice(0, 200), corpus) >= PHRASE_MATCH;
    }).length;
    metrics.learnerEvidenceCoverage = hits / learnerEvidence.length;
  } else {
    metrics.learnerEvidenceCoverage = 1;
  }

  if (concepts.length) {
    var withDetail = concepts.filter(function (concept) {
      var body = String(concept.body || "");
      return body.length >= 60 && /[\n]|：|:|例|example/i.test(body);
    }).length;
    metrics.explanationCoverage = withDetail / concepts.length;
  } else {
    metrics.explanationCoverage = 0;
  }

  var sourceItems = [];
  ((summary && summary.sections) || []).forEach(function (section) {
    if (section.type === "concepts" || section.type === "key-insight") sourceItems.push(section);
  });
  if (!requireSources) {
    metrics.sourceIntegrity = 1;
  } else if (!sourceItems.length) {
    metrics.sourceIntegrity = 1;
  } else {
    var withSource = 0;
    sourceItems.forEach(function (section) {
      if (section.type === "key-insight") {
        if (isValidIndex(section.sourceMessageIndexes, range.min, range.max)) withSource += 1;
        return;
      }
      (section.items || []).forEach(function (item) {
        if (isValidIndex(item.sourceMessageIndexes, range.min, range.max)) withSource += 1;
      });
    });
    var totalItems = 0;
    sourceItems.forEach(function (section) {
      totalItems += section.type === "key-insight" ? 1 : (section.items || []).length;
    });
    metrics.sourceIntegrity = totalItems ? withSource / totalItems : 1;
  }

  var questions = (itemsOf(summary, "review-questions") || []).map(function (item) { return item.question; });
  if (questions.length >= 2) {
    var worst = 0;
    for (var i = 0; i < questions.length; i++) {
      for (var j = i + 1; j < questions.length; j++) worst = Math.max(worst, similar(questions[i], questions[j], 1));
    }
    metrics.reviewQuestionDiversity = 1 - worst;
  } else if (questions.length === 1) {
    metrics.reviewQuestionDiversity = 0.7;
  } else {
    metrics.reviewQuestionDiversity = 0;
  }

  var sections = (summary && summary.sections) || [];
  var structureHits = 0;
  if (sectionsOf(summary, ["tldr"]).length) structureHits += 1;
  if (concepts.length) structureHits += 1;
  if (sections.length >= 2 && sections.length <= 8) structureHits += 1;
  if (questions.length >= 2) structureHits += 1;
  metrics.structureValidity = structureHits / 4;

  var target = (input && input.targetRange) || partitioner.visibleTargetRange(Number(input && input.sourceMessageCount) || 0, input && input.language);
  // Count rendered text only — JSON keys and braces are not what the learner reads.
  metrics.lengthChars = partitioner.countVisible(allTextOf(summary).join("\n"), input && input.language);
  var min = target.min;
  var max = target.max;
  if (metrics.lengthChars >= min && metrics.lengthChars <= max) metrics.lengthFitness = 1;
  else if (metrics.lengthChars < min) metrics.lengthFitness = Math.max(0, metrics.lengthChars / Math.max(min, 1));
  else metrics.lengthFitness = Math.max(0, 1 - (metrics.lengthChars - max) / Math.max(max, 1));

  // Plan §2.3 measures duplication as a *share of sections*, so a couple of
  // near-identical concepts in a seven-concept note reads as ~29% and not 100%.
  // Bodies legitimately share structural boilerplate, hence the 0.65 floor.
  if (concepts.length >= 2) {
    var flagged = {};
    for (var a = 0; a < concepts.length; a++) {
      for (var b = a + 1; b < concepts.length; b++) {
        var nameScore = similar(concepts[a].name, concepts[b].name, 1);
        var bodyScore = 0;
        if (String(concepts[a].body).length > 80 && String(concepts[b].body).length > 80) {
          bodyScore = similar(concepts[a].body.slice(0, 400), concepts[b].body.slice(0, 400), 1);
        }
        if (nameScore >= 0.9 || bodyScore >= DUP_BODY_MATCH) {
          flagged[a] = true;
          flagged[b] = true;
        }
      }
    }
    metrics.duplicationRatio = Object.keys(flagged).length / concepts.length;
  }

  if (concepts.length) {
    var unsupported = concepts.filter(function (concept) { return !isSupported(concept, evidence); }).length;
    metrics.unsupportedTopicRatio = unsupported / concepts.length;
    if (unsupported) warnings.push(unsupported + " concept(s) have no chunk-evidence source");
  }
  if (metrics.sourceIntegrity < 1) warnings.push("sourceIntegrity below 1.0");
  if (metrics.duplicationRatio > DUP_MAX) warnings.push("duplicate concept bodies");

  var total = 0;
  Object.keys(WEIGHTS).forEach(function (key) { total += WEIGHTS[key] * (metrics[key] || 0); });
  total -= Math.max(0, metrics.duplicationRatio - DUP_MAX) * 0.4;
  total -= Math.max(0, metrics.unsupportedTopicRatio - UNSUPPORTED_MAX) * 0.5;
  total = Math.max(0, Math.min(1, total));

  var decision = "accept";
  if (total < REPAIR_THRESHOLD) decision = "remerge";
  else if (total < ACCEPT_THRESHOLD) decision = "repair";
  if (metrics.sourceIntegrity < 1 && decision === "accept") decision = "repair";

  return { score: Number(total.toFixed(4)), metrics: metrics, warnings: warnings, decision: decision };
}

function bulletList(values, marker) {
  return values.map(function (value) { return marker + " " + value; }).join("\n");
}

function dedupeTopics(evidence) {
  var merged = [];
  (evidence || []).forEach(function (chunk) {
    (chunk.topics || []).forEach(function (topic) {
      var existing = null;
      for (var i = 0; i < merged.length; i++) {
        if (similar(merged[i].name, topic.name, 1) >= 0.8) { existing = merged[i]; break; }
      }
      if (!existing) {
        merged.push({
          name: topic.name,
          facts: (topic.facts || []).slice(),
          examples: (topic.examples || []).slice(),
          sourceMessageIndexes: (topic.sourceMessageIndexes || []).slice()
        });
        return;
      }
      existing.facts = existing.facts.concat(topic.facts || []);
      existing.examples = existing.examples.concat(topic.examples || []);
      existing.sourceMessageIndexes = existing.sourceMessageIndexes.concat(topic.sourceMessageIndexes || []);
    });
  });
  merged.forEach(function (topic) {
    topic.facts = topic.facts.filter(function (value, index) { return topic.facts.indexOf(value) === index; }).slice(0, 6);
    topic.examples = topic.examples.filter(function (value, index) { return topic.examples.indexOf(value) === index; }).slice(0, 3);
    topic.sourceMessageIndexes = topic.sourceMessageIndexes.filter(function (value, index) { return topic.sourceMessageIndexes.indexOf(value) === index; });
  });
  return merged;
}

var KIND_LABELS = {
  misconception: "误区",
  correct: "答对",
  confusion: "困惑",
  shift: "理解转变"
};

// §3.5 deterministic assembly.  Weaker prose than a model merge, but nothing
// is invented and nothing is lost.
function assembleDegraded(input) {
  var evidence = (input && input.evidence) || [];
  var language = (input && input.language) || "chinese";
  var english = language === "english";
  var topics = dedupeTopics(evidence);
  var sections = [];

  var first = topics[0];
  if (first) {
    sections.push({
      type: "tldr",
      content: english
        ? "This lesson covered " + first.name + (first.facts[0] ? ": " + first.facts[0] : "") + "."
        : "本节课围绕「" + first.name + "」展开" + (first.facts[0] ? "，" + first.facts[0] : "") + "。"
    });
  }

  if (topics.length) {
    sections.push({
      type: "concepts",
      items: topics.map(function (topic) {
        var body = [];
        if (topic.facts.length) body.push(bulletList(topic.facts, "-"));
        if (topic.examples.length) body.push("", (english ? "**Examples**" : "**例子**"), bulletList(topic.examples, "-"));
        var item = { name: topic.name, body: body.join("\n").trim() };
        if (topic.sourceMessageIndexes.length) item.sourceMessageIndexes = topic.sourceMessageIndexes;
        return item;
      })
    });
  }

  var evidenceItems = collectLearnerEvidence(evidence);
  if (evidenceItems.length) {
    var seen = {};
    var lines = [];
    evidenceItems.forEach(function (item) {
      var key = item.content.slice(0, 40);
      if (seen[key]) return;
      seen[key] = true;
      var label = KIND_LABELS[item.kind] || item.kind;
      lines.push("- **" + label + "**：" + item.content);
    });
    if (lines.length) sections.push({ type: "notes", title: english ? "Learner trajectory" : "学习轨迹", content: lines.join("\n") });
  }

  var insights = [];
  var questions = [];
  var reviewCandidates = [];
  (evidence || []).forEach(function (chunk) {
    (chunk.keyInsights || []).forEach(function (item) { insights.push(item); });
    (chunk.openQuestions || []).forEach(function (item) { questions.push(item); });
    (chunk.reviewCandidates || []).forEach(function (item) { reviewCandidates.push(item); });
  });

  if (insights.length) {
    var insight = insights[0];
    var section = { type: "key-insight", content: insight.content };
    if (insight.sourceMessageIndexes && insight.sourceMessageIndexes.length) section.sourceMessageIndexes = insight.sourceMessageIndexes;
    sections.push(section);
  }
  if (questions.length) sections.push({ type: "open-question", content: questions[0].content });
  if (reviewCandidates.length) {
    sections.push({
      type: "review-questions",
      items: reviewCandidates.slice(0, 5).map(function (item) {
        var out = { question: item.question };
        if (item.answer) out.answer = item.answer;
        return out;
      })
    });
  }

  return {
    sections: schema.mapStrings(sections),
    pagesRange: null,
    degraded: true
  };
}

module.exports = {
  WEIGHTS: WEIGHTS,
  ACCEPT_THRESHOLD: ACCEPT_THRESHOLD,
  REPAIR_THRESHOLD: REPAIR_THRESHOLD,
  score: score,
  assembleDegraded: assembleDegraded,
  similar: similar,
  dedupeTopics: dedupeTopics
};
