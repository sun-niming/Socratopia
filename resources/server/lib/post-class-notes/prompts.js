"use strict";

// PN-014 — prompt text for the three model roles.
//
// Kept out of the state machine so prose can be tuned without touching
// orchestration logic.  Section specs are shared between the direct (short
// lesson) and reduce (long lesson) prompts so the two paths cannot drift.
//
// Plan: POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md §3.2, §3.3, §3.4, §7.2.

var schema = require("./schema.js");

var KIND_VOCAB = "misconception | correct | confusion | shift";

function languageSuffix(language) {
  if (language === "english") return "";
  if (language === "chinese-traditional") return "\n\n請使用繁體中文輸出所有欄位內容。";
  return "\n\n请使用简体中文输出所有字段内容。";
}

var SECTION_SPEC_ZH = [
  "每个 section 必须有 `type`，只能取以下 8 种之一（不必全用，按实际内容组织）：",
  "",
  '1. { "type": "tldr", "content": "一句话总结本节课最核心的收获" }',
  '2. { "type": "narrative", "content": "2-3 句学习弧线：从哪开始、经历什么、走到哪" }',
  '3. { "type": "concepts", "items": [ { "name": "概念名", "body": "markdown：定义/直觉/例子/公式", "sourceMessageIndexes": [编号] } ] }',
  '4. { "type": "key-insight", "content": "学习者自己说出的最佳结论", "sourceMessageIndexes": [编号] }',
  '5. { "type": "open-question", "content": "尚未解决的问题或自然延伸" }',
  '6. { "type": "key-terms", "items": [ { "term": "术语", "definition": "定义" } ] }',
  '7. { "type": "review-questions", "items": [ { "question": "题干", "answer": "参考答案" } ] }',
  '8. { "type": "notes", "title": "标题（必填）", "content": "markdown" }'
].join("\n");

var SECTION_SPEC_EN = [
  "Every section needs a `type`, one of exactly these eight (use only the ones the lesson needs):",
  "",
  '1. { "type": "tldr", "content": "One-sentence takeaway" }',
  '2. { "type": "narrative", "content": "2-3 sentence learning arc: started here, went through this, ended there" }',
  '3. { "type": "concepts", "items": [ { "name": "Concept", "body": "markdown: definition / intuition / example / formula", "sourceMessageIndexes": [numbers] } ] }',
  '4. { "type": "key-insight", "content": "The learner\'s own best conclusion", "sourceMessageIndexes": [numbers] }',
  '5. { "type": "open-question", "content": "An unresolved question or natural next step" }',
  '6. { "type": "key-terms", "items": [ { "term": "Term", "definition": "Definition" } ] }',
  '7. { "type": "review-questions", "items": [ { "question": "Prompt", "answer": "Reference answer" } ] }',
  '8. { "type": "notes", "title": "Required title", "content": "markdown" }'
].join("\n");

var SHARED_RULES_ZH = [
  "1. 每个 concept 与 key-insight 都必须带 `sourceMessageIndexes`，编号取自对话正文每行开头的 `[n]`。**补不上编号的概念就不要写。**",
  "2. `key-insight` 必须是学习者**真的说过**的话。没有就整条省略，不要编造。",
  "3. 内容层面可以用背景知识把已经讨论过的概念写得更系统，但 **不能引入对话没有的新概念**。",
  "4. 复习题 3～5 道，必须覆盖不同概念，不能只是改写同一道题。",
  "5. 只输出 JSON，前后不要任何解释、代码块或空白。",
  "6. 所有数学符号、公式、变量都要写成 \\(...\\) 或 \\[...\\]；JSON 字符串里所有反斜杠必须双写（写 \\\\(、\\\\)、\\\\frac、\\\\n）。"
].join("\n");

var SHARED_RULES_EN = [
  "1. Every concept and key-insight MUST carry `sourceMessageIndexes` taken from the `[n]` prefix of each transcript line. **If you cannot cite one, omit that item.**",
  "2. `key-insight` must be something the learner **actually said**. Omit the section rather than invent one.",
  "3. You may enrich a topic the dialogue already covered with background knowledge, but **never introduce a concept the dialogue did not touch**.",
  "4. 3-5 review questions covering different concepts; not the same question reworded.",
  "5. Output ONLY the JSON — no preamble, no code fence, no trailing prose.",
  "6. Write math as \\(...\\) or \\[...\\]; every backslash inside a JSON string must be doubled (\\\\(, \\\\), \\\\frac, \\\\n)."
].join("\n");

// ---- direct: one call, complete dialogue -> complete note (§3.2) ----------

