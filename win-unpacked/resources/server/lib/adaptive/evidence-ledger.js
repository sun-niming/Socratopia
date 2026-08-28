/**
 * Pure immutable evidence-ledger rules for adaptive teaching v2.
 *
 * Persistence and transaction visibility live outside this module.  Callers
 * pass an already committed/prospective event set (or an explicit committed
 * transaction filter); this module validates, deduplicates and hashes it.
 */
(function () {
  "use strict";

  var crypto = require("crypto");
  var assessmentEngine = require("./assessment-engine.js");

  function domainError(code, message, details) {
    var error = new Error(message);
    error.code = code;
    if (details) error.details = details;
    return error;
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function canonicalValue(value) {
    if (value === null || typeof value === "boolean" || typeof value === "string") {
      return typeof value === "string" ? value.normalize("NFC") : value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw domainError("invalid_canonical_number", "Canonical JSON does not support non-finite numbers");
      return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (isObject(value)) {
      var output = {};
      Object.keys(value).sort().forEach(function (key) {
        if (value[key] !== undefined) output[key.normalize("NFC")] = canonicalValue(value[key]);
      });
      return output;
    }
    throw domainError("invalid_canonical_value", "Unsupported value in canonical JSON: " + typeof value);
  }

  function canonicalJson(value) {
    return JSON.stringify(canonicalValue(value));
  }

  function hashCanonical(value) {
    return "sha256:" + crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  }

  function stableString(value, name) {
    if (typeof value !== "string" || value.trim() === "") throw domainError("invalid_evidence", name + " must be a non-empty string");
    return value.normalize("NFC");
  }

  function normalizedIdSet(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map(function (value) {
      return stableString(value, "event reference");
    }))).sort();
  }

  function eventIdentity(input) {
    var scope = {
      accountId: stableString(input.accountId, "accountId"),
      profileId: stableString(input.profileId, "profileId"),
      worldId: stableString(input.worldId, "worldId"),
      textbookId: stableString(input.textbookId, "textbookId")
    };
    var source = stableString(input.source || "classroom", "source");
    if (source === "classroom") {
      return {
        schemaVersion: 1,
        source: source,
        scope: scope,
        sessionId: stableString(input.sessionId, "sessionId"),
        turnId: stableString(input.turnId, "turnId"),
        assessmentId: stableString(input.assessmentId || input.evidenceType, "assessmentId")
      };
    }
    return {
      schemaVersion: 1,
      source: source,
      scope: scope,
      sourceEventId: stableString(input.sourceEventId, "sourceEventId")
    };
  }

  function deriveEventKey(input) {
    return "evidence:" + hashCanonical(eventIdentity(input)).slice("sha256:".length, "sha256:".length + 40);
  }

  function inputIdentity(input) {
    var scoringResult = input.scoringResult || {};
    var assessment = input.assessment || {};
    var diagnosis = input.diagnosis || {};
    return {
      canonicalVersion: 1,
      eventIdentity: eventIdentity(input),
      conceptId: input.conceptId,
      evidenceType: input.evidenceType,
      assistanceLevel: input.assistanceLevel,
      outcome: scoringResult.outcome || diagnosis.outcome || input.outcome || "unknown",
      learnerAnswerHash: scoringResult.learnerAnswerHash || (input.learnerAnswer === undefined ? undefined : hashCanonical({ learnerAnswer: input.learnerAnswer })),
      assessmentVersion: scoringResult.assessmentVersion || assessment.assessmentVersion,
      answerKeyHash: scoringResult.answerKeyHash || assessment.answerKeyHash,
      answerKeyProvenance: scoringResult.answerKeyProvenance || assessment.answerKeyProvenance,
      answerKeyValidationStatus: scoringResult.answerKeyValidationStatus || assessment.answerKeyValidationStatus,
      validatorType: assessment.validatorType,
      validatorVersion: scoringResult.validatorVersion || assessment.validatorVersion,
      graderType: scoringResult.graderType || assessment.scoringMode || (input.evidenceType === "self_report" ? "self_report" : (input.diagnosis ? "llm_assisted" : undefined)),
      graderVersion: scoringResult.graderVersion || assessment.graderVersion,
      misconceptionId: input.misconceptionId,
      diagnosticConfidence: diagnosis.diagnosticConfidence,
      verifiedByEventIds: normalizedIdSet(input.verifiedByEventIds),
      sourceEventId: input.sourceEventId
    };
  }

  function deriveEventInputHash(input) {
    return hashCanonical(inputIdentity(input));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function authorityAllowsVerified(assessment, result) {
    if (!assessment || !result || result.verificationStatus !== "verified") return false;
    var normalized = assessmentEngine.normalizeAssessment(assessment);
    if (!assessmentEngine.isVerifiedAuthority(normalized)) return false;
    if (normalized.scoringMode !== "deterministic" && normalized.scoringMode !== "external_deterministic") return false;
    if (result.graderType !== normalized.scoringMode) return false;
    if (result.answerKeyHash !== normalized.answerKeyHash) return false;
    if (result.assessmentVersion !== normalized.assessmentVersion) return false;
    if (result.validatorVersion !== normalized.validatorVersion) return false;
    if (result.answerKeyProvenance !== normalized.answerKeyProvenance) return false;
    return result.outcome === "correct" || result.outcome === "incorrect";
  }

  function createEvidenceEvent(input) {
    if (!isObject(input)) throw domainError("invalid_evidence", "event input must be an object");
    var scoringResult = input.scoringResult || null;
    var assessment = input.assessment ? assessmentEngine.normalizeAssessment(input.assessment) : null;
    var diagnosis = input.diagnosis || null;
    var evidenceType = input.evidenceType || "basic";
    var graderType = scoringResult && scoringResult.graderType;
    var outcome = scoringResult && scoringResult.outcome;
    var verificationStatus = "unverified";
    var diagnosticConfidence = 0;

    if (evidenceType === "self_report") {
      graderType = "self_report";
      outcome = "unknown";
    } else if (diagnosis) {
      graderType = "llm_assisted";
      outcome = diagnosis.outcome === "correct" || diagnosis.outcome === "incorrect" ? diagnosis.outcome : "unknown";
      diagnosticConfidence = typeof diagnosis.diagnosticConfidence === "number" ? diagnosis.diagnosticConfidence : 0;
    } else if (authorityAllowsVerified(assessment, scoringResult)) {
      verificationStatus = "verified";
    }

    if (graderType === "llm_assisted" || graderType === "self_report") verificationStatus = "unverified";
    if (assessment && assessment.answerKeyProvenance === "llm_generated") verificationStatus = "unverified";

    var identityInput = Object.assign({}, input, {
      assessmentId: input.assessmentId || (assessment && assessment.assessmentId) || evidenceType,
      scoringResult: scoringResult || undefined,
      assessment: assessment || undefined,
      evidenceType: evidenceType,
      assistanceLevel: input.assistanceLevel || "none",
      outcome: outcome || "unknown"
    });
    var key = deriveEventKey(identityInput);
    var inputHash = deriveEventInputHash(identityInput);
    if (input.eventKey && input.eventKey !== key) throw domainError("event_key_mismatch", "Provided eventKey does not match canonical domain identity");
    if (input.eventInputHash && input.eventInputHash !== inputHash) throw domainError("event_input_hash_mismatch", "Provided eventInputHash does not match canonical event input");
    var event = {
      schemaVersion: 1,
      eventId: input.eventId || "ev_" + key.slice("evidence:".length, "evidence:".length + 24),
      eventKey: key,
      eventInputHash: inputHash,
      transactionId: stableString(input.transactionId, "transactionId"),
      accountId: stableString(input.accountId, "accountId"),
      profileId: stableString(input.profileId, "profileId"),
      worldId: stableString(input.worldId, "worldId"),
      textbookId: stableString(input.textbookId, "textbookId"),
      sessionId: input.sessionId,
      turnId: input.turnId,
      assessmentId: identityInput.assessmentId,
      conceptId: stableString(input.conceptId, "conceptId"),
      source: input.source || "classroom",
      sourceEventId: input.sourceEventId,
      evidenceType: evidenceType,
      outcome: outcome || "unknown",
      assistanceLevel: input.assistanceLevel || "none",
      verificationStatus: verificationStatus,
      graderType: graderType || "self_report",
      graderVersion: scoringResult && scoringResult.graderVersion || (assessment && assessment.graderVersion) || "none",
      scoringMode: assessment && assessment.scoringMode || graderType || "self_report",
      assessmentVersion: scoringResult && scoringResult.assessmentVersion || (assessment && assessment.assessmentVersion) || "none",
      answerKeyHash: scoringResult && scoringResult.answerKeyHash || (assessment && assessment.answerKeyHash) || "none",
      answerKeyProvenance: scoringResult && scoringResult.answerKeyProvenance || (assessment && assessment.answerKeyProvenance) || "none",
      answerKeyValidationStatus: scoringResult && scoringResult.answerKeyValidationStatus || (assessment && assessment.answerKeyValidationStatus) || "unverified",
      validatorType: assessment && assessment.validatorType || "none",
      validatorVersion: scoringResult && scoringResult.validatorVersion || (assessment && assessment.validatorVersion) || "none",
      diagnosticConfidence: diagnosticConfidence,
      verifiedByEventIds: normalizedIdSet(input.verifiedByEventIds),
      misconceptionId: input.misconceptionId,
      createdAt: stableString(input.createdAt, "createdAt")
    };
    event.payloadHash = hashCanonical(Object.assign({}, event));
    return deepFreeze(event);
  }

  function validateEvidenceEvent(event, assessment) {
    var errors = [];
    if (!isObject(event)) return { valid: false, errors: ["event_not_object"] };
    ["eventId", "eventKey", "eventInputHash", "transactionId", "accountId", "profileId", "worldId", "textbookId", "conceptId", "source", "evidenceType", "outcome", "assistanceLevel", "verificationStatus", "graderType", "createdAt"].forEach(function (field) {
      if (typeof event[field] !== "string" || event[field] === "") errors.push(field + "_missing");
    });
    if (event.payloadHash) {
      var withoutHash = Object.assign({}, event);
      delete withoutHash.payloadHash;
      if (event.payloadHash !== hashCanonical(withoutHash)) errors.push("payload_hash_mismatch");
    }
    if (event.verificationStatus === "verified" && !isEligibleVerifiedEvidence(event, assessment)) errors.push("verified_authority_mismatch");
    return { valid: errors.length === 0, errors: errors };
  }

  function isEligibleVerifiedEvidence(event, assessment) {
    if (!event || event.verificationStatus !== "verified") return false;
    if (event.outcome !== "correct" && event.outcome !== "incorrect") return false;
    if (event.graderType !== "deterministic" && event.graderType !== "external_deterministic") return false;
    if (event.scoringMode !== event.graderType) return false;
    if (event.answerKeyValidationStatus !== "verified") return false;
    if (event.answerKeyProvenance === "llm_generated" || event.answerKeyProvenance === "none") return false;
    if (!event.assessmentVersion || event.assessmentVersion === "none") return false;
    if (!event.answerKeyHash || event.answerKeyHash === "none") return false;
    if (!event.validatorVersion || event.validatorVersion === "none") return false;
    var expectedValidator = {
      source_anchored: "template_rule",
      solver_derived: "solver",
      human_verified: "human",
      external_verified: "external_contract"
    }[event.answerKeyProvenance];
    if (!expectedValidator || event.validatorType !== expectedValidator) return false;
    if (event.graderType === "external_deterministic" && event.answerKeyProvenance !== "external_verified") return false;
    if (!event.graderVersion || event.graderVersion === "none") return false;
    if (assessment) {
      var normalized = assessmentEngine.normalizeAssessment(assessment);
      if (!assessmentEngine.isVerifiedAuthority(normalized)) return false;
      if (normalized.assessmentVersion !== event.assessmentVersion || normalized.answerKeyHash !== event.answerKeyHash || normalized.validatorVersion !== event.validatorVersion || normalized.scoringMode !== event.graderType) return false;
    }
    return true;
  }

  function appendImmutableEvent(existingEvents, candidate) {
    var events = Array.isArray(existingEvents) ? existingEvents.slice() : [];
    for (var i = 0; i < events.length; i += 1) {
      if (events[i].eventKey !== candidate.eventKey) continue;
      if (events[i].eventInputHash !== candidate.eventInputHash) {
        throw domainError("evidence_conflict", "The event key already exists with different input", {
          eventKey: candidate.eventKey,
          existingEventId: events[i].eventId,
          candidateEventId: candidate.eventId
        });
      }
      return { events: events, event: events[i], replayed: true };
    }
    var validation = validateEvidenceEvent(candidate);
    if (!validation.valid) throw domainError("invalid_evidence", "Evidence event failed validation", validation.errors);
    events.push(candidate);
    return { events: events, event: candidate, replayed: false };
  }

  function transactionVisible(event, options) {
    if (!options) return true;
    if (typeof options.isTransactionCommitted === "function") {
      return options.isTransactionCommitted(event.transactionId) || (options.includeCurrentTransaction === true && options.currentTransactionId === event.transactionId);
    }
    if (options.committedTransactionIds) {
      var committed = options.committedTransactionIds instanceof Set ? options.committedTransactionIds : new Set(options.committedTransactionIds);
      return committed.has(event.transactionId) || (options.includeCurrentTransaction === true && options.currentTransactionId === event.transactionId);
    }
    if (event.transactionStatus) return event.transactionStatus === "committed" || (options.includeCurrentTransaction === true && options.currentTransactionId === event.transactionId);
    return true;
  }

  function buildLedgerView(inputEvents, options) {
    var visible = (Array.isArray(inputEvents) ? inputEvents : []).filter(function (event) { return transactionVisible(event, options); });
    var byKey = new Map();
    visible.forEach(function (event) {
      var existing = byKey.get(event.eventKey);
      if (existing && existing.eventInputHash !== event.eventInputHash) {
        throw domainError("evidence_conflict", "The ledger contains conflicting inputs for one event key", { eventKey: event.eventKey });
      }
      if (!existing) byKey.set(event.eventKey, event);
    });
    var events = Array.from(byKey.values()).sort(function (a, b) {
      return String(a.eventKey).localeCompare(String(b.eventKey)) || String(a.eventId).localeCompare(String(b.eventId));
    });
    var verifiedEvents = events.filter(function (event) { return isEligibleVerifiedEvidence(event); });
    var identity = events.map(function (event) {
      return {
        eventKey: event.eventKey,
        eventInputHash: event.eventInputHash,
        payloadHash: event.payloadHash,
        transactionId: event.transactionId
      };
    });
    return {
      schemaVersion: 1,
      events: events,
      verifiedEvents: verifiedEvents,
      ledgerViewHash: hashCanonical({ schemaVersion: 1, events: identity })
    };
  }

  module.exports = {
    canonicalJson: canonicalJson,
    hashCanonical: hashCanonical,
    eventIdentity: eventIdentity,
    deriveEventKey: deriveEventKey,
    deriveEventInputHash: deriveEventInputHash,
    createEvidenceEvent: createEvidenceEvent,
    createEvent: createEvidenceEvent,
    validateEvidenceEvent: validateEvidenceEvent,
    validateEvent: validateEvidenceEvent,
    isEligibleVerifiedEvidence: isEligibleVerifiedEvidence,
    isVerifiedEvidence: isEligibleVerifiedEvidence,
    appendImmutableEvent: appendImmutableEvent,
    appendEvent: appendImmutableEvent,
    buildLedgerView: buildLedgerView,
    dedupeEvents: function (events) { return buildLedgerView(events).events; },
    domainError: domainError
  };
})();
