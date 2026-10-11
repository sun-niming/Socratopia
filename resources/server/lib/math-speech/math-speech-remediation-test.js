"use strict";

var assert = require("assert");
var core = require("./index");
var numbers = require("./numbers-zh");
var benchmark = require("./math-speech-benchmark");
var symbolScope = require("./symbol-scope");

function prepare(latex, options) {
  return core.prepareMathSpeech(Object.assign({ latex: latex, locale: "zh-Hans", style: "concise" }, options || {}));
}

function assertSafeSkip(result, label) {
  assert.strictEqual(result.ok, false, label + " must skip");
  assert.strictEqual(result.decision.mode, "skip", label + " mode");
  assert.strictEqual(result.decision.sealed, true, label + " sealed");
  assert.strictEqual(result.speech, "", label + " speech");
}

// FAILURE-001: P is not enough evidence for conditional probability.
var probabilityWithoutEvidence = prepare(String.raw`P(A\mid B)`);
assert.strictEqual(probabilityWithoutEvidence.ok, true);
assert.strictEqual(probabilityWithoutEvidence.decision.mode, "structural");
assert(probabilityWithoutEvidence.speech.indexOf("条件下的概率") === -1);
var probabilityHintOnly = prepare(String.raw`P(A\mid B)`, { context: { domainHints: ["probability"] } });
assert.strictEqual(probabilityHintOnly.decision.mode, "structural");
var probabilityExplicit = prepare(String.raw`P(A\mid B)`, { context: { symbolFacts: { P: { type: "probability", evidence: "explicit" } } } });
assert.strictEqual(probabilityExplicit.speech, "A 在 B 条件下的概率");
var probabilityConflict = prepare(String.raw`P(A\mid B)`, { context: { symbolFacts: {
  P: [
    { type: "probability", evidence: "explicit", scopeId: "current" },
    { type: "function", evidence: "explicit", scopeId: "current" },
  ],
} } });
assert.strictEqual(probabilityConflict.decision.mode, "structural");

