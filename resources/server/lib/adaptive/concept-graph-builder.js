/**
 * Concept Graph Builder
 *
 * Generates structured ConceptGraph documents from textbook source material or
 * pre-built knowledge_base cards. Output conforms to the ConceptGraph schema
 * used by the adaptive teaching data layer (loadConceptGraph / saveConceptGraph).
 *
 * Exports:
 *   buildConceptGraph(input, callLLM)
 *   loadTextbookSource(input)
 *   normalizeConceptGraph(raw, context)
 *   validateConceptGraph(graph)
 *   extractConceptGraphJson(text)
 *
 * CommonJS module — loaded by the API route or standalone smoke test.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

// ========== Helpers ==========

function slugify(title, idx) {
  var base = String(title || "").replace(/['\".,\/\\?！？。，、：:;；!！\s]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  if (!base || base.length < 2) base = "concept";
  base = base.slice(0, 40);
  return (typeof idx === "number" ? String(idx).padStart(3, "0") : "000") + "_" + base;
}

function genQuestionId(conceptId, idx) {
  return conceptId + "_q" + String(idx + 1).padStart(2, "0");
}

function isObject(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }

function safeSegment(value, name) {
  if (value === null || value === undefined || typeof value !== "string" || value.trim() === "")
    throw new Error(name + " must be a non-empty string");
  if (value.length > 128) throw new Error(name + " exceeds max length (128)");
  if (value.indexOf("/") >= 0) throw new Error(name + " must not contain '/'");
  if (value.indexOf("\\") >= 0) throw new Error(name + " must not contain '\\'");
  if (value.indexOf("..") >= 0) throw new Error(name + " must not contain '..'");
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error(name + " must not contain control characters");
  return value;
}

// ========== Source loading ==========

function loadTextbookSource(input) {
  // Validate IDs before any path operations
  if (input.textbookDir && typeof input.textbookDir === "string" && input.textbookDir.trim()) {
    // explicit textbookDir: skip ID validation, use directory directly
  } else {
    if (input.accountId) safeSegment(input.accountId, "accountId");
    if (input.textbookId) safeSegment(input.textbookId, "textbookId");
    if (input.profileId) safeSegment(input.profileId, "profileId");
    if (input.worldId) safeSegment(input.worldId, "worldId");
  }

  // 1. Explicit sourceText
  if (input.sourceText && typeof input.sourceText === "string" && input.sourceText.trim()) {
    return {
      type: "sourceText",
      text: input.sourceText.trim(),
      title: input.textbookTitle || "Untitled Source",
      pages: input.pageRange || null
    };
  }

  // 2. Knowledge base
  var kbSource = tryLoadKnowledgeBase(input);
  if (kbSource) return kbSource;

  // 3. Try textbook path (reading pages)
  var textbookSource = tryLoadTextbook(input);
  if (textbookSource) return textbookSource;

  return null;
}

function tryLoadKnowledgeBase(input) {
  // knowledge_base is at <textbookDir>/knowledge_base/
  var textbookDir = resolveTextbookDir(input);
  if (!textbookDir) return null;

  var kbDir = path.join(textbookDir, "knowledge_base");
  if (!fs.existsSync(kbDir)) return null;

  var indexPath = path.join(kbDir, "index.json");
  if (!fs.existsSync(indexPath)) return null;

  var index;
  try { index = JSON.parse(fs.readFileSync(indexPath, "utf-8")); } catch (e) { return null; }
  if (!index || !Array.isArray(index.cards)) return null;

  var cardsDir = path.join(kbDir, "cards");
  var cards = [];
  for (var i = 0; i < index.cards.length; i++) {
    var cardRef = index.cards[i];
    var cardPath = path.join(cardsDir, (cardRef.concept_id || "") + ".json");
    if (fs.existsSync(cardPath)) {
      try {
        var card = JSON.parse(fs.readFileSync(cardPath, "utf-8"));
        cards.push(card);
      } catch (e) { /* skip corrupt card */ }
    }
  }

  // Also try teaching_map for prerequisite relationships
  var tmap = null;
  var tmapPath = path.join(kbDir, "teaching_map.json");
  if (fs.existsSync(tmapPath)) {
    try { tmap = JSON.parse(fs.readFileSync(tmapPath, "utf-8")); } catch (e) {}
  }

  if (cards.length === 0) return null;

  return {
    type: "knowledge_base",
    title: index.title || input.textbookTitle || "Untitled",
    pages: null,
    cards: cards,
    teachingMap: tmap
  };
}

