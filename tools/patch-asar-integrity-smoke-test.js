"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var os = require("os");
var path = require("path");
var integrity = require("./patch-asar-integrity.js");

// Fixtures mirror the real on-disk layout: an asar pickle header, and an EXE carrying a UTF-16LE
// resource name followed by an ASCII JSON payload - plus a decoy `"value":"` earlier in the file,
// which a naive "patch the first match" implementation would corrupt instead.

var MARKER = Buffer.from("E\0L\0E\0C\0T\0R\0O\0N\0A\0S\0A\0R\0");
var ASAR_FILE = "resources" + path.sep + "app.asar";
var DECOY = "f".repeat(64);
var STALE = "a".repeat(64);

function buildAsar(headerJson) {
  var header = Buffer.from(headerJson, "utf8");
  var pad = (4 - (header.length % 4)) % 4;
  var payloadStart = 16 + header.length + pad;
  var buf = Buffer.alloc(payloadStart + 7);
  buf.writeUInt32LE(4, 0);
  buf.writeUInt32LE(payloadStart - 8, 4);
  buf.writeUInt32LE(payloadStart - 12, 8);
  buf.writeUInt32LE(header.length, 12);
  header.copy(buf, 16);
  buf.write("PAYLOAD", payloadStart, "utf8");
  return buf;
}

function resourcePayload(value) {
  return JSON.stringify([{ file: ASAR_FILE, alg: "SHA256", value: value }]);
}

function buildExe(value, options) {
  var settings = options || {};
  var decoy = Buffer.concat([
    Buffer.from(JSON.stringify({ resource: "OTHER", value: DECOY }) + "\0"),
    Buffer.alloc(settings.padding || 0, 0x20),
  ]);
  return Buffer.concat([
    Buffer.from("MZ-pretend-launcher\0"),
    decoy,
    MARKER,
    Buffer.from("\0\0\0" + resourcePayload(settings.smash || value) + "\0"),
    Buffer.from("\0tail\0"),
  ]);
}

function headerHash(asarPath) {
  var contents = fs.readFileSync(asarPath);
  return crypto.createHash("sha256").update(contents.slice(16, 16 + contents.readUInt32LE(12))).digest("hex");
}

