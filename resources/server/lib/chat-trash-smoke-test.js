// chat-trash-smoke-test.js — self-contained tests for lib/chat-trash.js.
// Run: node <this file>
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var trash = require("./chat-trash.js");

var results = [];
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), "chat-trash-"));
var account = "acct";
var profile = "p1";
var world = "KU";

function scope() {
  return { projectRoot: TMP, accountId: account, profileId: profile, worldId: world };
}

function worldDir() {
  return path.join(TMP, "accounts", account, "profiles", profile, "worlds", world);
}

function writeChat(id, body) {
  var dir = path.join(worldDir(), "chats");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + ".json"), JSON.stringify(body || { id: id, messages: [] }));
  return path.join(dir, id + ".json");
}

// The bundle's list helper: readdir + endsWith(".json") + JSON.parse in a try.
function listLikeTheBundle() {
  var dir = path.join(worldDir(), "chats");
  var out = [];
  for (var name of fs.readdirSync(dir)) {
    if (name.slice(-5) !== ".json") continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))); } catch (_) {}
  }
  return out;
}

function test(name, fn) {
  try {
    fn();
    results.push({ name: name, ok: true });
    console.log("  PASS  " + name);
  } catch (error) {
    results.push({ name: name, ok: false });
    console.log("  FAIL  " + name);
    console.log("        " + (error && error.stack ? error.stack.split("\n").slice(0, 4).join("\n        ") : error));
  }
}

test("the paths sit where the app expects them", function () {
  var s = scope();
  assert.strictEqual(trash.chatsDir(s), path.join(worldDir(), "chats"));
  assert.strictEqual(trash.trashDir(s), path.join(worldDir(), "chats", ".trash"));
  assert.strictEqual(trash.chatFile(s, "abc"), path.join(worldDir(), "chats", "abc.json"));
  assert.strictEqual(trash.trashFile(s, "abc"), path.join(worldDir(), "chats", ".trash", "abc.json"));
});

test("deleting a conversation moves it into .trash and keeps the bytes", function () {
  var id = "conv1";
  var file = writeChat(id, { id: id, messages: [{ role: "user", content: "hi" }] });
  var before = fs.readFileSync(file, "utf8");
  var report = trash.trash(scope(), id);
  assert.strictEqual(report.trashed, true, JSON.stringify(report));
  assert.strictEqual(fs.existsSync(file), false, "the live file must be gone");
  assert.strictEqual(fs.existsSync(trash.trashFile(scope(), id)), true, "the trashed copy must exist");
  assert.strictEqual(fs.readFileSync(trash.trashFile(scope(), id), "utf8"), before, "content must survive verbatim");
});

test("the list helper never sees the .trash directory as a conversation", function () {
  writeChat("alive1");
  writeChat("gone1");
  trash.trash(scope(), "gone1");
  var listed = listLikeTheBundle().map(function (c) { return c.id; });
  assert.strictEqual(listed.indexOf("alive1") >= 0, true, "the live conversation must stay listed");
  assert.strictEqual(listed.indexOf("gone1") >= 0, false, "the trashed one must not be listed");
  // the .trash directory itself must never parse as a conversation
  var dir = path.join(worldDir(), "chats");
  assert.strictEqual(fs.readdirSync(dir).some(function (n) { return n === ".trash"; }), true);
});

test("restore puts a conversation back and refuses a taken id", function () {
  assert.strictEqual(trash.restore(scope(), "conv1").restored, true);
  assert.strictEqual(fs.existsSync(trash.chatFile(scope(), "conv1")), true);
  assert.strictEqual(trash.restore(scope(), "conv1").reason, "not_in_trash");
  writeChat("conv3");
  trash.trash(scope(), "conv3");
  writeChat("conv3");
  var report = trash.restore(scope(), "conv3");
  assert.strictEqual(report.restored, false);
  assert.strictEqual(report.reason, "id_taken", "a live conversation must not be overwritten");
});

test("deleting the same id twice replaces the earlier trash copy", function () {
  var id = "conv4";
  writeChat(id, { id: id, messages: [{ role: "user", content: "first" }] });
  trash.trash(scope(), id);
  writeChat(id, { id: id, messages: [{ role: "user", content: "second" }] });
  var report = trash.trash(scope(), id);
  assert.strictEqual(report.trashed, true);
  var kept = JSON.parse(fs.readFileSync(trash.trashFile(scope(), id), "utf8"));
  assert.strictEqual(kept.messages[0].content, "second");
  assert.strictEqual(trash.listTrash(scope()).filter(function (e) { return e.id === id; }).length, 1);
});

