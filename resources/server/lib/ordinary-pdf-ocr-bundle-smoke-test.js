"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var chunk = fs.readFileSync(path.join(__dirname, "..", ".next", "server", "chunks", "2751.js"), "utf8");
var toolChunk = fs.readFileSync(path.join(__dirname, "..", ".next", "server", "chunks", "9654.js"), "utf8");

assert.ok(chunk.includes("global.__PDF_OCR_COORDINATOR__"), "module 36547 must delegate PDF execution to the coordinator");
assert.ok(!chunk.includes("execFile)(process.execPath"), "module 36547 must not retain an unmanaged PDF worker fallback");
assert.ok(chunk.includes("ocr_scope_invalid"), "unscoped PDF calls must fail closed");
assert.ok(chunk.includes("accountId:a&&a.accountId"), "module 36547 must forward the request-bound account id");
assert.ok(chunk.includes("sessionEpoch:a&&a.sessionEpoch"), "module 36547 must forward the request-bound session epoch");
assert.ok(chunk.includes("signal:d.signal"), "module 36547 must forward the caller abort signal to the coordinator request");
assert.ok(chunk.includes("deadlineAt:d.deadlineAt"), "module 36547 must forward the absolute request deadline to the coordinator request");
assert.ok(chunk.includes("pdfOcrScope"), "textbook import must create an ownership scope before PDF inspection");
assert.ok(chunk.includes("U8)(x,pdfOcrScope"), "textbook metadata must use the scoped coordinator");
assert.ok(chunk.includes("ut)(x,1,Q,void 0,!1,pdfOcrScope"), "textbook preface extraction must use the scoped coordinator");
var pdfExtractor = fs.readFileSync(path.join(__dirname, "..", ".next", "server", "chunks", "7962.js"), "utf8");
assert.ok(pdfExtractor.includes("U8)(a,b"), "PdfExtractor must forward ownership scope");
var readingContext = fs.readFileSync(path.join(__dirname, "..", ".next", "server", "app", "api", "reading-context", "route.js"), "utf8");
assert.ok(readingContext.includes("Vi)(b,{profileId:c,worldId:d,textbookId:e"), "reading-context TOC must use the scoped coordinator");
assert.ok(chunk.includes("failedPages"), "module 36547 must propagate page failures");
assert.ok(chunk.includes("contiguousUsableEndPage"), "module 36547 must propagate the contiguous range");
assert.ok(toolChunk.includes("failedPages"), "ordinary read_textbook_pages must consume page failures");
assert.ok(toolChunk.includes("contiguousUsableEndPage"), "ordinary read_textbook_pages must guard progress with the contiguous range");
assert.ok(toolChunk.includes("Vi)(b,{profileId:c,worldId:f,textbookId:o"), "ordinary get_textbook_toc must pass the active textbook ownership scope");
assert.ok(toolChunk.includes("accountId:_ocrOperation&&_ocrOperation.accountId"), "ordinary tools must forward the request-bound account id");
assert.ok(toolChunk.includes("sessionEpoch:_ocrOperation&&_ocrOperation.sessionEpoch"), "ordinary tools must forward the request-bound session epoch");
assert.ok(toolChunk.includes("signal:_ocrOperation&&_ocrOperation.signal"), "ordinary tools must forward the request abort signal");
assert.ok(toolChunk.includes("deadlineAt:_ocrOperation&&_ocrOperation.deadlineAt"), "ordinary tools must forward the absolute request deadline");
console.log("ordinary PDF OCR bundle smoke: PASS");
