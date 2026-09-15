"use strict";

/**
 * Public contracts and input guards for the offline mathematics speech core.
 *
 * The module intentionally contains no application state.  Keeping the
 * contract here makes it possible for the renderer and the smoke tests to
 * share the same limits without importing the main entry point.
 */

var VERSION = "math-speech-zh-v1";
var DEFAULT_LOCALE = "zh-Hans";
var DEFAULT_LIMITS = Object.freeze({
  maxInputChars: 4096,
  maxAstDepth: 64,
  maxAstNodes: 2000,
  maxOutputChars: 1200,
  maxMatrixRows: 64,
  maxMatrixColumns: 64,
  maxMatrixSpeechCells: 9,
  maxMathmlChars: 140000,
});

var MODES = Object.freeze(["semantic", "structural", "detailed", "skip"]);
var VERBOSITIES = Object.freeze(["concise", "detailed", "structural"]);

var FORBIDDEN_PROPERTY_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

var ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  INPUT_TOO_LONG: "input_too_long",
  KATEX_PARSE_FAILED: "katex_parse_failed",
  MATHML_PARSE_FAILED: "mathml_parse_failed",
  EMPTY_AST: "empty_ast",
  UNSUPPORTED_NODE: "unsupported_node",
  UNKNOWN_SEMANTIC_MACRO: "unknown_semantic_macro",
  AST_TOO_DEEP: "ast_too_deep",
  AST_TOO_LARGE: "ast_too_large",
  MATRIX_TOO_LARGE: "matrix_too_large",
  OUTPUT_TOO_LONG: "output_too_long",
  RAW_LATEX_REMAINING: "raw_latex_remaining",
  UNRESOLVED_CRITICAL_AMBIGUITY: "unresolved_critical_ambiguity",
  INTERNAL_INVARIANT_FAILED: "internal_invariant_failed",
});

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  try {
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch (error) {
    return false;
  }
}

function isForbiddenPropertyKey(key) {
  return FORBIDDEN_PROPERTY_KEYS.indexOf(key) !== -1;
}

function unsafeControlCodePoint(codePoint) {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || codePoint === 0x00ad || codePoint === 0x034f || codePoint === 0x061c || codePoint === 0x180e || (codePoint >= 0x200b && codePoint <= 0x200f) || (codePoint >= 0x2028 && codePoint <= 0x202e) || (codePoint >= 0x2060 && codePoint <= 0x206f) || codePoint === 0xfeff || (codePoint >= 0xfff9 && codePoint <= 0xfffb) || codePoint === 0xe0001 || (codePoint >= 0xe0020 && codePoint <= 0xe007f);
}

function firstUnsafeControlCodePoint(value) {
  if (typeof value !== "string") return null;
  for (var index = 0; index < value.length; index += 1) {
    var codePoint = value.codePointAt(index);
    if (unsafeControlCodePoint(codePoint)) return codePoint;
    if (codePoint > 0xffff) index += 1;
  }
  return null;
}

function hasUnsafeControlCharacters(value) {
  return firstUnsafeControlCodePoint(value) !== null;
}

function readOwnDataProperty(object, key) {
  if (object === null || typeof object !== "object") return { present: false };
  var descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(object, key);
  } catch (error) {
    return { present: true, error: "property descriptor could not be read" };
  }
  if (!descriptor) return { present: false };
  if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) return { present: true, error: "accessor properties are not accepted" };
  return { present: true, value: descriptor.value };
}

function ownDataKeys(object) {
  var keys;
  try {
    keys = Object.keys(object);
  } catch (error) {
    throw new TypeError("object keys could not be read");
  }
  return keys.filter(function (key) { return !isForbiddenPropertyKey(key); }).sort();
}

function hasUnsafeData(value, seen) {
  if (typeof value === "string") return hasUnsafeControlCharacters(value);
  if (!value || typeof value !== "object") return false;
  if (!seen) seen = new WeakSet();
  if (seen.has(value)) return true;
  seen.add(value);
  var unsafe = Array.isArray(value) ? false : false;
  ownDataKeys(value).forEach(function (key) {
    var descriptor = readOwnDataProperty(value, key);
    if (descriptor.error || hasUnsafeData(descriptor.value, seen)) unsafe = true;
  });
  seen.delete(value);
  return unsafe;
}

/**
 * Clone caller-owned JSON-like data while rejecting cycles and executable
 * values.  The returned object never aliases context.symbolFacts.
 */
