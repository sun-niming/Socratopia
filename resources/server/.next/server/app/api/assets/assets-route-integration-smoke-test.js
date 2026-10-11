// assets-route-integration-smoke-test.js — boots the REAL server and drives the
// hand-written /api/assets routes over HTTP, so it covers the parts the fast
// lib/assets/assets-http-smoke-test.js cannot: the app-path manifests, the
// hand-written AppRouteRouteModule shim, dynamic-segment matching and the real
// capability-token gate.
//
// Run by hand (the matrix skips .next/):
//   node resources/server/.next/server/app/api/assets/assets-route-integration-smoke-test.js
"use strict";

var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

var { TestEnvironment } = require(path.join(__dirname, "..", "..", "..", "..", "..", "smoke-test-utils.js"));

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
  ihdr[8] = 8;
  ihdr[9] = 2;
  var raw = Buffer.alloc((width * 3 + 1) * height);
  for (var y = 0; y < height; y += 1) raw[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- fixture: a tiny valid 3-page PDF (no repo PDF needed) -----------------
function contentStream(pageNumber) {
  return [
    "0.20 0.40 0.90 rg",
    "153 396 306 200 re f",
    "0 0 0 rg",
    "BT /F1 24 Tf 72 720 Td (Page " + pageNumber + ") Tj ET",
  ].join("\n") + "\n";
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

var results = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: ok });
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (ok ? "" : "  -> " + detail));
}

function parse(body) {
  try { return JSON.parse(body); } catch (_) { return null; }
}

var env = new TestEnvironment({ silent: true });

