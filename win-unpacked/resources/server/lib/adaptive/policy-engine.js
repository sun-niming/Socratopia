/**
 * Deterministic adaptive-teaching policy.
 *
 * The policy consumes a projection and already-normalized signals.  It never
 * invokes an LLM, reads a clock, or mutates mastery.  Callers must provide the
 * transaction's fixed evaluationTime.
 */
(function () {
  "use strict";

  var crypto = require("crypto");

  var RULES_VERSION = "policy-rules-v1";

  function domainError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function canonical(value) {
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return value.normalize("NFC");
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.keys(value).sort().reduce(function (output, key) {
        if (value[key] !== undefined) output[key.normalize("NFC")] = canonical(value[key]);
        return output;
      }, {});
    }
    return undefined;
  }

  function stableDecisionId(seed) {
    var hash = crypto.createHash("sha256").update(JSON.stringify(canonical(seed)), "utf8").digest("hex");
    return "decision_" + hash.slice(0, 24);
  }

  function pendingAssessmentId(pending) {
    if (typeof pending === "string") return pending;
    return pending && pending.assessmentId || null;
  }

  function nextAssessmentId(context, kind) {
    var candidates = Array.isArray(context.assessmentCandidates) ? context.assessmentCandidates : [];
    for (var i = 0; i < candidates.length; i += 1) {
      if ((!kind || candidates[i].evidenceType === kind) && candidates[i].answerKeyValidationStatus === "verified") return candidates[i].assessmentId;
    }
    return null;
  }

  function effectiveState(projection, evaluationTime) {
    if (projection.effectiveState) return projection.effectiveState;
    if (projection.baseState === "mastered" && projection.nextReviewAt && Date.parse(evaluationTime) >= Date.parse(projection.nextReviewAt)) return "review_due";
    return projection.baseState || "unseen";
  }

  function chooseRule(context, projection, evaluationTime) {
    var pendingId = pendingAssessmentId(context.pendingAssessment);
    if (pendingId) {
      return { action: "check", difficulty: "same", reasonCodes: ["PENDING_ASSESSMENT_CONTINUES"], assessmentId: pendingId, hintLevel: "none", expectedEvidenceType: context.pendingAssessment.evidenceType || "basic" };
    }

    if (context.learnerSignal === "self_report" || context.selfReport === true) {
      return { action: "check", difficulty: "same", reasonCodes: ["SELF_REPORT_NEEDS_CHECK"], assessmentId: nextAssessmentId(context, "basic"), hintLevel: "none", expectedEvidenceType: "basic" };
    }

    if (context.diagnosisStatus === "timeout" || context.diagnosisStatus === "invalid" || context.diagnosisStatus === "error" || context.diagnosisStatus === "unavailable") {
      return { action: "check", difficulty: "same", reasonCodes: ["DIAGNOSIS_UNAVAILABLE_CONSERVATIVE_CHECK"], assessmentId: nextAssessmentId(context, "basic"), hintLevel: "none", expectedEvidenceType: "basic" };
    }

    var repeated = Array.isArray(projection.repeatedMisconceptions) ? projection.repeatedMisconceptions : [];
    if (repeated.length > 0 || context.repeatedMisconception === true) {
      return { action: "remediate", difficulty: "lower", reasonCodes: ["REPEATED_MISCONCEPTION"], assessmentId: nextAssessmentId(context, "basic"), hintLevel: "light", expectedEvidenceType: "basic" };
    }

    if (projection.heavyHintCorrect === true || context.heavyHintCorrect === true) {
      return { action: "check", difficulty: "same", reasonCodes: ["HEAVY_HINT_NEEDS_INDEPENDENT_CHECK"], assessmentId: nextAssessmentId(context, "basic"), hintLevel: "none", expectedEvidenceType: "basic" };
    }

    if (projection.hasIndependentBasic === true && projection.hasIndependentTransfer !== true && projection.hasIndependentRetention !== true) {
      return { action: "assess_transfer", difficulty: "higher", reasonCodes: ["TRANSFER_EVIDENCE_REQUIRED"], assessmentId: nextAssessmentId(context, "transfer"), hintLevel: "none", expectedEvidenceType: "transfer" };
    }

    if (effectiveState(projection, evaluationTime) === "review_due") {
      return { action: "review", difficulty: "same", reasonCodes: ["REVIEW_DUE"], assessmentId: nextAssessmentId(context, "retention"), hintLevel: "none", expectedEvidenceType: "retention" };
    }

    var gaps = Array.isArray(context.prerequisiteGaps) ? context.prerequisiteGaps.filter(Boolean) : [];
    if (gaps.length > 0) {
      gaps.sort(function (a, b) {
        var ad = typeof a === "object" && typeof a.depth === "number" ? a.depth : 0;
        var bd = typeof b === "object" && typeof b.depth === "number" ? b.depth : 0;
        return ad - bd || String(a.conceptId || a).localeCompare(String(b.conceptId || b));
      });
      return { action: "explain", difficulty: "lower", reasonCodes: ["PREREQUISITE_GAP"], targetConceptId: gaps[0].conceptId || gaps[0], assessmentId: null, hintLevel: "light", expectedEvidenceType: "basic" };
    }

    if (projection.baseState === "mastered") {
      return { action: "advance", difficulty: "higher", reasonCodes: ["MASTERY_CONDITIONS_MET"], assessmentId: null, hintLevel: "none", expectedEvidenceType: "basic" };
    }

    if (projection.baseState === "remediation") {
      return { action: "remediate", difficulty: "lower", reasonCodes: ["VERIFIED_FAILURE_REQUIRES_REMEDIATION"], assessmentId: nextAssessmentId(context, "basic"), hintLevel: "light", expectedEvidenceType: "basic" };
    }

    return { action: "check", difficulty: "same", reasonCodes: ["CONSERVATIVE_CHECK"], assessmentId: nextAssessmentId(context, "basic"), hintLevel: "none", expectedEvidenceType: "basic" };
  }

  function buildTutorContract(rule, context) {
    var conceptId = rule.targetConceptId || context.conceptId;
    var moveByAction = {
      check: "Ask exactly one independently scorable check question.",
      explain: "Explain the smallest prerequisite gap, then ask at most one check question.",
      remediate: "Correct the named misconception with a changed representation, then ask at most one check question.",
      assess_transfer: "Ask one independently scorable transfer question with a different surface form.",
      advance: "Acknowledge verified progress briefly and move to the next eligible concept.",
      review: "Ask one independently scorable delayed-recall question."
    };
    return Object.freeze({
      objective: "Collect " + rule.expectedEvidenceType + " evidence for concept " + conceptId + ".",
      requiredMove: moveByAction[rule.action],
      forbiddenMoves: [
        "DO_NOT_DECLARE_MASTERY_FROM_SELF_REPORT",
        "DO_NOT_TREAT_LLM_DIAGNOSIS_AS_VERIFIED_EVIDENCE",
        "DO_NOT_WRITE_MASTERY_DIRECTLY",
        "DO_NOT_ASK_MORE_THAN_ONE_QUESTION"
      ],
      hintLevel: rule.hintLevel,
      expectedEvidenceType: rule.expectedEvidenceType,
      maxQuestions: 1
    });
  }

  function selectNextAction(context) {
    if (!context || typeof context !== "object") throw domainError("invalid_policy_context", "policy context is required");
    if (typeof context.conceptId !== "string" || context.conceptId === "") throw domainError("invalid_policy_context", "conceptId is required");
    if (!context.projection || typeof context.projection !== "object") throw domainError("invalid_policy_context", "projection is required");
    var time = Date.parse(context.evaluationTime);
    if (!Number.isFinite(time)) throw domainError("invalid_evaluation_time", "evaluationTime must be supplied by the transaction");
    var evaluationTime = new Date(time).toISOString();
    var rule = chooseRule(context, context.projection, evaluationTime);
    var seed = {
      conceptId: context.conceptId,
      sessionId: context.sessionId || null,
      turnId: context.turnId || null,
      evaluationTime: evaluationTime,
      projectionHash: context.projection.projectionHash || context.projection.ledgerViewHash,
      action: rule.action,
      reasonCodes: rule.reasonCodes,
      assessmentId: rule.assessmentId
    };
    return Object.freeze({
      schemaVersion: 1,
      decisionId: context.decisionId || stableDecisionId(seed),
      sessionId: context.sessionId || null,
      conceptId: rule.targetConceptId || context.conceptId,
      action: rule.action,
      difficulty: rule.difficulty,
      reasonCodes: rule.reasonCodes.slice(),
      assessmentId: rule.assessmentId || null,
      tutorContract: buildTutorContract(rule, context),
      rulesVersion: context.rulesVersion || RULES_VERSION,
      evaluationTime: evaluationTime,
      createdAt: evaluationTime
    });
  }

  module.exports = {
    RULES_VERSION: RULES_VERSION,
    selectNextAction: selectNextAction,
    decide: selectNextAction,
    buildTutorContract: buildTutorContract,
    stableDecisionId: stableDecisionId,
    domainError: domainError
  };
})();
