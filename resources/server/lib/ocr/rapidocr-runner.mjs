import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.join(__dirname, "rapidocr-v5");
const ENGINE_FILES = Object.freeze([
  ["RapidOcrOnnx.exe", 18847744, "115e34764b0ef9660e75c4c8b0b3ee70d92acbfaa652798f640783d7cfc0f8e6"],
  ["models/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx", 1018508, "54379ae5174d026780215fc748a7f31910dee36818e63d49e17dc598ecc82df7"],
  ["models/ch_PP-OCRv5_det_mobile.onnx", 4819576, "4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae"],
  ["models/ch_PP-OCRv5_rec_mobile.onnx", 16631306, "5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5"],
  ["models/ppocrv5_dict.txt", 92393, "53685c8981fdc5233ad64a62b00f6c05a061da55ccc60bff92ba0dc482f735a6"],
  ["models/ppocr_keys_v1.txt", 32871, "d917d7489d2c20d2e4cee8c17068f8ac54f6ee406a04bf5ac3b1ff5dc38e1e52"],
]);
const MAX_ITEMS = 6;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || !!relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function verifyEngineIntegrity(root = ENGINE_ROOT, files = ENGINE_FILES) {
  for (const [relative, expectedBytes, expectedHash] of files) {
    const file = path.join(root, ...relative.split("/"));
    let stat;
    try { stat = await fsPromises.lstat(file); } catch { throw codedError("rapidocr_integrity_failed"); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expectedBytes) throw codedError("rapidocr_integrity_failed");
    if (await hashFile(file) !== expectedHash) throw codedError("rapidocr_integrity_failed");
  }
  return true;
}

async function engineStatFingerprint(root, files) {
  const fingerprint = [];
  for (const [relative, expectedBytes] of files) {
    const file = path.join(root, ...relative.split("/"));
    let stat;
    try { stat = await fsPromises.lstat(file, { bigint: true }); } catch { throw codedError("rapidocr_integrity_failed"); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== BigInt(expectedBytes)) throw codedError("rapidocr_integrity_failed");
    fingerprint.push([
      relative,
      stat.dev.toString(),
      stat.ino.toString(),
      stat.size.toString(),
      stat.mtimeNs.toString(),
      stat.ctimeNs.toString(),
    ]);
  }
  return JSON.stringify(fingerprint);
}

export function createEngineIntegrityVerifier(root = ENGINE_ROOT, files = ENGINE_FILES) {
  let verifiedFingerprint = null;
  let pendingVerification = null;
  async function verifyCachedEngineIntegrity() {
    const before = await engineStatFingerprint(root, files);
    if (before === verifiedFingerprint) return true;
    if (pendingVerification) {
      await pendingVerification;
      return verifyCachedEngineIntegrity();
    }
    pendingVerification = (async () => {
      await verifyEngineIntegrity(root, files);
      const after = await engineStatFingerprint(root, files);
      if (after !== before) throw codedError("rapidocr_integrity_failed");
      verifiedFingerprint = after;
      return true;
    })();
    try {
      return await pendingVerification;
    } catch (error) {
      verifiedFingerprint = null;
      throw error;
    } finally {
      pendingVerification = null;
    }
  }
  return verifyCachedEngineIntegrity;
}

const verifyIntegrity = createEngineIntegrityVerifier();

