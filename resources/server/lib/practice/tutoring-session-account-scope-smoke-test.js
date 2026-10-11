"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-tutor-account-"));
process.env.PROJECT_ROOT = root;
delete require.cache[require.resolve("./tutoring-session.js")];
var tutor = require("./tutoring-session.js");
var state = null;
global.__SOCRATOPIA_ACCOUNT_CONTEXT__ = function () { return state; };

function context(accountId, epoch) { return { active: true, accountId: accountId, sessionEpoch: epoch }; }
function mustThrow(fn, code) {
  var thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert(thrown, "expected error " + code);
  assert.strictEqual(thrown.code, code);
}

try {
  state = context("account_a", 1);
  var ctxA1 = context("account_a", 1);
  var sessionA = tutor.defaultSession("same_problem", ctxA1);
  tutor.writeTutoringSession("same_profile", "same_world", sessionA, ctxA1);
  tutor.setCompanion("same_profile", "same_world", "same_problem", "ci_a", "A", { slotId: "npc_a", companionInstanceId: "ci_a", candidateId: "candidate_a" }, ctxA1);
  tutor.appendMessage("same_profile", "same_world", "same_problem", { role: "user", content: "A only" }, ctxA1);
  var pathA = tutor.sessionFilePath("same_profile", "same_world", "same_problem", ctxA1);
  assert(pathA.indexOf(path.join("accounts", "account_a", "profiles")) >= 0);
  assert.strictEqual(tutor.readTutoringSession("same_profile", "same_world", "same_problem", ctxA1).companionInstanceId, "ci_a");

  state = context("account_b", 2);
  var ctxB2 = context("account_b", 2);
  assert.strictEqual(tutor.readTutoringSession("same_profile", "same_world", "same_problem", ctxB2), null, "same profile/world/problem set must not cross account root");
  tutor.appendMessage("same_profile", "same_world", "same_problem", { role: "user", content: "B only" }, ctxB2);
  var pathB = tutor.sessionFilePath("same_profile", "same_world", "same_problem", ctxB2);
  assert.notStrictEqual(pathA, pathB);
  assert.strictEqual(tutor.readTutoringSession("same_profile", "same_world", "same_problem", ctxB2).messages[0].content, "B only");

  state = null;
  var legacy = tutor.defaultSession("legacy_problem", null);
  tutor.writeTutoringSession("same_profile", "same_world", legacy, null);
  var legacyPath = tutor.sessionFilePath("same_profile", "same_world", "legacy_problem", null);
  assert(legacyPath.indexOf(path.join(root, "profiles")) === 0);
  state = context("account_a", 3);
  var ctxA3 = context("account_a", 3);
  assert.strictEqual(tutor.readTutoringSession("same_profile", "same_world", "legacy_problem", ctxA3), null, "active account must not fall back to legacy profile data");
  mustThrow(function () { tutor.readTutoringSession("same_profile", "same_world", "legacy_problem", null); }, "TUTORING_SESSION_EPOCH_STALE");

  state = context("account_a", 4);
  mustThrow(function () { tutor.appendMessage("same_profile", "same_world", "same_problem", { role: "user", content: "stale" }, ctxA3); }, "TUTORING_SESSION_EPOCH_STALE");
  var resumed = tutor.readTutoringSession("same_profile", "same_world", "same_problem", context("account_a", 4));
  assert(resumed, "new current epoch can safely reopen the account-scoped persisted session");
  assert.strictEqual(resumed.accountId, "account_a");
  console.log("PASS tutoring sessions are account-root isolated, legacy-fenced, identity-persistent and stale-epoch fenced");
} finally {
  delete global.__SOCRATOPIA_ACCOUNT_CONTEXT__;
  fs.rmSync(root, { recursive: true, force: true });
}
