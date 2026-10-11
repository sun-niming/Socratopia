// pdf-page-render.js — shared "PDF page -> PNG" renderer for API routes.
//
// The textbook-figure layer (T13) and the page-image preview route both need to
// rasterize one page of a textbook PDF.  kb-builder.mjs already proves the stack
// (pdfjs-dist + @napi-rs/canvas) inside its own worker process, but it is an ESM
// worker with process-level globals, so this module re-implements only the
// renderer in CommonJS and deliberately does NOT import kb-builder.mjs.
//
// Coordinates: `rect` is normalized [x0, y0, x1, y1] relative to the page's
// original width/height (0..1).  Pixels are computed here from the rendered
// size, so a caller never sends cross-platform pixel coordinates.
//
// Every error carries a stable `code` plus an HTTP `status` so route code can
// map it straight onto a response (same convention as lib/assets/store.js).
"use strict";

var fs = require("fs");
var path = require("path");
var url = require("url");

var PdfJsPaths = require("./pdfjs-paths.js");

// Render caps copied from lib/kb-builder.mjs so both paths agree on the ceiling.
var RENDER_DPI = 150;
var MAX_CANVAS_SIDE = 2600;
var MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
var MAX_PNG_BYTES = 12 * 1024 * 1024;

// An open pdfjs document holds the whole parsed file; three textbooks is the
// observed working set for a lesson.  Eviction destroys the document.
var DOC_CACHE_LIMIT = 3;

var SCOPE_PART_RE = /^[a-zA-Z0-9_-]{1,160}$/;

function codedError(code, message, status) {
  var error = new Error(message || code);
  error.code = code;
  error.status = status || 400;
  error.statusCode = error.status;
  return error;
}

// ---------------------------------------------------------------------------
// dependency resolution — mirrors kb-builder.mjs resolveDep: packaged
// (.next/node_modules) first, then the dev checkout, then NODE_PATH.  ESM
// ignores NODE_PATH, hence explicit absolute paths.
// ---------------------------------------------------------------------------
function resolveDependency(subpath) {
  var roots = [
    path.join(__dirname, "..", ".next", "node_modules", subpath),
    path.join(__dirname, "..", "..", "node_modules", subpath),
  ].concat(String(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean).map(function (root) {
    return path.join(root, subpath);
  }));
  for (var i = 0; i < roots.length; i += 1) {
    if (fs.existsSync(roots[i])) return roots[i];
  }
  throw codedError("figure_dependency_missing", "dependency not found: " + subpath, 500);
}

function dependencyUrl(subpath) {
  return url.pathToFileURL(resolveDependency(subpath)).href;
}

function dependencyDir(subpath) {
  return PdfJsPaths.resourceDir(resolveDependency(subpath));
}

var canvasModule = null;
var pdfjsModule = null;

async function loadCanvas() {
  if (canvasModule) return canvasModule;
  canvasModule = require(resolveDependency("@napi-rs/canvas/index.js"));
  return canvasModule;
}

async function loadPdfjs() {
  if (pdfjsModule) return pdfjsModule;
  var canvas = await loadCanvas();
  // pdfjs reads these globals at module-load time; @napi-rs/canvas is the real
  // implementation, exactly as kb-builder.mjs does it.
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = canvas.DOMMatrix;
  if (!globalThis.ImageData) globalThis.ImageData = canvas.ImageData;
  if (!globalThis.Path2D) globalThis.Path2D = canvas.Path2D;
  var pdfjs = await import(dependencyUrl("pdfjs-dist/legacy/build/pdf.mjs"));
  pdfjs.GlobalWorkerOptions.workerSrc = dependencyUrl("pdfjs-dist/legacy/build/pdf.worker.mjs");
  pdfjsModule = pdfjs;
  return pdfjsModule;
}

// ---------------------------------------------------------------------------
// LRU of open documents, keyed by absolute path + mtimeMs + size so an edited
// or replaced PDF is never served from a stale handle.
// ---------------------------------------------------------------------------
var docCache = new Map();

function docCacheSize() {
  return docCache.size;
}

function clearDocCache() {
  var entries = Array.from(docCache.values());
  docCache.clear();
  entries.forEach(function (entry) { destroyEntry(entry); });
  // Rendered rasters are derived from the document, so dropping one drops both —
  // otherwise a test/debug "clear" would silently keep serving rasters.
  clearRenderCache();
  clearPageCache();
  return entries.length;
}

