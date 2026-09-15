"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var os = require("os");
var path = require("path");
var staging = require("./stage-clean-win-release.js");

function write(root, relative, contents) {
  var target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents || "fixture");
  return target;
}

function exists(root, relative) {
  return fs.existsSync(path.join(root, ...relative.split("/")));
}

function manifestEntry(root, relative, manifestPath) {
  var contents = fs.readFileSync(path.join(root, ...relative.split("/")));
  return { path: manifestPath, bytes: contents.length, sha256: crypto.createHash("sha256").update(contents).digest("hex") };
}

var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-clean-stage-"));
try {
  var source = path.join(root, "source");
  var destination = path.join(root, "release", "win-unpacked");
  fs.mkdirSync(source, { recursive: true });

  write(source, "Socratopia.exe", "electron");
  write(source, "resources.pak", "pak");
  write(source, "locales/en-US.pak", "locale");
  write(source, "resources/app.asar", "asar");
  write(source, "resources/app-update.yml", "update");
  write(source, "resources/server/.next/node_modules/@napi-rs/canvas/index.js", "canvas");
  write(source, "resources/server/.next/node_modules/pdfjs-dist/legacy/build/pdf.mjs", "pdfjs");
  write(source, "resources/server/.next/node_modules/next/dist/cli/next-test.js", "manifest-runtime-despite-test-name");
  write(source, "resources/server/deps.zip", "deps");
  write(source, "resources/server/lib/ocr/rapidocr-v5/RapidOcrOnnx.exe", "ocr");
  write(source, "resources/server/lib/ocr/rapidocr-v5/LICENSE", "license");
  write(source, "resources/server/lib/ocr/rapidocr-v5/THIRD_PARTY_NOTICES.md", "notices");
  write(source, "resources/server/server.js", "server");
  var runtimeManifest = {
    version: 1,
    generatedFrom: ".next/node_modules",
    packageVersions: {},
    archive: manifestEntry(source, "resources/server/deps.zip", "deps.zip"),
    nodeModules: [
      manifestEntry(source, "resources/server/.next/node_modules/@napi-rs/canvas/index.js", "@napi-rs/canvas/index.js"),
      manifestEntry(source, "resources/server/.next/node_modules/next/dist/cli/next-test.js", "next/dist/cli/next-test.js"),
      manifestEntry(source, "resources/server/.next/node_modules/pdfjs-dist/legacy/build/pdf.mjs", "pdfjs-dist/legacy/build/pdf.mjs"),
    ],
    server: [
      manifestEntry(source, "resources/server/lib/ocr/rapidocr-v5/RapidOcrOnnx.exe", "lib/ocr/rapidocr-v5/RapidOcrOnnx.exe"),
      manifestEntry(source, "resources/server/lib/ocr/rapidocr-v5/LICENSE", "lib/ocr/rapidocr-v5/LICENSE"),
      manifestEntry(source, "resources/server/lib/ocr/rapidocr-v5/THIRD_PARTY_NOTICES.md", "lib/ocr/rapidocr-v5/THIRD_PARTY_NOTICES.md"),
    ],
  };
  write(source, "resources/server/release-runtime-manifest.json", JSON.stringify(runtimeManifest));

  var canary = "REAL_KEY_MUST_NOT_COPY";
  write(source, "resources/settings.json", canary);
  write(source, "resources/set.json", canary);
  write(source, "resources/settings_dp.json", canary);
  write(source, "resources/settings__.json", canary);
  write(source, "resources/settings - copy.json", canary);
  write(source, "resources/setup.json", "legitimate-resource");
  write(source, "resources/server/node_modules/dev-only/index.js", canary);
  write(source, "resources/server/lib/feature-smoke-test.js", canary);
  write(source, "resources/server/lib/feature.test.js", canary);
  write(source, "resources/server/lib/fixtures/secret-fixture.json", canary);
  write(source, "resources/server/.next/server/app.js.map", canary);
  write(source, "node_modules/root-dev/index.js", canary);
  write(source, "tools/dev-tool.js", canary);
  write(source, ".git/config", canary);
  write(source, "main.js", canary);
  write(source, "README.md", canary);

  write(destination, "stale.txt", "stale");
  var result = staging.stageCleanWinRelease({ sourceRoot: source, destinationRoot: destination });
  assert(result.files > 0);
  assert(exists(destination, "Socratopia.exe"));
  assert(exists(destination, "resources/app.asar"));
  assert(exists(destination, "resources/server/.next/node_modules/@napi-rs/canvas/index.js"));
  assert(exists(destination, "resources/server/.next/node_modules/pdfjs-dist/legacy/build/pdf.mjs"));
  assert(exists(destination, "resources/server/.next/node_modules/next/dist/cli/next-test.js"), "manifest-managed runtime files must not be removed by generic test-name filtering");
  assert(exists(destination, "resources/server/deps.zip"));
  assert(exists(destination, "resources/server/release-runtime-manifest.json"));
  assert(exists(destination, "resources/server/lib/ocr/rapidocr-v5/RapidOcrOnnx.exe"));
  assert(exists(destination, "resources/server/lib/ocr/rapidocr-v5/LICENSE"));
  assert(exists(destination, "resources/server/lib/ocr/rapidocr-v5/THIRD_PARTY_NOTICES.md"));
  assert(!exists(destination, "stale.txt"));
  assert(!exists(destination, "resources/settings.json"));
  assert(!exists(destination, "resources/set.json"));
  // Ad-hoc variants of the same local config are excluded too; a similarly-named real resource is not.
  assert(!exists(destination, "resources/settings_dp.json"));
  assert(!exists(destination, "resources/settings__.json"));
  assert(!exists(destination, "resources/settings - copy.json"));
  assert(exists(destination, "resources/setup.json"));
  assert(!exists(destination, "resources/server/node_modules"));
  assert(!exists(destination, "resources/server/lib/feature-smoke-test.js"));
  assert(!exists(destination, "resources/server/lib/feature.test.js"));
  assert(!exists(destination, "resources/server/lib/fixtures"));
  assert(!exists(destination, "resources/server/.next/server/app.js.map"));
  assert(!exists(destination, "node_modules"));
  assert(!exists(destination, "tools"));
  assert(!exists(destination, ".git"));
  assert(!exists(destination, "main.js"));
  assert(!exists(destination, "README.md"));
  assert(exists(source, "resources/server/node_modules/dev-only/index.js"), "staging must never mutate source node_modules");

  var stagedText = [];
  (function collect(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
      var target = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(target);
      else stagedText.push(fs.readFileSync(target).toString("utf8"));
    });
  })(destination);
  assert(!stagedText.join("\n").includes(canary), "sensitive canary must not enter staged output");

  var verifyCli = childProcess.spawnSync(process.execPath, [path.join(__dirname, "verify-clean-win-release.js"), destination], {
    encoding: "utf8",
  });
  assert.strictEqual(verifyCli.status, 0, verifyCli.stderr || verifyCli.stdout);
  assert(verifyCli.stdout.includes("clean Windows release verified"));

  // Local config is skipped by the copy (asserted above) but must be tolerated by verify: the packaged
  // server reads resources/settings.json at runtime, so a finished release carries it by hand.
  assert.strictEqual(staging.allowedReleasePath("resources/settings.json"), false, "copy skips local config");
  assert.strictEqual(staging.allowedStagedPath("resources/settings.json"), true, "finished release may carry local config");
  assert.strictEqual(staging.allowedReleasePath("resources/set.json"), false);
  assert.strictEqual(staging.allowedStagedPath("resources/set.json"), true);
  write(destination, "resources/settings.json", canary);
  staging.verifyCleanWinRelease(destination);
  write(destination, "resources/set.json", canary);
  staging.verifyCleanWinRelease(destination);

  // The exemption is narrow - everything else still fails verification.
  write(destination, "resources/server/lib/leftover-smoke-test.js", canary);
  assert.throws(function () { staging.verifyCleanWinRelease(destination); }, /forbidden release artifact/);
  fs.rmSync(path.join(destination, "resources", "server", "lib", "leftover-smoke-test.js"), { force: true });
  write(destination, "resources/server/node_modules/dev-only/index.js", canary);
  assert.throws(function () { staging.verifyCleanWinRelease(destination); }, /forbidden release artifact/);
  fs.rmSync(path.join(destination, "resources", "server", "node_modules"), { recursive: true, force: true });
  staging.verifyCleanWinRelease(destination);
  fs.writeFileSync(path.join(destination, "resources", "server", ".next", "node_modules", "next", "dist", "cli", "next-test.js"), "tampered");
  assert.throws(function () { staging.verifyCleanWinRelease(destination); }, /runtime manifest (size|hash) mismatch/);
  fs.writeFileSync(path.join(destination, "resources", "server", ".next", "node_modules", "next", "dist", "cli", "next-test.js"), "manifest-runtime-despite-test-name");
  staging.verifyCleanWinRelease(destination);

  var badSource = path.join(root, "bad-source");
  var protectedDestination = path.join(root, "failed-release", "win-unpacked");
  write(badSource, "Socratopia.exe", "electron");
  write(protectedDestination, "keep.txt", "keep");
  assert.throws(function () {
    staging.stageCleanWinRelease({ sourceRoot: badSource, destinationRoot: protectedDestination });
  }, /missing required release artifact/);
  assert.strictEqual(fs.readFileSync(path.join(protectedDestination, "keep.txt"), "utf8"), "keep", "failed staging must not replace the previous release");

  var leftovers = fs.readdirSync(path.dirname(destination)).filter(function (name) {
    return name.startsWith(".win-unpacked.stage-") || name.startsWith(".win-unpacked.backup-");
  });
  assert.deepStrictEqual(leftovers, []);
  console.log("clean Windows release staging smoke: PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