var DIRECT_ZH = [
  "你是一个高质量的课堂笔记整理助手。用户会给你**一节完整的课堂对话**。",
  "",
  "你的任务：整理出一份像优秀学生课堂笔记的概念卡——结构清晰、详略得当、便于复习。",
  "",
  "输出结构：",
  "",
  "{",
  '  "pagesRange": "本次覆盖的页码范围，如未提及则为 null",',
  '  "sections": [ ... 有序 section 数组 ... ]',
  "}",
  "",
  SECTION_SPEC_ZH,
  "",
  "硬性规则：",
  "- **主题层面严守对话**：只能写对话里真的**触及过**的主题。不要因为教材章节名写着某个概念就跑出来讲它。",
  "- 一个简单检验：学生只看这份笔记，应该能想起「哦，这是我们刚才聊过的内容」。可以更丰满，但不能陌生。",
  SHARED_RULES_ZH
].join("\n");

var DIRECT_EN = [
  "You are a high-quality lesson notes assistant. The user gives you **one complete tutor-learner dialogue**.",
  "",
  "Your job: produce a concept card that reads like **a strong student's class notes** — clearly structured, well-prioritised, useful for review.",
  "",
  "Output shape:",
  "",
  "{",
  '  "pagesRange": "Pages covered, or null",',
  '  "sections": [ ... ordered array of section objects ... ]',
  "}",
  "",
  SECTION_SPEC_EN,
  "",
  "Hard rules:",
  "- **Stay faithful to the dialogue at the topic level.** Only include topics actually touched in the conversation; do not introduce a topic just because a chapter name suggests it.",
  "- Simple test: a student reading only these notes should think \"yes, this is what we just discussed\" — richer in detail, but not foreign.",
  SHARED_RULES_EN
].join("\n");

// ---- reduce: chunk evidence -> complete note (§3.4) -----------------------

var REDUCE_ZH = [
  "你是一个高质量的课堂笔记整理助手。用户会给你**多个片段的结构化证据 JSON**（不是原始课堂对话）。",
  "",
  "你的任务：把这些证据合并成一份像优秀学生课堂笔记的概念卡。",
  "",
  "输出结构：",
  "",
  "{",
  '  "pagesRange": "本次覆盖的页码范围，如未提及则为 null",',
  '  "sections": [ ... 有序 section 数组 ... ]',
  "}",
  "",
  SECTION_SPEC_ZH,
  "",
  "硬性规则：",
  "- **主题只能来自证据 JSON**。证据里没有的主题一律不许出现。",
  "- **合并重复概念**：同一个概念在不同片段里出现多次也只写一次，不要按片段机械堆叠。",
  "- **控制体量**：concepts 总共 10～16 条——证据里同族或相邻的 topic 合成一条；每条 body 2～5 行、不超过 200 字；`key-terms` 不超过 10 条。正文总长以上面的目标篇幅为准，宁可精炼。证据超过 6 个片段时可放宽到 20 条。",
  "- **概念名沿用证据里的 topic 名**（合并时保留各自的关键词），不要改写成证据里没有的新说法。",
  "- **`notes` 逐条落实 `learnerEvidence`**：学习者的误区/困惑/理解转变要按原话或忠实概括一条一条写出来（带 kind 标签），不要压缩成三言两语。",
  "- 优先保留学习者的误区、困惑与理解转变，以及伙伴给出的关键解释、例子、公式和边界条件。",
  "- 证据里的 `learnerEvidence` 应体现在 `notes` 或相应概念正文中，不要丢掉。",
  SHARED_RULES_ZH
].join("\n");

var REDUCE_EN = [
  "You are a high-quality lesson notes assistant. The user gives you the **structured evidence JSON of several slices** (not the raw dialogue).",
  "",
  "Your job: merge that evidence into a concept card that reads like **a strong student's class notes**.",
  "",
  "Output shape:",
  "",
  "{",
  '  "pagesRange": "Pages covered, or null",',
  '  "sections": [ ... ordered array of section objects ... ]',
  "}",
  "",
  SECTION_SPEC_EN,
  "",
  "Hard rules:",
  "- **Topics may only come from the evidence JSON.** Never introduce a topic it does not contain.",
  "- **Merge duplicate concepts** — one concept appears once, never once per slice.",
  "- **Keep it compact**: 10-16 concepts in total — merge same-family or neighbouring topics; each body 2-5 lines and under ~200 characters; at most 10 `key-terms`. Respect the target length above; prefer concise. With more than six slices you may go up to 20.",
  "- **Reuse the evidence topic names** as concept names (keep their keywords when merging) instead of inventing wording the evidence does not use.",
  "- **Put every `learnerEvidence` item into `notes`**, one line each, quoting or faithfully paraphrasing the learner (keep the kind label). Do not compress it into two sentences.",
  "- Prioritise the learner's misconceptions, confusion and shifts, plus the companion's key explanations, examples, formulas and edge cases.",
  "- Fold `learnerEvidence` into a `notes` section or the relevant concept body; do not drop it.",
  SHARED_RULES_EN
].join("\n");

