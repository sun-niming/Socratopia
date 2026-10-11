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
// BUG-0018: how close the reported taught page must be to the window end
// before the threshold fallback may force-advance. 1 page of slack covers a
// figure-only trailing page the tutor referenced but did not "teach".
var FORCE_ADVANCE_TAIL_SLACK = 1;

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

// Body of a wrapped window without its leading range comment. Used to tell an
// empty seed (header only) apart from a window that actually carries pages.
function rangeBody(content) {
  return String(content || "").replace(/^<!--[^>]*-->\r?\n?/, "");
}

// A legacy projection file is adopted as a page window only when it parses as a
// valid wrapped range with a non-empty body. Anything else keeps the historic
// quarantine/repair path so damaged files are never promoted to authoritative.
function adoptableExternalReading(content) {
  var text = String(content || "");
  var range = parseRange(text);
  if (!range) return null;
  var startPage = Number(range.startPage);
  var endPage = Number(range.endPage);
  if (!Number.isInteger(startPage) || startPage < 1 || !Number.isInteger(endPage) || endPage < startPage) return null;
  if (!rangeBody(text).trim()) return null;
  return { startPage: startPage, endPage: endPage, content: text };
}

function pendingAdvanceVerified(pendingAdvance, conversation) {
  if (!pendingAdvance || pendingAdvance.teachingProgressVerified !== true) return false;
  if (!conversation) return true;
  if (pendingAdvance.conversationId !== conversation.conversationId) return false;
  if (typeof pendingAdvance.turnId !== "string" || !pendingAdvance.turnId) return false;
  var turn = conversation.turns && conversation.turns[pendingAdvance.turnId];
  if (!turn || turn.turnState !== "COMPLETED") return false;
  if (turn.clientTurnId !== pendingAdvance.turnId) return false;
  if (!Number.isSafeInteger(Number(pendingAdvance.serverTurnOrdinal)) || Number(pendingAdvance.serverTurnOrdinal) !== Number(turn.serverTurnOrdinal)) return false;
  if (!Number.isSafeInteger(Number(pendingAdvance.baseReadingVersion)) || Number(pendingAdvance.baseReadingVersion) !== Number(conversation.readingVersion)) return false;
  return true;
}

