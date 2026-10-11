// conversations-blocks-roundtrip-smoke-test.js — T11: a conversation whose
// messages carry structured image blocks must survive save -> disk -> list
// untouched, with no migration of legacy string messages.
//
// Run by hand (the matrix skips .next/):
//   node resources/server/.next/server/app/api/conversations/conversations-blocks-roundtrip-smoke-test.js
"use strict";

var fs = require("fs");
var path = require("path");

var { TestEnvironment } = require(path.join(__dirname, "..", "..", "..", "..", "..", "smoke-test-utils.js"));

var results = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: ok });
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (ok ? "" : "  -> " + detail));
}

var IMAGE_BLOCK = { type: "image", assetId: "ast_9f3c1a2b3c4d5e6f" };
var BLOCKS_CONVERSATION = {
  id: "conv-blocks-1",
  character: "npc_a",
  createdAt: "2026-01-01T00:00:00.000Z",
  messages: [
    { role: "user", content: "纯文本旧消息，先来一条" },
    { role: "assistant", content: "好，我们看图。" },
    {
      role: "user",
      content: [
        { type: "text", text: "这张图里第二步的响应为什么也是异步的？" },
        IMAGE_BLOCK,
      ],
      turnId: "turn-2",
    },
    { role: "assistant", content: "因为……" },
  ],
};
var LEGACY_CONVERSATION = {
  id: "conv-legacy-1",
  createdAt: "2026-01-02T00:00:00.000Z",
  messages: [
    { role: "user", content: "只有字符串" },
    { role: "assistant", content: "收到" },
  ],
};

function chatFile(env, conversationId) {
  return path.join(env.tmpDir, "accounts", "test", "profiles", "test", "worlds", "test", "chats", conversationId + ".json");
}

// A companion slot in world_meta.json, otherwise the companion-continuity
// runtime rejects the save with COMPANION_WORLD_NOT_FOUND.
function seedWorld(env) {
  var baseDir = path.join(env.tmpDir, "accounts", "test", "profiles", "test", "worlds", "test");
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(path.join(baseDir, "world_meta.json"), JSON.stringify({
    worldId: "test", language: "chinese",
    companions: [{ candidateId: "fixture_a", name: "赛飞儿", companionInstanceId: "ci_aaaaaaaaaaaaaaaa" }, null, null, null],
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(baseDir, "npc_a.md"), "# 赛飞儿\n\n聪明、爱玩。", "utf8");
}

(async function main() {
  var env = new TestEnvironment({ silent: true });
  try {
    await env.setup();
    seedWorld(env);
    var auth = { Authorization: env.capabilityHeader() };
    var scope = { profileId: "test", worldId: "test" };

    // --- save a conversation whose messages contain image blocks -------------
    var saved = await env.post("/api/conversations", {
      profileId: scope.profileId, worldId: scope.worldId, conversation: BLOCKS_CONVERSATION,
    }, auth);
    check("POST /api/conversations accepts a conversation with image blocks", saved.status === 200 && /"ok":true/.test(saved.body),
      "status=" + saved.status + " body=" + saved.body.slice(0, 300));

    // --- read it back straight off disk --------------------------------------
    var file = chatFile(env, BLOCKS_CONVERSATION.id);
    var onDisk = null;
    try { onDisk = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { onDisk = null; }
    check("the conversation landed on disk", !!onDisk, "missing/unreadable: " + file);
    check("messages round-trip byte-identically (no rewrite, no migration)",
      !!onDisk && JSON.stringify(onDisk.messages) === JSON.stringify(BLOCKS_CONVERSATION.messages),
      "disk=" + JSON.stringify(onDisk && onDisk.messages).slice(0, 400));
    check("the image block keeps its assetId and shape",
      !!onDisk && Array.isArray(onDisk.messages[2].content) &&
        onDisk.messages[2].content[1].type === "image" &&
        onDisk.messages[2].content[1].assetId === IMAGE_BLOCK.assetId,
      JSON.stringify(onDisk && onDisk.messages[2]));
    check("unknown extra message fields survive", !!onDisk && onDisk.messages[2].turnId === "turn-2",
      JSON.stringify(onDisk && onDisk.messages[2]));

    // --- legacy string conversation is untouched too --------------------------
    var legacySaved = await env.post("/api/conversations", {
      profileId: scope.profileId, worldId: scope.worldId, conversation: LEGACY_CONVERSATION,
    }, auth);
    var legacyOnDisk = null;
    try { legacyOnDisk = JSON.parse(fs.readFileSync(chatFile(env, LEGACY_CONVERSATION.id), "utf8")); } catch (_) {}
    check("a legacy string conversation round-trips unchanged",
      legacySaved.status === 200 && !!legacyOnDisk &&
        JSON.stringify(legacyOnDisk.messages) === JSON.stringify(LEGACY_CONVERSATION.messages),
      "status=" + legacySaved.status + " disk=" + JSON.stringify(legacyOnDisk && legacyOnDisk.messages).slice(0, 200));
    check("legacy content is still a plain string, not a block array",
      !!legacyOnDisk && typeof legacyOnDisk.messages[0].content === "string",
      typeof (legacyOnDisk && legacyOnDisk.messages[0].content));

    // --- list still returns both --------------------------------------------
    var listed = await env.get("/api/conversations?profileId=test&worldId=test", auth);
    var listBody = null;
    try { listBody = JSON.parse(listed.body); } catch (_) {}
    var ids = listBody && Array.isArray(listBody.conversations)
      ? listBody.conversations.map(function (c) { return c && c.id; })
      : [];
    check("GET /api/conversations lists both conversations", listed.status === 200 &&
      ids.indexOf(BLOCKS_CONVERSATION.id) !== -1 && ids.indexOf(LEGACY_CONVERSATION.id) !== -1,
      "status=" + listed.status + " ids=" + JSON.stringify(ids));

    // --- re-save (idempotent overwrite) keeps the blocks ---------------------
    var again = await env.post("/api/conversations", {
      profileId: scope.profileId, worldId: scope.worldId, conversation: BLOCKS_CONVERSATION,
    }, auth);
    var reDisk = null;
    try { reDisk = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
    check("re-saving the same conversation is idempotent", again.status === 200 && !!reDisk &&
      JSON.stringify(reDisk.messages) === JSON.stringify(BLOCKS_CONVERSATION.messages),
      "status=" + again.status);

    // --- delete --------------------------------------------------------------
    var deleted = await env.get("/api/conversations?profileId=test&worldId=test&id=" + BLOCKS_CONVERSATION.id, auth);
    // DELETE is a separate verb on the same path; TestEnvironment has no delete helper.
    var http = require("http");
    var delStatus = await new Promise(function (resolve) {
      var req = http.request({
        hostname: "127.0.0.1", port: env.serverPort,
        path: "/api/conversations?profileId=test&worldId=test&id=" + BLOCKS_CONVERSATION.id,
        method: "DELETE", headers: auth,
      }, function (res) { res.resume(); resolve(res.statusCode); });
      req.on("error", function () { resolve(0); });
      req.end();
    });
    check("DELETE removes the conversation", delStatus === 200 && !fs.existsSync(file),
      "status=" + delStatus + " exists=" + fs.existsSync(file));
    check("GET on the bare path is unaffected by the earlier DELETE probe", deleted.status === 200,
      "status=" + deleted.status);
  } catch (error) {
    check("harness completed", false, error && error.stack);
  } finally {
    try { await env.teardown(); } catch (_) {}
  }

  var failed = results.filter(function (r) { return !r.ok; }).length;
  console.log("");
  console.log("conversations-blocks-roundtrip: " + (results.length - failed) + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();
