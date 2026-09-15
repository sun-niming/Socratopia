"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var route = fs.readFileSync(path.resolve(__dirname, "..", "..", ".next", "server", "app", "api", "reading-context", "route.js"), "utf8");
var helperStart = route.indexOf("\nfunction _captureOcrRequestFence(");
assert(helperStart >= 0, "reading-context route must expose the in-bundle request fence helpers");

var accountId = "account-a";
var accountState = { active: true, accountId: "account-a", sessionEpoch: 7 };
var sandbox = {
  Date: Date,
  global: {
    __SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__: { getAccountId: function () { return accountId; } },
    __SOCRATOPIA_ACCOUNT_CONTEXT__: function () { return accountState; },
  },
};
vm.createContext(sandbox);
vm.runInContext(route.slice(helperStart) + "\nthis.capture=_captureOcrRequestFence;this.assertFence=_assertOcrRequestFence;this.isFenceError=_isOcrFenceError;", sandbox);

var controller = new AbortController();
var fence = sandbox.capture({ signal: controller.signal }, 60000);
assert(Object.isFrozen(fence), "captured request fence must be immutable");
assert.strictEqual(fence.accountId, "account-a");
assert.strictEqual(fence.sessionEpoch, 7);
assert.strictEqual(fence.signal, controller.signal);
assert(fence.deadlineAt > Date.now());
sandbox.assertFence(fence);

accountState = { active: true, accountId: "account-a", sessionEpoch: 8 };
assert.throws(function () { sandbox.assertFence(fence); }, function (error) { return error && error.code === "request_stale"; });
accountState = { active: true, accountId: "account-a", sessionEpoch: 7 };
controller.abort();
assert.throws(function () { sandbox.assertFence(fence); }, function (error) { return error && error.code === "request_aborted"; });

var live = sandbox.capture({ signal: new AbortController().signal }, 1);
var originalNow = Date.now;
Date.now = function () { return live.deadlineAt; };
try {
  assert.throws(function () { sandbox.assertFence(live); }, function (error) { return error && error.code === "request_deadline"; });
} finally {
  Date.now = originalNow;
}

var fenceCodes = ["request_aborted", "request_deadline", "request_stale", "ocr_request_aborted", "ocr_request_deadline", "ocr_request_stale", "ocr_delivery_scope_stale", "ocr_scope_stale", "ocr_scope_invalid", "ocr_scope_tombstoned", "ocr_account_state_unavailable", "vision_account_changed"];
fenceCodes.forEach(function (code) {
  var error = Object.assign(new Error(code), { code: code });
  assert.strictEqual(sandbox.isFenceError(error), true, code + " must be rethrown by tolerant route catches");
  assert.throws(function () { if (sandbox.isFenceError(error)) throw error; }, function (thrown) { return thrown === error; }, code + " must escape a tolerant catch unchanged");
});
assert.strictEqual(sandbox.isFenceError({ code: "pdf_busy" }), false, "ordinary OCR availability errors must retain the original tolerant behavior");
assert.strictEqual(sandbox.isFenceError(null), false);

console.log("API route OCR request fence behavior smoke: PASS");