// ---- map: one slice -> evidence only (§3.3) -------------------------------

var MAP_ZH = [
  "你是一个课堂证据提取器。用户会给你一节课堂对话的**一个片段**。",
  "",
  "你的唯一任务：把这个片段里真实发生过的内容抽成结构化证据。**不要写笔记、不要润色、不要补充片段之外的知识。**",
  "",
  "严格按下面的 JSON 结构输出：",
  "",
  "{",
  '  "topics": [ { "name": "主题名", "facts": ["对话里陈述过的事实/定义/结论"], "examples": ["对话里的例子、公式、代码或边界情况"], "sourceMessageIndexes": [编号] } ],',
  '  "learnerEvidence": [ { "kind": "' + KIND_VOCAB + '", "content": "学习者原话或忠实概括", "sourceMessageIndexes": [编号] } ],',
  '  "keyInsights": [ { "content": "学习者自己说出的关键结论", "sourceMessageIndexes": [编号] } ],',
  '  "openQuestions": [ { "content": "片段里未被解决的问题", "sourceMessageIndexes": [编号] } ],',
  '  "reviewCandidates": [ { "question": "可考查本片段重点的问题", "answer": "参考答案", "sourceMessageIndexes": [编号] } ]',
  "}",
  "",
  "硬性规则：",
  "1. 每条证据都必须带 `sourceMessageIndexes`，编号来自对话正文每行开头的 `[n]`。**不要编造编号。**",
  "2. 只记录这段对话**真的说过**的内容。教材标题、章节名、你的背景知识都不算。",
  "3. `learnerEvidence.kind` 只能取 " + KIND_VOCAB + " 之一。",
  "4. 没有内容的数组留空数组 `[]`，不要写 null。",
  "5. 事实与例子要短句、可核对；不要合并成一大段。",
  "6. 只输出 JSON，前后不要任何解释或代码块。",
  "",
  "所有数学符号、公式、变量都要写成 \\(...\\) 或 \\[...\\]，JSON 字符串里的反斜杠必须双写。"
].join("\n");

var MAP_EN = [
  "You are a classroom evidence extractor. The user gives you **one slice** of a tutor-learner dialogue.",
  "",
  "Your only job: turn what actually happened in the slice into structured evidence. **Do not write notes, do not polish, do not add knowledge from outside the slice.**",
  "",
  "Output strict JSON in exactly this shape:",
  "",
  "{",
  '  "topics": [ { "name": "Topic name", "facts": ["Facts / definitions / conclusions actually stated"], "examples": ["Examples, formulas, code or edge cases given"], "sourceMessageIndexes": [numbers] } ],',
  '  "learnerEvidence": [ { "kind": "' + KIND_VOCAB + '", "content": "The learner\'s own words or a faithful paraphrase", "sourceMessageIndexes": [numbers] } ],',
  '  "keyInsights": [ { "content": "A conclusion the learner stated themselves", "sourceMessageIndexes": [numbers] } ],',
  '  "openQuestions": [ { "content": "Something left unresolved in this slice", "sourceMessageIndexes": [numbers] } ],',
  '  "reviewCandidates": [ { "question": "A question that tests this slice", "answer": "Reference answer", "sourceMessageIndexes": [numbers] } ]',
  "}",
  "",
  "Hard rules:",
  "1. Every evidence item MUST carry `sourceMessageIndexes` taken from the `[n]` prefix of each transcript line. **Never invent an index.**",
  "2. Record only what this dialogue **actually said**. Textbook titles, chapter names and your own background knowledge do not count.",
  "3. `learnerEvidence.kind` must be one of " + KIND_VOCAB + ".",
  "4. Use an empty array `[]` for anything with no content — never null.",
  "5. Keep facts and examples short and checkable; do not merge them into a paragraph.",
  "6. Output ONLY the JSON — no preamble, no code fence.",
  "",
  "Write math as \\(...\\) or \\[...\\] and double every backslash inside JSON strings."
].join("\n");

// ---- repair: targeted fix of an invalid note (§6.2) -----------------------

