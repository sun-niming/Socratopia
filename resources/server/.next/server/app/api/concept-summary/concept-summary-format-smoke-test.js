"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var routePath = path.join(__dirname, "route.js");
var source = fs.readFileSync(routePath, "utf-8");
var start = source.indexOf("function ab(a){");
// The route is minified onto one line, so the formatter is sliced out by string
// offset. Anchor on the GET handler that follows, then back up to the
// formatter's own closing brace — stepping over whatever `let Q=` keyword the
// deletion of the old `let K=` prompt constants may have left behind.
var sentinel = source.indexOf("Q=(0,y.pW)(async function(a){", start);
var end = sentinel < 0 ? -1 : source.lastIndexOf("}", sentinel);
assert.ok(start >= 0 && end > start, "summary formatter is discoverable");
assert.strictEqual(source[end], "}", "the formatter slice must end on a closing brace");
var formatterSource = source.slice(start, end + 1);
var format = Function(formatterSource + ";return ab;")();

var cpp = 'std::cout << "line\\n";\\nstd::string tab = "\\t";';
assert.strictEqual(format(cpp), cpp, "C++ string escape sequences are preserved");
var escapedHeading = "Overview\\n# Details";
assert.strictEqual(format(escapedHeading), "Overview\n# Details", "double-escaped markdown heading is normalized");

console.log("concept summary format smoke: PASS");
