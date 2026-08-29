"use strict";

// Contract coverage for the packaged route surface.  It intentionally calls
// compiled userland handlers directly so missing/forged capabilities are
// proven before any filesystem or LLM work can run.
var assert = require("assert");
var path = require("path");
var auth = require("./lib/local-request-auth.js");
var routeAuth = require("./lib/route-auth.js");
var context = require("./lib/account-request-context.js").createAccountRequestContext();

var NOW = 2_000_000_000;
var issuer = auth.createInMemoryIssuer({
  testOnly: true,
  issuer: "contract-smoke",
  audience: "adaptive-teaching",
  currentAuthState: { accountId: "contract-account", sessionEpoch: 11 },
  scope: { accountId: "contract-account", profileId: "profile-a", worldId: "world-a", textbookId: "book-a", conversationId: "conversation-a" },
  nowSeconds: function () { return NOW; },
});
global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__ = context;
global.__SOCRATOPIA_ROUTE_AUTH__ = routeAuth.createRouteAuth({ verifier: issuer.verifier, accountRequestContext: context });
function adaptiveRuntime(verifier) {
  return {
    auth: {
      verifyRequest: function (request, body) { return verifier.verifyRequest(request, body); },
      assertNoRawAccountSelectors: auth.assertNoRawAccountSelectors,
      assertAccountScope: auth.assertAccountScope,
      assertEligible: function () {},
    },
    readinessPromise: Promise.resolve({ ok: false, code: "contract_no_storage" }),
    handlePublicRequest: function () { throw new Error("contract request must not reach storage"); },
    newTraceId: function () { return "contract-trace"; },
  };
}
global.__ADAPTIVE_TEACHING_RUNTIME__ = adaptiveRuntime(issuer.verifier);

var routes = [
  ["reading-context", "GET"], ["chat", "POST"], ["jump-page", "POST"], ["conversations", "GET"],
  ["adaptive-teaching", "GET"], ["practice", "GET"], ["flashcard", "GET"], ["concept-summary", "GET"],
  ["lesson-summary", "GET"], ["profile", "GET"], ["profile/avatar", "GET"], ["profile/reset", "POST"],
  ["world", "GET"], ["textbook", "GET"], ["diary", "GET"], ["forum", "GET"], ["search", "GET"],
  ["stats", "GET"], ["custom-companions", "GET"], ["custom-companions/avatar", "GET"],
  ["tts-audio", "GET"], ["pdf-assets", "GET"], ["knowledge-source", "GET"], ["groupchat", "GET"],
];

function load(name) {
  var compiled = require(path.join(__dirname, ".next", "server", "app", "api", name, "route.js"));
  return compiled.routeModule && compiled.routeModule.userland || null;
}

function urlFor(name, extra) {
  var query = "profileId=profile-a&worldId=world-a&textbookId=book-a&conversationId=conversation-a";
  if (name === "profile/avatar" || name === "custom-companions/avatar") query += "&id=profile-a";
  return "http://127.0.0.1/api/" + name + "?" + query + (extra ? "&" + extra : "");
}

function bodyFor(name) {
  if (name === "chat") return { messages: [{ role: "user", content: "hello" }], profileId: "profile-a", worldId: "world-a", textbookId: "book-a", conversationId: "conversation-a", teachingLanguage: "chinese" };
  if (name === "jump-page") return { profileId: "profile-a", worldId: "world-a", textbookId: "book-a", conversationId: "conversation-a", targetPage: 1 };
  if (name === "profile/reset") return { profileId: "profile-a" };
  return { profileId: "profile-a", worldId: "world-a", textbookId: "book-a", conversationId: "conversation-a" };
}

async function call(userland, method, url, headers, body) {
  var init = { method: method, headers: Object.assign({}, headers || {}) };
  if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  var handler = userland[method];
  if (typeof handler !== "function") return { status: 405, body: {} };
  var response = await handler(new Request(url, init));
  return { status: response.status, body: await response.json().catch(function () { return {}; }) };
}

async function main() {
  var valid = issuer.authorizationHeader();
  var forged = valid.slice(0, -1) + (valid.slice(-1) === "A" ? "B" : "A");
  for (var i = 0; i < routes.length; i++) {
    var name = routes[i][0], method = routes[i][1], userland = load(name), body = method === "GET" ? undefined : bodyFor(name);
    if (!userland || typeof userland[method] !== "function") { console.log("SKIP\tasync route module\t" + name); continue; }
    var missing = await call(userland, method, urlFor(name), {}, body);
    assert([401, 403, 503].indexOf(missing.status) >= 0, name + " missing auth must fail closed");
    var raw = await call(userland, method, urlFor(name), { Authorization: valid, "X-Account-Id": "contract-account" }, body);
    assert([400, 403].indexOf(raw.status) >= 0, name + " raw account selector must be rejected");
    var rawQuery = await call(userland, method, urlFor(name, "accountId=contract-account"), { Authorization: valid }, body);
    assert([400, 403].indexOf(rawQuery.status) >= 0, name + " query account selector must be rejected");
    if (method !== "GET") {
      var rawBody = await call(userland, method, urlFor(name), { Authorization: valid }, Object.assign({}, body || {}, { accountId: "contract-account" }));
      assert([400, 403].indexOf(rawBody.status) >= 0, name + " body account selector must be rejected");
    }
    var forgedResponse = await call(userland, method, urlFor(name), { Authorization: forged }, body);
    assert.strictEqual(forgedResponse.status, 401, name + " forged capability must be rejected");
    var mismatchHeader = issuer.authorizationHeader({ scope: { accountId: "contract-account", profileId: "other-profile", worldId: "other-world", textbookId: "other-book", conversationId: "other-conversation" } });
    var mismatch = await call(userland, method, urlFor(name), { Authorization: mismatchHeader }, body);
    assert([400, 403, 503].indexOf(mismatch.status) >= 0, name + " wrong scope must fail closed");
  }
  var bootstrap = await call(load("account/init"), "POST", "http://127.0.0.1/api/account/init", {}, { accountId: "legacy-bootstrap" });
  assert.notStrictEqual(bootstrap.status, 403, "account bootstrap is the explicit migration boundary");
  delete global.__SOCRATOPIA_ROUTE_AUTH__;
  delete global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__;
  delete global.__ADAPTIVE_TEACHING_RUNTIME__;
  console.log("sensitive API auth contract smoke: PASS routes=" + routes.length);
}

main().catch(function (error) { console.error(error && error.stack || error); process.exitCode = 1; });
