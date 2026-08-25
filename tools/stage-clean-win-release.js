"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var ROOT_RUNTIME_DIRECTORIES = new Set(["locales", "resources"]);
var ROOT_RUNTIME_FILES = new Set([
  "Socratopia.exe",
  "Uninstall Socratopia.exe",
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "d3dcompiler_47.dll",
  "dxcompiler.dll",
  "dxil.dll",
  "ffmpeg.dll",
  "icudtl.dat",
  "libEGL.dll",
  "libGLESv2.dll",
  "LICENSE.electron.txt",
  "LICENSES.chromium.html",
  "resources.pak",
  "snapshot_blob.bin",
  "uninstallerIcon.ico",
  "v8_context_snapshot.bin",
  "vk_swiftshader.dll",
  "vk_swiftshader_icd.json",
  "vulkan-1.dll",
]);
var REQUIRED_RELEASE_ARTIFACTS = Object.freeze([
  ["Socratopia.exe", "file"],
  ["resources.pak", "file"],
  ["locales", "directory"],
  ["resources/app.asar", "file"],
  ["resources/server/.next/node_modules", "directory"],
  ["resources/server/deps.zip", "file"],
  ["resources/server/release-runtime-manifest.json", "file"],
  ["resources/server/lib/ocr/rapidocr-v5/RapidOcrOnnx.exe", "file"],
  ["resources/server/lib/ocr/rapidocr-v5/LICENSE", "file"],
  ["resources/server/lib/ocr/rapidocr-v5/THIRD_PARTY_NOTICES.md", "file"],
]);

function normalized(relative) {
  return String(relative || "").split(path.sep).join("/").replace(/^[/]+|[/]+$/g, "");
}

function testOrSourceMap(relative) {
  var parts = normalized(relative).toLowerCase().split("/");
  var basename = parts[parts.length - 1] || "";
  if (basename.endsWith(".map")) return true;
  if (parts.some(function (part) {
    return part === "test" || part === "tests" || part === "__tests__" ||
      part === "spec" || part === "specs" || part === "fixtures";
  })) return true;
  return parts.some(function (part) {
    return /(^|[-_.])(?:smoke|tests?|spec)(?:[-_.]|$)/i.test(part);
  });
}

function manifestRuntimePath(relative) {
  var rel = normalized(relative).toLowerCase();
  return rel === "resources/server/.next/node_modules" || rel.startsWith("resources/server/.next/node_modules/");
}

function forbiddenReleasePath(relative) {
  var rel = normalized(relative).toLowerCase();
  if (!rel) return false;
  if (rel === "resources/settings.json" || rel === "resources/set.json") return true;
  if (rel === "resources/server/node_modules" || rel.startsWith("resources/server/node_modules/")) return true;
  if (manifestRuntimePath(rel)) return false;
  return testOrSourceMap(rel);
}

function allowedReleasePath(relative) {
  var rel = normalized(relative);
  if (!rel || forbiddenReleasePath(rel)) return false;
  var parts = rel.split("/");
  if (parts.length === 1) return ROOT_RUNTIME_DIRECTORIES.has(parts[0]) || ROOT_RUNTIME_FILES.has(parts[0]);
  return ROOT_RUNTIME_DIRECTORIES.has(parts[0]);
}

