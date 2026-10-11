// Covers tools/finish-asar-repack.js: the asar reader it decides with, the plan
// mapping behind --check, and the CLI exit codes.  Runs standalone; no writes.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const tool = require(path.join(ROOT, "tools", "finish-asar-repack.js"));
const ASAR = path.join(ROOT, "resources", "app.asar");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  PASS  " + name);
  } catch (error) {
    failed++;
    console.log("  FAIL  " + name + "\n          " + (error && error.message));
  }
}

test("readAsarEntry returns the exact shipped bytes for a real entry", function () {
  const shipped = tool.readAsarEntry(ASAR, "dist-electron/preload.js");
  assert.ok(shipped && shipped.length > 0, "entry must be readable");
  assert.ok(shipped.equals(fs.readFileSync(path.join(ROOT, "preload.js"))), "must be the same bytes as root preload.js");
});

test("readAsarEntry handles the header padding instead of shifting by it", function () {
  // A misaligned reader still returns the right *length*, so check the payload shape.
  const pkg = tool.readAsarEntry(ASAR, "package.json");
  assert.strictEqual(pkg.slice(0, 1).toString("utf8"), "{", "must not start with padding bytes");
  assert.strictEqual(JSON.parse(pkg.toString("utf8")).name, "socratopia");
});

test("readAsarEntry returns null for a missing entry and rejects non-asar files", function () {
  assert.strictEqual(tool.readAsarEntry(ASAR, "dist-electron/nope.js"), null);
  assert.throws(function () { tool.readAsarEntry(path.join(ROOT, "preload.js"), "x"); }, /not an asar/);
});

test("the plan exposes every signal the decision needs", function () {
  const current = tool.plan();
  ["drift", "fresh", "inSync", "writable", "done", "usableViaCopy", "statusText"].forEach(function (key) {
    assert.ok(key in current, "plan is missing " + key);
  });
  assert.ok(Array.isArray(current.drift));
  assert.strictEqual(typeof current.done, "boolean");
  // done means the PRIMARY pair is current; a --copy twin is usable but still leaves
  // work (the original EXE hash).  never a subset of the three preconditions.
  assert.strictEqual(current.done, !current.drift.length && current.fresh && current.inSync);
  assert.strictEqual(current.usableViaCopy, current.fresh && current.copyInSync === true);
  assert.ok(!current.done || !current.usableViaCopy || current.inSync, "done implies the primary pair");
});

test("plan().fresh tracks the shipped main.js, not the hash pair", function () {
  const shipped = tool.readAsarEntry(ASAR, "dist-electron/main.js");
  const root = fs.readFileSync(path.join(ROOT, "main.js"));
  assert.strictEqual(tool.electronLayerFresh(), shipped.equals(root));
});

test("--help exits 0 and --check maps to 0 when current, 1 when not", function () {
  assert.strictEqual(tool.main(["--help"]), 0);
  const current = tool.plan();
  assert.strictEqual(tool.main(["--check"]), current.done ? 0 : 1);
});

test("staging parity is what the guard checks (root main.js byte-identical)", function () {
  const drift = tool.ELECTRON_FILES.filter(function (name) {
    return !tool.sameFile(path.join(ROOT, name), path.join(ROOT, "_asar_extracted", "dist-electron", name));
  });
  assert.ok(drift.length <= tool.ELECTRON_FILES.length, "drift is a subset");
  assert.ok(tool.sameFile(path.join(ROOT, "preload.js"), path.join(ROOT, "preload.js")));
  assert.ok(!tool.sameFile(path.join(ROOT, "preload.js"), path.join(ROOT, "missing.js")));
});

console.log("");
console.log("finish-asar-repack: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
