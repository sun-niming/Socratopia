"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var coordinatorModule = require("./pdf-ocr-coordinator.js");
var canvas = require(path.join(__dirname, "..", ".next", "node_modules", "@napi-rs", "canvas"));

async function main() {
  if (process.platform !== "win32") {
    console.log("PDF OCR round-trip smoke: SKIP (Windows build only)");
    return;
  }
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-ocr-roundtrip-"));
  var textbookDir = path.join(root, "accounts", "account-a", "profiles", "p", "worlds", "w", "textbooks", "t");
  fs.mkdirSync(textbookDir, { recursive: true });
  try {
    var raster = canvas.createCanvas(1800, 600);
    var context = raster.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, raster.width, raster.height);
    context.fillStyle = "black";
    context.font = '96px "Arial"';
    context.fillText("Socratopia Scanned Page", 120, 220);
    context.fillText("OCR Round Trip Test 2026", 120, 410);
    var image = await canvas.loadImage(raster.toBuffer("image/png"));
    var pdfDocument = new canvas.PDFDocument();
    var pdfContext = pdfDocument.beginPage(1800, 600);
    pdfContext.drawImage(image, 0, 0, 1800, 600);
    pdfDocument.endPage();
    var pdf = path.join(textbookDir, "scan.pdf");
    fs.writeFileSync(pdf, pdfDocument.close());

    var coordinator = coordinatorModule.createCoordinator({
      projectRoot: root,
      cacheRoot: path.join(root, ".private", "ocr-cache"),
      getAccountContext: function () { return { active: true, accountId: "account-a", sessionEpoch: 1 }; },
    });
    await coordinator.initialize();
    var request = {
      command: "extract",
      filePath: pdf,
      startPage: 1,
      endPage: 1,
      scope: { accountId: "account-a", profileId: "p", worldId: "w", textbookId: "t", sessionEpoch: 1 },
      expectedLanguage: "zh-Hans-CN",
      timeoutMs: 120000,
    };
    var first = await coordinator.run(request);
    assert.strictEqual(first.pages.length, 1);
    assert(["windows-ocr", "rapidocr-v5"].includes(first.pages[0].source), "image-only PDF must use a local OCR engine");
    assert(/Test\s+2026/i.test(first.pages[0].text), first.pages[0].text);
    assert.strictEqual(first.failedPages.length, 0);
    var cached = await coordinator.run(request);
    assert.strictEqual(cached.pages[0].cached, true, "ordinary second read must reuse the per-page OCR cache");
    assert.strictEqual(cached.pages[0].source, first.pages[0].source);
    await coordinator.shutdown();
    console.log("PDF OCR round-trip smoke: PASS source=" + first.pages[0].source);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exit(1);
});
