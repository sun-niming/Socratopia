"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var STATE_FILE = "progress_state.json";
var SCHEMA_VERSION = 2;

function statePath(textbookDir) {
  return path.join(String(textbookDir || ""), STATE_FILE);
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    var obj = JSON.parse(fs.readFileSync(file, "utf-8"));
    return obj && typeof obj === "object" ? obj : null;
  } catch (e) {
    return null;
  }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function readCursor(textbookDir) {
  return readJson(statePath(textbookDir));
}

function clone(obj) {
  var out = {};
  if (obj && typeof obj === "object") {
    Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
  }
  return out;
}

function normalizePage(n, fallback) {
  n = Number(n);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function chunkIdForPage(page) {
  page = normalizePage(page, 1);
  return "md-" + String(page).padStart(4, "0");
}

function cursorFromMeta(meta, extra) {
  meta = meta || {};
  var startPage = normalizePage(meta.startPage, null);
  var endPage = normalizePage(meta.endPage, startPage);
  if (!startPage) return null;
  var cursor = {
    chunkId: meta.chunkId || chunkIdForPage(startPage),
    ordinal: normalizePage(meta.ordinal, startPage),
    startPage: startPage,
    endPage: endPage || startPage,
    updatedAt: new Date().toISOString(),
  };
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach(function (k) {
      if (extra[k] !== undefined) cursor[k] = extra[k];
    });
  }
  return cursor;
}

function mirrorLegacyPageFields(state) {
  state = state || {};
  var taught = state.taughtCursor;
  if (taught && taught.startPage > 0) {
    var page = taught.endPage || taught.startPage;
    state.lastTaughtPage = page;
    state.currentPage = page;
  }
  return state;
}

function writeCursor(textbookDir, partial) {
  try {
    if (!textbookDir) return null;
    var prev = readCursor(textbookDir) || {};
    var next = clone(prev);
    partial = partial && typeof partial === "object" ? partial : {};
    Object.keys(partial).forEach(function (k) {
      var v = partial[k];
      if (v === undefined) return;
      if (k === "loadedCursor" && next.taughtCursor && v && v.chunkId === next.taughtCursor.chunkId) {
        next.loadedCursor = v;
        return;
      }
      next[k] = v;
    });
    next.schemaVersion = Math.max(Number(next.schemaVersion) || 0, SCHEMA_VERSION);
    next.updatedAt = new Date().toISOString();
    mirrorLegacyPageFields(next);
    writeJsonAtomic(statePath(textbookDir), next);
    return next;
  } catch (e) {
    return null;
  }
}

function updateLoadedCursor(textbookDir, meta, extra) {
  var cursor = cursorFromMeta(meta, extra);
  if (!cursor) return null;
  return writeCursor(textbookDir, { loadedCursor: cursor });
}

function parseProgressMarker(text) {
  if (!text || typeof text !== "string") return null;
  var re = /<!--\s*mdProgress:\s*([^>]*)-->/ig;
  var m;
  var last = null;
  while ((m = re.exec(text)) !== null) last = m[1] || "";
  if (last == null) return null;
  var out = {};
  last.replace(/([a-zA-Z][\w-]*)=("[^"]*"|'[^']*'|[^\s]+)/g, function (_, key, value) {
    value = String(value || "").replace(/^["']|["']$/g, "");
    out[key] = value;
    return "";
  });
  if (!out.chunk) return null;
  var coverage = Number(out.coverage);
  return {
    chunk: out.chunk,
    status: /^(teaching|checking|complete|offtrack)$/.test(out.status || "") ? out.status : "teaching",
    coverage: Number.isFinite(coverage) ? Math.max(0, Math.min(1, coverage)) : 0,
    ready: String(out.ready).toLowerCase() === "true",
  };
}

function stripProgressMarker(text) {
  return typeof text === "string" ? text.replace(/\n?<!--\s*mdProgress:\s*[^>]*-->\s*/ig, "") : text;
}

function parseReadingMeta(text) {
  if (!text || typeof text !== "string") return null;
  var m = text.match(/^<!--\s*startPage:\s*(\d+)\s+endPage:\s*(\d+)([^>]*)-->/);
  if (!m) {
    var old = text.match(/^<!--\s*endPage:\s*(\d+)\s*-->/);
    return old ? { startPage: 1, endPage: parseInt(old[1], 10) } : null;
  }
  var extra = m[3] || "";
  function pick(name) {
    var r = new RegExp("\\b" + name + "\\s*:\\s*([^\\s>]+)");
    var mm = extra.match(r);
    return mm ? mm[1] : null;
  }
  var startPage = parseInt(m[1], 10);
  var endPage = parseInt(m[2], 10);
  var ordinal = pick("ordinal");
  return {
    startPage: startPage,
    endPage: endPage,
    chunkId: pick("chunkId") || chunkIdForPage(startPage),
    ordinal: ordinal ? parseInt(ordinal, 10) : startPage,
    loadedOnly: String(pick("loadedOnly")).toLowerCase() === "true",
  };
}

function isReadyMarker(marker) {
  return !!marker && (marker.ready === true || marker.status === "complete");
}

function markerMatchesReading(marker, readingMeta) {
  if (!marker || !readingMeta) return false;
  var chunkId = readingMeta.chunkId || chunkIdForPage(readingMeta.startPage);
  return marker.chunk === chunkId || marker.chunk === String(chunkId);
}

function updateMarkerState(textbookDir, marker, readingMeta) {
  if (!marker || !readingMeta) return null;
  var current = cursorFromMeta(readingMeta, {
    status: marker.status,
    coverage: marker.coverage,
    ready: marker.ready,
  });
  if (!current) return null;
  return writeCursor(textbookDir, { activeMarker: marker, activeCursor: current });
}

function commitTaughtChunk(textbookDir, marker, readingMeta, opts) {
  if (!isReadyMarker(marker) || !markerMatchesReading(marker, readingMeta)) return null;
  var taught = cursorFromMeta(readingMeta, {
    status: "complete",
    coverage: Math.max(1, marker.coverage || 0),
    ready: true,
    committedAt: new Date().toISOString(),
    reason: opts && opts.reason || "markdown_commit",
  });
  if (!taught) return null;
  return writeCursor(textbookDir, {
    taughtCursor: taught,
    lastCommittedChunkId: taught.chunkId,
  });
}

function stateHash(state) {
  try {
    if (!state) return "";
    var taught = state.taughtCursor || {};
    var loaded = state.loadedCursor || {};
    var key = [
      taught.chunkId || "",
      taught.startPage || "",
      taught.status || "",
      loaded.chunkId || "",
      state.lastCommittedChunkId || "",
    ].join("|");
    if (!key.replace(/\|/g, "")) return "";
    return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
  } catch (e) {
    return "";
  }
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  STATE_FILE: STATE_FILE,
  statePath: statePath,
  readCursor: readCursor,
  writeCursor: writeCursor,
  updateLoadedCursor: updateLoadedCursor,
  chunkIdForPage: chunkIdForPage,
  cursorFromMeta: cursorFromMeta,
  parseProgressMarker: parseProgressMarker,
  stripProgressMarker: stripProgressMarker,
  parseReadingMeta: parseReadingMeta,
  isReadyMarker: isReadyMarker,
  markerMatchesReading: markerMatchesReading,
  updateMarkerState: updateMarkerState,
  commitTaughtChunk: commitTaughtChunk,
  mirrorLegacyPageFields: mirrorLegacyPageFields,
  stateHash: stateHash,
};
