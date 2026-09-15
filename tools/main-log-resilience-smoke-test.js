"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const targets = [
  path.join(process.cwd(), "main.js"),
  path.join(process.cwd(), "_asar_extracted", "dist-electron", "main.js")
];

for (const target of targets) {
  const source = fs.readFileSync(target, "utf8");
  assert(source.includes("LOG_MAX_BYTES"), `${target}: log size must be bounded and rotated`);
  assert(source.includes('process.stdout?.on?.("error"'), `${target}: stdout EPIPE needs an error handler`);
  assert(source.includes('process.stderr?.on?.("error"'), `${target}: stderr EPIPE needs an error handler`);
  assert(source.includes('if (err?.code === "EPIPE")'), `${target}: stdio EPIPE must be recognized`);
  assert(source.includes('appendLogLine("[uncaughtException] "'), `${target}: uncaughtException must write file-only logs`);
  assert(source.includes('appendLogLine("[unhandledRejection] "'), `${target}: unhandledRejection must write file-only logs`);
  const logFunction = source.slice(source.indexOf("function log(msg)"), source.indexOf("function resolveSystemTool"));
  assert(!logFunction.includes("log(`[uncaughtException]"), `${target}: exception handler must not recursively call log()`);
}

console.log("main log resilience smoke: PASS");
