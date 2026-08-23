"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..", "..");
var mainFiles = [
  path.join(root, "main.js"),
  path.join(root, "_asar_extracted", "dist-electron", "main.js")
];
var preloadFiles = [
  path.join(root, "preload.js"),
  path.join(root, "_asar_extracted", "dist-electron", "preload.js")
];

function count(source, value) { return source.split(value).length - 1; }
function adaptiveBlock(source) {
  var start = source.indexOf('var ADAPTIVE_AUTH_ACCOUNT_ID = "local";');
  var end = source.indexOf("function log(msg)", start);
  assert(start >= 0 && end > start, "adaptive Electron block must be present");
  return source.slice(start, end);
}

var blocks = mainFiles.map(function (file) {
  var source = fs.readFileSync(file, "utf8");
  var block = adaptiveBlock(source);
  assert(block.indexOf("randomBytes(32)") >= 0, file + " must use a 32-byte per-generation secret");
  assert(block.indexOf("createCapabilityIssuer") >= 0, file + " must use the production issuer");
  assert(block.indexOf("secret.fill(0)") >= 0, file + " must clear the caller secret buffer");
  assert(block.indexOf('message.sequence !== expected.sequence || message.active !== expected.active || message.accountId !== expected.accountId || message.sessionEpoch !== expected.sessionEpoch') >= 0, file + " must strictly match the full ACK");
  assert(block.indexOf("adaptiveAuthSession !== sessionState || serverProcess !== child") >= 0, file + " must reject stale-child ACKs");
  assert(block.indexOf("args.length !== 0") >= 0, file + " must reject IPC arguments");
  assert(block.indexOf("event.sender !== mainWindow.webContents") >= 0, file + " must bind the main window sender");
  assert(block.indexOf("frame !== event.sender.mainFrame") >= 0, file + " must bind the main frame");
  assert(block.indexOf('origin.protocol !== "http:" || !loopback') >= 0, file + " must require loopback HTTP");
  assert(block.indexOf("originPort !== serverPort") >= 0, file + " must bind the active port");
  assert.strictEqual(count(source, 'stdio: ["ignore", "pipe", "pipe", "ipc"]'), 1, file + " must fork one IPC child");
  assert(source.indexOf("await waitForPort(serverPort)") < source.indexOf("await synchronizeAdaptiveAuthState(child, nextAdaptiveAuthSession)"), file + " must synchronize only after HTTP readiness");
  assert.strictEqual(source.indexOf("log(secret"), -1, file + " must not log the secret");
  assert.strictEqual(source.indexOf("log(token"), -1, file + " must not log a capability");
  return block;
});
assert.strictEqual(blocks[0], blocks[1], "root and ASAR runtime must share the same adaptive protocol block");

preloadFiles.forEach(function (file) {
  var source = fs.readFileSync(file, "utf8");
  var matches = source.match(/getAdaptiveCapability:\s*\(\)\s*=>\s*[A-Za-z0-9_$.]+\.ipcRenderer\.invoke\("adaptive:getCapability"\)/g) || [];
  assert.strictEqual(matches.length, 1, file + " must expose one zero-argument capability method");
});

console.log("electron adaptive capability smoke test passed for root and ASAR runtime baselines");
