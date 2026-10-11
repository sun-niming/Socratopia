#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");
var acorn = require("acorn");

var root = path.resolve(__dirname, "..");
var target = path.join(root, "resources", "server", ".next", "server", "app", "api", "chat", "route.js");
var legacy = "if((commitAdvance||prefetchAdvance)&&!b._advanceInFlight)";
var guarded = "if(!_advanceTurn&&(commitAdvance||prefetchAdvance)&&!b._advanceInFlight)";
var source = fs.readFileSync(target, "utf8");

if (source.includes(guarded)) {
  if (source.includes(legacy)) throw new Error("guarded and unguarded legacy chat advance blocks coexist");
  console.log("legacy chat auto-advance guard already installed");
  process.exit(0);
}

var occurrences = source.split(legacy).length - 1;
if (occurrences !== 1) throw new Error("expected one legacy chat auto-advance block, found " + occurrences);
var next = source.replace(legacy, guarded);
acorn.parse(next, { ecmaVersion: 2022 });
var temp = target + ".tmp-legacy-advance-" + process.pid;
fs.writeFileSync(temp, next, "utf8");
fs.renameSync(temp, target);
console.log("installed v2 guard on legacy chat auto-advance block");