function assertDirectory(root, label) {
  var stat;
  try { stat = fs.lstatSync(root); } catch (_) { throw new Error(label + " missing: " + root); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(label + " must be a real directory: " + root);
}

function copyAllowedTree(sourceRoot, destinationRoot) {
  var files = 0;
  var bytes = 0;
  function copyDirectory(sourceDirectory, relativeDirectory) {
    fs.readdirSync(sourceDirectory, { withFileTypes: true }).sort(function (left, right) {
      return left.name.localeCompare(right.name);
    }).forEach(function (entry) {
      var relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      if (!allowedReleasePath(relative)) return;
      var source = path.join(sourceDirectory, entry.name);
      var destination = path.join(destinationRoot, relative);
      var stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw new Error("symlink refused while staging: " + normalized(relative));
      if (stat.isDirectory()) {
        fs.mkdirSync(destination, { recursive: true });
        copyDirectory(source, relative);
        return;
      }
      if (!stat.isFile()) throw new Error("unsupported release artifact: " + normalized(relative));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      files += 1;
      bytes += stat.size;
    });
  }
  copyDirectory(sourceRoot, "");
  return { files: files, bytes: bytes };
}

function requiredArtifact(root, relative, kind) {
  var target = path.join(root, ...relative.split("/"));
  var stat;
  try { stat = fs.lstatSync(target); } catch (_) { throw new Error("missing required release artifact: " + relative); }
  if (stat.isSymbolicLink()) throw new Error("symlink refused in release: " + relative);
  if (kind === "file" && (!stat.isFile() || stat.size <= 0)) throw new Error("missing required release artifact: " + relative);
  if (kind === "directory" && !stat.isDirectory()) throw new Error("missing required release artifact: " + relative);
}

function safeManifestRelative(value, label) {
  var raw = String(value || "");
  var portable = raw.split("\\").join("/");
  if (!raw || path.isAbsolute(raw) || /^[a-z]:/i.test(raw) || portable.startsWith("/") || portable.indexOf("\0") >= 0) {
    throw new Error("invalid runtime manifest path: " + label);
  }
  var rel = normalized(raw);
  if (!rel || rel === ".." || rel.startsWith("../") || rel.indexOf("/../") >= 0 || rel.split("/").some(function (part) { return !part || part === "." || part === ".."; })) {
    throw new Error("invalid runtime manifest path: " + label);
  }
  return rel;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function verifyManifestFile(baseRoot, entry, label) {
  if (!entry || typeof entry !== "object") throw new Error("invalid runtime manifest entry: " + label);
  var relative = safeManifestRelative(entry.path, label);
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/i.test(String(entry.sha256 || ""))) {
    throw new Error("invalid runtime manifest metadata: " + label + ":" + relative);
  }
  var target = path.resolve(baseRoot, ...relative.split("/"));
  var containment = path.relative(path.resolve(baseRoot), target);
  if (!containment || containment === ".." || containment.startsWith(".." + path.sep) || path.isAbsolute(containment)) {
    throw new Error("runtime manifest path escaped base: " + label + ":" + relative);
  }
  var stat;
  try { stat = fs.lstatSync(target); } catch (_) { throw new Error("runtime manifest file missing: " + label + ":" + relative); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("runtime manifest entry must be a regular file: " + label + ":" + relative);
  if (stat.size !== entry.bytes) throw new Error("runtime manifest size mismatch: " + label + ":" + relative);
  if (sha256File(target) !== String(entry.sha256).toLowerCase()) throw new Error("runtime manifest hash mismatch: " + label + ":" + relative);
  return relative;
}

function regularFileInventory(root) {
  var files = [];
  function walk(directory, relativeDirectory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
      var relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      var target = path.join(directory, entry.name);
      var stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error("symlink refused in runtime inventory: " + normalized(relative));
      if (stat.isDirectory()) walk(target, relative);
      else if (stat.isFile()) files.push(normalized(relative));
      else throw new Error("unsupported runtime artifact: " + normalized(relative));
    });
  }
  walk(root, "");
  return files.sort();
}

function verifyManifestEntries(baseRoot, entries, label, exactInventory) {
  if (!Array.isArray(entries) || !entries.length) throw new Error("invalid runtime manifest entries: " + label);
  var expected = [];
  var seen = new Set();
  entries.forEach(function (entry, index) {
    var relative = verifyManifestFile(baseRoot, entry, label + "[" + index + "]");
    if (seen.has(relative)) throw new Error("duplicate runtime manifest entry: " + label + ":" + relative);
    seen.add(relative);
    expected.push(relative);
  });
  if (exactInventory) {
    expected.sort();
    var actual = regularFileInventory(baseRoot);
    if (actual.length !== expected.length || actual.some(function (value, index) { return value !== expected[index]; })) {
      throw new Error("runtime manifest inventory mismatch: " + label);
    }
  }
}

function verifyRuntimeManifest(releaseRoot) {
  var serverRoot = path.join(releaseRoot, "resources", "server");
  var manifestPath = path.join(serverRoot, "release-runtime-manifest.json");
  var manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch (_) {
    throw new Error("invalid release runtime manifest: resources/server/release-runtime-manifest.json");
  }
  if (!manifest || manifest.version !== 1 || !manifest.archive) throw new Error("invalid release runtime manifest schema");
  verifyManifestFile(serverRoot, manifest.archive, "archive");
  verifyManifestEntries(path.join(serverRoot, ".next", "node_modules"), manifest.nodeModules, "nodeModules", true);
  verifyManifestEntries(serverRoot, manifest.server, "server", false);
}

function verifyCleanWinRelease(root) {
  var releaseRoot = path.resolve(String(root || ""));
  assertDirectory(releaseRoot, "release root");
  var files = 0;
  var bytes = 0;
  function inspect(directory, relativeDirectory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
      var relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      if (!allowedReleasePath(relative)) throw new Error("forbidden release artifact: " + normalized(relative));
      var target = path.join(directory, entry.name);
      var stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error("symlink refused in release: " + normalized(relative));
      if (stat.isDirectory()) inspect(target, relative);
      else if (stat.isFile()) {
        files += 1;
        bytes += stat.size;
      } else {
        throw new Error("unsupported release artifact: " + normalized(relative));
      }
    });
  }
  inspect(releaseRoot, "");
  REQUIRED_RELEASE_ARTIFACTS.forEach(function (item) { requiredArtifact(releaseRoot, item[0], item[1]); });
  verifyRuntimeManifest(releaseRoot);
  return Object.freeze({ root: releaseRoot, files: files, bytes: bytes });
}

