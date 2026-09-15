"use strict";

var crypto = require("crypto");
var evidence = require("./evidence-ledger.js");

var MIGRATION_VERSION = "stage-d-migration-v1";

function isRecord(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function hash(value) { return evidence.hashCanonical(value); }
function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(name + " must be a non-empty string");
  return value.normalize("NFC");
}
function subjectKey(value, salt) {
  return hash({ schemaVersion: 1, salt: requiredString(salt || "stage-d-migration-redaction", "salt"), value: requiredString(value, "subject") });
}

function recordsByType(snapshot) {
  return {
    transactions: Array.isArray(snapshot.transactions) ? snapshot.transactions : [],
    decisions: Array.isArray(snapshot.decisions) ? snapshot.decisions : [],
    executions: Array.isArray(snapshot.executions) ? snapshot.executions : [],
    executionEvents: Array.isArray(snapshot.executionEvents) ? snapshot.executionEvents : [],
    terminals: Array.isArray(snapshot.terminals) ? snapshot.terminals : [],
    evidenceEvents: Array.isArray(snapshot.evidenceEvents) ? snapshot.evidenceEvents : [],
    assessments: Array.isArray(snapshot.assessments) ? snapshot.assessments : []
  };
}

function cloneRecordForMigration(record, targetSchemaVersion, migration) {
  var copy = clone(record);
  var current = Number.isSafeInteger(copy.schemaVersion) ? copy.schemaVersion : 1;
  if (current > targetSchemaVersion) throw new Error("record schema is newer than target");
  while (current < targetSchemaVersion) {
    var key = current + "->" + (current + 1);
    if (!migration || typeof migration[key] !== "function") throw new Error("missing migration " + key);
    copy = migration[key](clone(copy));
    if (!isRecord(copy)) throw new Error("migration " + key + " returned a non-record");
    copy.schemaVersion = current + 1;
    current += 1;
  }
  return copy;
}

function planMigration(snapshot, options) {
  if (!isRecord(snapshot)) throw new Error("migration snapshot must be an object");
  options = options || {};
  var targetSchemaVersion = Number.isSafeInteger(options.targetSchemaVersion) ? options.targetSchemaVersion : 1;
  if (targetSchemaVersion < 1) throw new Error("targetSchemaVersion must be positive");
  var salt = requiredString(options.redactionSalt || "stage-d-migration-redaction", "redactionSalt");
  var records = recordsByType(snapshot);
  var beforeHash = hash(snapshot);
  var beforeCounts = {};
  var after = clone(snapshot);
  var changes = [];
  Object.keys(records).forEach(function (type) {
    beforeCounts[type] = records[type].length;
    after[type] = records[type].map(function (record, index) {
      var current = isRecord(record) && Number.isSafeInteger(record.schemaVersion) ? record.schemaVersion : 1;
      if (current === targetSchemaVersion) return clone(record);
      var migrated = cloneRecordForMigration(record, targetSchemaVersion, options.migrations || {});
      changes.push({ type: type, index: index, from: current, to: targetSchemaVersion });
      return migrated;
    });
  });
  var afterHash = hash(after);
  var scopes = new Set();
  records.evidenceEvents.concat(records.decisions, records.executions).forEach(function (record) {
    if (!isRecord(record)) return;
    var raw = [record.accountId, record.profileId, record.worldId, record.textbookId].filter(Boolean).join("\u0000");
    if (raw) scopes.add(subjectKey(raw, salt));
  });
  return Object.freeze({
    schemaVersion: 1,
    migrationVersion: MIGRATION_VERSION,
    targetSchemaVersion: targetSchemaVersion,
    beforeHash: beforeHash,
    afterHash: afterHash,
    changed: changes.length > 0,
    records: beforeCounts,
    changes: changes,
    scopeKeys: Array.from(scopes).sort(),
    risk: changes.length === 0 ? "none" : "non_destructive_in_memory_only",
    productionWrite: false,
    writesPerformed: 0,
    reversible: true
  });
}

function applyInMemory(snapshot, options) {
  if (!isRecord(snapshot)) throw new Error("migration snapshot must be an object");
  options = options || {};
  var targetSchemaVersion = Number.isSafeInteger(options.targetSchemaVersion) ? options.targetSchemaVersion : 1;
  var records = recordsByType(snapshot);
  var migrated = clone(snapshot);
  Object.keys(records).forEach(function (type) {
    migrated[type] = records[type].map(function (record) {
      return cloneRecordForMigration(record, targetSchemaVersion, options.migrations || {});
    });
  });
  return Object.freeze(migrated);
}

module.exports = {
  MIGRATION_VERSION: MIGRATION_VERSION,
  planMigration: planMigration,
  applyInMemory: applyInMemory
};
