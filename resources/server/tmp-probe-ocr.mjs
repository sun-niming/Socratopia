
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
const __dirname = "E:\\huanjing\\sogeladi\\Socratopia\\resources\\server\\lib";
const pdfjs = await import(pathToFileURL(path.join("E:/huanjing/sogeladi/Socratopia/resources/server", ".next", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs")).href);
const canvas = await import(pathToFileURL(path.join("E:/huanjing/sogeladi/Socratopia/resources/server", ".next", "node_modules", "@napi-rs", "canvas", "index.js")).href);
globalThis.DOMMatrix = canvas.DOMMatrix; globalThis.ImageData = canvas.ImageData; globalThis.Path2D = canvas.Path2D;
const doc = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile("C:\\Users\\ASUS\\AppData\\Roaming\\socratopia\\project-data\\accounts\\local\\profiles\\uolmzgq8\\worlds\\KU\\textbooks\\KUyw\\编译原理 第二版.pdf")) }).promise;
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "probe-ocr-"));
const items = [];
for (const n of [182, 185]) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 225 / 72 });
  const canvasObj = canvas.createCanvas(vp.width, vp.height);
  await page.render({ canvasContext: canvasObj.getContext("2d"), viewport: vp }).promise;
  const p = path.join(tempDir, "page-" + n + ".png");
  await fs.writeFile(p, canvasObj.toBuffer("image/png"));
  items.push({ page: n, path: p, width: vp.width, height: vp.height });
}
// run the two engines separately to see what each yields now
const rapid = await import(pathToFileURL(path.join(__dirname, "ocr", "rapidocr-runner.mjs")).href);
const win = await import(pathToFileURL(path.join(__dirname, "ocr", "local-ocr-runner.mjs")).href);
const r = await rapid.runRapidOcr({ tempDir, items, timeoutMs: 120000 });
console.log("RAPID " + JSON.stringify((r.pages || []).map((p) => ({ page: p.page, conf: p.confidence, err: p.error, len: (p.text || "").length, ph: ((p.text || "").match(/[\u25A1\u25AF]/g) || []).length }))));
const w = await win.runWindowsOcr({ tempDir, items, language: "zh-Hans-CN", timeoutMs: 120000 });
const wq = q.assess;
console.log("WINDOWS " + JSON.stringify((w.pages || []).map((p) => ({ page: p.page, err: p.error, len: (p.text || "").length, ph: ((p.text || "").match(/[□▯]/g) || []).length, q: wq(p.text, { expectedCjk: true, source: "windows-ocr" }).reason })) ));
for (const p of r.pages) { const t = p.text || ""; const i = t.search(/[\u25A1\u25AF]/); if (i >= 0) console.log("page " + p.page + " box context: " + JSON.stringify(t.slice(Math.max(0, i - 30), i + 30))); }
await fs.rm(tempDir, { recursive: true, force: true });
