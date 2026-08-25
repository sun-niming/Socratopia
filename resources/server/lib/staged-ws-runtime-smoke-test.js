"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var workspaceRoot = path.resolve(__dirname, "..", "..", "..");
var releaseRoot = path.resolve(process.argv[2] || path.join(workspaceRoot, "release", "win-unpacked"));
var serverRoot = path.join(releaseRoot, "resources", "server");
var nodeModules = path.join(serverRoot, ".next", "node_modules");
assert(fs.statSync(releaseRoot).isDirectory(), "staged release directory is required");
assert(!fs.existsSync(path.join(serverRoot, "node_modules")), "clean staging must not depend on outer development node_modules");

var probe = childProcess.spawnSync(process.execPath, ["-e", [
  "var ws = require('ws');",
  "if (typeof ws !== 'function' && typeof ws.WebSocket !== 'function') throw new Error('ws export unavailable');",
  "var bridge = require('./lib/knowledge/daimon-bridge.js');",
  "if (!bridge || typeof bridge !== 'object') throw new Error('Daimon bridge unavailable');",
  "var atomic = require('write-file-atomic');",
  "if (typeof atomic !== 'function' && typeof atomic.sync !== 'function') throw new Error('write-file-atomic export unavailable');",
  "var advance = require('./lib/reading/auto-advance.js');",
  "if (!advance || typeof advance.createAutoAdvance !== 'function') throw new Error('Auto Advance runtime unavailable');",
  "console.log('staged ws runtime probe: PASS');",
].join("\n")], {
  cwd: serverRoot,
  env: Object.assign({}, process.env, { NODE_PATH: nodeModules }),
  encoding: "utf8",
});
assert.strictEqual(probe.status, 0, probe.stderr || probe.stdout);
assert(probe.stdout.includes("staged ws runtime probe: PASS"));
console.log("staged ws runtime smoke: PASS");