// New round-2 regression: explicit ordinary functions named P/Pr must not be treated as probability operators.
var ordinaryPFunction = prepare("P(A)", { context: { symbolFacts: { P: { type: "function", evidence: "explicit", scopeId: "current" } } } });
assert.strictEqual(ordinaryPFunction.decision.mode, "structural");
assert.strictEqual(ordinaryPFunction.speech, "P 左圆括号 A 右圆括号");
assert(ordinaryPFunction.decision.unresolvedAmbiguities.indexOf("probability-function-role") !== -1);
var ordinaryPrFunction = prepare("\\Pr(A)", { context: { symbolFacts: { Pr: { type: "function", evidence: "explicit", scopeId: "current" } } } });
assert.strictEqual(ordinaryPrFunction.decision.mode, "structural");
assert.strictEqual(ordinaryPrFunction.speech, "Pr 左圆括号 A 右圆括号");
assert(ordinaryPrFunction.decision.unresolvedAmbiguities.indexOf("probability-function-role") !== -1);
var probabilityRoleConflict = prepare("P(A)", { context: { scopes: [{ kind: "currentSentence", symbolFacts: { P: [
  { type: "function", evidence: "explicit" },
  { type: "probability", evidence: "explicit" },
] } }] } });
assert.strictEqual(probabilityRoleConflict.decision.mode, "structural");
assert.strictEqual(probabilityRoleConflict.speech, "P 左圆括号 A 右圆括号");
assert(probabilityRoleConflict.decision.unresolvedAmbiguities.indexOf("conflicting-symbol-fact") !== -1);
var nearFunctionOverridesProbability = prepare("P(A)", { context: {
  symbolFacts: { P: { type: "probability", evidence: "explicit", scopeId: "classroom" } },
  scopes: [{ kind: "currentSentence", symbolFacts: { P: { type: "function", evidence: "explicit", scopeId: "sentence" } } }],
} });
assert.strictEqual(nearFunctionOverridesProbability.decision.mode, "structural");
assert.strictEqual(nearFunctionOverridesProbability.speech, "P 左圆括号 A 右圆括号");
var explicitProbabilityIntentWins = core.prepareMathSpeech({
  mathml: '<math intent="probability"><mrow><mi>P</mi><mo stretchy="false">(</mo><mi>A</mi><mo stretchy="false">)</mo></mrow></math>',
  context: { scopes: [{ kind: "currentSentence", symbolFacts: { P: [
    { type: "function", evidence: "explicit" },
    { type: "probability", evidence: "explicit" },
  ] } }] },
});
assert.strictEqual(explicitProbabilityIntentWins.decision.mode, "semantic");
assert.strictEqual(explicitProbabilityIntentWins.speech, "A 的概率");
var prTextScopes = [
  { currentSentence: "令 Pr 是函数。" },
  { currentReply: "令 Pr 是函数。" },
  { knowledgePointText: "令 Pr 是函数。" },
  { classroomText: "令 Pr 是函数。" },
];
prTextScopes.forEach(function (context) {
  var scopedPr = prepare("\\Pr(T)", { context: context });
  assert.strictEqual(scopedPr.decision.mode, "structural");
  assert.strictEqual(scopedPr.speech, "Pr 左圆括号 T 右圆括号");
});
var conflictingPrText = prepare("\\Pr(T)", { context: { currentSentence: "令 Pr 是函数。设 Pr 表示概率。" } });
assert.strictEqual(conflictingPrText.decision.mode, "structural");
assert(conflictingPrText.decision.unresolvedAmbiguities.indexOf("conflicting-symbol-fact") !== -1);
var multiCharacterFacts = symbolScope.extractExplicitFacts("令 Foo2 是函数。");
assert.strictEqual(multiCharacterFacts.Foo2.type, "function");
assert.strictEqual(multiCharacterFacts.Foo2.sourceText, "令 Foo2 是函数");
var identifier64 = "F".repeat(64);
var identifier65 = "G".repeat(65);
assert.strictEqual(symbolScope.extractExplicitFacts("令 " + identifier64 + " 是函数。")[identifier64].type, "function");
assert.deepStrictEqual(symbolScope.extractExplicitFacts("令 " + identifier65 + " 是函数。"), {});

// FAILURE-002: scientific notation is a number token, while standalone e is a constant.
assert.strictEqual(prepare("1.2e-3").speech, "一点二乘以十的负三次方");
assert.strictEqual(prepare("1e9").speech, "一乘以十的九次方");
assert.strictEqual(prepare("6.02e23").speech, "六点零二乘以十的二十三次方");
assert.strictEqual(prepare("1E+6").speech, "一乘以十的六次方");
assert.strictEqual(prepare("-2.5e-4").speech, "负二点五乘以十的负四次方");
assert.strictEqual(prepare("0e0").speech, "零乘以十的零次方");
assert.strictEqual(prepare("e").speech, "自然常数 e");
assert.strictEqual(prepare(String.raw`x_{1e9}`).speech.indexOf("一乘以十的九次方") !== -1, true);
assert.strictEqual(prepare(String.raw`\frac{1e9}{2}`).speech.indexOf("一乘以十的九次方") !== -1, true);
assert.strictEqual(prepare(String.raw`\begin{pmatrix}1e9&2\\3&4\end{pmatrix}`).speech.indexOf("一乘以十的九次方") !== -1, true);

// FAILURE-003: an integral without d<variable> must not invent x.
var missingDifferential = prepare(String.raw`\int_0^1 t^2`);
assert.strictEqual(missingDifferential.ok, true);
assert(missingDifferential.speech.indexOf("关于 x 的积分") === -1);
assert(missingDifferential.speech.indexOf("关于 t 的积分") === -1);
assert.strictEqual(prepare(String.raw`\int_0^1 t^2\,dt`).speech, "从零到一，t 的平方关于 t 的积分");
assert.strictEqual(prepare(String.raw`\int_0^1 t^2\,d\theta`).speech, "从零到一，t 的平方关于 西塔 的积分");
assert.strictEqual(prepare(String.raw`\iint_0^1 f(x,y)\,dx\,dy`).ok, true);

