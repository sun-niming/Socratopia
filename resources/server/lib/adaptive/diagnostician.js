/**
 * Diagnostician
 *
 * Structured diagnosis agent for the adaptive teaching mode.
 * Analyzes user input against ConceptGraph and LearnerModel to produce
 * structured Diagnosis documents. Supports both dry-run (rule-based) and
 * LLM-powered diagnosis paths.
 *
 * Exports:
 *   diagnose(input, callLLM?)
 *   buildDiagnosisPrompt(input)
 *   normalizeDiagnosis(raw, context)
 *   validateDiagnosis(diagnosis, conceptGraph?)
 *   extractDiagnosisJson(text)
 *   makeFallbackDiagnosis(input, reason)
 *
 * CommonJS module — loaded by the API route or standalone smoke test.
 */
"use strict";

var crypto = require("crypto");

// ========== Helpers ==========

function genDiagnosisId() {
  return "diag_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex");
}

function isObject(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }

function isNonEmptyString(x) { return typeof x === "string" && x.trim().length > 0; }

function toNumber(x, fallback) { var n = Number(x); return isNaN(n) ? fallback : n; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Number(v) || lo)); }

// ========== Data loading helpers ==========

function getAdaptive() {
  if (typeof global !== "undefined" && global.__ADAPTIVE__) return global.__ADAPTIVE__;
  try { return require("./data-layer.js"); } catch (e) { return null; }
}

function resolveConceptGraph(input) {
  if (input.conceptGraph && isObject(input.conceptGraph) && Array.isArray(input.conceptGraph.concepts)) {
    return input.conceptGraph;
  }
  var ad = getAdaptive();
  if (ad && ad.getConceptGraph && input.profileId && input.worldId && input.textbookId) {
    return ad.getConceptGraph(input.profileId, input.worldId, input.textbookId);
  }
  return null;
}

function resolveLearnerModel(input) {
  if (input.learnerModel && isObject(input.learnerModel) && isObject(input.learnerModel.conceptMastery)) {
    return input.learnerModel;
  }
  var ad = getAdaptive();
  if (ad && ad.loadLearnerModel && input.profileId && input.worldId) {
    try { return ad.loadLearnerModel(input.profileId, input.worldId); } catch (e) { return null; }
  }
  return null;
}

function resolveRecentTurns(input) {
  if (Array.isArray(input.recentTurns)) return input.recentTurns;
  if (!input.sessionId) return [];
  var ad = getAdaptive();
  if (ad && ad.getTeachingEvents) {
    try { return ad.getTeachingEvents(input.sessionId, 5); } catch (e) { return []; }
  }
  return [];
}

function resolveActiveConceptIds(input, conceptGraph) {
  if (Array.isArray(input.activeConceptIds) && input.activeConceptIds.length > 0) {
    return input.activeConceptIds.filter(function (id) { return typeof id === "string"; });
  }
  // Infer from session
  if (input.sessionId) {
    var ad = getAdaptive();
    if (ad && ad.getTeachingSession) {
      try {
        var sess = ad.getTeachingSession(input.sessionId);
        if (sess && Array.isArray(sess.activeConceptIds) && sess.activeConceptIds.length > 0) {
          return sess.activeConceptIds;
        }
      } catch (e) {}
    }
  }
  // Fallback: first 3 concepts from ConceptGraph
  if (conceptGraph && Array.isArray(conceptGraph.concepts) && conceptGraph.concepts.length > 0) {
    return conceptGraph.concepts.slice(0, 3).map(function (c) { return c.conceptId; });
  }
  return [];
}

// ========== Keyword matching ==========

var STRUGGLE_KEYWORDS = [
  "不懂", "不会", "不知道", "看不懂", "不理解", "不明白",
  "太难", "搞不懂", "弄不清", "毫无头绪", "没学过",
  "don't understand", "don't know", "can't", "no idea",
  "not sure", "confused", "difficult", "hard to"
];

var QUESTION_KEYWORDS = [
  "什么是", "什么叫", "解释", "请说明", "什么意思",
  "what is", "explain", "define", "tell me about",
  "如何", "怎么", "怎样", "how to", "how do"
];

function extractConceptTerms(text) {
  if (!isNonEmptyString(text)) return [];
  var lower = text.toLowerCase();
  var terms = [];

  // Extract potential concept terms (Chinese: 2-8 chars, English: 1-4 words)
  // Chinese noun phrases
  var zhRe = /[\u4e00-\u9fff]{2,8}/g;
  var m;
  while ((m = zhRe.exec(text)) !== null) {
    var t = m[0].trim();
    if (t.length >= 2 && terms.indexOf(t) < 0) terms.push(t);
  }

  // English words / phrases (2+ chars, not stopwords)
  var enStopwords = { "the":1, "is":1, "are":1, "a":1, "an":1, "of":1, "to":1, "in":1, "it":1, "and":1, "or":1, "not":1, "but":1, "for":1, "on":1, "at":1, "with":1, "this":1, "that":1, "was":1, "were":1, "be":1, "has":1, "have":1, "do":1, "does":1, "can":1, "will":1, "would":1, "should":1, "could":1, "may":1, "i":1, "you":1, "he":1, "she":1, "we":1, "they":1, "me":1, "him":1, "her":1, "us":1, "them":1, "my":1, "your":1, "his":1, "our":1, "their":1, "what":1, "how":1, "why":1, "when":1, "where":1, "which":1, "who":1 };
  var enRe = /[A-Za-z]{2,}/g;
  while ((m = enRe.exec(text)) !== null) {
    var w = m[0].toLowerCase();
    if (!enStopwords[w] && w.length >= 2 && terms.indexOf(w) < 0) terms.push(w);
  }

  return terms;
}

