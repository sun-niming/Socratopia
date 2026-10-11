"use strict";

// The continuity layer deliberately implements a logical transaction rather
// than claiming that NTFS can atomically rename several files at once.  A
// journal, per-world mutex and a committed receipt make an interrupted commit
// recoverable and make a retry idempotent.

var crypto = require("crypto");
var fs = require("fs");
var fsp = fs.promises;
var path = require("path");

var locks = new Map();
var CONTINUITY_DIR = "continuity";
var SCHEMA_VERSION = 1;

function continuityError(code, message, status) {
  var error = new Error(message || code);
  error.code = code;
  error.status = status || 500;
  error.statusCode = error.status;
  return error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value == null ? "" : String(value), "utf8").digest("hex");
}

function operationHash(operationId) {
  if (typeof operationId !== "string" || !operationId || operationId.length > 2048) {
    throw continuityError("CONTINUITY_OPERATION_INVALID", "Invalid continuity operation id", 400);
  }
  return sha256(operationId);
}

function normalizeRelative(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.length > 1024 || /[\x00-\x1f]/.test(relativePath)) {
    throw continuityError("CONTINUITY_PATH_INVALID", "Invalid continuity target path", 400);
  }
  var normalized = relativePath.replace(/\\/g, "/");
  if (normalized[0] === "/" || /^[A-Za-z]:/.test(normalized) || normalized.split("/").some(function (part) { return !part || part === "." || part === ".."; })) {
    throw continuityError("CONTINUITY_PATH_INVALID", "Continuity target must be a world-relative path", 400);
  }
  return normalized;
}

function resolveInsideWorld(worldDir, relativePath) {
  if (typeof worldDir !== "string" || !worldDir) throw continuityError("CONTINUITY_SCOPE_INVALID", "Missing world directory", 400);
  var relative = normalizeRelative(relativePath);
  var root = path.resolve(worldDir);
  var absolute = path.resolve(root, relative);
  if (absolute !== root && absolute.slice(0, root.length + 1) !== root + path.sep) {
    throw continuityError("CONTINUITY_PATH_INVALID", "Continuity target escaped world scope", 400);
  }
  return { absolute: absolute, relative: relative };
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch (_) {
    return false;
  }
}

