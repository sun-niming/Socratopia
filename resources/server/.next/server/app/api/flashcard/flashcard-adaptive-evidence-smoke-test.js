"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function HeadersFixture(input) {
  this.values = Object.create(null);
  if (input instanceof HeadersFixture) {
    var self = this;
    Object.keys(input.values).forEach(function (key) { self.values[key] = input.values[key]; });
  } else if (input && typeof input === "object") {
    var self2 = this;
    Object.keys(input).forEach(function (key) { self2.set(key, input[key]); });
  }
}
HeadersFixture.prototype.set = function (name, value) { this.values[String(name).toLowerCase()] = String(value); };
HeadersFixture.prototype.get = function (name) { return this.values[String(name).toLowerCase()] || null; };
HeadersFixture.prototype.has = function (name) { return Object.prototype.hasOwnProperty.call(this.values, String(name).toLowerCase()); };
HeadersFixture.prototype.delete = function (name) { delete this.values[String(name).toLowerCase()]; };

function loadRouteHelpers() {
  var routePath = path.join(__dirname, "route.js");
  var source = fs.readFileSync(routePath, "utf8");
  var start = source.indexOf("function _stageCService");
  var end = source.indexOf("function E(", start);
  assert(start >= 0 && end > start, "Stage C Flashcard helper block missing");
  var textbook = { textbookId: "textbook-a", cards: [] };
  var favorites = { cards: [] };
  var flags = { failTextbookWrite: false, failFavoriteWrite: false };
  var context = {
    console: { warn: function () {} },
    global: null,
    D: { pW: function (core) { return async function (req, ctx) { context.legacyCalls += 1; return core(req, ctx, null, null); }; } },
    v: { NextResponse: { json: function (body, options) { return { body: body, status: options && options.status || 200 }; } } },
    legacyCalls: 0,
    I: async function () { return clone(textbook); },
    J: async function (profileId, worldId, textbookId, value) {
      if (flags.failTextbookWrite) throw new Error("fixture textbook write failure");
      textbook = clone(value);
    },
    K: async function () { return clone(favorites); },
    L: async function (profileId, value) {
      if (flags.failFavoriteWrite) throw new Error("fixture favorite write failure");
      favorites = clone(value);
    },
    F: function (value) { if (!value || /[\\/]|\.\./.test(value)) throw new Error("Invalid path segment"); return value; },
    E: function (card, correct) {
      card.repetitions = Number(card.repetitions) || 0;
      card.interval = Number(card.interval) || 0;
      card.ease = Number(card.ease) || 2.5;
      if (correct) { card.repetitions += 1; card.interval = 1; }
      else { card.repetitions = 0; card.interval = 0; }
      card.nextReview = "2026-08-21T00:00:00.000Z";
      return card;
    },
    setTimeout: setTimeout,
    Promise: Promise,
    Date: Date,
    Number: Number,
    Array: Array,
    Error: Error,
    RegExp: RegExp
  };
  context.global = context;
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context, { filename: "flashcard-stage-c-helpers.js" });
  return {
    source: source,
    context: context,
    flags: flags,
    setTextbook: function (value) { textbook = clone(value); },
    getTextbook: function () { return clone(textbook); },
    setFavorites: function (value) { favorites = clone(value); },
    getFavorites: function () { return clone(favorites); }
  };
}

