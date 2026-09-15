"use strict";

// Post-class notes v2 — loose JSON extraction, markdown normalization and the
// two-level schema (chunk evidence + final summary).
//
// The final summary keeps the eight section types the shipped frontend already
// renders; evidence/quality/trace live in `generationMeta` so an old frontend
// that ignores unknown fields still works (plan §7.4).
//
// Plan: POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md §3.3, §3.4, §7.2, §7.4.

var errors = require("./errors.js");

var SECTION_TYPES = ["tldr", "narrative", "concepts", "key-insight", "open-question", "key-terms", "review-questions", "notes"];
var SECTION_TYPE_SET = {};
SECTION_TYPES.forEach(function (type) { SECTION_TYPE_SET[type] = true; });

var EVIDENCE_KINDS = ["misconception", "correct", "confusion", "shift"];
var EVIDENCE_KIND_SET = {};
EVIDENCE_KINDS.forEach(function (kind) { EVIDENCE_KIND_SET[kind] = true; });

var CONTENT_SECTIONS = { tldr: true, narrative: true, "key-insight": true, "open-question": true };
var ITEM_SECTIONS = { concepts: true, "key-terms": true, "review-questions": true };

var CODE_LANGUAGES = ["js", "javascript", "ts", "typescript", "python", "py", "bash", "sh", "shell", "java", "c", "cpp", "c++", "cs", "csharp", "go", "rust", "sql", "html", "css", "json"];
var CODE_LANGUAGE_SET = {};
CODE_LANGUAGES.forEach(function (language) { CODE_LANGUAGE_SET[language] = true; });

var FENCE_JOIN = /(^|\n)(\x60{3,}|~{3,})([^\n]*?)\\n([\s\S]*?)(?=\n\2(?:\n|$))/g;
var ESCAPED_NEWLINE = /\\r\\n|\\n(?=\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\x60\x60\x60|$))/g;
var DOUBLE_BACKSLASH = /\\\\([()[\]])/g;
var DISPLAY_MATH = /\\\[([\s\S]*?)\\\]/g;
var INLINE_MATH = /\\\(([\s\S]*?)\\\)/g;
var CODE_START = /[{}();=#]|^\s*(class|function|const|let|var|def|import|from|echo|grep|cat|sed|awk|SELECT|WITH|CREATE|public|private)\b/i;

// ---------------------------------------------------------------- JSON input

// Models routinely double-escape backslashes used by LaTeX (`\\(`, `\\frac`).
// Repair only the sequences that are *not* legal JSON escapes, so a genuine
// `\\n` inside a C++ snippet survives.
function repairBackslashes(input) {
  var value = String(input == null ? "" : input);
  var out = "";
  var index = 0;
  var safeChars = { '"': true, "\\": true, "/": true };
  var safeEscapes = { b: true, f: true, n: true, r: true, t: true, u: true };
  while (index < value.length) {
    if (value[index] === "\\" && index + 1 < value.length) {
      var next = value[index + 1];
      if (safeChars[next]) { out += "\\" + next; index += 2; continue; }
      if (safeEscapes[next]) {
        var after = index + 2 < value.length ? value[index + 2] : "";
        if (/[a-zA-Z]/.test(after)) { out += "\\\\" + next; index += 2; continue; }
        out += "\\" + next; index += 2; continue;
      }
      out += "\\\\" + next; index += 2; continue;
    }
    out += value[index];
    index += 1;
  }
  return out;
}

function stripFences(text) {
  var value = String(text == null ? "" : text).trim();
  var fenced = value.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  return fenced ? fenced[1].trim() : value;
}

// Scans for the balanced `{...}` object while honouring string literals, so a
// brace inside a concept body never ends the scan early.  Returns
// `closed: false` when the model was cut off mid-array.
function sliceFirstObject(text) {
  var value = String(text == null ? "" : text);
  var start = value.indexOf("{");
  if (start < 0) return { json: "", closed: false };
  var depth = 0;
  var inString = false;
  var escaped = false;
  for (var i = start; i < value.length; i++) {
    var ch = value[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { json: value.slice(start, i + 1), closed: true };
    }
  }
  return { json: value.slice(start), closed: false };
}

// Appends the missing closers for a truncated object, honouring string state
// and nesting order (`]` must close before its enclosing `}`).
function closeUnbalanced(json) {
  var stack = [];
  var inString = false;
  var escaped = false;
  for (var i = 0; i < json.length; i++) {
    var ch = json[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  var out = json;
  if (inString) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

function sanitizeJsonText(json) {
  var value = repairBackslashes(json);
  while (/,\s*([}\]])/.test(value)) value = value.replace(/,\s*([}\]])/g, "$1");
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
}

