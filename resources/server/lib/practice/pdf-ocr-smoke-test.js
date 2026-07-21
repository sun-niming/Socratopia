"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");
var canvas = require(path.join(__dirname, "..", "..", ".next", "node_modules", "@napi-rs", "canvas"));

function extract(helper, pdfPath, expectedCjk, tempRoot) {
  var result = childProcess.spawnSync(process.execPath, [helper, pdfPath, "[1]", String(expectedCjk)], {
    encoding: "utf8",
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

    var helper = path.join(__dirname, "pdf-page-extractor-child.mjs");
    var parsed = extract(helper, imagePdfPath, true, root);
    var text = String(parsed.pages && parsed.pages["1"] || "");
    assert.ok(text.indexOf(scanPhrase) >= 0 || /OCR\s*Test\s*2026/i.test(text), "image-only PDF text is recovered by OCR: text=" + JSON.stringify(text) + " diag=" + JSON.stringify(parsed.diagnostics && parsed.diagnostics["1"]));
    assert.ok(!/\u626b\s+\u63cf|\u6a21\s+\u5757|\u5bfc\s+\u5165/u.test(text), "adjacent Chinese OCR characters are normalized: text=" + JSON.stringify(text));
    assert.strictEqual(parsed.diagnostics["1"].ocr.attempted, true, "OCR attempt is reported");
    assert.strictEqual(parsed.diagnostics["1"].ocr.accepted, true, "OCR result is accepted into page output");
    assert.deepStrictEqual(fs.readdirSync(root).filter(function (name) { return /^socratopia-ocr-/.test(name); }), [], "OCR temporary directory is removed after batch recognition");

    var sparsePdf = new canvas.PDFDocument();
    var sparseCtx = sparsePdf.beginPage(900, 400);
    sparseCtx.fillStyle = "black";
    sparseCtx.font = '48px "Arial"';
    sparseCtx.fillText("Sparse PDF text", 80, 180);
    sparsePdf.endPage();
    var sparsePdfPath = path.join(root, "sparse-text.pdf");
    fs.writeFileSync(sparsePdfPath, sparsePdf.close());

    var sparseParsed = extract(helper, sparsePdfPath, false, root);
    assert.ok(/Sparse PDF text/.test(String(sparseParsed.pages && sparseParsed.pages["1"] || "")), "correct sparse PDF.js text is preserved");
    assert.strictEqual(sparseParsed.diagnostics["1"].ocr.attempted, false, "correct sparse PDF.js text does not invoke OCR");
    console.log("PDF OCR smoke: PASS text=" + JSON.stringify(text));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(function (error) {
  console.error(error && error.stack || error);
  process.exit(1);
});
