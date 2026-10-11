// textbook-figure-e2e-smoke-test.js — T13e chain on a REAL booted server.
//
// The pieces have their own tests; this one proves they line up end to end:
//   page-image preview -> POST /api/assets (textbook-figure) -> GET the stored
//   PNG + thumbnail -> /meta keeps the provenance -> the chat serializer turns
//   the `asset://` anchor back into readable text for the model.
//
// Run by hand (the matrix skips .next/):
//   node resources/server/.next/server/app/api/assets/textbook-figure-e2e-smoke-test.js
"use strict";

var path = require("path");
var http = require("http");

var { TestEnvironment } = require(path.join(__dirname, "..", "..", "..", "..", "..", "smoke-test-utils.js"));

// TestEnvironment.get() collects the body as a UTF-8 string, which mangles raw
// PNG bytes.  Fetch image responses as latin1 so every byte survives.
function getBinary(env, url, extraHeaders) {
  return new Promise(function (resolve, reject) {
    var req = http.request({
      hostname: "127.0.0.1",
      port: env.serverPort,
      path: url,
      method: "GET",
      headers: extraHeaders || {},
    }, function (res) {
      var chunks = [];
      res.setEncoding("latin1");
      res.on("data", function (chunk) { chunks.push(Buffer.from(chunk, "latin1")); });
      res.on("end", function () {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ---- fixture: a tiny valid 3-page PDF (generated, no repo PDF needed) -------
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

var PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

var results = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok });
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (ok ? "" : "  -> " + detail));
}

function parse(body) {
  try { return JSON.parse(body); } catch (_) { return null; }
}

function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.slice(0, 8).equals(PNG_MAGIC)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

var env = new TestEnvironment({ silent: true });
var TEXTBOOK_ID = "t13book";

(async function main() {
  var Q = "profileId=test&worldId=test";
  var authed;
  try {
    await env.setup();
    authed = { Authorization: env.capabilityHeader() };

    // Fixture lands where the route resolves textbooks: PROJECT_ROOT-rooted.
    var worldDir = path.join(env.tmpDir, "accounts", "test", "profiles", "test", "worlds", "test");
    var bookDir = path.join(worldDir, "textbooks", TEXTBOOK_ID);
    require("fs").mkdirSync(bookDir, { recursive: true });
    require("fs").writeFileSync(path.join(bookDir, "fixture.pdf"), buildPdf(3));

    // 1. preview page 2.  The page-image action lives on the existing textbook
    //    route as a query flag (`?page-image=1`), which is what the frontend
    //    entry calls; `?action=page-image` is accepted as an alias.
    var preview = await getBinary(env, "/api/textbook?page-image=1&" + Q + "&textbookId=" + TEXTBOOK_ID + "&page=2&maxWidth=800", authed);

    // The streaming frontend renders a book:// order before the crop exists and cannot
    // always name the textbook; the route must fall back instead of 400-ing.
    var previewNoBook = await getBinary(env, "/api/textbook?page-image=1&" + Q + "&page=2&maxWidth=800", authed);
    check("page-image resolves the world's textbook when textbookId is omitted",
      previewNoBook.status === 200 && previewNoBook.body.length > 0 &&
        /image\/png/.test(String(previewNoBook.headers["content-type"])),
      "status=" + previewNoBook.status + " ct=" + previewNoBook.headers["content-type"] + " bytes=" + previewNoBook.body.length);
    var previewSize = pngSize(preview.body);
    check("GET /api/textbook?page-image=1 renders page 2 as PNG",
      preview.status === 200 && !!previewSize && previewSize.width <= 800 &&
      /max-age=3600/.test(String(preview.headers["cache-control"])),
      "status=" + preview.status + " ct=" + preview.headers["content-type"] + " size=" + JSON.stringify(previewSize));
    check("page-image is authenticated", (await getBinary(env, "/api/textbook?page-image=1&" + Q + "&textbookId=" + TEXTBOOK_ID + "&page=2")).status !== 200, "anon accepted");

    // 2. the user's marquee becomes a persisted figure
    //    normalized rect: the blue rectangle occupies the middle band of the page
    var created = await env.post("/api/assets?" + Q, {
      kind: "textbook-figure",
      ref: { textbookId: TEXTBOOK_ID, page: 2, rect: [0.25, 0.5, 0.75, 0.75] },
      caption: "图 2-1 双向异步消息通信模式",
      conversationId: "c-e2e",
    }, authed);
    var body = parse(created.body);
    var id = body && body.assetId;
    check("POST /api/assets renders and persists the textbook-figure",
      created.status === 201 && /^ast_[0-9a-f]{16}$/.test(String(id)) && body.record && body.record.width > 0 && body.record.height > 0,
      "status=" + created.status + " body=" + created.body.slice(0, 240));
    check("the record keeps its provenance, not pixel coordinates",
      !!body && body.record && body.record.ref && body.record.ref.page === 2 &&
      body.record.ref.bookId === TEXTBOOK_ID && body.record.ref.rect.length === 4,
      "ref=" + JSON.stringify(body && body.record && body.record.ref));

    if (!id) throw new Error("no asset id; nothing downstream to check");

    // 3. the cropped region is a real, smaller-than-page image (raw bytes, hence
    //    the latin1 transport helper)
    var file = await getBinary(env, "/api/assets/" + id + "?" + Q, authed);
    var cropped = pngSize(file.body);
    check("GET /api/assets/<id> serves the cropped PNG",
      file.status === 200 && /image\/png/.test(String(file.headers["content-type"])) && !!cropped &&
      (!previewSize || cropped.height < previewSize.height),
      "status=" + file.status + " size=" + JSON.stringify(cropped));
    var thumb = await env.get("/api/assets/" + id + "?thumb=1&" + Q, authed);
    check("the thumbnail is a JPEG", thumb.status === 200 && /image\/jpeg/.test(String(thumb.headers["content-type"])),
      "status=" + thumb.status + " ct=" + thumb.headers["content-type"]);
    var meta = await env.get("/api/assets/" + id + "/meta?" + Q, authed);
    check("/meta returns the figure record with its caption",
      meta.status === 200 && parse(meta.body) && parse(meta.body).asset.caption === "图 2-1 双向异步消息通信模式",
      "status=" + meta.status);
    var listed = await env.get("/api/assets?kind=textbook-figure&conversationId=c-e2e&" + Q, authed);
    check("the figure is listed for its conversation",
      listed.status === 200 && parse(listed.body) && parse(listed.body).count === 1, "status=" + listed.status);

    // 4. error ladder on the same route
    var badPage = await env.post("/api/assets?" + Q, {
      kind: "textbook-figure", ref: { textbookId: TEXTBOOK_ID, page: 9, rect: [0, 0, 1, 1] },
    }, authed);
    check("page out of range is a coded 400",
      badPage.status === 400 && /figure_page_out_of_range/.test(badPage.body), "status=" + badPage.status + " body=" + badPage.body.slice(0, 160));
    var noBook = await env.post("/api/assets?" + Q, {
      kind: "textbook-figure", ref: { textbookId: "ghost", page: 1, rect: [0, 0, 1, 1] },
    }, authed);
    check("unknown textbook is a coded 404",
      noBook.status === 404 && /textbook_source_missing/.test(noBook.body), "status=" + noBook.status + " body=" + noBook.body.slice(0, 160));
    var traversal = await env.post("/api/assets?" + Q, {
      kind: "textbook-figure", ref: { textbookId: "../..", page: 1, rect: [0, 0, 1, 1] },
    }, authed);
    check("a traversal textbookId is rejected, not resolved",
      traversal.status === 400 && /asset_ref_invalid|textbook_source/.test(traversal.body), "status=" + traversal.status + " body=" + traversal.body.slice(0, 160));

    // 5. the message path: the anchor the frontend inserts must reach the model
    //    as text, using the record we just created (same process, same globals
    //    the chat route installs).
    var store = require(path.join(__dirname, "..", "..", "..", "..", "..", "lib", "assets", "store.js"));
    var index = require(path.join(__dirname, "..", "..", "..", "..", "..", "lib", "assets", "index.js"));
    var serialize = require(path.join(__dirname, "..", "..", "..", "..", "..", "lib", "assets", "serialize.js"));
    global.__ASSETS__ = store;
    global.__ASSETS_INDEX__ = index;
    var scope = { projectRoot: env.tmpDir, accountId: "test", profileId: "test", worldId: "test" };
    var options = serialize.optionsFromGlobals(scope);
    check("vision stays off by default (stock install behaviour)", options.visionEnabled === false, "visionEnabled=" + options.visionEnabled);
    var out = serialize.messagesToLlmInput(
      [{ role: "user", content: "这一页的图讲什么？![图 p.2](asset://" + id + ")" }],
      options
    );
    check("the anchor flattens to the figure's caption for the model",
      typeof out[0].content === "string" && out[0].content.indexOf("图 2-1 双向异步消息通信模式") !== -1,
      "content=" + JSON.stringify(out[0].content).slice(0, 200));
  } catch (error) {
    check("harness completed", false, error && error.stack);
    console.log("server stderr tail:\n" + String(env.serverStderr || "").slice(-2500));
  } finally {
    try { await env.teardown(); } catch (_) {}
  }

  var failed = results.filter(function (r) { return !r.ok; }).length;
  console.log("");
  console.log("textbook-figure-e2e: " + (results.length - failed) + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();
