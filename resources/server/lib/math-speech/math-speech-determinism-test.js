"use strict";

var assert = require("assert");
var core = require("./index");

var input = {
  latex: String.raw`\frac{\sqrt{x^2+1}}{a-b}`,
  locale: "zh-Hans",
  style: "concise",
  context: {
    precedingText: "设 x 为实数",
    currentSentence: "设 x 为实数。",
    domainHints: ["algebra"],
    symbolFacts: { x: { type: "scalar", evidence: "explicit" } },
  },
};
var baseline = core.prepareMathSpeech(input);
var serialized = JSON.stringify(baseline);
for (var index = 0; index < 50; index += 1) {
  assert.strictEqual(JSON.stringify(core.prepareMathSpeech(input)), serialized, "same input must be deterministic");
}

assert.strictEqual(Object.isFrozen(baseline), true);
assert.strictEqual(Object.isFrozen(baseline.decision), true);
assert.strictEqual(Object.isFrozen(baseline.diagnostics), true);
assert.strictEqual(Object.isFrozen(baseline.ast), true);

var mutableFacts = { A: { type: "set", evidence: "explicit" } };
var first = core.prepareMathSpeech({ latex: "|A|=5", context: { symbolFacts: mutableFacts } });
mutableFacts.A.type = "scalar";
delete mutableFacts.A.evidence;
assert.strictEqual(first.speech, "集合 A 的基数，等于五");

var noFacts = { symbolFacts: {} };
var oldResult = core.prepareMathSpeech({ latex: "|A|=5", context: noFacts });
noFacts.symbolFacts.A = { type: "set", evidence: "explicit" };
assert.strictEqual(oldResult.speech, "左竖线 A 右竖线，等于五");

var futureResult = core.prepareMathSpeech({ latex: "|A|+1", context: noFacts });
assert.strictEqual(futureResult.speech, "集合 A 的基数加一");

var detailed = core.prepareMathSpeech({ latex: String.raw`\frac{\sqrt{x^2+1}}{a-b}`, style: "detailed" });
assert.strictEqual(detailed.ok, true);
assert.strictEqual(detailed.decision.verbosity, "detailed");
assert(detailed.speech.indexOf("一个分数") === 0);

console.log("math speech determinism: PASS iterations=50");