function makeService() {
  var tail = Promise.resolve();
  var recordCalls = [];
  var retryCalls = [];
  var specs = [];
  var sequence = [];
  var service = {
    statusForHandle: function (handle) { return { active: handle.active !== false, reasonCode: handle.active === false ? "adaptive_not_eligible" : null }; },
    bindingForHandle: function (handle) { return handle.binding; },
    withSourceLock: function (handle, binding, callback) {
      var run = tail.then(callback);
      tail = run.then(function () {}, function () {});
      return run;
    },
    prepareObservation: function (handle, spec) { specs.push(clone(spec)); return { spec: clone(spec) }; },
    finalizeObservation: function (handle, draft, meta) {
      return {
        schemaVersion: 1,
        source: "flashcard",
        sourceEventId: "sha256:flashcard-" + meta.domainRevision,
        domainRevision: meta.domainRevision,
        accountBindingHash: handle.binding,
        conceptResolution: { status: "resolved", conceptId: "concept-a" },
        gradingMode: "deterministic",
        observationInputHash: "sha256:observation-" + meta.domainRevision,
        eventInputHash: "sha256:event-input-" + meta.domainRevision,
        payload: { sourceEventId: "sha256:flashcard-" + meta.domainRevision },
        businessReceipt: clone(meta.businessReceipt),
        createdAt: meta.createdAt,
        sync: { state: "pending", attempts: 0, lastReasonCode: null, updatedAt: meta.createdAt },
        fixtureSpec: draft.spec
      };
    },
    recordPending: async function (handle, value) {
      sequence.push("record:" + value.domainRevision);
      recordCalls.push(clone(value));
      return value.fixtureSpec.answerKeyProvenance === "llm_generated"
        ? { state: "unverified", reasonCode: "answer_key_unverified" }
        : { state: "committed", reasonCode: null };
    },
    retryPending: async function (handle, value) {
      sequence.push("retry:" + value.domainRevision);
      retryCalls.push(clone(value));
      return { state: "duplicate", reasonCode: null };
    },
    publicSyncResult: function (result) {
      return { adaptiveSyncStatus: result.state === "unverified" ? "unverified_committed" : result.state, adaptiveSyncReason: result.reasonCode || null };
    },
    authorizeRequest: async function () { return { binding: "sha256:account-a", active: true }; },
    runAuthorized: async function (handle, callback) { return callback(); }
  };
  return { service: service, recordCalls: recordCalls, retryCalls: retryCalls, specs: specs, sequence: sequence };
}

function card(overrides) {
  return Object.assign({
    id: "card-a",
    question: "2 + 2?",
    choices: ["3", "4"],
    correctIndex: 1,
    source: { textbook: "Math", chapter: "Algebra", textbookSlug: "textbook-a" },
    history: [], interval: 0, ease: 2.5, repetitions: 0
  }, overrides || {});
}

function body(overrides) {
  return Object.assign({ action: "answer", profileId: "profile-a", worldId: "world-a", textbookId: "textbook-a", cardId: "card-a", chosenIndex: 0 }, overrides || {});
}

function extractModule(source) {
  var marker = "1292:";
  var start = source.indexOf(marker);
  var end = source.indexOf(",1551:", start);
  assert(start >= 0 && end > start, "module 1292 boundary missing");
  return source.slice(start + marker.length, end);
}