function attemptParse(json) {
  if (!json) return null;
  try { return JSON.parse(json); } catch (_) {}
  try { return JSON.parse(sanitizeJsonText(json)); } catch (_) {}
  return null;
}

// Returns `{ ok, value, truncated, raw }`.  `truncated` is what stops a
// half-written array from being saved as a successful note.
function parseJsonLoose(text) {
  var body = stripFences(text);
  var sliced = sliceFirstObject(body);
  if (!sliced.json) return { ok: false, value: null, truncated: false, raw: body.slice(0, 400) };

  if (sliced.closed) {
    var parsed = attemptParse(sliced.json);
    if (parsed) return { ok: true, value: parsed, truncated: false, raw: "" };
  }
  var recovered = attemptParse(closeUnbalanced(sliced.json));
  if (recovered) return { ok: true, value: recovered, truncated: true, raw: "" };
  return { ok: false, value: null, truncated: true, raw: body.slice(0, 400) };
}

// ------------------------------------------------------------- markdown fix

// Ported from the shipped route so existing notes normalize identically:
// escaped newlines inside malformed fences, `\(...\)`/`\[...\]` math, and
// bare language tags used as fence openers.
function normalizeMarkdown(input) {
  var value = String(input == null ? "" : input);
  value = value.replace(FENCE_JOIN, function (match, lead, fence, tag, body) {
    return lead + fence + tag + "\n" + body.replace(/\\n/g, "\n");
  });
  value = value.replace(ESCAPED_NEWLINE, "\n");
  value = value.replace(DOUBLE_BACKSLASH, "\\$1");
  value = value
    .replace(DISPLAY_MATH, function (match, body) { return "\n\n$$\n" + body.trim() + "\n$$\n\n"; })
    .replace(INLINE_MATH, function (match, body) { return "$" + body.trim() + "$"; });

  var lines = value.split("\n");
  var out = [];
  var inFence = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim().toLowerCase();
    if (!inFence && CODE_LANGUAGE_SET[trimmed] && i + 1 < lines.length && CODE_START.test(lines[i + 1])) {
      out.push("```" + (trimmed === "py" ? "python" : trimmed === "sh" ? "bash" : trimmed));
      inFence = true;
      continue;
    }
    if (inFence && line.trim() === "") { out.push("```"); out.push(line); inFence = false; continue; }
    out.push(line);
  }
  if (inFence) out.push("```");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function mapStrings(value) {
  if (typeof value === "string") return normalizeMarkdown(value);
  if (Array.isArray(value)) return value.map(mapStrings);
  if (value && typeof value === "object") {
    var out = {};
    Object.keys(value).forEach(function (key) { out[key] = mapStrings(value[key]); });
    return out;
  }
  return value;
}

// -------------------------------------------------------------- index utils

function toIndexArray(value, allowed) {
  if (!Array.isArray(value)) return [];
  var allow = allowed ? new Set(allowed) : null;
  var out = [];
  for (var i = 0; i < value.length; i++) {
    var index = Number(value[i]);
    if (!Number.isInteger(index) || index < 0) continue;
    if (allow && !allow.has(index)) continue;
    if (out.indexOf(index) < 0) out.push(index);
  }
  return out.sort(function (a, b) { return a - b; });
}

