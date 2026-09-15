"use strict";

var numbers = require("./numbers-zh");
var lexicon = require("./lexicon-zh");

function isLatinStart(value) {
  return !!value && /^[A-Za-z0-9]/.test(value);
}

function isLatinEnd(value) {
  return !!value && /[A-Za-z0-9]$/.test(value);
}

function joinWord(left, word, right) {
  var before = isLatinEnd(left) ? " " : "";
  var after = isLatinStart(right) ? " " : "";
  return left + before + word + after + right;
}

function joinAdjacent(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (isLatinEnd(left) && isLatinStart(right)) return left + " " + right;
  if (isLatinEnd(left) && /^[\u3400-\u9fff]/.test(right)) return left + " " + right;
  if (/[\u3400-\u9fff]$/.test(left) && isLatinStart(right)) return left + " " + right;
  if (/^左(?:圆|方|大|尖|双)?/.test(right)) return left + " " + right;
  return left + right;
}

function cleanSpeech(value) {
  return String(value || "").replace(/[ \t]+/g, " ").replace(/ +([，。；：、])/g, "$1").trim();
}

function renderRelation(node, context, bound) {
  var left = renderNode(node.left, context);
  var right = renderNode(node.right, context);
  var info = lexicon.operatorInfo(node.operator);
  var word = info && info.relation ? info.relation : "关系符号";
  if (bound) return joinWord(left, word, right);
  return left + "，" + word + (isLatinStart(right) ? " " : "") + right;
}

function renderBinary(node, context) {
  var left = renderBinaryOperand(node.left, context);
  var right = renderBinaryOperand(node.right, context);
  if (node.operatorRole === "setDifference") return left + " 与 " + right + " 的集合差";
  var info = lexicon.operatorInfo(node.operator);
  var word = info && (info.binary || info.setDifference) ? (info.setDifference && !info.binary ? info.setDifference : info.binary) : "运算";
  if (node.operator === "∪") return left + " 与 " + right + " 的并集";
  if (node.operator === "∩") return left + " 与 " + right + " 的交集";
  if (node.operator === "∖") return left + " 与 " + right + " 的集合差";
  if (node.operator === "∧" || node.operator === "∨") return joinWord(left, word, right);
  return joinWord(left, word, right);
}

function renderBinaryOperand(node, context) {
  var speech = renderNode(node, context);
  if (!node) return speech;
  if (node.type === "binary" || node.type === "relation") return "（" + speech + "）";
  if (node.type === "fenced" && node.body && ["binary", "relation", "row"].indexOf(node.body.type) !== -1) return "（" + speech + "）";
  return speech;
}

function renderUnary(node, context) {
  var operand = renderNode(node.operand, context);
  if (node.operator === "¬") {
    var logical = renderLogicalOperand(node.operand, context);
    return "非" + logical;
  }
  var word = node.operator === "+" ? "正" : "负";
  return word + (isLatinStart(operand) ? " " : "") + operand;
}

function renderLogicalOperand(node, context) {
  var speech = renderNode(node, context);
  if (!node) return "（未知命题）";
  if (node.type === "fenced" || node.type === "binary" || node.type === "relation" || node.type === "quantifier" || node.type === "function-call" || (node.type === "unary" && node.operator === "¬")) return "（" + speech + "）";
  return (isLatinStart(speech) ? " " : "") + speech;
}

function isSimpleNode(node) {
  return !!(node && ["number", "identifier", "text", "subscript", "power", "unary", "function-call"].indexOf(node.type) !== -1);
}

function renderFraction(node, context) {
  var numerator = renderNode(node.numerator, context);
  var denominator = renderNode(node.denominator, context);
  var complex = !isSimpleNode(node.numerator) || !isSimpleNode(node.denominator) || (node.numerator && node.numerator.type === "unary") || (node.denominator && node.denominator.type === "unary");
  if (context.verbosity === "detailed" || context.mode === "structural" || complex) {
    return "一个分数，分子是" + numerator + "，分母是" + denominator + "，分数结束";
  }
  if (node.numerator && node.numerator.type === "number" && node.denominator && node.denominator.type === "number") return denominator + "分之" + numerator;
  return numerator + " 除以 " + denominator;
}

