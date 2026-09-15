"use strict";

var contracts = require("./contracts");
var latexAdapter = require("./latex-to-mathml");
var mathml = require("./mathml-to-ast");
var normalizer = require("./normalize-ast");
var resolver = require("./resolve-intent");
var renderer = require("./render-zh");
var diagnostics = require("./diagnostics");
var seal = require("./seal-policy");

function blockerFor(code) {
  var mapping = {};
  mapping[contracts.ERROR_CODES.INVALID_INPUT] = "invalid-input";
  mapping[contracts.ERROR_CODES.INPUT_TOO_LONG] = "input-too-long";
  mapping[contracts.ERROR_CODES.KATEX_PARSE_FAILED] = "parse-failed";
  mapping[contracts.ERROR_CODES.MATHML_PARSE_FAILED] = "parse-failed";
  mapping[contracts.ERROR_CODES.EMPTY_AST] = "empty-ast";
  mapping[contracts.ERROR_CODES.UNSUPPORTED_NODE] = "unsupported-node";
  mapping[contracts.ERROR_CODES.UNKNOWN_SEMANTIC_MACRO] = "unknown-semantic-macro";
  mapping[contracts.ERROR_CODES.AST_TOO_DEEP] = "ast-too-deep";
  mapping[contracts.ERROR_CODES.AST_TOO_LARGE] = "ast-too-large";
  mapping[contracts.ERROR_CODES.MATRIX_TOO_LARGE] = "matrix-too-large";
  mapping[contracts.ERROR_CODES.OUTPUT_TOO_LONG] = "output-too-long";
  mapping[contracts.ERROR_CODES.RAW_LATEX_REMAINING] = "raw-latex-remaining";
  mapping[contracts.ERROR_CODES.UNRESOLVED_CRITICAL_AMBIGUITY] = "unresolved-critical-ambiguity";
  mapping[contracts.ERROR_CODES.INTERNAL_INVARIANT_FAILED] = "internal-invariant-failed";
  return mapping[code] || "parse-failed";
}

function safeSource(input) {
  return {
    latex: input && typeof input.latex === "string" ? input.latex : "",
    normalizedLatex: input && typeof input.latex === "string" ? input.latex.trim() : "",
  };
}

function skip(options) {
  var value = options || {};
  var result = seal.createSkipResult({
    locale: value.locale || contracts.DEFAULT_LOCALE,
    source: value.source || { latex: "", normalizedLatex: "" },
    code: value.code,
    reason: value.reason || blockerFor(value.code),
    blockers: value.blockers || [value.reason || blockerFor(value.code)],
    warnings: value.warnings || [],
    diagnostics: value.diagnostics || diagnostics.failedDiagnostics(value.code, value.reason || blockerFor(value.code), value.warnings || []),
  });
  return seal.sealResult(result);
}

function visitMatrices(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (node.type === "matrix") visitor(node);
  Object.keys(node).forEach(function (key) {
    if (key === "source" || key === "type") return;
    var value = node[key];
    if (Array.isArray(value)) value.forEach(function (item) { visitMatrices(item, visitor); });
    else if (value && typeof value === "object") visitMatrices(value, visitor);
  });
}

function unsupportedOperators(node) {
  var unsupported = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value.type === "operator" && !value.applyFunction && !value.role && !require("./lexicon-zh").operatorInfo(value.symbol)) unsupported.push(value.symbol);
    Object.keys(value).forEach(function (key) {
      if (key !== "source" && key !== "type") visit(value[key]);
    });
  }
  visit(node);
  return Array.from(new Set(unsupported));
}

function containsRawAstControl(node) {
  var found = false;
  function visit(value) {
    if (found || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value.type === "text" && typeof value.value === "string" && /\\[A-Za-z]+/.test(value.value)) {
      found = true;
      return;
    }
    Object.keys(value).forEach(function (key) {
      if (key !== "source" && key !== "type") visit(value[key]);
    });
  }
  visit(node);
  return found;
}

function buildSuccess(input, source, ast, decision, speech, parsedDiagnostics) {
  var finalDiagnostics = diagnostics.analyzeAst(ast, {
    warnings: parsedDiagnostics.warnings,
    speech: speech,
    mode: decision.mode,
    verbosity: decision.verbosity,
    boundaryRisk: decision.mode === "detailed",
  });
  return seal.sealResult({
    ok: true,
    version: contracts.VERSION,
    locale: input.locale,
    source: source,
    ast: ast,
    decision: decision,
    speech: speech,
    diagnostics: finalDiagnostics,
  });
}

/**
 * Deterministically convert one LaTeX or MathML expression to Chinese
 * mathematics speech.  This function has no I/O, network, TTS, or UI side
 * effects; every caller-owned input is cloned before resolution.
 */
