/**
 * model-router.js — unified, cost-aware model selection for Socratopia.
 *
 * Loaded by server.js into global.__MODEL_ROUTER__ (CommonJS module.exports).
 * Pure logic + a thin LLM caller; no Next.js / webpack dependencies, so it runs
 * standalone (smoke test) and inside the server process.
 *
 * Policy (see MODEL_ROUTING_TARGET_PLAN.md):
 *   - weak / kb / strong all default to the mini model.
 *   - Escalate to the high-value "premium" model ONLY when:
 *       * task is inherently complex (concept_graph, cross-chapter diagnosis, ...)
 *       * input complexity is high (long tokens + JSON, many pages, ...)
 *       * a prior mini attempt FAILED in a content way (empty / bad JSON /
 *         missing schema fields / abnormal card/node counts / image rejected)
 *       * user explicitly chose high-quality mode.
 *   - Premium retries at most ONCE (maxRetries reflects remaining escalations).
 *   - Decisions are observable: every resolveModelRoute returns { reason },
 *     and callers log task/role/selectedModel/reason/fallbackAttempt.
 *   - NEVER escalate on auth / quota / 429 / network errors.
 *   - Missing premium config => no escalation, reason="no_premium_config".
 *   - API keys are never logged.
 *
 * Exports: resolveModelRoute, callRoutedLLM, shouldEscalateAfterFailure,
 *          validateRoutedOutput, _estimateTokens (test helper), TASK_POLICY.
 */
"use strict";

// Tasks that always stay on mini regardless of size (high-frequency, cheap).
var ALWAYS_MINI = {
  chat: 1, summary: 1, lesson_summary: 1, concept_summary: 1, flashcard: 1,
  practice_generate: 1, practice_hint: 1, practice_explain: 1, practice_variant: 1,
  practice_grade: 1,
};
// Default mini, but may escalate once on a content failure.
var MINI_THEN_ESCALATE = { kb_build: 1, kb_distill: 1, diagnosis: 1 };
// Default high (complex by nature), or high once complexity flags trip.
var DEFAULT_HIGH = { concept_graph: 1 };

var TASK_POLICY = {
  alwaysMini: ALWAYS_MINI,
  miniThenEscalate: MINI_THEN_ESCALATE,
  defaultHigh: DEFAULT_HIGH,
};

// Rough token estimate (~4 chars/token, CJK ~1.7). Good enough for thresholds.
function _estimateTokens(input) {
  if (typeof input === "number") return input;
  if (!input) return 0;
  var s = String(input);
  var cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  var rest = s.length - cjk;
  return Math.ceil(cjk / 1.7 + rest / 4);
}

function _routingCfg(baseConfig) {
  var r = (baseConfig && baseConfig.routing) || {};
  return {
    defaultQualityMode: r.defaultQualityMode || "auto",
    miniInputTokenLimit: typeof r.miniInputTokenLimit === "number" ? r.miniInputTokenLimit : 12000,
    miniPageLimit: typeof r.miniPageLimit === "number" ? r.miniPageLimit : 12,
    enableFailureEscalation: r.enableFailureEscalation !== false,
    enableDirectHighForConceptGraph: r.enableDirectHighForConceptGraph !== false,
  };
}

// Pull the resolved block for a role (server.js already filled baseUrl/apiKey/model).
function _block(baseConfig, name) {
  return (baseConfig && baseConfig[name]) || null;
}

function _toRoute(block, tier, reason, canEscalate) {
  block = block || {};
  return {
    provider: block.group || block.apiType || "gpt",
    apiType: block.apiType || block.group || "gpt",
    apiKey: block.apiKey || "",
    baseUrl: block.baseUrl || "",
    model: block.model || "",
    tier: tier,
    reason: reason,
    maxRetries: canEscalate ? 1 : 0,
    canEscalate: !!canEscalate,
  };
}

