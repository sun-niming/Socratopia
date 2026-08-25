"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var serverRoot = path.resolve(__dirname, "..", "..", ".next", "server", "app", "api");

function readRoute(name) {
  return fs.readFileSync(path.join(serverRoot, name, "route.js"), "utf8");
}

function assertOrdered(source, needles, label) {
  var cursor = -1;
  needles.forEach(function (needle) {
    var next = source.indexOf(needle, cursor + 1);
    assert(next >= 0, label + " missing: " + needle);
    assert(next > cursor, label + " has wrong order at: " + needle);
    cursor = next;
  });
}

function assertFenceHelpers(source, label) {
  assert(source.includes("function _captureOcrRequestFence("), label + " must capture one immutable OCR request fence");
  assert(source.includes("function _assertOcrRequestFence("), label + " must revalidate the captured OCR request fence");
  assert(source.includes("__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__"), label + " must capture request ALS accountId");
  assert(source.includes("__SOCRATOPIA_ACCOUNT_CONTEXT__"), label + " must capture global account/session state");
  assert(source.includes("signal:a&&a.signal"), label + " must retain request.signal");
  assert(source.includes("deadlineAt:Date.now()+"), label + " must retain an absolute deadline");
}

var world = readRoute("world");
var profile = readRoute("profile");
var reset = readRoute(path.join("profile", "reset"));
var reading = readRoute("reading-context");
var chat = readRoute("chat");
var textbook = readRoute("textbook");
var jumpPage = readRoute("jump-page");

[world, profile, reset, reading, chat, textbook, jumpPage].forEach(function (source, index) {
  assertFenceHelpers(source, ["world", "profile", "profile/reset", "reading-context", "chat", "textbook", "jump-page"][index]);
});

assertOrdered(world, ["_captureOcrRequestFence(a,6e4)", "await a.json()", "_assertOcrRequestFence(_ocrFence)", "cancelTree(_ocrTreeScope)", "purgeTree(_ocrTreeScope)", "_assertOcrRequestFence(_ocrFence)", ".uT)(b,c)"], "world DELETE");
assert(world.includes("worldId:c,accountId:_ocrFence.accountId,sessionEpoch:_ocrFence.sessionEpoch,signal:_ocrFence.signal,deadlineAt:_ocrFence.deadlineAt"));

assertOrdered(profile, ["_captureOcrRequestFence(a,6e4)", "await a.json()", "_assertOcrRequestFence(_ocrFence)", "cancelTree(_ocrTreeScope)", "purgeTree(_ocrTreeScope)", "_assertOcrRequestFence(_ocrFence)", ".lp)(b)"], "profile DELETE");
assert(profile.includes("profileId:b,accountId:_ocrFence.accountId,sessionEpoch:_ocrFence.sessionEpoch,signal:_ocrFence.signal,deadlineAt:_ocrFence.deadlineAt"));

assertOrdered(reset, ["_captureOcrRequestFence(a,6e4)", "await a.json()", "_assertOcrRequestFence(_ocrFence)", "cancelTree(_ocrTreeScope)", "purgeTree(_ocrTreeScope)", "_assertOcrRequestFence(_ocrFence)", ".rm)(b", "_assertOcrRequestFence(_ocrFence)", "activateTree(_ocrTreeScope)"], "profile reset");
assert(reset.includes("accountId:_ocrFence.accountId,sessionEpoch:_ocrFence.sessionEpoch,signal:_ocrFence.signal,deadlineAt:_ocrFence.deadlineAt"));

assertOrdered(reading, ["_captureOcrRequestFence(a,3e4)", "_assertOcrRequestFence(_ocrFence)", ".Vi)(b,{profileId:c,worldId:d,textbookId:e,accountId:_ocrFence.accountId,sessionEpoch:_ocrFence.sessionEpoch,signal:_ocrFence.signal,deadlineAt:_ocrFence.deadlineAt", "_assertOcrRequestFence(_ocrFence)"], "reading-context TOC");
assert(reading.includes("function _isOcrFenceError("), "reading-context must classify fence failures");
assert(reading.includes("catch(_ocrTocError){if(_isOcrFenceError(_ocrTocError))throw _ocrTocError}"), "reading-context must rethrow fence failures instead of returning a stale 200 response");

