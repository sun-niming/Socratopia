import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { limits, runLocalOcr } from "./local-ocr-runner.mjs";

assert.equal(limits.maxItems, 6);
assert.equal(limits.maxOutputBytes, 4 * 1024 * 1024);
if (process.platform !== "win32") {
  await assert.rejects(() => runLocalOcr({}), (error) => error && error.code === "windows_ocr_unavailable");
} else {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "socratopia-local-ocr-"));
  try {
    const first = path.join(root, "page-1.png");
    const second = path.join(root, "page-2.png");
    await fs.writeFile(first, "one");
    await fs.writeFile(second, "two");
    const items = [{ page: 1, path: first }, { page: 2, path: second }];
    const primaryOrder = [];
    const rapidPrimary = await runLocalOcr({
      tempDir: root,
      items: [items[0]],
      windowsRunner: async () => {
        primaryOrder.push("windows");
        return { pages: [{ page: 1, text: "Windows result should be fallback only", language: "en-US" }] };
      },
      rapidRunner: async () => {
        primaryOrder.push("rapid");
        return { pages: [{ page: 1, text: "Rapid OCR primary result", confidence: 0.93, engine: "rapidocr-v5" }] };
      },
    });
    assert.deepEqual(primaryOrder, ["rapid"], "bundled RapidOCR must run before the optional Windows language-pack engine");
    assert.equal(rapidPrimary.pages[0].engine, "rapidocr-v5");
    let windowsCalls = 0;
    const result = await runLocalOcr({
      tempDir: root,
      items,
      rapidRunner: async (request) => {
        assert.deepEqual(request.items.map((item) => item.page), [1, 2], "RapidOCR must receive the complete batch first");
        return { pages: [
          { page: 1, text: "Rapid OCR succeeds", confidence: 0.91, engine: "rapidocr-v5", error: null },
          { page: 2, text: "低", confidence: 0.2, engine: "rapidocr-v5", error: null },
        ] };
      },
      windowsRunner: async (request) => {
        windowsCalls += 1;
        assert.deepEqual(request.items.map((item) => item.page), [2], "only failed RapidOCR pages fall back to Windows OCR");
        return { pages: [{ page: 2, text: "Windows fallback completes this page", language: "en-US" }] };
      },
    });
    assert.equal(windowsCalls, 1);
    assert.equal(result.pages[0].engine, "rapidocr-v5");
    assert.equal(result.pages[1].engine, "windows-ocr");

    const unavailable = new Error("rapidocr_unavailable");
    unavailable.code = "rapidocr_unavailable";
    const fallback = await runLocalOcr({
      tempDir: root,
      items: [items[0]],
      rapidRunner: async () => { throw unavailable; },
      windowsRunner: async () => ({ pages: [{ page: 1, text: "Windows language pack fallback succeeds", language: "en-US" }] }),
    });
    assert.equal(fallback.pages[0].engine, "windows-ocr");
    assert.equal(fallback.pages[0].error, null);

    let skippedWindows = false;
    const rapidOnly = await runLocalOcr({
      tempDir: root,
      items: [items[0]],
      rapidRunner: async () => ({ pages: [{ page: 1, text: "Bundled Rapid OCR success", confidence: 0.95, engine: "rapidocr-v5" }] }),
      windowsRunner: async () => { skippedWindows = true; throw new Error("must not run"); },
    });
    assert.equal(skippedWindows, false);
    assert.equal(rapidOnly.pages[0].engine, "rapidocr-v5");

    const lowConfidence = await runLocalOcr({
      tempDir: root,
      items: [items[0]],
      rapidRunner: async () => ({ pages: [{ page: 1, text: "plausible but uncertain text", confidence: 0.2, engine: "rapidocr-v5" }] }),
      windowsRunner: async () => ({ pages: [{ page: 1, text: "abc", language: "en-US" }] }),
    });
    assert.equal(lowConfidence.pages[0].error, "rapidocr_low_confidence");

    let rapidBudget = 0;
    let windowsBudget = 0;
    const timedOut = new Error("rapidocr_timeout");
    timedOut.code = "rapidocr_timeout";
    const reservedFallback = await runLocalOcr({
      tempDir: root,
      items: [items[0]],
      timeoutMs: 8000,
      rapidRunner: async (request) => { rapidBudget = request.timeoutMs; throw timedOut; },
      windowsRunner: async (request) => {
        windowsBudget = request.timeoutMs;
        return { pages: [{ page: 1, text: "Windows fallback still has reserved time", language: "en-US" }] };
      },
    });
    assert(rapidBudget <= 6000, "RapidOCR primary must leave a bounded fallback reserve");
    assert(windowsBudget >= 1000, "Windows fallback must receive the remaining absolute-deadline budget");
    assert.equal(reservedFallback.pages[0].engine, "windows-ocr");

    const sixItems = [];
    for (let page = 1; page <= 6; page++) sixItems.push({ page, path: first });
    const sixPage = await runLocalOcr({
      tempDir: root,
      items: sixItems,
      rapidRunner: async () => ({ pages: sixItems.map((item) => ({ page: item.page, text: "complete page " + item.page, confidence: 0.9, engine: "rapidocr-v5" })) }),
      windowsRunner: async () => { throw new Error("six-page RapidOCR batch must not need fallback"); },
    });
    assert.equal(sixPage.pages.length, 6);
    assert(sixPage.pages.every((item) => item.engine === "rapidocr-v5" && item.error === null));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
console.log("local OCR runner smoke: PASS");
