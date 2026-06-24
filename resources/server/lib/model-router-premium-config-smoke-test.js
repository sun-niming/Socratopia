/**
 * model-router-premium-config-smoke-test.js
 *
 * Verifies that the set.json + settings.json normalization (mirrored from
 * server.js) yields a fully-resolved `premium` block (baseUrl + apiKey + model),
 * and that the model-router escalates kb_distill to premium on a content failure
 * while keeping chat on mini. Never prints the API key.
 *
 * Run: node resources/server/lib/model-router-premium-config-smoke-test.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var router = require("./model-router.js");

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error("FAIL: " + msg); }
}

// ---- settings.json normalization (mirror of server.js `norm`) -------------
function normSettings(S) {
  S = S || {};
  var endpoint = S.endpoint || S.baseUrl || "https://api.nwafu-ai.cn/v1";
  var keys = S.apiKeys || {};
  function fill(name, defKeyGroup) {
    var b = S[name] || {};
    b.baseUrl = b.baseUrl || endpoint;
    b.apiKey = b.apiKey || keys[b.apiKeyGroup] || keys[defKeyGroup] || "";
    b.models = b.models || {};
    S[name] = b;
    return b;
  }
  var gpt = fill("gpt", "codex");
  S.openai = S.openai || gpt;
  S.deepseek = S.deepseek || gpt;
  return S;
}

// ---- set.json normalization (mirror of server.js `normalize`) -------------
var SETTINGS;
function pickProvider(S, preferred) {
  var n = (preferred || "gpt").toLowerCase();
  if (S[n]) return n;
  if (("openai" === n || "gpt" === n) && S.gpt) return "gpt";
  if (S.gpt) return "gpt";
  return n;
}
function firstModel(m) { if (!m) return ""; var v = Object.values(m); return v && v.length ? v[0] : ""; }
function pickModel(block, key) { var m = block && block.models || {}; return key && m[key] || m.gpt || m.openai || firstModel(m); }
function normalize(raw, modelKey) {
  raw = raw || {};
  var S = SETTINGS || {};
  var provider = pickProvider(S, raw.group || raw.provider);
  var block = S[provider] || {};
  var out = {};
  Object.keys(raw).forEach(function (k) { out[k] = raw[k]; });
  out.group = out.group || provider;
  out.apiType = out.group;
  out.baseUrl = out.baseUrl || block.baseUrl || S.endpoint || "";
  out.apiKey = out.apiKey || block.apiKey || "";
  out.model = out.model || pickModel(block, modelKey || provider) || "";
  return out;
}

// ---- load real config files ----------------------------------------------
var root = path.join(__dirname, "..", "..");
var settingsRaw = JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf-8"));
var setRaw = JSON.parse(fs.readFileSync(path.join(root, "set.json"), "utf-8"));
SETTINGS = normSettings(settingsRaw);

var SET = {};
Object.keys(setRaw).forEach(function (k) { SET[k] = setRaw[k]; });
SET.strong = normalize(setRaw.strong, "strong");
if (setRaw.kb) SET.kb = normalize(setRaw.kb, "kb");
SET.weak = normalize(setRaw.weak, "weak");
if (setRaw.vision) SET.vision = normalize(setRaw.vision, "gemini");
if (setRaw.premium) SET.premium = normalize(setRaw.premium, "premium");

// ---- model assignments -----------------------------------------------------
ok(SET.weak && SET.weak.model === "gpt-5.4-mini", "weak.model is gpt-5.4-mini");
ok(SET.strong && SET.strong.model === "gpt-5.4-mini", "strong.model is gpt-5.4-mini");
ok(SET.kb && SET.kb.model === "gpt-5.4-mini", "kb.model is gpt-5.4-mini");
ok(SET.premium && SET.premium.model === "gpt-5.5", "premium.model is gpt-5.5");

// ---- premium fully resolved ------------------------------------------------
ok(SET.premium && typeof SET.premium.baseUrl === "string" && SET.premium.baseUrl.length > 0, "premium.baseUrl non-empty");
ok(SET.premium && typeof SET.premium.apiKey === "string" && SET.premium.apiKey.length > 0, "premium.apiKey non-empty (value not printed)");

// ---- router behavior with this config -------------------------------------
var r1 = router.resolveModelRoute({ task: "kb_distill", role: "kb", baseConfig: SET });
ok(r1.tier === "mini", "kb_distill -> mini");
ok(r1.canEscalate === true, "kb_distill canEscalate=true");

var r2 = router.resolveModelRoute({ task: "kb_distill", role: "kb", baseConfig: SET, previousFailure: { kind: "json_parse" } });
ok(r2.tier === "high", "kb_distill + json_parse failure -> high");
ok(r2.model === "gpt-5.5", "escalated route model is gpt-5.5");

var r3 = router.resolveModelRoute({ task: "chat", role: "weak", baseConfig: SET });
ok(r3.tier === "mini", "chat -> mini");
ok(r3.canEscalate === false, "chat canEscalate=false");

var r4 = router.resolveModelRoute({ task: "kb_distill", role: "kb", baseConfig: SET, userQualityMode: "fast", previousFailure: { kind: "json_parse" } });
ok(r4.tier === "mini", "fast mode forbids escalation even on failure");

if (fails === 0) {
  console.log("passed");
  process.exit(0);
} else {
  console.error(fails + " assertion(s) failed");
  process.exit(1);
}