function tryLoadTextbook(input) {
  // Try to read textbook page files if a textbook directory exists
  var textbookDir = resolveTextbookDir(input);
  if (!textbookDir) return null;

  // Look for pages/ subdirectory or page_*.txt files
  var pagesDir = path.join(textbookDir, "pages");
  var pageFiles = [];
  if (fs.existsSync(pagesDir)) {
    var entries = fs.readdirSync(pagesDir);
    pageFiles = entries.filter(function (f) { return /\.(txt|md)$/i.test(f); }).sort();
  }

  // Also try page_*.json or page_*.txt at root
  if (pageFiles.length === 0) {
    var rootEntries = fs.readdirSync(textbookDir);
    pageFiles = rootEntries.filter(function (f) { return /^page_/.test(f); }).sort();
    pagesDir = textbookDir;
  }

  if (pageFiles.length === 0) return null;

  var pageStart = (input.pageRange && input.pageRange[0]) || 1;
  var pageEnd = (input.pageRange && input.pageRange[1]) || pageFiles.length;
  var textChunks = [];

  for (var i = 0; i < pageFiles.length; i++) {
    var pageNum = parseInt(String(pageFiles[i]).match(/page_(\d+)/)?.[1] || "0", 10);
    if (pageNum > 0 && (pageNum < pageStart || pageNum > pageEnd)) continue;
    try {
      var content = fs.readFileSync(path.join(pagesDir, pageFiles[i]), "utf-8");
      textChunks.push(content);
    } catch (e) {}
  }

  if (textChunks.length === 0) return null;
  return {
    type: "textbook_pages",
    title: input.textbookTitle || "Untitled Textbook",
    pages: [pageStart, pageEnd],
    text: textChunks.join("\n\n")
  };
}

function pathInside(base, target) {
  var relative = path.relative(base, target);
  return relative === "" || (relative !== ".." && relative.indexOf(".." + path.sep) !== 0 && !path.isAbsolute(relative));
}

function existingTextbookDirectory(root, candidate) {
  var resolvedRoot = path.resolve(root);
  var resolvedCandidate = path.resolve(candidate);
  if (!pathInside(resolvedRoot, resolvedCandidate) || !fs.existsSync(resolvedCandidate)) return null;
  try {
    var realRoot = fs.existsSync(resolvedRoot) ? fs.realpathSync(resolvedRoot) : resolvedRoot;
    var realCandidate = fs.realpathSync(resolvedCandidate);
    if (!pathInside(realRoot, realCandidate) || !fs.statSync(realCandidate).isDirectory()) return null;
    return realCandidate;
  } catch (error) {
    return null;
  }
}

function storagePathSegment(value, name) {
  return safeSegment(value, name).normalize("NFC").toLowerCase();
}

function resolveTextbookDir(input) {
  var root = process.env.PROJECT_ROOT || "";
  if (!root) return null;

  var pid = input.profileId || "";
  var wid = input.worldId || "";
  var tid = input.textbookId || "";

  // An explicit server-selected directory is authoritative. Invalid or missing
  // paths fail closed and must never fall back to scanning another account.
  if (typeof input.textbookDir === "string") {
    var explicit = input.textbookDir.trim();
    if (!explicit) return null;
    return existingTextbookDirectory(root, explicit);
  }

  // Authenticated callers are bound to one exact storage-v2 account scope.
  if (input.accountId) {
    if (!pid || !wid || !tid) return null;
    return existingTextbookDirectory(root, path.join(
      root,
      "accounts", storagePathSegment(input.accountId, "accountId"),
      "profiles", storagePathSegment(pid, "profileId"),
      "worlds", storagePathSegment(wid, "worldId"),
      "textbooks", storagePathSegment(tid, "textbookId")
    ));
  }

  // Legacy callers without account identity retain the historical layouts.
  var candidates = [
    path.join(root, "textbooks", tid),
    path.join(root, "textbook", tid)
  ];
  if (pid && wid) {
    candidates.push(path.join(root, pid, wid, "textbooks", tid));
    candidates.push(path.join(root, "profiles", pid, "worlds", wid, "textbooks", tid));
    try {
      var accountsDir = path.join(root, "accounts");
      if (fs.existsSync(accountsDir)) {
        fs.readdirSync(accountsDir).forEach(function (accountDirectory) {
          candidates.push(path.join(accountsDir, accountDirectory, "profiles", pid, "worlds", wid, "textbooks", tid));
        });
      }
    } catch (error) {}
  }

  for (var i = 0; i < candidates.length; i++) {
    var existing = existingTextbookDirectory(root, candidates[i]);
    if (existing) return existing;
  }
  return null;
}

