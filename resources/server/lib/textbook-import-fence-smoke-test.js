"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var file = path.resolve(__dirname, "..", ".next", "server", "chunks", "2751.js");
var source = fs.readFileSync(file, "utf8");

function assertOrdered(needles, label) {
  var cursor = -1;
  needles.forEach(function (needle) {
    var next = source.indexOf(needle, cursor + 1);
    assert(next > cursor, label + " missing or out of order: " + needle);
    cursor = next;
  });
}

assert(source.includes("let ocrOperation=assertTextbookOcrFence(a&&a.ocrOperation),fenceMismatch=!Object.isFrozen(ocrOperation)"), "importer must accept one frozen operation fence");
assert(source.includes("function validTextbookSegment(a)"), "importer must validate profile/world segments before any filesystem access");
assert(source.includes("function assertTextbookSegments()"), "all textbook service entry points must share a fail-closed segment guard");
assert(source.includes("function safeTextbookFileName(a)"), "importer must reject traversal and Windows device filenames");
assert(source.includes("await s(f,x,g.constants.COPYFILE_EXCL)"), "import copy must never overwrite an existing destination");
assert(source.includes("async function M(a,b,c,ocrOperation){assertTextbookSegments(a,b,c);"), "DELETE must validate all IDs before its first path construction");
assert(source.includes("async function Q(a,b,c){assertTextbookSegments(a,b,c);"), "textbook source lookup must validate IDs before path construction");
assert(source.includes("safeTextbookFileName(f.fileName)"), "legacy catalog filenames must be revalidated before join/read");
assert(source.includes("a.accountId!==ocrOperation.accountId||a.sessionEpoch!==ocrOperation.sessionEpoch||a.signal!==ocrOperation.signal||a.deadlineAt!==ocrOperation.deadlineAt"), "compatibility fields must strictly match the frozen fence");
assert(source.includes("pdfOcrScope=\"pdf\"===n?{accountId:ocrOperation.accountId"), "PDF scope must derive account identity from the frozen operation");
assert(source.includes("sessionEpoch:ocrOperation.sessionEpoch"));
assert(source.includes("signal:ocrOperation.signal,deadlineAt:ocrOperation.deadlineAt"));
assert(!source.includes("pdfOcrScope=\"pdf\"===n?{accountId:a.accountId"), "duplicate request fields must not remain a trust source");

assert(source.includes("Vi)(x,pdfOcrScope).catch(a=>{if(isTextbookOcrFenceError(a))throw a;assertTextbookOcrFence(ocrOperation);return[]}"), "outline fallback must rethrow lifecycle/security errors");
assert(source.includes("catch(a){if(isTextbookOcrFenceError(a))throw a;assertTextbookOcrFence(ocrOperation);console.error(\"[textbook] TOC generation failed (non-critical):\",a)}"), "TOC fallback must rethrow lifecycle/security errors");
assert(source.includes("async function u(a,b,d,e,f=\"chinese\",g,h,ocrOperation)"));
assert(source.includes("async function C(a,b,d,e,f,g=\"chinese\",h,i,j,k,ocrOperation)"));
assert(source.includes("async function F(a,b,d,e,f,g=\"chinese\",h,i,ocrOperation)"));
assert(source.includes("signal:ocrOperation.signal,deadlineAt:ocrOperation.deadlineAt"), "all importer LLM calls must receive the request fence");
assert(source.includes("if(isTextbookOcrFenceError(a))throw a;assertTextbookOcrFence(ocrOperation)"), "LLM fallback catches must preserve lifecycle errors");

assertOrdered([
  "assertTextbookOcrFence(ocrOperation);await (0,d.mkdir)(r",
  "assertTextbookOcrFence(ocrOperation);await s(f,x,g.constants.COPYFILE_EXCL)",
  "await ocrCoordinator.activateScope(pdfOcrScope);assertTextbookOcrFence(ocrOperation)",
  "B=await A.detectQuality(x,pdfOcrScope);assertTextbookOcrFence(ocrOperation)",
  "D=await A.getMetadata(x,pdfOcrScope);assertTextbookOcrFence(ocrOperation)",
], "import staging and OCR phases");
assertOrdered([
  "await (0,d.writeFile)(i().join(r,\"preface.json\")",
  "assertTextbookOcrFence(ocrOperation),\"pdf\"===n",
  "await (0,d.writeFile)(i().join(r,\"progress.md\")",
  "assertTextbookOcrFence(ocrOperation);let af=",
  "await z(b,e,ag),indexCommitted=!0,assertTextbookOcrFence(ocrOperation)",
  "await G(b,e,p),activeCommitted=!0,assertTextbookOcrFence(ocrOperation)",
], "staging and durable commit phases");
assert(source.includes("await importBuilder.cancelScope({accountId:ocrOperation.accountId,sessionEpoch:ocrOperation.sessionEpoch"), "cleanup must use the same frozen account/session identity");

var helperStart = source.indexOf("let textbookOcrFenceErrors=");
var helperEnd = source.indexOf("async function M(", helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, "fence helpers must be extractable for behavior checks");
var accountId = "account-a";
var accountState = { active: true, accountId: "account-a", sessionEpoch: 7 };
var sandbox = {
  Date: Date,
  Error: Error,
  Number: Number,
  Set: Set,
  String: String,
  global: {
    __SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__: { getAccountId: function () { return accountId; } },
    __SOCRATOPIA_ACCOUNT_CONTEXT__: function () { return accountState; },
  },
};
vm.createContext(sandbox);
vm.runInContext(source.slice(helperStart, helperEnd) + "\nthis.assertFence=assertTextbookOcrFence;this.isFenceError=isTextbookOcrFenceError;this.validSegment=validTextbookSegment;this.safeFileName=safeTextbookFileName;this.assertSegments=assertTextbookSegments;", sandbox);

assert.strictEqual(sandbox.validSegment("profile_1"), true);
assert.strictEqual(sandbox.validSegment("../profile"), false);
assert.strictEqual(sandbox.safeFileName("book.pdf"), "book.pdf");
["../book.pdf", "..\\book.pdf", "CON.pdf", "book.pdf.", "book?.pdf"].forEach(function (name) { assert.strictEqual(sandbox.safeFileName(name), null, name); });
assert.throws(function () { sandbox.assertSegments("profile", "../world", "book"); }, function (error) { return error && error.code === "textbook_scope_invalid"; });

var controller = new AbortController();
var operation = Object.freeze({ accountId: "account-a", sessionEpoch: 7, signal: controller.signal, deadlineAt: Date.now() + 60000 });
assert.strictEqual(sandbox.assertFence(operation), operation);
accountState = { active: true, accountId: "account-a", sessionEpoch: 8 };
assert.throws(function () { sandbox.assertFence(operation); }, function (error) { return error && error.code === "request_stale"; });
accountState = { active: true, accountId: "account-a", sessionEpoch: 7 };
controller.abort();
assert.throws(function () { sandbox.assertFence(operation); }, function (error) { return error && error.code === "request_aborted"; });

[
  "request_aborted", "request_deadline", "request_stale", "ocr_request_aborted", "ocr_request_deadline",
  "ocr_scope_stale", "ocr_scope_invalid", "ocr_scope_tombstoned", "pdf_scope_mismatch",
  "pdf_changed_during_ocr", "vision_account_changed",
].forEach(function (code) {
  assert.strictEqual(sandbox.isFenceError({ code: code }), true, code + " must escape tolerant importer catches");
});
assert.strictEqual(sandbox.isFenceError({ code: "pdf_busy" }), false, "ordinary availability failures may retain content fallback behavior");

console.log("textbook import request fence smoke: PASS");
