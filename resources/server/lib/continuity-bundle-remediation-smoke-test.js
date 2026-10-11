"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var serverRoot = path.resolve(__dirname, "..");
var chat = fs.readFileSync(path.join(serverRoot, ".next", "server", "app", "api", "chat", "route.js"), "utf8");
var worldChunk = fs.readFileSync(path.join(serverRoot, ".next", "server", "chunks", "829.js"), "utf8");
var voice = fs.readFileSync(path.join(serverRoot, ".next", "static", "chunks", "4137-131d0676e3b5bef7.js"), "utf8");
var server = fs.readFileSync(path.join(serverRoot, "server.js"), "utf8");

assert(chat.includes("let _ccEndAnchor=null;"), "end-class route stores the resolved taught-page anchor");
assert(chat.includes("endingPage:_ccPage"), "continuity end-class commit receives the taught-page anchor");
assert(chat.includes("_ccReplayPage=Number(_ccPayload.endingPage)"), "receipt replay reconciles the persisted taught-page anchor");
assert(chat.includes("sessionEpoch:_ccSnapshot.sessionEpoch"), "continuity scope forwards the captured account epoch");
assert(!chat.includes("endingPage:_ccState?.windowEndPage??null"), "loaded window tail is never submitted as end-class endingPage");
assert(server.includes("function assertContinuityAccount(scope)"), "server runtime validates continuity account scopes");
assert(server.includes("current.sessionEpoch !== scope.sessionEpoch"), "server runtime fences continuity writes by epoch");
assert(server.includes("commitEndClass: function (input) { return endClass.commitEndClass(bindContinuityAccount(input)); }"), "end-class commits use the account-bound wrapper");
assert(worldChunk.includes(":(z?.companionInstanceId||(global.__COMPANION_CONTINUITY__"), "same-candidate companion edits preserve the existing instance id");
assert(voice.includes("let SocratopiaTtsVoiceKey=t,r;"), "stream captures the requested voice key before parsing frames");
assert(voice.includes('voiceKey:SocratopiaTtsVoiceKey,chars:e.length'), "stream frames return the requested voice key");

console.log("continuity bundle remediation smoke: PASS");