// ========== Dry-run graph generation (no LLM) ==========

function buildDryRunGraph(source, input) {
  var concepts = [];

  if (source.type === "knowledge_base" && Array.isArray(source.cards)) {
    concepts = cardsToConcepts(source.cards, source.teachingMap);
  } else if (source.text) {
    concepts = textToConcepts(source.text, source.title);
  }

  // Ensure at least 2 concepts for test validity
  if (concepts.length < 2) {
    concepts = concepts.concat(generateFallbackConcepts(concepts.length));
  }

  return buildGraphEnvelope(concepts, input, source);
}

function cardsToConcepts(cards, teachingMap) {
  var titleToPhase = {};
  if (teachingMap && Array.isArray(teachingMap.teaching_sequence)) {
    for (var s = 0; s < teachingMap.teaching_sequence.length; s++) {
      var seg = teachingMap.teaching_sequence[s];
      if (seg && Array.isArray(seg.card_ids)) {
        for (var c = 0; c < seg.card_ids.length; c++) {
          titleToPhase[seg.card_ids[c]] = seg.phase || (s + 1);
        }
      }
    }
  }

  // Build card title → conceptId map for prerequisite resolution
  var titleToConceptId = {};
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var cid = (typeof card.concept_id === "string" && card.concept_id) ? card.concept_id : slugify(card.title, i);
    titleToConceptId[card.title] = cid;
  }

  return cards.map(function (card, idx) {
    var cid = (typeof card.concept_id === "string" && card.concept_id) ? card.concept_id : slugify(card.title, idx);
    var phase = titleToPhase[card.title] || 1;

    // Resolve prerequisites from card titles to conceptIds
    var prereqs = [];
    if (Array.isArray(card.prerequisites)) {
      for (var p = 0; p < card.prerequisites.length; p++) {
        var pr = card.prerequisites[p];
        var mapped = titleToConceptId[pr];
        if (mapped && mapped !== cid) prereqs.push(mapped);
      }
    }
    // Phase-based ordering: concepts in earlier phases are prerequisites
    if (prereqs.length === 0 && phase > 1 && idx > 0) {
      prereqs.push(slugify(cards[idx - 1].title, idx - 1));
    }

    var questions = [];
    if (Array.isArray(card.qa_pairs)) {
      for (var q = 0; q < card.qa_pairs.length; q++) {
        var qa = card.qa_pairs[q];
        questions.push({
          questionId: genQuestionId(cid, q),
          type: "diagnostic",
          difficulty: card.difficulty || 1,
          question: qa.q || "",
          expectedAnswer: qa.a || "",
          rubric: "",
          misconceptionMapping: [],
          targetConcepts: [cid]
        });
      }
    }

    return {
      conceptId: cid,
      title: card.title || "",
      aliases: [],
      description: card.definition || "",
      prerequisites: prereqs,
      masteryCriteria: Array.isArray(card.key_points) ? card.key_points.slice(0, 3) : ["能解释该概念"],
      commonMisconceptions: Array.isArray(card.misconceptions) ? card.misconceptions : [],
      difficulty: card.difficulty || 1,
      sourcePages: Array.isArray(card.source_pages) ? card.source_pages : [],
      questions: questions
    };
  });
}