assertOrdered(chat, ["_captureOcrRequestFence(a,12e4)", "await a.json()", "(0,l.o8)(\"read_textbook_pages\"", "O,!1,_ocrFence", "ocrOperation:_ocrFence"], "chat OCR propagation");
assert(chat.includes("function _isOcrFenceError("), "chat must classify fence failures");
assert(chat.includes("catch(_ocrPreloadError){if(_isOcrFenceError(_ocrPreloadError))throw _ocrPreloadError}"), "chat automatic preload must rethrow fence failures");
assert(chat.includes("j.conversationId,j.nuwaMode,j.ocrOperation"), "chat streaming tool caller must forward the OCR operation in the ninth argument");
assert(chat.includes("(0,z.WS)(c2,a2,b2,30,{profileId:x,worldId:C,textbookId:ac,accountId:_ocrFence.accountId,sessionEpoch:_ocrFence.sessionEpoch,signal:_ocrFence.signal,deadlineAt:_ocrFence.deadlineAt"), "chat automatic refill must pass the complete OCR fence");
assert(chat.includes("accountId:_ocrFence.accountId,sessionEpoch:_ocrFence.sessionEpoch"), "chat Close Reading call must use the captured fence");
assertOrdered(chat, ["_assertOcrRequestFence(_ocrFence);_crResult=await global.__CLOSE_READING__.execute", "_assertOcrRequestFence(_ocrFence);_crResult?.prompt", "catch(_crError){if(_isOcrFenceError(_crError))throw _crError"], "chat Close Reading fence enforcement");
assertOrdered(chat, ["_assertOcrRequestFence(j.ocrOperation);let c=await (0,f.o8)", "j.conversationId,j.nuwaMode,j.ocrOperation)", "_assertOcrRequestFence(j.ocrOperation);u.push"], "chat streaming tool fence enforcement");

assertOrdered(textbook, ["_captureOcrRequestFence(a,18e4)", "await a.formData()", "_assertOcrRequestFence(_ocrFence)", ".Gt)({profileId:f,worldId:g", "ocrOperation:_ocrFence"], "textbook import");
assert(textbook.includes("_captureOcrRequestFence(a,6e4)"), "textbook deletion must capture a request fence");
assertOrdered(textbook, ["_captureOcrRequestFence(a,6e4)", "_assertOcrRequestFence(_ocrFence);if(!await (0,D.KC)(c,d,e,_ocrFence)", "_assertOcrRequestFence(_ocrFence),v.NextResponse.json({ok:!0})"], "textbook deletion");
var textbookService = fs.readFileSync(path.resolve(serverRoot, "..", "..", "chunks", "2751.js"), "utf8");
assert(textbookService.includes("pdfOcrScope=\"pdf\"===n?{accountId:ocrOperation.accountId,profileId:b,worldId:e,textbookId:p,sessionEpoch:ocrOperation.sessionEpoch"), "textbook importer must derive account/session from the frozen operation");
assert(textbookService.includes("signal:ocrOperation.signal,deadlineAt:ocrOperation.deadlineAt"), "textbook importer must derive signal/deadline from the frozen operation");
assert(textbookService.includes("fenceMismatch=!Object.isFrozen(ocrOperation)"), "textbook importer must reject mutable or mismatched duplicate fence fields");
assert(textbook.includes("_safeTextbookFileName(e.name)"), "textbook route must reject unsafe multipart filenames before temp writes");
assert(textbook.includes("_validTextbookSegment(f)||!_validTextbookSegment(g)"), "textbook route must reject profile/world traversal");
assert(textbook.includes("!_validTextbookSegment(c)||!_validTextbookSegment(d)"), "textbook GET must reject profile/world traversal");
assert(textbook.includes("!Array.isArray(a)||!a.every(_validTextbookSegment)"), "textbook reorder must validate every textbook id");
assert(textbook.includes("!_validTextbookSegment(c)||!_validTextbookSegment(d)||!_validTextbookSegment(e)"), "textbook DELETE must reject every unsafe id before service entry");
assert(textbookService.includes("Vi)(x,pdfOcrScope).catch(a=>{if(isTextbookOcrFenceError(a))throw a"), "textbook importer must not swallow lifecycle failures while reading the outline");
assert(textbookService.includes("async function M(a,b,c,ocrOperation){assertTextbookSegments(a,b,c);assertTextbookOcrFence(ocrOperation)"), "textbook deletion service must validate IDs and fail closed on a missing operation fence");

assertOrdered(jumpPage, ["_captureOcrRequestFence(a,12e4)", "await a.json()", "_assertOcrRequestFence(_ocrFence)", ".WS)(i,e,4e4,30,{profileId:b,worldId:c,textbookId:d,accountId:_ocrFence.accountId,sessionEpoch:_ocrFence.sessionEpoch,signal:_ocrFence.signal,deadlineAt:_ocrFence.deadlineAt", "_assertOcrRequestFence(_ocrFence)"], "jump-page OCR");

console.log("API route OCR request fence smoke: PASS");