function renderRoot(node, context) {
  var radicand = renderNode(node.radicand, context);
  var rootSpace = isLatinEnd(radicand) ? " " : "";
  if (!node.index) return radicand + rootSpace + "的平方根";
  var index = renderNode(node.index, Object.assign({}, context, { numberRole: "subscript" }));
  if (node.index.type === "number" && node.index.value === "3") return radicand + rootSpace + "的立方根";
  return radicand + rootSpace + "的" + (isLatinStart(index) ? " " : "") + index + (isLatinEnd(index) ? " " : "") + "次方根";
}

function simpleNumberValue(node) {
  if (!node) return null;
  if (node.type === "number") return node.value;
  if (node.type === "unary" && node.operand && node.operand.type === "number") return (node.operator === "+" ? "" : "-") + node.operand.value;
  return null;
}

function renderPower(node, context) {
  var base = renderNode(node.base, context);
  var baseBoundary = node.base && node.base.type === "fenced" && node.base.body && ["binary", "relation", "row", "unary", "quantifier"].indexOf(node.base.body.type) !== -1;
  if (baseBoundary) base = "（" + renderNode(node.base.body, context) + "）";
  var exponent = renderNode(node.exponent, context);
  if (node.inverseRole === "inverse-function") return base + (isLatinEnd(base) ? " " : "") + "的逆函数";
  var exponentValue = simpleNumberValue(node.exponent);
  if (node.inverseRole === "structural") return base + " 上标" + (isLatinStart(exponent) ? " " : "") + exponent;
  var powerSpace = isLatinEnd(base) ? " " : "";
  if (exponentValue === "2") return base + powerSpace + "的平方";
  if (exponentValue === "3") return base + powerSpace + "的立方";
  return base + powerSpace + "的" + (isLatinStart(exponent) ? " " : "") + exponent + (isLatinEnd(exponent) ? " " : "") + "次方";
}

function renderScientific(node) {
  var coefficient = numbers.speakNumber(node.coefficient, { role: "cardinal" });
  var exponent = numbers.speakNumber(node.exponent, { role: "cardinal" });
  return coefficient && exponent ? coefficient + "乘以十的" + exponent + "次方" : "";
}

function renderSubscript(node, context) {
  var base = renderNode(node.base, context);
  var index = renderNode(node.index, Object.assign({}, context, { numberRole: "subscript" }));
  if (node.base && node.base.type === "operator" && node.base.symbol === "∂") return "关于 " + index + " 的偏导";
  return base + " 下标" + (isLatinStart(index) ? " " : "") + index;
}

function renderSubsup(node, context) {
  var base = renderNode(node.base, context);
  var lower = renderNode(node.lower, Object.assign({}, context, { numberRole: "subscript" }));
  var upper = renderNode(node.upper, context);
  return base + " 下标" + (isLatinStart(lower) ? " " : "") + lower + " 上标" + (isLatinStart(upper) ? " " : "") + upper;
}

function renderBinomial(node, context) {
  return renderNode(node.upper, context) + " 选 " + renderNode(node.lower, context);
}

function renderDelimiter(symbol, opening) {
  var info = lexicon.delimiterInfo(symbol);
  if (!info) return opening ? "左分隔符" : "右分隔符";
  return opening ? info.open : info.close;
}

function renderFenced(node, context) {
  var body = renderNode(node.body, context);
  if (context.mode !== "structural" && node.delimiterRole === "cardinality") return "集合 " + body + " 的基数";
  if (context.mode !== "structural" && node.delimiterRole === "determinant") return "矩阵 " + body + " 的行列式";
  if (context.mode !== "structural" && node.delimiterRole === "absolute-value") return body + " 的绝对值";
  if (context.mode !== "structural" && node.delimiterRole === "set-builder") return "集合构造式，左大括号 " + body + " 右大括号";
  if (context.mode !== "structural" && !node.delimiterRole && (node.open === "(" || node.open === "[" || node.open === "{")) return body;
  return renderDelimiter(node.open, true) + " " + body + " " + renderDelimiter(node.close, false);
}

