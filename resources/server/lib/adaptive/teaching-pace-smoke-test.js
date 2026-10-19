"use strict";

// Teaching-pace profile map.  Pins the three ids, the fallback behaviour and the
// monotonic ordering of the thresholds, so a careless edit cannot silently make
// "slow" faster than "normal".

const assert = require("assert");
const path = require("path");

const pace = require(path.join(__dirname, "teaching-pace.js"));

assert.deepStrictEqual(pace.PACE_IDS, ["slow", "normal", "brisk"], "pace ids and order are part of the settings UI contract");
assert.strictEqual(pace.DEFAULT_PACE, "normal", "the default pace is normal");

for (const id of pace.PACE_IDS) {
  const profile = pace.resolve(id);
  assert.strictEqual(profile.id, id, id + ": resolve must return the profile with the same id");
  assert(Number.isFinite(profile.thresholds.markdown), id + ": markdown threshold must be a number");
  assert(Number.isFinite(profile.thresholds.other), id + ": non-markdown threshold must be a number");
  assert(profile.thresholds.markdown >= 1 && profile.thresholds.other >= 1, id + ": thresholds are turn counts");
  assert(Number.isFinite(profile.windowEndTurns), id + ": windowEndTurns must be a number");
  assert(Number.isFinite(profile.intentAdvanceMinTurns), id + ": intentAdvanceMinTurns must be a number");
  assert.strictEqual(typeof profile.guidance, "string", id + ": guidance is a string");
}

// Ordering: slow waits longest, brisk moves first, on every axis.
const slow = pace.resolve("slow");
const normal = pace.resolve("normal");
const brisk = pace.resolve("brisk");
assert(slow.thresholds.markdown > normal.thresholds.markdown, "slow must outlast normal on markdown");
assert(normal.thresholds.markdown > brisk.thresholds.markdown, "normal must outlast brisk on markdown");
assert(slow.thresholds.other > normal.thresholds.other, "slow must outlast normal otherwise");
assert(normal.thresholds.other > brisk.thresholds.other, "normal must outlast brisk otherwise");
assert(slow.windowEndTurns > normal.windowEndTurns, "slow must outlast normal at the window end");
assert(normal.windowEndTurns > brisk.windowEndTurns, "normal must outlast brisk at the window end");
assert(slow.intentAdvanceMinTurns >= normal.intentAdvanceMinTurns, "slow must not honour a bare intent sooner");

// Normal keeps the historic hard-coded numbers so an absent setting is a no-op.
assert.strictEqual(normal.thresholds.markdown, 10, "normal markdown threshold must stay at the historic 10");
assert.strictEqual(normal.thresholds.other, 12, "normal threshold must stay at the historic 12");
assert.strictEqual(normal.windowEndTurns, 6, "normal window-end turns must stay at the historic 6");
assert.strictEqual(normal.guidance, "", "normal injects no extra guidance");

// Unknown / malformed input degrades to normal instead of throwing.
for (const bad of [undefined, null, "", "  ", "FAST", "turbo", 3, {}, []]) {
  assert.strictEqual(pace.normalize(bad), "normal", "normalize(" + JSON.stringify(bad) + ") must yield normal");
  assert.strictEqual(pace.resolve(bad).id, "normal", "resolve(" + JSON.stringify(bad) + ") must yield normal");
}

// Case and surrounding whitespace are tolerated; a known id survives.
assert.strictEqual(pace.normalize(" SLOW "), "slow", "normalize trims and lowercases");
assert.strictEqual(pace.isValid("Brisk"), true, "isValid accepts a case-folded id");
assert.strictEqual(pace.isValid("turbo"), false, "isValid rejects an unknown id");
assert.strictEqual(pace.isValid(undefined), false, "isValid rejects a missing value");

// thresholdFor picks the format's axis and tolerates a missing profile.
assert.strictEqual(pace.thresholdFor(brisk, true), brisk.thresholds.markdown, "markdown format uses the markdown threshold");
assert.strictEqual(pace.thresholdFor(brisk, false), brisk.thresholds.other, "page format uses the other threshold");
assert.strictEqual(pace.thresholdFor(null, true), normal.thresholds.markdown, "a missing profile falls back to normal");
assert.strictEqual(pace.thresholdFor(undefined, false), normal.thresholds.other, "a missing profile falls back to normal");

// resolve returns the shared frozen-ish profile object, not a copy per call.
assert.strictEqual(pace.resolve("slow"), pace.PROFILES.slow, "resolve returns the profile from the table");

// normal injects no extra guidance in any language; the other two do, per language.
assert.strictEqual(pace.guidanceFor(normal, "chinese"), "", "normal injects no Chinese guidance");
assert.strictEqual(pace.guidanceFor(normal, "english"), "", "normal injects no English guidance");
assert.strictEqual(pace.guidanceFor(normal, "chinese-traditional"), "", "normal injects no zh-TW guidance");
for (const id of ["slow", "brisk"]) {
  const profile = pace.resolve(id);
  for (const lang of ["chinese", "chinese-traditional", "english"]) {
    assert(pace.guidanceFor(profile, lang).length > 0, id + ": " + lang + " guidance must not be empty");
  }
  assert.notStrictEqual(pace.guidanceFor(profile, "chinese"), pace.guidanceFor(profile, "english"), id + ": guidance must be localised");
}
// An unknown language tag falls back to the Chinese line, never undefined.
assert.strictEqual(pace.guidanceFor(brisk, "klingon"), brisk.guidance, "unknown language falls back to Chinese");

console.log("teaching-pace smoke test: PASS");
