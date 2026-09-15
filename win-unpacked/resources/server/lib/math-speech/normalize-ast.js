"use strict";

var lexicon = require("./lexicon-zh");

var BRACKET_PAIRS = Object.freeze({ "(": ")", "[": "]", "{": "}", "⟨": "⟩" });
var CLOSING_BRACKETS = Object.freeze({ ")": true, "]": true, "}": true, "⟩": true });
var BAR_SYMBOLS = Object.freeze({ "|": true, "∣": true, "‖": true, "∥": true });

function copyNode(original, fields) {
  var result = {};
  Object.keys(original || {}).forEach(function (key) { result[key] = original[key]; });
  Object.keys(fields || {}).forEach(function (key) { result[key] = fields[key]; });
  return result;
}

function makeRow(children) {
  var values = (children || []).filter(Boolean);
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  return { type: "row", children: values };
}

function childCount(node) {
  return node && node.type === "row" && Array.isArray(node.children) ? node.children.length : node ? 1 : 0;
}

function isOperator(node, symbol) {
  return !!(node && node.type === "operator" && (!symbol || node.symbol === symbol));
}

function isRelationOperator(node) {
  var info = node && node.type === "operator" ? lexicon.operatorInfo(node.symbol) : null;
  return !!(info && info.relation);
}

function isBinaryOperator(node) {
  if (!node || node.type !== "operator") return false;
  var info = lexicon.operatorInfo(node.symbol);
  return !!(info && (info.binary || info.setDifference));
}

function isOpenDelimiter(node) {
  return !!(node && node.type === "operator" && Object.prototype.hasOwnProperty.call(BRACKET_PAIRS, node.symbol));
}

function isCloseDelimiter(node) {
  return !!(node && node.type === "operator" && CLOSING_BRACKETS[node.symbol]);
}

function normalizeNumberValue(value) {
  var text = String(value || "");
  if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return text;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) return text.replace(/,/g, "");
  return null;
}

function numberNodeValue(node) {
  return node && node.type === "number" && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(node.value) ? node.value : null;
}

function signSymbol(node) {
  return isOperator(node, "+") || isOperator(node, "-") || isOperator(node, "−") ? node.symbol : null;
}

function unarySignPosition(children, index) {
  if (index === 0) return true;
  var previous = children[index - 1];
  return !!(previous && (previous.type === "operator" || previous.type === "binary" || previous.type === "relation" || previous.type === "unary" || isOpenDelimiter(previous)));
}

function normalizeNumberFragments(children) {
  var result = [];
  var index = 0;
  while (index < children.length) {
    var current = children[index];
    if (!current || current.type !== "number" || !/^\d+(?:\.\d+)?$/.test(current.value)) {
      result.push(current);
      index += 1;
      continue;
    }
    var value = current.value;
    var cursor = index;
    var pieces = [value];
    while (cursor + 2 < children.length && isOperator(children[cursor + 1], ",") && numberNodeValue(children[cursor + 2])) {
      pieces.push(children[cursor + 2].value);
      cursor += 2;
    }
    var firstInteger = /^\d+$/.test(pieces[0]);
    var validGroups = pieces.length > 1 && firstInteger && pieces[0].length <= 3 && pieces.slice(1).every(function (piece, pieceIndex) {
      var integerPart = piece.split(".")[0];
      return /^\d+$/.test(integerPart) && integerPart.length === 3 && (pieceIndex === pieces.length - 2 || piece.indexOf(".") === -1);
    });
    if (validGroups) {
      result.push(copyNode(current, { value: pieces.join("").replace(/(?<=\d{3})\.(?=\d)/, ".") }));
      index = cursor + 1;
    } else {
      result.push(current);
      index += 1;
    }
  }
  return result;
}

