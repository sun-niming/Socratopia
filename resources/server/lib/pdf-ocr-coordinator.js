"use strict";

var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var os = require("os");
var path = require("path");
var quality = require("./ocr/ocr-quality.js");
var cacheModule = require("./ocr/ocr-cache.js");

var PDF_COMMANDS = new Set(["meta", "extract", "extract_adaptive", "scan", "render", "toc"]);
var OCR_SCHEMA = "local-ocr-v3";
var RAPID_OCR_FINGERPRINT = [
  "RapidOcrOnnx.exe:115e34764b0ef9660e75c4c8b0b3ee70d92acbfaa652798f640783d7cfc0f8e6",
  "ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx:54379ae5174d026780215fc748a7f31910dee36818e63d49e17dc598ecc82df7",
  "ch_PP-OCRv5_det_mobile.onnx:4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae",
  "ch_PP-OCRv5_rec_mobile.onnx:5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5",
  "ppocrv5_dict.txt:53685c8981fdc5233ad64a62b00f6c05a061da55ccc60bff92ba0dc482f735a6"
].join(",");

function defaultEngineMarker() {
  var script = path.join(__dirname, "practice", "windows-ocr.ps1");
  var scriptHash = "missing";
  try { scriptHash = crypto.createHash("sha256").update(fs.readFileSync(script)).digest("hex"); } catch (_) {}
  return [OCR_SCHEMA, scriptHash, RAPID_OCR_FINGERPRINT, process.platform, os.release()].join(":");
}

function ocrSource(value) {
  return value === "rapidocr-v5" ? "rapidocr-v5" : value === "windows-ocr" ? "windows-ocr" : null;
}

function ocrConfidence(value) {
  value = Number(value);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function codedError(code, message) {
  var error = new Error(message || code);
  error.code = code;
  return error;
}

function requestAbortError(signal) {
  if (signal && signal.reason && signal.reason.code === "ocr_request_aborted") return signal.reason;
  return codedError("ocr_request_aborted");
}

function assertRequestActive(request) {
  if (request && request.signal && request.signal.aborted) throw requestAbortError(request.signal);
  if (request && Number.isFinite(Number(request.deadlineAt)) && Number(request.deadlineAt) <= Date.now()) throw codedError("ocr_request_deadline");
}

function validSegment(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function contained(root, candidate) {
  var relative = path.relative(root, candidate);
  return relative === "" || !!relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

function sameFileIdentity(left, right, includeMutable) {
  if (!left || !right) return false;
  if (Number(left.dev) !== Number(right.dev) || Number(left.ino) !== Number(right.ino)) return false;
  if (Number(left.birthtimeMs || 0) !== Number(right.birthtimeMs || 0)) return false;
  return !includeMutable || Number(left.size) === Number(right.size) && Number(left.mtimeMs) === Number(right.mtimeMs);
}

async function rejectSymlinkPath(root, target) {
  var relative = path.relative(root, target);
  if (!contained(root, target)) throw codedError("pdf_scope_mismatch");
  var current = root;
  var rootStat = await fs.promises.lstat(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw codedError("pdf_scope_reparse");
  for (var part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    var stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink()) throw codedError("pdf_scope_reparse");
  }
}

async function digestFile(file) {
  return new Promise(function (resolve, reject) {
    var hash = crypto.createHash("sha256");
    var stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", function (chunk) { hash.update(chunk); });
    stream.on("end", function () { resolve(hash.digest("hex")); });
  });
}

function defaultWorkerPath() {
  var source = path.join(process.cwd(), "src", "lib", "pdf-worker.mjs");
  var packaged = path.join(process.cwd(), "lib", "pdf-worker.mjs");
  if (fs.existsSync(source)) return source;
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, "pdf-worker.mjs");
}

function minimalWorkerEnvironment(nodePath) {
  var env = {};
  ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec", "TEMP", "TMP"].forEach(function (name) {
    if (process.env[name]) env[name] = process.env[name];
  });
  env.NODE_PATH = nodePath || "";
  // The packaged server itself runs under Socratopia.exe with Electron's
  // Node mode enabled. Preserve that mode for PDF worker children; otherwise
  // spawning process.execPath opens another Electron app instead of running
  // pdf-worker.mjs, and every page is reported as an OCR failure.
  if (/\.exe$/i.test(process.execPath)) env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}

function disabledCache() {
  return Object.freeze({
    initialize: async function () {},
    read: async function () { return null; },
      write: async function () {},
      purgeScope: async function () {},
      purgeProfile: async function () {},
      purgeAccount: async function () {},
  });
}

function killTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === "win32") childProcess.spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch (_) {}
}