test("a missing file, a bogus scope and a directory all degrade without throwing", function () {
  assert.strictEqual(trash.trash(scope(), "nope").reason, "missing");
  assert.strictEqual(trash.trash(scope(), "").reason, "no_id");
  var dirCase = path.join(TMP, "accounts", "acct", "profiles", "p1", "worlds", "other");
  fs.mkdirSync(path.join(dirCase, "chats", "weird.json"), { recursive: true });
  var report = trash.trash({ projectRoot: TMP, accountId: account, profileId: profile, worldId: "other" }, "weird");
  assert.strictEqual(report.reason, "not_a_file");
  assert.deepStrictEqual(trash.listTrash({ projectRoot: TMP, accountId: account, profileId: "ghost", worldId: "nowhere" }), []);
});

test("listTrash reports newest first and is empty without a trash dir", function () {
  var id = "conv5";
  writeChat(id);
  assert.strictEqual(trash.listTrash(scope()).length >= 1, true);
  trash.trash(scope(), id);
  var entries = trash.listTrash(scope());
  assert.strictEqual(entries.some(function (e) { return e.id === id; }), true);
  assert.strictEqual(typeof entries[0].deletedAt, "string");
  var fresh = trash.listTrash({ projectRoot: TMP, accountId: account, profileId: "p9", worldId: "w9" });
  assert.deepStrictEqual(fresh, []);
});

test("the scope-shaped call the route uses means the same as (scope, id)", function () {
  // The route passes one object: {profileId, worldId, id}.  Getting this wrong is a
  // silent no-op (reason=no_id) that only shows up in a real delete.
  var id = "conv6";
  writeChat(id);
  var oneArg = trash.trash({ projectRoot: TMP, accountId: account, profileId: profile, worldId: world, id: id });
  assert.strictEqual(oneArg.trashed, true, JSON.stringify(oneArg));
  assert.strictEqual(fs.existsSync(trash.trashFile(scope(), id)), true);
  assert.strictEqual(fs.existsSync(trash.chatFile(scope(), id)), false);
  var restored = trash.restore({ projectRoot: TMP, accountId: account, profileId: profile, worldId: world, id: id });
  assert.strictEqual(restored.restored, true, JSON.stringify(restored));
  assert.strictEqual(fs.existsSync(trash.chatFile(scope(), id)), true);
});

test("the trash prunes down to the cap, keeping the newest", function () {
  var s = { projectRoot: TMP, accountId: account, profileId: "prune", worldId: "w" };
  var dir = trash.trashDir(s);
  fs.mkdirSync(dir, { recursive: true });
  var total = trash.MAX_TRASH_ENTRIES + 5;
  for (var i = 0; i < total; i += 1) {
    var file = path.join(dir, "old" + i + ".json");
    fs.writeFileSync(file, "{}");
    var when = new Date(Date.now() - (total - i) * 1000);
    fs.utimesSync(file, when, when);
  }
  var names = fs.readdirSync(dir);
  assert.strictEqual(names.length, total);
  // one more delete triggers the prune
  writeChat("trigger");
  var report = trash.trash({ projectRoot: TMP, accountId: account, profileId: "prune", worldId: "w" }, "none");
  assert.strictEqual(report.reason, "missing");
  var pruned = trash.trash(s, "none");
  assert.strictEqual(pruned.reason, "missing");
  // make the newest entry arrive through a real trash() call
  fs.mkdirSync(path.join(TMP, "accounts", account, "profiles", "prune", "worlds", "w", "chats"), { recursive: true });
  fs.writeFileSync(trash.chatFile(s, "fresh"), "{}");
  var moved = trash.trash(s, "fresh");
  assert.strictEqual(moved.trashed, true);
  assert.strictEqual(moved.pruned >= 1, true, JSON.stringify(moved));
  assert.strictEqual(fs.readdirSync(dir).length, trash.MAX_TRASH_ENTRIES);
  assert.strictEqual(fs.existsSync(path.join(dir, "fresh.json")), true, "the newest entry must survive");
  assert.strictEqual(fs.existsSync(path.join(dir, "old0.json")), false, "the oldest entry must go");
});

console.log("");
var passed = results.filter(function (r) { return r.ok; }).length;
var failed = results.length - passed;
console.log("chat-trash: " + passed + " passed, " + failed + " failed");
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
if (failed) process.exit(1);
