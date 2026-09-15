/**
 * Smoke test for lib/model-router.js — pure logic, no network.
 * Run: node resources/server/lib/model-router-smoke-test.js
 */
"use strict";
var R = require("./model-router.js");

var pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL: " + label); }
}
function eq(a, b, label) { ok(a === b, label + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }

// Base config mirroring set.json after the cost-control change.
var BASE = {
  weak:    { group: "gpt", apiType: "gpt", baseUrl: "https://x/v1", apiKey: "k", model: "gpt-5.4-mini" },
  kb:      { group: "gpt", apiType: "gpt", baseUrl: "https://x/v1", apiKey: "k", model: "gpt-5.4-mini", maxInputChars: 8000 },
  strong:  { group: "gpt", apiType: "gpt", baseUrl: "https://x/v1", apiKey: "k", model: "gpt-5.4-mini" },
  premium: { group: "gpt", apiType: "gpt", baseUrl: "https://x/v1", apiKey: "k", model: "gpt-5.5" },
  routing: { defaultQualityMode: "auto", miniInputTokenLimit: 12000, miniPageLimit: 12, enableFailureEscalation: true, enableDirectHighForConceptGraph: true },
};
// Config WITHOUT premium block.
var NO_PREM = { weak: BASE.weak, kb: BASE.kb, strong: BASE.strong, routing: BASE.routing };

function route(over) { return R.resolveModelRoute(Object.assign({ baseConfig: BASE }, over)); }

console.log("== resolveModelRoute: always-mini tasks ==");
["chat", "summary", "lesson_summary", "concept_summary", "flashcard",
 "practice_generate", "practice_hint", "practice_explain", "practice_variant", "practice_grade"
].forEach(function (t) {
  var r = route({ task: t, role: "strong" });
  eq(r.tier, "mini", "always-mini task " + t + " -> mini");
  eq(r.model, "gpt-5.4-mini", "always-mini task " + t + " model");
  eq(r.canEscalate, false, "always-mini task " + t + " no escalate");
});

console.log("== concept_graph defaults to high ==");
(function () {
  var r = route({ task: "concept_graph", role: "strong" });
  eq(r.tier, "high", "concept_graph -> high");
  eq(r.model, "gpt-5.5", "concept_graph model");
  ok(/task_default_high/.test(r.reason), "concept_graph reason");
})();

console.log("== mini-then-escalate tasks default mini but escalatable ==");
["kb_build", "kb_distill", "diagnosis"].forEach(function (t) {
  var r = route({ task: t, role: t === "kb_distill" ? "kb" : "strong" });
  eq(r.tier, "mini", t + " -> mini first");
  eq(r.canEscalate, true, t + " escalatable");
  eq(r.maxRetries, 1, t + " maxRetries=1");
});

console.log("== explicit user quality modes ==");
(function () {
  var r = route({ task: "summary", userQualityMode: "high" });
  eq(r.tier, "high", "userQualityMode=high -> high");
  eq(r.reason, "user_quality_high", "high reason");

  var rf = route({ task: "kb_build", userQualityMode: "fast", role: "kb" });
  eq(rf.tier, "mini", "fast mode -> mini");
  eq(rf.canEscalate, false, "fast mode never escalates");

  // fast mode even forces concept_graph to mini (no direct high)
  var rcg = route({ task: "concept_graph", userQualityMode: "fast" });
  eq(rcg.tier, "mini", "fast mode concept_graph -> mini");
})();

console.log("== complexity-driven escalation ==");
(function () {
  var rlong = route({ task: "kb_build", role: "kb", inputTokens: 20000, requiresJson: true });
  eq(rlong.tier, "high", "long input + json -> high");
  ok(/long_input_json/.test(rlong.reason), "long input reason");

  var rpages = route({ task: "diagnosis", pageCount: 30 });
  eq(rpages.tier, "high", "many pages diagnosis -> high");
  ok(/many_pages/.test(rpages.reason), "many pages reason");

  // long input on an always-mini task that doesn't require json -> stays mini
  var rsum = route({ task: "summary", inputTokens: 20000, requiresJson: false });
  eq(rsum.tier, "mini", "long summary no-json stays mini");
})();

console.log("== no premium config => graceful, never escalate ==");
(function () {
  var r = R.resolveModelRoute({ task: "concept_graph", role: "strong", baseConfig: NO_PREM });
  eq(r.tier, "mini", "no premium concept_graph -> mini");
  eq(r.reason, "no_premium_config", "no premium reason");
  eq(r.canEscalate, false, "no premium no escalate");

  var rk = R.resolveModelRoute({ task: "kb_build", role: "kb", baseConfig: NO_PREM });
  eq(rk.canEscalate, false, "no premium kb_build not escalatable");
})();

console.log("== shouldEscalateAfterFailure ==");
(function () {
  var base = { baseConfig: BASE, task: "kb_build", pageCount: 8 };
  ok(R.shouldEscalateAfterFailure(base, { kind: "json_parse" }), "json_parse escalates");
  ok(R.shouldEscalateAfterFailure(base, { kind: "empty" }), "empty escalates");
  ok(R.shouldEscalateAfterFailure(base, { kind: "schema" }), "schema escalates");
  ok(R.shouldEscalateAfterFailure(base, { kind: "image_rejected" }), "image_rejected escalates");
  ok(R.shouldEscalateAfterFailure(base, { kind: "other", cardCount: 0 }), "0 cards on 8 pages escalates");
  ok(R.shouldEscalateAfterFailure({ baseConfig: BASE, task: "concept_graph" }, { kind: "x", nodeCount: 1, expected: 20 }), "few nodes escalates");
  // never escalate:
  ok(!R.shouldEscalateAfterFailure(base, { kind: "auth" }), "auth no escalate");
  ok(!R.shouldEscalateAfterFailure(base, { kind: "rate_limit" }), "rate_limit no escalate");
  ok(!R.shouldEscalateAfterFailure(base, { httpStatus: 429 }), "429 no escalate");
  ok(!R.shouldEscalateAfterFailure(base, { httpStatus: 402 }), "402 no escalate");
  ok(!R.shouldEscalateAfterFailure({ baseConfig: BASE, task: "kb_build", userQualityMode: "fast", pageCount: 8 }, { kind: "json_parse" }), "fast mode no escalate");
})();

console.log("== validateRoutedOutput ==");
(function () {
  eq(R.validateRoutedOutput("chat", "hello").ok, true, "chat any non-empty ok");
  eq(R.validateRoutedOutput("summary", "").ok, false, "empty summary fails");
  eq(R.validateRoutedOutput("kb_build", "not json").ok, false, "bad json fails");
  eq(R.validateRoutedOutput("kb_build", '{"cards":[]}').ok, false, "empty cards fails");
  eq(R.validateRoutedOutput("kb_build", '{"cards":[{"title":"x"}]}').ok, true, "cards ok");
  eq(R.validateRoutedOutput("flashcard", '{"cards":[{"q":"a"}]}').ok, true, "flashcard cards ok");
  eq(R.validateRoutedOutput("concept_graph", '{"nodes":[]}').ok, false, "empty nodes fails");
  eq(R.validateRoutedOutput("concept_graph", '{"nodes":[{"id":"a"}],"edges":[]}').ok, true, "graph ok");
  eq(R.validateRoutedOutput("diagnosis", '{}').ok, false, "empty diagnosis obj fails");
  eq(R.validateRoutedOutput("diagnosis", '{"level":"ok"}').ok, true, "diagnosis ok");
  // parsedOutput passthrough
  eq(R.validateRoutedOutput("kb_build", "ignored", { cards: [{ title: "y" }] }).ok, true, "parsed passthrough ok");
})();

console.log("== classifyError ==");
(function () {
  eq(R.classifyError(new Error("LLM API 401 Unauthorized")).kind, "auth", "401 -> auth");
  eq(R.classifyError(new Error("HTTP 429 too many requests")).kind, "rate_limit", "429 -> rate_limit");
  eq(R.classifyError(new Error("insufficient balance")).kind, "quota", "balance -> quota");
  eq(R.classifyError(new Error("request timeout 180s")).kind, "timeout", "timeout -> timeout");
  eq(R.classifyError(new Error("LLM API empty response")).kind, "empty", "empty -> empty");
  eq(R.classifyError(new Error("JSON parse: x")).kind, "json_parse", "json -> json_parse");
  eq(R.classifyError(new Error("model does not support image")).kind, "image_rejected", "image -> image_rejected");
})();

console.log("== callRoutedLLM: mini success, no escalation ==");
(function () {
  var calls = [];
  return R.callRoutedLLM({ task: "flashcard", role: "strong", baseConfig: BASE }, function (rt) {
    calls.push(rt.tier); return Promise.resolve('{"cards":[{"q":"1"}]}');
  }).then(function (res) {
    eq(res.fallbackAttempt, 0, "flashcard success no fallback");
    eq(res.tier, "mini", "flashcard stays mini");
    eq(calls.length, 1, "only one call");
  });
})();

console.log("== callRoutedLLM: mini bad json -> escalate once to premium ==");
function runEscalation() {
  var calls = [];
  return R.callRoutedLLM({ task: "kb_build", role: "kb", pageCount: 8, baseConfig: BASE }, function (rt) {
    calls.push(rt.tier);
    if (rt.tier === "mini") return Promise.resolve("garbage not json");
    return Promise.resolve('{"cards":[{"title":"ok"}]}');
  }).then(function (res) {
    eq(res.fallbackAttempt, 1, "escalated once");
    eq(res.tier, "high", "escalated to high");
    eq(calls[0], "mini", "first call mini");
    eq(calls[1], "high", "second call high");
    eq(calls.length, 2, "exactly two calls (one retry)");
  });
}

console.log("== callRoutedLLM: auth failure -> NO escalation ==");
function runAuthNoEscalate() {
  var calls = [];
  return R.callRoutedLLM({ task: "kb_build", role: "kb", pageCount: 8, baseConfig: BASE }, function (rt) {
    calls.push(rt.tier);
    return Promise.reject(new Error("LLM API 401 Unauthorized"));
  }).then(function (res) {
    eq(res.fallbackAttempt, 0, "auth failure no escalation");
    eq(calls.length, 1, "only one call on auth failure");
  });
}

Promise.resolve()
  .then(runEscalation)
  .then(runAuthNoEscalate)
  .then(function () {
    console.log("\n" + pass + " passed, " + fail + " failed");
    process.exit(fail ? 1 : 0);
  })
  .catch(function (e) { console.error("SMOKE ERROR", e); process.exit(1); });
