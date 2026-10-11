// store.js — asset layer on-disk store (PNG / SVG files + append-only index.jsonl).
//
// One asset layer, many writers: screenshots, LLM-authored SVG work figures,
// server-rendered textbook figures and raster generations.  A textbook figure
// carries a PNG like a screenshot once the route has rendered it; a legacy
// caller that passes no buffer still gets the P0 record-only row.
// Readers are the `asset://<id>` anchors in messages and notes.
//
// Path safety mirrors lib/ocr/local-ocr-runner.mjs: a `contained()` check plus
// `lstat` symlink rejection.  All errors carry a stable `code` and an HTTP
// `status` so route code can map them straight to a response.
"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var INDEX_FILE = "index.jsonl";
var ASSET_ID_RE = /^ast_[0-9a-f]{16}$/;
var SCOPE_PART_RE = /^[a-zA-Z0-9_-]{1,160}$/;

var MAX_PNG_BYTES = 12 * 1024 * 1024;
var MAX_SVG_BYTES = 512 * 1024;
var THUMB_EDGE_PX = 256;

var PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// kind -> which binary field it owns (null = no dedicated field; a
// textbook-figure receives its PNG from the route's renderer instead)
var KINDS = Object.freeze({
  "textbook-figure": null,
  svg: "svgSource",
  screenshot: "pngBuffer",
  generated: "pngBuffer",
});

function codedError(code, message, status) {
  var error = new Error(message || code);
  error.code = code;
  error.status = status || 400;
  error.statusCode = error.status;
  return error;
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function newAssetId() {
  return "ast_" + crypto.randomBytes(8).toString("hex");
}

function contained(root, candidate) {
  var relative = path.relative(root, candidate);
  return relative === "" ||
    (!!relative && relative !== ".." && relative.indexOf(".." + path.sep) !== 0 && !path.isAbsolute(relative));
}

function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.slice(0, 8).equals(PNG_MAGIC);
}

