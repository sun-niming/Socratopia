"use strict";

// Exact, fail-closed remediation for single-line compiled bundles. Every
// target is preflighted before any write, then all changed files are staged
// and committed with rollback backups so incompatible old resources cannot
// leave the packaged app in a half-patched state.

var fs = require("fs");
var path = require("path");

var root = path.resolve(process.env.SOCRATOPIA_REMEDIATION_ROOT || path.resolve(__dirname, ".."));
var plannedWrites = [];
var chatPath = path.join(root, "resources", "server", ".next", "server", "app", "api", "chat", "route.js");
var worldChunkPath = path.join(root, "resources", "server", ".next", "server", "chunks", "829.js");
var voicePath = path.join(root, "resources", "server", ".next", "static", "chunks", "4137-131d0676e3b5bef7.js");

function replaceOnce(source, needle, replacement, label) {
  var count = source.split(needle).length - 1;
  if (count === 1) return source.replace(needle, replacement);
  if (count === 0 && source.indexOf(replacement) >= 0) return source;
  throw new Error("Expected one patch target for " + label + ", found " + count);
}

function replaceCount(source, needle, replacement, expected, label) {
  var count = source.split(needle).length - 1;
  if (count === expected) return source.split(needle).join(replacement);
  if (count === 0 && source.indexOf(replacement) >= 0) return source;
  throw new Error("Expected " + expected + " patch targets for " + label + ", found " + count);
}

function writeIfChanged(file, source, original) {
  if (source === original) {
    console.log("already patched " + path.relative(root, file));
    return;
  }
  plannedWrites.push({ file: file, source: source, original: original });
}

function removeIfExists(file) {
  try { fs.unlinkSync(file); } catch (error) { if (!error || error.code !== "ENOENT") throw error; }
}

