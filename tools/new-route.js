#!/usr/bin/env node
"use strict";
/*
 * new-route.js — scaffold a brand-new Next.js standalone API route into this
 * build-less packaged artifact. Automates the 5 manual steps proven by the
 * adaptive-teaching spike (see CLAUDE.md "API routes" + spike commit).
 *
 * Usage:
 *   node tools/new-route.js <route-name> [--methods GET,POST] [--dry-run]
 *
 * It (1) allocates collision-free webpack module IDs, (2) writes route.js from
 * the test-key template, (3) writes route_client-reference-manifest.js, and
 * (4) registers the route in the 3 API-route manifests. Then node --check.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SERVER = path.join(__dirname, "..", "resources", "server", ".next", "server");
const NEXT = path.join(__dirname, "..", "resources", "server", ".next");
const API_DIR = path.join(SERVER, "app", "api");
const TEMPLATE = path.join(API_DIR, "test-key", "route.js");
const RESOLVED_BASE = "/Users/leminwu/Documents/Github/socralab-app/v2/src/app/api";

function die(msg) { console.error("ERROR: " + msg); process.exit(1); }

function parseArgs(argv) {
  const args = { methods: ["GET", "POST"], dryRun: false, name: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--methods") {
      const v = argv[++i];
      if (!v) die("--methods needs a value, e.g. --methods GET,POST");
      args.methods = v.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    } else if (a.startsWith("--")) die("unknown flag: " + a);
    else if (!args.name) args.name = a;
    else die("unexpected extra argument: " + a);
  }
  if (!args.name) die("route name required. Usage: node tools/new-route.js <name> [--methods GET,POST] [--dry-run]");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.name)) die("route name must be lowercase letters/digits/hyphens: " + args.name);
  const valid = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  for (const m of args.methods) if (!valid.includes(m)) die("invalid HTTP method: " + m);
  return args;
}

// Walk every route.js and collect EVERY numeric webpack id in use so we can
// allocate ids that collide with nothing in the shared webpack-runtime registry.
function collectUsedIds() {
  const used = new Set();
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(fp);
      else if (ent.name === "route.js") scanFile(fp, used);
    }
  }
  function scanFile(fp, set) {
    const src = fs.readFileSync(fp, "utf-8");
    let m;
    // a.id=N and a.ids=[N,...]
    const idRe = /a\.id=(\d+)|a\.ids=\[([\d,]+)\]/g;
    while ((m = idRe.exec(src))) {
      if (m[1]) set.add(+m[1]);
      if (m[2]) m[2].split(",").forEach(x => x && set.add(+x));
    }
    // module keys "N:(a,b,c)=>", "N:a=>", "N:()=>"
    const keyRe = /(\d+):\((?:a,b,c|a)\)=>|(\d+):a=>|(\d+):\(\)=>/g;
    while ((m = keyRe.exec(src))) {
      for (let g = 1; g <= 3; g++) if (m[g]) set.add(+m[g]);
    }
    // entry refs b(b.s=N)
    const entryRe = /b\(b\.s=(\d+)\)/g;
    while ((m = entryRe.exec(src))) set.add(+m[1]);
  }
  walk(API_DIR);
  return used;
}

// Pick two distinct ids >= floor that are absent from `used`.
function allocate(used, floor) {
  const out = [];
  let n = floor;
  while (out.length < 2) {
    if (!used.has(n)) { out.push(n); used.add(n); }
    n++;
  }
  return out; // [chunkId, entryId]
}

// Build the userland handler exports + function bodies for the requested methods.
// Produces a working no-op echo handler so the route is immediately testable.
function buildHandlers(name, methods) {
  // map each method to a unique fn name: GET->wGET, POST->wPOST, ...
  const fnName = m => "w" + m;
  const exportList = methods.map(m => m + ":()=>" + fnName(m)).join(",");
  const bodies = methods.map(m => {
    if (m === "GET" || m === "HEAD" || m === "DELETE" || m === "OPTIONS") {
      return "async function " + fnName(m) + "(a){return v.NextResponse.json({ok:!0,route:\"" + name +
        "\",method:\"" + m + "\",scaffold:\"replace me\"},{headers:{\"Cache-Control\":\"private, no-store\"}})}";
    }
    // POST/PUT/PATCH: echo the JSON body
    return "async function " + fnName(m) + "(a){var b={};try{b=await a.json()}catch(e){}return v.NextResponse.json({ok:!0,route:\"" +
      name + "\",method:\"" + m + "\",echo:b,scaffold:\"replace me\"},{headers:{\"Cache-Control\":\"private, no-store\"}})}";
  }).join("");
  return { exportList, bodies };
}

// Transform the test-key template into a route for `name` with fresh ids.
function buildRouteJs(name, chunkId, entryId, methods) {
  let src = fs.readFileSync(TEMPLATE, "utf-8");
  const { exportList, bodies } = buildHandlers(name, methods);

  // 1) top chunk id: a.id=5904,a.ids=[5904]
  src = src.replace(/a\.id=5904,a\.ids=\[5904\]/, "a.id=" + chunkId + ",a.ids=[" + chunkId + "]");
  // 2) entry module key: 35009:(a,b,c)=>
  src = src.replace(/35009:\(a,b,c\)=>/, entryId + ":(a,b,c)=>");
  // 3) entry ref at tail: b(b.s=35009)
  src = src.replace(/b\(b\.s=35009\)/, "b(b.s=" + entryId + ")");
  // 4) userland exports: c.d(d,{POST:()=>w})  -> requested methods
  src = src.replace(/c\.r\(d\),c\.d\(d,\{POST:\(\)=>w\}\)/, "c.r(d),c.d(d,{" + exportList + "})");
  // 5) userland handler body: async function w(a){...return ...BYOK_NOT_AVAILABLE...}
  //    located between the d-exports and "let x=new e.AppRouteRouteModule"
  src = src.replace(/async function w\(a\)\{return v\.NextResponse\.json\(\{error:"BYOK_NOT_AVAILABLE"\},\{status:400,headers:\{"Cache-Control":"private, no-store"\}\}\)\}/, bodies);
  // 6) route path strings (order matters: longer first)
  src = src.split("/api/test-key/route").join("/api/" + name + "/route");
  src = src.split("/api/test-key").join("/api/" + name);
  // 7) resolvedPagePath cosmetic
  src = src.replace(RESOLVED_BASE + "/test-key/route.ts", RESOLVED_BASE + "/" + name + "/route.ts");
  return src;
}

function buildClientRefManifest(name) {
  return 'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/api/' +
    name + '/route"]={"moduleLoading":{"prefix":"/_next/"},"ssrModuleMapping":{},"edgeSSRModuleMapping":{},' +
    '"clientModules":{},"entryCSSFiles":{"' + RESOLVED_BASE.replace("/app/api", "/") + '":[],"' +
    RESOLVED_BASE + "/" + name + '/route":[]},"rscModuleMapping":{},"edgeRscModuleMapping":{}}';
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf-8")); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf-8"); }

// Register into the 3 API-route manifests. Returns a list of {file, change} for logging.
function registerManifests(name, dryRun) {
  const changes = [];
  const page = "/api/" + name + "/route";
  const pathname = "/api/" + name;

  // a) server/app-paths-manifest.json
  const apPath = path.join(SERVER, "app-paths-manifest.json");
  const ap = readJson(apPath);
  if (ap[page]) die("already registered in app-paths-manifest: " + page);
  ap[page] = "app/api/" + name + "/route.js";
  changes.push({ file: apPath, obj: ap, desc: page + " -> app/api/" + name + "/route.js" });

  // b) app-path-routes-manifest.json
  const aprPath = path.join(NEXT, "app-path-routes-manifest.json");
  const apr = readJson(aprPath);
  apr[page] = pathname;
  changes.push({ file: aprPath, obj: apr, desc: page + " -> " + pathname });

  // c) routes-manifest.json staticRoutes[]
  const rmPath = path.join(NEXT, "routes-manifest.json");
  const rm = readJson(rmPath);
  if (rm.staticRoutes.some(r => r.page === pathname)) die("already in routes-manifest: " + pathname);
  const esc = pathname.replace(/-/g, "\\-");
  const regex = "^" + esc + "(?:/)?$";
  rm.staticRoutes.push({ page: pathname, regex, routeKeys: {}, namedRegex: regex });
  changes.push({ file: rmPath, obj: rm, desc: "staticRoutes += " + pathname });

  if (!dryRun) for (const c of changes) writeJson(c.file, c.obj);
  return changes;
}

function main() {
  const args = parseArgs(process.argv);
  const routeDir = path.join(API_DIR, args.name);
  if (fs.existsSync(routeDir)) die("route already exists: " + routeDir + " (refusing to clobber)");

  const used = collectUsedIds();
  const [chunkId, entryId] = allocate(used, 59000);
  const routeJs = buildRouteJs(args.name, chunkId, entryId, args.methods);
  const crm = buildClientRefManifest(args.name);

  console.log("Route:    /api/" + args.name);
  console.log("Methods:  " + args.methods.join(", "));
  console.log("chunkId:  " + chunkId + "   entryId: " + entryId + "   (collision-free)");

  if (args.dryRun) {
    console.log("\n--dry-run: would create:");
    console.log("  " + path.relative(process.cwd(), path.join(routeDir, "route.js")));
    console.log("  " + path.relative(process.cwd(), path.join(routeDir, "route_client-reference-manifest.js")));
    const changes = registerManifests(args.name, true);
    console.log("would register:");
    for (const c of changes) console.log("  " + path.relative(process.cwd(), c.file) + ": " + c.desc);
    console.log("\n(no files written)");
    return;
  }

  fs.mkdirSync(routeDir, { recursive: true });
  const routePath = path.join(routeDir, "route.js");
  fs.writeFileSync(routePath, routeJs, "utf-8");
  fs.writeFileSync(path.join(routeDir, "route_client-reference-manifest.js"), crm, "utf-8");
  const changes = registerManifests(args.name, false);

  try {
    execFileSync(process.execPath, ["--check", routePath], { stdio: "pipe" });
    console.log("\nnode --check: PASS");
  } catch (e) {
    die("node --check FAILED on generated route:\n" + (e.stderr || e.message));
  }

  console.log("\nCreated:");
  console.log("  " + path.relative(process.cwd(), routePath));
  console.log("  " + path.relative(process.cwd(), path.join(routeDir, "route_client-reference-manifest.js")));
  console.log("Registered in:");
  for (const c of changes) console.log("  " + path.relative(process.cwd(), c.file));
  console.log("\nDone. Restart the server, then test:  curl http://localhost:<port>/api/" + args.name);
}

main();