var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-asar-integrity-"));
try {
  var exePath = path.join(root, "Socratopia.exe");
  var asarPath = path.join(root, "resources", "app.asar");
  fs.mkdirSync(path.dirname(asarPath), { recursive: true });
  fs.writeFileSync(asarPath, buildAsar('{"files":{"dist-electron":{"files":{}}}}'));

  assert.strictEqual(integrity.asarHeaderSha256(asarPath), headerHash(asarPath), "hash covers exactly the asar header JSON");
  assert.notStrictEqual(integrity.asarHeaderSha256(asarPath), crypto.createHash("sha256").update(fs.readFileSync(asarPath)).digest("hex"), "hash is not over the whole archive");

  // The marker sits after the decoy, so patching the first `"value":"` in the file would write elsewhere.
  fs.writeFileSync(exePath, buildExe(STALE, { padding: 64 }));
  var fileBytes = fs.readFileSync(exePath);
  var decoyOffset = fileBytes.indexOf(Buffer.from(DECOY));
  var decoyBefore = fileBytes.slice(decoyOffset - 28, decoyOffset + 66);

  var entry = integrity.readEmbeddedIntegrity(exePath);
  assert.strictEqual(entry.value, STALE, "reads the marker's own entry, not the decoy");
  assert.strictEqual(entry.file, ASAR_FILE);
  assert.strictEqual(entry.algorithm, "SHA256");

  // The reported offset must address the value field itself.
  var shifted = buildExe("b".repeat(64), { padding: 64 });
  shifted.write("c".repeat(64), entry.offset, 64, "latin1");
  fs.writeFileSync(exePath, shifted);
  assert.strictEqual(integrity.readEmbeddedIntegrity(exePath).value, "c".repeat(64), "reported offset addresses the value field");

  fs.writeFileSync(exePath, buildExe(STALE, { padding: 64 }));
  var expected = integrity.asarHeaderSha256(asarPath);

  var dry = integrity.patchAsarIntegrity({ exePath: exePath, asarPath: asarPath, dryRun: true });
  assert.strictEqual(dry.changed, true);
  assert.strictEqual(integrity.readEmbeddedIntegrity(exePath).value, STALE, "dry run must not write");

  var patched = integrity.patchAsarIntegrity({ exePath: exePath, asarPath: asarPath });
  assert.strictEqual(patched.changed, true);
  assert.strictEqual(patched.previous, STALE);
  assert.strictEqual(patched.expected, expected);
  assert.strictEqual(integrity.readEmbeddedIntegrity(exePath).value, expected, "embedded value now matches the asar header");

  assert.deepStrictEqual(fs.readFileSync(exePath).slice(decoyOffset - 28, decoyOffset + 66), decoyBefore, "decoy resource untouched");
  assert.strictEqual(integrity.readEmbeddedIntegrity(exePath).file, ASAR_FILE, "decoy payload not reparsed as the marker payload");

  assert.strictEqual(integrity.patchAsarIntegrity({ exePath: exePath, asarPath: asarPath }).changed, false, "patching is idempotent");

  // Repacking the asar shifts the header hash; the EXE must be re-embedded.
  fs.writeFileSync(asarPath, buildAsar('{"files":{"dist-electron":{"files":{"main.js":{"size":1}}}}}'));
  var afterRepack = integrity.patchAsarIntegrity({ exePath: exePath, asarPath: asarPath });
  assert.strictEqual(afterRepack.changed, true, "repacked asar invalidates the embedded hash");
  assert.notStrictEqual(afterRepack.expected, expected);
  assert.strictEqual(integrity.readEmbeddedIntegrity(exePath).value, afterRepack.expected);

  // A value damaged in transit (not hex) is still located by field name and repaired.
  fs.writeFileSync(exePath, buildExe(STALE, { padding: 64, smash: "z".repeat(64) }));
  assert.strictEqual(integrity.patchAsarIntegrity({ exePath: exePath, asarPath: asarPath }).changed, true, "non-hex value still repaired");
  assert.strictEqual(integrity.readEmbeddedIntegrity(exePath).value, afterRepack.expected);

  // Odd header lengths exercise the pickle's 4-byte padding.
  fs.writeFileSync(asarPath, buildAsar('{"files":{"odd":1}}'));
  integrity.patchAsarIntegrity({ exePath: exePath, asarPath: asarPath });
  assert.strictEqual(integrity.readEmbeddedIntegrity(exePath).value, integrity.asarHeaderSha256(asarPath), "odd-length header aligned correctly");

  // Failures are explicit rather than silent.
  var noMarker = path.join(root, "no-marker.exe");
  fs.writeFileSync(noMarker, Buffer.from("nothing to see"));
  assert.throws(function () { integrity.readEmbeddedIntegrity(noMarker); }, /no ELECTRONASAR resource/);
  assert.throws(function () { integrity.asarHeaderSha256(path.join(root, "missing.asar")); }, /ENOENT/);
  var stub = path.join(root, "stub.asar");
  fs.writeFileSync(stub, Buffer.from([4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0]));
  assert.throws(function () { integrity.asarHeaderSha256(stub); }, /header size out of range/);
  fs.writeFileSync(path.join(root, "short.asar"), Buffer.alloc(4));
  assert.throws(function () { integrity.asarHeaderSha256(path.join(root, "short.asar")); }, /too short/);

  var tool = path.join(__dirname, "patch-asar-integrity.js");
  function run(args) {
    return childProcess.spawnSync(process.execPath, [tool].concat(args), { encoding: "utf8" });
  }

  var checkInSync = run(["--check", exePath, asarPath]);
  assert.strictEqual(checkInSync.status, 0, checkInSync.stderr);
  assert.match(checkInSync.stdout, /^in sync: /);

  var settled = integrity.readEmbeddedIntegrity(exePath).value;
  fs.writeFileSync(asarPath, buildAsar('{"files":{"drifted":true}}'));
  var driftedHash = integrity.asarHeaderSha256(asarPath);
  var checkDrifted = run(["--check", exePath, asarPath]);
  assert.strictEqual(checkDrifted.status, 1);
  assert.match(checkDrifted.stderr, /out of sync: /);
  assert.strictEqual(integrity.readEmbeddedIntegrity(exePath).value, settled, "--check reports drift but leaves the EXE alone");

  var writeRun = run([exePath, asarPath]);
  assert.strictEqual(writeRun.status, 0, writeRun.stderr);
  assert.match(writeRun.stdout, /^patched: /);
  assert.strictEqual(integrity.readEmbeddedIntegrity(exePath).value, driftedHash, "CLI writes the header hash");

  var badArgs = run(["--nope", "a", "b", "c"]);
  assert.strictEqual(badArgs.status, 2);
  assert.match(badArgs.stderr, /Usage:/);

  console.log("patch ASAR integrity smoke: PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
