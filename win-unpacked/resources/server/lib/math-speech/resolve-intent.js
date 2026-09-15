"use strict";

var lexicon = require("./lexicon-zh");
var scopeModule = require("./symbol-scope");

function copyNode(node, fields) {
  var result = {};
  Object.keys(node || {}).forEach(function (key) { result[key] = node[key]; });
  Object.keys(fields || {}).forEach(function (key) { result[key] = fields[key]; });
  return result;
}

function simpleIdentifier(node) {
  return node && node.type === "identifier" ? node.name : null;
}

function unwrapSingle(node) {
  if (node && node.type === "row" && node.children && node.children.length === 1) return node.children[0];
  return node;
}

function hasTopLevelComma(node) {
  if (!node) return false;
  if (node.type === "operator" && node.symbol === ",") return true;
  if (node.type === "row") return node.children.some(function (child) { return hasTopLevelComma(child); });
  return false;
}

function addAmbiguity(state, name) {
  if (state.ambiguities.indexOf(name) === -1) state.ambiguities.push(name);
}

function containsConditionalBar(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "operator") return node.symbol === "|" || node.symbol === "∣";
  if (Array.isArray(node)) return node.some(containsConditionalBar);
  return Object.keys(node).some(function (key) {
    return key !== "source" && key !== "type" && containsConditionalBar(node[key]);
  });
}

function intentName(value) {
  return typeof value === "string" ? value.toLowerCase().replace(/[_:]/g, "-").replace(/\s+/g, "-") : "";
}

function isProbabilityIntent(value) {
  var name = intentName(value);
  return name === "probability" || name === "conditional-probability" || name === "conditionalprobability" || name === "probability-conditional";
}

function hasDifferential(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "differential") return true;
  if (Array.isArray(node)) return node.some(hasDifferential);
  return Object.keys(node).some(function (key) {
    return key !== "source" && key !== "type" && hasDifferential(node[key]);
  });
}

function boundaryComplex(node) {
  if (!node || typeof node !== "object") return false;
  if (["binary", "relation", "row", "fraction", "root", "subsup", "matrix", "piecewise", "quantifier"].indexOf(node.type) !== -1) return true;
  if (node.type === "unary") return node.operator === "¬" || boundaryComplex(node.operand);
  if (node.type === "function-call") return boundaryComplex(node.argument);
  if (node.type === "subscript" || node.type === "power") return boundaryComplex(node.base) || boundaryComplex(node.index || node.exponent);
  if (node.type === "fenced") return boundaryComplex(node.body) || !!node.delimiterRole;
  return false;
}

function requiresDetailedSpeech(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "fraction") {
    if (boundaryComplex(node.numerator) || boundaryComplex(node.denominator)) return true;
    if (node.numerator && node.numerator.type === "fraction") return true;
    if (node.denominator && node.denominator.type === "fraction") return true;
  }
  if (Array.isArray(node)) return node.some(requiresDetailedSpeech);
  return Object.keys(node).some(function (key) {
    return key !== "source" && key !== "type" && requiresDetailedSpeech(node[key]);
  });
}