/**
 * resolveModelRoute(input) -> route object.
 * Decides mini vs high and returns the resolved provider/model block to call.
 */
function resolveModelRoute(input) {
  input = input || {};
  var role = input.role || "strong";
  var task = input.task || "chat";
  var baseConfig = input.baseConfig || {};
  var cfg = _routingCfg(baseConfig);

  var miniBlock = _block(baseConfig, role) || _block(baseConfig, "strong");
  var premiumBlock = _block(baseConfig, "premium");
  var hasPremium = !!(premiumBlock && premiumBlock.model && premiumBlock.baseUrl && premiumBlock.apiKey);

  var qualityMode = input.userQualityMode || cfg.defaultQualityMode || "auto";
  var inputTokens = _estimateTokens(input.inputTokens || input.inputChars || 0);
  var pageCount = +input.pageCount || 0;
  var requiresJson = !!input.requiresJson;
  var schemaComplexity = input.schemaComplexity || "low";
  var hasImages = !!input.hasImages;
  var hasTablesOrCode = !!input.hasTablesOrCode;
  var previousFailure = input.previousFailure || null;

  // helper: build a high route if premium exists, else fall back to mini.
  function high(reason) {
    if (!hasPremium) return _toRoute(miniBlock, "mini", "no_premium_config", false);
    return _toRoute(premiumBlock, "high", reason, false);
  }
  function mini(reason, canEscalate) {
    var esc = canEscalate && hasPremium && cfg.enableFailureEscalation;
    return _toRoute(miniBlock, "mini", reason, esc);
  }

  // 1) Explicit user quality mode wins.
  if (qualityMode === "high") return high("user_quality_high");
  // fast mode: never escalate, even tasks normally allowed to.
  var fastMode = qualityMode === "fast";

  // 2) Failure escalation (a previous mini attempt failed in a content way).
  if (previousFailure && !fastMode && cfg.enableFailureEscalation) {
    if (shouldEscalateAfterFailure(input, previousFailure)) {
      return high("escalate_after_failure:" + (previousFailure.kind || "unknown"));
    }
    // non-escalatable failure (auth/quota/429/network) — stay, no retry.
    return mini("failure_no_escalate:" + (previousFailure.kind || "unknown"), false);
  }

  // 3) Task-type policy.
  if (DEFAULT_HIGH[task]) {
    // fast mode forbids direct escalation, even for inherently-complex tasks.
    if (fastMode) return mini("concept_graph_fast", false);
    // concept_graph etc. — default high unless disabled, then mini-then-escalate.
    if (task === "concept_graph" && !cfg.enableDirectHighForConceptGraph) {
      return mini("concept_graph_mini_first", true);
    }
    return high("task_default_high:" + task);
  }

  // 4) Complexity-driven escalation (applies to escalatable + always-mini-ish).
  var complexReason = null;
  if (inputTokens > cfg.miniInputTokenLimit && (requiresJson || MINI_THEN_ESCALATE[task] || schemaComplexity === "high")) {
    complexReason = "long_input_json(" + inputTokens + ">" + cfg.miniInputTokenLimit + ")";
  } else if (pageCount > cfg.miniPageLimit && (task === "concept_graph" || task === "diagnosis" || task === "kb_build")) {
    complexReason = "many_pages(" + pageCount + ">" + cfg.miniPageLimit + ")";
  } else if (schemaComplexity === "high" && requiresJson && inputTokens > (cfg.miniInputTokenLimit / 2)) {
    complexReason = "high_schema_large_input";
  }
  if (complexReason && !fastMode) return high(complexReason);

  // 5) kb_build with images: try mini first, escalate on rejection/abnormal cards.
  if (task === "kb_build" && hasImages) {
    return fastMode ? mini("kb_build_images_fast", false) : mini("kb_build_images_mini_first", true);
  }

  // 6) Default by task family.
  if (MINI_THEN_ESCALATE[task]) {
    return fastMode ? mini(task + "_fast", false) : mini(task + "_mini_first", true);
  }
  if (ALWAYS_MINI[task]) {
    return mini("always_mini:" + task, false);
  }
  // Unknown task — conservative mini, escalatable unless fast.
  return fastMode ? mini("default_fast", false) : mini("default_mini", !!hasPremium && cfg.enableFailureEscalation);
}

