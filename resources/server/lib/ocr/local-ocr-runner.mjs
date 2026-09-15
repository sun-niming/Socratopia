import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import quality from "./ocr-quality.js";
import { runRapidOcr } from "./rapidocr-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 6;

function codedError(code, detail) {
  const error = new Error(code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || !!relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

function minimalEnvironment(tempDir) {
  const env = {};
  for (const name of ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  env.TEMP = tempDir;
  env.TMP = tempDir;
  return env;
}

export async function runWindowsOcr(options = {}) {
  if (process.platform !== "win32") throw codedError("windows_ocr_unavailable");
  const tempDir = path.resolve(String(options.tempDir || ""));
  const items = Array.isArray(options.items) ? options.items : [];
  if (!tempDir || !items.length) throw codedError("ocr_manifest_empty");
  if (items.length > MAX_ITEMS) throw codedError("ocr_manifest_invalid");
  const language = String(options.language || "zh-Hans-CN");
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(language)) throw codedError("ocr_language_invalid");
  const rootStat = await fs.lstat(tempDir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw codedError("ocr_temp_invalid");
  const manifest = [];
  for (const item of items) {
    const page = Number(item && item.page);
    const imagePath = path.resolve(String(item && item.path || ""));
    if (!Number.isInteger(page) || page < 1 || !contained(tempDir, imagePath)) throw codedError("ocr_manifest_invalid");
    const stat = await fs.lstat(imagePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 12 * 1024 * 1024) throw codedError("ocr_image_invalid");
    manifest.push({ page, path: imagePath });
  }
  const manifestPath = path.join(tempDir, "manifest-" + process.pid + ".json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest), { encoding: "utf8", flag: "wx", mode: 0o600 });
  const script = path.join(__dirname, "..", "practice", "windows-ocr.ps1");
  await fs.access(script);
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const timeoutMs = Math.min(180000, Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(powershell, [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", script, manifestPath, language,
      ], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: minimalEnvironment(tempDir),
      });
      const stdout = [];
      const stderr = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch {}
        reject(codedError("ocr_timeout"));
      }, timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            try { child.kill(); } catch {}
            reject(codedError("ocr_output_limit"));
          }
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= 256 * 1024) stderr.push(chunk);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(codedError("windows_ocr_failed", error && error.code));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const out = Buffer.concat(stdout).toString("utf8").replace(/^\uFEFF/, "").trim();
        const err = Buffer.concat(stderr).toString("utf8").replace(/^\uFEFF/, "").trim();
        if (code !== 0) {
          const match = /ocr_language_unavailable:[^\s\r\n]+/.exec(err);
          return reject(codedError(match ? "ocr_language_unavailable" : "windows_ocr_failed"));
        }
        try {
          const parsed = JSON.parse(out || "[]");
          const list = Array.isArray(parsed) ? parsed : [parsed];
          resolve({ pages: list.map((item) => ({
            page: Number(item && item.page),
            text: String(item && item.text || ""),
            language: String(item && item.language || language),
            error: item && item.error ? "windows_ocr_page_failed" : null,
          })) });
        } catch {
          reject(codedError("ocr_invalid_json"));
        }
      });
    });
  } finally {
    await fs.rm(manifestPath, { force: true }).catch(() => {});
  }
}

const WINDOWS_FALLBACK_ERRORS = new Set([
  "ocr_language_unavailable",
  "windows_ocr_failed",
  "ocr_timeout",
  "ocr_output_limit",
  "ocr_invalid_json",
]);

const RAPID_FALLBACK_ERRORS = new Set([
  "rapidocr_integrity_failed",
  "rapidocr_timeout",
  "rapidocr_output_limit",
  "rapidocr_error_limit",
  "rapidocr_unavailable",
  "rapidocr_failed",
]);

function normalizedEngine(value) {
  return value === "rapidocr-v5" ? "rapidocr-v5" : "windows-ocr";
}