function normalizeScientificNotation(children) {
  var result = [];
  for (var index = 0; index < children.length; index += 1) {
    var coefficient = numberNodeValue(children[index]);
    var start = index;
    if (!coefficient && signSymbol(children[index]) && unarySignPosition(children, index)) {
      var signedValue = numberNodeValue(children[index + 1]);
      if (signedValue) {
        coefficient = (children[index].symbol === "+" ? "" : "-") + signedValue;
        start = index;
        index += 1;
      }
    }
    if (!coefficient || !children[index + 1] || children[index + 1].type !== "identifier" || (children[index + 1].name !== "e" && children[index + 1].name !== "E")) {
      if (start !== index) index -= 1;
      result.push(children[index]);
      continue;
    }
    var exponentIndex = index + 2;
    var exponentSign = "";
    if (signSymbol(children[exponentIndex])) {
      exponentSign = children[exponentIndex].symbol === "+" ? "" : "-";
      exponentIndex += 1;
    }
    var exponent = numberNodeValue(children[exponentIndex]);
    if (!exponent) {
      if (start !== index) index -= 1;
      result.push(children[index]);
      continue;
    }
    result.push({ type: "scientific", coefficient: coefficient, exponent: exponentSign + exponent, notation: children[index + 1].name, source: children[index + 1].source });
    index = exponentIndex;
  }
  return result;
}

function normalizePercentages(children) {
  var result = [];
  for (var index = 0; index < children.length; index += 1) {
    if (children[index] && children[index].type === "number" && children[index + 1] && isOperator(children[index + 1], "%")) {
      result.push({ type: "percentage", value: children[index].value, source: children[index].source });
      index += 1;
    } else {
      result.push(children[index]);
    }
  }
  return result;
}

function isBarOpening(children, index) {
  var previous = children[index - 1];
  if (!previous) return true;
  if (isOpenDelimiter(previous) || isRelationOperator(previous) || isBinaryOperator(previous)) return true;
  if (previous.type === "operator" && previous.separator) return true;
  return false;
}

function normalizeDelimitedBody(items, warnings) {
  if (!items.length) return null;
  var normalized = normalizeRow({ type: "row", children: items }, warnings);
  return normalized;
}

function repairScriptedFence(children, warnings) {
  var result = children.slice();
  for (var index = 0; index < result.length; index += 1) {
    var current = result[index];
    if (!current || (current.type !== "power" && current.type !== "subscript") || !current.base || !isCloseDelimiter(current.base)) continue;
    var expectedOpen = Object.keys(BRACKET_PAIRS).find(function (open) { return BRACKET_PAIRS[open] === current.base.symbol; });
    if (!expectedOpen) continue;
    var openIndex = -1;
    for (var cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (isOperator(result[cursor], expectedOpen)) {
        openIndex = cursor;
        break;
      }
    }
    if (openIndex === -1) continue;
    var body = normalizeDelimitedBody(result.slice(openIndex + 1, index), warnings);
    var fenced = { type: "fenced", open: expectedOpen, close: current.base.symbol, separators: ",", body: body, source: result[openIndex].source };
    result.splice(openIndex, index - openIndex + 1, copyNode(current, { base: fenced }));
    index = openIndex;
  }
  return result;
}

function matrixDimensions(matrix) {
  var rows = matrix && Array.isArray(matrix.rows) ? matrix.rows : [];
  var columns = rows.reduce(function (maximum, row) { return Math.max(maximum, Array.isArray(row) ? row.length : 0); }, 0);
  return { rows: rows.length, columns: columns };
}

function isPiecewiseMatrix(matrix) {
  if (!matrix || matrix.type !== "matrix" || !matrix.rows.length) return false;
  return matrix.rows.every(function (row) { return Array.isArray(row) && row.length === 2 && row[0] && row[1]; });
}

