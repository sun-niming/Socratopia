// local-request-auth smoke test — no server, filesystem, settings, or user data.
"use strict";

var assert = require("assert");
var auth = require("./local-request-auth.js");

var NOW = 2_000_000_000;
var total = 0;

function test(name, run) {
  total++;
  try {
    run();
    console.log("ok " + total + " - " + name);
  } catch (error) {
    console.error("not ok " + total + " - " + name);
    throw error;
  }
}

function expectAuthError(run, code, status, forbiddenText) {
  var caught = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof auth.AuthError, "expected an AuthError");
  assert.strictEqual(caught.code, code);
  assert.strictEqual(caught.status, status);
  assert.strictEqual(caught.statusCode, status);
  assert.strictEqual(caught.toJSON().error.code, code);
  if (forbiddenText) {
    assert(!String(caught.message).includes(forbiddenText), "error message leaked capability");
    assert(!JSON.stringify(caught).includes(forbiddenText), "serialized error leaked capability");
  }
}

function request(header, extra) {
  var value = {
    headers: header === undefined ? {} : { Authorization: header },
    url: "http://127.0.0.1/api/adaptive-teaching",
  };
  Object.keys(extra || {}).forEach(function (key) {
    value[key] = extra[key];
  });
  return value;
}

function fixture() {
  return auth.createInMemoryIssuer({
    testOnly: true,
    issuer: "socratopia-smoke-test",
    audience: "adaptive-teaching",
    currentAuthState: { accountId: "account-a", sessionEpoch: 7 },
    nowSeconds: function () { return NOW; },
  });
}

test("test issuer is explicitly gated", function () {
  expectAuthError(function () {
    auth.createInMemoryIssuer({
      issuer: "not-enabled",
      audience: "adaptive-teaching",
      currentAuthState: { accountId: "account-a", sessionEpoch: 7 },
    });
  }, "test_issuer_forbidden", 403);
});

test("production issuer copies its secret and issues only current bounded claims", function () {
  var secret = Buffer.alloc(32, 7);
  var issuer = auth.createCapabilityIssuer({
    secret: secret,
    issuer: "socratopia-electron",
    audience: "adaptive-teaching",
    currentAuthState: { accountId: "account-a", sessionEpoch: 7 },
    ttlSeconds: 30,
    maxTtlSeconds: 60,
    nowSeconds: function () { return NOW; },
  });
  secret.fill(0);
  var token = issuer.issueCapability();
  var verifier = auth.createVerifier({
    secret: Buffer.alloc(32, 7),
    issuer: "socratopia-electron",
    audience: "adaptive-teaching",
    currentAuthState: { accountId: "account-a", sessionEpoch: 7 },
    maxTtlSeconds: 60,
    nowSeconds: function () { return NOW; },
  });
  var context = verifier.verifyRequest(request("Socratopia " + token));
  assert.strictEqual(context.accountId, "account-a");
  assert.strictEqual(context.expiresAt - context.issuedAt, 30);
  expectAuthError(function () { issuer.issueCapability({ accountId: "account-b" }); }, "auth_invalid", 400);
  issuer.setCurrentAuthState(null);
  expectAuthError(function () { issuer.issueCapability(); }, "auth_unavailable", 503);
});

test("valid capability creates a frozen token-free trusted context", function () {
  var f = fixture();
  var token = f.issueCapability();
  var context = f.verifier.verifyRequest(request("Socratopia " + token));
  assert.strictEqual(context.accountId, "account-a");
  assert.strictEqual(context.audience, "adaptive-teaching");
  assert.strictEqual(context.sessionEpoch, 7);
  assert(Object.isFrozen(context));
  assert(Object.isFrozen(context.claims));
  assert.strictEqual(context.token, undefined);
  assert(!JSON.stringify(context).includes(token));
  assert.strictEqual(auth.assertTrustedAccount(context, "account-a"), context);
});

test("missing issuer, secret, audience, or current state fails closed", function () {
  var full = fixture();
  var token = full.issueCapability();
  var base = {
    secret: Buffer.alloc(32, 1),
    issuer: "issuer",
    audience: "adaptive-teaching",
    currentAuthState: { accountId: "account-a", sessionEpoch: 7 },
    nowSeconds: function () { return NOW; },
  };
  ["secret", "issuer", "audience", "currentAuthState"].forEach(function (missing) {
    var options = Object.assign({}, base);
    delete options[missing];
    var verifier = auth.createVerifier(options);
    expectAuthError(function () {
      verifier.verifyRequest(request("Socratopia " + token));
    }, "auth_unavailable", 503);
  });
});

test("missing authorization is rejected when verifier is ready", function () {
  var f = fixture();
  expectAuthError(function () {
    f.verifier.verifyRequest(request());
  }, "auth_missing", 401);
});

