#!/usr/bin/env node
"use strict";

var assert = require("assert");
var auth = require("../local-request-auth.js");
var compiled = require("../../.next/server/app/api/adaptive-teaching/route.js");
var userland = compiled.routeModule.userland;

function issuerFor(accountId) {
  return auth.createInMemoryIssuer({
    testOnly: true,
    issuer: "route-test",
    audience: "adaptive-teaching",
    secret: Buffer.alloc(32, 9),
    currentAuthState: { accountId: accountId, sessionEpoch: 1 },
    nowSeconds: function () { return 1_787_100_000; }
  });
}

function request(method, url, authorization, body, extraHeaders) {
  var headers = Object.assign({}, extraHeaders || {});
  if (authorization) headers.authorization = authorization;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function json(response) { return { status: response.status, body: await response.json() }; }

async function run() {
  var original = global.__ADAPTIVE_TEACHING_RUNTIME__;
  try {
    delete global.__ADAPTIVE_TEACHING_RUNTIME__;
    var missing = await json(await userland.POST(request("POST", "http://127.0.0.1/api/adaptive-teaching", null, { action: "startSession" })));
    assert.strictEqual(missing.status, 503);
    assert.strictEqual(missing.body.error.code, "auth_unavailable");

    var issuer = issuerFor("RouteAccount");
    var authorization = issuer.authorizationHeader();
    var dispatchCalls = 0;
    var eligibilityCalls = 0;
    var eligible = true;
    var readinessCalls = 0;
    var readyResolve;
    var sharedReadiness = new Promise(function (resolve) { readyResolve = resolve; });
    global.__ADAPTIVE_TEACHING_RUNTIME__ = {
      auth: {
        verifyRequest: function (req, body) { return issuer.verifier.verifyRequest(req, body); },
        assertNoRawAccountSelectors: auth.assertNoRawAccountSelectors,
        assertEligible: function () {
          eligibilityCalls += 1;
          if (!eligible) {
            var error = new Error("not eligible");
            error.code = "adaptive_not_eligible";
            error.status = 403;
            error.safeToFallback = true;
            throw error;
          }
        }
      },
      readinessPromise: sharedReadiness.then(function (value) { readinessCalls += 1; return value; }),
      handlePublicRequest: function (context, method, action, payload) {
        dispatchCalls += 1;
        return { ok: true, method: method, action: action, accountId: context.accountId, requestId: payload.requestId || null };
      },
      newTraceId: function () { return "route-trace"; }
    };

    var pendingA = userland.POST(request("POST", "http://127.0.0.1/api/adaptive-teaching", authorization, { action: "startSession", requestId: "a" }));
    var pendingB = userland.POST(request("POST", "http://127.0.0.1/api/adaptive-teaching", authorization, { action: "startSession", requestId: "b" }));
    await Promise.resolve();
    assert.strictEqual(dispatchCalls, 0, "dispatch waits for shared readiness");
    readyResolve({ ok: true });
    var readyResponses = await Promise.all([pendingA, pendingB]);
    assert.strictEqual(readinessCalls, 1, "both requests observe one readiness promise");
    assert.strictEqual((await readyResponses[0].json()).accountId, "RouteAccount");
    assert.strictEqual(dispatchCalls, 2);
    assert.strictEqual(eligibilityCalls, 2);

    eligible = false;
    var ineligible = await json(await userland.POST(request("POST", "http://127.0.0.1/api/adaptive-teaching", authorization, { action: "startSession", requestId: "ineligible" })));
    assert.strictEqual(ineligible.status, 403);
    assert.strictEqual(ineligible.body.error.code, "adaptive_not_eligible");
    assert.strictEqual(ineligible.body.safeToFallback, true);
    assert.strictEqual(dispatchCalls, 2, "ineligible requests fail before dispatch");
    eligible = true;

    var beforeForbidden = dispatchCalls;
    var forbidden = await json(await userland.POST(request("POST", "http://127.0.0.1/api/adaptive-teaching", authorization, { action: "claimDecision" })));
    assert.strictEqual(forbidden.status, 403);
    assert.strictEqual(forbidden.body.error.code, "forbidden");
    assert.strictEqual(dispatchCalls, beforeForbidden);

    var rawHeader = await json(await userland.POST(request("POST", "http://127.0.0.1/api/adaptive-teaching", authorization, { action: "startSession" }, { "x-account-id": "Other" })));
    assert.strictEqual(rawHeader.status, 403);
    assert.strictEqual(dispatchCalls, beforeForbidden);
    var rawBody = await json(await userland.POST(request("POST", "http://127.0.0.1/api/adaptive-teaching", authorization, { action: "startSession", accountId: "Other" })));
    assert.strictEqual(rawBody.status, 403);
    var rawQuery = await json(await userland.GET(request("GET", "http://127.0.0.1/api/adaptive-teaching?action=state&accountId=Other", authorization)));
    assert.strictEqual(rawQuery.status, 403);
    assert.strictEqual(dispatchCalls, beforeForbidden);

    var forged = await json(await userland.POST(request("POST", "http://127.0.0.1/api/adaptive-teaching", "Socratopia forged", { action: "startSession" })));
    assert.strictEqual(forged.status, 401);
    issuer.setCurrentAuthState({ accountId: "RouteAccount", sessionEpoch: 2 });
    var oldEpoch = await json(await userland.POST(request("POST", "http://127.0.0.1/api/adaptive-teaching", authorization, { action: "startSession" })));
    assert.strictEqual(oldEpoch.status, 403);
    assert.strictEqual(oldEpoch.body.error.code, "auth_epoch_mismatch");

    var unavailableVerifier = auth.createVerifier({ issuer: "route-test", audience: "adaptive-teaching", currentAuthState: { accountId: "RouteAccount", sessionEpoch: 1 } });
    global.__ADAPTIVE_TEACHING_RUNTIME__ = {
      auth: { verifyRequest: unavailableVerifier.verifyRequest, assertNoRawAccountSelectors: auth.assertNoRawAccountSelectors, assertEligible: function () {} },
      readinessPromise: Promise.resolve({ ok: true }),
      handlePublicRequest: function () { throw new Error("must not dispatch"); }
    };
    var unavailable = await json(await userland.GET(request("GET", "http://127.0.0.1/api/adaptive-teaching?action=state", authorization)));
    assert.strictEqual(unavailable.status, 503);
    assert.strictEqual(unavailable.body.error.code, "auth_unavailable");

    var readyIssuer = issuerFor("RouteAccount");
    global.__ADAPTIVE_TEACHING_RUNTIME__ = {
      auth: { verifyRequest: readyIssuer.verifier.verifyRequest, assertNoRawAccountSelectors: auth.assertNoRawAccountSelectors, assertEligible: function () {} },
      readinessPromise: Promise.resolve({ ok: false, code: "recovery_failed" }),
      handlePublicRequest: function () { throw new Error("must not dispatch"); }
    };
    var degraded = await json(await userland.GET(request("GET", "http://127.0.0.1/api/adaptive-teaching?action=state", readyIssuer.authorizationHeader())));
    assert.strictEqual(degraded.status, 503);
    assert.strictEqual(degraded.body.error.code, "recovery_failed");

    console.log("PASS: compiled adaptive route is authenticated, readiness-gated, public-only, and fail-closed");
  } finally {
    if (original === undefined) delete global.__ADAPTIVE_TEACHING_RUNTIME__;
    else global.__ADAPTIVE_TEACHING_RUNTIME__ = original;
  }
}

run().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
