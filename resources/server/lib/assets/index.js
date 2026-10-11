// index.js — per-world in-memory projection of assets/index.jsonl.
//
// The store owns the file; this module owns the read side: one cached array per
// assets directory, refreshed only when the file's mtime/size moves (or when a
// caller explicitly invalidates after a write).  A single world holds on the
// order of a thousand images, so a linear JSONL scan is cheaper than a database.
"use strict";

var fs = require("fs");

var store = require("./store.js");

var cache = new Map();

function statsOf(file) {
  try {
    var stat = fs.statSync(file);
    return stat.size + ":" + stat.mtimeMs;
  } catch (error) {
    if (error && error.code === "ENOENT") return "missing";
    throw error;
  }
}

function build(resolved) {
  var file = store.indexPath(resolved.assetsDir);
  var signature = statsOf(file);
  var cached = cache.get(resolved.assetsDir);
  if (cached && cached.signature === signature) return cached;
  var records = store.loadAll(resolved);
  var byId = new Map();
  records.forEach(function (record) { byId.set(record.id, record); });
  var entry = {
    signature: signature,
    assetsDir: resolved.assetsDir,
    byId: byId,
    live: Array.from(byId.values()).filter(function (record) { return !record.deleted; }),
    loadedAt: Date.now(),
  };
  entry.live.sort(function (a, b) { return b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1); });
  cache.set(resolved.assetsDir, entry);
  return entry;
}

function entryFor(scope) {
  return build(store.resolveScope(scope));
}

function invalidate(scope) {
  if (scope === undefined) {
    cache.clear();
    return true;
  }
  return cache.delete(store.resolveScope(scope).assetsDir);
}

function get(id, scope) {
  if (typeof id !== "string" || !store.ASSET_ID_RE.test(id)) {
    throw store.codedError("asset_id_invalid", "Invalid asset id");
  }
  var record = entryFor(scope).byId.get(id);
  return record && !record.deleted ? record : null;
}

function list(filter, scope) {
  filter = filter && typeof filter === "object" ? filter : {};
  var live = entryFor(scope).live;
  var kind = filter.kind || null;
  var conversationId = filter.conversationId || null;
  var noteId = filter.noteId || null;
  var tags = Array.isArray(filter.tags) ? filter.tags : null;
  var limit = Number.isFinite(Number(filter.limit)) && Number(filter.limit) > 0 ? Number(filter.limit) : 0;
  var out = [];
  for (var i = 0; i < live.length; i += 1) {
    var record = live[i];
    if (kind && record.kind !== kind) continue;
    if (conversationId && record.conversationId !== conversationId) continue;
    if (noteId && record.noteId !== noteId) continue;
    if (tags && !tags.every(function (tag) { return record.tags.indexOf(tag) !== -1; })) continue;
    out.push(record);
    if (limit && out.length >= limit) break;
  }
  return out;
}

// Free-text match over the text-ish fields.  `q` is matched case-insensitively
// as a substring; no tokenizer, no ranking beyond newest-first order.
function search(query, scope) {
  var needle = String(query || "").trim().toLowerCase();
  if (!needle) return list({}, scope);
  return entryFor(scope).live.filter(function (record) {
    var haystack = [record.caption, record.ocrText, record.svgTitle, record.prompt, record.tags.join(" ")].join("\n").toLowerCase();
    return haystack.indexOf(needle) !== -1;
  });
}

function stats(scope) {
  var entry = entryFor(scope);
  var byKind = Object.create(null);
  entry.live.forEach(function (record) {
    byKind[record.kind || "unknown"] = (byKind[record.kind || "unknown"] || 0) + 1;
  });
  return { assetsDir: entry.assetsDir, total: entry.byId.size, live: entry.live.length, byKind: byKind };
}

// Convenience for writers: append a row through the store and drop the cache in
// one step so the next read cannot serve a stale projection.
function append(record, scope) {
  var saved = store.appendRecord(record, scope);
  invalidate(scope);
  return saved;
}

module.exports = {
  invalidate: invalidate,
  get: get,
  list: list,
  search: search,
  stats: stats,
  append: append,
  cacheSize: function () { return cache.size; },
};
