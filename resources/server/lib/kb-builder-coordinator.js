"use strict";

var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var os = require("os");
var path = require("path");
var responsesCompat = require("./responses-api-compat.js");
var publisher = require("./kb-publisher.js");

function codedError(code) {
  var error = new Error(code);
  error.code = code;
  return error;
}

function validSegment(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function sameAccount(left, right) {
  return !!left && !!right && left.active === true && right.active === true &&
    left.accountId === right.accountId && left.sessionEpoch === right.sessionEpoch;
}

function normalizedConfig(value) {
  value = value || {};
  var baseUrl = value.baseUrl || value.baseURL || "";
  if (!baseUrl || !value.apiKey || !value.model) return null;
  return { baseUrl: String(baseUrl).replace(/\/$/, ""), apiKey: value.apiKey, model: String(value.model), maxInput: Number(value.maxInput) || 8000 };
}

function normalizedOcrVisionConfig(value) {
  value = value || {};
  if (value.enabled !== true || value.userConsent !== true) return null;
  return normalizedConfig(value);
}

function minimalEnvironment(job, configs, nodePath) {
  var env = {};
  ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec", "TEMP", "TMP"].forEach(function (name) {
    if (process.env[name]) env[name] = process.env[name];
  });
  env.NODE_PATH = nodePath || "";
  env.KB_SUPERVISED = "1";
  env.KB_TEXTBOOK_DIR = job.sandboxDir;
  env.KB_SRC_PATH = job.sourceSandboxPath;
  env.KB_FORMAT = job.workerFormat;
  env.KB_TITLE = job.title;
  env.KB_LANG = job.language;
  env.KB_CARD_MODEL = configs.card.model;
  env.KB_CARD_MAXINPUT = String(configs.card.maxInput);
  env.KB_PREMIUM_MODEL = configs.premium ? configs.premium.model : "";
  env.KB_ALLOW_REMOTE_VISION = job.allowRemoteVision === true && configs.vision ? "1" : "0";
  env.KB_VISION_MODEL = job.allowRemoteVision === true && configs.vision ? configs.vision.model : "";
  env.KB_CONCURRENCY = "1";
  env.KB_CHUNK_RETRIES = "1";
  env.KB_MAX_CHUNKS = "50";
  return env;
}

function digestFile(file) {
  return new Promise(function (resolve, reject) {
    var hash = crypto.createHash("sha256");
    var stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", function (chunk) { hash.update(chunk); });
    stream.on("end", function () { resolve(hash.digest("hex")); });
  });
}

function createBoundedFrameReader(stream, limits, onFrame, onError) {
  var buffer = Buffer.alloc(0);
  var totalBytes = 0;
  var frames = 0;
  var stopped = false;
  function fail(code) {
    if (stopped) return;
    stopped = true;
    try { stream.pause(); } catch (_) {}
    onError(codedError(code));
  }
  stream.on("data", function (chunk) {
    if (stopped) return;
    totalBytes += chunk.length;
    if (totalBytes > limits.maxTotalBytes) return fail("builder_protocol_limit");
    buffer = buffer.length ? Buffer.concat([buffer, chunk], buffer.length + chunk.length) : Buffer.from(chunk);
    var newline;
    while (!stopped && (newline = buffer.indexOf(10)) >= 0) {
      var frame = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      if (frame.length && frame[frame.length - 1] === 13) frame = frame.subarray(0, frame.length - 1);
      frames += 1;
      if (!frame.length || frame.length > limits.maxFrameBytes || frames > limits.maxFrames) return fail("builder_protocol_limit");
      onFrame(frame.toString("utf8"));
    }
    if (buffer.length > limits.maxFrameBytes) fail("builder_protocol_limit");
  });
  stream.on("end", function () { if (!stopped && buffer.length) fail("builder_protocol_truncated"); });
  stream.on("error", function () { fail("builder_protocol_io"); });
  return { close: function () { stopped = true; try { stream.destroy(); } catch (_) {} } };
}

