// http.js — request handlers for the /api/assets surface.
//
// Kept out of the route files on purpose: route.js under .next is a hand-written
// AppRouteRouteModule shim, so all real logic lives here where an ordinary smoke
// test can drive it without booting Next.
//
// Routes (plan §7):
//   POST   /api/assets                       create one asset
//   GET    /api/assets                       list (kind/conversationId/noteId filters)
//   GET    /api/assets/<id>[?thumb=1]        binary (404 only for a legacy
//                                            record-only textbook-figure)
//   GET    /api/assets/<id>/meta             index record
//   DELETE /api/assets/<id>                  append-only tombstone
//
// `textbook-figure` has no bytes on the wire: the handler resolves the world's
// textbook PDF, renders the page region here and hands the PNG to the store, so
// POST, GET and the serializer then treat it exactly like a screenshot.
//
// Every response goes through the account-scoped route auth facade installed by
// server.js, so an unauthenticated caller can never reach the store.
"use strict";

var path = require("path");

var MAX_PNG_BASE64 = Math.ceil(12 * 1024 * 1024 * 4 / 3) + 256;

function json(body, status, headers) {
  var out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
  };
  if (headers) Object.keys(headers).forEach(function (key) { out[key] = headers[key]; });
  return new Response(JSON.stringify(body), { status: status || 200, headers: out });
}

