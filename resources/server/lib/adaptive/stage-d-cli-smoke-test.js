"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var child = require("child_process");

var root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-d-cli-"));
var input = path.join(root, "snapshot.json");
var replayOut = path.join(root, "replay.json");
var migrationOut = path.join(root, "migration.json");
fs.writeFileSync(input, JSON.stringify({ evaluationTime: "2026-08-26T00:00:00.000Z", transactions: [], evidenceEvents: [] }), "utf8");
try {
  child.execFileSync(process.execPath, [path.join(__dirname, "stage-d-cli.js"), "replay", input, replayOut], { encoding: "utf8" });
  child.execFileSync(process.execPath, [path.join(__dirname, "stage-d-cli.js"), "migration", input, migrationOut], { encoding: "utf8" });
  var replayResult = JSON.parse(fs.readFileSync(replayOut, "utf8"));
  var migrationResult = JSON.parse(fs.readFileSync(migrationOut, "utf8"));
  assert.strictEqual(replayResult.redaction.rawIdentifiersEmitted, false);
  assert.strictEqual(migrationResult.productionWrite, false);
  assert.strictEqual(migrationResult.writesPerformed, 0);
  console.log("stage-d cli smoke: 4/4 passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