async function frontendChecks() {
  var files = [
    "page-3a1fef7566e26c43.js",
    "page-practice-ui-20260622.js",
    "page-practice-ui-20260625-jyfix.js",
    "page-87daa6ca210ab9dc.js"
  ].map(function (name) { return path.join(__dirname, "../../../../static/chunks/app", name); });
  var modules = files.map(function (file) { return extractModule(fs.readFileSync(file, "utf8")); });
  modules.slice(1).forEach(function (value) { assert.strictEqual(value, modules[0], "signed helper semantics must match across bundles"); });

  async function load(capability, fetchImpl) {
    var exports = {};
    var storageWrites = 0;
    function loader(id) { if (id === 1660) return { PU: function () { return "raw-account"; } }; throw new Error("unexpected module " + id); }
    loader.d = function (target, definitions) {
      Object.keys(definitions).forEach(function (key) { Object.defineProperty(target, key, { enumerable: true, get: definitions[key] }); });
    };
    var context = {
      window: { electronAPI: capability },
      Headers: HeadersFixture,
      fetch: fetchImpl,
      localStorage: { getItem: function () { return null; }, setItem: function () { storageWrites += 1; } },
      Error: Error
    };
    vm.createContext(context);
    var factory = vm.runInContext("(" + modules[0] + ")", context);
    factory({}, exports, loader);
    return { signed: exports.z, storageWrites: function () { return storageWrites; } };
  }

  var signedCalls = [];
  var loaded = await load({ getAdaptiveCapability: async function () { return "valid-capability-token-000"; } }, async function (url, init) {
    signedCalls.push({ url: url, init: init });
    return { ok: true, status: 200 };
  });
  await loaded.signed("/api/flashcard", { method: "POST", headers: { Authorization: "spoof", "X-Account-Id": "spoof" }, body: "{}" });
  assert.strictEqual(signedCalls.length, 1, "valid capability must issue exactly one fetch");
  assert.strictEqual(signedCalls[0].init.headers.get("X-Account-Id"), null, "signed request must strip raw account selector");
  assert.strictEqual(signedCalls[0].init.headers.get("Authorization"), "Socratopia valid-capability-token-000", "signed request must overwrite spoofed authorization");
  assert.strictEqual(loaded.storageWrites(), 0, "capability must never enter storage");

  var fallbackCalls = [];
  loaded = await load({}, async function (url, init) { fallbackCalls.push(init); return { ok: true, status: 200 }; });
  await loaded.signed("/api/practice", { method: "POST", headers: { Authorization: "spoofed-fallback-token", "X-Account-Id": "spoof" } });
  assert.strictEqual(fallbackCalls.length, 1, "preflight capability absence must fall back exactly once");
  assert.strictEqual(fallbackCalls[0].headers.get("X-Account-Id"), "raw-account", "legacy fallback should retain ordinary account selector");
  assert.strictEqual(fallbackCalls[0].headers.get("Authorization"), null, "legacy fallback must strip caller Authorization");

  var uncertainCalls = 0, uncertain = null;
  loaded = await load({ getAdaptiveCapability: async function () { return "valid-capability-token-000"; } }, async function () { uncertainCalls += 1; throw new Error("network includes secret"); });
  try { await loaded.signed("/api/practice", { method: "POST" }); } catch (error) { uncertain = error; }
  assert.strictEqual(uncertainCalls, 1, "uncertain signed mutation must not retry or fall back");
  assert(uncertain && uncertain.message === "stage_c_request_uncertain" && uncertain.message.indexOf("valid-capability") < 0, "uncertain error must be fixed and token-free");

  var forbiddenCalls = 0;
  loaded = await load({ getAdaptiveCapability: async function () { return "valid-capability-token-000"; } }, async function () { forbiddenCalls += 1; return { ok: false, status: 403 }; });
  var forbidden = await loaded.signed("/api/practice", { method: "POST" });
  assert.strictEqual(forbidden.status, 403, "401/403 response must pass through without fallback");
  assert.strictEqual(forbiddenCalls, 1, "401/403 must not retry");
  return 10;
}

