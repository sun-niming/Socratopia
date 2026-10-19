// chat-figure-catalogue-smoke-test.js — wiring test for the prompt block that
// tells the tutor which textbook figures it may echo back into its reply.
//
// The route is compiled text, so the block is asserted two ways: the call must
// exist inside the prompt assembly (after the reading snapshot, before the
// energy tail) AND the lifted snippet must actually append to the prompt when
// run against a fake serializer.  Run: node <this file>
"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var ROUTE = path.join(__dirname, "route.js");
var routeSrc = fs.readFileSync(ROUTE, "utf8");

var results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name: name, ok: true });
    console.log("  PASS  " + name);
  } catch (error) {
    results.push({ name: name, ok: false });
    console.log("  FAIL  " + name);
    console.log("        " + (error && error.stack ? error.stack.split("\n").slice(0, 5).join("\n        ") : error));
  }
}

console.log("chat/route.js figure catalogue");

var START = "if(global.__ASSETS_SERIALIZE__&&O)";
var END = "_energyTail&&(b+=_energyTail)";

function snippet() {
  var start = routeSrc.indexOf(START);
  assert.ok(start >= 0, "the catalogue block must be present");
  var end = routeSrc.indexOf(END, start);
  assert.ok(end > start, "the catalogue block must close before the energy tail");
  return "{" + routeSrc.slice(start, end);
}

test("the block sits in the prompt assembly, after the reading snapshot", function () {
  var start = routeSrc.indexOf(START);
  var snapshotAt = routeSrc.indexOf("_readingSnapshotPreamble(_advanceTurn,X", start - 4000);
  var bodyAt = routeSrc.indexOf("b=H&&C?await (0,n._)", start - 20000);
  assert.ok(snapshotAt > 0 && snapshotAt < start, "snapshot is appended before the catalogue");
  assert.ok(bodyAt > 0 && bodyAt < start, "the base prompt is built before the catalogue");
  assert.strictEqual(routeSrc.indexOf(END, start) > start, true, "the energy tail still follows");
});

test("an advance also warms the page rasters just past the window", function () {
  // The tutor's next `book://` order lands on the pages after the window, so the
  // route schedules them in the background instead of paying the render later.
  assert.ok(routeSrc.indexOf("__ASSETS_PREFETCH__") > 0, "no prefetch hook in the route");
  assert.ok(routeSrc.indexOf("scheduleInBackground({profileId:x,worldId:C,textbookId:ac") > 0,
    "the schedule must carry the scope and the current textbook");
  assert.ok(routeSrc.indexOf("_advanceComplete.readingRange") > 0, "the window end must drive the page list");
  var call = routeSrc.indexOf("scheduleInBackground");
  var guard = routeSrc.indexOf("_advanceComplete.shouldPrefetch");
  assert.ok(guard > 0 && guard < call, "prefetch must sit behind the shouldPrefetch site");
});

test("the block passes the conversation and scope through", function () {
  var body = snippet();
  ["conversationId:O", "profileId:x", "worldId:C", "lang:X", "messages:c", "accountId:_ocrFence&&_ocrFence.accountId"].forEach(function (arg) {
    assert.ok(body.indexOf(arg) > 0, "missing argument " + arg);
  });
  assert.ok(body.indexOf("figureCatalogue(") > 0);
  assert.ok(body.indexOf('b+="\\n\\n---\\n\\n"+_figs') > 0, "must append behind a section separator");
});

test("running the block appends the catalogue to the prompt", function () {
  var calls = [];
  var fakeGlobal = {
    __ASSETS_SERIALIZE__: {
      figureCatalogue: function (input) {
        calls.push(input);
        return "## 可用插图\n- 第 174 页：![图 p.174](asset://ast_e15161937a1a4cb0)";
      },
    },
  };
  var messages = [{ role: "user", content: "![图片](asset://ast_3b093bff81d3454e)" }];
  var run = new Function("b", "O", "x", "C", "X", "c", "_ocrFence", "ac", "global", snippet() + "; return b;");
  var out = run("BASE", "c1", "p1", "w1", "chinese", messages, { accountId: "local" }, "KUbm", fakeGlobal);
  assert.ok(out.indexOf("BASE\n\n---\n\n## 可用插图") === 0, out.slice(0, 60));
  assert.ok(out.indexOf("asset://ast_e15161937a1a4cb0") > 0);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].textbookId, "KUbm", "the ordering guide needs the current textbook id");
  assert.deepStrictEqual(calls[0].conversationId, "c1");
  assert.deepStrictEqual(calls[0].profileId, "p1");
  assert.deepStrictEqual(calls[0].worldId, "w1");
  assert.deepStrictEqual(calls[0].lang, "chinese");
  assert.deepStrictEqual(calls[0].accountId, "local");
  assert.strictEqual(calls[0].messages, messages, "the transcript travels with the call");
});

test("an empty catalogue leaves the prompt byte-identical", function () {
  var fakeGlobal = { __ASSETS_SERIALIZE__: { figureCatalogue: function () { return ""; } } };
  var run = new Function("b", "O", "x", "C", "X", "c", "_ocrFence", "global", snippet() + "; return b;");
  assert.strictEqual(run("BASE", "c1", "p1", "w1", "chinese", null, null, fakeGlobal), "BASE");
});

test("no serializer global, a missing conversation, and a throwing serializer all degrade", function () {
  var run = new Function("b", "O", "x", "C", "X", "c", "_ocrFence", "global", snippet() + "; return b;");
  assert.strictEqual(run("BASE", "c1", "p1", "w1", "chinese", null, null, {}), "BASE", "no global");
  var empty = { __ASSETS_SERIALIZE__: { figureCatalogue: function () { throw new Error("boom"); } } };
  var warn = console.warn;
  var warned = [];
  console.warn = function () { warned.push(Array.prototype.join.call(arguments, " ")); };
  try {
    assert.strictEqual(run("BASE", "c1", "p1", "w1", "chinese", null, null, empty), "BASE", "thrower");
  } finally {
    console.warn = warn;
  }
  assert.strictEqual(warned.length, 1);
  assert.ok(warned[0].indexOf("figure catalogue failed") > 0, warned[0]);
});

test("the serializer really exposes figureCatalogue", function () {
  var serialize = require(path.join(__dirname, "..", "..", "..", "..", "..", "lib", "assets", "serialize.js"));
  assert.strictEqual(typeof serialize.figureCatalogue, "function");
});

console.log("");
var passed = results.filter(function (r) { return r.ok; }).length;
var failed = results.length - passed;
console.log("chat-figure-catalogue: " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