function resolveNode(node, state, parent) {
  if (!node || typeof node !== "object") return node;
  var context = parent || {};
  if (node.type === "fenced") {
    var body = resolveNode(node.body, state, { functionName: context.functionName, inFunctionArgument: context.inFunctionArgument, probabilityEvidence: context.probabilityEvidence, logicalPredicate: context.logicalPredicate });
    var role = null;
    if ((node.open === "|" || node.open === "∣" || node.open === "‖") && node.open === node.close) {
      var inner = unwrapSingle(body);
      var symbol = simpleIdentifier(inner);
      var fact = symbol ? scopeModule.getFact(state.scope, symbol) : null;
      if (symbol && scopeModule.hasConflict(state.scope, symbol)) {
        role = "structural";
        addAmbiguity(state, "conflicting-symbol-fact");
      } else if (fact && fact.type === "set") role = "cardinality";
      else if (fact && fact.type === "matrix") role = "determinant";
      else if (fact && fact.type === "scalar") role = "absolute-value";
      else if (inner && inner.type === "matrix") role = "determinant";
      else {
        role = "structural";
        if (!context.inFunctionArgument) addAmbiguity(state, "vertical-bar-meaning");
      }
    } else if (node.open === "{" && node.close === "}" && hasTopLevelOperator(body, ["|", "∣"])) {
      role = "set-builder";
    } else if (!context.inFunctionArgument && (node.open === "(" || node.open === "[" || node.open === "{")) {
      if (hasTopLevelComma(body)) addAmbiguity(state, node.open === "(" ? "tuple-or-interval" : "bracket-role");
    }
    return copyNode(node, { body: body, delimiterRole: role });
  }
  if (node.type === "function-call") {
    var conditionalShape = (node.name === "P" || node.name === "Pr") && containsConditionalBar(node.argument);
    var probabilityNotation = node.name === "P" || node.name === "Pr";
    var probabilityFact = scopeModule.getFact(state.scope, "P");
    var namedProbabilityFact = scopeModule.getFact(state.scope, node.name);
    var explicitProbabilityIntent = isProbabilityIntent(state.explicitIntent);
    var probabilityConflict = scopeModule.hasConflict(state.scope, node.name) || (node.name === "Pr" && scopeModule.hasConflict(state.scope, "P"));
    var explicitNonProbabilityFact = probabilityNotation && namedProbabilityFact && namedProbabilityFact.type !== "probability" && !explicitProbabilityIntent;
    var nonProbabilityRole = !explicitProbabilityIntent && !!(explicitNonProbabilityFact || probabilityConflict);
    var conditionalEvidence = explicitProbabilityIntent || !nonProbabilityRole && (node.name === "Pr" || !!(probabilityFact && probabilityFact.type === "probability") || !!(namedProbabilityFact && namedProbabilityFact.type === "probability"));
    if (!explicitProbabilityIntent && probabilityConflict && !conditionalShape) addAmbiguity(state, "conflicting-symbol-fact");
    else if (explicitNonProbabilityFact) addAmbiguity(state, "probability-function-role");
    if (conditionalShape && !conditionalEvidence) addAmbiguity(state, "conditional-probability-role");
    var argument = resolveNode(node.argument, state, { functionName: node.name, inFunctionArgument: true, probabilityEvidence: conditionalEvidence });
    var callee = resolveNode(node.callee, state, context);
    var base = resolveNode(node.base, state, context);
    var known = !!node.known || lexicon.isFunctionName(node.name) || scopeModule.hasType(state.scope, node.name, "function");
    if (!known) addAmbiguity(state, "unknown-function-role");
    var conditional = conditionalShape && conditionalEvidence;
    return copyNode(node, { argument: argument, callee: callee, base: base, known: known, conditional: conditional, conditionalEvidence: conditionalEvidence, probabilityRole: nonProbabilityRole ? "function" : conditionalEvidence ? "probability" : null });
  }
  if (node.type === "row") {
    var children = node.children.map(function (child) { return resolveNode(child, state, context); });
    children.forEach(function (child, index) {
      var next = children[index + 1];
      if (child && next && child.type === "identifier" && next.type === "identifier") addAmbiguity(state, "implicit-product-meaning");
      if (child && next && child.type === "number" && next.type === "identifier") addAmbiguity(state, "implicit-product-meaning");
    });
    return copyNode(node, { children: children });
  }
  if (node.type === "binary" || node.type === "relation") {
    var left = resolveNode(node.left, state, context);
    var right = resolveNode(node.right, state, context);
    var role = "binary";
    if (node.operator === "-" || node.operator === "−") {
      var leftName = simpleIdentifier(left);
      var rightName = simpleIdentifier(right);
      if (scopeModule.hasType(state.scope, leftName, "set") && scopeModule.hasType(state.scope, rightName, "set")) role = "setDifference";
      else if (leftName && rightName && /^[A-Z][A-Z0-9]*$/.test(leftName) && /^[A-Z][A-Z0-9]*$/.test(rightName)) addAmbiguity(state, "set-or-arithmetic-difference");
    }
    return copyNode(node, { left: left, right: right, operatorRole: role });
  }
  if (node.type === "unary") return copyNode(node, { operand: resolveNode(node.operand, state, context), operatorRole: "unary" });
  if (node.type === "quantifier") return copyNode(node, {
    variable: resolveNode(node.variable, state, context),
    body: resolveNode(node.body, state, Object.assign({}, context, { logicalPredicate: true })),
  });
  if (node.type === "power") {
    var powerBase = resolveNode(node.base, state, context);
    var exponent = resolveNode(node.exponent, state, context);
    var inverseRole = null;
    if (simpleIdentifier(powerBase) && isNegativeOne(exponent)) {
      if (scopeModule.hasType(state.scope, powerBase.name, "function")) inverseRole = "inverse-function";
      else {
        inverseRole = "structural";
        addAmbiguity(state, "inverse-power-meaning");
      }
    }
    return copyNode(node, { base: powerBase, exponent: exponent, inverseRole: inverseRole });
  }
  if (node.type === "operator") {
    var operatorRole = node.role || null;
    if ((context.functionName === "P" || context.functionName === "Pr") && context.probabilityEvidence) {
      if (node.symbol === "|" || node.symbol === "∣") operatorRole = "conditional";
    }
    return copyNode(node, { role: operatorRole });
  }
  if (node.type === "fraction") return copyNode(node, { numerator: resolveNode(node.numerator, state, context), denominator: resolveNode(node.denominator, state, context) });
  if (node.type === "root") return copyNode(node, { radicand: resolveNode(node.radicand, state, context), index: resolveNode(node.index, state, context) });
  if (node.type === "subscript") return copyNode(node, { base: resolveNode(node.base, state, context), index: resolveNode(node.index, state, context) });
  if (node.type === "subsup") return copyNode(node, { base: resolveNode(node.base, state, context), lower: resolveNode(node.lower, state, context), upper: resolveNode(node.upper, state, context) });
  if (node.type === "accent") return copyNode(node, { base: resolveNode(node.base, state, context), over: resolveNode(node.over, state, context), under: resolveNode(node.under, state, context) });
  if (node.type === "summation" || node.type === "product" || node.type === "integral") {
    if (node.type === "integral" && !hasDifferential(node.body)) addAmbiguity(state, "missing-integral-variable");
    return copyNode(node, {
    lower: resolveNode(node.lower, state, context),
    upper: resolveNode(node.upper, state, context),
    body: resolveNode(node.body, state, Object.assign({}, context, { inIntegral: node.type === "integral" })),
    });
  }
  if (node.type === "limit") return copyNode(node, { condition: resolveNode(node.condition, state, context), body: resolveNode(node.body, state, context) });
  if (node.type === "differential") {
    if (!context.inIntegral) addAmbiguity(state, "differential-or-product");
    return copyNode(node, { variable: resolveNode(node.variable, state, context) });
  }
  if (node.type === "matrix") return copyNode(node, { rows: node.rows.map(function (row) { return row.map(function (cell) { return resolveNode(cell, state, context); }); }) });
  if (node.type === "piecewise") return copyNode(node, { cases: node.cases.map(function (item) { return { value: resolveNode(item.value, state, context), condition: resolveNode(item.condition, state, context) }; }) });
  return copyNode(node);
}

