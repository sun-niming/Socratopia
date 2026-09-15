// Smoke test for the /api/long-reasoning-demo route (security + behavior).
// Run: node resources/server/lib/reasoning/long-reasoning-demo-route-smoke-test.js
//
// This exercises the compiled webpack route by calling routeModule.userland.GET
// directly with a Request. It verifies:
//   - missing profileId/worldId/textbookId -> 400 missing_params
//   - textbookDir outside PROJECT_ROOT     -> 400 invalid_textbook_dir
//   - textbookDir with ".." escape         -> 400 invalid_textbook_dir
//   - no graph / no KB                     -> 404 no_graph
//   - fake PROJECT_ROOT-internal KB        -> 200 ok:true with promptBlock
//
// READ-ONLY demo path; does NOT touch the live classroom chain.
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Module = require("module");
var auth = require("../local-request-auth.js");
var routeAuth = require("../route-auth.js");

// ---- make the compiled Next route's `next` import resolvable ----
var SERVER_DIR = path.resolve(__dirname, "..", "..");            // resources/server
var NEXT_NODE_MODULES = path.join(SERVER_DIR, ".next", "node_modules");
process.env.NODE_PATH = NEXT_NODE_MODULES + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : "");
Module._initPaths();

var ROUTE_PATH = path.join(SERVER_DIR, ".next", "server", "app", "api", "long-reasoning-demo", "route.js");

var pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); pass++; }

// ---- temp PROJECT_ROOT + fake textbookDir/knowledge_base (inside root) ----
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lrd-route-smoke-"));
process.env.PROJECT_ROOT = tmp;
var capabilityIssuer = auth.createInMemoryIssuer({
  testOnly: true,
  issuer: "long-reasoning-smoke",
  audience: "adaptive-teaching",
  currentAuthState: { accountId: "local", sessionEpoch: 1 },
  scope: { accountId: "local", profileId: "*", worldId: "*", textbookId: "*", conversationId: "*" }
});
global.__SOCRATOPIA_ROUTE_AUTH__ = routeAuth.createRouteAuth({
  verifier: capabilityIssuer.verifier,
});

var PID = "p1", WID = "w1", TID = "tb1";
var tbDir = path.join(tmp, "profiles", PID, "worlds", WID, "textbooks", TID);
var kbDir = path.join(tbDir, "knowledge_base");
var cardsDir = path.join(kbDir, "cards");
fs.mkdirSync(cardsDir, { recursive: true });

function writeCard(c) { fs.writeFileSync(path.join(cardsDir, c.concept_id + ".json"), JSON.stringify(c), "utf-8"); }
// c_base (p1-5) <- c_mid (p6-10) <- c_top (p11-15) via title prerequisites
writeCard({ concept_id: "c_base", title: "Base", definition: "base def", key_points: ["kp1"], examples: ["ex1"], source_pages: [1, 5], prerequisites: [] });
writeCard({ concept_id: "c_mid", title: "Mid", definition: "mid def", key_points: ["kp2"], examples: [], source_pages: [6, 10], prerequisites: ["Base"] });
writeCard({ concept_id: "c_top", title: "Top", definition: "top def", key_points: [], examples: [], source_pages: [11, 15], prerequisites: ["Mid"] });
fs.writeFileSync(path.join(kbDir, "index.json"), JSON.stringify({
  title: "Demo TB",
  cards: [{ concept_id: "c_base" }, { concept_id: "c_mid" }, { concept_id: "c_top" }]
}), "utf-8");

// ---- load helper globals the same way server.js does ----
var AD = require("../adaptive/data-layer.js");
global.__ADAPTIVE__ = AD;
global.__ADAPTIVE_CONCEPT_GRAPH__ = require("../adaptive/concept-graph-builder.js");
global.__LONG_REASONING__ = require("./long-context.js");

// ---- require the compiled route (executes webpack IIFE; needs NODE_PATH) ----
var routeMod = require(ROUTE_PATH);
var GET = routeMod && routeMod.routeModule && routeMod.routeModule.userland && routeMod.routeModule.userland.GET;
ok(typeof GET === "function", "route exposes routeModule.userland.GET");

function call(qs) {
  var url = "http://localhost/api/long-reasoning-demo" + (qs ? "?" + qs : "");
  return Promise.resolve(GET(new Request(url, { method: "GET", headers: { Authorization: capabilityIssuer.authorizationHeader() } }))).then(function (res) {
    return Promise.resolve(res.json()).then(function (body) { return { status: res.status, body: body }; });
  });
}
function enc(o) {
  return Object.keys(o).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(o[k]); }).join("&");
}

// Allocate the outside-root dir up front so cleanup() can always remove it.
var outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "lrd-outside-"));

function cleanup() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch (e) {}
  delete global.__SOCRATOPIA_ROUTE_AUTH__;
}

// Tests run SERIALLY (awaited one at a time). Several cases temporarily set
// global.__ADAPTIVE_CONCEPT_GRAPH__ = null to force kb_fallback / no_graph;
// running them concurrently could let that null bleed into other cases. Each
// such case restores the global in a finally block.
// (The "route exposes GET" assertion was already made above.)

// ---- 1. missing params -> 400 missing_params ----
async function testMissingParams() {
  var r1 = await call(enc({ worldId: WID, textbookId: TID }));
  eq(r1.status, 400, "missing profileId: status 400");
  eq(r1.body.error, "missing_params", "missing profileId: error code");
  ok(r1.body.ok === false, "missing profileId: ok false");

  var r2 = await call(enc({ profileId: PID, textbookId: TID }));
  eq(r2.status, 400, "missing worldId: status 400");
  eq(r2.body.error, "missing_params", "missing worldId: error code");

  var r3 = await call(enc({ profileId: PID, worldId: WID }));
  eq(r3.status, 400, "missing textbookId: status 400");
  eq(r3.body.error, "missing_params", "missing textbookId: error code");
}