function createDefaultWorkerRunner(options) {
  var worker = options.workerPath || defaultWorkerPath();
  var quarantine = 0;
  var maxQuarantine = Math.max(1, Number(options.maxQuarantine) || 2);
  return function runWorker(request) {
    if (quarantine >= maxQuarantine) return Promise.reject(codedError("OCR_CAPACITY_EXHAUSTED"));
    return new Promise(function (resolve, reject) {
      var output = [];
      var errors = [];
      var outputBytes = 0;
      var errorBytes = 0;
      var settled = false;
      var terminatingError = null;
      var quarantined = false;
      var reapTimer = null;
      var signal = request && request.signal;
      function cleanupSignal() {
        if (signal) signal.removeEventListener("abort", onAbort);
      }
      function settleRejected(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (reapTimer) clearTimeout(reapTimer);
        cleanupSignal();
        reject(error);
      }
      function terminate(error) {
        if (settled || terminatingError) return;
        terminatingError = error;
        clearTimeout(timer);
        cleanupSignal();
        killTree(child);
        reapTimer = setTimeout(function () {
          if (settled) return;
          quarantined = true;
          quarantine += 1;
          settleRejected(error);
        }, 5000);
      }
      function onAbort() {
        terminate(requestAbortError(signal));
      }
      var deps = path.join(process.cwd(), "deps");
      var nodePath = fs.existsSync(deps) ? [deps, process.env.NODE_PATH].filter(Boolean).join(path.delimiter) : process.env.NODE_PATH;
      var child = childProcess.spawn(process.execPath, [worker, "--coordinator-ipc"], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: minimalWorkerEnvironment(nodePath)
      });
      var deadline = Math.min(180000, Math.max(1000, Number(request.timeoutMs) || 120000));
      var timer = setTimeout(function () {
        terminate(codedError("pdf_worker_timeout"));
      }, deadline);
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) return onAbort();
      }
      child.stdout.on("data", function (chunk) {
        outputBytes += chunk.length;
        if (outputBytes > 50 * 1024 * 1024) {
          terminate(codedError("pdf_worker_output_limit"));
          return;
        }
        output.push(chunk);
      });
      child.stderr.on("data", function (chunk) {
        errorBytes += chunk.length;
        if (errorBytes <= 1024 * 1024) errors.push(chunk);
      });
      child.on("error", function (error) {
        if (settled) return;
        settleRejected(terminatingError || error);
      });
      child.on("close", function (code) {
        if (settled) {
          if (quarantined) { quarantined = false; quarantine = Math.max(0, quarantine - 1); }
          return;
        }
        if (terminatingError) return settleRejected(terminatingError);
        settled = true;
        clearTimeout(timer);
        if (reapTimer) clearTimeout(reapTimer);
        cleanupSignal();
        var stdout = Buffer.concat(output).toString("utf8").replace(/^\uFEFF/, "").trim();
        var stderr = Buffer.concat(errors).toString("utf8").replace(/^\uFEFF/, "").trim();
        if (code !== 0) {
          try { return reject(codedError(JSON.parse(stderr || stdout || "{}").error || "pdf_worker_failed")); }
          catch (_) { return reject(codedError("pdf_worker_failed", (stderr || "pdf_worker_failed").slice(0, 500))); }
        }
        try { resolve(JSON.parse(stdout || "{}")); }
        catch (_) { reject(codedError("pdf_worker_invalid_json")); }
      });
      child.stdin.end(JSON.stringify(request));
    });
  };
}