function groupFences(children, warnings) {
  var result = [];
  for (var index = 0; index < children.length; index += 1) {
    var current = children[index];
    if (isOpenDelimiter(current)) {
      var closeSymbol = BRACKET_PAIRS[current.symbol];
      var depth = 0;
      var closeIndex = -1;
      for (var cursor = index + 1; cursor < children.length; cursor += 1) {
        if (isOpenDelimiter(children[cursor]) && children[cursor].symbol === current.symbol) depth += 1;
        else if (isCloseDelimiter(children[cursor]) && children[cursor].symbol === closeSymbol) {
          if (depth === 0) {
            closeIndex = cursor;
            break;
          }
          depth -= 1;
        }
      }
      if (closeIndex === -1) {
        if (!(current.symbol === "{" && children[index + 1] && children[index + 1].type === "matrix" && isPiecewiseMatrix(children[index + 1]))) warnings.push("unclosed-fence");
        result.push(current);
        continue;
      }
      var inside = children.slice(index + 1, closeIndex);
      if (inside.length === 1 && inside[0].type === "matrix" && closeIndex === index + 2) {
        var closedMatrix = copyNode(inside[0], { open: current.symbol, close: closeSymbol });
        result.push(closedMatrix);
      } else if (inside.length === 1 && inside[0].type === "fraction" && inside[0].linethickness === "0px") {
        result.push({ type: "binomial", upper: inside[0].numerator, lower: inside[0].denominator, source: current.source });
      } else {
        result.push({
          type: "fenced",
          open: current.symbol,
          close: closeSymbol,
          separators: ",",
          body: normalizeDelimitedBody(inside, warnings),
          source: current.source,
        });
      }
      index = closeIndex;
      continue;
    }
    if (BAR_SYMBOLS[current && current.symbol] && isBarOpening(children, index)) {
      var barClose = -1;
      for (var barIndex = index + 1; barIndex < children.length; barIndex += 1) {
        if (isOperator(children[barIndex]) && children[barIndex].symbol === current.symbol) {
          barClose = barIndex;
          break;
        }
      }
      if (barClose !== -1) {
        result.push({
          type: "fenced",
          open: current.symbol,
          close: current.symbol,
          separators: ",",
          body: normalizeDelimitedBody(children.slice(index + 1, barClose), warnings),
          source: current.source,
        });
        index = barClose;
        continue;
      }
      warnings.push("unclosed-fence");
    }
    result.push(current);
  }
  for (var pieceIndex = 0; pieceIndex + 1 < result.length; pieceIndex += 1) {
    if (isOperator(result[pieceIndex], "{") && result[pieceIndex + 1].type === "matrix" && isPiecewiseMatrix(result[pieceIndex + 1])) {
      result.splice(pieceIndex, 2, {
        type: "piecewise",
        cases: result[pieceIndex + 1].rows.map(function (row) { return { value: row[0], condition: row[1] }; }),
        source: result[pieceIndex].source,
      });
      pieceIndex -= 1;
    }
  }
  return result;
}

function normalizeUnary(children) {
  var result = [];
  for (var index = 0; index < children.length; index += 1) {
    var current = children[index];
    if (isOperator(current) && (current.symbol === "-" || current.symbol === "−" || current.symbol === "+")) {
      var previous = result[result.length - 1];
      var unaryPosition = !previous || isOperator(previous) || previous.type === "relation" || previous.type === "binary" || (previous.type === "fenced" && !previous.body);
      if (unaryPosition && children[index + 1] && !isOperator(children[index + 1])) {
        result.push({ type: "unary", operator: current.symbol, operand: children[index + 1], source: current.source });
        index += 1;
        continue;
      }
    }
    result.push(current);
  }
  return result;
}

function functionName(node) {
  if (!node) return null;
  if (node.type === "identifier") return node.name;
  if (node.type === "subscript" && node.base && node.base.type === "identifier") return node.base.name;
  if (node.type === "row") {
    var identifiers = node.children.filter(function (child) { return child.type === "identifier"; });
    if (identifiers.length === 1 && node.children.every(function (child) { return child.type === "identifier" || (child.type === "operator" && child.applyFunction); })) return identifiers[0].name;
  }
  return null;
}

