/**
 * Standalone PDF extraction worker using pdfjs-dist legacy build.
 * Runs as a child process to bypass Next.js/Turbopack bundler issues.
 *
 * Usage: node pdf-worker.mjs <command> <filepath> [args...]
 * Commands:
 *   meta <filepath>                    — get metadata (JSON)
 *   extract <filepath> <start> <end>   — extract text from page range (JSON)
 *   scan <filepath>                    — detect scanned PDF (JSON)
 *   render <filepath> <start> <end> [scale] — render pages as PNG base64 (JSON)
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";

// Resolve __dirname for this ESM file
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find pdfjs-dist main entry by absolute file URL. ESM ignores NODE_PATH for
 * module resolution, so we resolve by hand.
 *
 * Today there are exactly two real runtime layouts. Earlier versions of this
 * function also probed `__dirname/../deps/pdfjs-dist` and `__dirname/../node_modules/pdfjs-dist`
 * — both were 1.0.2-era artifacts and have been dead in every shipped layout
 * since 1.0.3. Removing them eliminates the "we have backups" safety theater
 * that masked the real bug in 1.0.5 (NODE_PATH stale) — when only one path
 * actually works, anything that breaks it breaks loudly, not silently.
 *
 *   1. PACKAGED (Mac + Win, identical placement):
 *      Worker:    <serverDir>/lib/pdf-worker.mjs
 *      pdfjs:     <serverDir>/.next/node_modules/pdfjs-dist
 *      (Mac: prepare-build.sh moves deps/ → .next/node_modules at build time.
 *       Win: electron/main.ts ensureNodeModules() extracts deps.zip into the
 *       same path at runtime — see getServerNodeModulesPath().)
 *      Resolved by PRIMARY check below.
 *
 *   2. DEV (`npm run dev` / `electron:dev`):
 *      Worker:    v2/src/lib/pdf-worker.mjs
 *      pdfjs:     v2/node_modules/pdfjs-dist
 *      Resolved by DEV check below.
 *
 * NODE_PATH loop kept as belt-and-suspenders only — it must never be the
 * sole path that works, because that's exactly the failure shape from 1.0.5
 * (silent reliance on NODE_PATH set elsewhere → "still works" until something
 * trivially strips that env var).
 */
function findDependencyPath(subpath) {
  // PRIMARY: packaged production placement (both Mac and Win).
  const productionPath = path.join(__dirname, "..", ".next", "node_modules", subpath);
  if (existsSync(productionPath)) return pathToFileURL(productionPath).href;

  // DEV: pdf-worker.mjs runs from its source location.
  const devPath = path.join(__dirname, "..", "..", "node_modules", subpath);
  if (existsSync(devPath)) return pathToFileURL(devPath).href;

  // Belt-and-suspenders — anomalous deployments where someone placed
  // pdfjs-dist elsewhere AND set NODE_PATH to point at it. Not load-bearing
  // in any known scenario, just a last-resort net.
  for (const root of (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean)) {
    const fallbackPath = path.join(root, subpath);
    if (existsSync(fallbackPath)) return pathToFileURL(fallbackPath).href;
  }

  throw new Error(
    `pdfjs-dist not found. Tried:\n  ${productionPath}\n  ${devPath}\n  (+ NODE_PATH roots: ${process.env.NODE_PATH || "(none)"})`
  );
}

function findPdfjsPath(subpath) {
  return findDependencyPath(path.join("pdfjs-dist", subpath));
}

function pdfjsResourcePath(directory) {
  const fsPath = fileURLToPath(findPdfjsPath(directory)).replace(/\\/g, "/");
  return fsPath.endsWith("/") ? fsPath : fsPath + "/";
}

const [,, command, filePath, ...args] = process.argv;
let canvasModule = null;
if (command === "render") {
  canvasModule = await import(findDependencyPath(path.join("@napi-rs", "canvas", "index.js")));
}

// Polyfill DOM globals required by pdfjs-dist at module load time.
// We only use text extraction (getTextContent), not rendering, so stubs suffice.
if (canvasModule) {
  globalThis.DOMMatrix = canvasModule.DOMMatrix;
  globalThis.ImageData = canvasModule.ImageData;
  globalThis.Path2D = canvasModule.Path2D;
} else if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      const v = init && Array.isArray(init) ? init : [1, 0, 0, 1, 0, 0];
      this.a = v[0]; this.b = v[1]; this.c = v[2];
      this.d = v[3]; this.e = v[4]; this.f = v[5];
      this.is2D = true;
      this.isIdentity = v[0]===1&&v[1]===0&&v[2]===0&&v[3]===1&&v[4]===0&&v[5]===0;
    }
    scale() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    multiply() { return new DOMMatrix(); }
    inverse() { return new DOMMatrix(); }
    transformPoint(p) { return p || { x: 0, y: 0, z: 0, w: 1 }; }
    static fromMatrix() { return new DOMMatrix(); }
    static fromFloat64Array(a) { return new DOMMatrix(a ? Array.from(a) : undefined); }
    static fromFloat32Array(a) { return new DOMMatrix(a ? Array.from(a) : undefined); }
  };
}
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(w, h) { this.width = w || 0; this.height = h || 0; this.data = new Uint8ClampedArray(0); }
  };
}
if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D { constructor() {} };
}

const { getDocument, GlobalWorkerOptions } = await import(
  findPdfjsPath("legacy/build/pdf.mjs")
);
GlobalWorkerOptions.workerSrc = findPdfjsPath("legacy/build/pdf.worker.mjs");

