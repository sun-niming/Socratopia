"use strict";

// One trusted resolver for classroom, practice and close-reading.  It is the
// only continuity module that maps a client slot/instance assertion to the
// actual, account-scoped world files.

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var Transaction = require("./transaction.js");

var SLOT_IDS = ["npc_a", "npc_b", "npc_c", "npc_d"];
var IDENTITY_VERSION = 1;

function companionError(code, message, status) {
  var error = new Error(message || code);
  error.code = code;
  error.status = status || 400;
  error.statusCode = error.status;
  return error;
}

function createContextMismatchError(message) {
  return companionError("COMPANION_CONTEXT_MISMATCH", message || "Companion context no longer matches this world", 409);
}

function assertId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw companionError("COMPANION_SCOPE_INVALID", "Invalid " + label, 400);
  }
  return value;
}

function assertOptionalText(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 512 || /[\x00-\x1f]/.test(value)) {
    throw companionError("COMPANION_SCOPE_INVALID", "Invalid " + label, 400);
  }
  return value;
}

function newCompanionInstanceId() {
  return "ci_" + crypto.randomBytes(12).toString("hex");
}

function bounded(value, maximum) {
  value = String(value || "").trim();
  if (!value || maximum <= 0) return "";
  return value.length > maximum ? value.slice(0, maximum) : value;
}

function splitPalEntries(markdown) {
  return String(markdown || "").trim().split(/(?=^##\s+\d{4}-\d{2}-\d{2}\s*\|)/m).map(function (entry) {
    return entry.trim();
  }).filter(Boolean);
}

function markerInstanceId(entry) {
  var match = /<!--\s*continuityEvent:[^\s>]+\s+companion:([^\s>]+)\s+mode:[^\s>]+\s*-->/.exec(entry || "");
  return match ? match[1] : null;
}

function legacyEntryMatchesName(entry, displayName) {
  if (!displayName) return false;
  var heading = /^##\s+\d{4}-\d{2}-\d{2}\s*\|\s*([^\n]+)/m.exec(entry || "");
  return !!heading && heading[1].trim() === String(displayName).trim();
}

