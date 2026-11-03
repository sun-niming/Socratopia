"use strict";

// Smoke test: the renderer must not let markdown carry live HTML into the DOM.
//
// The renderer builds its markdown pipeline as
//   remark-parse -> remark-attention -> remark-gfm -> remark-rehype
//   -> rehype-katex -> rehype-stringify
// and feeds the result into innerHTML (selection-dock) or into the exported
// PDF document (app bundle).  rehype-stringify's `allowDangerousHtml` option
// decides whether raw HTML found in the markdown source is emitted verbatim
// or escaped into visible text.  With the flag on, any HTML the model (or a
// textbook excerpt) contains becomes live DOM in a renderer that can reach
// window.electronAPI - see docs/reviews/2026-11-漏洞筛查与点评.md (V-01).
//
// This test pins the fix: the last stage (stringify) must be OFF while the
// remark-rehype stage stays ON, so raw HTML is preserved as readable text
// instead of disappearing.
//
// Run: node resources/server/lib/markdown-render-safety-smoke-test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SERVER_ROOT = path.join(__dirname, "..");
const CHUNK_ROOT = path.join(SERVER_ROOT, ".next", "static", "chunks");
const APP_HTML = path.join(SERVER_ROOT, ".next", "server", "app", "index.html");
const SERVER_JS = path.join(SERVER_ROOT, "server.js");
const SELECTION_DOCK = path.join(SERVER_ROOT, "public", "selection-dock.js");

// The last allowDangerousHtml option in a pipeline belongs to rehype-stringify.
function pipelineOptions(source) {
  const flags = [];
  const re = /allowDangerousHtml\s*:\s*(true|false|!0|!1)/g;
  let match;
  while ((match = re.exec(source)) !== null) flags.push(match[1]);
  return flags;
}

function assertStringifyIsOff(label, source) {
  const flags = pipelineOptions(source);
  assert.ok(flags.length >= 2, label + ": expected an allowDangerousHtml pipeline, found " + flags.length);
  const last = flags[flags.length - 1];
  assert.ok(
    last === "false" || last === "!1",
    label + ": rehype-stringify must run with allowDangerousHtml=false, found " + last
  );
  const first = flags[0];
  assert.ok(
    first === "true" || first === "!0",
    label + ": remark-rehype must keep allowDangerousHtml=true so raw HTML survives as text, found " + first
  );
}

// --- 1. the live app page bundle -------------------------------------------
const html = fs.readFileSync(APP_HTML, "utf8");
const pageMatch = html.match(/\/_next\/static\/chunks\/app\/page-[A-Za-z0-9._-]+\.js/);
assert.ok(pageMatch, "could not find the app page bundle in index.html");
const pageChunkPath = path.join(SERVER_ROOT, ".next", path.basename(path.dirname(pageMatch[0])) === "app"
  ? path.join("server", "app", path.basename(pageMatch[0]))
  : path.basename(pageMatch[0]));
const resolvedPageChunk = fs.existsSync(pageChunkPath)
  ? pageChunkPath
  : path.join(CHUNK_ROOT, "app", path.basename(pageMatch[0]));
assert.ok(fs.existsSync(resolvedPageChunk), "app page bundle is missing: " + resolvedPageChunk);
const pageChunk = fs.readFileSync(resolvedPageChunk, "utf8");
assertStringifyIsOff("app page bundle", pageChunk);

// --- 2. the selection dock -------------------------------------------------
const dock = fs.readFileSync(SELECTION_DOCK, "utf8");
assertStringifyIsOff("selection dock", dock);
assert.strictEqual(
  dock.split("allowDangerousHtml: true").length - 1,
  1,
  "selection dock must keep exactly one allowDangerousHtml:true stage (remark-rehype)"
);
assert.ok(
  dock.indexOf("allowDangerousHtml: true") < dock.indexOf("allowDangerousHtml: false"),
  "selection dock must disable allowDangerousHtml only at the rehype-stringify stage"
);
assert.ok(
  dock.indexOf("target.innerHTML = out") >= 0,
  "selection dock markdown sink changed shape - re-check the escaping contract"
);

// --- 3. every other live renderer file -------------------------------------
function liveRendererFiles() {
  const files = [];
  const dir = path.join(CHUNK_ROOT, "app");
  fs.readdirSync(dir).forEach(function (name) {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) return;
    if (!/\.js$/.test(name)) return;
    if (/-smoke-test\.js$/.test(name)) return;
    const source = fs.readFileSync(full, "utf8");
    if (source.indexOf("allowDangerousHtml") < 0) return;
    files.push({ name: name, source: source, referenced: html.indexOf(name) >= 0 });
  });
  return files;
}

const rendererFiles = liveRendererFiles();
assert.ok(rendererFiles.length > 0, "no renderer file mentions allowDangerousHtml");
rendererFiles.forEach(function (file) {
  if (!file.referenced) return; // stale bundle from an older build, not served
  assertStringifyIsOff(file.name, file.source);
});

// --- 4. the shipped rehype-stringify really escapes when the flag is off ----
const stringifyChunkName = fs.readdirSync(CHUNK_ROOT).filter(function (name) {
  return /^8740\./.test(name);
})[0];
assert.ok(stringifyChunkName, "could not find the rehype-stringify chunk");
const stringifyChunk = fs.readFileSync(path.join(CHUNK_ROOT, stringifyChunkName), "utf8");
assert.ok(
  stringifyChunk.indexOf("raw:function(e,t,a,r){return r.settings.allowDangerousHtml?e.value:") >= 0,
  "rehype-stringify no longer escapes raw HTML when allowDangerousHtml is false"
);

// --- 5. the server installs the policy --------------------------------------
const serverJs = fs.readFileSync(SERVER_JS, "utf8");
assert.ok(
  serverJs.indexOf("./lib/csp.js") >= 0 && serverJs.indexOf("installCsp(") >= 0,
  "resources/server/server.js must install the Content-Security-Policy"
);

console.log("markdown render safety smoke: ok (" + rendererFiles.length + " renderer bundles inspected)");
