"use strict";

var assert = require("assert");
var core = require("./index");
var seal = require("./seal-policy");

function prepare(latex, extra) {
  var input = Object.assign({ latex: latex, locale: "zh-Hans", style: "concise" }, extra || {});
  return core.prepareMathSpeech(input);
}

var examples = [
  ["x^2+y^2=z^2", "x 的平方加 y 的平方，等于 z 的平方"],
  [String.raw`\frac{1}{2}`, "二分之一"],
  [String.raw`\sqrt{x+1}`, "x 加一的平方根"],
  [String.raw`\sqrt[3]{x}`, "x 的立方根"],
  [String.raw`\sum_{i=1}^{n} a_i`, "从 i 等于一到 n，对 a 下标 i 求和"],
  [String.raw`\int_0^1 x^2\,dx`, "从零到一，x 的平方关于 x 的积分"],
  [String.raw`\lim_{x\to 0}\frac{\sin x}{x}=1`, "当 x 趋近于零时，正弦 x 除以 x 的极限，等于一"],
];

examples.forEach(function (item) {
  var result = prepare(item[0]);
  assert.strictEqual(result.ok, true, item[0] + " should parse");
  assert.strictEqual(result.speech, item[1], item[0] + " speech");
  assert.strictEqual(result.decision.sealed, true);
  assert.strictEqual(typeof result.speech, "string");
  assert.strictEqual(result.diagnostics.containsRawLatex, false);
  ["这个公式", "来看这个公式", "请看公式", "公式如下"].forEach(function (phrase) {
    assert.strictEqual(result.speech.indexOf(phrase), -1, item[0] + " placeholder");
  });
  assert.strictEqual(Object.isFrozen(result), true);
});

var ambiguous = prepare("|A|=5");
assert.strictEqual(ambiguous.ok, true);
assert.strictEqual(ambiguous.decision.mode, "structural");
assert.deepStrictEqual(ambiguous.decision.unresolvedAmbiguities, ["vertical-bar-meaning"]);
assert.strictEqual(ambiguous.speech, "左竖线 A 右竖线，等于五");

var facts = { A: { type: "set", evidence: "explicit" } };
var cardinality = prepare("|A|+1", { context: { symbolFacts: facts } });
assert.strictEqual(cardinality.ok, true);
assert.strictEqual(cardinality.decision.mode, "semantic");
assert.strictEqual(cardinality.speech, "集合 A 的基数加一");

var probability = prepare(String.raw`P(A\mid B)`);
assert.strictEqual(probability.ok, true);
assert.strictEqual(probability.decision.mode, "structural");
assert.strictEqual(probability.speech, "P 左圆括号 A 竖线 B 右圆括号");

var detailed = prepare(String.raw`\frac{\sqrt{x^2+1}}{a-b}`);
assert.strictEqual(detailed.decision.mode, "detailed");
assert.strictEqual(detailed.decision.verbosity, "detailed");

var missingDifferential = prepare(String.raw`\int_0^1 t^2`);
assert.strictEqual(missingDifferential.decision.mode, "structural");
assert(missingDifferential.speech.indexOf("关于 x 的积分") === -1);

var directMathml = core.prepareMathSpeech({
  mathml: "<math><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>",
  locale: "zh-Hans",
});
assert.strictEqual(directMathml.ok, true);
assert.strictEqual(directMathml.speech, "x 加一");

var context = { symbolFacts: {} };
var frozen = prepare("|A|=5", { context: context });
context.symbolFacts.A = { type: "set", evidence: "explicit" };
assert.strictEqual(frozen.speech, "左竖线 A 右竖线，等于五");
assert.strictEqual(seal.containsForbiddenSpeech(frozen.speech), false);

console.log("math speech smoke: PASS examples=" + (examples.length + 7));