function extractFunctionArgument(node) {
  if (node && node.type === "fenced") return node.body;
  return node;
}

function conditionalPieces(argument) {
  var body = argument && argument.type === "fenced" ? argument.body : argument;
  if (!body || body.type !== "row") return null;
  var index = body.children.findIndex(function (child) {
    return child && child.type === "operator" && (child.symbol === "|" || child.symbol === "∣") && child.role === "conditional";
  });
  if (index < 1 || index + 1 >= body.children.length) return null;
  var left = body.children.slice(0, index);
  var right = body.children.slice(index + 1);
  return {
    left: left.length === 1 ? left[0] : { type: "row", children: left },
    right: right.length === 1 ? right[0] : { type: "row", children: right },
  };
}

function renderFunctionCall(node, context) {
  var argument = extractFunctionArgument(node.argument);
  var argumentSpeech = renderNode(argument, context);
  var name = node.name;
  if (name === "P" || name === "Pr") {
    if (node.probabilityRole === "function") {
      var functionContext = Object.assign({}, context, { mode: "structural", verbosity: "structural" });
      return renderNode(node.callee, functionContext) + " 左圆括号 " + renderNode(argument, functionContext) + " 右圆括号";
    }
    if (!node.conditional && node.conditionalEvidence === false && (argumentSpeech.indexOf("竖线") !== -1 || context.logicalPredicate)) {
      var structuralContext = Object.assign({}, context, { mode: "structural", verbosity: "structural" });
      return renderNode(node.callee, structuralContext) + " 左圆括号 " + renderNode(argument, structuralContext) + " 右圆括号";
    }
    var conditional = conditionalPieces(node.argument);
    if (conditional) return renderNode(conditional.left, context) + " 在 " + renderNode(conditional.right, context) + " 条件下的概率";
    var probabilityArgument = argument && ["binary", "relation", "row"].indexOf(argument.type) !== -1 ? "（" + argumentSpeech + "）" : argumentSpeech;
    return probabilityArgument + " 的概率";
  }
  if (name === "det") return argumentSpeech + " 的行列式";
  if (name === "log" && node.base) {
    var logArgument = argument && ["binary", "relation", "row", "unary", "quantifier"].indexOf(argument.type) !== -1 ? "（" + argumentSpeech + "）" : argumentSpeech;
    return "以" + renderNode(node.base, context) + "为底，" + logArgument + (isLatinEnd(logArgument) ? " " : "") + "的对数";
  }
  if (name === "ln") return "自然对数 " + argumentSpeech;
  if (name === "lg") return "常用对数 " + argumentSpeech;
  if (name === "exp") return "e 的" + argumentSpeech + "次方";
  var functionWord = lexicon.functionSpeech(name);
  if (functionWord) {
    var argumentBoundary = argument && ["binary", "relation", "row", "unary", "quantifier"].indexOf(argument.type) !== -1 ? "（" + argumentSpeech + "）" : argumentSpeech;
    return functionWord + (isLatinStart(argumentBoundary) ? " " : "") + argumentBoundary;
  }
  var callee = renderNode(node.callee, Object.assign({}, context, { mode: "structural" }));
  return callee + " " + renderFenced({ open: "(", close: ")", body: argument, delimiterRole: null }, Object.assign({}, context, { mode: "structural" }));
}

function boundSpeech(node, context) {
  if (!node) return "";
  if (node.type === "relation") return renderRelation(node, context, true);
  return renderNode(node, context);
}

