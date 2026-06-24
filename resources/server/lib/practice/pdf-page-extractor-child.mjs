import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfjsPath = path.join(__dirname, "..", "..", ".next", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs");

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
  if (!pdfPath) throw new Error("missing pdf path");
  const pages = JSON.parse(pagesRaw)
    .map((n) => parseInt(n, 10))
    .filter((n, i, arr) => Number.isFinite(n) && n >= 1 && arr.indexOf(n) === i)
    .slice(0, 80);

  const pdfjs = await import(pathToFileUrl(pdfjsPath));
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const doc = await pdfjs.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true,
  }).promise;

  const out = {};
  for (const pageNo of pages) {
    if (pageNo < 1 || pageNo > doc.numPages) continue;
    const page = await doc.getPage(pageNo);
    const text = await page.getTextContent({ includeMarkedContent: false });
    const cleaned = cleanText(text.items);
    if (cleaned) out[String(pageNo)] = cleaned;
  }
  console.log(JSON.stringify({ pageCount: doc.numPages, pages: out }));
}

function pathToFileUrl(p) {
  return "file:///" + path.resolve(p).replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1:");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