function destroyEntry(entry) {
  if (!entry) return;
  Promise.resolve(entry.docPromise).then(function (doc) {
    if (doc && typeof doc.destroy === "function") return doc.destroy();
    return null;
  }).catch(function () { /* a failed open has nothing to destroy */ });
}

function touchDocCache(key, entry) {
  // Map preserves insertion order; re-insert to mark the newest use.
  if (docCache.has(key)) docCache.delete(key);
  docCache.set(key, entry);
  while (docCache.size > DOC_CACHE_LIMIT) {
    var oldestKey = docCache.keys().next().value;
    var oldest = docCache.get(oldestKey);
    docCache.delete(oldestKey);
    destroyEntry(oldest);
  }
  return entry;
}

function docCacheKey(pdfPath) {
  var stat;
  try {
    stat = fs.statSync(pdfPath);
  } catch (error) {
    if (error && error.code === "ENOENT") throw codedError("figure_source_missing", "PDF not found: " + pdfPath, 404);
    throw error;
  }
  if (!stat.isFile()) throw codedError("figure_source_missing", "PDF is not a file: " + pdfPath, 404);
  return path.resolve(pdfPath) + "|" + stat.mtimeMs + "|" + stat.size;
}

// Rendered page raster LRU.  Without it every figure the tutor orders re-rasterizes
// the page it sits on, and a background prefetch would pay that cost twice.  Keyed by
// document identity (path+mtime+size) + page + rect + the sizing knobs.
var RENDER_CACHE_LIMIT = 24;
var RENDER_CACHE_MAX_BYTES = 48 * 1024 * 1024;
var renderCache = new Map();
var renderCacheBytes = 0;

function renderCacheKey(pdfPath, pageNumber, box, opts) {
  var identity;
  try {
    identity = docCacheKey(pdfPath);
  } catch (_) {
    identity = path.resolve(String(pdfPath || ""));
  }
  var rect = box ? [box[0], box[1], box[2], box[3]].join(",") : "page";
  return identity + "|p" + pageNumber + "|" + rect + "|" + (opts && opts.maxWidth ? opts.maxWidth : "") + "|" + (opts && opts.scale ? opts.scale : "");
}

function renderCacheGet(key) {
  var hit = renderCache.get(key);
  if (!hit) return null;
  renderCache.delete(key);
  renderCache.set(key, hit);
  return hit.value;
}

function renderCacheSet(key, value) {
  if (renderCache.has(key)) {
    renderCacheBytes -= renderCache.get(key).bytes;
    renderCache.delete(key);
  }
  var bytes = value && Buffer.isBuffer(value.png) ? value.png.length : 0;
  renderCache.set(key, { value: value, bytes: bytes });
  renderCacheBytes += bytes;
  while (renderCache.size > RENDER_CACHE_LIMIT || (renderCacheBytes > RENDER_CACHE_MAX_BYTES && renderCache.size > 1)) {
    var oldest = renderCache.keys().next().value;
    if (oldest === undefined) break;
    renderCacheBytes -= renderCache.get(oldest).bytes;
    renderCache.delete(oldest);
  }
}

function clearRenderCache() {
  renderCache.clear();
  renderCacheBytes = 0;
}

function renderCacheSize() {
  return renderCache.size;
}

// Whole-page raster cache.  A page canvas is ~width*height*4 bytes of RGBA, so the
// budget is deliberately smaller than the rect cache's.
var PAGE_CACHE_LIMIT = 6;
var PAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
var pageCache = new Map();
var pageCacheBytes = 0;

function pageCanvasKey(pdfPath, pageNumber, opts) {
  var identity;
  try {
    identity = docCacheKey(pdfPath);
  } catch (_) {
    identity = path.resolve(String(pdfPath || ""));
  }
  var scale = opts && opts.scale ? opts.scale : "";
  var maxWidth = opts && opts.maxWidth ? opts.maxWidth : "";
  return identity + "|page" + pageNumber + "|" + scale + "|" + maxWidth;
}

function pageCacheGet(key) {
  var hit = pageCache.get(key);
  if (!hit) return null;
  pageCache.delete(key);
  pageCache.set(key, hit);
  return hit.value;
}

// Rasterizes one page and returns the decoded image.  `buffer` arrives as an
// already-decoded canvas in production; tests may inject a stub.  Independent of
// renderPageRegion so a background prefetch can warm it.
function pageCacheSet(key, entry) {
  var bytes = entry.canvas ? entry.canvas.width * entry.canvas.height * 4 : 0;
  if (pageCache.has(key)) {
    pageCacheBytes -= pageCache.get(key).bytes;
    pageCache.delete(key);
  }
  pageCache.set(key, { value: entry, bytes: bytes });
  pageCacheBytes += bytes;
  while (pageCache.size > PAGE_CACHE_LIMIT || (pageCacheBytes > PAGE_CACHE_MAX_BYTES && pageCache.size > 1)) {
    var oldest = pageCache.keys().next().value;
    if (oldest === undefined) break;
    pageCacheBytes -= pageCache.get(oldest).bytes;
    pageCache.delete(oldest);
  }
}