// FAILURE-004: every input route rejects controls; successful speech cannot contain them.
var controls = [0x0000, 0x0001, 0x007f, 0x0085, 0x2028, 0x2029, 0x202e, 0x202d, 0x202b, 0x202a, 0x202c, 0x2060, 0x2065, 0x2066, 0x2067, 0x2068, 0x2069, 0x206a, 0x200b, 0x200c, 0x200d, 0xfeff, 0xfff9];
controls.forEach(function (codePoint) {
  var character = String.fromCodePoint(codePoint);
  assertSafeSkip(prepare("x" + character + "+1"), "latex-control-" + codePoint.toString(16));
  assertSafeSkip(core.prepareMathSpeech({ mathml: "<math><mtext>A" + character + "B</mtext></math>", locale: "zh-Hans" }), "mathml-control-" + codePoint.toString(16));
});
assertSafeSkip(core.prepareMathSpeech({ mathml: "<math><mtext>A&#x202E;B</mtext></math>", locale: "zh-Hans" }), "mathml-encoded-rlo");
assertSafeSkip(core.prepareMathSpeech({ mathml: "<math><mtext>A\u0000B&#x202E;C</mtext><mystery/></math>", locale: "zh-Hans" }), "mathml-control-and-unknown");
assertSafeSkip(core.prepareMathSpeech({ mathml: "<math><mtext><script>globalThis.pwned=1</script></mtext></math>", locale: "zh-Hans" }), "mathml-nested-unknown-leaf");

// FAILURE-005: logical negation owns a complete next operand.
assert.strictEqual(prepare(String.raw`\neg(P\land Q)`).speech, "非（P 且 Q）");
assert.strictEqual(prepare(String.raw`\neg(P\lor Q)`).speech, "非（P 或 Q）");
assert.strictEqual(prepare(String.raw`\neg\neg P`).speech, "非（非 P）");
assert(prepare(String.raw`\neg\forall x\,P(x)`).speech.indexOf("非（") === 0);
assert(prepare(String.raw`\neg\exists x\,P(x)`).speech.indexOf("非（") === 0);

// FAILURE-006: only valid 3-digit groups merge; tuple commas remain commas.
assert.strictEqual(prepare("1,234").speech, "一千二百三十四");
assert.strictEqual(prepare("12,345").speech, "一万二千三百四十五");
assert.strictEqual(prepare("1,234,567").speech, "一百二十三万四千五百六十七");
assert.strictEqual(prepare("1,234.56").speech, "一千二百三十四点五六");
assert.strictEqual(prepare("-1,234").speech, "负一千二百三十四");
assert.notStrictEqual(prepare("12,34").speech, "一千二百三十四");
assert.strictEqual(prepare("(1,2)").speech, "左圆括号 一 逗号 二 右圆括号");
assert(prepare(String.raw`f(1,234)`).speech.indexOf("一千二百三十四") !== -1);

// FAILURE-007: current-sentence evidence outranks an older classroom fact.
var sentenceOverridesClass = prepare("|A|", { context: {
  currentSentence: "设 A 为有限集合。",
  symbolFacts: { A: { type: "matrix", evidence: "explicit", scopeId: "classroom", sourceText: "令 A 是矩阵" } },
} });
assert.strictEqual(sentenceOverridesClass.speech, "集合 A 的基数");
var layeredScopes = prepare("|M|", { context: { scopes: [
  { kind: "classroom", scopeId: "classroom", symbolFacts: { M: { type: "set", evidence: "explicit" } } },
  { kind: "currentSentence", scopeId: "sentence", symbolFacts: { M: { type: "matrix", evidence: "explicit" } } },
] } });
assert.strictEqual(layeredScopes.speech, "矩阵 M 的行列式");
var sameScopeConflict = prepare("|C|", { context: { scopes: [{ kind: "currentSentence", symbolFacts: {
  C: [
    { type: "set", evidence: "explicit" },
    { type: "matrix", evidence: "explicit" },
  ],
} }] } });
assert.strictEqual(sameScopeConflict.decision.mode, "structural");
assert.strictEqual(prepare("|a|", { context: { symbolFacts: { a: { type: "set", evidence: "explicit" } } } }).decision.mode, "semantic");
assert.strictEqual(prepare("|A|", { context: { symbolFacts: { a: { type: "set", evidence: "explicit" } } } }).decision.mode, "structural");

