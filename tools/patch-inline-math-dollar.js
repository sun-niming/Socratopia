"use strict";

// RM-001 — escaped dollars inside inline math break the whole message.
//
// The renderer feeds model output through `eV` (delimiter normalisation) before
// remark-math sees it.  `micromark-extension-math@3` has no escape construct in
// math text: a `\` is ordinary data, so in `$\$$` the `\` is data and the
// following `$$` is a two-dollar run that cannot close a one-dollar opener.
// The math never closes at the right place, every later `$` pairs with the
// wrong partner, and half the LaTeX lands outside math (rendered as literal
// source, because rehype-katex runs with `errorColor:"inherit"`).
//
// The fix rewrites `\$` to `\text{\textdollar}` — KaTeX has no `\mathdollar`
// and `\textdollar` is text-mode only — but ONLY while inside math, so a real
// markdown-escaped `\$5` in prose keeps working.
//
// The repo ships five page bundles that are patched in lockstep (only one is
// ever loaded, but frontend smoke tests assert all five), so this follows the
// `replaceOnce` discipline of `tools/patch-post-class-notes-ui.js`.
//
//   node tools/patch-inline-math-dollar.js           # patch
//   node tools/patch-inline-math-dollar.js --check   # verify only
//
// v2 (2026-10-10) — two defects fixed here and repaired in place:
//
//  1. The helper used to be called `eS`, which collides with an existing
//     `var eS = r(6035)` in the same block scope of page-87daa6ca210ab9dc.js.
//     The var assignment runs at module init and overwrites the hoisted
//     function, so the first markdown render called a module namespace object:
//     "TypeError: eS is not a function" -> React render crash.  The helper is
//     now `__inlineMathDollar`, a name the minifier never emits.
//  2. The call-site anchor assumed the `\(...\)` rewrite always carries the
//     `,(e,t)=>`$${t}$`` callback.  In the four practice bundles it does not,
//     and the old code replaced that callback with the call, producing
//     `...\\\\)","g"),e=eS(e)))` — a syntax error.  Insertion is now anchored
//     on the code-span restore that follows and preserves whatever callback is
//     there.
//
// Both edits are per-occurrence: the four practice bundles contain the page
// module twice, so a bundle may need the same edit in more than one copy.

var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var pages = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
].map(function (name) {
  return path.join(root, "resources", "server", ".next", "static", "chunks", "app", name);
});

// --------------------------------------------------------------- new piece

// No backticks and no `${}` on purpose: this text is spliced into a minified
// file that is full of template literals.
var NAME = "__inlineMathDollar";

var SCANNER =
  "function " + NAME + '(e){let t="",r=0,a=!1;for(;r<e.length;){' +
  'if("\\\\"===e[r]&&"$"===e[r+1]){t+=a?"\\\\text{\\\\textdollar}":"\\\\$",r+=2;continue}' +
  'if("$"===e[r]){let n=0;for(;"$"===e[r];)n++,r++;a=!a,t+="$".repeat(n);continue}' +
  "t+=e[r],r++}return t}";

// v1 emitted this instead; both the declaration and the call are migrated.
var SCANNER_V1 = SCANNER.replace("function " + NAME + "(", "function eS(");

var ANCHOR_HOOK = "function eV(e){let t=e.split(";
var RESTORE = ")).replace(/\\x00C(\\d+)\\x00/g";
var CALLBACK_HEAD = ",(e,t)=>`$${t}$`";

// v1 emitted the helper as `eS`.  Two of its call-site shapes must be migrated:
//   EATEN — the callback was replaced by the call (four practice bundles):
//           ...\\\\)","g"),e=eS(e))).replace(/\x00C...     (callback gone)
//   OK    — the call was seated correctly but keeps the colliding name:
//           ...\\\\)","g"),e=eS(e)).replace(/\x00C...
// Both become ...\\\\)","g"),CALLBACK),NAME(e)).replace(/\x00C...
var V1_EATEN = ",e=eS(e))).replace(/\\x00C(\\d+)\\x00/g";
var V1_OK = ",e=eS(e)).replace(/\\x00C(\\d+)\\x00/g";
var V2_FIXED = "," + NAME + "(e)).replace(/\\x00C(\\d+)\\x00/g";
var V2_FIXED_WITH_CALLBACK = CALLBACK_HEAD + ")," + NAME + "(e)).replace(/\\x00C(\\d+)\\x00/g";

function count(src, needle) { return src.split(needle).length - 1; }
function replaceAll(src, needle, replacement) { return src.split(needle).join(replacement); }

