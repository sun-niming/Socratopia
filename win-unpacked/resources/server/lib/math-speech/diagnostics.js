"use strict";

var lexicon = require("./lexicon-zh");

var SUPPORTED_TYPES = Object.freeze({
  number: true, identifier: true, text: true, operator: true, row: true, unary: true, binary: true,
  relation: true, fraction: true, binomial: true, scientific: true, quantifier: true, root: true, power: true, subscript: true, superscript: true,
  subsup: true, "function-call": true, fenced: true, summation: true, product: true, integral: true,
  limit: true, accent: true, vector: true, matrix: true, piecewise: true, differential: true, percentage: true,
});

function analyzeAst(ast, options) {
  var state = {
    totalNodes: 0,
    supportedNodes: 0,
    unknownNodes: 0,
    maxDepth: 0,
    symbolLeaves: 0,
    knownSymbolLeaves: 0,
    unknownTags: [],
  };
  function visit(value, depth) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(function (item) { visit(item, depth); });
      return;
    }
    if (typeof value.type === "string") {
      state.totalNodes += 1;
      state.maxDepth = Math.max(state.maxDepth, depth);
      if (SUPPORTED_TYPES[value.type]) state.supportedNodes += 1;
      if (value.type === "unknown") {
        state.unknownNodes += 1;
        if (value.tag) state.unknownTags.push(value.tag);
      }
      if (value.type === "identifier" || value.type === "number" || value.type === "operator" || value.type === "text") {
        state.symbolLeaves += 1;
        if (value.type === "identifier" || value.type === "number" || value.type === "text" || lexicon.operatorInfo(value.symbol)) state.knownSymbolLeaves += 1;
      }
      Object.keys(value).forEach(function (key) {
        if (key !== "source" && key !== "type") visit(value[key], depth + 1);
      });
      return;
    }
    Object.keys(value).forEach(function (key) { visit(value[key], depth + 1); });
  }
  visit(ast, 1);
  var warnings = Array.isArray(options && options.warnings) ? options.warnings.slice() : [];
  var unknownTags = Array.from(new Set(state.unknownTags));
  if (state.unknownNodes) warnings.push("unsupported-node");
  return {
    parseOk: true,
    supportedNodes: state.supportedNodes,
    totalNodes: state.totalNodes,
    unknownNodes: state.unknownNodes,
    nodeCoverage: state.totalNodes ? state.supportedNodes / state.totalNodes : 0,
    symbolCoverage: state.symbolLeaves ? state.knownSymbolLeaves / state.symbolLeaves : 1,
    maxDepth: state.maxDepth,
    mode: options && options.mode ? options.mode : null,
    verbosity: options && options.verbosity ? options.verbosity : null,
    boundaryRisk: !!(options && options.boundaryRisk),
    containsRawLatex: !!(options && typeof options.speech === "string" && /\\[A-Za-z]+|\$\$?|[{}]/.test(options.speech)),
    outputChars: typeof (options && options.speech) === "string" ? options.speech.length : 0,
    warnings: Array.from(new Set(warnings)),
    unknownTags: unknownTags,
  };
}

function failedDiagnostics(code, reason, warnings) {
  return {
    parseOk: false,
    code: code || null,
    reason: reason || "parse-failed",
    warnings: Array.isArray(warnings) ? warnings.slice() : [],
  };
}

module.exports = {
  SUPPORTED_TYPES: SUPPORTED_TYPES,
  analyzeAst: analyzeAst,
  failedDiagnostics: failedDiagnostics,
};
