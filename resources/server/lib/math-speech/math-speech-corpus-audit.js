"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var core = require("./index");

var directory = path.join(__dirname, "corpus");
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

function expressionKey(entry) {
  var value = typeof entry.latex === "string" ? entry.latex : entry.mathml;
  return String(value || "").trim().replace(/\s+/g, "");
}

function structuralShape(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map(structuralShape);
  var result = { type: node.type };
  ["operator", "delimiterRole", "inverseRole", "accent", "quantifier", "notation", "open", "close"].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(node, key)) result[key] = node[key];
  });
  Object.keys(node).sort().forEach(function (key) {
    if (["type", "source", "name", "value", "operator", "delimiterRole", "inverseRole", "accent", "quantifier", "notation", "open", "close"].indexOf(key) !== -1) return;
    if (node[key] && typeof node[key] === "object") result[key] = structuralShape(node[key]);
  });
  return result;
}

var entries = [];
var categoryEntries = {};
fs.readdirSync(directory).filter(function (name) { return name.endsWith(".json"); }).sort().forEach(function (name) {
  var category = name.replace(/\.json$/, "");
  var values = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  categoryEntries[category] = values;
  values.forEach(function (entry) { entries.push({ category: category, entry: entry }); });
});

var keyGroups = Object.create(null);
var categoryKeys = {};
var shapeKeys = new Set();
var duplicateEntries = [];
var modeCounts = { semantic: 0, structural: 0, detailed: 0, skip: 0 };
var errors = [];
entries.forEach(function (item) {
  var entry = item.entry;
  var key = expressionKey(entry);
  if (!keyGroups[key]) keyGroups[key] = [];
  keyGroups[key].push(entry.id);
  if (!categoryKeys[item.category]) categoryKeys[item.category] = new Set();
  categoryKeys[item.category].add(key);
  var input = {};
  ["latex", "mathml", "locale", "style", "context", "limits"].forEach(function (field) {
    if (Object.prototype.hasOwnProperty.call(entry, field)) input[field] = entry[field];
  });
  var result = core.prepareMathSpeech(input);
  var mode = result.ok ? result.decision.mode : "skip";
  modeCounts[mode] = (modeCounts[mode] || 0) + 1;
  if (result.ok) shapeKeys.add(JSON.stringify(structuralShape(result.ast)));
  if (!result.ok !== !entry.expected.ok || mode !== entry.expected.mode || result.speech !== entry.expected.speech) errors.push(entry.id);
});
Object.keys(keyGroups).forEach(function (key) {
  if (keyGroups[key].length > 1) duplicateEntries.push({ normalizedExpression: key, entries: keyGroups[key] });
});
duplicateEntries.sort(function (left, right) { return left.normalizedExpression.localeCompare(right.normalizedExpression); });
var uniqueByCategory = {};
Object.keys(categoryKeys).forEach(function (category) { uniqueByCategory[category] = categoryKeys[category].size; });
var report = {
  runner: "math-speech-corpus-audit-v2",
  rawTotal: entries.length,
  normalizedLatexUniqueTotal: Object.keys(keyGroups).length,
  structuralShapeUniqueTotal: shapeKeys.size,
  rawDuplicateEntries: duplicateEntries.reduce(function (sum, group) { return sum + group.entries.length - 1; }, 0),
  rawDuplicateRate: entries.length ? duplicateEntries.reduce(function (sum, group) { return sum + group.entries.length - 1; }, 0) / entries.length : 0,
  perCategory: Object.keys(categoryEntries).sort().reduce(function (result, category) {
    result[category] = { raw: categoryEntries[category].length, normalizedLatexUnique: uniqueByCategory[category] };
    return result;
  }, {}),
  uniqueByCategory: uniqueByCategory,
  duplicateGroups: duplicateEntries,
  modes: modeCounts,
  detailedEntries: modeCounts.detailed,
  structuralEntries: modeCounts.structural,
  skipEntries: modeCounts.skip,
  expectedMismatches: errors,
  thresholds: { uniqueTotalAtLeast: 230, detailedAtLeast: 1, categoryMinimums: minimums },
};
report.thresholdsPass = report.normalizedLatexUniqueTotal >= 230 && report.detailedEntries >= 1 && Object.keys(minimums).every(function (category) {
  return report.perCategory[category] && report.perCategory[category].raw >= minimums[category];
});
assert.strictEqual(report.expectedMismatches.length, 0, "corpus expected values must match: " + JSON.stringify(report.expectedMismatches));
assert.strictEqual(report.rawDuplicateEntries, 0);
assert.strictEqual(report.thresholdsPass, true);
console.log(JSON.stringify(report, null, 2));
