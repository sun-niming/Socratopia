"use strict";

// PN-008 — the route is now a thin adapter, and the response/time budget moved
// out of the route's prompt text into lib/post-class-notes.
//
// Before stage D this file asserted the route carried `maxTokens:4096`,
// `response_format` and the "under 1800 characters" wording. Those moved (the
// flat 1800-char cap was replaced by §7.1 adaptive length), so the assertions
// moved with them.
//
//   node resources/server/.next/server/app/api/concept-summary/concept-summary-response-budget-smoke-test.js

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var routeSource = fs.readFileSync(path.join(__dirname, "route.js"), "utf8");
var libRoot = path.resolve(__dirname, "..", "..", "..", "..", "..", "lib", "post-class-notes");
var errors = require(path.join(libRoot, "errors.js"));
var orchestration = require(path.join(libRoot, "orchestrator.js"));
var partitioner = require(path.join(libRoot, "partitioner.js"));
var prompts = require(path.join(libRoot, "prompts.js"));

// --- the route only routes -------------------------------------------------

assert.ok(
  routeSource.includes("global.__POST_CLASS_NOTES__"),
  "the route must reach the orchestrator through the injected global, never by requiring a lib path itself",
);
assert.ok(
  routeSource.includes("getOrchestrator"),
  "the route must reuse the cached orchestrator so in-memory job state survives between requests",
);
assert.ok(
  routeSource.includes("createProvider"),
  "the route must build its transport through the injected module",
);
assert.ok(
  !routeSource.includes("w.callLLM("),
  "the note path must not go through compiled callLLM, whose response.json() turns an HTML gateway page into a JSON syntax error",
);
["start", "status", "cancel", "retry"].forEach(function (action) {
  assert.ok(routeSource.includes('"' + action + '"'), "the route exposes the " + action + " action");
});
assert.ok(
  routeSource.includes("missing_dependency"),
  "a missing global must fail closed with a stable code rather than quietly falling back",
);
// Assert on the prompt *text*, not on `let K=`: the Next route-module handler
// further down the file declares its own unrelated `let K=`.
assert.ok(
  !routeSource.includes("你是一个高质量的课堂笔记整理助手"),
  "the direct-path prompt must be gone from the route so prompts.js is the single source of truth",
);

// --- the budget moved, and still matches §6.3 ------------------------------

var limits = orchestration.DEFAULT_LIMITS;
assert.strictEqual(limits.directTimeoutMs, 120000, "short-path timeout matches plan §6.3");
assert.strictEqual(limits.mapTimeoutMs, 90000, "per-slice timeout matches plan §6.3");
assert.strictEqual(limits.reduceTimeoutMs, 150000, "merge timeout matches plan §6.3");
assert.strictEqual(limits.repairTimeoutMs, 60000, "repair timeout matches plan §6.3");
assert.strictEqual(limits.softBudgetMs, 300000, "soft job budget is 5 minutes");
assert.strictEqual(limits.hardBudgetMs, 480000, "hard job budget is 8 minutes");
assert.strictEqual(limits.maxConcurrentChunks, 2, "at most two slices are in flight");
assert.strictEqual(limits.maxCallsPerJob, 40, "the whole job is bounded by a call budget");
assert.ok(limits.directMaxTokens >= 4096, "the short path must not be squeezed below the old 4096-token stop-gap");

// --- §7.1 replaced the flat 1800-char cap ----------------------------------

assert.deepStrictEqual(partitioner.visibleTargetRange(20, "chinese"), { min: 1500, max: 2500, unit: "chars" });
assert.deepStrictEqual(partitioner.visibleTargetRange(80, "chinese"), { min: 3000, max: 4000, unit: "chars" });

var directChinese = prompts.systemFor("direct", "chinese");
var directEnglish = prompts.systemFor("direct", "english");
assert.ok(!/1800/.test(directChinese), "the flat 1800-character wording is gone from the Chinese prompt");
assert.ok(!/1800/.test(directEnglish), "the flat 1800-character wording is gone from the English prompt");

// The length target is stated in the user turn, not the system prompt.
var target = partitioner.visibleTargetRange(80, "chinese");
var userChinese = prompts.directUserContent({ language: "chinese", targetRange: target, transcript: "x" });
var userEnglish = prompts.directUserContent({ language: "english", targetRange: target, transcript: "x" });
assert.ok(/目标篇幅/.test(userChinese), "the Chinese direct turn states an adaptive length target");
assert.ok(/3000～4000/.test(userChinese), "and carries the band for this lesson size");
assert.ok(/Target length/.test(userEnglish), "and so does the English one");

// --- §8.3 error text is still actionable and translated --------------------

assert.strictEqual(errors.publicMessage(errors.CODES.upstream_timeout, "chinese"), "模型服务响应过慢，已保留生成进度。");
assert.strictEqual(errors.publicMessage(errors.CODES.upstream_html_response, "chinese"), "模型服务当前被网关拦截，请稍后重试。");
assert.ok(/閘道/.test(errors.publicMessage(errors.CODES.upstream_html_response, "chinese-traditional")), "traditional Chinese variant exists");
assert.strictEqual(errors.publicMessage(errors.CODES.upstream_html_response, "english"), "The model service is behind an intercepting gateway right now. Please retry shortly.");

console.log("concept-summary response budget smoke: PASS");
