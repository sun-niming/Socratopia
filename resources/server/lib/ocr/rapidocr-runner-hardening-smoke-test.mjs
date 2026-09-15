import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createEngineIntegrityVerifier, runRapidOcr, verifyEngineIntegrity } from "./rapidocr-runner.mjs";

if (process.platform === "win32") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "socratopia-rapidocr-hardening-"));
  try {
    const image = path.join(root, "page-1.png");
    await fs.writeFile(image, "image");
    const item = { tempDir: root, items: [{ page: 1, path: image }] };
    await assert.rejects(
      () => runRapidOcr(Object.assign({}, item, {
        timeoutMs: 1000,
        spawnImpl: function (_executable, _args, options) {
          return spawn(process.execPath, ["-e", "setInterval(function(){},1000)"], options);
        },
      })),
      (error) => error && error.code === "rapidocr_timeout",
    );
    await assert.rejects(
      () => runRapidOcr(Object.assign({}, item, {
        timeoutMs: 10000,
        spawnImpl: function (_executable, _args, options) {
          return spawn(process.execPath, ["-e", "process.stdout.write(Buffer.alloc(9*1024*1024,65));setInterval(function(){},1000)"], options);
        },
      })),
      (error) => error && error.code === "rapidocr_output_limit",
    );

    const integrityRoot = path.join(root, "integrity");
    await fs.mkdir(integrityRoot);
    const fixture = path.join(integrityRoot, "engine.bin");
    await fs.writeFile(fixture, "trusted");
    const hash = crypto.createHash("sha256").update("trusted").digest("hex");
    await verifyEngineIntegrity(integrityRoot, [["engine.bin", 7, hash]]);

    const integrityVerifier = createEngineIntegrityVerifier(integrityRoot, [["engine.bin", 7, hash]]);
    let integritySpawnCalls = 0;
    const successfulSpawn = function (_executable, _args, options) {
      integritySpawnCalls += 1;
      return spawn(process.execPath, ["-e", "process.stdin.once('data',function(){process.stdout.write(JSON.stringify({code:100,data:[{text:'trusted result',score:0.99,box:[[0,0],[1,0],[1,1],[0,1]]}]})+'\\n')});setInterval(function(){},1000)"], options);
    };
    await runRapidOcr(Object.assign({}, item, { integrityVerifier, spawnImpl: successfulSpawn }));
    assert.equal(integritySpawnCalls, 1, "trusted fixture must reach the OCR spawn");

    await fs.writeFile(fixture, "corrupt");
    await assert.rejects(
      () => runRapidOcr(Object.assign({}, item, { integrityVerifier, spawnImpl: successfulSpawn })),
      (error) => error && error.code === "rapidocr_integrity_failed",
      "same-size tampering after a successful verification must be rejected before the next spawn",
    );
    assert.equal(integritySpawnCalls, 1, "tampered fixture must be rejected before spawning OCR");

    let preSpawnChecks = 0;
    let preSpawnCalls = 0;
    await assert.rejects(
      () => runRapidOcr(Object.assign({}, item, {
        integrityVerifier: async function () {
          preSpawnChecks += 1;
          if (preSpawnChecks === 2) throw Object.assign(new Error("rapidocr_integrity_failed"), { code: "rapidocr_integrity_failed" });
        },
        spawnImpl: function () { preSpawnCalls += 1; return successfulSpawn.apply(null, arguments); },
      })),
      (error) => error && error.code === "rapidocr_integrity_failed",
      "an engine mutation detected after image validation must still be rejected before spawn",
    );
    assert.equal(preSpawnChecks, 2, "engine integrity must be checked at request entry and immediately before spawn");
    assert.equal(preSpawnCalls, 0, "failed pre-spawn recheck must prevent child creation");

    await fs.writeFile(fixture, "trusted");
    await integrityVerifier();
    await fs.writeFile(fixture, "corrupt");
    await assert.rejects(
      () => verifyEngineIntegrity(integrityRoot, [["engine.bin", 7, hash]]),
      (error) => error && error.code === "rapidocr_integrity_failed",
    );
    await fs.writeFile(fixture, "trusted");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
console.log("RapidOCR hardening smoke: PASS");