async function loadDoc() {
  const data = readFileSync(filePath);
  return getDocument({
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    cMapUrl: pdfjsResourcePath("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: pdfjsResourcePath("standard_fonts"),
    wasmUrl: pdfjsResourcePath("wasm"),
    iccUrl: pdfjsResourcePath("iccs"),
    useSystemFonts: true,
    disableAutoFetch: true,
    disableStream: true,
  }).promise;
}

/**
 * Extract text from a single page.
 * Groups items by Y position to preserve line breaks.
 */
async function extractPageText(doc, pageNum) {
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
  return lines.join("").trim();
}

function canvasFactory() {
  const { createCanvas } = canvasModule;
  return {
    create(w, h) { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext("2d") }; },
    reset(holder, w, h) { holder.canvas.width = w; holder.canvas.height = h; },
    destroy(holder) { holder.canvas.width = 0; holder.canvas.height = 0; },
  };
}

async function renderPage(doc, pageNum, scale) {
  if (!canvasModule) throw new Error("@napi-rs/canvas is required for PDF rendering");
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport, canvasFactory: canvasFactory() }).promise;
  return canvas.toBuffer("image/png").toString("base64");
}

async function main() {
  const doc = await loadDoc();
  const numPages = doc.numPages;

  switch (command) {

    case "meta": {
      const info = await doc.getMetadata();
      console.log(JSON.stringify({
        title: info.info?.Title || "",
        author: info.info?.Author || "",
        year: info.info?.CreationDate ? String(info.info.CreationDate).slice(2, 6) : "",
        numPages,
      }));
      break;
    }

    case "extract": {
      // Args: start end
      const start = Math.max(1, parseInt(args[0] || "1", 10));
      const end = Math.min(numPages, parseInt(args[1] || "10", 10));
      const info = await doc.getMetadata();
      const pages = [];
      for (let i = start; i <= end; i++) {
        const text = await extractPageText(doc, i);
        pages.push({ page: i, text });
      }
      console.log(JSON.stringify({
        pages,
        metadata: {
          title: info.info?.Title || "",
          author: info.info?.Author || "",
          year: info.info?.CreationDate ? String(info.info.CreationDate).slice(2, 6) : "",
          numPages,
        },
      }));
      break;
    }

    case "extract_adaptive": {
      // Args: startPage targetChars maxPages
      const startAdapt = Math.max(1, parseInt(args[0] || "1", 10));
      const targetChars = parseInt(args[1] || "15000", 10);
      const maxPagesAdapt = parseInt(args[2] || "30", 10);
      const info = await doc.getMetadata();
      const endLimit = Math.min(numPages, startAdapt + maxPagesAdapt - 1);

      const pages = [];
      let totalChars = 0;
      for (let i = startAdapt; i <= endLimit; i++) {
        const text = await extractPageText(doc, i);
        pages.push({ page: i, text });
        totalChars += text.length;
        if (totalChars >= targetChars) break;
      }

      console.log(JSON.stringify({
        pages,
        totalChars,
        endPage: pages.length > 0 ? pages[pages.length - 1].page : startAdapt - 1,
        metadata: {
          title: info.info?.Title || "",
          author: info.info?.Author || "",
          numPages,
        },
      }));
      break;
    }

    case "toc": {
      let outline = null;
      try { outline = await doc.getOutline(); } catch {}

      if (!outline || outline.length === 0) {
        console.log(JSON.stringify({ entries: [] }));
        break;
      }

      async function flattenItems(items, level) {
        const result = [];
        for (const item of items) {
          let pageNum = null;
          try {
            if (item.dest) {
              let dest = item.dest;
              if (typeof dest === "string") dest = await doc.getDestination(dest);
              if (Array.isArray(dest) && dest[0]) {
                const idx = await doc.getPageIndex(dest[0]);
                pageNum = idx + 1;
              }
            }
          } catch {}
          result.push({ title: item.title || "", page: pageNum, level });
          if (item.items?.length) {
            const children = await flattenItems(item.items, level + 1);
            result.push(...children);
          }
        }
        return result;
      }

      const entries = await flattenItems(outline, 0);
      console.log(JSON.stringify({ entries }));
      break;
    }

    case "scan": {
      // Sample pages from the middle of the PDF to avoid cover/TOC pages.
      // For very short PDFs (1-3 pages), sample all available pages.
      const sampleCount = Math.min(5, numPages);
      const mid = Math.floor(numPages / 2);
      const half = Math.floor(sampleCount / 2);
      const startPage = Math.max(1, mid - half + 1);
      let totalChars = 0;
      for (let i = startPage; i < startPage + sampleCount; i++) {
        const text = await extractPageText(doc, i);
        totalChars += text.length;
      }
      const avgChars = sampleCount > 0 ? Math.round(totalChars / sampleCount) : 0;
      console.log(JSON.stringify({
        isScanned: avgChars < 50,
        avgChars,
        pagesChecked: sampleCount,
      }));
      break;
    }

    case "render": {
      const start = Math.max(1, parseInt(args[0] || "1", 10));
      const end = Math.min(numPages, parseInt(args[1] || String(start), 10));
      const scale = Math.min(3, Math.max(1, Number(args[2]) || 2));
      const pages = [];
      for (let i = start; i <= end; i++) {
        pages.push({ page: i, pngB64: await renderPage(doc, i, scale) });
      }
      console.log(JSON.stringify({ pages, metadata: { numPages }, scale }));
      break;
    }

    default:
      process.stderr.write(JSON.stringify({ error: `Unknown command: ${command}` }));
      process.exit(1);
  }

  await doc.destroy();
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ error: err.message }));
  process.exit(1);
});
