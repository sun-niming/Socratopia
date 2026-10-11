// assets-prefetch-smoke-test.js — self-contained tests for lib/assets/prefetch.js.
// Run: node <this file>
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var prefetch = require("./prefetch.js");
var renderer = require("../pdf-page-render.js");

var results = [];
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), "assets-prefetch-"));

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
  return "0.2 0.4 0.9 rg\n100 400 300 200 re f\n0 0 0 rg\nBT /F1 20 Tf 60 720 Td (P" + pageNumber + ") Tj ET\n";
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
  for (var k = 1; k < objects.length; k += 1) out += String(offsets[k]).padStart(10, "0") + " 00000 n \n";
  out += "trailer\n<< /Size " + objects.length + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF\n";
  return Buffer.from(out, "latin1");
}

function makeWorld(name) {
  var scope = { projectRoot: TMP, accountId: "acct", profileId: "p1", worldId: name };
  var worldDir = require("./store.js").resolveScope(scope).worldDir;
  fs.mkdirSync(path.join(worldDir, "textbooks", "tid" + name), { recursive: true });
  fs.writeFileSync(path.join(worldDir, "textbooks", "tid" + name, "book.pdf"), buildPdf(4));
  return { scope: scope, worldDir: worldDir, pdfPath: path.join(worldDir, "textbooks", "tid" + name, "book.pdf") };
}

// ---- tests ----------------------------------------------------------------

(async function suite() {
  await test("pages are derived from the window end plus a lookahead", function () {
    assert.deepStrictEqual(prefetch.resolvePages({ endPage: 10 }), [11, 12]);
    assert.deepStrictEqual(prefetch.resolvePages({ pages: [3, 1, 3, 0, -2] }), [3, 1]);
    assert.deepStrictEqual(prefetch.resolvePages({ pages: [1, 2, 3, 4, 5] }).length, prefetch.MAX_PAGES_PER_RUN);
    assert.deepStrictEqual(prefetch.resolvePages({}), []);
  });

  await test("a schedule renders exactly the requested pages once", async function () {
    prefetch.reset();
    var fixture = makeWorld("w1");
    var report = await prefetch.schedule({ pdfPath: fixture.pdfPath, pages: [1, 2] });
    assert.strictEqual(report.rendered, 2, JSON.stringify(report));
    assert.strictEqual(report.failed, 0);
    assert.strictEqual(renderer.pageCacheSize() >= 2, true);
  });

  await test("a second schedule within the throttle window is a no-op", async function () {
    prefetch.reset();
    var fixture = makeWorld("w2");
    var first = await prefetch.schedule({ pdfPath: fixture.pdfPath, pages: [1] });
    assert.strictEqual(first.rendered, 1);
    var second = await prefetch.schedule({ pdfPath: fixture.pdfPath, pages: [1] });
    assert.strictEqual(second.skipped, "throttled");
    prefetch.reset();
    var third = await prefetch.schedule({ pdfPath: fixture.pdfPath, pages: [1] });
    assert.strictEqual(third.skipped, null, "reset clears the throttle");
    assert.strictEqual(third.cached, 1, "the page is already rasterized");
  });

  await test("an overlapping schedule for the same pdf is skipped, not queued twice", async function () {
    prefetch.reset();
    var fixture = makeWorld("w3");
    var both = await Promise.all([
      prefetch.schedule({ pdfPath: fixture.pdfPath, pages: [1, 2, 3] }),
      prefetch.schedule({ pdfPath: fixture.pdfPath, pages: [1, 2, 3] }),
    ]);
    var skipped = both.filter(function (r) { return r.skipped === "in_flight"; });
    assert.strictEqual(skipped.length, 1, JSON.stringify(both));
  });

  await test("a page past the end of the PDF stops the run without throwing", async function () {
    prefetch.reset();
    var fixture = makeWorld("w4");
    var report = await prefetch.schedule({ pdfPath: fixture.pdfPath, pages: [4, 5, 6] });
    assert.strictEqual(report.rendered, 1, JSON.stringify(report));
    assert.strictEqual(report.failed >= 1, true);
  });

  await test("no textbook and no pdf degrade to a report, never a throw", async function () {
    prefetch.reset();
    var bare = { projectRoot: TMP, accountId: "acct", profileId: "p1", worldId: "nothing-here" };
    var noPdf = await prefetch.schedule({ profileId: "p1", worldId: "nothing-here", projectRoot: TMP, accountId: "acct", textbookId: "nope", pages: [1] });
    assert.strictEqual(noPdf.skipped, "no_pdf");
    var noPages = await prefetch.schedule({ projectRoot: TMP, worldId: bare.worldId, pages: [] });
    assert.strictEqual(noPages.skipped, "no_pages");
  });

  await test("the textbook id is resolved through the world when no pdf is given", async function () {
    prefetch.reset();
    var fixture = makeWorld("w5");
    var report = await prefetch.schedule({
      projectRoot: TMP, accountId: "acct", profileId: "p1", worldId: "w5",
      textbookId: "tidw5", pages: [2],
    });
    assert.strictEqual(report.rendered, 1, JSON.stringify(report));
  });

  await test("a prefetched page makes a later crop cheap (the page raster is reused)", async function () {
    prefetch.reset();
    renderer.clearPageCache();
    renderer._internals.clearDocCache();
    var fixture = makeWorld("w6");
    await prefetch.schedule({ pdfPath: fixture.pdfPath, pages: [2] });
    var pagesAfterPrefetch = renderer.pageCacheSize();
    var docsAfterPrefetch = renderer._internals.docCacheSize();
    var cropped = await renderer.renderPageRegion(fixture.pdfPath, 2, [0.1, 0.1, 0.5, 0.5]);
    assert.ok(cropped.png.length > 100);
    assert.strictEqual(renderer.pageCacheSize(), pagesAfterPrefetch, "no new page raster");
    assert.strictEqual(renderer._internals.docCacheSize(), docsAfterPrefetch, "no new document open");
  });

  await test("scheduleInBackground never rejects and reports through stats", async function () {
    prefetch.reset();
    var fixture = makeWorld("w7");
    prefetch.scheduleInBackground({ pdfPath: fixture.pdfPath, pages: [1] });
    assert.strictEqual(prefetch.stats().throttleMs > 0, true);
  });

  await test("a stub renderer can be injected through the global hook", async function () {
    prefetch.reset();
    var calls = [];
    var previous = global.__PDF_PAGE_RENDER__;
    global.__PDF_PAGE_RENDER__ = {
      resolveTextbookPdf: function () { return "/stub/book.pdf"; },
      prefetchPages: function (pdfPath, pages) { calls.push({ pdfPath: pdfPath, pages: pages }); return { rendered: pages.length, cached: 0, failed: 0, pages: pages }; },
    };
    try {
      var report = await prefetch.schedule({ pdfPath: "/stub/book.pdf", endPage: 20 });
      assert.deepStrictEqual(calls[0].pages, [21, 22]);
      assert.strictEqual(report.rendered, 2);
    } finally {
      if (previous === undefined) delete global.__PDF_PAGE_RENDER__;
      else global.__PDF_PAGE_RENDER__ = previous;
    }
  });

  console.log("");
  var passed = results.filter(function (r) { return r.ok; }).length;
  var failed = results.length - passed;
  console.log("assets-prefetch: " + passed + " passed, " + failed + " failed");
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  if (failed) process.exit(1);
})();
