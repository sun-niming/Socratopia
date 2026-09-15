"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");
var quality = require("../ocr/ocr-quality.js");

var pdfPath = process.argv[2];
if (!pdfPath || !fs.existsSync(pdfPath)) {
  console.error("Usage: node pdf-cmap-real-smoke-test.js <real-pdf-path>");
  process.exit(2);
}

var helper = path.join(__dirname, "..", "pdf-worker.mjs");
var pages = [34, 35, 62, 63];
var result = childProcess.spawnSync(process.execPath, [helper, "--coordinator-ipc"], {
  encoding: "utf8",
  input: JSON.stringify({ command: "extract", filePath: pdfPath, startPage: 34, endPage: 63 }),
  maxBuffer: 50 * 1024 * 1024,
  timeout: 120000,
  windowsHide: true,
});
assert.strictEqual(result.status, 0, "PDF helper exits successfully: " + String(result.stderr || ""));
assert.ok(!/Unable to load binary CMap|file:\/\/.*cmaps/i.test(result.stderr || ""), "no CMap path/load warning");
var parsed = JSON.parse(result.stdout);
pages.forEach(function (page) {
  var item = (parsed.pages || []).find(function (entry) { return Number(entry.page) === page; }) || {};
  var text = quality.normalize(item.text);
  var cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  assert.ok(cjk >= 100, "page " + page + " contains semantic Chinese text (CJK=" + cjk + ")");
  assert.strictEqual(quality.assess(text, { expectedCjk: true }).garbled, false, "page " + page + " is not garbled");
});

console.log("real PDF CMap smoke: PASS pages=" + pages.join(","));
