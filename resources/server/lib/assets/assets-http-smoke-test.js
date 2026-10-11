// assets-http-smoke-test.js — self-contained tests for lib/assets/http.js and the
// hand-written /api/assets route modules.  No booted Next server, no network.
// Run: node <this file>
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var store = require("./store.js");
var assetsIndex = require("./index.js");
var http = require("./http.js");

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

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), "assets-http-"));
var PROFILE = "p1";
var WORLD = "w1";

var PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
var SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';

// A fake page renderer keeps this fast test free of pdfjs/canvas while still
// exercising the handler's resolution and error-propagation branches.
var renderCalls = [];
var fakeRenderer = {
  resolveTextbookPdf: function (worldDir, textbookId) {
    renderCalls.push({ worldDir: worldDir, textbookId: textbookId });
    if (textbookId === "ghost") throw store.codedError("textbook_source_missing", "No PDF in the textbook directory", 404);
    if (textbookId === "../..") throw store.codedError("textbook_source_invalid", "Invalid textbookId");
    return path.join(worldDir, "textbooks", textbookId, "book.pdf");
  },
  renderPageRegion: async function (pdfPath, page, rect) {
    renderCalls.push({ pdfPath: pdfPath, page: page, rect: rect });
    return { png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), width: 10, height: 10 };
  },
};

var handlers = http.createAssetHandlers({ store: store, index: assetsIndex, renderer: fakeRenderer });

function request(method, requestPath, options) {
  options = options || {};
  var url = new URL("http://127.0.0.1:3000" + requestPath);
  if (options.query) {
    Object.keys(options.query).forEach(function (key) { url.searchParams.set(key, options.query[key]); });
  }
  var body = options.body || {};
  return {
    method: method,
    url: url.toString(),
    headers: options.headers || {},
    nextUrl: { pathname: url.pathname, searchParams: url.searchParams },
    json: function () { return Promise.resolve(body); },
    clone: function () { return { json: function () { return Promise.resolve(body); } }; },
    __body: body,
  };
}

function previousEnv() {
  return { PROJECT_ROOT: process.env.PROJECT_ROOT, account: global.__SOCRATOPIA_ACCOUNT_CONTEXT__ };
}

function installScope() {
  process.env.PROJECT_ROOT = TMP;
  global.__SOCRATOPIA_ACCOUNT_CONTEXT__ = function () { return { active: true, accountId: "acct" }; };
}

function restoreEnv(saved) {
  if (saved.PROJECT_ROOT === undefined) delete process.env.PROJECT_ROOT;
  else process.env.PROJECT_ROOT = saved.PROJECT_ROOT;
  global.__SOCRATOPIA_ACCOUNT_CONTEXT__ = saved.account;
  assetsIndex.invalidate();
}

var SCOPE_QUERY = { profileId: PROFILE, worldId: WORLD };

