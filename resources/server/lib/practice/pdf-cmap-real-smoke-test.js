"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var pdfPath = process.argv[2];
if (!pdfPath || !fs.existsSync(pdfPath)) {
  console.error("Usage: node pdf-cmap-real-smoke-test.js <real-pdf-path>");
  process.exit(2);
}

var helper = path.join(__dirname, "pdf-page-extractor-child.mjs");
var pages = [34, 35, 62, 63];
var result = childProcess.spawnSync(process.execPath, [helper, pdfPath, JSON.stringify(pages), "true"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
  timeout: 120000,
  windowsHide: true,
});
assert.strictEqual(result.status, 0, "PDF helper exits successfully: " + String(result.stderr || ""));
assert.ok(!/Unable to load binary CMap|file:\/\/.*cmaps/i.test(result.stderr || ""), "no CMap path/load warning");
var parsed = JSON.parse(result.stdout);
pages.forEach(function (page) {
  var text = String(parsed.pages && parsed.pages[String(page)] || "");
  var cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  assert.ok(cjk >= 100, "page " + page + " contains semantic Chinese text (CJK=" + cjk + ")");
  assert.strictEqual(!!(parsed.diagnostics && parsed.diagnostics[String(page)] && parsed.diagnostics[String(page)].garbled), false, "page " + page + " is not garbled");
});

console.log("real PDF CMap smoke: PASS pages=" + pages.join(","));