function assertSafeRoots(sourceRoot, destinationRoot) {
  if (path.basename(destinationRoot).toLowerCase() !== "win-unpacked") {
    throw new Error("destination basename must be win-unpacked: " + destinationRoot);
  }
  if (sourceRoot === destinationRoot) throw new Error("source and destination must differ");
  var sourceInsideDestination = path.relative(destinationRoot, sourceRoot);
  if (sourceInsideDestination === "" || sourceInsideDestination === ".." || !sourceInsideDestination.startsWith(".." + path.sep)) {
    throw new Error("source must not be inside destination");
  }
  if (path.dirname(destinationRoot) === path.parse(destinationRoot).root) throw new Error("destination parent must not be a filesystem root");
}

function generatedSibling(destinationRoot, kind, token) {
  return path.join(path.dirname(destinationRoot), "." + path.basename(destinationRoot) + "." + kind + "-" + token);
}

function assertGeneratedSibling(destinationRoot, candidate, kind) {
  var expectedParent = path.dirname(destinationRoot);
  var expectedPrefix = "." + path.basename(destinationRoot) + "." + kind + "-";
  if (path.dirname(candidate) !== expectedParent || !path.basename(candidate).startsWith(expectedPrefix)) {
    throw new Error("unsafe generated staging path: " + candidate);
  }
}

function stageCleanWinRelease(options) {
  options = options || {};
  var sourceRoot = path.resolve(String(options.sourceRoot || process.cwd()));
  var destinationRoot = path.resolve(String(options.destinationRoot || path.join(sourceRoot, "release", "win-unpacked")));
  assertDirectory(sourceRoot, "source root");
  assertSafeRoots(sourceRoot, destinationRoot);
  fs.mkdirSync(path.dirname(destinationRoot), { recursive: true });
  var token = process.pid + "-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex");
  var stagingRoot = generatedSibling(destinationRoot, "stage", token);
  var backupRoot = generatedSibling(destinationRoot, "backup", token);
  assertGeneratedSibling(destinationRoot, stagingRoot, "stage");
  assertGeneratedSibling(destinationRoot, backupRoot, "backup");
  var movedExisting = false;
  try {
    fs.mkdirSync(stagingRoot, { recursive: false });
    copyAllowedTree(sourceRoot, stagingRoot);
    verifyCleanWinRelease(stagingRoot);
    if (fs.existsSync(destinationRoot)) {
      var existingStat = fs.lstatSync(destinationRoot);
      if (existingStat.isSymbolicLink() || !existingStat.isDirectory()) throw new Error("existing destination must be a real directory");
      fs.renameSync(destinationRoot, backupRoot);
      movedExisting = true;
    }
    try {
      fs.renameSync(stagingRoot, destinationRoot);
    } catch (installError) {
      if (movedExisting && !fs.existsSync(destinationRoot) && fs.existsSync(backupRoot)) fs.renameSync(backupRoot, destinationRoot);
      throw installError;
    }
    if (movedExisting && fs.existsSync(backupRoot)) fs.rmSync(backupRoot, { recursive: true, force: true });
    return verifyCleanWinRelease(destinationRoot);
  } finally {
    if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
    if (fs.existsSync(backupRoot) && !fs.existsSync(destinationRoot)) fs.renameSync(backupRoot, destinationRoot);
  }
}

function usage() {
  return [
    "Usage:",
    "  node tools/stage-clean-win-release.js stage [source-win-unpacked] [destination-win-unpacked]",
    "  node tools/stage-clean-win-release.js verify <destination-win-unpacked>",
  ].join("\n");
}

function main(argv) {
  var mode = argv[2];
  if (mode === "stage") {
    var sourceRoot = path.resolve(argv[3] || process.cwd());
    var destinationRoot = path.resolve(argv[4] || path.join(sourceRoot, "release", "win-unpacked"));
    var staged = stageCleanWinRelease({ sourceRoot: sourceRoot, destinationRoot: destinationRoot });
    console.log("clean Windows release staged: files=" + staged.files + " bytes=" + staged.bytes + " root=" + staged.root);
    return;
  }
  if (mode === "verify" && argv[3]) {
    var verified = verifyCleanWinRelease(argv[3]);
    console.log("clean Windows release verified: files=" + verified.files + " bytes=" + verified.bytes + " root=" + verified.root);
    return;
  }
  console.error(usage());
  process.exitCode = 2;
}

if (require.main === module) main(process.argv);

module.exports = {
  allowedReleasePath: allowedReleasePath,
  forbiddenReleasePath: forbiddenReleasePath,
  stageCleanWinRelease: stageCleanWinRelease,
  verifyCleanWinRelease: verifyCleanWinRelease,
};
