// version-order.js — canon-scoped ordering for world-lore cutoff axes.
//
// World lore cards carry a spoiler threshold (`spoilerLevel`, `timeRange`) that must be
// compared against a world's canon cutoff. The two pilot worlds do not express progress
// the same way:
//
//   amphoreus  game version only        (HSR `3.x`)
//   teyvat     game version AND 章·幕   (Genshin chapters/acts; versions are the other axis)
//
// `3.4` means nothing comparable across the two games, and on Teyvat a `章·幕` value is
// not comparable to a version value without a bridge — so every comparison names its axis
// and refuses instead of guessing.
//
// See docs/shared-world-continuity/05-canon-cutoff-schemes.md for the evidence and for the
// axes this deliberately does NOT handle (in-world `光历` years, cycle ordinals).
//
// Design rules:
//   - numeric component-wise compare, so "3.10" > "3.4" (plain string compare gets this backwards)
//   - missing components pad with 0, so "3.4" === "3.4.0"
//   - null / undefined / "" mean "no constraint in this direction", never a version
//   - non-numeric input throws instead of silently degrading to a string compare
//   - cross-canon comparison reports incomparable rather than inventing an order
//   - chapter and act both required: an act-only value like "第三幕" is ambiguous because
//     the same act number exists in every chapter, so it throws instead of guessing
"use strict";

var MAX_COMPONENTS = 3;

var VERSION_PATTERN = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

// Canon -> primary axis. Keys are card/manifest `canon` values, not runtime worldIds.
var AXES = Object.freeze({
  amphoreus: "hsr-version",
  teyvat: "genshin-version"
});

var CHAPTER_ACT_AXES = Object.freeze({
  teyvat: "genshin-chapter-act"
});

// Axis name -> comparison family. The family, not the name, decides how two values are
// ordered; the name only keeps the namespaces (and the error messages) honest.
var AXIS_FAMILIES = Object.freeze({
  "hsr-version": "version",
  "genshin-version": "version",
  "genshin-chapter-act": "chapter-act"
});

// 序章 is chapter 0; 第六章 aliases to the named arc 空月之歌 (S017 headings).
var CHAPTER_NAMES = Object.freeze({ "空月之歌": 6 });

// 间章 act K unlocks after 第K章's last numbered act and before 第K+1章
// (S017: 间章第一幕←第一章第三幕, 第二幕←第二章第四幕, 第三幕←第三章第五幕,
// 第四幕←间章第三幕). Ranking it above every numbered act of that chapter is what
// makes the interleaving order-preserving without a per-act placement table.
var INTERLUDE_ACT = 100;

var CHAPTER_ACT_PATTERN =
  /^(序章|间章|空月之歌|第([0-9]+|[零一二三四五六七八九十]+)章)(.*)$/;
var ACT_PATTERN = /^(序奏|第?([0-9]+|[零一二三四五六七八九十]+)幕)/;

var CN_DIGITS = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function VersionError(message) {
  this.name = "VersionError";
  this.message = message;
  if (Error.captureStackTrace) Error.captureStackTrace(this, VersionError);
}
VersionError.prototype = Object.create(Error.prototype);
VersionError.prototype.constructor = VersionError;

function isBlank(value) {
  return value === null || value === undefined ||
    (typeof value === "string" && value.trim() === "");
}

function axisOf(canon) {
  if (typeof canon !== "string") return null;
  return Object.prototype.hasOwnProperty.call(AXES, canon) ? AXES[canon] : null;
}

function chapterActAxisOf(canon) {
  if (typeof canon !== "string") return null;
  return Object.prototype.hasOwnProperty.call(CHAPTER_ACT_AXES, canon)
    ? CHAPTER_ACT_AXES[canon] : null;
}

function familyOf(axisName) {
  if (typeof axisName !== "string") return null;
  return Object.prototype.hasOwnProperty.call(AXIS_FAMILIES, axisName)
    ? AXIS_FAMILIES[axisName] : null;
}

// 零 to 九十九, the range the wiki actually uses for 章 and 幕.
function parseCnNumber(token) {
  if (/^[0-9]+$/.test(token)) return parseInt(token, 10);
  var ten = token.indexOf("十");
  if (ten === -1) {
    if (!Object.prototype.hasOwnProperty.call(CN_DIGITS, token)) {
      throw new VersionError("unparsable numeral " + JSON.stringify(token));
    }
    return CN_DIGITS[token];
  }
  var head = token.slice(0, ten);
  var tail = token.slice(ten + 1);
  var tens = head === "" ? 1 : CN_DIGITS[head];
  var ones = tail === "" ? 0 : CN_DIGITS[tail];
  if (tens === undefined || ones === undefined) {
    throw new VersionError("unparsable numeral " + JSON.stringify(token));
  }
  return tens * 10 + ones;
}