function renderLargeOperator(node, context) {
  var lower = boundSpeech(node.lower, context);
  var upper = renderNode(node.upper, context);
  var lowerPart = lower && isLatinStart(lower) ? " " + lower : lower;
  var upperPart = upper && isLatinStart(upper) ? " " + upper : upper;
  var range = lower && upper ? "从" + lowerPart + "到" + upperPart + "，" : lower ? "从" + lowerPart + "，" : "";
  var body = renderNode(node.body, context);
  if (node.type === "summation") return range + "对 " + body + " 求和";
  if (node.type === "product") return range + "对 " + body + " 求积";
  var integrand = node.body;
  var variables = [];
  if (integrand && integrand.type === "differential") {
    variables.unshift(integrand.variable);
    integrand = null;
  } else if (integrand && integrand.type === "row") {
    var items = integrand.children.slice();
    while (items.length && items[items.length - 1] && items[items.length - 1].type === "differential") variables.unshift(items.pop().variable);
    integrand = items.length === 1 ? items[0] : { type: "row", children: items };
  }
  var integralBody = renderNode(integrand, context);
  var integralInfo = lexicon.operatorInfo(node.operator) || {};
  var order = integralInfo.order || 1;
  var integralLabel = order === 2 ? "二重积分" : order === 3 ? "三重积分" : order === 4 ? "四重积分" : "积分";
  if (!variables.length) return range + integralBody + "，" + integralLabel;
  var variableSpeech = variables.map(function (variable) { return renderNode(variable, context); }).join(" 和 ");
  return range + integralBody + (isLatinEnd(integralBody) ? " " : "") + "关于 " + variableSpeech + " 的" + integralLabel;
}

function renderLimit(node, context) {
  var condition = boundSpeech(node.condition, context);
  var body = renderNode(node.body, context);
  return "当 " + condition + "时，" + body + (isLatinEnd(body) ? " 的极限" : "的极限");
}

function renderMatrix(node, context) {
  var dimensions = { rows: node.rows.length, columns: node.rows.reduce(function (max, row) { return Math.max(max, row.length); }, 0) };
  var rows = numbers.speakNumber(String(dimensions.rows), { role: "cardinal" });
  var columns = numbers.speakNumber(String(dimensions.columns), { role: "cardinal" });
  if (dimensions.rows > 3 || dimensions.columns > 3 || dimensions.rows * dimensions.columns > context.maxMatrixSpeechCells) return rows + "行" + columns + "列矩阵";
  var rowSpeech = node.rows.map(function (row, rowIndex) {
    var cells = row.map(function (cell) { return renderNode(cell, context); }).join("、");
    return "第" + numbers.speakNumber(String(rowIndex + 1), { role: "cardinal" }) + "行 " + cells;
  }).join("；");
  return rows + "行" + columns + "列矩阵，" + rowSpeech;
}

function renderPiecewise(node, context) {
  var pieces = node.cases.map(function (item, index) {
    var value = renderNode(item.value, context).replace(/[，,]$/, "");
    var condition = item.condition && item.condition.type === "relation" ? renderRelation(item.condition, context, true) : renderNode(item.condition, context);
    return "第" + numbers.speakNumber(String(index + 1), { role: "cardinal" }) + "种情况是" + (isLatinStart(value) ? " " : "") + value + "，条件是" + (isLatinStart(condition) ? " " : "") + condition;
  });
  return "分段函数，" + pieces.join("；");
}

function renderAccent(node, context) {
  var base = renderNode(node.base, context);
  if (node.accent === "⃗") return "向量 " + base;
  if (node.accent === "^") return base + " 上加帽";
  if (node.accent === "‾") return base + " 上横线";
  if (node.accent === "⏟") return base + (node.under ? " 下方括号，标记为 " + renderNode(node.under, context) : " 下方括号");
  if (node.accent === "⏞") return base + (node.over ? " 上方括号，标记为 " + renderNode(node.over, context) : " 上方括号");
  if (node.accent === "ˉ") return base + " 上横线";
  if (node.accent === "̄") return base + " 上横线";
  if (node.accent === "˙") return base + " 上点";
  if (node.accent === "¨") return base + " 上双点";
  if (node.accent === "̃" || node.accent === "~") return base + " 上波浪线";
  if (node.under) return base + " 下方括号，标记为 " + renderNode(node.under, context);
  if (node.over) return base + " 上方括号，标记为 " + renderNode(node.over, context);
  return base + " 重音";
}

function renderVector(node, context) {
  return "向量 " + renderNode(node.base, context);
}

function renderOperator(node, context) {
  if (node.role === "conditional") return "在……条件下";
  if (node.separator || node.symbol === ",") return context && context.mode === "structural" ? "逗号" : "，";
  var info = lexicon.operatorInfo(node.symbol);
  if (!info) return node.symbol;
  return info.relation || info.binary || info.constant || info.prefix || info.delimiter || info.setDifference || info.separator || info.percentage || info.postfix || node.symbol;
}

