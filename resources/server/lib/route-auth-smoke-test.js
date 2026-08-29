"use strict";

var assert = require("assert");
var auth = require("./local-request-auth.js");
var routeAuth = require("./route-auth.js");

var now = 2_000_000_000;
var issuer = auth.createInMemoryIssuer({
  testOnly: true,
  issuer: "route-smoke",
  audience: "adaptive-teaching",
  currentAuthState: { accountId: "account-a", sessionEpoch: 4 },
  scope: { accountId: "account-a", profileId: "profile-a", worldId: "world-a", textbookId: "book-a", conversationId: "conversation-a" },
  nowSeconds: function () { return now; },
});
var contextStore = require("./account-request-context.js").createAccountRequestContext();
var facade = routeAuth.createRouteAuth({ verifier: issuer.verifier, accountRequestContext: contextStore });

function request(url, body, headers) {
  var raw = body === undefined ? undefined : JSON.stringify(body);
  var req = new Request(url, { method: body === undefined ? "GET" : "POST", headers: Object.assign({ Authorization: issuer.authorizationHeader() }, headers || {}), body: raw });
  return req;
}

async function main() {
  var ok = await facade.dispatch(async function (req) { return new Response(JSON.stringify({ account: contextStore.getAccountId(), url: req.url }), { status: 200 }); }, request("http://127.0.0.1/api/reading-context?profileId=profile-a&worldId=world-a&textbookId=book-a"), [], "/api/reading-context");
  assert.strictEqual(ok.status, 200);
  var body = await ok.json();
  assert.strictEqual(body.account, "account-a");

  var missing = await facade.dispatch(async function () { throw new Error("must not run"); }, new Request("http://127.0.0.1/api/profile"), [], "/api/profile");
  assert.strictEqual(missing.status, 401);

  var raw = await facade.dispatch(async function () { throw new Error("must not run"); }, new Request("http://127.0.0.1/api/profile?accountId=account-a"), [], "/api/profile");
  assert.strictEqual(raw.status, 403);

  var mismatch = await facade.dispatch(async function () { throw new Error("must not run"); }, request("http://127.0.0.1/api/reading-context?profileId=profile-b&worldId=world-a&textbookId=book-a"), [], "/api/reading-context");
  assert.strictEqual(mismatch.status, 403);

  var bootstrap = await facade.dispatch(async function () { return new Response("ok", { status: 200 }); }, new Request("http://127.0.0.1/api/account/init", { method: "POST", body: JSON.stringify({ accountId: "legacy" }) }), [], "/api/account/init");
  assert.strictEqual(bootstrap.status, 200);
  console.log("route-auth smoke test passed");
}

main().catch(function (error) { console.error(error); process.exitCode = 1; });
