// chat-trash.js — deleting a conversation moves its file into the world's trash
// instead of unlinking it.
//
// Why: the sidebar's delete is a single small button with no confirmation and no
// toast, and the conversation file is the only place a chat's messages live.  A move
// is just as cheap as an unlink, so an accidental click stays recoverable:
//
//   <PROJECT_ROOT>/accounts/<accountId>/profiles/<pid>/worlds/<wid>/chats/<id>.json
//     -> .../chats/.trash/<id>.json
//
// The directory is named `.trash` and holds `.json` files only, so the list helper
// used by the conversations/search/stats routes (readdir + endsWith(".json")) skips
// it and the sidebar never shows a phantom conversation.
//
// Everything here is best-effort: `trash` never throws, and when the module cannot
// resolve the world directory the caller falls back to the old unlink.
"use strict";

var fs = require("fs");
var path = require("path");
var store = require("./assets/store.js");

var TRASH_DIRNAME = ".trash";
var MAX_TRASH_ENTRIES = 200;

function chatsDir(scope) {
  return path.join(store.resolveScope(scope).worldDir, "chats");
}

function trashDir(scope) {
  return path.join(chatsDir(scope), TRASH_DIRNAME);
}

function chatFile(scope, id) {
  return path.join(chatsDir(scope), String(id) + ".json");
}

function trashFile(scope, id) {
  return path.join(trashDir(scope), String(id) + ".json");
}

// Keep the trash bounded: drop the oldest entries beyond MAX_TRASH_ENTRIES.
function pruneTrash(dir) {
  var entries;
  try {
    entries = fs.readdirSync(dir)
      .filter(function (name) { return name.slice(-5) === ".json"; })
      .map(function (name) {
        var stat;
        try { stat = fs.statSync(path.join(dir, name)); } catch (_) { return null; }
        return { name: name, mtime: stat.mtimeMs };
      })
      .filter(Boolean);
  } catch (_) {
    return 0;
  }
  if (entries.length <= MAX_TRASH_ENTRIES) return 0;
  entries.sort(function (a, b) { return a.mtime - b.mtime; });
  var removed = 0;
  entries.slice(0, entries.length - MAX_TRASH_ENTRIES).forEach(function (entry) {
    try { fs.unlinkSync(path.join(dir, entry.name)); removed += 1; } catch (_) {}
  });
  if (removed) console.log("[chat-trash] pruned " + removed + " old entries");
  return removed;
}

// Move `chats/<id>.json` into `chats/.trash/<id>.json`.
// Accepts either trash(scope, id) or trash({profileId, worldId, id}) — the route
// calls the latter, the tests the former, and both must mean the same thing.
// Returns {trashed:true, path, pruned} or {trashed:false, reason} — never throws.
function trash(scope, id) {
  if (id === undefined && scope && typeof scope === "object") id = scope.id;
  if (!id) return { trashed: false, reason: "no_id" };
  var from;
  try {
    from = chatFile(scope, id);
  } catch (error) {
    return { trashed: false, reason: (error && error.message) || "scope" };
  }
  var stat;
  try { stat = fs.statSync(from); } catch (_) { return { trashed: false, reason: "missing" }; }
  if (!stat.isFile()) return { trashed: false, reason: "not_a_file" };
  try {
    var dir = trashDir(scope);
    fs.mkdirSync(dir, { recursive: true });
    var to = trashFile(scope, id);
    // A restored copy may already sit there; the newest delete wins.
    try { if (fs.existsSync(to)) fs.unlinkSync(to); } catch (_) {}
    fs.renameSync(from, to);
    return { trashed: true, path: to, bytes: stat.size, pruned: pruneTrash(dir) };
  } catch (error) {
    // Cross-device or permission trouble: behave exactly like the old code.
    try {
      fs.unlinkSync(from);
      return { trashed: false, reason: "unlinked_after:" + ((error && error.code) || "error") };
    } catch (_) {
      return { trashed: false, reason: (error && error.code) || "error" };
    }
  }
}

// Inspect the trash (newest first).  Used by tests and for manual recovery.
function listTrash(scope, limit) {
  var dir;
  try { dir = trashDir(scope); } catch (_) { return []; }
  var names;
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  var out = names.filter(function (name) { return name.slice(-5) === ".json"; }).map(function (name) {
    var stat;
    try { stat = fs.statSync(path.join(dir, name)); } catch (_) { return null; }
    if (!stat.isFile()) return null;
    return { id: name.slice(0, -5), bytes: stat.size, deletedAt: new Date(stat.mtimeMs).toISOString() };
  }).filter(Boolean);
  out.sort(function (a, b) { return a.deletedAt < b.deletedAt ? 1 : -1; });
  return typeof limit === "number" && limit > 0 ? out.slice(0, limit) : out;
}

// Put a trashed conversation back.  Refuses when the id is taken again, because the
// app addresses the file by the conversation id stored inside it.
function restore(scope, id) {
  if (id === undefined && scope && typeof scope === "object") id = scope.id;
  if (!id) return { restored: false, reason: "no_id" };
  var from = trashFile(scope, id);
  var to = chatFile(scope, id);
  if (!fs.existsSync(from)) return { restored: false, reason: "not_in_trash" };
  if (fs.existsSync(to)) return { restored: false, reason: "id_taken" };
  try {
    fs.renameSync(from, to);
    return { restored: true, path: to };
  } catch (error) {
    return { restored: false, reason: (error && error.code) || "error" };
  }
}

module.exports = {
  TRASH_DIRNAME: TRASH_DIRNAME,
  MAX_TRASH_ENTRIES: MAX_TRASH_ENTRIES,
  chatsDir: chatsDir,
  trashDir: trashDir,
  chatFile: chatFile,
  trashFile: trashFile,
  trash: trash,
  restore: restore,
  listTrash: listTrash,
};
