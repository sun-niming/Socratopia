"use strict";

var assert = require("assert");
var crypto = require("crypto");
var fs = require("fs");
var os = require("os");
var path = require("path");
var vm = require("vm");

function digest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function entry(relative, bytes) {
  return { path: relative, bytes: bytes.length, sha256: digest(bytes) };
}

function loadVerifier(mainPath, manifestHash) {
  var source = fs.readFileSync(mainPath, "utf8");
  var start = source.indexOf("var RUNTIME_MANIFEST_SHA256 =");
  var end = source.indexOf("function getServerNodeModulesPath", start);
  assert(start >= 0 && end > start, "Electron verifier source must be present");
  var snippet = source.slice(start, end).replace(/var RUNTIME_MANIFEST_SHA256 = "[a-f0-9]{64}";/, "var RUNTIME_MANIFEST_SHA256 = \"" + manifestHash + "\";");
  var sandbox = {
    import_crypto: { default: crypto },
    import_fs5: { default: fs },
    import_path4: { default: path },
    log: function () {},
  };
  vm.runInNewContext(snippet + "\nthis.verifier={loadRuntimeManifest,verifyRuntimeManifest,nodeModulesIntact};", sandbox, { filename: mainPath });
  return sandbox.verifier;
}

function writeFile(root, relative, bytes) {
  var file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-runtime-verifier-"));
try {
  var server = path.join(root, "server");
  var nodeModules = path.join(server, ".next", "node_modules");
  var archiveBytes = Buffer.from("archive-v1");
  var rapidBytes = Buffer.from("rapidocr-v1");
  var runtimeBytes = Buffer.from("canvas-runtime-v1");
  var manifest = {
    version: 1,
    archive: entry("deps.zip", archiveBytes),
    server: [entry("lib/ocr/rapidocr-v5/RapidOcrOnnx.exe", rapidBytes)],
    nodeModules: [entry("@napi-rs/canvas/index.js", runtimeBytes)],
  };
  var manifestBytes = Buffer.from(JSON.stringify(manifest));
  writeFile(server, "deps.zip", archiveBytes);
  writeFile(server, "lib/ocr/rapidocr-v5/RapidOcrOnnx.exe", rapidBytes);
  writeFile(nodeModules, "@napi-rs/canvas/index.js", runtimeBytes);
  writeFile(server, "release-runtime-manifest.json", manifestBytes);

  for (var mainPath of [
    path.resolve(__dirname, "..", "..", "..", "main.js"),
    path.resolve(__dirname, "..", "..", "..", "_asar_extracted", "dist-electron", "main.js"),
  ]) {
    var verifier = loadVerifier(mainPath, digest(manifestBytes));
    assert.strictEqual(verifier.nodeModulesIntact(nodeModules, server), true, "valid runtime must pass");
    verifier.verifyRuntimeManifest(server, nodeModules);

    writeFile(nodeModules, "@napi-rs/canvas/index.js", Buffer.from("canvas-runtime-v2"));
    assert.strictEqual(verifier.nodeModulesIntact(nodeModules, server), false, "same-size runtime tamper must fail");
    writeFile(nodeModules, "@napi-rs/canvas/index.js", runtimeBytes);

    fs.rmSync(path.join(nodeModules, "@napi-rs", "canvas", "index.js"));
    assert.strictEqual(verifier.nodeModulesIntact(nodeModules, server), false, "missing runtime file must fail");
    writeFile(nodeModules, "@napi-rs/canvas/index.js", runtimeBytes);

    writeFile(server, "lib/ocr/rapidocr-v5/RapidOcrOnnx.exe", Buffer.from("rapidocr-v2"));
    assert.throws(function () { verifier.verifyRuntimeManifest(server, nodeModules); }, /Runtime integrity check failed/);
    writeFile(server, "lib/ocr/rapidocr-v5/RapidOcrOnnx.exe", rapidBytes);

    writeFile(server, "release-runtime-manifest.json", Buffer.concat([manifestBytes, Buffer.from(" ")]));
    assert.throws(function () { verifier.loadRuntimeManifest(server); }, /manifest integrity check failed/i);
    writeFile(server, "release-runtime-manifest.json", manifestBytes);
  }
  console.log("electron runtime manifest verifier smoke: PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
