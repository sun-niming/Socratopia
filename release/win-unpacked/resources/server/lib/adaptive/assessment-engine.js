/**
 * Pure assessment domain rules for adaptive teaching v2.
 *
 * This module deliberately performs no I/O.  It distinguishes a repeatable
 * comparison from a trusted answer key: deterministic comparison can report
 * `correct`, while only a separately verified key may produce verified
 * evidence.
 */
(function () {
  "use strict";

  var crypto = require("crypto");

  var SCORING_MODES = ["deterministic", "llm_assisted", "self_report", "external_deterministic"];
  var DETERMINISTIC_TYPES = ["choice", "boolean", "order", "set", "numeric", "short_answer"];
  var PROVENANCE_VALIDATORS = {
    source_anchored: "template_rule",
    solver_derived: "solver",
    human_verified: "human",
    external_verified: "external_contract"
  };

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

  function sha256(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
  }

  function computeAnswerKeyHash(answerKey) {
    return "sha256:" + sha256(canonicalJson({ canonicalVersion: 1, answerKey: answerKey }));
  }

  function nonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return canonicalValue(value);
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function normalizeAssessment(input) {
    if (!isObject(input)) throw domainError("invalid_assessment", "assessment must be an object");
    var assessment = clone(input);
    assessment.schemaVersion = assessment.schemaVersion || 1;
    assessment.assessmentVersion = assessment.assessmentVersion || "assessment-v1";
    assessment.questionType = assessment.questionType || "open";
    assessment.scoringMode = assessment.scoringMode || (assessment.questionType === "open" ? "llm_assisted" : "deterministic");
    assessment.answerKeyProvenance = assessment.answerKeyProvenance || "llm_generated";
    assessment.answerKeyValidationStatus = assessment.answerKeyValidationStatus || "unverified";
    assessment.validatorType = assessment.validatorType || "none";
    assessment.validatorVersion = assessment.validatorVersion || "none";
    assessment.graderVersion = assessment.graderVersion || "assessment-engine-v1";
    assessment.sourceRefs = Array.isArray(assessment.sourceRefs) ? assessment.sourceRefs : [];
    assessment.scoringRules = isObject(assessment.scoringRules) ? assessment.scoringRules : {};
    assessment.answerKeyHash = assessment.answerKeyHash || computeAnswerKeyHash(assessment.answerKey);

    // An LLM-origin key never becomes authoritative merely because a caller
    // writes "verified" beside it.  Preserve the provenance and fail closed.
    if (assessment.answerKeyProvenance === "llm_generated") {
      assessment.answerKeyValidationStatus = "unverified";
      assessment.validatorType = "none";
    }
    return deepFreeze(assessment);
  }

  function validSourceRefs(refs) {
    return Array.isArray(refs) && refs.length > 0 && refs.every(function (ref) {
      return isObject(ref) && nonEmptyString(ref.sourceId) && ref.pageOrCardId !== undefined && ref.pageOrCardId !== null && nonEmptyString(ref.contentHash) && nonEmptyString(ref.excerptHash);
    });
  }

  function validateAnswerKey(input) {
    var assessment = normalizeAssessment(input);
    var errors = [];
    if (assessment.answerKey === undefined || assessment.answerKey === null) errors.push("answer_key_missing");
    var expectedHash = computeAnswerKeyHash(assessment.answerKey);
    if (assessment.answerKeyHash !== expectedHash) errors.push("answer_key_hash_mismatch");
    if (assessment.answerKeyValidationStatus !== "verified") errors.push("answer_key_not_verified");
    if (assessment.answerKeyProvenance === "llm_generated") errors.push("llm_generated_answer_key");

    var expectedValidator = PROVENANCE_VALIDATORS[assessment.answerKeyProvenance];
    if (!expectedValidator) errors.push("unsupported_answer_key_provenance");
    else if (assessment.validatorType !== expectedValidator) errors.push("validator_provenance_mismatch");
    if (!nonEmptyString(assessment.validatorVersion) || assessment.validatorVersion === "none") errors.push("validator_version_missing");

    if (assessment.answerKeyProvenance === "source_anchored" && !validSourceRefs(assessment.sourceRefs)) {
      errors.push("source_anchor_missing");
    }
    if (assessment.answerKeyProvenance === "solver_derived") {
      var solver = assessment.solver;
      if (!isObject(solver) || !nonEmptyString(solver.name) || !nonEmptyString(solver.version) || !nonEmptyString(solver.normalizedInput) || !nonEmptyString(solver.resultHash)) {
        errors.push("solver_replay_contract_missing");
      }
    }
    if (assessment.answerKeyProvenance === "human_verified") {
      var review = assessment.humanVerification;
      if (!isObject(review) || !nonEmptyString(review.recordId) || !nonEmptyString(review.verifiedAt)) errors.push("human_review_record_missing");
    }
    if (assessment.answerKeyProvenance === "external_verified") {
      var contract = assessment.externalContract;
      if (!isObject(contract) || !nonEmptyString(contract.contractId) || !nonEmptyString(contract.version)) errors.push("external_contract_missing");
    }
    return {
      valid: errors.length === 0,
      canProduceVerifiedEvidence: errors.length === 0,
      errors: errors,
      assessment: assessment,
      computedAnswerKeyHash: expectedHash
    };
  }

  function normalizeText(value, rules) {
    var text = String(value).normalize("NFC");
    if (rules.trim !== false) text = text.trim();
    if (rules.collapseWhitespace !== false) text = text.replace(/\s+/g, " ");
    if (!rules.caseSensitive) text = text.toLocaleLowerCase("en-US");
    if (rules.stripPunctuation === true) text = text.replace(/[\p{P}\p{S}]/gu, "");
    return text;
  }

  function strictNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    var text = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
    var number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function scoreChoice(key, answer, rules) {
    var expected = isObject(key) && key.value !== undefined ? key.value : key;
    return normalizeText(expected, rules) === normalizeText(answer, rules);
  }

  function normalizeBoolean(value) {
    if (value === true || value === false) return value;
    if (value === 1 || value === "1") return true;
    if (value === 0 || value === "0") return false;
    if (typeof value !== "string") return null;
    var text = value.trim().toLocaleLowerCase("en-US");
    if (text === "true" || text === "yes" || text === "是" || text === "正确") return true;
    if (text === "false" || text === "no" || text === "否" || text === "错误") return false;
    return null;
  }

  function scoreBoolean(key, answer) {
    var expected = normalizeBoolean(isObject(key) && key.value !== undefined ? key.value : key);
    var actual = normalizeBoolean(answer);
    return expected !== null && actual !== null && expected === actual;
  }

  function normalizedList(value, rules) {
    if (!Array.isArray(value)) return null;
    return value.map(function (item) { return normalizeText(item, rules); });
  }

  function scoreOrder(key, answer, rules) {
    var expected = normalizedList(isObject(key) && Array.isArray(key.items) ? key.items : key, rules);
    var actual = normalizedList(answer, rules);
    if (!expected || !actual || expected.length !== actual.length) return false;
    for (var i = 0; i < expected.length; i += 1) if (expected[i] !== actual[i]) return false;
    return true;
  }

  function scoreSet(key, answer, rules) {
    var expected = normalizedList(isObject(key) && Array.isArray(key.items) ? key.items : key, rules);
    var actual = normalizedList(answer, rules);
    if (!expected || !actual) return false;
    expected = Array.from(new Set(expected)).sort();
    actual = Array.from(new Set(actual)).sort();
    return expected.length === actual.length && expected.every(function (item, index) { return item === actual[index]; });
  }

  function scoreNumeric(key, answer, rules) {
    var expected = strictNumber(isObject(key) && key.value !== undefined ? key.value : key);
    var actual = strictNumber(answer);
    if (expected === null || actual === null) return false;
    var keyTolerance = isObject(key) && typeof key.tolerance === "number" ? key.tolerance : undefined;
    var absoluteTolerance = typeof rules.absoluteTolerance === "number" ? rules.absoluteTolerance : (keyTolerance || 0);
    var relativeTolerance = typeof rules.relativeTolerance === "number" ? rules.relativeTolerance : 0;
    if (absoluteTolerance < 0 || relativeTolerance < 0) return false;
    var allowed = Math.max(absoluteTolerance, Math.abs(expected) * relativeTolerance);
    return Math.abs(actual - expected) <= allowed;
  }

  function scoreShortAnswer(key, answer, rules) {
    var accepted;
    if (Array.isArray(key)) accepted = key;
    else if (isObject(key) && Array.isArray(key.acceptedAnswers)) accepted = key.acceptedAnswers;
    else accepted = [isObject(key) && key.value !== undefined ? key.value : key];
    var actual = normalizeText(answer, rules);
    return accepted.some(function (candidate) { return normalizeText(candidate, rules) === actual; });
  }

  function deterministicCompare(questionType, key, answer, rules) {
    if (questionType === "choice") return scoreChoice(key, answer, rules);
    if (questionType === "boolean") return scoreBoolean(key, answer);
    if (questionType === "order") return scoreOrder(key, answer, rules);
    if (questionType === "set") return scoreSet(key, answer, rules);
    if (questionType === "numeric") return scoreNumeric(key, answer, rules);
    if (questionType === "short_answer") return scoreShortAnswer(key, answer, rules);
    throw domainError("unsupported_deterministic_question", "Unsupported deterministic question type: " + questionType);
  }

  function baseResult(assessment, answer) {
    return {
      schemaVersion: 1,
      assessmentId: assessment.assessmentId,
      assessmentVersion: assessment.assessmentVersion,
      conceptId: assessment.conceptId,
      scoringMode: assessment.scoringMode,
      graderType: assessment.scoringMode,
      graderVersion: assessment.graderVersion,
      answerKeyHash: assessment.answerKeyHash,
      answerKeyProvenance: assessment.answerKeyProvenance,
      answerKeyValidationStatus: assessment.answerKeyValidationStatus,
      validatorVersion: assessment.validatorVersion,
      learnerAnswerHash: "sha256:" + sha256(canonicalJson({ canonicalVersion: 1, learnerAnswer: answer })),
      correct: null,
      outcome: "unknown",
      verificationStatus: "unverified",
      authorityErrors: []
    };
  }

  function scoreAssessment(input, learnerAnswer, options) {
    var assessment = normalizeAssessment(input);
    var result = baseResult(assessment, learnerAnswer);
    options = options || {};
    if (SCORING_MODES.indexOf(assessment.scoringMode) < 0) {
      result.authorityErrors = ["unsupported_scoring_mode"];
      return deepFreeze(result);
    }
    if (assessment.scoringMode === "self_report") return deepFreeze(result);
    if (assessment.scoringMode === "llm_assisted") {
      result.diagnosticConfidence = typeof options.diagnosticConfidence === "number" ? options.diagnosticConfidence : 0;
      result.diagnosticVerdict = options.diagnosticVerdict || "unknown";
      return deepFreeze(result);
    }
    if (assessment.scoringMode === "external_deterministic") {
      return scoreExternalAssessment(assessment, options.externalResult || {});
    }
    if (DETERMINISTIC_TYPES.indexOf(assessment.questionType) < 0) {
      result.authorityErrors = ["unsupported_deterministic_question"];
      return deepFreeze(result);
    }

    result.correct = deterministicCompare(assessment.questionType, assessment.answerKey, learnerAnswer, assessment.scoringRules);
    result.outcome = result.correct ? "correct" : "incorrect";
    var authority = validateAnswerKey(assessment);
    result.authorityErrors = authority.errors;
    if (authority.canProduceVerifiedEvidence) result.verificationStatus = "verified";
    return deepFreeze(result);
  }

  function scoreExternalAssessment(input, externalResult) {
    var assessment = normalizeAssessment(input);
    var result = baseResult(assessment, externalResult);
    result.graderType = "external_deterministic";
    result.graderVersion = externalResult.graderVersion || assessment.graderVersion;
    if (externalResult.outcome === "correct" || externalResult.outcome === "incorrect") {
      result.outcome = externalResult.outcome;
      result.correct = externalResult.outcome === "correct";
    }
    var authority = validateAnswerKey(assessment);
    result.authorityErrors = authority.errors.slice();
    if (assessment.scoringMode !== "external_deterministic") result.authorityErrors.push("external_scoring_mode_required");
    if (externalResult.contractVerified !== true) result.authorityErrors.push("external_result_contract_unverified");
    if (!nonEmptyString(result.graderVersion)) result.authorityErrors.push("grader_version_missing");
    if (result.outcome === "unknown") result.authorityErrors.push("external_outcome_missing");
    if (result.authorityErrors.length === 0) result.verificationStatus = "verified";
    return deepFreeze(result);
  }

  function isVerifiedAuthority(input) {
    return validateAnswerKey(input).canProduceVerifiedEvidence;
  }

  module.exports = {
    SCORING_MODES: SCORING_MODES.slice(),
    DETERMINISTIC_TYPES: DETERMINISTIC_TYPES.slice(),
    PROVENANCE_VALIDATORS: Object.assign({}, PROVENANCE_VALIDATORS),
    canonicalJson: canonicalJson,
    computeAnswerKeyHash: computeAnswerKeyHash,
    normalizeAssessment: normalizeAssessment,
    validateAssessment: validateAnswerKey,
    validateAnswerKey: validateAnswerKey,
    isVerifiedAuthority: isVerifiedAuthority,
    deterministicCompare: deterministicCompare,
    scoreAssessment: scoreAssessment,
    scoreExternalAssessment: scoreExternalAssessment,
    domainError: domainError
  };
})();
