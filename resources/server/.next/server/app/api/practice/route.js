(()=>{var a={};a.id=59005,a.ids=[59005],a.modules={261:a=>{"use strict";a.exports=require("next/dist/shared/lib/router/utils/app-paths")},3295:a=>{"use strict";a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},10846:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},29294:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},59006:(a,b,c)=>{"use strict";c.r(b),c.d(b,{handler:()=>C,patchFetch:()=>B,routeModule:()=>x,serverHooks:()=>A,workAsyncStorage:()=>y,workUnitAsyncStorage:()=>z});var d={};c.r(d),c.d(d,{GET:()=>wGET,POST:()=>wPOST});var e=c(19225),f=c(84006),g=c(8317),h=c(99373),i=c(34775),j=c(24235),k=c(261),l=c(54365),m=c(90771),n=c(73461),o=c(67798),p=c(92280),q=c(62018),r=c(45696),s=c(47929),t=c(86439),u=c(37527),v=c(45592);/* TEMPORARY: createPracticeLLMCaller - inline LLM caller for the practice workbench. Replace with proper abstraction once practice stabilizes. */
function createPracticeLLMCaller(mc, model) {
  return async function (p) {
    var r = await fetch(mc.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + mc.apiKey },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }],
        temperature: typeof p.temperature === "number" ? p.temperature : 0.4,
        max_tokens: p.maxTokens || 4096,
        response_format: { type: "json_object" }
      })
    });
    if (!r.ok) { var t = await r.text(); throw new Error("LLM API " + r.status + ": " + t.slice(0, 200)); }
    var d = await r.json();
    return d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : "";
  };
}

// Resolve an LLM caller from the teaching-model config. Returns null when no usable config.
function _resolveLLM(body) {
  var set = global.__SOCRATOPIA_SET__ || {};
  var mc = set.strong || set.kb || set.weak || null;
  if (!mc || !mc.baseUrl) return null;
  var apiKey = body.apiKey || mc.apiKey || "";
  if (!apiKey) return null;
  var model = body.model || mc.model;
  if (!model) return null;
  return createPracticeLLMCaller({ baseUrl: mc.baseUrl, apiKey: apiKey }, model);
}

