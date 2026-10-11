"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const serverRoot = path.resolve(__dirname, "..");
const voiceBundlePath = path.join(serverRoot, ".next", "static", "chunks", "4137-131d0676e3b5bef7.js");
const pageBundles = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
].map(name => path.join(serverRoot, ".next", "static", "chunks", "app", name));

function read(filePath) {
  assert(fs.existsSync(filePath), `missing required file: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

function expect(text, needle, label) {
  assert(text.includes(needle), `missing ${label}: ${needle}`);
}

const voiceBundle = read(voiceBundlePath);

expect(voiceBundle, "/infer_classic_stream", "frontend stream endpoint");
expect(voiceBundle, "getReader()", "frontend response stream reader");
expect(voiceBundle, "synthesizeStream", "frontend stream synthesis helper");
expect(voiceBundle, "classic-stream-ndjson-v1", "frontend protocol marker");
expect(voiceBundle, "SocratopiaClassicVoiceConfig", "shared classic voice configuration");
expect(voiceBundle, "batch_size:1", "one-fragment classic stream batch configuration");
expect(voiceBundle, 'if(!y||T||!Number.isInteger(n.seq)||n.seq!==_)', "multi-frame sequence validation");
expect(voiceBundle, "/infer_classic_stream/cancel", "frontend explicit cancellation endpoint");
expect(voiceBundle, "request_id:SocratopiaTtsRequestId", "frontend stream request id");
expect(voiceBundle, "let SocratopiaTtsVoiceKey=t,r;", "frontend captures requested voice key before parsing frames");
expect(voiceBundle, "voiceKey:SocratopiaTtsVoiceKey", "frontend stream frames preserve requested voice key");

for (const pageBundlePath of pageBundles) {
  const pageBundle = read(pageBundlePath);
  expect(pageBundle, "synthesizeStream", `page stream consumption in ${path.basename(pageBundlePath)}`);
}

console.log("tts classic stream contract smoke: PASS");