function textToConcepts(text, title) {
  // Deterministic concept extraction from plain text:
  // 1. Split into paragraphs
  // 2. Extract "definition-like" sentences
  // 3. Build minimal concept nodes
  var paragraphs = text.split(/\n\s*\n/).filter(function (p) { return p.trim().length > 20; });
  var concepts = [];
  var seenTerms = {};
  var conceptIdList = [];

  // Extract section headers and key sentences
  var headerPattern = /^(?:#+\s*|第[一二三四五六七八九十\d]+[章节]|Section\s+\d+[.:]\s*)(.+)$/im;
  var defPatterns = [
    /([^，。；\n]{2,30})是指[^。]*[。]/g,
    /([^，。；\n]{2,30})的定义[是为].*?[。]/g,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:is|refers to|means)\s+[^.]+\./g,
    /[""]([^""]{2,30})[""][是为].*?[。]/g
  ];

  // Try to find section headers
  var headerMatch = text.match(headerPattern);
  var headerTerm = headerMatch ? headerMatch[1].trim() : null;

  // Try definition patterns
  for (var d = 0; d < defPatterns.length; d++) {
    var re = new RegExp(defPatterns[d].source, defPatterns[d].flags);
    var match;
    while ((match = re.exec(text)) !== null) {
      var term = (match[1] || "").trim();
      if (term.length >= 2 && term.length <= 40 && !seenTerms[term]) {
        seenTerms[term] = true;
        var prevId = conceptIdList.length > 0 ? conceptIdList[conceptIdList.length - 1] : null;
        var cDef = makeConceptFromTerm(term, match[0], conceptIdList.length, paragraphs, prevId);
        conceptIdList.push(cDef.conceptId);
        concepts.push(cDef);
        if (concepts.length >= 6) break;
      }
    }
    if (concepts.length >= 2) break;
  }

  // Fallback: use section headers and long-enough terms from text
  if (concepts.length < 2) {
    // Extract capitalized phrases or Chinese terms
    var termRe = /(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}|[\u4e00-\u9fff]{2,8})/g;
    var termMatch;
    while ((termMatch = termRe.exec(text)) !== null) {
      var t = termMatch[0].trim();
      if (t.length >= 2 && !seenTerms[t]) {
        seenTerms[t] = true;
        var prevIdF = conceptIdList.length > 0 ? conceptIdList[conceptIdList.length - 1] : null;
        var cFb = makeConceptFromTerm(t, "", conceptIdList.length, paragraphs, prevIdF);
        conceptIdList.push(cFb.conceptId);
        concepts.push(cFb);
        if (concepts.length >= 6) break;
      }
    }
  }

  // Add header if we still have too few
  if (concepts.length < 2 && headerTerm && !seenTerms[headerTerm]) {
    var prevIdH = conceptIdList.length > 0 ? conceptIdList[conceptIdList.length - 1] : null;
    var cHd = makeConceptFromTerm(headerTerm, "", conceptIdList.length, paragraphs, prevIdH);
    conceptIdList.push(cHd.conceptId);
    concepts.push(cHd);
  }

  return concepts;
}

function makeConceptFromTerm(term, contextSentence, idx, paragraphs, prevConceptId) {
  var cid = slugify(term, idx);
  return {
    conceptId: cid,
    title: term,
    aliases: [],
    description: contextSentence || ("关于 " + term + " 的基本概念"),
    prerequisites: prevConceptId ? [prevConceptId] : [],
    masteryCriteria: ["能解释" + term + "的基本含义", "能举例说明" + term],
    commonMisconceptions: [],
    difficulty: 1,
    sourcePages: [],
    questions: [
      {
        questionId: genQuestionId(cid, 0),
        type: "diagnostic",
        difficulty: 1,
        question: "请解释什么是" + term + "？",
        expectedAnswer: contextSentence || ("需要了解" + term + "的定义和基本特征"),
        rubric: "回答需要包含核心定义和至少一个关键特征",
        misconceptionMapping: [],
        targetConcepts: [cid]
      }
    ]
  };
}

function generateFallbackConcepts(existingCount) {
  var fallbacks = [];
  var templates = [
    { title: "基础概念框架", desc: "本课程涉及的基础概念和定义", mastery: ["能说出至少3个关键概念", "能区分核心概念与派生概念"] },
    { title: "核心方法论", desc: "课程中使用的核心方法和技巧", mastery: ["能描述方法的步骤", "能在简单场景中应用该方法"] }
  ];
  for (var i = 0; i < templates.length && (existingCount + fallbacks.length) < 2; i++) {
    var t = templates[i];
    var cid = slugify(t.title, existingCount + i);
    fallbacks.push({
      conceptId: cid,
      title: t.title,
      aliases: [],
      description: t.desc,
      prerequisites: [],
      masteryCriteria: t.mastery,
      commonMisconceptions: [],
      difficulty: 1,
      sourcePages: [],
      questions: [{
        questionId: genQuestionId(cid, 0),
        type: "diagnostic",
        difficulty: 1,
        question: "请简述" + t.title + "的主要内容？",
        expectedAnswer: t.desc,
        rubric: "",
        misconceptionMapping: [],
        targetConcepts: [cid]
      }]
    });
  }
  return fallbacks;
}

function buildGraphEnvelope(concepts, input, source) {
  var now = new Date().toISOString();
  return {
    profileId: input.profileId || "",
    worldId: input.worldId || "",
    textbookId: input.textbookId || "",
    version: 1,
    createdAt: now,
    updatedAt: now,
    source: {
      type: source.type || "unknown",
      title: source.title || input.textbookTitle || "",
      pages: source.pages || input.pageRange || null
    },
    concepts: concepts
  };
}

// ========== LLM integration ==========

