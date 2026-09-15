"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var script = fs.readFileSync(path.join(__dirname, "practice", "windows-ocr.ps1"), "utf8");
assert.ok(script.includes("ocr_language_unavailable"), "missing requested OCR language must have a stable error code");
assert.ok(!/if \(-not \$language\) \{\s*\$language = \$available \| Where-Object \{ \$_\.LanguageTag -like \"en-\*\" \}/m.test(script), "Chinese OCR must not silently fall back to English");
assert.ok(script.includes('$LanguageTag -like "zh-Hant*"'), "Traditional Chinese requests must select only zh-Hant recognizers");
assert.ok(script.includes('$LanguageTag -like "zh-Hans*"'), "Simplified Chinese requests must select only zh-Hans recognizers");
assert.ok(!script.includes('$LanguageTag -like "zh-*"'), "Traditional Chinese must not collapse into the Simplified recognizer family");
console.log("strict Windows OCR language smoke: PASS");
