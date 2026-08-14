"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var serverRoot = path.resolve(__dirname, "..", "..");
var bundleRoot = path.join(serverRoot, ".next", "static", "chunks", "app");
[
  "page-practice-ui-20260626-postclass-notes.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260622.js",
  "page-3a1fef7566e26c43.js",
].forEach(function (name) {
  var content = fs.readFileSync(path.join(bundleRoot, name), "utf8");
  assert(content.includes("__SOCRATOPIA_CLOSE_READING_MENU_LOADER__"), name + " loader");
  assert(content.includes("/close-reading-skill-menu.js?v=20260806-2"), name + " versioned asset path");
});

var menu = fs.readFileSync(path.join(serverRoot, "public", "close-reading-skill-menu.js"), "utf8");
[
  "/Close_Reading",
  "PDF 精读",
  "chat-input-textarea",
  'setAttribute("role", "listbox")',
  "ArrowDown",
  "setSelectionRange",
  "MutationObserver",
  "isUsableInput",
  "removeUi",
  "getClientRects",
  "syncUi",
].forEach(function (token) { assert(menu.includes(token), token); });

console.log("close-reading UI static smoke: ok");
