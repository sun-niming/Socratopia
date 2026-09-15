"use strict";

var crypto = require("crypto");
var evidence = require("./evidence-ledger.js");

var METRICS_VERSION = "stage-d-metrics-v1";
var EXPOSURE_VERSION = "stage-d-exposure-v1";

function isRecord(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function hash(value) { return evidence.hashCanonical(value); }
function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(name + " must be a non-empty string");
  return value.normalize("NFC");
}
function boundedNumber(value, name, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(name + " is outside bounds");
  return value;
}
function subjectKey(accountId, profileId, salt) {
  return hash({ schemaVersion: 1, salt: requiredString(salt || "stage-d-subject-redaction", "salt"), accountId: requiredString(accountId, "accountId"), profileId: requiredString(profileId, "profileId") });
}
function cohortId(experimentId, version, salt) {
  return hash({ schemaVersion: 1, salt: requiredString(salt || "stage-d-cohort-redaction", "salt"), experimentId: requiredString(experimentId, "experimentId"), version: requiredString(version, "experimentVersion") });
}
function bucket(subject, seed) {
  var digest = crypto.createHash("sha256").update(String(seed) + "\u0000" + String(subject), "utf8").digest("hex");
  return parseInt(digest.slice(0, 8), 16) % 10000;
}

function assignCohort(input) {
  if (!isRecord(input)) throw new Error("cohort input must be an object");
  var experimentId = requiredString(input.experimentId, "experimentId");
  var experimentVersion = requiredString(input.experimentVersion, "experimentVersion");
  var accountId = requiredString(input.accountId, "accountId");
  var profileId = requiredString(input.profileId, "profileId");
  var arms = Array.isArray(input.arms) ? input.arms.filter(function (arm) { return typeof arm === "string" && arm.trim() !== ""; }).map(function (arm) { return arm.trim(); }) : [];
  if (arms.length < 2 || arms.length > 16) throw new Error("cohort requires 2-16 arms");
  var salt = input.redactionSalt || "stage-d-cohort-redaction";
  var subject = subjectKey(accountId, profileId, salt);
  var slot = bucket(subject, experimentId + "\u0000" + experimentVersion) % arms.length;
  return Object.freeze({
    schemaVersion: 1,
    exposureVersion: EXPOSURE_VERSION,
    experimentId: experimentId,
    experimentVersion: experimentVersion,
    cohortKey: cohortId(experimentId, experimentVersion, salt),
    subjectKey: subject,
    arm: arms[slot],
    bucket: bucket(subject, experimentId + "\u0000" + experimentVersion),
    arms: arms.slice()
  });
}

function createExposure(input) {
  if (!isRecord(input) || !isRecord(input.assignment)) throw new Error("exposure assignment is required");
  var assignment = input.assignment;
  var at = requiredString(input.exposedAt, "exposedAt");
  if (!Number.isFinite(Date.parse(at))) throw new Error("exposedAt must be an ISO timestamp");
  var record = {
    schemaVersion: 1,
    exposureVersion: EXPOSURE_VERSION,
    exposureId: null,
    experimentId: requiredString(assignment.experimentId, "experimentId"),
    experimentVersion: requiredString(assignment.experimentVersion, "experimentVersion"),
    cohortKey: requiredString(assignment.cohortKey, "cohortKey"),
    subjectKey: requiredString(assignment.subjectKey, "subjectKey"),
    arm: requiredString(assignment.arm, "arm"),
    eligible: input.eligible === true,
    exposed: input.exposed === true,
    fallback: input.fallback === true,
    fallbackCode: input.fallbackCode == null ? null : requiredString(input.fallbackCode, "fallbackCode"),
    executionKey: input.executionId == null ? null : hash({ executionId: requiredString(input.executionId, "executionId") }),
    verifiedEvidenceCount: Number.isSafeInteger(input.verifiedEvidenceCount) ? input.verifiedEvidenceCount : 0,
    latencyMs: input.latencyMs == null ? null : boundedNumber(input.latencyMs, "latencyMs", 0, 86400000),
    exposedAt: new Date(Date.parse(at)).toISOString()
  };
  if (record.verifiedEvidenceCount < 0) throw new Error("verifiedEvidenceCount must be non-negative");
  record.exposureId = hash(record);
  return Object.freeze(record);
}

