"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var os = require("os");
var path = require("path");

var serverRoot = path.resolve(__dirname, "..");
var nodeModulesRoot = path.join(serverRoot, ".next", "node_modules");
var manifestPath = path.join(serverRoot, "release-runtime-manifest.json");
var manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verify(root, entry) {
  var file = path.join(root, ...entry.path.split("/"));
  var stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), entry.path + " must be a regular file");
  assert.strictEqual(stat.size, entry.bytes, entry.path + " byte length");
  assert.strictEqual(sha256(file), entry.sha256, entry.path + " sha256");
}

assert.strictEqual(manifest.version, 1);
assert.strictEqual(manifest.generatedFrom, ".next/node_modules");
assert.strictEqual(manifest.packageVersions["@napi-rs/canvas"], "1.0.0");
assert.strictEqual(manifest.packageVersions["pdfjs-dist"], "5.5.207");
assert.strictEqual(manifest.packageVersions.ws, "8.18.2");
assert.strictEqual(manifest.packageVersions["write-file-atomic"], "7.0.1");
var actualRuntimeFiles = [];
(function walk(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach(function (item) {
    var absolute = path.join(directory, item.name);
    if (item.isDirectory()) walk(absolute);
    else if (item.isFile()) actualRuntimeFiles.push(path.relative(nodeModulesRoot, absolute).split(path.sep).join("/"));
    else assert.fail("runtime must not contain links or special files: " + absolute);
  });
})(nodeModulesRoot);
assert.strictEqual(manifest.nodeModules.length, actualRuntimeFiles.length, "manifest must cover every actual runtime file");
assert.deepStrictEqual(manifest.nodeModules.map(function (entry) { return entry.path; }).sort(), actualRuntimeFiles.sort(), "manifest paths must exactly match the actual runtime tree");
assert(manifest.nodeModules.some(function (entry) { return /skia\.win32-x64-msvc\.node$/.test(entry.path); }), "manifest must include canvas native binary");
assert(manifest.nodeModules.some(function (entry) { return /icudtl\.dat$/.test(entry.path); }), "manifest must include canvas ICU data");
assert(manifest.nodeModules.some(function (entry) { return entry.path === "pdfjs-dist/build/pdf.worker.mjs"; }), "manifest must include PDF.js worker");
assert(manifest.nodeModules.some(function (entry) { return entry.path.startsWith("pdfjs-dist/cmaps/"); }), "manifest must include PDF.js CMaps");
assert(manifest.nodeModules.some(function (entry) { return entry.path.startsWith("pdfjs-dist/wasm/"); }), "manifest must include PDF.js WASM");
assert(manifest.nodeModules.some(function (entry) { return entry.path.startsWith("pdfjs-dist/standard_fonts/"); }), "manifest must include PDF.js standard fonts");
assert(manifest.nodeModules.some(function (entry) { return entry.path === "ws/index.js"; }), "manifest must include the Daimon WebSocket runtime");
assert(manifest.nodeModules.some(function (entry) { return entry.path === "write-file-atomic/lib/index.js"; }), "manifest must include the atomic writer required by Auto Advance");
assert(manifest.nodeModules.some(function (entry) { return entry.path === "next/dist/cli/next-test.js"; }), "manifest runtime must preserve Next's production next-test CLI file despite its name");
assert.strictEqual(manifest.server.length, 9, "manifest must include RapidOCR executable, models, dictionaries, licenses, and notices");

verify(serverRoot, manifest.archive);
manifest.nodeModules.forEach(function (entry) { verify(nodeModulesRoot, entry); });
manifest.server.forEach(function (entry) { verify(serverRoot, entry); });

var extracted = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-deps-manifest-"));
try {
  var tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  childProcess.execFileSync(tar, ["-xf", path.join(serverRoot, manifest.archive.path), "-C", extracted], { stdio: "ignore" });
  manifest.nodeModules.forEach(function (entry) { verify(extracted, entry); });
} finally {
  fs.rmSync(extracted, { recursive: true, force: true });
}

var rootMain = fs.readFileSync(path.resolve(serverRoot, "..", "..", "main.js"), "utf8");
var asarMain = fs.readFileSync(path.resolve(serverRoot, "..", "..", "_asar_extracted", "dist-electron", "main.js"), "utf8");
for (var source of [rootMain, asarMain]) {
  assert(source.includes("release-runtime-manifest.json"), "Electron sentinel must load the runtime manifest");
  assert(source.includes("verifyRuntimeManifest"), "Electron sentinel must verify manifest sizes and hashes");
  assert(source.includes("nodeModulesIntact(nmLink, bundled)"), "startup must validate the actual bundled runtime");
  assert(source.includes("RUNTIME_MANIFEST_SHA256 = \"" + sha256(manifestPath) + "\""), "Electron must anchor the runtime manifest hash in code");
  assert(source.includes(".node_modules-repair-"), "Electron repair must extract into a separate verified directory");
}

console.log("release runtime manifest smoke: PASS entries=" + (manifest.nodeModules.length + manifest.server.length + 1));