// Extract JSON object from possibly-fenced LLM text.
function _extractJson(text) {
  if (!text || typeof text !== "string") return null;
  var t = text.trim();
  // Try strict parse first, then a sanitized retry that escapes illegal
  // backslash sequences (e.g. LaTeX \( \[ \frac inside string values, which
  // are invalid JSON escapes and make JSON.parse throw).
  function tryParse(s) {
    try { return JSON.parse(s); } catch (e) {}
    try { return JSON.parse(s.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")); } catch (e) {}
    return undefined;
  }
  var r = tryParse(t);
  if (r !== undefined) return r;
  var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { r = tryParse(fence[1].trim()); if (r !== undefined) return r; }
  // balance braces
  var start = t.indexOf("{");
  if (start >= 0) {
    var depth = 0, end = -1;
    for (var i = start; i < t.length; i++) {
      if (t[i] === "{") depth++;
      else if (t[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end > start) { r = tryParse(t.slice(start, end)); if (r !== undefined) return r; }
  }
  // balance brackets (array)
  var as = t.indexOf("[");
  if (as >= 0) {
    var d2 = 0, e2 = -1;
    for (var j = as; j < t.length; j++) {
      if (t[j] === "[") d2++;
      else if (t[j] === "]") { d2--; if (d2 === 0) { e2 = j + 1; break; } }
    }
    if (e2 > as) { r = tryParse(t.slice(as, e2)); if (r !== undefined) return r; }
  }
  return null;
}

function _norm(s) {
  return String(s == null ? "" : s).trim().toLowerCase().replace(/[\s。.!！？?，,;；:：、]+$/g, "").replace(/\s+/g, " ");
}

function _jsonErr(code, message, status, headers) {
  return v.NextResponse.json({ error: code, message: message }, { status: status, headers: headers });
}

// ===== Source resolution for generate =====
// Delegate to the standalone source adapter (global.__PRACTICE_SOURCE__, loaded
// by server.js). Falls back to a local require so the route still works if the
// global was not set. Returns { text, kind } on success, or { error, message }.
function _resolveSource(body) {
  var SA = global.__PRACTICE_SOURCE__;
  if (!SA) {
    try { SA = require("../../../../../lib/practice/source-adapter.js"); }
    catch (e) { SA = null; }
  }
  if (SA && typeof SA.resolveSourceText === "function" && body && body.sourceType === "mixed") {
    var parts = [];
    var errors = [];
    var noFocusBody = Object.assign({}, body);
    delete noFocusBody.sourceText;
    var tb = Object.assign({}, noFocusBody, { sourceType: "textbook-page" });
    var cv = Object.assign({}, noFocusBody, { sourceType: "conversation" });
    var r1 = SA.resolveSourceText(tb);
    if (r1 && r1.text) parts.push("【教材范围】\n" + r1.text);
    else if (r1 && r1.message) errors.push(r1.message);
    var r2 = SA.resolveSourceText(cv);
    if (r2 && r2.text) parts.push("【课堂范围】\n" + r2.text);
    else if (r2 && r2.message) errors.push(r2.message);
    if (parts.length) return { text: parts.join("\n\n"), kind: "mixed:textbook+conversation" };
    if (body.focusText && typeof body.focusText === "string" && body.focusText.trim()) {
      return { text: body.focusText.trim(), kind: "mixed:focusText-fallback" };
    }
    return { error: "no_source", message: errors.join("；") || "No readable textbook or conversation source." };
  }
  if (SA && typeof SA.resolveSourceText === "function" && body && body.sourceType === "conversation" && !body.sourceText && Array.isArray(body.conversationIds) && body.conversationIds.length) {
    var convoParts = [];
    var convoErrors = [];
    for (var ci = 0; ci < body.conversationIds.length && ci < 12; ci++) {
      var cid = body.conversationIds[ci];
      if (!cid || typeof cid !== "string") continue;
      var single = Object.assign({}, body, { sourceType: "conversation", conversationId: cid });
      delete single.conversationIds;
      var cr = SA.resolveSourceText(single);
      if (cr && cr.text) convoParts.push("【课堂 " + (ci + 1) + "】\n" + cr.text);
      else if (cr && cr.message) convoErrors.push(cr.message);
    }
    if (convoParts.length) return { text: convoParts.join("\n\n"), kind: "conversation:multiple" };
    if (body.focusText && typeof body.focusText === "string" && body.focusText.trim()) {
      return { text: body.focusText.trim(), kind: "conversation:focusText-fallback" };
    }
    return { error: "no_source", message: convoErrors.join("；") || "No readable conversation sources." };
  }
  if (SA && typeof SA.resolveSourceText === "function") {
    var resolved = SA.resolveSourceText(body);
    if (resolved && resolved.error && body && body.sourceType === "textbook-page" && Array.isArray(body.conversationIds) && body.conversationIds.length) {
      var fallbackParts = [];
      for (var fi = 0; fi < body.conversationIds.length && fi < 12; fi++) {
        var fcid = body.conversationIds[fi];
        if (!fcid || typeof fcid !== "string") continue;
        var fsingle = Object.assign({}, body, { sourceType: "conversation", conversationId: fcid });
        delete fsingle.conversationIds;
        var fr = SA.resolveSourceText(fsingle);
        if (fr && fr.text) fallbackParts.push("【课堂范围 " + (fi + 1) + "】\n" + fr.text);
      }
      if (fallbackParts.length) return { text: fallbackParts.join("\n\n"), kind: "textbook-page:conversation-fallback" };
    }
    if (resolved && resolved.error && body.focusText && typeof body.focusText === "string" && body.focusText.trim()) {
      return { text: body.focusText.trim(), kind: (body.sourceType || "manual") + ":focusText-fallback" };
    }
    return resolved;
  }
  // Minimal fallback: explicit sourceText only.
  if (body.sourceText && typeof body.sourceText === "string" && body.sourceText.trim()) {
    return { text: body.sourceText.trim(), kind: (body.sourceType || "manual") + ":provided-sourceText" };
  }
  if (body.focusText && typeof body.focusText === "string" && body.focusText.trim()) {
    return { text: body.focusText.trim(), kind: (body.sourceType || "manual") + ":focusText-fallback" };
  }
  return { error: "no_source", message: "Source adapter unavailable; provide sourceText." };
}

function _conceptGraphContext(body) {
  var SA = global.__PRACTICE_SOURCE__;
  if (SA && typeof SA.conceptGraphContext === "function") {
    try { return SA.conceptGraphContext(body, 8) || ""; } catch (e) { return ""; }
  }
  return "";
}

// ===== Action handlers =====

async function _doGenerate(body, h) {
  var P = global.__PRACTICE__;
  if (!P) return _jsonErr("practice_unavailable", "practice data layer not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId;
  if (!pid || !wid) return _jsonErr("missing_params", "profileId and worldId required", 400, h);

  var source = _resolveSource(body);
  if (!source || source.error) return _jsonErr("no_source", (source && source.message) || "No source text. Provide sourceText, a textbook page, a chapter, or a conversation summary.", 404, h);

  var callLLM = _resolveLLM(body);
  if (!callLLM) return _jsonErr("no_llm", "No LLM available. Provide apiKey or configure set.json strong model.", 400, h);

  var lang = body.teachingLanguage || "chinese";
  var zh = lang.indexOf("english") < 0;
  var validTypes = { choice: 1, fill: 1, "short-answer": 1, step: 1 };
  var specs = [];
  if (Array.isArray(body.composition)) {
    for (var si = 0; si < body.composition.length; si++) {
      var rawSpec = body.composition[si] || {};
      var stype = validTypes[rawSpec.type] ? rawSpec.type : null;
      var scount = parseInt(rawSpec.count, 10);
      var sdiff = parseInt(rawSpec.difficulty, 10);
      if (stype && scount > 0) specs.push({
        type: stype,
        count: Math.min(20, scount),
        difficulty: (sdiff >= 1 && sdiff <= 3) ? sdiff : 2
      });
    }
  }
  if (!specs.length) {
    var types = Array.isArray(body.problemTypes) && body.problemTypes.length ? body.problemTypes : ["choice", "short-answer"];
    var difficulty = (typeof body.difficulty === "number" && body.difficulty >= 1 && body.difficulty <= 3) ? body.difficulty : 2;
    var count = (typeof body.count === "number" && body.count >= 1 && body.count <= 20) ? body.count : 5;
    var cleanTypes = types.filter(function (t) { return validTypes[t]; });
    if (!cleanTypes.length) cleanTypes = ["choice"];
    for (var ti = 0; ti < cleanTypes.length; ti++) {
      var share = Math.floor(count / cleanTypes.length) + (ti < count % cleanTypes.length ? 1 : 0);
      if (share > 0) specs.push({ type: cleanTypes[ti], count: share, difficulty: difficulty });
    }
  }
  if (!specs.length) specs.push({ type: "choice", count: 5, difficulty: 2 });
  var totalCount = specs.reduce(function (sum, s) { return sum + s.count; }, 0);
  if (totalCount > 24) {
    return _jsonErr("too_many_problems", "A paper can contain at most 24 problems.", 400, h);
  }
  var specText = specs.map(function (s) {
    return s.type + " x " + s.count + " (difficulty " + s.difficulty + ")";
  }).join("; ");
  var maxDifficulty = specs.reduce(function (m, s) { return Math.max(m, s.difficulty); }, 1);
  var focusText = (body.focusText && typeof body.focusText === "string" && body.focusText.trim()) ? body.focusText.trim().slice(0, 4000) : "";

  var sys = zh
    ? "你是一个严谨的出题专家。根据给定的教材/课堂内容生成练习题。严格只输出 JSON,不要加 markdown 代码块标记,不要加额外文字。题目不能超出给定内容太远;如果用到补充知识,必须在 solution 中标注。"
    : "You are a rigorous problem-setter. Generate practice problems from the given material. Output strict JSON only, no markdown fences, no extra text. Do not stray far from the given material; if you use supplementary knowledge, note it in solution.";

  var cgContext = _conceptGraphContext(body);
  var user = (zh ? "教材/课堂内容:\n" : "Material:\n") + source.text.slice(0, 8000) + "\n\n" +
    (focusText ? (zh ? "用户补充的重点/备考方向(只作为出题倾向参考,不能替代教材/课堂范围):\n" : "User focus notes (reference for emphasis only, not a replacement for the source range):\n") + focusText + "\n\n" : "") +
    (cgContext ? (zh ? "相关概念图谱(仅供参考,不要照搬):\n" : "Related concept graph (reference only):\n") + cgContext + "\n\n" : "") +
    (zh ? "请生成一张综合试卷,结构必须严格符合: " + specText + "。总题数 " + totalCount + "。难度 1入门/2进阶/3综合。\n" : "Generate a mixed paper. The structure must exactly match: " + specText + ". Total problems: " + totalCount + ". Difficulty scale 1-3.\n") +
    "请输出 JSON:\n{\n  \"problems\": [\n    {\n      \"type\": \"choice|fill|short-answer|step\",\n      \"question\": \"...\",\n      \"choices\": [\"A\",\"B\",\"C\",\"D\"],\n      \"correctAnswer\": \"...\",\n      \"correctIndex\": 0,\n      \"solution\": \"...\",\n      \"knowledgePoints\": [\"...\"],\n      \"difficulty\": " + maxDifficulty + ",\n      \"commonMistakes\": [\"...\"]\n    }\n  ]\n}\n" +
    (zh ? "要求: choice 题必须有 choices 和 correctIndex; fill/short-answer/step 必须有 correctAnswer 和 solution; 每题至少一个 knowledgePoint; 不要把题型集中成单一类型,必须按结构分配。" : "Rules: choice needs choices+correctIndex; others need correctAnswer+solution; each problem >= 1 knowledgePoint; do not collapse into one type, follow the structure exactly.");

  var raw;
  try { raw = await callLLM({ system: sys, user: user, temperature: 0.5, maxTokens: 6000 }); }
  catch (e) { return _jsonErr("llm_error", "LLM call failed: " + (e && e.message), 502, h); }
  var parsed = _extractJson(raw);
  if (!parsed) return _jsonErr("parse_error", "Failed to parse LLM JSON", 502, h);
  var arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.problems) ? parsed.problems : null);
  if (!arr) return _jsonErr("parse_error", "LLM output missing problems array", 502, h);

  var sourceMeta = {
    profileId: pid, worldId: wid,
    textbookId: body.textbookId || undefined,
    textbookTitle: body.textbookTitle || undefined,
    pages: Array.isArray(body.pageRange) ? body.pageRange : undefined,
    conversationId: body.conversationId || undefined,
    conversationIds: Array.isArray(body.conversationIds) ? body.conversationIds.slice(0, 12) : undefined,
    sourceType: body.sourceType || source.kind,
    sourceKind: source.kind,
    focusText: focusText || undefined,
    rangeMode: body.rangeMode || body.sourceType || undefined,
    composition: specs
  };

  var problems = [];
  for (var i = 0; i < arr.length; i++) {
    var p = P.normalizeProblem(arr[i], i);
    if (!p) continue;
    p.source = sourceMeta;
    // For choice problems, resolve correctIndex from correctAnswer text if needed
    if (p.type === "choice" && Array.isArray(p.choices)) {
      if (typeof p.correctIndex !== "number" || p.correctIndex < 0 || p.correctIndex >= p.choices.length) {
        var ci = -1;
        for (var ck = 0; ck < p.choices.length; ck++) { if (_norm(p.choices[ck]) === _norm(p.correctAnswer)) { ci = ck; break; } }
        if (ci >= 0) p.correctIndex = ci;
      }
      if ((!p.correctAnswer || !p.correctAnswer.trim()) && typeof p.correctIndex === "number" && p.choices[p.correctIndex]) {
        p.correctAnswer = String(p.choices[p.correctIndex]);
      }
    }
    var errs = P.validateProblem(p);
    if (errs.length === 0) problems.push(p);
  }
  if (problems.length === 0) return _jsonErr("no_valid_problems", "LLM produced no valid problems", 422, h);

  var ps = P.defaultProblemSet(P.genId("ps"), sourceMeta);
  ps.problems = problems;
  try { P.writeProblemSet(pid, wid, ps); }
  catch (e) { return _jsonErr("save_failed", "Failed to save problem set: " + (e && e.message), 500, h); }

  return v.NextResponse.json({ problemSet: ps }, { headers: h });
}

async function _doGrade(body, h) {
  var P = global.__PRACTICE__;
  if (!P) return _jsonErr("practice_unavailable", "practice data layer not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId, psid = body.problemSetId, pbid = body.problemId;
  if (!pid || !wid || !psid || !pbid) return _jsonErr("missing_params", "profileId, worldId, problemSetId, problemId required", 400, h);
  var userAnswer = body.userAnswer != null ? String(body.userAnswer) : "";

  var ps = P.readProblemSet(pid, wid, psid);
  if (!ps) return _jsonErr("not_found", "ProblemSet not found", 404, h);
  var problem = null;
  for (var i = 0; i < ps.problems.length; i++) { if (ps.problems[i].id === pbid) { problem = ps.problems[i]; break; } }
  if (!problem) return _jsonErr("not_found", "Problem not found", 404, h);

  var result = null;

  if (problem.type === "choice") {
    // Local grading — no LLM. Accept index (number-like) or choice text.
    var correctIdx = (typeof problem.correctIndex === "number") ? problem.correctIndex : -1;
    var ok = false;
    var ua = userAnswer.trim();
    if (/^\d+$/.test(ua)) { ok = parseInt(ua, 10) === correctIdx; }
    if (!ok && Array.isArray(problem.choices)) {
      ok = _norm(ua) === _norm(problem.correctAnswer);
      if (!ok && correctIdx >= 0 && problem.choices[correctIdx]) ok = _norm(ua) === _norm(problem.choices[correctIdx]);
    }
    result = {
      correct: ok, score: ok ? 1 : 0,
      normalizedUserAnswer: ua, normalizedCorrectAnswer: String(problem.correctAnswer),
      feedback: ok ? "回答正确。" : "回答错误,正确答案是: " + problem.correctAnswer,
      mistakeType: ok ? undefined : "concept",
      missingPoints: ok ? [] : problem.knowledgePoints,
      nextAction: ok ? "continue" : "explain"
    };
  } else if (problem.type === "fill") {
    // Normalized local compare; fall back to LLM only if available and mismatch
    var fok = _norm(userAnswer) === _norm(problem.correctAnswer);
    if (!fok) {
      // accept pipe-separated acceptable answers
      var alts = String(problem.correctAnswer).split("|").map(_norm);
      fok = alts.indexOf(_norm(userAnswer)) >= 0;
    }
    if (fok) {
      result = { correct: true, score: 1, normalizedUserAnswer: _norm(userAnswer), normalizedCorrectAnswer: _norm(problem.correctAnswer), feedback: "回答正确。", missingPoints: [], nextAction: "continue" };
    } else {
      var callLLMf = _resolveLLM(body);
      if (callLLMf) {
        result = await _llmGrade(callLLMf, problem, userAnswer);
      }
      if (!result) {
        result = { correct: false, score: 0, normalizedUserAnswer: _norm(userAnswer), normalizedCorrectAnswer: _norm(problem.correctAnswer), feedback: "回答与参考答案不一致。参考答案: " + problem.correctAnswer, mistakeType: "concept", missingPoints: problem.knowledgePoints, nextAction: "explain" };
      }
    }
  } else {
    // short-answer / step → LLM grading
    var callLLM = _resolveLLM(body);
    if (!callLLM) return _jsonErr("no_llm", "Subjective grading requires an LLM. Provide apiKey or configure set.json.", 400, h);
    result = await _llmGrade(callLLM, problem, userAnswer);
    if (!result) return _jsonErr("grade_failed", "Failed to grade answer", 502, h);
  }

  // Write into problem.history
  try {
    P.appendAnswerRecord(pid, wid, psid, pbid, {
      userAnswer: userAnswer, correct: result.correct, score: result.score,
      mistakeType: result.mistakeType || null, feedback: result.feedback || null
    });
  } catch (e) { result._warning = "Failed to persist answer record: " + (e && e.message); }

  // Suggest (but do not force) saving a mistake when incorrect
  if (!result.correct) {
    result.suggestSaveMistake = {
      problemId: pbid,
      wrongAnswer: userAnswer,
      correctAnswer: String(problem.correctAnswer),
      diagnosis: result.feedback || "",
      knowledgePoints: problem.knowledgePoints || [],
      source: problem.source || {}
    };
  }

  return v.NextResponse.json({ grading: result }, { headers: h });
}

async function _llmGrade(callLLM, problem, userAnswer) {
  var sys = "你是严格但公正的判题老师。根据题目、参考答案和评分要点判定学生作答。严格只输出 JSON,不要 markdown,不要额外文字。不要编造学生没写的内容。";
  var user = "题目: " + problem.question + "\n参考答案: " + problem.correctAnswer + "\n" +
    (problem.solution ? "解析: " + problem.solution + "\n" : "") +
    (Array.isArray(problem.rubric) && problem.rubric.length ? "评分要点: " + problem.rubric.join("; ") + "\n" : "") +
    "知识点: " + (problem.knowledgePoints || []).join(", ") + "\n" +
    "学生作答: " + userAnswer + "\n\n" +
    "请输出 JSON:\n{\n  \"correct\": true,\n  \"score\": 0.0,\n  \"feedback\": \"具体反馈,说明为什么对/错\",\n  \"mistakeType\": \"concept|method|calculation|reading|expression|unknown\",\n  \"missingPoints\": [\"遗漏的要点\"]\n}\nscore 取 0-1。correct 与 score 要一致(score>=0.6 视为基本正确)。";
  var raw;
  try { raw = await callLLM({ system: sys, user: user, temperature: 0.2, maxTokens: 1500 }); }
  catch (e) { return null; }
  var parsed = _extractJson(raw);
  if (!parsed) return null;
  var score = (typeof parsed.score === "number") ? Math.max(0, Math.min(1, parsed.score)) : (parsed.correct ? 1 : 0);
  var correct = (typeof parsed.correct === "boolean") ? parsed.correct : score >= 0.6;
  var validMt = { concept: 1, method: 1, calculation: 1, reading: 1, expression: 1, unknown: 1 };
  return {
    correct: correct, score: score,
    normalizedUserAnswer: userAnswer, normalizedCorrectAnswer: String(problem.correctAnswer),
    feedback: String(parsed.feedback || (correct ? "回答正确。" : "回答有误。")),
    mistakeType: correct ? undefined : (validMt[parsed.mistakeType] ? parsed.mistakeType : "unknown"),
    missingPoints: Array.isArray(parsed.missingPoints) ? parsed.missingPoints.filter(function (m) { return typeof m === "string"; }) : [],
    nextAction: correct ? "continue" : "explain"
  };
}

async function _doHint(body, h) {
  var P = global.__PRACTICE__;
  if (!P) return _jsonErr("practice_unavailable", "practice data layer not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId, psid = body.problemSetId, pbid = body.problemId;
  if (!pid || !wid || !psid || !pbid) return _jsonErr("missing_params", "profileId, worldId, problemSetId, problemId required", 400, h);
  var ps = P.readProblemSet(pid, wid, psid);
  if (!ps) return _jsonErr("not_found", "ProblemSet not found", 404, h);
  var problem = null;
  for (var i = 0; i < ps.problems.length; i++) { if (ps.problems[i].id === pbid) { problem = ps.problems[i]; break; } }
  if (!problem) return _jsonErr("not_found", "Problem not found", 404, h);

  var callLLM = _resolveLLM(body);
  if (!callLLM) return _jsonErr("no_llm", "Hint generation requires an LLM.", 400, h);

  var sys = "你是循循善诱的辅导老师。给学生提示,引导其自己想出答案。严格禁止透露最终答案或正确选项。严格只输出 JSON,不要 markdown。";
  var user = "题目: " + problem.question + "\n知识点: " + (problem.knowledgePoints || []).join(", ") + "\n" +
    (body.userAnswer ? "学生当前作答: " + body.userAnswer + "\n" : "") +
    (Array.isArray(body.attemptHistory) && body.attemptHistory.length ? "之前尝试: " + body.attemptHistory.slice(-3).join(" | ") + "\n" : "") +
    "\n请输出 JSON:\n{\n  \"hint\": \"一条不泄露答案的提示\",\n  \"focusKnowledgePoint\": \"建议关注的知识点\",\n  \"guidingQuestion\": \"一个引导性问题\"\n}\n严禁包含最终答案或正确选项文字。";
  var raw;
  try { raw = await callLLM({ system: sys, user: user, temperature: 0.5, maxTokens: 800 }); }
  catch (e) { return _jsonErr("llm_error", "LLM call failed: " + (e && e.message), 502, h); }
  var parsed = _extractJson(raw);
  if (!parsed) return _jsonErr("parse_error", "Failed to parse hint JSON", 502, h);
  var hint = {
    hint: String(parsed.hint || ""),
    focusKnowledgePoint: String(parsed.focusKnowledgePoint || ""),
    guidingQuestion: String(parsed.guidingQuestion || "")
  };
  return v.NextResponse.json({ hint: hint }, { headers: h });
}

async function _doExplain(body, h) {
  var P = global.__PRACTICE__;
  if (!P) return _jsonErr("practice_unavailable", "practice data layer not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId, psid = body.problemSetId, pbid = body.problemId;
  if (!pid || !wid || !psid || !pbid) return _jsonErr("missing_params", "profileId, worldId, problemSetId, problemId required", 400, h);
  var ps = P.readProblemSet(pid, wid, psid);
  if (!ps) return _jsonErr("not_found", "ProblemSet not found", 404, h);
  var problem = null;
  for (var i = 0; i < ps.problems.length; i++) { if (ps.problems[i].id === pbid) { problem = ps.problems[i]; break; } }
  if (!problem) return _jsonErr("not_found", "Problem not found", 404, h);

  var callLLM = _resolveLLM(body);
  if (!callLLM) return _jsonErr("no_llm", "Explanation requires an LLM.", 400, h);

  var sys = "你是擅长分步讲题的老师。把解题过程拆成清晰的步骤,每步包含讲解和检查问题。严格只输出 JSON,不要 markdown。数学公式用 \\(...\\) 或 \\[...\\]。";
  var user = "题目: " + problem.question + "\n参考答案: " + problem.correctAnswer + "\n" +
    (problem.solution ? "解析参考: " + problem.solution + "\n" : "") +
    "知识点: " + (problem.knowledgePoints || []).join(", ") + "\n" +
    (body.userAnswer ? "学生作答: " + body.userAnswer + "\n" : "") +
    (body.grading && body.grading.feedback ? "判题反馈: " + body.grading.feedback + "\n" : "") +
    "\n请输出 JSON:\n{\n  \"summary\": \"一句话概述解题思路\",\n  \"steps\": [\n    {\"title\":\"步骤标题\",\"content\":\"讲解\",\"checkQuestion\":\"检查学生是否跟上的问题\",\"hint\":\"提示\",\"expectedAnswer\":\"该步期望答案\",\"commonMistake\":\"常见误区\"}\n  ],\n  \"finalAnswer\": \"完整最终答案\",\n  \"mistakeDiagnosis\": \"如果有学生作答,诊断错因\",\n  \"variantDirections\": [\"变式方向\"]\n}\nsteps 至少 2 步。";
  var raw;
  try { raw = await callLLM({ system: sys, user: user, temperature: 0.4, maxTokens: 4000 }); }
  catch (e) { return _jsonErr("llm_error", "LLM call failed: " + (e && e.message), 502, h); }
  var parsed = _extractJson(raw);
  if (!parsed || !Array.isArray(parsed.steps)) return _jsonErr("parse_error", "Failed to parse explanation steps", 502, h);

  var steps = [];
  for (var s = 0; s < parsed.steps.length; s++) {
    var st = parsed.steps[s];
    if (!st || typeof st !== "object") continue;
    steps.push({
      title: String(st.title || ("步骤 " + (s + 1))),
      content: String(st.content || ""),
      checkQuestion: st.checkQuestion ? String(st.checkQuestion) : undefined,
      hint: st.hint ? String(st.hint) : undefined,
      expectedAnswer: st.expectedAnswer ? String(st.expectedAnswer) : undefined,
      commonMistake: st.commonMistake ? String(st.commonMistake) : undefined
    });
  }
  if (steps.length === 0) return _jsonErr("no_steps", "Explanation produced no steps", 422, h);

  var explanation = {
    problemId: pbid,
    generatedAt: new Date().toISOString(),
    summary: String(parsed.summary || ""),
    steps: steps,
    finalAnswer: String(parsed.finalAnswer || problem.correctAnswer),
    mistakeDiagnosis: parsed.mistakeDiagnosis ? String(parsed.mistakeDiagnosis) : undefined,
    variantDirections: Array.isArray(parsed.variantDirections) ? parsed.variantDirections.filter(function (x) { return typeof x === "string"; }) : undefined
  };
  return v.NextResponse.json({ explanation: explanation }, { headers: h });
}

async function _doVariant(body, h) {
  var P = global.__PRACTICE__;
  if (!P) return _jsonErr("practice_unavailable", "practice data layer not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId, psid = body.problemSetId, pbid = body.problemId;
  if (!pid || !wid || !psid || !pbid) return _jsonErr("missing_params", "profileId, worldId, problemSetId, problemId required", 400, h);
  var ps = P.readProblemSet(pid, wid, psid);
  if (!ps) return _jsonErr("not_found", "ProblemSet not found", 404, h);
  var problem = null;
  for (var i = 0; i < ps.problems.length; i++) { if (ps.problems[i].id === pbid) { problem = ps.problems[i]; break; } }
  if (!problem) return _jsonErr("not_found", "Problem not found", 404, h);

  var callLLM = _resolveLLM(body);
  if (!callLLM) return _jsonErr("no_llm", "Variant generation requires an LLM.", 400, h);

  var count = (typeof body.count === "number" && body.count >= 1 && body.count <= 3) ? body.count : 2;
  var sys = "你是出题专家,负责生成变式题。变式题必须保持与原题相同或高度相关的知识点,只改变表面条件/场景/数值,不得引入完全无关的知识点。严格只输出 JSON,不要 markdown。";
  var user = "原题: " + problem.question + "\n原题答案: " + problem.correctAnswer + "\n知识点: " + (problem.knowledgePoints || []).join(", ") + "\n" +
    (body.mistakeType ? "学生错因类型: " + body.mistakeType + "\n" : "") +
    "\n请生成 " + count + " 道变式题,输出 JSON:\n{\n  \"problems\": [\n    {\"type\":\"" + problem.type + "\",\"question\":\"...\",\"choices\":[\"...\"],\"correctAnswer\":\"...\",\"correctIndex\":0,\"solution\":\"...\",\"knowledgePoints\":[\"...\"],\"difficulty\":" + problem.difficulty + ",\"commonMistakes\":[\"...\"]}\n  ]\n}\n知识点必须与原题一致或高度相关。";
  var raw;
  try { raw = await callLLM({ system: sys, user: user, temperature: 0.6, maxTokens: 4000 }); }
  catch (e) { return _jsonErr("llm_error", "LLM call failed: " + (e && e.message), 502, h); }
  var parsed = _extractJson(raw);
  var arr = parsed && (Array.isArray(parsed) ? parsed : parsed.problems);
  if (!Array.isArray(arr)) return _jsonErr("parse_error", "Failed to parse variant problems", 502, h);

  var variants = [];
  var srcMeta = problem.source || { profileId: pid, worldId: wid };
  for (var k = 0; k < arr.length && variants.length < count; k++) {
    var p = P.normalizeProblem(arr[k], k);
    if (!p) continue;
    p.source = Object.assign({}, srcMeta, { variantOf: pbid });
    if (p.type === "choice" && Array.isArray(p.choices)) {
      if (typeof p.correctIndex !== "number" || p.correctIndex < 0 || p.correctIndex >= p.choices.length) {
        var ci = -1;
        for (var cj = 0; cj < p.choices.length; cj++) { if (_norm(p.choices[cj]) === _norm(p.correctAnswer)) { ci = cj; break; } }
        if (ci >= 0) p.correctIndex = ci;
      }
    }
    if (P.validateProblem(p).length === 0) variants.push(p);
  }
  if (variants.length === 0) return _jsonErr("no_valid_variants", "No valid variant problems produced", 422, h);

  // Persistence policy: append variants to the SAME problem set (so they can be answered/graded).
  var saved = false;
  try {
    for (var vi = 0; vi < variants.length; vi++) ps.problems.push(variants[vi]);
    P.writeProblemSet(pid, wid, ps);
    saved = true;
  } catch (e) { saved = false; }

  return v.NextResponse.json({ variants: variants, savedToProblemSet: saved ? psid : null }, { headers: h });
}

async function _doSaveMistake(body, h) {
  var P = global.__PRACTICE__;
  if (!P) return _jsonErr("practice_unavailable", "practice data layer not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId;
  if (!pid || !wid || !body.problemId) return _jsonErr("missing_params", "profileId, worldId, problemId required", 400, h);
  var saved;
  try {
    saved = P.saveMistake(pid, wid, {
      problemId: body.problemId,
      wrongAnswer: body.wrongAnswer,
      correctAnswer: body.correctAnswer,
      diagnosis: body.diagnosis,
      knowledgePoints: body.knowledgePoints,
      source: body.source,
      status: body.status,
      nextReview: body.nextReview,
      reviewEntry: body.reviewEntry
    });
  } catch (e) { return _jsonErr("save_failed", "Failed to save mistake: " + (e && e.message), 500, h); }
  return v.NextResponse.json({ mistake: saved }, { headers: h });
}

async function _doListMistakes(body, h) {
  var P = global.__PRACTICE__;
  if (!P) return _jsonErr("practice_unavailable", "practice data layer not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId;
  if (!pid || !wid) return _jsonErr("missing_params", "profileId, worldId required", 400, h);
  var filters = {
    textbookId: body.textbookId || undefined,
    knowledgePoint: body.knowledgePoint || undefined,
    createdAfter: body.createdAfter || undefined,
    reviewDue: body.reviewDue === true,
    includeMastered: body.includeMastered === true
  };
  var mistakes;
  try { mistakes = P.readMistakes(pid, wid, filters); }
  catch (e) { return _jsonErr("list_failed", "Failed to list mistakes: " + (e && e.message), 500, h); }
  return v.NextResponse.json({ mistakes: mistakes }, { headers: h });
}

async function _doSavePracticeRecord(body, h) {
  var P = global.__PRACTICE__;
  if (!P) return _jsonErr("practice_unavailable", "practice data layer not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId, psid = body.problemSetId;
  if (!pid || !wid || !psid) return _jsonErr("missing_params", "profileId, worldId, problemSetId required", 400, h);
  var ps = P.readProblemSet(pid, wid, psid);
  if (!ps) return _jsonErr("not_found", "ProblemSet not found", 404, h);
  var problems = Array.isArray(ps.problems) ? ps.problems : [];
  var grades = body.grades && typeof body.grades === "object" ? body.grades : {};
  var answeredCount = typeof body.answeredCount === "number" ? body.answeredCount : Object.keys(grades).length;
  var correctCount = typeof body.correctCount === "number" ? body.correctCount : Object.keys(grades).filter(function (k) { return grades[k] && grades[k].correct; }).length;
  var score = typeof body.score === "number" ? body.score : (problems.length ? correctCount / problems.length : null);
  var record;
  try {
    record = P.savePracticeRecord(pid, wid, {
      problemSetId: psid,
      status: body.status || "submitted",
      submittedAt: body.submittedAt || new Date().toISOString(),
      problemCount: problems.length,
      answeredCount: answeredCount,
      correctCount: correctCount,
      score: score,
      source: ps.source || {},
      composition: (ps.source && ps.source.composition) || body.composition || null,
      answers: body.answers || {},
      grades: grades,
      summary: body.summary || null,
      companionId: body.companionId || undefined,
      companionName: body.companionName || undefined,
      tutoringSessionId: psid
    });
  } catch (e) { return _jsonErr("save_failed", "Failed to save practice record: " + (e && e.message), 500, h); }
  return v.NextResponse.json({ record: record }, { headers: h });
}

async function _doListPracticeRecords(body, h) {
  var P = global.__PRACTICE__;
  if (!P) return _jsonErr("practice_unavailable", "practice data layer not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId;
  if (!pid || !wid) return _jsonErr("missing_params", "profileId, worldId required", 400, h);
  var records;
  try { records = P.listPracticeRecords(pid, wid); }
  catch (e) { return _jsonErr("list_failed", "Failed to list practice records: " + (e && e.message), 500, h); }
  return v.NextResponse.json({ records: records }, { headers: h });
}

// ===== Tutoring session actions =====

function _resolveTutor() {
  var T = global.__PRACTICE_TUTOR__;
  if (!T) { try { T = require("../../../../../lib/practice/tutoring-session.js"); } catch (e) { T = null; } }
  return T;
}

function _buildTutorSystemPrompt(session, body) {
  var companionName = session.companionName || body.companionName || "学习伙伴";
  var ctx = session.context || body.context || null;
  var zh = !(body.teachingLanguage && body.teachingLanguage.indexOf("english") >= 0);
  var lines = [];
  if (zh) {
    lines.push("你是" + companionName + "，学生的学习伙伴。你正在帮助学生讲解一整张练习卷。");
    if (ctx) {
      if (ctx.exam) {
        lines.push("试卷：" + (ctx.exam.title || ctx.problemSetId || ""));
        if (typeof ctx.exam.score === "number") lines.push("整卷得分：" + Math.round(ctx.exam.score * 100) + " 分");
        if (ctx.exam.answeredCount != null && ctx.exam.problemCount != null) lines.push("完成情况：" + ctx.exam.answeredCount + "/" + ctx.exam.problemCount);
      }
      if (Array.isArray(ctx.problems)) {
        lines.push("试卷题目与作答：");
        ctx.problems.slice(0, 24).forEach(function (p, idx) {
          lines.push((idx + 1) + ". [" + (p.type || "题目") + "] " + (p.question || ""));
          if (p.userAnswer != null) lines.push("学生答案：" + p.userAnswer);
          if (p.correctAnswer != null) lines.push("参考答案：" + p.correctAnswer);
          if (p.grading && p.grading.feedback) lines.push("批改反馈：" + p.grading.feedback);
          if (Array.isArray(p.knowledgePoints) && p.knowledgePoints.length) lines.push("知识点：" + p.knowledgePoints.join(", "));
        });
      } else {
        if (ctx.question) lines.push("题目：" + ctx.question);
        if (ctx.userAnswer) lines.push("学生答案：" + ctx.userAnswer);
        if (ctx.correctAnswer) lines.push("正确答案：" + ctx.correctAnswer);
        if (typeof ctx.score === "number") lines.push("得分：" + ctx.score);
        if (ctx.mistakeType) lines.push("错误类型：" + ctx.mistakeType);
        if (ctx.grading && ctx.grading.feedback) lines.push("批改反馈：" + ctx.grading.feedback);
      }
    }
    lines.push("");
    lines.push("先概览整卷表现，再按学生最需要的题目讲。用苏格拉底式提问引导学生理解，允许在交卷后给出完整解法，但仍要先诊断思路。回复自然流畅，像课堂上一对一讲卷。");
  } else {
    lines.push("You are " + companionName + ", the student's learning companion. You are reviewing a full practice paper with the student.");
    if (ctx) {
      if (ctx.exam) {
        lines.push("Paper: " + (ctx.exam.title || ctx.problemSetId || ""));
        if (typeof ctx.exam.score === "number") lines.push("Paper score: " + Math.round(ctx.exam.score * 100));
        if (ctx.exam.answeredCount != null && ctx.exam.problemCount != null) lines.push("Progress: " + ctx.exam.answeredCount + "/" + ctx.exam.problemCount);
      }
      if (Array.isArray(ctx.problems)) {
        lines.push("Problems and answers:");
        ctx.problems.slice(0, 24).forEach(function (p, idx) {
          lines.push((idx + 1) + ". [" + (p.type || "problem") + "] " + (p.question || ""));
          if (p.userAnswer != null) lines.push("Student answer: " + p.userAnswer);
          if (p.correctAnswer != null) lines.push("Correct answer: " + p.correctAnswer);
          if (p.grading && p.grading.feedback) lines.push("Grading feedback: " + p.grading.feedback);
          if (Array.isArray(p.knowledgePoints) && p.knowledgePoints.length) lines.push("Knowledge points: " + p.knowledgePoints.join(", "));
        });
      } else {
        if (ctx.question) lines.push("Problem: " + ctx.question);
        if (ctx.userAnswer) lines.push("Student answer: " + ctx.userAnswer);
        if (ctx.correctAnswer) lines.push("Correct answer: " + ctx.correctAnswer);
        if (typeof ctx.score === "number") lines.push("Score: " + ctx.score);
        if (ctx.mistakeType) lines.push("Mistake type: " + ctx.mistakeType);
        if (ctx.grading && ctx.grading.feedback) lines.push("Grading feedback: " + ctx.grading.feedback);
      }
    }
    lines.push("");
    lines.push("Start with an overview of the paper, then focus on the problems the student needs most. Since the paper has already been submitted, you may provide full solutions, but diagnose their reasoning first. Be conversational and friendly.");
  }
  return lines.join("\n");
}

function _buildTutorMessages(session, userContent, actionHint) {
  var msgs = [];
  // Include recent history (last 20 messages to stay within context)
  var hist = session.messages || [];
  var start = Math.max(0, hist.length - 20);
  for (var i = start; i < hist.length; i++) {
    var m = hist[i];
    if (m.role === "user" || m.role === "assistant") {
      msgs.push({ role: m.role, content: m.content || "" });
    }
  }
  // Current user message
  var content = userContent || "";
  if (actionHint && !content) content = actionHint;
  if (content) msgs.push({ role: "user", content: content });
  return msgs;
}

function _streamingTutorResponse(mc, model, systemPrompt, messages) {
  var enc = new TextEncoder();
  var stream = new ReadableStream({
    async start(controller) {
      function send(obj) {
        try { controller.enqueue(enc.encode("data: " + JSON.stringify(obj) + "\n\n")); } catch (e) {}
      }
      try {
        var allMsgs = [{ role: "system", content: systemPrompt }].concat(messages);
        var resp = await fetch(mc.baseUrl + "/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + mc.apiKey },
          body: JSON.stringify({ model: model, messages: allMsgs, temperature: 0.6, max_tokens: 4096, stream: true })
        });
        if (!resp.ok) {
          var errText = await resp.text().catch(function () { return ""; });
          send({ type: "error", error: "LLM API " + resp.status + ": " + errText.slice(0, 200) });
          send({ type: "done" });
          controller.close();
          return;
        }
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buf = "";
        var fullText = "";
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buf += decoder.decode(chunk.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop() || "";
          for (var li = 0; li < lines.length; li++) {
            var line = lines[li].trim();
            if (!line || !line.startsWith("data:")) continue;
            var payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              var parsed = JSON.parse(payload);
              var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
              if (delta && delta.content) {
                fullText += delta.content;
                send({ type: "text", text: delta.content });
              }
            } catch (e) {}
          }
        }
        send({ type: "done", fullText: fullText });
      } catch (e) {
        send({ type: "error", error: e && e.message ? e.message : "Stream failed" });
        send({ type: "done" });
      }
      controller.close();
    }
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
}

var _tutorActionHints = {
  tutorExplain: { zh: "请讲解这道题，引导我理解解题思路。", en: "Please explain this problem and guide me through the solution." },
  tutorHint: { zh: "给我一个提示，帮我自己想出答案。", en: "Give me a hint to help me figure it out myself." },
  tutorRephrase: { zh: "能换种方式讲解吗？我没太理解。", en: "Can you explain it differently? I didn't quite understand." },
  tutorExample: { zh: "能举一个类似的例子帮我理解吗？", en: "Can you give me a similar example to help me understand?" },
  tutorFullAnswer: { zh: "请直接告诉我完整的解答过程和答案。", en: "Please give me the full solution and answer directly." },
  tutorVariant: { zh: "能出一道类似的题让我练习吗？", en: "Can you give me a similar problem to practice?" }
};

async function _doTutorStream(body, h, actionKey) {
  var T = _resolveTutor();
  if (!T) return _jsonErr("tutor_unavailable", "Tutoring session module not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId, psid = body.problemSetId;
  if (!pid || !wid || !psid) return _jsonErr("missing_params", "profileId, worldId, problemSetId required", 400, h);

  var set = global.__SOCRATOPIA_SET__ || {};
  var mc = set.strong || set.kb || set.weak || null;
  if (!mc || !mc.baseUrl) return _jsonErr("no_llm", "No LLM config available", 400, h);
  var apiKey = body.apiKey || mc.apiKey || "";
  if (!apiKey) return _jsonErr("no_llm", "No API key available", 400, h);
  var model = body.model || mc.model;
  if (!model) return _jsonErr("no_llm", "No model configured", 400, h);

  // Ensure session exists
  var sess = T.readTutoringSession(pid, wid, psid);
  if (!sess) {
    sess = T.defaultSession(psid);
    if (body.companionId) { sess.companionId = body.companionId; sess.companionName = body.companionName || null; }
    if (body.context) { sess.context = body.context; if (body.context.problemId) sess.activeProblemId = body.context.problemId; }
    T.writeTutoringSession(pid, wid, sess);
  }
  // Update context if provided
  if (body.context && typeof body.context === "object") {
    T.updateContext(pid, wid, psid, body.context);
    sess = T.readTutoringSession(pid, wid, psid);
  }

  var zh = !(body.teachingLanguage && body.teachingLanguage.indexOf("english") >= 0);
  var userContent = body.message || body.content || "";
  var hint = _tutorActionHints[actionKey];
  var actionHintText = hint ? (zh ? hint.zh : hint.en) : "";

  // For tutorFullAnswer, override the system prompt to allow giving the full answer
  var sysPrompt = _buildTutorSystemPrompt(sess, body);
  if (actionKey === "tutorFullAnswer") {
    sysPrompt += zh ? "\n\n学生明确要求了完整答案,请给出详细的解题过程和最终答案。" : "\n\nThe student has explicitly asked for the full answer. Provide a detailed solution process and final answer.";
  }
  if (actionKey === "tutorVariant") {
    sysPrompt += zh ? "\n\n学生要求出一道变式题。请出一道相似知识点但不同情境/数值的题目,给出题面,先不给答案,等学生作答。" : "\n\nThe student wants a variant problem. Create a similar problem with different context/values. Present the problem only, wait for the student to answer.";
  }

  // Append user message to session
  var finalUserContent = userContent || actionHintText;
  if (finalUserContent) {
    T.appendMessage(pid, wid, psid, { role: "user", content: finalUserContent, metadata: { action: actionKey } });
    sess = T.readTutoringSession(pid, wid, psid);
  }

  var llmMessages = _buildTutorMessages(sess, null, null);
  // Stream the response
  var streamResp = _streamingTutorResponse({ baseUrl: mc.baseUrl, apiKey: apiKey }, model, sysPrompt, llmMessages);

  // We need to capture the full text to save it. Use a wrapper stream.
  var origStream = streamResp.body;
  var fullText = "";
  var passEnc = new TextEncoder();
  var wrapStream = new ReadableStream({
    async start(ctrl) {
      var reader = origStream.getReader();
      var dec = new TextDecoder();
      try {
        while (true) {
          var r = await reader.read();
          if (r.done) break;
          ctrl.enqueue(r.value);
          // Parse for fullText capture
          var chunk = dec.decode(r.value, { stream: true });
          var clines = chunk.split("\n");
          for (var ci = 0; ci < clines.length; ci++) {
            var cl = clines[ci].trim();
            if (!cl.startsWith("data:")) continue;
            try {
              var cp = JSON.parse(cl.slice(5).trim());
              if (cp.type === "text" && cp.text) fullText += cp.text;
              if (cp.type === "done" && cp.fullText) fullText = cp.fullText;
            } catch (e) {}
          }
        }
      } catch (e) {}
      // Save assistant message after stream ends
      if (fullText) {
        try { T.appendMessage(pid, wid, psid, { role: "assistant", content: fullText, metadata: { action: actionKey } }); } catch (e) {}
        try {
          var P = global.__PRACTICE__;
          if (P && typeof P.savePracticeRecord === "function") {
            var latest = T.readTutoringSession(pid, wid, psid);
            P.savePracticeRecord(pid, wid, {
              problemSetId: psid,
              status: "tutoring",
              tutoringStartedAt: new Date().toISOString(),
              companionId: sess.companionId || body.companionId || null,
              companionName: sess.companionName || body.companionName || null,
              messageCount: latest && Array.isArray(latest.messages) ? latest.messages.length : undefined,
              tutoringSessionId: psid
            });
          }
        } catch (e) {}
      }
      ctrl.close();
    }
  });

  return new Response(wrapStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
}

async function _doTutorFreeChat(body, h) {
  return _doTutorStream(body, h, "tutorFreeChat");
}

// --- Management actions (non-streaming) ---

async function _doGetTutoringSession(body, h) {
  var T = _resolveTutor();
  if (!T) return _jsonErr("tutor_unavailable", "Tutoring session module not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId, psid = body.problemSetId;
  if (!pid || !wid || !psid) return _jsonErr("missing_params", "profileId, worldId, problemSetId required", 400, h);
  var sess = T.readTutoringSession(pid, wid, psid);
  return v.NextResponse.json({ session: sess }, { headers: h });
}

async function _doListTutoringSessions(body, h) {
  var T = _resolveTutor();
  if (!T) return _jsonErr("tutor_unavailable", "Tutoring session module not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId;
  if (!pid || !wid) return _jsonErr("missing_params", "profileId and worldId required", 400, h);
  var list = T.listTutoringSessions(pid, wid);
  return v.NextResponse.json({ sessions: list }, { headers: h });
}

async function _doDeleteTutoringSession(body, h) {
  var T = _resolveTutor();
  if (!T) return _jsonErr("tutor_unavailable", "Tutoring session module not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId, psid = body.problemSetId;
  if (!pid || !wid || !psid) return _jsonErr("missing_params", "profileId, worldId, problemSetId required", 400, h);
  var ok = T.deleteTutoringSession(pid, wid, psid);
  return v.NextResponse.json({ deleted: ok }, { headers: h });
}

async function _doSetTutoringCompanion(body, h) {
  var T = _resolveTutor();
  if (!T) return _jsonErr("tutor_unavailable", "Tutoring session module not loaded", 500, h);
  var pid = body.profileId, wid = body.worldId, psid = body.problemSetId;
  if (!pid || !wid || !psid) return _jsonErr("missing_params", "profileId, worldId, problemSetId required", 400, h);
  var cid = body.companionId || null, cname = body.companionName || null;
  if (!cid) return _jsonErr("missing_params", "companionId required", 400, h);
  var sess = T.setCompanion(pid, wid, psid, cid, cname);
  return v.NextResponse.json({ session: sess }, { headers: h });
}

async function wGET(a) {
  var h = { "Cache-Control": "private, no-store" };
  try {
    var u = a.nextUrl ? a.nextUrl : new URL(a.url || "");
    var sp = u.searchParams;
    var action = sp.get("action") || "listProblemSets";
    var pid = sp.get("profileId") || "", wid = sp.get("worldId") || "";
    var P = global.__PRACTICE__;
    if (!P) return _jsonErr("practice_unavailable", "practice data layer not loaded", 500, h);
    if (!pid || !wid) return _jsonErr("missing_params", "profileId and worldId required", 400, h);
    if (action === "getProblemSet") {
      var psid = sp.get("problemSetId") || "";
      if (!psid) return _jsonErr("missing_params", "problemSetId required", 400, h);
      var ps = P.readProblemSet(pid, wid, psid);
      if (!ps) return _jsonErr("not_found", "ProblemSet not found", 404, h);
      return v.NextResponse.json({ problemSet: ps }, { headers: h });
    }
    if (action === "listMistakes") {
      var mistakes = P.readMistakes(pid, wid, {
        textbookId: sp.get("textbookId") || undefined,
        knowledgePoint: sp.get("knowledgePoint") || undefined,
        reviewDue: sp.get("reviewDue") === "true",
        includeMastered: sp.get("includeMastered") === "true"
      });
      return v.NextResponse.json({ mistakes: mistakes }, { headers: h });
    }
    if (action === "getTutoringSession") {
      var T = _resolveTutor();
      if (!T) return _jsonErr("tutor_unavailable", "Tutoring session module not loaded", 500, h);
      var tpsid = sp.get("problemSetId") || "";
      if (!tpsid) return _jsonErr("missing_params", "problemSetId required", 400, h);
      var tsess = T.readTutoringSession(pid, wid, tpsid);
      return v.NextResponse.json({ session: tsess }, { headers: h });
    }
    if (action === "listTutoringSessions") {
      var T2 = _resolveTutor();
      if (!T2) return _jsonErr("tutor_unavailable", "Tutoring session module not loaded", 500, h);
      var tlist = T2.listTutoringSessions(pid, wid);
      return v.NextResponse.json({ sessions: tlist }, { headers: h });
    }
    if (action === "listPracticeRecords") {
      return v.NextResponse.json({ records: P.listPracticeRecords(pid, wid) }, { headers: h });
    }
    // default: list problem sets
    return v.NextResponse.json({ problemSets: P.listProblemSets(pid, wid) }, { headers: h });
  } catch (e) {
    return _jsonErr("get_failed", e && e.message, 500, h);
  }
}

async function wPOST(a) {
  var h = { "Cache-Control": "private, no-store" };
  var b = {};
  try { b = await a.json(); } catch (e) { return _jsonErr("invalid_json", "Request body must be valid JSON", 400, h); }
  var action = b.action || "";
  try {
    if (action === "generate") return await _doGenerate(b, h);
    if (action === "grade") return await _doGrade(b, h);
    if (action === "hint") return await _doHint(b, h);
    if (action === "explain") return await _doExplain(b, h);
    if (action === "variant") return await _doVariant(b, h);
    if (action === "saveMistake") return await _doSaveMistake(b, h);
    if (action === "listMistakes") return await _doListMistakes(b, h);
    if (action === "savePracticeRecord") return await _doSavePracticeRecord(b, h);
    if (action === "listPracticeRecords") return await _doListPracticeRecords(b, h);
    if (action === "tutorExplain") return await _doTutorStream(b, h, "tutorExplain");
    if (action === "tutorHint") return await _doTutorStream(b, h, "tutorHint");
    if (action === "tutorRephrase") return await _doTutorStream(b, h, "tutorRephrase");
    if (action === "tutorExample") return await _doTutorStream(b, h, "tutorExample");
    if (action === "tutorFullAnswer") return await _doTutorStream(b, h, "tutorFullAnswer");
    if (action === "tutorVariant") return await _doTutorStream(b, h, "tutorVariant");
    if (action === "tutorFreeChat") return await _doTutorFreeChat(b, h);
    if (action === "getTutoringSession") return await _doGetTutoringSession(b, h);
    if (action === "listTutoringSessions") return await _doListTutoringSessions(b, h);
    if (action === "deleteTutoringSession") return await _doDeleteTutoringSession(b, h);
    if (action === "setTutoringCompanion") return await _doSetTutoringCompanion(b, h);
    return _jsonErr("unknown_action", "Unknown action: " + action, 400, h);
  } catch (e) {
    return _jsonErr("practice_failed", e && e.message, 500, h);
  }
}let x=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/practice/route",pathname:"/api/practice",filename:"route",bundlePath:"app/api/practice/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/leminwu/Documents/Github/socralab-app/v2/src/app/api/practice/route.ts",nextConfigOutput:"standalone",userland:d}),{workAsyncStorage:y,workUnitAsyncStorage:z,serverHooks:A}=x;function B(){return(0,g.patchFetch)({workAsyncStorage:y,workUnitAsyncStorage:z})}async function C(a,b,c){x.isDev&&(0,h.addRequestMeta)(a,"devRequestTimingInternalsEnd",process.hrtime.bigint());let d="/api/practice/route";"/index"===d&&(d="/");let e=await x.prepare(a,b,{srcPage:d,multiZoneDraftMode:!1});if(!e)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:g,params:v,nextConfig:w,parsedUrl:y,isDraftMode:z,prerenderManifest:A,routerServerContext:B,isOnDemandRevalidate:C,revalidateOnlyGenerated:D,resolvedPathname:E,clientReferenceManifest:F,serverActionsManifest:G}=e,H=(0,k.normalizeAppPath)(d),I=!!(A.dynamicRoutes[H]||A.routes[E]),J=async()=>((null==B?void 0:B.render404)?await B.render404(a,b,y,!1):b.end("This page could not be found"),null);if(I&&!z){let a=!!A.routes[E],b=A.dynamicRoutes[H];if(b&&!1===b.fallback&&!a){if(w.experimental.adapterPath)return await J();throw new t.NoFallbackError}}let K=null;!I||x.isDev||z||(K="/index"===(K=E)?"/":K);let L=!0===x.isDev||!I,M=I&&!L;G&&F&&(0,j.setManifestsSingleton)({page:d,clientReferenceManifest:F,serverActionsManifest:G});let N=a.method||"GET",O=(0,i.getTracer)(),P=O.getActiveScopeSpan(),Q={params:v,prerenderManifest:A,renderOpts:{experimental:{authInterrupts:!!w.experimental.authInterrupts},cacheComponents:!!w.cacheComponents,supportsDynamicResponse:L,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:w.cacheLife,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d,e)=>x.onRequestError(a,b,d,e,B)},sharedContext:{buildId:g}},R=new l.NodeNextRequest(a),S=new l.NodeNextResponse(b),T=m.NextRequestAdapter.fromNodeNextRequest(R,(0,m.signalFromNodeResponse)(b));try{let e=async a=>x.handle(T,Q).finally(()=>{if(!a)return;a.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let c=O.getRootSpanAttributes();if(!c)return;if(c.get("next.span_type")!==n.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${c.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=c.get("next.route");if(e){let b=`${N} ${e}`;a.setAttributes({"next.route":e,"http.route":e,"next.span_name":b}),a.updateName(b)}else a.updateName(`${N} ${d}`)}),g=!!(0,h.getRequestMeta)(a,"minimalMode"),j=async h=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!g&&C&&D&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let d=await e(h);a.fetchMetrics=Q.renderOpts.fetchMetrics;let i=Q.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=Q.renderOpts.collectedTags;if(!I)return await (0,p.I)(R,S,d,Q.renderOpts.pendingWaitUntil),null;{let a=await d.blob(),b=(0,q.toNodeOutgoingHttpHeaders)(d.headers);j&&(b[s.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==Q.renderOpts.collectedRevalidate&&!(Q.renderOpts.collectedRevalidate>=s.INFINITE_CACHE)&&Q.renderOpts.collectedRevalidate,e=void 0===Q.renderOpts.collectedExpire||Q.renderOpts.collectedExpire>=s.INFINITE_CACHE?void 0:Q.renderOpts.collectedExpire;return{value:{kind:u.CachedRouteKind.APP_ROUTE,status:d.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:e}}}}catch(b){throw(null==f?void 0:f.isStale)&&await x.onRequestError(a,b,{routerKind:"App Router",routePath:d,routeType:"route",revalidateReason:(0,o.c)({isStaticGeneration:M,isOnDemandRevalidate:C})},!1,B),b}},l=await x.handleResponse({req:a,nextConfig:w,cacheKey:K,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:A,isRoutePPREnabled:!1,isOnDemandRevalidate:C,revalidateOnlyGenerated:D,responseGenerator:k,waitUntil:c.waitUntil,isMinimalMode:g});if(!I)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==u.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});g||b.setHeader("x-nextjs-cache",C?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),z&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,q.fromNodeOutgoingHttpHeaders)(l.value.headers);return g&&I||m.delete(s.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,r.getCacheControlHeader)(l.cacheControl)),await (0,p.I)(R,S,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};P?await j(P):await O.withPropagatedContext(a.headers,()=>O.trace(n.BaseServerSpan.handleRequest,{spanName:`${N} ${d}`,kind:i.SpanKind.SERVER,attributes:{"http.method":N,"http.target":a.url}},j))}catch(b){if(b instanceof t.NoFallbackError||await x.onRequestError(a,b,{routerKind:"App Router",routePath:H,routeType:"route",revalidateReason:(0,o.c)({isStaticGeneration:M,isOnDemandRevalidate:C})},!1,B),I)throw b;return await (0,p.I)(R,S,new Response(null,{status:500})),null}}},44870:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},63033:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},78335:()=>{},86439:a=>{"use strict";a.exports=require("next/dist/shared/lib/no-fallback-error.external")},96487:()=>{}};var b=require("../../../webpack-runtime.js");b.C(a);var c=b.X(0,[3445,1813],()=>b(b.s=59006));module.exports=c})();
