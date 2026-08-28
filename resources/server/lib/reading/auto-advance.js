"use strict";

// Durable classroom reading/turn state for packaged builds.
//
// Design invariants:
// - one immutable generation manifest plus one atomic pointer is authoritative;
// - legacy current_reading/progress/currentPage files are projections only;
// - client message-window length is never used as a turn ordinal;
// - a turn's range effect is committed at most once, before model execution;
// - background work may publish a candidate, never a formal range transition.

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var writeFileAtomic = require("write-file-atomic");

var API_VERSION = 2;
var SCHEMA_VERSION = 2;
var STATE_DIR = ".reading-state-v2";
var POINTER_FILE = "current-pointer.json";
var UPGRADE_FILE = "schema-upgrade.json";
var MAX_TURNS_PER_CONVERSATION = 4096;

function codedError(code, message, status) {
  var error = new Error(message || code);
  error.code = code;
  error.status = status || 409;
  error.statusCode = error.status;
  return error;
}

function validSegment(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function assertSegment(name, value) {
  if (!validSegment(value)) throw codedError("advance_scope_invalid", "Invalid " + name, 400);
  return value;
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw codedError("turn_envelope_invalid_number", "Envelope numbers must be finite", 400);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().filter(function (key) {
      return value[key] !== undefined;
    }).map(function (key) {
      return JSON.stringify(key) + ":" + canonicalize(value[key]);
    }).join(",") + "}";
  }
  throw codedError("turn_envelope_invalid_value", "Unsupported envelope value", 400);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function parseRange(content) {
  var match = String(content || "").match(/^<!-- startPage: (\d+) endPage: (\d+)(?:[^>]*)-->/);
  if (!match) {
    match = String(content || "").match(/^<!-- endPage: (\d+) -->/);
    return match ? { startPage: 1, endPage: Number(match[1]) } : null;
  }
  return { startPage: Number(match[1]), endPage: Number(match[2]) };
}

function wrapRange(content, startPage, endPage) {
  content = String(content || "");
  if (parseRange(content)) return content;
  return "<!-- startPage: " + startPage + " endPage: " + endPage + " -->\r\n" + content;
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  writeFileAtomic.sync(filePath, content, { encoding: "utf8", fsync: true });
}

function readText(filePath) {
  try { return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""); }
  catch (_) { return ""; }
}

function readJson(filePath) {
  var text = readText(filePath);
  if (!text.trim()) return null;
  try { return JSON.parse(text); }
  catch (_) { return null; }
}

function readJsonStrict(filePath, code, message) {
  var text;
  try { text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""); }
  catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw codedError(code, message, 500);
  }
  if (!text.trim()) throw codedError(code, message, 500);
  try { return JSON.parse(text); }
  catch (_) { throw codedError(code, message, 500); }
}

function fileHash(filePath) {
  try { return sha256(fs.readFileSync(filePath)); }
  catch (_) { return null; }
}

function projectionFileMissing(filePath) {
  try { return !fs.statSync(filePath).isFile(); }
  catch (error) { return !!error && error.code === "ENOENT"; }
}