function matchConcepts(terms, conceptGraph) {
  if (!conceptGraph || !Array.isArray(conceptGraph.concepts)) return [];
  var matches = [];

  for (var i = 0; i < conceptGraph.concepts.length; i++) {
    var c = conceptGraph.concepts[i];
    var score = 0;
    var evidence = "";

    // Match against title
    for (var t = 0; t < terms.length; t++) {
      var term = terms[t];
      var titleLower = (c.title || "").toLowerCase();
      if (titleLower.indexOf(term) >= 0) {
        score = Math.max(score, 0.9);
        if (!evidence) evidence = "用户提到了 '" + term + "'，匹配概念 '" + c.title + "'";
      }
      // Match against aliases
      if (Array.isArray(c.aliases)) {
        for (var a = 0; a < c.aliases.length; a++) {
          var aliasLower = (c.aliases[a] || "").toLowerCase();
          if (aliasLower.indexOf(term) >= 0 || term.indexOf(aliasLower) >= 0) {
            score = Math.max(score, 0.8);
            if (!evidence) evidence = "用户提到了 '" + term + "'，匹配别名 '" + c.aliases[a] + "'";
          }
        }
      }
      // Match against description
      var descLower = (c.description || "").toLowerCase();
      if (term.length >= 3 && descLower.indexOf(term) >= 0) {
        score = Math.max(score, 0.5);
        if (!evidence) evidence = "用户提到了 '" + term + "'，与概念 '" + c.title + "' 的描述相关";
      }
      // Match against question text
      if (Array.isArray(c.questions)) {
        for (var q = 0; q < c.questions.length; q++) {
          var qLower = (c.questions[q].question || "").toLowerCase();
          if (term.length >= 3 && qLower.indexOf(term) >= 0) {
            score = Math.max(score, 0.4);
            if (!evidence) evidence = "用户提到了 '" + term + "'，可能与诊断题相关";
          }
        }
      }
    }

    if (score > 0) {
      matches.push({
        conceptId: c.conceptId,
        title: c.title,
        relevance: Math.round(score * 10) / 10,
        evidence: evidence
      });
    }
  }

  // Sort by relevance descending, keep top 5
  matches.sort(function (a, b) { return b.relevance - a.relevance; });
  return matches.slice(0, 5);
}

function hasStruggleSignal(text) {
  if (!isNonEmptyString(text)) return false;
  var lower = text.toLowerCase();
  for (var i = 0; i < STRUGGLE_KEYWORDS.length; i++) {
    if (lower.indexOf(STRUGGLE_KEYWORDS[i]) >= 0) return true;
  }
  // Also check for "?" or "？" indicating a question
  if (text.indexOf("?") >= 0 || text.indexOf("？") >= 0) return true;
  return false;
}

function hasQuestionSignal(text) {
  if (!isNonEmptyString(text)) return false;
  var lower = text.toLowerCase();
  for (var i = 0; i < QUESTION_KEYWORDS.length; i++) {
    if (lower.indexOf(QUESTION_KEYWORDS[i]) >= 0) return true;
  }
  return false;
}

// ========== Dry-run (rule-based) diagnosis ==========