function makeFunctionCall(callee, argument) {
  var name = functionName(callee);
  if (!name) return null;
  var fields = { name: name, callee: callee, argument: argument, known: lexicon.isFunctionName(name) };
  if (callee.type === "subscript") fields.base = callee.index;
  return { type: "function-call", name: name, callee: callee, argument: argument, known: fields.known, base: fields.base };
}

function isFunctionCandidate(node) {
  return !!(node && (node.type === "identifier" || node.type === "subscript") && (lexicon.isFunctionName(functionName(node)) || node.type === "identifier"));
}

function normalizeFunctionCalls(children) {
  var result = [];
  var meaningful = children.filter(function (child) { return !(isOperator(child) && child.applyFunction); });
  for (var index = 0; index < meaningful.length; index += 1) {
    var current = meaningful[index];
    if (isFunctionCandidate(current) && meaningful[index + 1]) {
      var next = meaningful[index + 1];
      if (next.type === "fenced") {
        var call = makeFunctionCall(current, next);
        if (call) {
          result.push(call);
          index += 1;
          continue;
        }
      } else if (lexicon.isFunctionName(functionName(current)) && !isOperator(next) && next.type !== "relation") {
        var directCall = makeFunctionCall(current, next);
        if (directCall) {
          result.push(directCall);
          index += 1;
          continue;
        }
      }
    }
    result.push(current);
  }
  return result;
}

function normalizeDifferentials(children) {
  var result = [];
  for (var index = 0; index < children.length; index += 1) {
    var current = children[index];
    if (current && current.type === "identifier" && /^d[a-zA-Z]$/.test(current.name)) {
      result.push({ type: "differential", variable: { type: "identifier", name: current.name.slice(1), source: current.source }, source: current.source });
      continue;
    }
    if (current && current.type === "identifier" && current.name === "d" && children[index + 1] && children[index + 1].type === "identifier") {
      result.push({ type: "differential", variable: children[index + 1], source: current.source });
      index += 1;
      continue;
    }
    result.push(current);
  }
  return result;
}

function isLogicalQuantifier(node) {
  return isOperator(node, "∀") || isOperator(node, "∃");
}

function normalizeQuantifiers(children, warnings) {
  var result = [];
  for (var index = 0; index < children.length; index += 1) {
    var current = children[index];
    if (!isLogicalQuantifier(current) || !children[index + 1] || children[index + 1].type !== "identifier") {
      result.push(current);
      continue;
    }
    var variable = children[index + 1];
    var tail = children.slice(index + 2);
    var body = null;
    if (tail.length) {
      if (tail[0].type === "operator" && (precedence(tail[0]) >= 0 || tail[0].separator)) tail.unshift(variable);
      body = tail.length === 1 ? tail[0] : parseExplicitExpression(tail) || { type: "row", children: tail };
      index = children.length - 1;
    } else {
      index += 1;
    }
    result.push({ type: "quantifier", quantifier: current.symbol, variable: variable, body: body, source: current.source });
  }
  return result;
}

function normalizeLogicalPrefixes(children) {
  var result = [];
  for (var index = 0; index < children.length; index += 1) {
    var current = children[index];
    if (!isOperator(current, "¬")) {
      result.push(current);
      continue;
    }
    var operand = children[index + 1];
    if (!operand) {
      result.push(current);
      continue;
    }
    if (isOperator(operand, "¬")) {
      var nestedOperand = children[index + 2];
      if (nestedOperand) {
        result.push({ type: "unary", operator: "¬", operand: { type: "unary", operator: "¬", operand: nestedOperand, source: operand.source }, source: current.source });
        index += 2;
        continue;
      }
    }
    result.push({ type: "unary", operator: "¬", operand: operand, source: current.source });
    index += 1;
  }
  return result;
}

