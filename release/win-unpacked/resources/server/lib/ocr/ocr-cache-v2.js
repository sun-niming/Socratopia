"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var MAX_TEXT_BYTES = 256 * 1024;
var MAX_JSON_BYTES = 512 * 1024;
var DEFAULT_TEXTBOOK_BYTES = 64 * 1024 * 1024;
var DEFAULT_PROFILE_BYTES = 256 * 1024 * 1024;
var DEFAULT_GLOBAL_BYTES = 1024 * 1024 * 1024;
var DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
var MIN_FREE_BYTES = 64 * 1024 * 1024;
var MAX_INDEX_FILES = 20000;

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function inside(root, candidate) {
  var relative = path.relative(root, candidate);
  return relative === "" || !!relative && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

function cacheError(code) {
  var error = new Error(code);
  error.code = code;
  return error;
}

function ensureNoReparse(root, target) {
  if (!inside(root, target)) throw cacheError("ocr_cache_path_invalid");
  var current = root;
  var relative = path.relative(root, target);
  for (var part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    var stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw cacheError("ocr_cache_reparse_rejected");
  }
}

function createCache(options) {
  options = options || {};
  var root = path.resolve(options.root || path.join(process.cwd(), ".socratopia-private", "ocr-cache-v2"));
  var limits = {
    textbook: Math.max(MAX_JSON_BYTES, Number(options.maxTextbookBytes) || DEFAULT_TEXTBOOK_BYTES),
    profile: Math.max(MAX_JSON_BYTES, Number(options.maxProfileBytes) || DEFAULT_PROFILE_BYTES),
    global: Math.max(MAX_JSON_BYTES, Number(options.maxGlobalBytes) || DEFAULT_GLOBAL_BYTES),
  };
  var ttlMs = Math.max(60000, Number(options.ttlMs) || DEFAULT_TTL_MS);
  var beforeCommit = typeof options.beforeCommit === "function" ? options.beforeCommit : async function () {};
  var maintenance = Promise.resolve();

  function rootsFor(key) {
    var accountHash = hash(key.accountId);
    var profileHash = hash([key.accountId, key.profileId].join("\u001f"));
    var textbookHash = hash([key.accountId, key.profileId, key.worldId, key.textbookId].join("\u001f"));
    var accountRoot = path.join(root, accountHash.slice(0, 2), accountHash);
    var profileRoot = path.join(accountRoot, profileHash);
    return { account: accountRoot, profile: profileRoot, textbook: path.join(profileRoot, textbookHash) };
  }

  function entryPath(key) {
    var roots = rootsFor(key);
    var engineHash = hash([key.schema, key.language, key.dpi, key.qualityVersion, key.engineMarker].join("\u001f"));
    return path.join(roots.textbook, key.pdfHash, engineHash, String(key.page) + ".json");
  }

  async function listFiles(scanRoot) {
    var files = [];
    if (!inside(root, scanRoot) || !fs.existsSync(scanRoot)) return files;
    var pending = [scanRoot];
    while (pending.length) {
      var directory = pending.pop();
      ensureNoReparse(root, directory);
      var entries = await fs.promises.readdir(directory, { withFileTypes: true });
      for (var i = 0; i < entries.length; i++) {
        if (files.length >= MAX_INDEX_FILES) throw cacheError("ocr_cache_index_limit");
        var candidate = path.join(directory, entries[i].name);
        if (!inside(root, candidate) || entries[i].isSymbolicLink()) continue;
        if (entries[i].isDirectory()) pending.push(candidate);
        else if (entries[i].isFile() && /\.json$/i.test(entries[i].name)) {
          var stat = await fs.promises.lstat(candidate);
          if (!stat.isSymbolicLink() && stat.isFile()) files.push({ path: candidate, size: stat.size, time: Math.max(stat.atimeMs || 0, stat.mtimeMs || 0) });
        }
      }
    }
    return files;
  }

  async function unlinkExact(file) {
    if (!inside(root, file)) throw cacheError("ocr_cache_path_invalid");
    ensureNoReparse(root, path.dirname(file));
    var stat;
    try { stat = await fs.promises.lstat(file); } catch (error) { if (error && error.code === "ENOENT") return; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw cacheError("ocr_cache_reparse_rejected");
    await fs.promises.unlink(file);
  }

  async function removeExpired() {
    var cutoff = Date.now() - ttlMs;
    var files = await listFiles(root);
    for (var i = 0; i < files.length; i++) if (files[i].time < cutoff) await unlinkExact(files[i].path);
  }

  async function availableBytes() {
    if (typeof fs.promises.statfs !== "function") return Infinity;
    var stat = await fs.promises.statfs(root);
    return Number(stat.bavail) * Number(stat.bsize);
  }

  async function enforceLimit(scanRoot, maximum, delta, protectedFile) {
    var files = await listFiles(scanRoot);
    var total = files.reduce(function (sum, item) { return sum + item.size; }, 0);
    var candidates = files.filter(function (item) { return path.resolve(item.path) !== path.resolve(protectedFile); }).sort(function (a, b) { return a.time - b.time; });
    for (var i = 0; total + delta > maximum && i < candidates.length; i++) {
      await unlinkExact(candidates[i].path);
      total -= candidates[i].size;
    }
    if (total + delta > maximum) throw cacheError("ocr_cache_quota_exceeded");
  }

  async function initialize() {
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
    var stat = await fs.promises.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw cacheError("ocr_cache_root_invalid");
    maintenance = maintenance.then(removeExpired);
    await maintenance;
    return { ok: true, root: root };
  }

  async function read(key) {
    var file = entryPath(key);
    ensureNoReparse(root, path.dirname(file));
    try {
      var stat = await fs.promises.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES) return null;
      if (Math.max(stat.atimeMs || 0, stat.mtimeMs || 0) < Date.now() - ttlMs) {
        maintenance = maintenance.then(function () { return unlinkExact(file); }).catch(function () {});
        return null;
      }
      var raw = await fs.promises.readFile(file, "utf8");
      var value = JSON.parse(raw);
      if (!value || value.schema !== key.schema || value.pdfHash !== key.pdfHash || value.page !== key.page) return null;
      if (Buffer.byteLength(String(value.text || ""), "utf8") > MAX_TEXT_BYTES) return null;
      fs.promises.utimes(file, new Date(), new Date(stat.mtimeMs)).catch(function () {});
      return value;
    } catch (_) { return null; }
  }

  async function write(key, value, writeOptions) {
    var guard = writeOptions && typeof writeOptions.guard === "function" ? writeOptions.guard : function () {};
    guard();
    var text = String(value && value.text || "");
    if (!text || Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) throw cacheError("ocr_cache_entry_too_large");
    var file = entryPath(key);
    var dir = path.dirname(file);
    var roots = rootsFor(key);
    var record = {
      schema: key.schema,
      pdfHash: key.pdfHash,
      page: key.page,
      text: text,
      source: value && value.source === "vision-transcription" ? "vision-transcription" : value && value.source === "rapidocr-v5" ? "rapidocr-v5" : "windows-ocr",
      language: value.language || key.language,
      quality: value.quality || null,
      confidence: Number.isFinite(Number(value && value.confidence)) ? Math.max(0, Math.min(1, Number(value.confidence))) : null,
      createdAt: new Date().toISOString(),
    };
    var payload = JSON.stringify(record);
    var payloadBytes = Buffer.byteLength(payload, "utf8");
    if (payloadBytes > MAX_JSON_BYTES) throw cacheError("ocr_cache_entry_too_large");
    maintenance = maintenance.catch(function () {}).then(async function () {
      guard();
      await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
      ensureNoReparse(root, dir);
      if (await availableBytes() < payloadBytes + MIN_FREE_BYTES) throw cacheError("ocr_cache_disk_low");
      var oldSize = 0;
      try { oldSize = (await fs.promises.lstat(file)).size; } catch (_) {}
      var delta = Math.max(0, payloadBytes - oldSize);
      await enforceLimit(roots.textbook, limits.textbook, delta, file);
      await enforceLimit(roots.profile, limits.profile, delta, file);
      await enforceLimit(root, limits.global, delta, file);
      var temp = path.join(dir, "." + path.basename(file) + "." + crypto.randomBytes(12).toString("hex") + ".tmp");
      var handle = await fs.promises.open(temp, "wx", 0o600);
      try { await handle.writeFile(payload, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      try { await beforeCommit({ file: file, temp: temp, key: key }); guard(); fs.renameSync(temp, file); }
      catch (error) { await fs.promises.rm(temp, { force: true }).catch(function () {}); throw error; }
      return record;
    });
    return maintenance;
  }

  async function purgeScope(key) {
    var target = rootsFor(key).textbook;
    var files = await listFiles(target);
    for (var i = 0; i < files.length; i++) await unlinkExact(files[i].path);
  }

  async function purgeProfile(key) {
    var target = rootsFor({ accountId: key.accountId, profileId: key.profileId, worldId: "_", textbookId: "_" }).profile;
    var files = await listFiles(target);
    for (var i = 0; i < files.length; i++) await unlinkExact(files[i].path);
  }

  async function purgeAccount(key) {
    var target = rootsFor({ accountId: key.accountId, profileId: "_", worldId: "_", textbookId: "_" }).account;
    var files = await listFiles(target);
    for (var i = 0; i < files.length; i++) await unlinkExact(files[i].path);
  }

  return Object.freeze({ initialize: initialize, read: read, write: write, purgeScope: purgeScope, purgeProfile: purgeProfile, purgeAccount: purgeAccount, root: root, _entryPath: entryPath, _rootsFor: rootsFor });
}

module.exports = { createCache: createCache, hash: hash };
