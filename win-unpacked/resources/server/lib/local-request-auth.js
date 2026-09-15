// local-request-auth.js — fail-closed verification for local desktop capabilities.
//
// A capability is the only source of account identity for HTTP requests. The
// verifier deliberately has no fallback to an account header, query parameter,
// process global, or profile lookup. The in-memory issuer is test-only.
"use strict";

var crypto = require("crypto");

var AUTHORIZATION_SCHEME = "Socratopia";
var DEFAULT_MAX_TTL_SECONDS = 120;
var MAX_TOKEN_LENGTH = 8192;
var MIN_SECRET_BYTES = 32;
var IDENTIFIER_RE = /^[A-Za-z0-9_-]{1,64}$/;
var SCOPE_KEYS = ["accountId", "profileId", "worldId", "textbookId", "conversationId"];
var trustedContexts = new WeakSet();

var SAFE_MESSAGES = {
  auth_unavailable: "Local request authentication is unavailable",
  auth_missing: "A local request capability is required",
  auth_invalid: "The local request capability is invalid",
  auth_expired: "The local request capability has expired",
  auth_audience_mismatch: "The local request capability is not valid for this service",
  auth_issuer_mismatch: "The local request capability was issued by an unexpected issuer",
  auth_account_mismatch: "The local request capability is not valid for this account",
  auth_epoch_mismatch: "The local request capability is no longer valid for this session",
  auth_scope_mismatch: "The local request capability is not valid for this scope",
  scope_invalid: "The requested scope is invalid",
  raw_account_id_forbidden: "Raw account selectors are not accepted",
  untrusted_request_context: "The trusted request context is invalid",
  test_issuer_forbidden: "The in-memory capability issuer is test-only",
};

function AuthError(code, status) {
  Error.call(this);
  this.name = "AuthError";
  this.code = typeof code === "string" && code ? code : "auth_invalid";
  this.status = Number.isInteger(status) ? status : 401;
  this.statusCode = this.status;
  this.message = SAFE_MESSAGES[this.code] || "Local request authentication failed";
  if (Error.captureStackTrace) Error.captureStackTrace(this, AuthError);
}

AuthError.prototype = Object.create(Error.prototype);
AuthError.prototype.constructor = AuthError;
AuthError.prototype.toJSON = function () {
  return { error: { code: this.code, message: this.message, status: this.status } };
};

function authError(code, status) {
  return new AuthError(code, status);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function hasOwnCaseInsensitive(object, expectedKey) {
  if (!isRecord(object)) return false;
  var expected = String(expectedKey).toLowerCase();
  return Object.keys(object).some(function (key) { return String(key).toLowerCase() === expected; });
}

function readHeader(headers, expectedName) {
  if (!headers) return { present: false, value: null };
  var expected = String(expectedName).toLowerCase();
  if (typeof headers.has === "function" && typeof headers.get === "function") {
    try {
      if (!headers.has(expectedName)) return { present: false, value: null };
      return { present: true, value: headers.get(expectedName) };
    } catch (_) {
      return { present: false, value: null };
    }
  }
  if (!isRecord(headers)) return { present: false, value: null };
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i]).toLowerCase() === expected) return { present: true, value: headers[keys[i]] };
  }
  return { present: false, value: null };
}

function hasAccountIdInSearchParams(searchParams) {
  if (!searchParams) return false;
  if (typeof searchParams.keys === "function") {
    try {
      var iterator = searchParams.keys();
      var next = iterator.next();
      while (!next.done) {
        if (String(next.value).toLowerCase() === "accountid") return true;
        next = iterator.next();
      }
      return false;
    } catch (_) {
      return false;
    }
  }
  return hasOwnCaseInsensitive(searchParams, "accountId");
}

function requestHasRawAccountSelector(request, body) {
  request = request || {};
  if (readHeader(request.headers, "X-Account-Id").present) return true;
  if (hasOwnCaseInsensitive(request.query, "accountId")) return true;
  if (hasAccountIdInSearchParams(request.nextUrl && request.nextUrl.searchParams)) return true;
  if (typeof request.url === "string") {
    try {
      var parsedUrl = new URL(request.url, "http://127.0.0.1");
      if (hasAccountIdInSearchParams(parsedUrl.searchParams)) return true;
    } catch (_) {
      // Malformed URLs are rejected by the route; never infer an identity here.
    }
  }
  var candidateBody = body === undefined ? request.body : body;
  return hasOwnCaseInsensitive(candidateBody, "accountId");
}

