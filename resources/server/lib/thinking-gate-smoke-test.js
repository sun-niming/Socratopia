"use strict";

// BUG-0014 regression (2026-09-25 live classroom).
//
// "Should this request carry a reasoning intent?" used to be decided by the
// literal test `/^deepseek/i`. When the classroom model was switched to
// `gpt-5.6-terra` the gate went false in every payload builder, so `thinking`
// stopped being sent at all -- and the three guards whose whole job is to keep
// reasoning from eating `max_tokens` (and returning an empty `content`) silently
// stopped firing too. The log still said `thinking=enabled`; only the adjacent
// `applied=false` gave it away.
//
// The gate is DUPLICATED: module 64092 has several definers plus three hand-written
// lib senders. Editing six of the ten is the documented failure mode, so this test
// pins the whole set rather than one representative file.
//
// See docs/project-reconstruction/16-live-lesson-review-20260925.md, R-24, Q-056.
var assert = require("assert");
var fs = require("fs");
var path = require("path");

var SERVER = path.join(__dirname, "..");
var PREDICATE = "/^(?:deepseek|gpt-5\\.6)/i";
var LEGACY_ONLY = "/^deepseek/i";

// Every file that decides whether to attach a `thinking` payload. Compiled chunks
// and routes first (module 64092 definers), then the hand-written senders.
var GATED_FILES = [
  ".next/server/app/api/chat/route.js",
  ".next/server/app/api/concept-summary/route.js",
  ".next/server/app/api/flashcard/route.js",
  ".next/server/app/api/companion/reconcile-persona/route.js",
  ".next/server/app/api/custom-companions/merge-persona/route.js",
  ".next/server/chunks/1576.js",
  ".next/server/chunks/4092.js",
  "lib/llm-gateway.js",
  "lib/kb-builder-coordinator.js",
  "lib/kb-builder.mjs"
];

function read(relative) {
  var file = path.join(SERVER, relative);
  assert.ok(fs.existsSync(file), "gated file must exist: " + relative);
  return fs.readFileSync(file, "utf8");
}

GATED_FILES.forEach(function (relative) {
  var source = read(relative);
  assert.ok(source.indexOf(PREDICATE) >= 0,
    relative + ": must gate on the capability predicate " + PREDICATE);
  assert.strictEqual(source.indexOf(LEGACY_ONLY), -1,
    relative + ": must not fall back to the model-name-only gate " + LEGACY_ONLY);
});
console.log("PASS all " + GATED_FILES.length + " payload builders gate on the capability predicate, not a model name");

// The predicate is only useful if something downstream understands the field it
// emits. A `/responses` target rewrites `thinking` into `reasoning`; without that
// mapping the widened gate would send a field nobody reads.
var compat = require("./responses-api-compat.js");
var translated = compat.chatRequestToResponses({
  model: "gpt-5.6-sol",
  messages: [{ role: "user", content: "x" }],
  thinking: { type: "disabled" }
});
assert.ok(translated.reasoning, "a disabled thinking intent must survive the /responses rewrite");
assert.ok(translated.thinking === undefined, "the chat-completions spelling must not leak into the Responses body");
console.log("PASS a disabled thinking intent reaches the Responses body as reasoning");

// Sanity: the predicate itself is not accidentally broad enough to hit unrelated
// models (which would send an unknown field to a plain /chat/completions endpoint).
var predicate = /^(?:deepseek|gpt-5\.6)/i;
assert.ok(predicate.test("deepseek-flash") && predicate.test("DeepSeek-V4.1-Flash"), "deepseek models stay covered");
assert.ok(predicate.test("gpt-5.6-terra") && predicate.test("gpt-5.6-sol"), "the model that regressed is covered");
assert.ok(!predicate.test("gpt-4o-mini") && !predicate.test("qwen3"), "unrelated models stay untouched");
console.log("PASS predicate covers deepseek + gpt-5.6 only");

console.log("thinking gate smoke: 4/4 passed");