function writeStage(file, source) {
  var handle = fs.openSync(file, "wx");
  try {
    fs.writeFileSync(handle, source, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function commitPlannedWrites() {
  if (!plannedWrites.length) return;
  var token = process.pid + "-" + Date.now().toString(36);
  try {
    plannedWrites.forEach(function (entry, index) {
      entry.stage = entry.file + ".continuity-remediation-stage-" + token + "-" + index;
      entry.backup = entry.file + ".continuity-remediation-backup-" + token + "-" + index;
      writeStage(entry.stage, entry.source);
    });
    plannedWrites.forEach(function (entry) {
      if (fs.readFileSync(entry.file, "utf8") !== entry.original) {
        throw new Error("remediation precondition changed: " + path.relative(root, entry.file));
      }
    });
  } catch (error) {
    plannedWrites.forEach(function (entry) { if (entry.stage) try { removeIfExists(entry.stage); } catch (_) {} });
    throw error;
  }
  var committed = [];
  try {
    plannedWrites.forEach(function (entry, index) {
      if (process.env.SOCRATOPIA_REMEDIATION_FAULT_INDEX === String(index)) throw new Error("injected remediation commit failure at " + index);
      fs.renameSync(entry.file, entry.backup);
      committed.push(entry);
      fs.renameSync(entry.stage, entry.file);
    });
  } catch (error) {
    var rollbackError = null;
    committed.slice().reverse().forEach(function (entry) {
      try {
        removeIfExists(entry.file);
        if (fs.existsSync(entry.backup)) fs.renameSync(entry.backup, entry.file);
      } catch (caught) { rollbackError = rollbackError || caught; }
    });
    plannedWrites.forEach(function (entry) { try { removeIfExists(entry.stage); } catch (_) {} });
    if (rollbackError) error.rollbackError = rollbackError;
    throw error;
  }
  plannedWrites.forEach(function (entry) {
    removeIfExists(entry.backup);
    console.log("patched " + path.relative(root, entry.file));
  });
}

var chat = fs.readFileSync(chatPath, "utf8");
var originalChat = chat;

var brokenAnchorTail = 'a.progressMd=global.__RESUME__.normalizeProgressMdPage(a.progressMd,_ccEndAnchor,_anchor.windowStartPage||_session?.windowStartPage||_ccEndAnchor)}}catch(e2){console.warn("[end-class] progress.md page normalization failed:",e2?.message||e2)}';
var fixedAnchorTail = 'a.progressMd=global.__RESUME__.normalizeProgressMdPage(a.progressMd,_ccEndAnchor,_anchor.windowStartPage||_session?.windowStartPage||_ccEndAnchor)}}}catch(e2){console.warn("[end-class] progress.md page normalization failed:",e2?.message||e2)}';
if (chat.indexOf(brokenAnchorTail) >= 0) {
  chat = replaceOnce(chat, brokenAnchorTail, fixedAnchorTail, "repair incomplete anchor try block");
}

chat = replaceOnce(
  chat,
  'try{if(ac&&global.__RESUME__&&global.__RESUME__.resolveEndClassAnchor&&global.__RESUME__.normalizeProgressMdPage){let _session=O?v.dq.get(O):null,_anchor=global.__RESUME__.resolveEndClassAnchor({textbookDir:(0,B.Uu)(x,C,ac),progressMdText:a.progressMd,currentPage:null,windowStartPage:_session?.windowStartPage,windowEndPage:_session?.windowEndPage});if(_anchor&&_anchor.page)a.progressMd=global.__RESUME__.normalizeProgressMdPage(a.progressMd,_anchor.page,_anchor.windowStartPage||_session?.windowStartPage||_anchor.page)}}catch(e2){console.warn("[end-class] progress.md page normalization failed:",e2?.message||e2)}',
  'let _ccEndAnchor=null;try{if(ac&&global.__RESUME__&&global.__RESUME__.resolveEndClassAnchor&&global.__RESUME__.normalizeProgressMdPage){let _session=O?v.dq.get(O):null,_anchor=global.__RESUME__.resolveEndClassAnchor({textbookDir:(0,B.Uu)(x,C,ac),progressMdText:a.progressMd,currentPage:null,windowStartPage:_session?.windowStartPage,windowEndPage:_session?.windowEndPage});if(_anchor&&_anchor.page){_ccEndAnchor=Number(_anchor.page),a.progressMd=global.__RESUME__.normalizeProgressMdPage(a.progressMd,_ccEndAnchor,_anchor.windowStartPage||_session?.windowStartPage||_ccEndAnchor)}}}catch(e2){console.warn("[end-class] progress.md page normalization failed:",e2?.message||e2)}',
  "capture end-class taught anchor"
);
chat = replaceCount(
  chat,
  'scope:{accountId:_ccSnapshot.accountId,profileId:x,worldId:C,conversationId:O}',
  'scope:{accountId:_ccSnapshot.accountId,sessionEpoch:_ccSnapshot.sessionEpoch,profileId:x,worldId:C,conversationId:O}',
  3,
  "forward continuity session epoch"
);
chat = replaceOnce(
  chat,
  'let _ccPayload=_ccReplay.payload,_ccEncoder=new TextEncoder(),_ccDiary="diary/"+new Date().toISOString().slice(0,7)+".md",_ccStream=',
  'let _ccPayload=_ccReplay.payload,_ccReplayPage=Number(_ccPayload.endingPage);if(ac&&Number.isInteger(_ccReplayPage)&&_ccReplayPage>0)try{await (0,j.fU)(x,C,ac,_ccReplayPage)}catch(_ccReplayPageError){console.warn("[continuity] replay textbook page sync failed:",_ccReplayPageError?.message||_ccReplayPageError)}let _ccEncoder=new TextEncoder(),_ccDiary="diary/"+new Date().toISOString().slice(0,7)+".md",_ccStream=',
  "reconcile replayed textbook index"
);
chat = replaceOnce(
  chat,
  'let _ccState=O?v.dq.get(O):null,_ccCleanup=[];',
  'let _ccState=O?v.dq.get(O):null,_ccPage=Number.isInteger(_ccEndAnchor)&&_ccEndAnchor>0?_ccEndAnchor:(_ccState?.windowStartPage??null),_ccCleanup=[];',
  "derive continuity taught page"
);
chat = replaceOnce(
  chat,
  'endingPage:_ccState?.windowEndPage??null',
  'endingPage:_ccPage',
  "commit taught page"
);
chat = replaceOnce(
  chat,
  'if(ac&&null!=_ccState?.windowEndPage)try{await (0,j.fU)(x,C,ac,_ccState.windowEndPage)}',
  'if(ac&&null!=_ccPage)try{await (0,j.fU)(x,C,ac,_ccPage)}',
  "sync taught page"
);
writeIfChanged(chatPath, chat, originalChat);

var worldChunk = fs.readFileSync(worldChunkPath, "utf8");
var originalWorldChunk = worldChunk;
worldChunk = replaceOnce(
  worldChunk,
  ':z?.companionInstanceId||global.__COMPANION_CONTINUITY__&&"function"==typeof global.__COMPANION_CONTINUITY__.newCompanionInstanceId?global.__COMPANION_CONTINUITY__.newCompanionInstanceId():"ci_"+Date.now().toString(36)+Math.random().toString(36).slice(2,18);',
  ':(z?.companionInstanceId||(global.__COMPANION_CONTINUITY__&&"function"==typeof global.__COMPANION_CONTINUITY__.newCompanionInstanceId?global.__COMPANION_CONTINUITY__.newCompanionInstanceId():"ci_"+Date.now().toString(36)+Math.random().toString(36).slice(2,18)));',
  "preserve companion instance on same candidate"
);
writeIfChanged(worldChunkPath, worldChunk, originalWorldChunk);

var voice = fs.readFileSync(voicePath, "utf8");
var originalVoice = voice;
voice = replaceOnce(
  voice,
  'async function SocratopiaClassicStream(e,t,n,l){let r;',
  'async function SocratopiaClassicStream(e,t,n,l){let SocratopiaTtsVoiceKey=t,r;',
  "capture requested stream voice key"
);
voice = replaceOnce(
  voice,
  'b({audio:l,provider:"gpt-sovits-stream",voiceKey:t,chars:e.length,tokenCost:0,latencyMs:0,seq:n.seq})',
  'b({audio:l,provider:"gpt-sovits-stream",voiceKey:SocratopiaTtsVoiceKey,chars:e.length,tokenCost:0,latencyMs:0,seq:n.seq})',
  "return requested stream voice key"
);
writeIfChanged(voicePath, voice, originalVoice);
commitPlannedWrites();
