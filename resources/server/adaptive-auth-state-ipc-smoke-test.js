#!/usr/bin/env node
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
    if (child.exitCode !== null) throw new Error("server exited before readiness: " + output.join(""));
    try {
      var response = await fetch("http://127.0.0.1:" + port + "/api/adaptive-teaching?action=state");
      if (response.status) return response;
    } catch (_) {}
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  throw new Error("server did not become reachable: " + output.join(""));
}

function sendAndWaitForAck(child, message, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      cleanup();
      reject(new Error("auth-state ACK timeout for sequence " + message.sequence));
    }, timeoutMs || 1500);
    function cleanup() {
      clearTimeout(timer);
      child.removeListener("message", onMessage);
    }
    function onMessage(reply) {
      if (!reply || reply.type !== "socratopia:auth-state-ack:v1" || reply.sequence !== message.sequence) return;
      cleanup();
      resolve(reply);
    }
    child.on("message", onMessage);
    child.send(message);
  });
}

function sendAndExpectIgnored(child, message, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      cleanup();
      resolve();
    }, timeoutMs || 400);
    function cleanup() {
      clearTimeout(timer);
      child.removeListener("message", onMessage);
    }
    function onMessage(reply) {
      if (!reply || reply.type !== "socratopia:auth-state-ack:v1" || reply.sequence !== message.sequence) return;
      cleanup();
      reject(new Error("server acknowledged an invalid auth-state transition for sequence " + message.sequence));
    }
    child.on("message", onMessage);
    child.send(message);
  });
}

async function adaptiveRequest(port, authorization) {
  var response = await fetch("http://127.0.0.1:" + port + "/api/adaptive-teaching?action=state&profileId=Profile", {
    headers: authorization ? { Authorization: authorization } : {}
  });
  var body = await response.json().catch(function () { return {}; });
  return { response: response, body: body };
}

function assertAuthenticated(result, label) {
  assert.notStrictEqual(result.response.status, 401, label + " must not fail as missing/invalid auth");
  assert.notStrictEqual(result.response.status, 403, label + " must not fail account/epoch auth");
  assert.notStrictEqual(result.response.status, 503, label + " must not fail as unavailable auth");
}

async function run() {
  var temporary = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-auth-state-ipc-"));
  var content = path.join(temporary, "content");
  fs.mkdirSync(content, { recursive: true });
  var port = await freePort();
  var secret = Buffer.alloc(32, 19);
  var issuerName = "socratopia-ipc-smoke";
  var env = Object.assign({}, process.env, {
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    PROJECT_ROOT: path.join(temporary, "project-data"),
    CONTENT_ROOT: content,
    SOCRATOPIA_ADAPTIVE_AUTH_SECRET_B64: secret.toString("base64"),
    SOCRATOPIA_ADAPTIVE_AUTH_ISSUER: issuerName,
    SOCRATOPIA_ADAPTIVE_ENABLED: "true",
    SOCRATOPIA_ADAPTIVE_PROFILE_ALLOWLIST: "Profile"
  });
  var output = [];
  var child = childProcess.fork(path.join(__dirname, "server.js"), [], {
    cwd: __dirname,
    env: env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  child.stdout.on("data", function (chunk) { output.push(String(chunk)); });
  child.stderr.on("data", function (chunk) { output.push(String(chunk)); });
  try {
    var unavailable = await waitForServer(port, child, output);
    assert.strictEqual(unavailable.status, 503, "secret without current auth state remains fail closed");

    var accountA = { accountId: "account-a", sessionEpoch: 7 };
    var issuer = auth.createInMemoryIssuer({
      testOnly: true,
      issuer: issuerName,
      audience: "adaptive-teaching",
      secret: secret,
      currentAuthState: accountA,
      nowSeconds: function () { return Math.floor(Date.now() / 1000); }
    });
    var firstAck = await sendAndWaitForAck(child, {
      type: "socratopia:auth-state:v1",
      sequence: 1,
      active: true,
      accountId: accountA.accountId,
      sessionEpoch: accountA.sessionEpoch
    });
    assert.strictEqual(firstAck.sessionEpoch, 7);
    assert.strictEqual(firstAck.accountId, "account-a");
    assertAuthenticated(await adaptiveRequest(port, issuer.authorizationHeader()), "initial account capability");

    await sendAndExpectIgnored(child, {
      type: "socratopia:auth-state:v1",
      sequence: 2,
      active: true,
      accountId: "account-b",
      sessionEpoch: 7
    });
    assertAuthenticated(await adaptiveRequest(port, issuer.authorizationHeader()), "rejected same-epoch account switch");

    var inactiveAck = await sendAndWaitForAck(child, {
      type: "socratopia:auth-state:v1",
      sequence: 3,
      active: false,
      sessionEpoch: 8
    });
    assert.strictEqual(inactiveAck.active, false);
    assert.strictEqual(inactiveAck.accountId, null);
    var revoked = await adaptiveRequest(port, issuer.authorizationHeader());
    assert.strictEqual(revoked.response.status, 503, "inactive state revokes all outstanding capabilities");
    assert.strictEqual(revoked.body.error.code, "auth_unavailable");

    issuer.setCurrentAuthState({ accountId: "account-a", sessionEpoch: 9 });
    var activeAck = await sendAndWaitForAck(child, {
      type: "socratopia:auth-state:v1",
      sequence: 4,
      active: true,
      accountId: "account-a",
      sessionEpoch: 9
    });
    assert.strictEqual(activeAck.active, true);
    assert.strictEqual(activeAck.accountId, "account-a");
    assertAuthenticated(await adaptiveRequest(port, issuer.authorizationHeader()), "reactivated capability");

    issuer.setCurrentAuthState(accountA);
    var stale = await adaptiveRequest(port, issuer.authorizationHeader());
    assert.strictEqual(stale.response.status, 403, "pre-revocation epoch stays invalid after reactivation");
    assert.strictEqual(stale.body.error.code, "auth_epoch_mismatch");
    console.log("PASS: adaptive auth-state IPC enforces strict account epochs, revoke, reactivation, and stale-token rejection");
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise(function (resolve) { child.once("exit", resolve); setTimeout(resolve, 3000); });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

run().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