function createCoordinator(options) {
  options = options || {};
  var projectRoot = path.resolve(options.projectRoot || process.env.PROJECT_ROOT || "");
  if (!projectRoot) throw codedError("ocr_project_root_missing");
  var getAccountContext = options.getAccountContext || function () { return null; };
  var workerRunner = options.workerRunner || createDefaultWorkerRunner(options);
  var cache = options.cache || cacheModule.createCache({ root: options.cacheRoot || path.join(projectRoot, ".system", "ocr-cache-v1") });
  var queue = [];
  var activeGlobal = 0;
  var activeAccounts = new Map();
  var runningJobs = [];
  var queuedAccounts = new Map();
  var closed = false;
  var initialized = false;
  var inFlight = new Map();
  var ocrTail = Promise.resolve();
  var engineMarker = options.engineMarker || defaultEngineMarker();
  var lifecycleStates = new Map();
  var lifecycleTails = new Map();
  var treeTombstones = new Set();

  function treeKey(context, scope, level) {
    return [level, context.accountId, scope && scope.profileId || "", scope && scope.worldId || ""].join("\u001f");
  }

  function assertTreeActive(context, scope) {
    if (treeTombstones.has(treeKey(context, null, "account"))) throw codedError("ocr_scope_tombstoned");
    if (scope && treeTombstones.has(treeKey(context, scope, "profile"))) throw codedError("ocr_scope_tombstoned");
    if (scope && scope.worldId && treeTombstones.has(treeKey(context, scope, "world"))) throw codedError("ocr_scope_tombstoned");
  }

  function lifecycleKey(context, scope) {
    return crypto.createHash("sha256").update([context.accountId, scope.profileId, scope.worldId, scope.textbookId].join("\u001f")).digest("hex");
  }

  function lifecycleState(key, context, scope) {
    if (!lifecycleStates.has(key)) lifecycleStates.set(key, { generation: 0, tombstone: false, accountId: context && context.accountId, profileId: scope && scope.profileId, worldId: scope && scope.worldId, textbookId: scope && scope.textbookId });
    return lifecycleStates.get(key);
  }

  function captureLifecycle(context, scope) {
    assertTreeActive(context, scope);
    var key = lifecycleKey(context, scope);
    var state = lifecycleState(key, context, scope);
    if (state.tombstone) throw codedError("ocr_scope_tombstoned");
    return { key: key, generation: state.generation };
  }

  function assertLifecycle(snapshot) {
    var state = lifecycleState(snapshot.key);
    if (state.tombstone || state.generation !== snapshot.generation) throw codedError("ocr_scope_stale");
  }

  function withLifecycleMutation(key, callback) {
    var previous = lifecycleTails.get(key) || Promise.resolve();
    var next = previous.catch(function () {}).then(callback);
    lifecycleTails.set(key, next);
    return next.finally(function () { if (lifecycleTails.get(key) === next) lifecycleTails.delete(key); });
  }

  async function initialize() {
    var cacheDisabled = false;
    try { await cache.initialize(); }
    catch (error) {
      cacheDisabled = true;
      cache = disabledCache();
      console.warn("[ocr-cache] disabled after initialize failure:", error && error.code || "ocr_cache_initialize_failed");
    }
    initialized = true;
    return { ok: true, version: 1, cacheDisabled: cacheDisabled };
  }

  function currentContext(scope) {
    var context = getAccountContext();
    if (!context || context.active === false || !validSegment(context.accountId) || !Number.isSafeInteger(context.sessionEpoch)) throw codedError("ocr_account_state_unavailable");
    if (!scope || !validSegment(scope.accountId) || !Number.isSafeInteger(scope.sessionEpoch)) throw codedError("ocr_delivery_scope_stale");
    if (scope.accountId !== context.accountId || scope.sessionEpoch !== context.sessionEpoch) throw codedError("ocr_delivery_scope_stale");
    return context;
  }

  async function resolveAuthorizedPath(context, scope, filePath) {
    if (!scope || !validSegment(scope.profileId) || !validSegment(scope.worldId) || !validSegment(scope.textbookId)) throw codedError("ocr_scope_invalid");
    var expected = path.join(projectRoot, "accounts", context.accountId, "profiles", scope.profileId, "worlds", scope.worldId, "textbooks", scope.textbookId);
    var expectedReal;
    var fileReal;
    try {
      await rejectSymlinkPath(projectRoot, expected);
      var requestedStat = await fs.promises.lstat(path.resolve(filePath));
      if (!requestedStat.isFile() || requestedStat.isSymbolicLink()) throw codedError("pdf_path_invalid");
      expectedReal = await fs.promises.realpath(expected);
      fileReal = await fs.promises.realpath(path.resolve(filePath));
    } catch (_) { throw codedError("pdf_path_unavailable"); }
    if (!contained(expectedReal, fileReal)) throw codedError("pdf_scope_mismatch");
    var stat = await fs.promises.lstat(fileReal);
    if (!stat.isFile() || stat.isSymbolicLink()) throw codedError("pdf_path_invalid");
    if (stat.size > 256 * 1024 * 1024) throw codedError("pdf_file_too_large");
    var textbookStat = await fs.promises.lstat(expectedReal);
    if (!textbookStat.isDirectory() || textbookStat.isSymbolicLink()) throw codedError("pdf_scope_reparse");
    return { path: fileReal, stat: stat, textbookPath: expectedReal, textbookStat: textbookStat };
  }

  async function verifyAuthorizedIdentity(authorized) {
    var fileReal;
    var textbookReal;
    try {
      fileReal = await fs.promises.realpath(authorized.path);
      textbookReal = await fs.promises.realpath(authorized.textbookPath);
    } catch (_) { throw codedError("pdf_changed_during_ocr"); }
    if (fileReal !== authorized.path || textbookReal !== authorized.textbookPath) throw codedError("pdf_changed_during_ocr");
    var fileStat = await fs.promises.lstat(fileReal);
    var textbookStat = await fs.promises.lstat(textbookReal);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || !sameFileIdentity(authorized.stat, fileStat, true)) throw codedError("pdf_changed_during_ocr");
    if (!textbookStat.isDirectory() || textbookStat.isSymbolicLink() || !sameFileIdentity(authorized.textbookStat, textbookStat, false)) throw codedError("pdf_scope_generation_changed");
  }

  function runOcrExclusive(work) {
    var running = ocrTail.then(work, work);
    ocrTail = running.catch(function () {});
    return running;
  }

  function jobPriority(job) {
    return job && job.priority === "background" ? "background" : "interactive";
  }

  function schedulable(job) {
    if ((activeAccounts.get(job.accountId) || 0) < 1) return true;
    if (jobPriority(job) !== "interactive") return false;
    // An interactive read may bypass the per-account cap only when every
    // running same-account job is background work (e.g. auto-advance
    // prefetch); the global cap of 2 and the per-batch runOcrExclusive lock
    // still bound real engine contention.
    return runningJobs.every(function (running) { return running.accountId !== job.accountId || running.priority === "background"; });
  }

  function pump() {
    if (closed) return;
    while (activeGlobal < 2) {
      var index = queue.findIndex(function (job) { return jobPriority(job) === "interactive" && schedulable(job); });
      if (index < 0) index = queue.findIndex(function (job) { return schedulable(job); });
      if (index < 0) return;
      let job = queue.splice(index, 1)[0];
      queuedAccounts.set(job.accountId, Math.max(0, (queuedAccounts.get(job.accountId) || 1) - 1));
      if (job.deadlineAt <= Date.now()) {
        job.state = "settled";
        job.settle(codedError("ocr_request_deadline"));
        continue;
      }
      job.state = "running";
      activeGlobal += 1;
      activeAccounts.set(job.accountId, (activeAccounts.get(job.accountId) || 0) + 1);
      runningJobs.push(job);
      Promise.resolve().then(job.work).then(function (value) {
        job.settle(null, value);
      }, function (error) {
        job.settle(error);
      }).finally(function () {
        job.state = "settled";
        activeGlobal -= 1;
        activeAccounts.set(job.accountId, Math.max(0, (activeAccounts.get(job.accountId) || 1) - 1));
        var runningIndex = runningJobs.indexOf(job);
        if (runningIndex >= 0) runningJobs.splice(runningIndex, 1);
        pump();
      });
    }
  }

  function schedule(accountId, work, signal, deadlineAt, priority) {
    if (closed) return Promise.reject(codedError("ocr_coordinator_closed"));
    if (signal && signal.aborted) return Promise.reject(requestAbortError(signal));
    deadlineAt = Number.isFinite(Number(deadlineAt)) ? Number(deadlineAt) : Date.now() + 120000;
    if (deadlineAt <= Date.now()) return Promise.reject(codedError("ocr_request_deadline"));
    if (queue.length >= 6 || (queuedAccounts.get(accountId) || 0) >= 2) return Promise.reject(codedError("pdf_busy"));
    return new Promise(function (resolve, reject) {
      var job = { accountId: accountId, work: work, resolve: resolve, reject: reject, abortCleanup: null, deadlineTimer: null, deadlineAt: deadlineAt, state: "queued", outwardSettled: false, priority: priority === "background" ? "background" : "interactive" };
      job.settle = function (error, value) {
        if (job.outwardSettled) return false;
        job.outwardSettled = true;
        if (job.abortCleanup) job.abortCleanup();
        if (job.deadlineTimer) { clearTimeout(job.deadlineTimer); job.deadlineTimer = null; }
        if (error) reject(error);
        else resolve(value);
        return true;
      };
      function removeQueued(error) {
        if (job.state !== "queued") return false;
        var index = queue.indexOf(job);
        if (index < 0) return false;
        job.state = "settled";
        queue.splice(index, 1);
        queuedAccounts.set(accountId, Math.max(0, (queuedAccounts.get(accountId) || 1) - 1));
        job.settle(error);
        pump();
        return true;
      }
      if (signal) {
        var onAbort = function () {
          var error = requestAbortError(signal);
          if (!removeQueued(error) && job.state === "running") job.settle(error);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        job.abortCleanup = function () { signal.removeEventListener("abort", onAbort); job.abortCleanup = null; };
      }
      job.deadlineTimer = setTimeout(function () {
        var error = codedError("ocr_request_deadline");
        if (!removeQueued(error) && job.state === "running") job.settle(error);
      }, Math.max(1, deadlineAt - Date.now()));
      queue.push(job);
      queuedAccounts.set(accountId, (queuedAccounts.get(accountId) || 0) + 1);
      pump();
    });
  }

  function observeInFlight(promise, deadlineAt, signal) {
    if (signal && signal.aborted) return Promise.reject(requestAbortError(signal));
    var hasDeadline = Number.isFinite(Number(deadlineAt));
    if (!hasDeadline && !signal) return promise;
    var remaining = hasDeadline ? Number(deadlineAt) - Date.now() : 0;
    if (hasDeadline && remaining <= 0) return Promise.reject(codedError("ocr_request_deadline"));
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = hasDeadline ? setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(codedError("ocr_request_deadline"));
      }, remaining) : null;
      function onAbort() {
        if (settled) return;
        settled = true;
        cleanup();
        reject(requestAbortError(signal));
      }
      function cleanup() {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      promise.then(function (value) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      }, function (error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });
    });
  }

  function cacheKey(context, scope, pdfHash, page, language) {
    return {
      accountId: context.accountId,
      profileId: scope.profileId,
      worldId: scope.worldId,
      textbookId: scope.textbookId,
      pdfHash: pdfHash,
      page: page,
      schema: OCR_SCHEMA,
      language: language,
      dpi: 225,
      qualityVersion: "quality-v2",
      engineMarker: engineMarker
    };
  }

  function visionCacheKey(context, scope, pdfHash, page, model) {
    return {
      accountId: context.accountId,
      profileId: scope.profileId,
      worldId: scope.worldId,
      textbookId: scope.textbookId,
      pdfHash: pdfHash,
      page: page,
      schema: "vision-transcription-v1",
      language: "und",
      dpi: 144,
      qualityVersion: "vision-prompt-v1",
      engineMarker: crypto.createHash("sha256").update(String(model)).digest("hex")
    };
  }

  async function readVisionCache(request) {
    request = request || {};
    assertRequestActive(request);
    var page = Number(request.page);
    var model = String(request.model || "");
    if (!Number.isInteger(page) || page < 1 || !model || model.length > 256) throw codedError("vision_cache_request_invalid");
    var context = currentContext(request.scope);
    var lifecycle = captureLifecycle(context, request.scope);
    var authorized = await resolveAuthorizedPath(context, request.scope, request.filePath);
    assertRequestActive(request);
    var pdfHash = await digestFile(authorized.path);
    assertRequestActive(request);
    var hit = await cache.read(visionCacheKey(context, request.scope, pdfHash, page, model));
    assertRequestActive(request);
    assertLifecycle(lifecycle);
    var refreshed = currentContext(request.scope);
    if (refreshed.accountId !== context.accountId || refreshed.sessionEpoch !== context.sessionEpoch) throw codedError("ocr_delivery_scope_stale");
    await verifyAuthorizedIdentity(authorized);
    assertRequestActive(request);
    var assessed = hit && hit.source === "vision-transcription" ? quality.assess(hit.text, { expectedCjk: false, source: "vision-transcription" }) : null;
    if (!assessed || !assessed.usable) return { hit: false };
    return { hit: true, text: quality.normalize(hit.text), source: "vision-transcription", cached: true };
  }

  async function writeVisionCache(request) {
    request = request || {};
    assertRequestActive(request);
    var page = Number(request.page);
    var model = String(request.model || "");
    var text = quality.normalize(request.text);
    var assessed = quality.assess(text, { expectedCjk: false, source: "vision-transcription" });
    var expectedPdfHash = String(request.expectedPdfHash || "");
    if (!Number.isInteger(page) || page < 1 || !model || model.length > 256 || !assessed.usable || !/^[a-f0-9]{64}$/.test(expectedPdfHash)) throw codedError("vision_cache_request_invalid");
    var context = currentContext(request.scope);
    var lifecycle = captureLifecycle(context, request.scope);
    var authorized = await resolveAuthorizedPath(context, request.scope, request.filePath);
    assertRequestActive(request);
    var pdfHash = await digestFile(authorized.path);
    assertRequestActive(request);
    if (pdfHash !== expectedPdfHash) throw codedError("vision_cache_snapshot_stale");
    var key = visionCacheKey(context, request.scope, pdfHash, page, model);
    await verifyAuthorizedIdentity(authorized);
    assertRequestActive(request);
    await withLifecycleMutation(lifecycle.key, async function () {
      assertRequestActive(request);
      assertLifecycle(lifecycle);
      var refreshed = currentContext(request.scope);
      if (refreshed.accountId !== context.accountId || refreshed.sessionEpoch !== context.sessionEpoch) throw codedError("ocr_delivery_scope_stale");
      await cache.write(key, { text: text, source: "vision-transcription", language: "und", quality: assessed }, { guard: function () { assertRequestActive(request); assertLifecycle(lifecycle); currentContext(request.scope); } });
      assertRequestActive(request);
    });
    assertLifecycle(lifecycle);
    assertRequestActive(request);
    return { stored: true };
  }

  async function validateDelivery(request, context, authorized, pdfHash, lifecycle) {
    assertRequestActive(request);
    assertLifecycle(lifecycle);
    var refreshed = currentContext(request.scope);
    if (refreshed.accountId !== context.accountId || refreshed.sessionEpoch !== context.sessionEpoch) throw codedError("ocr_delivery_scope_stale");
    var afterHash = await digestFile(authorized.path);
    assertRequestActive(request);
    if (afterHash !== pdfHash) throw codedError("pdf_changed_during_ocr");
    await verifyAuthorizedIdentity(authorized);
    assertRequestActive(request);
    assertLifecycle(lifecycle);
  }

  async function execute(request, context, authorized, pdfHash, lifecycle) {
    assertRequestActive(request);
    var command = request.command;
    var expectedCjk = /^zh(?:-|$)/i.test(request.expectedLanguage || "zh-Hans-CN");
    var workerRequest = {
      command: command,
      filePath: authorized.path,
      accountId: context.accountId,
      startPage: Math.max(1, Number(request.startPage) || 1),
      endPage: Math.max(1, Number(request.endPage) || Number(request.startPage) || 1),
      targetChars: Math.min(40000, Math.max(1, Number(request.targetChars) || 15000)),
      maxPages: Math.min(30, Math.max(1, Number(request.maxPages) || 30)),
      scale: Math.min(3, Math.max(1, Number(request.scale) || 2)),
      timeoutMs: Math.min(
        Math.max(1000, Number(request.timeoutMs) || 120000),
        Number.isFinite(Number(request.deadlineAt)) ? Math.max(1, Number(request.deadlineAt) - Date.now()) : 180000
      ),
      signal: request.signal
    };
    assertRequestActive(request);
    var extracted = await workerRunner(workerRequest);
    assertRequestActive(request);
    if (command !== "extract" && command !== "extract_adaptive") {
      await validateDelivery(request, context, authorized, pdfHash, lifecycle);
      if (command === "render") {
        extracted.pdfHash = pdfHash;
        extracted.pages = (extracted.pages || []).map(function (page) {
          var pngB64 = String(page && page.pngB64 || "");
          return Object.assign({}, page, {
            imageHash: crypto.createHash("sha256").update(Buffer.from(pngB64, "base64")).digest("hex")
          });
        });
      }
      return extracted;
    }
    var pages = (extracted.pages || []).map(function (item) {
      var text = quality.normalize(item && item.text);
      var assessed = quality.assess(text, { expectedCjk: expectedCjk, source: "text-layer" });
      return { page: Number(item.page), text: text, source: assessed.usable ? "text-layer" : "unresolved", quality: assessed, error: assessed.usable ? null : assessed.reason, cached: false };
    }).filter(function (item) { return Number.isInteger(item.page) && item.page >= 1; }).sort(function (a, b) { return a.page - b.page; });
    if (command === "extract") {
      var pageMap = new Map(pages.map(function (page) { return [page.page, page]; }));
      var complete = [];
      for (var requestedPage = workerRequest.startPage; requestedPage <= workerRequest.endPage; requestedPage++) {
        complete.push(pageMap.get(requestedPage) || { page: requestedPage, text: "", source: "unresolved", quality: quality.assess("", { expectedCjk: expectedCjk, source: "text-layer" }), error: "page_missing", cached: false });
      }
      pages = complete;
    } else if (!pages.length) {
      pages = [{ page: workerRequest.startPage, text: "", source: "unresolved", quality: quality.assess("", { expectedCjk: expectedCjk, source: "text-layer" }), error: "page_missing", cached: false }];
    }
    var missing = [];
    var pendingCacheWrites = [];
    assertLifecycle(lifecycle);
    if (request.cachePolicy !== "bypass") {
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].source !== "unresolved") continue;
        var hit = await cache.read(cacheKey(context, request.scope, pdfHash, pages[i].page, request.expectedLanguage || "zh-Hans-CN"));
        var hitSource = ocrSource(hit && hit.source);
        var hitQuality = hitSource ? quality.assess(hit.text, { expectedCjk: expectedCjk, source: hitSource }) : null;
        if (hitQuality && hitSource === "rapidocr-v5" && !(ocrConfidence(hit.confidence) >= 0.55)) hitQuality = Object.assign({}, hitQuality, { usable: false, score: 0, reason: "rapidocr_low_confidence" });
        if (hit && hitSource && hitQuality.usable) {
          pages[i] = { page: pages[i].page, text: quality.normalize(hit.text), source: hitSource, quality: hitQuality, confidence: ocrConfidence(hit.confidence), error: null, cached: true, language: hit.language || request.expectedLanguage || "zh-Hans-CN", lines: Array.isArray(hit.lines) ? hit.lines : [] };
        } else missing.push(pages[i].page);
      }
    } else missing = pages.filter(function (page) { return page.source === "unresolved"; }).map(function (page) { return page.page; });
    if (missing.length) {
      var ocrPages = [];
      var appliedOcrCount = 0;
      var ocrDeadline = Date.now() + Math.min(180000, Math.max(1000, Number(request.timeoutMs) || 120000));
      // BUG-0021: fold every finished OCR batch into `pages` and persist it to the
      // OCR cache *immediately*. Previously the whole call's OCR output was only
      // cached after the batch loop (`withLifecycleMutation`), so a deadline or
      // abort in a later batch discarded every completed page. A conversation whose
      // textbook window needs more than the request fence to load then retried from
      // a cold cache and died at the same point every turn: the window never
      // committed, so `empty_window_reload` re-ran forever with `ocr_request_deadline`
      // surfaced as the assistant reply. Flushing per batch makes retries converge.
      var mergeRecognizedPages = async function () {
        if (appliedOcrCount >= ocrPages.length) return;
        var fresh = ocrPages.slice(appliedOcrCount);
        appliedOcrCount = ocrPages.length;
        var freshByPage = new Map(fresh.map(function (item) { return [Number(item.page), item]; }));
        var flushed = [];
        for (var index = 0; index < pages.length; index++) {
          if (pages[index].source !== "unresolved") continue;
          if (!freshByPage.has(pages[index].page)) continue;
          var recognized = freshByPage.get(pages[index].page);
          var recognizedText = quality.normalize(recognized.text);
          var recognizedSource = ocrSource(recognized.engine || recognized.source) || "windows-ocr";
          var recognizedQuality = quality.assess(recognizedText, { expectedCjk: expectedCjk, source: recognizedSource });
          if (recognizedSource === "rapidocr-v5" && !(ocrConfidence(recognized.confidence) >= 0.55)) recognizedQuality = Object.assign({}, recognizedQuality, { usable: false, score: 0, reason: "rapidocr_low_confidence" });
          if (recognizedQuality.usable && !recognized.error) {
            pages[index] = { page: pages[index].page, text: recognizedText, source: recognizedSource, quality: recognizedQuality, confidence: ocrConfidence(recognized.confidence), error: null, cached: false, language: recognized.language || request.expectedLanguage || "zh-Hans-CN", lines: Array.isArray(recognized.lines) ? recognized.lines : [] };
            if (request.cachePolicy !== "bypass") {
              var entry = { key: cacheKey(context, request.scope, pdfHash, pages[index].page, request.expectedLanguage || "zh-Hans-CN"), value: pages[index] };
              pendingCacheWrites.push(entry);
              flushed.push(entry);
            }
          } else {
            pages[index].quality = recognizedQuality;
            pages[index].error = recognized.error || recognizedQuality.reason || "windows_ocr_failed";
          }
        }
        for (var cursor = 0; cursor < flushed.length; cursor++) {
          var landed = false;
          try {
            await withLifecycleMutation(lifecycle.key, async function () {
              // Deliberately no assertRequestActive(): a flushed batch is exactly the
              // work a later deadline would otherwise destroy, so it must still land
              // once the caller's fence has already expired. Lifecycle/scope staleness
              // still vetoes the write, so a tombstone never repopulates a purged cache.
              assertLifecycle(lifecycle);
              currentContext(request.scope);
              await cache.write(flushed[cursor].key, flushed[cursor].value);
              landed = true;
            });
          } catch (_) { landed = false; }
          if (!landed) continue;
          var at = pendingCacheWrites.indexOf(flushed[cursor]);
          if (at >= 0) pendingCacheWrites.splice(at, 1);
        }
      };
      for (var batchOffset = 0; batchOffset < missing.length; batchOffset += 6) {
        assertRequestActive(request);
        var batch = missing.slice(batchOffset, batchOffset + 6);
        var remainingMs = Math.min(ocrDeadline, Number.isFinite(Number(request.deadlineAt)) ? Number(request.deadlineAt) : ocrDeadline) - Date.now();
        if (remainingMs < 1000) {
          ocrPages.push.apply(ocrPages, missing.slice(batchOffset).map(function (page) { return { page: page, text: "", error: "ocr_timeout" }; }));
          break;
        }
        try {
          var batchResult = await runOcrExclusive(function () {
            assertRequestActive(request);
            var call = { filePath: authorized.path, pages: batch, expectedLanguage: request.expectedLanguage || "zh-Hans-CN", accountId: context.accountId, timeoutMs: remainingMs, deadlineAt: request.deadlineAt, signal: request.signal };
            return options.ocrRunner ? options.ocrRunner(call) : workerRunner(Object.assign({ command: "ocr_pages" }, call));
          });
          assertRequestActive(request);
          ocrPages.push.apply(ocrPages, batchResult.pages || []);
        } catch (error) {
          var fenceError = null;
          try { assertRequestActive(request); } catch (pending) { fenceError = pending; }
          if (fenceError || error && (error.code === "ocr_request_aborted" || error.code === "ocr_request_deadline")) {
            await mergeRecognizedPages();
            throw fenceError || error;
          }
          ocrPages.push.apply(ocrPages, batch.map(function (page) { return { page: page, text: "", error: error && error.code || "windows_ocr_failed" }; }));
        }
        await mergeRecognizedPages();
      }
      await mergeRecognizedPages();
      for (var leftover = 0; leftover < pages.length; leftover++) {
        if (pages[leftover].source !== "unresolved" || pages[leftover].error) continue;
        pages[leftover].error = "windows_ocr_failed";
      }
    }
    assertRequestActive(request);
    await validateDelivery(request, context, authorized, pdfHash, lifecycle);
    await withLifecycleMutation(lifecycle.key, async function () {
      assertRequestActive(request);
      assertLifecycle(lifecycle);
      for (var cacheIndex = 0; cacheIndex < pendingCacheWrites.length; cacheIndex++) {
        assertRequestActive(request);
        try { await cache.write(pendingCacheWrites[cacheIndex].key, pendingCacheWrites[cacheIndex].value, { guard: function () { assertRequestActive(request); assertLifecycle(lifecycle); currentContext(request.scope); } }); }
        catch (cacheWriteError) { console.warn("[ocr-cache] write skipped:", cacheWriteError && cacheWriteError.code || "ocr_cache_write_failed"); }
      }
    });
    assertLifecycle(lifecycle);
    var start = workerRequest.startPage;
    var contiguousEnd = start - 1;
    var contiguous = [];
    var contiguousChars = 0;
    var charBudget = Math.max(1, Number(workerRequest.targetChars) || 15000);
    var budgetCapped = false;
    var blocked = false;
    var supplemental = [];
    for (var k = 0; k < pages.length; k++) {
      var usable = pages[k].quality && pages[k].quality.usable && !!pages[k].text;
      // OCR 回填会显著放大单页字符数，worker 端的 targetChars 在拼接处必须再把守一次；
      // 至少保留第一页，达到预算后停止扩展连续窗口（语义与 pdf-worker 的 push-then-break 一致）。
      var withinBudget = contiguous.length === 0 || contiguousChars < charBudget;
      if (!blocked && withinBudget && pages[k].page === contiguousEnd + 1 && usable) {
        contiguousEnd = pages[k].page;
        contiguous.push(pages[k]);
        contiguousChars += pages[k].text.length;
      } else {
        if (!blocked && withinBudget && pages[k].page === contiguousEnd + 1 && !usable) blocked = true;
        if (!withinBudget && usable) budgetCapped = true;
        if (usable) supplemental.push(pages[k]);
      }
    }
    if (budgetCapped) console.warn("[pdf-ocr] contiguous window capped at targetChars", { targetChars: charBudget, contiguousChars: contiguousChars, contiguousEnd: contiguousEnd });
    var failedPages = pages.filter(function (page) { return !(page.quality && page.quality.usable && page.text); }).map(function (page) { return { page: page.page, reason: page.error || "unresolved" }; });
    var requestedPages = pages.map(function (page) { return page.page; });
    var sourcesByPage = {};
    pages.forEach(function (page) { sourcesByPage[String(page.page)] = page.source; });
    var text = contiguous.map(function (page) { return "--- 第 " + page.page + " 页 ---\n" + page.text; }).join("\n\n");
    return {
      pages: pages,
      pageResults: pages,
      text: text,
      totalChars: text.length,
      totalBodyChars: contiguous.reduce(function (sum, page) { return sum + page.text.length; }, 0),
      startPage: start,
      endPage: contiguousEnd,
      attemptedEndPage: pages.length ? pages[pages.length - 1].page : start - 1,
      contiguousUsableEndPage: contiguousEnd,
      requestedPages: requestedPages,
      successfulPages: pages.filter(function (page) { return page.quality && page.quality.usable && page.text; }).map(function (page) { return page.page; }),
      failedPages: failedPages,
      status: failedPages.length ? "processed_with_failures" : "transcription_complete",
      processingComplete: true,
      transcriptionComplete: failedPages.length === 0,
      sourcesByPage: sourcesByPage,
      supplementalPages: supplemental,
      metadata: extracted.metadata || {}
    };
  }

  function run(request) {
    if (!initialized) return Promise.reject(codedError("ocr_coordinator_not_ready"));
    if (!request || !PDF_COMMANDS.has(request.command)) return Promise.reject(codedError("pdf_command_invalid"));
    var context;
    var lifecycle;
    try { assertRequestActive(request); context = currentContext(request.scope); lifecycle = captureLifecycle(context, request.scope); } catch (error) { return Promise.reject(error); }
    var operation = resolveAuthorizedPath(context, request.scope, request.filePath).then(async function (authorized) {
      var pdfHash = await digestFile(authorized.path);
      var singleKey = crypto.createHash("sha256").update(JSON.stringify([context.accountId, request.scope, lifecycle.generation, pdfHash, request.command, request.startPage, request.endPage, request.targetChars, request.maxPages, request.expectedLanguage, Number.isFinite(Number(request.deadlineAt)) ? Number(request.deadlineAt) : null])).digest("hex");
      var useSingleFlight = request.cachePolicy !== "bypass" && !request.signal;
      if (useSingleFlight && inFlight.has(singleKey)) return observeInFlight(inFlight.get(singleKey), request.deadlineAt);
      var promise = schedule(context.accountId, function () { return execute(request, context, authorized, pdfHash, lifecycle); }, request.signal, request.deadlineAt, request.priority === "background" ? "background" : "interactive");
      if (useSingleFlight) {
        inFlight.set(singleKey, promise);
        promise.finally(function () { if (inFlight.get(singleKey) === promise) inFlight.delete(singleKey); }).catch(function () {});
      }
      return promise;
    });
    return observeInFlight(operation, request.deadlineAt, request.signal);
  }

  function purgeScope(scope) {
    var context;
    try { context = currentContext(scope); } catch (error) { return Promise.reject(error); }
    var key = lifecycleKey(context, scope);
    return withLifecycleMutation(key, async function () {
      var state = lifecycleState(key, context, scope);
      state.generation += 1;
      state.tombstone = true;
      await cache.purgeScope({ accountId: context.accountId, profileId: scope.profileId, worldId: scope.worldId, textbookId: scope.textbookId });
      return { generation: state.generation, tombstone: true };
    });
  }

  function activateScope(scope) {
    var context;
    try { context = currentContext(scope); } catch (error) { return Promise.reject(error); }
    var key = lifecycleKey(context, scope);
    return withLifecycleMutation(key, async function () {
      var state = lifecycleState(key, context, scope);
      state.generation += 1;
      state.tombstone = false;
      return { generation: state.generation, tombstone: false };
    });
  }

  async function purgeTree(scope) {
    scope = scope || {};
    if (!validSegment(scope.accountId) || !Number.isSafeInteger(scope.sessionEpoch)) throw codedError("ocr_delivery_scope_stale");
    var context = currentContext(scope);
    var level = validSegment(scope.profileId) ? validSegment(scope.worldId) ? "world" : "profile" : "account";
    if (scope.profileId && !validSegment(scope.profileId) || scope.worldId && !validSegment(scope.worldId)) throw codedError("ocr_scope_invalid");
    treeTombstones.add(treeKey(context, scope, level));
    lifecycleStates.forEach(function (state) {
      var match = state.accountId === context.accountId && (level === "account" || state.profileId === scope.profileId && (level === "profile" || state.worldId === scope.worldId));
      if (match) { state.generation += 1; state.tombstone = true; }
    });
    if (level === "account" && typeof cache.purgeAccount === "function") await cache.purgeAccount({ accountId: context.accountId });
    else if (typeof cache.purgeProfile === "function") await cache.purgeProfile({ accountId: context.accountId, profileId: scope.profileId });
    return { level: level, tombstone: true };
  }

  function activateTree(scope) {
    scope = scope || {};
    if (!validSegment(scope.accountId) || !Number.isSafeInteger(scope.sessionEpoch)) return Promise.reject(codedError("ocr_delivery_scope_stale"));
    var context = currentContext(scope);
    var level = validSegment(scope.profileId) ? validSegment(scope.worldId) ? "world" : "profile" : "account";
    if (scope.profileId && !validSegment(scope.profileId) || scope.worldId && !validSegment(scope.worldId)) return Promise.reject(codedError("ocr_scope_invalid"));
    treeTombstones.delete(treeKey(context, scope, level));
    lifecycleStates.forEach(function (state) {
      var match = state.accountId === context.accountId && (level === "account" || state.profileId === scope.profileId && (level === "profile" || state.worldId === scope.worldId));
      if (match) { state.generation += 1; state.tombstone = false; }
    });
    return Promise.resolve({ level: level, tombstone: false });
  }

  async function shutdown() {
    closed = true;
    var pending = queue.splice(0);
    pending.forEach(function (job) {
      job.state = "settled";
      queuedAccounts.set(job.accountId, Math.max(0, (queuedAccounts.get(job.accountId) || 1) - 1));
      job.settle(codedError("ocr_coordinator_closed"));
    });
  }

  return Object.freeze({ initialize: initialize, run: run, readVisionCache: readVisionCache, writeVisionCache: writeVisionCache, purgeScope: purgeScope, activateScope: activateScope, purgeTree: purgeTree, activateTree: activateTree, shutdown: shutdown, resolveAuthorizedPath: resolveAuthorizedPath, _cache: cache });
}

module.exports = { createCoordinator: createCoordinator, codedError: codedError, digestFile: digestFile, minimalWorkerEnvironment: minimalWorkerEnvironment };
