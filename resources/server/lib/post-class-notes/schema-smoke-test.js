"use strict";

// PN-002 — loose JSON extraction, markdown normalization and the two-level
// schema (chunk evidence + final summary).
//
//   node resources/server/lib/post-class-notes/schema-smoke-test.js

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var schema = require("./schema.js");

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name + ".json"), "utf8"));
}

function scenario(name, body) {
  try {
    body();
    console.log("  ok   " + name);
  } catch (error) {
    error.message = name + ": " + error.message;
    throw error;
  }
}

// --- JSON extraction -------------------------------------------------------

function plainJson() {
  var result = schema.parseJsonLoose('{"a":1}');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.truncated, false);
  assert.deepStrictEqual(result.value, { a: 1 });
}

function fencedAndWrapped() {
  var fenced = schema.parseJsonLoose('```json\n{"sections":[]}\n```');
  assert.strictEqual(fenced.ok, true, "a code fence is stripped");
  assert.strictEqual(fenced.truncated, false);

  var wrapped = schema.parseJsonLoose('好的，这是笔记：\n\n{"sections":[{"type":"tldr","content":"x"}]}\n\n希望有帮助。');
  assert.strictEqual(wrapped.ok, true, "surrounding prose is ignored");
  assert.strictEqual(wrapped.value.sections[0].type, "tldr");
}

function bracesInsideStrings() {
  var source = '{"content":"use { and } inside, and \\"quoted\\" text"}';
  var result = schema.parseJsonLoose(source);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.value.content, 'use { and } inside, and "quoted" text');
}

function escapedLatex() {
  // The model writes `\(x^2\)` for inline math, which is not a legal JSON
  // escape; repair must preserve it without eating a genuine `\n`.
  var source = '{"body":"公式 \\\\(x^2\\\\) 与换行\\n\\n下一段"}';
  var result = schema.parseJsonLoose(source);
  assert.strictEqual(result.ok, true, "double-escaped latex still parses");
  assert.strictEqual(result.value.body.indexOf("\\(") >= 0, true, "latex delimiter survives");
  assert.strictEqual(result.value.body.indexOf("\n") >= 0, true, "a genuine newline escape still becomes a newline");
}

function controlCharacters() {
  var source = '{"a":"x\u0001y","b":2}';
  var result = schema.parseJsonLoose(source);
  assert.strictEqual(result.ok, true, "raw control characters are sanitized");
  assert.strictEqual(result.value.b, 2);
}

function truncatedArrayIsFlagged() {
  // Exactly the production failure: cut off mid-array (5836 chars, no closing).
  var source = '{"pagesRange":null,"sections":[{"type":"tldr","content":"开头"},{"type":"concepts","items":[{"name":"词法单元","body":"定义是';
  var result = schema.parseJsonLoose(source);
  assert.strictEqual(result.ok, true, "a truncated object is still recoverable");
  assert.strictEqual(result.truncated, true, "and is flagged as truncated so it is never saved as complete");
  assert.strictEqual(result.value.sections.length, 2);
  assert.strictEqual(result.value.sections[1].items[0].name, "词法单元");
}

function truncatedMidStringClosesProperly() {
  var source = '{"sections":[{"type":"tldr","content":"未写完的句';
  var result = schema.parseJsonLoose(source);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.value.sections[0].content, "未写完的句");
}

function trailingCommas() {
  var result = schema.parseJsonLoose('{"a":[1,2,],"b":3,}');
  assert.strictEqual(result.ok, true, "trailing commas are tolerated");
  assert.deepStrictEqual(result.value.a, [1, 2]);
}

function noObject() {
  var result = schema.parseJsonLoose("完全不是 JSON");
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.value, null);
}

// --- markdown normalization (ported semantics) -----------------------------

function malformedFence() {
  var input = ["Before", "```cpp\\ndevice.Scanner::start();\\ndevice.Printer::start();", "```", "After"].join("\n");
  var expected = ["Before", "```cpp", "device.Scanner::start();", "device.Printer::start();", "```", "After"].join("\n");
  assert.strictEqual(schema.normalizeMarkdown(input), expected, "literal \\n inside a malformed fence becomes a line break");
}

function validFenceUnchanged() {
  var input = ["Before", "```cpp", 'printf("\\\\n");', "```", "After"].join("\n");
  assert.strictEqual(schema.normalizeMarkdown(input), input, "valid fences and intentional escapes stay put");
}