function clearPageCache() {
  pageCache.clear();
  pageCacheBytes = 0;
}

function pageCacheSize() {
  return pageCache.size;
}

async function openDocument(pdfPath) {
  var key = docCacheKey(pdfPath);
  var cached = docCache.get(key);
  if (cached) return { key: key, entry: touchDocCache(key, cached) };

  var pdfjs = await loadPdfjs();
  // A Buffer is passed as Uint8Array over a copied view: pdfjs may keep it alive
  // for lazy fetches, so it must not alias a pooled Buffer's backing store.
  var data = new Uint8Array(fs.readFileSync(pdfPath));
  var entry = { key: key, path: pdfPath };
  entry.docPromise = pdfjs.getDocument({
    data: data,
    useSystemFonts: true,
    disableAutoFetch: true,
    disableStream: true,
    cMapUrl: dependencyDir("pdfjs-dist/cmaps"),
    cMapPacked: true,
    standardFontDataUrl: dependencyDir("pdfjs-dist/standard_fonts"),
    wasmUrl: dependencyDir("pdfjs-dist/wasm"),
  }).promise.then(function (doc) {
    entry.doc = doc;
    return doc;
  }, function (error) {
    // Let a later call retry instead of caching a permanent failure.
    docCache.delete(key);
    throw error;
  });
  touchDocCache(key, entry);
  return { key: key, entry: entry };
}

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------
function normalizePage(page) {
  var value = Number(page);
  if (!Number.isInteger(value) || value < 1) {
    throw codedError("figure_page_out_of_range", "page must be a positive integer");
  }
  return value;
}

function normalizeRect(rect) {
  if (rect === null || rect === undefined) return null;
  if (!Array.isArray(rect) || rect.length !== 4) {
    throw codedError("figure_rect_invalid", "rect must be [x0, y0, x1, y1]");
  }
  var values = rect.map(Number);
  for (var i = 0; i < 4; i += 1) {
    if (!Number.isFinite(values[i]) || values[i] < 0 || values[i] > 1) {
      throw codedError("figure_rect_invalid", "rect values must be normalized 0..1");
    }
  }
  if (values[2] <= values[0] || values[3] <= values[1]) {
    throw codedError("figure_rect_invalid", "rect must have positive width and height");
  }
  return values;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scaleForPage(baseWidth, baseHeight, opts) {
  var requested = RENDER_DPI / 72;
  // The caps are ceilings, not a "never upscale" clamp: a normal A4 page at
  // 150 DPI stays far inside them and the extra pixels are what make a cropped
  // figure readable.  kb-builder's own scale is always 1 for the same reason.
  var sideScale = MAX_CANVAS_SIDE / Math.max(baseWidth, baseHeight);
  var pixelScale = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, baseWidth * baseHeight));
  var scale = Math.min(requested, sideScale, pixelScale);
  var maxWidth = Number(opts && opts.maxWidth);
  if (Number.isFinite(maxWidth) && maxWidth > 0) {
    scale = Math.min(scale, maxWidth / Math.max(1, baseWidth));
  }
  return scale;
}

