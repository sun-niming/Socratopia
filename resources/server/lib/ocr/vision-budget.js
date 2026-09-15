"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

function codedError(code, message) {
  var error = new Error(message || code);
  error.code = code;
  return error;
}

function sameAccount(left, right) {
  return !!left && !!right && left.active === true && right.active === true &&
    left.accountId === right.accountId && left.sessionEpoch === right.sessionEpoch;
}

function normalizedAccount(value) {
  if (!value || value.active !== true || typeof value.accountId !== "string" || !value.accountId ||
      !Number.isSafeInteger(value.sessionEpoch) || value.sessionEpoch < 0) return null;
  return { active: true, accountId: value.accountId, sessionEpoch: value.sessionEpoch };
}

function validSegment(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function normalizedScope(value) {
  if (!value || !validSegment(value.profileId) || !validSegment(value.worldId) || !validSegment(value.textbookId)) return null;
  return { profileId: value.profileId, worldId: value.worldId, textbookId: value.textbookId };
}

function createVisionBudget(options) {
  options = options || {};
  var getAccountContext = typeof options.getAccountContext === "function" ? options.getAccountContext : function () { return null; };
  var maxConcurrent = Math.min(2, Math.max(1, Math.floor(Number(options.maxConcurrent) || 1)));
  var maxPerAccount = 1;
  var maxQueued = Math.min(32, Math.max(1, Math.floor(Number(options.maxQueued) || 4)));
  var maxQueueWaitMs = Math.min(60000, Math.max(10, Number(options.maxQueueWaitMs) || 15000));
  var maxRuntimeMs = Math.min(180000, Math.max(100, Number(options.maxRuntimeMs) || 125000));
  var maxInputBytes = Math.min(64 * 1024 * 1024, Math.max(1024, Number(options.maxInputBytes) || 32 * 1024 * 1024));
  var maxOutputTokens = Math.min(8000, Math.max(1, Number(options.maxOutputTokens) || 6000));
  var maxDailyAttempts = Math.min(1000, Math.max(1, Math.floor(Number(options.maxDailyAttempts) || 20)));
  var maxPagesPerOperation = Math.min(10, Math.max(1, Math.floor(Number(options.maxPagesPerOperation) || 5)));
  var ledgerRoot = path.resolve(options.ledgerRoot || path.join(options.projectRoot || process.cwd(), ".system", "ocr-vision-budget-v1"));
  var allowedPurposes = new Set(["close-reading", "kb-builder-page"]);
  var queue = [];
  var active = new Set();
  var activeByAccount = new Map();
  var shutdownWaiters = [];
  var stopped = false;
  var accepted = 0;
  var completed = 0;
  var rejected = 0;
  var peakActive = 0;
  var peakQueued = 0;
  var ledgerTail = Promise.resolve();
  var operationCounts = new Map();

  function currentAccount() {
    try { return normalizedAccount(getAccountContext()); } catch (_) { return null; }
  }

  function assertItemAccount(item) {
    if (!sameAccount(item.account, currentAccount())) throw codedError("vision_account_changed");
  }

  function accountCount(accountId) {
    return activeByAccount.get(accountId) || 0;
  }

  function matchesScope(item, scope, level) {
    if (!item.scope) return false;
    if (level === "account") return true;
    if (item.scope.profileId !== scope.profileId) return false;
    if (level === "profile") return true;
    if (item.scope.worldId !== scope.worldId) return false;
    return level === "world" || item.scope.textbookId === scope.textbookId;
  }

  function rejectItem(item, error) {
    if (item.settled) return;
    item.settled = true;
    clearTimeout(item.queueTimer);
    if (item.externalSignal && item.externalAbort) item.externalSignal.removeEventListener("abort", item.externalAbort);
    rejected++;
    item.reject(error);
  }

  function settleShutdown() {
    if (!stopped || active.size) return;
    var waiters = shutdownWaiters.splice(0);
    waiters.forEach(function (resolve) { resolve(); });
  }

  function removeQueued(item) {
    var index = queue.indexOf(item);
    if (index >= 0) queue.splice(index, 1);
  }

  function cancelQueued(item, error) {
    removeQueued(item);
    rejectItem(item, error);
  }

  function cancelActive(item, error) {
    if (!active.has(item) || item.cancelError) return;
    item.cancelError = error;
    try { item.controller.abort(error); } catch (_) {}
  }

  function canStart(item) {
    return active.size < maxConcurrent && accountCount(item.account.accountId) < maxPerAccount;
  }

  function finishActive(item, error, value) {
    if (!active.has(item)) return;
    active.delete(item);
    clearTimeout(item.runtimeTimer);
    var count = accountCount(item.account.accountId) - 1;
    if (count > 0) activeByAccount.set(item.account.accountId, count);
    else activeByAccount.delete(item.account.accountId);
    if (item.externalSignal && item.externalAbort) item.externalSignal.removeEventListener("abort", item.externalAbort);
    if (!item.settled) {
      item.settled = true;
      if (item.cancelError) {
        rejected++;
        item.reject(item.cancelError);
      } else if (!sameAccount(item.account, currentAccount())) {
        rejected++;
        item.reject(codedError("vision_account_changed"));
      } else if (error) {
        rejected++;
        item.reject(error);
      } else {
        completed++;
        item.resolve(value);
      }
    }
    pump();
    settleShutdown();
  }

  function start(item) {
    clearTimeout(item.queueTimer);
    if (stopped) {
      rejectItem(item, codedError("vision_budget_shutdown"));
      return;
    }
    if (!sameAccount(item.account, currentAccount())) {
      rejectItem(item, codedError("vision_account_changed"));
      return;
    }
    if (item.deadlineAt <= Date.now()) {
      rejectItem(item, codedError("vision_request_deadline"));
      return;
    }
    item.controller = new AbortController();
    active.add(item);
    activeByAccount.set(item.account.accountId, accountCount(item.account.accountId) + 1);
    peakActive = Math.max(peakActive, active.size);
    var deadlineRemaining = Math.max(1, item.deadlineAt - Date.now());
    var runtimeMs = Math.min(maxRuntimeMs, deadlineRemaining);
    var deadlineWins = deadlineRemaining <= maxRuntimeMs;
    item.runtimeTimer = setTimeout(function () {
      cancelActive(item, codedError(deadlineWins ? "vision_request_deadline" : "vision_request_timeout"));
    }, runtimeMs);
    if (item.runtimeTimer.unref) item.runtimeTimer.unref();
    if (item.externalSignal) {
      item.externalAbort = function () { cancelActive(item, codedError("vision_request_cancelled")); };
      item.externalSignal.addEventListener("abort", item.externalAbort, { once: true });
      if (item.externalSignal.aborted) item.externalAbort();
    }
    Promise.resolve().then(function () {
      if (item.cancelError) throw item.cancelError;
      assertItemAccount(item);
      return reserveAttempt(item);
    }).then(function () {
      if (item.cancelError) throw item.cancelError;
      assertItemAccount(item);
      return item.execute(item.controller.signal);
    }).then(function (value) {
      finishActive(item, null, value);
    }, function (error) {
      finishActive(item, error, null);
    });
  }

  function pump() {
    if (stopped) return;
    for (var index = 0; index < queue.length && active.size < maxConcurrent;) {
      var item = queue[index];
      if (!canStart(item)) {
        index++;
        continue;
      }
      queue.splice(index, 1);
      start(item);
    }
  }

  function validateRequest(request) {
    if (!request || !allowedPurposes.has(request.purpose)) throw codedError("vision_purpose_denied");
    if (typeof request.execute !== "function") throw codedError("vision_request_invalid");
    if (request.imageCount !== 1 || !Number.isSafeInteger(request.inputBytes) || request.inputBytes < 1 || request.inputBytes > maxInputBytes ||
        !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > maxOutputTokens) {
      throw codedError("vision_request_invalid");
    }
    if (typeof request.operationId !== "string" || !/^[A-Za-z0-9_-]{8,96}$/.test(request.operationId) ||
        !Number.isInteger(request.page) || request.page < 1 || request.page > 100000) throw codedError("vision_request_invalid");
    if (!normalizedScope(request.scope)) throw codedError("vision_request_invalid");
    var hasExpectedAccount = request.expectedAccountId !== undefined || request.expectedSessionEpoch !== undefined;
    if (hasExpectedAccount && (typeof request.expectedAccountId !== "string" || !request.expectedAccountId || !Number.isSafeInteger(request.expectedSessionEpoch))) throw codedError("vision_request_invalid");
  }

  function utcDay() {
    return new Date().toISOString().slice(0, 10);
  }

  function ledgerFile(account, day) {
    var accountHash = crypto.createHash("sha256").update(account.accountId).digest("hex");
    return path.join(ledgerRoot, accountHash.slice(0, 2), accountHash + "-" + day + ".json");
  }

  async function reserveAttempt(item) {
    assertItemAccount(item);
    var operationKey = [item.account.accountId, item.account.sessionEpoch, item.operationId].join("\u001f");
    var now = Date.now();
    if (operationCounts.size > 512) {
      operationCounts.forEach(function (value, key) {
        if (now - value.updatedAt > 10 * 60 * 1000) operationCounts.delete(key);
      });
    }
    var existing = operationCounts.get(operationKey);
    if (existing && existing.count >= maxPagesPerOperation) throw codedError("vision_operation_budget_exhausted");
    var reservation = ledgerTail.catch(function () {}).then(async function () {
      assertItemAccount(item);
      var day = utcDay();
      var file = ledgerFile(item.account, day);
      await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      var record = null;
      try {
        var stat = await fs.promises.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw codedError("vision_budget_storage_unavailable");
        record = JSON.parse(await fs.promises.readFile(file, "utf8"));
      } catch (error) {
        if (!error || error.code !== "ENOENT") {
          if (error && /^vision_/.test(error.code || "")) throw error;
          throw codedError("vision_budget_storage_unavailable");
        }
      }
      var attempts = record && record.day === day && Number.isSafeInteger(record.attempts) ? record.attempts : 0;
      if (attempts >= maxDailyAttempts) throw codedError("vision_daily_budget_exhausted");
      assertItemAccount(item);
      var next = JSON.stringify({ version: 1, day: day, attempts: attempts + 1, updatedAt: new Date().toISOString() });
      var temp = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
      await fs.promises.writeFile(temp, next, { encoding: "utf8", flag: "wx", mode: 0o600 });
      try { await fs.promises.rename(temp, file); }
      catch (error) { await fs.promises.rm(temp, { force: true }).catch(function () {}); throw codedError("vision_budget_storage_unavailable"); }
      operationCounts.set(operationKey, { count: (existing && existing.count || 0) + 1, updatedAt: now });
      assertItemAccount(item);
    });
    ledgerTail = reservation.catch(function () {});
    return reservation;
  }

  function run(request) {
    if (stopped) return Promise.reject(codedError("vision_budget_shutdown"));
    try { validateRequest(request); } catch (error) { return Promise.reject(error); }
    var account = currentAccount();
    if (!account) return Promise.reject(codedError("vision_account_unavailable"));
    if (request.expectedAccountId !== undefined && (request.expectedAccountId !== account.accountId || request.expectedSessionEpoch !== account.sessionEpoch)) return Promise.reject(codedError("vision_account_changed"));
    var deadlineAt = Number.isFinite(Number(request.deadlineAt)) ? Number(request.deadlineAt) : Date.now() + maxRuntimeMs;
    if (deadlineAt <= Date.now()) return Promise.reject(codedError("vision_request_deadline"));
    var queueDeadlineAt = Math.min(deadlineAt, Date.now() + maxQueueWaitMs);
    return new Promise(function (resolve, reject) {
      var item = {
        account: account,
        scope: normalizedScope(request.scope),
        execute: request.execute,
        externalSignal: request.signal,
        resolve: resolve,
        reject: reject,
        settled: false,
        cancelError: null,
        operationId: request.operationId,
        page: request.page,
        deadlineAt: deadlineAt,
      };
      accepted++;
      if (canStart(item)) {
        start(item);
        return;
      }
      if (queue.length >= maxQueued) {
        rejectItem(item, codedError("vision_queue_full"));
        return;
      }
      if (item.externalSignal && item.externalSignal.aborted) {
        rejectItem(item, codedError("vision_request_cancelled"));
        return;
      }
      item.queueTimer = setTimeout(function () {
        cancelQueued(item, codedError(deadlineAt <= Date.now() ? "vision_request_deadline" : "vision_queue_timeout"));
        pump();
      }, Math.max(1, queueDeadlineAt - Date.now()));
      queue.push(item);
      if (item.externalSignal) {
        item.externalAbort = function () { cancelQueued(item, codedError("vision_request_cancelled")); };
        item.externalSignal.addEventListener("abort", item.externalAbort, { once: true });
      }
      peakQueued = Math.max(peakQueued, queue.length);
    });
  }

  function syncAccount(nextAccount) {
    var normalized = normalizedAccount(nextAccount);
    queue.slice().forEach(function (item) {
      if (!sameAccount(item.account, normalized)) cancelQueued(item, codedError("vision_account_changed"));
    });
    active.forEach(function (item) {
      if (!sameAccount(item.account, normalized)) cancelActive(item, codedError("vision_account_changed"));
    });
  }

  function cancelScope(scope) {
    var account = currentAccount();
    if (!account || !scope || scope.accountId !== account.accountId || scope.sessionEpoch !== account.sessionEpoch) return Promise.reject(codedError("vision_account_changed"));
    var normalized = normalizedScope(scope);
    if (!normalized) return Promise.reject(codedError("vision_request_invalid"));
    queue.slice().forEach(function (item) { if (matchesScope(item, normalized, "textbook")) cancelQueued(item, codedError("vision_scope_cancelled")); });
    active.forEach(function (item) { if (matchesScope(item, normalized, "textbook")) cancelActive(item, codedError("vision_scope_cancelled")); });
    return Promise.resolve();
  }

  function cancelTree(scope) {
    var account = currentAccount();
    if (!account || !scope || scope.accountId !== account.accountId || scope.sessionEpoch !== account.sessionEpoch) return Promise.reject(codedError("vision_account_changed"));
    var level = scope.profileId === undefined ? "account" : scope.worldId === undefined ? "profile" : "world";
    if (level !== "account" && !validSegment(scope.profileId) || level === "world" && !validSegment(scope.worldId)) return Promise.reject(codedError("vision_request_invalid"));
    var normalized = { profileId: scope.profileId, worldId: scope.worldId, textbookId: "" };
    queue.slice().forEach(function (item) { if (matchesScope(item, normalized, level)) cancelQueued(item, codedError("vision_scope_cancelled")); });
    active.forEach(function (item) { if (matchesScope(item, normalized, level)) cancelActive(item, codedError("vision_scope_cancelled")); });
    return Promise.resolve();
  }

  function shutdown() {
    if (!stopped) {
      stopped = true;
      queue.slice().forEach(function (item) { cancelQueued(item, codedError("vision_budget_shutdown")); });
      active.forEach(function (item) { cancelActive(item, codedError("vision_budget_shutdown")); });
    }
    if (!active.size) return Promise.resolve();
    return new Promise(function (resolve) { shutdownWaiters.push(resolve); });
  }

  function stats() {
    return Object.freeze({
      active: active.size,
      queued: queue.length,
      peakActive: peakActive,
      peakQueued: peakQueued,
      accepted: accepted,
      completed: completed,
      rejected: rejected,
      stopped: stopped,
      maxDailyAttempts: maxDailyAttempts,
    });
  }

  return Object.freeze({ version: 1, run: run, cancelScope: cancelScope, cancelTree: cancelTree, syncAccount: syncAccount, shutdown: shutdown, stats: stats });
}

module.exports = { createVisionBudget: createVisionBudget };
