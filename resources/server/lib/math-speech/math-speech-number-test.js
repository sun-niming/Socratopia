"use strict";

var assert = require("assert");
var numbers = require("./numbers-zh");
var core = require("./index");

var cases = [
  ["0", "零"], ["10", "十"], ["11", "十一"], ["20", "二十"],
  ["101", "一百零一"], ["1001", "一千零一"], ["10000", "一万"],
  ["10001", "一万零一"], ["2026", "二千零二十六"], ["3.14", "三点一四"],
  ["-2", "负二"], ["0012", "零零一二"],
];
cases.forEach(function (item) { assert.strictEqual(numbers.speakNumber(item[0]), item[1], item[0]); });
assert.strictEqual(numbers.speakNumber("25%", { role: "percentage" }), "百分之二十五");
assert.strictEqual(numbers.speakNumber("25", { role: "percentage" }), "百分之二十五");
assert.strictEqual(numbers.speakNumber("10^8", { role: "exponent" }), "十的八次方");
assert.strictEqual(numbers.speakNumber("10^-3", { role: "exponent" }), "十的负三次方");
assert.strictEqual(numbers.speakNumber("1.2e-3", { role: "scientific" }), "一点二乘以十的负三次方");
assert.strictEqual(numbers.speakNumber("1.2e-3"), "一点二乘以十的负三次方");
assert.strictEqual(numbers.speakNumber("e"), "", "standalone constants are AST identifiers, not number input");
assert.strictEqual(numbers.speakNumber("12", { role: "digits" }), "一二");
assert.strictEqual(numbers.speakNumber("12", { role: "subscript" }), "一二");
assert.strictEqual(numbers.speakNumber("12", { role: "ordinal" }), "第十二");

var precise = numbers.speakNumber("9007199254740993");
assert(precise.indexOf("九千零七") === 0, "large integer must retain decimal digits");
assert.strictEqual(numbers.speakNumber("9".repeat(257)), "", "extreme integer must be bounded");

var text = core.prepareMathSpeech({ latex: String.raw`\text{HTTP/1.1 GPT-5.6 v4 2026 年 第 12 页 模型 64092}` });
assert.strictEqual(text.ok, true);
assert(text.speech.indexOf("HTTP/1.1") !== -1);
assert(text.speech.indexOf("GPT-5.6") !== -1);
assert(text.speech.indexOf("64092") !== -1);

var mathNumber = core.prepareMathSpeech({ latex: "2026" });
assert.strictEqual(mathNumber.speech, "二千零二十六");

var independentBoundaries = [
  ["100", "一百"], ["110", "一百一十"], ["1000", "一千"], ["1010", "一千零一十"],
  ["100000001", "一亿零一"], ["0.001", "零点零零一"], ["-0.5", "负零点五"],
  ["0000", "零零零零"], ["0007", "零零零七"], ["1e9", "一乘以十的九次方"],
  ["6.02e23", "六点零二乘以十的二十三次方"], ["1.2e-3", "一点二乘以十的负三次方"],
  ["1E+6", "一乘以十的六次方"], ["-2.5e-4", "负二点五乘以十的负四次方"],
  ["0e0", "零乘以十的零次方"], ["1,234", "一千二百三十四"],
  ["12,345", "一万二千三百四十五"], ["1,234,567", "一百二十三万四千五百六十七"],
  ["1,234.56", "一千二百三十四点五六"], ["-1,234", "负一千二百三十四"],
  ["100\\%", "百分之一百"], ["0\\%", "百分之零"], ["50\\%", "百分之五十"],
  ["123456789", "一亿二千三百四十五万六千七百八十九"], ["100010001", "一亿零一万零一"],
  ["9007199254740993", "九千零七兆一千九百九十二亿五千四百七十四万零九百九十三"],
  ["999999999999999999999999999999", "九十九穰九千九百九十九秭九千九百九十九垓九千九百九十九京九千九百九十九兆九千九百九十九亿九千九百九十九万九千九百九十九"],
  ["3.1415926", "三点一四一五九二六"], ["-0.125", "负零点一二五"],
  ["10^8", "十的八次方"], ["10^{-3}", "十的负三次方"],
];
independentBoundaries.forEach(function (item) {
  var latex = item[0].indexOf("\\%") !== -1 ? item[0] : item[0];
  var result = core.prepareMathSpeech({ latex: latex });
  assert.strictEqual(result.ok, true, "boundary " + item[0]);
  assert.strictEqual(result.speech, item[1], "boundary " + item[0]);
});

var ordinaryText = core.prepareMathSpeech({ latex: String.raw`\text{HTTP/1.1 GPT-5.6 v4 2026 年 第 12 页 模型 64092 IPv4 Windows 11}` });
assert.strictEqual(ordinaryText.ok, true);
["HTTP/1.1", "GPT-5.6", "v4", "2026", "第", "12", "64092", "IPv4", "Windows", "11"].forEach(function (token) {
  assert(ordinaryText.speech.indexOf(token) !== -1, "ordinary text token " + token);
});

console.log("math speech number: PASS cases=" + (cases.length + independentBoundaries.length + 11));
