"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var active = path.join(__dirname, "page-87daa6ca210ab9dc.js");
var manifest = path.join(__dirname, "..", "..", "..", "server", "app", "page_client-reference-manifest.js");
var source = fs.readFileSync(active, "utf8");
var manifestSource = fs.readFileSync(manifest, "utf8");

assert(manifestSource.indexOf("page-87daa6ca210ab9dc.js") >= 0, "page manifest must reference the active UI chunk");
assert(source.indexOf("compSlotId") >= 0 && source.indexOf("compInstanceId") >= 0, "tutor state must retain slot and instance identity");
assert(source.indexOf("companionInstanceId:compInstanceId") >= 0, "chooser must send companion instance identity");
assert(source.indexOf("slotId,companionInstanceId:compInstanceId") >= 0, "chooser must send world slot identity");
assert(!/comp\.id(?![A-Za-z])/g.test(source), "active tutor chooser must not access nonexistent comp.id");
assert(source.indexOf("伙伴绑定失败") >= 0 && source.indexOf("if(!r.ok||!d||d.error)") >= 0, "failed companion binding must be visible and non-optimistic");
console.log("PASS active practice UI uses world slot + companion instance identity and visible binding errors");
