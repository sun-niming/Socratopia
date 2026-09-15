"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const routePath = path.join(__dirname, "route.js");
const source = fs.readFileSync(routePath, "utf8");
const start = source.indexOf("function ab(a){");
const endMarkers = ["}let K=`", "}\nlet K=`"];
const end = Math.max(...endMarkers.map((marker) => source.indexOf(marker, start)));

assert.notStrictEqual(start, -1, "concept-summary markdown normalizer was not found");
assert.notStrictEqual(end, -1, "concept-summary markdown normalizer end was not found");

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
