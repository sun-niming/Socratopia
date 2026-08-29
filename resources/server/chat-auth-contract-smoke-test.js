"use strict";

var assert = require("assert");
var http = require("http");
var TestEnvironment = require("./smoke-test-utils.js").TestEnvironment;

function get(env, url, headers) {
  return new Promise(function (resolve, reject) {
    var request = http.request({ hostname: "127.0.0.1", port: env.serverPort, path: url, method: "GET", headers: headers || {} }, function (response) {
      var raw = "";
      response.on("data", function (chunk) { raw += chunk; });
      response.on("end", function () { resolve({ status: response.statusCode, raw: raw }); });
    });
    request.on("error", reject);
    request.end();
  });
}

async function main() {
  var env = new TestEnvironment();
  try {
    await env.setup();
    env.mockLLM.setResponse({ choices: [{ message: { content: "authenticated reply" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    var body = {
      messages: [{ role: "user", content: "hello" }],
      profileId: "test",
      worldId: "test",
      textbookId: "math",
      conversationId: "contract-chat",
      teachingLanguage: "chinese",
      apiKey: "mock-key",
      provider: "openai",
      model: "mock-weak",
    };
    var missing = await env.postSSE("/api/chat", body);
    assert([401, 403, 503].indexOf(missing.status) >= 0, "missing capability must fail closed");
    var forged = await env.postSSE("/api/chat", body, { Authorization: "Socratopia forged" });
    assert.strictEqual(forged.status, 401, "forged capability must be rejected");
    var raw = await env.postSSE("/api/chat", body, { Authorization: env.capabilityHeader(), "X-Account-Id": "test" });
    assert.strictEqual(raw.status, 403, "raw account header must be rejected");
    var rawBody = await env.postSSE("/api/chat", Object.assign({}, body, { accountId: "test" }), { Authorization: env.capabilityHeader() });
    assert.strictEqual(rawBody.status, 403, "raw account body selector must be rejected");
    var wrongScope = env.capabilityIssuer.authorizationHeader({ scope: { accountId: "test", profileId: "other", worldId: "other", textbookId: "other", conversationId: "other" } });
    var mismatch = await env.postSSE("/api/chat", body, { Authorization: wrongScope });
    assert.strictEqual(mismatch.status, 403, "wrong scope capability must be rejected");
    var valid = await env.postSSE("/api/chat", body, { Authorization: env.capabilityHeader() });
    assert.strictEqual(valid.status, 200, "valid capability and scope must reach chat");
    assert(valid.raw.includes("data: "), "valid chat must enter the SSE contract");
    var groupUrl = "/api/groupchat?profileId=test&worldId=test";
    var groupMissing = await get(env, groupUrl);
    assert([401, 403, 503].indexOf(groupMissing.status) >= 0, "groupchat missing capability must fail closed");
    var groupRaw = await get(env, groupUrl, { Authorization: env.capabilityHeader(), "X-Account-Id": "test" });
    assert.strictEqual(groupRaw.status, 403, "groupchat raw account header must be rejected");
    var groupMismatch = await get(env, groupUrl, { Authorization: wrongScope });
    assert.strictEqual(groupMismatch.status, 403, "groupchat wrong scope capability must be rejected");
    var groupValid = await get(env, groupUrl, { Authorization: env.capabilityHeader() });
    assert([401, 403, 503].indexOf(groupValid.status) < 0, "valid capability and scope must reach groupchat business logic");
    console.log("chat auth contract smoke: PASS");
  } finally {
    await env.teardown();
  }
}

main().catch(function (error) { console.error(error && error.stack || error); process.exitCode = 1; });
