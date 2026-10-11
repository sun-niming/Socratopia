"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const bundles = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
];

for (const name of bundles) {
  const source = fs.readFileSync(path.join(__dirname, name), "utf8");
  assert(
    source.includes("synthesisChain:Promise.resolve()"),
    `${name}: each voice session needs a synthesis backpressure chain`
  );
  assert(
    source.includes("a.synthesisChain.then(()=>(0,el.synthesizeStream)"),
    `${name}: sentence synthesis must wait for the prior stream producer to finish`
  );
  assert(
    source.includes("await e.stream.done"),
    `${name}: the next synthesis may start after producer completion, without waiting for playback end`
  );
  assert(
    !source.includes("d=i.map(e=>(0,el.synthesizeStream)"),
    `${name}: unbounded eager HTTP/session fan-out must be removed`
  );
}

console.log("voice stream backpressure smoke: PASS");