function assertNoRawAccountSelectors(request, body) {
  if (requestHasRawAccountSelector(request, body)) throw authError("raw_account_id_forbidden", 403);
}

function encodeBase64Url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9_-]+$/.test(value)) throw authError("auth_invalid", 401);
  var remainder = value.length % 4;
  if (remainder === 1) throw authError("auth_invalid", 401);
  var padded = value.replace(/-/g, "+").replace(/_/g, "/");
  if (remainder) padded += new Array(5 - remainder).join("=");
  var decoded;
  try { decoded = Buffer.from(padded, "base64"); } catch (_) { throw authError("auth_invalid", 401); }
  if (encodeBase64Url(decoded) !== value) throw authError("auth_invalid", 401);
  return decoded;
}

function normalizeSecret(secret) {
  var value = null;
  if (Buffer.isBuffer(secret)) value = Buffer.from(secret);
  else if (secret instanceof Uint8Array) value = Buffer.from(secret);
  else if (typeof secret === "string") value = Buffer.from(secret, "utf8");
  return value && value.length >= MIN_SECRET_BYTES ? value : null;
}

function validBoundedString(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function validIdentifier(value) {
  return typeof value === "string" && IDENTIFIER_RE.test(value);
}

function validEpoch(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeCurrentAuthState(state) {
  if (!isRecord(state) || !validIdentifier(state.accountId) || !validEpoch(state.sessionEpoch)) return null;
  return { accountId: state.accountId, sessionEpoch: state.sessionEpoch };
}

function normalizeScopeValue(value) {
  if (value === "*") return "*";
  if (typeof value === "string") {
    if (!validIdentifier(value)) throw authError("auth_invalid", 401);
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && value.length <= 64) {
    var values = value.map(function (item) {
      if (!validIdentifier(item)) throw authError("auth_invalid", 401);
      return item;
    });
    return Object.freeze(values.slice().sort());
  }
  throw authError("auth_invalid", 401);
}

function normalizeScope(scope, accountId) {
  if (scope === undefined || scope === null) return Object.freeze({ accountId: accountId });
  if (!isRecord(scope)) throw authError("auth_invalid", 401);
  var normalized = {};
  SCOPE_KEYS.forEach(function (key) {
    if (!hasOwn(scope, key)) return;
    var value = normalizeScopeValue(scope[key]);
    if (key === "accountId" && value !== "*" && value !== accountId && !(Array.isArray(value) && value.indexOf(accountId) >= 0)) throw authError("auth_account_mismatch", 403);
    normalized[key] = value;
  });
  if (!hasOwn(normalized, "accountId")) normalized.accountId = accountId;
  return Object.freeze(normalized);
}

function nowSeconds(options) {
  var value;
  if (options && typeof options.nowSeconds === "function") value = options.nowSeconds();
  else if (options && typeof options.clock === "function") value = options.clock() / 1000;
  else value = Date.now() / 1000;
  value = Number(value);
  return Number.isFinite(value) ? Math.floor(value) : null;
}

function parseAuthorization(value) {
  if (value === undefined || value === null || value === "") throw authError("auth_missing", 401);
  if (Array.isArray(value) || typeof value !== "string" || value.length > MAX_TOKEN_LENGTH + 32) throw authError("auth_invalid", 401);
  var match = /^Socratopia[ \t]+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(value);
  if (!match) throw authError("auth_invalid", 401);
  return match[1];
}

function signPayload(payloadPart, secret) {
  return crypto.createHmac("sha256", secret).update(payloadPart, "ascii").digest();
}

function parseAndVerifyToken(token, secret) {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) throw authError("auth_invalid", 401);
  var parts = token.split(".");
  if (parts.length !== 2) throw authError("auth_invalid", 401);
  var suppliedSignature = decodeBase64Url(parts[1]);
  var expectedSignature = signPayload(parts[0], secret);
  if (suppliedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(suppliedSignature, expectedSignature)) throw authError("auth_invalid", 401);
  var claims;
  try { claims = JSON.parse(decodeBase64Url(parts[0]).toString("utf8")); }
  catch (error) { if (error instanceof AuthError) throw error; throw authError("auth_invalid", 401); }
  if (!isRecord(claims)) throw authError("auth_invalid", 401);
  return claims;
}

function audienceMatches(actual, expected) {
  return Array.isArray(expected) ? expected.indexOf(actual) >= 0 : actual === expected;
}

function validateClaims(claims, options, state) {
  if (!validIdentifier(claims.accountId) || !validBoundedString(claims.audience, 256) || !validBoundedString(claims.issuer, 256) || !validBoundedString(claims.nonce, 256) || claims.nonce.length < 16 || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt) || !validEpoch(claims.sessionEpoch) || claims.expiresAt <= claims.issuedAt) throw authError("auth_invalid", 401);
  var scope = normalizeScope(claims.scope, claims.accountId);
  var currentTime = nowSeconds(options);
  if (currentTime === null) throw authError("auth_unavailable", 503);
  var clockSkewSeconds = Number.isFinite(options.clockSkewSeconds) ? Math.max(0, Math.min(30, Math.floor(options.clockSkewSeconds))) : 0;
  var maxTtlSeconds = Number.isFinite(options.maxTtlSeconds) ? Math.max(1, Math.floor(options.maxTtlSeconds)) : DEFAULT_MAX_TTL_SECONDS;
  if (claims.issuedAt > currentTime + clockSkewSeconds) throw authError("auth_invalid", 401);
  if (claims.expiresAt <= currentTime - clockSkewSeconds) throw authError("auth_expired", 401);
  if (claims.expiresAt - claims.issuedAt > maxTtlSeconds) throw authError("auth_invalid", 401);
  if (!audienceMatches(claims.audience, options.audience)) throw authError("auth_audience_mismatch", 403);
  if (claims.issuer !== options.issuer) throw authError("auth_issuer_mismatch", 403);
  if (claims.accountId !== state.accountId) throw authError("auth_account_mismatch", 403);
  if (claims.sessionEpoch !== state.sessionEpoch) throw authError("auth_epoch_mismatch", 403);
  return scope;
}

