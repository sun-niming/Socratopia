/**
 * Smoke test for lib/world-lore/version-order.js — pure logic, no network, no fixtures.
 * Run: node resources/server/lib/world-lore/version-order-smoke-test.js
 *
 * Fixture values are the ones actually observed in 资料/ (see
 * docs/shared-world-continuity/05-canon-cutoff-schemes.md), so a regression here reads
 * as a world-content bug rather than an abstract one.
 */
"use strict";
var V = require("./version-order.js");

var pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL: " + label); }
}
function eq(a, b, label) { ok(a === b, label + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function throws(fn, label) {
  try { fn(); ok(false, label + " (did not throw)"); }
  catch (e) { ok(e instanceof V.VersionError, label + " (threw " + e.name + ")"); }
}

console.log("== component-wise numeric order (string compare gets this backwards) ==");
ok(V.compare("3.10", "3.4") > 0, "3.10 > 3.4");
ok(V.compare("3.4", "3.10") < 0, "3.4 < 3.10");
ok("3.10" < "3.4", "sanity: raw string compare would invert it");
eq(V.compare("3.4", "3.5"), -1, "3.4 < 3.5");
eq(V.compare("4.0", "3.7"), 1, "4.0 > 3.7");
eq(V.compare("3.4", "3.4"), 0, "3.4 == 3.4");
eq(V.compare("10.0", "9.9"), 1, "two-digit major still numeric");

console.log("== missing components pad with zero ==");
eq(V.compare("3.4", "3.4.0"), 0, "3.4 == 3.4.0");
ok(V.compare("3.4.1", "3.4") > 0, "3.4.1 > 3.4");
eq(V.parse("3.4").parts.length, 3, "parts always padded to 3");
eq(V.parse("3").parts.join(","), "3,0,0", "bare major pads out");

console.log("== v prefix and whitespace tolerated ==");
eq(V.compare("v3.4", "3.4"), 0, "v3.4 == 3.4");
eq(V.compare(" 3.4 ", "3.4"), 0, "surrounding whitespace ignored");

console.log("== blank means unbounded, never a version ==");
eq(V.parse(null).unbounded, true, "null unbounded");
eq(V.parse(undefined).unbounded, true, "undefined unbounded");
eq(V.parse("").unbounded, true, "empty string unbounded");
eq(V.parse("   ").unbounded, true, "whitespace-only unbounded");
eq(V.parse(null).raw, null, "unbounded has no raw");
ok(V.compare(null, "3.4") > 0, "unbounded sorts above concrete (upper-bound reading)");
eq(V.compare(null, undefined), 0, "both unbounded equal");

// V.parse is the version parser and stays version-only; V.parseChapterAct is its
// counterpart, and V.axisOfValue is the router that decides which one a value belongs to.
console.log("== non-numeric axes throw instead of degrading to string compare ==");
throws(function () { V.parse("空月之歌"); }, "Genshin chapter name (use parseChapterAct)");
throws(function () { V.parse("光历4931年"); }, "Amphoreus in-world year");
throws(function () { V.parse("第33550337次永劫回归"); }, "cycle ordinal");
throws(function () { V.parse("3.4.1.2"); }, "too many components");
throws(function () { V.parse("abc"); }, "plain word");
throws(function () { V.parse("3.4-beta"); }, "suffix not silently dropped");
throws(function () { V.parse({}); }, "object input");
throws(function () { V.compare("3.4", "空月之歌"); }, "compare propagates the throw");
ok(V.VersionError.prototype instanceof Error, "VersionError inherits Error");
eq(new V.VersionError("boom").message, "boom", "VersionError carries the message");
eq(new V.VersionError("boom").name, "VersionError", "VersionError names itself");

console.log("== chapter-act parses the real S017 headings ==");
(function () {
  var nine = V.parseChapterAct("第六章·第九幕");
  eq(nine.chapter, 6, "空月之歌 arc resolves to chapter 6");
  eq(nine.act, 9, "第九幕 is act 9");

  // S133/S134 headings append the act name; it carries no order so it is dropped.
  eq(V.parseChapterAct("第七章 第二幕死魂灵的夜曲").act, 2, "trailing act name ignored");
  eq(V.parseChapterAct("第七章 第一幕无神怜爱的雪国").chapter, 7, "chapter-name suffix ignored too");
  eq(V.parseChapterAct("空月之歌·第九幕身土坏空").act, 9, "named 空月之歌 act");
  eq(V.parseChapterAct("第六章 空月之歌").act, 0, "bare chapter means chapter start");
  eq(V.parseChapterAct("空月之歌·序奏归途").act, 0, "序奏 is act 0");
  eq(V.parseChapterAct("序章·第三幕巨龙与自由之").chapter, 0, "序章 is chapter 0");
  eq(V.parseChapterAct("第三章第五幕").act, 5, "separator is optional");
  eq(V.parseChapterAct("第六章·第十二幕").act, 12, "CN numerals past ten");
})();

console.log("== interlude acts anchor to their own chapter, per the S017 unlock chain ==");
(function () {
  // 间章第一幕←第一章第三幕, 第二幕←第二章第四幕, 第三幕←第三章第五幕, 第四幕←间章第三幕
  ok(V.compareChapterAct("间章第一幕", "第一章第四幕") > 0, "间章第一幕 after 第一章's acts");
  ok(V.compareChapterAct("间章第一幕", "第二章第一幕") < 0, "间章第一幕 before 第二章");
  ok(V.compareChapterAct("间章第二幕", "第二章第四幕") > 0, "间章第二幕 after 第二章's acts");
  ok(V.compareChapterAct("间章第三幕", "第三章第五幕") > 0, "间章第三幕 after 第三章's acts");
  ok(V.compareChapterAct("间章第四幕", "间章第三幕") > 0, "间章第四幕 after 间章第三幕");
  ok(V.compareChapterAct("空月之歌·序奏", "第五章第六幕") > 0, "空月之歌序奏 after 第五章第六幕");
  ok(V.compareChapterAct("空月之歌·序奏", "间章第四幕") > 0, "空月之歌序奏 after 间章第四幕");
  ok(V.compareChapterAct("第七章", "空月之歌·第十幕") > 0, "第七章 after the whole 空月之歌 arc");
  eq(V.parseChapterAct("间章第一幕").interlude, true, "interlude is flagged");

  var line = ["第七章", "间章第四幕", "空月之歌·第十幕", "第五章第六幕",
    "间章第一幕", "第三章第五幕", "第一章第一幕", "序章·第三幕"];
  var sorted = line.slice().sort(V.compareChapterAct);
  // 间章第K幕 lands between 第K章 and 第K+1章. K=4 is an inference: its stated
  // prerequisite is 间章第三幕, not 第四章's last act, but chapter 4 is the only slot
  // that keeps it after 间章第三幕 without colliding with it.
  ok(sorted.join(" | ") === "序章·第三幕 | 第一章第一幕 | 间章第一幕 | 第三章第五幕 | " +
    "间章第四幕 | 第五章第六幕 | 空月之歌·第十幕 | 第七章",
    "the whole 章·幕 line sorts in release order (got " + sorted.join(" | ") + ")");
})();

console.log("== chapter-act blanks are unbounded and bad values throw ==");
(function () {
  eq(V.parseChapterAct(null).unbounded, true, "null chapter-act unbounded");
  eq(V.parseChapterAct("  ").unbounded, true, "blank chapter-act unbounded");
  ok(V.compareChapterAct(null, "第七章") > 0, "unbounded sorts above concrete");

  throws(function () { V.parseChapterAct("间章"); }, "间章 without an act is ambiguous");
  throws(function () { V.parseChapterAct("第三幕"); }, "act without a chapter is ambiguous");
  throws(function () { V.parseChapterAct("光历4931年"); }, "Amphoreus in-world year");
  throws(function () { V.parseChapterAct("3.4"); }, "a version is not a chapter-act");
  throws(function () { V.parseChapterAct({}); }, "object input");
  eq(V.isChapterAct("第七章"), true, "isChapterAct accepts a heading");
  eq(V.isChapterAct("3.4"), false, "isChapterAct rejects a version");
  eq(V.isChapterAct("光历4931年"), false, "isChapterAct rejects an in-world year");
})();

console.log("== axisOfValue routes by parsing, not by guessing ==");
(function () {
  eq(V.axisOfValue("teyvat", "第六章·第九幕"), "genshin-chapter-act", "teyvat chapter-act");
  eq(V.axisOfValue("teyvat", "5.8"), "genshin-version", "teyvat version");
  eq(V.axisOfValue("amphoreus", "3.7"), "hsr-version", "amphoreus version");
  eq(V.axisOfValue("teyvat", null), "genshin-version", "blank takes the primary axis");
  throws(function () { V.axisOfValue("amphoreus", "第六章·第九幕"); }, "amphoreus has no chapter-act axis");
  throws(function () { V.axisOfValue("arcadia", "3.4"); }, "unknown canon");
  throws(function () { V.axisOfValue("teyvat", "光历4931年"); }, "neither family parses");
  eq(V.chapterActAxisOf("teyvat"), "genshin-chapter-act", "chapter-act axis lookup");
  eq(V.chapterActAxisOf("amphoreus"), null, "amphoreus has none");
})();

console.log("== Teyvat carries two axes, so a cutoff names which one it means ==");
(function () {
  // Same canon, two axes: a 章·幕 cutoff and a card's version floor do not silently mix.
  var mixed = V.compareScoped("teyvat", "teyvat", "第六章·第九幕", "5.8");
  eq(mixed.comparable, false, "章·幕 vs version is incomparable without an axis");
  ok(/different axes/.test(mixed.reason), "mismatch reason names the axes");

  var byChapter = V.compareScoped("teyvat", "teyvat", "第六章·第九幕", "第七章", "genshin-chapter-act");
  eq(byChapter.comparable, true, "explicit chapter-act axis compares");
  eq(byChapter.order, -1, "第六章·第九幕 < 第七章");

  var crossAxis = V.compareScoped("teyvat", "teyvat", "第六章·第九幕", "第七章");
  eq(crossAxis.comparable, true, "same-axis inference works without the hint too");

  var amp = V.compareScoped("amphoreus", "amphoreus", "第六章·第九幕", "第七章", "genshin-chapter-act");
  eq(amp.comparable, false, "amphoreus refuses the chapter-act axis");
  ok(/does not exist/.test(amp.reason), "missing-axis reason");

  throws(function () {
    V.compareScoped("teyvat", "teyvat", "3.4", "3.5", "genshin-chapter-act");
  }, "explicit axis does not coerce the values");

  eq(V.compareOnAxis("genshin-chapter-act", "第七章", "第六章"), 1, "compareOnAxis dispatches");
  eq(V.compareOnAxis("genshin-version", "3.10", "3.4"), 1, "compareOnAxis keeps version semantics");
  throws(function () { V.compareOnAxis("nope", "3.4", "3.5"); }, "unknown axis name");
})();

console.log("== card-level visibility works on the chapter-act axis ==");
(function () {
  var axis = "genshin-chapter-act";
  eq(V.isVisibleAt("第六章·第九幕", "第六章·第九幕", axis), true, "card at cutoff visible");
  eq(V.isVisibleAt("第七章", "第六章·第九幕", axis), false, "future chapter hidden");
  eq(V.isVisibleAt("空月之歌·序奏", "第六章·第九幕", axis), true, "past act visible");
  eq(V.isVisibleAt("第七章", null, axis), true, "no cutoff -> everything visible");
  eq(V.isVisibleAt(null, "第六章·第九幕", axis), true, "unbounded spoilerLevel stays visible");
  eq(V.isAtOrAfter("第七章", "第六章·第九幕", axis), true, "chapter-act floor honoured");
})();

console.log("== axis lookup ==");
eq(V.axisOf("amphoreus"), "hsr-version", "amphoreus axis");
eq(V.axisOf("teyvat"), "genshin-version", "teyvat axis");
eq(V.axisOf("nope"), null, "unknown canon axis");
eq(V.axisOf(null), null, "null canon axis");

console.log("== cross-canon comparison refuses to invent an order ==");
(function () {
  var same = V.compareScoped("amphoreus", "amphoreus", "3.4", "3.7");
  eq(same.comparable, true, "same canon comparable");
  eq(same.order, -1, "same canon ordered");

  // 3.4 (HSR) vs 6.0 (Genshin): numerically 3.4 < 6.0 but the lines are unrelated.
  var cross = V.compareScoped("amphoreus", "teyvat", "3.4", "6.0");
  eq(cross.comparable, false, "cross canon incomparable");
  eq(cross.order, null, "cross canon has no order");
  ok(/different axes/.test(cross.reason), "cross canon reason");

  var unknown = V.compareScoped("amphoreus", "arcadia", "3.4", "3.4");
  eq(unknown.comparable, false, "unknown canon incomparable even when equal");
  ok(/unknown canon/.test(unknown.reason), "unknown canon reason");
})();

console.log("== bound helpers treat blanks as 'no constraint in this direction' ==");
eq(V.isAtOrBefore("3.4", null), true, "no cutoff -> always before");
eq(V.isAtOrBefore("3.5", "3.4"), false, "3.5 not before 3.4");
eq(V.isAtOrBefore("3.4", "3.4"), true, "cutoff inclusive");
eq(V.isAtOrBefore(null, "3.4"), false, "unbounded value is above a concrete cutoff");
eq(V.isAtOrAfter("3.0", null), true, "no floor -> always after");
eq(V.isAtOrAfter("3.4", "3.4"), true, "floor inclusive");
eq(V.isAtOrAfter("2.0", "3.4"), false, "2.0 before the floor");

console.log("== card-level visibility ==");
eq(V.isVisibleAt("3.4", "3.4"), true, "card at cutoff visible");
eq(V.isVisibleAt("3.5", "3.4"), false, "future card hidden");
eq(V.isVisibleAt("3.3", "3.4"), true, "past card visible");
eq(V.isVisibleAt("3.5", null), true, "no cutoff -> everything visible");
eq(V.isVisibleAt(null, "3.4"), true, "unbounded spoilerLevel stays visible");
eq(V.isVisibleAt("3.10", "3.4"), false, "3.10 is future relative to 3.4");

console.log("== real cutoff orderings from the survey ==");
(function () {
  var amphoreus = ["3.0", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7"];
  var sorted = amphoreus.slice().sort(V.compare);
  eq(sorted.join(","), amphoreus.join(","), "Amphoreus version line sorts in release order");

  var teyvat = ["4.5", "5.0", "5.4", "6.0"];
  eq(teyvat.slice().sort(V.compare).join(","), teyvat.join(","), "Teyvat version line sorts in release order");
})();

console.log("== the 3.4 collision is a known coincidence, not a parse bug ==");
(function () {
  // 资料/可用文本/崩坏·星穹铁道/历史编年/S002 编年史 outline has a section "3.4 第二次逐火之旅".
  // Parsed as a version it equals the game version 3.4; the caller must tag which is which.
  eq(V.compare("3.4", "3.4"), 0, "outline label and game version parse identically");
  eq(V.isVisibleAt("3.4", "3.4"), true, "so a 3.4 cutoff keeps a 3.4-labelled card");
})();

console.log("== determinism ==");
(function () {
  var first = V.compare("3.10", "3.4");
  for (var i = 0; i < 200; i++) { if (V.compare("3.10", "3.4") !== first) { fail++; break; } }
  ok(true, "stable across 200 calls");
})();

console.log("");
console.log("version-order smoke: " + (fail === 0 ? "PASS" : "FAIL") + " (" + pass + " passed, " + fail + " failed)");
process.exit(fail === 0 ? 0 : 1);
