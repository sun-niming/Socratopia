"use strict";

var fs = require("fs");

var file = process.argv[2];
var moduleId = process.argv[3];
var nextModuleId = process.argv[4];
if (!file || !/^\d+$/.test(moduleId || "") || !/^\d+$/.test(nextModuleId || "")) {
  throw new Error("Usage: node tools/split-bundle-module.js <file> <moduleId> <nextModuleId>");
}
var source = fs.readFileSync(file, "utf8");
var startNeedle = moduleId + ":";
var endNeedle = "," + nextModuleId + ":";
var start = source.indexOf(startNeedle);
var end = source.indexOf(endNeedle, start + startNeedle.length);
if (start < 0 || end < 0) throw new Error("Module boundary not found");
var output = source.slice(0, start) + "\n" + source.slice(start, end + 1) + "\n" + source.slice(end + 1);
fs.writeFileSync(file, output, "utf8");
