"use strict";

var katex = require("katex");
var contracts = require("./contracts");

var UNSAFE_MACRO_PATTERN = /\\(?:href|url|htmlClass|htmlId|htmlStyle|htmlData|includegraphics|verb|verbatim|def|gdef|xdef|newcommand|renewcommand|providecommand|DeclareMathOperator|definecolor|colorbox|fcolorbox)\b/;

function shortError(error) {
  var message = error && typeof error.message === "string" ? error.message : "KaTeX failed to render expression";
  return message.replace(/[\r\n]+/g, " ").slice(0, 240);
}

function extractMathElement(rendered) {
  var match = rendered.match(/<math\b[\s\S]*?<\/math>/i);
  return match ? match[0] : "";
}

/**
 * Render through KaTeX's documented output API.  The MathML parser is kept
 * outside this adapter so a malformed result is still diagnosed separately.
 */
function renderLatexToMathml(latex, limits) {
  if (typeof latex !== "string" || !latex.trim()) {
    return { ok: false, code: contracts.ERROR_CODES.INVALID_INPUT, message: "latex must be a non-empty string" };
  }
  var safeLimits = limits || contracts.DEFAULT_LIMITS;
  if (latex.length > safeLimits.maxInputChars) {
    return { ok: false, code: contracts.ERROR_CODES.INPUT_TOO_LONG, message: "expression exceeds maxInputChars" };
  }
  if (latex.indexOf("\u0000") !== -1) {
    return { ok: false, code: contracts.ERROR_CODES.INVALID_INPUT, message: "expression contains a null character" };
  }
  if (UNSAFE_MACRO_PATTERN.test(latex)) {
    return { ok: false, code: contracts.ERROR_CODES.UNKNOWN_SEMANTIC_MACRO, message: "expression contains a macro outside the offline semantic subset" };
  }
  try {
    var rendered = katex.renderToString(latex.trim(), {
      output: "mathml",
      throwOnError: true,
      trust: false,
      strict: "warn",
      maxExpand: 1000,
    });
    var mathml = extractMathElement(rendered);
    if (!mathml) {
      return { ok: false, code: contracts.ERROR_CODES.MATHML_PARSE_FAILED, message: "KaTeX did not produce MathML" };
    }
    if (/<mtext\b[^>]*>\s*\\[A-Za-z]/.test(mathml)) {
      return { ok: false, code: contracts.ERROR_CODES.UNKNOWN_SEMANTIC_MACRO, message: "MathML contains an unconsumed control command" };
    }
    if (mathml.length > safeLimits.maxMathmlChars) {
      return { ok: false, code: contracts.ERROR_CODES.AST_TOO_LARGE, message: "MathML output exceeds the safety limit" };
    }
    return { ok: true, mathml: mathml, normalizedLatex: latex.trim() };
  } catch (error) {
    return {
      ok: false,
      code: contracts.ERROR_CODES.KATEX_PARSE_FAILED,
      message: shortError(error),
    };
  }
}

module.exports = {
  renderLatexToMathml: renderLatexToMathml,
  extractMathElement: extractMathElement,
};
