"use strict";

var assert = require("assert");
var path = require("path");
var P = require("./pdfjs-paths.js");

var root = path.join("E:\\app", "node_modules", "pdfjs-dist", "cmaps");
var value = P.resourceDir(root);
assert.ok(path.isAbsolute(value), "resource directory is absolute");
assert.ok(!/^file:/i.test(value), "resource directory is not a file URL");
assert.ok(!value.includes("\\"), "resource directory uses forward slashes");
assert.ok(value.endsWith("/"), "resource directory has a trailing slash");

console.log("pdfjs paths smoke: PASS " + value);
