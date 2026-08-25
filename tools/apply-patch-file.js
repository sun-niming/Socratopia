"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var patchFile = process.argv[2];
if (!patchFile) throw new Error("Usage: node tools/apply-patch-file.js <patch-file>");
var codexJs = path.join("C:\\Users\\ASUS\\npm-global", "node_modules", "@openai", "codex", "bin", "codex.js");
var patchText = fs.readFileSync(patchFile, "utf8").trimEnd();
var result = childProcess.spawnSync(process.execPath, [codexJs, "--codex-run-as-apply-patch", patchText], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.status == null ? 1 : result.status;
