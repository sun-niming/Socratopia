#!/usr/bin/env node
/**
 * Runtime E2E smoke for /api/practice against a LIVE Socratopia HTTP server.
 *
 *   node resources/server/lib/practice/runtime-e2e-smoke.js
 *
 * No external apiKey: relies on the app's built-in strong LLM chain.
 * Auto-detects the running Socratopia.exe HTTP port (Windows). Falls back to a
 * candidate list. Never writes API keys to disk. Read-only against user data
 * except the practice problem_sets it generates under the e2e profile/world.
 *
 * Env overrides:
 *   PRACTICE_E2E_BASE_URL    explicit base URL (wins)
 *   PRACTICE_E2E_PROFILE_ID  default practice_e2e_user
 *   PRACTICE_E2E_WORLD_ID    default practice_e2e_world
 *   PRACTICE_E2E_ACCOUNT_ID  sent as X-Account-Id when present
 *   PRACTICE_E2E_TEXTBOOK_ID optional real textbook id for textbook-page step
 */
"use strict";

var http = require("http");
var url = require("url");
var cp = require("child_process");

var PID = process.env.PRACTICE_E2E_PROFILE_ID || "practice_e2e_user";
var WID = process.env.PRACTICE_E2E_WORLD_ID || "practice_e2e_world";
var ACCOUNT_ID = process.env.PRACTICE_E2E_ACCOUNT_ID || "";
var TEXTBOOK_ID = process.env.PRACTICE_E2E_TEXTBOOK_ID || "";

var results = [];
function record(step, ok, detail) {
  results.push({ step: step, ok: ok, detail: detail });
  var tag = ok === true ? "PASS" : ok === "warn" ? "WARN" : ok === "skip" ? "SKIP" : "FAIL";
  console.log("  [" + tag + "] " + step + (detail ? " — " + detail : ""));
}