// BUG-0012 / R-23: a synchronous reader never holds an fd across an `await`, so it
// can never be the handle that makes a same-process synchronous rename fail with
// EPERM. `atomicWrite` below already closes its handle before renaming, but the
// *verification* reads of `checked.target` (which includes textbook_index.json)
// did not; that fd is closed from a JS continuation, which cannot run while the
// sync retry loop blocks the event loop. See docs/project-reconstruction/R-23.
async function readTextOrNull(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function removeIfExists(file) {
  try {
    await fsp.unlink(file);
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
}

async function atomicWrite(file, value) {
  var directory = path.dirname(file);
  await fsp.mkdir(directory, { recursive: true });
  var temp = file + ".continuity-write-" + process.pid + "-" + crypto.randomBytes(8).toString("hex");
  var handle;
  try {
    handle = await fsp.open(temp, "w");
    await handle.writeFile(value, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(temp, file);
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch (_) {}
    }
    try { await removeIfExists(temp); } catch (_) {}
    throw error;
  }
}

async function readJson(file, fallback) {
  var raw = await readTextOrNull(file);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw continuityError("CONTINUITY_JOURNAL_INVALID", "Continuity journal is invalid: " + path.basename(file), 500);
  }
}

async function writeJson(file, value) {
  return atomicWrite(file, JSON.stringify(value, null, 2) + "\n");
}

function continuityPaths(worldDir, operationId) {
  var hash = operationHash(operationId);
  var root = path.resolve(worldDir, CONTINUITY_DIR);
  return {
    root: root,
    transactions: path.join(root, "transactions"),
    receipts: path.join(root, "receipts"),
    transaction: path.join(root, "transactions", "tx_" + hash + ".json"),
    receipt: path.join(root, "receipts", hash + ".json"),
    operationHash: hash,
  };
}

async function withWorldLock(worldDir, work) {
  var key = path.resolve(worldDir);
  var previous = locks.get(key) || Promise.resolve();
  var release;
  var current = previous.catch(function () {}).then(function () {
    return new Promise(function (resolve) { release = resolve; });
  });
  locks.set(key, current);
  await previous.catch(function () {});
  try {
    return await work();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

function stageRelative(relativePath, txId) {
  return relativePath + ".continuity-stage-" + txId;
}

function backupRelative(relativePath, txId) {
  return relativePath + ".continuity-backup-" + txId;
}

function safeJournalEntry(worldDir, entry) {
  if (!entry || typeof entry !== "object") throw continuityError("CONTINUITY_JOURNAL_INVALID", "Continuity journal has an invalid entry", 500);
  var target = resolveInsideWorld(worldDir, entry.relativePath);
  var stage = entry.stageRelativePath ? resolveInsideWorld(worldDir, entry.stageRelativePath) : null;
  var backup = entry.backupRelativePath ? resolveInsideWorld(worldDir, entry.backupRelativePath) : null;
  return {
    relativePath: target.relative,
    target: target.absolute,
    stage: stage && stage.absolute,
    backup: backup && backup.absolute,
    oldExists: !!entry.oldExists,
    oldHash: entry.oldHash == null ? null : String(entry.oldHash),
    newHash: entry.newHash == null ? null : String(entry.newHash),
    deleting: !!entry.deleting,
    state: entry.state || "pending",
  };
}

async function verifyHash(file, expectedHash, shouldExist) {
  var content = await readTextOrNull(file);
  if (!shouldExist) return content == null;
  return content != null && sha256(content) === expectedHash;
}

async function cleanupJournalArtifacts(worldDir, journal) {
  var entries = Array.isArray(journal.targets) ? journal.targets : [];
  for (var index = 0; index < entries.length; index += 1) {
    var entry = safeJournalEntry(worldDir, entries[index]);
    if (entry.stage) await removeIfExists(entry.stage);
    if (entry.backup) await removeIfExists(entry.backup);
  }
}

async function rollbackJournal(worldDir, journal) {
  var entries = Array.isArray(journal.targets) ? journal.targets.slice().reverse() : [];
  for (var index = 0; index < entries.length; index += 1) {
    var entry = safeJournalEntry(worldDir, entries[index]);
    var hasBackup = entry.backup && await exists(entry.backup);
    var hasTarget = await exists(entry.target);
    if (hasBackup) {
      if (hasTarget) await removeIfExists(entry.target);
      await fsp.mkdir(path.dirname(entry.target), { recursive: true });
      await fsp.rename(entry.backup, entry.target);
      if (!await verifyHash(entry.target, entry.oldHash, entry.oldExists)) {
        throw continuityError("CONTINUITY_RECOVERY_REQUIRED", "Continuity rollback hash verification failed", 503);
      }
    } else if (!entry.oldExists && hasTarget) {
      await removeIfExists(entry.target);
    } else if (entry.oldExists && entry.state !== "pending" && !await verifyHash(entry.target, entry.oldHash, true)) {
      throw continuityError("CONTINUITY_RECOVERY_REQUIRED", "Continuity rollback backup is missing", 503);
    }
    if (entry.stage) await removeIfExists(entry.stage);
  }
}

async function journalHasAllNewContent(worldDir, journal) {
  var entries = Array.isArray(journal.targets) ? journal.targets : [];
  for (var index = 0; index < entries.length; index += 1) {
    var entry = safeJournalEntry(worldDir, entries[index]);
    if (!await verifyHash(entry.target, entry.newHash, !entry.deleting)) return false;
  }
  return true;
}

function buildReceipt(journal) {
  return {
    schemaVersion: SCHEMA_VERSION,
    status: "committed",
    operationId: journal.operationId,
    operationHash: journal.operationHash,
    scope: journal.scope || null,
    companion: journal.companion || null,
    committedAt: journal.committedAt || new Date().toISOString(),
    targets: (journal.targets || []).map(function (entry) {
      return {
        relativePath: entry.relativePath,
        oldHash: entry.oldHash == null ? null : entry.oldHash,
        newHash: entry.newHash == null ? null : entry.newHash,
        deleting: !!entry.deleting,
      };
    }),
    payload: journal.receiptPayload || null,
  };
}

async function recoverJournalUnlocked(worldDir, journalFile) {
  var journal = await readJson(journalFile, null);
  if (!journal) return { recovered: false };
  if (!journal.operationId || !journal.operationHash || !Array.isArray(journal.targets)) {
    throw continuityError("CONTINUITY_RECOVERY_REQUIRED", "Continuity journal lacks recovery metadata", 503);
  }
  var paths = continuityPaths(worldDir, journal.operationId);
  if (paths.operationHash !== journal.operationHash) {
    throw continuityError("CONTINUITY_RECOVERY_REQUIRED", "Continuity journal operation hash mismatch", 503);
  }
  var receipt = await readJson(paths.receipt, null);
  if (receipt && receipt.status === "committed") {
    await cleanupJournalArtifacts(worldDir, journal);
    await removeIfExists(journalFile);
    return { recovered: true, action: "receipt-cleanup", operationId: journal.operationId };
  }
  if (journal.phase === "committing" && await journalHasAllNewContent(worldDir, journal)) {
    journal.committedAt = journal.committedAt || new Date().toISOString();
    await writeJson(paths.receipt, buildReceipt(journal));
    journal.phase = "committed";
    await writeJson(journalFile, journal);
    await cleanupJournalArtifacts(worldDir, journal);
    await removeIfExists(journalFile);
    return { recovered: true, action: "roll-forward", operationId: journal.operationId };
  }
  if (journal.phase === "prepared" || journal.phase === "committing" || journal.phase === "rolled_back" || journal.phase === "error") {
    await rollbackJournal(worldDir, journal);
    journal.phase = "rolled_back";
    await writeJson(journalFile, journal);
    await cleanupJournalArtifacts(worldDir, journal);
    await removeIfExists(journalFile);
    return { recovered: true, action: "rollback", operationId: journal.operationId };
  }
  if (journal.phase === "committed") {
    journal.committedAt = journal.committedAt || new Date().toISOString();
    await writeJson(paths.receipt, buildReceipt(journal));
    await cleanupJournalArtifacts(worldDir, journal);
    await removeIfExists(journalFile);
    return { recovered: true, action: "committed-cleanup", operationId: journal.operationId };
  }
  throw continuityError("CONTINUITY_RECOVERY_REQUIRED", "Unknown continuity journal phase: " + journal.phase, 503);
}

async function recoverWorldUnlocked(worldDir) {
  var transactionDir = path.join(worldDir, CONTINUITY_DIR, "transactions");
  var names;
  try {
    names = await fsp.readdir(transactionDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  var results = [];
  for (var index = 0; index < names.length; index += 1) {
    var item = names[index];
    if (!item.isFile() || !/^tx_[a-f0-9]{64}\.json$/i.test(item.name)) continue;
    try {
      results.push(await recoverJournalUnlocked(worldDir, path.join(transactionDir, item.name)));
    } catch (error) {
      if (!error.code) error.code = "CONTINUITY_RECOVERY_REQUIRED";
      if (!error.status) error.status = 503;
      throw error;
    }
  }
  return results;
}

async function recoverWorld(worldDir) {
  return withWorldLock(worldDir, function () { return recoverWorldUnlocked(worldDir); });
}

async function readReceipt(worldDir, operationId) {
  var paths = continuityPaths(worldDir, operationId);
  var receipt = await readJson(paths.receipt, null);
  if (!receipt || receipt.status !== "committed") return null;
  if (receipt.operationHash !== paths.operationHash) {
    throw continuityError("CONTINUITY_RECEIPT_INVALID", "Continuity receipt hash mismatch", 500);
  }
  return receipt;
}

function normalizeTargets(worldDir, txId, targets) {
  if (!Array.isArray(targets) || !targets.length) throw continuityError("CONTINUITY_TARGETS_INVALID", "Continuity commit needs at least one target", 400);
  var seen = new Set();
  return targets.map(function (target) {
    if (!target || typeof target !== "object") throw continuityError("CONTINUITY_TARGETS_INVALID", "Invalid continuity target", 400);
    var resolved = resolveInsideWorld(worldDir, target.relativePath);
    if (seen.has(resolved.relative)) throw continuityError("CONTINUITY_TARGETS_INVALID", "Duplicate continuity target: " + resolved.relative, 400);
    seen.add(resolved.relative);
    var deleting = target.content === null || target.delete === true;
    return {
      relativePath: resolved.relative,
      content: deleting ? null : String(target.content == null ? "" : target.content),
      deleting: deleting,
      target: resolved.absolute,
      stageRelativePath: deleting ? null : stageRelative(resolved.relative, txId),
      backupRelativePath: backupRelative(resolved.relative, txId),
    };
  });
}

async function invokeFault(faultInjector, phase, entry, index, journal) {
  if (!faultInjector) return;
  var result = await faultInjector({
    phase: phase,
    index: index,
    relativePath: entry.relativePath,
    txId: journal.txId,
    operationId: journal.operationId,
  });
  if (result instanceof Error) throw result;
  if (result === true) throw continuityError("CONTINUITY_FAULT_INJECTED", "Continuity fault injected at " + phase, 500);
}

async function assertStillAuthorized(options, phase, entry, index, journal) {
  if (!options || typeof options.assertStillAuthorized !== "function") return;
  await options.assertStillAuthorized({
    phase: phase,
    index: index == null ? null : index,
    relativePath: entry && entry.relativePath || null,
    operationId: journal && journal.operationId || null,
    txId: journal && journal.txId || null,
  });
}

async function commit(options) {
  options = options || {};
  var worldDir = options.worldDir;
  var operationId = options.operationId;
  var paths = continuityPaths(worldDir, operationId);
  return withWorldLock(worldDir, async function () {
    await assertStillAuthorized(options, "before_recover", null, null, null);
    await recoverWorldUnlocked(worldDir);
    await assertStillAuthorized(options, "before_receipt", null, null, null);
    var prior = await readReceipt(worldDir, operationId);
    if (prior) return { committed: true, replayed: true, receipt: prior };

    var txId = "tx_" + paths.operationHash;
    var inputTargets = normalizeTargets(worldDir, txId, options.targets);
    var journal = {
      schemaVersion: SCHEMA_VERSION,
      txId: txId,
      phase: "preparing",
      operationId: operationId,
      operationHash: paths.operationHash,
      scope: options.scope || null,
      companion: options.companion || null,
      createdAt: new Date().toISOString(),
      receiptPayload: options.receiptPayload || null,
      targets: [],
    };

    try {
      await assertStillAuthorized(options, "before_prepare", null, null, journal);
      for (var index = 0; index < inputTargets.length; index += 1) {
        var input = inputTargets[index];
        var previous = await readTextOrNull(input.target);
        var stage = input.stageRelativePath ? resolveInsideWorld(worldDir, input.stageRelativePath).absolute : null;
        if (stage) {
          await atomicWrite(stage, input.content);
          if (!await verifyHash(stage, sha256(input.content), true)) {
            throw continuityError("CONTINUITY_STAGE_INVALID", "Continuity staged content hash mismatch", 500);
          }
        }
        journal.targets.push({
          relativePath: input.relativePath,
          stageRelativePath: input.stageRelativePath,
          backupRelativePath: input.backupRelativePath,
          oldExists: previous !== null,
          oldHash: previous === null ? null : sha256(previous),
          newHash: input.deleting ? null : sha256(input.content),
          deleting: input.deleting,
          state: "pending",
        });
      }
      journal.phase = "prepared";
      await writeJson(paths.transaction, journal);
      journal.phase = "committing";
      await writeJson(paths.transaction, journal);

      for (var targetIndex = 0; targetIndex < journal.targets.length; targetIndex += 1) {
        var entry = journal.targets[targetIndex];
        var checked = safeJournalEntry(worldDir, entry);
        await assertStillAuthorized(options, "before_target", checked, targetIndex, journal);
        await invokeFault(options.faultInjector, "before_backup", checked, targetIndex, journal);
        var current = await readTextOrNull(checked.target);
        if ((current === null) !== !checked.oldExists || current !== null && sha256(current) !== checked.oldHash) {
          throw continuityError("CONTINUITY_PRECONDITION_FAILED", "Continuity target changed before commit: " + checked.relativePath, 409);
        }
        if (checked.oldExists) {
          await fsp.mkdir(path.dirname(checked.backup), { recursive: true });
          await removeIfExists(checked.backup);
          await fsp.rename(checked.target, checked.backup);
          entry.state = "backed_up";
          await writeJson(paths.transaction, journal);
        }
        await invokeFault(options.faultInjector, "after_backup", checked, targetIndex, journal);
        if (!checked.deleting) {
          await fsp.mkdir(path.dirname(checked.target), { recursive: true });
          await fsp.rename(checked.stage, checked.target);
        }
        entry.state = "applied";
        await writeJson(paths.transaction, journal);
        await invokeFault(options.faultInjector, "after_apply", checked, targetIndex, journal);
      }

      if (!await journalHasAllNewContent(worldDir, journal)) {
        throw continuityError("CONTINUITY_COMMIT_INVALID", "Continuity commit hash verification failed", 500);
      }
      await assertStillAuthorized(options, "before_receipt", null, null, journal);
      journal.committedAt = new Date().toISOString();
      await writeJson(paths.receipt, buildReceipt(journal));
      journal.phase = "committed";
      await writeJson(paths.transaction, journal);
      await cleanupJournalArtifacts(worldDir, journal);
      await removeIfExists(paths.transaction);
      return { committed: true, replayed: false, receipt: await readReceipt(worldDir, operationId) };
   } catch (error) {
      // Smoke tests use this to model a process that stopped between renames.
      // Production callers never set it; normal failures recover before the
      // request returns.
      if (options.testOnlyLeaveJournal) throw error;
     try {
       await recoverJournalUnlocked(worldDir, paths.transaction);
      } catch (recoveryError) {
        if (!recoveryError.code) recoveryError.code = "CONTINUITY_RECOVERY_REQUIRED";
        throw recoveryError;
      }
      throw error;
    }
  });
}

function diagnostics(worldDir) {
  var transactionDir = path.join(worldDir, CONTINUITY_DIR, "transactions");
  try {
    return fs.readdirSync(transactionDir).filter(function (name) { return /^tx_[a-f0-9]{64}\.json$/i.test(name); }).map(function (name) {
      var journal = JSON.parse(fs.readFileSync(path.join(transactionDir, name), "utf8"));
      return {
        txId: journal.txId,
        phase: journal.phase,
        operationHash: journal.operationHash,
        targets: (journal.targets || []).map(function (entry) {
          return { relativePath: entry.relativePath, oldHash: entry.oldHash, newHash: entry.newHash, state: entry.state };
        }),
      };
    });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  sha256: sha256,
  operationHash: operationHash,
  normalizeRelative: normalizeRelative,
  resolveInsideWorld: resolveInsideWorld,
  atomicWrite: atomicWrite,
  withWorldLock: withWorldLock,
  recoverWorld: recoverWorld,
  readReceipt: readReceipt,
  commit: commit,
  diagnostics: diagnostics,
  continuityError: continuityError,
};