// Pixel box of a normalized rect, rounded and clamped to at least 1x1 inside the
// rendered canvas.
function pixelBox(rect, width, height) {
  var left = clamp(Math.round(rect[0] * width), 0, width - 1);
  var top = clamp(Math.round(rect[1] * height), 0, height - 1);
  var right = clamp(Math.round(rect[2] * width), left + 1, width);
  var bottom = clamp(Math.round(rect[3] * height), top + 1, height);
  return { left: left, top: top, width: right - left, height: bottom - top };
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

// renderPageRegion(pdfPath, page, rect, opts) -> { png, width, height, ... }
//   page  1-based page number
//   rect  null for the whole page, else normalized [x0, y0, x1, y1]
//   opts  { maxWidth?: number } caps the rendered width (page previews)
async function renderPageRegion(pdfPath, page, rect, opts) {
  if (typeof pdfPath !== "string" || !pdfPath) {
    throw codedError("figure_source_missing", "pdfPath is required", 404);
  }
  var pageNumber = normalizePage(page);
  var box = normalizeRect(rect);
  opts = opts && typeof opts === "object" ? opts : {};

  var cacheKey = renderCacheKey(pdfPath, pageNumber, box, opts);
  var cached = renderCacheGet(cacheKey);
  if (cached) return cached;

  var pageEntry = await renderPageCanvas(pdfPath, pageNumber, opts);
  var canvas = pageEntry.canvas;

  var out = canvas;
  var outWidth = canvas.width;
  var outHeight = canvas.height;
  if (box) {
    var crop = pixelBox(box, canvas.width, canvas.height);
    out = cropCanvas(canvasModule, canvas, crop);
    outWidth = crop.width;
    outHeight = crop.height;
  }

  var png = out.toBuffer("image/png");
  if (!Buffer.isBuffer(png) || png.length < 8) {
    throw codedError("figure_render_failed", "Renderer produced no PNG", 500);
  }
  if (png.length > MAX_PNG_BYTES) {
    throw codedError("figure_render_failed", "Rendered PNG exceeds 12 MB", 500);
  }
  var result = {
    png: png,
    width: outWidth,
    height: outHeight,
    page: pageNumber,
    pageWidth: canvas.width,
    pageHeight: canvas.height,
    rect: box,
  };
  renderCacheSet(cacheKey, result);
  return result;
}

// Renders (and caches) the *whole page raster*, independent of any crop.  Every
// crop on a page reuses this, so a background prefetch of the page the tutor is
// about to cite makes the eventual `book://` order a crop + encode instead of a
// full rasterize.  Returns { canvas, width, height, page, pageWidth, pageHeight }.
async function renderPageCanvas(pdfPath, page, opts) {
  var pageNumber = normalizePage(page);
  opts = opts && typeof opts === "object" ? opts : {};
  var key = pageCanvasKey(pdfPath, pageNumber, opts);
  var hit = pageCacheGet(key);
  if (hit) return hit;

  var opened = await openDocument(pdfPath);
  var doc;
  try {
    doc = await opened.entry.docPromise;
  } catch (error) {
    throw error && error.code ? error : codedError("figure_render_failed", "Could not open PDF: " + (error && error.message), 500);
  }

  if (pageNumber > doc.numPages) {
    throw codedError("figure_page_out_of_range", "page " + pageNumber + " exceeds " + doc.numPages + " pages");
  }

  var canvas;
  var canvasLib;
  try {
    var pdfjs = await loadPdfjs();
    canvasLib = await loadCanvas();
    var pdfPage = await doc.getPage(pageNumber);
    var base = pdfPage.getViewport({ scale: 1 });
    var scale = scaleForPage(base.width, base.height, opts);
    var viewport = pdfPage.getViewport({ scale: scale });
    var width = Math.max(1, Math.ceil(viewport.width));
    var height = Math.max(1, Math.ceil(viewport.height));
    if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_CANVAS_PIXELS) {
      throw codedError("figure_render_failed", "canvas limit exceeded", 500);
    }
    canvas = canvasLib.createCanvas(width, height);
    var context = canvas.getContext("2d");
    await pdfPage.render({ canvasContext: context, viewport: viewport, canvasFactory: canvasFactory(canvasLib) }).promise;
    void pdfjs;
  } catch (error) {
    if (error && error.code) throw error;
    throw codedError("figure_render_failed", "Page render failed: " + (error && error.message), 500);
  }

  var entry = {
    canvas: canvas,
    width: canvas.width,
    height: canvas.height,
    page: pageNumber,
    pageWidth: canvas.width,
    pageHeight: canvas.height,
  };
  pageCacheSet(key, entry);
  return entry;
}

// Renders a list of pages in the background.  Never throws: the foreground order
// works without it, this only removes the later wait.
async function prefetchPages(pdfPath, pages, opts) {
  var report = { rendered: 0, cached: 0, failed: 0, pages: [] };
  var list = Array.isArray(pages) ? pages : [];
  for (var i = 0; i < list.length; i += 1) {
    var pageNumber = Number(list[i]);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) continue;
    try {
      if (pageCacheGet(pageCanvasKey(pdfPath, pageNumber, opts || {}))) {
        report.cached += 1;
        continue;
      }
      await renderPageCanvas(pdfPath, pageNumber, opts);
      report.rendered += 1;
      report.pages.push(pageNumber);
    } catch (error) {
      report.failed += 1;
      if (error && (error.code === "figure_page_out_of_range")) break;
    }
  }
  return report;
}