// ---- HTTP helper (no external deps) ----
function request(method, fullUrl, bodyObj) {
  return new Promise(function (resolve) {
    var u = url.parse(fullUrl);
    var payload = bodyObj ? JSON.stringify(bodyObj) : null;
    var headers = { "Accept": "application/json" };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    if (ACCOUNT_ID) headers["X-Account-Id"] = ACCOUNT_ID;
    var req = http.request(
      { hostname: u.hostname, port: u.port, path: u.path, method: method, headers: headers },
      function (res) {
        var b = "";
        res.on("data", function (d) { b += d; });
        res.on("end", function () {
          var json = null;
          try { json = JSON.parse(b); } catch (e) {}
          resolve({ status: res.statusCode, body: b, json: json });
        });
      }
    );
    req.on("error", function (e) { resolve({ err: e.message }); });
    req.setTimeout(120000, function () { req.destroy(); resolve({ err: "timeout" }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ---- Port discovery (Windows) ----
function discoverSocratopiaPorts() {
  var ports = [];
  try {
    var ps =
      "$p = Get-Process Socratopia -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; " +
      "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | " +
      "Where-Object { $p -contains $_.OwningProcess } | " +
      "Select-Object -ExpandProperty LocalPort";
    var out = cp.execSync("powershell -NoProfile -Command \"" + ps + "\"", {
      encoding: "utf-8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"]
    });
    out.split(/\r?\n/).forEach(function (line) {
      var n = parseInt(line.trim(), 10);
      if (n && ports.indexOf(n) < 0) ports.push(n);
    });
  } catch (e) { /* PowerShell unavailable; rely on candidates */ }
  return ports;
}

function candidateBaseUrls() {
  var list = [];
  if (process.env.PRACTICE_E2E_BASE_URL) list.push(process.env.PRACTICE_E2E_BASE_URL.replace(/\/$/, ""));
  list.push("http://127.0.0.1:101532");
  list.push("http://localhost:101532");
  list.push("http://127.0.0.1:3000");
  list.push("http://localhost:3000");
  discoverSocratopiaPorts().forEach(function (p) {
    list.push("http://127.0.0.1:" + p);
  });
  // de-dupe + drop invalid ports (>65535), preserve order
  var seen = {}, out = [];
  list.forEach(function (u) {
    var m = u.match(/:(\d+)$/);
    if (m && parseInt(m[1], 10) > 65535) return;
    if (!seen[u]) { seen[u] = 1; out.push(u); }
  });
  return out;
}

async function findBaseUrl() {
  var probePath = "/api/practice?action=listProblemSets&profileId=" + encodeURIComponent(PID) +
    "&worldId=" + encodeURIComponent(WID);
  var attempts = [];
  var cands = candidateBaseUrls();
  for (var i = 0; i < cands.length; i++) {
    var base = cands[i];
    var r = await request("GET", base + probePath, null);
    if (r.err) { attempts.push(base + " -> " + r.err); continue; }
    if (r.json && (Array.isArray(r.json.problemSets) || r.json.error)) {
      return { base: base, needsAccount: false, attempts: attempts };
    }
    if (r.status === 400 && /account/i.test(r.body || "")) {
      attempts.push(base + " -> 400 needs X-Account-Id");
      return { base: base, needsAccount: true, attempts: attempts };
    }
    attempts.push(base + " -> HTTP " + r.status + " " + (r.body || "").slice(0, 80));
  }
  return { base: null, attempts: attempts };
}

// ---- helpers to pick problems ----
function pickProblem(set, types) {
  if (!set || !Array.isArray(set.problems)) return null;
  for (var i = 0; i < set.problems.length; i++) {
    var p = set.problems[i];
    if (!types || types.indexOf(p.type) >= 0) return p;
  }
  return null;
}

async function main() {
  console.log("Practice Runtime E2E Smoke");
  console.log("Profile: " + PID + "  World: " + WID + (ACCOUNT_ID ? "  Account: " + ACCOUNT_ID : ""));
  console.log("");

  var found = await findBaseUrl();
  if (!found.base) {
    record("port-discovery", false, "runtime_service_not_found");
    console.log("\nAttempts:\n  " + found.attempts.join("\n  "));
    finish("runtime_service_not_found");
    return;
  }
  var BASE = found.base;
  console.log("Base URL: " + BASE + (found.needsAccount ? "  (needs X-Account-Id)" : ""));
  console.log("");
  record("port-discovery", true, BASE);

  if (found.needsAccount && !ACCOUNT_ID) {
    record("account-header", "warn", "service_found_needs_account: set PRACTICE_E2E_ACCOUNT_ID");
    finish("service_found_needs_account");
    return;
  }

  // 1. route availability
  var avail = await request("GET", BASE + "/api/practice?action=listProblemSets&profileId=" +
    encodeURIComponent(PID) + "&worldId=" + encodeURIComponent(WID), null);
  record("1.route-availability", avail.json ? true : false,
    avail.json ? "HTTP " + avail.status : (avail.err || "no json"));

  // 2. generate manual sourceText
  var strongOk = true;
  var gen = await request("POST", BASE + "/api/practice", {
    action: "generate", profileId: PID, worldId: WID,
    sourceType: "manual",
    sourceText: "递归是指函数直接或间接调用自身。递归必须有基例，用来终止递归过程。没有基例的递归可能导致无限调用。",
    problemTypes: ["choice", "short-answer"], count: 2, difficulty: 2, teachingLanguage: "chinese"
  });
  var PSID = null, genSet = null;
  if (gen.json && gen.json.problemSet && Array.isArray(gen.json.problemSet.problems)) {
    genSet = gen.json.problemSet;
    PSID = genSet.id;
    record("2.generate-manual", true, "problemSet=" + PSID + " problems=" + genSet.problems.length);
  } else if (gen.json && /no_llm|strong|unavailable/i.test(JSON.stringify(gen.json))) {
    strongOk = false;
    record("2.generate-manual", false, "strong_chain_unavailable: " + JSON.stringify(gen.json).slice(0, 160));
  } else {
    record("2.generate-manual", false, (gen.err || "HTTP " + gen.status + " " + (gen.body || "").slice(0, 160)));
  }

  // 3. getProblemSet
  if (PSID) {
    var got = await request("GET", BASE + "/api/practice?action=getProblemSet&profileId=" +
      encodeURIComponent(PID) + "&worldId=" + encodeURIComponent(WID) + "&problemSetId=" + encodeURIComponent(PSID), null);
    var gotSet = got.json && got.json.problemSet;
    record("3.getProblemSet", gotSet && Array.isArray(gotSet.problems) &&
      gotSet.problems.length === genSet.problems.length,
      gotSet ? "read back problems=" + gotSet.problems.length : (got.err || "HTTP " + got.status));
  } else {
    record("3.getProblemSet", "skip", "no problemSet from generate");
  }

  // 4. choice grade (local, no LLM)
  var choiceP = pickProblem(genSet, ["choice"]);
  if (PSID && choiceP) {
    var cg = await request("POST", BASE + "/api/practice", {
      action: "grade", profileId: PID, worldId: WID, problemSetId: PSID,
      problemId: choiceP.id, userAnswer: "0"
    });
    var grd = cg.json && cg.json.grading;
    record("4.choice-grade-local",
      grd && typeof grd.correct !== "undefined" && typeof grd.score !== "undefined" ? true : false,
      grd ? "correct=" + grd.correct + " score=" + grd.score : (cg.err || "HTTP " + cg.status + " " + (cg.body || "").slice(0, 120)));
  } else {
    record("4.choice-grade-local", "warn", PSID ? "no choice problem in generated set" : "no problemSet");
  }

  // 5. short-answer grade via strong
  var shortP = pickProblem(genSet, ["short-answer", "shortAnswer", "step", "essay"]);
  if (PSID && shortP) {
    var sg = await request("POST", BASE + "/api/practice", {
      action: "grade", profileId: PID, worldId: WID, problemSetId: PSID,
      problemId: shortP.id, userAnswer: "递归就是函数调用自己，并且需要终止条件。"
    });
    var sgr = sg.json && sg.json.grading;
    if (sgr && (typeof sgr.score !== "undefined" || typeof sgr.correct !== "undefined")) {
      record("5.subjective-grade-strong", true,
        "score=" + sgr.score + " mistakeType=" + (sgr.mistakeType || "-"));
    } else if (sg.json && /no_llm|strong|unavailable/i.test(JSON.stringify(sg.json))) {
      strongOk = false;
      record("5.subjective-grade-strong", false, "strong_chain_unavailable");
    } else {
      record("5.subjective-grade-strong", false, (sg.err || "HTTP " + sg.status + " " + (sg.body || "").slice(0, 120)));
    }
  } else {
    record("5.subjective-grade-strong", "skip", PSID ? "no subjective problem" : "no problemSet");
  }

  var anyP = pickProblem(genSet, null);

  // 6. hint
  if (PSID && anyP) {
    var hn = await request("POST", BASE + "/api/practice", {
      action: "hint", profileId: PID, worldId: WID, problemSetId: PSID, problemId: anyP.id
    });
    var hint = hn.json && hn.json.hint;
    if (hint && hint.hint) {
      var topLevelLeak = typeof hn.json.correctAnswer !== "undefined";
      var ca = anyP.correctAnswer != null ? String(anyP.correctAnswer) : "";
      var inHintLeak = ca && hint.hint.indexOf(ca) >= 0;
      record("6.hint", topLevelLeak ? false : true,
        "focusKnowledgePoint=" + (hint.focusKnowledgePoint ? "y" : "n") +
        " guidingQuestion=" + (hint.guidingQuestion ? "y" : "n") +
        (topLevelLeak ? " LEAK:top-level-correctAnswer" : "") +
        (inHintLeak ? " WARN:answer-in-hint-text" : ""));
    } else if (hn.json && /no_llm|strong|unavailable/i.test(JSON.stringify(hn.json))) {
      strongOk = false; record("6.hint", false, "strong_chain_unavailable");
    } else {
      record("6.hint", false, (hn.err || "HTTP " + hn.status + " " + (hn.body || "").slice(0, 120)));
    }
  } else {
    record("6.hint", "skip", "no problemSet");
  }

  // 7. explain
  if (PSID && anyP) {
    var ex = await request("POST", BASE + "/api/practice", {
      action: "explain", profileId: PID, worldId: WID, problemSetId: PSID, problemId: anyP.id
    });
    var exp = ex.json && ex.json.explanation;
    if (exp && Array.isArray(exp.steps)) {
      record("7.explain", exp.steps.length >= 1 && typeof exp.finalAnswer !== "undefined",
        "steps=" + exp.steps.length + " finalAnswer=" + (exp.finalAnswer != null ? "y" : "n"));
    } else if (ex.json && /no_llm|strong|unavailable/i.test(JSON.stringify(ex.json))) {
      strongOk = false; record("7.explain", false, "strong_chain_unavailable");
    } else {
      record("7.explain", false, (ex.err || "HTTP " + ex.status + " " + (ex.body || "").slice(0, 120)));
    }
  } else {
    record("7.explain", "skip", "no problemSet");
  }

  // 8. variant
  if (PSID && anyP) {
    var vr = await request("POST", BASE + "/api/practice", {
      action: "variant", profileId: PID, worldId: WID, problemSetId: PSID, problemId: anyP.id, count: 2
    });
    var variants = vr.json && vr.json.variants;
    if (Array.isArray(variants) && variants.length > 0) {
      var v0 = variants[0];
      var shape = v0 && v0.id && v0.type && v0.question && typeof v0.correctAnswer !== "undefined";
      var saved = vr.json.savedToProblemSet;
      record("8.variant", shape ? true : false,
        "variants=" + variants.length + " savedToProblemSet=" + (saved === PSID ? "PSID" : String(saved)));
    } else if (vr.json && /no_llm|strong|unavailable/i.test(JSON.stringify(vr.json))) {
      strongOk = false; record("8.variant", false, "strong_chain_unavailable");
    } else {
      record("8.variant", false, (vr.err || "HTTP " + vr.status + " " + (vr.body || "").slice(0, 120)));
    }
  } else {
    record("8.variant", "skip", "no problemSet");
  }

  // 9. textbook-page runtime
  if (TEXTBOOK_ID) {
    var tp = await request("POST", BASE + "/api/practice", {
      action: "generate", profileId: PID, worldId: WID,
      sourceType: "textbook-page", textbookId: TEXTBOOK_ID, page: 1, count: 1, teachingLanguage: "chinese"
    });
    if (tp.json && tp.json.problemSet) {
      record("9.textbook-page", true, "generated from textbook page");
    } else if (tp.json && tp.json.error === "no_source") {
      record("9.textbook-page", "warn", "textbook_page_runtime_no_source (UI must prefer sourceText)");
    } else {
      record("9.textbook-page", "warn", "textbook_page_runtime_failed: " + (tp.err || "HTTP " + tp.status));
    }
  } else {
    record("9.textbook-page", "skip", "textbook_page_runtime_not_tested (no PRACTICE_E2E_TEXTBOOK_ID)");
  }

  finish(strongOk ? null : "strong_chain_unavailable");
}

function finish(globalNote) {
  var hard = results.filter(function (r) { return r.ok === false; });
  console.log("");
  console.log("Steps: " + results.length + "  Pass: " +
    results.filter(function (r) { return r.ok === true; }).length +
    "  Fail: " + hard.length +
    "  Warn: " + results.filter(function (r) { return r.ok === "warn"; }).length +
    "  Skip: " + results.filter(function (r) { return r.ok === "skip"; }).length);
  if (globalNote) console.log("Note: " + globalNote);
  console.log("JSON_RESULTS " + JSON.stringify({ note: globalNote || null, results: results }));
  process.exit(hard.length > 0 ? 1 : 0);
}

main().catch(function (e) {
  console.error("FATAL " + (e && e.stack ? e.stack : e));
  process.exit(2);
});

