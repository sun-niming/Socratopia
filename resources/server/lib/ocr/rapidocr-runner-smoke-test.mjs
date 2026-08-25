import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRapidOcr } from "./rapidocr-runner.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(dirname, "fixtures", "rapidocr-chinese.png");
const fixtureBytes = await fs.readFile(fixture);
assert.strictEqual(fixtureBytes.length, 26002, "Chinese OCR fixture size must remain stable");
assert.strictEqual(crypto.createHash("sha256").update(fixtureBytes).digest("hex"), "0a9a208bf7f10eee205c61bb25428ff85d69c7e7ad952f2df0db8def65d52123", "Chinese OCR fixture hash must remain stable");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "socratopia-rapidocr-"));
try {
  const image = path.join(root, "page-1.png");
  await fs.copyFile(fixture, image);
  const result = await runRapidOcr({ tempDir: root, items: [{ page: 1, path: image }], timeoutMs: 30000 });
  assert.strictEqual(result.pages.length, 1);
  assert.strictEqual(result.pages[0].engine, "rapidocr-v5");
  assert(result.pages[0].confidence >= 0.8, "RapidOCR must expose high confidence for the fixed fixture");
  assert(result.pages[0].text.includes("扫描页面模块导入"), result.pages[0].text);
  assert(/Test\s+2026/i.test(result.pages[0].text), result.pages[0].text);
  assert(!/[□▯\uFFFD]/.test(result.pages[0].text), "OCR output must not contain missing-glyph boxes or replacement characters");
  assert(!/(?:锟斤拷|Ã[\u0080-\u00FF]|Â[\u0080-\u00FF]|â[\u0080-\u00BF]{1,2})/.test(result.pages[0].text), "OCR output must not contain known mojibake");
  console.log('RapidOCR smoke: PASS text="' + result.pages[0].text.replace(/\s+/g, " ").trim() + '"');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
