// route-module.js — hand-written replacement for a webpack-produced App Route
// bundle.
//
// A compiled route.js under .next normally contains its own copy of Next's
// route harness and therefore cannot `require("fs")`.  New routes here are
// hand-written, so they assemble the very same AppRouteRouteModule straight from
// Next's compiled sources; that keeps plain `require()` (and lib/ reuse) alive.
//
// This file is a deliberate 1:1 port of next/dist/build/templates/app-route.js,
// with the build-time VAR_* placeholders turned into factory arguments.  Keep it
// aligned with that template when upgrading Next.
"use strict";

var moduleCompiled = require("next/dist/server/route-modules/app-route/module.compiled");
var routeKind = require("next/dist/server/route-kind");
var patchFetchLib = require("next/dist/server/lib/patch-fetch");
var requestMeta = require("next/dist/server/request-meta");
var tracerLib = require("next/dist/server/lib/trace/tracer");
var manifestsSingleton = require("next/dist/server/app-render/manifests-singleton");
var appPaths = require("next/dist/shared/lib/router/utils/app-paths");
var nodeHttp = require("next/dist/server/base-http/node");
var nextRequestAdapter = require("next/dist/server/web/spec-extension/adapters/next-request");
var traceConstants = require("next/dist/server/lib/trace/constants");
var instrumentationUtils = require("next/dist/server/instrumentation/utils");
var sendResponseLib = require("next/dist/server/send-response");
var webUtils = require("next/dist/server/web/utils");
var cacheControl = require("next/dist/server/lib/cache-control");
var constants = require("next/dist/lib/constants");
var noFallbackError = require("next/dist/shared/lib/no-fallback-error.external");
var responseCache = require("next/dist/server/response-cache");

var http = require("./http.js");

var METHODS = ["GET", "POST", "DELETE", "HEAD"];

var NEXT_CONFIG_OUTPUT = "standalone";

function interopWildcard(value) {
  // Mirrors the template's interop helper: a namespace object that also carries
  // `default`, which is what AppRouteRouteModule receives as `userland`.
  var namespace = { __proto__: null };
  Object.keys(value).forEach(function (key) { namespace[key] = value[key]; });
  namespace.default = value;
  return namespace;
}

function authUnavailable() {
  return new Response(JSON.stringify({
    error: { code: "auth_unavailable", message: "Local request authentication is unavailable", status: 503 },
    code: "auth_unavailable",
    message: "Local request authentication is unavailable",
    status: 503,
  }), { status: 503, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });
}

// Health breadcrumb: the renderer loads thumbnails as plain <img src="/api/assets/...">
// and those requests only carry a capability when Electron's image-auth hook
// recognises the path.  Without this line a broken <img> is invisible in the log.
function reportAssetRequest(request, pathname, response) {
  try {
    var url = request && typeof request.url === "string" ? request.url : String(pathname || "");
    var hasAuth = !!(request && request.headers && typeof request.headers.get === "function" && request.headers.get("authorization"));
    console.error("[assets-http] " + ((request && request.method) || "GET") + " " +
      url.replace(/^https?:\/\/[^/]+/, "") + " auth=" + (hasAuth ? "yes" : "no") +
      " -> " + ((response && response.status) || 0));
  } catch (_) { /* logging must never break the route */ }
  return response;
}

// Same wrapping shape the compiled bundles install around their userland
// handlers: real Next requests must pass the account-scoped auth facade, while
// direct userland calls in tests keep their explicit context.
function wrapWithRouteAuth(inner, pathname) {
  return function (request) {
    var args = Array.prototype.slice.call(arguments, 1);
    var routeAuth = global.__SOCRATOPIA_ROUTE_AUTH__;
    var isHttpRequest = !!request && (typeof request.url === "string" || !!request.nextUrl);
    if (routeAuth && typeof routeAuth.dispatch === "function") {
      return Promise.resolve(routeAuth.dispatch(inner, request, args, pathname)).then(
        function (response) { return reportAssetRequest(request, pathname, response); },
        function (error) {
          reportAssetRequest(request, pathname, { status: (error && (error.status || error.statusCode)) || 500 });
          throw error;
        }
      );
    }
    if (isHttpRequest) return reportAssetRequest(request, pathname, authUnavailable());
    return inner.apply(null, [request].concat(args));
  };
}