function precedence(node) {
  if (!node || node.type !== "operator") return -1;
  var symbol = node.symbol;
  if (isRelationOperator(node)) return 10;
  if (symbol === "∨" || symbol === "⇒" || symbol === "⇔") return 15;
  if (symbol === "∧") return 20;
  if (symbol === "+" || symbol === "-" || symbol === "−" || symbol === "∪" || symbol === "∩" || symbol === "∖") return 30;
  if (symbol === "×" || symbol === "*" || symbol === "⋅" || symbol === "·" || symbol === "∙" || symbol === "÷" || symbol === "∘") return 40;
  return -1;
}

function parseExplicitExpression(children) {
  if (!children.length) return null;
  var cursor = 0;
  var valid = true;
  function parseAtom() {
    var value = children[cursor];
    if (!value || (value.type === "operator" && precedence(value) >= 0)) {
      valid = false;
      return null;
    }
    cursor += 1;
    return value;
  }
  function parseLevel(minimum) {
    var left = parseAtom();
    while (valid && cursor < children.length) {
      var operator = children[cursor];
      var currentPrecedence = precedence(operator);
      if (currentPrecedence < minimum) break;
      cursor += 1;
      var right = parseLevel(currentPrecedence + 1);
      if (!right) {
        valid = false;
        break;
      }
      left = {
        type: isRelationOperator(operator) ? "relation" : "binary",
        operator: operator.symbol,
        left: left,
        right: right,
        source: operator.source,
      };
    }
    return left;
  }
  var parsed = parseLevel(0);
  if (!valid || cursor !== children.length) return null;
  return parsed;
}

function groupLargeOperators(children, warnings) {
  var result = [];
  for (var index = 0; index < children.length; index += 1) {
    var current = children[index];
    if (current && (current.type === "summation" || current.type === "product" || current.type === "integral" || current.type === "limit") && current.body === null) {
      var body = [];
      var cursor = index + 1;
      while (cursor < children.length) {
        if (isRelationOperator(children[cursor]) || (children[cursor] && ["summation", "product", "integral", "limit"].indexOf(children[cursor].type) !== -1)) break;
        body.push(children[cursor]);
        cursor += 1;
      }
      if (!body.length) {
        warnings.push("large-operator-without-body");
        result.push(copyNode(current, { body: { type: "unknown", reason: "missing-large-operator-body" } }));
      } else {
        var bodyAst = body.length === 1 ? body[0] : parseExplicitExpression(body) || { type: "row", children: body };
        result.push(copyNode(current, { body: bodyAst }));
      }
      index = cursor - 1;
      continue;
    }
    result.push(current);
  }
  return result;
}

function normalizeRow(node, warnings) {
  var children = Array.isArray(node.children) ? node.children.filter(Boolean) : [];
  children = children.map(function (child) { return normalizeNode(child, warnings); }).filter(Boolean);
  children = repairScriptedFence(children, warnings);
  children = normalizeNumberFragments(children);
  children = normalizeScientificNotation(children);
  children = normalizePercentages(children);
  children = groupFences(children, warnings);
  children = normalizeUnary(children);
  children = normalizeFunctionCalls(children);
  children = normalizeDifferentials(children);
  children = normalizeQuantifiers(children, warnings);
  children = normalizeLogicalPrefixes(children);
  children = groupLargeOperators(children, warnings);
  var explicit = parseExplicitExpression(children);
  if (explicit) return explicit;
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return copyNode(node, { children: children });
}

