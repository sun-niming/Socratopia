import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import KBQuality from "../kb-quality.js";
import PdfJsPaths from "../pdfjs-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfjsRoot = path.join(__dirname, "..", "..", ".next", "node_modules", "pdfjs-dist");
const pdfjsPath = path.join(pdfjsRoot, "legacy", "build", "pdf.mjs");
const canvasRoot = path.join(__dirname, "..", "..", ".next", "node_modules", "@napi-rs", "canvas");

async function renderPage(page, canvas) {
  const viewport = page.getViewport({ scale: 150 / 72 });
  const surface = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: surface.getContext("2d"), viewport }).promise;
  return surface.toBuffer("image/png");
}

function cleanOcrText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, "$1")
    .replace(/ *\n */g, "\n")
    .trim();
}

async function recognizeRenderedPages(manifest, tempDir, expectedCjk) {
  if (process.platform !== "win32" || !manifest.length) return { results: {}, unavailable: "windows_ocr_unavailable" };
  const script = path.join(__dirname, "windows-ocr.ps1");
  try { await fs.access(script); } catch { return { results: {}, unavailable: "windows_ocr_script_missing" }; }
  try {
    const manifestPath = path.join(tempDir, "manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const run = spawnSync(powershell, [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", script, manifestPath, expectedCjk ? "zh-Hans-CN" : "en-US",
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120000, windowsHide: true });
    if (run.status !== 0 || !String(run.stdout || "").trim()) {
      return { results: {}, unavailable: String(run.stderr || "windows_ocr_failed").trim().slice(0, 500) };
    }
    const parsed = JSON.parse(String(run.stdout).replace(/^\uFEFF/, "").trim());
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const results = {};
    list.forEach((item) => { if (item && item.page != null) results[String(item.page)] = item; });
    return { results };
  } catch (error) {
    return { results: {}, unavailable: error && error.message ? error.message : String(error) };
  }
}

function cleanText(items) {
  return (items || [])
    .map((item) => (item && typeof item.str === "string" ? item.str : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const pdfPath = process.argv[2];
  const pagesRaw = process.argv[3] || "[]";
  const expectedCjk = String(process.argv[4] || "").toLowerCase() === "true";
  if (!pdfPath) throw new Error("missing pdf path");
  const pages = JSON.parse(pagesRaw)
    .map((n) => parseInt(n, 10))
    .filter((n, i, arr) => Number.isFinite(n) && n >= 1 && arr.indexOf(n) === i)
    .slice(0, 80);

  const canvas = await import(pathToFileURL(path.join(canvasRoot, "index.js")).href);
  globalThis.DOMMatrix ??= canvas.DOMMatrix;
  globalThis.ImageData ??= canvas.ImageData;
  globalThis.Path2D ??= canvas.Path2D;
  const pdfjs = await import(pathToFileUrl(pdfjsPath));
  const data = new Uint8Array(await fs.readFile(pdfPath));
  let doc;
  let tempDir;
  try {
    doc = await pdfjs.getDocument({
      data,
      disableWorker: true,
      useSystemFonts: true,
      cMapUrl: PdfJsPaths.resourceDir(path.join(pdfjsRoot, "cmaps")),
      cMapPacked: true,
      standardFontDataUrl: PdfJsPaths.resourceDir(path.join(pdfjsRoot, "standard_fonts")),
      wasmUrl: PdfJsPaths.resourceDir(path.join(pdfjsRoot, "wasm")),
    }).promise;

    const pageCount = doc.numPages;
    const out = {};
    const diagnostics = {};
    const manifest = [];
    for (const pageNo of pages) {
      if (pageNo < 1 || pageNo > pageCount) continue;
      const page = await doc.getPage(pageNo);
      const text = await page.getTextContent({ includeMarkedContent: false });
      const cleaned = cleanText(text.items);
      const quality = KBQuality.assessPdfText(cleaned, { expectedCjk });
      const usablePdfText = !!cleaned && !quality.garbled;
      if (usablePdfText) out[String(pageNo)] = cleaned;
      if (quality.renderRecommended && !usablePdfText) {
        try {
          if (!tempDir) {
            tempDir = process.env.SOCRATOPIA_OCR_JOB_DIR || await fs.mkdtemp(path.join(os.tmpdir(), "socratopia-ocr-"));
            await fs.mkdir(tempDir, { recursive: true });
          }
          const png = await renderPage(page, canvas);
          const imagePath = path.join(tempDir, "page-" + String(pageNo) + ".png");
          await fs.writeFile(imagePath, png);
          quality.rendered = true;
          quality.renderBytes = png.length;
          manifest.push({ page: pageNo, path: imagePath });
        } catch (error) {
          quality.rendered = false;
          quality.renderError = error && error.message ? error.message : String(error);
        }
      } else if (quality.renderRecommended) {
        quality.ocr = { attempted: false, accepted: false, reason: "usable_pdf_text" };
      }
      diagnostics[String(pageNo)] = quality;
    }
    const ocr = await recognizeRenderedPages(manifest, tempDir, expectedCjk);
    manifest.forEach((rendered) => {
      const key = String(rendered.page);
      const item = ocr.results[key];
      const text = cleanOcrText(item && item.text);
      const ocrQuality = KBQuality.assessPdfText(text, { expectedCjk });
      const enoughOcrText = ocrQuality.length >= 8 || (expectedCjk && ocrQuality.cjk >= 4);
      const useOcr = enoughOcrText && !ocrQuality.garbled && !out[key];
      diagnostics[key].ocr = {
        attempted: true,
        language: item && item.language || (expectedCjk ? "zh-Hans-CN" : "en-US"),
        chars: ocrQuality.length,
        cjk: ocrQuality.cjk,
        accepted: useOcr,
        error: item && item.error || ocr.unavailable || null,
      };
      if (useOcr) out[key] = text;
    });
    console.log(JSON.stringify({ pageCount, pages: out, diagnostics }));
  } finally {
    if (doc) await doc.destroy().catch(() => {});
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function pathToFileUrl(p) {
  return "file:///" + path.resolve(p).replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1:");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