function fail(error, fallbackStatus) {
  var code = error && typeof error.code === "string" && /^[a-z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : "asset_internal_error";
  var status = Number(error && (error.status || error.statusCode));
  if (!Number.isFinite(status) || status < 400 || status > 599) status = fallbackStatus || 400;
  return json({ ok: false, code: code, message: String((error && error.message) || code), error: { code: code, status: status } }, status);
}

function queryOf(request, key) {
  var params = request && request.nextUrl && request.nextUrl.searchParams;
  if (params && typeof params.get === "function") return params.get(key);
  if (request && typeof request.url === "string") {
    try { return new URL(request.url, "http://127.0.0.1").searchParams.get(key); } catch (_) { return null; }
  }
  return null;
}

// `profileId`/`worldId` are also route-auth scope keys, so a request that names
// them is additionally checked against the capability token's scope.
function partialScope(request, body) {
  // A direct userland call (tests, internal callers) has no URL, so the explicit
  // __body fixture is the last place the scope can come from.
  var source = body || (request && request.__body) || null;
  return {
    profileId: queryOf(request, "profileId") || (source && source.profileId) || null,
    worldId: queryOf(request, "worldId") || (source && source.worldId) || null,
  };
}

function scopeMissing() {
  var error = new Error("profileId and worldId are required");
  error.code = "asset_scope_missing";
  error.status = 400;
  return error;
}

function scopeOf(request, body) {
  var scope = partialScope(request, body);
  if (!scope.profileId || !scope.worldId) throw scopeMissing();
  return scope;
}

// Reads accept a bare `asset://<id>`: when the scope is absent the id is looked
// up across the account's worlds, so an anchor stays a working hyperlink.
function readScopeFor(store, request, body, id) {
  var scope = partialScope(request, body);
  if (scope.profileId && scope.worldId) return scope;
  if (!scope.profileId && !scope.worldId && id) {
    var found = store.findAssetScope(id, {});
    if (found) return found;
  }
  throw scopeMissing();
}

function pathnameOf(request) {
  if (request && request.nextUrl && typeof request.nextUrl.pathname === "string") return request.nextUrl.pathname;
  if (request && typeof request.url === "string") {
    try { return new URL(request.url, "http://127.0.0.1").pathname; } catch (_) { return ""; }
  }
  return "";
}

// /api/assets            -> { id: null, meta: false }
// /api/assets/<id>       -> { id, meta: false }
// /api/assets/<id>/meta  -> { id, meta: true }
function targetOf(request, context) {
  var params = (context && context.params) || {};
  var id = typeof params.id === "string" ? params.id : null;
  var trailing = null;
  var pathname = pathnameOf(request);
  var match = /^\/api\/assets(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/.exec(pathname);
  if (match) {
    if (!id && match[1]) id = decodeURIComponent(match[1]);
    trailing = match[2] ? decodeURIComponent(match[2]) : null;
  }
  if (queryOf(request, "id")) id = queryOf(request, "id");
  return { id: id, meta: trailing === "meta" || queryOf(request, "meta") === "1" };
}

function readBody(request) {
  if (request && typeof request.json === "function") {
    return request.json().catch(function () { return {}; });
  }
  if (request && request.__body) return Promise.resolve(request.__body);
  return Promise.resolve({});
}

function decodePng(base64) {
  if (typeof base64 !== "string" || !base64) return undefined;
  if (base64.length > MAX_PNG_BASE64) {
    var error = new Error("PNG exceeds 12 MB");
    error.code = "asset_png_too_large";
    error.status = 413;
    throw error;
  }
  return Buffer.from(base64, "base64");
}

// dependencies are injectable so the smoke test can run without server.js.
function createAssetHandlers(deps) {
  deps = deps || {};
  var store = deps.store || function () { return global.__ASSETS__ || require("./store.js"); }();
  var assetsIndex = deps.index || function () { return global.__ASSETS_INDEX__ || require("./index.js"); }();
  // The page renderer is injected too, so the fast smoke test stays free of
  // pdfjs/canvas while the integration tests exercise the real thing.
  var renderer = deps.renderer || null;

  function pageRenderer() {
    if (!renderer) renderer = require("../pdf-page-render.js");
    return renderer;
  }

  // Renders the requested page region and returns its PNG.  Coded errors from
  // the renderer (404/409/400/500) propagate untouched to fail().
  async function renderTextbookFigure(body, scope) {
    var ref = body.ref && typeof body.ref === "object" && !Array.isArray(body.ref) ? body.ref : {};
    var textbookId = ref.textbookId || ref.bookId;
    if (typeof textbookId !== "string" || !textbookId) {
      var error = new Error("textbook-figure requires ref.textbookId");
      error.code = "asset_ref_invalid";
      error.status = 400;
      throw error;
    }
    var render = pageRenderer();
    var worldDir = store.resolveScope(scope).worldDir;
    var pdfPath = render.resolveTextbookPdf(worldDir, textbookId);
    // resolveTextbookPdf already rejects a traversing id; re-proving containment
    // here also covers an injected renderer that returns an odd path.
    if (!store.contained(path.resolve(worldDir), path.resolve(pdfPath))) {
      throw store.codedError("textbook_source_invalid", "textbookId escapes the world directory");
    }
    var rendered = await render.renderPageRegion(pdfPath, ref.page, ref.rect || null);
    return rendered.png;
  }

  function handleList(request) {
    var scope = scopeOf(request, null);
    // Maintenance view: `?audit=1` reports index/disk drift, `&repair=1` also
    // re-inserts a record for a file whose index row was lost.  Additive, so the
    // ordinary list shape is unchanged.
    if (queryOf(request, "audit") === "1") {
      if (store && typeof store.reconcile === "function") {
        return json({ ok: true, report: store.reconcile(scope, { repair: queryOf(request, "repair") === "1" }) });
      }
    }
    // `?prefetch=1&textbookId=..&page=..|pages=1,2` warms the page raster cache
    // (same work the chat route schedules in the background) and reports what it did.
    if (queryOf(request, "prefetch") === "1") {
      var prefetch = global.__ASSETS_PREFETCH__;
      if (prefetch && typeof prefetch.schedule === "function") {
        var pagesQuery = queryOf(request, "pages");
        var pageQuery = queryOf(request, "page");
        var wanted = pagesQuery
          ? String(pagesQuery).split(",").map(Number)
          : pageQuery ? [Number(pageQuery)] : null;
        var endPage = Number(queryOf(request, "endPage"));
        return prefetch.schedule({
          profileId: scope.profileId,
          worldId: scope.worldId,
          accountId: scope.accountId,
          textbookId: queryOf(request, "textbookId") || undefined,
          pages: wanted || undefined,
          endPage: Number.isInteger(endPage) ? endPage : undefined,
        }).then(function (report) {
          return json({ ok: true, report: report });
        });
      }
    }
    var limit = Number(queryOf(request, "limit"));
    var assets = assetsIndex.list({
      kind: queryOf(request, "kind"),
      conversationId: queryOf(request, "conversationId"),
      noteId: queryOf(request, "noteId"),
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(500, Math.floor(limit)) : 0,
    }, scope);
    return json({ ok: true, count: assets.length, assets: assets });
  }

  async function handleCreate(request) {
    var body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      var error = new Error("Body must be a JSON object");
      error.code = "asset_body_invalid";
      error.status = 400;
      throw error;
    }
    var scope = scopeOf(request, body);
    var kind = String(body.kind || "");
    if (kind !== "textbook-figure" && kind !== "svg" && kind !== "screenshot" && kind !== "generated") {
      var kindError = new Error("Unknown asset kind: " + (kind || "(missing)"));
      kindError.code = "asset_kind_invalid";
      kindError.status = 400;
      throw kindError;
    }
    // A figure with no client-side bytes is rendered here; with one it is a
    // plain upload, which keeps the branch testable without a real PDF.
    var pngBuffer = decodePng(body.pngBase64);
    if (kind === "textbook-figure" && !pngBuffer) pngBuffer = await renderTextbookFigure(body, scope);
    var created = await store.createAsset({
      kind: kind,
      scope: scope,
      pngBuffer: pngBuffer,
      svgSource: body.svgSource,
      ref: body.ref,
      caption: body.caption,
      tags: body.tags,
      prompt: body.prompt,
      svgTitle: body.svgTitle,
      conversationId: body.conversationId,
      messageId: body.messageId,
      noteId: body.noteId,
    });
    assetsIndex.invalidate(scope);
    return json({ ok: true, assetId: created.assetId, record: created.record }, 201);
  }

  function handleMeta(request, context) {
    var target = targetOf(request, context);
    if (!target.id) {
      var error = new Error("Asset id required");
      error.code = "asset_id_invalid";
      error.status = 400;
      throw error;
    }
    var scope = readScopeFor(store, request, null, target.id);
    var record = assetsIndex.get(target.id, scope);
    if (!record) {
      var missing = new Error("Asset not found");
      missing.code = "asset_not_found";
      missing.status = 404;
      throw missing;
    }
    return json({ ok: true, asset: record });
  }

  function handleFile(request, context) {
    var target = targetOf(request, context);
    if (!target.id) {
      var error = new Error("Asset id required");
      error.code = "asset_id_invalid";
      error.status = 400;
      throw error;
    }
    var scope = readScopeFor(store, request, null, target.id);
    var variant = queryOf(request, "thumb") === "1" ? "thumb" : null;
    var file = store.readAssetFile(target.id, variant, scope);
    var bytes = require("fs").readFileSync(file.path);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(bytes.length),
        // Asset ids are content-addressed by creation, so a file never changes.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }

  function handleDelete(request, context) {
    var target = targetOf(request, context);
    var scope = scopeOf(request, null);
    if (!target.id) {
      var error = new Error("Asset id required");
      error.code = "asset_id_invalid";
      error.status = 400;
      throw error;
    }
    store.deleteAsset(target.id, scope);
    assetsIndex.invalidate(scope);
    return json({ ok: true, assetId: target.id, deleted: true });
  }

  // One dispatcher for all three registered app paths.
  function dispatch(request, context) {
    var method = String((request && request.method) || "GET").toUpperCase();
    var target = targetOf(request, context);
    try {
      if (method === "POST") {
        if (target.id) {
          var postError = new Error("Use /api/assets for POST");
          postError.code = "asset_route_invalid";
          postError.status = 405;
          throw postError;
        }
        return Promise.resolve(handleCreate(request)).catch(function (error) { return fail(error); });
      }
      if (method === "DELETE") return Promise.resolve(handleDelete(request, context)).catch(function (error) { return fail(error); });
      if (method !== "GET" && method !== "HEAD") {
        var methodError = new Error("Method not allowed");
        methodError.code = "asset_method_not_allowed";
        methodError.status = 405;
        throw methodError;
      }
      if (target.meta) return Promise.resolve(handleMeta(request, context)).catch(function (error) { return fail(error, 404); });
      if (target.id) return Promise.resolve(handleFile(request, context)).catch(function (error) { return fail(error, 404); });
      return Promise.resolve(handleList(request)).catch(function (error) { return fail(error); });
    } catch (error) {
      return fail(error);
    }
  }

  return {
    dispatch: dispatch,
    list: handleList,
    create: handleCreate,
    meta: handleMeta,
    file: handleFile,
    remove: handleDelete,
    _internals: { targetOf: targetOf, scopeOf: scopeOf, partialScope: partialScope, readScopeFor: readScopeFor, decodePng: decodePng },
  };
}

module.exports = { createAssetHandlers: createAssetHandlers, MAX_PNG_BASE64: MAX_PNG_BASE64 };