// ------------------------------------------------------------ chunk evidence

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeChunkEvidence(value, chunk) {
  var source = value && typeof value === "object" ? value : {};
  var allowed = chunk && chunk.sourceIndexes ? chunk.sourceIndexes : null;
  var evidence = {
    chunkId: text(source.chunkId) || (chunk && chunk.chunkId) || "",
    messageRange: Array.isArray(source.messageRange) && source.messageRange.length === 2
      ? [Number(source.messageRange[0]), Number(source.messageRange[1])]
      : (chunk && chunk.messageRange) || [],
    topics: [],
    learnerEvidence: [],
    keyInsights: [],
    openQuestions: [],
    reviewCandidates: []
  };

  (Array.isArray(source.topics) ? source.topics : []).forEach(function (topic) {
    if (!topic || !text(topic.name)) return;
    evidence.topics.push({
      name: text(topic.name),
      facts: (Array.isArray(topic.facts) ? topic.facts : []).map(text).filter(Boolean),
      examples: (Array.isArray(topic.examples) ? topic.examples : []).map(text).filter(Boolean),
      sourceMessageIndexes: toIndexArray(topic.sourceMessageIndexes, allowed)
    });
  });

  (Array.isArray(source.learnerEvidence) ? source.learnerEvidence : []).forEach(function (item) {
    if (!item || !text(item.content)) return;
    var kind = text(item.kind).toLowerCase();
    evidence.learnerEvidence.push({
      kind: EVIDENCE_KIND_SET[kind] ? kind : "confusion",
      content: text(item.content),
      sourceMessageIndexes: toIndexArray(item.sourceMessageIndexes, allowed)
    });
  });

  (Array.isArray(source.keyInsights) ? source.keyInsights : []).forEach(function (item) {
    var content = text(item && item.content) || text(item);
    if (!content) return;
    evidence.keyInsights.push({ content: content, sourceMessageIndexes: toIndexArray(item && item.sourceMessageIndexes, allowed) });
  });

  (Array.isArray(source.openQuestions) ? source.openQuestions : []).forEach(function (item) {
    var content = text(item && item.content) || text(item);
    if (!content) return;
    evidence.openQuestions.push({ content: content, sourceMessageIndexes: toIndexArray(item && item.sourceMessageIndexes, allowed) });
  });

  (Array.isArray(source.reviewCandidates) ? source.reviewCandidates : []).forEach(function (item) {
    var question = text(item && item.question);
    if (!question) return;
    evidence.reviewCandidates.push({
      question: question,
      answer: text(item && item.answer),
      sourceMessageIndexes: toIndexArray(item && item.sourceMessageIndexes, allowed)
    });
  });

  return evidence;
}

function validateChunkEvidence(value) {
  var problems = [];
  if (!value || typeof value !== "object") problems.push("evidence is not an object");
  else if (!Array.isArray(value.topics)) problems.push("evidence.topics is not an array");
  return { ok: problems.length === 0, errors: problems };
}

// -------------------------------------------------------------- final summary

function normalizeSection(section) {
  if (!section || typeof section !== "object") return null;
  var type = text(section.type);
  if (!SECTION_TYPE_SET[type]) return null;
  var out = { type: type };

  if (CONTENT_SECTIONS[type]) {
    var content = text(section.content);
    if (!content) return null;
    out.content = content;
    if (type === "key-insight" && text(section.attribution)) out.attribution = text(section.attribution);
  } else if (ITEM_SECTIONS[type]) {
    var items = (Array.isArray(section.items) ? section.items : []).map(function (item) { return normalizeItem(type, item); }).filter(Boolean);
    if (!items.length) return null;
    out.items = items;
  } else {
    var body = text(section.content);
    var title = text(section.title);
    if (!body || !title) return null;
    out.title = title;
    out.content = body;
  }

  var indexes = toIndexArray(section.sourceMessageIndexes, null);
  if (indexes.length) out.sourceMessageIndexes = indexes;
  return out;
}

