"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var files = [
  ".next/server/chunks/7341.js",
  ".next/server/app/api/account/init/route.js",
  ".next/server/app/api/companion/avatar/route.js",
  ".next/server/app/api/profile/reset/route.js",
  ".next/server/app/api/pdf-assets/route.js"
];

function extractDefinition(source, file) {
  var marker = "function _accountContext()";
  var start = source.indexOf(marker);
  assert(start >= 0, file + " must contain the account context adapter");
  var end = source.indexOf("}},", start);
  assert(end > start, file + " must contain the complete module 93536 definition");
  return source.slice(start, end);
}

var definitions = files.map(function (file) {
  var source = fs.readFileSync(path.join(__dirname, file), "utf8");
  assert.strictEqual((source.match(/function _accountContext\(\)/g) || []).length, 1, file + " must define one adapter");
  assert(source.indexOf("global.__SOCRATOPIA_ROUTE_AUTH__") >= 0, file + " must delegate HTTP requests to the capability gate");
  assert.strictEqual(source.indexOf("X-Account-Id"), -1, file + " must not contain a raw account selector fallback");
  assert.strictEqual(source.indexOf("Missing or invalid X-Account-Id"), -1, file + " must not expose the legacy selector error");
  return extractDefinition(source, file);
});

definitions.slice(1).forEach(function (definition, index) {
  assert.strictEqual(definition, definitions[0], files[index + 1] + " must match the shared module implementation");
});
assert.strictEqual(definitions[0].indexOf('require("fs")'), -1, "shared module must not add require(fs)");
console.log("account request context bundle smoke test passed for " + files.length + " definitions");