function mathConversion() {
  var inline = schema.normalizeMarkdown("求 \\(x^2+1\\) 的最小值");
  assert.strictEqual(/\\\(/.test(inline), false, "inline latex is converted, not left double-escaped");
  assert.ok(/\$x\^2\+1\$/.test(inline), "inline math becomes $...$, got: " + inline);

  var display = schema.normalizeMarkdown("推导：\\[\\frac{1}{x}\\]");
  assert.ok(/\$\$\n\\frac\{1\}\{x\}\n\$\$/.test(display), "display math becomes a block, got: " + display);
}

function bareLanguageFence() {
  var input = ["说明", "python", "def f(x):", "    return x", "", "继续"].join("\n");
  var out = schema.normalizeMarkdown(input);
  assert.ok(out.indexOf("```python") === 0 || out.indexOf("```python") > 0, "a bare language tag opens a fence");
}

function mapStringsIsDeep() {
  var mapped = schema.mapStrings({ a: "看 \\(y\\)", b: ["\\[z\\]"], c: 3 });
  assert.ok(/\$y\$/.test(mapped.a), "nested string normalized");
  assert.ok(/\$\$/.test(mapped.b[0]), "array member normalized");
  assert.strictEqual(mapped.c, 3, "numbers untouched");
}

// --- chunk evidence --------------------------------------------------------

function evidenceClamping() {
  var chunk = { chunkId: "chunk-002", messageRange: [10, 20], sourceIndexes: [10, 12, 15, 20] };
  var value = {
    topics: [{ name: "词法单元", facts: ["x"], sourceMessageIndexes: [12, 99, 15] }],
    learnerEvidence: [{ kind: "MISCONCEPTION", content: "把模式当成串", sourceMessageIndexes: [11] }],
    keyInsights: ["正则和 DFA 不是一回事"],
    openQuestions: [{ content: "最小化是否唯一" }],
    reviewCandidates: [{ question: "什么是词素" }]
  };
  var evidence = schema.normalizeChunkEvidence(value, chunk);
  assert.deepStrictEqual(evidence.topics[0].sourceMessageIndexes, [12, 15], "indexes outside the chunk are dropped");
  assert.strictEqual(evidence.learnerEvidence[0].kind, "misconception", "kind is lowercased");
  assert.deepStrictEqual(evidence.learnerEvidence[0].sourceMessageIndexes, [], "index 11 is outside this chunk");
  assert.strictEqual(evidence.keyInsights[0].content, "正则和 DFA 不是一回事", "a bare string insight is accepted");
  assert.strictEqual(evidence.chunkId, "chunk-002", "chunkId falls back to the slice");
  assert.deepStrictEqual(evidence.messageRange, [10, 20]);
  assert.strictEqual(evidence.reviewCandidates.length, 1);
}

function evidenceKindFallback() {
  var evidence = schema.normalizeChunkEvidence({ learnerEvidence: [{ kind: "nonsense", content: "x" }] }, null);
  assert.strictEqual(evidence.learnerEvidence[0].kind, "confusion", "an unknown kind degrades to confusion");
}

function evidenceValidation() {
  assert.strictEqual(schema.validateChunkEvidence({ topics: [] }).ok, true);
  assert.strictEqual(schema.validateChunkEvidence({}).ok, false);
  assert.strictEqual(schema.validateChunkEvidence(null).ok, false);
}

// --- final summary ---------------------------------------------------------

function unknownSectionsDropped() {
  var result = schema.normalizeSummary({
    sections: [
      { type: "tldr", content: "一句话" },
      { type: "summary", content: "老类型" },
      { type: "concepts", items: [{ name: "A", body: "b" }] },
      { type: "concepts", items: [{ name: "B", body: "b" }] },
      { type: "key-terms", items: [] },
      { type: "notes", title: "没有 content" }
    ]
  });
  var types = result.summary.sections.map(function (section) { return section.type; });
  assert.deepStrictEqual(types, ["tldr", "concepts"], "unknown and empty sections are dropped");
  assert.strictEqual(result.summary.sections[1].items.length, 2, "duplicate concepts sections merge");
  assert.ok(result.warnings.length >= 2, "every drop is reported as a warning");
}

function sectionTypesPreserved() {
  schema.SECTION_TYPES.forEach(function (type) {
    var section;
    if (type === "concepts") section = { type: type, items: [{ name: "n", body: "b" }] };
    else if (type === "key-terms") section = { type: type, items: [{ term: "t", definition: "d" }] };
    else if (type === "review-questions") section = { type: type, items: [{ question: "q" }] };
    else if (type === "notes") section = { type: type, title: "t", content: "c" };
    else section = { type: type, content: "c" };
    var result = schema.normalizeSummary({ sections: [section] });
    assert.strictEqual(result.summary.sections.length, 1, type + " survives normalization (frontend compatibility)");
  });
}

function sourcesSurviveAndNormalize() {
  var result = schema.normalizeSummary({
    sections: [{ type: "concepts", items: [{ name: "词法单元", body: "看 \\(x\\)", sourceMessageIndexes: [3, 5, 3] }] }]
  });
  var item = result.summary.sections[0].items[0];
  assert.deepStrictEqual(item.sourceMessageIndexes, [3, 5], "deduped and sorted");
  assert.ok(/\$x\$/.test(item.body), "markdown inside items is normalized too");

  var stripped = schema.normalizeSummary({ sections: [{ type: "concepts", items: [{ name: "a", body: "b", sourceMessageIndexes: [1] }] }] }, { keepSourceIndexes: false });
  assert.strictEqual(stripped.summary.sections[0].items[0].sourceMessageIndexes, undefined);
}

function summaryValidation() {
  assert.strictEqual(schema.validateSummary({ sections: [{ type: "tldr", content: "x" }] }).ok, true);
  assert.strictEqual(schema.validateSummary({ sections: [] }).ok, false);
  assert.strictEqual(schema.validateSummary({}).ok, false);
  assert.strictEqual(schema.validateSummary(null).ok, false);
  assert.strictEqual(schema.validateSummary({ sections: [{ type: "bogus", content: "x" }] }).ok, false, "a section that cannot render is a validation failure");

  var missingSource = schema.validateSummary({ sections: [{ type: "key-insight", content: "x" }] }, { requireSources: true });
  assert.strictEqual(missingSource.ok, false, "key-insight without a source index fails when sources are required");
}

function hasConceptMatching() {
  var summary = schema.normalizeSummary({ sections: [{ type: "concepts", items: [{ name: "非确定有限自动机", body: "b" }] }] }).summary;
  assert.strictEqual(schema.hasConcept(summary, "非确定有限自动机"), true);
  assert.strictEqual(schema.hasConcept(summary, "非确定"), true, "partial containment counts");
  assert.strictEqual(schema.hasConcept(summary, "最小化"), false);
}

function invalidSchemaIsCoded() {
  assert.strictEqual(schema.invalidSchema("x").code, "schema_invalid");
}

// --- a real fixture end-to-end through the schema --------------------------

function longFixtureShape() {
  var f = fixture("long-80");
  assert.ok(f.messages.length === 80, "fixture kept its shape");
  var summary = schema.normalizeSummary({
    sections: [
      { type: "tldr", content: "本节课围绕词法分析展开。" },
      { type: "concepts", items: [{ name: "词法单元", body: "定义……", sourceMessageIndexes: [0, 1] }] }
    ]
  });
  assert.strictEqual(schema.validateSummary(summary.summary).ok, true);
}

console.log("schema smoke:");
scenario("plain json parses", plainJson);
scenario("fences and surrounding prose are stripped", fencedAndWrapped);
scenario("braces inside strings do not end the scan", bracesInsideStrings);
scenario("escaped latex survives backslash repair", escapedLatex);
scenario("control characters are sanitized", controlCharacters);
scenario("truncated arrays are flagged", truncatedArrayIsFlagged);
scenario("truncation inside a string closes correctly", truncatedMidStringClosesProperly);
scenario("trailing commas are tolerated", trailingCommas);
scenario("non-json returns ok=false", noObject);
scenario("malformed fence newlines are repaired", malformedFence);
scenario("valid fences are untouched", validFenceUnchanged);
scenario("latex is converted to markdown math", mathConversion);
scenario("bare language tags open a fence", bareLanguageFence);
scenario("mapStrings walks nested values", mapStringsIsDeep);
scenario("evidence indexes are clamped to the chunk", evidenceClamping);
scenario("unknown evidence kind degrades", evidenceKindFallback);
scenario("evidence validation", evidenceValidation);
scenario("invalid sections are dropped and reported", unknownSectionsDropped);
scenario("all eight frontend section types survive", sectionTypesPreserved);
scenario("source indexes survive and normalize", sourcesSurviveAndNormalize);
scenario("summary validation", summaryValidation);
scenario("concept matching", hasConceptMatching);
scenario("schema_invalid is a coded error", invalidSchemaIsCoded);
scenario("fixture-driven happy path", longFixtureShape);
console.log("schema smoke: PASS");
