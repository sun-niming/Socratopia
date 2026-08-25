"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");
var quality = require("../ocr/ocr-quality.js");
var canvas = require(path.join(__dirname, "..", "..", ".next", "node_modules", "@napi-rs", "canvas"));

function runWorker(worker, request, tempRoot) {
  var result = childProcess.spawnSync(process.execPath, [worker, "--coordinator-ipc"], {
    encoding: "utf8",
    input: JSON.stringify(request),
    env: Object.assign({}, process.env, { TEMP: tempRoot, TMP: tempRoot }),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120000,
    windowsHide: true,
  });
  assert.strictEqual(result.status, 0, String(result.stderr || result.stdout));
  return JSON.parse(result.stdout);
}

(async function () {
  if (process.platform !== "win32") {
    console.log("PDF OCR smoke: SKIP (Windows.Media.Ocr is Windows-only)");
    return;
  }
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-ocr-smoke-"));
  try {
    var raster = canvas.createCanvas(1800, 600);
    var rasterCtx = raster.getContext("2d");
    rasterCtx.fillStyle = "white";
    rasterCtx.fillRect(0, 0, 1800, 600);
    rasterCtx.fillStyle = "black";
    rasterCtx.font = '96px "Microsoft YaHei"';
    var scanPhrase = "\u626b\u63cf\u9875\u6a21\u5757\u5bfc\u5165";
    rasterCtx.fillText(scanPhrase, 120, 220);
    rasterCtx.font = '82px "Arial"';
    rasterCtx.fillText("Socratopia OCR Test 2026", 120, 410);

    var image = await canvas.loadImage(raster.toBuffer("image/png"));
    var imagePdf = new canvas.PDFDocument();
    var imagePdfCtx = imagePdf.beginPage(1800, 600);
    imagePdfCtx.drawImage(image, 0, 0, 1800, 600);
    imagePdf.endPage();
    var imagePdfPath = path.join(root, "scan.pdf");
    fs.writeFileSync(imagePdfPath, imagePdf.close());

    var worker = path.join(__dirname, "..", "pdf-worker.mjs");
    var extracted = runWorker(worker, { command: "extract", filePath: imagePdfPath, startPage: 1, endPage: 1 }, root);
    assert.strictEqual(String(extracted.pages && extracted.pages[0] && extracted.pages[0].text || "").trim(), "", "image-only PDF has no text layer");
    var parsed = runWorker(worker, { command: "ocr_pages", filePath: imagePdfPath, pages: [1], expectedLanguage: "zh-Hans-CN", accountId: "smoke" }, root);
    var pageResult = parsed.pages && parsed.pages[0] || {};
    var text = quality.normalize(pageResult.text);
    assert.ok(text.indexOf(scanPhrase) >= 0 || /OCR\s*Test\s*2026/i.test(text), "image-only PDF text is recovered by OCR: text=" + JSON.stringify(text) + " error=" + JSON.stringify(pageResult.error));
    assert.ok(!/\u626b\s+\u63cf|\u6a21\s+\u5757|\u5bfc\s+\u5165/u.test(text), "adjacent Chinese OCR characters are normalized: text=" + JSON.stringify(text));
    assert.strictEqual(pageResult.page, 1, "OCR result retains the requested PDF page number");
    assert.deepStrictEqual(fs.readdirSync(root).filter(function (name) { return /^socratopia-(?:pdf-)?ocr-/.test(name); }), [], "OCR temporary directory is removed after batch recognition");

    var sparsePdf = new canvas.PDFDocument();
    var sparseCtx = sparsePdf.beginPage(900, 400);
    sparseCtx.fillStyle = "black";
    sparseCtx.font = '48px "Arial"';
    sparseCtx.fillText("Sparse PDF text", 80, 180);
    sparsePdf.endPage();
    var sparsePdfPath = path.join(root, "sparse-text.pdf");
    fs.writeFileSync(sparsePdfPath, sparsePdf.close());

    var sparseParsed = runWorker(worker, { command: "extract", filePath: sparsePdfPath, startPage: 1, endPage: 1 }, root);
    assert.ok(/Sparse PDF text/.test(String(sparseParsed.pages && sparseParsed.pages[0] && sparseParsed.pages[0].text || "")), "correct sparse PDF.js text is preserved without invoking OCR");
    console.log("PDF OCR smoke: PASS text=" + JSON.stringify(text));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(function (error) {
  console.error(error && error.stack || error);
  process.exit(1);
});