function applyEdits(file, checkOnly) {
  var source = fs.readFileSync(file, "utf8");
  var original = source;
  var notes = [];

  // -- 1. migrate the v1 helper name ------------------------------------
  var v1Decls = count(source, SCANNER_V1);
  if (v1Decls) {
    source = replaceAll(source, SCANNER_V1, SCANNER);
    notes.push("renamed " + v1Decls + " helper declaration(s)");
  }
  var eaten = count(source, V1_EATEN);
  if (eaten) {
    // the callback must come back before the call is re-seated
    source = replaceAll(source, V1_EATEN, V2_FIXED_WITH_CALLBACK);
    notes.push("restored " + eaten + " eaten callback(s)");
  }
  var misSeated = count(source, V1_OK);
  if (misSeated) {
    source = replaceAll(source, V1_OK, V2_FIXED);
    notes.push("re-seated " + misSeated + " v1 call(s)");
  }

  // -- 2. insert the helper before every `eV` that lacks one ------------
  var hooks = 0, injected = 0;
  for (var from = 0; ; ) {
    var at = source.indexOf(ANCHOR_HOOK, from);
    if (at < 0) break;
    hooks++;
    var before = source.slice(Math.max(0, at - 600), at);
    if (before.indexOf("function " + NAME + "(") < 0) {
      source = source.slice(0, at) + SCANNER + source.slice(at);
      injected++;
      at += SCANNER.length;
    }
    from = at + ANCHOR_HOOK.length;
  }
  if (injected) notes.push("injected " + injected + " of " + hooks + " helper(s)");

  // -- 3. seat the call before every code-span restore ------------------
  var sites = 0, seated = 0;
  for (var pos = 0; ; ) {
    var hit = source.indexOf(RESTORE, pos);
    if (hit < 0) break;
    sites++;
    var lead = source.slice(Math.max(0, hit - 200), hit);
    // NB: the match starts at the call's own closing paren once the call exists,
    // so look for `NAME(` rather than `NAME(e)` in the lead.
    if (lead.indexOf(NAME + "(") < 0) {
      // RESTORE starts at the `)` that closes the outer parenthesis group; the
      // call belongs immediately after it, as a sequence element of `e=(...` .
      source = source.slice(0, hit + 1) + "," + NAME + "(e)" + source.slice(hit + 1);
      seated++;
      pos = hit + 1 + NAME.length + 4;
      continue;
    }
    pos = hit + RESTORE.length;
  }
  if (seated) notes.push("seated " + seated + " of " + sites + " call(s)");

  // -- 4. invariants ----------------------------------------------------
  // Every `eV` copy carries the helper; a copy whose pipeline has no code-span
  // restore site (page-3a1f* copy 1, whose `eV` tail was cut by another patch)
  // cannot carry the call yet — that is reported, not treated as success.
  var decls = count(source, SCANNER);
  var calls = count(source, NAME + "(e)") - decls;
  var ok = hooks > 0 && decls === hooks && calls > 0 && calls <= decls;
  if (ok && calls < decls) notes.push((decls - calls) + " helper(s) without a restore site");
  var patched = source.indexOf(NAME + "(e)") >= 0;

  if (!checkOnly && source !== original) fs.writeFileSync(file, source, "utf8");
  return { changed: source !== original, patched: patched, ok: ok, hooks: hooks, decls: decls, calls: calls, notes: notes };
}

function main() {
  var checkOnly = process.argv.indexOf("--check") >= 0;
  var failures = [], syntax = [];
  pages.forEach(function (file) {
    var short = path.basename(file);
    try {
      var result = applyEdits(file, checkOnly);
      var state = result.ok ? (result.changed ? "patched" : "already patched") : "INCONSISTENT";
      if (!result.ok) failures.push(short + " (decls=" + result.decls + " calls=" + result.calls + " hooks=" + result.hooks + ")");
      console.log(state + "  " + path.relative(root, file) + (result.notes.length ? " — " + result.notes.join("; ") : ""));
    } catch (error) {
      failures.push(short + ": " + error.message);
      console.log("FAILED  " + path.relative(root, file) + " — " + error.message);
    }
    // syntax gate: a bundle that cannot parse never boots, patched or not
    try {
      require("acorn").parse(fs.readFileSync(file, "utf8"), { ecmaVersion: 2022, sourceType: "module" });
    } catch (error) {
      syntax.push(path.relative(root, file) + ": " + error.message);
      console.log("  [syntax] " + error.message);
    }
  });
  if (failures.length) {
    console.error("\n" + failures.length + " bundle(s) not patched");
    process.exitCode = 1;
    return;
  }
  if (syntax.length) {
    console.error("\n" + syntax.length + " bundle(s) carry inline-math-dollar-v2 but do not parse");
    process.exitCode = 1;
    return;
  }
  console.log("\nall " + pages.length + " bundles carry inline-math-dollar-v2");
}

if (require.main === module) main();

module.exports = { applyEdits: applyEdits, count: count, NAME: NAME, SCANNER: SCANNER, pages: pages };
