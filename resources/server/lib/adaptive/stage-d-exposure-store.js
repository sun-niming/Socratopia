"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var evidence = require("./evidence-ledger.js");

var STORE_VERSION = "stage-d-exposure-store-v1";

function isRecord(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function hash(value) { return evidence.hashCanonical(value); }
function safeSegment(value, name) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 128 || /[\\/\x00-\x1F\x7F]/.test(value) || value.indexOf("..") >= 0) throw new Error(name + " is not a safe segment");
  return value.normalize("NFC");
}
function assertSanitized(record) {
  if (!isRecord(record)) throw new Error("exposure record must be an object");
  ["accountId", "profileId", "worldId", "textbookId", "sessionId", "conversationId", "executionId"].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(record, key)) throw new Error("raw exposure identifier forbidden: " + key);
  });
  if (typeof record.exposureId !== "string" || !/^sha256:/.test(record.exposureId)) throw new Error("exposureId must be hashed");
  if (typeof record.subjectKey !== "string" || !/^sha256:/.test(record.subjectKey)) throw new Error("subjectKey must be hashed");
  if (typeof record.cohortKey !== "string" || !/^sha256:/.test(record.cohortKey)) throw new Error("cohortKey must be hashed");
  return record;
}
function atomicWrite(file, value) {
  var temp = file + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
  fs.writeFileSync(temp, value, "utf8");
  fs.renameSync(temp, file);
}

function createExposureStore(options) {
  options = options || {};
  if (options.allowWrite !== true || options.writeToken !== "stage-d-explicit") throw new Error("stage-d exposure store requires explicit write authorization");
  var rootDir = path.resolve(String(options.rootDir || ""));
  if (!rootDir || rootDir === path.parse(rootDir).root) throw new Error("exposure rootDir must be explicit and narrow");
  var experimentId = safeSegment(options.experimentId, "experimentId");
  var file = path.join(rootDir, "stage-d", "exposures", experimentId + ".json");
  var rootCheck = path.resolve(rootDir, "stage-d", "exposures");
  if (!path.relative(rootDir, file) || path.relative(rootDir, file).startsWith("..")) throw new Error("exposure path escaped rootDir");

  function read() {
    if (!fs.existsSync(file)) return { schemaVersion: 1, storeVersion: STORE_VERSION, experimentId: experimentId, records: [] };
    var value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isRecord(value) || value.storeVersion !== STORE_VERSION || value.experimentId !== experimentId || !Array.isArray(value.records)) throw new Error("exposure store is invalid");
    value.records.forEach(assertSanitized);
    return value;
  }
  function append(record) {
    record = assertSanitized(clone(record));
    var state = read();
    var prior = state.records.find(function (value) { return value.exposureId === record.exposureId; });
    if (prior) {
      if (hash(prior) !== hash(record)) throw new Error("exposure_conflict");
      return Object.freeze({ state: "duplicate", exposureId: record.exposureId });
    }
    state.records.push(record);
    state.records.sort(function (left, right) { return String(left.exposedAt).localeCompare(String(right.exposedAt)) || left.exposureId.localeCompare(right.exposureId); });
    fs.mkdirSync(rootCheck, { recursive: true });
    atomicWrite(file, JSON.stringify(state, null, 2));
    return Object.freeze({ state: "committed", exposureId: record.exposureId });
  }
  function list() { return read().records.map(clone); }
  return Object.freeze({ version: STORE_VERSION, file: file, append: append, list: list });
}

module.exports = {
  STORE_VERSION: STORE_VERSION,
  createExposureStore: createExposureStore,
  assertSanitized: assertSanitized
};
