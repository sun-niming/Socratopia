// assets-intents-smoke-test.js — self-contained tests for lib/assets/intents.js.
// Real tiny PDF + real page renderer, no app, no network.
// Run: node <this file>
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var intents = require("./intents.js");
var store = require("./store.js");
var renderer = require("../pdf-page-render.js");

var results = [];
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), "assets-intents-"));

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

// ---- fixtures -------------------------------------------------------------

function contentStream(pageNumber) {
  return "0.20 0.40 0.90 rg\n153 396 306 200 re f\n0 0 0 rg\nBT /F1 24 Tf 72 720 Td (Page " + pageNumber + ") Tj ET\n";
}

function buildPdf(pageCount) {
  var fontId = 3 + pageCount * 2;
  var objects = [];
  var kids = [];
  for (var i = 0; i < pageCount; i += 1) kids.push((3 + i * 2) + " 0 R");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pageCount + " >>";
  for (var p = 0; p < pageCount; p += 1) {
    var pageId = 3 + p * 2;
    var stream = contentStream(p + 1);
    objects[pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]" +
      " /Resources << /Font << /F1 " + fontId + " 0 R >> >> /Contents " + (pageId + 1) + " 0 R >>";
    objects[pageId + 1] = "<< /Length " + Buffer.byteLength(stream, "latin1") + " >>\nstream\n" + stream + "endstream";
  }
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  var out = "%PDF-1.4\n";
  var offsets = [];
  for (var id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += id + " 0 obj\n" + objects[id] + "\nendobj\n";
  }
  var xrefStart = Buffer.byteLength(out, "latin1");
  out += "xref\n0 " + objects.length + "\n0000000000 65535 f \n";
  for (var k = 1; k < objects.length; k += 1) {
    out += String(offsets[k]).padStart(10, "0") + " 00000 n \n";
  }
  out += "trailer\n<< /Size " + objects.length + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF\n";
  return Buffer.from(out, "latin1");
}

var SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect x="4" y="4" width="192" height="92" fill="none" stroke="#333"/></svg>';

var worlds = {};
function makeWorld(name) {
  if (worlds[name]) return worlds[name];
  var scope = { projectRoot: TMP, accountId: "acct", profileId: "p1", worldId: name };
  var worldDir = store.resolveScope(scope).worldDir;
  fs.mkdirSync(path.join(worldDir, "textbooks", "tid" + name), { recursive: true });
  fs.writeFileSync(path.join(worldDir, "textbooks", "tid" + name, "book.pdf"), buildPdf(3));
  worlds[name] = scope;
  return scope;
}

function textOf(message) {
  return typeof message === "string" ? message : message.content;
}

function order(text, scope, extra) {
  var ctx = Object.assign({ scope: scope }, extra || {});
  return intents.materializeText(text, ctx);
}

// ---- tests ----------------------------------------------------------------