function makeTrustedContext(claims, scope) {
  var frozenScope = Object.freeze(Object.assign({}, scope));
  var frozenClaims = Object.freeze({
    accountId: claims.accountId,
    audience: claims.audience,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    sessionEpoch: claims.sessionEpoch,
    nonce: claims.nonce,
    issuer: claims.issuer,
    scope: frozenScope,
  });
  var context = {
    accountId: frozenClaims.accountId,
    audience: frozenClaims.audience,
    issuedAt: frozenClaims.issuedAt,
    expiresAt: frozenClaims.expiresAt,
    sessionEpoch: frozenClaims.sessionEpoch,
    nonce: frozenClaims.nonce,
    issuer: frozenClaims.issuer,
    scope: frozenScope,
    claims: frozenClaims,
  };
  trustedContexts.add(context);
  return Object.freeze(context);
}

function scopeAllows(granted, expected) {
  if (granted === "*") return true;
  if (Array.isArray(granted)) return granted.indexOf(expected) >= 0;
  return granted === expected;
}

function assertScopeValue(context, key, expected) {
  if (expected === undefined || expected === null || expected === "") return;
  if (!validIdentifier(expected)) throw authError("scope_invalid", 400);
  var scope = context.scope || {};
  if (!scopeAllows(scope[key], expected)) throw authError(key === "accountId" ? "auth_account_mismatch" : "auth_scope_mismatch", 403);
}

function assertTrustedAccount(context, expectedAccountOrScope) {
  if (!isRecord(context) || !trustedContexts.has(context)) throw authError("untrusted_request_context", 403);
  var expected = isRecord(expectedAccountOrScope) ? expectedAccountOrScope : { accountId: expectedAccountOrScope };
  if (!validIdentifier(context.accountId)) throw authError("auth_account_mismatch", 403);
  SCOPE_KEYS.forEach(function (key) { if (hasOwn(expected, key)) assertScopeValue(context, key, expected[key]); });
  if (hasOwn(expected, "accountId") && context.accountId !== expected.accountId) throw authError("auth_account_mismatch", 403);
  return context;
}