/**
 * shouldEscalateAfterFailure(input, failure) -> bool.
 * Only CONTENT failures escalate. Transport/auth/quota failures never do.
 * failure: { kind, httpStatus?, cardCount?, nodeCount?, edgeCount?, expected? }
 */
function shouldEscalateAfterFailure(input, failure) {
  if (!failure) return false;
  input = input || {};
  if ((input.userQualityMode || "auto") === "fast") return false;
  var cfg = _routingCfg(input.baseConfig || {});
  if (!cfg.enableFailureEscalation) return false;

  var kind = failure.kind || "";
  // Never escalate on transport / billing / auth problems.
  var NEVER = { auth: 1, unauthorized: 1, forbidden: 1, quota: 1, insufficient_balance: 1, rate_limit: 1, network: 1, timeout: 1 };
  if (NEVER[kind]) return false;
  var st = failure.httpStatus;
  if (st === 401 || st === 403 || st === 429 || st === 402) return false;

  // Content failures that justify one premium retry.
  var ESCALATE = {
    empty: 1, empty_response: 1, json_parse: 1, schema: 1, schema_missing: 1,
    missing_fields: 1, image_rejected: 1, unsupported_input: 1,
    abnormal_cards: 1, abnormal_graph: 1,
  };
  if (ESCALATE[kind]) return true;

  // kb_build: 0 cards from a multi-page chunk is abnormal.
  if (failure.cardCount === 0 && (input.pageCount || 0) >= 4) return true;
  // concept_graph: node/edge count far below input scale.
  if (typeof failure.nodeCount === "number" && typeof failure.expected === "number" &&
      failure.expected > 0 && failure.nodeCount < Math.max(1, failure.expected * 0.5)) return true;

  return false;
}

/**
 * validateRoutedOutput(task, rawOutput, parsedOutput) -> { ok, failure? }.
 * Lightweight content validation so callers can decide to escalate.
 */
function validateRoutedOutput(task, rawOutput, parsedOutput) {
  if (rawOutput == null || (typeof rawOutput === "string" && !rawOutput.trim())) {
    return { ok: false, failure: { kind: "empty" } };
  }
  var needsJson = task === "kb_build" || task === "kb_distill" || task === "flashcard" ||
    task === "concept_graph" || task === "diagnosis" || task === "practice_generate";
  if (!needsJson) return { ok: true };

  var obj = parsedOutput;
  if (obj === undefined) {
    try { obj = JSON.parse(String(rawOutput).trim()); }
    catch (e) { return { ok: false, failure: { kind: "json_parse" } }; }
  }
  if (!obj || typeof obj !== "object") return { ok: false, failure: { kind: "schema" } };

  if (task === "kb_build" || task === "kb_distill" || task === "flashcard") {
    var cards = obj.cards;
    if (!Array.isArray(cards)) return { ok: false, failure: { kind: "missing_fields", field: "cards" } };
    if (cards.length === 0) return { ok: false, failure: { kind: "abnormal_cards", cardCount: 0 } };
  }
  if (task === "concept_graph") {
    var nodes = obj.nodes || obj.concepts;
    var edges = obj.edges || obj.relations;
    if (!Array.isArray(nodes)) return { ok: false, failure: { kind: "missing_fields", field: "nodes" } };
    if (nodes.length === 0) return { ok: false, failure: { kind: "abnormal_graph", nodeCount: 0 } };
    if (edges !== undefined && !Array.isArray(edges)) return { ok: false, failure: { kind: "schema", field: "edges" } };
  }
  if (task === "diagnosis") {
    // diagnosis schema varies; only require it be a non-empty object.
    if (Object.keys(obj).length === 0) return { ok: false, failure: { kind: "schema" } };
  }
  return { ok: true };
}