function runDryRunDiagnosis(input, conceptGraph, learnerModel) {
  var now = new Date().toISOString();
  var userMessage = (input.userMessage || "").trim();
  var diagnosisId = genDiagnosisId();

  // Extract terms and match concepts
  var terms = extractConceptTerms(userMessage);
  var relatedConcepts = matchConcepts(terms, conceptGraph);

  // Build conceptId set for reference validation
  var conceptIdSet = {};
  if (conceptGraph && Array.isArray(conceptGraph.concepts)) {
    for (var i = 0; i < conceptGraph.concepts.length; i++) {
      conceptIdSet[conceptGraph.concepts[i].conceptId] = conceptGraph.concepts[i];
    }
  }

  // Determine understanding level
  var level = "unknown";
  var errorType = "unknown";
  var summary = "";
  var evidence = [];
  var confidence = 0.3;

  if (userMessage.length === 0) {
    level = "no_attempt";
    errorType = "insufficient_evidence";
    summary = "学生未提供任何输入，无法判断理解状态。";
    confidence = 0.95;
  } else if (userMessage.length < 4) {
    level = "no_attempt";
    errorType = "insufficient_evidence";
    summary = "学生输入过短（'" + userMessage + "'），不足以评估理解水平。";
    evidence.push("输入长度 " + userMessage.length + " 字符");
    confidence = 0.9;
  } else if (hasStruggleSignal(userMessage) && relatedConcepts.length > 0) {
    // Student is struggling with a known concept
    level = "misconception";
    errorType = "concept_misunderstanding";
    summary = "学生在 '" + relatedConcepts[0].title + "' 相关话题上表达了困惑。";
    evidence.push("用户表达困惑: '" + userMessage.slice(0, 100) + "'");
    evidence.push("匹配到概念: " + relatedConcepts.map(function (r) { return r.title; }).join(", "));
    confidence = 0.4;
  } else if (hasQuestionSignal(userMessage) && relatedConcepts.length > 0) {
    level = "partial";
    errorType = "none";
    summary = "学生正在询问关于 '" + relatedConcepts[0].title + "' 的问题，可能有部分理解。";
    evidence.push("用户提问: '" + userMessage.slice(0, 100) + "'");
    confidence = 0.3;
  } else if (relatedConcepts.length > 0) {
    level = "unknown";
    errorType = "none";
    summary = "学生提到了 '" + relatedConcepts[0].title + "' 但未明确表达理解或困惑。";
    evidence.push("用户提及: '" + userMessage.slice(0, 100) + "'");
    confidence = 0.2;
  } else {
    // No concept match
    if (hasStruggleSignal(userMessage) || hasQuestionSignal(userMessage)) {
      level = "unknown";
      errorType = "off_topic";
      summary = "学生的问题可能与当前课程内容无关，或当前知识图谱中无匹配概念。";
      evidence.push("用户输入未匹配到任何概念: '" + userMessage.slice(0, 100) + "'");
      confidence = 0.35;
    } else {
      level = "unknown";
      errorType = "unknown";
      summary = "无法从当前输入判断学生的理解状态和关联概念。";
      evidence.push("输入: '" + userMessage.slice(0, 100) + "'");
      confidence = 0.2;
    }
  }

  // Build prerequisite gaps from learnerModel
  var prerequisiteGaps = [];
  if (learnerModel && isObject(learnerModel.conceptMastery)) {
    for (var r = 0; r < relatedConcepts.length; r++) {
      var rid = relatedConcepts[r].conceptId;
      var cm = learnerModel.conceptMastery[rid];
      if (cm && typeof cm.score === "number" && cm.score < 0.5) {
        prerequisiteGaps.push({
          conceptId: rid,
          title: conceptIdSet[rid] ? conceptIdSet[rid].title : rid,
          reason: "学生对该概念的掌握程度较低 (score " + cm.score.toFixed(2) + ")",
          severity: cm.score < 0.3 ? 3 : cm.score < 0.5 ? 2 : 1
        });
      }
    }
    // Also check prerequisites of matched concepts
    for (var r2 = 0; r2 < relatedConcepts.length; r2++) {
      var cObj = conceptIdSet[relatedConcepts[r2].conceptId];
      if (cObj && Array.isArray(cObj.prerequisites)) {
        for (var p = 0; p < cObj.prerequisites.length; p++) {
          var pid = cObj.prerequisites[p];
          var pcm = learnerModel.conceptMastery[pid];
          if (pcm && typeof pcm.score === "number" && pcm.score < 0.5) {
            // Check not already added
            var alreadyAdded = false;
            for (var g = 0; g < prerequisiteGaps.length; g++) {
              if (prerequisiteGaps[g].conceptId === pid) { alreadyAdded = true; break; }
            }
            if (!alreadyAdded) {
              prerequisiteGaps.push({
                conceptId: pid,
                title: conceptIdSet[pid] ? conceptIdSet[pid].title : pid,
                reason: "这是 '" + (cObj.title || rid) + "' 的前置概念，学生掌握不足 (score " + pcm.score.toFixed(2) + ")",
                severity: pcm.score < 0.3 ? 3 : pcm.score < 0.5 ? 2 : 1
              });
            }
          }
        }
      }
    }
  }

  // Sort prerequisiteGaps by severity descending
  prerequisiteGaps.sort(function (a, b) { return b.severity - a.severity; });

  // Determine suggestedFocus
  var suggestedFocus = null;
  if (relatedConcepts.length > 0) {
    // Prefer the first concept that has a prerequisite gap
    var focusConcept = relatedConcepts[0];
    for (var g2 = 0; g2 < prerequisiteGaps.length; g2++) {
      if (prerequisiteGaps[g2].conceptId === focusConcept.conceptId) {
        // Focus on the prerequisite instead
        var gapObj = conceptIdSet[prerequisiteGaps[g2].conceptId];
        if (gapObj) {
          suggestedFocus = {
            conceptId: prerequisiteGaps[g2].conceptId,
            reason: "建议先解决前置概念 '" + (gapObj.title || "") + "' 的掌握不足"
          };
        }
        break;
      }
    }
    if (!suggestedFocus) {
      suggestedFocus = {
        conceptId: focusConcept.conceptId,
        reason: "学生当前最相关的概念，建议进一步诊断"
      };
    }
  }

  // Collect candidate question IDs from related concepts
  var candidateQuestionIds = [];
  for (var r3 = 0; r3 < relatedConcepts.length && candidateQuestionIds.length < 3; r3++) {
    var rcId = relatedConcepts[r3].conceptId;
    var rcObj = conceptIdSet[rcId];
    if (rcObj && Array.isArray(rcObj.questions)) {
      for (var q = 0; q < rcObj.questions.length && candidateQuestionIds.length < 3; q++) {
        candidateQuestionIds.push(rcObj.questions[q].questionId);
      }
    }
  }

  // Determine assessment need
  var assessmentNeed = {
    shouldAskQuestion: candidateQuestionIds.length > 0 && (level === "misconception" || level === "partial" || level === "unknown"),
    reason: candidateQuestionIds.length > 0
      ? "有候选诊断题可以验证学生对相关概念的理解"
      : "当前无匹配的诊断题目",
    candidateQuestionIds: candidateQuestionIds
  };

  // Affective signal from learnerModel
  var affectiveSignal = {
    confidence: 0.5,
    frustration: 0.0,
    engagement: 0.5,
    evidence: ""
  };
  if (learnerModel && isObject(learnerModel.affectiveState)) {
    var as = learnerModel.affectiveState;
    affectiveSignal.confidence = typeof as.confidence === "number" ? clamp(as.confidence, 0, 1) : 0.5;
    affectiveSignal.frustration = typeof as.frustration === "number" ? clamp(as.frustration, 0, 1) : 0.0;
    affectiveSignal.engagement = typeof as.engagement === "number" ? clamp(as.engagement, 0, 1) : 0.5;
    affectiveSignal.evidence = "基于学习者模型中的情感状态";
  }

  return {
    type: "diagnosis",
    diagnosisId: diagnosisId,
    profileId: input.profileId || "",
    worldId: input.worldId || "",
    textbookId: input.textbookId || "",
    sessionId: input.sessionId || "",
    timestamp: now,
    relatedConcepts: relatedConcepts,
    prerequisiteGaps: prerequisiteGaps,
    understanding: {
      level: level,
      confidence: confidence,
      summary: summary
    },
    errorType: errorType,
    evidence: evidence,
    suggestedFocus: suggestedFocus,
    assessmentNeed: assessmentNeed,
    affectiveSignal: affectiveSignal,
    rawModelNotes: "dryRun rule-based diagnosis"
  };
}

// ========== LLM integration ==========

