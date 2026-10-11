#!/usr/bin/env node
"use strict";

// Guard for tools/patch-inline-math-dollar.js.
//
// The v1 patch regressed silently: the bundles kept whatever syntax the patch
// left behind and the app only failed when React rendered.  This test pins the
// properties that regression broke on the live bundle:
//
//   1. it parses (a cut template / stray callback is fatal);
//   2. the helper never shares a name with a binding in the same scope — the v1
//      name `eS` collided with `var eS=r(6035)` in page-87daa6ca210ab9dc.js and
//      the var won, so the render called a module object
//      ("TypeError: eS is not a function");
//   3. the helper keeps its contract: `\$` inside math -> \text{\textdollar},
//      `\$` in prose untouched.
//
// The four non-live bundles currently carry the helper without a live call
// (their first module copy was truncated by another patch, see the WARN lines);
// that is reported but does not fail this test.
//
// Usage: node tools/patch-inline-math-dollar-smoke-test.js

var fs = require("fs");
var path = require("path");
var acorn = require("acorn");

var root = path.resolve(__dirname, "..");
var dir = path.join(root, "resources", "server", ".next", "static", "chunks", "app");
var NAME = "__inlineMathDollar";
var SCANNER = "function " + NAME + '(e){let t="",r=0,a=!1;';
var LIVE = "page-87daa6ca210ab9dc.js";
var FILES = [
  LIVE,
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
];

var failures = [], allSources = {};
function check(ok, label, detail) {
  if (!ok) failures.push(label + (detail ? " — " + detail : ""));
  console.log((ok ? "PASS  " : "FAIL  ") + label + (detail && !ok ? " — " + detail : ""));
}
function duplicateBindings(src, name) {
  var ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: "module" });
  var found = [];
  (function walk(node) {
    var isFn = node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" || node.type === "Program";
    if (isFn) {
      var n = 0;
      (function scan(x) {
        if (x.type === "VariableDeclarator" && x.id && x.id.name === name) n++;
        if (x.type === "FunctionDeclaration" && x.id && x.id.name === name) n++;
        if (x.type === "FunctionDeclaration" || x.type === "FunctionExpression" || x.type === "ArrowFunctionExpression") {
          (x.params || []).forEach(function (p) { if (p.name === name) n++; });
        }
        for (var k in x) {
          if (k === "type" || k === "start" || k === "end") continue;
          var v = x[k];
          if (Array.isArray(v)) v.forEach(function (c) { if (c && c.type) scan(c); });
          else if (v && v.type) scan(v);
        }
      })(node);
      if (n > 1) found.push(node.type + "@" + node.start + " x" + n);
    }
    for (var k in node) {
      if (k === "type" || k === "start" || k === "end") continue;
      var v = node[k];
      if (Array.isArray(v)) v.forEach(function (c) { if (c && c.type) walk(c); });
      else if (v && v.type) walk(v);
    }
  })(ast);
  return found;
}

FILES.forEach(function (name) {
  var src = fs.readFileSync(path.join(dir, name), "utf8");
  allSources[name] = src;
  check(src.indexOf(SCANNER) >= 0, name + ": carries the helper");
  check(src.indexOf("e=eS(e)") < 0, name + ": no leftover `e=eS(e)` call (v1 name)");
  var parsed = true;
  try { acorn.parse(src, { ecmaVersion: 2022, sourceType: "module" }); }
  catch (error) { parsed = false; }
  if (!parsed) {
    if (name === LIVE) check(false, name + ": parses");
    else console.log("WARN  " + name + " does not parse (truncated first module copy; see tmp/structure notes)");
    return;
  }
  check(true, name + ": parses");
  var dupes = duplicateBindings(src, NAME);
  check(dupes.length === 0, name + ": no duplicate " + NAME + " binding", dupes.join(", "));
});

var live = allSources[LIVE];
var decl = live.match(new RegExp("function " + NAME + "\\(e\\)\\{[\\s\\S]*?return t\\}"));
check(!!decl, "helper body is extractable from the live bundle");
if (decl) {
  var fn = new Function(decl[0] + "; return " + NAME + ";")();
  [["\\$ inside math", "$a\\$b$", "$a\\text{\\textdollar}b$"],
   ["\\$ in prose", "costs \\$5 today", "costs \\$5 today"],
   ["display math", "$$a\\$b$$", "$$a\\text{\\textdollar}b$$"],
   ["plain", "no dollars", "no dollars"]].forEach(function (c) {
    check(fn(c[1]) === c[2], "helper: " + c[0], JSON.stringify(fn(c[1])));
  });
}

console.log("");
if (failures.length) {
  console.error(failures.length + " failure(s)");
  process.exitCode = 1;
} else {
  console.log("patch-inline-math-dollar smoke: PASS");
}