// Classify a thrown LLM error into a failure.kind for escalation decisions.
function classifyError(err) {
  var msg = (err && err.message || String(err || "")).toLowerCase();
  var m = msg.match(/\b(401|402|403|429|500|502|503)\b/);
  var status = m ? +m[1] : null;
  var kind = "unknown";
  if (status === 401 || /unauthorized|invalid api key|api key/.test(msg)) kind = "auth";
  else if (status === 403) kind = "forbidden";
  else if (status === 429 || /rate.?limit|too many/.test(msg)) kind = "rate_limit";
  else if (status === 402 || /insufficient|balance|quota|exceeded/.test(msg)) kind = "quota";
  else if (/timeout|timed out|abort/.test(msg)) kind = "timeout";
  else if (/network|econn|socket|fetch failed|enotfound/.test(msg)) kind = "network";
  else if (/empty/.test(msg)) kind = "empty";
  else if (/json|parse/.test(msg)) kind = "json_parse";
  else if (/image|vision|multimodal|not support/.test(msg)) kind = "image_rejected";
  return { kind: kind, httpStatus: status, message: err && err.message };
}

/**
 * callRoutedLLM(input) -> { content, route, fallbackAttempt, tier }.
 * Runs the mini route, validates output, and on a content failure (and only
 * then) retries once on premium. `caller` is an async fn(route) => rawString.
 * Logs task/role/selectedModel/reason/fallbackAttempt (never the apiKey).
 */
async function callRoutedLLM(input, caller) {
  input = input || {};
  var task = input.task || "chat";
  var role = input.role || "strong";
  if (typeof caller !== "function") throw new Error("callRoutedLLM requires a caller(route) function");

  function logRoute(route, attempt) {
    try {
      console.log("[model-router] task=" + task + " role=" + role +
        " tier=" + route.tier + " model=" + (route.model || "?") +
        " reason=" + route.reason + " fallbackAttempt=" + attempt);
    } catch (e) {}
  }

  var route = resolveModelRoute(input);
  logRoute(route, 0);

  var raw, parsed, validation, lastFailure = null;
  try {
    raw = await caller(route);
  } catch (e) {
    lastFailure = classifyError(e);
    raw = null;
  }
  if (raw != null) {
    validation = validateRoutedOutput(task, raw);
    if (validation.ok) return { content: raw, route: route, fallbackAttempt: 0, tier: route.tier };
    lastFailure = validation.failure;
  }

  // Decide on a single escalation.
  if (route.tier === "mini" && route.canEscalate &&
      shouldEscalateAfterFailure(input, lastFailure)) {
    var escInput = Object.assign({}, input, { previousFailure: lastFailure });
    var escRoute = resolveModelRoute(escInput);
    if (escRoute.tier === "high") {
      logRoute(escRoute, 1);
      var raw2 = await caller(escRoute);
      var v2 = validateRoutedOutput(task, raw2);
      // Return premium result even if still imperfect — no second escalation.
      return { content: raw2, route: escRoute, fallbackAttempt: 1, tier: escRoute.tier, failure: v2.ok ? null : v2.failure };
    }
  }

  // No escalation possible. Surface the mini result (may be null) + failure.
  return { content: raw, route: route, fallbackAttempt: 0, tier: route.tier, failure: lastFailure };
}

module.exports = {
  resolveModelRoute: resolveModelRoute,
  callRoutedLLM: callRoutedLLM,
  shouldEscalateAfterFailure: shouldEscalateAfterFailure,
  validateRoutedOutput: validateRoutedOutput,
  classifyError: classifyError,
  _estimateTokens: _estimateTokens,
  TASK_POLICY: TASK_POLICY,
};
