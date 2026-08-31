"use strict";

// Regression: authenticated tutoring sessions must use the same account root
// as the practice data layer. This test never touches real profile data.
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var originalRoot = process.env.PROJECT_ROOT;
var originalContext = global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__;
var tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-tutoring-account-"));

try {
  process.env.PROJECT_ROOT = tempRoot;
  global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__ = {
    getAccountId: function () { return "acct_a"; }
  };

  var tutor = require("./tutoring-session.js");
  var actual = tutor.sessionFilePath("profile", "world", "problem_set");
  var expected = path.join(
    tempRoot,
    "accounts",
    "acct_a",
    "profiles",
    "profile",
    "worlds",
    "world",
    "practice",
    "tutoring_sessions",
    "problem_set.json"
  );

  assert.strictEqual(actual, expected, "tutoring session path must stay inside the authenticated account root");
  tutor.appendMessage("profile", "world", "problem_set", { role: "user", content: "hello" });
  assert.ok(fs.existsSync(expected), "session write must land in the authenticated account root");
  console.log("Tutoring account scope smoke: PASS");
} finally {
  if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
  else process.env.PROJECT_ROOT = originalRoot;
  if (originalContext === undefined) delete global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__;
  else global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__ = originalContext;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
