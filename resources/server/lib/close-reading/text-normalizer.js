"use strict";

function normalizeText(value) {
  return String(value == null ? "" : value)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .normalize("NFC");
}

function normalizeForSearch(value) {
  return normalizeText(value)
    .normalize("NFKC")
    .replace(/([A-Za-z])[-\u00AD]\s*\n\s*([A-Za-z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .replace(/\s*([(){}\[\],;:+*/=<>])\s*/g, "$1")
    .trim()
    .toLocaleLowerCase();
}

function effectiveLength(value) {
  return normalizeText(value).replace(/\s+/g, "").length;
}

function looksGarbled(value) {
  var text = normalizeText(value);
  if (!text) return false;
  var bad = (text.match(/[\uFFFD\uE000-\uF8FF]/g) || []).length;
  return bad >= 3 && bad / Math.max(1, text.length) > 0.01;
}

module.exports = {
  normalizeText: normalizeText,
  normalizeForSearch: normalizeForSearch,
  effectiveLength: effectiveLength,
  looksGarbled: looksGarbled,
};
