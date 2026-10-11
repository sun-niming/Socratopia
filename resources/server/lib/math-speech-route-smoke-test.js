"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var routePath = path.join(__dirname, "..", ".next", "server", "app", "api", "math-speech", "route.js");
var route = fs.readFileSync(routePath, "utf8");

assert(route.includes("segments must be an array"), "math-speech route must validate segments");
assert(route.includes("prepareMathSpeech"), "math-speech route must call the core");
assert(route.includes("at most 32 items"), "math-speech route must bound batch size");
assert(route.includes("private, no-store"), "math-speech route must prevent caching sensitive context");

console.log("math speech route smoke: PASS");
