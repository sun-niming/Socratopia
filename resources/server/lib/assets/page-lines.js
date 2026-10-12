// page-lines.js — the OCR line boxes for one textbook page, straight from the on-disk cache.
//
// The coordinator owns the cache but a crop happens on the conversation write path, where the
// coordinator isn't instantiated.  The cache nests several hashed levels under
// <projectRoot>/.system/ocr-cache-v1, so walk it and trust the entry's own pdfHash.
"use strict";

var path = require("path");
var memo = new Map();

function projectRoot() {
  if (process.env.SOCRATOPIA_PROJECT_ROOT) return process.env.SOCRATOPIA_PROJECT_ROOT;
  var appData = process.env.APPDATA || process.env.HOME || "";
  return path.join(appData, "socratopia", "project-data");
}

async function digest(pdfPath, deps, fsImpl) {
  if (deps && typeof deps.digestFile === "function") return deps.digestFile(pdfPath);
  var coordinator = require("../pdf-ocr-coordinator.js");
  var key = pdfPath;
  try {
    var stat = fsImpl.statSync(pdfPath);
    key = pdfPath + "|" + stat.size + "|" + stat.mtimeMs;
  } catch (_) { /* fall back to the bare path */ }
  if (memo.has(key)) return memo.get(key);
  var value = await coordinator.digestFile(pdfPath);
  memo.set(key, value);
  while (memo.size > 8) memo.delete(memo.keys().next().value);
  return value;
}

function collect(dir, page, depth, out, fsImpl) {
  if (depth > 6) return;
  var entries;
  try { entries = fsImpl.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (var i = 0; i < entries.length; i += 1) {
    var entry = entries[i];
    var full = path.join(dir, entry.name);
    if (entry.isDirectory()) { collect(full, page, depth + 1, out, fsImpl); continue; }
    if (entry.name !== String(page) + ".json") continue;
    var parsed = null;
    try { parsed = JSON.parse(fsImpl.readFileSync(full, "utf8")); } catch (_) { continue; }
    if (parsed) out.push(parsed);
  }
}

// Returns { lines, page, text } or null.  Never throws.
async function pageLines(input, deps) {
  input = input || {};
  deps = deps || {};
  var fsImpl = deps.fs || require("fs");
  var pdfPath = input.pdfPath;
  var page = Number(input.page);
  if (!pdfPath || !Number.isInteger(page) || page < 1) return null;
  var pdfHash = input.pdfHash || (await digest(pdfPath, deps, fsImpl));
  if (!pdfHash) return null;

  var root = path.join(deps.projectRoot || projectRoot(), ".system", "ocr-cache-v1");
  var found = [];
  collect(root, page, 0, found, fsImpl);
  var best = null;
  for (var i = 0; i < found.length; i += 1) {
    var entry = found[i];
    if (entry.pdfHash && entry.pdfHash !== pdfHash) continue;
    if (!Array.isArray(entry.lines) || !entry.lines.length) continue;
    var at = Number(entry.createdAt) || 0;
    if (!best || at > best.at) best = { at: at, entry: entry };
  }
  if (!best) return null;
  var lines = best.entry.lines
    .filter(function (line) { return line && Array.isArray(line.box) && line.box.length === 4 && line.box.every(Number.isFinite); })
    .map(function (line) { return { text: String(line.text || ""), box: line.box.map(Number) }; });
  if (!lines.length) return null;
  return { lines: lines, page: page, text: best.entry.text || "" };
}

function resetMemo() { memo.clear(); }

// Every caption-looking OCR line in the book, so a mention can be mapped to a page.
var captionMemo = new Map();

async function allCaptions(input, deps) {
  input = input || {};
  deps = deps || {};
  var fsImpl = deps.fs || require("fs");
  var pdfPath = input.pdfPath;
  if (!pdfPath) return [];
  var pdfHash = input.pdfHash || (await digest(pdfPath, deps, fsImpl));
  if (!pdfHash) return [];
  if (captionMemo.has(pdfHash)) return captionMemo.get(pdfHash);
  var root = path.join(deps.projectRoot || projectRoot(), ".system", "ocr-cache-v1");
  var entries = [];
  collectAll(root, 0, entries, fsImpl);
  var figureBox = require("./figure-box.js");
  var out = [];
  for (var i = 0; i < entries.length; i += 1) {
    var entry = entries[i];
    if (entry.pdfHash && entry.pdfHash !== pdfHash) continue;
    if (!Array.isArray(entry.lines)) continue;
    for (var j = 0; j < entry.lines.length; j += 1) {
      var line = entry.lines[j];
      if (!line || !Array.isArray(line.box)) continue;
      var label = figureBox.captionLabel(line);
      if (!label) continue;
      out.push({ label: label, page: Number(entry.page), text: String(line.text || "").trim(), y: Number(line.box[1]) });
    }
  }
  out.sort(function (a, b) { return a.page - b.page || a.y - b.y; });
  captionMemo.set(pdfHash, out);
  while (captionMemo.size > 6) captionMemo.delete(captionMemo.keys().next().value);
  return out;
}

function collectAll(dir, depth, out, fsImpl) {
  if (depth > 6) return;
  var entries;
  try { entries = fsImpl.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (var i = 0; i < entries.length; i += 1) {
    var entry = entries[i];
    var full = path.join(dir, entry.name);
    if (entry.isDirectory()) { collectAll(full, depth + 1, out, fsImpl); continue; }
    if (!entry.name.endsWith(".json")) continue;
    try { var parsed = JSON.parse(fsImpl.readFileSync(full, "utf8")); if (parsed) out.push(parsed); } catch (_) {}
  }
}

module.exports = { pageLines: pageLines, allCaptions: allCaptions, projectRoot: projectRoot, resetMemo: function () { memo.clear(); captionMemo.clear(); } };