(async function main() {
  var Q = "profileId=test&worldId=test";
  var authed;
  try {
    await env.setup();
    authed = { Authorization: env.capabilityHeader() };

    var anon = await env.get("/api/assets?" + Q);
    check("unauthenticated GET is rejected", anon.status === 401 || anon.status === 403, "status=" + anon.status);

    var list = await env.get("/api/assets?" + Q, authed);
    check("GET /api/assets lists (200, empty)", list.status === 200 && parse(list.body) && parse(list.body).count === 0,
      "status=" + list.status + " body=" + list.body.slice(0, 200));

    var png = makePng(40, 20);
    var created = await env.post("/api/assets?" + Q, { kind: "screenshot", pngBase64: png.toString("base64"), caption: "板书" }, authed);
    var createdBody = parse(created.body);
    var id = createdBody && createdBody.assetId;
    check("POST /api/assets creates a screenshot (201)", created.status === 201 && /^ast_[0-9a-f]{16}$/.test(id || ""),
      "status=" + created.status + " body=" + created.body.slice(0, 200));

    var file = await env.get("/api/assets/" + id + "?" + Q, authed);
    check("GET /api/assets/<id> serves PNG bytes (dynamic route matched)",
      file.status === 200 && /image\/png/.test(String(file.headers["content-type"])),
      "status=" + file.status + " ct=" + file.headers["content-type"]);

    var thumb = await env.get("/api/assets/" + id + "?thumb=1&" + Q, authed);
    check("GET /api/assets/<id>?thumb=1 serves a sharp thumbnail (jpeg)",
      thumb.status === 200 && /image\/jpeg/.test(String(thumb.headers["content-type"])),
      "status=" + thumb.status + " ct=" + thumb.headers["content-type"]);

    var meta = await env.get("/api/assets/" + id + "/meta?" + Q, authed);
    check("GET /api/assets/<id>/meta returns the record",
      meta.status === 200 && parse(meta.body) && parse(meta.body).asset.kind === "screenshot" && parse(meta.body).asset.width === 40,
      "status=" + meta.status + " body=" + meta.body.slice(0, 200));

    // A real textbook PDF where the route resolves textbooks (PROJECT_ROOT is
    // env.tmpDir), so the textbook-figure branch renders through pdfjs for real.
    var worldDir = path.join(env.tmpDir, "accounts", "test", "profiles", "test", "worlds", "test");
    var bookDir = path.join(worldDir, "textbooks", "t13b");
    fs.mkdirSync(bookDir, { recursive: true });
    fs.writeFileSync(path.join(bookDir, "book.pdf"), buildPdf(3));

    var figure = await env.post("/api/assets?" + Q, {
      kind: "textbook-figure",
      ref: { textbookId: "t13b", page: 2, rect: [0.1, 0.1, 0.9, 0.5] },
      caption: "图 2-1",
    }, authed);
    var figureBody = parse(figure.body);
    var figureId = figureBody && figureBody.assetId;
    check("POST /api/assets renders a textbook-figure (201)",
      figure.status === 201 && /^ast_[0-9a-f]{16}$/.test(figureId || "") && figureBody.record.width > 0 && figureBody.record.height > 0,
      "status=" + figure.status + " body=" + figure.body.slice(0, 200));
    var figureFile = await env.get("/api/assets/" + figureId + "?" + Q, authed);
    check("textbook-figure GET original is a PNG (200)",
      figureFile.status === 200 && /image\/png/.test(String(figureFile.headers["content-type"])),
      "status=" + figureFile.status + " ct=" + figureFile.headers["content-type"]);
    var figureThumb = await env.get("/api/assets/" + figureId + "?thumb=1&" + Q, authed);
    check("textbook-figure GET ?thumb=1 is a jpeg (200)",
      figureThumb.status === 200 && /image\/jpeg/.test(String(figureThumb.headers["content-type"])),
      "status=" + figureThumb.status + " ct=" + figureThumb.headers["content-type"]);
    var figureMeta = await env.get("/api/assets/" + figureId + "/meta?" + Q, authed);
    check("textbook-figure meta is 200 with ref",
      figureMeta.status === 200 && parse(figureMeta.body) && parse(figureMeta.body).asset.ref.page === 2 &&
      parse(figureMeta.body).asset.ref.bookId === "t13b",
      "status=" + figureMeta.status + " body=" + figureMeta.body.slice(0, 200));

    var bad = await env.get("/api/assets/not-an-id/meta?" + Q, authed);
    check("invalid id rejected (400)", bad.status === 400, "status=" + bad.status);

    var noScope = await env.get("/api/assets", authed);
    check("missing scope rejected (400)", noScope.status === 400, "status=" + noScope.status);

    var list2 = await env.get("/api/assets?" + Q, authed);
    check("list reports both assets", list2.status === 200 && parse(list2.body) && parse(list2.body).count === 2,
      "status=" + list2.status + " body=" + list2.body.slice(0, 200));

    var filtered = await env.get("/api/assets?kind=svg&" + Q, authed);
    check("kind filter narrows the list", filtered.status === 200 && parse(filtered.body) && parse(filtered.body).count === 0,
      "status=" + filtered.status);

    // 14. The breadcrumb matters on the real machine: a renderer <img> carries no
    // capability, so a missing auth=yes line is the difference between "broken
    // thumbnail" and "hydration will retry".
    var anon = await env.get("/api/assets/" + figureId + "?thumb=1&" + Q);
    check("an unauthenticated thumb GET is 401", anon.status === 401, "status=" + anon.status);
    await new Promise(function (resolve) { setTimeout(resolve, 300); });
    var stderr = String(env.serverStderr || "");
    var breadcrumbs = stderr.split("\n").filter(function (line) { return line.indexOf("[assets-http]") >= 0; });
    // NB: match with >= 0 - raw harness stderr starts the line at index 0, while the
    // packaged log prefixes it.  A `> 0` here silently fails only in this harness.
    check("the route logs the request, its auth state and the status",
      breadcrumbs.some(function (line) { return line.indexOf("[assets-http] GET /api/assets/" + figureId) >= 0 && line.indexOf("auth=no -> 401") >= 0; }),
      breadcrumbs.slice(-3).join(" | ") || "(no breadcrumbs)");
    check("an authed request logs auth=yes -> 200",
      breadcrumbs.some(function (line) { return line.indexOf("auth=yes -> 200") >= 0; }),
      breadcrumbs.slice(-3).join(" | ") || "(no breadcrumbs)");
  } catch (error) {
    check("harness completed", false, error && error.stack);
    console.log("server stderr tail:\n" + String(env.serverStderr || "").slice(-2500));
  } finally {
    try { await env.teardown(); } catch (_) {}
  }

  var failed = results.filter(function (r) { return !r.ok; }).length;
  console.log("");
  console.log("assets-route-integration: " + (results.length - failed) + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();