function normalizeNode(node, warnings) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "row") return normalizeRow(node, warnings);
  if (node.type === "number") {
    var normalizedNumber = normalizeNumberValue(node.value);
    return normalizedNumber === null ? { type: "unknown", reason: "invalid-number-token", source: node.source } : copyNode(node, { value: normalizedNumber });
  }
  if (node.type === "fraction") return copyNode(node, { numerator: normalizeNode(node.numerator, warnings), denominator: normalizeNode(node.denominator, warnings) });
  if (node.type === "root") return copyNode(node, { radicand: normalizeNode(node.radicand, warnings), index: normalizeNode(node.index, warnings) });
  if (node.type === "power") return copyNode(node, { base: normalizeNode(node.base, warnings), exponent: normalizeNode(node.exponent, warnings) });
  if (node.type === "subscript") return copyNode(node, { base: normalizeNode(node.base, warnings), index: normalizeNode(node.index, warnings) });
  if (node.type === "subsup") return copyNode(node, { base: normalizeNode(node.base, warnings), lower: normalizeNode(node.lower, warnings), upper: normalizeNode(node.upper, warnings) });
  if (node.type === "fenced") return copyNode(node, { body: normalizeNode(node.body, warnings) });
  if (node.type === "unary") return copyNode(node, { operand: normalizeNode(node.operand, warnings) });
  if (node.type === "quantifier") return copyNode(node, { variable: normalizeNode(node.variable, warnings), body: normalizeNode(node.body, warnings) });
  if (node.type === "binary" || node.type === "relation") return copyNode(node, { left: normalizeNode(node.left, warnings), right: normalizeNode(node.right, warnings) });
  if (node.type === "accent") return copyNode(node, { base: normalizeNode(node.base, warnings), over: normalizeNode(node.over, warnings), under: normalizeNode(node.under, warnings) });
  if (node.type === "vector") return copyNode(node, { base: normalizeNode(node.base, warnings) });
  if (node.type === "function-call") return copyNode(node, { callee: normalizeNode(node.callee, warnings), argument: normalizeNode(node.argument, warnings), base: normalizeNode(node.base, warnings) });
  if (node.type === "summation" || node.type === "product" || node.type === "integral") return copyNode(node, { lower: normalizeNode(node.lower, warnings), upper: normalizeNode(node.upper, warnings), body: normalizeNode(node.body, warnings) });
  if (node.type === "limit") return copyNode(node, { condition: normalizeNode(node.condition, warnings), body: normalizeNode(node.body, warnings) });
  if (node.type === "differential") return copyNode(node, { variable: normalizeNode(node.variable, warnings) });
  if (node.type === "operator" && ["∑", "∏", "∫", "∮", "∬", "∭", "∯", "∰"].indexOf(node.symbol) !== -1) {
    var largeType = node.symbol === "∑" ? "summation" : node.symbol === "∏" ? "product" : "integral";
    return { type: largeType, lower: null, upper: null, body: null, operator: node.symbol, source: node.source };
  }
  if (node.type === "binomial") return copyNode(node, { upper: normalizeNode(node.upper, warnings), lower: normalizeNode(node.lower, warnings) });
  if (node.type === "scientific") return copyNode(node);
  if (node.type === "matrix") {
    var rows = (node.rows || []).map(function (row) { return (row || []).map(function (cell) { return normalizeNode(cell, warnings); }); });
    var dimensions = matrixDimensions({ rows: rows });
    if (!dimensions.rows || !dimensions.columns) warnings.push("empty-matrix");
    if (rows.some(function (row) { return row.length !== dimensions.columns; })) warnings.push("ragged-matrix");
    return copyNode(node, { rows: rows });
  }
  if (node.type === "piecewise") return copyNode(node, { cases: (node.cases || []).map(function (item) { return { value: normalizeNode(item.value, warnings), condition: normalizeNode(item.condition, warnings) }; }) });
  return copyNode(node);
}

function normalizeAst(ast, options) {
  var warnings = [];
  var normalized = normalizeNode(ast, warnings);
  return { ast: normalized, warnings: Array.from(new Set(warnings)) };
}

module.exports = {
  normalizeAst: normalizeAst,
  matrixDimensions: matrixDimensions,
  makeRow: makeRow,
};
