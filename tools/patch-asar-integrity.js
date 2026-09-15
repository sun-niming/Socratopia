"use strict";

// Re-embed the `ELECTRONASAR` integrity value in the launcher EXE after repacking `resources/app.asar`.
//
// Repacking the ASAR changes its header, and Electron compares that header against a hash baked into
// the EXE's resource section. Forgetting this step makes the app refuse to launch, so the patch is
// mandatory after every `npx asar pack`.
//
//   node tools/patch-asar-integrity.js [exe] [asar]          # default: Socratopia.exe + resources/app.asar
//   node tools/patch-asar-integrity.js --check [exe] [asar]  # verify only, exit 1 when out of sync
//
// Close the app first - a running Socratopia.exe holds the file locked (EBUSY).
//
// Two traps this handles, which a naive global replace gets wrong:
//   1. The resource *name* "ELECTRONASAR" is UTF-16LE, but its payload JSON is plain ASCII.
//   2. Other embedded resources also contain `"value":"...` - patch only the entry following the marker.

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var MARKER = Buffer.from("E\0L\0E\0C\0T\0R\0O\0N\0A\0S\0A\0R\0"); // UTF-16LE
var PAYLOAD_WINDOW = 1024;
var DEFAULT_EXE = "Socratopia.exe";
var DEFAULT_ASAR = path.join("resources", "app.asar");

function asarHeaderSha256(asarPath) {
  var contents = fs.readFileSync(asarPath);
  if (contents.length < 16) throw new Error("asar too short to hold a header: " + asarPath);
  if (contents.readUInt32LE(0) !== 4) throw new Error("unexpected asar pickle prefix in " + asarPath);
  // Electron hashes the raw header JSON: bytes [16, 16 + uint32LE(12)).
  var headerBytes = contents.readUInt32LE(12);
  var end = 16 + headerBytes;
  if (headerBytes <= 0 || end > contents.length) throw new Error("asar header size out of range in " + asarPath);
  return crypto.createHash("sha256").update(contents.slice(16, end)).digest("hex");
}

function readEmbeddedIntegrity(exePath) {
  var handle = fs.openSync(exePath, "r");
  try {
    var exe = Buffer.alloc(fs.fstatSync(handle).size);
    fs.readSync(handle, exe, 0, exe.length, 0);
    var marker = exe.indexOf(MARKER);
    if (marker < 0) throw new Error("no ELECTRONASAR resource in " + exePath);
    var start = marker + MARKER.length;
    var window = exe.slice(start, start + PAYLOAD_WINDOW).toString("latin1");
    var jsonStart = window.indexOf("[{");
    if (jsonStart < 0) throw new Error("no resource payload after ELECTRONASAR in " + exePath);
    var jsonEnd = window.indexOf("}]", jsonStart);
    if (jsonEnd < 0) throw new Error("unterminated ELECTRONASAR payload in " + exePath);
    var jsonText = window.slice(jsonStart, jsonEnd + 2);
    var entries = JSON.parse(jsonText);
    // Prefer a well-formed hash; fall back to any value field so a damaged value can still be repaired.
    var chosen = null;
    for (var index = 0; index < entries.length; index++) {
      var candidate = entries[index];
      if (typeof candidate.value !== "string") continue;
      if (/^[a-f0-9]{64}$/i.test(candidate.value)) { chosen = candidate; break; }
      if (!chosen) chosen = candidate;
    }
    if (!chosen) throw new Error("no resource entry with a value field in " + exePath);
    var valueAt = jsonText.indexOf('"value":"' + chosen.value + '"');
    if (valueAt < 0) throw new Error("value field offset not resolvable in " + exePath);
    return {
      file: chosen.file,
      algorithm: chosen.alg,
      value: chosen.value,
      offset: start + jsonStart + valueAt + '"value":"'.length,
    };
  } finally {
    fs.closeSync(handle);
  }
}

function patchAsarIntegrity(options) {
  var exePath = options.exePath;
  var asarPath = options.asarPath;
  var dryRun = options.dryRun === true;
  var want = asarHeaderSha256(asarPath);
  var embedded = readEmbeddedIntegrity(exePath);
  if (embedded.algorithm && embedded.algorithm !== "SHA256") {
    throw new Error("unsupported ELECTRONASAR algorithm: " + embedded.algorithm);
  }
  var result = { exePath: exePath, asarPath: asarPath, file: embedded.file, previous: embedded.value, expected: want, changed: false };
  if (embedded.value === want) return result;
  if (dryRun) {
    result.changed = true;
    return result;
  }
  var handle;
  try {
    handle = fs.openSync(exePath, "r+");
  } catch (error) {
    if (error && error.code === "EBUSY") throw new Error("cannot write " + exePath + " - close the running app first (EBUSY)");
    throw error;
  }
  try {
    fs.writeSync(handle, Buffer.from(want, "latin1"), 0, 64, embedded.offset);
  } finally {
    fs.closeSync(handle);
  }
  result.changed = true;
  return result;
}

function usage() {
  return [
    "Usage:",
    "  node tools/patch-asar-integrity.js [--check] [exe] [asar]",
    "",
    "Defaults to Socratopia.exe + resources/app.asar next to this repo. Close the app first.",
  ].join("\n");
}

function main(argv) {
  var args = argv.slice(2);
  var dryRun = false;
  if (args.indexOf("--check") >= 0) {
    dryRun = true;
    args = args.filter(function (value) { return value !== "--check"; });
  }
  if (args.indexOf("--help") >= 0) {
    console.log(usage());
    return;
  }
  if (args.length > 2) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  var exePath = path.resolve(args[0] || DEFAULT_EXE);
  var asarPath = path.resolve(args[1] || DEFAULT_ASAR);
  var result = patchAsarIntegrity({ exePath: exePath, asarPath: asarPath, dryRun: dryRun });
  if (dryRun && result.changed) {
    console.error("out of sync: " + exePath + " has " + result.previous + ", asar header is " + result.expected);
    process.exitCode = 1;
    return;
  }
  var prefix = dryRun ? "in sync" : result.changed ? "patched" : "in sync";
  console.log(prefix + ": " + result.file + " " + result.expected);
}

if (require.main === module) {
  try {
    main(process.argv);
  } catch (error) {
    console.error(error && error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  asarHeaderSha256: asarHeaderSha256,
  readEmbeddedIntegrity: readEmbeddedIntegrity,
  patchAsarIntegrity: patchAsarIntegrity,
};