function createVerifier(options) {
  options = options || {};
  var secret = normalizeSecret(options.secret);
  var issuer = validBoundedString(options.issuer, 256) ? options.issuer : null;
  var audience = Array.isArray(options.audience) ? options.audience.filter(function (value) { return validBoundedString(value, 256); }) : validBoundedString(options.audience, 256) ? [options.audience] : [];
  var currentAuthState = options.currentAuthState || null;

  function getState() {
    var candidate;
    try { candidate = typeof options.getCurrentAuthState === "function" ? options.getCurrentAuthState() : currentAuthState; }
    catch (_) { throw authError("auth_unavailable", 503); }
    var state = normalizeCurrentAuthState(candidate);
    if (!state) throw authError("auth_unavailable", 503);
    return state;
  }

  function assertAvailable() {
    if (!secret || !issuer || !audience.length) throw authError("auth_unavailable", 503);
  }

  function verifyAuthorization(authorizationValue, expectedScope) {
    assertAvailable();
    var state = getState();
    var claims = parseAndVerifyToken(parseAuthorization(authorizationValue), secret);
    var scope = validateClaims(claims, { issuer: issuer, audience: audience, maxTtlSeconds: options.maxTtlSeconds, clockSkewSeconds: options.clockSkewSeconds, nowSeconds: options.nowSeconds, clock: options.clock }, state);
    var context = makeTrustedContext(claims, scope);
    return expectedScope === undefined ? context : assertTrustedAccount(context, expectedScope);
  }

  function verifyRequest(request, body, expectedScope) {
    assertNoRawAccountSelectors(request, body);
    assertAvailable();
    var state = getState();
    var authorization = readHeader(request && request.headers, "Authorization");
    var claims = parseAndVerifyToken(parseAuthorization(authorization.present ? authorization.value : null), secret);
    var scope = validateClaims(claims, { issuer: issuer, audience: audience, maxTtlSeconds: options.maxTtlSeconds, clockSkewSeconds: options.clockSkewSeconds, nowSeconds: options.nowSeconds, clock: options.clock }, state);
    var context = makeTrustedContext(claims, scope);
    return expectedScope === undefined ? context : assertTrustedAccount(context, expectedScope);
  }

  function assertCurrentContext(context) {
    assertTrustedAccount(context, context && context.accountId);
    var state = getState();
    if (context.accountId !== state.accountId) throw authError("auth_account_mismatch", 403);
    if (context.sessionEpoch !== state.sessionEpoch) throw authError("auth_epoch_mismatch", 403);
    return context;
  }

  function setCurrentAuthState(nextState) { currentAuthState = nextState || null; }

  return Object.freeze({ verifyRequest: verifyRequest, verifyAuthorization: verifyAuthorization, assertCurrentContext: assertCurrentContext, setCurrentAuthState: setCurrentAuthState });
}

function authenticateRequest(request, options) {
  options = options || {};
  return createVerifier(options).verifyRequest(request, options.body, options.scope);
}

