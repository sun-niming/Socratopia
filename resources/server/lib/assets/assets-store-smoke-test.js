// assets-store-smoke-test.js — self-contained tests for lib/assets/store.js.
// No app, no network, no real API keys.  Run: node <this file>
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var zlib = require("zlib");

var store = require("./store.js");

var results = [];
var skipped = [];

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

// createAsset is async (optional sharp pass), so validation failures arrive as
// promise rejections; every caller must await this.
async function codeOf(fn) {
  try {
    await fn();
    return { code: null };
  } catch (error) {
    return { code: error && error.code, status: error && error.status };
  }
}

// ---- fixtures -------------------------------------------------------------

function crc32(buffer) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buffer) >>> 0;
  var table = [];
  for (var n = 0; n < 256; n += 1) {
    var c = n;
    for (var k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  var crc = 0xffffffff;
  for (var i = 0; i < buffer.length; i += 1) crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  var typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function makePng(width, height) {
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  var raw = Buffer.alloc((width * 3 + 1) * height);
  for (var y = 0; y < height; y += 1) {
    var rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    for (var x = 0; x < width; x += 1) {
      raw[rowStart + 1 + x * 3] = 0x30;
      raw[rowStart + 2 + x * 3] = 0x80;
      raw[rowStart + 3 + x * 3] = 0xc0;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), "assets-store-"));
var PNG = makePng(64, 32);
var SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#0af"/></svg>';
// A shape on a transparent ground: dropping alpha onto black paints the corners.
var SVG_TRANSPARENT = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><circle cx="60" cy="30" r="20" fill="#3355aa"/></svg>';

var sharp = null;
try { sharp = require("sharp"); } catch (_) { skipped.push("sharp unavailable"); }

// Top-left pixel of a stored thumbnail, i.e. exactly the ground the bug showed in.
async function cornerRgb(file) {
  var decoded = await sharp(fs.readFileSync(file)).raw().toBuffer({ resolveWithObject: true });
  return [decoded.data[0], decoded.data[1], decoded.data[2]];
}

function svgThumbMarker(thumbPath) {
  return thumbPath.replace(/\.thumb\.jpg$/, ".thumbw");
}

function scope(profileId, worldId) {
  return { projectRoot: TMP, accountId: "acct", profileId: profileId || "p1", worldId: worldId || "w1" };
}

function assetsDir(s) {
  return store.resolveScope(s).assetsDir;
}

function names(dir) {
  return fs.readdirSync(dir).sort();
}

function indexLines(dir) {
  return fs.readFileSync(path.join(dir, "index.jsonl"), "utf8").split("\n").filter(function (line) { return line.trim(); });
}

// ---- tests ---------------------------------------------------------------

async function suite() {
  console.log("assets/store.js");

  await test("resolveScope is account-scoped and legacy-compatible", function () {
    var scoped = store.resolveScope(scope("p1", "w1"));
    assert.strictEqual(scoped.assetsDir, path.join(TMP, "accounts", "acct", "profiles", "p1", "worlds", "w1", "assets"));
    var legacy = store.resolveScope({ projectRoot: TMP, accountId: null, profileId: "p9", worldId: "w9" });
    assert.strictEqual(legacy.assetsDir, path.join(TMP, "profiles", "p9", "worlds", "w9", "assets"));
  });

  await test("contained() rejects traversal and sibling prefixes", function () {
    assert.strictEqual(store.contained("/a/b", "/a/b/c.png"), true);
    assert.strictEqual(store.contained("/a/b", "/a/b"), true);
    assert.strictEqual(store.contained("/a/b", "/a/b/../c"), false);
    assert.strictEqual(store.contained("/a/b", "/a/bc/d"), false);
  });

  await test("case 1: textbook-figure with a png writes a png + thumb and keeps ref; without one stays record-only", async function () {
    var s = scope("p1", "w1");
    var dir = assetsDir(s);
    var recordOnly = await store.createAsset({
      kind: "textbook-figure",
      ref: { bookId: "book-12", page: 123, rect: [0.1, 0.2, 0.9, 0.45] },
      caption: "图 12-10 双向异步消息通信模式",
      tags: ["图12-10", "时序图"],
      scope: s,
    });
    assert.strictEqual(recordOnly.file, null);
    assert.match(recordOnly.assetId, store.ASSET_ID_RE);
    assert.deepStrictEqual(names(dir), ["index.jsonl"], "a figure without a buffer must not create a binary");
    var record = store.getAssetRecord(recordOnly.assetId, s);
    assert.strictEqual(record.kind, "textbook-figure");
    assert.deepStrictEqual(record.ref, { bookId: "book-12", page: 123, rect: [0.1, 0.2, 0.9, 0.45] });
    assert.deepStrictEqual(record.tags, ["图12-10", "时序图"]);
    assert.strictEqual(record.caption, "图 12-10 双向异步消息通信模式");
    // A legacy record-only figure keeps returning the same 404 code as before.
    var legacyRead = await codeOf(function () { return store.readAssetFile(recordOnly.assetId, null, s); });
    assert.strictEqual(legacyRead.code, "asset_file_missing");
    assert.strictEqual(legacyRead.status, 404);

    // The server-rendered form takes the screenshot path verbatim: the PNG lands
    // on disk with its dimensions in the record, and `ref` keeps the provenance.
    var rendered = await store.createAsset({
      kind: "textbook-figure",
      ref: { textbookId: "book-12", page: 12, rect: [0.1, 0.1, 0.9, 0.5] },
      pngBuffer: PNG,
      caption: "框选插图",
      scope: s,
    });
    assert.ok(rendered.file && fs.existsSync(rendered.file), "a rendered figure writes its png");
    assert.strictEqual(rendered.file, path.join(dir, rendered.assetId + ".png"));
    var renderedRecord = store.getAssetRecord(rendered.assetId, s);
    assert.strictEqual(renderedRecord.kind, "textbook-figure");
    assert.strictEqual(renderedRecord.width, 64);
    assert.strictEqual(renderedRecord.height, 32);
    assert.strictEqual(renderedRecord.bytes, PNG.length);
    // `textbookId` (plan §3) is accepted on input but stored as the canonical bookId.
    assert.deepStrictEqual(renderedRecord.ref, { bookId: "book-12", page: 12, rect: [0.1, 0.1, 0.9, 0.5] });
    assert.strictEqual(store.readAssetFile(rendered.assetId, null, s).contentType, "image/png");
    assert.ok(names(dir).indexOf(rendered.assetId + ".png") >= 0, "the png is in the assets directory");
  });

  await test("case 2: png lands on disk with a complete record", async function () {
    var s = scope("p1", "w1");
    var dir = assetsDir(s);
    var created = await store.createAsset({ kind: "screenshot", pngBuffer: PNG, caption: "题目", scope: s });
    var file = path.join(dir, created.assetId + ".png");
    var stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.strictEqual(stat.size, PNG.length);
    var record = store.getAssetRecord(created.assetId, s);
    assert.strictEqual(record.kind, "screenshot");
    assert.strictEqual(record.width, 64);
    assert.strictEqual(record.height, 32);
    assert.strictEqual(record.bytes, PNG.length);
    assert.strictEqual(record.caption, "题目");
    assert.ok(record.createdAt > 0);
    var read = store.readAssetFile(created.assetId, null, s);
    assert.strictEqual(read.contentType, "image/png");
    assert.ok(fs.readFileSync(read.path).equals(PNG));
  });

  await test("case 3: svg over 512 KB rejected; valid svg stored with parsed size", async function () {
    var s = scope("p1", "w1");
    var big = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><desc>' +
      new Array(513 * 1024).join("x") + "</desc></svg>";
    assert.ok(Buffer.byteLength(big, "utf8") > store.MAX_SVG_BYTES);
    var rejected = await codeOf(function () { return store.createAsset({ kind: "svg", svgSource: big, scope: s }); });
    assert.strictEqual(rejected.code, "asset_svg_too_large");
    assert.strictEqual(rejected.status, 413);

    var created = await store.createAsset({ kind: "svg", svgSource: SVG, svgTitle: "流程示意", scope: s });
    var file = path.join(assetsDir(s), created.assetId + ".svg");
    assert.strictEqual(fs.readFileSync(file, "utf8"), SVG);
    var record = store.getAssetRecord(created.assetId, s);
    assert.strictEqual(record.width, 120);
    assert.strictEqual(record.height, 60);
    assert.strictEqual(store.readAssetFile(created.assetId, null, s).contentType, "image/svg+xml");
  });

  await test("case 3b: oversized png, non-png buffer and unknown kind rejected", async function () {
    var s = scope("p1", "w1");
    var huge = Buffer.concat([PNG, Buffer.alloc(store.MAX_PNG_BYTES)]);
    assert.strictEqual((await codeOf(function () { return store.createAsset({ kind: "screenshot", pngBuffer: huge, scope: s }); })).code, "asset_png_too_large");
    assert.strictEqual((await codeOf(function () { return store.createAsset({ kind: "screenshot", pngBuffer: Buffer.from("nope"), scope: s }); })).code, "asset_png_invalid");
    assert.strictEqual((await codeOf(function () { return store.createAsset({ kind: "nope", pngBuffer: PNG, scope: s }); })).code, "asset_kind_invalid");
    assert.strictEqual((await codeOf(function () { return store.createAsset({ kind: "screenshot", scope: s }); })).code, "asset_png_missing");
  });

  await test("case 4: traversal in scope part and asset id is rejected", async function () {
    assert.strictEqual((await codeOf(function () { return store.resolveScope({ projectRoot: TMP, profileId: "..", worldId: "w" }); })).code, "asset_scope_invalid");
    assert.strictEqual((await codeOf(function () { return store.resolveScope({ projectRoot: TMP, profileId: "p", worldId: "a/b" }); })).code, "asset_scope_invalid");
    assert.strictEqual((await codeOf(function () { return store.resolveAssetFile("ast_../../etc", "png", scope()); })).code, "asset_id_invalid");
    assert.strictEqual((await codeOf(function () { return store.getAssetRecord("nope", scope()); })).code, "asset_id_invalid");
  });

  await test("case 5: symlinked asset file is rejected", async function () {
    var s = scope("p1", "w1");
    var dir = assetsDir(s);
    var id = store.newAssetId();
    var outside = path.join(TMP, "outside-" + id + ".png");
    fs.writeFileSync(outside, PNG);
    store.appendRecord({ id: id, kind: "screenshot", createdAt: Date.now() }, s);
    var link = path.join(dir, id + ".png");
    var linked = true;
    try {
      fs.symlinkSync(outside, link, "file");
    } catch (error) {
      linked = false;
      skipped.push("file-symlink unavailable (" + error.code + ")");
      fs.copyFileSync(outside, link);
    }
    assert.strictEqual(fs.lstatSync(link).isSymbolicLink(), linked);
    var result = await codeOf(function () { return store.readAssetFile(id, null, s); });
    assert.strictEqual(result.code, linked ? "asset_symlink_rejected" : null);
  });

  await test("case 5b: a linked assets directory is rejected when lstat calls it a link", async function () {
    var s = { projectRoot: TMP, accountId: null, profileId: "p2", worldId: "w2" };
    var real = path.join(TMP, "real-assets-p2");
    fs.mkdirSync(real, { recursive: true });
    var fake = path.join(TMP, "profiles", "p2", "worlds", "w2");
    fs.mkdirSync(fake, { recursive: true });
    var link = path.join(fake, "assets");
    var made = "junction";
    try {
      fs.symlinkSync(real, link, "dir");
      made = "symlink";
    } catch (error) {
      skipped.push("dir-symlink unavailable (" + error.code + "), junction used instead");
      fs.symlinkSync(real, link, "junction");
    }
    // Whether a junction counts as a link is build-dependent, so assert the
    // behaviour that the observed lstat implies instead of a fixed answer.
    var isLink = fs.lstatSync(link).isSymbolicLink();
    skipped.push(made + " reported as " + (isLink ? "a link" : "a plain directory"));
    var result = await codeOf(function () { return store.loadAll(s); });
    assert.strictEqual(result.code, isLink ? "asset_symlink_rejected" : null);
  });

  await test("case 5c: symlink rejection branch covered deterministically (no dev-mode symlinks needed)", async function () {
    var s = scope("p7", "w7");
    var created = await store.createAsset({ kind: "screenshot", pngBuffer: PNG, scope: s });
    var target = path.resolve(path.join(assetsDir(s), created.assetId + ".png"));
    var realLstat = fs.lstatSync;
    fs.lstatSync = function (candidate) {
      var stat = realLstat.call(fs, candidate);
      if (path.resolve(String(candidate)) === target) {
        return {
          isSymbolicLink: function () { return true; },
          isDirectory: function () { return false; },
          isFile: function () { return true; },
          size: stat.size,
        };
      }
      return stat;
    };
    try {
      var result = await codeOf(function () { return store.readAssetFile(created.assetId, null, s); });
      assert.strictEqual(result.code, "asset_symlink_rejected");
    } finally {
      fs.lstatSync = realLstat;
    }
  });

  await test("case 6: deleted tombstone is last-one-wins and append-only", async function () {
    var s = scope("p3", "w3");
    var created = await store.createAsset({ kind: "screenshot", pngBuffer: PNG, scope: s });
    assert.ok(store.getAssetRecord(created.assetId, s));
    store.deleteAsset(created.assetId, s);
    assert.strictEqual(store.getAssetRecord(created.assetId, s), null);
    assert.strictEqual(store.listAssets({}, s).length, 0);
    var lines = indexLines(assetsDir(s));
    assert.strictEqual(lines.length, 2, "delete appends, never rewrites");
    assert.strictEqual(JSON.parse(lines[1]).deleted, true);
    // the binary stays behind on purpose (append-only, no GC in P0)
    assert.ok(fs.existsSync(path.join(assetsDir(s), created.assetId + ".png")));
    assert.strictEqual((await codeOf(function () { return store.deleteAsset(created.assetId, s); })).code, "asset_not_found");
  });

  await test("corrupt index lines are skipped without throwing", async function () {
    var s = scope("p4", "w4");
    var created = await store.createAsset({ kind: "screenshot", pngBuffer: PNG, scope: s });
    fs.appendFileSync(path.join(assetsDir(s), "index.jsonl"), "{not json\n{\"id\":\"bogus\"}\n\n");
    var all = store.loadAll(s);
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].id, created.assetId);
    assert.strictEqual(store.listAssets({}, s).length, 1);
  });

  await test("listAssets filters by kind/conversation and sorts newest first", async function () {
    var s = scope("p5", "w5");
    var a = await store.createAsset({ kind: "screenshot", pngBuffer: PNG, conversationId: "c1", scope: s });
    await new Promise(function (r) { setTimeout(r, 5); });
    var b = await store.createAsset({ kind: "svg", svgSource: SVG, conversationId: "c2", scope: s });
    var listed = store.listAssets({}, s);
    assert.strictEqual(listed.length, 2);
    assert.strictEqual(listed[0].id, b.assetId, "newest first");
    assert.strictEqual(store.listAssets({ kind: "screenshot" }, s).length, 1);
    assert.strictEqual(store.listAssets({ conversationId: "c2" }, s)[0].id, b.assetId);
    assert.strictEqual(store.listAssets({ conversationId: "zz" }, s).length, 0);
    assert.ok(a.assetId);
  });

  await test("loadAll on a world with no assets dir returns []", function () {
    assert.deepStrictEqual(store.loadAll({ projectRoot: TMP, accountId: null, profileId: "ghost", worldId: "gw" }), []);
  });

  await test("textbook-figure needs a valid ref and tolerates a degenerate rect only when positive", async function () {
    var s = scope("p6", "w6");
    assert.strictEqual((await codeOf(function () { return store.createAsset({ kind: "textbook-figure", scope: s }); })).code, "asset_ref_missing");
    assert.strictEqual((await codeOf(function () {
      return store.createAsset({ kind: "textbook-figure", ref: { bookId: "b", page: 0, rect: [0, 0, 1, 1] }, scope: s });
    })).code, "asset_ref_invalid");
    assert.strictEqual((await codeOf(function () {
      return store.createAsset({ kind: "textbook-figure", ref: { bookId: "b", page: 1, rect: [0, 0, 2, 1] }, scope: s });
    })).code, "asset_ref_invalid");
    assert.strictEqual((await codeOf(function () {
      return store.createAsset({ kind: "textbook-figure", ref: { bookId: "b", page: 1, rect: [0.5, 0.5, 0.5, 0.9] }, scope: s });
    })).code, "asset_ref_invalid");
    var created = await store.createAsset({ kind: "textbook-figure", ref: { bookId: "b", page: 1, rect: [0, 0, 1, 1] }, scope: s });
    assert.strictEqual(store.getAssetRecord(created.assetId, s).ref.page, 1);
  });

  await test("findAssetScope locates an id across worlds, and misses cleanly", async function () {
    store.clearScopeCache();
    var s = scope("p8", "w8");
    var created = await store.createAsset({ kind: "svg", svgSource: SVG, scope: s });
    var found = store.findAssetScope(created.assetId, { projectRoot: TMP, accountId: "acct" });
    assert.ok(found, "must find the owning world");
    assert.strictEqual(found.profileId, "p8");
    assert.strictEqual(found.worldId, "w8");
    assert.strictEqual(store.getAssetRecord(created.assetId, found).id, created.assetId);
    assert.strictEqual(store.findAssetScope("ast_ffffffffffffffff", { projectRoot: TMP, accountId: "acct" }), null);
    // legacy layout (no account segment)
    var legacy = { projectRoot: TMP, accountId: null, profileId: "p9", worldId: "w9" };
    var legacyCreated = await store.createAsset({ kind: "svg", svgSource: SVG, scope: legacy });
    assert.strictEqual((store.findAssetScope(legacyCreated.assetId, { projectRoot: TMP, accountId: null }) || {}).worldId, "w9");
    store.clearScopeCache();
    assert.strictEqual((store.findAssetScope(created.assetId, { projectRoot: TMP, accountId: "acct" }) || {}).worldId, "w8", "re-scans after cache clear");
  });

  await test("sanitizeRecord keeps only known fields", function () {
    var out = store.sanitizeRecord({ id: "ast_" + "a".repeat(16), kind: "svg", evil: "../../x", tags: ["a", "a", " b "] });
    assert.strictEqual(out.evil, undefined);
    assert.ok(!("evil" in out));
    assert.deepStrictEqual(out.tags, ["a", "b"]);
    assert.strictEqual(out.id, "ast_" + "a".repeat(16));
    assert.strictEqual(out.kind, "svg");
    assert.strictEqual(store.sanitizeRecord({ id: "bad", kind: "svg" }), null);
  });

  // ---- hardening: dedupe + reconcile --------------------------------------
  await test("hardening 1: the same bytes for the same page are stored once", async function () {
    var s = scope("ph1", "wh1");
    var ref = { textbookId: "book-h", page: 40, rect: [0, 0, 1, 1] };
    var first = await store.createAsset({ kind: "textbook-figure", ref: ref, pngBuffer: PNG, scope: s });
    var again = await store.createAsset({ kind: "textbook-figure", ref: ref, pngBuffer: PNG, scope: s });
    assert.strictEqual(again.assetId, first.assetId, "an identical re-capture must reuse the asset");
    assert.strictEqual(again.deduped, true);
    assert.strictEqual(store.listAssets({}, s).length, 1);
    var pngs = fs.readdirSync(assetsDir(s)).filter(function (n) { return n.endsWith(".png"); });
    assert.strictEqual(pngs.length, 1, "no duplicate binary on disk");
    assert.strictEqual(store.getAssetRecord(first.assetId, s).sha256, store.sha256Of(PNG));
  });

  await test("hardening 2: a different page or an explicit opt-out still stores", async function () {
    var s = scope("ph2", "wh2");
    var a = await store.createAsset({ kind: "textbook-figure", ref: { textbookId: "book-h2", page: 1, rect: [0, 0, 1, 1] }, pngBuffer: PNG, scope: s });
    var b = await store.createAsset({ kind: "textbook-figure", ref: { textbookId: "book-h2", page: 2, rect: [0, 0, 1, 1] }, pngBuffer: PNG, scope: s });
    assert.notStrictEqual(a.assetId, b.assetId, "the ref is part of the identity");
    var c = await store.createAsset({ kind: "screenshot", pngBuffer: PNG, scope: s });
    var d = await store.createAsset({ kind: "screenshot", pngBuffer: PNG, dedupe: false, scope: s });
    assert.notStrictEqual(c.assetId, d.assetId, "dedupe:false forces a new asset");
    var otherKind = await store.createAsset({ kind: "svg", svgSource: SVG, scope: s });
    assert.ok(otherKind.assetId);
  });

  await test("hardening 3: reconcile reports what the index and disk disagree on", async function () {
    var s = scope("ph3", "wh3");
    var kept = await store.createAsset({ kind: "screenshot", pngBuffer: PNG, scope: s });
    var lost = await store.createAsset({ kind: "screenshot", pngBuffer: makePng(32, 16), scope: s });
    fs.rmSync(path.join(assetsDir(s), lost.assetId + ".png"));
    // An orphan: a file present on disk with no index row (torn append, manual copy).
    var orphanId = "ast_" + "b".repeat(16);
    fs.writeFileSync(path.join(assetsDir(s), orphanId + ".png"), PNG);
    var report = store.reconcile(s);
    assert.ok(report.missingFiles.indexOf(lost.assetId) >= 0, "index row without a file");
    assert.ok(report.orphans.indexOf(orphanId) >= 0, "file without an index row");
    assert.ok(report.missingFiles.indexOf(kept.assetId) < 0);
    assert.strictEqual(store.getAssetRecord(orphanId, s), null, "unreadable before repair");
  });

  await test("hardening 4: reconcile --repair makes an orphan readable again", async function () {
    var s = scope("ph4", "wh4");
    var orphanId = "ast_" + "c".repeat(16);
    fs.mkdirSync(assetsDir(s), { recursive: true });
    fs.writeFileSync(path.join(assetsDir(s), orphanId + ".png"), PNG);
    var report = store.reconcile(s, { repair: true });
    assert.deepStrictEqual(report.repaired, [orphanId]);
    var record = store.getAssetRecord(orphanId, s);
    assert.ok(record && record.recovered === true, "recovered record is flagged");
    assert.strictEqual(record.bytes, PNG.length);
    assert.strictEqual(store.readAssetFile(orphanId, null, s).contentType, "image/png");
    assert.strictEqual(store.reconcile(s).orphans.length, 0, "repair is idempotent");
  });

  await test("hardening 6: an svg thumb request always resolves", async function () {
    var s = scope("ph6", "wh6");
    var created = await store.createAsset({ kind: "svg", svgSource: SVG, scope: s });
    // With sharp the thumb is a rasterized JPEG; without it the vector source is
    // served instead — either way the client's unconditional `?thumb=1` works.
    var read = store.readAssetFile(created.assetId, "thumb", s);
    assert.ok(read.contentType === "image/jpeg" || read.contentType === "image/svg+xml", read.contentType);
    assert.ok(fs.statSync(read.path).size > 0);
    assert.strictEqual(store.readAssetFile(created.assetId, null, s).contentType, "image/svg+xml");
  });

  // The message view showed every AI-drawn diagram as a black card: sharp drops
  // alpha for JPEG and composites it onto black, and the dark strokes of a
  // transparent diagram then sat on a black ground.  SVG rasters must be white.
  await test("bugfix: an svg thumbnail is composited on white, not black", async function () {
    if (!sharp) return skipped.push("no sharp: white composite assertion");
    var s = scope("pw1", "ww1");
    var created = await store.createAsset({ kind: "svg", svgSource: SVG_TRANSPARENT, scope: s });
    var read = store.readAssetFile(created.assetId, "thumb", s);
    assert.strictEqual(read.contentType, "image/jpeg");
    assert.deepStrictEqual(await cornerRgb(read.path), [255, 255, 255], "thumbnail ground must be white");
    assert.ok(fs.statSync(svgThumbMarker(read.path)).isFile(), "a white thumbnail must be stamped");
  });

  await test("bugfix: a pre-fix black svg thumbnail is rebuilt once, on first read", async function () {
    if (!sharp) return skipped.push("no sharp: thumbnail rebuild assertion");
    var s = scope("pw2", "ww2");
    var created = await store.createAsset({ kind: "svg", svgSource: SVG_TRANSPARENT, scope: s });
    var thumbPath = path.join(assetsDir(s), created.assetId + ".thumb.jpg");
    var marker = svgThumbMarker(thumbPath);
    // Reproduce a stored legacy thumbnail: no white composite, no stamp.
    fs.writeFileSync(thumbPath, await sharp(Buffer.from(SVG_TRANSPARENT)).jpeg({ quality: 80 }).toBuffer());
    fs.rmSync(marker, { force: true });
    assert.deepStrictEqual(await cornerRgb(thumbPath), [0, 0, 0], "the legacy thumbnail is black");

    // The triggering read serves the vector, so the black JPEG is never shown.
    var triggered = store.readAssetFile(created.assetId, "thumb", s);
    assert.strictEqual(triggered.contentType, "image/svg+xml", "the healing read must fall back to the vector");

    for (var i = 0; i < 40 && !fs.existsSync(marker); i += 1) {
      await new Promise(function (resolve) { setTimeout(resolve, 25); });
    }
    assert.ok(fs.existsSync(marker), "the rebuild must stamp the thumbnail");
    var healed = store.readAssetFile(created.assetId, "thumb", s);
    assert.strictEqual(healed.contentType, "image/jpeg");
    assert.deepStrictEqual(await cornerRgb(healed.path), [255, 255, 255], "the healed thumbnail must be white");
  });

  await test("bugfix: a stamped svg thumbnail is left alone", async function () {
    if (!sharp) return skipped.push("no sharp: one-shot rebuild assertion");
    var s = scope("pw3", "ww3");
    var created = await store.createAsset({ kind: "svg", svgSource: SVG_TRANSPARENT, scope: s });
    var thumbPath = path.join(assetsDir(s), created.assetId + ".thumb.jpg");
    var sentinel = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
    fs.writeFileSync(thumbPath, sentinel);
    var read = store.readAssetFile(created.assetId, "thumb", s);
    assert.strictEqual(read.contentType, "image/jpeg", "a stamped thumbnail is served as stored");
    assert.ok(fs.readFileSync(thumbPath).equals(sentinel), "a stamped thumbnail must not be rebuilt");
  });

  await test("hardening 5: a corrupt index tail line is skipped, not fatal", function () {
    var s = scope("ph5", "wh5");
    fs.mkdirSync(assetsDir(s), { recursive: true });
    fs.appendFileSync(store.indexPath(assetsDir(s)), '{"id":"ast_' + "d".repeat(16) + '","kind":"svg"}\n{"id":\n');
    var records = store.loadAll(s);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].id, "ast_" + "d".repeat(16));
  });
}

suite().then(function () {
  console.log("");
  if (skipped.length) console.log("environment notes: " + skipped.join(", "));
  var passed = results.filter(function (r) { return r.ok; }).length;
  var failed = results.length - passed;
  console.log("assets-store: " + passed + " passed, " + failed + " failed");
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  if (failed) process.exit(1);
}).catch(function (error) {
  console.error("harness failure: " + (error && error.stack));
  process.exit(1);
});