function hasTopLevelOperator(node, symbols) {
  if (!node) return false;
  if (node.type === "operator") return symbols.indexOf(node.symbol) !== -1;
  if (node.type === "row") return node.children.some(function (child) { return hasTopLevelOperator(child, symbols); });
  return false;
}

function isNegativeOne(node) {
  if (!node) return false;
  if (node.type === "unary" && (node.operator === "-" || node.operator === "−") && node.operand && node.operand.type === "number") return node.operand.value === "1";
  return node.type === "number" && (node.value === "-1" || node.value === "−1");
}

function inferIntent(ast) {
  if (!ast) return null;
  if (ast.type === "relation") return ast.operator === "=" ? "equation" : "inequality";
  if (ast.type === "summation" || ast.type === "product" || ast.type === "integral" || ast.type === "limit") return ast.type;
  if (ast.type === "fraction" || ast.type === "root" || ast.type === "power" || ast.type === "subscript") return ast.type;
  if (ast.type === "matrix" || ast.type === "piecewise" || ast.type === "function-call" || ast.type === "binomial" || ast.type === "scientific" || ast.type === "quantifier") return ast.type;
  if (ast.type === "row") return "expression";
  if (ast.type === "binary" || ast.type === "unary") return "expression";
  return ast.type || null;
}

function resolveIntent(ast, context, style, explicitIntent) {
  var state = {
    scope: scopeModule.buildScope(context || {}),
    ambiguities: [],
    explicitIntent: explicitIntent || (context && context.intent) || null,
  };
  var resolvedAst = resolveNode(ast, state, {});
  state.ambiguities.sort();
  var structural = style === "structural" || state.ambiguities.length > 0;
  var detailed = !structural && (style === "detailed" || requiresDetailedSpeech(resolvedAst));
  var mode = structural ? "structural" : detailed ? "detailed" : "semantic";
  var verbosity = structural ? "structural" : detailed ? "detailed" : "concise";
  return {
    ast: resolvedAst,
    scope: state.scope,
    decision: {
      mode: mode,
      verbosity: verbosity,
      intent: inferIntent(resolvedAst),
      unresolvedAmbiguities: state.ambiguities.slice(),
      hardBlockers: [],
      sealed: true,
    },
  };
}

module.exports = {
  resolveIntent: resolveIntent,
  inferIntent: inferIntent,
  isNegativeOne: isNegativeOne,
  requiresDetailedSpeech: requiresDetailedSpeech,
  isProbabilityIntent: isProbabilityIntent,
};
