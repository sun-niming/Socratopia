#!/usr/bin/env node
"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var net = require("net");
var os = require("os");
var path = require("path");

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

async function waitForAdaptive(port, child, output) {
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

async function run() {
  var temporary = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-server-runtime-"));
  var content = path.join(temporary, "content");
  fs.mkdirSync(content, { recursive: true });
  var port = await freePort();
  var env = Object.assign({}, process.env, {
    PORT: String(port),
    PROJECT_ROOT: path.join(temporary, "project-data"),
    CONTENT_ROOT: content
  });
  delete env.HOSTNAME;
  delete env.SOCRATOPIA_ADAPTIVE_AUTH_SECRET_B64;
  var output = [];
  var child = childProcess.spawn(process.execPath, [path.join(__dirname, "server.js")], { cwd: __dirname, env: env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", function (chunk) { output.push(String(chunk)); });
  child.stderr.on("data", function (chunk) { output.push(String(chunk)); });
  try {
    var response = await waitForAdaptive(port, child, output);
    var body = await response.json();
    assert.strictEqual(response.status, 503);
    assert.strictEqual(body.error.code, "auth_unavailable");
    assert(output.join("").indexOf("127.0.0.1:" + port) >= 0 || output.join("").indexOf("127.0.0.1") >= 0, "standalone startup reports a loopback listener");
    console.log("PASS: standalone server starts normally, binds loopback, and adaptive HTTP fails closed without issuer state");
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
