// pdf-page-render-smoke-test.js — self-contained tests for lib/pdf-page-render.js.
// No app, no network, no real API keys.  Run: node <this file>
//
// The fixture is generated at runtime (a 3-page PDF with a blue rectangle) so the
// test has no dependency on tmp/ or on a packaged textbook.
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var renderer = require("./pdf-page-render.js");

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
    console.log("        " + (error && error.stack ? error.stack.split("\n").slice(0, 6).join("\n        ") : error));
  }
}

async function codeOf(fn) {
  try {
    await fn();
    return { code: null };
  } catch (error) {
    return { code: error && error.code, status: error && error.status };
  }
}

// ---- fixtures -------------------------------------------------------------

var MEDIA_W = 612;
var MEDIA_H = 792;

function contentStream(pageNumber) {
  return [
    "0.20 0.40 0.90 rg",
    "153 396 306 200 re f",
    "0 0 0 rg",
    "BT /F1 24 Tf 72 720 Td (Page " + pageNumber + ") Tj ET",
  ].join("\n") + "\n";
}

// Minimal, correctly xref'd 3-page PDF.  latin1 keeps one byte per character so
// offsets stay exact.
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
    objects[pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + MEDIA_W + " " + MEDIA_H + "]" +
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

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-page-render-"));
var PDF = path.join(TMP, "book.pdf");
fs.writeFileSync(PDF, buildPdf(3));

function makeBook(name, pdfCount) {
  var bookDir = path.join(TMP, "worlds", "w1", "textbooks", name);
  fs.mkdirSync(bookDir, { recursive: true });
  for (var i = 0; i < pdfCount; i += 1) {
    fs.writeFileSync(path.join(bookDir, "book" + (i + 1) + ".pdf"), buildPdf(3));
  }
  return bookDir;
}

var WORLD = path.join(TMP, "worlds", "w1");
makeBook("single", 1);
makeBook("double", 2);

var PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertPng(buffer) {
  assert.ok(Buffer.isBuffer(buffer) && buffer.length > 100, "expected a PNG buffer");
  assert.ok(buffer.slice(0, 8).equals(PNG_MAGIC), "PNG magic bytes");
}

async function loadCanvas() {
  return require(renderer._internals.resolveDependency("@napi-rs/canvas/index.js"));
}

async function pixelAt(pngBuffer, x, y) {
  var canvasLib = await loadCanvas();
  var image = await canvasLib.loadImage(pngBuffer);
  var canvas = canvasLib.createCanvas(image.width, image.height);
  var ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  var data = ctx.getImageData(x, y, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

// ---- tests ---------------------------------------------------------------

async function suite() {
  console.log("lib/pdf-page-render.js");

  await test("full page renders a PNG at the builder's 150 DPI scale", async function () {
    var out = await renderer.renderPageRegion(PDF, 1, null);
    assertPng(out.png);
    assert.strictEqual(out.width, Math.ceil(MEDIA_W * renderer.RENDER_DPI / 72));
    assert.ok(Math.abs(out.height - Math.ceil(MEDIA_H * renderer.RENDER_DPI / 72)) <= 1, "height " + out.height);
    assert.ok(out.width <= renderer.MAX_CANVAS_SIDE && out.height <= renderer.MAX_CANVAS_SIDE);
    assert.ok(out.width * out.height <= renderer.MAX_CANVAS_PIXELS);
    assert.strictEqual(out.page, 1);
    assert.strictEqual(out.pageWidth, out.width);
  });

  await test("the rendered pixels actually contain the page's blue rectangle", async function () {
    var out = await renderer.renderPageRegion(PDF, 1, null);
    // The rectangle spans x 153..459, y 396..596 in PDF space (origin bottom-left).
    var center = await pixelAt(out.png, Math.round(out.width / 2), Math.round(out.height * 0.38));
    assert.ok(center.b > 150 && center.r < 120, "center pixel should be blue, got " + JSON.stringify(center));
    var corner = await pixelAt(out.png, 8, 8);
    assert.ok(corner.r > 220 && corner.g > 220 && corner.b > 220, "top-left should be white, got " + JSON.stringify(corner));
  });

  await test("a normalized rect crops to the proportional pixel box", async function () {
    var full = await renderer.renderPageRegion(PDF, 2, null);
    var half = await renderer.renderPageRegion(PDF, 2, [0.25, 0.25, 0.75, 0.75]);
    assertPng(half.png);
    assert.ok(Math.abs(half.width - Math.round(full.width * 0.5)) <= 2, "cropped width " + half.width);
    assert.ok(Math.abs(half.height - Math.round(full.height * 0.5)) <= 2, "cropped height " + half.height);
    assert.strictEqual(half.page, 2);
    assert.deepStrictEqual(half.rect, [0.25, 0.25, 0.75, 0.75]);
    assert.strictEqual(half.pageWidth, full.width, "pageWidth stays the full page width");
  });

  await test("a degenerate rect still yields at least one pixel", async function () {
    var out = await renderer.renderPageRegion(PDF, 1, [0.5, 0.5, 0.5001, 0.5001]);
    assert.ok(out.width >= 1 && out.height >= 1);
  });

  await test("maxWidth caps the rendered width", async function () {
    var out = await renderer.renderPageRegion(PDF, 1, null, { maxWidth: 400 });
    assert.ok(out.width <= 401 && out.width >= 398, "width " + out.width);
    assert.ok(out.height > out.width, "portrait page stays portrait");
  });

  await test("the same PDF is opened once and served from the document cache", async function () {
    renderer._internals.clearDocCache();
    await renderer.renderPageRegion(PDF, 1, null);
    assert.strictEqual(renderer._internals.docCacheSize(), 1);
    await renderer.renderPageRegion(PDF, 3, [0, 0, 0.5, 0.5]);
    assert.strictEqual(renderer._internals.docCacheSize(), 1, "re-render must not open a second document");
    // Touching the file is what invalidates: the key is path + mtime + size, so
    // the edited file gets its own entry instead of a stale parsed document.
    var stat = fs.statSync(PDF);
    var bumped = new Date(stat.mtimeMs + 5000);
    fs.utimesSync(PDF, bumped, bumped);
    var fresh = await renderer.renderPageRegion(PDF, 1, null);
    assertPng(fresh.png);
    assert.strictEqual(renderer._internals.docCacheSize(), 2, "a new mtime opens a new document");
  });

  await test("a repeated page+rect render is served from the raster cache", async function () {
    // Two orders pointing at the same figure (or a prefetch followed by the real
    // order) must not rasterize the page twice.
    renderer._internals.clearDocCache();
    var first = await renderer.renderPageRegion(PDF, 2, [0, 0, 0.5, 0.5]);
    assert.strictEqual(renderer.renderCacheSize(), 1);
    assert.strictEqual(renderer._internals.docCacheSize(), 1);
    var second = await renderer.renderPageRegion(PDF, 2, [0, 0, 0.5, 0.5]);
    assert.strictEqual(second.png, first.png, "the cached buffer is reused");
    await renderer.renderPageRegion(PDF, 2, [0, 0, 0.2, 0.2]);
    assert.strictEqual(renderer.renderCacheSize(), 2, "a different rect is its own entry");
    await renderer.renderPageRegion(PDF, 1, null);
    assert.strictEqual(renderer.renderCacheSize(), 3, "a whole page is its own entry");
    renderer.clearRenderCache();
    assert.strictEqual(renderer.renderCacheSize(), 0);
  });

  await test("prefetchPages warms the page cache that later crops reuse", async function () {
    renderer._internals.clearDocCache();
    var warmed = await renderer.prefetchPages(PDF, [1, 2, 3]);
    assert.strictEqual(warmed.rendered, 3);
    assert.strictEqual(renderer.pageCacheSize(), 3);
    var again = await renderer.prefetchPages(PDF, [1, 2, 3]);
    assert.strictEqual(again.cached, 3, "a re-run pays nothing");
    assert.strictEqual(again.rendered, 0);
    var docs = renderer._internals.docCacheSize();
    await renderer.renderPageRegion(PDF, 2, [0.2, 0.2, 0.6, 0.6]);
    assert.strictEqual(renderer._internals.docCacheSize(), docs, "no extra document for a warmed page");
    var beyond = await renderer.prefetchPages(PDF, [99]);
    assert.strictEqual(beyond.failed, 1, "a page past the end counts as failed, not a throw");
    renderer.clearPageCache();
    assert.strictEqual(renderer.pageCacheSize(), 0);
  });

  await test("the document cache is bounded and evicts without breaking later renders", async function () {
    renderer._internals.clearDocCache();
    assert.strictEqual(renderer._internals.docCacheSize(), 0);
    var paths = [];
    for (var i = 0; i < renderer.DOC_CACHE_LIMIT + 2; i += 1) {
      var file = path.join(TMP, "evict-" + i + ".pdf");
      fs.writeFileSync(file, buildPdf(3));
      paths.push(file);
    }
    for (var p = 0; p < paths.length; p += 1) await renderer.renderPageRegion(paths[p], 1, null);
    assert.strictEqual(renderer._internals.docCacheSize(), renderer.DOC_CACHE_LIMIT, "cache stays at its limit");
    // An evicted document must still render on its next use (proves eviction is
    // not a one-way dead end).
    var again = await renderer.renderPageRegion(paths[0], 2, null);
    assertPng(again.png);
    assert.strictEqual(renderer._internals.docCacheSize(), renderer.DOC_CACHE_LIMIT);
    renderer._internals.clearDocCache();
  });

  await test("invalid page and rect raise their coded errors", async function () {
    assert.strictEqual((await codeOf(function () { return renderer.renderPageRegion(PDF, 0, null); })).code, "figure_page_out_of_range");
    assert.strictEqual((await codeOf(function () { return renderer.renderPageRegion(PDF, 1.5, null); })).code, "figure_page_out_of_range");
    assert.strictEqual((await codeOf(function () { return renderer.renderPageRegion(PDF, 9, null); })).code, "figure_page_out_of_range");
    assert.strictEqual((await codeOf(function () { return renderer.renderPageRegion(PDF, 1, [0, 0, 1]); })).code, "figure_rect_invalid");
    assert.strictEqual((await codeOf(function () { return renderer.renderPageRegion(PDF, 1, [0, 0, 2, 1]); })).code, "figure_rect_invalid");
    assert.strictEqual((await codeOf(function () { return renderer.renderPageRegion(PDF, 1, [0.5, 0.5, 0.5, 0.9]); })).code, "figure_rect_invalid");
    assert.strictEqual((await codeOf(function () { return renderer.renderPageRegion(PDF, 1, [0.9, 0.1, 0.2, 0.5]); })).code, "figure_rect_invalid");
    var outOfRange = await codeOf(function () { return renderer.renderPageRegion(PDF, 9, null); });
    assert.strictEqual(outOfRange.status, 400);
    assert.strictEqual((await codeOf(function () { return renderer.renderPageRegion(path.join(TMP, "nope.pdf"), 1, null); })).code, "figure_source_missing");
    assert.strictEqual((await codeOf(function () { return renderer.renderPageRegion(path.join(TMP, "nope.pdf"), 1, null); })).status, 404);
  });

  await test("resolveTextbookPdf picks a lone top-level pdf and ignores subdirectories", function () {
    var bookDir = path.join(WORLD, "textbooks", "single");
    fs.mkdirSync(path.join(bookDir, "knowledge_base"), { recursive: true });
    fs.writeFileSync(path.join(bookDir, "knowledge_base", "nested1.pdf"), buildPdf(1));
    fs.writeFileSync(path.join(bookDir, "knowledge_base", "nested2.pdf"), buildPdf(1));
    fs.mkdirSync(path.join(bookDir, "backup-20260101"), { recursive: true });
    fs.writeFileSync(path.join(bookDir, "backup-20260101", "old.pdf"), buildPdf(1));
    assert.strictEqual(renderer.resolveTextbookPdf(WORLD, "single"), path.join(bookDir, "book1.pdf"));
  });

  await test("several top-level pdfs resolve through textbook_index.json, else report ambiguity", function () {
    assert.strictEqual((function () {
      try { renderer.resolveTextbookPdf(WORLD, "double"); return null; } catch (error) { return error.code; }
    })(), "textbook_source_ambiguous");
    fs.writeFileSync(path.join(WORLD, "textbooks", "textbook_index.json"), JSON.stringify({
      worldId: "w1",
      textbooks: [{ id: "double", fileName: "book2.pdf" }],
    }));
    assert.strictEqual(renderer.resolveTextbookPdf(WORLD, "double"), path.join(WORLD, "textbooks", "double", "book2.pdf"));
  });

  await test("missing textbook, bad id and traversal are reported as such", function () {
    function codeOfSync(fn) {
      try { fn(); return null; } catch (error) { return error.code; }
    }
    assert.strictEqual(codeOfSync(function () { return renderer.resolveTextbookPdf(WORLD, "ghost"); }), "textbook_source_missing");
    assert.strictEqual(codeOfSync(function () { return renderer.resolveTextbookPdf(WORLD, "../.."); }), "textbook_source_invalid");
    assert.strictEqual(codeOfSync(function () { return renderer.resolveTextbookPdf(WORLD, "a b"); }), "textbook_source_invalid");
    assert.strictEqual(codeOfSync(function () { return renderer.resolveTextbookPdf("", "x"); }), "textbook_source_missing");
  });

  await test("a resolved textbook renders straight through the resolver", async function () {
    var pdf = renderer.resolveTextbookPdf(WORLD, "single");
    var out = await renderer.renderPageRegion(pdf, 1, [0, 0, 1, 0.5], { maxWidth: 320 });
    assertPng(out.png);
    assert.ok(out.width <= 321);
  });
}

suite().then(function () {
  console.log("");
  if (skipped.length) console.log("environment notes: " + skipped.join(", "));
  var passed = results.filter(function (r) { return r.ok; }).length;
  var failed = results.length - passed;
  console.log("pdf-page-render: " + passed + " passed, " + failed + " failed");
  renderer._internals.clearDocCache();
  // pdfjs keeps worker handles alive briefly; do not let the temp dir lock exit.
  setTimeout(function () {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    if (failed) process.exit(1);
    process.exit(0);
  }, 50);
}).catch(function (error) {
  console.error("harness failure: " + (error && error.stack));
  process.exit(1);
});
