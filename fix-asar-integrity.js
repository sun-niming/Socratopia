/**
 * ASAR Integrity Fixer for Socratopia
 *
 * After any edit to _asar_extracted/ files and re-packing with:
 *   npx asar pack _asar_extracted/ resources/app.asar
 *
 * Run this script to auto-update the ELECTRONASAR integrity hash in the EXE:
 *   node fix-asar-integrity.js
 */

var fs = require('fs');
var crypto = require('crypto');
var path = require('path');

var BASE = __dirname;
var EXE_PATH = process.argv[2] ? path.resolve(process.argv[2]) : (fs.existsSync(path.join(BASE, 'Socratopia.exe'))
  ? path.join(BASE, 'Socratopia.exe')
  : path.join(BASE, 'win-unpacked', 'Socratopia.exe'));
var ASAR_PATH = process.argv[3] ? path.resolve(process.argv[3]) : path.join(BASE, 'resources', 'app.asar');

// ---- 1. Compute ASAR header hash ----
var asarBuf = fs.readFileSync(ASAR_PATH);

// Find end of JSON header (starts at byte 16 in ASAR format)
var braceDepth = 0;
var jsonEnd = -1;
var inString = false;
var escaped = false;

for (var i = 16; i < asarBuf.length; i++) {
  var ch = String.fromCharCode(asarBuf[i]);
  if (escaped) { escaped = false; continue; }
  if (ch === String.fromCharCode(92)) { escaped = true; continue; }  // backslash
  if (ch === String.fromCharCode(34)) { inString = !inString; continue; }  // quote
  if (inString) continue;
  if (ch === '{') braceDepth++;
  if (ch === '}') {
    braceDepth--;
    if (braceDepth === 0) { jsonEnd = i + 1; break; }
  }
}

if (jsonEnd < 0) {
  console.error('ERROR: Could not find end of ASAR JSON header');
  process.exit(1);
}

var newHash = crypto.createHash('sha256').update(asarBuf.slice(16, jsonEnd)).digest('hex');
console.log('Computed ASAR header hash: ' + newHash);

// ---- 2. Find and update ELECTRONASAR resource in EXE ----
var exeBuf = fs.readFileSync(EXE_PATH);

// Search for UTF-16LE encoded "ELECTRONASAR" string
var searchStr = 'ELECTRONASAR';
var utf16 = Buffer.alloc(searchStr.length * 2);
for (var i = 0; i < searchStr.length; i++) {
  utf16.writeUInt16LE(searchStr.charCodeAt(i), i * 2);
}

var elecOffset = exeBuf.indexOf(utf16);
if (elecOffset < 0) {
  console.error('ERROR: ELECTRONASAR resource not found in EXE');
  process.exit(1);
}

// JSON manifest starts after the name + 2 null bytes (UTF-16 null terminator)
var jsonStart = elecOffset + searchStr.length * 2 + 2;
var jsonEndExe = exeBuf.indexOf(0, jsonStart); // null byte ends the JSON string
var jsonStr = exeBuf.toString('utf-8', jsonStart, jsonEndExe);

console.log('Found integrity manifest: ' + jsonStr);

var match = jsonStr.match(/"value":"([a-f0-9]{64})"/);
if (!match) {
  console.error('ERROR: Could not find hash value in integrity manifest');
  process.exit(1);
}

var oldHash = match[1];
console.log('Old hash: ' + oldHash);

if (oldHash === newHash) {
  console.log('Hash unchanged. No update needed.');
  process.exit(0);
}

var hashOffset = exeBuf.indexOf(Buffer.from(oldHash, 'ascii'));
if (hashOffset < 0) {
  console.error('ERROR: Old hash bytes not found at expected location');
  process.exit(1);
}

exeBuf.set(Buffer.from(newHash, 'ascii'), hashOffset);
fs.writeFileSync(EXE_PATH, exeBuf);
console.log('Updated EXE with new hash: ' + newHash);
console.log('Done.');