function buildDiagnosisPrompt(input) {
  var lang = input.teachingLanguage || "zh";
  var useChinese = lang.indexOf("zh") === 0 || lang.indexOf("cn") >= 0;

  var systemPrompt = useChinese
    ? "你是一个专业的教学诊断代理。你的职责是根据学生输入、对话上下文、知识图谱和学习者模型，输出结构化的诊断结果。\n\n重要原则：\n- 不要编造学生没说过或没表现出的错误。\n- 证据不足时，明确标记为 insufficient_evidence，confidence 不超过 0.4。\n- relatedConcepts 中的 conceptId 必须来自提供的概念列表，不要自行编造。\n- prerequisiteGaps 中的 conceptId 也必须来自概念列表或前置关系。\n- suggestedFocus 的 conceptId 必须是已有概念 ID 或 null。\n- 严格只输出 JSON，不要加任何 markdown 代码块标记，不要加任何额外文字说明。"
    : "You are a professional teaching diagnostic agent. Your job is to produce structured diagnosis based on student input, conversation context, knowledge graph, and learner model.\n\nKey principles:\n- Do not invent errors the student has not demonstrated.\n- When evidence is insufficient, explicitly mark as insufficient_evidence with confidence <= 0.4.\n- relatedConcepts conceptIds must come from the provided concept list; do not fabricate.\n- prerequisiteGaps conceptIds must also come from the concept list or prerequisite relationships.\n- suggestedFocus conceptId must be an existing concept ID or null.\n- Output strictly JSON only — no markdown code fences, no extra text.";

  var userPrompt = "";

  // 1. Student message
  userPrompt += (useChinese ? "## 学生消息\n" : "## Student Message\n");
  userPrompt += (input.userMessage || "(empty)") + "\n\n";

  // 2. Recent turns summary
  var recentTurns = input.recentTurns || [];
  if (recentTurns.length > 0) {
    userPrompt += (useChinese ? "## 近期对话上下文\n" : "## Recent Context\n");
    for (var i = 0; i < Math.min(recentTurns.length, 5); i++) {
      var turn = recentTurns[i];
      if (turn && isObject(turn)) {
        var summary = turn.type + ": " + (turn.userMessage || turn.question || turn.tutorReply || "").slice(0, 150);
        userPrompt += "- " + summary + "\n";
      }
    }
    userPrompt += "\n";
  }

  // 3. Active / related concepts (compact)
  var conceptGraph = input.conceptGraph;
  var activeConceptIds = input.activeConceptIds || [];
  var allRelevantIds = {};
  if (activeConceptIds.length > 0) {
    for (var a = 0; a < activeConceptIds.length; a++) allRelevantIds[activeConceptIds[a]] = true;
  }
  // Also include first 3 concepts from graph as context
  if (conceptGraph && Array.isArray(conceptGraph.concepts)) {
    for (var c = 0; c < Math.min(conceptGraph.concepts.length, 5); c++) {
      allRelevantIds[conceptGraph.concepts[c].conceptId] = true;
    }
  }

  if (conceptGraph && Array.isArray(conceptGraph.concepts) && Object.keys(allRelevantIds).length > 0) {
    userPrompt += (useChinese ? "## 相关概念\n" : "## Relevant Concepts\n");
    for (var c2 = 0; c2 < conceptGraph.concepts.length; c2++) {
      var concept = conceptGraph.concepts[c2];
      if (!allRelevantIds[concept.conceptId] && Object.keys(allRelevantIds).length > 5) continue;
      userPrompt += "- " + concept.conceptId + ": " + (concept.title || "") + "\n";
      if (concept.description) userPrompt += "  " + (concept.description || "").slice(0, 200) + "\n";
      if (Array.isArray(concept.prerequisites) && concept.prerequisites.length > 0) {
        userPrompt += "  prerequisites: " + concept.prerequisites.join(", ") + "\n";
      }
      if (Array.isArray(concept.questions) && concept.questions.length > 0) {
        userPrompt += (useChinese ? "  候选诊断题:\n" : "  Candidate questions:\n");
        for (var q = 0; q < Math.min(concept.questions.length, 2); q++) {
          userPrompt += "    - [" + concept.questions[q].questionId + "] " + concept.questions[q].question + "\n";
        }
      }
    }
    userPrompt += "\n";
  }

  // 4. Learner model state (compact)
  var learnerModel = input.learnerModel;
  if (learnerModel && isObject(learnerModel.conceptMastery)) {
    var relevantMastery = {};
    var cmKeys = Object.keys(learnerModel.conceptMastery);
    for (var k = 0; k < cmKeys.length; k++) {
      if (allRelevantIds[cmKeys[k]]) {
        relevantMastery[cmKeys[k]] = learnerModel.conceptMastery[cmKeys[k]];
      }
    }
    if (Object.keys(relevantMastery).length > 0) {
      userPrompt += (useChinese ? "## 学生掌握状态\n" : "## Student Mastery\n");
      var rk = Object.keys(relevantMastery);
      for (var r = 0; r < rk.length; r++) {
        var sc = relevantMastery[rk[r]];
        userPrompt += "- " + rk[r] + ": score " + (sc.score != null ? sc.score : "N/A") + "\n";
      }
      userPrompt += "\n";
    }
    // Error patterns
    if (Array.isArray(learnerModel.errorPatterns) && learnerModel.errorPatterns.length > 0) {
      userPrompt += (useChinese ? "## 历史错误模式\n" : "## Historical Error Patterns\n");
      for (var ep = 0; ep < Math.min(learnerModel.errorPatterns.length, 3); ep++) {
        userPrompt += "- " + JSON.stringify(learnerModel.errorPatterns[ep]) + "\n";
      }
      userPrompt += "\n";
    }
    // Affective state
    if (isObject(learnerModel.affectiveState)) {
      userPrompt += (useChinese ? "## 情感状态\n" : "## Affective State\n");
      userPrompt += JSON.stringify(learnerModel.affectiveState) + "\n\n";
    }
  }

  // 5. Output schema
  userPrompt += (useChinese
    ? "请输出如下 JSON 结构：\n{\n" +
      '  "understanding": {\n' +
      '    "level": "unknown | no_attempt | misconception | partial | mostly_correct | correct",\n' +
      '    "confidence": 0.3,\n' +
      '    "summary": "对学生当前理解状态的一句话判断"\n' +
      '  },\n' +
      '  "errorType": "none | concept_misunderstanding | prerequisite_gap | calculation_error | expression_issue | off_topic | insufficient_evidence | unknown",\n' +
      '  "relatedConcepts": [\n' +
      '    {"conceptId": "...", "title": "...", "relevance": 0.8, "evidence": "为什么相关"}\n' +
      '  ],\n' +
      '  "prerequisiteGaps": [\n' +
      '    {"conceptId": "...", "title": "...", "reason": "为什么判断为前置缺口", "severity": 1}\n' +
      '  ],\n' +
      '  "evidence": ["证据1", "证据2"],\n' +
      '  "suggestedFocus": {"conceptId": "...", "reason": "下一步最该聚焦什么"} | null,\n' +
      '  "assessmentNeed": {\n' +
      '    "shouldAskQuestion": true,\n' +
      '    "reason": "是否需要出一个诊断题验证",\n' +
      '    "candidateQuestionIds": ["questionId1"]\n' +
      '  },\n' +
      '  "affectiveSignal": {\n' +
      '    "confidence": 0.5, "frustration": 0.0, "engagement": 0.5,\n' +
      '    "evidence": ""\n' +
      '  },\n' +
      '  "rawModelNotes": ""\n' +
      '}'
    : "Please output the following JSON structure:\n{\n" +
      '  "understanding": {\n' +
      '    "level": "unknown | no_attempt | misconception | partial | mostly_correct | correct",\n' +
      '    "confidence": 0.3,\n' +
      '    "summary": "one-sentence judgment of student\'s understanding"\n' +
      '  },\n' +
      '  "errorType": "none | concept_misunderstanding | prerequisite_gap | calculation_error | expression_issue | off_topic | insufficient_evidence | unknown",\n' +
      '  "relatedConcepts": [\n' +
      '    {"conceptId": "...", "title": "...", "relevance": 0.8, "evidence": "why relevant"}\n' +
      '  ],\n' +
      '  "prerequisiteGaps": [\n' +
      '    {"conceptId": "...", "title": "...", "reason": "why judged as prerequisite gap", "severity": 1}\n' +
      '  ],\n' +
      '  "evidence": ["evidence 1", "evidence 2"],\n' +
      '  "suggestedFocus": {"conceptId": "...", "reason": "what to focus on next"} | null,\n' +
      '  "assessmentNeed": {\n' +
      '    "shouldAskQuestion": true,\n' +
      '    "reason": "whether a diagnostic question is needed",\n' +
      '    "candidateQuestionIds": ["questionId1"]\n' +
      '  },\n' +
      '  "affectiveSignal": {\n' +
      '    "confidence": 0.5, "frustration": 0.0, "engagement": 0.5,\n' +
      '    "evidence": ""\n' +
      '  },\n' +
      '  "rawModelNotes": ""\n' +
      '}');

  return { system: systemPrompt, user: userPrompt };
}

