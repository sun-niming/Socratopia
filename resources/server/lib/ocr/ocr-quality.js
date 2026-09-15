"use strict";

function normalize(text) {
  return String(text || "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/(\p{Script=Han}) +(?=\p{Script=Han})/gu, "$1")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countMatches(text, expression) {
  var matches = text.match(expression);
  return matches ? matches.length : 0;
}

function assess(input, options) {
  options = options || {};
  var text = normalize(input);
  var length = Array.from(text).length;
  var replacement = countMatches(text, /\uFFFD/g);
  var controls = countMatches(text, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g);
  var placeholders = countMatches(text, /[\u25A1\u25AF]/g);
  var cjk = countMatches(text, /\p{Script=Han}/gu);
  var visible = countMatches(text, /[\p{L}\p{N}\p{Script=Han}]/gu);
  var mojibake = countMatches(text, /(?:锟斤拷|Ã[\u0080-\u00FF]|Â[\u0080-\u00FF]|â[\u0080-\u00BF]{1,2})/g);
  var frequencies = new Map();
  Array.from(text).filter(function (character) { return /[\p{L}\p{N}\p{Script=Han}]/u.test(character); }).forEach(function (character) {
    frequencies.set(character, (frequencies.get(character) || 0) + 1);
  });
  var maximumFrequency = 0;
  frequencies.forEach(function (value) { maximumFrequency = Math.max(maximumFrequency, value); });
  var repetitive = visible >= 8 && maximumFrequency / Math.max(1, visible) >= 0.7;
  var suspicious = replacement + controls + mojibake + placeholders;
  var garbled = suspicious > 0 && suspicious / Math.max(1, length) >= 0.05;
  if (replacement >= 2 || controls >= 2 || placeholders >= 2 || mojibake > 0 || repetitive) garbled = true;
  var minimumVisible = options.source === "windows-ocr" || options.source === "rapidocr-v5" ? 3 : 1;
  var visibleRatio = visible / Math.max(1, length);
  var usable = length > 0 && visible >= minimumVisible && visibleRatio >= 0.2 && !garbled;
  var score = usable ? Math.max(0, Math.min(1, 0.55 + 0.35 * visibleRatio + (cjk > 0 ? 0.1 : 0))) : 0;
  return Object.freeze({
    usable: usable,
    garbled: garbled,
    length: length,
    cjk: cjk,
    visible: visible,
    replacement: replacement,
    controls: controls,
    placeholders: placeholders,
    mojibake: mojibake,
    repetitive: repetitive,
    score: score,
    reason: usable ? null : !length ? "empty_text" : garbled ? "garbled_text" : "low_quality_text"
  });
}

module.exports = { normalize: normalize, assess: assess };
