"use strict";

var fs = require("fs");

var file = process.argv[2];
var anchor = process.argv[3];
var tokens = process.argv.slice(4);
if (!file || !anchor || tokens.length === 0) {
  throw new Error("Usage: node tools/split-bundle-tokens.js <file> <anchor> <token> [...token]");
}

var source = fs.readFileSync(file, "utf8");
var cursor = source.indexOf(anchor);
if (cursor < 0) throw new Error("Anchor not found");

for (var token of tokens) {
  var index = source.indexOf(token, cursor);
  if (index < 0) throw new Error("Token not found after anchor: " + token);
  if (index > 0 && source[index - 1] !== "\n") {
    source = source.slice(0, index) + "\n" + source.slice(index);
    index += 1;
  }
  cursor = index + token.length;
}

fs.writeFileSync(file, source, "utf8");
