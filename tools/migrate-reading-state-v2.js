#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");
var Auto = require(path.join(__dirname, "..", "resources", "server", "lib", "reading", "auto-advance.js"));

var DEFAULT_ROOT = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"), "socratopia", "project-data");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
function findPointers(directory, output) {
  output = output || [];
  if (!fs.existsSync(directory)) return output;
  fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
    var full = path.join(directory, entry.name);
    if (entry.isDirectory()) findPointers(full, output);
    else if (entry.name === "current-pointer.json" && path.basename(path.dirname(full)) === ".reading-state-v2") output.push(full);
  });
  return output;
}
function target(pointerFile) {
  var stateDir = path.dirname(pointerFile);
  var pointer = readJson(pointerFile);
  var state = readJson(path.join(stateDir, "generations", path.basename(pointer.manifest)));
  return {
    pointerFile: pointerFile,
    scope: {
      accountId: state.scope.accountId,
      sessionEpoch: state.scope.sessionEpoch,
      profileId: state.scope.profileId,
      worldId: state.scope.worldId,
      textbookId: state.scope.textbookId,
      conversationId: state.owner.conversationId
    },
    generation: state.stateGeneration
  };
}

async function main() {
  var apply = process.argv.indexOf("--apply") >= 0;
  var rootArg = process.argv.find(function (arg, index) { return index > 1 && arg !== "--apply"; });
  var projectRoot = path.resolve(rootArg || process.env.SOCRATOPIA_PROJECT_ROOT || DEFAULT_ROOT);
  var targets = findPointers(path.join(projectRoot, "accounts")).sort().map(target);
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", projectRoot: projectRoot, count: targets.length, targets: targets }, null, 2));
    return;
  }
  var accountContext = null;
  var runtime = Auto.createAutoAdvance({
    projectRoot: projectRoot,
    bootId: "repair_" + process.pid,
    getAccountContext: function () { return accountContext; }
  });
  var results = [];
  try {
    for (var index = 0; index < targets.length; index++) {
      var item = targets[index];
      accountContext = { active: true, accountId: item.scope.accountId, sessionEpoch: item.scope.sessionEpoch };
      results.push(await runtime.repairLegacyProjection(item.scope));
    }
  } finally {
    runtime.shutdown();
  }
  console.log(JSON.stringify({ mode: "apply", projectRoot: projectRoot, count: results.length, results: results }, null, 2));
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
