"use strict";

var contracts = require("./contracts");

var FORBIDDEN_PLACEHOLDERS = Object.freeze(["这个公式", "来看这个公式", "请看公式", "公式如下"]);
var RAW_LATEX_PATTERN = /\\[A-Za-z]+|\$\$?|[{}]/;

function containsForbiddenSpeech(speech) {
  if (typeof speech !== "string") return true;
  if (FORBIDDEN_PLACEHOLDERS.some(function (phrase) { return speech.indexOf(phrase) !== -1; })) return true;
  if (contracts.hasUnsafeControlCharacters(speech)) return true;
  if (/<\/?[A-Za-z][^>]*>/.test(speech)) return true;
  if (/(?:^|[^A-Za-z])(undefined|null|NaN)(?:$|[^A-Za-z])/.test(speech)) return true;
  return RAW_LATEX_PATTERN.test(speech);
}

function createSkipResult(options) {
  var value = options || {};
  var source = value.source || { latex: "", normalizedLatex: "" };
  var decision = contracts.makeDecision("skip", null, null, value.ambiguities || [], value.blockers || ["parse-failed"]);
  return {
    ok: false,
    version: contracts.VERSION,
    locale: value.locale || contracts.DEFAULT_LOCALE,
    source: source,
    decision: decision,
    speech: "",
    diagnostics: value.diagnostics || {
      parseOk: false,
      code: value.code || null,
      reason: value.reason || "parse-failed",
      warnings: value.warnings || [],
    },
  };
}

function sealResult(result) {
  if (!result || typeof result !== "object") throw new Error("result must be an object");
  if (typeof result.speech !== "string") throw new Error("speech must be a string");
  if (!result.decision || result.decision.sealed !== true) throw new Error("decision must be sealed");
  if (result.decision.mode === "skip" && result.speech !== "") throw new Error("skip speech must be empty");
  if (result.decision.mode !== "skip" && result.speech === "") throw new Error("non-skip speech must be non-empty");
  if (containsForbiddenSpeech(result.speech)) throw new Error("speech contains unsafe or placeholder text");
  var cloned = contracts.cloneData(result);
  return contracts.freezeDeep(cloned);
}

module.exports = {
  FORBIDDEN_PLACEHOLDERS: FORBIDDEN_PLACEHOLDERS,
  containsForbiddenSpeech: containsForbiddenSpeech,
  createSkipResult: createSkipResult,
  sealResult: sealResult,
};