function createCapabilityIssuer(options) {
  options = options || {};
  var secret = normalizeSecret(options.secret);
  if (!secret || !validBoundedString(options.issuer, 256) || !validBoundedString(options.audience, 256)) throw authError("auth_unavailable", 503);
  var currentAuthState = options.currentAuthState || null;
  var maxTtlSeconds = Number.isFinite(options.maxTtlSeconds) ? Math.max(1, Math.floor(options.maxTtlSeconds)) : DEFAULT_MAX_TTL_SECONDS;
  var ttlSeconds = Number.isFinite(options.ttlSeconds) ? Math.max(1, Math.floor(options.ttlSeconds)) : 30;
  if (ttlSeconds > maxTtlSeconds) throw authError("auth_unavailable", 503);
  function getCurrentAuthState() { return currentAuthState; }
  function setCurrentAuthState(nextState) { currentAuthState = nextState || null; }
  function issueCapability() {
    if (arguments.length) throw authError("auth_invalid", 400);
    var state = normalizeCurrentAuthState(currentAuthState);
    var issuedAt = nowSeconds(options);
    if (!state || issuedAt === null) throw authError("auth_unavailable", 503);
    var claims = { accountId: state.accountId, audience: options.audience, issuedAt: issuedAt, expiresAt: issuedAt + ttlSeconds, sessionEpoch: state.sessionEpoch, nonce: encodeBase64Url(crypto.randomBytes(18)), issuer: options.issuer, scope: normalizeScope(options.scope, state.accountId) };
    var payloadPart = encodeBase64Url(Buffer.from(JSON.stringify(claims), "utf8"));
    return payloadPart + "." + encodeBase64Url(signPayload(payloadPart, secret));
  }
  return Object.freeze({ issueCapability: issueCapability, authorizationHeader: function () { return AUTHORIZATION_SCHEME + " " + issueCapability(); }, setCurrentAuthState: setCurrentAuthState, getCurrentAuthState: getCurrentAuthState });
}

function createInMemoryIssuer(options) {
  options = options || {};
  if (options.testOnly !== true) throw authError("test_issuer_forbidden", 403);
  if (!validBoundedString(options.issuer, 256) || !validBoundedString(options.audience, 256)) throw authError("auth_unavailable", 503);
  var secret = options.secret === undefined ? crypto.randomBytes(MIN_SECRET_BYTES) : normalizeSecret(options.secret);
  if (!secret) throw authError("auth_unavailable", 503);
  var currentAuthState = options.currentAuthState || null;
  function getCurrentAuthState() { return currentAuthState; }
  function setCurrentAuthState(nextState) { currentAuthState = nextState || null; }
  function issueCapability(overrides) {
    overrides = overrides || {};
    var state = normalizeCurrentAuthState(currentAuthState);
    if (!state) throw authError("auth_unavailable", 503);
    var issuedAt = nowSeconds(options);
    if (issuedAt === null) throw authError("auth_unavailable", 503);
    var ttlSeconds = Number.isFinite(options.ttlSeconds) ? Math.max(1, Math.floor(options.ttlSeconds)) : 30;
    var claims = { accountId: state.accountId, audience: options.audience, issuedAt: issuedAt, expiresAt: issuedAt + ttlSeconds, sessionEpoch: state.sessionEpoch, nonce: encodeBase64Url(crypto.randomBytes(18)), issuer: options.issuer, scope: normalizeScope(options.scope, state.accountId) };
    Object.keys(overrides).forEach(function (key) { claims[key] = overrides[key]; });
    var payloadPart = encodeBase64Url(Buffer.from(JSON.stringify(claims), "utf8"));
    return payloadPart + "." + encodeBase64Url(signPayload(payloadPart, secret));
  }
  var verifier = createVerifier({ secret: secret, issuer: options.issuer, audience: options.audience, getCurrentAuthState: getCurrentAuthState, maxTtlSeconds: options.maxTtlSeconds, clockSkewSeconds: options.clockSkewSeconds, nowSeconds: options.nowSeconds, clock: options.clock });
  return Object.freeze({ issueCapability: issueCapability, authorizationHeader: function (overrides) { return AUTHORIZATION_SCHEME + " " + issueCapability(overrides); }, setCurrentAuthState: setCurrentAuthState, getCurrentAuthState: getCurrentAuthState, verifier: verifier });
}

module.exports = {
  AUTHORIZATION_SCHEME: AUTHORIZATION_SCHEME,
  AuthError: AuthError,
  createVerifier: createVerifier,
  createLocalRequestAuth: createVerifier,
  authenticateRequest: authenticateRequest,
  verifyLocalRequest: authenticateRequest,
  assertNoRawAccountSelectors: assertNoRawAccountSelectors,
  assertTrustedAccount: assertTrustedAccount,
  assertAccountScope: assertTrustedAccount,
  validIdentifier: validIdentifier,
  normalizeScope: normalizeScope,
  createCapabilityIssuer: createCapabilityIssuer,
  createInMemoryIssuer: createInMemoryIssuer,
};
