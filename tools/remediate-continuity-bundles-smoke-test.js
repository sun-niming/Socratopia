"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");

var sourceRoot = path.resolve(__dirname, "..");
var remediationScript = path.join(__dirname, "remediate-continuity-bundles.js");
var files = [
  "resources/server/.next/server/app/api/chat/route.js",
  "resources/server/.next/server/chunks/829.js",
  "resources/server/.next/static/chunks/4137-131d0676e3b5bef7.js",
];

function target(root, relative) {
  return path.join(root, relative.split("/").join(path.sep));
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function reverseOnce(source, patched, legacy, label) {
  assert(source.includes(patched), "fixture lacks patched " + label);
  return source.replace(patched, legacy);
}

function seedLegacy(root) {
  files.forEach(function (relative) {
    write(target(root, relative), fs.readFileSync(target(sourceRoot, relative), "utf8"));
  });
  var chatFile = target(root, files[0]);
  var worldFile = target(root, files[1]);
  var voiceFile = target(root, files[2]);
  var chat = fs.readFileSync(chatFile, "utf8");
  chat = reverseOnce(chat,
    'let _ccEndAnchor=null;try{if(ac&&global.__RESUME__&&global.__RESUME__.resolveEndClassAnchor&&global.__RESUME__.normalizeProgressMdPage){let _session=O?v.dq.get(O):null,_anchor=global.__RESUME__.resolveEndClassAnchor({textbookDir:(0,B.Uu)(x,C,ac),progressMdText:a.progressMd,currentPage:null,windowStartPage:_session?.windowStartPage,windowEndPage:_session?.windowEndPage});if(_anchor&&_anchor.page){_ccEndAnchor=Number(_anchor.page),a.progressMd=global.__RESUME__.normalizeProgressMdPage(a.progressMd,_ccEndAnchor,_anchor.windowStartPage||_session?.windowStartPage||_ccEndAnchor)}}}catch(e2){console.warn("[end-class] progress.md page normalization failed:",e2?.message||e2)}',
    'try{if(ac&&global.__RESUME__&&global.__RESUME__.resolveEndClassAnchor&&global.__RESUME__.normalizeProgressMdPage){let _session=O?v.dq.get(O):null,_anchor=global.__RESUME__.resolveEndClassAnchor({textbookDir:(0,B.Uu)(x,C,ac),progressMdText:a.progressMd,currentPage:null,windowStartPage:_session?.windowStartPage,windowEndPage:_session?.windowEndPage});if(_anchor&&_anchor.page)a.progressMd=global.__RESUME__.normalizeProgressMdPage(a.progressMd,_anchor.page,_anchor.windowStartPage||_session?.windowStartPage||_anchor.page)}}catch(e2){console.warn("[end-class] progress.md page normalization failed:",e2?.message||e2)}', "anchor");
  assert.strictEqual(chat.split('scope:{accountId:_ccSnapshot.accountId,sessionEpoch:_ccSnapshot.sessionEpoch,profileId:x,worldId:C,conversationId:O}').length - 1, 3);
  chat = chat.split('scope:{accountId:_ccSnapshot.accountId,sessionEpoch:_ccSnapshot.sessionEpoch,profileId:x,worldId:C,conversationId:O}').join('scope:{accountId:_ccSnapshot.accountId,profileId:x,worldId:C,conversationId:O}');
  chat = reverseOnce(chat, 'let _ccState=O?v.dq.get(O):null,_ccPage=Number.isInteger(_ccEndAnchor)&&_ccEndAnchor>0?_ccEndAnchor:(_ccState?.windowStartPage??null),_ccCleanup=[];', 'let _ccState=O?v.dq.get(O):null,_ccCleanup=[];', "page derivation");
  chat = reverseOnce(chat, 'endingPage:_ccPage', 'endingPage:_ccState?.windowEndPage??null', "ending page");
  chat = reverseOnce(chat, 'if(ac&&null!=_ccPage)try{await (0,j.fU)(x,C,ac,_ccPage)}', 'if(ac&&null!=_ccState?.windowEndPage)try{await (0,j.fU)(x,C,ac,_ccState.windowEndPage)}', "page sync");
  write(chatFile, chat);

  var world = fs.readFileSync(worldFile, "utf8");
  world = reverseOnce(world, ':(z?.companionInstanceId||(global.__COMPANION_CONTINUITY__&&"function"==typeof global.__COMPANION_CONTINUITY__.newCompanionInstanceId?global.__COMPANION_CONTINUITY__.newCompanionInstanceId():"ci_"+Date.now().toString(36)+Math.random().toString(36).slice(2,18)));', ':z?.companionInstanceId||global.__COMPANION_CONTINUITY__&&"function"==typeof global.__COMPANION_CONTINUITY__.newCompanionInstanceId?global.__COMPANION_CONTINUITY__.newCompanionInstanceId():"ci_"+Date.now().toString(36)+Math.random().toString(36).slice(2,18);', "companion instance");
  write(worldFile, world);

  var voice = fs.readFileSync(voiceFile, "utf8");
  voice = reverseOnce(voice, 'async function SocratopiaClassicStream(e,t,n,l){let SocratopiaTtsVoiceKey=t,r;', 'async function SocratopiaClassicStream(e,t,n,l){let r;', "voice capture");
  voice = reverseOnce(voice, 'voiceKey:SocratopiaTtsVoiceKey,chars:e.length', 'voiceKey:t,chars:e.length', "voice return");
  write(voiceFile, voice);
}

function snapshot(root) {
  return files.map(function (relative) { return fs.readFileSync(target(root, relative), "utf8"); });
}

function runTool(root, faultIndex) {
  var env = Object.assign({}, process.env, { SOCRATOPIA_REMEDIATION_ROOT: root });
  if (faultIndex !== undefined) env.SOCRATOPIA_REMEDIATION_FAULT_INDEX = String(faultIndex);
  return childProcess.spawnSync(process.execPath, [remediationScript], { encoding: "utf8", env: env });
}

function assertNoArtifacts(root) {
  var found = [];
  function walk(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
      var file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.includes(".continuity-remediation-")) found.push(file);
    });
  }
  walk(root);
  assert.deepStrictEqual(found, []);
}

function run() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "continuity-bundle-tx-"));
  try {
    seedLegacy(root);
    var legacy = snapshot(root);
    write(target(root, files[2]), legacy[2].replace('async function SocratopiaClassicStream(e,t,n,l){let r;', 'async function SocratopiaClassicStream(e,t,n,l){let incompatibleOldResource;'));
    var conflict = snapshot(root);
    var result = runTool(root);
    assert.notStrictEqual(result.status, 0, "old-resource conflict must fail closed");
    assert.deepStrictEqual(snapshot(root), conflict, "preflight conflict must not partially patch chat or companion resources");

    write(target(root, files[2]), legacy[2]);
    var beforeFault = snapshot(root);
    result = runTool(root, 1);
    assert.notStrictEqual(result.status, 0, "injected commit fault must fail");
    assert.deepStrictEqual(snapshot(root), beforeFault, "commit fault must roll back every resource");
    assertNoArtifacts(root);

    result = runTool(root);
    assert.strictEqual(result.status, 0, result.stderr);
    var patched = snapshot(root);
    assert(patched[1].includes(':(z?.companionInstanceId||(global.__COMPANION_CONTINUITY__'), "companion resource must preserve its instance identity");
    result = runTool(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(snapshot(root), patched, "second remediation must be idempotent");
    assertNoArtifacts(root);
    console.log("PASS continuity bundle preflight conflict, transaction rollback, commit, and idempotence");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
