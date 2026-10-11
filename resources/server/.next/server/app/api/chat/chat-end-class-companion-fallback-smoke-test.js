"use strict";

// End-class companion fallback: when the companion instance asserted by the
// client (or by the stored conversation snapshot) no longer matches the world,
// an end-class command must still complete against the CURRENT slot occupant,
// while ordinary messages keep the 409 protection.

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var routePath = path.join(__dirname, "route.js");
var source = fs.readFileSync(routePath, "utf8");
var startAnchor = "if(_ccRuntime&&_ccRuntime.enabled&&!H&&C&&d){try{_ccSnapshot=await _ccRuntime.resolveCompanion";
var endAnchor = "if(_ccRuntime&&_ccRuntime.enabled&&!H&&C&&O&&_ccSnapshot&&(0,s.Q)(ab))";
var start = source.indexOf(startAnchor);
var end = source.indexOf(endAnchor, start);
assert.ok(start >= 0 && end > start, "companion resolution block is discoverable");
var block = source.slice(start, end);
assert.ok(block.indexOf('(0,s.Q)(ab)&&_ccError&&_ccError.code==="COMPANION_CONTEXT_MISMATCH"') >= 0, "fallback is gated on the end-class command and the mismatch code");
assert.ok(block.indexOf("slotId:d,mode:") >= 0, "fallback retry drops the instance and candidate assertions");

var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function compile() {
  return new AsyncFunction(
    "_ccRuntime", "H", "x", "C", "d", "_ccRequestedInstanceId", "_ccRequestedCandidateId", "_crActive", "s", "ab", "Response", "console",
    "var _ccSnapshot=null;" + block + ";return _ccSnapshot;"
  );
}
function FakeResponse(body, init) {
  this.body = body;
  this.status = init && init.status || 200;
}
function mismatchError(message) {
  var error = new Error(message || "Companion instance changed");
  error.code = "COMPANION_CONTEXT_MISMATCH";
  error.status = 409;
  return error;
}
var quietConsole = { warn: function () {} };

async function run() {
  var runBlock = compile();

  // 1. Happy path: the asserted instance is current.
  var current = { slotId: "npc_a", companionInstanceId: "ci_new" };
  var snapshot = await runBlock(
    { enabled: true, resolveCompanion: async function () { return current; } },
    false, "profile_a", "world_a", "npc_a", "ci_new", "candidate_new", false,
    { Q: function () { return false; } }, "你好", FakeResponse, quietConsole);
  assert.strictEqual(snapshot, current, "matching instance resolves normally");

  // 2. End-class command with a stale instance falls back to the current occupant.
  var calls = [];
  var runtime = {
    enabled: true,
    resolveCompanion: async function (input) {
      calls.push(input);
      if (input.companionInstanceId) throw mismatchError();
      return { slotId: input.slotId, companionInstanceId: "ci_current" };
    }
  };
  snapshot = await runBlock(runtime, false, "profile_a", "world_a", "npc_a", "ci_stale", void 0, false,
    { Q: function () { return true; } }, "下课", FakeResponse, quietConsole);
  assert.deepStrictEqual(snapshot, { slotId: "npc_a", companionInstanceId: "ci_current" }, "end-class proceeds with the current companion");
  assert.strictEqual(calls.length, 2, "fallback retries exactly once");
  assert.ok(!("companionInstanceId" in calls[1]) && !("candidateId" in calls[1]), "retry drops the stale assertions");

  // 3. Ordinary message with a stale instance keeps the 409 protection.
  var denied = await runBlock(runtime, false, "profile_a", "world_a", "npc_a", "ci_stale", void 0, false,
    { Q: function () { return false; } }, "今天讲什么？", FakeResponse, quietConsole);
  assert.ok(denied instanceof FakeResponse && denied.status === 409, "ordinary messages still 409 on mismatch");
  assert.strictEqual(JSON.parse(denied.body).code, "COMPANION_CONTEXT_MISMATCH", "denied response keeps the documented code");

  // 4. End-class fallback surfaces the retry failure when the slot is empty.
  var emptyRuntime = { enabled: true, resolveCompanion: async function () { throw mismatchError("This companion slot is empty"); } };
  var empty = await runBlock(emptyRuntime, false, "profile_a", "world_a", "npc_a", "ci_stale", void 0, false,
    { Q: function () { return true; } }, "下课", FakeResponse, quietConsole);
  assert.ok(empty instanceof FakeResponse && empty.status === 409, "empty slot still blocks end-class");
  assert.strictEqual(JSON.parse(empty.body).error, "This companion slot is empty", "retry error is surfaced");

  console.log("chat end-class companion fallback smoke: PASS");
}

run().catch(function (error) {
  console.error("chat end-class companion fallback smoke: FAIL", error && error.stack || error);
  process.exitCode = 1;
});
