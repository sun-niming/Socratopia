"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const routePath = path.join(__dirname, "route.js");
const source = fs.readFileSync(routePath, "utf8");
const start = source.indexOf("function ab(a){");
// Slice the whole function expression out. Anchoring on the next statement's
// text used to depend on exact whitespace (`}let K=` vs `}\nlet K=`); scanning
// back to the normalizer's own closing brace is immune to that, which matters
// now that the `let K=` prompt constants are gone.
const sentinel = source.indexOf("Q=(0,y.pW)(async function(a){", start);
const end = sentinel < 0 ? -1 : source.lastIndexOf("}", sentinel);

assert.notStrictEqual(start, -1, "concept-summary markdown normalizer was not found");
assert.notStrictEqual(end, -1, "concept-summary markdown normalizer end was not found");
assert.ok(end > start, "concept-summary markdown normalizer must end after it starts");

const normalizeMarkdown = Function(
  `return (${source.slice(start, end + 1)})`,
)();

const malformedFence = [
  "Before",
  "```cpp\\ndevice.Scanner::start();\\ndevice.Printer::start();",
  "```",
  "After",
].join("\n");
const expectedFence = [
  "Before",
  "```cpp",
  "device.Scanner::start();",
  "device.Printer::start();",
  "```",
  "After",
].join("\n");

assert.strictEqual(
  normalizeMarkdown(malformedFence),
  expectedFence,
  "literal escaped newlines inside a malformed fenced code block must become line breaks",
);

const validFence = [
  "Before",
  "```cpp",
  'printf("\\\\n");',
  "```",
  "After",
].join("\n");

assert.strictEqual(
  normalizeMarkdown(validFence),
  validFence,
  "valid fenced code and intentional escaped characters must remain unchanged",
);

console.log("concept-summary markdown smoke test passed");