function canvasFactory(canvasLib) {
  return {
    create: function (w, h) {
      var c = canvasLib.createCanvas(w, h);
      return { canvas: c, context: c.getContext("2d") };
    },
    reset: function (co, w, h) { co.canvas.width = w; co.canvas.height = h; },
    destroy: function (co) { co.canvas.width = 0; co.canvas.height = 0; },
  };
}

// Crops on the canvas itself so the module needs no sharp: @napi-rs/canvas is
// already mandatory for the render step, sharp is optional everywhere else.
function cropCanvas(canvasLib, source, box) {
  var target = canvasLib.createCanvas(box.width, box.height);
  target.getContext("2d").drawImage(source, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
  return target;
}

// ---------------------------------------------------------------------------
// textbook source resolution (plan §3)
//
//   <worldDir>/textbooks/<textbookId>/<the one top-level *.pdf>
//
// Only the textbook's own directory top level is scanned; backup-* / handoff /
// knowledge_base subdirectories are ignored by construction.  When several PDFs
// sit side by side, the textbook_index.json row for that id names the original
// file; anything else is ambiguous rather than guessed.
// ---------------------------------------------------------------------------
function contained(root, candidate) {
  var relative = path.relative(root, candidate);
  return relative === "" ||
    (!!relative && relative !== ".." && relative.indexOf(".." + path.sep) !== 0 && !path.isAbsolute(relative));
}

function readTextbookIndexEntry(worldDir, textbookId) {
  try {
    var raw = fs.readFileSync(path.join(worldDir, "textbooks", "textbook_index.json"), "utf8");
    var parsed = JSON.parse(raw);
    var books = parsed && Array.isArray(parsed.textbooks) ? parsed.textbooks : [];
    for (var i = 0; i < books.length; i += 1) {
      if (books[i] && books[i].id === textbookId && typeof books[i].fileName === "string") return books[i];
    }
  } catch (_) {
    // A missing or corrupt index is not fatal: a single-pdf directory still works.
  }
  return null;
}

function listTopLevelPdfs(dir) {
  var entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter(function (entry) {
    return entry.isFile() && /\.pdf$/i.test(entry.name);
  }).map(function (entry) { return entry.name; }).sort();
}

function resolveTextbookPdf(worldDir, textbookId) {
  if (typeof worldDir !== "string" || !worldDir) {
    throw codedError("textbook_source_missing", "worldDir is required", 404);
  }
  if (typeof textbookId !== "string" || !SCOPE_PART_RE.test(textbookId)) {
    throw codedError("textbook_source_invalid", "Invalid textbookId");
  }
  var bookDir = path.join(worldDir, "textbooks", textbookId);
  if (!contained(path.resolve(worldDir), path.resolve(bookDir))) {
    throw codedError("textbook_source_invalid", "textbookId escapes the world directory");
  }
  var candidates = listTopLevelPdfs(bookDir);
  if (!candidates.length) {
    throw codedError("textbook_source_missing", "No PDF in " + path.join("textbooks", textbookId), 404);
  }
  if (candidates.length === 1) return path.join(bookDir, candidates[0]);
  var entry = readTextbookIndexEntry(worldDir, textbookId);
  if (entry && candidates.indexOf(entry.fileName) !== -1) return path.join(bookDir, entry.fileName);
  throw codedError("textbook_source_ambiguous", "Several PDFs in " + path.join("textbooks", textbookId) + " and no index entry", 409);
}

module.exports = {
  renderPageRegion: renderPageRegion,
  resolveTextbookPdf: resolveTextbookPdf,
  contained: contained,
  codedError: codedError,
  RENDER_DPI: RENDER_DPI,
  MAX_CANVAS_SIDE: MAX_CANVAS_SIDE,
  MAX_CANVAS_PIXELS: MAX_CANVAS_PIXELS,
  MAX_PNG_BYTES: MAX_PNG_BYTES,
  DOC_CACHE_LIMIT: DOC_CACHE_LIMIT,
  clearRenderCache: clearRenderCache,
  renderCacheSize: renderCacheSize,
  RENDER_CACHE_LIMIT: RENDER_CACHE_LIMIT,
  renderPageCanvas: renderPageCanvas,
  prefetchPages: prefetchPages,
  clearPageCache: clearPageCache,
  pageCacheSize: pageCacheSize,
  PAGE_CACHE_LIMIT: PAGE_CACHE_LIMIT,
  _internals: {
    resolveDependency: resolveDependency,
    docCacheSize: docCacheSize,
    clearDocCache: clearDocCache,
    normalizeRect: normalizeRect,
    pixelBox: pixelBox,
    scaleForPage: scaleForPage,
  },
};
