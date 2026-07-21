"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var P = require("./kb-publisher.js");

var root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-publisher-"));
var textbook = path.join(root, "TB");
fs.mkdirSync(textbook, { recursive: true });

var dirs = P.prepare(textbook);
fs.writeFileSync(path.join(dirs.stageDir, "build_status.json"), JSON.stringify({ state: "partial" }));
assert.strictEqual(P.publishFailureIfNoFinal(textbook), true, "new partial KB is exposed for diagnostics");
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dirs.finalDir, "build_status.json"))).state, "partial");

dirs = P.prepare(textbook);
fs.writeFileSync(path.join(dirs.stageDir, "index.json"), JSON.stringify({ version: "new" }));
P.publish(textbook);
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dirs.finalDir, "index.json"))).version, "new", "healthy staged KB replaces final");
assert.strictEqual(fs.existsSync(dirs.previousDir), false, "temporary previous directory is removed");

dirs = P.prepare(textbook);
fs.writeFileSync(path.join(dirs.stageDir, "build_status.json"), JSON.stringify({ state: "partial" }));
assert.strictEqual(P.publishFailureIfNoFinal(textbook), false, "failed rebuild does not replace existing KB");
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dirs.finalDir, "index.json"))).version, "new", "existing KB survives failed rebuild");

fs.rmSync(root, { recursive: true, force: true });
console.log("kb publisher smoke: PASS");