function cloneData(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "undefined") return undefined;
  if (typeof value !== "object") throw new TypeError("context must contain JSON-like values");
  if (!seen) seen = new WeakSet();
  if (seen.has(value)) throw new TypeError("cyclic context is not supported");
  seen.add(value);
  var result;
  if (Array.isArray(value)) {
    result = [];
    ownDataKeys(value).forEach(function (key) {
      var descriptor = readOwnDataProperty(value, key);
      if (descriptor.error) throw new TypeError(descriptor.error);
      var child = cloneData(descriptor.value, seen);
      if (/^(0|[1-9]\d*)$/.test(key)) result[Number(key)] = child;
      else result[key] = child;
    });
  } else if (isPlainObject(value)) {
    result = {};
    ownDataKeys(value).forEach(function (key) {
      var descriptor = readOwnDataProperty(value, key);
      if (descriptor.error) throw new TypeError(descriptor.error);
      var child = cloneData(descriptor.value, seen);
      if (typeof child !== "undefined") result[key] = child;
    });
  } else {
    throw new TypeError("context must contain plain objects and arrays");
  }
  seen.delete(value);
  return result;
}

function freezeDeep(value, seen) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (!seen) seen = new WeakSet();
  if (seen.has(value)) return value;
  seen.add(value);
  Object.keys(value).forEach(function (key) { freezeDeep(value[key], seen); });
  return Object.freeze(value);
}

function positiveInteger(value, fallback, maximum) {
  if (!Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, maximum);
}

function boundedLimit(value, name, fallback, maximum) {
  if (typeof value === "undefined") return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(name + " must be a positive integer");
  return Math.min(value, maximum);
}

function normalizeLimits(value) {
  if (value !== undefined && value !== null && !isPlainObject(value)) throw new TypeError("limits must be a plain object");
  var limits = value || {};
  function field(name) {
    var descriptor = readOwnDataProperty(limits, name);
    if (descriptor.error) throw new TypeError(descriptor.error);
    return descriptor.present ? descriptor.value : undefined;
  }
  return {
    maxInputChars: boundedLimit(field("maxInputChars"), "maxInputChars", DEFAULT_LIMITS.maxInputChars, DEFAULT_LIMITS.maxInputChars),
    maxAstDepth: boundedLimit(field("maxAstDepth"), "maxAstDepth", DEFAULT_LIMITS.maxAstDepth, DEFAULT_LIMITS.maxAstDepth),
    maxAstNodes: boundedLimit(field("maxAstNodes"), "maxAstNodes", DEFAULT_LIMITS.maxAstNodes, DEFAULT_LIMITS.maxAstNodes),
    maxOutputChars: boundedLimit(field("maxOutputChars"), "maxOutputChars", DEFAULT_LIMITS.maxOutputChars, DEFAULT_LIMITS.maxOutputChars),
    maxMatrixRows: boundedLimit(field("maxMatrixRows"), "maxMatrixRows", DEFAULT_LIMITS.maxMatrixRows, DEFAULT_LIMITS.maxMatrixRows),
    maxMatrixColumns: boundedLimit(field("maxMatrixColumns"), "maxMatrixColumns", DEFAULT_LIMITS.maxMatrixColumns, DEFAULT_LIMITS.maxMatrixColumns),
    maxMatrixSpeechCells: boundedLimit(field("maxMatrixSpeechCells"), "maxMatrixSpeechCells", DEFAULT_LIMITS.maxMatrixSpeechCells, DEFAULT_LIMITS.maxMatrixSpeechCells),
    maxMathmlChars: boundedLimit(field("maxMathmlChars"), "maxMathmlChars", DEFAULT_LIMITS.maxMathmlChars, DEFAULT_LIMITS.maxMathmlChars),
  };
}

function normalizeContext(value) {
  if (value !== undefined && value !== null && !isPlainObject(value)) throw new TypeError("context must be a plain object");
  var context = value === undefined || value === null ? {} : cloneData(value);
  if (!isPlainObject(context)) throw new TypeError("context must be a plain object");
  if (hasUnsafeData(context)) throw new TypeError("context contains unsafe control characters");
  if (!Array.isArray(context.domainHints)) context.domainHints = [];
  if (!isPlainObject(context.symbolFacts) && !Array.isArray(context.symbolFacts)) context.symbolFacts = {};
  if (typeof context.precedingText !== "string") context.precedingText = "";
  if (typeof context.currentSentence !== "string") context.currentSentence = "";
  return context;
}

