"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var route = fs.readFileSync(path.join(__dirname, "..", ".next", "server", "app", "api", "chat", "route.js"), "utf8");
var callStart = route.indexOf("let d2=await (0,z.WS)(c2,a2,b2,30");
assert.ok(callStart >= 0, "chat auto-fill PDF call must exist");
var call = route.slice(callStart, callStart + 900);
assert.ok(call.includes("profileId:x,worldId:C,textbookId:ac"), "chat auto-fill must pass OCR ownership scope");
assert.ok(call.includes("contiguousUsableEndPage"), "chat auto-fill must consume the contiguous usable range");
assert.ok(call.includes("failedPages") && call.includes("sourcesByPage"), "chat auto-fill must propagate page diagnostics");
assert.ok(call.includes("endPage:Math.min"), "chat auto-fill endPage must be clamped before xC can write or commit it");
console.log("chat auto OCR bundle smoke: PASS");
