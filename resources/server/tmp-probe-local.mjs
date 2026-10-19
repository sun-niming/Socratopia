
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
const libDir = "E:\\huanjing\\sogeladi\\Socratopia\\resources\\server\\lib";
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
const runner = await import(pathToFileURL(path.join(libDir, "ocr", "local-ocr-runner.mjs")).href);
const out = await runner.runLocalOcr({ tempDir, items, language: "zh-Hans-CN", timeoutMs: 120000 });
console.log("RESULT " + JSON.stringify((out.pages || []).map((p) => ({ page: p.page, engine: p.engine, err: p.error, len: (p.text || "").length, box: ((p.text || "").match(/[\u25A1\u25AF]/g) || []).length, head: (p.text || "").slice(0, 40) })), null, 1));
await fs.rm(tempDir, { recursive: true, force: true });