function renderRow(node, context) {
  var result = "";
  node.children.forEach(function (child, index) {
    var current = renderNode(child, context);
    if (!current) return;
    if (child.type === "operator" && child.separator) {
      result += context.mode === "structural" ? " " + current + " " : current;
    } else if (child.type === "operator" && !child.applyFunction && (lexicon.operatorInfo(child.symbol) || child.role === "conditional")) {
      var info = lexicon.operatorInfo(child.symbol) || {};
      if (info.relation || info.binary || info.prefix || child.role === "conditional") {
        result = joinAdjacent(result, current);
        var next = node.children[index + 1];
        if (next && !isLatinStart(renderNode(next, context))) result = result;
        else if (next) result += " ";
      } else {
        result = joinAdjacent(result, current);
      }
    }
    else result = joinAdjacent(result, current);
  });
  return result;
}

function renderNode(node, context) {
  if (!node) return "";
  switch (node.type) {
    case "number": return numbers.speakNumber(node.value, { role: context.numberRole || "cardinal" });
    case "percentage": return numbers.speakNumber(node.value, { role: "percentage" });
    case "scientific": return renderScientific(node);
    case "identifier": {
      var variant = node.source && node.source.attributes ? node.source.attributes.mathvariant : "";
      var setName = variant === "double-struck" ? { R: "ℝ", Z: "ℤ", Q: "ℚ", N: "ℕ", C: "ℂ", P: "ℙ" }[node.name] : null;
      return lexicon.identifierSpeech(setName || node.name);
    }
    case "text": return String(node.value || "").trim();
    case "operator": return renderOperator(node, context);
    case "row": return renderRow(node, context);
    case "unary": return renderUnary(node, context);
    case "quantifier": return renderQuantifier(node, context);
    case "binary": return renderBinary(node, context);
    case "relation": return renderRelation(node, context, false);
    case "fraction": return renderFraction(node, context);
    case "binomial": return renderBinomial(node, context);
    case "root": return renderRoot(node, context);
    case "power": return renderPower(node, context);
    case "subscript": return renderSubscript(node, context);
    case "subsup": return renderSubsup(node, context);
    case "fenced": return renderFenced(node, context);
    case "function-call": return renderFunctionCall(node, context);
    case "summation": return renderLargeOperator(node, context);
    case "product": return renderLargeOperator(node, context);
    case "integral": return renderLargeOperator(node, context);
    case "limit": return renderLimit(node, context);
    case "differential": return "d " + renderNode(node.variable, context);
    case "accent": return renderAccent(node, context);
    case "vector": return renderVector(node, context);
    case "matrix": return renderMatrix(node, context);
    case "piecewise": return renderPiecewise(node, context);
    default: return "";
  }
}

function renderQuantifier(node, context) {
  var quantifier = node.quantifier === "∀" ? "任意" : "存在";
  var variable = renderNode(node.variable, context);
  if (!node.body) return quantifier + (isLatinStart(variable) ? " " : "") + variable;
  if (node.body.type === "relation" && node.body.left && node.body.left.type === "identifier" && node.variable && node.variable.type === "identifier" && node.body.left.name === node.variable.name) {
    var relationInfo = lexicon.operatorInfo(node.body.operator);
    var relationWord = relationInfo && relationInfo.relation ? relationInfo.relation : "关系符号";
    return quantifier + (isLatinStart(variable) ? " " : "") + variable + " " + relationWord + " " + renderNode(node.body.right, context);
  }
  return quantifier + (isLatinStart(variable) ? " " : "") + variable + "，" + renderNode(node.body, Object.assign({}, context, { logicalPredicate: true }));
}

function renderChinese(ast, options) {
  var context = Object.assign({ mode: "semantic", verbosity: "concise", maxMatrixSpeechCells: 9, numberRole: null }, options || {});
  return cleanSpeech(renderNode(ast, context));
}

module.exports = {
  renderChinese: renderChinese,
  renderNode: renderNode,
  cleanSpeech: cleanSpeech,
};
