"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Resolver = require("./resolver.js");

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function world(root, accountId, profileId, worldId, companions) {
  var dir = path.join(root, "accounts", accountId, "profiles", profileId, "worlds", worldId);
  write(path.join(dir, "world_meta.json"), JSON.stringify({ worldId: worldId, language: "chinese", companions: companions }, null, 2));
  write(path.join(dir, "npc_a.md"), "persona A");
  write(path.join(dir, "npc_b.md"), "persona B");
  write(path.join(dir, "relation_npc_a.md"), "relation A");
  write(path.join(dir, "learner_profile.md"), "learner profile");
  write(path.join(dir, "pal_moments.md"), [
    "## 2026-08-31 | A",
    "<!-- continuityEvent:event-a companion:ci_aaaaaaaaaaaaaaaa mode:classroom -->",
    "personal memory",
    "",
    "## 2026-08-30 | B",
    "<!-- continuityEvent:event-b companion:ci_other mode:classroom -->",
    "shared memory",
    "",
    "## 2026-08-29 | A",
    "legacy memory",
  ].join("\n"));
  return dir;
}

async function run() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-companion-resolver-"));
  var account = { active: true, accountId: "account_a", sessionEpoch: 7 };
  var companionsA = [
    { candidateId: "preset_a", name: "A", companionInstanceId: "ci_aaaaaaaaaaaaaaaa" },
    { candidateId: "custom_b", name: "B" },
    null,
    { candidateId: "preset_d", name: "D" },
  ];
  var worldA = world(root, "account_a", "profile_a", "world_a", companionsA);
  world(root, "account_b", "profile_a", "world_a", [{ candidateId: "other", name: "Other" }, null, null, null]);
  var resolver = Resolver.createCompanionResolver({ projectRoot: root, getAccountContext: function () { return account; } });
  try {
    var first = await resolver.resolveCompanion({ profileId: "profile_a", worldId: "world_a", slotId: "npc_a", companionInstanceId: "ci_aaaaaaaaaaaaaaaa", candidateId: "preset_a", mode: "classroom" });
    assert.strictEqual(first.accountId, "account_a");
    assert.strictEqual(first.displayName, "A");
    var migrated = JSON.parse(fs.readFileSync(path.join(worldA, "world_meta.json"), "utf8"));
    assert(/^ci_[a-z0-9]{16,64}$/.test(migrated.companions[1].companionInstanceId));
    assert(/^ci_[a-z0-9]{16,64}$/.test(migrated.companions[3].companionInstanceId));
    var original = first.companionInstanceId;
    migrated.companions[0].customName = "Renamed A";
    fs.writeFileSync(path.join(worldA, "world_meta.json"), JSON.stringify(migrated, null, 2), "utf8");
    var renamed = await resolver.resolveCompanion({ profileId: "profile_a", worldId: "world_a", slotId: "npc_a", companionInstanceId: original });
    assert.strictEqual(renamed.companionInstanceId, original);
    assert.strictEqual(renamed.displayName, "Renamed A");
    var changed = JSON.parse(fs.readFileSync(path.join(worldA, "world_meta.json"), "utf8"));
    changed.companions[0] = { candidateId: "replacement", name: "Replacement" };
    fs.writeFileSync(path.join(worldA, "world_meta.json"), JSON.stringify(changed, null, 2), "utf8");
    var replacement = await resolver.resolveCompanion({ profileId: "profile_a", worldId: "world_a", slotId: "npc_a", candidateId: "replacement" });
    assert.notStrictEqual(replacement.companionInstanceId, original);
    var mismatch = null;
    try { await resolver.resolveCompanion({ profileId: "profile_a", worldId: "world_a", slotId: "npc_a", companionInstanceId: original }); } catch (error) { mismatch = error; }
    assert(mismatch);
    assert.strictEqual(mismatch.code, "COMPANION_CONTEXT_MISMATCH");
    assert.strictEqual(mismatch.status, 409);
    var context = await resolver.loadContext({
      profileId: "profile_a", worldId: "world_a", slotId: "npc_b", companionInstanceId: migrated.companions[1].companionInstanceId, candidateId: "custom_b", mode: "practice",
    }, { persona: 100, relation: 100, learnerProfile: 100, personalMoments: 100, sharedMoments: 500 });
    assert.strictEqual(context.persona, "persona B");
    assert(context.sharedMoments.indexOf("shared memory") >= 0);
    account = { active: true, accountId: "account_b", sessionEpoch: 8 };
    var isolated = await resolver.resolveCompanion({ profileId: "profile_a", worldId: "world_a", slotId: "npc_a" });
    assert.strictEqual(isolated.accountId, "account_b");
    assert.strictEqual(isolated.candidateId, "other");
    console.log("PASS resolver legacy migration, rename/replacement identity, mismatch, context and account isolation");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(function (error) {
  console.error("FAIL resolver smoke:", error && error.stack || error);
  process.exitCode = 1;
});
