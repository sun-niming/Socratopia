"use strict";

var assert = require("assert");
var core = require("./index");

function result(latex, context) {
  return core.prepareMathSpeech({ latex: latex, locale: "zh-Hans", style: "concise", context: context || {} });
}

var bars = result("|A|");
assert.strictEqual(bars.ok, true);
assert.strictEqual(bars.decision.mode, "structural");
assert.strictEqual(bars.speech, "左竖线 A 右竖线");
assert.strictEqual(bars.ast.delimiterRole, "structural");
assert.deepStrictEqual(bars.decision.unresolvedAmbiguities, ["vertical-bar-meaning"]);

var setFact = result("|A|+1", { symbolFacts: { A: { type: "set", evidence: "explicit" } } });
assert.strictEqual(setFact.decision.mode, "semantic");
assert.strictEqual(setFact.speech, "集合 A 的基数加一");

var scalarFact = result("|x|", { symbolFacts: { x: { type: "scalar", evidence: "explicit" } } });
assert.strictEqual(scalarFact.speech, "x 的绝对值");

var matrixFact = result("|M|", { symbolFacts: { M: { type: "matrix", evidence: "explicit" } } });
assert.strictEqual(matrixFact.speech, "矩阵 M 的行列式");

var inverse = result("f^{-1}");
assert.strictEqual(inverse.decision.mode, "structural");
assert.strictEqual(inverse.speech, "f 上标负一");
assert(inverse.decision.unresolvedAmbiguities.indexOf("inverse-power-meaning") !== -1);

var inverseFunction = result("f^{-1}", { symbolFacts: { f: { type: "function", evidence: "explicit" } } });
assert.strictEqual(inverseFunction.decision.mode, "semantic");
assert.strictEqual(inverseFunction.speech, "f 的逆函数");

var tuple = result("(a,b)");
assert.strictEqual(tuple.decision.mode, "structural");
assert.strictEqual(tuple.speech, "左圆括号 a 逗号 b 右圆括号");

var bracket = result("[a,b]");
assert.strictEqual(bracket.decision.mode, "structural");
assert.strictEqual(bracket.speech, "左方括号 a 逗号 b 右方括号");

var conditional = result(String.raw`P(A\mid B)`);
assert.strictEqual(conditional.decision.mode, "structural");
assert.strictEqual(conditional.speech, "P 左圆括号 A 竖线 B 右圆括号");
assert(conditional.decision.unresolvedAmbiguities.indexOf("conditional-probability-role") !== -1);

var explicitProbability = result(String.raw`P(A\mid B)`, { symbolFacts: { P: { type: "probability", evidence: "explicit", sourceText: "设 P 表示概率", scopeId: "current" } } });
assert.strictEqual(explicitProbability.decision.mode, "semantic");
assert.strictEqual(explicitProbability.speech, "A 在 B 条件下的概率");

var ordinaryFunction = result("P(A)", { symbolFacts: { P: { type: "function", evidence: "explicit", sourceText: "设 P 是普通函数", scopeId: "current" } } });
assert.strictEqual(ordinaryFunction.decision.mode, "structural");
assert.strictEqual(ordinaryFunction.speech, "P 左圆括号 A 右圆括号");

var sentencePrFunction = result("\\Pr(T)", { currentSentence: "令 Pr 是函数。" });
assert.strictEqual(sentencePrFunction.decision.mode, "structural");
assert.strictEqual(sentencePrFunction.speech, "Pr 左圆括号 T 右圆括号");
assert(sentencePrFunction.decision.unresolvedAmbiguities.indexOf("probability-function-role") !== -1);
assert(ordinaryFunction.decision.unresolvedAmbiguities.indexOf("probability-function-role") !== -1);

var explicitIntent = core.prepareMathSpeech({ mathml: "<math intent=\"conditional-probability\"><mrow><mi>P</mi><mo stretchy=\"false\">(</mo><mi>A</mi><mo>∣</mo><mi>B</mi><mo stretchy=\"false\">)</mo></mrow></math>" });
assert.strictEqual(explicitIntent.decision.mode, "semantic");
assert.strictEqual(explicitIntent.speech, "A 在 B 条件下的概率");

var hintOnly = result("|A|", { domainHints: ["set"] });
assert.strictEqual(hintOnly.decision.mode, "structural", "domain hints cannot eliminate critical bar ambiguity");

var setDifference = result("A-B", { symbolFacts: {
  A: { type: "set", evidence: "explicit" },
  B: { type: "set", evidence: "explicit" },
} });
assert.strictEqual(setDifference.speech, "A 与 B 的集合差");

var ordinaryDifference = result("a-b");
assert.strictEqual(ordinaryDifference.speech, "a 减 b");

var uppercaseDifference = result("A-B");
assert.strictEqual(uppercaseDifference.decision.mode, "structural");
assert(uppercaseDifference.decision.unresolvedAmbiguities.indexOf("set-or-arithmetic-difference") !== -1);

var implicitProduct = result("AB");
assert.strictEqual(implicitProduct.decision.mode, "structural");
assert.strictEqual(implicitProduct.speech, "A B");

var unary = result("-x");
assert.strictEqual(unary.speech, "负 x");

var differential = result("dx");
assert.strictEqual(differential.decision.mode, "structural");
assert.strictEqual(differential.speech, "d x");

var sentenceFact = result("|A|", { currentSentence: "设 A 为有限集合。" });
assert.strictEqual(sentenceFact.decision.mode, "semantic");
assert.strictEqual(sentenceFact.speech, "集合 A 的基数");

var sentenceOverridesRemote = result("|A|", { currentSentence: "设 A 为有限集合。", symbolFacts: {
  A: { type: "matrix", evidence: "explicit", scopeId: "classroom", sourceText: "令 A 是矩阵" },
} });
assert.strictEqual(sentenceOverridesRemote.speech, "集合 A 的基数");

var sameScopeConflict = result("|C|", { scopes: [{ kind: "currentSentence", symbolFacts: {
  C: [
    { type: "set", evidence: "explicit" },
    { type: "matrix", evidence: "explicit" },
  ],
} }] });
assert.strictEqual(sameScopeConflict.decision.mode, "structural");
assert(sameScopeConflict.decision.unresolvedAmbiguities.indexOf("conflicting-symbol-fact") !== -1);

var fiveLayerScope = result("|M|", { scopes: [
  { kind: "classroom", symbolFacts: { M: { type: "set", evidence: "explicit" } } },
  { kind: "knowledgePoint", symbolFacts: { M: { type: "scalar", evidence: "explicit" } } },
  { kind: "currentReply", symbolFacts: { M: { type: "matrix", evidence: "explicit" } } },
] });
assert.strictEqual(fiveLayerScope.speech, "矩阵 M 的行列式");

console.log("math speech ambiguity: PASS cases=20");