function buildUserland(handlers, pathname) {
  var raw = {};
  METHODS.forEach(function (method) {
    raw[method] = wrapWithRouteAuth(handlers.dispatch, pathname);
  });
  return { raw: raw, namespace: interopWildcard(raw) };
}

// page       e.g. "/api/assets/route"       (must match app-paths-manifest)
// pathname   e.g. "/api/assets"             (matched URL prefix)
// bundlePath e.g. "app/api/assets/route"    (must match app-paths-manifest value)
function create(page, pathname, bundlePath) {
  var handlers = http.createAssetHandlers({});
  var userland = buildUserland(handlers, pathname);

  var routeModule = new moduleCompiled.AppRouteRouteModule({
    definition: {
      kind: routeKind.RouteKind.APP_ROUTE,
      page: page,
      pathname: pathname,
      filename: "route",
      bundlePath: bundlePath,
    },
    distDir: ".next",
    relativeProjectDir: "",
    resolvedPagePath: "hand-written:lib/assets/route-module.js",
    nextConfigOutput: NEXT_CONFIG_OUTPUT,
    userland: userland.namespace,
  });

  var workAsyncStorage = routeModule.workAsyncStorage;
  var workUnitAsyncStorage = routeModule.workUnitAsyncStorage;
  var serverHooks = routeModule.serverHooks;

  function patchFetch() {
    return patchFetchLib.patchFetch({ workAsyncStorage: workAsyncStorage, workUnitAsyncStorage: workUnitAsyncStorage });
  }

  async function handler(req, res, ctx) {
    if (routeModule.isDev) {
      requestMeta.addRequestMeta(req, "devRequestTimingInternalsEnd", process.hrtime.bigint());
    }
    var srcPage = page;
    if (srcPage === "/index") srcPage = "/";
    var multiZoneDraftMode = process.env.__NEXT_MULTI_ZONE_DRAFT_MODE;
    var prepareResult = await routeModule.prepare(req, res, { srcPage: srcPage, multiZoneDraftMode: multiZoneDraftMode });
    if (!prepareResult) {
      res.statusCode = 400;
      res.end("Bad Request");
      if (ctx.waitUntil) ctx.waitUntil(Promise.resolve());
      return null;
    }
    var buildId = prepareResult.buildId;
    var params = prepareResult.params;
    var nextConfig = prepareResult.nextConfig;
    var parsedUrl = prepareResult.parsedUrl;
    var isDraftMode = prepareResult.isDraftMode;
    var prerenderManifest = prepareResult.prerenderManifest;
    var routerServerContext = prepareResult.routerServerContext;
    var isOnDemandRevalidate = prepareResult.isOnDemandRevalidate;
    var revalidateOnlyGenerated = prepareResult.revalidateOnlyGenerated;
    var resolvedPathname = prepareResult.resolvedPathname;
    var clientReferenceManifest = prepareResult.clientReferenceManifest;
    var serverActionsManifest = prepareResult.serverActionsManifest;

    var normalizedSrcPage = appPaths.normalizeAppPath(srcPage);
    var isIsr = Boolean(prerenderManifest.dynamicRoutes[normalizedSrcPage] || prerenderManifest.routes[resolvedPathname]);
    async function render404() {
      if (routerServerContext && routerServerContext.render404) {
        await routerServerContext.render404(req, res, parsedUrl, false);
      } else {
        res.end("This page could not be found");
      }
      return null;
    }
    if (isIsr && !isDraftMode) {
      var isPrerendered = Boolean(prerenderManifest.routes[resolvedPathname]);
      var prerenderInfo = prerenderManifest.dynamicRoutes[normalizedSrcPage];
      if (prerenderInfo && prerenderInfo.fallback === false && !isPrerendered) {
        if (nextConfig.experimental.adapterPath) return await render404();
        throw new noFallbackError.NoFallbackError();
      }
    }
    var cacheKey = null;
    if (isIsr && !routeModule.isDev && !isDraftMode) {
      cacheKey = resolvedPathname === "/index" ? "/" : resolvedPathname;
    }
    var supportsDynamicResponse = routeModule.isDev === true || !isIsr;
    var isStaticGeneration = isIsr && !supportsDynamicResponse;

    if (serverActionsManifest && clientReferenceManifest) {
      manifestsSingleton.setManifestsSingleton({
        page: srcPage,
        clientReferenceManifest: clientReferenceManifest,
        serverActionsManifest: serverActionsManifest,
      });
    }

    var method = req.method || "GET";
    var tracer = tracerLib.getTracer();
    var activeSpan = tracer.getActiveScopeSpan();
    var context = {
      params: params,
      prerenderManifest: prerenderManifest,
      renderOpts: {
        experimental: { authInterrupts: Boolean(nextConfig.experimental.authInterrupts) },
        cacheComponents: Boolean(nextConfig.cacheComponents),
        supportsDynamicResponse: supportsDynamicResponse,
        incrementalCache: requestMeta.getRequestMeta(req, "incrementalCache"),
        cacheLifeProfiles: nextConfig.cacheLife,
        waitUntil: ctx.waitUntil,
        onClose: function (cb) { res.on("close", cb); },
        onAfterTaskError: undefined,
        onInstrumentationRequestError: function (error, _request, errorContext, silenceLog) {
          return routeModule.onRequestError(req, error, errorContext, silenceLog, routerServerContext);
        },
      },
      sharedContext: { buildId: buildId },
    };
    var nodeNextReq = new nodeHttp.NodeNextRequest(req);
    var nodeNextRes = new nodeHttp.NodeNextResponse(res);
    var nextReq = nextRequestAdapter.NextRequestAdapter.fromNodeNextRequest(
      nodeNextReq,
      nextRequestAdapter.signalFromNodeResponse(res)
    );

    try {
      var invokeRouteModule = async function (span) {
        return routeModule.handle(nextReq, context).finally(function () {
          if (!span) return;
          span.setAttributes({ "http.status_code": res.statusCode, "next.rsc": false });
          var rootSpanAttributes = tracer.getRootSpanAttributes();
          if (!rootSpanAttributes) return;
          if (rootSpanAttributes.get("next.span_type") !== traceConstants.BaseServerSpan.handleRequest) {
            console.warn("Unexpected root span type '" + rootSpanAttributes.get("next.span_type") + "'. Please report this Next.js issue https://github.com/vercel/next.js");
            return;
          }
          var route = rootSpanAttributes.get("next.route");
          if (route) {
            var name = method + " " + route;
            span.setAttributes({ "next.route": route, "http.route": route, "next.span_name": name });
            span.updateName(name);
          } else {
            span.updateName(method + " " + srcPage);
          }
        });
      };
      var isMinimalMode = Boolean(process.env.MINIMAL_MODE || requestMeta.getRequestMeta(req, "minimalMode"));
      var handleResponse = async function (currentSpan) {
        var responseGenerator = async function (options) {
          var previousCacheEntry = options && options.previousCacheEntry;
          try {
            if (!isMinimalMode && isOnDemandRevalidate && revalidateOnlyGenerated && !previousCacheEntry) {
              res.statusCode = 404;
              res.setHeader("x-nextjs-cache", "REVALIDATED");
              res.end("This page could not be found");
              return null;
            }
            var response = await invokeRouteModule(currentSpan);
            req.fetchMetrics = context.renderOpts.fetchMetrics;
            var pendingWaitUntil = context.renderOpts.pendingWaitUntil;
            if (pendingWaitUntil && ctx.waitUntil) {
              ctx.waitUntil(pendingWaitUntil);
              pendingWaitUntil = undefined;
            }
            var cacheTags = context.renderOpts.collectedTags;
            if (isIsr) {
              var blob = await response.blob();
              var headers = webUtils.toNodeOutgoingHttpHeaders(response.headers);
              if (cacheTags) headers[constants.NEXT_CACHE_TAGS_HEADER] = cacheTags;
              if (!headers["content-type"] && blob.type) headers["content-type"] = blob.type;
              var revalidate = typeof context.renderOpts.collectedRevalidate === "undefined" || context.renderOpts.collectedRevalidate >= constants.INFINITE_CACHE ? false : context.renderOpts.collectedRevalidate;
              var expire = typeof context.renderOpts.collectedExpire === "undefined" || context.renderOpts.collectedExpire >= constants.INFINITE_CACHE ? undefined : context.renderOpts.collectedExpire;
              return {
                value: {
                  kind: responseCache.CachedRouteKind.APP_ROUTE,
                  status: response.status,
                  body: Buffer.from(await blob.arrayBuffer()),
                  headers: headers,
                },
                cacheControl: { revalidate: revalidate, expire: expire },
              };
            }
            await sendResponseLib.sendResponse(nodeNextReq, nodeNextRes, response, context.renderOpts.pendingWaitUntil);
            return null;
          } catch (error) {
            if (previousCacheEntry && previousCacheEntry.isStale) {
              await routeModule.onRequestError(req, error, {
                routerKind: "App Router",
                routePath: srcPage,
                routeType: "route",
                revalidateReason: instrumentationUtils.getRevalidateReason({
                  isStaticGeneration: isStaticGeneration,
                  isOnDemandRevalidate: isOnDemandRevalidate,
                }),
              }, false, routerServerContext);
            }
            throw error;
          }
        };
        var cacheEntry = await routeModule.handleResponse({
          req: req,
          nextConfig: nextConfig,
          cacheKey: cacheKey,
          routeKind: routeKind.RouteKind.APP_ROUTE,
          isFallback: false,
          prerenderManifest: prerenderManifest,
          isRoutePPREnabled: false,
          isOnDemandRevalidate: isOnDemandRevalidate,
          revalidateOnlyGenerated: revalidateOnlyGenerated,
          responseGenerator: responseGenerator,
          waitUntil: ctx.waitUntil,
          isMinimalMode: isMinimalMode,
        });
        if (!isIsr) return null;
        if (!cacheEntry || !cacheEntry.value || cacheEntry.value.kind !== responseCache.CachedRouteKind.APP_ROUTE) {
          throw new Error("Invariant: app-route received invalid cache entry " + (cacheEntry && cacheEntry.value && cacheEntry.value.kind));
        }
        if (!isMinimalMode) {
          res.setHeader("x-nextjs-cache", isOnDemandRevalidate ? "REVALIDATED" : cacheEntry.isMiss ? "MISS" : cacheEntry.isStale ? "STALE" : "HIT");
        }
        if (isDraftMode) {
          res.setHeader("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");
        }
        var outHeaders = webUtils.fromNodeOutgoingHttpHeaders(cacheEntry.value.headers);
        if (!(isMinimalMode && isIsr)) outHeaders.delete(constants.NEXT_CACHE_TAGS_HEADER);
        if (cacheEntry.cacheControl && !res.getHeader("Cache-Control") && !outHeaders.get("Cache-Control")) {
          outHeaders.set("Cache-Control", cacheControl.getCacheControlHeader(cacheEntry.cacheControl));
        }
        await sendResponseLib.sendResponse(nodeNextReq, nodeNextRes, new Response(cacheEntry.value.body, {
          headers: outHeaders,
          status: cacheEntry.value.status || 200,
        }));
        return null;
      };
      if (activeSpan) {
        await handleResponse(activeSpan);
      } else {
        await tracer.withPropagatedContext(req.headers, function () {
          return tracer.trace(traceConstants.BaseServerSpan.handleRequest, {
            spanName: method + " " + srcPage,
            kind: tracerLib.SpanKind.SERVER,
            attributes: { "http.method": method, "http.target": req.url },
          }, handleResponse);
        });
      }
    } catch (error) {
      if (!(error instanceof noFallbackError.NoFallbackError)) {
        await routeModule.onRequestError(req, error, {
          routerKind: "App Router",
          routePath: normalizedSrcPage,
          routeType: "route",
          revalidateReason: instrumentationUtils.getRevalidateReason({
            isStaticGeneration: isStaticGeneration,
            isOnDemandRevalidate: isOnDemandRevalidate,
          }),
        }, false, routerServerContext);
      }
      if (isIsr) throw error;
      await sendResponseLib.sendResponse(nodeNextReq, nodeNextRes, new Response(null, { status: 500 }));
      return null;
    }
  }

  return {
    routeModule: routeModule,
    handler: handler,
    patchFetch: patchFetch,
    serverHooks: serverHooks,
    workAsyncStorage: workAsyncStorage,
    workUnitAsyncStorage: workUnitAsyncStorage,
    userland: userland.raw,
  };
}

module.exports = { create: create, METHODS: METHODS, NEXT_CONFIG_OUTPUT: NEXT_CONFIG_OUTPUT };