function prepareMathSpeech(input) {
  var normalized = contracts.normalizeInput(input);
  if (!normalized.ok) {
    return skip({ locale: normalized.locale || contracts.DEFAULT_LOCALE, source: { latex: "", normalizedLatex: "" }, code: normalized.code, reason: blockerFor(normalized.code) });
  }
  var source = safeSource(normalized);
  if (normalized.mathml !== null) source.mathml = normalized.mathml;
  try {
    var inlineMathml = normalized.mathml === null && /^\s*<math\b/i.test(normalized.latex) ? normalized.latex : null;
    var rendered = normalized.mathml !== null || inlineMathml !== null ? { ok: true, mathml: normalized.mathml !== null ? normalized.mathml : inlineMathml, normalizedLatex: source.normalizedLatex } : latexAdapter.renderLatexToMathml(normalized.latex, normalized.limits);
    if (!rendered.ok) return skip({ locale: normalized.locale, source: source, code: rendered.code, reason: blockerFor(rendered.code) });
    source.normalizedLatex = rendered.normalizedLatex || source.normalizedLatex;
    var parsed = mathml.parseMathml(rendered.mathml, normalized.limits, { generated: normalized.mathml === null && inlineMathml === null });
    if (!parsed.ok) return skip({ locale: normalized.locale, source: source, code: parsed.code, reason: "parse-failed" });
    var converted = mathml.mathmlToAst(parsed.root);
    if (!converted.ok || !converted.ast) return skip({ locale: normalized.locale, source: source, code: converted.code || contracts.ERROR_CODES.EMPTY_AST, reason: "empty-ast" });
    var normalizedAst = normalizer.normalizeAst(converted.ast, normalized.limits);
    if (!normalizedAst.ast) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.EMPTY_AST, reason: "empty-ast", warnings: normalizedAst.warnings });
    var astDiagnostics = diagnostics.analyzeAst(normalizedAst.ast, { warnings: normalizedAst.warnings });
    if (astDiagnostics.totalNodes === 0) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.EMPTY_AST, reason: "empty-ast", warnings: astDiagnostics.warnings });
    if (astDiagnostics.maxDepth > normalized.limits.maxAstDepth) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.AST_TOO_DEEP, reason: "ast-too-deep", warnings: astDiagnostics.warnings });
    if (astDiagnostics.totalNodes > normalized.limits.maxAstNodes) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.AST_TOO_LARGE, reason: "ast-too-large", warnings: astDiagnostics.warnings });
    if (astDiagnostics.unknownNodes || converted.unknownTags.length) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.UNSUPPORTED_NODE, reason: "unsupported-node", warnings: astDiagnostics.warnings });
    if (normalizedAst.warnings.length) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.UNSUPPORTED_NODE, reason: "unsafe-structure", warnings: normalizedAst.warnings });
    if (containsRawAstControl(normalizedAst.ast)) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.RAW_LATEX_REMAINING, reason: "raw-latex-remaining", warnings: astDiagnostics.warnings });
    var matrixBlocked = false;
    visitMatrices(normalizedAst.ast, function (matrix) {
      var rows = matrix.rows.length;
      var columns = matrix.rows.reduce(function (max, row) { return Math.max(max, row.length); }, 0);
      if (rows > normalized.limits.maxMatrixRows || columns > normalized.limits.maxMatrixColumns || rows * columns > normalized.limits.maxAstNodes) matrixBlocked = true;
    });
    if (matrixBlocked) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.MATRIX_TOO_LARGE, reason: "matrix-too-large", warnings: astDiagnostics.warnings });
    if (unsupportedOperators(normalizedAst.ast).length) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.UNSUPPORTED_NODE, reason: "unsupported-symbol", warnings: astDiagnostics.warnings });
    var effectiveIntent = normalized.intent || converted.intent || (normalized.context && normalized.context.intent) || null;
    var resolved = resolver.resolveIntent(normalizedAst.ast, normalized.context, normalized.style, effectiveIntent);
    if (resolved.decision.unresolvedAmbiguities.length && normalized.style !== "structural") {
      resolved.decision.mode = "structural";
      resolved.decision.verbosity = "structural";
    }
    var speech = renderer.renderChinese(resolved.ast, {
      mode: resolved.decision.mode,
      verbosity: resolved.decision.verbosity,
      maxMatrixSpeechCells: normalized.limits.maxMatrixSpeechCells,
    });
    if (!speech) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.EMPTY_AST, reason: "empty-speech", warnings: astDiagnostics.warnings });
    if (speech.length > normalized.limits.maxOutputChars) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.OUTPUT_TOO_LONG, reason: "output-too-long", warnings: astDiagnostics.warnings });
    if (seal.containsForbiddenSpeech(speech)) return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.RAW_LATEX_REMAINING, reason: "raw-latex-remaining", warnings: astDiagnostics.warnings });
    return buildSuccess(normalized, source, resolved.ast, resolved.decision, speech, { warnings: astDiagnostics.warnings });
  } catch (error) {
    return skip({ locale: normalized.locale, source: source, code: contracts.ERROR_CODES.INTERNAL_INVARIANT_FAILED, reason: "internal-invariant-failed" });
  }
}

module.exports = {
  prepareMathSpeech: prepareMathSpeech,
  VERSION: contracts.VERSION,
  contracts: contracts,
};
