"use strict";

// Verifies the /api/tts-audio file boundary independently of the player changes:
// only a single-segment file name inside PROJECT_ROOT/tts-cache may be served, and
// the capability gate in front of the handler must stay in place.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const routePath = path.resolve(__dirname, "..", ".next", "server", "app", "api", "tts-audio", "route.js");
const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-tts-audio-"));
const cacheDir = path.join(cacheRoot, "tts-cache");
fs.mkdirSync(cacheDir);
fs.mkdirSync(path.join(cacheDir, "sub"));
fs.mkdirSync(path.join(cacheRoot, "tts-cache-evil"));
fs.writeFileSync(path.join(cacheRoot, "outside.wav"), Buffer.alloc(16, 7));
fs.writeFileSync(path.join(cacheRoot, "tts-cache-evil", "evil.wav"), Buffer.alloc(16, 7));
const wav = Buffer.alloc(48);
wav.write("RIFF", 0, "ascii");
wav.write("WAVE", 8, "ascii");
fs.writeFileSync(path.join(cacheDir, "ok.wav"), wav);
process.env.PROJECT_ROOT = cacheRoot;

function loadRoute() {
  delete require.cache[require.resolve(routePath)];
  return require(routePath);
}

function request(name, raw) {
  const query = raw === undefined ? encodeURIComponent(name) : raw;
  return new Request("http://127.0.0.1/api/tts-audio?file=" + query, { method: "GET" });
}

async function call(get, name, raw) {
  const response = await get(request(name, raw));
  return { status: response.status, body: await response.text() };
}

// The capability gate captures global.__SOCRATOPIA_ROUTE_AUTH__ when the bundle is
// loaded, so the fail-closed case must run in a fresh process without the global.
function checkGuardInChildProcess() {
  const script = [
    "const route = require(process.env.TTS_AUDIO_ROUTE);",
    "(async () => {",
    "  const response = await route.routeModule.userland.GET(new Request('http://127.0.0.1/api/tts-audio?file=ok.wav'));",
    "  const text = await response.text();",
    "  if (response.status !== 503 || text.indexOf('auth_unavailable') < 0) {",
    "    console.error('expected 503 auth_unavailable, got ' + response.status + ' ' + text);",
    "    process.exit(1);",
    "  }",
    "  console.log(JSON.stringify({ status: response.status, code: 'auth_unavailable' }));",
    "})().catch(error => { console.error(error.stack || error); process.exit(1); });"
  ].join("\n");
  const stdout = require("child_process").execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { TTS_AUDIO_ROUTE: routePath })
  });
  return JSON.parse(stdout.trim());
}

async function main() {
  // --- the capability gate must stay in front of the handler ------------------------
  const guarded = checkGuardInChildProcess();
  assert.strictEqual(guarded.status, 503, "the route must keep failing closed when local request auth is unavailable");
  assert.strictEqual(guarded.code, "auth_unavailable", "the guarded response must keep the auth_unavailable code");

  // --- with the gate satisfied, only single-segment cache names may be served -------
  global.__SOCRATOPIA_ROUTE_AUTH__ = {
    dispatch: function (handler, req, args) { return handler.apply(null, [req].concat(args || [])); }
  };
  const compiled = loadRoute();
  const get = compiled.routeModule.userland.GET;
  assert.strictEqual(typeof get, "function", "the route must expose a GET handler");

  const allowed = await call(get, "ok.wav");
  assert.strictEqual(allowed.status, 200, "a cached wav inside tts-cache must be served");
  assert.strictEqual(allowed.body.length, 48, "the served wav must keep its full body");

  const missing = await call(get, "missing.wav");
  assert.strictEqual(missing.status, 404, "an absent cache entry must be a clean 404");

  const rejected = [
    ["parent traversal", "../outside.wav"],
    ["parent directory", ".."],
    ["current directory", "."],
    ["cache directory itself", "sub"],
    ["sibling cache prefix", "tts-cache-evil/evil.wav"],
    ["absolute windows path", "C:\\Windows\\win.ini"],
    ["absolute posix path", "/etc/passwd"],
    ["backslash traversal", "..\\outside.wav"],
    ["encoded traversal", "%2e%2e%2foutside.wav"],
    ["nul byte", "%00.wav"],
    ["dot slash", "./ok.wav"]
  ];

  for (const [label, value] of rejected) {
    const result = await call(get, null, value);
    assert.strictEqual(result.status, 400, label + " must be rejected with 400, got " + result.status + " (" + result.body + ")");
  }

  // A traversal that only differs by a non-separator character must never reach a sibling.
  const sibling = await call(get, null, ".." + encodeURIComponent("/") + "outside.wav");
  assert.strictEqual(sibling.status, 400, "an encoded separator traversal must be rejected");

  console.log(JSON.stringify({
    result: "PASS",
    cacheRoot: "<tmp>/tts-cache",
    allowed: allowed.status,
    missing: missing.status,
    rejected: rejected.length
  }, null, 2));
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
