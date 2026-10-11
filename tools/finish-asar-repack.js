// Finish the Electron-layer half of a fix: repack app.asar from the staged tree and
// re-embed the EXE integrity hash, or safely abort when the EXE is file-locked.
//
//   node tools/finish-asar-repack.js          stage + pack + patch (safe abort)
//   node tools/finish-asar-repack.js --check  report only, no writes
//   node tools/finish-asar-repack.js --copy   on EBUSY keep the new asar and emit
//                                             a patched Socratopia.patched.exe
//
// Why a tool instead of two commands: `npx asar pack` succeeds even while the EXE is
// locked, and a repacked asar with a stale EXE hash *bricks launch*.  So an aborted
// run must put the asar back.  `--check` is always safe, even with the app running.
"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EXE = path.join(ROOT, "Socratopia.exe");
const ASAR = path.join(ROOT, "resources", "app.asar");
const STAGE = path.join(ROOT, "_asar_extracted");
const PATCHER = path.join(ROOT, "tools", "patch-asar-integrity.js");
const BACKUP = path.join(ROOT, "outputs", "app.asar.before-finish.bak");
const COPY_EXE = path.join(ROOT, "Socratopia.patched.exe");
const ELECTRON_FILES = ["main.js", "preload.js"];

function run(cmd, args) {
  return cp.spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
}

function writeProbe(file) {
  try {
    fs.closeSync(fs.openSync(file, "r+"));
    return true;
  } catch (_) {
    return false;
  }
}

function sameFile(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch (_) {
    return false;
  }
}

// Read one entry out of the asar.  The header is Electron's pickle: a 4-byte marker,
// then the byte length of the raw header JSON at offset 12; that JSON is padded to a
// 4-byte boundary and every entry offset is relative to its end.
function readAsarEntry(asarPath, rel) {
  const contents = fs.readFileSync(asarPath);
  if (contents.length < 16 || contents.readUInt32LE(0) !== 4) throw new Error("not an asar: " + asarPath);
  const headerBytes = contents.readUInt32LE(12);
  const json = JSON.parse(contents.slice(16, 16 + headerBytes).toString("utf8").replace(/\0+$/, ""));
  let node = json;
  rel.split("/").forEach(function (part) { node = node && node.files && node.files[part]; });
  if (!node || !node.size) return null;
  const start = 16 + Math.ceil(headerBytes / 4) * 4 + Number(node.offset || 0);
  return contents.slice(start, start + node.size);
}

// The live Electron layer is only current when the shipped main.js is byte-identical
// to root main.js - the asar/exe hash pair alone says nothing about which edit is in.
function electronLayerFresh() {
  try {
    const shipped = readAsarEntry(ASAR, "dist-electron/main.js");
    return !!shipped && shipped.equals(fs.readFileSync(path.join(ROOT, "main.js")));
  } catch (_) {
    return false;
  }
}

function integrity(exePath) {
  const result = run(process.execPath, [PATCHER, exePath || EXE, ASAR, "--check"]);
  const text = ((result.stdout || "") + (result.stderr || "")).trim();
  return { inSync: result.status === 0, text: text.split("\n").pop() };
}

// Everything needed to decide, with no writes.
function plan() {
  const drift = ELECTRON_FILES.filter(function (name) {
    return !sameFile(path.join(ROOT, name), path.join(STAGE, "dist-electron", name));
  });
  const status = integrity(EXE);
  const writable = fs.existsSync(EXE) ? writeProbe(EXE) : false;
  const fresh = electronLayerFresh();
  // --copy mode pairs the asar with a sibling EXE; either pair being valid is
  // launchable, but only the primary pair means there is nothing left to do.
  const copyPair = fs.existsSync(COPY_EXE) ? integrity(COPY_EXE) : null;
  const copyInSync = copyPair ? copyPair.inSync : null;
  return {
    drift: drift,
    fresh: fresh,
    inSync: status.inSync,
    copyInSync: copyInSync,
    writable: writable,
    exeMissing: !fs.existsSync(EXE),
    done: !drift.length && fresh && status.inSync,
    usableViaCopy: fresh && copyInSync === true,
    statusText: status.text,
  };
}

function report(current) {
  console.log("staging drift   : " + (current.drift.length ? current.drift.join(", ") + " (root -> stage, will copy)" : "none"));
  console.log("live electron   : " + (current.fresh ? "current (asar already ships root main.js)" : "STALE (asar ships an older main.js)"));
  console.log("live asar vs exe: " + (current.inSync ? "in sync" : "OUT OF SYNC"));
  if (current.copyInSync !== null) {
    console.log("patched copy    : " + (current.copyInSync ? "in sync (launch Socratopia.patched.exe)" : "OUT OF SYNC"));
  }
  console.log("exe writable    : " + (current.writable ? "yes" : "no (locked)"));
}

