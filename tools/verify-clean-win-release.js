"use strict";

var path = require("path");
var verifyCleanWinRelease = require("./stage-clean-win-release.js").verifyCleanWinRelease;

var target = process.argv[2];
if (!target) {
  console.error("Usage: node tools/verify-clean-win-release.js <win-unpacked>");
  process.exitCode = 2;
} else {
  try {
    var result = verifyCleanWinRelease(path.resolve(target));
    console.log("clean Windows release verified: files=" + result.files + " bytes=" + result.bytes + " root=" + result.root);
  } catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  }
}