function normalizeInput(input) {
  if (!isPlainObject(input)) return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: "input must be an object" };
  var fields = {};
  var fieldNames = ["latex", "mathml", "locale", "style", "context", "limits", "intent"];
  for (var fieldIndex = 0; fieldIndex < fieldNames.length; fieldIndex += 1) {
    var fieldName = fieldNames[fieldIndex];
    var field = readOwnDataProperty(input, fieldName);
    if (field.error) return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: field.error };
    fields[fieldName] = field;
  }
  var latex = fields.latex.present ? fields.latex.value : undefined;
  var mathml = fields.mathml.present ? fields.mathml.value : undefined;
  if (fields.latex.present && typeof latex !== "string") return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: "latex must be a string" };
  if (fields.mathml.present && typeof mathml !== "string") return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: "mathml must be a string" };
  if (fields.latex.present && fields.mathml.present) return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: "provide exactly one of latex or mathml" };
  if (typeof latex !== "string" && typeof mathml !== "string") {
    return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: "latex or mathml must be a string" };
  }
  var sourceText = typeof latex === "string" ? latex : "";
  var locale = fields.locale.present ? fields.locale.value : DEFAULT_LOCALE;
  if (typeof locale !== "string" || !locale) return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: "locale must be a non-empty string" };
  if (locale !== DEFAULT_LOCALE) {
    return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: "only zh-Hans is supported" };
  }
  var style = fields.style.present ? fields.style.value : "concise";
  if (style !== "concise" && style !== "detailed" && style !== "structural") return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: "style is not supported" };
  var intent = fields.intent.present ? fields.intent.value : null;
  if (intent !== null && typeof intent !== "string") return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: "intent must be a string" };
  var limits;
  var context;
  try {
    limits = normalizeLimits(fields.limits.present ? fields.limits.value : undefined);
    context = normalizeContext(fields.context.present ? fields.context.value : undefined);
  } catch (error) {
    return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: error.message };
  }
  var expression = typeof mathml === "string" ? mathml : sourceText;
  if (hasUnsafeControlCharacters(sourceText) || hasUnsafeControlCharacters(mathml)) {
    return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: "expression contains unsafe control characters" };
  }
  if (hasUnsafeControlCharacters(intent)) {
    return { ok: false, code: ERROR_CODES.INVALID_INPUT, message: "intent contains unsafe control characters" };
  }
  if (sourceText.length > limits.maxInputChars || (typeof mathml === "string" && mathml.length > limits.maxInputChars)) {
    return {
      ok: false,
      code: ERROR_CODES.INPUT_TOO_LONG,
      message: "expression exceeds maxInputChars",
      locale: locale,
      style: style,
      latex: "",
      context: context,
      limits: limits,
    };
  }
  return {
    ok: true,
    latex: sourceText,
    mathml: typeof mathml === "string" ? mathml : null,
    intent: intent,
    locale: locale,
    style: style,
    context: context,
    limits: limits,
  };
}

function makeDecision(mode, verbosity, intent, ambiguities, blockers) {
  return {
    mode: mode,
    verbosity: verbosity,
    intent: intent || null,
    sealed: true,
    unresolvedAmbiguities: Array.isArray(ambiguities) ? ambiguities.slice() : [],
    hardBlockers: Array.isArray(blockers) ? blockers.slice() : [],
  };
}

module.exports = {
  VERSION: VERSION,
  DEFAULT_LOCALE: DEFAULT_LOCALE,
  DEFAULT_LIMITS: DEFAULT_LIMITS,
  MODES: MODES,
  VERBOSITIES: VERBOSITIES,
  ERROR_CODES: ERROR_CODES,
  cloneData: cloneData,
  freezeDeep: freezeDeep,
  firstUnsafeControlCodePoint: firstUnsafeControlCodePoint,
  hasUnsafeControlCharacters: hasUnsafeControlCharacters,
  hasUnsafeData: hasUnsafeData,
  isForbiddenPropertyKey: isForbiddenPropertyKey,
  readOwnDataProperty: readOwnDataProperty,
  isPlainObject: isPlainObject,
  normalizeLimits: normalizeLimits,
  normalizeContext: normalizeContext,
  normalizeInput: normalizeInput,
  makeDecision: makeDecision,
};