function percentile(values, p) {
  if (!values.length) return null;
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  var index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function aggregateMetrics(records) {
  if (!Array.isArray(records)) throw new Error("metric records must be an array");
  var arms = {};
  var subjects = new Map();
  var latency = [];
  var crossArm = [];
  records.forEach(function (record) {
    if (!isRecord(record)) throw new Error("metric record must be an object");
    var arm = requiredString(record.arm, "arm");
    var item = arms[arm] || (arms[arm] = { exposures: 0, eligible: 0, exposed: 0, fallback: 0, executions: 0, verifiedEvidence: 0, latencyMs: [] });
    item.exposures += 1;
    if (record.eligible === true) item.eligible += 1;
    if (record.exposed === true) item.exposed += 1;
    if (record.fallback === true) item.fallback += 1;
    if (record.executionKey) item.executions += 1;
    item.verifiedEvidence += Number.isSafeInteger(record.verifiedEvidenceCount) ? record.verifiedEvidenceCount : 0;
    if (typeof record.latencyMs === "number" && Number.isFinite(record.latencyMs)) { item.latencyMs.push(record.latencyMs); latency.push(record.latencyMs); }
    if (record.subjectKey) {
      var prior = subjects.get(record.subjectKey) || new Set();
      prior.add(arm);
      subjects.set(record.subjectKey, prior);
    }
  });
  subjects.forEach(function (assigned, subject) { if (assigned.size > 1) crossArm.push(hash({ subject: subject })); });
  var outputArms = {};
  Object.keys(arms).sort().forEach(function (arm) {
    var item = arms[arm];
    outputArms[arm] = {
      exposures: item.exposures,
      eligible: item.eligible,
      exposed: item.exposed,
      fallback: item.fallback,
      fallbackRate: item.exposures ? item.fallback / item.exposures : 0,
      executions: item.executions,
      verifiedEvidence: item.verifiedEvidence,
      p50LatencyMs: percentile(item.latencyMs, 0.5),
      p95LatencyMs: percentile(item.latencyMs, 0.95)
    };
  });
  return Object.freeze({
    schemaVersion: 1,
    metricsVersion: METRICS_VERSION,
    totalRecords: records.length,
    totalSubjects: subjects.size,
    crossArmSubjectCount: crossArm.length,
    crossArmSubjectKeys: crossArm.sort(),
    totalLatencyP50Ms: percentile(latency, 0.5),
    totalLatencyP95Ms: percentile(latency, 0.95),
    arms: outputArms,
    rawIdentifiersEmitted: false
  });
}

function evaluateThresholds(metrics, thresholds) {
  if (!isRecord(metrics)) throw new Error("metrics are required");
  thresholds = thresholds || {};
  var failures = [];
  var minExposures = Number.isSafeInteger(thresholds.minExposures) ? thresholds.minExposures : 1;
  var maxFallbackRate = typeof thresholds.maxFallbackRate === "number" ? thresholds.maxFallbackRate : 0.25;
  var maxP95LatencyMs = typeof thresholds.maxP95LatencyMs === "number" ? thresholds.maxP95LatencyMs : 30000;
  var maxCrossArmSubjects = Number.isSafeInteger(thresholds.maxCrossArmSubjects) ? thresholds.maxCrossArmSubjects : 0;
  var minVerifiedEvidence = Number.isSafeInteger(thresholds.minVerifiedEvidence) ? thresholds.minVerifiedEvidence : 1;
  Object.keys(metrics.arms || {}).forEach(function (arm) {
    var item = metrics.arms[arm];
    if (item.exposures < minExposures) failures.push("min_exposures:" + arm);
    if (item.fallbackRate > maxFallbackRate) failures.push("fallback_rate:" + arm);
    if (item.p95LatencyMs !== null && item.p95LatencyMs > maxP95LatencyMs) failures.push("latency_p95:" + arm);
    if (item.verifiedEvidence < minVerifiedEvidence) failures.push("verified_evidence:" + arm);
  });
  if (metrics.crossArmSubjectCount > maxCrossArmSubjects) failures.push("cross_arm_contamination");
  return Object.freeze({
    schemaVersion: 1,
    metricsVersion: METRICS_VERSION,
    safeToExpand: failures.length === 0,
    failures: failures,
    thresholds: clone({ minExposures: minExposures, maxFallbackRate: maxFallbackRate, maxP95LatencyMs: maxP95LatencyMs, maxCrossArmSubjects: maxCrossArmSubjects, minVerifiedEvidence: minVerifiedEvidence })
  });
}

module.exports = {
  METRICS_VERSION: METRICS_VERSION,
  EXPOSURE_VERSION: EXPOSURE_VERSION,
  assignCohort: assignCohort,
  createExposure: createExposure,
  aggregateMetrics: aggregateMetrics,
  evaluateThresholds: evaluateThresholds
};