// FAILURE-008: accessors are rejected without being invoked more than once; dual sources are rejected.
var getterInput = {};
Object.defineProperty(getterInput, "latex", { enumerable: true, get: function () { throw new Error("getter-boom"); } });
assert.doesNotThrow(function () { assertSafeSkip(core.prepareMathSpeech(getterInput), "latex-getter"); });
var contextGetterInput = { latex: "x+1" };
Object.defineProperty(contextGetterInput, "context", { enumerable: true, get: function () { throw new Error("context-getter-boom"); } });
assert.doesNotThrow(function () { assertSafeSkip(core.prepareMathSpeech(contextGetterInput), "context-getter"); });
var limitsGetterInput = { latex: "x+1" };
Object.defineProperty(limitsGetterInput, "limits", { enumerable: true, get: function () { throw new Error("limits-getter-boom"); } });
assert.doesNotThrow(function () { assertSafeSkip(core.prepareMathSpeech(limitsGetterInput), "limits-getter"); });
var mathmlGetterInput = {};
Object.defineProperty(mathmlGetterInput, "mathml", { enumerable: true, get: function () { throw new Error("mathml-getter-boom"); } });
assert.doesNotThrow(function () { assertSafeSkip(core.prepareMathSpeech(mathmlGetterInput), "mathml-getter"); });
var symbolFactsGetterInput = { latex: "x+1", context: {} };
Object.defineProperty(symbolFactsGetterInput.context, "symbolFacts", { enumerable: true, get: function () { throw new Error("symbol-facts-getter-boom"); } });
assert.doesNotThrow(function () { assertSafeSkip(core.prepareMathSpeech(symbolFactsGetterInput), "symbol-facts-getter"); });
assertSafeSkip(core.prepareMathSpeech({ latex: "x+1", style: "invalid" }), "invalid-style");
assertSafeSkip(core.prepareMathSpeech({ latex: "x+1", limits: { maxInputChars: 0 } }), "invalid-limit");
var dualSource = { latex: "x".repeat(5000), mathml: "<math><mi>x</mi></math>" };
assertSafeSkip(core.prepareMathSpeech(dualSource), "dual-source");
var polluted = Object.create(null);
polluted.latex = "|A|";
polluted.context = Object.create(null);
polluted.context.symbolFacts = Object.create(null);
polluted.context.symbolFacts.__proto__ = { type: "set", evidence: "explicit" };
polluted.context.symbolFacts.constructor = { type: "matrix", evidence: "explicit" };
polluted.context.symbolFacts.prototype = { type: "scalar", evidence: "explicit" };
var pollutedResult = core.prepareMathSpeech(polluted);
assert.strictEqual(pollutedResult.decision.mode, "structural");

// FAILURE-009: semantic category and detailed speech mode are separate contract values.
var detailed = prepare(String.raw`\frac{\sqrt{x^2+1}}{a-b}`);
assert.strictEqual(detailed.ok, true);
assert.strictEqual(detailed.decision.mode, "detailed");
assert.strictEqual(detailed.decision.verbosity, "detailed");
assert(detailed.speech.indexOf("一个分数") === 0);
assert.strictEqual(prepare(String.raw`\frac{1}{2}`).decision.mode, "semantic");

// Direct number API remains isolated from ordinary text.
assert.strictEqual(numbers.speakNumber("1.2e-3", { role: "scientific" }), "一点二乘以十的负三次方");

// FAILURE-011: benchmark validity is not equivalent to “did not throw”.
var allSkipped = benchmark.runBenchmark(function () {
  return { ok: false, speech: "", decision: { mode: "skip", sealed: true }, diagnostics: { nodeCoverage: 0 } };
}, { iterations: 30, warmup: 0 });
assert.strictEqual(allSkipped.valid, false);
assert(allSkipped.failures.length > 0);

console.log("math speech remediation regression: PASS");
