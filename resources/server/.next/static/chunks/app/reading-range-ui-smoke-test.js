"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var bundle = fs.readFileSync(path.join(__dirname, "page-practice-ui-20260622.js"), "utf-8");
assert.ok(bundle.includes("`${e.loadedStartPage||e.startPage}-${e.loadedEndPage||e.endPage}/${e.totalPages}`"), "loaded-window label uses loaded cursor fields");
assert.ok(!bundle.includes("T=e.totalPages>0?`${e.startPage}-${e.endPage}/${e.totalPages}`"), "taught range is not mislabeled as loaded window");
console.log("reading range UI smoke: PASS");
