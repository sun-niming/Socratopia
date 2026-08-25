"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");

var workerPath = path.join(__dirname, "kb-builder.mjs");

function workerEnvironment(root, source, pagesPerChunk, maxChunks) {
  var env = {};
  ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec", "TEMP", "TMP", "NODE_PATH"].forEach(function (name) {
    if (process.env[name]) env[name] = process.env[name];
  });
  Object.assign(env, {
    KB_SUPERVISED: "1",
    KB_TEXTBOOK_DIR: root,
    KB_SRC_PATH: source,
    KB_FORMAT: "markdown",
    KB_TITLE: "source-limit-smoke",
    KB_LANG: "chinese",
    KB_CARD_MODEL: "mock-card-model",
    KB_PAGES_PER_CHUNK: String(pagesPerChunk),
    KB_MAX_CHUNKS: String(maxChunks),
  });
  return env;
}

function runWorker(root, source, pagesPerChunk, maxChunks) {
  return new Promise(function (resolve, reject) {
    var child = childProcess.spawn(process.execPath, [workerPath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"],
      env: workerEnvironment(root, source, pagesPerChunk, maxChunks),
    });
    var stdout = "";
    var stderr = "";
    var rpc = "";
    var publish = "";
    var timer = setTimeout(function () {
      child.kill();
      reject(new Error("Builder source-limit smoke timed out"));
    }, 15000);
    child.stdout.on("data", function (chunk) { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", function (chunk) { stderr += chunk.toString("utf8"); });
    child.stdio[3].on("data", function (chunk) { rpc += chunk.toString("utf8"); });
    child.stdio[5].on("data", function (chunk) { publish += chunk.toString("utf8"); });
    child.on("error", function (error) { clearTimeout(timer); reject(error); });
    child.on("close", function (code) {
      clearTimeout(timer);
      resolve({ code: code, stdout: stdout, stderr: stderr, rpc: rpc, publish: publish });
    });
  });
}

function markdown(blocks) {
  return Array.from({ length: blocks }, function (_, index) {
    return "# Page " + (index + 1) + "\ncontent " + (index + 1);
  }).join("\n");
}

async function runCase(blocks, pagesPerChunk, maxChunks, expectedCode, expectedActual, expectedLimit) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-builder-source-limit-"));
  var source = path.join(root, "source.md");
  try {
    fs.writeFileSync(source, markdown(blocks), "utf8");
    var result = await runWorker(root, source, pagesPerChunk, maxChunks);
    assert.strictEqual(result.code, 1, expectedCode + " must terminate the worker");
    assert(result.stdout.includes("FATAL: " + expectedCode), expectedCode + " must remain visible as a stable worker error");
    assert.strictEqual(result.rpc, "", expectedCode + " must fail before any OCR/model RPC");
    assert.strictEqual(result.publish, "", expectedCode + " must never request parent commit/publish");
    var statusPath = path.join(root, "knowledge_base", "build_status.json");
    var status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    assert.strictEqual(status.state, "error");
    assert.strictEqual(status.activationEligible, false);
    assert.strictEqual(status.errorCode, expectedCode);
    assert.strictEqual(status.actual, expectedActual);
    assert.strictEqual(status.limit, expectedLimit);
    assert.strictEqual(status.extraction.sourcePages, blocks, expectedCode + " must retain the real source page/block count");
    if (expectedCode === "builder_source_chunk_limit") {
      assert.strictEqual(status.extraction.sourceChunks, expectedActual, "chunk-limit status must retain the complete chunk count");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  await runCase(201, 4, 50, "builder_source_page_limit", 201, 200);
  await runCase(5, 1, 1, "builder_source_chunk_limit", 5, 1);
  console.log("KB Builder source-limit smoke: PASS");
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
