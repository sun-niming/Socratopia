"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

function StorageError(code, message, status, details) {
  Error.call(this, message);
  this.name = "StorageError";
  this.code = code || "storage_error";
  this.status = status || 500;
  this.message = message || this.code;
  if (details) this.details = details;
  if (Error.captureStackTrace) Error.captureStackTrace(this, StorageError);
}
StorageError.prototype = Object.create(Error.prototype);
StorageError.prototype.constructor = StorageError;

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().filter(function (key) { return value[key] !== undefined; }).map(function (key) {
      return JSON.stringify(key) + ":" + canonicalJson(value[key]);
    }).join(",") + "}";
  }
  return JSON.stringify(typeof value === "string" ? value.normalize("NFC") : value);
}

function digest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function safeSegment(value, label) {
  if (typeof value !== "string") throw new StorageError("invalid_scope_id", (label || "id") + " must be a string", 400);
  var normalized = value.normalize("NFC");
  if (!normalized || normalized.length > 180) throw new StorageError("invalid_scope_id", (label || "id") + " is empty or too long", 400);
  if (/[\u0000-\u001f\u007f]/.test(normalized) || /[\\/:]/.test(normalized) || normalized.indexOf("..") >= 0) {
    throw new StorageError("invalid_scope_id", (label || "id") + " contains an unsafe path token", 400);
  }
  if (/[. ]$/.test(normalized)) throw new StorageError("invalid_scope_id", (label || "id") + " has a forbidden trailing character", 400);
  var deviceBase = normalized.split(".")[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceBase)) {
    throw new StorageError("invalid_scope_id", (label || "id") + " is a reserved Windows device name", 400);
  }
  return normalized;
}

function storageIdentity(value, label) {
  return safeSegment(value, label).toLowerCase();
}

function locatorScopeKey(scope) {
  return "locator_" + digest([scope.storageAccountId, scope.storageProfileId, scope.storageWorldId]).slice(0, 40);
}

function mutationScopeKey(scope) {
  if (!scope.storageTextbookId) throw new StorageError("missing_textbook_scope", "textbookId is required for a mutation scope", 400);
  return "scope_" + digest([scope.storageAccountId, scope.storageProfileId, scope.storageWorldId, scope.storageTextbookId]).slice(0, 40);
}