function writeResponseFrame(state, stream, value) {
  var frame = Buffer.from(JSON.stringify(value) + "\n", "utf8");
  if (frame.length > state.maxFrameBytes || state.pendingBytes + frame.length > state.maxPendingBytes) return Promise.reject(codedError("builder_protocol_backpressure"));
  state.pendingBytes += frame.length;
  var write = state.tail.catch(function () {}).then(function () {
    return new Promise(function (resolve, reject) {
      if (!stream || !stream.writable) return reject(codedError("builder_protocol_closed"));
      var timer = setTimeout(function () { reject(codedError("builder_protocol_backpressure")); }, state.timeoutMs);
      if (timer.unref) timer.unref();
      stream.write(frame, function (error) {
        clearTimeout(timer);
        if (error) reject(codedError("builder_protocol_io"));
        else resolve();
      });
    });
  }).finally(function () { state.pendingBytes -= frame.length; });
  state.tail = write;
  return write;
}

function killTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === "win32") childProcess.spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch (_) {}
}

function createBuilderCoordinator(options) {
  options = options || {};
  var projectRoot = path.resolve(options.projectRoot || "");
  var getAccountContext = options.getAccountContext || function () { return null; };
  var getModelSet = options.getModelSet || function () { return global.__SOCRATOPIA_SET__ || {}; };
  var pdfCoordinator = options.pdfOcrCoordinator;
  var visionBudget = options.visionBudget;
  var beforeArtifactCopy = typeof options.beforeArtifactCopy === "function" ? options.beforeArtifactCopy : async function () {};
  var workerPath = options.workerPath || path.join(__dirname, "kb-builder.mjs");
  var queue = [];
  var active = null;
  var stopped = false;
  var byScope = new Map();
  var treeTombstones = new Set();

  function context() {
    var value = getAccountContext();
    if (!value || value.active !== true || !validSegment(value.accountId) || !Number.isSafeInteger(value.sessionEpoch)) return null;
    return { active: true, accountId: value.accountId, sessionEpoch: value.sessionEpoch };
  }

  function scopeKey(account, scope) {
    return [account.accountId, scope.profileId, scope.worldId, scope.textbookId].join("\u001f");
  }

  function treeKey(account, scope, level) {
    return [level, account.accountId, scope && scope.profileId || "", scope && scope.worldId || ""].join("\u001f");
  }

  function treeLevel(scope) {
    return scope && validSegment(scope.profileId) ? validSegment(scope.worldId) ? "world" : "profile" : "account";
  }

  function validateTreeScope(scope) {
    var hasProfile = Object.prototype.hasOwnProperty.call(scope, "profileId");
    var hasWorld = Object.prototype.hasOwnProperty.call(scope, "worldId");
    if (hasProfile && !validSegment(scope.profileId) || hasWorld && (!validSegment(scope.worldId) || !validSegment(scope.profileId))) throw codedError("builder_scope_invalid");
  }

  function assertExpectedAccount(account, scope) {
    if (!validSegment(scope.accountId) || scope.accountId !== account.accountId) throw codedError("builder_account_changed");
    if (!Number.isSafeInteger(scope.sessionEpoch) || scope.sessionEpoch !== account.sessionEpoch) throw codedError("builder_account_changed");
  }

  function assertTreeActive(account, scope) {
    if (treeTombstones.has(treeKey(account, null, "account")) || treeTombstones.has(treeKey(account, scope, "profile")) || treeTombstones.has(treeKey(account, scope, "world"))) throw codedError("builder_scope_tombstoned");
  }

  function treeMatches(item, account, scope, level) {
    return item.job.account.accountId === account.accountId && (level === "account" || item.job.scope.profileId === scope.profileId && (level === "profile" || item.job.scope.worldId === scope.worldId));
  }

  function configs() {
    var set = getModelSet() || {};
    var card = normalizedConfig(set.kb || set.strong);
    if (!card) throw codedError("builder_model_unavailable");
    return { card: card, premium: normalizedConfig(set.premium), vision: normalizedOcrVisionConfig(set.ocrVision) };
  }

  async function resolveJob(input, account) {
    if (!input || !validSegment(input.profileId) || !validSegment(input.worldId) || !validSegment(input.textbookId)) throw codedError("builder_scope_invalid");
    var textbookDir = path.join(projectRoot, "accounts", account.accountId, "profiles", input.profileId, "worlds", input.worldId, "textbooks", input.textbookId);
    var rootReal = await fs.promises.realpath(projectRoot);
    var dirReal = await fs.promises.realpath(textbookDir);
    var relative = path.relative(rootReal, dirReal);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw codedError("builder_scope_invalid");
    var dirStat = await fs.promises.lstat(dirReal);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw codedError("builder_scope_invalid");
    var requestedFormat = String(input.format || "pdf").toLowerCase();
    var workerFormat = requestedFormat;
    var sourceName = null;
    var entries = await fs.promises.readdir(dirReal, { withFileTypes: true });
    if (requestedFormat === "qbook" || requestedFormat === "markdown" || requestedFormat === "md") {
      sourceName = entries.some(function (entry) { return entry.isFile() && entry.name === "_kb_src.md"; }) ? "_kb_src.md" : null;
      workerFormat = "markdown";
    } else {
      var extension = requestedFormat === "pptx" ? ".pptx" : ".pdf";
      var match = entries.find(function (entry) { return entry.isFile() && !entry.isSymbolicLink() && path.extname(entry.name).toLowerCase() === extension; });
      sourceName = match && match.name;
      workerFormat = extension.slice(1);
    }
    if (!sourceName) throw codedError("builder_source_unavailable");
    var sourcePath = path.join(dirReal, sourceName);
    var sourceStat = await fs.promises.lstat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size <= 0 || sourceStat.size > 256 * 1024 * 1024) throw codedError("builder_source_invalid");
    var sourceHash = await digestFile(sourcePath);
    return {
      account: account,
      scope: { accountId: account.accountId, profileId: input.profileId, worldId: input.worldId, textbookId: input.textbookId, sessionEpoch: account.sessionEpoch },
      textbookDir: dirReal,
      sourcePath: sourcePath,
      sourceHash: sourceHash,
      workerFormat: workerFormat,
      title: String(input.title || "").slice(0, 512),
      language: "chinese",
      allowRemoteVision: input.allowRemoteVision === true,
      operationId: crypto.randomBytes(16).toString("hex"),
    };
  }

  function safeError(error) {
    var code = String(error && error.code || "");
    if (/^(?:builder|vision|ocr|pdf)_[a-z0-9_]+$/.test(code)) return code;
    var status = Number(error && (error.statusCode || error.status));
    if (status === 401 || status === 403) return "builder_model_auth_failed";
    if (status === 429) return "builder_model_rate_limited";
    if (status >= 500) return "builder_model_unavailable";
    return "builder_request_failed";
  }

  function imageCount(payload) {
    var count = 0;
    (payload && payload.messages || []).forEach(function (message) {
      if (!Array.isArray(message && message.content)) return;
      message.content.forEach(function (part) { if (part && part.type === "image_url") count += 1; });
    });
    return count;
  }

  async function providerCall(config, payload, signal) {
    payload = Object.assign({}, payload, { model: config.model, stream: false });
    // deepseek 默认开启思考,会把 max_tokens 烧在 reasoning_content 上、content 返回空串。按最终 model 兜一层。
    if (/^deepseek/i.test(String(config.model || ""))) payload.thinking = { type: "disabled" };
    return responsesCompat.postChatCompletionsJson(new URL(config.baseUrl + "/chat/completions"), payload, {
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey, Connection: "close" },
      timeoutMs: 180000,
      timeoutMessage: "builder model timeout",
      signal: signal,
    });
  }

  function selectConfig(configSet, payload, purpose) {
    if (purpose === "kb-builder-vision") return configSet.vision;
    var requested = String(payload && payload.model || "");
    if (configSet.premium && requested === configSet.premium.model) return configSet.premium;
    return configSet.card;
  }

  function modelContent(parsed) {
    var message = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message;
    if (!message) throw codedError("builder_model_invalid_response");
    return message.content || message.reasoning_content || "";
  }

  async function handleRpc(job, configSet, message, signal, budget) {
    if (signal && signal.aborted) throw signal.reason || codedError("builder_scope_cancelled");
    if (!sameAccount(job.account, context())) throw codedError("builder_account_changed");
    if (!message || message.v !== 1 || typeof message.id !== "string" || message.id.length > 80) throw codedError("builder_protocol_invalid");
    if (message.type === "ocr-page") {
      var page = Number(message.page);
      if (!Number.isInteger(page) || page < 1 || !pdfCoordinator || typeof pdfCoordinator.run !== "function") throw codedError("builder_ocr_unavailable");
      if (budget.ocrPages >= 200) throw codedError("builder_ocr_budget_exhausted");
      budget.ocrPages += 1;
      var result = await pdfCoordinator.run({
        command: "extract",
        filePath: job.sourcePath,
        startPage: page,
        endPage: page,
        scope: job.scope,
        expectedLanguage: "zh-Hans-CN",
        timeoutMs: 120000,
        deadlineAt: budget.deadlineAt,
        signal: signal,
      });
      if (signal && signal.aborted) throw signal.reason || codedError("builder_scope_cancelled");
      if (!sameAccount(job.account, context())) throw codedError("builder_account_changed");
      var recognized = result && result.pages && result.pages[0];
      return { text: String(recognized && recognized.text || ""), source: recognized && recognized.source || "unresolved", error: recognized && recognized.error || null };
    }
    if (message.type !== "model") throw codedError("builder_protocol_invalid");
    var purpose = String(message.purpose || "");
    if (!["kb-builder-cards", "kb-builder-vision"].includes(purpose)) throw codedError("builder_protocol_invalid");
    var raw = JSON.stringify(message.payload || {});
    var rawBytes = Buffer.byteLength(raw, "utf8");
    if (rawBytes > 32 * 1024 * 1024) throw codedError("builder_request_too_large");
    if (budget.modelCalls >= 200 || budget.modelInputBytes + rawBytes > 256 * 1024 * 1024) throw codedError("builder_model_budget_exhausted");
    var count = imageCount(message.payload);
    if (count > 1) throw codedError("builder_image_limit");
    if (count && purpose !== "kb-builder-vision") throw codedError("builder_remote_vision_not_authorized");
    if (purpose === "kb-builder-vision" && (job.allowRemoteVision !== true || !configSet.vision)) throw codedError("builder_remote_vision_not_authorized");
    var config = selectConfig(configSet, message.payload, purpose);
    if (!config) throw codedError("builder_model_unavailable");
    if (configSet.premium && config === configSet.premium) {
      if (budget.premiumCalls >= 10) throw codedError("builder_premium_budget_exhausted");
      budget.premiumCalls += 1;
    }
    var requestedTokens = Math.min(8000, Math.max(1, Number(message.payload && message.payload.max_tokens) || 4096));
    if (budget.requestedOutputTokens + requestedTokens > 400000) throw codedError("builder_model_budget_exhausted");
    budget.modelCalls += 1;
    budget.modelInputBytes += rawBytes;
    budget.requestedOutputTokens += requestedTokens;
    var execute = function (signal) { return providerCall(config, message.payload, signal); };
    var parsed;
    if (count === 1) {
      if (!visionBudget || typeof visionBudget.run !== "function") throw codedError("vision_budget_unavailable");
      parsed = await visionBudget.run({
        purpose: "kb-builder-page",
        imageCount: 1,
        inputBytes: Buffer.byteLength(raw, "utf8"),
        maxOutputTokens: requestedTokens,
        operationId: job.operationId,
        page: Math.max(1, Number(message.page) || 1),
        deadlineAt: Date.now() + 15000,
        expectedAccountId: job.account.accountId,
        expectedSessionEpoch: job.account.sessionEpoch,
        scope: { profileId: job.scope.profileId, worldId: job.scope.worldId, textbookId: job.scope.textbookId },
        signal: signal,
        execute: execute,
      });
    } else {
      parsed = await execute(signal);
    }
    if (signal && signal.aborted) throw signal.reason || codedError("builder_scope_cancelled");
    if (!sameAccount(job.account, context())) throw codedError("builder_account_changed");
    return { content: modelContent(parsed) };
  }

  async function collectArtifacts(stageDir) {
    var files = [];
    var totalBytes = 0;
    async function walk(current, relative, depth) {
      if (depth > 2) throw codedError("builder_commit_invalid");
      var entries = await fs.promises.readdir(current, { withFileTypes: true });
      for (var index = 0; index < entries.length; index++) {
        var entry = entries[index];
        var childRelative = relative ? relative + "/" + entry.name : entry.name;
        var full = path.join(current, entry.name);
        var stat = await fs.promises.lstat(full);
        if (stat.isSymbolicLink()) throw codedError("builder_commit_invalid");
        if (stat.isDirectory()) {
          if (childRelative !== "cards") throw codedError("builder_commit_invalid");
          await walk(full, childRelative, depth + 1);
          continue;
        }
        if (!stat.isFile()) throw codedError("builder_commit_invalid");
        var allowedRoot = childRelative === "build_status.json" || childRelative === "index.json" || childRelative === "teaching_map.json";
        var allowedCard = /^cards\/[^\\/]{1,160}\.json$/u.test(childRelative);
        if (!allowedRoot && !allowedCard) throw codedError("builder_commit_invalid");
        if (stat.size <= 0 || stat.size > (allowedCard ? 1024 * 1024 : 8 * 1024 * 1024)) throw codedError("builder_commit_invalid");
        totalBytes += stat.size;
        if (files.length >= 500 || totalBytes > 64 * 1024 * 1024) throw codedError("builder_commit_invalid");
        var bytes = await fs.promises.readFile(full);
        files.push({ path: childRelative, bytes: bytes, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
      }
    }
    await walk(stageDir, "", 0);
    return files.sort(function (left, right) { return left.path.localeCompare(right.path); });
  }

  function parsedArtifact(files, name) {
    var item = files.find(function (entry) { return entry.path === name; });
    if (!item) throw codedError("builder_commit_invalid");
    try { return JSON.parse(item.bytes.toString("utf8")); } catch (_) { throw codedError("builder_commit_invalid"); }
  }

  function validateArtifactSchema(files) {
    var status = parsedArtifact(files, "build_status.json");
    var index = parsedArtifact(files, "index.json");
    var teachingMap = parsedArtifact(files, "teaching_map.json");
    var cardFiles = files.filter(function (entry) { return entry.path.startsWith("cards/"); });
    if (!status || status.state !== "done" || status.activationEligible !== true || !index || !Array.isArray(index.cards) || !Number.isSafeInteger(index.card_count) || index.card_count !== index.cards.length || index.card_count !== cardFiles.length) throw codedError("builder_commit_not_eligible");
    var ids = new Set();
    cardFiles.forEach(function (entry) {
      var card;
      try { card = JSON.parse(entry.bytes.toString("utf8")); } catch (_) { throw codedError("builder_commit_invalid"); }
      var expectedId = path.basename(entry.path, ".json");
      if (!card || String(card.concept_id || "") !== expectedId || ids.has(expectedId) || expectedId.includes("..")) throw codedError("builder_commit_invalid");
      ids.add(expectedId);
    });
    index.cards.forEach(function (card) { if (!card || !ids.has(String(card.concept_id || ""))) throw codedError("builder_commit_invalid"); });
    if (!teachingMap || teachingMap.version !== 3 || !Array.isArray(teachingMap.segments)) throw codedError("builder_commit_invalid");
    var mapped = [];
    teachingMap.segments.forEach(function (segment) {
      if (!segment || !Array.isArray(segment.sequence)) throw codedError("builder_commit_invalid");
      segment.sequence.forEach(function (phase) { (phase && phase.card_ids || []).forEach(function (id) { mapped.push(String(id)); }); });
    });
    if (mapped.length !== ids.size || new Set(mapped).size !== ids.size || mapped.some(function (id) { return !ids.has(id); })) throw codedError("builder_commit_invalid");
    return { status: status, index: index };
  }

  function assertJobActive(item) {
    if (!item || item.cancelError) throw item && item.cancelError || codedError("builder_scope_cancelled");
    if (!sameAccount(item.job.account, context())) throw codedError("builder_account_changed");
    assertTreeActive(item.job.account, item.job.scope);
  }

  async function validateAndPublishAfterClose(item) {
    var job = item.job;
    var realStage = null;
    assertJobActive(item);
    try {
    if (await digestFile(job.sourcePath) !== job.sourceHash) throw codedError("builder_source_changed");
    assertJobActive(item);
    var stageDir = publisher.paths(job.sandboxDir).stageDir;
    var stageStat = await fs.promises.lstat(stageDir);
    if (!stageStat.isDirectory() || stageStat.isSymbolicLink()) throw codedError("builder_commit_invalid");
    assertJobActive(item);
    var files = await collectArtifacts(stageDir);
    assertJobActive(item);
    validateArtifactSchema(files);
    await beforeArtifactCopy(job);
    assertJobActive(item);
    realStage = publisher.prepare(job.textbookDir).stageDir;
    assertJobActive(item);
    await fs.promises.mkdir(path.join(realStage, "cards"), { recursive: true });
    assertJobActive(item);
    for (var index = 0; index < files.length; index++) {
      assertJobActive(item);
      var target = path.join(realStage, files[index].path.split("/").join(path.sep));
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      assertJobActive(item);
      await fs.promises.writeFile(target, files[index].bytes, { flag: "wx" });
      assertJobActive(item);
    }
    var manifest = { version: 1, sourceSha256: job.sourceHash, createdAt: new Date().toISOString(), artifacts: files.map(function (entry) { return { path: entry.path, bytes: entry.size, sha256: entry.sha256 }; }) };
    assertJobActive(item);
    await fs.promises.writeFile(path.join(realStage, "artifact_manifest.json"), JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx" });
    assertJobActive(item);
    if (await digestFile(job.sourcePath) !== job.sourceHash) throw codedError("builder_source_changed");
    assertJobActive(item);
    publisher.publish(job.textbookDir);
    return { published: true, manifest: manifest };
    } catch (error) {
      if (realStage) await fs.promises.rm(realStage, { recursive: true, force: true }).catch(function () {});
      throw error;
    }
  }

  async function runJob(item) {
    var job = item.job;
    var sandboxRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "socratopia-kb-builder-"));
    job.sandboxDir = sandboxRoot;
    job.sourceSandboxPath = path.join(sandboxRoot, job.workerFormat === "markdown" ? "source.md" : job.workerFormat === "pptx" ? "source.pptx" : "source.pdf");
    await fs.promises.copyFile(job.sourcePath, job.sourceSandboxPath);
    if (await digestFile(job.sourceSandboxPath) !== job.sourceHash) throw codedError("builder_source_changed");
    if (item.cancelError) throw item.cancelError;
    var run = new Promise(function (resolve, reject) {
      var configSet;
      try { configSet = configs(); } catch (error) { reject(error); return; }
      var deps = path.join(process.cwd(), "deps");
      var nodePath = fs.existsSync(deps) ? deps : process.env.NODE_PATH || "";
      var child = childProcess.spawn(process.execPath, [workerPath], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"],
        env: minimalEnvironment(job, configSet, nodePath),
      });
      item.child = child;
      item.controller = new AbortController();
      var budget = { deadlineAt: Date.now() + 30 * 60 * 1000, modelCalls: 0, premiumCalls: 0, modelInputBytes: 0, requestedOutputTokens: 0, ocrPages: 0 };
      var settled = false;
      var stdoutBytes = 0;
      var stderrBytes = 0;
      var requestCount = 0;
      var committed = false;
      var rpcBusy = false;
      var seenRequestIds = new Set();
      var responseState = { tail: Promise.resolve(), pendingBytes: 0, maxFrameBytes: 8 * 1024 * 1024, maxPendingBytes: 16 * 1024 * 1024, timeoutMs: 15000 };
      var commitResponseState = { tail: Promise.resolve(), pendingBytes: 0, maxFrameBytes: 64 * 1024, maxPendingBytes: 64 * 1024, timeoutMs: 5000 };
      function failJob(error) {
        if (!item.cancelError) item.cancelError = error;
        try { item.controller.abort(item.cancelError); } catch (_) {}
        killTree(child);
      }
      var timer = setTimeout(function () {
        if (!settled) failJob(codedError("builder_timeout"));
      }, 30 * 60 * 1000);
      if (timer.unref) timer.unref();

      child.stdout.on("data", function (chunk) {
        stdoutBytes += chunk.length;
        if (stdoutBytes > 2 * 1024 * 1024) failJob(codedError("builder_output_limit"));
      });
      child.stderr.on("data", function (chunk) {
        stderrBytes += chunk.length;
        if (stderrBytes > 2 * 1024 * 1024) failJob(codedError("builder_error_limit"));
      });

      var rpcReader = createBoundedFrameReader(child.stdio[3], { maxFrameBytes: 20 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024, maxFrames: 250 }, function (line) {
        requestCount += 1;
        var message;
        try { message = JSON.parse(line); } catch (_) { return failJob(codedError("builder_protocol_invalid")); }
        if (rpcBusy || committed || !message || seenRequestIds.has(message.id)) return failJob(codedError("builder_protocol_invalid"));
        seenRequestIds.add(message.id);
        rpcBusy = true;
        try { child.stdio[3].pause(); } catch (_) {}
        Promise.resolve().then(function () { return handleRpc(job, configSet, message, item.controller.signal, budget); }).then(function (value) {
          return writeResponseFrame(responseState, child.stdio[4], { v: 1, id: message.id, ok: true, value: value });
        }, function (error) {
          return writeResponseFrame(responseState, child.stdio[4], { v: 1, id: message.id, ok: false, error: safeError(error) });
        }).then(function () {
          rpcBusy = false;
          if (!item.cancelError) try { child.stdio[3].resume(); } catch (_) {}
        }, failJob);
      }, failJob);

      var commitReader = createBoundedFrameReader(child.stdio[5], { maxFrameBytes: 64 * 1024, maxTotalBytes: 64 * 1024, maxFrames: 1 }, function (line) {
        var message;
        try { message = JSON.parse(line); } catch (_) { message = null; }
        if (!message || message.v !== 1 || message.type !== "publish" || committed || rpcBusy || responseState.pendingBytes) return failJob(codedError("builder_commit_invalid"));
        committed = true;
        writeResponseFrame(commitResponseState, child.stdio[6], { v: 1, ok: true, value: { sealed: true } }).catch(failJob);
      }, failJob);

      child.on("error", function () {
        if (!item.cancelError) item.cancelError = codedError("builder_spawn_failed");
      });
      child.on("close", function (code) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rpcReader.close();
        commitReader.close();
        if (item.cancelError) return reject(item.cancelError);
        if (code !== 0) return reject(codedError("builder_failed"));
        if (!committed || rpcBusy || responseState.pendingBytes || commitResponseState.pendingBytes) return reject(codedError("builder_commit_missing"));
        validateAndPublishAfterClose(item).then(function () {
          resolve({ ok: true, textbookId: job.scope.textbookId });
        }, reject);
      });
    });
    return run.finally(function () { return fs.promises.rm(sandboxRoot, { recursive: true, force: true }); });
 }

  function pump() {
    if (stopped || active || !queue.length) return;
    var item = queue.shift();
    active = item;
    var running = runJob(item);
    item.donePromise = running.catch(function () {});
    running.then(item.resolve, item.reject).finally(function () {
      byScope.delete(item.key);
      if (active === item) active = null;
      pump();
    });
  }

  function abortItem(item, error) {
    if (!item) return Promise.resolve();
    if (!item.cancelError) item.cancelError = error;
    if (item.controller) try { item.controller.abort(item.cancelError); } catch (_) {}
    killTree(item.child);
    return item.donePromise || Promise.resolve();
  }

  async function enqueue(input) {
    if (stopped) throw codedError("builder_shutdown");
    var account = context();
    if (!account) throw codedError("builder_account_unavailable");
    assertTreeActive(account, input);
    var job = await resolveJob(input, account);
    assertTreeActive(account, input);
    var key = scopeKey(account, job.scope);
    if (byScope.has(key)) return byScope.get(key);
    if (queue.length >= 2) throw codedError("builder_queue_full");
    var promise = new Promise(function (resolve, reject) {
      queue.push({ key: key, job: job, resolve: resolve, reject: reject, child: null, controller: null, donePromise: null, cancelError: null });
      pump();
    });
    byScope.set(key, promise);
    return promise;
  }

  async function cancelScope(scope) {
    var account = context();
    if (!account) throw codedError("builder_account_unavailable");
    if (!scope || !validSegment(scope.profileId) || !validSegment(scope.worldId) || !validSegment(scope.textbookId)) throw codedError("builder_scope_invalid");
    assertExpectedAccount(account, scope);
    var key = scopeKey(account, scope);
    queue.slice().forEach(function (item) {
      if (item.key === key) {
        queue.splice(queue.indexOf(item), 1);
        byScope.delete(item.key);
        item.reject(codedError("builder_scope_cancelled"));
      }
    });
    if (active && active.key === key) {
      await abortItem(active, codedError("builder_scope_cancelled"));
    }
  }

  async function cancelTree(scope) {
    scope = scope || {};
    var account = context();
    if (!account) return;
    assertExpectedAccount(account, scope);
    validateTreeScope(scope);
    var level = treeLevel(scope);
    treeTombstones.add(treeKey(account, scope, level));
    queue.slice().forEach(function (item) {
      if (!treeMatches(item, account, scope, level)) return;
      queue.splice(queue.indexOf(item), 1);
      byScope.delete(item.key);
      item.reject(codedError("builder_scope_cancelled"));
    });
    if (active && treeMatches(active, account, scope, level)) await abortItem(active, codedError("builder_scope_cancelled"));
  }

  function activateTree(scope) {
    scope = scope || {};
    var account = context();
    if (!account) return Promise.reject(codedError("builder_account_unavailable"));
    try { assertExpectedAccount(account, scope); validateTreeScope(scope); } catch (error) { return Promise.reject(error); }
    treeTombstones.delete(treeKey(account, scope, treeLevel(scope)));
    return Promise.resolve();
  }

  async function syncAccount(next) {
    queue.slice().forEach(function (item) {
      if (!sameAccount(item.job.account, next)) {
        queue.splice(queue.indexOf(item), 1);
        byScope.delete(item.key);
        item.reject(codedError("builder_account_changed"));
      }
    });
    if (active && !sameAccount(active.job.account, next)) {
      await abortItem(active, codedError("builder_account_changed"));
    }
  }

  async function shutdown() {
    stopped = true;
    queue.splice(0).forEach(function (item) {
      byScope.delete(item.key);
      item.reject(codedError("builder_shutdown"));
    });
    if (active) {
      await abortItem(active, codedError("builder_shutdown"));
    }
  }

  return Object.freeze({ version: 1, enqueue: enqueue, cancelScope: cancelScope, cancelTree: cancelTree, activateTree: activateTree, syncAccount: syncAccount, shutdown: shutdown });
}

module.exports = { createBuilderCoordinator: createBuilderCoordinator, minimalEnvironment: minimalEnvironment, createBoundedFrameReader: createBoundedFrameReader, writeResponseFrame: writeResponseFrame };
