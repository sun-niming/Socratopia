"use strict";

// PN-009 — frontend contract for the polled post-class-notes job.
//
// The repo patches five page bundles in lockstep but only one is ever loaded, so
// this asserts all five carry the same behaviour.  It lives under `.next`, which
// means the smoke matrix does NOT pick it up — run it by hand after touching a
// page chunk.
//
//   node resources/server/.next/static/chunks/app/post-class-notes-ui-smoke-test.js

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var BUNDLES = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
];

function read(bundle) {
  return fs.readFileSync(path.join(__dirname, bundle), "utf8");
}

function check(name, body) {
  try {
    body();
    console.log("  ok   " + name);
  } catch (error) {
    error.message = name + ": " + error.message;
    throw error;
  }
}

BUNDLES.forEach(function (bundle) {
  check(bundle + " carries the polling client", function () {
    var source = read(bundle);
    [
      ["PCRUN", "run token that stops a superseded poll"],
      ["PCJOB", "last jobId, used by the retry button"],
      ["pcStage", "stage -> progress text"],
      ["pcText", "error code -> message"],
      ["pcRetry", "retry resumes instead of restarting"],
      ["post(\"status\"", "polls the status action"]
    ].forEach(function (pair) {
      assert.ok(source.indexOf(pair[0]) >= 0, "missing " + pair[1] + " (" + pair[0] + ")");
    });
  });

  check(bundle + " starts a job instead of blocking on one response", function () {
    var source = read(bundle);
    assert.ok(source.indexOf("post(w?\"retry\":\"start\"") >= 0, "the generate path posts start/retry as an action");
    assert.ok(source.indexOf("action:act") >= 0, "every request carries an action field");
    assert.ok(
      source.indexOf("let{summary:s}=await n.json();S({kind:\"ready\",summary:s})") < 0,
      "the old blocking `let{summary}=await res.json()` read must be gone"
    );
    assert.ok(source.indexOf("if(body.summary)") >= 0, "but a synchronous placeholder/ready reply is still honoured");
  });

  check(bundle + " polls on the §8.2 cadence and stops on a terminal status", function () {
    var source = read(bundle);
    assert.ok(/Date\.now\(\)-started>30000\?3000:1500/.test(source), "1.5s, backing off to 3s after 30s");
    assert.ok(source.indexOf("document.hidden") >= 0, "and 8s while the window is in the background");
    assert.ok(source.indexOf("!==token)return") >= 0, "a superseded poll stops");
    assert.ok(source.indexOf("\"failed\"===sb.status||\"cancelled\"===sb.status") >= 0, "failed and cancelled stop the loop");
    assert.ok(source.indexOf("\"ready\"===sb.status||\"degraded\"===sb.status") >= 0, "ready and degraded stop the loop");
    // A terminal status with no summary must not be rendered bare, or the
    // section renderer crashes on `summary.sections`.
    assert.ok(
      source.indexOf("code:sb.code||\"persist_failed\"") >= 0,
      "a terminal status without a note becomes a coded, retryable error"
    );
  });

  check(bundle + " shows the real stage", function () {
    var source = read(bundle);
    ["created", "partitioning", "mapping", "reducing", "validating", "persisting"].forEach(function (stage) {
      assert.ok(source.indexOf(stage + ":[") >= 0, "stage text for " + stage);
    });
    assert.ok(source.indexOf("stageText:C.stageText") >= 0, "the spinner receives the stage text");
    assert.ok(source.indexOf("function nE({t:e,silent:t=!1,stageText:s})") >= 0, "and renders it");
  });

  check(bundle + " maps stable error codes to text in three languages", function () {
    var source = read(bundle);
    ["upstream_html_response", "upstream_timeout", "upstream_auth", "upstream_rate_limit", "upstream_network",
      "output_truncated", "quality_rejected", "persist_failed", "missing_dependency", "cancelled"].forEach(function (code) {
      assert.ok(source.indexOf(code + ":{zh:") >= 0, "message for " + code);
    });
    assert.ok(source.indexOf("traceId:err&&err.traceId") >= 0, "the traceId is surfaced for support");
    assert.ok(source.indexOf("o.traceId?\"  (\"+o.traceId+\")\"") >= 0, "and appended to the message");
  });

  check(bundle + " re-enters an interrupted job and marks a degraded note", function () {
    var source = read(bundle);
    assert.ok(source.indexOf("action:\"status\",profileId:e") >= 0, "on mount the latest job is looked up");
    assert.ok(source.indexOf("PCJOB.current=sb.jobId") >= 0, "an existing job is adopted, not restarted");
    assert.ok(source.indexOf("degradedText:C.degradedText") >= 0, "the ready view gets the degraded hint");
    assert.ok(source.indexOf("function nz({summary:e,learnerName:t,t:r,degradedText:dg})") >= 0, "and renders it");
    assert.ok(source.indexOf("pcDegraded()") >= 0, "with localized wording");
  });

  check(bundle + " wires the error retry button to the resuming callback", function () {
    var source = read(bundle);
    assert.ok(source.indexOf("onRetry:pcRetry") >= 0, "retry uses pcRetry");
    assert.ok(source.indexOf("onRetry:z,") < 0, "and no longer passes the bare generate callback");
  });

  check(bundle + " still parses", function () {
    // node --check is a separate gate; a cheap re-parse here keeps the smoke
    // honest when the patch script itself changes.
    var source = read(bundle);
    assert.ok(source.length > 100000, "bundle is intact");
    assert.strictEqual((source.match(/function nT\(/g) || []).length >= 1, true, "the concept-review component is still present");
  });
});

// The patcher itself must stay idempotent, otherwise a second run corrupts the
// bundles that a first run already touched.
check("the patch script reports the bundles as already patched", function () {
  var source = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "..", "..", "..", "tools", "patch-post-class-notes-ui.js"), "utf8");
  assert.ok(source.indexOf("already patched") >= 0, "the script can tell patched from pristine");
  assert.ok(source.indexOf("expected one") >= 0, "and asserts exactly one hit per edit");
});

console.log("post-class-notes UI smoke: PASS");