function createStorage(options) {
  options = options || {};
  var rootDir = path.resolve(String(options.rootDir || process.env.PROJECT_ROOT || ""));
  if (!options.rootDir && !process.env.PROJECT_ROOT) throw new StorageError("storage_unavailable", "PROJECT_ROOT is not configured", 503);
  var queues = new Map();

  function inside(base, target) {
    var relative = path.relative(base, target);
    return relative === "" || (relative !== ".." && relative.indexOf(".." + path.sep) !== 0 && !path.isAbsolute(relative));
  }

  function markerFor(directory) { return path.join(directory, ".scope-identity.json"); }

  function readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      if (error instanceof SyntaxError) throw new StorageError("corrupt_json", "Stored JSON is corrupt", 500, { file: file });
      throw error;
    }
  }

  function writeNewIdentity(directory, kind, displayId, storageId) {
    fs.mkdirSync(directory, { recursive: true });
    var marker = markerFor(directory);
    var payload = canonicalJson({ schemaVersion: 1, kind: kind, displayId: displayId, storageId: storageId });
    var descriptor;
    try {
      descriptor = fs.openSync(marker, "wx", 384);
      fs.writeFileSync(descriptor, payload, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
    } catch (error) {
      if (descriptor != null) try { fs.closeSync(descriptor); } catch (_) {}
      if (!error || error.code !== "EEXIST") throw error;
    }
    var existing = readJson(marker);
    if (!existing || existing.kind !== kind || existing.storageId !== storageId || existing.displayId !== displayId) {
      throw new StorageError("scope_alias_conflict", "Scope id aliases an existing Windows storage identity", 409, {
        kind: kind,
        requestedId: displayId,
        existingId: existing && existing.displayId
      });
    }
  }

  function identityLevel(parent, kind, rawId, container) {
    var displayId = safeSegment(rawId, kind + "Id");
    var storageId = storageIdentity(displayId, kind + "Id");
    var directory = path.join(parent, container, storageId);
    writeNewIdentity(directory, kind, displayId, storageId);
    return { displayId: displayId, storageId: storageId, directory: directory };
  }

  function resolveScope(input) {
    input = input || {};
    var account = identityLevel(rootDir, "account", input.accountId, "accounts");
    var profile = identityLevel(account.directory, "profile", input.profileId, "profiles");
    var world = identityLevel(profile.directory, "world", input.worldId, "worlds");
    var adaptiveRoot = path.join(world.directory, "adaptive");
    fs.mkdirSync(adaptiveRoot, { recursive: true });
    var scope = {
      accountId: account.displayId,
      profileId: profile.displayId,
      worldId: world.displayId,
      storageAccountId: account.storageId,
      storageProfileId: profile.storageId,
      storageWorldId: world.storageId,
      worldRoot: world.directory,
      adaptiveRoot: adaptiveRoot
    };
    if (input.textbookId != null) {
      var textbook = identityLevel(adaptiveRoot, "textbook", input.textbookId, "textbooks");
      scope.textbookId = textbook.displayId;
      scope.storageTextbookId = textbook.storageId;
      scope.textbookRoot = textbook.directory;
      scope.contentTextbookRoot = path.join(world.directory, "textbooks", textbook.storageId);
      scope.mutationScopeKey = mutationScopeKey(scope);
    }
    scope.locatorScopeKey = locatorScopeKey(scope);
    return Object.freeze(scope);
  }

  function validateStorageKey(storageKey) {
    if (typeof storageKey !== "string" || !storageKey || storageKey[0] === "/" || storageKey[0] === "\\" || /^[A-Za-z]:/.test(storageKey)) {
      throw new StorageError("invalid_storage_key", "storageKey is invalid", 400);
    }
    var parts = storageKey.replace(/\\/g, "/").split("/");
    if (!parts.length) throw new StorageError("invalid_storage_key", "storageKey is empty", 400);
    return parts.map(function (part) { return safeSegment(part, "storageKey"); });
  }

  function artifactPath(scope, storageKey) {
    if (!scope || !scope.adaptiveRoot) throw new StorageError("invalid_scope", "A resolved scope is required", 400);
    var target = path.resolve(scope.adaptiveRoot, path.join.apply(path, validateStorageKey(storageKey)));
    if (!inside(scope.adaptiveRoot, target)) throw new StorageError("invalid_storage_key", "storageKey escapes the adaptive root", 400);
    return target;
  }

  function writeArtifactAtomic(scope, storageKey, value) {
    var target = artifactPath(scope, storageKey);
    var parent = path.dirname(target);
    fs.mkdirSync(parent, { recursive: true });
    var temporary = path.join(parent, "." + path.basename(target) + ".tmp-" + process.pid + "-" + crypto.randomBytes(8).toString("hex"));
    var descriptor;
    try {
      descriptor = fs.openSync(temporary, "wx", 384);
      fs.writeFileSync(descriptor, canonicalJson(value), "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporary, target);
    } catch (error) {
      if (descriptor != null) try { fs.closeSync(descriptor); } catch (_) {}
      try { fs.unlinkSync(temporary); } catch (_) {}
      throw error;
    }
  }

  function readArtifact(scope, storageKey) {
    return readJson(artifactPath(scope, storageKey));
  }

  function listArtifacts(scope, prefix) {
    var normalizedPrefix = prefix ? validateStorageKey(prefix.replace(/\/$/, "")).join("/") : "";
    var start = normalizedPrefix ? artifactPath(scope, normalizedPrefix) : scope.adaptiveRoot;
    if (!fs.existsSync(start)) return [];
    var output = [];
    function visit(current) {
      fs.readdirSync(current, { withFileTypes: true }).forEach(function (entry) {
        if (entry.name === ".scope-identity.json" || entry.name.indexOf(".tmp-") >= 0) return;
        var full = path.join(current, entry.name);
        if (entry.isSymbolicLink()) throw new StorageError("unsafe_storage_entry", "Symbolic links are not allowed in adaptive storage", 500);
        if (entry.isDirectory()) return visit(full);
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") return;
        var key = path.relative(scope.adaptiveRoot, full).split(path.sep).join("/");
        output.push({ storageKey: key, value: readJson(full) });
      });
    }
    var stat = fs.statSync(start);
    if (stat.isDirectory()) visit(start);
    else output.push({ storageKey: path.relative(scope.adaptiveRoot, start).split(path.sep).join("/"), value: readJson(start) });
    return output.sort(function (left, right) { return left.storageKey.localeCompare(right.storageKey); });
  }

  function scopeFromMarkers(accountDir, profileDir, worldDir, textbookDir) {
    var account = readJson(markerFor(accountDir));
    var profile = readJson(markerFor(profileDir));
    var world = readJson(markerFor(worldDir));
    var textbook = readJson(markerFor(textbookDir));
    if (!account || !profile || !world || !textbook) return null;
    var scope = {
      accountId: account.displayId,
      profileId: profile.displayId,
      worldId: world.displayId,
      textbookId: textbook.displayId,
      storageAccountId: account.storageId,
      storageProfileId: profile.storageId,
      storageWorldId: world.storageId,
      storageTextbookId: textbook.storageId,
      worldRoot: worldDir,
      adaptiveRoot: path.join(worldDir, "adaptive"),
      textbookRoot: textbookDir,
      contentTextbookRoot: path.join(worldDir, "textbooks", textbook.storageId)
    };
    scope.locatorScopeKey = locatorScopeKey(scope);
    scope.mutationScopeKey = mutationScopeKey(scope);
    return Object.freeze(scope);
  }

  function childDirectories(directory, container) {
    var base = path.join(directory, container);
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base, { withFileTypes: true }).filter(function (entry) { return entry.isDirectory() && !entry.isSymbolicLink(); }).map(function (entry) { return path.join(base, entry.name); });
  }

  function listScopes() {
    var scopes = [];
    childDirectories(rootDir, "accounts").forEach(function (accountDir) {
      childDirectories(accountDir, "profiles").forEach(function (profileDir) {
        childDirectories(profileDir, "worlds").forEach(function (worldDir) {
          var adaptiveRoot = path.join(worldDir, "adaptive");
          childDirectories(adaptiveRoot, "textbooks").forEach(function (textbookDir) {
            var scope = scopeFromMarkers(accountDir, profileDir, worldDir, textbookDir);
            if (scope) scopes.push(scope);
          });
        });
      });
    });
    return scopes.sort(function (left, right) { return left.mutationScopeKey.localeCompare(right.mutationScopeKey); });
  }

  async function withScopeLock(key, callback) {
    if (typeof callback !== "function") throw new TypeError("withScopeLock requires a callback");
    key = String(key || "");
    if (!key) throw new StorageError("invalid_scope_key", "scope key is required", 400);
    var previous = queues.get(key) || Promise.resolve();
    var release;
    var current = new Promise(function (resolve) { release = resolve; });
    queues.set(key, current);
    await previous;
    try {
      return await callback();
    } finally {
      release();
      if (queues.get(key) === current) queues.delete(key);
    }
  }

  async function withScopeLocks(keys, callback) {
    var ordered = Array.from(new Set((keys || []).map(String))).sort();
    async function enter(index) {
      if (index >= ordered.length) return callback();
      return withScopeLock(ordered[index], function () { return enter(index + 1); });
    }
    return enter(0);
  }

  return Object.freeze({
    rootDir: rootDir,
    resolveScope: resolveScope,
    createScope: resolveScope,
    readArtifact: readArtifact,
    writeArtifactAtomic: writeArtifactAtomic,
    listArtifacts: listArtifacts,
    listScopes: listScopes,
    artifactPath: artifactPath,
    withScopeLock: withScopeLock,
    withScopeLocks: withScopeLocks,
    locatorScopeKey: locatorScopeKey,
    mutationScopeKey: mutationScopeKey
  });
}

module.exports = {
  StorageError: StorageError,
  safeSegment: safeSegment,
  storageIdentity: storageIdentity,
  locatorScopeKey: locatorScopeKey,
  mutationScopeKey: mutationScopeKey,
  createStorage: createStorage
};
