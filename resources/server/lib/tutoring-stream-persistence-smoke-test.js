"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var serverRoot = path.resolve(__dirname, "..");
var route = fs.readFileSync(path.join(serverRoot, ".next", "server", "app", "api", "practice", "route.js"), "utf8");
var pages = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
];

assert(route.includes('type: "tutor_complete"'), "upstream tutor stream must use an internal completion event");
assert(route.includes('type: "tutor_error"'), "upstream tutor stream must use an internal error event");
assert(route.includes("upstreamDone"), "wrapper must defer the public terminal event until upstream completion");
assert(route.includes('persisted: true'), "public done reports a successful persisted session");
assert(route.includes('persisted: false'), "public terminal event reports a persistence failure");

pages.forEach(function (name) {
  var source = fs.readFileSync(path.join(serverRoot, ".next", "static", "chunks", "app", name), "utf8");
  assert(source.includes("tutorError"), name + " must surface tutor persistence errors");
  assert(source.includes("讲题回复未能保存"), name + " must show a visible persistence failure");
});

console.log("tutoring stream persistence smoke: PASS");
