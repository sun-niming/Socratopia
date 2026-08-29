"use strict";

var fs = require("fs");
var path = require("path");
var child = require("child_process");

var root = path.resolve(__dirname, "..");
var rawArgs = process.argv.slice(2);
var jsonIndex = rawArgs.indexOf("--json");
var selected = rawArgs.filter(function (value, index) { return value !== "--json" && !(jsonIndex >= 0 && index === jsonIndex + 1); });
function walk(directory) {
  var out = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
    var file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") return;
      out = out.concat(walk(file));
    } else if (entry.isFile() && /smoke-test\.(?:js|mjs)$/.test(entry.name)) out.push(file);
  });
  return out;
}

var tests = selected.length ? selected.map(function (file) { return path.resolve(root, file); }) : walk(path.join(root, "resources", "server"));
tests.sort();
var results = [];
tests.forEach(function (file) {
  var rel = path.relative(root, file).split(path.sep).join("/");
  var startedAt = new Date().toISOString();
  var result = child.spawnSync(process.execPath, [file], { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  var rawStatus = result.error && result.error.code === "ETIMEDOUT" ? 124 : result.status;
  var skipped = rawStatus === 2 && /pdf-(?:cmap-real|render-real)-smoke-test\.(?:js|mjs)$/.test(file);
  var status = skipped ? 0 : rawStatus;
  results.push({ file: rel, startedAt: startedAt, exitCode: status, rawExitCode: rawStatus, skipped: skipped, timedOut: status === 124, stdout: result.stdout || "", stderr: result.stderr || "" });
  console.log((skipped ? "SKIP" : status === 0 ? "PASS" : "FAIL") + "\t" + rawStatus + "\t" + rel);
});
var summary = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  passed: results.filter(function (item) { return item.exitCode === 0 && !item.skipped; }).length,
  failed: results.filter(function (item) { return item.exitCode !== 0; }).length,
  skipped: results.filter(function (item) { return item.skipped; }).length,
  results: results,
};
if (jsonIndex >= 0) {
  var output = rawArgs[jsonIndex + 1];
  if (output) fs.writeFileSync(path.resolve(root, output), JSON.stringify(summary, null, 2) + "\n", "utf8");
}
process.exitCode = summary.failed ? 1 : 0;