// ---- 2. textbookDir outside PROJECT_ROOT -> 400 invalid_textbook_dir ----
async function testOutsideTextbookDir() {
  var r = await call(enc({ profileId: PID, worldId: WID, textbookId: TID, textbookDir: outsideDir }));
  eq(r.status, 400, "outside textbookDir: status 400");
  eq(r.body.error, "invalid_textbook_dir", "outside textbookDir: error code");
  ok(/PROJECT_ROOT/.test(r.body.message || ""), "outside textbookDir: message mentions PROJECT_ROOT");
}

// ---- 2b. ".." escape attempt -> 400 invalid_textbook_dir ----
async function testPathEscape() {
  var escapeDir = path.join(tmp, "profiles", "..", "..", "etc");
  var r = await call(enc({ profileId: PID, worldId: WID, textbookId: TID, textbookDir: escapeDir }));
  eq(r.status, 400, ".. escape: status 400");
  eq(r.body.error, "invalid_textbook_dir", ".. escape: error code");
}

// ---- 3. no graph / no KB -> 404 no_graph ----
// Disable the concept-graph builder so dry-run is unavailable; point at an
// in-root dir that has NO knowledge_base.
async function testNoGraph() {
  var emptyDir = path.join(tmp, "profiles", PID, "worlds", WID, "textbooks", "tbEmpty");
  fs.mkdirSync(emptyDir, { recursive: true });
  var savedBuilder = global.__ADAPTIVE_CONCEPT_GRAPH__;
  global.__ADAPTIVE_CONCEPT_GRAPH__ = null;
  try {
    var r = await call(enc({ profileId: PID, worldId: WID, textbookId: "tbEmpty", textbookDir: emptyDir, focusConceptId: "x" }));
    eq(r.status, 404, "no_graph: status 404");
    eq(r.body.error, "no_graph", "no_graph: error code");
  } finally {
    global.__ADAPTIVE_CONCEPT_GRAPH__ = savedBuilder;
  }
}

// ---- 4. fake PROJECT_ROOT-internal KB -> 200 ok:true with promptBlock ----
// No saved graph + no builder => kb_fallback from the on-disk KB.
async function testKbFallback() {
  var savedBuilder = global.__ADAPTIVE_CONCEPT_GRAPH__;
  global.__ADAPTIVE_CONCEPT_GRAPH__ = null;
  try {
    var r = await call(enc({ profileId: PID, worldId: WID, textbookId: "tbNoGraph", textbookDir: tbDir, focusConceptId: "c_top" }));
    eq(r.status, 200, "kb ok: status 200");
    ok(r.body.ok === true, "kb ok: ok true");
    eq(r.body.source, "kb_fallback", "kb ok: source kb_fallback");
    eq(r.body.focus.conceptId, "c_top", "kb ok: focus c_top");
    ok(typeof r.body.promptBlock === "string" && r.body.promptBlock.length > 0, "kb ok: has promptBlock");
    ok(r.body.promptBlock.indexOf("LONG_REASONING_CONTEXT") >= 0, "kb ok: promptBlock has LONG_REASONING_CONTEXT");
    var depIds = (r.body.dependencies || []).map(function (d) { return d.conceptId; });
    ok(depIds.indexOf("c_mid") >= 0 && depIds.indexOf("c_base") >= 0, "kb ok: prereq chain present");
  } finally {
    global.__ADAPTIVE_CONCEPT_GRAPH__ = savedBuilder;
  }
}

// ---- 4b. ok:true via saved_graph (no textbookDir; derived path inside root) ----
async function testSavedGraph() {
  var graph = {
    profileId: PID, worldId: WID, textbookId: TID, version: 1, concepts: [
      { conceptId: "c_base", title: "Base", description: "base", prerequisites: [], sourcePages: [1, 5], masteryCriteria: ["m"], commonMisconceptions: [], difficulty: 1, questions: [{ questionId: "c_base_q01", type: "diagnostic", difficulty: 1, question: "q", expectedAnswer: "a", misconceptionMapping: [], targetConcepts: ["c_base"] }] },
      { conceptId: "c_mid", title: "Mid", description: "mid", prerequisites: ["c_base"], sourcePages: [6, 10], masteryCriteria: ["m"], commonMisconceptions: [], difficulty: 1, questions: [{ questionId: "c_mid_q01", type: "diagnostic", difficulty: 1, question: "q", expectedAnswer: "a", misconceptionMapping: [], targetConcepts: ["c_mid"] }] }
    ]
  };
  AD.saveConceptGraph(PID, WID, TID, graph);
  // derived path: <root>/profiles/<pid>/worlds/<wid>/textbooks/<tid> exists (tbDir)
  var r = await call(enc({ profileId: PID, worldId: WID, textbookId: TID, focusConceptId: "c_mid" }));
  eq(r.status, 200, "saved_graph ok: status 200");
  ok(r.body.ok === true, "saved_graph ok: ok true");
  eq(r.body.source, "saved_graph", "saved_graph ok: source saved_graph");
  ok(r.body.promptBlock.indexOf("LONG_REASONING_CONTEXT") >= 0, "saved_graph ok: promptBlock tag");
}

async function main() {
  try {
    await testMissingParams();
    await testOutsideTextbookDir();
    await testPathEscape();
    await testNoGraph();
    await testKbFallback();
    await testSavedGraph();
    console.log("long-reasoning-demo route smoke test: " + pass + " assertions passed");
  } catch (e) {
    console.error("long-reasoning-demo route smoke test FAILED:", e && e.stack || e);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}
main();