(async function suite() {
  await test("a book order crops the page into an asset and rewrites to asset://", async function () {
    var scope = makeWorld("w1");
    var text = "先看这张图：\n\n![图 12-7a 调用/返回模式](book://tidw1/p2#0.1,0.1,0.5,0.4)\n\n然后是讲解。";
    var out = await order(text, scope);
    assert.ok(out.indexOf("book://") < 0, "the order must be rewritten");
    var match = /!\[图 12-7a 调用\/返回模式\]\(asset:\/\/(ast_[0-9a-f]{16})\)/.exec(out);
    assert.ok(match, "anchor with the alt text expected, got: " + out);
    var record = store.getAssetRecord(match[1], scope);
    assert.strictEqual(record.kind, "textbook-figure");
    assert.strictEqual(record.ref.page, 2);
    assert.deepStrictEqual(record.ref.rect, [0.1, 0.1, 0.5, 0.4]);
    assert.strictEqual(record.caption, "图 12-7a 调用/返回模式");
    var file = store.readAssetFile(match[1], null, scope);
    assert.strictEqual(file.contentType, "image/png");
    assert.ok(fs.statSync(file.path).size > 100);
  });

  await test("the same order resolves to the same asset and does not re-render", async function () {
    var scope = makeWorld("w2");
    var text = "![示意图](book://tidw2/p1#0.2,0.2,0.3,0.3)";
    var first = await order(text, scope);
    renderer.clearRenderCache();
    var second = await order(text, scope);
    assert.strictEqual(second, first, "idempotent rewrite");
    assert.strictEqual(renderer.renderCacheSize(), 0, "the second pass never rendered");
    var pngs = fs.readdirSync(store.resolveScope(scope).assetsDir).filter(function (n) { return n.endsWith(".png"); });
    assert.strictEqual(pngs.length, 1);
  });

  await test("a rect that is too thin or incoherent falls back to the whole page", async function () {
    var scope = makeWorld("w3");
    var out = await order("![x](book://tidw3/p2#0.1,0.1,0.105,0.5)", scope);
    var id = /asset:\/\/(ast_[0-9a-f]{16})/.exec(out)[1];
    var record = store.getAssetRecord(id, scope);
    assert.deepStrictEqual(record.ref.rect, [0, 0, 1, 1], "rect dropped, page kept");
    assert.strictEqual(record.ref.page, 2);
    // An incoherent box (right edge left of the origin) is dropped the same way.
    var swapped = await order("![x](book://tidw3/p3#0.8,0.8,0.2,0.2)", scope);
    var swappedId = /asset:\/\/(ast_[0-9a-f]{16})/.exec(swapped)[1];
    assert.deepStrictEqual(store.getAssetRecord(swappedId, scope).ref.rect, [0, 0, 1, 1]);
  });

  await test("the short form uses the current textbook", async function () {
    var scope = makeWorld("w4");
    var out = await order("![x](book://p3#0.2,0.2,0.3,0.3)", scope, { textbookId: "tidw4" });
    var id = /asset:\/\/(ast_[0-9a-f]{16})/.exec(out)[1];
    assert.strictEqual(store.getAssetRecord(id, scope).ref.bookId, "tidw4");
    var shortForm = await order("![x](book://p3#0.2,0.2,0.3,0.3)", scope);
    assert.strictEqual(shortForm, out, "single-textbook worlds resolve the short form too");
  });

  await test("a missing textbook leaves the order readable, never throws", async function () {
    var scope = { projectRoot: TMP, accountId: "acct", profileId: "p1", worldId: "empty" };
    var text = "![x](book://tidnone/p1#0.1,0.1,0.5,0.5)";
    var out = await order(text, scope);
    assert.strictEqual(out, text);
  });

  await test("a page past the end of the PDF keeps the order text", async function () {
    var scope = makeWorld("w5");
    var text = "![x](book://tidw5/p99)";
    assert.strictEqual(await order(text, scope), text);
  });

  await test("an svg fence becomes an svg asset with the title as alt", async function () {
    var scope = makeWorld("w6");
    var text = "来看时序：\n\n```svg\n<!-- title: 消息-回复时序 -->\n" + SVG + "\n```\n\n就这样。";
    var out = await order(text, scope);
    assert.ok(out.indexOf("```svg") < 0, "fence replaced");
    var id = /!\[消息-回复时序\]\(asset:\/\/(ast_[0-9a-f]{16})\)/.exec(out);
    assert.ok(id, "anchored with the title, got: " + out);
    var record = store.getAssetRecord(id[1], scope);
    assert.strictEqual(record.kind, "svg");
    assert.strictEqual(record.svgTitle, "消息-回复时序");
    assert.strictEqual(store.readAssetFile(id[1], "thumb", scope).contentType.length > 0, true, "thumb request resolves for an svg");
  });

  await test("an unusable svg is left in place", async function () {
    var scope = makeWorld("w7");
    var noViewBox = "```svg\n<svg width=\"10\" height=\"10\"><rect/></svg>\n```";
    assert.strictEqual(await order(noViewBox, scope), noViewBox);
    var scripted = "```svg\n<svg viewBox=\"0 0 1 1\"><script>x()</script></svg>\n```";
    assert.strictEqual(await order(scripted, scope), scripted);
  });

  // The guide tells the model to open with `<!-- title: … -->`, and models never write
  // `xmlns`. A leading comment (or XML declaration) must not be mistaken for a bad root,
  // and added xmlns must reach the stored file — without it a data-URI <img> decodes to 0×0.
  await test("a title comment before the root is accepted, and xmlns is added", async function () {
    var scope = makeWorld("w7b");
    var fig = "<svg viewBox=\"0 0 40 20\"><rect width=\"40\" height=\"20\"/></svg>";
    var raw = "<!-- title: 有注释的图 -->\n" + fig;
    assert.strictEqual(intents.validateSvgSource(raw).invalid, undefined, "a leading comment must not reject the root");
    var bare = fs.readFileSync(
      (function () {
        var tmp = path.join(os.tmpdir(), "intents-svg-" + process.pid + ".txt");
        fs.writeFileSync(tmp, fig);
        return tmp;
      })(),
      "utf8"
    );
    assert.ok(intents.validateSvgSource(bare).value.indexOf("xmlns=") > 0, "validate must add xmlns");
    var out = await order("看：\n\n```svg\n" + raw + "\n```", scope);
    assert.ok(out.indexOf("```svg") < 0, "a titled fence must still materialize");
    var id = /asset:\/\/(ast_[0-9a-f]{16})/.exec(out);
    assert.ok(id, "titled svg must be anchored, got: " + out);
    var stored = fs.readFileSync(store.readAssetFile(id[1], null, scope).path, "utf8");
    assert.ok(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(stored), "stored svg must carry xmlns");
    var already = await order("```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><rect/></svg>\n```", scope);
    assert.ok(already.indexOf("```svg") < 0, "an svg that already has xmlns still works");
    assert.strictEqual(
      (intents.validateSvgSource("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><rect/></svg>").value.match(/xmlns=/g) || []).length,
      1,
      "xmlns must not be added twice"
    );
  });

  await test("at most four orders are materialized per message", async function () {
    var scope = makeWorld("w8");
    var lines = [];
    for (var i = 1; i <= 5; i += 1) lines.push("![f" + i + "](book://tidw8/p1#0,0,0.2,0.2)");
    var out = await order(lines.join("\n\n"), scope);
    var done = (out.match(/asset:\/\//g) || []).length;
    assert.strictEqual(done, intents.MAX_ORDERS_PER_MESSAGE);
    assert.ok(out.indexOf("book://") > 0, "the surplus order stays as readable text");
  });

  await test("materializeConversation rewrites assistant strings only", async function () {
    var scope = makeWorld("w9");
    var conversation = {
      messages: [
        { role: "user", content: "![user](book://tidw9/p1#0.1,0.1,0.2,0.2)" },
        { role: "assistant", content: "![a](book://tidw9/p2#0.1,0.1,0.2,0.2) and ```svg\n" + SVG + "\n```" },
        { role: "assistant", content: [{ type: "text", text: "no markdown here" }] },
        { role: "assistant", content: "nothing to do" },
      ],
    };
    var report = await intents.materializeConversation(conversation, { projectRoot: TMP, accountId: "acct", profileId: "p1", worldId: "w9" });
    assert.strictEqual(report.rewritten, 1);
    assert.ok(conversation.messages[0].content.indexOf("book://") > 0, "a user order stays as written");
    assert.ok(conversation.messages[1].content.indexOf("asset://") > 0);
    assert.ok(conversation.messages[1].content.indexOf("```svg") < 0);
  });

  await test("a message with no order short-circuits", async function () {
    assert.strictEqual(await intents.materializeText("plain prose", {}), "plain prose");
    assert.strictEqual(await intents.materializeText("", {}), "");
    assert.strictEqual(await intents.materializeText(null, {}), null);
  });

  await test("the anchor label never breaks markdown", async function () {
    var scope = makeWorld("w10");
    var out = await order("![图 [12-7a] 调用/返回](book://tidw10/p1#0.1,0.1,0.2,0.2)", scope);
    var label = /!\[([^\]]*)\]\(asset:/.exec(out);
    assert.ok(label, "anchor parses back");
    assert.strictEqual(label[1], "图 12-7a 调用/返回");
  });

  console.log("");
  var passed = results.filter(function (r) { return r.ok; }).length;
  var failed = results.length - passed;
  console.log("assets-intents: " + passed + " passed, " + failed + " failed");
  try {
    renderer.clearRenderCache();
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (_) {}
  if (failed) process.exit(1);
})();