function createCompanionResolver(options) {
  options = options || {};
  var projectRoot = typeof options.projectRoot === "string" ? options.projectRoot : process.env.PROJECT_ROOT || "";
  var getAccountContext = typeof options.getAccountContext === "function" ? options.getAccountContext : function () { return null; };
  var makeInstanceId = typeof options.newCompanionInstanceId === "function" ? options.newCompanionInstanceId : newCompanionInstanceId;

  function activeAccount() {
    var context = getAccountContext() || null;
    if (!context || !context.active) return null;
    return {
      accountId: assertId(context.accountId, "account id"),
      sessionEpoch: Number.isSafeInteger(context.sessionEpoch) ? context.sessionEpoch : null,
    };
  }

  function profilesRoot() {
    var account = activeAccount();
    return account ? path.join(projectRoot, "accounts", account.accountId, "profiles") : path.join(projectRoot, "profiles");
  }

  function resolveWorld(scope) {
    var profileId = assertId(scope && scope.profileId, "profile id");
    var worldId = assertId(scope && scope.worldId, "world id");
    var root = path.resolve(profilesRoot());
    var worldDir = path.resolve(root, profileId, "worlds", worldId);
    if (worldDir.slice(0, root.length + 1) !== root + path.sep) throw companionError("COMPANION_SCOPE_INVALID", "World path escaped account scope", 400);
    return { profileId: profileId, worldId: worldId, worldDir: worldDir, account: activeAccount() };
  }

  async function readWorldMeta(worldDir) {
    var metaPath = path.join(worldDir, "world_meta.json");
    var raw;
    try {
      raw = await fs.promises.readFile(metaPath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") throw companionError("COMPANION_WORLD_NOT_FOUND", "World not found", 404);
      throw error;
    }
    try {
      var meta = JSON.parse(raw.replace(/^\uFEFF/, ""));
      if (!meta || typeof meta !== "object") throw Error("not object");
      if (!Array.isArray(meta.companions)) meta.companions = [null, null, null, null];
      return { meta: meta, raw: raw, metaPath: metaPath };
    } catch (_) {
      throw companionError("COMPANION_WORLD_INVALID", "world_meta.json is invalid", 500);
    }
  }

  function validInstanceId(value) {
    return typeof value === "string" && /^ci_[a-z0-9]{16,64}$/.test(value);
  }

  function issueInstanceId() {
    var value = String(makeInstanceId() || "");
    if (!validInstanceId(value)) throw companionError("COMPANION_INSTANCE_INVALID", "Companion instance id generator returned an invalid id", 500);
    return value;
  }

  async function ensureInstanceIds(world) {
    return Transaction.withWorldLock(world.worldDir, async function () {
      var loaded = await readWorldMeta(world.worldDir);
      var changed = false;
      for (var index = 0; index < SLOT_IDS.length; index += 1) {
        var slot = loaded.meta.companions[index];
        if (!slot || typeof slot !== "object") continue;
        if (!validInstanceId(slot.companionInstanceId)) {
          slot.companionInstanceId = issueInstanceId();
          changed = true;
        }
      }
      if (changed) await Transaction.atomicWrite(loaded.metaPath, JSON.stringify(loaded.meta, null, 2) + "\n");
      return loaded.meta;
    });
  }

  function resolveSlotIndex(meta, scope) {
    var slotId = assertOptionalText(scope && scope.slotId, "slot id");
    var requestedInstance = assertOptionalText(scope && scope.companionInstanceId, "companion instance id");
    if (slotId && SLOT_IDS.indexOf(slotId) < 0) throw createContextMismatchError("Unknown companion slot");
    var index = slotId ? SLOT_IDS.indexOf(slotId) : -1;
    if (!slotId && requestedInstance) {
      index = meta.companions.findIndex(function (slot) { return slot && slot.companionInstanceId === requestedInstance; });
      if (index < 0) throw createContextMismatchError("Companion instance is not present in this world");
      slotId = SLOT_IDS[index];
    }
    if (index < 0) throw companionError("COMPANION_SCOPE_INVALID", "A companion slot or instance is required", 400);
    return { slotId: slotId, slotIndex: index, requestedInstance: requestedInstance };
  }

  async function findAvatar(worldDir, slotId) {
    var dir = path.join(worldDir, "companions");
    try {
      var names = await fs.promises.readdir(dir);
      var prefix = slotId + ".";
      var name = names.find(function (entry) { return entry.indexOf(prefix) === 0 && /^[a-z0-9_.-]+$/i.test(entry); });
      return name ? path.join(dir, name) : null;
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function resolveCompanion(scope) {
    scope = scope || {};
    var world = resolveWorld(scope);
    // All readers pass this recovery gate before seeing an interrupted
    // continuity transaction.  It is deliberately scoped to the requested
    // world rather than enumerating account directories.
    await Transaction.recoverWorld(world.worldDir);
    var meta = await ensureInstanceIds(world);
    var resolved = resolveSlotIndex(meta, scope);
    var slot = meta.companions[resolved.slotIndex];
    if (!slot || typeof slot !== "object" || !slot.candidateId) throw createContextMismatchError("This companion slot is empty");
    if (resolved.requestedInstance && slot.companionInstanceId !== resolved.requestedInstance) {
      throw createContextMismatchError("Companion instance changed");
    }
    var requestedCandidate = assertOptionalText(scope.candidateId, "candidate id");
    if (requestedCandidate && slot.candidateId !== requestedCandidate) throw createContextMismatchError("Companion candidate changed");
    var mode = scope.mode || "classroom";
    if (["classroom", "practice", "close-reading"].indexOf(mode) < 0) throw companionError("COMPANION_MODE_INVALID", "Invalid companion mode", 400);
    var displayName = String(slot.customName || slot.name || resolved.slotId).trim() || resolved.slotId;
    return Object.freeze({
      accountId: world.account ? world.account.accountId : "legacy",
      sessionEpoch: world.account ? world.account.sessionEpoch : null,
      profileId: world.profileId,
      worldId: world.worldId,
      worldDir: world.worldDir,
      slotId: resolved.slotId,
      slotIndex: resolved.slotIndex,
      companionInstanceId: slot.companionInstanceId,
      candidateId: slot.candidateId,
      displayName: displayName,
      pronoun: slot.pronoun || null,
      color: slot.color || null,
      personaPath: path.join(world.worldDir, resolved.slotId + ".md"),
      relationPath: path.join(world.worldDir, "relation_" + resolved.slotId + ".md"),
      avatarPath: await findAvatar(world.worldDir, resolved.slotId),
      worldLanguage: meta.language || "chinese",
      identityVersion: IDENTITY_VERSION,
      mode: mode,
    });
  }

  async function readOptional(file) {
    try { return await fs.promises.readFile(file, "utf8"); } catch (error) { if (error && error.code === "ENOENT") return ""; throw error; }
  }

  async function loadContext(snapshot, budget) {
    if (!snapshot || typeof snapshot !== "object") throw companionError("COMPANION_SCOPE_INVALID", "A companion snapshot is required", 400);
    var fresh = await resolveCompanion({
      profileId: snapshot.profileId,
      worldId: snapshot.worldId,
      slotId: snapshot.slotId,
      companionInstanceId: snapshot.companionInstanceId,
      candidateId: snapshot.candidateId,
      mode: snapshot.mode || "classroom",
    });
    budget = Object.assign({ persona: 4000, relation: 1500, learnerProfile: 1500, personalMoments: 1600, sharedMoments: 600 }, budget || {});
    var values = await Promise.all([
      readOptional(fresh.personaPath),
      readOptional(fresh.relationPath),
      readOptional(path.join(fresh.worldDir, "learner_profile.md")),
      readOptional(path.join(fresh.worldDir, "pal_moments.md")),
    ]);
    var entries = splitPalEntries(values[3]);
    var personal = [];
    var shared = [];
    entries.forEach(function (entry) {
      var instance = markerInstanceId(entry);
      if (instance === fresh.companionInstanceId) personal.push(entry);
      else if (instance) shared.push(entry);
      else if (legacyEntryMatchesName(entry, fresh.displayName)) shared.push(entry + "\n<!-- continuity legacy-name-match: shared -->");
      else shared.push(entry + "\n<!-- continuity legacy: shared -->");
    });
    return Object.freeze({
      snapshot: fresh,
      persona: bounded(values[0], Number(budget.persona) || 0),
      relation: bounded(values[1], Number(budget.relation) || 0),
      learnerProfile: bounded(values[2], Number(budget.learnerProfile) || 0),
      personalMoments: bounded(personal.join("\n\n"), Number(budget.personalMoments) || 0),
      sharedMoments: bounded(shared.join("\n\n"), Number(budget.sharedMoments) || 0),
    });
  }

  return Object.freeze({
    resolveCompanion: resolveCompanion,
    loadContext: loadContext,
    profilesRoot: profilesRoot,
    worldDirFor: function (scope) { return resolveWorld(scope).worldDir; },
    newCompanionInstanceId: issueInstanceId,
  });
}

module.exports = {
  SLOT_IDS: SLOT_IDS,
  IDENTITY_VERSION: IDENTITY_VERSION,
  newCompanionInstanceId: newCompanionInstanceId,
  createContextMismatchError: createContextMismatchError,
  ContextMismatchError: createContextMismatchError,
  createCompanionResolver: createCompanionResolver,
  createResolver: createCompanionResolver,
};
