"use strict";

// Exercise the actual bundled parser with synthetic reports only.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "route.js"), "utf8");
const start = source.indexOf('function D(a,b="chinese")');
const end = source.indexOf("let K=new Map", start);
assert(start >= 0 && end > start, "bundled parser must be present");
const parse = vm.runInNewContext("(" + source.slice(start, end) + ")", {
  i: { _O: () => 200, Xq: 200 },
  console: { warn() {} }
});
const sections = {
  FAREWELL: "See you next lesson.",
  PAL_MOMENTS_MD: "## 2026-09-13 | Test companion\nReviewed sockets.",
  PROGRESS_MD: "# Current Page: 131\nResume exercises next lesson.",
  DIARY_ENTRY: "## 2026-09-13\nStudied with the test companion.",
  RELATION_MD: "",
  COMPANION_NOTE: "We will start with the exercises."
};
const report = Object.entries(sections).map(([tag, body]) => "===" + tag + "===\n" + body).join("\n") + "\n===END===";
const expected = JSON.stringify(parse(report));
let passed = 0;
function check(name, fn) { fn(); passed++; console.log("PASS " + name); }
check("canonical six sections, empty relationship allowed", () => assert.strictEqual(parse(report).relationMd, undefined));
for (const [name, format] of [
  ["three-line markers", tag => "===\n" + tag + "\n==="],
  ["two-line markers", tag => "===" + tag + "\n==="],
  ["spaces and CRLF", tag => "  === \r\n  " + tag + " \r\n ===  "]
]) {
  check(name, () => assert.strictEqual(JSON.stringify(parse(report.replace(/===([A-Z_]+)===/g, (_, tag) => format(tag)))), expected));
}
check("mixed markers seen in incident", () => assert.strictEqual(JSON.stringify(parse(report.replace(/===(PAL_MOMENTS_MD|PROGRESS_MD|DIARY_ENTRY|RELATION_MD|COMPANION_NOTE)===/g, "===\n$1\n==="))), expected));
check("preserve ordinary markdown separators", () => assert(parse(report.replace("Reviewed sockets.", "Reviewed sockets.\n===\nNormal paragraph.")).palMomentsMd.includes("===\nNormal paragraph.")));
for (const tag of Object.keys(sections)) {
  check("reject missing " + tag, () => assert.throws(() => parse(report.replace("===" + tag + "===\n" + sections[tag] + "\n", ""))));
  if (tag !== "RELATION_MD") check("reject empty " + tag, () => assert.throws(() => parse(report.replace(sections[tag], ""))));
}
check("reject truncated report without END", () => assert.throws(() => parse(report.replace("\n===END===", ""))));
check("reject duplicate required section", () => assert.throws(() => parse(report.replace("===END===", "===PROGRESS_MD===\nConflicting page.\n===END==="))));
check("reject content after END", () => assert.throws(() => parse(report + "\n===PROGRESS_MD===\nConflicting page.")));
console.log("end-class parser smoke: " + passed + " passed");