function parsePngSize(buffer) {
  if (!isPng(buffer) || buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function parseSvgSize(source) {
  if (typeof source !== "string") return null;
  var width = /\bwidth\s*=\s*["']([0-9.]+)(?:px)?["']/i.exec(source);
  var height = /\bheight\s*=\s*["']([0-9.]+)(?:px)?["']/i.exec(source);
  if (width && height) return { width: Math.round(Number(width[1])), height: Math.round(Number(height[1])) };
  var viewBox = /\bviewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(source);
  if (viewBox) return { width: Math.round(Number(viewBox[1])), height: Math.round(Number(viewBox[2])) };
  return null;
}

function deviceScopePart(value, name) {
  if (typeof value !== "string" || !SCOPE_PART_RE.test(value)) {
    throw codedError("asset_scope_invalid", "Invalid asset " + name);
  }
  return value;
}

function activeAccountId() {
  try {
    var context = global.__SOCRATOPIA_ACCOUNT_CONTEXT__;
    var state = typeof context === "function" ? context() : null;
    return state && state.active ? state.accountId : null;
  } catch (_) {
    return null;
  }
}

// Assets live beside the rest of a world's user data:
//   <PROJECT_ROOT>/accounts/<accountId>/profiles/<profileId>/worlds/<worldId>/assets/
// Optional explicit scope wins over process.env / the request account context so
// the module is unit-testable without a booted server.
function resolveScope(scope) {
  scope = isRecord(scope) ? scope : {};
  var projectRoot = path.resolve(String(scope.projectRoot || process.env.PROJECT_ROOT || ""));
  var profileId = deviceScopePart(scope.profileId, "profile id");
  var worldId = deviceScopePart(scope.worldId, "world id");
  var accountId = scope.accountId === undefined ? activeAccountId() : scope.accountId;
  if (accountId) accountId = deviceScopePart(accountId, "account id");
  var profiles = accountId
    ? path.join(projectRoot, "accounts", accountId, "profiles")
    : path.join(projectRoot, "profiles");
  var worldDir = path.join(profiles, profileId, "worlds", worldId);
  return { projectRoot: projectRoot, accountId: accountId || null, profileId: profileId, worldId: worldId, worldDir: worldDir, assetsDir: path.join(worldDir, "assets") };
}

function assertScopeDirectory(assetsDir) {
  var stat;
  try {
    stat = fs.lstatSync(assetsDir);
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
  // A true symlink is rejected, exactly like lib/ocr/local-ocr-runner.mjs.
  // NOTE: on Windows a directory *junction* is reported as a symlink by lstat
  // on some Node/Windows builds and as a plain directory on others, so the
  // rejection is build-dependent; either way the literal path stays the
  // containment root, which is what the traversal guard actually needs.
  if (stat.isSymbolicLink()) throw codedError("asset_symlink_rejected", "Assets directory is a symlink");
  if (!stat.isDirectory()) throw codedError("asset_scope_invalid", "Assets path is not a directory");
  return true;
}

function ensureAssetsDir(assetsDir) {
  if (assertScopeDirectory(assetsDir)) return assetsDir;
  fs.mkdirSync(assetsDir, { recursive: true });
  assertScopeDirectory(assetsDir);
  return assetsDir;
}

function validateAssetId(id) {
  if (typeof id !== "string" || !ASSET_ID_RE.test(id)) {
    throw codedError("asset_id_invalid", "Invalid asset id");
  }
  return id;
}

// Resolves one asset file and proves it stays inside the assets directory and
// is not reached through a symlink.
function resolveAssetFile(id, extension, scope) {
  validateAssetId(id);
  var resolved = resolveScope(scope);
  assertScopeDirectory(resolved.assetsDir);
  var target = path.join(resolved.assetsDir, id + "." + extension);
  if (!contained(resolved.assetsDir, target)) {
    throw codedError("asset_path_escape", "Asset path escapes the assets directory");
  }
  var stat = null;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
  if (stat && stat.isSymbolicLink()) throw codedError("asset_symlink_rejected", "Asset file is a symlink");
  return { path: target, stat: stat, scope: resolved };
}

function normalizeRef(ref) {
  if (!isRecord(ref)) throw codedError("asset_ref_missing", "textbook-figure requires a ref");
  // `textbookId` is the plan's name, `bookId` the canonical stored field: accept
  // either on input so both the frontend and the store speak one shape.
  var bookId = String(ref.bookId || ref.textbookId || "");
  if (!SCOPE_PART_RE.test(bookId)) throw codedError("asset_ref_invalid", "Invalid ref.bookId");
  var page = Number(ref.page);
  if (!Number.isInteger(page) || page < 1) throw codedError("asset_ref_invalid", "Invalid ref.page");
  var rect = ref.rect;
  if (!Array.isArray(rect) || rect.length !== 4) throw codedError("asset_ref_invalid", "Invalid ref.rect");
  var normalized = rect.map(Number);
  for (var i = 0; i < 4; i += 1) {
    if (!Number.isFinite(normalized[i]) || normalized[i] < 0 || normalized[i] > 1) {
      throw codedError("asset_ref_invalid", "ref.rect values must be normalized 0..1");
    }
  }
  if (normalized[2] <= normalized[0] || normalized[3] <= normalized[1]) {
    throw codedError("asset_ref_invalid", "ref.rect must have positive width and height");
  }
  return { bookId: bookId, page: page, rect: normalized };
}

function validatePng(pngBuffer) {
  if (!Buffer.isBuffer(pngBuffer) || !pngBuffer.length) throw codedError("asset_png_missing", "Missing PNG buffer");
  if (!isPng(pngBuffer)) throw codedError("asset_png_invalid", "Buffer is not a PNG");
  if (pngBuffer.length > MAX_PNG_BYTES) throw codedError("asset_png_too_large", "PNG exceeds 12 MB", 413);
  return pngBuffer;
}

function validateSvg(svgSource) {
  if (typeof svgSource !== "string" || !svgSource.trim()) throw codedError("asset_svg_missing", "Missing SVG source");
  var bytes = Buffer.byteLength(svgSource, "utf8");
  if (bytes > MAX_SVG_BYTES) throw codedError("asset_svg_too_large", "SVG exceeds 512 KB", 413);
  if (!/<svg[\s>]/i.test(svgSource)) throw codedError("asset_svg_invalid", "SVG source has no <svg> root");
  return svgSource;
}

function optionalId(value, fallback) {
  return typeof value === "string" && value ? validateAssetId(value) : fallback;
}

function optionalText(value, limit) {
  if (value === undefined || value === null) return null;
  var text = String(value);
  if (!text) return null;
  return limit && text.length > limit ? text.slice(0, limit) : text;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  var seen = Object.create(null);
  var out = [];
  tags.forEach(function (tag) {
    var text = typeof tag === "string" ? tag.trim() : "";
    if (!text || seen[text]) return;
    seen[text] = true;
    out.push(text.slice(0, 80));
  });
  return out.slice(0, 32);
}

function readSharp() {
  if (global.__SHARP__) return global.__SHARP__;
  try {
    return require("sharp");
  } catch (_) {
    return null;
  }
}

// A JPEG has no alpha channel and sharp composites the dropped alpha onto BLACK,
// which turned every transparent AI-drawn diagram (dark strokes meant for white
// paper) into a black card in the message view.  An SVG raster therefore gets an
// explicit white ground before it is encoded.
var THUMB_BACKGROUND = "#ffffff";
// Stamp written next to an SVG thumbnail once it is known to be white-composited;
// a thumbnail written before this fix has no stamp and is rebuilt on first read.
var SVG_THUMB_MARKER_SUFFIX = ".thumbw";

function svgThumbMarker(thumbPath) {
  return thumbPath.replace(/\.thumb\.jpg$/, SVG_THUMB_MARKER_SUFFIX);
}

function rasterizeSvg(sharp, svgBuffer) {
  return sharp(svgBuffer, { density: 144 })
    .resize(THUMB_EDGE_PX, THUMB_EDGE_PX, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: THUMB_BACKGROUND })
    .jpeg({ quality: 80 });
}

async function writeThumbnail(assetsDir, id, buffer, isSvg) {
  var sharp = readSharp();
  // sharp is optional: without it the frontend falls back to the full PNG and
  // CSS width limiting (see the plan's risk table).
  if (!sharp) return false;
  try {
    // An SVG has no intrinsic raster size, so let sharp rasterize it first; the
    // message view wants a small JPEG either way.
    var out = isSvg
      ? await rasterizeSvg(sharp, buffer).toBuffer()
      : await sharp(buffer)
        .resize(THUMB_EDGE_PX, THUMB_EDGE_PX, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
    fs.writeFileSync(path.join(assetsDir, id + ".thumb.jpg"), out, { flag: "wx" });
    if (isSvg) fs.writeFileSync(path.join(assetsDir, id + SVG_THUMB_MARKER_SUFFIX), "v1");
    return true;
  } catch (error) {
    console.warn("[assets] thumbnail failed for " + id + ": " + (error && error.message));
    return false;
  }
}

// Rewrites a pre-white-composite SVG thumbnail in the background.  sharp has no
// sync API in this build, so the read that notices a legacy thumbnail serves the
// vector instead (see readAssetFile) and this settles the JPEG a moment later.
var svgThumbRebuilds = Object.create(null);

function rebuildSvgThumbnail(svgPath, thumbPath) {
  if (svgThumbRebuilds[thumbPath]) return;
  var sharp = readSharp();
  if (!sharp) return;
  var source;
  try {
    source = fs.readFileSync(svgPath);
  } catch (_) {
    return;
  }
  svgThumbRebuilds[thumbPath] = true;
  rasterizeSvg(sharp, source).toBuffer()
    .then(function (out) {
      fs.writeFileSync(thumbPath, out);
      fs.writeFileSync(svgThumbMarker(thumbPath), "v1");
    })
    .catch(function (error) {
      // No stamp: the next read retries instead of serving black forever.
      console.warn("[assets] svg thumbnail rebuild failed for " + path.basename(thumbPath) + ": " + (error && error.message));
    })
    .then(function () { delete svgThumbRebuilds[thumbPath]; });
}

function indexPath(assetsDir) {
  return path.join(assetsDir, INDEX_FILE);
}

function migrateLegacy(record) {
  return sanitizeRecord(record);
}

// Keeps only known fields so a foreign/legacy line can never smuggle a path or
// a getter into the in-memory index.
function sanitizeRecord(input) {
  if (!isRecord(input)) return null;
  var id = input.id;
  if (typeof id !== "string" || !ASSET_ID_RE.test(id)) return null;
  var record = {
    id: id,
    kind: KINDS[input.kind] !== undefined ? input.kind : null,
    createdAt: Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : 0,
    conversationId: optionalText(input.conversationId, 160),
    messageId: optionalText(input.messageId, 160),
    noteId: optionalText(input.noteId, 160),
    ref: isRecord(input.ref) ? input.ref : null,
    svgTitle: optionalText(input.svgTitle, 300),
    caption: optionalText(input.caption, 2000),
    ocrText: optionalText(input.ocrText, 20000),
    ocrConfidence: Number.isFinite(Number(input.ocrConfidence)) ? Number(input.ocrConfidence) : null,
    prompt: optionalText(input.prompt, 4000),
    tags: normalizeTags(input.tags),
    width: Number.isFinite(Number(input.width)) ? Number(input.width) : null,
    height: Number.isFinite(Number(input.height)) ? Number(input.height) : null,
    bytes: Number.isFinite(Number(input.bytes)) ? Number(input.bytes) : null,
    sha256: typeof input.sha256 === "string" && /^[0-9a-f]{64}$/.test(input.sha256) ? input.sha256 : null,
  };
  if (input.deleted === true) record.deleted = true;
  if (input.thumb === true) record.thumb = true;
  if (input.recovered === true) record.recovered = true;
  return record;
}

function serializeLine(record) {
  return JSON.stringify(record) + "\n";
}

// Append + fsync.  A torn tail line is survivable (loadAll skips corrupt lines)
// but it silently hides the asset, so make the write durable before returning.
function appendRecord(record, scope) {
  var sanitized = sanitizeRecord(record);
  if (!sanitized) throw codedError("asset_record_invalid", "Record has no valid asset id");
  var resolved = resolveScope(scope);
  ensureAssetsDir(resolved.assetsDir);
  var file = indexPath(resolved.assetsDir);
  var handle = fs.openSync(file, "a");
  try {
    fs.writeSync(handle, serializeLine(sanitized), null, "utf8");
    try {
      fs.fsyncSync(handle);
    } catch (_) { /* some filesystems refuse to fsync; the append already landed */ }
  } finally {
    fs.closeSync(handle);
  }
  forgetScopeCache(sanitized.id);
  return sanitized;
}

// Same bytes, same kind (and same page/rect for a figure) already stored: reuse it
// instead of writing a second copy.  A re-captured page used to duplicate the file
// and the index row on every click.
function refKey(record) {
  var ref = record && record.ref;
  if (!isRecord(ref)) return "";
  return [ref.bookId || ref.textbookId || "", ref.page == null ? "" : ref.page,
    Array.isArray(ref.rect) ? ref.rect.join(",") : ""].join("|");
}

function findDuplicate(hash, kind, ref, resolved) {
  if (!hash) return null;
  var wanted = ref ? refKey({ ref: ref }) : "";
  var hit = null;
  listAssets({}, resolved).some(function (record) {
    if (record.sha256 !== hash || record.kind !== kind) return false;
    if (kind === "textbook-figure" && refKey(record) !== wanted) return false;
    hit = record;
    return true;
  });
  return hit;
}

function sha256Of(bufferOrText) {
  return crypto.createHash("sha256").update(bufferOrText).digest("hex");
}

// The figure a `book://<textbookId>/p<page>#rect` intent points at, if it was
// already rendered.  Callers use it to skip a page render entirely.
function findFigureByRef(ref, scope) {
  if (!isRecord(ref)) return null;
  var wanted = refKey({ ref: ref });
  var hit = null;
  listAssets({ kind: "textbook-figure" }, scope).some(function (record) {
    if (refKey(record) !== wanted) return false;
    hit = record;
    return true;
  });
  return hit;
}

// Audits the assets directory against the index.  `repair` re-inserts a record for
// a file whose index row was lost (torn append, manual copy) — without it such a
// file is unreachable forever, because reads go through the index only.
function reconcile(scope, options) {
  options = isRecord(options) ? options : {};
  var resolved = resolveScope(scope);
  var dir = resolved.assetsDir;
  var live = listAssets({}, resolved);
  var liveIds = {};
  live.forEach(function (record) { liveIds[record.id] = true; });
  var onDisk = [];
  try {
    onDisk = fs.readdirSync(dir);
  } catch (_) { /* no directory yet */ }
  var binaryFiles = onDisk.filter(function (name) { return /^ast_[0-9a-f]{16}\.(png|svg)$/.test(name); });
  var fileIds = {};
  binaryFiles.forEach(function (name) { fileIds[name.replace(/\.[a-z]+$/, "")] = name; });
  var report = {
    indexed: live.length,
    files: binaryFiles.length,
    // index says it exists, disk disagrees
    missingFiles: live.filter(function (record) { return !fileIds[record.id]; }).map(function (record) { return record.id; }),
    // disk says it exists, index disagrees (unreadable until repaired)
    orphans: Object.keys(fileIds).filter(function (id) { return !liveIds[id]; }),
    repaired: [],
  };
  if (!options.repair) return report;
  report.orphans.forEach(function (id) {
    var name = fileIds[id];
    var extension = name.slice(name.lastIndexOf(".") + 1);
    var size = null;
    try {
      size = fs.statSync(path.join(dir, name)).size;
    } catch (_) {}
    appendRecord({
      id: id,
      kind: extension === "svg" ? "svg" : "screenshot",
      createdAt: Date.now(),
      bytes: size,
      recovered: true,
    }, resolved);
    report.repaired.push(id);
  });
  return report;
}

function loadAll(scope) {
  var resolved = resolveScope(scope);
  assertScopeDirectory(resolved.assetsDir);
  var file = indexPath(resolved.assetsDir);
  var raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  var out = [];
  var lines = raw.split("\n");
  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i].trim();
    if (!line) continue;
    var parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      console.warn("[assets] skipping corrupt index line " + (i + 1) + ": " + (error && error.message));
      continue;
    }
    var record = sanitizeRecord(parsed);
    if (!record) {
      console.warn("[assets] skipping malformed index line " + (i + 1));
      continue;
    }
    out.push(record);
  }
  return out;
}

// Last write wins: a tombstone supersedes every earlier record for that id.
function latestById(records) {
  var byId = new Map();
  (records || []).forEach(function (record) {
    byId.set(record.id, record);
  });
  return byId;
}

function getAssetRecord(id, scope) {
  validateAssetId(id);
  var latest = latestById(loadAll(scope)).get(id);
  if (!latest || latest.deleted) return null;
  return migrateLegacy(latest);
}

function listAssets(filter, scope) {
  filter = isRecord(filter) ? filter : {};
  var out = [];
  latestById(loadAll(scope)).forEach(function (record) {
    if (record.deleted) return;
    if (filter.kind && record.kind !== filter.kind) return;
    if (filter.conversationId && record.conversationId !== filter.conversationId) return;
    if (filter.noteId && record.noteId !== filter.noteId) return;
    out.push(record);
  });
  out.sort(function (a, b) { return b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1); });
  return out;
}

function deleteAsset(id, scope) {
  validateAssetId(id);
  var existing = getAssetRecord(id, scope);
  if (!existing) throw codedError("asset_not_found", "Asset not found", 404);
  appendRecord({ id: id, deleted: true, createdAt: Date.now() }, scope);
  return true;
}

// Writes one binary asset + index row.  A `textbook-figure` takes the exact same
// path as a screenshot once the caller hands over a rendered `pngBuffer`; a call
// with no buffer keeps the P0 record-only shape (index row only, `file: null`).
// Async only because the optional sharp thumbnail pass is async.
async function createAsset(input) {
  input = isRecord(input) ? input : {};
  var kind = String(input.kind || "");
  if (KINDS[kind] === undefined) {
    throw codedError("asset_kind_invalid", "Unknown asset kind: " + kind);
  }
  var resolved = resolveScope(input.scope);
  ensureAssetsDir(resolved.assetsDir);

  var record = {
    id: optionalId(input.id, newAssetId()),
    kind: kind,
    createdAt: Date.now(),
    conversationId: optionalText(input.conversationId, 160),
    messageId: optionalText(input.messageId, 160),
    noteId: optionalText(input.noteId, 160),
    ref: null,
    svgTitle: optionalText(input.svgTitle, 300),
    caption: optionalText(input.caption, 2000),
    ocrText: optionalText(input.ocrText, 20000),
    ocrConfidence: Number.isFinite(Number(input.ocrConfidence)) ? Number(input.ocrConfidence) : null,
    prompt: optionalText(input.prompt, 4000),
    tags: normalizeTags(input.tags),
    width: null,
    height: null,
    bytes: null,
  };

  if (kind === "textbook-figure") {
    record.ref = normalizeRef(input.ref);
    // Legacy/P0 form: no rendered bytes, so the record stays file-less and the
    // reader keeps returning asset_file_missing for it.
    if (!input.pngBuffer) {
      if (input.width !== undefined) record.width = Number(input.width) || null;
      if (input.height !== undefined) record.height = Number(input.height) || null;
      appendRecord(record, resolved);
      return { assetId: record.id, record: migrateLegacy(record), file: null, scope: resolved };
    }
  }

  if (kind === "svg") {
    var svg = validateSvg(input.svgSource);
    var svgHash = input.dedupe === false ? null : sha256Of(svg);
    if (svgHash) {
      var svgDup = findDuplicate(svgHash, kind, null, resolved);
      if (svgDup) {
        return { assetId: svgDup.id, record: migrateLegacy(svgDup), file: resolveAssetFile(svgDup.id, "svg", resolved).path, scope: resolved, deduped: true };
      }
    }
    record.sha256 = svgHash;
    record.bytes = Buffer.byteLength(svg, "utf8");
    var size = parseSvgSize(svg);
    if (size) { record.width = size.width; record.height = size.height; }
    var svgFile = resolveAssetFile(record.id, "svg", resolved);
    fs.writeFileSync(svgFile.path, svg, { encoding: "utf8", flag: "wx" });
    record.thumb = await writeThumbnail(resolved.assetsDir, record.id, Buffer.from(svg, "utf8"), true);
    appendRecord(record, resolved);
    return { assetId: record.id, record: migrateLegacy(record), file: svgFile.path, scope: resolved };
  }

  var png = validatePng(input.pngBuffer);
  var pngHash = input.dedupe === false ? null : sha256Of(png);
  if (pngHash) {
    var pngDup = findDuplicate(pngHash, kind, record.ref, resolved);
    if (pngDup) {
      return { assetId: pngDup.id, record: migrateLegacy(pngDup), file: resolveAssetFile(pngDup.id, "png", resolved).path, scope: resolved, deduped: true };
    }
  }
  record.sha256 = pngHash;
  record.bytes = png.length;
  var pngSize = parsePngSize(png);
  if (pngSize) { record.width = pngSize.width; record.height = pngSize.height; }
  if (input.prompt) record.prompt = optionalText(input.prompt, 4000);
  var pngFile = resolveAssetFile(record.id, "png", resolved);
  fs.writeFileSync(pngFile.path, png, { flag: "wx" });
  record.thumb = await writeThumbnail(resolved.assetsDir, record.id, png);
  appendRecord(record, resolved);
  return { assetId: record.id, record: migrateLegacy(record), file: pngFile.path, scope: resolved };
}

// Reads a stored binary.  `variant` is "thumb" for the JPEG thumbnail.
function readAssetFile(id, variant, scope) {
  var record = getAssetRecord(id, scope);
  if (!record) {
    throw codedError("asset_file_missing", "Asset has no stored file", 404);
  }
  if (variant === "thumb") {
    var thumb = resolveAssetFile(id, "thumb.jpg", scope);
    if (thumb.stat && thumb.stat.isFile()) {
      // A thumbnail stored before the white-composite fix is a black card.  Serve
      // the vector on the read that kicks off its rebuild so black is never shown;
      // the stamp file makes the check free from then on.
      if (record.kind === "svg" && !fs.existsSync(svgThumbMarker(thumb.path))) {
        var vector = resolveAssetFile(id, "svg", scope);
        if (vector.stat && vector.stat.isFile()) {
          rebuildSvgThumbnail(vector.path, thumb.path);
          return { path: vector.path, contentType: "image/svg+xml", record: record };
        }
      }
      return { path: thumb.path, contentType: "image/jpeg", record: record };
    }
    // An SVG is vector + tiny: serving the source itself is a better "thumbnail"
    // than a 404, and it keeps working when sharp is unavailable.
    if (record.kind !== "svg") variant = null;
  }
  var extension = record.kind === "svg" ? "svg" : "png";
  var file = resolveAssetFile(id, extension, scope);
  if (!file.stat || !file.stat.isFile()) throw codedError("asset_file_missing", "Asset file is missing", 404);
  return { path: file.path, contentType: extension === "svg" ? "image/svg+xml" : "image/png", record: record };
}

// Resolves an asset id to its owning world when the caller does not know the
// scope.  `asset://<id>` is meant to behave like a hyperlink, so an anchor
// copied into a note keeps working without carrying profile/world query noise.
// Only used as a fallback: it scans the account's profiles/worlds.
var scopeCache = new Map();

function clearScopeCache() {
  scopeCache.clear();
}

function forgetScopeCache(id) {
  if (!scopeCache.size || typeof id !== "string") return;
  var suffix = "|" + id;
  Array.from(scopeCache.keys()).forEach(function (key) {
    if (key.slice(-suffix.length) === suffix) scopeCache.delete(key);
  });
}

function listDirectories(parent) {
  var entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter(function (entry) {
    return entry.isDirectory() && SCOPE_PART_RE.test(entry.name);
  }).map(function (entry) { return entry.name; });
}

function findAssetScope(id, options) {
  validateAssetId(id);
  options = isRecord(options) ? options : {};
  var projectRoot = path.resolve(String(options.projectRoot || process.env.PROJECT_ROOT || ""));
  var accountId = options.accountId === undefined ? activeAccountId() : options.accountId;
  if (accountId) accountId = deviceScopePart(accountId, "account id");
  var profilesRoot = accountId
    ? path.join(projectRoot, "accounts", accountId, "profiles")
    : path.join(projectRoot, "profiles");
  var key = profilesRoot + "|" + id;
  if (scopeCache.has(key)) return scopeCache.get(key);

  var found = null;
  var profiles = listDirectories(profilesRoot);
  for (var i = 0; i < profiles.length && !found; i += 1) {
    var worldsRoot = path.join(profilesRoot, profiles[i], "worlds");
    var worlds = listDirectories(worldsRoot);
    for (var w = 0; w < worlds.length && !found; w += 1) {
      var candidate = { projectRoot: projectRoot, accountId: accountId, profileId: profiles[i], worldId: worlds[w] };
      try {
        if (getAssetRecord(id, candidate)) found = candidate;
      } catch (_) {
        // An unreadable/odd world must not abort the scan.
      }
    }
  }
  scopeCache.set(key, found);
  return found;
}

module.exports = {
  INDEX_FILE: INDEX_FILE,
  ASSET_ID_RE: ASSET_ID_RE,
  KINDS: KINDS,
  MAX_PNG_BYTES: MAX_PNG_BYTES,
  MAX_SVG_BYTES: MAX_SVG_BYTES,
  THUMB_EDGE_PX: THUMB_EDGE_PX,
  codedError: codedError,
  contained: contained,
  newAssetId: newAssetId,
  parsePngSize: parsePngSize,
  parseSvgSize: parseSvgSize,
  resolveScope: resolveScope,
  resolveAssetFile: resolveAssetFile,
  indexPath: indexPath,
  sanitizeRecord: sanitizeRecord,
  latestById: latestById,
  createAsset: createAsset,
  appendRecord: appendRecord,
  loadAll: loadAll,
  getAssetRecord: getAssetRecord,
  listAssets: listAssets,
  deleteAsset: deleteAsset,
  readAssetFile: readAssetFile,
  reconcile: reconcile,
  sha256Of: sha256Of,
  findFigureByRef: findFigureByRef,
  findAssetScope: findAssetScope,
  clearScopeCache: clearScopeCache,
};