async function main() {
  var count = 0;
  function ok(value, message) { assert(value, message); count += 1; }
  var fixture = loadRouteHelpers();
  var harness = makeService();
  var handle = { binding: "sha256:account-a", active: true };

  fixture.setTextbook({ textbookId: "textbook-a", cards: [card()] });
  fixture.setFavorites({ cards: [card({ status: "favorited" })] });
  var wrong = await fixture.context._answerFlashcard(body({ chosenIndex: 0, correct: true, isFavorite: false }), harness.service, handle);
  ok(wrong.status === 200 && wrong.body.correct === false, "forged correct=true must be recomputed as incorrect");
  var stored = fixture.getTextbook().cards[0];
  ok(stored.history[0].correct === false && stored.repetitions === 0, "canonical history and scheduling must use server correctness");
  ok(fixture.getFavorites().cards[0].history.length === 1, "body isFavorite must be ignored in favor of saved favorite replica");

  var right = await fixture.context._answerFlashcard(body({ chosenIndex: 1, correct: false }), harness.service, handle);
  ok(right.body.correct === true, "forged correct=false must be recomputed as correct");
  stored = fixture.getTextbook().cards[0];
  ok(stored.history.map(function (entry) { return entry.domainRevision; }).join(",") === "1,2", "canonical revisions must be monotonic");
  ok(harness.recordCalls.length === 2 && fixture.getFavorites().cards[0].history.every(function (entry) { return !entry.adaptiveEvidence; }), "favorite replica must not own a second pending intent or event");
  ok(right.body.adaptiveSyncStatus === "unverified_committed" && harness.specs[1].answerKeyProvenance === "llm_generated", "LLM-generated correctIndex must stay unverified");

  fixture.setTextbook({ textbookId: "textbook-a", cards: [] });
  var missing = await fixture.context._answerFlashcard(body(), harness.service, handle);
  ok(missing.status === 404 && harness.recordCalls.length === 2, "missing canonical card must return 404 before facade call");

  fixture.setTextbook({ textbookId: "textbook-a", cards: [card()] });
  fixture.flags.failTextbookWrite = true;
  var writeFailure = null;
  try { await fixture.context._answerFlashcard(body(), harness.service, handle); } catch (error) { writeFailure = error; }
  ok(writeFailure && harness.recordCalls.length === 2, "canonical write failure must call facade zero times");
  fixture.flags.failTextbookWrite = false;

  fixture.setFavorites({ cards: [card({ status: "favorited" })] });
  fixture.flags.failFavoriteWrite = true;
  var favoriteFailure = await fixture.context._answerFlashcard(body({ chosenIndex: 1 }), harness.service, handle);
  ok(favoriteFailure.status === 200 && fixture.getTextbook().cards[0].history.length === 1, "favorite replica failure must not roll back canonical commit");
  fixture.flags.failFavoriteWrite = false;

  fixture.setTextbook({ textbookId: "textbook-a", cards: [card()] });
  fixture.setFavorites({ cards: [] });
  await Promise.all([
    fixture.context._answerFlashcard(body({ chosenIndex: 0 }), harness.service, handle),
    fixture.context._answerFlashcard(body({ chosenIndex: 1 }), harness.service, handle)
  ]);
  stored = fixture.getTextbook().cards[0];
  ok(stored.history.map(function (entry) { return entry.domainRevision; }).join(",") === "1,2", "concurrent signed answers must receive unique revisions under source lock");

  var pendingCard = card({ history: [{
    schemaVersion: 2, domainRevision: 3, answerRecordId: "old", adaptiveEvidence: {
      schemaVersion: 1, sourceEventId: "sha256:old", domainRevision: 3,
      accountBindingHash: "sha256:account-a", observationInputHash: "sha256:old-observation",
      sync: { state: "retryable", attempts: 1 }
    }
  }] });
  fixture.setTextbook({ textbookId: "textbook-a", cards: [pendingCard] });
  var sequenceStart = harness.sequence.length;
  await fixture.context._answerFlashcard(body(), harness.service, handle);
  var sequence = harness.sequence.slice(sequenceStart);
  ok(sequence[0] === "retry:3" && sequence[1] === "record:4", "pending recovery must run before the new canonical event");

  var wrapperCoreCalls = 0;
  fixture.context.global.__ADAPTIVE_TEACHING_RUNTIME__ = { externalEvidence: harness.service };
  var wrapped = fixture.context._stageCWrapFlashcard(async function (req, ctx, service, authorizedHandle) {
    wrapperCoreCalls += 1;
    return { signed: !!authorizedHandle };
  });
  var signedReq = {
    headers: { get: function (name) { return name === "Authorization" ? "Socratopia valid-capability-token-000" : null; } },
    clone: function () { return { json: async function () { return body(); } }; }
  };
  var signedResult = await wrapped(signedReq, {});
  ok(signedResult.signed === true && fixture.context.legacyCalls === 0, "signed answer must bypass raw-account legacy wrapper");
  var unsignedReq = { headers: { get: function () { return null; } } };
  await wrapped(unsignedReq, {});
  ok(wrapperCoreCalls === 2 && fixture.context.legacyCalls === 1, "unsigned ordinary request must preserve legacy wrapper");

  ok(fixture.source.indexOf("correct:g,isFavorite:h") < 0, "route must not trust client correct/isFavorite fields");
  count += await frontendChecks();
  console.log("flashcard adaptive evidence smoke: " + count + "/" + count + " passed");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