// Returns { unbounded: true } or { unbounded: false, parts: [major, minor, patch], raw }.
// `raw` is kept for diagnostics and for echoing back into compiled context.
function parse(value) {
  if (isBlank(value)) return { unbounded: true, raw: null };
  if (typeof value === "number") value = String(value);
  if (typeof value !== "string") {
    throw new VersionError("version must be a string or null, got " + typeof value);
  }
  var text = value.trim();
  var match = VERSION_PATTERN.exec(text);
  if (!match) {
    throw new VersionError(
      "unparsable version " + JSON.stringify(text) +
      " (expected major[.minor[.patch]]; in-world axes such as 光历 years, 循环 ordinals " +
      "and 章·幕 must be mapped before calling)"
    );
  }
  var parts = [];
  for (var i = 1; i <= MAX_COMPONENTS; i++) {
    parts.push(match[i] === undefined ? 0 : parseInt(match[i], 10));
  }
  return { unbounded: false, parts: parts, raw: text };
}

// Returns { unbounded: true } or { unbounded: false, chapter, act, raw }.
// Separators (· and whitespace) are dropped first, so "第六章·第九幕", "第六章 第九幕"
// and "第六章第九幕" all parse alike; a trailing act *name* ("第九幕身土坏空") is ignored
// because S017 headings append it and it carries no ordering information.
function parseChapterAct(value) {
  if (isBlank(value)) return { unbounded: true, raw: null };
  if (typeof value !== "string") {
    throw new VersionError("chapter-act must be a string or null, got " + typeof value);
  }
  var text = value.replace(/[·・‧∙\s]/g, "");
  var chapter = CHAPTER_ACT_PATTERN.exec(text);
  if (!chapter) {
    throw new VersionError(
      "unparsable chapter-act " + JSON.stringify(text) +
      " (expected 序章 / 第N章 / 间章第N幕 / 空月之歌·第N幕)"
    );
  }
  var token = chapter[1];
  var interlude = token === "间章";
  var chapterNumber;
  if (token === "序章") {
    chapterNumber = 0;
  } else if (interlude) {
    chapterNumber = null;
  } else if (Object.prototype.hasOwnProperty.call(CHAPTER_NAMES, token)) {
    chapterNumber = CHAPTER_NAMES[token];
  } else {
    chapterNumber = parseCnNumber(chapter[2]);
  }

  var remainder = chapter[3];
  var act = ACT_PATTERN.exec(remainder);
  if (interlude && !act) {
    throw new VersionError(
      "间章 without an act " + JSON.stringify(text) +
      " is ambiguous (each 间章 act is anchored to a different chapter)"
    );
  }
  if (!interlude && act) {
    var actNumber = act[1] === "序奏" ? 0 : parseCnNumber(act[2]);
    return { unbounded: false, chapter: chapterNumber, act: actNumber, interlude: false, raw: text };
  }
  if (!interlude) {
    // Bare chapter ("第七章", "第六章空月之歌") means "start of that chapter".
    return { unbounded: false, chapter: chapterNumber, act: 0, interlude: false, raw: text };
  }
  // 间章第N幕 anchors after 第N章 and before 第N+1章.
  return {
    unbounded: false,
    chapter: parseCnNumber(act[2]),
    act: INTERLUDE_ACT,
    interlude: true,
    raw: text
  };
}

function compareChapterAct(a, b) {
  var left = parseChapterAct(a);
  var right = parseChapterAct(b);
  if (left.unbounded && right.unbounded) return 0;
  if (left.unbounded) return 1;
  if (right.unbounded) return -1;
  if (left.chapter !== right.chapter) return left.chapter < right.chapter ? -1 : 1;
  if (left.act !== right.act) return left.act < right.act ? -1 : 1;
  return 0;
}

function isChapterAct(value) {
  try { parseChapterAct(value); return true; }
  catch (e) { if (e instanceof VersionError) return false; throw e; }
}

// Which axis does `value` belong to on this canon? The two families share no syntax
// (`3.4` vs `第六章·第九幕`), so this is a parse, not a heuristic.
function axisOfValue(canon, value) {
  var axis = axisOf(canon);
  if (axis === null) {
    throw new VersionError("unknown canon " + JSON.stringify(canon));
  }
  if (isBlank(value)) return axis;
  if (isChapterAct(value)) {
    var chapterActAxis = chapterActAxisOf(canon);
    if (chapterActAxis === null) {
      throw new VersionError(
        canon + " has no chapter-act axis, but got " + JSON.stringify(value)
      );
    }
    return chapterActAxis;
  }
  parse(value);
  return axis;
}