test("raw account header is rejected and never used as authentication", function () {
  var f = fixture();
  var token = f.issueCapability();
  expectAuthError(function () {
    f.verifier.verifyRequest({
      headers: { authorization: "Socratopia " + token, "x-account-id": "account-a" },
      url: "http://127.0.0.1/api/adaptive-teaching",
    });
  }, "raw_account_id_forbidden", 403, token);
});

test("query accountId is rejected before capability use", function () {
  var f = fixture();
  var token = f.issueCapability();
  expectAuthError(function () {
    f.verifier.verifyRequest(request("Socratopia " + token, {
      url: "http://127.0.0.1/api/adaptive-teaching?accountId=account-a",
    }));
  }, "raw_account_id_forbidden", 403, token);
});

test("body accountId is rejected before capability use", function () {
  var f = fixture();
  var token = f.issueCapability();
  expectAuthError(function () {
    f.verifier.verifyRequest(request("Socratopia " + token), { action: "startSession", accountId: "account-a" });
  }, "raw_account_id_forbidden", 403, token);
});

test("forged capability is rejected without leaking it", function () {
  var f = fixture();
  var token = f.issueCapability();
  var forged = token.slice(0, -1) + (token.slice(-1) === "A" ? "B" : "A");
  expectAuthError(function () {
    f.verifier.verifyRequest(request("Socratopia " + forged));
  }, "auth_invalid", 401, forged);
});

test("expired capability is rejected", function () {
  var f = fixture();
  var token = f.issueCapability({ issuedAt: NOW - 30, expiresAt: NOW - 1 });
  expectAuthError(function () {
    f.verifier.verifyRequest(request("Socratopia " + token));
  }, "auth_expired", 401, token);
});

test("wrong audience and issuer are rejected", function () {
  var f = fixture();
  var wrongAudience = f.issueCapability({ audience: "chat" });
  expectAuthError(function () {
    f.verifier.verifyRequest(request("Socratopia " + wrongAudience));
  }, "auth_audience_mismatch", 403, wrongAudience);

  var wrongIssuer = f.issueCapability({ issuer: "another-issuer" });
  expectAuthError(function () {
    f.verifier.verifyRequest(request("Socratopia " + wrongIssuer));
  }, "auth_issuer_mismatch", 403, wrongIssuer);
});

test("account switch invalidates the old account capability immediately", function () {
  var f = fixture();
  var oldToken = f.issueCapability();
  f.setCurrentAuthState({ accountId: "account-b", sessionEpoch: 8 });
  expectAuthError(function () {
    f.verifier.verifyRequest(request("Socratopia " + oldToken));
  }, "auth_account_mismatch", 403, oldToken);
});

test("epoch advance invalidates an old capability immediately", function () {
  var f = fixture();
  var oldToken = f.issueCapability();
  f.setCurrentAuthState({ accountId: "account-a", sessionEpoch: 8 });
  expectAuthError(function () {
    f.verifier.verifyRequest(request("Socratopia " + oldToken));
  }, "auth_epoch_mismatch", 403, oldToken);
});

test("claim-to-scope mismatch is rejected", function () {
  var f = fixture();
  var context = f.verifier.verifyRequest(request(f.authorizationHeader()));
  expectAuthError(function () {
    auth.assertAccountScope(context, { accountId: "account-b" });
  }, "auth_account_mismatch", 403);
  expectAuthError(function () {
    auth.assertTrustedAccount({ accountId: "account-a" }, "account-a");
  }, "untrusted_request_context", 403);
});

test("malformed, overlong, and future-dated capabilities are rejected", function () {
  var f = fixture();
  expectAuthError(function () {
    f.verifier.verifyRequest(request("Bearer definitely-not-a-capability"));
  }, "auth_invalid", 401);
  var future = f.issueCapability({ issuedAt: NOW + 1, expiresAt: NOW + 31 });
  expectAuthError(function () {
    f.verifier.verifyRequest(request("Socratopia " + future));
  }, "auth_invalid", 401, future);
  var longLived = f.issueCapability({ issuedAt: NOW, expiresAt: NOW + 121 });
  expectAuthError(function () {
    f.verifier.verifyRequest(request("Socratopia " + longLived));
  }, "auth_invalid", 401, longLived);
});

test("Authorization header parsing is case-insensitive by header name only", function () {
  var f = fixture();
  var token = f.issueCapability();
  var context = f.verifier.verifyRequest({
    headers: { authorization: "Socratopia " + token },
    url: "http://127.0.0.1/api/adaptive-teaching",
  });
  assert.strictEqual(context.accountId, "account-a");
  expectAuthError(function () {
    f.verifier.verifyRequest(request("socratopia " + token));
  }, "auth_invalid", 401, token);
});

console.log(total + " tests, all passed");
