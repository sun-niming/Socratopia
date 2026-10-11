"use strict";

var DIGITS = Object.freeze(["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]);
var SMALL_UNITS = Object.freeze(["", "十", "百", "千"]);
var LARGE_UNITS = Object.freeze(["", "万", "亿", "兆", "京", "垓", "秭", "穰"]);
var MAX_DIGITS = 256;

function asString(value) {
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function digitSpeech(value) {
  var text = asString(value);
  if (!text) return "";
  var result = "";
  for (var index = 0; index < text.length; index += 1) {
    var character = text[index];
    if (character >= "0" && character <= "9") result += DIGITS[character.charCodeAt(0) - 48];
    else if (character === ".") result += "点";
    else if (character === "+") continue;
    else if (character === "-" || character === "−") result += "负";
    else return "";
  }
  return result;
}

function fourDigitSpeech(value, omitLeadingOneBeforeTen) {
  var digits = String(value).padStart(4, "0");
  var result = "";
  var zeroPending = false;
  for (var index = 0; index < 4; index += 1) {
    var digit = digits.charCodeAt(index) - 48;
    var position = 3 - index;
    if (digit === 0) {
      if (result) zeroPending = true;
      continue;
    }
    if (zeroPending) result += "零";
    if (!(omitLeadingOneBeforeTen && result === "" && position === 1 && digit === 1)) {
      result += DIGITS[digit];
    }
    result += SMALL_UNITS[position];
    zeroPending = false;
  }
  return result;
}

function integerSpeech(value) {
  var text = asString(value);
  if (!/^\d+$/.test(text)) return "";
  if (text.length > MAX_DIGITS) return "";
  if (text.length > 1 && text[0] === "0") return digitSpeech(text);
  text = text.replace(/^0+(?=\d)/, "");
  if (text === "0") return DIGITS[0];
  var groups = [];
  for (var end = text.length; end > 0; end -= 4) {
    var start = Math.max(0, end - 4);
    groups.unshift(text.slice(start, end));
  }
  var result = "";
  var zeroBetween = false;
  for (var index = 0; index < groups.length; index += 1) {
    var group = groups[index];
    var groupValue = Number(group);
    var largeUnitIndex = groups.length - index - 1;
    if (groupValue === 0) {
      if (result) zeroBetween = true;
      continue;
    }
    if (result && (zeroBetween || groupValue < 1000)) result += "零";
    result += fourDigitSpeech(group, index === 0);
    if (largeUnitIndex >= LARGE_UNITS.length) return "";
    result += LARGE_UNITS[largeUnitIndex];
    zeroBetween = false;
  }
  return result;
}

function unsignedDecimalSpeech(value) {
  var text = asString(value);
  if (/^\.\d+$/.test(text)) text = "0" + text;
  if (!/^\d+(?:\.\d*)?$/.test(text)) return "";
  var parts = text.split(".");
  var integer = integerSpeech(parts[0]);
  if (!integer) return "";
  return parts.length === 1 ? integer : integer + "点" + digitSpeech(parts[1]);
}

function decimalSpeech(value) {
  var text = asString(value);
  if (!text) return "";
  var negative = text[0] === "-" || text[0] === "−";
  if (negative || text[0] === "+") text = text.slice(1);
  var speech = unsignedDecimalSpeech(text);
  return speech ? (negative ? "负" : "") + speech : "";
}

function exponentSpeech(value) {
  var text = asString(value).replace(/\s+/g, "");
  var match = text.match(/^(.+?)\^([+-−]?\d+)$/);
  if (!match) return "";
  var base = decimalSpeech(match[1]);
  var exponent = decimalSpeech(match[2]);
  return base && exponent ? base + "的" + exponent + "次方" : "";
}

function scientificSpeech(value) {
  var text = asString(value).replace(/\s+/g, "");
  var match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))[eE]([+-]?\d+)$/);
  if (!match) return "";
  var coefficient = decimalSpeech(match[1]);
  var exponent = decimalSpeech(match[2]);
  return coefficient && exponent ? coefficient + "乘以十的" + exponent + "次方" : "";
}

function speakNumber(value, options) {
  var role = options && typeof options.role === "string" ? options.role : "cardinal";
  var text = asString(value);
  if (!text || text.length > MAX_DIGITS + 32) return "";
  if (role === "cardinal" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+$/.test(text)) return scientificSpeech(text);
  if (role === "digits" || role === "subscript") return digitSpeech(text);
  if (role === "percentage") {
    var percentage = text.endsWith("%") ? text.slice(0, -1) : text;
    var percentageSpeech = decimalSpeech(percentage);
    return percentageSpeech ? "百分之" + percentageSpeech : "";
  }
  if (role === "exponent") return exponentSpeech(text);
  if (role === "scientific") return scientificSpeech(text);
  if (role === "ordinal") {
    var ordinal = decimalSpeech(text);
    return ordinal ? "第" + ordinal : "";
  }
  if (role === "negative") {
    var negative = decimalSpeech(text);
    return negative ? (negative.indexOf("负") === 0 ? negative : "负" + negative) : "";
  }
  if (text.endsWith("%")) return speakNumber(text, { role: "percentage" });
  if (/^[+-]?\d+\.\d+$/.test(text) || /^[+-]?\.\d+$/.test(text)) return decimalSpeech(text);
  if (/^[+-]?\d+$/.test(text)) {
    var negativeSign = text[0] === "-" || text[0] === "−";
    var unsigned = negativeSign || text[0] === "+" ? text.slice(1) : text;
    var integer = integerSpeech(unsigned);
    return integer ? (negativeSign ? "负" : "") + integer : "";
  }
  return decimalSpeech(text);
}

module.exports = {
  DIGITS: DIGITS,
  MAX_DIGITS: MAX_DIGITS,
  speakNumber: speakNumber,
  digitSpeech: digitSpeech,
  integerSpeech: integerSpeech,
  decimalSpeech: decimalSpeech,
  exponentSpeech: exponentSpeech,
  scientificSpeech: scientificSpeech,
};