function createAutoAdvance(options) {
  options = options || {};
  var projectRoot = path.resolve(options.projectRoot || process.env.PROJECT_ROOT || "");
  if (!projectRoot) throw codedError("advance_project_root_missing", "PROJECT_ROOT is required", 500);
  var getAccountContext = options.getAccountContext || function () { return null; };
  var bootId = options.bootId || "advance_" + crypto.randomBytes(16).toString("hex");
  var now = typeof options.now === "function" ? options.now : Date.now;
  var leaseMs = Math.max(100, Number(options.leaseMs) || 5 * 60 * 1000);
  var lockTails = new Map();
  var taskRegistry = new Map();
  var closed = false;

  function contextFor(scope) {
    var context = getAccountContext();
    if (!context || context.active === false || !validSegment(context.accountId) || !Number.isSafeInteger(context.sessionEpoch)) {
      throw codedError("advance_account_state_unavailable", "No active account", 409);
    }
    if (scope && scope.accountId && scope.accountId !== context.accountId) throw codedError("advance_scope_stale", "Account changed", 409);
    if (scope && Number.isSafeInteger(scope.sessionEpoch) && scope.sessionEpoch !== context.sessionEpoch) throw codedError("SCOPE_STALE", "Account session changed", 409);
    return context;
  }

  function normalizeScope(input) {
    input = input || {};
    var context = contextFor(input);
    return {
      accountId: context.accountId,
      sessionEpoch: context.sessionEpoch,
      profileId: assertSegment("profileId", input.profileId),
      worldId: assertSegment("worldId", input.worldId),
      textbookId: assertSegment("textbookId", input.textbookId),
      conversationId: assertSegment("conversationId", input.conversationId)
    };
  }

  function pathsFor(scope) {
    var worldDir = path.join(projectRoot, "accounts", scope.accountId, "profiles", scope.profileId, "worlds", scope.worldId);
    var textbookDir = path.join(worldDir, "textbooks", scope.textbookId);
    var stateDir = path.join(textbookDir, STATE_DIR);
    return {
      worldDir: worldDir,
      textbookDir: textbookDir,
      conversationDir: path.join(worldDir, "conversations", scope.conversationId),
      chatPath: path.join(worldDir, "chats", scope.conversationId + ".json"),
      indexPath: path.join(worldDir, "textbook_index.json"),
      progressPath: path.join(textbookDir, "progress_state.json"),
      stateDir: stateDir,
      generationsDir: path.join(stateDir, "generations"),
      blobsDir: path.join(stateDir, "blobs"),
      backupDir: path.join(stateDir, "legacy-backup"),
      pointerPath: path.join(stateDir, POINTER_FILE),
      upgradePath: path.join(stateDir, UPGRADE_FILE),
      readingPath: path.join(worldDir, "conversations", scope.conversationId, "current_reading.md")
    };
  }

  function lockKey(scope) {
    return [scope.accountId, scope.profileId, scope.worldId, scope.textbookId].join("\u001f");
  }

  function withLock(scope, callback) {
    var key = lockKey(scope);
    var previous = lockTails.get(key) || Promise.resolve();
    var running = previous.catch(function () {}).then(callback);
    lockTails.set(key, running);
    return running.finally(function () {
      if (lockTails.get(key) === running) lockTails.delete(key);
    });
  }

  function writeBlob(paths, content, kind) {
    var buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ""), "utf8");
    var hash = sha256(buffer);
    var fileName = (kind || "blob") + "-" + hash + ".bin";
    var filePath = path.join(paths.blobsDir, fileName);
    ensureDir(paths.blobsDir);
    if (!fs.existsSync(filePath)) atomicWrite(filePath, buffer);
    else if (fileHash(filePath) !== hash) throw codedError("advance_blob_hash_mismatch", "Existing blob hash mismatch", 500);
    return { ref: fileName, hash: hash, size: buffer.length };
  }

  function readBlob(paths, ref, expectedHash) {
    if (typeof ref !== "string" || !/^[A-Za-z0-9_.-]{1,200}$/.test(ref)) throw codedError("advance_blob_ref_invalid", "Invalid blob reference", 500);
    var filePath = path.join(paths.blobsDir, ref);
    var buffer = fs.readFileSync(filePath);
    var actual = sha256(buffer);
    if (expectedHash && actual !== expectedHash) throw codedError("advance_blob_hash_mismatch", "Blob hash mismatch", 500);
    return buffer;
  }

  function generationName(generation, hash) {
    return "generation-" + String(generation).padStart(12, "0") + "-" + hash.slice(0, 12) + ".json";
  }

  function acquireCommitLock(paths) {
    ensureDir(paths.stateDir);
    var lockPath = path.join(paths.stateDir, "commit.lock");
    var lockId = bootId + "_" + crypto.randomBytes(12).toString("hex");
    var deadline = Date.now() + 15000;
    for (;;) {
      try {
        var fd = fs.openSync(lockPath, "wx", 384);
        fs.writeFileSync(fd, JSON.stringify({ bootId: bootId, lockId: lockId, pid: process.pid, expiresAt: Date.now() + 10000 }), "utf8");
        fs.fsyncSync(fd);
        return function release() {
          try { fs.closeSync(fd); } catch (_) {}
          try {
            var current = readJsonStrict(lockPath, "advance_commit_lock_invalid", "Reading-state commit lock is invalid");
            if (current && current.lockId === lockId) fs.unlinkSync(lockPath);
          } catch (_) {}
        };
      } catch (error) {
        if (!error || error.code !== "EEXIST") throw error;
        var existing = null;
        try { existing = readJsonStrict(lockPath, "advance_commit_lock_invalid", "Reading-state commit lock is invalid"); } catch (_) {}
        if (!existing) {
          try {
            var invalidStat = fs.lstatSync(lockPath);
            if (Date.now() - invalidStat.mtimeMs >= 1000) {
              fs.unlinkSync(lockPath);
              continue;
            }
          } catch (_) {}
        }
        var alive = false;
        if (existing && Number.isInteger(Number(existing.pid)) && Number(existing.pid) > 0) {
          try { process.kill(Number(existing.pid), 0); alive = true; }
          catch (probeError) { alive = !!probeError && probeError.code === "EPERM"; }
        }
        if (existing && (Number(existing.expiresAt) <= Date.now() || !alive)) {
          try { fs.unlinkSync(lockPath); continue; } catch (_) {}
        }
        if (Date.now() >= deadline) throw codedError("advance_commit_lock_timeout", "Reading-state commit lock timed out", 503);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  }

  function commitManifest(paths, state) {
    var expectedGeneration = Math.max(0, Number(state.stateGeneration) || 0);
    var expectedManifestHash = state._pointerManifestHash || null;
    var release = acquireCommitLock(paths);
    try {
      var currentPointer = readJsonStrict(paths.pointerPath, "advance_pointer_invalid", "Reading-state pointer is invalid");
      if (currentPointer) {
        if (currentPointer.stateGeneration !== expectedGeneration || expectedManifestHash && currentPointer.manifestHash !== expectedManifestHash) throw codedError("SCOPE_STALE", "Reading-state generation changed before commit", 409);
      } else if (expectedGeneration !== 0 || expectedManifestHash) throw codedError("advance_pointer_missing", "Reading-state pointer disappeared", 500);
      state = clone(state);
      state.schemaVersion = SCHEMA_VERSION;
      state.stateGeneration = expectedGeneration + 1;
      state.updatedAt = nowIso();
      var serialized = JSON.stringify(state, null, 2);
      var manifestHash = sha256(serialized);
      var fileName = generationName(state.stateGeneration, manifestHash);
      ensureDir(paths.generationsDir);
      var manifestPath = path.join(paths.generationsDir, fileName);
      if (!fs.existsSync(manifestPath)) atomicWrite(manifestPath, serialized);
      var pointer = { schemaVersion: SCHEMA_VERSION, stateGeneration: state.stateGeneration, manifest: fileName, manifestHash: manifestHash, committedAt: nowIso() };
      atomicWrite(paths.pointerPath, JSON.stringify(pointer, null, 2));
      Object.defineProperty(state, "_pointerManifestHash", { value: manifestHash, enumerable: false, configurable: true });
      return state;
    } finally { release(); }
  }

  function readCommitted(paths) {
    var pointer = readJsonStrict(paths.pointerPath, "advance_pointer_invalid", "Reading-state pointer is invalid");
    if (!pointer) return null;
    if (pointer.schemaVersion !== SCHEMA_VERSION || !Number.isSafeInteger(pointer.stateGeneration) || !pointer.manifest || !pointer.manifestHash) {
      throw codedError("advance_pointer_invalid", "Reading-state pointer is invalid", 500);
    }
    var manifestPath = path.join(paths.generationsDir, path.basename(pointer.manifest));
    var serialized = readText(manifestPath);
    if (!serialized || sha256(serialized) !== pointer.manifestHash) throw codedError("advance_manifest_invalid", "Reading-state manifest is missing or corrupt", 500);
    var state;
    try { state = JSON.parse(serialized); }
    catch (_) { throw codedError("advance_manifest_invalid", "Reading-state manifest is missing or corrupt", 500); }
    if (state.schemaVersion !== SCHEMA_VERSION || state.stateGeneration !== pointer.stateGeneration) throw codedError("advance_generation_mismatch", "Pointer generation mismatch", 500);
    Object.defineProperty(state, "_pointerManifestHash", { value: pointer.manifestHash, enumerable: false, configurable: true });
    return state;
  }

  function legacyRange(paths) {
    var reading = readText(paths.readingPath);
    var readingRange = parseRange(reading);
    var progress = readJson(paths.progressPath) || {};
    var progressRange = progress.loadedCursor && Number.isInteger(progress.loadedCursor.startPage) && Number.isInteger(progress.loadedCursor.endPage)
      ? { startPage: progress.loadedCursor.startPage, endPage: progress.loadedCursor.endPage }
      : null;
    if (readingRange && progressRange && (readingRange.startPage !== progressRange.startPage || readingRange.endPage !== progressRange.endPage) && String(progress.sourceConversationId || "") === paths.conversationId) {
      throw codedError("MIGRATION_REPAIR_REQUIRED", "Legacy reading and progress ranges disagree", 409);
    }
    return { reading: reading, range: readingRange || progressRange, progress: progress };
  }

  function backupLegacy(paths) {
    ensureDir(paths.backupDir);
    var files = [
      { name: "current_reading.md", source: paths.readingPath },
      { name: "progress_state.json", source: paths.progressPath },
      { name: "textbook_index.json", source: paths.indexPath },
      { name: "chat.json", source: paths.chatPath }
    ];
    var manifest = { schemaVersion: 1, createdAt: nowIso(), files: [] };
    files.forEach(function (entry) {
      if (!fs.existsSync(entry.source)) return;
      var buffer = fs.readFileSync(entry.source);
      var target = path.join(paths.backupDir, entry.name);
      if (!fs.existsSync(target)) atomicWrite(target, buffer);
      manifest.files.push({ name: entry.name, hash: sha256(buffer), size: buffer.length });
    });
    manifest.files.sort(function (left, right) { return left.name.localeCompare(right.name); });
    atomicWrite(path.join(paths.backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    atomicWrite(paths.upgradePath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, phase: "legacy_backed_up", backupManifestHash: sha256(JSON.stringify(manifest)), updatedAt: nowIso() }, null, 2));
  }

  function conversationSeed(paths, scope, legacy) {
    var range = legacy.range || { startPage: 1, endPage: 1 };
    var content = legacy.reading || wrapRange("", range.startPage, range.endPage);
    var blob = writeBlob(paths, content, "reading");
    var chat = readJson(paths.chatPath) || {};
    var lastAssistantMessageId = null;
    if (Array.isArray(chat.messages)) {
      for (var index = chat.messages.length - 1; index >= 0; index--) {
        if (chat.messages[index] && chat.messages[index].role === "assistant") {
          lastAssistantMessageId = chat.messages[index].id || null;
          break;
        }
      }
    }
    return {
      conversationId: scope.conversationId,
      causalConversationRevision: 0,
      readingVersion: 0,
      serverTurnOrdinal: 0,
      lastAdvanceServerOrdinal: 0,
      lastAssistantMessageId: lastAssistantMessageId,
      loadedRange: range,
      loadedContent: blob,
      taughtCursor: legacy.progress.taughtCursor || null,
      completedConceptIds: Array.isArray(legacy.progress.completedConceptIds) ? legacy.progress.completedConceptIds.slice() : [],
      pendingAdvance: null,
      candidate: null,
      turns: {},
      projectionStatus: "pending",
      projectionReadingHash: null,
      projectionProgress: null,
      projectionIndex: null
    };
  }

  function migrate(paths, scope) {
    backupLegacy(paths);
    var legacy = legacyRange(Object.assign({ conversationId: scope.conversationId }, paths));
    var conversation = conversationSeed(paths, scope, legacy);
    var state = {
      schemaVersion: SCHEMA_VERSION,
      stateGeneration: 0,
      scope: {
        accountId: scope.accountId,
        profileId: scope.profileId,
        worldId: scope.worldId,
        textbookId: scope.textbookId,
        sessionEpoch: scope.sessionEpoch,
        scopeGeneration: 1
      },
      owner: { conversationId: scope.conversationId, ownerGeneration: 1 },
      conversations: {},
      createdAt: nowIso()
    };
    state.conversations[scope.conversationId] = conversation;
    state = commitManifest(paths, state);
    projectConversation(paths, state, scope.conversationId);
    markProjectionClean(paths, state, scope.conversationId);
    state = commitManifest(paths, state);
    atomicWrite(paths.upgradePath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, phase: "complete", stateGeneration: state.stateGeneration, completedAt: nowIso() }, null, 2));
    return state;
  }

  function updateIndexCurrentPage(paths, textbookId, currentPage) {
    var index = readJson(paths.indexPath);
    if (!index || !Array.isArray(index.textbooks)) return;
    var changed = false;
    index.textbooks = index.textbooks.map(function (entry) {
      if (!entry || entry.id !== textbookId) return entry;
      if (entry.currentPage === currentPage) return entry;
      changed = true;
      return Object.assign({}, entry, { currentPage: currentPage });
    });
    if (changed) {
      index.updatedAt = nowIso();
      atomicWrite(paths.indexPath, JSON.stringify(index, null, 2));
    }
  }

  function projectConversation(paths, state, conversationId) {
    var conversation = state.conversations[conversationId];
    if (!conversation) throw codedError("advance_conversation_missing", "Conversation state missing", 500);
    var content = readBlob(paths, conversation.loadedContent.ref, conversation.loadedContent.hash).toString("utf8");
    atomicWrite(paths.readingPath, content);
    var progress = readJson(paths.progressPath) || {};
    var projectedRange = conversation.loadedRange || {};
    progress.schemaVersion = Math.max(3, Number(progress.schemaVersion) || 0);
    progress.textbookId = state.scope.textbookId;
    progress.sourceConversationId = conversationId;
    progress.loadedCursor = {
      chunkId: projectedRange.chunkId || "loaded-" + String(projectedRange.startPage).padStart(4, "0"),
      ordinal: Number.isInteger(projectedRange.ordinal) ? projectedRange.ordinal : projectedRange.startPage,
      startPage: projectedRange.startPage,
      endPage: projectedRange.endPage,
      updatedAt: nowIso()
    };
    if (projectedRange.loadedOnly === true) progress.loadedCursor.loadedOnly = true;
    if (projectedRange.jumpLoaded === true) progress.loadedCursor.jumpLoaded = true;
    var taughtStartPage = Number(progress.taughtCursor && progress.taughtCursor.startPage);
    if (projectedRange.loadedOnly === true && Number.isInteger(taughtStartPage) && taughtStartPage > 0) {
      progress.lastTaughtPage = taughtStartPage;
      progress.currentPage = taughtStartPage;
    } else {
      progress.currentPage = projectedRange.startPage;
    }
    progress.updatedAt = nowIso();
    atomicWrite(paths.progressPath, JSON.stringify(progress, null, 2));
    updateIndexCurrentPage(paths, state.scope.textbookId, projectedRange.startPage);
  }

  function projectionSignature(paths, state, conversationId) {
    var conversation = state.conversations[conversationId];
    var progress = readJson(paths.progressPath);
    var index = readJson(paths.indexPath);
    var entry = index && Array.isArray(index.textbooks) ? index.textbooks.find(function (item) { return item && item.id === state.scope.textbookId; }) : null;
    var progressSignature = progress ? {
      present: true,
      sourceConversationId: progress.sourceConversationId || null,
      startPage: Number(progress.loadedCursor && progress.loadedCursor.startPage) || null,
      endPage: Number(progress.loadedCursor && progress.loadedCursor.endPage) || null,
      currentPage: Number(progress.currentPage) || null
    } : { present: false };
    var authoritativeRange = conversation && conversation.loadedRange || {};
    if (authoritativeRange.chunkId) progressSignature.chunkId = progress && progress.loadedCursor && progress.loadedCursor.chunkId || null;
    if (Number.isInteger(authoritativeRange.ordinal)) progressSignature.ordinal = Number(progress && progress.loadedCursor && progress.loadedCursor.ordinal) || null;
    if (authoritativeRange.loadedOnly === true) progressSignature.loadedOnly = !!(progress && progress.loadedCursor && progress.loadedCursor.loadedOnly);
    if (authoritativeRange.jumpLoaded === true) progressSignature.jumpLoaded = !!(progress && progress.loadedCursor && progress.loadedCursor.jumpLoaded);
    return {
      readingHash: fileHash(paths.readingPath),
      progress: progressSignature,
      index: entry ? { present: true, currentPage: Number(entry.currentPage) || null } : { present: false }
    };
  }

  function markProjectionClean(paths, state, conversationId) {
    var conversation = state.conversations[conversationId];
    var signature = projectionSignature(paths, state, conversationId);
    conversation.projectionStatus = "clean";
    conversation.projectionReadingHash = signature.readingHash;
    conversation.projectionProgress = signature.progress;
    conversation.projectionIndex = signature.index;
  }

  function recover(paths, scope, state) {
    var conversationId = state.owner && state.owner.conversationId || scope.conversationId;
    var conversation = state.conversations[conversationId];
    if (!conversation) return state;
    if (conversation.projectionStatus === "pending") {
      // A pending projection may belong to the previous conversation. Do not
      // recreate that conversation's legacy file while opening a new one (the
      // end-class flow intentionally removes it); activation will publish the
      // requested conversation's projection instead.
      if (scope.conversationId !== conversationId) return state;
      var ownerPaths = pathsFor(Object.assign({}, scope, { conversationId: conversationId }));
      projectConversation(ownerPaths, state, conversationId);
      markProjectionClean(ownerPaths, state, conversationId);
      return commitManifest(paths, state);
    }
    var ownerPaths = pathsFor(Object.assign({}, scope, { conversationId: conversationId }));
    var signature = projectionSignature(ownerPaths, state, conversationId);
    var readingMissing = !!conversation.projectionReadingHash && !signature.readingHash && projectionFileMissing(ownerPaths.readingPath);
    var progressMissing = !!conversation.projectionProgress && !signature.progress.present && projectionFileMissing(ownerPaths.progressPath);
    var indexMissing = !!conversation.projectionIndex && !signature.index.present && projectionFileMissing(ownerPaths.indexPath);
    var readingChanged = !!conversation.projectionReadingHash && (!signature.readingHash ? !readingMissing : conversation.projectionReadingHash !== signature.readingHash);
    var progressChanged = !!conversation.projectionProgress && (!signature.progress.present ? !progressMissing : canonicalize(conversation.projectionProgress) !== canonicalize(signature.progress));
    var indexChanged = !!conversation.projectionIndex && (!signature.index.present ? !indexMissing : canonicalize(conversation.projectionIndex) !== canonicalize(signature.index));
    if (readingChanged || progressChanged || indexChanged) {
      throw codedError("EXTERNAL_LEGACY_MUTATION_DETECTED", "Legacy reading projection changed outside the authoritative state", 409);
    }
    // Missing legacy files are recoverable: they are projections, and the
    // authoritative state can recreate them. Keep an inactive conversation
    // pending so opening it later repairs the projection without resurrecting
    // stale files during a different conversation's bootstrap.
    var projectionMissing = readingMissing || progressMissing || indexMissing ||
      !conversation.projectionProgress || !conversation.projectionIndex;
    if (projectionMissing) {
      conversation.projectionStatus = "pending";
      if (scope.conversationId === conversationId) {
        projectConversation(ownerPaths, state, conversationId);
        markProjectionClean(ownerPaths, state, conversationId);
      }
      return commitManifest(paths, state);
    }
    return state;
  }

  function loadOrMigrate(paths, scope) {
    var state = readCommitted(paths);
    if (!state) return migrate(paths, scope);
    if (!state.scope || state.scope.accountId !== scope.accountId || state.scope.profileId !== scope.profileId || state.scope.worldId !== scope.worldId || state.scope.textbookId !== scope.textbookId) {
      throw codedError("advance_scope_mismatch", "Authoritative state belongs to another scope", 409);
    }
    if (scope.sessionEpoch < state.scope.sessionEpoch) {
      throw codedError("SCOPE_STALE", "Account session epoch is stale", 409);
    }
    if (state.scope.sessionEpoch !== scope.sessionEpoch) {
      state.scope.sessionEpoch = scope.sessionEpoch;
      state.scope.scopeGeneration = Math.max(0, Number(state.scope.scopeGeneration) || 0) + 1;
      Object.keys(state.conversations || {}).forEach(function (conversationId) {
        var turns = state.conversations[conversationId].turns || {};
        Object.keys(turns).forEach(function (turnId) {
          var turn = turns[turnId];
          if (turn.turnState !== "MODEL_RUNNING") return;
          turn.lastAttemptId = Math.max(Number(turn.lastAttemptId) || 0, Number(turn.executor && turn.executor.attemptId) || 0);
          turn.turnState = "CANCELLED_RETRYABLE";
          turn.terminalResult = "error";
          turn.errorCode = "advance_session_changed";
          turn.executor = null;
          turn.updatedAt = nowIso();
        });
      });
      state = commitManifest(paths, state);
    }
    return recover(paths, scope, state);
  }

  function ensureConversation(paths, state, scope) {
    if (state.conversations[scope.conversationId]) return state.conversations[scope.conversationId];
    var legacy = legacyRange(Object.assign({ conversationId: scope.conversationId }, paths));
    state.conversations[scope.conversationId] = conversationSeed(paths, scope, legacy);
    return state.conversations[scope.conversationId];
  }

  function activateOwner(paths, state, scope) {
    ensureConversation(paths, state, scope);
    if (!state.owner || state.owner.conversationId !== scope.conversationId) {
      var targetConversation = state.conversations[scope.conversationId];
      if (targetConversation.projectionStatus === "clean") {
        var targetPaths = pathsFor(scope);
        var targetReadingHash = fileHash(targetPaths.readingPath);
        if (targetConversation.projectionReadingHash && targetReadingHash && targetConversation.projectionReadingHash !== targetReadingHash) {
          throw codedError("EXTERNAL_LEGACY_MUTATION_DETECTED", "Inactive conversation reading projection changed outside the authoritative state", 409);
        }
      }
      var previousKey = lockKey(scope);
      var task = taskRegistry.get(previousKey);
      if (task && task.controller) task.controller.abort(codedError("advance_scope_stale"));
      state.owner = { conversationId: scope.conversationId, ownerGeneration: Math.max(0, Number(state.owner && state.owner.ownerGeneration) || 0) + 1 };
      state.conversations[scope.conversationId].projectionStatus = "pending";
      state = commitManifest(paths, state);
      projectConversation(paths, state, scope.conversationId);
      markProjectionClean(paths, state, scope.conversationId);
      state = commitManifest(paths, state);
    }
    return state;
  }

  function publicSnapshot(state, conversation) {
    var readingRange = {
      startPage: conversation.loadedRange.startPage,
      endPage: conversation.loadedRange.endPage,
      readingVersion: conversation.readingVersion,
      stateGeneration: state.stateGeneration,
      conversationId: conversation.conversationId
    };
    if (conversation.loadedRange.chunkId) readingRange.chunkId = conversation.loadedRange.chunkId;
    if (Number.isInteger(conversation.loadedRange.ordinal)) readingRange.ordinal = conversation.loadedRange.ordinal;
    if (conversation.loadedRange.loadedOnly === true) readingRange.loadedOnly = true;
    if (conversation.loadedRange.jumpLoaded === true) readingRange.jumpLoaded = true;
    return {
      advanceProtocolVersion: API_VERSION,
      causalConversationRevision: conversation.causalConversationRevision,
      readingVersion: conversation.readingVersion,
      stateGeneration: state.stateGeneration,
      ownerGeneration: state.owner.ownerGeneration,
      parentAssistantMessageId: conversation.lastAssistantMessageId || null,
      readingRange: readingRange
    };
  }

  function bootstrap(input) {
    var scope = normalizeScope(input);
    var paths = pathsFor(scope);
    return withLock(scope, function () {
      contextFor(scope);
      var state = activateOwner(paths, loadOrMigrate(paths, scope), scope);
      return publicSnapshot(state, state.conversations[scope.conversationId]);
    });
  }

  function readSnapshot(input) {
    var scope = normalizeScope(input);
    var paths = pathsFor(scope);
    return withLock(scope, function () {
      contextFor(scope);
      var state = readCommitted(paths);
      if (!state) return null;
      if (!state.scope || state.scope.accountId !== scope.accountId || state.scope.profileId !== scope.profileId || state.scope.worldId !== scope.worldId || state.scope.textbookId !== scope.textbookId) {
        throw codedError("advance_scope_mismatch", "Authoritative state belongs to another scope", 409);
      }
      if (scope.sessionEpoch < state.scope.sessionEpoch) throw codedError("SCOPE_STALE", "Account session epoch is stale", 409);
      var conversation = state.conversations && state.conversations[scope.conversationId];
      if (!conversation) return null;
      var readingHash = fileHash(paths.readingPath);
      if (conversation.projectionStatus === "clean" && conversation.projectionReadingHash && readingHash && conversation.projectionReadingHash !== readingHash) {
        throw codedError("EXTERNAL_LEGACY_MUTATION_DETECTED", "Conversation reading projection changed outside the authoritative state", 409);
      }
      return publicSnapshot(state, conversation);
    });
  }

  function readSnapshot(input) {
    var scope = normalizeScope(input);
    var paths = pathsFor(scope);
    return withLock(scope, function () {
      contextFor(scope);
      var state = readCommitted(paths);
      if (!state) return null;
      if (!state.scope || state.scope.accountId !== scope.accountId || state.scope.profileId !== scope.profileId || state.scope.worldId !== scope.worldId || state.scope.textbookId !== scope.textbookId) {
        throw codedError("advance_scope_mismatch", "Authoritative state belongs to another scope", 409);
      }
      if (scope.sessionEpoch < state.scope.sessionEpoch) throw codedError("SCOPE_STALE", "Account session epoch is stale", 409);
      var conversation = state.conversations && state.conversations[scope.conversationId];
      if (!conversation) return null;
      var readingHash = fileHash(paths.readingPath);
      if (conversation.projectionStatus === "clean" && conversation.projectionReadingHash && readingHash && conversation.projectionReadingHash !== readingHash) {
        throw codedError("EXTERNAL_LEGACY_MUTATION_DETECTED", "Conversation reading projection changed outside the authoritative state", 409);
      }
      return publicSnapshot(state, conversation);
    });
  }

  function normalizeEnvelope(input, scope) {
    var envelope = clone(input && input.envelope || {});
    if (Number(envelope.protocolVersion) !== API_VERSION || Number(input && input.advanceProtocolVersion) !== API_VERSION) {
      throw codedError("CLIENT_REFRESH_REQUIRED", "版本已更新，请重启应用", 409);
    }
    if (!validSegment(input.clientTurnId)) throw codedError("turn_id_invalid", "clientTurnId is required", 400);
    ["accountId", "profileId", "worldId", "textbookId", "conversationId"].forEach(function (key) {
      if (envelope[key] !== scope[key]) throw codedError("turn_envelope_scope_mismatch", "Envelope scope mismatch", 409);
    });
    if (envelope.clientTurnId && envelope.clientTurnId !== input.clientTurnId) throw codedError("turn_envelope_id_mismatch", "Envelope turn ID mismatch", 409);
    envelope.clientTurnId = input.clientTurnId;
    return { envelope: envelope, canonical: canonicalize(envelope), hash: sha256(canonicalize(envelope)) };
  }

  function explicitIntent(envelope) {
    if (envelope.postJumpAcknowledgement === true) return null;
    var action = envelope.readingAction;
    if (action && action.type === "page" && Number.isInteger(Number(action.page)) && Number(action.page) >= 1) return { type: "page", page: Number(action.page), reason: "explicit_page_jump" };
    if (action && action.type === "next") return { type: "next", reason: "explicit_next_page" };
    var text = String(envelope.sanitizedUserContent || "").trim();
    var page = text.match(/(?:请\s*)?(?:跳到|翻到|从)(?:\s*PDF)?\s*第?\s*(\d+)\s*页(?:开始|看起|继续)?/i);
    if (page) return { type: "page", page: Number(page[1]), reason: "explicit_page_jump" };
    if (/^(?:请\s*)?(?:下一页|翻页|翻到下一页|请看下一页|next\s+page)[。.!！]?$/i.test(text)) return { type: "next", reason: "explicit_next_page" };
    return null;
  }

  function isHoldIntent(text) {
    return /(先别|不要|暂时不|别急着)(?:翻页|下一页|往下|继续下一)/.test(String(text || ""));
  }

  function newExecutor(turn, attemptId) {
    return {
      bootId: bootId,
      leaseId: crypto.randomBytes(16).toString("hex"),
      attemptId: attemptId,
      expiresAt: now() + leaseMs
    };
  }

  function sameExecutor(left, right) {
    return !!left && !!right && left.bootId === right.bootId && left.leaseId === right.leaseId && left.attemptId === right.attemptId;
  }

  function cancelAcceptedExecutor(paths, scope, clientTurnId, executor, errorCode) {
    for (var attempt = 0; attempt < 8; attempt += 1) {
      var state = readCommitted(paths);
      if (!state || !state.scope ||
          state.scope.accountId !== scope.accountId ||
          state.scope.profileId !== scope.profileId ||
          state.scope.worldId !== scope.worldId ||
          state.scope.textbookId !== scope.textbookId) return false;
      var conversation = state.conversations && state.conversations[scope.conversationId];
      var turn = conversation && conversation.turns && conversation.turns[clientTurnId];
      if (!turn || turn.turnState !== "MODEL_RUNNING" || !sameExecutor(turn.executor, executor)) return false;
      turn.lastAttemptId = Math.max(Number(turn.lastAttemptId) || 0, Number(turn.executor && turn.executor.attemptId) || 0);
      turn.turnState = "CANCELLED_RETRYABLE";
      turn.terminalResult = "error";
      turn.errorCode = String(errorCode || "begin_turn_failed").slice(0, 128);
      turn.executor = null;
      turn.updatedAt = nowIso();
      try {
        commitManifest(paths, state);
        return true;
      } catch (error) {
        if (!error || error.code !== "SCOPE_STALE") throw error;
      }
    }
    return false;
  }

  async function beginTurn(input) {
    var scope = normalizeScope(input);
    var paths = pathsFor(scope);
    var normalized = normalizeEnvelope(input, scope);
    return withLock(scope, async function () {
      contextFor(scope);
      var state = loadOrMigrate(paths, scope);
      var conversation = ensureConversation(paths, state, scope);
      var existing = conversation.turns[input.clientTurnId];
      if (existing) {
        if (existing.envelopeHash !== normalized.hash) throw codedError("TURN_CONFLICT", "Turn ID was reused with a different envelope", 409);
        if (existing.turnState === "COMPLETED") {
          var replay = existing.responseBlobRef ? readBlob(paths, existing.responseBlobRef, existing.responseHash).toString("utf8") : "";
          return Object.assign({ replay: true, responseText: replay, envelopeHash: existing.envelopeHash, executorKey: null }, publicSnapshot(state, conversation));
        }
        if (!state.owner || state.owner.conversationId !== scope.conversationId) throw codedError("SCOPE_STALE", "Conversation is no longer active", 409);
        if (existing.turnState === "MODEL_RUNNING" && existing.executor && existing.executor.expiresAt > now()) throw codedError("TURN_IN_PROGRESS", "This turn is already running", 409);
        var retrySnapshot = existing.promptSnapshot;
        if (!retrySnapshot || !retrySnapshot.blobRef || !retrySnapshot.contentHash) throw codedError("advance_prompt_snapshot_missing", "Accepted turn prompt snapshot is unavailable", 500);
        if (retrySnapshot.readingVersion !== conversation.readingVersion || retrySnapshot.ownerGeneration !== state.owner.ownerGeneration || retrySnapshot.scopeGeneration !== state.scope.scopeGeneration || retrySnapshot.causalConversationRevision !== conversation.causalConversationRevision) {
          var staleRetry = codedError("SCOPE_STALE", "Accepted turn prompt snapshot is stale", 409);
          staleRetry.snapshot = publicSnapshot(state, conversation);
          throw staleRetry;
        }
        var retryContent = readBlob(paths, retrySnapshot.blobRef, retrySnapshot.contentHash).toString("utf8");
        var nextAttempt = Math.max(0, Number(existing.lastAttemptId) || 0, Number(existing.executor && existing.executor.attemptId) || 0) + 1;
        existing.lastAttemptId = nextAttempt;
        existing.turnState = "MODEL_RUNNING";
        existing.executor = newExecutor(existing, nextAttempt);
        existing.updatedAt = nowIso();
        state = commitManifest(paths, state);
        return Object.assign({ replay: false, retry: true, envelopeHash: existing.envelopeHash, executorKey: clone(existing.executor), promptSnapshot: {
          blobRef: retrySnapshot.blobRef,
          contentHash: retrySnapshot.contentHash,
          content: retryContent,
          readingVersion: retrySnapshot.readingVersion,
          stateGenerationAtStart: state.stateGeneration,
          causalConversationRevision: retrySnapshot.causalConversationRevision,
          scopeGeneration: retrySnapshot.scopeGeneration,
          ownerGeneration: retrySnapshot.ownerGeneration
        } }, publicSnapshot(state, conversation));
      }

      if (Number(normalized.envelope.baseCausalConversationRevision) !== Number(conversation.causalConversationRevision) || Number(normalized.envelope.baseReadingVersion) !== Number(conversation.readingVersion)) {
        var stale = codedError("STALE_TURN", "Conversation or reading revision is stale", 409);
        stale.snapshot = publicSnapshot(state, conversation);
        throw stale;
      }
      if (conversation.lastAssistantMessageId && normalized.envelope.parentAssistantMessageId !== conversation.lastAssistantMessageId) {
        var staleParent = codedError("STALE_TURN", "Parent assistant message is stale", 409);
        staleParent.snapshot = publicSnapshot(state, conversation);
        throw staleParent;
      }
      state = activateOwner(paths, state, scope);
      conversation = state.conversations[scope.conversationId];

      var ordinal = conversation.serverTurnOrdinal + 1;
      var intent = explicitIntent(normalized.envelope);
      var hold = isHoldIntent(normalized.envelope.sanitizedUserContent);
      var delta = Math.max(0, ordinal - conversation.lastAdvanceServerOrdinal);
      var shouldCommitPending = !hold && !intent && !!conversation.pendingAdvance && delta >= 1;
      var shouldForce = !hold && !intent && delta >= 12;
      var transition = intent || (shouldCommitPending || shouldForce ? { type: "next", reason: shouldForce ? "threshold_pre_turn" : "pending_pre_turn" } : null);
      var loaded = null;
      if (transition) {
        if (typeof input.loadRange !== "function") throw codedError("advance_loader_unavailable", "Range loader is unavailable", 503);
        var targetStart = transition.type === "page" ? transition.page : conversation.loadedRange.endPage + 1;
        if (transition.type !== "page" && conversation.candidate && conversation.candidate.baseReadingVersion === conversation.readingVersion && conversation.candidate.startPage === targetStart) {
          loaded = {
            content: readBlob(paths, conversation.candidate.blobRef, conversation.candidate.contentHash).toString("utf8"),
            startPage: conversation.candidate.startPage,
            endPage: conversation.candidate.endPage
          };
        } else {
          loaded = await input.loadRange({ startPage: targetStart, explicitPage: transition.type === "page", reason: transition.reason, scope: clone(scope), signal: input.signal, deadlineAt: input.deadlineAt });
        }
        if (!loaded || !String(loaded.content || "").trim() || !Number.isInteger(Number(loaded.startPage)) || !Number.isInteger(Number(loaded.endPage)) || Number(loaded.endPage) < Number(loaded.startPage)) {
          throw codedError("advance_load_failed", "无法加载目标教材页面", 409);
        }
        if (transition.type !== "page" && Number(loaded.startPage) !== conversation.loadedRange.endPage + 1) throw codedError("advance_non_adjacent", "Automatic advance must be adjacent", 409);
      }
      contextFor(scope);

      conversation.serverTurnOrdinal = ordinal;
      conversation.causalConversationRevision += 1;
      if (loaded) {
        var wrapped = wrapRange(loaded.content, Number(loaded.startPage), Number(loaded.endPage));
        conversation.loadedContent = writeBlob(paths, wrapped, "reading");
        conversation.loadedRange = { startPage: Number(loaded.startPage), endPage: Number(loaded.endPage) };
        conversation.readingVersion += 1;
        conversation.lastAdvanceServerOrdinal = ordinal;
        conversation.pendingAdvance = null;
        conversation.candidate = null;
        conversation.projectionStatus = "pending";
      }
      if (hold) conversation.pendingAdvance = null;

      var executor = newExecutor(null, 1);
      var immutablePromptSnapshot = {
        blobRef: conversation.loadedContent.ref,
        contentHash: conversation.loadedContent.hash,
        readingVersion: conversation.readingVersion,
        causalConversationRevision: conversation.causalConversationRevision,
        scopeGeneration: state.scope.scopeGeneration,
        ownerGeneration: state.owner.ownerGeneration
      };
      conversation.turns[input.clientTurnId] = {
        clientTurnId: input.clientTurnId,
        serverTurnOrdinal: ordinal,
        envelopeHash: normalized.hash,
        envelope: normalized.envelope,
        turnState: "MODEL_RUNNING",
        effectTxId: "tx_" + crypto.randomBytes(16).toString("hex"),
        rangeEffectReadingVersion: conversation.readingVersion,
        executor: executor,
        lastAttemptId: 1,
        promptSnapshot: immutablePromptSnapshot,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      if (Object.keys(conversation.turns).length > MAX_TURNS_PER_CONVERSATION) throw codedError("advance_turn_ledger_limit", "Turn ledger limit reached; archive this lesson", 409);
      var promptContent = readBlob(paths, conversation.loadedContent.ref, conversation.loadedContent.hash).toString("utf8");
      try {
        state = commitManifest(paths, state);
        conversation = state.conversations[scope.conversationId];
        if (conversation.projectionStatus === "pending") {
          projectConversation(paths, state, scope.conversationId);
          markProjectionClean(paths, state, scope.conversationId);
          state = commitManifest(paths, state);
        }
        return Object.assign({ replay: false, retry: false, envelopeHash: normalized.hash, rangeChanged: !!loaded, rangeReason: transition && transition.reason || null, executorKey: clone(executor), promptSnapshot: {
          blobRef: immutablePromptSnapshot.blobRef,
          contentHash: immutablePromptSnapshot.contentHash,
          content: promptContent,
          readingVersion: immutablePromptSnapshot.readingVersion,
          stateGenerationAtStart: state.stateGeneration,
          causalConversationRevision: immutablePromptSnapshot.causalConversationRevision,
          scopeGeneration: immutablePromptSnapshot.scopeGeneration,
          ownerGeneration: immutablePromptSnapshot.ownerGeneration
        } }, publicSnapshot(state, conversation));
      } catch (beginError) {
        try {
          cancelAcceptedExecutor(paths, scope, input.clientTurnId, executor, beginError && (beginError.code || beginError.message));
        } catch (cleanupError) {
          beginError.cleanupErrorCode = cleanupError && (cleanupError.code || cleanupError.message) || "begin_turn_cleanup_failed";
        }
        throw beginError;
      }
    });
  }

  function completionSignal(text, decision) {
    text = String(text || "");
    if (decision && (decision.contentProgress === "second_half" || decision.recommendedAction === "advance")) return true;
    return /(这一部分(?:已经)?讲完|当前(?:窗口|部分|小节)(?:已经)?讲完|进入下一(?:节|部分|知识点)|move on to the next|next section|next point)/i.test(text);
  }

  function completeTurn(input) {
    var scope = normalizeScope(input);
    var paths = pathsFor(scope);
    return withLock(scope, function () {
      contextFor(scope);
      var state = loadOrMigrate(paths, scope);
      if (!state.owner || state.owner.conversationId !== scope.conversationId) throw codedError("SCOPE_STALE", "Conversation is no longer active", 409);
      var conversation = ensureConversation(paths, state, scope);
      var turn = conversation.turns[input.clientTurnId];
      if (!turn) throw codedError("turn_not_found", "Turn was not accepted", 409);
      if (turn.envelopeHash !== input.envelopeHash) throw codedError("TURN_CONFLICT", "Turn envelope hash changed", 409);
      if (turn.turnState === "COMPLETED") return publicSnapshot(state, conversation);
      if (turn.turnState !== "MODEL_RUNNING" || !sameExecutor(turn.executor, input.executorKey)) throw codedError("SCOPE_STALE", "Model attempt lost its execution lease", 409);
      if (!Number.isFinite(Number(turn.executor.expiresAt)) || Number(turn.executor.expiresAt) <= now()) throw codedError("SCOPE_STALE", "Model attempt execution lease expired", 409);
      if (!input.promptSnapshot || !turn.promptSnapshot || input.promptSnapshot.blobRef !== turn.promptSnapshot.blobRef || input.promptSnapshot.contentHash !== turn.promptSnapshot.contentHash || input.promptSnapshot.readingVersion !== turn.promptSnapshot.readingVersion || input.promptSnapshot.ownerGeneration !== turn.promptSnapshot.ownerGeneration || input.promptSnapshot.scopeGeneration !== turn.promptSnapshot.scopeGeneration || input.promptSnapshot.causalConversationRevision !== turn.promptSnapshot.causalConversationRevision || input.promptSnapshot.readingVersion !== conversation.readingVersion || input.promptSnapshot.ownerGeneration !== state.owner.ownerGeneration || input.promptSnapshot.scopeGeneration !== state.scope.scopeGeneration || input.promptSnapshot.causalConversationRevision !== conversation.causalConversationRevision) {
        throw codedError("SCOPE_STALE", "Prompt snapshot is stale", 409);
      }
      var result = writeBlob(paths, String(input.responseText || ""), "response");
      turn.responseBlobRef = result.ref;
      turn.responseHash = result.hash;
      turn.turnState = "COMPLETED";
      turn.terminalResult = "done";
      turn.updatedAt = nowIso();
      turn.executor = null;
      turn.assistantMessageId = input.assistantMessageId || null;
      turn.completionDecision = completionSignal(input.responseText, input.decision) ? "pending_advance" : "stay";
      conversation.lastAssistantMessageId = input.assistantMessageId || conversation.lastAssistantMessageId;
      conversation.causalConversationRevision += 1;
      if (turn.completionDecision === "pending_advance") {
        conversation.pendingAdvance = { reason: "assistant_completion", turnId: input.clientTurnId, serverTurnOrdinal: turn.serverTurnOrdinal, baseReadingVersion: conversation.readingVersion, createdAt: nowIso() };
      }
      var delta = Math.max(0, conversation.serverTurnOrdinal - conversation.lastAdvanceServerOrdinal);
      state = commitManifest(paths, state);
      return Object.assign({ shouldPrefetch: delta >= 6 || !!conversation.pendingAdvance, envelopeHash: turn.envelopeHash }, publicSnapshot(state, conversation));
    });
  }

  function failTurn(input) {
    var scope = normalizeScope(input);
    var paths = pathsFor(scope);
    return withLock(scope, function () {
      contextFor(scope);
      var state = loadOrMigrate(paths, scope);
      var conversation = ensureConversation(paths, state, scope);
      var turn = conversation.turns[input.clientTurnId];
      if (!turn || turn.turnState === "COMPLETED") return publicSnapshot(state, conversation);
      if (turn.turnState !== "MODEL_RUNNING") return publicSnapshot(state, conversation);
      if (!sameExecutor(turn.executor, input.executorKey) || !Number.isFinite(Number(turn.executor.expiresAt)) || Number(turn.executor.expiresAt) <= now()) throw codedError("SCOPE_STALE", "Model attempt lost its execution lease", 409);
      turn.lastAttemptId = Math.max(Number(turn.lastAttemptId) || 0, Number(turn.executor.attemptId) || 0);
      turn.turnState = input.retryable === false ? "FAILED" : "CANCELLED_RETRYABLE";
      turn.terminalResult = "error";
      turn.errorCode = String(input.errorCode || "turn_failed").slice(0, 128);
      turn.executor = null;
      turn.updatedAt = nowIso();
      state = commitManifest(paths, state);
      return publicSnapshot(state, conversation);
    });
  }

  function commitRange(input) {
    var scope = normalizeScope(input);
    var paths = pathsFor(scope);
    var startPage = Number(input.startPage);
    var endPage = Number(input.endPage);
    var expected = input && input.expectedSnapshot;
    var metadata = input && input.rangeMetadata;
    var committedRange = { startPage: startPage, endPage: endPage };
    if (!Number.isInteger(startPage) || startPage < 1 || !Number.isInteger(endPage) || endPage < startPage || !String(input.content || "").trim()) {
      throw codedError("advance_range_invalid", "Invalid committed reading range", 400);
    }
    if (!expected ||
        !Number.isSafeInteger(expected.ownerGeneration) ||
        !Number.isSafeInteger(expected.readingVersion) ||
        !Number.isSafeInteger(expected.causalConversationRevision)) {
      throw codedError("advance_commit_fence_required", "Authoritative jump snapshot is required", 409);
    }
    if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
      throw codedError("advance_range_metadata_invalid", "Invalid reading range metadata", 400);
    }
    if (metadata) {
      if (metadata.chunkId !== undefined) {
        if (!validSegment(metadata.chunkId)) throw codedError("advance_range_metadata_invalid", "Invalid reading chunk ID", 400);
        committedRange.chunkId = metadata.chunkId;
      }
      if (metadata.ordinal !== undefined) {
        if (!Number.isSafeInteger(metadata.ordinal) || metadata.ordinal < 1) throw codedError("advance_range_metadata_invalid", "Invalid reading range ordinal", 400);
        committedRange.ordinal = metadata.ordinal;
      }
      if (metadata.loadedOnly === true) committedRange.loadedOnly = true;
      if (metadata.jumpLoaded === true) committedRange.jumpLoaded = true;
    }
    return withLock(scope, function () {
      contextFor(scope);
      var state = loadOrMigrate(paths, scope);
      var conversation = state.conversations && state.conversations[scope.conversationId];
      if (!conversation ||
          !state.owner ||
          state.owner.conversationId !== scope.conversationId ||
          state.owner.ownerGeneration !== expected.ownerGeneration ||
          conversation.readingVersion !== expected.readingVersion ||
          conversation.causalConversationRevision !== expected.causalConversationRevision ||
          (expected.readingRange && expected.readingRange.conversationId && expected.readingRange.conversationId !== scope.conversationId)) {
        var stale = codedError("SCOPE_STALE", "Jump request snapshot is stale", 409);
        if (conversation) stale.snapshot = publicSnapshot(state, conversation);
        throw stale;
      }
      var wrapped = wrapRange(input.content, startPage, endPage);
      conversation.loadedContent = writeBlob(paths, wrapped, "reading");
      conversation.loadedRange = committedRange;
      conversation.readingVersion += 1;
      conversation.lastAdvanceServerOrdinal = conversation.serverTurnOrdinal;
      conversation.pendingAdvance = null;
      conversation.candidate = null;
      conversation.projectionStatus = "pending";
      state = commitManifest(paths, state);
      projectConversation(paths, state, scope.conversationId);
      markProjectionClean(paths, state, scope.conversationId);
      state = commitManifest(paths, state);
      return Object.assign({ reason: String(input.reason || "explicit_page_jump") }, publicSnapshot(state, state.conversations[scope.conversationId]));
    });
  }

  async function prefetchCandidate(input) {
    var scope = normalizeScope(input);
    var paths = pathsFor(scope);
    if (typeof input.loadRange !== "function") return { skipped: true, reason: "loader_unavailable" };
    var captured = await withLock(scope, function () {
      contextFor(scope);
      var state = readCommitted(paths);
      if (!state) return { skipped: true, reason: "state_unavailable" };
      if (!state.scope ||
          state.scope.accountId !== scope.accountId ||
          state.scope.profileId !== scope.profileId ||
          state.scope.worldId !== scope.worldId ||
          state.scope.textbookId !== scope.textbookId) {
        throw codedError("advance_scope_mismatch", "Authoritative state belongs to another scope", 409);
      }
      if (state.scope.sessionEpoch !== scope.sessionEpoch) return { skipped: true, reason: "stale_scope" };
      var conversation = state.conversations && state.conversations[scope.conversationId];
      if (!state.owner || state.owner.conversationId !== scope.conversationId || !conversation) return { skipped: true, reason: "inactive_owner" };
      return {
        scopeGeneration: state.scope.scopeGeneration,
        ownerGeneration: state.owner.ownerGeneration,
        causalConversationRevision: conversation.causalConversationRevision,
        baseReadingVersion: conversation.readingVersion,
        startPage: conversation.loadedRange.endPage + 1
      };
    });
    if (captured.skipped) return captured;
    var taskKey = lockKey(scope);
    var existing = taskRegistry.get(taskKey);
    if (existing) {
      if (existing.scope &&
          existing.scope.conversationId === scope.conversationId &&
          existing.scope.sessionEpoch === scope.sessionEpoch) return existing.promise;
      return { skipped: true, reason: "prefetch_in_flight" };
    }
    var controller = new AbortController();
    var deadlineAt = Date.now() + Math.max(1000, Math.min(120000, Number(input.timeoutMs) || 30000));
    var promise = Promise.resolve().then(function () {
      return input.loadRange({ startPage: captured.startPage, explicitPage: false, reason: "background_prefetch", scope: clone(scope), signal: controller.signal, deadlineAt: deadlineAt });
    }).then(function (loaded) {
      if (!loaded || !String(loaded.content || "").trim()) return { skipped: true, reason: "empty" };
      return withLock(scope, function () {
        contextFor(scope);
        var state = readCommitted(paths);
        var conversation = state && state.conversations && state.conversations[scope.conversationId];
        if (!state || !state.scope ||
            state.scope.accountId !== scope.accountId ||
            state.scope.profileId !== scope.profileId ||
            state.scope.worldId !== scope.worldId ||
            state.scope.textbookId !== scope.textbookId ||
            state.scope.sessionEpoch !== scope.sessionEpoch ||
            !state.owner ||
            state.owner.conversationId !== scope.conversationId ||
            !conversation ||
            state.scope.scopeGeneration !== captured.scopeGeneration ||
            state.owner.ownerGeneration !== captured.ownerGeneration ||
            conversation.causalConversationRevision !== captured.causalConversationRevision ||
            conversation.readingVersion !== captured.baseReadingVersion ||
            Number(loaded.startPage) !== captured.startPage) {
          return { skipped: true, reason: "stale" };
        }
        var blob = writeBlob(paths, wrapRange(loaded.content, Number(loaded.startPage), Number(loaded.endPage)), "candidate");
        conversation.candidate = {
          baseReadingVersion: captured.baseReadingVersion,
          startPage: Number(loaded.startPage),
          endPage: Number(loaded.endPage),
          blobRef: blob.ref,
          contentHash: blob.hash,
          createdAt: nowIso()
        };
        state = commitManifest(paths, state);
        return { stored: true, stateGeneration: state.stateGeneration };
      });
    }).finally(function () {
      if (taskRegistry.get(taskKey) && taskRegistry.get(taskKey).promise === promise) taskRegistry.delete(taskKey);
    });
    taskRegistry.set(taskKey, { controller: controller, promise: promise, deadlineAt: deadlineAt, scope: clone(scope) });
    return promise;
  }

  function syncAccount(nextState) {
    taskRegistry.forEach(function (task) {
      if (!nextState || nextState.active === false || !task.scope || task.scope.accountId !== nextState.accountId || task.scope.sessionEpoch !== nextState.sessionEpoch) task.controller.abort(codedError("advance_scope_stale"));
    });
  }

  function shutdown() {
    closed = true;
    taskRegistry.forEach(function (task) { task.controller.abort(codedError("advance_shutdown")); });
    taskRegistry.clear();
  }

  if (closed) throw codedError("advance_closed", "Auto advance is closed", 503);
  return Object.freeze({
    version: API_VERSION,
    schemaVersion: SCHEMA_VERSION,
    bootstrap: bootstrap,
    readSnapshot: readSnapshot,
    readSnapshot: readSnapshot,
    beginTurn: beginTurn,
    completeTurn: completeTurn,
    failTurn: failTurn,
    commitRange: commitRange,
    prefetchCandidate: prefetchCandidate,
    syncAccount: syncAccount,
    shutdown: shutdown,
    canonicalize: canonicalize,
    hashEnvelope: function (envelope) { return sha256(canonicalize(envelope)); },
    _readCommitted: function (scopeInput) { var scope = normalizeScope(scopeInput); return readCommitted(pathsFor(scope)); }
  });
}

module.exports = {
  API_VERSION: API_VERSION,
  SCHEMA_VERSION: SCHEMA_VERSION,
  canonicalize: canonicalize,
  createAutoAdvance: createAutoAdvance,
  parseRange: parseRange,
  wrapRange: wrapRange
};
