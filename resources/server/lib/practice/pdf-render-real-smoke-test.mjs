import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import PdfJsPaths from "../pdfjs-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: node pdf-render-real-smoke-test.mjs <real-pdf-path>");
  process.exit(2);
}
const pdfjsRoot = path.join(__dirname, "..", "..", ".next", "node_modules", "pdfjs-dist");
const canvasRoot = path.join(__dirname, "..", "..", ".next", "node_modules", "@napi-rs", "canvas");
const canvas = await import(pathToFileURL(path.join(canvasRoot, "index.js")).href);
globalThis.DOMMatrix ??= canvas.DOMMatrix;
globalThis.ImageData ??= canvas.ImageData;
globalThis.Path2D ??= canvas.Path2D;
const pdfjs = await import(pathToFileURL(path.join(pdfjsRoot, "legacy", "build", "pdf.mjs")).href);
const data = new Uint8Array(await fs.readFile(pdfPath));
const doc = await pdfjs.getDocument({
  data,
  disableWorker: true,
  useSystemFonts: true,
  cMapUrl: PdfJsPaths.resourceDir(path.join(pdfjsRoot, "cmaps")),
  cMapPacked: true,
  standardFontDataUrl: PdfJsPaths.resourceDir(path.join(pdfjsRoot, "standard_fonts")),
  wasmUrl: PdfJsPaths.resourceDir(path.join(pdfjsRoot, "wasm")),
}).promise;
const page = await doc.getPage(2);
const viewport = page.getViewport({ scale: 1.5 });
const surface = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
await page.render({ canvasContext: surface.getContext("2d"), viewport }).promise;
const png = surface.toBuffer("image/png");
if (png.length < 20000) throw new Error("rendered page is unexpectedly small/blank: " + png.length + " bytes");
console.log("real PDF render smoke: PASS page=2 pngBytes=" + png.length);