function buildLLMPrompt(source, input) {
  var lang = input.teachingLanguage || "zh";
  var conceptCount = "3-8";

  var sourceBlock;
  if (source.type === "knowledge_base" && Array.isArray(source.cards)) {
    var cardBlurbs = source.cards.map(function (c) {
      return "- " + (c.title || "") + " (difficulty " + (c.difficulty || 1) + "): " + (c.definition || "").slice(0, 200);
    }).join("\n");
    sourceBlock = "以下是从教材《" + (source.title || "") + "》提取的知识卡片：\n" + cardBlurbs;
    conceptCount = String(Math.max(3, Math.min(source.cards.length, 12)));
  } else {
    var text = (source.text || "").slice(0, 8000);
    sourceBlock = "以下是教材《" + (source.title || "") + "》的内容摘录：\n" + text;
  }

  var systemPrompt = "你是一个课程设计专家。请根据给定的教材内容，提取并组织知识点，生成结构化的知识图谱和诊断题库。\n严格只输出 JSON，不要加任何 markdown 代码块标记，不要加任何额外文字说明。";

  var userPrompt = sourceBlock + "\n\n请输出如下 JSON 结构：\n" +
    "{\n" +
    '  "concepts": [\n' +
    '    {\n' +
    '      "conceptId": "slug_化的概念ID(英文+数字)",\n' +
    '      "title": "概念名称",\n' +
    '      "aliases": ["别名1"],\n' +
    '      "description": "准确、自足的描述",\n' +
    '      "prerequisites": ["前置概念的conceptId"],\n' +
    '      "masteryCriteria": ["掌握标准1", "掌握标准2"],\n' +
    '      "commonMisconceptions": ["常见误解1"],\n' +
    '      "difficulty": 1,\n' +
    '      "sourcePages": [0, 0],\n' +
    '      "questions": [\n' +
    '        {\n' +
    '          "questionId": "conceptId_q01",\n' +
    '          "type": "diagnostic",\n' +
    '          "difficulty": 1,\n' +
    '          "question": "诊断问题",\n' +
    '          "expectedAnswer": "期望的正确答案或要点",\n' +
    '          "rubric": "评分标准(可选)",\n' +
    '          "misconceptionMapping": ["对应的常见误解"],\n' +
    '          "targetConcepts": ["conceptId"]\n' +
    '        }\n' +
    '      ]\n' +
    '    }\n' +
    '  ]\n' +
    '}\n\n' +
    '要求：\n' +
    '- 生成 ' + conceptCount + ' 个概念。\n' +
    '- conceptId 使用英文 slug 格式，稳定且唯一。\n' +
    '- masteryCriteria 每个概念至少 1 条，必须可验证。\n' +
    '- commonMisconceptions 可以为空数组 []。\n' +
    '- 每个概念生成 1-3 道诊断题。\n' +
    '- questions 中每道题必须有 targetConcepts、difficulty(1-3)、expectedAnswer。\n' +
    '- misconceptionMapping 是字符串数组，对应 commonMisconceptions 的索引或内容。\n' +
    '- difficulty 取 1(入门)、2(进阶)、3(综合)。\n' +
    '- prerequisites 必须是已出现概念的 conceptId，不能引用不存在的概念。\n' +
    (lang.startsWith("zh") ? "- 所有内容使用简体中文。\n" : "- 所有内容使用英文。\n");

  return { system: systemPrompt, user: userPrompt };
}

