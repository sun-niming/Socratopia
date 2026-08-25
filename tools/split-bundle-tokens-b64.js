"use strict";

var fs = require("fs");

var file = process.argv[2];
var encoded = process.argv.slice(3);
if (!file || encoded.length < 2) {
  throw new Error("Usage: node tools/split-bundle-tokens-b64.js <file> <base64-anchor> <base64-token> [...token]");
}

var values = encoded.map(function (value) {
  return Buffer.from(value, "base64").toString("utf8");
});
var source = fs.readFileSync(file, "utf8");
var cursor = source.indexOf(values[0]);
if (cursor < 0) throw new Error("Anchor not found");

for (var token of values.slice(1)) {
  var index = source.indexOf(token, cursor);
  if (index < 0) throw new Error("Token not found after anchor: " + token);
  if (index > 0 && source[index - 1] !== "\n") {
    source = source.slice(0, index) + "\n" + source.slice(index);
    index += 1;
  }
  cursor = index + token.length;
}

fs.writeFileSync(file, source, "utf8");
