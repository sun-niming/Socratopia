"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var routePath = path.join(__dirname, "route.js");
var source = fs.readFileSync(routePath, "utf8");
var start = source.indexOf("function continuityConversationObject(");
var helpersEnd = source.indexOf("function A(a){", start);
var handlersEnd = source.indexOf(",D=(0,z.pW)", start);
assert.ok(start >= 0 && helpersEnd > start && handlersEnd > helpersEnd, "conversation continuity code is discoverable");
var helpers = Function(source.slice(start, helpersEnd) + ";return { snapshot: continuityConversationSnapshot, slot: continuityConversationSlot, mismatch: continuityConversationSnapshotMismatch, error: continuityConversationMismatch, resolved: continuityConversationResolved };")();
var canonical = { slotId: "npc_a", companionInstanceId: "ci_alpha", candidateId: "candidate_a", displayName: "Ada" };
assert.deepStrictEqual(helpers.snapshot({ companionSnapshot: canonical, companionIdentity: { slotId: "npc_b", companionInstanceId: "ci_other" } }), canonical, "canonical snapshot wins over legacy aliases");
assert.deepStrictEqual(helpers.snapshot({ companionIdentity: { slotId: "npc_b", companionInstanceId: "ci_beta", candidateId: "candidate_b", displayName: "Bea" } }), { slotId: "npc_b", companionInstanceId: "ci_beta", candidateId: "candidate_b", displayName: "Bea" }, "legacy companionIdentity is accepted");
assert.deepStrictEqual(helpers.snapshot({ companion: { slotId: "npc_c", companionInstanceId: "ci_gamma", candidateId: "candidate_c", displayName: "Cai" } }), { slotId: "npc_c", companionInstanceId: "ci_gamma", candidateId: "candidate_c", displayName: "Cai" }, "legacy companion is accepted");
assert.strictEqual(helpers.slot("npc_d"), "npc_d", "known slot is accepted");
assert.strictEqual(helpers.slot("not-a-slot"), null, "unknown legacy character does not force a resolver call");
assert.strictEqual(helpers.mismatch(canonical, { slotId: "npc_a", companionInstanceId: "ci_alpha", candidateId: "candidate_a", displayName: "Renamed Ada" }), false, "display-name rename does not invalidate an instance");
assert.strictEqual(helpers.mismatch(canonical, { slotId: "npc_a", companionInstanceId: "ci_replaced", candidateId: "candidate_a", displayName: "Ada" }), true, "instance replacement is detected");
var error = helpers.error();
assert.strictEqual(error.code, "COMPANION_CONTEXT_MISMATCH", "mismatch uses the documented code");
assert.strictEqual(error.status, 409, "mismatch uses HTTP 409");
assert.deepStrictEqual(helpers.resolved(canonical), canonical, "resolved identity persists exactly the canonical schema");

var stored = null;
var saved = [];
var world = {
  Gt: async function () { return stored; },
  vm: async function (_profileId, _worldId, conversation) { saved.push(JSON.parse(JSON.stringify(conversation))); }
};
function FakeResponse(body, init) {
  this.body = body;
  this.status = init && init.status || 200;
  this.headers = init && init.headers || {};
}
FakeResponse.json = function (body, init) { return new FakeResponse(body, init); };
var handlers = Function("v", "w", "x", "y", "z", source.slice(start, handlersEnd) + ";return { POST: C };")({ NextResponse: FakeResponse }, world, {}, {}, { pW: function (handler) { return handler; } });
var savedRuntime = global.__COMPANION_CONTINUITY__;