// Orders two values that are already known to share an axis.
function compareOnAxis(axisName, a, b) {
  var family = familyOf(axisName);
  if (family === null) throw new VersionError("unknown axis " + JSON.stringify(axisName));
  return family === "chapter-act" ? compareChapterAct(a, b) : compare(a, b);
}


// version, which is the right reading for an upper bound (`timeRange.to`); use
// isAtOrAfter for the lower bound so an unbounded floor is treated as "no floor".
function compare(a, b) {
  var left = parse(a);
  var right = parse(b);
  if (left.unbounded && right.unbounded) return 0;
  if (left.unbounded) return 1;
  if (right.unbounded) return -1;
  for (var i = 0; i < MAX_COMPONENTS; i++) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i] < right.parts[i] ? -1 : 1;
  }
  return 0;
}

// Compares across canons, refusing when the two sides sit on different lines.
// `axisName` ("hsr-version" / "genshin-version" / "genshin-chapter-act") is optional and
// defaults to each canon's version axis. On Teyvat it is what bridges a card's version
// floor to a 章·幕 cutoff: same canon, two axes, so the caller states which one it means.
function compareScoped(canonA, canonB, a, b, axisName) {
  var unknown = axisOf(canonA) === null ? canonA : (axisOf(canonB) === null ? canonB : null);
  if (unknown !== null) {
    return {
      comparable: false,
      order: null,
      reason: "unknown canon: " + JSON.stringify(unknown)
    };
  }
  var axisA, axisB;
  if (axisName === undefined || axisName === null) {
    // Same-canon and cross-canon both land here: each side announces its own axis by
    // parsing, and a mismatch is reported rather than resolved.
    axisA = axisOfValue(canonA, a);
    axisB = axisOfValue(canonB, b);
  } else {
    var wantA = resolveAxis(canonA, axisName);
    var wantB = resolveAxis(canonB, axisName);
    if (wantA === false || wantB === false) {
      return {
        comparable: false,
        order: null,
        reason: "axis " + axisName + " does not exist on " +
          JSON.stringify(wantA === false ? canonA : canonB)
      };
    }
    axisA = wantA;
    axisB = wantB;
  }
  if (axisA !== axisB) {
    return {
      comparable: false,
      order: null,
      reason: "different axes: " + axisA + " vs " + axisB
    };
  }
  return { comparable: true, order: compareOnAxis(axisA, a, b), reason: "" };
}

// Returns the axis name, false when this canon has no such axis, or null when `axisName`
// is a version axis belonging to the other game (so the caller falls back).
function resolveAxis(canon, axisName) {
  if (familyOf(axisName) === null) {
    throw new VersionError("unknown axis " + JSON.stringify(axisName));
  }
  if (axisName === axisOf(canon)) return axisName;
  if (axisName === chapterActAxisOf(canon)) return axisName;
  return false;
}

// `axis` is optional and defaults to the version family, which is what every existing
// caller means; pass a chapter-act axis name to bound 章·幕 values instead.
function orderOn(axis, a, b) {
  return axis === undefined || axis === null ? compare(a, b) : compareOnAxis(axis, a, b);
}

function isAtOrBefore(value, cutoff, axis) {
  if (isBlank(cutoff)) return true;
  if (isBlank(value)) return false;
  return orderOn(axis, value, cutoff) <= 0;
}

function isAtOrAfter(value, floor, axis) {
  if (isBlank(floor)) return true;
  if (isBlank(value)) return false;
  return orderOn(axis, value, floor) >= 0;
}

// Card-level entry point: is a card carrying `value` (its spoilerLevel) visible at
// `cutoff`? An unbounded card value is always visible.
function isVisibleAt(value, cutoff, axis) {
  if (isBlank(value)) return true;
  if (isBlank(cutoff)) return true;
  return orderOn(axis, value, cutoff) <= 0;
}

module.exports = {
  AXES: AXES,
  CHAPTER_ACT_AXES: CHAPTER_ACT_AXES,
  AXIS_FAMILIES: AXIS_FAMILIES,
  INTERLUDE_ACT: INTERLUDE_ACT,
  MAX_COMPONENTS: MAX_COMPONENTS,
  VERSION_PATTERN: VERSION_PATTERN,
  VersionError: VersionError,
  axisOf: axisOf,
  chapterActAxisOf: chapterActAxisOf,
  axisOfValue: axisOfValue,
  isBlank: isBlank,
  parse: parse,
  parseChapterAct: parseChapterAct,
  isChapterAct: isChapterAct,
  compare: compare,
  compareChapterAct: compareChapterAct,
  compareOnAxis: compareOnAxis,
  compareScoped: compareScoped,
  isAtOrBefore: isAtOrBefore,
  isAtOrAfter: isAtOrAfter,
  isVisibleAt: isVisibleAt
};
