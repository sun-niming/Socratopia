"use strict";

var assert = require("assert");
var core = require("./index");
var seal = require("./seal-policy");

function noThrow(input) {
  var result;
  assert.doesNotThrow(function () { result = core.prepareMathSpeech(input); });
  assert.strictEqual(result.ok, false, JSON.stringify(input));
  assert.strictEqual(result.decision.mode, "skip");
  assert.strictEqual(result.decision.sealed, true);
  assert.strictEqual(result.speech, "");
  assert.strictEqual(seal.containsForbiddenSpeech(result.speech), false);
  return result;
}

var malformed = [
  String.raw`\frac{`,
  String.raw`\sqrt{`,
  String.raw`\unknowncommand{x}`,
  String.raw`\href{javascript:alert(1)}{x}`,
  String.raw`\begin{matrix}1&2`,
  String.raw`\left(x`,
  "$$",
  "{",
  "}",
  String.raw`x^{`,
];
malformed.forEach(function (latex) {
  var result = noThrow({ latex: latex, locale: "zh-Hans" });
  assert(["parse-failed", "unsafe-structure", "unknown-semantic-macro"].indexOf(result.diagnostics.reason) !== -1);
});

var tooLong = noThrow({ latex: "x".repeat(20), limits: { maxInputChars: 8 } });
assert.strictEqual(tooLong.diagnostics.reason, "input-too-long");

var empty = noThrow({ latex: "", locale: "zh-Hans" });
assert.strictEqual(empty.diagnostics.reason, "invalid-input");

noThrow({ mathml: "<math><mrow><mi>x</mi></math>", locale: "zh-Hans" });
noThrow({ mathml: "<!DOCTYPE math [<!ENTITY x SYSTEM 'file:///secret'>]><math><mi>x</mi></math>", locale: "zh-Hans" });
noThrow({ mathml: "<math><mystery/></math>", locale: "zh-Hans" });
noThrow({ mathml: "<math><mo>⨂</mo></math>", locale: "zh-Hans" });
[
  0x0000, 0x0001, 0x007f, 0x0085, 0x2028, 0x2029, 0x202e, 0x202d, 0x202b, 0x202a,
  0x202c, 0x2060, 0x2065, 0x2066, 0x2067, 0x2068, 0x2069, 0x206a, 0x200b, 0x200c,
  0x200d, 0xfeff, 0xfff9,
].forEach(function (codePoint) {
  var character = String.fromCodePoint(codePoint);
  noThrow({ latex: "x" + character + "+1", locale: "zh-Hans" });
  noThrow({ mathml: "<math><mtext>A" + character + "B</mtext></math>", locale: "zh-Hans" });
});
noThrow({ mathml: "<math><mtext>A&#x202E;B</mtext></math>", locale: "zh-Hans" });
noThrow({ mathml: "<math><mtext><script>globalThis.pwned=1</script></mtext></math>", locale: "zh-Hans" });

var nested = "\\sqrt{".repeat(70) + "x" + "}".repeat(70);
var deep = noThrow({ latex: nested, locale: "zh-Hans" });
assert(["ast-too-deep", "parse-failed", "unsupported-node", "unsafe-structure"].indexOf(deep.diagnostics.reason) !== -1);

var outputLong = noThrow({ latex: String.raw`\text{` + "x".repeat(40) + "}", limits: { maxOutputChars: 10 } });
assert.strictEqual(outputLong.diagnostics.reason, "output-too-long");

console.log("math speech malformed: PASS cases=" + (malformed.length + 44));
