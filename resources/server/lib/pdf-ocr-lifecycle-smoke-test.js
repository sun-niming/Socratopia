"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var coordinatorModule = require("./pdf-ocr-coordinator.js");

function deferred() {
  var resolve;
  var promise = new Promise(function (done) { resolve = done; });
  return { promise: promise, resolve: resolve };
}

async function main() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-ocr-lifecycle-"));
  var dir = path.join(root, "accounts", "account-a", "profiles", "p", "worlds", "w", "textbooks", "t");
  fs.mkdirSync(dir, { recursive: true });
  var pdf = path.join(dir, "book.pdf");
  fs.writeFileSync(pdf, "synthetic-pdf");
  var scope = { accountId: "account-a", profileId: "p", worldId: "w", textbookId: "t", sessionEpoch: 1 };
  var started = deferred();
  var release = deferred();
  var writes = 0;
  var purges = 0;
  var coordinator = coordinatorModule.createCoordinator({
    projectRoot: root,
    getAccountContext: function () { return { active: true, accountId: "account-a", sessionEpoch: 1 }; },
    cache: {
      initialize: async function () {},
      read: async function () { return null; },
      write: async function () { writes++; },
      purgeScope: async function () { purges++; },
    },
    workerRunner: async function () { return { pages: [{ page: 1, text: "" }], metadata: { numPages: 1 } }; },
    ocrRunner: async function () {
      started.resolve();
      await release.promise;
      return { pages: [{ page: 1, text: "删除前的敏感正文", language: "zh-Hans-CN" }] };
    },
  });
  await coordinator.initialize();
  var pending = coordinator.run({ command: "extract", filePath: pdf, startPage: 1, endPage: 1, scope: scope, expectedLanguage: "zh-Hans-CN" });
  await started.promise;
  await coordinator.purgeScope(scope);
  release.resolve();
  await assert.rejects(pending, function (error) { return error && error.code === "ocr_scope_stale"; });
  assert.strictEqual(writes, 0, "a pre-delete OCR task must never write cache after tombstone");
  assert.strictEqual(purges, 1);
  await assert.rejects(function () {
    return coordinator.run({ command: "extract", filePath: pdf, startPage: 1, endPage: 1, scope: scope, expectedLanguage: "zh-Hans-CN" });
  }, function (error) { return error && error.code === "ocr_scope_tombstoned"; });

  await coordinator.activateScope(scope);
  await assert.rejects(function () {
    return coordinator.purgeScope({ profileId: "p", worldId: "w", textbookId: "t" });
  }, function (error) { return error && error.code === "ocr_delivery_scope_stale"; });
  await assert.rejects(function () {
    return coordinator.activateScope({ profileId: "p", worldId: "w", textbookId: "t" });
  }, function (error) { return error && error.code === "ocr_delivery_scope_stale"; });
  var after = await coordinator.run({ command: "extract", filePath: pdf, startPage: 1, endPage: 1, scope: scope, expectedLanguage: "zh-Hans-CN" });
  assert.strictEqual(after.contiguousUsableEndPage, 1);
  assert.strictEqual(writes, 1);
  await coordinator.shutdown();

  var treeStarted = deferred();
  var treeRelease = deferred();
  var treeWrites = 0;
  var profilePurges = 0;
  var accountPurges = 0;
  var treeAccount = { active: true, accountId: "account-a", sessionEpoch: 1 };
  var treeCoordinator = coordinatorModule.createCoordinator({
    projectRoot: root,
    cacheRoot: path.join(root, ".private", "tree-cache"),
    getAccountContext: function () { return Object.assign({}, treeAccount); },
    cache: {
      initialize: async function () {},
      read: async function () { return null; },
      write: async function () { treeWrites++; },
      purgeScope: async function () {},
      purgeProfile: async function () { profilePurges++; },
      purgeAccount: async function () { accountPurges++; },
    },
    workerRunner: async function () { return { pages: [{ page: 1, text: "" }], metadata: { numPages: 1 } }; },
    ocrRunner: async function () {
      treeStarted.resolve();
      await treeRelease.promise;
      return { pages: [{ page: 1, text: "tree generation text", language: "en" }] };
    },
  });
  await treeCoordinator.initialize();
  var pendingTree = treeCoordinator.run({ command: "extract", filePath: pdf, startPage: 1, endPage: 1, scope: scope, expectedLanguage: "en" });
  await treeStarted.promise;
  await treeCoordinator.purgeTree({ accountId: "account-a", sessionEpoch: 1, profileId: "p", worldId: "w" });
  treeRelease.resolve();
  await assert.rejects(pendingTree, function (error) { return error && error.code === "ocr_scope_stale"; });
  assert.strictEqual(treeWrites, 0, "world purge must invalidate active OCR generations before cache delivery");
  assert.strictEqual(profilePurges, 1, "world purge must clear the containing profile cache tree");
  await assert.rejects(function () {
    return treeCoordinator.run({ command: "extract", filePath: pdf, startPage: 1, endPage: 1, scope: scope, expectedLanguage: "en" });
  }, function (error) { return error && error.code === "ocr_scope_tombstoned"; });
  await treeCoordinator.activateTree({ accountId: "account-a", sessionEpoch: 1, profileId: "p", worldId: "w" });
  var afterTreeActivation = await treeCoordinator.run({ command: "extract", filePath: pdf, startPage: 1, endPage: 1, scope: scope, expectedLanguage: "en" });
  assert.strictEqual(afterTreeActivation.contiguousUsableEndPage, 1, "reset activation must permit a fresh generation using the same logical IDs");
  treeAccount = { active: true, accountId: "account-b", sessionEpoch: 2 };
  await assert.rejects(function () {
    return treeCoordinator.purgeTree({ accountId: "account-a", sessionEpoch: 1, profileId: "p", worldId: "w" });
  }, function (error) { return error && error.code === "ocr_delivery_scope_stale"; });
  assert.strictEqual(profilePurges, 1, "a stale account fence must not purge the newly active account cache");
  assert.strictEqual(accountPurges, 0, "a stale account fence must not fall back to account-wide purge");
  treeAccount = { active: true, accountId: "account-a", sessionEpoch: 1 };
  await treeCoordinator.purgeTree({ accountId: "account-a", sessionEpoch: 1 });
  assert.strictEqual(accountPurges, 1, "account reset must clear the complete account OCR cache tree");
  await treeCoordinator.shutdown();

  var renderStarted = deferred();
  var renderRelease = deferred();
  var deliveryAccount = { active: true, accountId: "account-a", sessionEpoch: 1 };
  var renderCoordinator = coordinatorModule.createCoordinator({
    projectRoot: root,
    cacheRoot: path.join(root, ".private", "render-cache"),
    getAccountContext: function () { return Object.assign({}, deliveryAccount); },
    workerRunner: async function () {
      renderStarted.resolve();
      await renderRelease.promise;
      return { pages: [{ page: 1, pngB64: Buffer.from("account-a-page").toString("base64") }] };
    },
  });
  await renderCoordinator.initialize();
  var pendingRender = renderCoordinator.run({ command: "render", filePath: pdf, startPage: 1, endPage: 1, scope: scope });
  await renderStarted.promise;
  deliveryAccount = { active: true, accountId: "account-b", sessionEpoch: 2 };
  renderRelease.resolve();
  await assert.rejects(pendingRender, function (error) { return error && error.code === "ocr_delivery_scope_stale"; });
  await renderCoordinator.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
  var bundle = fs.readFileSync(path.join(__dirname, "..", ".next", "server", "chunks", "2751.js"), "utf8");
  assert(bundle.includes("ocrCoordinator.purgeScope({accountId:ocrOperation.accountId,sessionEpoch:ocrOperation.sessionEpoch,profileId:a,worldId:b,textbookId:c"), "textbook deletion must tombstone and purge through the request-bound account/session scope");
  assert(bundle.includes("ocrCoordinator.activateScope(pdfOcrScope)"), "PDF import must activate a fresh scope generation");
  assert(bundle.includes("let importCommitted=!1,indexCommitted=!1,activeCommitted=!1;try{"), "textbook import must track directory, catalog, and active-textbook commit state");
  assert(bundle.includes("importCommitted=!0"), "textbook import must commit only after catalog/current textbook writes complete");
  assert(bundle.includes("if(indexCommitted)try{let rollback=await y(b,e)"), "stale imports must roll back a catalog commit before cleanup");
  assert(bundle.includes("await importBuilder.cancelScope({accountId:ocrOperation.accountId,sessionEpoch:ocrOperation.sessionEpoch,profileId:b,worldId:e,textbookId:p})"), "failed import must await cancellation using the frozen request identity");
  assert(bundle.includes("await importOcr.purgeScope(pdfOcrScope)"), "failed import must tombstone and purge the request-bound OCR scope");
  assert(bundle.includes("await (0,d.rm)(r,{recursive:!0,force:!0})"), "failed import must remove only its exact textbook directory");
  var worldRoute = fs.readFileSync(path.join(__dirname, "..", ".next", "server", "app", "api", "world", "route.js"), "utf8");
  var profileRoute = fs.readFileSync(path.join(__dirname, "..", ".next", "server", "app", "api", "profile", "route.js"), "utf8");
  var resetRoute = fs.readFileSync(path.join(__dirname, "..", ".next", "server", "app", "api", "profile", "reset", "route.js"), "utf8");
  assert(worldRoute.includes("await d.cancelTree(_ocrTreeScope)") && worldRoute.includes("await e.purgeTree(_ocrTreeScope)"), "world deletion must use one fixed account/session tree scope before removal");
  assert(profileRoute.includes("await d.cancelTree(_ocrTreeScope)") && profileRoute.includes("await e.purgeTree(_ocrTreeScope)"), "profile deletion must use one fixed account/session tree scope before removal");
  assert(profileRoute.includes("c(79748).rm") && profileRoute.includes("(0,w.o3)(b)"), "profile deletion must remove the exact profile directory");
  assert(resetRoute.includes("await c.cancelTree(_ocrTreeScope)"), "profile reset must await all Builder jobs through the fixed account/session scope");
  assert(resetRoute.includes("await d.purgeTree(_ocrTreeScope)"), "profile reset must tombstone and purge only the request-bound account OCR tree");
  assert(resetRoute.includes("await d.activateTree(_ocrTreeScope)") && resetRoute.includes("await c.activateTree(_ocrTreeScope)"), "profile reset must reactivate the same fixed tree only after recreation");
  assert(!resetRoute.includes("catch{}return v.NextResponse.json({ok:!0})"), "profile reset must not report success after deletion failure");
  var serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert(serverSource.includes("visionBudget.cancelScope(scope)"), "textbook purge must cancel matching active remote vision before OCR cache tombstone");
  assert(serverSource.includes("visionBudget.cancelTree(scope)"), "profile/world/account purge must cancel matching active remote vision before OCR cache tombstone");
  console.log("pdf OCR lifecycle smoke: PASS");
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
