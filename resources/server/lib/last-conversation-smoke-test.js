// last-conversation-smoke-test.js
"use strict";
const assert = require("assert");
const lib = require("./last-conversation.js");

const results = [];
function test(name, fn) {
  try { fn(); results.push(true); console.log("  PASS  " + name); }
  catch (error) { results.push(false); console.log("  FAIL  " + name + "\n        " + error.message); }
}

lib.reset();

test("an empty store yields nothing (process just started)", function () {
  assert.strictEqual(lib.get(), null);
  assert.strictEqual(lib.textbookIdFor(null), null);
  assert.strictEqual(lib.textbookIdFor("c1"), null);
});

test("set records the pair and textbookIdFor answers for it", function () {
  lib.set("c1", "KUyw");
  assert.deepStrictEqual(lib.get() && lib.get().id, "c1");
  assert.strictEqual(lib.textbookIdFor(null), "KUyw");
  assert.strictEqual(lib.textbookIdFor("c1"), "KUyw");
});

test("another conversation is not mistaken for the last one", function () {
  assert.strictEqual(lib.textbookIdFor("c2"), null);
  lib.set("c2", "KUym");
  assert.strictEqual(lib.textbookIdFor("c2"), "KUym");
  assert.strictEqual(lib.textbookIdFor("c1"), null, "stale conversation must not answer");
});

test("a turn without a textbook keeps the id empty, not the previous one", function () {
  lib.set("c3", null);
  assert.strictEqual(lib.get().id, "c3");
  assert.strictEqual(lib.textbookIdFor(null), null);
});

test("junk input is ignored instead of throwing", function () {
  const before = lib.get();
  lib.set(null, "KUyw");
  assert.strictEqual(lib.get(), before, "no id means no update");
  lib.set("c4", "KUyw");
  assert.strictEqual(lib.set("c4", 42).textbookId, "42");
  lib.reset();
  assert.strictEqual(lib.get(), null);
});

const passed = results.filter(Boolean).length;
console.log("\nlast-conversation: " + passed + " passed, " + (results.length - passed) + " failed");
if (passed !== results.length) process.exit(1);
