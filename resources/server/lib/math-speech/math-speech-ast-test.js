"use strict";

var assert = require("assert");
var parser = require("./mathml-to-ast");
var normalizer = require("./normalize-ast");
var diagnostics = require("./diagnostics");

function convert(inner) {
  var parsed = parser.parseMathml("<math><semantics>" + inner + "<annotation encoding=\"application/x-tex\">ignored</annotation></semantics></math>");
  assert.strictEqual(parsed.ok, true);
  var converted = parser.mathmlToAst(parsed.root);
  assert.strictEqual(converted.ok, true);
  return normalizer.normalizeAst(converted.ast).ast;
}

assert.strictEqual(convert("<mn>12</mn>").type, "number");
assert.strictEqual(convert("<mi>x</mi>").type, "identifier");
assert.strictEqual(convert("<mtext>if</mtext>").type, "text");
assert.strictEqual(convert("<mo>+</mo>").type, "operator");
assert.strictEqual(convert("<mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow>").type, "binary");
assert.strictEqual(convert("<mfrac><mn>1</mn><mn>2</mn></mfrac>").type, "fraction");
assert.strictEqual(convert("<msqrt><mi>x</mi></msqrt>").type, "root");
assert.strictEqual(convert("<mroot><mi>x</mi><mn>3</mn></mroot>").type, "root");
assert.strictEqual(convert("<msup><mi>x</mi><mn>2</mn></msup>").type, "power");
assert.strictEqual(convert("<msub><mi>a</mi><mi>i</mi></msub>").type, "subscript");
assert.strictEqual(convert("<msubsup><mi>a</mi><mi>i</mi><mn>2</mn></msubsup>").type, "subsup");
assert.strictEqual(convert("<mover accent=\"true\"><mi>x</mi><mo>^</mo></mover>").type, "accent");
assert.strictEqual(convert("<munder accentunder=\"true\"><mi>x</mi><mo>‾</mo></munder>").type, "accent");
assert.strictEqual(convert("<munderover><mo>∑</mo><mi>i</mi><mi>n</mi></munderover>").type, "summation");
assert.strictEqual(convert("<mfenced><mi>x</mi></mfenced>").type, "fenced");
assert.strictEqual(convert("<mtable><mtr><mtd><mn>1</mn></mtd></mtr></mtable>").type, "matrix");
assert.strictEqual(convert("<mrow><mn>1</mn><mi>e</mi><mo>−</mo><mn>3</mn></mrow>").type, "scientific");
assert.strictEqual(convert("<mrow><mi>∀</mi><mi>x</mi><mo>∈</mo><mi>A</mi></mrow>").type, "quantifier");
assert.strictEqual(convert("<mrow><mn>25</mn><mi>%</mi></mrow>").type, "percentage");
var annotationOnly = parser.mathmlToAst(parser.parseMathml("<math><semantics><annotation-xml encoding=\"application/xml\"><mrow><mi>x</mi></mrow></annotation-xml></semantics></math>").root);
assert.strictEqual(annotationOnly.ok, false);

var unknown = convert("<mystery><mi>x</mi></mystery>");
assert.strictEqual(unknown.type, "unknown");
var report = diagnostics.analyzeAst(unknown);
assert.strictEqual(report.unknownNodes, 1);
assert.strictEqual(report.nodeCoverage, 0);

var malformed = parser.parseMathml("<math><mrow><mi>x</mi></math>");
assert.strictEqual(malformed.ok, false);
assert.strictEqual(parser.parseMathml("<!DOCTYPE math><math><mi>x</mi></math>").ok, false);
assert.strictEqual(parser.parseMathml("<math><mi>&amp;</mi></math>").ok, true);
assert.strictEqual(parser.parseMathml("<math><mtext><script>x</script></mtext></math>").ok, true);

console.log("math speech AST: PASS mappings=21");