var REPAIR_ZH = [
  "你之前生成的课堂笔记 JSON 没有通过结构校验。下面给你**原始证据**和**不合格的笔记 JSON**。",
  "",
  "请只做定向修复：",
  "1. 删掉所有在证据里找不到来源的概念与结论；",
  "2. 给缺来源的 concept 与 key-insight 补上正确的 `sourceMessageIndexes`，补不上就删除该条；",
  "3. 修掉结构问题（未知 section type、空 items、缺字段）；",
  "4. **不要新增证据里没有的内容**，不要改动已经正确的部分。",
  "",
  "只输出修复后的完整 JSON，前后不要任何解释或代码块。"
].join("\n");

var REPAIR_EN = [
  "Your previous notes JSON failed structural validation. Below are the **original evidence** and the **invalid notes JSON**.",
  "",
  "Apply a targeted repair only:",
  "1. Remove any concept or conclusion that cannot be sourced from the evidence;",
  "2. Give every concept and key-insight correct `sourceMessageIndexes`, or delete the item if you cannot;",
  "3. Fix structural problems (unknown section types, empty items, missing fields);",
  "4. **Add nothing that is not in the evidence** and do not alter what is already correct.",
  "",
  "Output ONLY the repaired JSON — no preamble, no code fence."
].join("\n");

var SYSTEMS = {
  map: { chinese: MAP_ZH, "chinese-traditional": MAP_ZH, english: MAP_EN },
  direct: { chinese: DIRECT_ZH, "chinese-traditional": DIRECT_ZH, english: DIRECT_EN },
  reduce: { chinese: REDUCE_ZH, "chinese-traditional": REDUCE_ZH, english: REDUCE_EN },
  repair: { chinese: REPAIR_ZH, "chinese-traditional": REPAIR_ZH, english: REPAIR_EN }
};

function systemFor(stage, language) {
  var table = SYSTEMS[stage] || SYSTEMS.reduce;
  return table[language] || table.chinese;
}

function headerLines(input) {
  var opts = input || {};
  var english = opts.language === "english";
  var lines = [];
  if (opts.companionName) lines.push((english ? "Companion: " : "学习伙伴：") + opts.companionName);
  if (opts.textbookTitle) lines.push((english ? "Textbook: " : "教材：") + opts.textbookTitle);
  if (opts.targetRange && opts.targetRange.max) {
    lines.push(english
      ? "Target length: roughly " + opts.targetRange.min + "-" + opts.targetRange.max + " " + opts.targetRange.unit + " of visible prose. Do not pad to reach it."
      : "目标篇幅：正文大约 " + opts.targetRange.min + "～" + opts.targetRange.max + " " + (opts.targetRange.unit === "words" ? "词" : "字") + "。不要为凑长度而注水。");
  }
  return lines;
}

function mapUserContent(input) {
  var opts = input || {};
  var english = opts.language === "english";
  return headerLines(opts).concat([
    english ? "Slice " + opts.chunkId + " of the lesson:" : "课堂片段 " + opts.chunkId + "：",
    "",
    opts.transcript || ""
  ]).join("\n");
}

function directUserContent(input) {
  var opts = input || {};
  var english = opts.language === "english";
  return headerLines(opts).concat([
    english ? "Complete lesson dialogue:" : "完整课堂对话：",
    "",
    opts.transcript || ""
  ]).join("\n");
}

function reduceUserContent(input) {
  var opts = input || {};
  var english = opts.language === "english";
  return headerLines(opts).concat([
    english
      ? "Evidence JSON from " + (opts.chunkCount || 0) + " slice(s):"
      : "以下是 " + (opts.chunkCount || 0) + " 个片段的结构化证据 JSON：",
    "",
    JSON.stringify(opts.evidence || [], null, 2)
  ]).join("\n");
}

function repairUserContent(input) {
  var opts = input || {};
  return [
    "# evidence",
    JSON.stringify(opts.evidence || [], null, 2),
    "",
    "# invalid notes",
    String(opts.raw || "").slice(0, 12000),
    "",
    "# allowed section types",
    schema.SECTION_TYPES.join(", ")
  ].join("\n");
}

module.exports = {
  KIND_VOCAB: KIND_VOCAB,
  SECTION_SPEC_ZH: SECTION_SPEC_ZH,
  SECTION_SPEC_EN: SECTION_SPEC_EN,
  systemFor: systemFor,
  languageSuffix: languageSuffix,
  mapUserContent: mapUserContent,
  directUserContent: directUserContent,
  reduceUserContent: reduceUserContent,
  repairUserContent: repairUserContent
};
