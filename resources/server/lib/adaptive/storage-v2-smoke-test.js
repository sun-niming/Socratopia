#!/usr/bin/env node
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var storageModule = require("./storage-v2.js");

async function run() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-storage-v2-"));
  try {
    var storage = storageModule.createStorage({ rootDir: root });
    var scope = storage.resolveScope({ accountId: "Alice", profileId: "Profile", worldId: "World", textbookId: "Physics" });
    assert.strictEqual(scope.storageAccountId, "alice");
    assert.strictEqual(scope.storageTextbookId, "physics");
    assert.strictEqual(scope.mutationScopeKey, storageModule.mutationScopeKey(scope));
    assert.strictEqual(scope.locatorScopeKey, storageModule.locatorScopeKey(scope));
    assert.strictEqual(scope.worldRoot, path.join(root, "accounts", "alice", "profiles", "profile", "worlds", "world"));
    assert.strictEqual(scope.contentTextbookRoot, path.join(scope.worldRoot, "textbooks", "physics"), "content source path must be derived from the resolved account scope");

    assert.throws(function () {
      storage.resolveScope({ accountId: "alice", profileId: "Profile", worldId: "World", textbookId: "Physics" });
    }, function (error) { return error && error.code === "scope_alias_conflict" && error.status === 409; });

    var composed = "Caf\u00e9";
    var decomposed = "Cafe\u0301";
    var unicodeScope = storage.resolveScope({ accountId: "Unicode", profileId: decomposed, worldId: "World", textbookId: "Book" });
    var unicodeRetry = storage.resolveScope({ accountId: "Unicode", profileId: composed, worldId: "World", textbookId: "Book" });
    assert.strictEqual(unicodeScope.storageProfileId, unicodeRetry.storageProfileId);
    assert.strictEqual(unicodeScope.profileId, composed);

    ["..", "bad/name", "bad\\name", "name:stream", "trailing.", "trailing ", "CON", "con.txt", "LPT9"].forEach(function (bad) {
      assert.throws(function () { storageModule.safeSegment(bad, "testId"); }, function (error) { return error && error.code === "invalid_scope_id"; }, bad);
    });

    storage.writeArtifactAtomic(scope, "sessions/session-a.json", { schemaVersion: 1, revision: 1, value: "one" });
    assert.deepStrictEqual(storage.readArtifact(scope, "sessions/session-a.json"), { revision: 1, schemaVersion: 1, value: "one" });
    storage.writeArtifactAtomic(scope, "sessions/session-a.json", { schemaVersion: 1, revision: 2, value: "two" });
    assert.strictEqual(storage.readArtifact(scope, "sessions/session-a.json").revision, 2);
    assert.strictEqual(storage.listArtifacts(scope, "sessions/").length, 1);

    var parent = storage.resolveScope({ accountId: "Alice", profileId: "Profile", worldId: "World" });
    storage.writeArtifactAtomic(parent, "locators/sessions/session-a.json", { schemaVersion: 1, revision: 1, textbookId: "Physics" });
    assert.strictEqual(storage.readArtifact(parent, "locators/sessions/session-a.json").textbookId, "Physics");

    var other = storage.resolveScope({ accountId: "Bob", profileId: "Profile", worldId: "World", textbookId: "Physics" });
    assert.strictEqual(storage.readArtifact(other, "sessions/session-a.json"), null, "accounts must be physically isolated");
    storage.writeArtifactAtomic(other, "sessions/session-a.json", { schemaVersion: 1, revision: 1, value: "other" });
    assert.strictEqual(storage.readArtifact(scope, "sessions/session-a.json").value, "two");
    assert.strictEqual(storage.listScopes().length, 3, "all resolved textbook scopes are discoverable for startup recovery");
    var recoveredScope = storage.listScopes().find(function (item) { return item.mutationScopeKey === scope.mutationScopeKey; });
    assert(recoveredScope, "startup discovery must reconstruct the original scope");
    assert.strictEqual(recoveredScope.worldRoot, scope.worldRoot);
    assert.strictEqual(recoveredScope.contentTextbookRoot, scope.contentTextbookRoot, "startup scope reconstruction must preserve the trusted content path");

    var order = [];
    var releaseFirst;
    var firstEntered = new Promise(function (resolve) {
      storage.withScopeLock(scope.mutationScopeKey, async function () {
        order.push("first-enter");
        resolve();
        await new Promise(function (release) { releaseFirst = release; });
        order.push("first-exit");
      });
    });
    await firstEntered;
    var second = storage.withScopeLock(scope.mutationScopeKey, function () { order.push("second"); });
    await Promise.resolve();
    assert.deepStrictEqual(order, ["first-enter"]);
    releaseFirst();
    await second;
    assert.deepStrictEqual(order, ["first-enter", "first-exit", "second"]);
    var multiScopeOrder = [];
    await Promise.all([
      storage.withScopeLocks(["scope-b", "scope-a"], function () { multiScopeOrder.push("one"); }),
      storage.withScopeLocks(["scope-a", "scope-b"], function () { multiScopeOrder.push("two"); })
    ]);
    assert.deepStrictEqual(multiScopeOrder.sort(), ["one", "two"], "multi-scope locks sort keys and complete without deadlock");

    console.log("PASS: storage-v2 Windows identity, atomic files, isolation, discovery, and queues");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
