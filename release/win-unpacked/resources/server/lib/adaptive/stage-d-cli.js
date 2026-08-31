"use strict";

var fs = require("fs");
var path = require("path");
var replay = require("./stage-d-replay.js");
var migration = require("./stage-d-migration.js");

function usage() {
  throw new Error("usage: node stage-d-cli.js <replay|migration> <input.json> <output.json>");
}
function explicitFile(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(name + " is required");
  var resolved = path.resolve(value);
  if (path.extname(resolved).toLowerCase() !== ".json") throw new Error(name + " must be a .json file");
  return resolved;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value, input) {
  if (file === input) throw new Error("output must differ from input");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

var action = process.argv[2];
var inputFile = explicitFile(process.argv[3], "input");
var outputFile = explicitFile(process.argv[4], "output");
if (!fs.existsSync(inputFile)) throw new Error("input file does not exist");
var input = readJson(inputFile);
var result;
if (action === "replay") result = replay.replaySnapshot(input, { redactionSalt: process.env.STAGE_D_REDACTION_SALT || "stage-d-cli-redaction" });
else if (action === "migration") result = migration.planMigration(input, { targetSchemaVersion: Number(process.env.STAGE_D_TARGET_SCHEMA || 1), redactionSalt: process.env.STAGE_D_REDACTION_SALT || "stage-d-cli-redaction" });
else usage();
writeJson(outputFile, result, inputFile);
console.log(JSON.stringify({ action: action, output: outputFile, writesToProduction: false }, null, 2));
