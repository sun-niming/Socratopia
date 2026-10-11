"use strict";
// One-off gate runner: re-runs a stage gate and rewrites its results.json.
var spawnSync = require("child_process").spawnSync;
var fs = require("fs");
var path = require("path");
var B = process.argv[2];
var stage = process.argv[3];
var A = "resources/server/.next/static/chunks/app/";
var R = "resources/server/.next/server/app/api/concept-summary/";
var bundles = ["page-87daa6ca210ab9dc.js", "page-3a1fef7566e26c43.js", "page-practice-ui-20260622.js", "page-practice-ui-20260625-jyfix.js", "page-practice-ui-20260626-postclass-notes.js"];
var cmds = [];
function add(label, args) { cmds.push([label, "node", args]); }
var D_SMOKES = [
  "concept-summary-format-smoke-test.js", "concept-summary-markdown-smoke-test.js",
  "concept-summary-response-budget-smoke-test.js", "concept-summary-route-integration-smoke-test.js"
];
if (stage === "D") {
  add("node --check server.js", ["--check", "resources/server/server.js"]);
  add("node --check lib/orchestrator.js", ["--check", "resources/server/lib/post-class-notes/orchestrator.js"]);
  add("node --check route.js", ["--check", R + "route.js"]);
  add("node --check smoke-test-utils", ["--check", "resources/server/smoke-test-utils.js"]);
  D_SMOKES.forEach(function (f) { add("node --check " + f, ["--check", R + f]); });
  ["lib/post-class-notes/orchestrator-smoke-test.js", "lib/route-auth-smoke-test.js",
   "lib/local-request-auth-smoke-test.js", "lib/account-request-context-smoke-test.js"].forEach(function (f) {
    add("node " + f, ["resources/server/" + f]);
  });
  D_SMOKES.forEach(function (f) { add(f, [R + f]); });
} else {
  add("node --check tools/patch-post-class-notes-ui.js", ["--check", "tools/patch-post-class-notes-ui.js"]);
  add("check: patcher is idempotent", ["tools/patch-post-class-notes-ui.js", "--check"]);
  bundles.forEach(function (b) { add("node --check " + b, ["--check", A + b]); });
  add("node --check ui smoke", ["--check", A + "post-class-notes-ui-smoke-test.js"]);
  add("post-class-notes-ui-smoke-test", [A + "post-class-notes-ui-smoke-test.js"]);
  fs.readdirSync(A).filter(function (f) { return f.endsWith("-smoke-test.js") && f !== "post-class-notes-ui-smoke-test.js"; })
    .forEach(function (f) { add(f, [A + f]); });
  add("concept-summary-route-integration-smoke-test", [R + "concept-summary-route-integration-smoke-test.js"]);
  add("lib/post-class-notes/orchestrator-smoke-test", ["resources/server/lib/post-class-notes/orchestrator-smoke-test.js"]);
}
var results = [];
cmds.forEach(function (cmd) {
  var t0 = Date.now();
  var r = spawnSync(cmd[1], cmd[2], { encoding: "utf8", timeout: 300000 });
  var out = (r.stdout || "") + (r.stderr || "");
  fs.writeFileSync(path.join(B, "logs", cmd[0].replace(/[^a-z0-9.-]+/gi, "_") + ".log"), out);
  results.push({ label: cmd[0], command: [cmd[1]].concat(cmd[2]).join(" "), exitCode: r.status, elapsedMs: Date.now() - t0, verdict: r.status === 0 ? "PASS" : "FAIL", summary: out.trim().split("\n").slice(-1)[0] || "" });
  console.log((r.status === 0 ? "PASS" : "FAIL") + "  " + cmd[0] + "  " + (Date.now() - t0) + "ms");
});
var failed = results.filter(function (r) { return r.exitCode !== 0; });
var existing = JSON.parse(fs.readFileSync(path.join(B, "results.json"), "utf8"));
fs.writeFileSync(path.join(B, "results.json"), JSON.stringify(Object.assign(existing, {
  generatedAt: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results: results
}), null, 2));
console.log((stage + " GATE: ") + (results.length - failed.length) + "/" + results.length + " PASS");
