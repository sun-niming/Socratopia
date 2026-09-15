"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var net = require("net");
var os = require("os");
var path = require("path");
var auth = require("./lib/local-request-auth.js");

function freePort() {
  return new Promise(function (resolve, reject) {
    var server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () {
      var port = server.address().port;
      server.close(function () { resolve(port); });
    });
  });
}

async function waitForServer(port, child, output) {
  var deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("server exited: " + output.join(""));
    try {
      var response = await fetch("http://127.0.0.1:" + port + "/api/adaptive-teaching?action=state");
      if (response.status) return;
    } catch (_) {}
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  throw new Error("server readiness timeout: " + output.join(""));
}

function waitForAck(child, message) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error("ACK timeout")); }, 2000);
    function onMessage(reply) {
      if (!reply || reply.type !== "socratopia:auth-state-ack:v1" || reply.sequence !== message.sequence) return;
      clearTimeout(timer);
      child.removeListener("message", onMessage);
      resolve(reply);
    }
    child.on("message", onMessage);
    child.send(message);
  });
}

function adaptivePaths(root) {
  if (!fs.existsSync(root)) return [];
  var found = [];
  (function walk(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
      var full = path.join(directory, entry.name);
      if (entry.name.toLowerCase() === "adaptive") found.push(full);
      if (entry.isDirectory()) walk(full);
    });
  })(root);
  return found;
}

async function main() {
  var temporary = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-eligibility-"));
  var projectRoot = path.join(temporary, "project-data");
  var contentRoot = path.join(temporary, "content");
  fs.mkdirSync(contentRoot, { recursive: true });
  var port = await freePort();
  var secret = Buffer.alloc(32, 29);
  var issuerName = "eligibility-smoke";
  var env = Object.assign({}, process.env, {
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    PROJECT_ROOT: projectRoot,
    CONTENT_ROOT: contentRoot,
    SOCRATOPIA_ADAPTIVE_AUTH_SECRET_B64: secret.toString("base64"),
    SOCRATOPIA_ADAPTIVE_AUTH_ISSUER: issuerName
  });
  delete env.SOCRATOPIA_ADAPTIVE_ENABLED;
  delete env.SOCRATOPIA_ADAPTIVE_PROFILE_ALLOWLIST;
  var output = [];
  var child = childProcess.fork(path.join(__dirname, "server.js"), [], {
    cwd: __dirname,
    env: env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  child.stdout.on("data", function (value) { output.push(String(value)); });
  child.stderr.on("data", function (value) { output.push(String(value)); });
  try {
    await waitForServer(port, child, output);
    var state = { type: "socratopia:auth-state:v1", sequence: 1, active: true, accountId: "local", sessionEpoch: 1 };
    var ack = await waitForAck(child, state);
    assert.deepStrictEqual({ sequence: ack.sequence, active: ack.active, accountId: ack.accountId, sessionEpoch: ack.sessionEpoch }, {
      sequence: 1, active: true, accountId: "local", sessionEpoch: 1
    });
    var issuer = auth.createCapabilityIssuer({
      secret: secret,
      issuer: issuerName,
      audience: "adaptive-teaching",
      currentAuthState: { accountId: "local", sessionEpoch: 1 },
      ttlSeconds: 30
    });
    var response = await fetch("http://127.0.0.1:" + port + "/api/adaptive-teaching?action=state&profileId=Profile", {
      headers: { Authorization: issuer.authorizationHeader() }
    });
    var body = await response.json();
    assert.strictEqual(response.status, 403);
    assert.strictEqual(body.error.code, "adaptive_not_eligible");
    assert.strictEqual(body.safeToFallback, true);
    assert.deepStrictEqual(adaptivePaths(projectRoot), [], "default-off eligibility must not create adaptive data");
    console.log("adaptive eligibility runtime smoke test passed");
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise(function (resolve) { child.once("exit", resolve); setTimeout(resolve, 3000); });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