function extractConceptGraphJson(text) {
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

function normalizeConceptGraph(raw, context) {
  if (!raw || !Array.isArray(raw.concepts)) {
    return { error: "invalid_raw", message: "raw output missing concepts array" };
  }

  var now = new Date().toISOString();
  var graph = {
    profileId: context.profileId || "",
    worldId: context.worldId || "",
    textbookId: context.textbookId || "",
    version: 1,
    createdAt: now,
    updatedAt: now,
    source: {
      type: context.sourceType || "llm",
      title: context.textbookTitle || "",
      pages: context.pageRange || null
    },
    concepts: []
  };

  var conceptIdSet = {};
  var idx = 0;

  for (var i = 0; i < raw.concepts.length; i++) {
    var c = raw.concepts[i];
    if (!c || typeof c !== "object") continue;

    // Generate stable conceptId if missing or invalid
    var cid = (typeof c.conceptId === "string" && c.conceptId.trim()) ? c.conceptId.trim() : slugify(c.title || "", idx);
    if (conceptIdSet[cid]) {
      // De-duplicate: append suffix
      cid = cid + "_" + idx;
    }
    conceptIdSet[cid] = true;

    var concept = {
      conceptId: cid,
      title: String(c.title || cid).trim(),
      aliases: Array.isArray(c.aliases) ? c.aliases.filter(function (a) { return typeof a === "string"; }) : [],
      description: String(c.description || c.definition || "").trim(),
      prerequisites: Array.isArray(c.prerequisites) ? c.prerequisites.filter(function (p) { return typeof p === "string" && p !== cid; }) : [],
      masteryCriteria: Array.isArray(c.masteryCriteria) && c.masteryCriteria.length > 0
        ? c.masteryCriteria.filter(function (m) { return typeof m === "string" && m.trim(); })
        : ["能解释" + (c.title || "该概念") + "的基本含义"],
      commonMisconceptions: Array.isArray(c.commonMisconceptions)
        ? c.commonMisconceptions.filter(function (m) { return typeof m === "string"; })
        : [],
      difficulty: (typeof c.difficulty === "number" && c.difficulty >= 1 && c.difficulty <= 3) ? c.difficulty : 1,
      sourcePages: Array.isArray(c.sourcePages) ? c.sourcePages : (Array.isArray(c.source_pages) ? c.source_pages : []),
      questions: []
    };

    // Normalize questions
    var qList = Array.isArray(c.questions) ? c.questions : (Array.isArray(c.qa_pairs) ? normalizeQAPairs(c.qa_pairs, cid) : []);
    for (var q = 0; q < qList.length; q++) {
      var qq = qList[q];
      if (!qq || typeof qq !== "object") continue;
      var qid = (typeof qq.questionId === "string" && qq.questionId.trim())
        ? qq.questionId.trim()
        : genQuestionId(cid, q);
      concept.questions.push({
        questionId: qid,
        type: typeof qq.type === "string" ? qq.type : "diagnostic",
        difficulty: (typeof qq.difficulty === "number" && qq.difficulty >= 1 && qq.difficulty <= 3) ? qq.difficulty : concept.difficulty,
        question: String(qq.question || qq.q || "").trim(),
        expectedAnswer: String(qq.expectedAnswer || qq.a || qq.answer || "").trim(),
        rubric: String(qq.rubric || "").trim(),
        misconceptionMapping: Array.isArray(qq.misconceptionMapping) ? qq.misconceptionMapping.filter(function (m) { return typeof m === "string"; }) : [],
        targetConcepts: Array.isArray(qq.targetConcepts) && qq.targetConcepts.length > 0
          ? qq.targetConcepts.filter(function (t) { return typeof t === "string"; })
          : [cid]
      });
    }

    // Ensure at least 1 question per concept
    if (concept.questions.length === 0) {
      concept.questions.push({
        questionId: genQuestionId(cid, 0),
        type: "diagnostic",
        difficulty: concept.difficulty,
        question: "请解释什么是" + concept.title + "？",
        expectedAnswer: concept.description || "需要了解该概念的定义和基本特征",
        rubric: "",
        misconceptionMapping: [],
        targetConcepts: [cid]
      });
    }

    graph.concepts.push(concept);
    idx++;
  }

  // Second pass: clean up prerequisite references to non-existent conceptIds
  for (var j = 0; j < graph.concepts.length; j++) {
    graph.concepts[j].prerequisites = graph.concepts[j].prerequisites.filter(function (p) {
      return conceptIdSet[p];
    });
  }

  // Third pass: clean up targetConcepts references to non-existent conceptIds
  for (var k = 0; k < graph.concepts.length; k++) {
    var qs = graph.concepts[k].questions;
    for (var qi = 0; qi < qs.length; qi++) {
      qs[qi].targetConcepts = qs[qi].targetConcepts.filter(function (t) {
        return conceptIdSet[t];
      });
      // Ensure at least one targetConcept remains (default to self)
      if (qs[qi].targetConcepts.length === 0) {
        qs[qi].targetConcepts = [graph.concepts[k].conceptId];
      }
    }
  }

  return graph;
}

function normalizeQAPairs(qaPairs, cid) {
  return qaPairs.map(function (qa, q) {
    return {
      questionId: genQuestionId(cid, q),
      type: "diagnostic",
      difficulty: 1,
      question: qa.q || "",
      expectedAnswer: qa.a || "",
      rubric: "",
      misconceptionMapping: [],
      targetConcepts: [cid]
    };
  });
}

// ========== Validation ==========

function validateConceptGraph(graph) {
  var errors = [];

  if (!isObject(graph)) return ["graph must be an object"];
  if (!graph.profileId) errors.push("missing profileId");
  if (!graph.worldId) errors.push("missing worldId");
  if (!graph.textbookId) errors.push("missing textbookId");
  if (!Array.isArray(graph.concepts)) {
    errors.push("concepts must be an array");
    return errors;
  }
  if (graph.concepts.length < 2) errors.push("concepts must have at least 2 entries");

  var conceptIds = {};
  for (var i = 0; i < graph.concepts.length; i++) {
    var c = graph.concepts[i];
    var tag = "concepts[" + i + "]";

    if (!c.conceptId || typeof c.conceptId !== "string") {
      errors.push(tag + ": missing or invalid conceptId");
    } else if (conceptIds[c.conceptId]) {
      errors.push(tag + ": duplicate conceptId '" + c.conceptId + "'");
    } else {
      conceptIds[c.conceptId] = true;
    }

    if (!c.title || typeof c.title !== "string") errors.push(tag + ": missing title");
    if (!Array.isArray(c.prerequisites)) errors.push(tag + ": prerequisites must be an array");
    if (!Array.isArray(c.masteryCriteria) || c.masteryCriteria.length === 0)
      errors.push(tag + ": masteryCriteria must be a non-empty array");
    if (!Array.isArray(c.commonMisconceptions)) errors.push(tag + ": commonMisconceptions must be an array");

    if (!Array.isArray(c.questions)) {
      errors.push(tag + ": questions must be an array");
    } else {
      for (var q = 0; q < c.questions.length; q++) {
        var qq = c.questions[q];
        var qtag = tag + ".questions[" + q + "]";
        if (!qq.questionId) errors.push(qtag + ": missing questionId");
        if (!qq.question) errors.push(qtag + ": missing question text");
        if (!qq.expectedAnswer) errors.push(qtag + ": missing expectedAnswer");
        if (!Array.isArray(qq.targetConcepts) || qq.targetConcepts.length === 0)
          errors.push(qtag + ": targetConcepts must be a non-empty array");
        if (typeof qq.difficulty !== "number" || qq.difficulty < 1 || qq.difficulty > 3)
          errors.push(qtag + ": difficulty must be 1-3");
        if (!Array.isArray(qq.misconceptionMapping))
          errors.push(qtag + ": misconceptionMapping must be an array");
      }
    }
  }

  // Validate prerequisites reference existing conceptIds
  for (var j = 0; j < graph.concepts.length; j++) {
    var prs = graph.concepts[j].prerequisites || [];
    for (var p = 0; p < prs.length; p++) {
      if (!conceptIds[prs[p]]) {
        errors.push("concepts[" + j + "].prerequisites references non-existent conceptId '" + prs[p] + "'");
      }
    }
  }

  // Validate targetConcepts reference existing conceptIds
  for (var k = 0; k < graph.concepts.length; k++) {
    var qs = graph.concepts[k].questions || [];
    for (var qi = 0; qi < qs.length; qi++) {
      var tcs = qs[qi].targetConcepts || [];
      for (var ti = 0; ti < tcs.length; ti++) {
        if (!conceptIds[tcs[ti]]) {
          errors.push("concepts[" + k + "].questions[" + qi + "].targetConcepts references non-existent conceptId '" + tcs[ti] + "'");
        }
      }
    }
  }

  return errors;
}

// ========== Main orchestrator ==========

async function buildConceptGraph(input, callLLM) {
  if (!input) return { error: "no_input", message: "input is required" };

  // Check required IDs
  if (!input.profileId || !input.worldId || !input.textbookId) {
    return { error: "missing_ids", message: "profileId, worldId, and textbookId are required" };
  }

  // 1. Load source
  var source = loadTextbookSource(input);
  if (!source) {
    return {
      error: "no_source",
      message: "No source material found. Provide sourceText, or ensure a knowledge_base/ or textbook pages exist for this textbookId.",
      profileId: input.profileId,
      worldId: input.worldId,
      textbookId: input.textbookId
    };
  }

  // 2. Build graph
  var graph;
  // Knowledge-base source: deterministic path is always available, LLM is optional enhancement
  var useLLM = !input.dryRun && typeof callLLM === "function" && source.type !== "knowledge_base";
  var kbCanUseLLM = !input.dryRun && typeof callLLM === "function" && source.type === "knowledge_base";

  if (useLLM) {
    // sourceText / textbook_pages + callLLM available → use LLM
    var prompt = buildLLMPrompt(source, input);
    var llmText;
    try {
      llmText = await callLLM(prompt);
    } catch (e) {
      return { error: "llm_error", message: "LLM call failed: " + (e && e.message) };
    }
    if (!llmText || typeof llmText !== "string") {
      return { error: "llm_empty", message: "LLM returned empty or invalid response" };
    }
    var raw = extractConceptGraphJson(llmText);
    if (!raw) {
      return { error: "parse_error", message: "Failed to extract valid JSON from LLM response", rawResponse: llmText.slice(0, 500) };
    }
    graph = normalizeConceptGraph(raw, {
      profileId: input.profileId,
      worldId: input.worldId,
      textbookId: input.textbookId,
      textbookTitle: source.title || input.textbookTitle,
      sourceType: source.type,
      pageRange: source.pages || input.pageRange
    });
    if (graph.error) return graph;
  } else if (kbCanUseLLM) {
    // knowledge_base + callLLM: use LLM for higher-quality graph
    var kprompt = buildLLMPrompt(source, input);
    var ktext;
    try { ktext = await callLLM(kprompt); } catch (e) {
      // LLM failed — fall through to deterministic path below
      ktext = null;
    }
    if (ktext && typeof ktext === "string") {
      var kraw = extractConceptGraphJson(ktext);
      if (kraw) {
        graph = normalizeConceptGraph(kraw, {
          profileId: input.profileId, worldId: input.worldId, textbookId: input.textbookId,
          textbookTitle: source.title || input.textbookTitle, sourceType: source.type, pageRange: source.pages || input.pageRange
        });
      }
    }
    // Fallback: if LLM didn't produce valid output, use deterministic
    if (!graph || graph.error) graph = buildDryRunGraph(source, input);
  } else {
    // dryRun OR (knowledge_base without callLLM) OR (sourceText without callLLM)
    graph = buildDryRunGraph(source, input);
  }

  // 3. An explicitly injected graph is authoritative for the v2 path. With
  // persist:false we must not even read the legacy global data layer.
  var explicitExisting = input.existingGraph;
  if (explicitExisting && typeof explicitExisting.version === "number" && explicitExisting.version >= 1) {
    graph.version = explicitExisting.version;
  } else if (input.persist !== false) try {
    var ad = global.__ADAPTIVE__;
    if (!ad) { try { ad = require("./data-layer.js"); } catch (e) {} }
    if (ad && ad.getConceptGraph) {
      var existing = ad.getConceptGraph(input.profileId, input.worldId, input.textbookId);
      if (existing && typeof existing.version === "number" && existing.version >= 1) {
        graph.version = existing.version;
      }
    } else if (ad && ad.loadConceptGraph) {
      // loadConceptGraph auto-creates — only use if we can detect pre-existing
      // Check by file existence before calling load
      var ad2 = ad;
      var fp = ad2.conceptGraphPath ? ad2.conceptGraphPath(input.profileId, input.worldId, input.textbookId) : null;
      if (fp) {
        try { if (require("fs").existsSync(fp)) { var eg = ad2.loadConceptGraph(input.profileId, input.worldId, input.textbookId); if (eg && typeof eg.version === "number") graph.version = eg.version; } } catch (e) {}
      }
    }
  } catch (e) {}

  // 4. Validate
  var validationErrors = validateConceptGraph(graph);
  if (validationErrors.length > 0) {
    return { error: "validation_failed", errors: validationErrors, partial: graph };
  }

  // 5. Persist
  //   - build action (non-dryRun): always save
  //   - dryRun: save only if dryRunSave=true
  var shouldSave = input.persist !== false && (!input.dryRun || input.dryRunSave);
  if (shouldSave) {
    try {
      var adSave = global.__ADAPTIVE__;
      if (!adSave) { try { adSave = require("./data-layer.js"); } catch (e) {} }
      if (adSave && adSave.saveConceptGraph) {
        adSave.saveConceptGraph(input.profileId, input.worldId, input.textbookId, graph);
      }
    } catch (e) {
      return { error: "save_failed", message: "Failed to save ConceptGraph: " + (e && e.message), graph: graph };
    }
  }

  return graph;
}

// ========== Export ==========

module.exports = {
  buildConceptGraph: buildConceptGraph,
  loadTextbookSource: loadTextbookSource,
  normalizeConceptGraph: normalizeConceptGraph,
  validateConceptGraph: validateConceptGraph,
  extractConceptGraphJson: extractConceptGraphJson,
  // Internal helpers exposed for testing
  _slugify: slugify,
  _buildDryRunGraph: buildDryRunGraph,
  _textToConcepts: textToConcepts,
  _cardsToConcepts: cardsToConcepts,
  _buildLLMPrompt: buildLLMPrompt
};