function normalizeAdvanceIntentText(text) {
  return String(text || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function hasAdvanceHoldIntent(text) {
  var value = normalizeAdvanceIntentText(text);
  if (!value) return false;
  var chineseBoundary = "(?:^|[。.!！?？,，；;：:\\s])";
  var advanceTarget = "(?:继续(?:进入下一)?|翻页|往下|跳到|翻到|进入下一(?:个|页|节|部分|知识点)?|下一(?:个|页|节|部分|知识点))";
  var chineseNegative = new RegExp("(?:先\\s*)?(?:别|不要|暂时(?:不要|别)|还\\s*不能)\\s*(?:再\\s*)?" + advanceTarget, "i");
  var englishNegative = /(?:^|[.!?;,：，。！？；])\s*(?:don['’]?t|do\s+not|should\s+not|must\s+not)\s+(?:continue|move\s+on|(?:jump|go)\s+to\s+page\s+\d+|go\s+to\s+the\s+next(?:\s+page|\s+section|\s+point)?)/i;
  var chinesePause = new RegExp(chineseBoundary + "(?:请\\s*)?(?:暂停(?:一下|一会儿|在这里)?|等(?:一下|一会儿)|先停(?:在这里|一下))(?=$|[。.!！?？,，；;：:\\s])", "i");
  var englishPause = /(?:^|[.!?;,])\s*(?:please\s+)?(?:not\s+yet|wait(?:\s+(?:a\s+moment|a\s+second|here))?|pause(?:\s+here)?)(?=$|[.!?;,\s])/i;
  return chineseNegative.test(value) || englishNegative.test(value) || chinesePause.test(value) || englishPause.test(value);
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  for (var attempt = 0; ; attempt++) {
    try {
      writeFileAtomic.sync(filePath, content, { encoding: "utf8", fsync: true });
      return;
    } catch (error) {
      // Windows can briefly deny replacement while another reader holds the file.
      // Keep atomic replacement: never unlink or truncate the committed file.
      //
      // BUG-0012 (2026-09-14): chat/route.js fires prefetchCandidate() WITHOUT awaiting
      // it, so this writer races the foreground post-response save on the very same
      // textbook_index.json. kb-progress.js writes it too and protects itself with a
      // 10-attempt budget (~1.1s); this one only had 5 (~375ms) and therefore kept
      // losing, killing the whole turn's progress save 3~5 times a day. Budgets must
      // stay at least this wide: attempt 0..9 with a 25ms..250ms backoff (~1.4s).
      if (process.platform !== "win32" || attempt >= 9 || !error || error.syscall !== "rename" ||
          ["EPERM", "EACCES", "EBUSY"].indexOf(error.code) < 0) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
    }
  }
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

function readProjectionJson(filePath, label) {
  var text;
  try { text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""); }
  catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw codedError("EXTERNAL_LEGACY_MUTATION_DETECTED", "Legacy " + (label || "projection") + " is unavailable", 409);
  }
  if (!text.trim()) throw codedError("EXTERNAL_LEGACY_MUTATION_DETECTED", "Legacy " + (label || "projection") + " is empty", 409);
  try { return JSON.parse(text); }
  catch (_) { throw codedError("EXTERNAL_LEGACY_MUTATION_DETECTED", "Legacy " + (label || "projection") + " is corrupt", 409); }
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
      indexPath: path.join(worldDir, "textbooks", "textbook_index.json"),
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
    var progress = readProjectionJson(paths.progressPath, "progress") || {};
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

  function textbookTotalPages(paths, textbookId) {
    var index = readJson(paths.indexPath);
    if (!index || !Array.isArray(index.textbooks)) return null;
    var entry = index.textbooks.find(function (item) { return item && String(item.id) === String(textbookId); });
    var totalPages = Number(entry && (entry.numPages || entry.totalPages));
    return Number.isSafeInteger(totalPages) && totalPages > 0 ? totalPages : null;
  }

  function normalizeTotalPages(value) {
    var totalPages = Number(value);
    return Number.isSafeInteger(totalPages) && totalPages > 0 ? totalPages : null;
  }

  function durableAssistantMessageId(paths) {
    var chat = readJson(paths.chatPath) || {};
    if (!Array.isArray(chat.messages)) return null;
    for (var index = chat.messages.length - 1; index >= 0; index -= 1) {
      var message = chat.messages[index];
      if (!message || message.role !== "assistant") continue;
      if (message.failed === true || message.notAccepted === true || message.aborted === true) continue;
      if (typeof message.id !== "string" || !message.id) continue;
      if (typeof message.content !== "string" || !message.content.trim()) continue;
      return message.id;
    }
    return null;
  }

  function hasCompletedTurn(conversation) {
    var turns = conversation && conversation.turns || {};
    return Object.keys(turns).some(function (turnId) {
      return turns[turnId] && turns[turnId].turnState === "COMPLETED";
    });
  }

  function conversationSeed(paths, scope, legacy) {
    var range = legacy.range || { startPage: 1, endPage: 1 };
    var content = legacy.reading || wrapRange("", range.startPage, range.endPage);
    var blob = writeBlob(paths, content, "reading");
    var lastAssistantMessageId = durableAssistantMessageId(paths);
    var totalPages = normalizeTotalPages(legacy.progress.totalPages || legacy.progress.numPages) || textbookTotalPages(paths, scope.textbookId);
    return {
      conversationId: scope.conversationId,
      causalConversationRevision: 0,
      readingVersion: 0,
      serverTurnOrdinal: 0,
      lastAdvanceServerOrdinal: 0,
      lastAssistantMessageId: lastAssistantMessageId,
      loadedRange: range,
      loadedContent: blob,
      totalPages: totalPages,
      atEndOfTextbook: legacy.progress.atEndOfTextbook === true,
      textbookComplete: legacy.progress.textbookComplete === true,
      textbookCompletionReason: typeof legacy.progress.textbookCompletionReason === "string" ? legacy.progress.textbookCompletionReason : null,
      activeConceptId: legacy.progress.activeConceptId || null,
      nextConceptId: legacy.progress.nextConceptId || null,
      structuredTeachingProgress: legacy.progress.structuredTeachingProgress === true,
      taughtCursor: legacy.progress.taughtCursor || null,
      completedConceptIds: Array.isArray(legacy.progress.completedConceptIds) ? legacy.progress.completedConceptIds.slice() : [],
      completedTitles: Array.isArray(legacy.progress.completedTitles) ? legacy.progress.completedTitles.slice() : [],
      pageOnlyTeachingProgress: legacy.progress.progressMode === "page_only",
      lessonStartPage: Number(legacy.progress.lessonStartPage) || null,
      lastTaughtPage: Number(legacy.progress.lastTaughtPage) || null,
      pendingAdvance: null,
      candidate: null,
      pendingExternalReading: null,
      structuredStallWarned: false,
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
    var index = readProjectionJson(paths.indexPath, "textbook index");
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
    var progress = readProjectionJson(paths.progressPath, "progress") || {};
    var projectedRange = conversation.loadedRange || {};
    progress.schemaVersion = Math.max(3, Number(progress.schemaVersion) || 0);
    progress.textbookId = state.scope.textbookId;
    progress.sourceConversationId = conversationId;
    if (conversation.totalPages) progress.totalPages = conversation.totalPages;
    progress.atEndOfTextbook = conversation.atEndOfTextbook === true;
    progress.textbookComplete = conversation.textbookComplete === true;
    progress.textbookCompletionReason = conversation.textbookCompletionReason || null;
    progress.activeConceptId = conversation.activeConceptId || null;
    progress.nextConceptId = conversation.nextConceptId || null;
    progress.structuredTeachingProgress = conversation.structuredTeachingProgress === true;
    if (conversation.pageOnlyTeachingProgress === true) progress.progressMode = "page_only";
    else if (progress.progressMode === "page_only") delete progress.progressMode;
    progress.taughtCursor = conversation.taughtCursor ? clone(conversation.taughtCursor) : null;
    progress.completedConceptIds = Array.isArray(conversation.completedConceptIds) ? conversation.completedConceptIds.slice() : [];
    progress.completedTitles = Array.isArray(conversation.completedTitles) ? conversation.completedTitles.slice() : [];
    if (Number.isInteger(Number(conversation.lessonStartPage)) && Number(conversation.lessonStartPage) > 0) progress.lessonStartPage = Number(conversation.lessonStartPage);
    if (Number.isInteger(Number(conversation.lastTaughtPage)) && Number(conversation.lastTaughtPage) > 0) progress.lastTaughtPage = Number(conversation.lastTaughtPage);
    progress.loadedCursor = {
      chunkId: projectedRange.chunkId || "loaded-" + String(projectedRange.startPage).padStart(4, "0"),
      ordinal: Number.isInteger(projectedRange.ordinal) ? projectedRange.ordinal : projectedRange.startPage,
      startPage: projectedRange.startPage,
      endPage: projectedRange.endPage,
      updatedAt: nowIso()
    };
    if (projectedRange.loadedOnly === true) progress.loadedCursor.loadedOnly = true;
    if (projectedRange.jumpLoaded === true) progress.loadedCursor.jumpLoaded = true;
    var taughtStartPage = Number(conversation.lastTaughtPage || conversation.taughtCursor && conversation.taughtCursor.startPage);
    var taughtInRange = Number.isInteger(taughtStartPage) && taughtStartPage >= Number(projectedRange.startPage) && taughtStartPage <= Number(projectedRange.endPage);
    var projectedCurrentPage = projectedRange.loadedOnly === true && Number.isInteger(taughtStartPage) && taughtStartPage > 0 || taughtInRange
      ? taughtStartPage
      : projectedRange.startPage;
    progress.currentPage = projectedCurrentPage;
    progress.updatedAt = nowIso();
    atomicWrite(paths.progressPath, JSON.stringify(progress, null, 2));
    updateIndexCurrentPage(paths, state.scope.textbookId, projectedCurrentPage);
  }

  function backupRepairState(paths, state, conversationId) {
    var stamp = nowIso().replace(/[:.]/g, "-") + "-" + crypto.randomBytes(4).toString("hex");
    var backupDir = path.join(paths.stateDir, "repair-backups", stamp);
    ensureDir(backupDir);
    var pointer = readJsonStrict(paths.pointerPath, "advance_pointer_invalid", "Reading-state pointer is invalid");
    var files = [
      { name: "current-pointer.json", source: paths.pointerPath },
      { name: "current-generation.json", source: pointer && path.join(paths.generationsDir, path.basename(pointer.manifest)) },
      { name: "current_reading.md", source: paths.readingPath },
      { name: "progress_state.json", source: paths.progressPath },
      { name: "textbook_index.json", source: paths.indexPath }
    ];
    var manifest = { schemaVersion: 1, createdAt: nowIso(), stateGeneration: state.stateGeneration, conversationId: conversationId, files: [] };
    files.forEach(function (entry) {
      if (!entry.source || !fs.existsSync(entry.source) || !fs.statSync(entry.source).isFile()) return;
      var buffer = fs.readFileSync(entry.source);
      atomicWrite(path.join(backupDir, entry.name), buffer);
      manifest.files.push({ name: entry.name, source: entry.source, hash: sha256(buffer), size: buffer.length });
    });
    atomicWrite(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    return backupDir;
  }

  function uniqueStrings(left, right) {
    var seen = new Set();
    return [].concat(left || [], right || []).map(function (value) { return String(value || ""); }).filter(function (value) {
      if (!value || value.length > 512 || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function mergeLegacyTeachingProgress(conversation, progress, conversationId) {
    var sourceMatches = String(progress.sourceConversationId || "") === conversationId;
    if (!sourceMatches) return false;
    var totalPages = normalizeTotalPages(progress.totalPages || progress.numPages);
    if (totalPages) conversation.totalPages = totalPages;
    if (progress.atEndOfTextbook === true) conversation.atEndOfTextbook = true;
    if (progress.textbookComplete === true) conversation.textbookComplete = true;
    if (typeof progress.textbookCompletionReason === "string" && progress.textbookCompletionReason) conversation.textbookCompletionReason = progress.textbookCompletionReason;
    // A page_only projection that also carries structuredTeachingProgress:true is
    // BUG-0017 legacy (the flag was armed by the protocol, not by a concept
    // marker). A page-only conversation cannot have validated concept progress,
    // so do not adopt the poisoned flag while seeding.
    if (progress.structuredTeachingProgress === true && progress.progressMode !== "page_only") conversation.structuredTeachingProgress = true;
    if (progress.progressMode === "page_only") conversation.pageOnlyTeachingProgress = true;
    if (typeof progress.activeConceptId === "string" && progress.activeConceptId && progress.activeConceptId.length <= 512) conversation.activeConceptId = progress.activeConceptId;
    if (typeof progress.nextConceptId === "string" && progress.nextConceptId && progress.nextConceptId.length <= 512) conversation.nextConceptId = progress.nextConceptId;
    if (progress.taughtCursor && typeof progress.taughtCursor === "object" && !Array.isArray(progress.taughtCursor)) conversation.taughtCursor = clone(progress.taughtCursor);
    conversation.completedConceptIds = uniqueStrings(conversation.completedConceptIds, progress.completedConceptIds);
    conversation.completedTitles = uniqueStrings(conversation.completedTitles, progress.completedTitles);
    var taughtPage = Number(progress.lastTaughtPage || progress.taughtCursor && progress.taughtCursor.startPage);
    var loadedRange = conversation.loadedRange || {};
    if (Number.isInteger(taughtPage) && taughtPage >= Number(loadedRange.startPage) && taughtPage <= Number(loadedRange.endPage)) conversation.lastTaughtPage = taughtPage;
    var lessonStartPage = Number(progress.lessonStartPage);
    if (Number.isInteger(lessonStartPage) && lessonStartPage > 0) conversation.lessonStartPage = lessonStartPage;
    return true;
  }

  function repairProjectionState(paths, state, conversationId, reason) {
    var conversation = state.conversations && state.conversations[conversationId];
    if (!conversation) throw codedError("advance_conversation_missing", "Conversation state missing", 500);
    var previousGeneration = state.stateGeneration;
    var progress = readProjectionJson(paths.progressPath, "progress") || {};
    var backupDir = backupRepairState(paths, state, conversationId);
    var sourceMatches = mergeLegacyTeachingProgress(conversation, progress, conversationId);
    conversation.projectionStatus = "pending";
    state = commitManifest(paths, state);
    projectConversation(paths, state, conversationId);
    markProjectionClean(paths, state, conversationId);
    state = commitManifest(paths, state);
    var result = {
      schemaVersion: 1,
      repairedAt: nowIso(),
      reason: String(reason || "manual_repair"),
      sourceConversationMatched: sourceMatches,
      previousGeneration: previousGeneration,
      stateGeneration: state.stateGeneration,
      textbookId: state.scope.textbookId,
      conversationId: conversationId
    };
    atomicWrite(path.join(backupDir, "repair-result.json"), JSON.stringify(result, null, 2));
    console.warn("[auto-advance] legacy projection repaired", result);
    return { state: state, result: result, backupDir: backupDir };
  }

  function normalizeTeachingProgress(input, conversation) {
    input = input || {};
    var page = Number(input.lastTaughtPage);
    var range = conversation.loadedRange || {};
    var claimedRange = input.loadedRange || {};
    if (!Number.isInteger(page) || page < Number(range.startPage) || page > Number(range.endPage)) {
      throw codedError("teaching_progress_outside_loaded_range", "Teaching progress is outside the authoritative reading range", 409);
    }
    if (Number(claimedRange.startPage) !== Number(range.startPage) || Number(claimedRange.endPage) !== Number(range.endPage)) {
      throw codedError("SCOPE_STALE", "Teaching progress reading range is stale", 409);
    }
    // C3: textbooks without a concept-card queue report page-level progress.
    // There is no concept id to validate, and none may be invented — concept
    // state is left untouched by applyTeachingProgress in this mode.
    var progressMode = input.progressMode === "page_only" ? "page_only" : "kb";
    var activeConceptId = String(input.activeConceptId || "");
    var nextConceptId = input.nextConceptId == null ? null : String(input.nextConceptId || "");
    if (progressMode === "kb") {
      if (!activeConceptId || activeConceptId.length > 512) throw codedError("teaching_progress_concept_invalid", "Invalid active concept", 400);
      if (nextConceptId && nextConceptId.length > 512) throw codedError("teaching_progress_concept_invalid", "Invalid next concept", 400);
    } else {
      activeConceptId = "";
      nextConceptId = null;
    }
    var activeIndex = Number(input.activeIndex);
    var totalPages = normalizeTotalPages(conversation.totalPages);
    var atKnownEnd = !!(totalPages && Number(range.endPage) >= totalPages);
    return {
      progressMode: progressMode,
      activeConceptId: activeConceptId,
      nextConceptId: nextConceptId || null,
      activeIndex: Number.isSafeInteger(activeIndex) && activeIndex >= 0 ? activeIndex : 0,
      newlyCompletedConceptIds: progressMode === "kb" ? uniqueStrings([], input.newlyCompletedConceptIds) : [],
      newlyCompletedTitles: progressMode === "kb" ? uniqueStrings([], input.newlyCompletedTitles) : [],
      lastTaughtPage: page,
      loadedRange: { startPage: Number(range.startPage), endPage: Number(range.endPage) },
      windowComplete: input.windowComplete === true,
      textbookComplete: input.windowComplete === true && (input.textbookComplete === true || atKnownEnd)
    };
  }

  function applyTeachingProgress(conversation, progress) {
    var wasAtEndOfTextbook = conversation.atEndOfTextbook === true;
    var wasTextbookComplete = conversation.textbookComplete === true;
    conversation.lessonStartPage = Number(conversation.lessonStartPage) || progress.loadedRange.startPage;
    conversation.lastTaughtPage = progress.lastTaughtPage;
    conversation.windowComplete = progress.windowComplete;
    conversation.atEndOfTextbook = wasAtEndOfTextbook || progress.textbookComplete === true;
    conversation.textbookComplete = wasTextbookComplete || progress.textbookComplete === true;
    if (progress.progressMode === "page_only") {
      // Positioning only: no concept ids, no completed-concept bookkeeping.
      // A page-only window can never commit a validated concept marker, so the C5
      // gate must stay open — clear any legacy/poisoned structured flag here. This
      // heals state (and projections) written before BUG-0017 on the next marker.
      conversation.structuredTeachingProgress = false;
      conversation.pageOnlyTeachingProgress = true;
      conversation.taughtCursor = {
        chunkId: "page-" + progress.lastTaughtPage,
        ordinal: progress.lastTaughtPage,
        startPage: progress.lastTaughtPage,
        endPage: progress.lastTaughtPage,
        status: "active",
        ready: true,
        committedAt: nowIso(),
        reason: "validated_page_marker"
      };
      conversation.projectionStatus = "pending";
      return;
    }
    conversation.activeConceptId = progress.activeConceptId;
    conversation.nextConceptId = progress.nextConceptId;
    conversation.pageOnlyTeachingProgress = false;
    conversation.completedConceptIds = uniqueStrings(conversation.completedConceptIds, progress.newlyCompletedConceptIds);
    conversation.completedTitles = uniqueStrings(conversation.completedTitles, progress.newlyCompletedTitles);
    conversation.structuredTeachingProgress = true;
    conversation.taughtCursor = {
      chunkId: "concept-" + progress.activeConceptId,
      ordinal: progress.activeIndex,
      startPage: progress.lastTaughtPage,
      endPage: progress.lastTaughtPage,
      status: "active",
      ready: true,
      committedAt: nowIso(),
      reason: "validated_kb_marker"
    };
    conversation.projectionStatus = "pending";
  }

  function projectionSignature(paths, state, conversationId) {
    var conversation = state.conversations[conversationId];
    var progress = readProjectionJson(paths.progressPath, "progress");
    var index = readProjectionJson(paths.indexPath, "textbook index");
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

  // The chat reading tool (read_textbook_pages) still writes the legacy
  // projection file when the learner asks to jump. Under the v2 state machine
  // that write must not move the window mid-turn (the running turn's prompt
  // snapshot is immutable), so instead of discarding it we stash the content
  // as a blob and apply it at the next beginTurn.
  function stashExternalReading(paths, state, conversationId, ownerPaths) {
    var conversation = state.conversations[conversationId];
    if (!conversation) return;
    var external = adoptableExternalReading(readText(ownerPaths.readingPath));
    if (!external) return;
    var blob = writeBlob(paths, external.content, "external");
    conversation.pendingExternalReading = {
      blobRef: blob.ref,
      contentHash: blob.hash,
      startPage: external.startPage,
      endPage: external.endPage,
      detectedAt: nowIso()
    };
    console.warn("[auto-advance] external reading window stashed for the next turn", {
      conversationId: conversationId,
      range: external.startPage + "-" + external.endPage,
      bytes: blob.size,
      note: "a page window written to the legacy projection file is applied at the next beginTurn instead of being reverted"
    });
  }

  function readPendingExternalReading(paths, conversation) {
    var pending = conversation && conversation.pendingExternalReading;
    if (!pending || typeof pending.blobRef !== "string") return null;
    var startPage = Number(pending.startPage);
    var endPage = Number(pending.endPage);
    if (!Number.isInteger(startPage) || startPage < 1 || !Number.isInteger(endPage) || endPage < startPage) return null;
    try {
      var content = readBlob(paths, pending.blobRef, pending.contentHash).toString("utf8");
      if (!rangeBody(content).trim()) return null;
      return { startPage: startPage, endPage: endPage, content: content };
    } catch (error) {
      console.warn("[auto-advance] stashed external reading is unreadable; falling back to the range loader", {
        conversationId: conversation.conversationId,
        code: error && error.code || null
      });
      return null;
    }
  }

  function conversationWindowEmpty(paths, conversation) {
    if (!conversation || !conversation.loadedContent) return true;
    try {
      var content = readBlob(paths, conversation.loadedContent.ref, conversation.loadedContent.hash).toString("utf8");
      return !rangeBody(content).trim();
    } catch (error) {
      console.warn("[auto-advance] authoritative window is unreadable; scheduling a reload", {
        conversationId: conversation.conversationId,
        code: error && error.code || null
      });
      return true;
    }
  }

  // C5: shouldForce is the only automatic advance trigger, and it stands down while
  // a validated *concept* trail exists because a threshold reload is considered
  // risky once a concept queue is being followed. BUG-0017 narrowed this: the gate
  // is armed only by a validated concept marker and is exempt for page-only
  // conversations, so reaching this branch means a KB textbook is genuinely stalled.
  // Keep the phenomenon in the log with cause/background/harm so it stays visible.
  function warnStructuredTeachingStall(conversation, delta) {
    if (conversation.structuredStallWarned === true) return;
    conversation.structuredStallWarned = true;
    console.warn("[auto-advance][C5] 阈值自动推进被已验证概念进度屏蔽", {
      conversationId: conversation.conversationId,
      turnsSinceLastAdvance: delta,
      structuredTeachingProgress: conversation.structuredTeachingProgress === true,
      pageOnlyTeachingProgress: conversation.pageOnlyTeachingProgress === true,
      cause: "beginTurn 中 shouldForce 要求门闩未武装（structuredTeachingProgress !== true 或 page_only）且 delta >= 12；条件不满足时没有兜底换窗触发器",
      background: "structuredTeachingProgress 现在只由已验证概念 marker 置位（applyTeachingProgress 的 kb 分支）；BUG-0017 之前它还会被 requiresTeachingProgress 的每个 PDF 回合置位，导致无知识库的教材永久屏蔽阈值兜底",
      harm: "窗口可无限期停在同一段教材；当页面定位缺失时模型会自行跳读（2026-09-11 KUym 第 13 章跳读事件的成因之一）",
      workaround: "用户显式跳页或 pendingAdvance 通过验证仍可换窗；C1 的窗口定位头可缓解定位缺失"
    });
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
      if (readingChanged) stashExternalReading(paths, state, conversationId, ownerPaths);
      return repairProjectionState(ownerPaths, state, conversationId, "external_legacy_mutation").state;
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
    var metadataTotalPages = textbookTotalPages(paths, scope.textbookId);
    if (metadataTotalPages) {
      var totalPagesChanged = false;
      Object.keys(state.conversations || {}).forEach(function (conversationId) {
        var conversation = state.conversations[conversationId];
        if (conversation && !normalizeTotalPages(conversation.totalPages)) {
          conversation.totalPages = metadataTotalPages;
          totalPagesChanged = true;
        }
      });
      if (totalPagesChanged) state = commitManifest(paths, state);
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
          var backupDir = backupRepairState(targetPaths, state, scope.conversationId);
          console.warn("[auto-advance] inactive legacy reading projection quarantined", { conversationId: scope.conversationId, backupDir: backupDir });
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
    // Reported position mirrors projectConversation(): a stale lastTaughtPage
    // that is outside the loaded window must not masquerade as the position.
    var committedTaughtPage = Number(conversation.lastTaughtPage || conversation.taughtCursor && conversation.taughtCursor.startPage);
    var committedTaughtInRange = Number.isInteger(committedTaughtPage) &&
      committedTaughtPage >= Number(conversation.loadedRange.startPage) &&
      committedTaughtPage <= Number(conversation.loadedRange.endPage);
    var reportedTaughtPage = conversation.loadedRange.loadedOnly === true && Number.isInteger(committedTaughtPage) && committedTaughtPage > 0 || committedTaughtInRange
      ? committedTaughtPage
      : null;
    var readingRange = {
      startPage: conversation.loadedRange.startPage,
      endPage: conversation.loadedRange.endPage,
      readingVersion: conversation.readingVersion,
      stateGeneration: state.stateGeneration,
      conversationId: conversation.conversationId,
      activeConceptId: conversation.activeConceptId || null,
      nextConceptId: conversation.nextConceptId || null,
      windowComplete: conversation.windowComplete === true,
      lastTaughtPage: reportedTaughtPage,
      totalPages: normalizeTotalPages(conversation.totalPages),
      atEndOfTextbook: conversation.atEndOfTextbook === true,
      textbookComplete: conversation.textbookComplete === true,
      textbookCompletionReason: conversation.textbookCompletionReason || null
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
      activeConceptId: conversation.activeConceptId || null,
      nextConceptId: conversation.nextConceptId || null,
      windowComplete: conversation.windowComplete === true,
      totalPages: normalizeTotalPages(conversation.totalPages),
      atEndOfTextbook: conversation.atEndOfTextbook === true,
      textbookComplete: conversation.textbookComplete === true,
      textbookCompletionReason: conversation.textbookCompletionReason || null,
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
      state = recover(paths, scope, state);
      var conversation = state.conversations && state.conversations[scope.conversationId];
      if (!conversation) return null;
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
    var page = text.match(/(?:请\s*)?(?:跳到|翻到|从)(?:\s*PDF)?\s*第?\s*(\d+)\s*页(?:开始|看起|继续)?|(?:please\s+)?(?:go|jump|move)\s+to\s+page\s+(\d+)/i);
    var requestedPage = page && (page[1] || page[2]);
    if (requestedPage) return { type: "page", page: Number(requestedPage), reason: "explicit_page_jump" };
    if (/^(?:请\s*)?(?:下一页|翻页|翻到下一页|请看下一页|next\s+page)[。.!！]?$/i.test(text)) return { type: "next", reason: "explicit_next_page" };
    return null;
  }

  function isAdvanceBlockedText(text) {
    return hasAdvanceHoldIntent(text);
  }

  function isHoldIntent(text) {
    return hasAdvanceHoldIntent(text);
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

  function markTextbookComplete(conversation, totalPages, serverTurnOrdinal, completionReason) {
    var normalizedTotalPages = normalizeTotalPages(totalPages) || normalizeTotalPages(conversation.totalPages);
    if (normalizedTotalPages) conversation.totalPages = normalizedTotalPages;
    conversation.atEndOfTextbook = true;
    conversation.textbookComplete = true;
    conversation.textbookCompletionReason = String(completionReason || conversation.textbookCompletionReason || "eof");
    conversation.nextConceptId = null;
    conversation.pendingAdvance = null;
    conversation.candidate = null;
    conversation.pendingExternalReading = null;
    conversation.projectionStatus = "pending";
    if (Number.isSafeInteger(serverTurnOrdinal)) conversation.lastAdvanceServerOrdinal = serverTurnOrdinal;
  }

  function readLoadedTotalPages(loaded) {
    return normalizeTotalPages(loaded && loaded.totalPages) ||
      normalizeTotalPages(loaded && loaded.metadata && (loaded.metadata.totalPages || loaded.metadata.numPages));
  }

  function trustedEof(loaded, requestedStart, currentEnd) {
    if (!loaded || loaded.eof !== true || Number(requestedStart) <= Number(currentEnd)) return null;
    var totalPages = readLoadedTotalPages(loaded);
    if (totalPages && (Number(requestedStart) <= totalPages || totalPages < Number(currentEnd))) return null;
    return { totalPages: totalPages, reason: totalPages ? "eof" : "eof_metadata_missing" };
  }

  function conversationAtKnownEnd(conversation) {
    var totalPages = normalizeTotalPages(conversation && conversation.totalPages);
    return !!(conversation && (conversation.atEndOfTextbook === true || conversation.textbookComplete === true || totalPages && conversation.loadedRange && conversation.loadedRange.endPage >= totalPages));
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
      if (!hasCompletedTurn(conversation)) {
        var durableParent = durableAssistantMessageId(paths);
        if (conversation.lastAssistantMessageId !== durableParent) {
          conversation.lastAssistantMessageId = durableParent;
          state = commitManifest(paths, state);
          conversation = state.conversations[scope.conversationId];
        }
      }
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
      var hold = isHoldIntent(normalized.envelope.sanitizedUserContent);
      var intent = hold ? null : explicitIntent(normalized.envelope);
      var delta = Math.max(0, ordinal - conversation.lastAdvanceServerOrdinal);
      var pendingVerified = pendingAdvanceVerified(conversation.pendingAdvance, conversation);
      var shouldCommitPending = !hold && !intent && pendingVerified && delta >= 1;
      // BUG-0017 defence in depth: even with a poisoned structured flag on disk
      // (written before the fix, or replayed from an old projection) a page-only
      // conversation must keep the threshold fallback. pageOnlyTeachingProgress is
      // the authoritative "no concept queue here" marker, so it wins over the flag.
      var structuredGateArmed = conversation.structuredTeachingProgress === true && conversation.pageOnlyTeachingProgress !== true;
      // BUG-0018: the threshold fallback must never outrun teaching. It exists
      // to unstick a window the tutor has finished but never formally completed
      // (page-only books cannot commit windowComplete while C3 stage 2 is off).
      // Firing it on turn count alone dropped untaught pages: a 22-44 window
      // force-advanced to 45-63 while lastTaughtPage was still 34, silently
      // skipping the rest of the chapter. Force only when the reported taught
      // page has (nearly) reached the window end; a conversation with no
      // marker at all keeps the legacy stall-breaker behavior.
      var forceTaughtPage = Number(conversation.lastTaughtPage) || 0;
      var forceWindowEnd = Number(conversation.loadedRange && conversation.loadedRange.endPage) || 0;
      var teachingCaughtUp = !forceTaughtPage || !forceWindowEnd || forceTaughtPage >= forceWindowEnd - FORCE_ADVANCE_TAIL_SLACK;
      var shouldForce = !hold && !intent && !structuredGateArmed && delta >= 12 && teachingCaughtUp;
      if (!shouldForce && !hold && !intent && !structuredGateArmed && delta >= 12 && !teachingCaughtUp) {
        console.log("[auto-advance] threshold force held: taught p." + forceTaughtPage + " has not reached window end " + forceWindowEnd + " (conv=" + conversation.conversationId + ", delta=" + delta + ")");
      }
      if (!shouldForce && !hold && !intent && structuredGateArmed && delta >= 12) warnStructuredTeachingStall(conversation, delta);
      var pendingExternal = readPendingExternalReading(paths, conversation);
      var transition = intent;
      if (!transition && pendingExternal) transition = { type: "page", page: pendingExternal.startPage, reason: "external_window_adopted" };
      if (!transition && (shouldCommitPending || shouldForce)) transition = { type: "next", reason: shouldForce ? "threshold_pre_turn" : "pending_pre_turn" };
      var loaded = null;
      var canFinalizeTextbook = !!transition && transition.type !== "page" &&
        (transition.reason === "explicit_next_page" || shouldCommitPending || pendingVerified);
      if (canFinalizeTextbook && conversationAtKnownEnd(conversation)) {
        markTextbookComplete(conversation, conversation.totalPages, ordinal, "known_end");
        transition = null;
      }
      if (!transition && typeof input.loadRange === "function" && conversationWindowEmpty(paths, conversation)) {
        var emptyStartPage = Number(conversation.loadedRange && conversation.loadedRange.startPage) || 1;
        transition = { type: "page", page: emptyStartPage, reason: "empty_window_reload" };
        console.warn("[auto-advance] authoritative window is empty; reloading the current range", {
          conversationId: conversation.conversationId,
          startPage: emptyStartPage,
          note: "conversationSeed seeded a header-only window from an empty current_reading.md projection"
        });
      }
      if (transition) {
        if (typeof input.loadRange !== "function") throw codedError("advance_loader_unavailable", "Range loader is unavailable", 503);
        var targetStart = transition.type === "page" ? transition.page : conversation.loadedRange.endPage + 1;
        if (transition.reason === "external_window_adopted" && pendingExternal && pendingExternal.startPage === targetStart) {
          loaded = { content: pendingExternal.content, startPage: pendingExternal.startPage, endPage: pendingExternal.endPage };
        } else if (transition.type !== "page" && conversation.candidate && conversation.candidate.baseReadingVersion === conversation.readingVersion && conversation.candidate.startPage === targetStart) {
          loaded = {
            content: readBlob(paths, conversation.candidate.blobRef, conversation.candidate.contentHash).toString("utf8"),
            startPage: conversation.candidate.startPage,
            endPage: conversation.candidate.endPage
          };
        } else {
          loaded = await input.loadRange({ startPage: targetStart, explicitPage: transition.type === "page", reason: transition.reason, scope: clone(scope), signal: input.signal, deadlineAt: input.deadlineAt });
        }
        var eofInfo = trustedEof(loaded, targetStart, conversation.loadedRange.endPage);
        if (eofInfo) {
          markTextbookComplete(conversation, eofInfo.totalPages, ordinal, eofInfo.reason);
          loaded = null;
          transition = null;
        }
        if (!loaded) {
          // A trusted EOF is a terminal state, not a failed range load.
        } else if (!String(loaded.content || "").trim() || !Number.isInteger(Number(loaded.startPage)) || !Number.isInteger(Number(loaded.endPage)) || Number(loaded.endPage) < Number(loaded.startPage)) {
          throw codedError("advance_load_failed", "无法加载目标教材页面", 409);
        }
        if (loaded && transition.type !== "page" && Number(loaded.startPage) !== conversation.loadedRange.endPage + 1) throw codedError("advance_non_adjacent", "Automatic advance must be adjacent", 409);
      }
      contextFor(scope);

      conversation.serverTurnOrdinal = ordinal;
      conversation.causalConversationRevision += 1;
      if (loaded) {
        var wrapped = wrapRange(loaded.content, Number(loaded.startPage), Number(loaded.endPage));
        conversation.loadedContent = writeBlob(paths, wrapped, "reading");
        conversation.loadedRange = { startPage: Number(loaded.startPage), endPage: Number(loaded.endPage) };
        var loadedTotalPages = readLoadedTotalPages(loaded);
        if (loadedTotalPages) conversation.totalPages = loadedTotalPages;
        conversation.atEndOfTextbook = false;
        conversation.textbookComplete = false;
        if (transition.type !== "page") {
          conversation.windowComplete = false;
          if (conversation.nextConceptId) {
            conversation.activeConceptId = conversation.nextConceptId;
            conversation.nextConceptId = null;
          }
        } else {
          conversation.nextConceptId = null;
          conversation.windowComplete = false;
        }
        conversation.readingVersion += 1;
        conversation.lastAdvanceServerOrdinal = ordinal;
        conversation.pendingAdvance = null;
        conversation.candidate = null;
        conversation.pendingExternalReading = null;
        conversation.structuredStallWarned = false;
        conversation.projectionStatus = "pending";
      }
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
        holdIntent: hold,
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
    if (isAdvanceBlockedText(text)) return false;
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
      turn.requiresTeachingProgress = input.requiresTeachingProgress === true;
      turn.advanceBlocked = turn.holdIntent === true || isAdvanceBlockedText(input.responseText);
      var alreadyAtTextbookEnd = conversation.atEndOfTextbook === true || conversation.textbookComplete === true;
      turn.completionDecision = !alreadyAtTextbookEnd && !turn.advanceBlocked && completionSignal(input.responseText, input.decision) ? "pending_advance" : "stay";
      conversation.lastAssistantMessageId = input.assistantMessageId || conversation.lastAssistantMessageId;
      conversation.causalConversationRevision += 1;
      if (alreadyAtTextbookEnd) {
        conversation.pendingAdvance = null;
      } else if (turn.completionDecision === "pending_advance") {
        conversation.pendingAdvance = {
          reason: "assistant_completion",
          turnId: input.clientTurnId,
          conversationId: conversation.conversationId,
          serverTurnOrdinal: turn.serverTurnOrdinal,
          baseReadingVersion: conversation.readingVersion,
          requiresTeachingProgress: input.requiresTeachingProgress === true,
          teachingProgressVerified: input.requiresTeachingProgress === true ? false : true,
          createdAt: nowIso()
        };
      }
      // BUG-0017: the protocol flag must not arm the C5 gate. Every PDF turn
      // carries requiresTeachingProgress=true (route.js), so arming the gate here
      // used to latch it on the very first page-only turn — and a page-only
      // textbook can never commit a validated concept marker to disarm it, which
      // killed the delta>=12 fallback forever. Only a validated concept marker
      // (applyTeachingProgress) arms the gate now; "this conversation follows the
      // teaching-progress protocol" stays on turn.requiresTeachingProgress.
      var delta = Math.max(0, conversation.serverTurnOrdinal - conversation.lastAdvanceServerOrdinal);
      state = commitManifest(paths, state);
      return Object.assign({ shouldPrefetch: delta >= 6 || !!conversation.pendingAdvance, envelopeHash: turn.envelopeHash }, publicSnapshot(state, conversation));
    });
  }

  function commitTeachingProgress(input) {
    var scope = normalizeScope(input);
    var paths = pathsFor(scope);
    return withLock(scope, function () {
      contextFor(scope);
      var state = loadOrMigrate(paths, scope);
      if (!state.owner || state.owner.conversationId !== scope.conversationId) throw codedError("SCOPE_STALE", "Conversation is no longer active", 409);
      var conversation = state.conversations && state.conversations[scope.conversationId];
      var turn = conversation && conversation.turns && conversation.turns[input.clientTurnId];
      if (!turn || turn.turnState !== "COMPLETED") throw codedError("turn_not_completed", "Teaching progress requires a completed turn", 409);
      var progress = normalizeTeachingProgress(input, conversation);
      var progressHash = sha256(canonicalize(progress));
      if (turn.teachingProgressHash) {
        if (turn.teachingProgressHash !== progressHash) throw codedError("TURN_CONFLICT", "Teaching progress changed for a completed turn", 409);
        return publicSnapshot(state, conversation);
      }
      applyTeachingProgress(conversation, progress);
      turn.teachingProgressHash = progressHash;
      turn.teachingProgressAppliedAt = nowIso();
      turn.teachingWindowComplete = progress.windowComplete;
      var terminalBeforeProgress = conversation.atEndOfTextbook === true || conversation.textbookComplete === true;
      if (terminalBeforeProgress || progress.textbookComplete === true) {
        markTextbookComplete(conversation, conversation.totalPages, turn.serverTurnOrdinal, conversation.textbookCompletionReason || "validated_textbook_complete");
        turn.completionDecision = "textbook_complete";
      } else if (turn.requiresTeachingProgress === true && progress.windowComplete === true && turn.advanceBlocked !== true) {
        if (conversation.pendingAdvance && conversation.pendingAdvance.turnId !== input.clientTurnId) {
          throw codedError("TURN_CONFLICT", "Another turn already owns the pending advance", 409);
        }
        if (!conversation.pendingAdvance) {
          conversation.pendingAdvance = {
            reason: "assistant_completion",
            turnId: input.clientTurnId,
            conversationId: conversation.conversationId,
            serverTurnOrdinal: turn.serverTurnOrdinal,
            baseReadingVersion: conversation.readingVersion,
            requiresTeachingProgress: true,
            teachingProgressVerified: true,
            createdAt: nowIso()
          };
        } else {
          conversation.pendingAdvance.conversationId = conversation.conversationId;
          conversation.pendingAdvance.turnId = input.clientTurnId;
          conversation.pendingAdvance.serverTurnOrdinal = turn.serverTurnOrdinal;
          conversation.pendingAdvance.baseReadingVersion = conversation.readingVersion;
          conversation.pendingAdvance.requiresTeachingProgress = true;
          conversation.pendingAdvance.teachingProgressVerified = true;
        }
        turn.completionDecision = "pending_advance";
      } else if (conversation.pendingAdvance && conversation.pendingAdvance.turnId === input.clientTurnId && conversation.pendingAdvance.requiresTeachingProgress === true) {
        conversation.pendingAdvance.teachingProgressVerified = progress.windowComplete;
      }
      state = commitManifest(paths, state);
      projectConversation(paths, state, scope.conversationId);
      markProjectionClean(paths, state, scope.conversationId);
      state = commitManifest(paths, state);
      return publicSnapshot(state, state.conversations[scope.conversationId]);
    });
  }

  function repairLegacyProjection(input) {
    var scope = normalizeScope(input);
    var paths = pathsFor(scope);
    return withLock(scope, function () {
      contextFor(scope);
      var state = readCommitted(paths);
      if (!state) throw codedError("advance_state_missing", "Authoritative reading state is missing", 409);
      if (!state.scope || state.scope.accountId !== scope.accountId || state.scope.profileId !== scope.profileId || state.scope.worldId !== scope.worldId || state.scope.textbookId !== scope.textbookId) {
        throw codedError("advance_scope_mismatch", "Authoritative state belongs to another scope", 409);
      }
      if (!state.owner || state.owner.conversationId !== scope.conversationId) throw codedError("SCOPE_STALE", "Conversation is no longer active", 409);
      var conversation = state.conversations && state.conversations[scope.conversationId];
      if (!conversation) throw codedError("advance_conversation_missing", "Conversation state missing", 500);
      var repaired = repairProjectionState(paths, state, scope.conversationId, "manual_repair");
      return Object.assign({ backupDir: repaired.backupDir }, repaired.result, { snapshot: publicSnapshot(repaired.state, repaired.state.conversations[scope.conversationId]) });
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
      conversation.atEndOfTextbook = false;
      conversation.textbookComplete = false;
      conversation.nextConceptId = null;
      conversation.windowComplete = false;
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
      var totalPages = normalizeTotalPages(conversation.totalPages);
      if (conversation.atEndOfTextbook === true || conversation.textbookComplete === true || totalPages && conversation.loadedRange.endPage >= totalPages) {
        return { skipped: true, reason: "textbook_complete" };
      }
      return {
        scopeGeneration: state.scope.scopeGeneration,
        ownerGeneration: state.owner.ownerGeneration,
        causalConversationRevision: conversation.causalConversationRevision,
        baseReadingVersion: conversation.readingVersion,
        currentEnd: conversation.loadedRange.endPage,
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
      var eofInfo = trustedEof(loaded, captured.startPage, captured.currentEnd);
      if (eofInfo) {
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
              conversation.readingVersion !== captured.baseReadingVersion) {
            return { skipped: true, reason: "stale" };
          }
          markTextbookComplete(conversation, eofInfo.totalPages, conversation.serverTurnOrdinal, eofInfo.reason);
          state = commitManifest(paths, state);
          projectConversation(paths, state, scope.conversationId);
          markProjectionClean(paths, state, scope.conversationId);
          state = commitManifest(paths, state);
          return { skipped: true, reason: "textbook_complete", stateGeneration: state.stateGeneration };
        });
      }
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
        var candidateTotalPages = readLoadedTotalPages(loaded);
        if (candidateTotalPages) conversation.totalPages = candidateTotalPages;
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
    commitTeachingProgress: commitTeachingProgress,
    repairLegacyProjection: repairLegacyProjection,
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
  pendingAdvanceVerified: pendingAdvanceVerified,
  parseRange: parseRange,
  wrapRange: wrapRange
};