async function run() {
  try {
    var resolverCalls = [];
    global.__COMPANION_CONTINUITY__ = {
      enabled: true,
      resolveCompanion: async function (input) {
        resolverCalls.push(input);
        return { slotId: input.slotId, companionInstanceId: input.companionInstanceId || "ci_new", candidateId: input.candidateId || "candidate_a", displayName: "Ada" };
      }
    };
    var created = await handlers.POST({ json: async function () { return { profileId: "profile_a", worldId: "world_a", conversation: { id: "conversation_a", character: "npc_a", messages: [] } }; } });
    assert.strictEqual(created.status, 200, "new conversation saves successfully");
    assert.deepStrictEqual(resolverCalls[0], { profileId: "profile_a", worldId: "world_a", slotId: "npc_a", companionInstanceId: null, candidateId: null, mode: "classroom" }, "character is resolved through the trusted runtime");
    assert.deepStrictEqual(created.body.companionSnapshot, { slotId: "npc_a", companionInstanceId: "ci_new", candidateId: "candidate_a", displayName: "Ada" }, "POST returns a canonical snapshot");
    assert.deepStrictEqual(saved[0].companionSnapshot, created.body.companionSnapshot, "POST persists the canonical snapshot");

    stored = { id: "conversation_b", character: "npc_a", companionSnapshot: canonical };
    var callsBeforeMismatch = resolverCalls.length;
    var forged = await handlers.POST({ json: async function () { return { profileId: "profile_a", worldId: "world_a", conversation: { id: "conversation_b", character: "npc_a", companionSnapshot: { slotId: "npc_a", companionInstanceId: "ci_forged", candidateId: "candidate_a", displayName: "Ada" } } }; } });
    assert.strictEqual(forged.status, 409, "incoming identity cannot replace a stored snapshot");
    assert.strictEqual(forged.body.code, "COMPANION_CONTEXT_MISMATCH", "stored snapshot conflict has the documented code");
    assert.strictEqual(resolverCalls.length, callsBeforeMismatch, "stored-snapshot mismatch is rejected before resolver side effects");

    global.__COMPANION_CONTINUITY__.resolveCompanion = async function () {
      var mismatch = new Error("Companion instance changed");
      mismatch.code = "COMPANION_CONTEXT_MISMATCH";
      mismatch.status = 409;
      throw mismatch;
    };
    var drift = await handlers.POST({ json: async function () { return { profileId: "profile_a", worldId: "world_a", conversation: { id: "conversation_b", character: "npc_a", companionSnapshot: canonical } }; } });
    assert.strictEqual(drift.status, 409, "occupant drift from a stored snapshot is returned as a conflict");
    assert.strictEqual(drift.body.code, "COMPANION_CONTEXT_MISMATCH", "occupant drift returns the documented code");

    var healCalls = [];
    global.__COMPANION_CONTINUITY__.resolveCompanion = async function (input) {
      healCalls.push(input);
      if (input.companionInstanceId) {
        var stale = new Error("Companion instance changed");
        stale.code = "COMPANION_CONTEXT_MISMATCH";
        stale.status = 409;
        throw stale;
      }
      return { slotId: input.slotId, companionInstanceId: "ci_current", candidateId: "candidate_current", displayName: "Ada" };
    };
    var healed = await handlers.POST({ json: async function () { return { profileId: "profile_a", worldId: "world_a", conversation: { id: "conversation_b", character: "npc_a", messages: [] } }; } });
    assert.strictEqual(healed.status, 200, "a stale stored instance self-heals to the current slot occupant");
    assert.deepStrictEqual(healed.body.companionSnapshot, { slotId: "npc_a", companionInstanceId: "ci_current", candidateId: "candidate_current", displayName: "Ada" }, "self-heal persists the refreshed snapshot");
    assert.strictEqual(healCalls.length, 2, "self-heal retries exactly once");
    assert.deepStrictEqual(healCalls[1], { profileId: "profile_a", worldId: "world_a", slotId: "npc_a", mode: "classroom" }, "the retry drops the stale instance and candidate assertions");

    stored = null;
    delete global.__COMPANION_CONTINUITY__;
    var legacy = await handlers.POST({ json: async function () { return { profileId: "profile_a", worldId: "world_a", conversation: { id: "conversation_c", character: "legacy-display-name" } }; } });
    assert.strictEqual(legacy.status, 200, "legacy records remain writable when continuity runtime is unavailable");
    assert.strictEqual(legacy.body.companionSnapshot, null, "legacy records do not receive an unverified synthetic snapshot");

    resolverCalls = [];
    global.__COMPANION_CONTINUITY__ = {
      enabled: true,
      resolveCompanion: async function (input) {
        resolverCalls.push(input);
        return { slotId: "npc_b", companionInstanceId: "ci_beta", candidateId: "candidate_b", displayName: "Bea" };
      }
    };
    var alias = await handlers.POST({ json: async function () { return { profileId: "profile_a", worldId: "world_a", conversation: { id: "conversation_d", character: "npc_b", companionIdentity: { slotId: "npc_b", companionInstanceId: "ci_beta", candidateId: "candidate_b", displayName: "Bea" } } }; } });
    assert.strictEqual(alias.status, 200, "legacy identity alias is migrated through resolver validation");
    assert.deepStrictEqual(resolverCalls[0], { profileId: "profile_a", worldId: "world_a", slotId: "npc_b", companionInstanceId: "ci_beta", candidateId: "candidate_b", mode: "classroom" }, "legacy alias becomes a resolver assertion");
    assert.deepStrictEqual(alias.body.companionSnapshot, { slotId: "npc_b", companionInstanceId: "ci_beta", candidateId: "candidate_b", displayName: "Bea" }, "legacy alias is persisted canonically");

    assert.ok(source.includes("close_reading_candidates.json"), "DELETE clears close-reading candidate data");
    assert.ok(source.includes("lesson_summaries/${e}.md"), "DELETE retains lesson-summary cleanup");
    console.log("conversations continuity smoke: PASS");
  } finally {
    if (savedRuntime === undefined) delete global.__COMPANION_CONTINUITY__;
    else global.__COMPANION_CONTINUITY__ = savedRuntime;
  }
}

run().catch(function (error) {
  console.error("conversations continuity smoke: FAIL", error && error.stack || error);
  process.exitCode = 1;
});