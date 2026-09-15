"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var routePath = path.join(__dirname, "route.js");
var source = fs.readFileSync(routePath, "utf8");
var start = source.indexOf("function continuityDiaryHash(");
var helpersEnd = source.indexOf("let y=", start);
var handlersEnd = source.indexOf(",A=new e.AppRouteRouteModule", start);
assert.ok(start >= 0 && helpersEnd > start && handlersEnd > helpersEnd, "diary continuity code is discoverable");
var helpers = Function("require", "var aa=require('crypto');" + source.slice(start, helpersEnd) + ";return { hash: continuityDiaryHash, etag: continuityDiaryEtag, expected: continuityDiaryExpectedHash };")(require);
var hash = helpers.hash("manual diary");
assert.strictEqual(hash, "02d6cabc09ee5069a5312e1f13b90be9d34460a4faafe0d4e4ae36aafcc1310e", "content hash uses SHA-256");
assert.strictEqual(helpers.etag(hash), '"' + hash + '"', "ETag is a quoted content hash");
assert.strictEqual(helpers.expected({ expectedHash: hash }, { headers: { get: function () { return null; } } }), hash, "body expectedHash is accepted");
assert.strictEqual(helpers.expected({}, { headers: { get: function () { return 'W/"' + hash + '"'; } } }), hash, "If-Match is accepted and normalized");
assert.strictEqual(helpers.expected({}, { headers: { get: function () { return null; } } }), null, "old clients may omit a hash");
assert.throws(function () {
  helpers.expected({ expectedHash: "stale" }, { headers: { get: function () { return null; } } });
}, function (error) {
  return error && error.code === "DIARY_HASH_INVALID" && error.status === 400;
}, "invalid revision hashes are rejected");

var diary = { "diary/2026-08.md": "loaded diary" };
var writes = [];
var world = {
  jo: async function () { return ["2026-08"]; },
  Dp: async function (_profileId, _worldId, relativePath) { return diary[relativePath] || ""; },
  YK: async function (_profileId, _worldId, relativePath, content) { diary[relativePath] = content; writes.push({ relativePath: relativePath, content: content }); }
};
var next = { NextResponse: { json: function (body, init) { return { body: body, status: init && init.status || 200, headers: init && init.headers || {} }; } } };
var handlers = Function("aa", "v", "w", "x", source.slice(start, handlersEnd) + ";return { GET: y, POST: z };")(require("crypto"), next, world, { pW: function (handler) { return handler; } });
var savedRuntime = global.__COMPANION_CONTINUITY__;

async function run() {
  try {
    var getResponse = await handlers.GET({ nextUrl: { searchParams: new URLSearchParams({ profileId: "profile_a", worldId: "world_a", month: "2026-08" }) } });
    var loadedHash = helpers.hash("loaded diary");
    assert.strictEqual(getResponse.status, 200, "GET succeeds");
    assert.strictEqual(getResponse.body.contentHash, loadedHash, "GET returns contentHash");
    assert.strictEqual(getResponse.headers.ETag, '"' + loadedHash + '"', "GET returns ETag");

    var manualInput = null;
    global.__COMPANION_CONTINUITY__ = {
      enabled: true,
      writeManualDiary: async function (input) {
        manualInput = input;
        return { contentHash: helpers.hash(input.content), replayed: false };
      }
    };
    var globalPost = await handlers.POST({
      json: async function () { return { profileId: "profile_a", worldId: "world_a", month: "2026-08", content: "manual edit", expectedHash: loadedHash }; },
      headers: { get: function () { return null; } }
    });
    assert.deepStrictEqual(manualInput, { scope: { profileId: "profile_a", worldId: "world_a" }, month: "2026-08", content: "manual edit", expectedHash: loadedHash }, "registered writer receives only trusted scope plus revision assertion");
    assert.strictEqual(globalPost.status, 200, "registered writer success is returned");
    assert.strictEqual(globalPost.body.contentHash, helpers.hash("manual edit"), "POST returns the committed contentHash");

    delete global.__COMPANION_CONTINUITY__;
    diary["diary/2026-08.md"] = "end-class update";
    var conflict = await handlers.POST({
      json: async function () { return { profileId: "profile_a", worldId: "world_a", month: "2026-08", content: "stale manual edit", expectedHash: loadedHash }; },
      headers: { get: function () { return null; } }
    });
    var actualHash = helpers.hash("end-class update");
    assert.strictEqual(conflict.status, 409, "fallback detects a stale expectedHash");
    assert.strictEqual(conflict.body.code, "DIARY_CONFLICT", "fallback uses the documented conflict code");
    assert.strictEqual(conflict.body.actualHash, actualHash, "fallback returns the actual hash");
    assert.strictEqual(conflict.headers.ETag, '"' + actualHash + '"', "fallback conflict returns the actual ETag");

    var fallbackPost = await handlers.POST({
      json: async function () { return { profileId: "profile_a", worldId: "world_a", month: "2026-08", content: "legacy client write" }; },
      headers: { get: function () { return null; } }
    });
    assert.strictEqual(fallbackPost.status, 200, "clients without expectedHash remain compatible");
    assert.strictEqual(diary["diary/2026-08.md"], "legacy client write", "fallback writes the requested content");
    assert.strictEqual(writes.length, 1, "only the no-hash fallback uses the legacy writer in this harness");

    global.__COMPANION_CONTINUITY__ = {
      enabled: true,
      writeManualDiary: async function () {
        var error = new Error("Diary changed since it was loaded");
        error.code = "DIARY_CONFLICT";
        error.status = 409;
        error.actualHash = helpers.hash("transaction winner");
        throw error;
      }
    };
    var runtimeConflict = await handlers.POST({
      json: async function () { return { profileId: "profile_a", worldId: "world_a", month: "2026-08", content: "losing edit", expectedHash: helpers.hash("legacy client write") }; },
      headers: { get: function () { return null; } }
    });
    assert.strictEqual(runtimeConflict.status, 409, "global transaction conflicts propagate as 409");
    assert.strictEqual(runtimeConflict.body.code, "DIARY_CONFLICT", "global transaction conflicts retain the documented code");
    assert.strictEqual(runtimeConflict.body.actualHash, helpers.hash("transaction winner"), "global transaction conflicts retain actualHash");

    assert.ok(source.includes("CONTINUITY_PRECONDITION_FAILED"), "transaction precondition races are normalized at the route boundary");
    assert.ok(source.includes("writeManualDiary"), "POST delegates to the continuity manual-diary writer when registered");
    console.log("diary continuity smoke: PASS");
  } finally {
    if (savedRuntime === undefined) delete global.__COMPANION_CONTINUITY__;
    else global.__COMPANION_CONTINUITY__ = savedRuntime;
  }
}

run().catch(function (error) {
  console.error("diary continuity smoke: FAIL", error && error.stack || error);
  process.exitCode = 1;
});