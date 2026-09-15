"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var serverRoot = path.resolve(__dirname, "..", "resources", "server");
var nodeModulesRoot = path.join(serverRoot, ".next", "node_modules");
var output = path.join(serverRoot, "release-runtime-manifest.json");

function sha256(file) {
  var hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function record(root, relative) {
  var normalized = relative.split(path.sep).join("/");
  var file = path.join(root, ...normalized.split("/"));
  var stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Manifest entry must be a regular file: " + normalized);
  return { path: normalized, bytes: stat.size, sha256: sha256(file) };
}

function collectTree(root, relative) {
  var absolute = path.join(root, ...relative.split("/"));
  var files = [];
  function walk(directory) {
    for (var entry of fs.readdirSync(directory, { withFileTypes: true })) {
      var file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symlink refused: " + file);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(record(root, path.relative(root, file)));
    }
  }
  walk(absolute);
  return files;
}

var nodeModules = collectTree(nodeModulesRoot, ".");
nodeModules.sort(function (left, right) { return left.path.localeCompare(right.path); });

var server = collectTree(serverRoot, "lib/ocr/rapidocr-v5");
server.sort(function (left, right) { return left.path.localeCompare(right.path); });

var packageVersions = {};
for (var packageName of ["@napi-rs/canvas", "pdfjs-dist", "ws", "write-file-atomic"]) {
  packageVersions[packageName] = JSON.parse(fs.readFileSync(path.join(nodeModulesRoot, packageName, "package.json"), "utf8")).version;
}

var manifest = {
  version: 1,
  generatedFrom: ".next/node_modules",
  packageVersions: packageVersions,
  archive: record(serverRoot, "deps.zip"),
  nodeModules: nodeModules,
  server: server,
};
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "w" });
console.log(output + " entries=" + (nodeModules.length + server.length + 1));
