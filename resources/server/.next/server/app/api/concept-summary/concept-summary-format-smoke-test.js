"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var routePath = path.join(__dirname, "route.js");
var source = fs.readFileSync(routePath, "utf-8");
var start = source.indexOf("function ab(a){");
var end = source.indexOf("let K=", start);
assert.ok(start >= 0 && end > start, "summary formatter is discoverable");
var formatterSource = source.slice(start, end);
var format = Function(formatterSource + ";return ab;")();

var cpp = 'std::cout << "line\\n";\\nstd::string tab = "\\t";';
assert.strictEqual(format(cpp), cpp, "C++ string escape sequences are preserved");
var escapedHeading = "Overview\\n# Details";
assert.strictEqual(format(escapedHeading), "Overview\n# Details", "double-escaped markdown heading is normalized");

console.log("concept summary format smoke: PASS");
