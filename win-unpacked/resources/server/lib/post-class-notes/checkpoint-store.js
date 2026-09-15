"use strict";

// PN-004 — durable generation checkpoints.
//
// Everything the orchestrator needs to resume lives under
// `<concept-summaries>/.jobs/<conversationId>/<jobId>/`:
//
//   job.json          state machine + counters (no classroom text)
//   partition.json    slice boundaries only (no classroom text)
//   chunks/*.json     one evidence object per finished slice
//   quality.json      scoring result
//   trace.jsonl       structured run log
//
// Atomicity + Windows EPERM: write a temp file, fsync, then rename, retrying
// the whole operation up to 10 times (~1.1s), matching the budget
// `lib/progress/kb-progress.js` uses. `write-file-atomic` v7 does not retry
// renames, which is why this is hand-rolled.
//
// Plan: POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md §5.

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var JOBS_DIR = ".jobs";
var ATOMIC_ATTEMPTS = 10;
var SUCCESS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
var FAILURE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
var MAX_JOBS_PER_CONVERSATION = 5;

function codedError(code, message, details) {
  var error = new Error(message || code);
  error.code = code;
  if (details) Object.keys(details).forEach(function (key) { error[key] = details[key]; });
  return error;
}

// Same guard the compiled route uses for path segments.
function safeSegment(value) {
  var text = String(value == null ? "" : value);
  if (!text || /[\/\\]|\.\./.test(text)) {
    throw codedError("invalid_path_segment", "unsafe path segment");
  }
  return text;
}

function defaultSleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function createStore(rootDir, options) {
  var opts = options || {};
  var root = path.resolve(String(rootDir || ""));
  if (!root) throw codedError("invalid_store_root", "store root is required");
  var sleep = opts.sleep || defaultSleep;
  var fsImpl = opts.fs || fs;
  var now = opts.now || function () { return Date.now(); };
  var random = opts.random || function () { return crypto.randomBytes(6).toString("hex"); };
  var inflight = new Map();

  function jobsRoot() {
    return path.join(root, JOBS_DIR);
  }

  function conversationJobsDir(conversationId) {
    return path.join(jobsRoot(), safeSegment(conversationId));
  }

  function jobDir(conversationId, jobId) {
    return path.join(conversationJobsDir(conversationId), safeSegment(jobId));
  }

  function finalPath(conversationId) {
    return path.join(root, safeSegment(conversationId) + ".json");
  }

  async function ensureDir(dir) {
    await fsImpl.promises.mkdir(dir, { recursive: true });
  }

  function isEperm(error) {
    var code = error && error.code;
    return code === "EPERM" || code === "EACCES" || code === "EBUSY";
  }

  // §5.2 atomic write. The whole temp-write + rename sequence is retried,
  // because on Windows an antivirus or a competing handle can make either half
  // fail.
  async function atomicWrite(target, contents) {
    var dir = path.dirname(target);
    await ensureDir(dir);
    var lastError = null;
    for (var attempt = 0; attempt < ATOMIC_ATTEMPTS; attempt++) {
      var temp = path.join(dir, path.basename(target) + ".tmp-" + process.pid + "-" + random());
      try {
        var handle = await fsImpl.promises.open(temp, "w");
        try {
          await handle.writeFile(contents, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fsImpl.promises.rename(temp, target);
        return target;
      } catch (error) {
        lastError = error;
        try { await fsImpl.promises.unlink(temp); } catch (_) {}
        if (!isEperm(error)) throw error;
        // 20,40,...,200ms -> ~1.1s over ten attempts.
        await sleep(20 * (attempt + 1));
      }
    }
    throw codedError("persist_failed", "atomic write failed after " + ATOMIC_ATTEMPTS + " attempts: " + (lastError && lastError.code), {
      target: target,
      cause: lastError && lastError.code
    });
  }

  function atomicWriteJson(target, value) {
    return atomicWrite(target, JSON.stringify(value, null, 2));
  }

  async function readJson(file) {
    try {
      var raw = await fsImpl.promises.readFile(file, "utf8");
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  async function removeTree(target) {
    var resolved = path.resolve(target);
    var base = path.resolve(root);
    if (resolved === base || !resolved.startsWith(base + path.sep)) {
      throw codedError("refusing_path_outside_store", "refusing to remove " + target);
    }
    await fsImpl.promises.rm(resolved, { recursive: true, force: true });
  }

  // ---- final notes -------------------------------------------------------

  async function readFinal(conversationId) {
    var value = await readJson(finalPath(conversationId));
    if (!value || typeof value !== "object" || !Array.isArray(value.sections)) return null;
    return value;
  }

  // The previous file is only replaced once the new one is safely on disk, so a
  // failed write can never destroy a readable note (§13.2).
  function writeFinal(conversationId, summary) {
    return atomicWriteJson(finalPath(conversationId), summary);
  }

  // ---- jobs --------------------------------------------------------------

  function writeJob(conversationId, jobId, job) {
    return atomicWriteJson(path.join(jobDir(conversationId, jobId), "job.json"), job);
  }

  function readJob(conversationId, jobId) {
    return readJson(path.join(jobDir(conversationId, jobId), "job.json"));
  }

  function writePartition(conversationId, jobId, partition) {
    return atomicWriteJson(path.join(jobDir(conversationId, jobId), "partition.json"), partition);
  }

  function readPartition(conversationId, jobId) {
    return readJson(path.join(jobDir(conversationId, jobId), "partition.json"));
  }

  function writeChunk(conversationId, jobId, chunkId, evidence) {
    return atomicWriteJson(path.join(jobDir(conversationId, jobId), "chunks", safeSegment(chunkId) + ".json"), evidence);
  }

  function readChunk(conversationId, jobId, chunkId) {
    return readJson(path.join(jobDir(conversationId, jobId), "chunks", safeSegment(chunkId) + ".json"));
  }

  async function listChunks(conversationId, jobId) {
    var dir = path.join(jobDir(conversationId, jobId), "chunks");
    var names;
    try {
      names = await fsImpl.promises.readdir(dir);
    } catch (_) {
      return [];
    }
    var out = [];
    var wanted = names.filter(function (name) { return name.endsWith(".json"); }).sort();
    for (var i = 0; i < wanted.length; i++) {
      var value = await readJson(path.join(dir, wanted[i]));
      if (value) out.push(value);
    }
    return out;
  }

  function writeQuality(conversationId, jobId, quality) {
    return atomicWriteJson(path.join(jobDir(conversationId, jobId), "quality.json"), quality);
  }

  async function appendTrace(conversationId, jobId, entry) {
    var dir = jobDir(conversationId, jobId);
    await ensureDir(dir);
    // Traces are append-only; a torn final line is tolerated because readers
    // skip unparsable lines.
    await fsImpl.promises.appendFile(path.join(dir, "trace.jsonl"), JSON.stringify(entry) + "\n", "utf8");
  }

  async function readTrace(conversationId, jobId) {
    try {
      var raw = await fsImpl.promises.readFile(path.join(jobDir(conversationId, jobId), "trace.jsonl"), "utf8");
      return raw.split("\n").filter(Boolean).map(function (line) {
        try { return JSON.parse(line); } catch (_) { return null; }
      }).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  async function listJobs(conversationId) {
    var dir = conversationJobsDir(conversationId);
    var names;
    try {
      names = await fsImpl.promises.readdir(dir);
    } catch (_) {
      return [];
    }
    var jobs = [];
    for (var i = 0; i < names.length; i++) {
      var job = await readJob(conversationId, names[i]);
      if (job) jobs.push(job);
    }
    return jobs.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  // §5.4 cleanup. Never touches the final note.
  async function cleanup(cleanupOptions) {
    var cOpts = cleanupOptions || {};
    var at = Number(cOpts.now) || now();
    var maxJobs = Number(cOpts.maxJobsPerConversation) || MAX_JOBS_PER_CONVERSATION;
    var removed = [];
    var conversations;
    try {
      conversations = await fsImpl.promises.readdir(jobsRoot());
    } catch (_) {
      return { removed: removed, kept: 0 };
    }

    for (var i = 0; i < conversations.length; i++) {
      var conversationId = conversations[i];
      var jobs = await listJobs(conversationId);
      for (var j = 0; j < jobs.length; j++) {
        var job = jobs[j];
        var finished = job.status === "ready" || job.status === "degraded";
        var age = at - (job.updatedAt || job.createdAt || 0);
        var expired = finished ? age > SUCCESS_RETENTION_MS : age > FAILURE_RETENTION_MS;
        if (expired || j >= maxJobs) {
          await removeTree(jobDir(conversationId, job.jobId));
          removed.push({ conversationId: conversationId, jobId: job.jobId, reason: expired ? "expired" : "over-limit" });
        }
      }
    }
    return { removed: removed, kept: 0 };
  }

  // §5.1 / §14 single-flight: one in-flight factory per key, so a double click
  // can never start two generations for the same lesson.
  function singleFlight(key, factory) {
    if (inflight.has(key)) return inflight.get(key);
    var promise = Promise.resolve().then(factory);
    inflight.set(key, promise);
    var release = function () { inflight.delete(key); };
    promise.then(release, release);
    return promise;
  }

  function hasInflight(key) {
    return inflight.has(key);
  }

  return {
    rootDir: root,
    jobsRoot: jobsRoot,
    jobDir: jobDir,
    finalPath: finalPath,
    atomicWrite: atomicWrite,
    atomicWriteJson: atomicWriteJson,
    readJson: readJson,
    readFinal: readFinal,
    writeFinal: writeFinal,
    writeJob: writeJob,
    readJob: readJob,
    writePartition: writePartition,
    readPartition: readPartition,
    writeChunk: writeChunk,
    readChunk: readChunk,
    listChunks: listChunks,
    writeQuality: writeQuality,
    appendTrace: appendTrace,
    readTrace: readTrace,
    listJobs: listJobs,
    cleanup: cleanup,
    singleFlight: singleFlight,
    hasInflight: hasInflight,
    removeTree: removeTree
  };
}

module.exports = {
  JOBS_DIR: JOBS_DIR,
  ATOMIC_ATTEMPTS: ATOMIC_ATTEMPTS,
  SUCCESS_RETENTION_MS: SUCCESS_RETENTION_MS,
  FAILURE_RETENTION_MS: FAILURE_RETENTION_MS,
  MAX_JOBS_PER_CONVERSATION: MAX_JOBS_PER_CONVERSATION,
  createStore: createStore,
  safeSegment: safeSegment
};