function finish(argv) {
  const wantCheck = argv.includes("--check");
  const wantCopy = argv.includes("--copy");
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: node tools/finish-asar-repack.js [--check] [--copy]");
    return 0;
  }
  if (!fs.existsSync(ASAR)) throw new Error("missing " + ASAR);
  if (!fs.existsSync(STAGE)) throw new Error("missing " + STAGE + " - run: npx asar extract resources/app.asar _asar_extracted");

  const current = plan();
  report(current);
  if (current.exeMissing) throw new Error("missing " + EXE);

  if (wantCheck) {
    if (current.done) {
      console.log("CHECK: nothing to do");
      return 0;
    }
    if (current.usableViaCopy) {
      // Usable right now, but the primary EXE hash is stale - still worth finishing.
      console.log("CHECK: usable via " + path.basename(COPY_EXE) + "; primary hash stale" +
        (current.writable ? " - rerun without --check to finish" : " - rerun once the EXE unlocks"));
      return 1;
    }
    console.log("CHECK: repack needed" + (current.writable ? "" : " - but the EXE is locked, writes will abort"));
    return 1;
  }

  if (current.done) {
    console.log("");
    console.log("DONE: already current, nothing to repack.");
    return 0;
  }

  // Stage the Electron files, then pack.  Keep the pre-run asar: if the EXE turns out
  // to be locked we must put it back, because only the matching pair launches.
  ELECTRON_FILES.forEach(function (name) {
    fs.copyFileSync(path.join(ROOT, name), path.join(STAGE, "dist-electron", name));
  });
  fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
  fs.copyFileSync(ASAR, BACKUP);
  const pack = run("npx", ["--no-install", "asar", "pack", STAGE, ASAR]);
  if (pack.status !== 0) throw new Error("asar pack failed:\n" + (pack.stdout || "") + (pack.stderr || ""));

  const patch = run(process.execPath, [PATCHER]);
  if (patch.status === 0) {
    if (fs.existsSync(COPY_EXE)) {
      try {
        fs.unlinkSync(COPY_EXE);
        console.log("removed the now-redundant Socratopia.patched.exe");
      } catch (_) { /* the copy may still be the running app */ }
    }
    console.log("");
    console.log("DONE: " + integrity().text);
    console.log("Restart the app (./Socratopia.exe) for the Electron change to take effect.");
    return 0;
  }
  const patchText = (patch.stdout || "") + (patch.stderr || "");
  if (!/EBUSY/.test(patchText)) throw new Error("patch-asar-integrity failed:\n" + patchText);

  if (!wantCopy) {
    fs.copyFileSync(BACKUP, ASAR);
    console.log("");
    console.log("BLOCKED: Socratopia.exe is locked (open r+ -> EBUSY) and no Socratopia.exe process exists.");
    console.log("The live asar is the pre-run one again, so ./Socratopia.exe still launches.");
    console.log("A reboot (or restarting whatever holds the handle) frees it - then rerun this tool.");
    console.log("Or run with --copy to keep the new asar and launch Socratopia.patched.exe instead.");
    return 2;
  }

  // --copy: keep the new asar and ship a patched sibling EXE.  A copy that is itself
  // running cannot be overwritten, so unlink first and report that case clearly.
  try {
    fs.unlinkSync(COPY_EXE);
  } catch (_) { /* absent, or locked */ }
  try {
    fs.copyFileSync(EXE, COPY_EXE);
  } catch (error) {
    throw new Error("cannot refresh " + COPY_EXE + " (" + error.code + ") - close the app that runs it first");
  }
  const copyPatch = run(process.execPath, [PATCHER, COPY_EXE, ASAR]);
  if (copyPatch.status !== 0) throw new Error("could not patch " + COPY_EXE + ":\n" + (copyPatch.stdout || "") + (copyPatch.stderr || ""));
  console.log("");
  console.log("DONE (copy mode): the new asar is live, paired with " + path.basename(COPY_EXE));
  console.log("Launch ./Socratopia.patched.exe - and rerun without --copy once the original unlocks.");
  return 0;
}

function main(argv) {
  try {
    return finish(argv || []);
  } catch (error) {
    console.error("FAIL: " + (error && error.message ? error.message : error));
    return 1;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { main, plan, electronLayerFresh, readAsarEntry, sameFile, writeProbe, ELECTRON_FILES };
