"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var core = require("./index");
var seal = require("./seal-policy");

var corpusDirectory = path.join(__dirname, "corpus");
var files = fs.readdirSync(corpusDirectory).filter(function (name) { return name.endsWith(".json"); }).sort();
var entries = [];
var categoryCounts = {};
var categoryKeys = {};
files.forEach(function (file) {
  var category = file.replace(/\.json$/, "");
  var content = JSON.parse(fs.readFileSync(path.join(corpusDirectory, file), "utf8"));
  assert(Array.isArray(content), file + " must contain an array");
  categoryCounts[category] = content.length;
  categoryKeys[category] = new Set();
  content.forEach(function (entry) { entries.push({ category: category, value: entry }); });
});

var minimums = {
  algebra: 50,
  "fractions-roots-powers": 30,
  calculus: 30,
  "sets-logic": 25,
  "probability-statistics": 20,
  "linear-algebra": 20,
  numbers: 25,
  "ambiguity-errors": 30,
};
Object.keys(minimums).forEach(function (category) { assert(categoryCounts[category] >= minimums[category], category + " corpus minimum"); });
assert(entries.length >= 200, "golden corpus must contain at least 200 entries");

var requiredRegressionIds = ["ambiguity-errors-043", "ambiguity-errors-044"];
var entriesById = new Map(entries.map(function (item) { return [item.value.id, item.value]; }));
requiredRegressionIds.forEach(function (id) { assert(entriesById.has(id), "required regression is missing: " + id); });
var ordinaryPRegression = entriesById.get("ambiguity-errors-043");
assert(ordinaryPRegression.context && ordinaryPRegression.context.symbolFacts && ordinaryPRegression.context.symbolFacts.P && ordinaryPRegression.context.symbolFacts.P.type === "function", "ambiguity-errors-043 must preserve the explicit ordinary P function contract");
var ordinaryPrRegression = entriesById.get("ambiguity-errors-044");
assert(ordinaryPrRegression.context && /(?:^|[^A-Za-z0-9])Pr(?:[^A-Za-z0-9]|$)/.test(ordinaryPrRegression.context.currentSentence || ""), "ambiguity-errors-044 must preserve the current-sentence Pr function contract");

function normalizedExpressionKey(entry) {
  if (typeof entry.latex === "string") return "latex:" + entry.latex.trim().replace(/\s+/g, "");
  return "mathml:" + String(entry.mathml || "").trim().replace(/\s+/g, "");
}

function astShape(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map(astShape);
  var shape = { type: node.type };
  ["operator", "delimiterRole", "inverseRole", "accent", "quantifier", "notation", "open", "close"].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(node, key)) shape[key] = node[key];
  });
  Object.keys(node).sort().forEach(function (key) {
    if (["type", "source", "name", "value", "operator", "delimiterRole", "inverseRole", "accent", "quantifier", "notation", "open", "close"].indexOf(key) !== -1) return;
    if (node[key] && typeof node[key] === "object") shape[key] = astShape(node[key]);
  });
  return shape;
}

var expressionKeys = new Map();
var duplicateEntries = [];
var uniqueByCategory = {};
var shapeKeys = new Set();
var detailedEntries = 0;
var structuralEntries = 0;
var skipEntries = 0;

var modes = { semantic: 0, structural: 0, detailed: 0, skip: 0 };
var coverage = 0;
var passed = 0;
entries.forEach(function (item) {
  var entry = item.value;
  assert(entry && typeof entry.id === "string", item.category + " entry id");
  assert(typeof entry.latex === "string" || typeof entry.mathml === "string", entry.id + " expression");
  assert(entry.expected && typeof entry.expected === "object", entry.id + " expected");
  var input = {};
  ["latex", "mathml", "locale", "style", "context", "limits"].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) input[key] = entry[key];
  });
  var result = core.prepareMathSpeech(input);
  var expected = entry.expected;
  var expressionKey = normalizedExpressionKey(entry);
  if (expressionKeys.has(expressionKey)) duplicateEntries.push({ key: expressionKey, first: expressionKeys.get(expressionKey), duplicate: entry.id });
  else expressionKeys.set(expressionKey, entry.id);
  categoryKeys[item.category].add(expressionKey);
  if (result.ok) shapeKeys.add(JSON.stringify(astShape(result.ast)));
  assert.strictEqual(result.ok, expected.ok, entry.id + " ok");
  var mode = result.ok ? result.decision.mode : "skip";
  modes[mode] = (modes[mode] || 0) + 1;
  if (mode === "detailed") detailedEntries += 1;
  if (mode === "structural") structuralEntries += 1;
  if (mode === "skip") skipEntries += 1;
  assert.strictEqual(mode, expected.mode, entry.id + " mode");
  assert.strictEqual(result.speech, expected.speech, entry.id + " speech");
  if (expected.reason) assert.strictEqual(result.diagnostics.reason, expected.reason, entry.id + " reason");
  if (expected.unresolvedAmbiguities) assert.deepStrictEqual(result.decision.unresolvedAmbiguities, expected.unresolvedAmbiguities, entry.id + " ambiguities");
  assert.strictEqual(result.decision.sealed, true, entry.id + " sealed");
  assert.strictEqual(typeof result.speech, "string", entry.id + " speech type");
  assert.strictEqual(seal.containsForbiddenSpeech(result.speech), false, entry.id + " safe speech");
  if (result.ok) coverage += result.diagnostics.nodeCoverage;
  passed += 1;
});

Object.keys(categoryKeys).forEach(function (category) { uniqueByCategory[category] = categoryKeys[category].size; });
assert.strictEqual(duplicateEntries.length, 0, "golden corpus must not duplicate normalized expressions: " + JSON.stringify(duplicateEntries));
assert(expressionKeys.size >= 230, "golden corpus must contain at least 230 unique normalized expressions");
assert(detailedEntries > 0, "golden corpus must contain detailed-mode entries");

console.log(JSON.stringify({
  total: entries.length,
  passed: passed,
  categories: categoryCounts,
  uniqueNormalizedExpressions: expressionKeys.size,
  structuralShapes: shapeKeys.size,
  uniqueByCategory: uniqueByCategory,
  duplicateEntries: duplicateEntries,
  modes: modes,
  detailedEntries: detailedEntries,
  structuralEntries: structuralEntries,
  skipEntries: skipEntries,
  meanNodeCoverage: Number((coverage / Math.max(1, modes.semantic + modes.structural + modes.detailed)).toFixed(4)),
}, null, 2));
