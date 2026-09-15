// route-auth.js — common HTTP capability/scope gate for compiled App Routes.
// The webpack bundles call the facade installed by server.js through
// global.__SOCRATOPIA_ROUTE_AUTH__. Keeping this logic in one module prevents
// the five inlined account-helper copies from drifting semantically.
"use strict";

var auth = require("./local-request-auth.js");

var PUBLIC_BOOTSTRAP_PATHS = Object.freeze({ "/api/account/init": true });
var SCOPE_KEYS = Object.freeze(["profileId", "worldId", "textbookId", "conversationId"]);

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pathOf(request) {
  if (!request) return "";
  if (request.nextUrl && typeof request.nextUrl.pathname === "string") return request.nextUrl.pathname;
  if (typeof request.url !== "string") return "";
  try { return new URL(request.url, "http://127.0.0.1").pathname; } catch (_) { return ""; }
}

function isHttpRequest(request) {
  return !!request && (typeof request.url === "string" || !!request.nextUrl);
}

function queryValue(request, key) {
  if (!request) return null;
  var params = request.nextUrl && request.nextUrl.searchParams;
  if (params && typeof params.get === "function") return params.get(key);
  if (typeof request.url === "string") {
    try { return new URL(request.url, "http://127.0.0.1").searchParams.get(key); } catch (_) { return null; }
  }
  return null;
}

function copyScopeValue(target, key, value) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || !auth.validIdentifier(value)) throw new auth.AuthError("scope_invalid", 400);
  target[key] = value;
}

function extractScope(request, body, routeName) {
  var scope = {};
  SCOPE_KEYS.forEach(function (key) {
    var fromQuery = queryValue(request, key);
    if (fromQuery !== null) copyScopeValue(scope, key, fromQuery);
    if (isRecord(body) && body[key] !== undefined) copyScopeValue(scope, key, body[key]);
  });
  var path = routeName || pathOf(request);
  // Profile/avatar routes use `id` for the profile selector.  `id` on the
  // companion/card/avatar routes is an object id and is intentionally not
  // guessed as a profile or account.
  if (path === "/api/profile/avatar" && !scope.profileId) copyScopeValue(scope, "profileId", queryValue(request, "id") || (isRecord(body) ? body.id : null));
  if (path === "/api/profile" && !scope.profileId && isRecord(body)) copyScopeValue(scope, "profileId", body.profileId);
  if (path === "/api/profile/reset" && !scope.profileId && isRecord(body)) copyScopeValue(scope, "profileId", body.profileId);
  return scope;
}

function safeError(error) {
  if (error instanceof auth.AuthError) return error;
  var code = error && typeof error.code === "string" && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "auth_invalid";
  var status = Number(error && (error.status || error.statusCode));
  if (![400, 401, 403, 404, 409, 422, 503].includes(status)) status = code === "auth_unavailable" ? 503 : 403;
  return new auth.AuthError(code, status);
}

function errorResponse(error, traceId) {
  var safe = safeError(error);
  var body = {
    error: { code: safe.code, message: safe.message, status: safe.status, traceId: traceId || null },
    code: safe.code,
    message: safe.message,
    traceId: traceId || null,
  };
  return new Response(JSON.stringify(body), {
    status: safe.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

function cloneBody(request) {
  if (!request) return Promise.resolve(undefined);
  if (typeof request.clone === "function") {
    try {
      var clone = request.clone();
      if (clone && typeof clone.json === "function") return clone.json().catch(function () { return undefined; });
    } catch (_) {}
  }
  if ((isRecord(request.body) && typeof request.body.getReader !== "function") || Array.isArray(request.body)) return Promise.resolve(request.body);
  if (isRecord(request.__body)) return Promise.resolve(request.__body);
  return Promise.resolve(undefined);
}

function createRouteAuth(options) {
  options = options || {};
  var verifier = options.verifier;
  var requestContext = options.accountRequestContext;
  var traceCounter = 0;
  function newTraceId() {
    traceCounter = (traceCounter + 1) % 0x7fffffff;
    return "route_" + Date.now().toString(36) + "_" + traceCounter.toString(36);
  }
  function isPublic(path) {
    return !!PUBLIC_BOOTSTRAP_PATHS[path];
  }
  function authenticate(request, body, routeName) {
    var path = routeName || pathOf(request);
    if (isPublic(path)) return { context: null, scope: {}, public: true, traceId: newTraceId() };
    if (!verifier || typeof verifier.verifyRequest !== "function") throw new auth.AuthError("auth_unavailable", 503);
    var context = verifier.verifyRequest(request, body);
    var scope = extractScope(request, body, path);
    auth.assertAccountScope(context, scope);
    return { context: context, scope: scope, public: false, traceId: newTraceId() };
  }
  function runWithContext(context, callback) {
    if (!context || !requestContext) return callback();
    if (typeof requestContext.runContext === "function") return requestContext.runContext(context, callback);
    if (typeof requestContext.run === "function") return requestContext.run(context.accountId, callback);
    return callback();
  }
  async function dispatch(handler, request, args, routeName) {
    // Direct userland calls in existing smoke tests are intentionally not HTTP
    // requests. They retain their explicit test/service context; real Next
    // requests always carry a URL and therefore cannot bypass this gate.
    if (!isHttpRequest(request)) return handler.apply(null, [request].concat(args || []));
    var traceId = newTraceId();
    try {
      var body = await cloneBody(request);
      var result = authenticate(request, body, routeName);
      return await runWithContext(result.context, function () { return handler.apply(null, [request].concat(args || [])); });
    } catch (error) {
      return errorResponse(error, traceId);
    }
  }
  return Object.freeze({
    version: 1,
    pathOf: pathOf,
    extractScope: extractScope,
    authenticate: authenticate,
    dispatch: dispatch,
    errorResponse: errorResponse,
    isPublic: isPublic,
  });
}

module.exports = {
  createRouteAuth: createRouteAuth,
  extractScope: extractScope,
  pathOf: pathOf,
  errorResponse: errorResponse,
};