function normalizeItem(type, item) {
  if (!item || typeof item !== "object") return null;
  if (type === "concepts") {
    var name = text(item.name);
    var itemBody = text(item.body);
    if (!name || !itemBody) return null;
    var concept = { name: name, body: itemBody };
    var indexes = toIndexArray(item.sourceMessageIndexes, null);
    if (indexes.length) concept.sourceMessageIndexes = indexes;
    return concept;
  }
  if (type === "key-terms") {
    var term = text(item.term);
    var definition = text(item.definition);
    if (!term || !definition) return null;
    return { term: term, definition: definition };
  }
  var question = text(item.question);
  if (!question) return null;
  var review = { question: question };
  if (text(item.hint)) review.hint = text(item.hint);
  if (text(item.answer)) review.answer = text(item.answer);
  return review;
}

function validateSummary(value, options) {
  var opts = options || {};
  var problems = [];
  if (!value || typeof value !== "object") return { ok: false, errors: ["summary is not an object"] };
  if (!Array.isArray(value.sections)) problems.push("summary.sections is not an array");
  else {
    if (!value.sections.length) problems.push("summary.sections is empty");
    var dropped = value.sections.filter(function (section) { return !normalizeSection(section); }).length;
    if (dropped) problems.push(dropped + " section(s) failed normalization");
  }
  if (opts.requireSources) {
    var missing = 0;
    (value.sections || []).forEach(function (section) {
      if (!section || !CONTENT_SECTIONS[section.type] || section.type !== "key-insight") return;
      if (!toIndexArray(section.sourceMessageIndexes, null).length) missing += 1;
    });
    if (missing) problems.push(missing + " key-insight section(s) without source indexes");
  }
  return { ok: problems.length === 0, errors: problems };
}

// Returns `{ summary, warnings }`; sections that cannot be rendered are dropped
// rather than shipped broken.
function normalizeSummary(value, options) {
  var opts = options || {};
  var source = value && typeof value === "object" ? value : {};
  var warnings = [];
  var seen = {};
  var sections = [];
  var list = Array.isArray(source.sections) ? source.sections : [];
  list.forEach(function (section) {
    var normalized = normalizeSection(section);
    if (!normalized) { warnings.push("dropped invalid section type=" + text(section && section.type)); return; }
    if (seen[normalized.type] && normalized.type !== "notes") {
      var existing = seen[normalized.type];
      if (existing.items && normalized.items) {
        existing.items = existing.items.concat(normalized.items);
        return;
      }
      warnings.push("merged duplicate section type=" + normalized.type);
      return;
    }
    seen[normalized.type] = normalized;
    sections.push(normalized);
  });

  var summary = {
    sections: sections.map(mapStrings)
  };
  if (typeof source.pagesRange === "string" && source.pagesRange.trim()) summary.pagesRange = normalizeMarkdown(source.pagesRange.trim());
  else summary.pagesRange = null;

  if (opts.keepSourceIndexes === false) {
    summary.sections.forEach(function (section) {
      delete section.sourceMessageIndexes;
      (section.items || []).forEach(function (item) { delete item.sourceMessageIndexes; });
    });
  }
  return { summary: summary, warnings: warnings };
}

function hasConcept(summary, name) {
  var needle = String(name || "").trim();
  if (!needle) return false;
  var sections = (summary && summary.sections) || [];
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].type !== "concepts") continue;
    for (var j = 0; j < sections[i].items.length; j++) {
      var item = sections[i].items[j];
      if (item.name === needle) return true;
      if (item.name.indexOf(needle) >= 0 || needle.indexOf(item.name) >= 0) return true;
    }
  }
  return false;
}

function invalidSchema(message) {
  return errors.codedError(errors.CODES.schema_invalid, message);
}

module.exports = {
  SECTION_TYPES: SECTION_TYPES,
  EVIDENCE_KINDS: EVIDENCE_KINDS,
  repairBackslashes: repairBackslashes,
  parseJsonLoose: parseJsonLoose,
  normalizeMarkdown: normalizeMarkdown,
  mapStrings: mapStrings,
  normalizeChunkEvidence: normalizeChunkEvidence,
  validateChunkEvidence: validateChunkEvidence,
  normalizeSummary: normalizeSummary,
  validateSummary: validateSummary,
  hasConcept: hasConcept,
  invalidSchema: invalidSchema
};
