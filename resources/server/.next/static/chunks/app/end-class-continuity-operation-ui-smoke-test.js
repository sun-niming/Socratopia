"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var source = fs.readFileSync(path.join(__dirname, "page-87daa6ca210ab9dc.js"), "utf8");

assert(source.indexOf('continuityOperationId:o?"endclass:v1:"+r:void 0') >= 0, "end-class request must derive a stable conversation-bound operation id");
assert(source.indexOf("companionInstanceId:ti?.[[\"npc_a\",\"npc_b\",\"npc_c\",\"npc_d\"].indexOf(a)]?.companionInstanceId") >= 0, "end-class request must assert current companion instance");
assert(source.indexOf("candidateId:ti?.[[\"npc_a\",\"npc_b\",\"npc_c\",\"npc_d\"].indexOf(a)]?.candidateId") >= 0, "end-class request must carry candidate assertion only alongside instance identity");
console.log("PASS active end-class UI supplies stable operation and companion identity assertions");
