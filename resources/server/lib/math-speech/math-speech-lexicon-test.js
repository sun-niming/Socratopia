"use strict";

var assert = require("assert");
var lexicon = require("./lexicon-zh");

var operatorSymbols = [
  "+", "−", "×", "÷", "·", "/", "=", "≠", "<", ">", "≤", "≥", "≈", "≡", "∝",
  "∞", "±", "∓", "√", "∑", "∏", "∫", "∂", "∇", "∈", "∉", "⊂", "⊆", "⊃", "⊇",
  "∪", "∩", "∅", "∀", "∃", "¬", "∧", "∨", "⇒", "⇔", "⊢", "⊨", "→", "←", "↔", "↦",
];
operatorSymbols.forEach(function (symbol) { assert(lexicon.operatorInfo(symbol), "missing operator: " + symbol); });

var greek = "αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ";
Array.from(greek).forEach(function (symbol) { assert(lexicon.identifierSpeech(symbol), "missing Greek symbol: " + symbol); });

assert.strictEqual(lexicon.operatorInfo("-").unary, "负");
assert.strictEqual(lexicon.operatorInfo("-").binary, "减");
assert.strictEqual(lexicon.operatorInfo("-").setDifference, "集合差");
assert.strictEqual(lexicon.operatorInfo("|").delimiter, "竖线");
assert.strictEqual(lexicon.operatorInfo("|").conditional, "在……条件下");
assert.strictEqual(lexicon.operatorInfo("|").divides, "整除");
assert.notStrictEqual(typeof lexicon.OPERATORS["-"], "string");
assert.notStrictEqual(typeof lexicon.OPERATORS["|"], "string");

console.log("math speech lexicon: PASS operators=" + operatorSymbols.length + " greek=" + Array.from(greek).length);