function extractDiagnosisJson(text) {
  if (!text || typeof text !== "string") return null;
  var t = text.trim();

  // Try direct parse first
  try { return JSON.parse(t); } catch (e) {}

  // Try to extract from markdown code fence
  var fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch (e) {}
  }

  // Try to find JSON object by balancing braces
  var start = t.indexOf("{");
  if (start < 0) return null;
  var depth = 0, end = -1;
  for (var i = start; i < t.length; i++) {
    if (t[i] === "{") depth++;
    else if (t[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end > start) {
    try { return JSON.parse(t.slice(start, end)); } catch (e) {}
  }

  return null;
}

// ========== Normalization ==========

function normalizeDiagnosis(raw, context) {
  if (!isObject(raw)) {
    return { error: "invalid_raw", message: "raw output is not an object" };
  }

  var now = new Date().toISOString();
  var conceptGraph = context.conceptGraph || null;
  var conceptIdSet = {};
  if (conceptGraph && Array.isArray(conceptGraph.concepts)) {
    for (var i = 0; i < conceptGraph.concepts.length; i++) {
      conceptIdSet[conceptGraph.concepts[i].conceptId] = conceptGraph.concepts[i];
    }
  }

  // Build title lookup from context concepts + raw relatedConcepts
  var titleMap = {};
  if (conceptGraph && Array.isArray(conceptGraph.concepts)) {
    for (var c = 0; c < conceptGraph.concepts.length; c++) {
      titleMap[conceptGraph.concepts[c].conceptId] = conceptGraph.concepts[c].title || conceptGraph.concepts[c].conceptId;
    }
  }
  if (Array.isArray(raw.relatedConcepts)) {
    for (var rc = 0; rc < raw.relatedConcepts.length; rc++) {
      if (raw.relatedConcepts[rc] && raw.relatedConcepts[rc].conceptId && !titleMap[raw.relatedConcepts[rc].conceptId]) {
        titleMap[raw.relatedConcepts[rc].conceptId] = raw.relatedConcepts[rc].title || raw.relatedConcepts[rc].conceptId;
      }
    }
  }

  // Normalize understanding
  var validLevels = { unknown:1, no_attempt:1, misconception:1, partial:1, mostly_correct:1, correct:1 };
  var level = validLevels[raw.understanding && raw.understanding.level] ? raw.understanding.level : "unknown";
  var confidence = clamp(toNumber(raw.understanding && raw.understanding.confidence, 0.3), 0, 1);
  var summary = String((raw.understanding && raw.understanding.summary) || "").trim();

  // Normalize errorType
  var validErrorTypes = { none:1, concept_misunderstanding:1, prerequisite_gap:1, calculation_error:1, expression_issue:1, off_topic:1, insufficient_evidence:1, unknown:1 };
  var errorType = validErrorTypes[raw.errorType] ? raw.errorType : "unknown";

  // Normalize relatedConcepts
  var relatedConcepts = [];
  if (Array.isArray(raw.relatedConcepts)) {
    for (var r = 0; r < raw.relatedConcepts.length; r++) {
      var rc = raw.relatedConcepts[r];
      if (!rc || !rc.conceptId) continue;
      var relevance = clamp(toNumber(rc.relevance, 0.5), 0, 1);
      relatedConcepts.push({
        conceptId: String(rc.conceptId),
        title: String(rc.title || titleMap[rc.conceptId] || rc.conceptId),
        relevance: Math.round(relevance * 10) / 10,
        evidence: String(rc.evidence || "")
      });
    }
  }

  // Normalize prerequisiteGaps
  var prerequisiteGaps = [];
  if (Array.isArray(raw.prerequisiteGaps)) {
    for (var g = 0; g < raw.prerequisiteGaps.length; g++) {
      var pg = raw.prerequisiteGaps[g];
      if (!pg || !pg.conceptId) continue;
      prerequisiteGaps.push({
        conceptId: String(pg.conceptId),
        title: String(pg.title || titleMap[pg.conceptId] || pg.conceptId),
        reason: String(pg.reason || ""),
        severity: clamp(Math.round(toNumber(pg.severity, 1)), 1, 3)
      });
    }
  }

  // Normalize evidence
  var evidence = [];
  if (Array.isArray(raw.evidence)) {
    for (var e = 0; e < raw.evidence.length; e++) {
      if (typeof raw.evidence[e] === "string") evidence.push(raw.evidence[e]);
    }
  }

  // Normalize suggestedFocus
  var suggestedFocus = null;
  if (isObject(raw.suggestedFocus) && raw.suggestedFocus.conceptId) {
    suggestedFocus = {
      conceptId: String(raw.suggestedFocus.conceptId),
      reason: String(raw.suggestedFocus.reason || "")
    };
  }

  // Normalize assessmentNeed
  var assessmentNeed = {
    shouldAskQuestion: !!raw.assessmentNeed && raw.assessmentNeed.shouldAskQuestion === true,
    reason: String((raw.assessmentNeed && raw.assessmentNeed.reason) || ""),
    candidateQuestionIds: Array.isArray(raw.assessmentNeed && raw.assessmentNeed.candidateQuestionIds)
      ? raw.assessmentNeed.candidateQuestionIds.filter(function (q) { return typeof q === "string"; })
      : []
  };

  // Normalize affectiveSignal
  var affectiveSignal = {
    confidence: 0.5,
    frustration: 0.0,
    engagement: 0.5,
    evidence: ""
  };
  if (isObject(raw.affectiveSignal)) {
    affectiveSignal.confidence = clamp(toNumber(raw.affectiveSignal.confidence, 0.5), 0, 1);
    affectiveSignal.frustration = clamp(toNumber(raw.affectiveSignal.frustration, 0), 0, 1);
    affectiveSignal.engagement = clamp(toNumber(raw.affectiveSignal.engagement, 0.5), 0, 1);
    affectiveSignal.evidence = String(raw.affectiveSignal.evidence || "");
  }

  return {
    type: "diagnosis",
    diagnosisId: context.diagnosisId || genDiagnosisId(),
    profileId: context.profileId || "",
    worldId: context.worldId || "",
    textbookId: context.textbookId || "",
    sessionId: context.sessionId || "",
    timestamp: now,
    relatedConcepts: relatedConcepts,
    prerequisiteGaps: prerequisiteGaps,
    understanding: {
      level: level,
      confidence: confidence,
      summary: summary
    },
    errorType: errorType,
    evidence: evidence,
    suggestedFocus: suggestedFocus,
    assessmentNeed: assessmentNeed,
    affectiveSignal: affectiveSignal,
    rawModelNotes: String(raw.rawModelNotes || "")
  };
}

// ========== Validation ==========

function validateDiagnosis(diagnosis, conceptGraph) {
  var errors = [];

  if (!isObject(diagnosis)) return ["diagnosis must be an object"];
  if (diagnosis.type !== "diagnosis") errors.push("type must be 'diagnosis'");
  if (!isNonEmptyString(diagnosis.diagnosisId)) errors.push("missing or invalid diagnosisId");
  if (!isNonEmptyString(diagnosis.profileId)) errors.push("missing profileId");
  if (!isNonEmptyString(diagnosis.worldId)) errors.push("missing worldId");
  if (!isNonEmptyString(diagnosis.textbookId)) errors.push("missing textbookId");
  if (!isNonEmptyString(diagnosis.timestamp)) errors.push("missing timestamp");

  // Validate understanding
  if (!isObject(diagnosis.understanding)) {
    errors.push("understanding must be an object");
  } else {
    var validLevels = { unknown:1, no_attempt:1, misconception:1, partial:1, mostly_correct:1, correct:1 };
    if (!validLevels[diagnosis.understanding.level]) {
      errors.push("understanding.level must be one of: " + Object.keys(validLevels).join(", ") + ", got '" + diagnosis.understanding.level + "'");
    }
    if (typeof diagnosis.understanding.confidence !== "number" || diagnosis.understanding.confidence < 0 || diagnosis.understanding.confidence > 1) {
      errors.push("understanding.confidence must be a number between 0 and 1");
    }
    if (typeof diagnosis.understanding.summary !== "string") {
      errors.push("understanding.summary must be a string");
    }
  }

  // Validate errorType
  var validErrorTypes = { none:1, concept_misunderstanding:1, prerequisite_gap:1, calculation_error:1, expression_issue:1, off_topic:1, insufficient_evidence:1, unknown:1 };
  if (!validErrorTypes[diagnosis.errorType]) {
    errors.push("errorType must be one of: " + Object.keys(validErrorTypes).join(", ") + ", got '" + diagnosis.errorType + "'");
  }

  // Validate relatedConcepts
  if (!Array.isArray(diagnosis.relatedConcepts)) {
    errors.push("relatedConcepts must be an array");
  } else {
    for (var i = 0; i < diagnosis.relatedConcepts.length; i++) {
      var rc = diagnosis.relatedConcepts[i];
      var tag = "relatedConcepts[" + i + "]";
      if (!isNonEmptyString(rc.conceptId)) errors.push(tag + ": missing conceptId");
      if (!isNonEmptyString(rc.title)) errors.push(tag + ": missing title");
      if (typeof rc.relevance !== "number" || rc.relevance < 0 || rc.relevance > 1) errors.push(tag + ": relevance must be 0-1");
      if (typeof rc.evidence !== "string") errors.push(tag + ": evidence must be a string");
    }
  }

  // Validate prerequisiteGaps
  if (!Array.isArray(diagnosis.prerequisiteGaps)) {
    errors.push("prerequisiteGaps must be an array");
  } else {
    for (var j = 0; j < diagnosis.prerequisiteGaps.length; j++) {
      var pg = diagnosis.prerequisiteGaps[j];
      var ptag = "prerequisiteGaps[" + j + "]";
      if (!isNonEmptyString(pg.conceptId)) errors.push(ptag + ": missing conceptId");
      if (!isNonEmptyString(pg.title)) errors.push(ptag + ": missing title");
      if (!isNonEmptyString(pg.reason)) errors.push(ptag + ": missing reason");
      if (typeof pg.severity !== "number" || pg.severity < 1 || pg.severity > 3) errors.push(ptag + ": severity must be 1-3");
    }
  }

  // Validate evidence
  if (!Array.isArray(diagnosis.evidence)) {
    errors.push("evidence must be an array");
  }

  // Validate suggestedFocus
  if (diagnosis.suggestedFocus !== null) {
    if (!isObject(diagnosis.suggestedFocus)) {
      errors.push("suggestedFocus must be null or an object");
    } else {
      if (!isNonEmptyString(diagnosis.suggestedFocus.conceptId)) errors.push("suggestedFocus.conceptId must be a non-empty string");
      if (typeof diagnosis.suggestedFocus.reason !== "string") errors.push("suggestedFocus.reason must be a string");
    }
  }

  // Validate assessmentNeed
  if (!isObject(diagnosis.assessmentNeed)) {
    errors.push("assessmentNeed must be an object");
  } else {
    if (typeof diagnosis.assessmentNeed.shouldAskQuestion !== "boolean") errors.push("assessmentNeed.shouldAskQuestion must be a boolean");
    if (typeof diagnosis.assessmentNeed.reason !== "string") errors.push("assessmentNeed.reason must be a string");
    if (!Array.isArray(diagnosis.assessmentNeed.candidateQuestionIds)) errors.push("assessmentNeed.candidateQuestionIds must be an array");
  }

  // Validate affectiveSignal
  if (!isObject(diagnosis.affectiveSignal)) {
    errors.push("affectiveSignal must be an object");
  } else {
    if (typeof diagnosis.affectiveSignal.confidence !== "number" || diagnosis.affectiveSignal.confidence < 0 || diagnosis.affectiveSignal.confidence > 1)
      errors.push("affectiveSignal.confidence must be 0-1");
    if (typeof diagnosis.affectiveSignal.frustration !== "number" || diagnosis.affectiveSignal.frustration < 0 || diagnosis.affectiveSignal.frustration > 1)
      errors.push("affectiveSignal.frustration must be 0-1");
    if (typeof diagnosis.affectiveSignal.engagement !== "number" || diagnosis.affectiveSignal.engagement < 0 || diagnosis.affectiveSignal.engagement > 1)
      errors.push("affectiveSignal.engagement must be 0-1");
  }

  // Cross-reference validation against conceptGraph (if provided)
  if (conceptGraph && Array.isArray(conceptGraph.concepts)) {
    var cidSet = {};
    for (var k = 0; k < conceptGraph.concepts.length; k++) {
      cidSet[conceptGraph.concepts[k].conceptId] = conceptGraph.concepts[k];
    }

    // relatedConcepts must reference existing conceptIds
    if (Array.isArray(diagnosis.relatedConcepts)) {
      for (var r = 0; r < diagnosis.relatedConcepts.length; r++) {
        if (!cidSet[diagnosis.relatedConcepts[r].conceptId]) {
          errors.push("relatedConcepts[" + r + "] references non-existent conceptId '" + diagnosis.relatedConcepts[r].conceptId + "'");
        }
      }
    }

    // prerequisiteGaps must reference existing conceptIds
    if (Array.isArray(diagnosis.prerequisiteGaps)) {
      for (var g = 0; g < diagnosis.prerequisiteGaps.length; g++) {
        if (!cidSet[diagnosis.prerequisiteGaps[g].conceptId]) {
          errors.push("prerequisiteGaps[" + g + "] references non-existent conceptId '" + diagnosis.prerequisiteGaps[g].conceptId + "'");
        }
      }
    }

    // suggestedFocus must reference existing conceptId (or be null)
    if (diagnosis.suggestedFocus && diagnosis.suggestedFocus.conceptId) {
      if (!cidSet[diagnosis.suggestedFocus.conceptId]) {
        errors.push("suggestedFocus references non-existent conceptId '" + diagnosis.suggestedFocus.conceptId + "'");
      }
    }
  }

  return errors;
}

// ========== Fallback diagnosis ==========

function makeFallbackDiagnosis(input, reason) {
  var now = new Date().toISOString();
  return {
    type: "diagnosis",
    diagnosisId: genDiagnosisId(),
    profileId: input.profileId || "",
    worldId: input.worldId || "",
    textbookId: input.textbookId || "",
    sessionId: input.sessionId || "",
    timestamp: now,
    relatedConcepts: [],
    prerequisiteGaps: [],
    understanding: {
      level: "unknown",
      confidence: 0.0,
      summary: "未能完成诊断" + (reason ? ": " + reason : "")
    },
    errorType: "unknown",
    evidence: [],
    suggestedFocus: null,
    assessmentNeed: {
      shouldAskQuestion: false,
      reason: "诊断未完成" + (reason ? ": " + reason : ""),
      candidateQuestionIds: []
    },
    affectiveSignal: {
      confidence: 0.5,
      frustration: 0.0,
      engagement: 0.5,
      evidence: ""
    },
    rawModelNotes: "fallback diagnosis" + (reason ? ": " + reason : "")
  };
}

// ========== Main orchestrator ==========

async function diagnose(input, callLLM) {
  if (!input) return { error: "no_input", message: "input is required" };

  // Validate required IDs
  if (!input.profileId || !input.worldId || !input.textbookId) {
    return { error: "missing_ids", message: "profileId, worldId, and textbookId are required" };
  }

  // Load data
  var conceptGraph = resolveConceptGraph(input);
  var learnerModel = resolveLearnerModel(input);
  var recentTurns = resolveRecentTurns(input);
  var activeConceptIds = resolveActiveConceptIds(input, conceptGraph);

  // ConceptGraph is required for diagnosis
  if (!conceptGraph) {
    return {
      error: "concept_graph_missing",
      message: "No ConceptGraph found for these IDs. Please build a ConceptGraph first (POST /api/adaptive-concept-graph) before running diagnosis."
    };
  }

  // Enrich input with resolved data
  var enrichedInput = {
    profileId: input.profileId,
    worldId: input.worldId,
    textbookId: input.textbookId,
    sessionId: input.sessionId || "",
    userMessage: input.userMessage || "",
    recentTurns: recentTurns,
    activeConceptIds: activeConceptIds,
    conceptGraph: conceptGraph,
    learnerModel: learnerModel,
    teachingLanguage: input.teachingLanguage || "zh",
    dryRun: input.dryRun === true,
    accessMode: input.accessMode || "",
    sessionToken: input.sessionToken || "",
    apiKey: input.apiKey || "",
    provider: input.provider || "",
    model: input.model || ""
  };

  var diagnosis = null;
  var isDryRun = input.dryRun === true;

  if (isDryRun) {
    // Rule-based diagnosis — no LLM needed
    diagnosis = runDryRunDiagnosis(enrichedInput, conceptGraph, learnerModel);
  } else if (typeof callLLM === "function") {
    // LLM-powered diagnosis
    var prompt = buildDiagnosisPrompt(enrichedInput);
    var llmText;
    try {
      llmText = await callLLM(prompt);
    } catch (e) {
      return { error: "llm_error", message: "LLM call failed: " + (e && e.message) };
    }
    if (!llmText || typeof llmText !== "string") {
      // LLM returned nothing → use dryRun as fallback
      diagnosis = runDryRunDiagnosis(enrichedInput, conceptGraph, learnerModel);
      diagnosis.rawModelNotes = "LLM returned empty response, fell back to rule-based diagnosis";
    } else {
      var raw = extractDiagnosisJson(llmText);
      if (!raw) {
        // Parse failed → use dryRun as fallback
        diagnosis = runDryRunDiagnosis(enrichedInput, conceptGraph, learnerModel);
        diagnosis.rawModelNotes = "Failed to parse LLM JSON, fell back to rule-based diagnosis. Raw: " + llmText.slice(0, 200);
      } else {
        // Normalize + validate
        diagnosis = normalizeDiagnosis(raw, {
          profileId: input.profileId,
          worldId: input.worldId,
          textbookId: input.textbookId,
          sessionId: input.sessionId || "",
          conceptGraph: conceptGraph,
          diagnosisId: genDiagnosisId()
        });
        if (diagnosis.error) {
          // Normalize failed → fallback
          diagnosis = runDryRunDiagnosis(enrichedInput, conceptGraph, learnerModel);
          diagnosis.rawModelNotes = "normalizeDiagnosis returned error, fell back to rule-based diagnosis";
        } else {
          // Validate
          var validationErrors = validateDiagnosis(diagnosis, conceptGraph);
          if (validationErrors.length > 0) {
            // Validation failed → fallback
            diagnosis = runDryRunDiagnosis(enrichedInput, conceptGraph, learnerModel);
            diagnosis.rawModelNotes = "Validation failed (" + validationErrors.length + " errors), fell back to rule-based diagnosis";
          }
        }
      }
    }
  } else {
    // No LLM caller available → use dryRun as fallback
    diagnosis = runDryRunDiagnosis(enrichedInput, conceptGraph, learnerModel);
    diagnosis.rawModelNotes = "No callLLM available, using rule-based diagnosis";
  }

  // Optionally persist as teaching event
  var writeWarning = null;
  if (input.sessionId && isNonEmptyString(input.sessionId)) {
    var ad = getAdaptive();
    if (ad && ad.appendTeachingEvent) {
      try {
        ad.appendTeachingEvent(input.sessionId, {
          type: "diagnosis",
          diagnosisId: diagnosis.diagnosisId,
          userMessage: input.userMessage || "",
          diagnosis: diagnosis,
          timestamp: diagnosis.timestamp
        });
      } catch (e) {
        writeWarning = "Failed to write diagnosis event: " + (e && e.message);
      }
    }
  }

  if (writeWarning) {
    diagnosis._warning = writeWarning;
  }

  return diagnosis;
}

// ========== Export ==========

module.exports = {
  diagnose: diagnose,
  buildDiagnosisPrompt: buildDiagnosisPrompt,
  normalizeDiagnosis: normalizeDiagnosis,
  validateDiagnosis: validateDiagnosis,
  extractDiagnosisJson: extractDiagnosisJson,
  makeFallbackDiagnosis: makeFallbackDiagnosis,
  // Internal helpers exposed for testing
  _runDryRunDiagnosis: runDryRunDiagnosis,
  _extractConceptTerms: extractConceptTerms,
  _matchConcepts: matchConcepts,
  _hasStruggleSignal: hasStruggleSignal,
  _hasQuestionSignal: hasQuestionSignal,
  _genDiagnosisId: genDiagnosisId
};
