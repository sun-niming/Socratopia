// conversations-intents-wiring-smoke-test.js — the conversation write path must
// resolve figure orders *before* persisting, and must not fail the save when it
// cannot.  Runs the compiled route source, no app, no network.
// Run: node <this file>
"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name: name, ok: true });
    console.log("  PASS  " + name);
  } catch (error) {
    results.push({ name: name, ok: false });
    console.log("  FAIL  " + name);
    console.log("        " + (error && error.stack ? error.stack.split("\n").slice(0, 4).join("\n        ") : error));
  }
}

var ROUTE = fs.readFileSync(path.join(__dirname, "route.js"), "utf8");

test("the POST handler consults the intent materializer", function () {
  assert.ok(ROUTE.indexOf("__ASSETS_INTENTS__") > 0, "materializer global missing");
  assert.ok(ROUTE.indexOf("materializeConversation") > 0, "materialize call missing");
});

test("materialization runs before the conversation is written", function () {
  var call = ROUTE.indexOf("materializeConversation");
  var write = ROUTE.indexOf("(0,w.vm)(b,c,d)");
  assert.ok(call > 0 && write > 0, "both the call and the write must exist");
  assert.ok(call < write, "orders must resolve before the file is written");
});

test("the rewrite is scoped to the request's profile and world", function () {
  var at = ROUTE.indexOf("materializeConversation");
  var around = ROUTE.slice(at, at + 200);
  assert.ok(around.indexOf("{profileId:b,worldId:c}") > 0, "scope must come from the request body: " + around);
});

test("a failing order never breaks the save", function () {
  var at = ROUTE.indexOf("materializeConversation");
  var around = ROUTE.slice(Math.max(0, at - 200), at + 260);
  assert.ok(/try\{/.test(around), "call must be wrapped in try: " + around);
  assert.ok(/catch\(_intentError\)/.test(around), "failure must be caught: " + around);
  assert.ok(around.indexOf("[assets] figure-order materialization failed") > 0, "failure must be logged");
});

test("the chat route passes the current textbook into the ordering guide", function () {
  var chat = fs.readFileSync(path.join(__dirname, "..", "chat", "route.js"), "utf8");
  assert.ok(chat.indexOf("figureCatalogue({conversationId:O") > 0, "catalogue call missing");
  assert.ok(chat.indexOf('textbookId:typeof ac!=="undefined"?ac:null') > 0,
    "the short book:// form needs the current textbook id");
});

test("deleting a conversation trashes the file instead of unlinking it", function () {
  // The sidebar's delete is a small, confirm-free button: the messages must survive
  // the click in chats/.trash/, with the old unlink kept as a hard fallback.
  assert.ok(ROUTE.indexOf("__CHAT_TRASH_CALL__") > 0, "trash call missing");
  var trashCall = ROUTE.indexOf("__CHAT_TRASH_CALL__");
  var unlink = ROUTE.indexOf("(0,w.J$)(c,d,e)");
  assert.ok(unlink > 0, "the fallback unlink must stay");
  assert.ok(Math.abs(unlink - trashCall) < 500, "move and fallback must be one expression: " + ROUTE.slice(unlink - 460, unlink + 30));
  var around = ROUTE.slice(Math.max(0, trashCall - 460), trashCall);
  assert.ok(around.indexOf("_r.trashed") > 0, "the move result must gate the unlink: " + around);
  assert.ok(/catch\(_e\)/.test(around), "a trash failure must be caught: " + around);
  assert.ok(around.indexOf("[chat-trash] failed") > 0, "a trash failure must be logged");
});

test("the trash can be inspected without disturbing the normal list shape", function () {
  assert.ok(ROUTE.indexOf("__TRASH_LIST__") > 0, "trash listing missing");
  var at = ROUTE.indexOf("__TRASH_LIST__");
  var around = ROUTE.slice(at, at + 420);
  assert.ok(around.indexOf('"trash")==="1"') > 0, "must be opt-in via ?trash=1: " + around);
  assert.ok(around.indexOf("listTrash({profileId:") > 0, "must list through the module");
  assert.ok(around.indexOf("conversations:e") > 0 || ROUTE.indexOf("{conversations:e}") > 0,
    "the plain GET must still answer with the conversations shape");
});

console.log("");
var passed = results.filter(function (r) { return r.ok; }).length;
var failed = results.length - passed;
console.log("conversations-intents-wiring: " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
