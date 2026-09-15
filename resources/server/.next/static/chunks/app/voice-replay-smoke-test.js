"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var pageBundles = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
];

pageBundles.forEach(function (file) {
  var bundle = fs.readFileSync(path.join(__dirname, file), "utf8");
  assert.ok(bundle.includes("if(s){if(!eH.current)"), file + ": TTS recorder must initialize as soon as streaming starts, before the typewriter has emitted its first character");
  assert.ok(!bundle.includes("if(s&&l){if(!eH.current)"), file + ": TTS recorder must not wait for non-empty typewriter text");
  assert.ok(bundle.includes('let t=e[e.length-1]?.content||l||""'), file + ": stream completion must prefer the full assistant response over partial typewriter text");
  assert.ok(bundle.includes("await S(B,a,e),U?.(a,Date.now())"), file + ": recorded audio must be committed and mark the message replayable");
});

console.log("voice replay bundle smoke: PASS");
