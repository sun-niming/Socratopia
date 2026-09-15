/** Read-only PDF page extraction and conditional rasterization worker. */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import PdfJsPaths from "../pdfjs-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [,, filePath, startArg, endArg, queryArg, allowVisionArg] = process.argv;

function resolveDep(subpath) {
  const prod = path.join(__dirname, "..", "..", ".next", "node_modules", subpath);
  if (existsSync(prod)) return pathToFileURL(prod).href;
  const dev = path.join(__dirname, "..", "..", "..", "node_modules", subpath);
  if (existsSync(dev)) return pathToFileURL(dev).href;
  for (const root of (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(root, subpath);
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error("dependency not found: " + subpath);
}

function resolveDepDir(subpath) {
  return PdfJsPaths.resourceDir(fileURLToPath(resolveDep(subpath)));
}

function normalizeSearch(value) {
  return String(value || "").toLocaleLowerCase()
    .replace(/([\p{L}\p{N}_])-\s*\n\s*([\p{L}\p{N}_])/gu, "$1$2")
    .replace(/\s+/g, "");
}

function abnormalRatio(text) {
  const bad = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD\uE000-\uF8FF]/g) || []).length;
  return bad / Math.max(1, Array.from(text).length);
}

async function main() {
  if (!filePath || !existsSync(filePath)) throw new Error("PDF file not found");
  const canvas = await import(resolveDep("@napi-rs/canvas/index.js"));
  globalThis.DOMMatrix ??= canvas.DOMMatrix;
  globalThis.ImageData ??= canvas.ImageData;
  globalThis.Path2D ??= canvas.Path2D;
  const pdfjs = await import(resolveDep("pdfjs-dist/legacy/build/pdf.mjs"));
  pdfjs.GlobalWorkerOptions.workerSrc = resolveDep("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const data = readFileSync(filePath);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    useSystemFonts: true,
    disableAutoFetch: true,
    disableStream: true,
    cMapUrl: resolveDepDir("pdfjs-dist/cmaps"),
    cMapPacked: true,
    standardFontDataUrl: resolveDepDir("pdfjs-dist/standard_fonts"),
    wasmUrl: resolveDepDir("pdfjs-dist/wasm"),
  }).promise;
  const startPage = Math.max(1, Number(startArg) || 1);
  const endPage = Math.min(doc.numPages, Math.max(startPage, Number(endArg) || startPage));
  if (startPage > doc.numPages) throw new Error("PAGE_OUT_OF_RANGE:" + doc.numPages);
  const query = normalizeSearch(queryArg);
  const allowVision = allowVisionArg !== "0";
  const pages = [];
  const numPages = doc.numPages;
  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const lines = [];
    let lastY = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) lines.push("\n");
      lines.push(item.str);
      lastY = y;
    }
    const rawText = lines.join("").trim();
    let visualContentExpected = false;
    try {
      const ops = await page.getOperatorList();
      const visualOps = new Set([
        pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
        pdfjs.OPS.paintJpegXObject, pdfjs.OPS.paintImageMaskXObject,
        pdfjs.OPS.constructPath, pdfjs.OPS.fill, pdfjs.OPS.stroke, pdfjs.OPS.fillStroke,
      ]);
      visualContentExpected = ops.fnArray.some((fn) => visualOps.has(fn));
    } catch (_) { visualContentExpected = true; }
    const meaningful = rawText.replace(/\s/g, "").length;
    const queryFound = !!query && normalizeSearch(rawText).includes(query);
    const poor = meaningful < 80 || abnormalRatio(rawText) > 0.01;
    const needsVision = allowVision && (poor || (!!query && !queryFound && visualContentExpected));
    let pngB64 = null;
    if (needsVision && visualContentExpected) {
      const viewport = page.getViewport({ scale: 150 / 72 });
      const target = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = target.getContext("2d");
      const factory = {
        create(w, h) { const c = canvas.createCanvas(w, h); return { canvas: c, context: c.getContext("2d") }; },
        reset(holder, w, h) { holder.canvas.width = w; holder.canvas.height = h; },
        destroy(holder) { holder.canvas.width = 0; holder.canvas.height = 0; },
      };
      await page.render({ canvasContext: context, viewport, canvasFactory: factory }).promise;
      pngB64 = target.toBuffer("image/png").toString("base64");
    }
    pages.push({ page: pageNum, rawText, visualContentExpected, queryFoundInTextLayer: queryFound, needsVision, pngB64 });
  }
  await doc.destroy();
  process.stdout.write(JSON.stringify({ numPages, pages }));
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ error: error.message || String(error) }));
  process.exit(1);
});