export async function runLocalOcr(options = {}) {
  if (process.platform !== "win32") throw codedError("windows_ocr_unavailable");
  const items = Array.isArray(options.items) ? options.items : [];
  if (!items.length) throw codedError("ocr_manifest_empty");
  if (items.length > MAX_ITEMS) throw codedError("ocr_manifest_invalid");
  const language = String(options.language || "zh-Hans-CN");
  const expectedCjk = /^zh(?:-|$)/i.test(language);
  const timeoutMs = Math.min(180000, Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));
  const deadline = Date.now() + timeoutMs;
  const windowsRunner = options.windowsRunner || runWindowsOcr;
  const rapidRunner = options.rapidRunner || runRapidOcr;
  const fallbackReserveMs = timeoutMs >= 4000
    ? Math.min(30000, Math.max(1000, Math.floor(timeoutMs * 0.25)))
    : 0;
  const rapidTimeoutMs = Math.max(1000, timeoutMs - fallbackReserveMs);
  let rapidResult = null;
  let rapidFailure = null;
  try {
    rapidResult = await rapidRunner({
      tempDir: options.tempDir,
      items,
      timeoutMs: rapidTimeoutMs,
    });
  } catch (error) {
    if (!RAPID_FALLBACK_ERRORS.has(error && error.code)) throw error;
    rapidFailure = error;
  }

  const rapidByPage = new Map(((rapidResult && rapidResult.pages) || []).map((item) => [Number(item && item.page), item]));
  const finalByPage = new Map();
  const fallbackItems = [];
  for (const item of items) {
    const page = Number(item && item.page);
    const recognized = rapidByPage.get(page);
    const text = quality.normalize(recognized && recognized.text);
    const assessed = quality.assess(text, { expectedCjk, source: "rapidocr-v5" });
    const confidence = Number.isFinite(Number(recognized && recognized.confidence)) ? Math.max(0, Math.min(1, Number(recognized.confidence))) : 0;
    const confidenceUsable = confidence >= 0.55;
    const error = rapidFailure && rapidFailure.code || recognized && recognized.error || (!confidenceUsable ? "rapidocr_low_confidence" : assessed.usable ? null : assessed.reason || "rapidocr_failed");
    finalByPage.set(page, {
      page,
      text,
      language,
      confidence,
      engine: normalizedEngine(recognized && recognized.engine),
      error,
    });
    if (error) fallbackItems.push(item);
  }

  if (fallbackItems.length) {
    const remainingMs = deadline - Date.now();
    if (remainingMs >= 1000) {
      try {
        const windowsResult = await windowsRunner({
          tempDir: options.tempDir,
          items: fallbackItems,
          language,
          timeoutMs: Math.max(1000, remainingMs),
        });
        const windowsByPage = new Map(((windowsResult && windowsResult.pages) || []).map((item) => [Number(item && item.page), item]));
        fallbackItems.forEach((item) => {
          const page = Number(item.page);
          const recognized = windowsByPage.get(page);
          const text = quality.normalize(recognized && recognized.text);
          const assessed = quality.assess(text, { expectedCjk, source: "windows-ocr" });
          if (!recognized || recognized.error || !assessed.usable || assessed.visible < 12) return;
          finalByPage.set(page, {
            page,
            text,
            language: String(recognized.language || language),
            confidence: Number.isFinite(Number(recognized.confidence)) ? Math.max(0, Math.min(1, Number(recognized.confidence))) : null,
            engine: "windows-ocr",
            error: null,
          });
        });
      } catch (error) {
        if (!WINDOWS_FALLBACK_ERRORS.has(error && error.code)) throw error;
      }
    }
  }

  return { pages: items.map((item) => finalByPage.get(Number(item.page))) };
}

export const limits = Object.freeze({ maxItems: MAX_ITEMS, maxOutputBytes: MAX_OUTPUT_BYTES });
