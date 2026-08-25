"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var route = fs.readFileSync(path.join(__dirname, "..", ".next", "server", "app", "api", "jump-page", "route.js"), "utf8");
var scopeCall = route.indexOf("profileId:b,worldId:c,textbookId:d");
var contiguousGuard = route.indexOf("contiguousUsableEndPage");
var failedPages = route.indexOf("failedPages");
var writeReading = route.indexOf("global.__AUTO_ADVANCE__.commitRange");
var writeWindow = route.indexOf("(0,C.kL)");
var pdfJumpFence = route.indexOf("global.__AUTO_ADVANCE__.readSnapshot({");
var markdownJumpFence = route.lastIndexOf("global.__AUTO_ADVANCE__.readSnapshot({");
var pdfOcr = route.indexOf("(0,y.WS)");
var markdownExtract = route.indexOf("_jumpExtractor.extractAdaptive");
var markdownFenceBefore = route.lastIndexOf("_assertOcrRequestFence(_ocrFence)", markdownExtract);
var markdownFenceAfter = route.indexOf("_assertOcrRequestFence(_ocrFence)", markdownExtract);
var firstRequestFence = route.indexOf("_assertOcrRequestFence(_ocrFence)");

assert.ok(scopeCall >= 0, "jump-page must pass profile/world/textbook scope to OCR");
assert.ok(contiguousGuard >= 0 && failedPages >= 0, "jump-page must inspect the contiguous range and page failures");
assert.ok(contiguousGuard < writeReading, "OCR failure guard must run before current_reading is written");
assert.ok(contiguousGuard < writeWindow, "OCR failure guard must run before the session window is updated");
assert.ok(route.includes("sourcesByPage"), "jump-page response must propagate OCR page sources");
assert.ok(route.includes("Math.min((0,B.JM)(k,l)??g,g)"), "jump-page truncation must not cross the contiguous usable range");
assert.ok(pdfJumpFence >= 0 && pdfJumpFence < pdfOcr, "PDF jump must capture an authoritative snapshot before OCR");
assert.ok(markdownJumpFence >= 0 && markdownJumpFence < markdownExtract, "document jump must capture an authoritative snapshot before extraction");
assert.ok(firstRequestFence >= 0 && firstRequestFence < pdfJumpFence, "request account/session fence must run before any authoritative snapshot operation");
assert.ok(!route.includes("global.__AUTO_ADVANCE__.bootstrap({"), "jump-page must not activate an owner while capturing its baseline");
assert.ok(route.includes("accountId:_ocrFence.accountId,sessionEpoch:_ocrFence.sessionEpoch"), "jump-page must bind runtime operations to the captured account session");
assert.ok(route.includes("expectedSnapshot:_advanceJumpBase"), "jump commit must carry its pre-extraction snapshot fence");
assert.ok(route.includes('error:"ADVANCE_SCOPE_REQUIRED"'), "jump-page must reject requests without a conversation scope");
assert.ok(!route.includes("else await (0,w.YK)(b,c,P,W)"), "jump-page must not fall back to an unfenced legacy write");
assert.ok(markdownFenceBefore >= 0 && markdownFenceAfter > markdownExtract, "document extraction must be enclosed by the request account/deadline fence");
assert.ok(!route.includes("__MD_CURSOR__.updateLoadedCursor"), "route must not rewrite progress_state after the authoritative commit");
assert.ok(!route.includes("await (0,x.fU)(b,c,d,e)"), "route must not rewrite textbook currentPage after the authoritative commit");
assert.ok(route.includes('error:a?.code||"EXTRACTION_ERROR"'), "route must preserve authoritative fence error codes");
console.log("jump-page OCR route smoke: PASS");