function minimalEnvironment(tempDir) {
  const env = {};
  for (const name of ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  env.TEMP = tempDir;
  env.TMP = tempDir;
  return env;
}

function linePosition(item) {
  const points = Array.isArray(item && item.box) ? item.box : [];
  const xs = points.map((point) => Number(point && point[0]) || 0);
  const ys = points.map((point) => Number(point && point[1]) || 0);
  return { y: ys.length ? Math.min(...ys) : 0, x: xs.length ? Math.min(...xs) : 0 };
}

function pageResult(page, response) {
  if (!response || response.code !== 100 || !Array.isArray(response.data)) {
    return { page, text: "", confidence: 0, engine: "rapidocr-v5", error: response && response.code === 101 ? "rapidocr_empty" : "rapidocr_failed" };
  }
  const lines = response.data.filter((item) => item && typeof item.text === "string" && item.text.trim()).sort((left, right) => {
    const a = linePosition(left);
    const b = linePosition(right);
    return Math.abs(a.y - b.y) > 10 ? a.y - b.y : a.x - b.x;
  });
  const scores = lines.map((item) => Number(item.score)).filter(Number.isFinite);
  const confidence = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  return {
    page,
    text: lines.map((item) => item.text.trim()).join("\n"),
    confidence,
    minimumConfidence: scores.length ? Math.min(...scores) : 0,
    engine: "rapidocr-v5",
    error: lines.length ? null : "rapidocr_empty",
  };
}

export async function runRapidOcr(options = {}) {
  if (process.platform !== "win32") throw codedError("rapidocr_unavailable");
  const integrityVerifier = typeof options.integrityVerifier === "function" ? options.integrityVerifier : verifyIntegrity;
  await integrityVerifier();
  const tempDir = path.resolve(String(options.tempDir || ""));
  const rootStat = await fsPromises.lstat(tempDir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw codedError("rapidocr_temp_invalid");
  const sourceItems = Array.isArray(options.items) ? options.items : [];
  if (!sourceItems.length || sourceItems.length > MAX_ITEMS) throw codedError("rapidocr_manifest_invalid");
  const items = [];
  for (const item of sourceItems) {
    const page = Number(item && item.page);
    const imagePath = path.resolve(String(item && item.path || ""));
    if (!Number.isInteger(page) || page < 1 || !contained(tempDir, imagePath)) throw codedError("rapidocr_manifest_invalid");
    const stat = await fsPromises.lstat(imagePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) throw codedError("rapidocr_image_invalid");
    items.push({ page, path: imagePath });
  }
  // Image validation performs asynchronous filesystem work. Re-check the
  // engine immediately before constructing the child so mutations in that
  // interval cannot reuse the earlier trusted fingerprint.
  await integrityVerifier();
  const executable = path.join(ENGINE_ROOT, "RapidOcrOnnx.exe");
  const models = path.join(ENGINE_ROOT, "models");
  const timeoutMs = Math.min(120000, Math.max(1000, Number(options.timeoutMs) || 60000));
  return new Promise((resolve, reject) => {
    const spawnImpl = typeof options.spawnImpl === "function" ? options.spawnImpl : spawn;
    const child = spawnImpl(executable, [
      "--models=" + models,
      "--numThread=2",
      "--maxSideLen=2400",
      "--doAngle=1",
      "--mostAngle=1",
      "--ensureAscii=0",
      "--ensureLogger=0",
    ], {
      cwd: ENGINE_ROOT,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: minimalEnvironment(tempDir),
    });
    let transportClosed = false;
    let completed = false;
    let terminalError = null;
    let outputBytes = 0;
    let errorBytes = 0;
    const results = [];
    function stop(error) {
      if (transportClosed || terminalError || completed) return;
      if (error) terminalError = error;
      else completed = true;
      try { child.kill(); } catch {}
    }
    const timer = setTimeout(() => {
      stop(codedError("rapidocr_timeout"));
    }, timeoutMs);
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) stop(codedError("rapidocr_output_limit"));
    });
    lines.on("line", (line) => {
      if (terminalError || completed) return;
      let parsed;
      try { parsed = JSON.parse(line); } catch { return; }
      if (!parsed || !Number.isInteger(parsed.code) || results.length >= items.length) return;
      results.push(pageResult(items[results.length].page, parsed));
      if (results.length === items.length) stop(null);
    });
    child.stderr.on("data", (chunk) => {
      errorBytes += chunk.length;
      if (errorBytes > 256 * 1024) stop(codedError("rapidocr_error_limit"));
    });
    child.on("error", () => {
      if (!terminalError && !completed) terminalError = codedError("rapidocr_unavailable");
    });
    child.on("close", (code) => {
      if (transportClosed) return;
      transportClosed = true;
      clearTimeout(timer);
      lines.close();
      if (terminalError) return reject(terminalError);
      if (errorBytes > 256 * 1024) return reject(codedError("rapidocr_error_limit"));
      if (!completed || results.length !== items.length) return reject(codedError("rapidocr_failed"));
      resolve({ pages: results });
    });
    for (const item of items) child.stdin.write(JSON.stringify({ image_path: item.path }) + "\n");
  });
}

export const limits = Object.freeze({ maxItems: MAX_ITEMS, maxImageBytes: MAX_IMAGE_BYTES, maxOutputBytes: MAX_OUTPUT_BYTES });
export const engineFiles = ENGINE_FILES;
