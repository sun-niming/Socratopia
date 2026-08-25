"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var stream = require("stream");
var coordinatorModule = require("./kb-builder-coordinator.js");

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function deferred() {
  var resolve;
  var promise = new Promise(function (done) { resolve = done; });
  return { promise: promise, resolve: resolve };
}

async function main() {
  var deniedEnv = coordinatorModule.minimalEnvironment({ sandboxDir: "x", sourceSandboxPath: "y", workerFormat: "pdf", title: "t", language: "chinese", allowRemoteVision: false }, { card: { model: "card", maxInput: 8000 }, premium: null, vision: { model: "ocr-vision" } }, "");
  assert.strictEqual(deniedEnv.KB_ALLOW_REMOTE_VISION, "0");
  assert.strictEqual(deniedEnv.KB_VISION_MODEL, "", "a configured OCR model must not reach a worker without per-job consent");
  var allowedEnv = coordinatorModule.minimalEnvironment({ sandboxDir: "x", sourceSandboxPath: "y", workerFormat: "pdf", title: "t", language: "chinese", allowRemoteVision: true }, { card: { model: "card", maxInput: 8000 }, premium: null, vision: { model: "ocr-vision" } }, "");
  assert.strictEqual(allowedEnv.KB_ALLOW_REMOTE_VISION, "1");
  assert.strictEqual(allowedEnv.KB_VISION_MODEL, "ocr-vision");

  var boundedInput = new stream.PassThrough();
  var boundedError = new Promise(function (resolve) {
    coordinatorModule.createBoundedFrameReader(boundedInput, { maxFrameBytes: 1024, maxTotalBytes: 4096, maxFrames: 2 }, function () {
      assert.fail("oversized no-newline frame must not be delivered");
    }, resolve);
  });
  boundedInput.write(Buffer.alloc(1025, 65));
  var frameError = await boundedError;
  assert.strictEqual(frameError.code, "builder_protocol_limit");

  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-builder-coordinator-"));
  var textbookDir = path.join(root, "accounts", "account-a", "profiles", "profile", "worlds", "world", "textbooks", "book");
  fs.mkdirSync(textbookDir, { recursive: true });
  fs.writeFileSync(path.join(textbookDir, "_kb_src.md"), "# supervised source\n\ncontent", "utf8");
  var fixture = path.join(root, "fixture-builder.js");
  fs.writeFileSync(fixture, [
    '"use strict";',
    'var fs=require("fs"),path=require("path"),readline=require("readline");',
    'var root=process.env.KB_TEXTBOOK_DIR,source=process.env.KB_SRC_PATH;',
    'if(!root||!source||path.dirname(source)!==root||/accounts[\\\\/]/.test(root))process.exit(8);',
    'if(process.env.KB_TITLE==="hang"){setInterval(function(){},1000);return;}',
    'var stage=path.join(root,"knowledge_base.__building__"),cards=path.join(stage,"cards");',
    'fs.mkdirSync(cards,{recursive:true});',
    'var id="001_test";',
    'fs.writeFileSync(path.join(cards,id+".json"),JSON.stringify({concept_id:id,title:"Test",definition:"Definition",source_pages:[1,1]}));',
    'fs.writeFileSync(path.join(stage,"index.json"),JSON.stringify({card_count:1,cards:[{concept_id:id,title:"Test",source_pages:[1,1]}]}));',
    'fs.writeFileSync(path.join(stage,"teaching_map.json"),JSON.stringify({version:3,segments:[{sequence:[{card_ids:[id]}]}]}));',
    'fs.writeFileSync(path.join(stage,"build_status.json"),JSON.stringify({state:"done",activationEligible:true,cardCount:1}));',
    'var input=fs.createReadStream(null,{fd:6,autoClose:false});',
    'var responses=readline.createInterface({input:input,crlfDelay:Infinity});',
    'var writer=fs.createWriteStream(null,{fd:5,autoClose:false});',
    'responses.once("line",function(line){var msg=JSON.parse(line);if(!msg.ok)process.exit(9);writer.end();responses.close();input.destroy();setTimeout(function(){process.exit(0)},400);});',
    'writer.write(JSON.stringify({v:1,type:"publish"})+"\\n");'
  ].join("\n"), "utf8");

  var account = { active: true, accountId: "account-a", sessionEpoch: 1 };
  var publishRaceStarted = deferred();
  var publishRaceRelease = deferred();
  var coordinator = coordinatorModule.createBuilderCoordinator({
    projectRoot: root,
    workerPath: fixture,
    getAccountContext: function () { return account; },
    getModelSet: function () { return { kb: { baseUrl: "http://127.0.0.1:9/v1", apiKey: "test", model: "test-model" } }; },
    beforeArtifactCopy: async function (job) {
      if (job.title !== "publish-race") return;
      publishRaceStarted.resolve();
      await publishRaceRelease.promise;
    },
  });
  var build = coordinator.enqueue({ profileId: "profile", worldId: "world", textbookId: "book", format: "markdown", title: "normal" });
  await delay(200);
  assert.strictEqual(fs.existsSync(path.join(textbookDir, "knowledge_base")), false, "sealed artifacts must not publish while child is alive");
  var result = await build;
  assert.strictEqual(result.ok, true);
  var finalDir = path.join(textbookDir, "knowledge_base");
  assert.strictEqual(fs.existsSync(path.join(finalDir, "artifact_manifest.json")), true, "parent must add artifact hash manifest");
  var manifest = JSON.parse(fs.readFileSync(path.join(finalDir, "artifact_manifest.json"), "utf8"));
  assert.strictEqual(manifest.artifacts.length, 4);
  assert(manifest.artifacts.every(function (item) { return /^[a-f0-9]{64}$/.test(item.sha256); }));

  var raceDir = path.join(root, "accounts", "account-a", "profiles", "profile", "worlds", "world", "textbooks", "race-book");
  fs.mkdirSync(raceDir, { recursive: true });
  fs.writeFileSync(path.join(raceDir, "_kb_src.md"), "# publish race source", "utf8");
  var publishRace = coordinator.enqueue({ profileId: "profile", worldId: "world", textbookId: "race-book", format: "markdown", title: "publish-race" });
  await publishRaceStarted.promise;
  var cancelRace = coordinator.cancelScope({ accountId: "account-a", sessionEpoch: 1, profileId: "profile", worldId: "world", textbookId: "race-book" });
  publishRaceRelease.resolve();
  await cancelRace;
  await assert.rejects(publishRace, function (error) { return error && error.code === "builder_scope_cancelled"; });
  assert.strictEqual(fs.existsSync(path.join(raceDir, "knowledge_base")), false, "a close-to-publish cancellation must not publish durable artifacts");
  assert.strictEqual(fs.existsSync(path.join(raceDir, "knowledge_base.__building__")), false, "a cancelled publish race must remove its exact real staging directory");

  var hanging = coordinator.enqueue({ profileId: "profile", worldId: "world", textbookId: "book", format: "markdown", title: "hang" });
  await delay(150);
  await coordinator.cancelScope({ accountId: "account-a", sessionEpoch: 1, profileId: "profile", worldId: "world", textbookId: "book" });
  await assert.rejects(hanging, function (error) { return error && error.code === "builder_scope_cancelled"; });
  await assert.rejects(function () {
    return coordinator.cancelScope({ profileId: "profile", worldId: "world", textbookId: "book" });
  }, function (error) { return error && error.code === "builder_account_changed"; });

  var treeHanging = coordinator.enqueue({ profileId: "profile", worldId: "world", textbookId: "book", format: "markdown", title: "hang" });
  await delay(150);
  await coordinator.cancelTree({ accountId: "account-a", sessionEpoch: 1, profileId: "profile", worldId: "world" });
  await assert.rejects(treeHanging, function (error) { return error && error.code === "builder_scope_cancelled"; });
  await assert.rejects(function () {
    return coordinator.enqueue({ profileId: "profile", worldId: "world", textbookId: "book", format: "markdown", title: "normal" });
  }, function (error) { return error && error.code === "builder_scope_tombstoned"; });
  await coordinator.activateTree({ accountId: "account-a", sessionEpoch: 1, profileId: "profile", worldId: "world" });
  var afterTreeActivation = await coordinator.enqueue({ profileId: "profile", worldId: "world", textbookId: "book", format: "markdown", title: "normal" });
  assert.strictEqual(afterTreeActivation.ok, true, "reset activation must permit a new Builder job using the same logical IDs");
  await assert.rejects(function () { return coordinator.cancelTree({ accountId: "account-a", sessionEpoch: 1, profileId: "../escape" }); }, function (error) {
    return error && error.code === "builder_scope_invalid";
  });
  await assert.rejects(function () { return coordinator.activateTree({ accountId: "account-a", sessionEpoch: 1, worldId: "world" }); }, function (error) {
    return error && error.code === "builder_scope_invalid";
  });
  account = { active: true, accountId: "account-b", sessionEpoch: 2 };
  await assert.rejects(function () {
    return coordinator.cancelTree({ accountId: "account-a", sessionEpoch: 1, profileId: "profile", worldId: "world" });
  }, function (error) { return error && error.code === "builder_account_changed"; });
  await coordinator.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
  console.log("KB Builder coordinator smoke: PASS");
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
