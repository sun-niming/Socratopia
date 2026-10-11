// assets-index-smoke-test.js — self-contained tests for lib/assets/index.js.
// Run: node <this file>
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var store = require("./store.js");
var assetsIndex = require("./index.js");

var results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name: name, ok: true });
    console.log("  PASS  " + name);
  } catch (error) {
    results.push({ name: name, ok: false });
    console.log("  FAIL  " + name);
    console.log("        " + (error && error.stack ? error.stack.split("\n").slice(0, 5).join("\n        ") : error));
  }
}

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), "assets-index-"));

function scope(profileId, worldId) {
  return { projectRoot: TMP, accountId: "acct", profileId: profileId || "p1", worldId: worldId || "w1" };
}

function dir(s) {
  return store.resolveScope(s).assetsDir;
}

function writeLines(s, records) {
  var d = dir(s);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "index.jsonl"), records.map(function (r) { return JSON.stringify(r) + "\n"; }).join(""), "utf8");
}

function id(n) {
  return "ast_" + String(n).padStart(16, "0").slice(-16);
}

// 24-byte header-only PNG: magic + IHDR length/type + width + height.  sharp
// cannot decode it, which exercises the "thumbnail unavailable" fallback too.
function tinyPng(width, height) {
  var buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function suite() {
  console.log("assets/index.js");

  await test("get/list return live records and deleted tombstones win", async function () {
    var s = scope("p1", "w1");
    var d = dir(s);
    fs.mkdirSync(d, { recursive: true });
    var created = await store.createAsset({ kind: "screenshot", pngBuffer: tinyPng(1, 1), scope: s });
    assetsIndex.invalidate();
    assert.ok(assetsIndex.get(created.assetId, s));
    assert.strictEqual(assetsIndex.list({}, s).length, 1);
    store.deleteAsset(created.assetId, s);
    assert.strictEqual(assetsIndex.get(created.assetId, s), null, "auto-invalidated by mtime/size signature");
    assert.strictEqual(assetsIndex.list({}, s).length, 0);
    assert.strictEqual(assetsIndex.stats(s).total, 1, "one distinct asset id");
    assert.strictEqual(assetsIndex.stats(s).live, 0);
    assert.strictEqual(store.loadAll(s).length, 2, "append-only: tombstone adds a row next to the original");
    assert.strictEqual(assetsIndex.get(id(999), s), null);
    assert.throws(function () { assetsIndex.get("bogus", s); }, /Invalid asset id/);
  });

  await test("filters: kind / conversationId / noteId / tags / limit", function () {
    var s = scope("p2", "w2");
    writeLines(s, [
      { id: id(1), kind: "screenshot", createdAt: 5, conversationId: "c1", tags: ["chapter-1"] },
      { id: id(2), kind: "svg", createdAt: 4, conversationId: "c1", noteId: "n1", tags: ["chapter-1", "flow"] },
      { id: id(3), kind: "svg", createdAt: 3, conversationId: "c2", tags: ["flow"] },
      { id: id(4), kind: "textbook-figure", createdAt: 2, conversationId: "c1", ref: { bookId: "b", page: 1, rect: [0, 0, 1, 1] } },
    ]);
    assetsIndex.invalidate();
    assert.strictEqual(assetsIndex.list({}, s).length, 4);
    assert.strictEqual(assetsIndex.list({ kind: "svg" }, s).length, 2);
    assert.strictEqual(assetsIndex.list({ conversationId: "c1" }, s).length, 3);
    assert.strictEqual(assetsIndex.list({ noteId: "n1" }, s).length, 1);
    assert.strictEqual(assetsIndex.list({ tags: ["chapter-1"] }, s).length, 2);
    assert.strictEqual(assetsIndex.list({ tags: ["chapter-1", "flow"] }, s).length, 1);
    assert.strictEqual(assetsIndex.list({ limit: 2 }, s).length, 2);
    assert.deepStrictEqual(assetsIndex.list({}, s).map(function (r) { return r.createdAt; }), [5, 4, 3, 2], "newest first");
  });

  await test("corrupt and malformed lines are skipped, not fatal", function () {
    var s = scope("p3", "w3");
    var d = dir(s);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "index.jsonl"), [
      JSON.stringify({ id: id(9), kind: "svg", createdAt: 1 }) + "\n",
      "{not json\n",
      JSON.stringify({ id: "bogus", kind: "svg" }) + "\n",
      "\n",
      "[]\n",
    ].join(""), "utf8");
    assetsIndex.invalidate();
    var warnings = 0;
    var warn = console.warn;
    console.warn = function () { warnings += 1; };
    try {
      assert.strictEqual(assetsIndex.list({}, s).length, 1);
    } finally {
      console.warn = warn;
    }
    assert.ok(warnings >= 3, "one warning per bad line, got " + warnings);
  });

  await test("1000 records load well under 200ms", function () {
    var s = scope("p4", "w4");
    var lines = [];
    for (var i = 1; i <= 1000; i += 1) {
      lines.push(JSON.stringify({ id: id(i), kind: i % 3 === 0 ? "svg" : "screenshot", createdAt: i, conversationId: "c" + (i % 10), caption: "caption " + i }));
    }
    fs.mkdirSync(dir(s), { recursive: true });
    fs.writeFileSync(path.join(dir(s), "index.jsonl"), lines.join("\n") + "\n", "utf8");
    assetsIndex.invalidate();
    var started = Date.now();
    var all = assetsIndex.list({}, s);
    var elapsed = Date.now() - started;
    assert.strictEqual(all.length, 1000);
    assert.ok(elapsed < 200, "took " + elapsed + "ms");
    console.log("        (cold load of 1000 records: " + elapsed + "ms)");
    var startedFiltered = Date.now();
    assert.strictEqual(assetsIndex.list({ kind: "svg" }, s).length, 333);
    console.log("        (filtered read on the cached projection: " + (Date.now() - startedFiltered) + "ms)");
  });

  await test("second read is served from cache; append auto-invalidates by size", function () {
    var s = scope("p5", "w5");
    writeLines(s, [{ id: id(1), kind: "svg", createdAt: 1 }]);
    assetsIndex.invalidate();
    assert.strictEqual(assetsIndex.list({}, s).length, 1);
    var first = assetsIndex.stats(s).live;
    assert.strictEqual(assetsIndex.stats(s).live, first, "cache hit keeps the same count");
    store.appendRecord({ id: id(2), kind: "svg", createdAt: 2 }, s);
    assert.strictEqual(assetsIndex.list({}, s).length, 2, "size change invalidates the signature");
    assert.strictEqual(assetsIndex.append({ id: id(3), kind: "svg", createdAt: 3 }, s).id, id(3));
    assert.strictEqual(assetsIndex.list({}, s).length, 3);
    assert.strictEqual(assetsIndex.invalidate(s), true);
    assert.strictEqual(assetsIndex.cacheSize() >= 0, true);
    assetsIndex.invalidate();
    assert.strictEqual(assetsIndex.cacheSize(), 0);
  });

  await test("search matches caption / ocrText / svgTitle / tags case-insensitively", function () {
    var s = scope("p6", "w6");
    writeLines(s, [
      { id: id(1), kind: "screenshot", createdAt: 3, caption: "TCP Handshake" },
      { id: id(2), kind: "screenshot", createdAt: 2, ocrText: "三次握手" },
      { id: id(3), kind: "svg", createdAt: 1, svgTitle: "Sequence diagram", tags: ["handshake"] },
    ]);
    assetsIndex.invalidate();
    assert.strictEqual(assetsIndex.search("handshake", s).length, 2);
    assert.strictEqual(assetsIndex.search("三次握手", s).length, 1);
    assert.strictEqual(assetsIndex.search("SEQUENCE", s).length, 1);
    assert.strictEqual(assetsIndex.search("", s).length, 3);
    assert.strictEqual(assetsIndex.search("nothing", s).length, 0);
  });

  await test("a missing index file yields an empty projection", function () {
    var s = { projectRoot: TMP, accountId: null, profileId: "ghost", worldId: "gw" };
    assetsIndex.invalidate();
    assert.deepStrictEqual(assetsIndex.list({}, s), []);
    assert.strictEqual(assetsIndex.stats(s).total, 0);
  });
}

suite().then(function () {
  console.log("");
  var passed = results.filter(function (r) { return r.ok; }).length;
  var failed = results.length - passed;
  console.log("assets-index: " + passed + " passed, " + failed + " failed");
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  if (failed) process.exit(1);
}).catch(function (error) {
  console.error("harness failure: " + (error && error.stack));
  process.exit(1);
});
