"use strict";

var fs = require("fs");
var path = require("path");
var root = path.resolve(__dirname, "..");
var names = [
  "page-3a1fef7566e26c43.js",
  "page-87daa6ca210ab9dc.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js",
];
var files = [];
names.forEach(function (name) {
  files.push(path.join(root, "resources", "server", ".next", "static", "chunks", "app", name));
  files.push(path.join(root, "win-unpacked", "resources", "server", ".next", "static", "chunks", "app", name));
});

files.forEach(function (file) {
  if (!fs.existsSync(file)) return;
  var source = fs.readFileSync(file, "utf8");
  // Persistence failed before the server saw the turn, so the same envelope is
  // still the correct idempotency key. `_advanceNotAccepted` is not in scope yet.
  source = source.replace(
    'retryEnvelope:_advanceNotAccepted?null:n.turnEnvelope,retryAssistantMessageId:s.id,notAccepted:!0',
    'retryEnvelope:n.turnEnvelope,retryAssistantMessageId:s.id,notAccepted:!0'
  );
  // STALE_TURN / TURN_CONFLICT is explicitly unaccepted. Do not expose the old
  // retry envelope or assistant id; the next click must create a fresh turn id
  // and use the monotonic snapshot merged from the error frame.
  source = source.replace(
    'retryEnvelope:n.turnEnvelope,retryAssistantMessageId:s.id,notAccepted:_advanceNotAccepted',
    'retryEnvelope:_advanceNotAccepted?null:n.turnEnvelope,retryAssistantMessageId:_advanceNotAccepted?null:s.id,notAccepted:_advanceNotAccepted'
  );
  fs.writeFileSync(file, source, "utf8");
});
console.log("hardened frontend stale retry envelopes");