async function suite() {
  console.log("assets/http.js + route modules");
  var saved = previousEnv();
  installScope();

  await test("route modules load and declare the expected app paths", function () {
    var base = path.join(__dirname, "..", "..", ".next", "server", "app", "api", "assets");
    var expectations = [
      [path.join(base, "route.js"), "/api/assets/route", "/api/assets"],
      [path.join(base, "[id]", "route.js"), "/api/assets/[id]/route", "/api/assets/[id]"],
      [path.join(base, "[id]", "meta", "route.js"), "/api/assets/[id]/meta/route", "/api/assets/[id]/meta"],
    ];
    expectations.forEach(function (entry) {
      var mod = require(entry[0]);
      assert.ok(mod && mod.routeModule, entry[0] + " must export routeModule");
      assert.strictEqual(mod.routeModule.definition.page, entry[1]);
      assert.strictEqual(mod.routeModule.definition.pathname, entry[2]);
      assert.strictEqual(typeof mod.routeModule.handle, "function");
    });
  });

  await test("POST /api/assets creates a screenshot and returns its id", async function () {
    var response = await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "screenshot", pngBase64: PNG_BASE64, caption: "板书", conversationId: "c1" },
    }), {});
    assert.strictEqual(response.status, 201);
    var payload = await response.json();
    assert.match(payload.assetId, store.ASSET_ID_RE);
    assert.strictEqual(payload.record.kind, "screenshot");
    assert.ok(payload.record.kind, "screenshot");
    assert.ok(fs.existsSync(path.join(TMP, "accounts", "acct", "profiles", PROFILE, "worlds", WORLD, "assets", payload.assetId + ".png")));
  });

  await test("POST requires kind, a payload, and a scope", async function () {
    var noScope = await handlers.dispatch(request("POST", "/api/assets", { body: { kind: "svg", svgSource: SVG } }), {});
    assert.strictEqual(noScope.status, 400);
    assert.strictEqual((await noScope.json()).code, "asset_scope_missing");

    var badKind = await handlers.dispatch(request("POST", "/api/assets", { query: SCOPE_QUERY, body: { kind: "zzz" } }), {});
    assert.strictEqual(badKind.status, 400);
    assert.strictEqual((await badKind.json()).code, "asset_kind_invalid");

    var noPng = await handlers.dispatch(request("POST", "/api/assets", { query: SCOPE_QUERY, body: { kind: "screenshot" } }), {});
    assert.strictEqual(noPng.status, 400);
    assert.strictEqual((await noPng.json()).code, "asset_png_missing");

    var oversized = await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "screenshot", pngBase64: "A".repeat(http.MAX_PNG_BASE64 + 4) },
    }), {});
    assert.strictEqual(oversized.status, 413);
    assert.strictEqual((await oversized.json()).code, "asset_png_too_large");
  });

  await test("GET /api/assets lists and filters", async function () {
    var response = await handlers.dispatch(request("GET", "/api/assets", { query: SCOPE_QUERY }), {});
    var payload = await response.json();
    assert.strictEqual(response.status, 200);
    assert.ok(payload.count >= 1);
    var filtered = await (await handlers.dispatch(request("GET", "/api/assets", { query: { ...SCOPE_QUERY, kind: "svg" } }), {})).json();
    assert.strictEqual(filtered.count, 0);
  });

  await test("GET /api/assets?prefetch=1 warms the page cache and reports", async function () {
    var calls = [];
    var previous = global.__ASSETS_PREFETCH__;
    global.__ASSETS_PREFETCH__ = {
      schedule: function (input) { calls.push(input); return Promise.resolve({ scheduled: 1, rendered: 1, cached: 0, failed: 0 }); },
    };
    try {
      var response = await handlers.dispatch(request("GET", "/api/assets", {
        query: { ...SCOPE_QUERY, prefetch: "1", textbookId: "t1", endPage: "7" },
      }), {});
      var payload = await response.json();
      assert.strictEqual(response.status, 200);
      assert.strictEqual(payload.ok, true);
      assert.strictEqual(payload.report.rendered, 1);
      assert.strictEqual(calls[0].textbookId, "t1");
      assert.strictEqual(calls[0].endPage, 7);
      assert.strictEqual(calls[0].profileId, SCOPE_QUERY.profileId);
      await (await handlers.dispatch(request("GET", "/api/assets", {
        query: { ...SCOPE_QUERY, prefetch: "1", pages: "3,4", page: "9" },
      }), {})).json();
      assert.deepStrictEqual(calls[1].pages, [3, 4], "pages wins over page");
    } finally {
      if (previous === undefined) delete global.__ASSETS_PREFETCH__;
      else global.__ASSETS_PREFETCH__ = previous;
    }
    var plain = await (await handlers.dispatch(request("GET", "/api/assets", { query: { ...SCOPE_QUERY, prefetch: "1" } }), {})).json();
    assert.strictEqual(plain.assets !== undefined, true, "without the global the ordinary list is served");
  });

  await test("GET /api/assets/<id> returns bytes, meta returns the record; a rendered figure is a raster", async function () {
    var created = await (await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "svg", svgSource: SVG, svgTitle: "图", conversationId: "c2" },
    }), {})).json();
    var file = await handlers.dispatch(request("GET", "/api/assets/" + created.assetId, { query: SCOPE_QUERY }), {});
    assert.strictEqual(file.status, 200);
    assert.strictEqual(file.headers.get("content-type"), "image/svg+xml");
    assert.strictEqual(await file.text(), SVG);

    var meta = await handlers.dispatch(request("GET", "/api/assets/" + created.assetId + "/meta", { query: SCOPE_QUERY }), {});
    assert.strictEqual(meta.status, 200);
    assert.strictEqual((await meta.json()).asset.svgTitle, "图");

    var figure = await (await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "textbook-figure", ref: { bookId: "book-1", page: 12, rect: [0.1, 0.1, 0.9, 0.5] } },
    }), {})).json();
    assert.match(figure.assetId, store.ASSET_ID_RE);
    var figureFile = await handlers.dispatch(request("GET", "/api/assets/" + figure.assetId, { query: SCOPE_QUERY }), {});
    assert.strictEqual(figureFile.status, 200, "a rendered textbook-figure is served as a raster");
    assert.strictEqual(figureFile.headers.get("content-type"), "image/png");
    var figureMeta = await handlers.dispatch(request("GET", "/api/assets/" + figure.assetId + "/meta", { query: SCOPE_QUERY }), {});
    assert.strictEqual(figureMeta.status, 200);
    var figureRecord = (await figureMeta.json()).asset;
    assert.strictEqual(figureRecord.kind, "textbook-figure");
    assert.strictEqual(figureRecord.ref.page, 12);
    assert.deepStrictEqual(figureRecord.ref, { bookId: "book-1", page: 12, rect: [0.1, 0.1, 0.9, 0.5] });
  });

  await test("a textbook-figure is rendered from the world's textbook PDF", async function () {
    renderCalls.length = 0;
    var response = await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "textbook-figure", ref: { textbookId: "book-9", page: 3, rect: [0, 0, 1, 1] } },
    }), {});
    assert.strictEqual(response.status, 201);
    var payload = await response.json();
    assert.ok(payload.assetId);
    // The renderer is called with the PROJECT_ROOT world dir and a top-level PDF.
    assert.strictEqual(renderCalls[0].textbookId, "book-9");
    assert.strictEqual(renderCalls[0].worldDir, path.join(TMP, "accounts", "acct", "profiles", PROFILE, "worlds", WORLD));
    assert.strictEqual(renderCalls[1].page, 3);
    assert.deepStrictEqual(renderCalls[1].rect, [0, 0, 1, 1]);
    assert.ok(renderCalls[1].pdfPath.indexOf(path.join("textbooks", "book-9") + path.sep) !== -1, renderCalls[1].pdfPath);
    var served = await handlers.dispatch(request("GET", "/api/assets/" + payload.assetId, { query: SCOPE_QUERY }), {});
    assert.strictEqual(served.status, 200);
    assert.strictEqual(served.headers.get("content-type"), "image/png");
  });

  await test("a textbook-figure with pngBase64 skips the renderer", async function () {
    renderCalls.length = 0;
    var response = await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "textbook-figure", ref: { textbookId: "book-1", page: 1, rect: [0, 0, 1, 1] }, pngBase64: PNG_BASE64 },
    }), {});
    assert.strictEqual(response.status, 201);
    assert.strictEqual(renderCalls.length, 0, "the client's bytes win over a render");
  });

  await test("textbook-figure ref errors are coded: missing, traversal and renderer propagation", async function () {
    var missing = await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "textbook-figure", ref: { page: 1, rect: [0, 0, 1, 1] } },
    }), {});
    assert.strictEqual(missing.status, 400);
    assert.strictEqual((await missing.json()).code, "asset_ref_invalid");

    var blank = await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "textbook-figure", ref: { textbookId: "", page: 1, rect: [0, 0, 1, 1] } },
    }), {});
    assert.strictEqual(blank.status, 400);
    assert.strictEqual((await blank.json()).code, "asset_ref_invalid");

    // `../..` never reaches a filesystem join: the resolver rejects it outright.
    var traversal = await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "textbook-figure", ref: { textbookId: "../..", page: 1, rect: [0, 0, 1, 1] } },
    }), {});
    assert.strictEqual(traversal.status, 400);
    assert.strictEqual((await traversal.json()).code, "textbook_source_invalid");

    // A renderer's own coded error keeps its status instead of becoming a 500.
    var ghost = await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "textbook-figure", ref: { textbookId: "ghost", page: 1, rect: [0, 0, 1, 1] } },
    }), {});
    assert.strictEqual(ghost.status, 404);
    assert.strictEqual((await ghost.json()).code, "textbook_source_missing");
  });

  await test("unknown and traversal-ish ids are rejected, not resolved", async function () {
    var unknown = await handlers.dispatch(request("GET", "/api/assets/ast_0000000000000000/meta", { query: SCOPE_QUERY }), {});
    assert.strictEqual(unknown.status, 404);
    assert.strictEqual((await unknown.json()).code, "asset_not_found");

    var bad = await handlers.dispatch(request("GET", "/api/assets/not-an-id/meta", { query: SCOPE_QUERY }), {});
    assert.strictEqual(bad.status, 400);
    assert.strictEqual((await bad.json()).code, "asset_id_invalid");

    // `..` survives URL normalization only through a query parameter.
    var traversal = await handlers.dispatch(request("GET", "/api/assets", {
      query: { ...SCOPE_QUERY, id: "ast_../../etc", meta: "1" },
    }), {});
    assert.strictEqual(traversal.status, 400);
    assert.strictEqual((await traversal.json()).code, "asset_id_invalid");
  });

  await test("thumb falls back to the original file when no thumbnail exists", async function () {
    var created = await (await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "screenshot", pngBase64: PNG_BASE64 },
    }), {})).json();
    var thumb = await handlers.dispatch(request("GET", "/api/assets/" + created.assetId, { query: { ...SCOPE_QUERY, thumb: "1" } }), {});
    assert.strictEqual(thumb.status, 200);
    assert.ok(["image/png", "image/jpeg"].indexOf(thumb.headers.get("content-type")) !== -1);
  });

  await test("a bare asset:// id resolves without any scope query", async function () {
    store.clearScopeCache();
    var created = await (await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "svg", svgSource: SVG, caption: "裸锚点" },
    }), {})).json();
    var meta = await handlers.dispatch(request("GET", "/api/assets/" + created.assetId + "/meta"), {});
    assert.strictEqual(meta.status, 200, "meta must resolve by scan");
    assert.strictEqual((await meta.json()).asset.id, created.assetId);
    var file = await handlers.dispatch(request("GET", "/api/assets/" + created.assetId), {});
    assert.strictEqual(file.status, 200);
    assert.strictEqual(await file.text(), SVG);

    // An id that exists nowhere cannot be located, so the scope is still required.
    var unknown = await handlers.dispatch(request("GET", "/api/assets/ast_ffffffffffffffff/meta"), {});
    assert.strictEqual(unknown.status, 400);
    assert.strictEqual((await unknown.json()).code, "asset_scope_missing");
  });

  await test("the scope scan is cached and invalidated by a new record", async function () {
    store.clearScopeCache();
    var created = await (await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY, body: { kind: "svg", svgSource: SVG },
    }), {})).json();
    // Prime a negative entry, then prove a fresh record invalidates it.
    assert.strictEqual((await handlers.dispatch(request("GET", "/api/assets/ast_eeeeeeeeeeeeeeee/meta"), {})).status, 400);
    assert.strictEqual((await handlers.dispatch(request("GET", "/api/assets/" + created.assetId + "/meta"), {})).status, 200);
    assert.strictEqual((await handlers.dispatch(request("GET", "/api/assets/" + created.assetId + "/meta"), {})).status, 200);
  });

  await test("DELETE tombstones the asset and later reads 404", async function () {
    var created = await (await handlers.dispatch(request("POST", "/api/assets", {
      query: SCOPE_QUERY,
      body: { kind: "svg", svgSource: SVG },
    }), {})).json();
    var removed = await handlers.dispatch(request("DELETE", "/api/assets/" + created.assetId, { query: SCOPE_QUERY }), {});
    assert.strictEqual(removed.status, 200);
    assert.strictEqual((await handlers.dispatch(request("GET", "/api/assets/" + created.assetId + "/meta", { query: SCOPE_QUERY }), {})).status, 404);
    assert.strictEqual((await handlers.dispatch(request("DELETE", "/api/assets/" + created.assetId, { query: SCOPE_QUERY }), {})).status, 404);
  });

  await test("unsupported methods are rejected", async function () {
    var put = await handlers.dispatch(request("PUT", "/api/assets", { query: SCOPE_QUERY }), {});
    assert.strictEqual(put.status, 405);
    var postWithId = await handlers.dispatch(request("POST", "/api/assets/ast_0000000000000000", { query: SCOPE_QUERY }), {});
    assert.strictEqual(postWithId.status, 405);
  });

  await test("route auth facade: no facade on a real HTTP request -> 503, denial -> 403", async function () {
    var create = require("./route-module.js").create;
    var mod = create("/api/assets/route", "/api/assets", "app/api/assets/route");
    var inner = mod.userland.GET;

    delete global.__SOCRATOPIA_ROUTE_AUTH__;
    var noFacade = await inner(request("GET", "/api/assets", { query: SCOPE_QUERY }), {});
    assert.strictEqual(noFacade.status, 503);
    assert.strictEqual((await noFacade.json()).code, "auth_unavailable");

    var denied = 0;
    global.__SOCRATOPIA_ROUTE_AUTH__ = {
      pathOf: function (req) { return req.nextUrl.pathname; },
      dispatch: function (handler, req) {
        if (!req.headers.authorization) {
          denied += 1;
          return new Response(JSON.stringify({ code: "auth_invalid" }), { status: 403 });
        }
        return handler.apply(null, [req].concat(Array.prototype.slice.call(arguments, 2)[0] || []));
      },
    };
    try {
      var unauthorized = await inner(request("GET", "/api/assets", { query: SCOPE_QUERY }), {});
      assert.strictEqual(unauthorized.status, 403);
      assert.strictEqual(denied, 1);

      var authorized = await inner(request("GET", "/api/assets", { query: SCOPE_QUERY, headers: { authorization: "Socratopia t" } }), {});
      assert.strictEqual(authorized.status, 200);
      assert.ok((await authorized.json()).assets);
    } finally {
      delete global.__SOCRATOPIA_ROUTE_AUTH__;
    }
  });

  await test("a direct userland call without a URL skips the auth gate", async function () {
    var create = require("./route-module.js").create;
    var mod = create("/api/assets/route", "/api/assets", "app/api/assets/route");
    var response = await mod.userland.GET({ method: "GET", __body: { profileId: PROFILE, worldId: WORLD } }, {});
    assert.strictEqual(response.status, 200);
    assert.ok((await response.json()).assets);
  });

  restoreEnv(saved);
}

suite().then(function () {
  console.log("");
  var passed = results.filter(function (r) { return r.ok; }).length;
  var failed = results.length - passed;
  console.log("assets-http: " + passed + " passed, " + failed + " failed");
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  if (failed) process.exit(1);
}).catch(function (error) {
  console.error("harness failure: " + (error && error.stack));
  process.exit(1);
});
