/**
 * Pure, replayable mastery projection for adaptive teaching v2.
 *
 * Only authority-verified evidence contributes.  Wall-clock `review_due` is
 * derived by `deriveEffectiveProjection` and is never persisted in or hashed
 * into the base projection.
 */
(function () {
  "use strict";

  var ledger = require("./evidence-ledger.js");

  var RULES_VERSION = "mastery-rules-v1";
  var DEFAULT_RULES = Object.freeze({
    basicCorrect: 0.10,
    transferCorrect: 0.18,
    retentionCorrect: 0.20,
    lightHintCorrect: 0.05,
    heavyHintCorrect: 0.01,
    incorrect: -0.10,
    repeatedMisconception: -0.15,
    transferReviewDelayMs: 7 * 24 * 60 * 60 * 1000,
    retentionReviewDelayMs: 14 * 24 * 60 * 60 * 1000
  });

  function domainError(code, message, details) {
    var error = new Error(message);
    error.code = code;
    if (details) error.details = details;
    return error;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function roundScore(value) {
    return Math.round(value * 10000) / 10000;
  }

  function eventTime(event) {
    var time = Date.parse(event.createdAt);
    if (!Number.isFinite(time)) throw domainError("invalid_evidence_time", "Evidence createdAt must be an ISO-compatible timestamp", { eventId: event.eventId });
    return time;
  }

  function sortEvents(events) {
    return events.slice().sort(function (a, b) {
      return eventTime(a) - eventTime(b) || String(a.eventKey).localeCompare(String(b.eventKey)) || String(a.eventId).localeCompare(String(b.eventId));
    });
  }

  function mergeRules(custom) {
    return Object.assign({}, DEFAULT_RULES, custom || {});
  }

  function correctWeight(event, rules) {
    if (event.assistanceLevel === "heavy") return rules.heavyHintCorrect;
    if (event.assistanceLevel === "light") return rules.lightHintCorrect;
    if (event.evidenceType === "transfer") return rules.transferCorrect;
    if (event.evidenceType === "retention") return rules.retentionCorrect;
    return rules.basicCorrect;
  }

  function independentCorrect(event) {
    return event.outcome === "correct" && event.assistanceLevel === "none";
  }

  function addReason(reasons, reason) {
    if (reasons.indexOf(reason) < 0) reasons.push(reason);
  }

  function replayConcept(inputEvents, conceptId, options) {
    options = options || {};
    if (typeof conceptId !== "string" || conceptId === "") throw domainError("invalid_concept_id", "conceptId must be a non-empty string");
    var rules = mergeRules(options.rules);
    var ledgerView = ledger.buildLedgerView(inputEvents, options.ledgerOptions);
    var events = sortEvents(ledgerView.events.filter(function (event) {
      return event.conceptId === conceptId && ledger.isEligibleVerifiedEvidence(event, options.assessments && options.assessments[event.assessmentId]);
    }));

    var score = 0;
    var reasons = [];
    var graders = [];
    var misconceptions = Object.create(null);
    var hasIndependentBasic = false;
    var hasIndependentTransfer = false;
    var hasIndependentRetention = false;
    var heavyHintCorrect = false;
    var lastEvidenceOutcome = null;
    var lastEvidenceType = null;
    var latestMasteringTime = null;
    var latestMasteringType = null;

    events.forEach(function (event) {
      if (graders.indexOf(event.graderVersion) < 0) graders.push(event.graderVersion);
      lastEvidenceOutcome = event.outcome;
      lastEvidenceType = event.evidenceType;
      if (event.outcome === "correct") {
        score += correctWeight(event, rules);
        if (event.assistanceLevel === "heavy") {
          heavyHintCorrect = true;
          addReason(reasons, "HEAVY_HINT_CORRECT_NOT_INDEPENDENT");
        }
        if (independentCorrect(event)) {
          if (event.evidenceType === "transfer") {
            hasIndependentTransfer = true;
            addReason(reasons, "INDEPENDENT_TRANSFER_VERIFIED");
          } else if (event.evidenceType === "retention") {
            hasIndependentRetention = true;
            addReason(reasons, "INDEPENDENT_RETENTION_VERIFIED");
          } else if (event.evidenceType === "basic") {
            hasIndependentBasic = true;
            addReason(reasons, "INDEPENDENT_BASIC_VERIFIED");
          }
        }
      } else if (event.outcome === "incorrect") {
        score += rules.incorrect;
        addReason(reasons, "VERIFIED_INCORRECT");
      }

      if (event.misconceptionId) {
        misconceptions[event.misconceptionId] = (misconceptions[event.misconceptionId] || 0) + 1;
        if (misconceptions[event.misconceptionId] === 2) {
          score += rules.repeatedMisconception;
          addReason(reasons, "REPEATED_MISCONCEPTION");
        }
      }

      if (independentCorrect(event) && event.evidenceType === "retention") {
        latestMasteringTime = eventTime(event);
        latestMasteringType = "retention";
      } else if (independentCorrect(event) && event.evidenceType === "transfer") {
        latestMasteringTime = eventTime(event);
        latestMasteringType = "transfer";
      }
    });

    score = roundScore(clamp(score, 0, 1));
    var repeatedMisconceptions = Object.keys(misconceptions).filter(function (key) { return misconceptions[key] >= 2; }).sort();
    var baseState = "unseen";
    if (events.length > 0) baseState = "learning";
    if (hasIndependentBasic) baseState = "provisional";
    if (hasIndependentRetention || (hasIndependentBasic && hasIndependentTransfer)) baseState = "mastered";
    if (repeatedMisconceptions.length > 0 || (lastEvidenceOutcome === "incorrect" && (hasIndependentBasic || hasIndependentTransfer || hasIndependentRetention))) {
      baseState = "remediation";
      addReason(reasons, "VERIFIED_FAILURE_REQUIRES_REMEDIATION");
    }

    var nextReviewAt = null;
    if (baseState === "mastered" && latestMasteringTime !== null) {
      var delay = latestMasteringType === "retention" ? rules.retentionReviewDelayMs : rules.transferReviewDelayMs;
      nextReviewAt = new Date(latestMasteringTime + delay).toISOString();
      addReason(reasons, "REVIEW_SCHEDULED");
    }

    var conceptLedgerIdentity = events.map(function (event) {
      return {
        eventKey: event.eventKey,
        eventInputHash: event.eventInputHash,
        payloadHash: event.payloadHash,
        transactionId: event.transactionId
      };
    });
    var conceptLedgerViewHash = ledger.hashCanonical({ schemaVersion: 1, conceptId: conceptId, events: conceptLedgerIdentity });
    var projection = {
      schemaVersion: 1,
      conceptId: conceptId,
      baseState: baseState,
      score: score,
      nextReviewAt: nextReviewAt,
      reasonCodes: reasons,
      inputEventIds: events.map(function (event) { return event.eventId; }),
      graderVersions: graders.sort(),
      rulesVersion: options.rulesVersion || RULES_VERSION,
      ledgerViewHash: conceptLedgerViewHash,
      hasIndependentBasic: hasIndependentBasic,
      hasIndependentTransfer: hasIndependentTransfer,
      hasIndependentRetention: hasIndependentRetention,
      heavyHintCorrect: heavyHintCorrect,
      repeatedMisconceptions: repeatedMisconceptions,
      misconceptionCounts: Object.keys(misconceptions).sort().reduce(function (output, key) {
        output[key] = misconceptions[key];
        return output;
      }, {}),
      lastEvidenceOutcome: lastEvidenceOutcome,
      lastEvidenceType: lastEvidenceType
    };
    projection.projectionHash = ledger.hashCanonical(projection);
    return Object.freeze(projection);
  }

  function deriveEffectiveProjection(baseProjection, asOf) {
    if (!baseProjection || typeof baseProjection !== "object") throw domainError("invalid_projection", "baseProjection is required");
    var evaluationTime = Date.parse(asOf);
    if (!Number.isFinite(evaluationTime)) throw domainError("invalid_evaluation_time", "asOf must be an ISO-compatible timestamp");
    var effectiveState = baseProjection.baseState;
    if (baseProjection.baseState === "mastered" && baseProjection.nextReviewAt && evaluationTime >= Date.parse(baseProjection.nextReviewAt)) {
      effectiveState = "review_due";
    }
    return Object.freeze(Object.assign({}, baseProjection, {
      effectiveState: effectiveState,
      responseAsOf: new Date(evaluationTime).toISOString()
    }));
  }

  function replayMastery(inputEvents, options) {
    options = options || {};
    if (options.conceptId) return replayConcept(inputEvents, options.conceptId, options);
    var conceptIds = options.conceptIds ? options.conceptIds.slice() : Array.from(new Set((inputEvents || []).map(function (event) { return event.conceptId; }).filter(Boolean)));
    conceptIds.sort();
    return conceptIds.reduce(function (output, conceptId) {
      output[conceptId] = replayConcept(inputEvents, conceptId, options);
      return output;
    }, {});
  }

  function computeLedgerViewHash(inputEvents, conceptId, options) {
    return replayConcept(inputEvents, conceptId, options).ledgerViewHash;
  }

  module.exports = {
    RULES_VERSION: RULES_VERSION,
    DEFAULT_RULES: Object.assign({}, DEFAULT_RULES),
    replayConcept: replayConcept,
    replayMastery: replayMastery,
    calculateMastery: replayConcept,
    deriveEffectiveProjection: deriveEffectiveProjection,
    deriveEffectiveState: deriveEffectiveProjection,
    computeLedgerViewHash: computeLedgerViewHash,
    domainError: domainError
  };
})();
