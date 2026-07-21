const path = require('path')
const KBQuality = require('./lib/kb-quality.js')

const dir = path.join(__dirname)

process.env.NODE_ENV = 'production'
process.chdir(__dirname)

// Load settings.json for API configuration
;(function(){var f=require("fs");var p=require("path");var s=p.join(process.env.CONTENT_ROOT||"","..","settings.json");function norm(S){S=S||{};var endpoint=S.endpoint||S.baseUrl||"https://api.nwafu-ai.cn/v1";var keys=S.apiKeys||{};function fill(name,defKeyGroup){var b=S[name]||{};b.baseUrl=b.baseUrl||endpoint;b.apiKey=b.apiKey||keys[b.apiKeyGroup]||keys[defKeyGroup]||"";b.models=b.models||{};S[name]=b;return b}var gpt=fill("gpt","codex"),other=S.other;if(other){other.baseUrl=other.baseUrl||endpoint;other.apiKey=other.apiKey||keys[other.apiKeyGroup]||keys.codex||"";other.models=other.models||{}}S.openai=S.openai||gpt;S.deepseek=S.deepseek||gpt;return S}try{var r=f.readFileSync(s,"utf-8");global.__SOCRATOPIA_SETTINGS__=norm(JSON.parse(r));console.log("[settings] Loaded from "+s+" (normalized)") }catch(e){console.warn("[settings] Could not load "+s+": "+e.message+", using defaults");global.__SOCRATOPIA_SETTINGS__=norm({endpoint:"https://api.nwafu-ai.cn/v1",apiKeys:{codex:""},gpt:{models:{}},proxyUrl:"",rulesUrl:""})}})();
// Load set.json for teaching model config (strong=切页/闪卡/总结, weak=教学对话). Falls back to settings.json blocks when absent.
;(function(){var f=require("fs");var p=require("path");var s=p.join(process.env.CONTENT_ROOT||"","..","set.json");function pickProvider(S,preferred){var n=(preferred||"gpt").toLowerCase();if(S[n])return n;if(("openai"===n||"gpt"===n)&&S.gpt)return"gpt";if(("deepseek"===n||"gemini"===n||"other"===n)&&S.other)return"other";if(S.gpt)return"gpt";if(S.other)return"other";return n}function apiTypeForProvider(provider){return provider==="gpt"?"openai":provider}function firstModel(m){if(!m)return"";var v=Object.values(m);return v&&v.length?v[0]:""}function pickModel(block,key){var m=block&&block.models||{};return key&&m[key]||m.gpt||m.openai||m.deepseek||m.gemini||firstModel(m)}function normalize(raw,modelKey){raw=raw||{};var S=global.__SOCRATOPIA_SETTINGS__||{};var provider=pickProvider(S,raw.group||raw.provider);var block=S[provider]||{};var envKey=process.env.SOCRATOPIA_OPENAI_API_KEY||"";var out={};Object.keys(raw).forEach(function(k){out[k]=raw[k]});out.group=out.group||provider;out.apiType=out.apiType||apiTypeForProvider(out.group);out.baseUrl=out.baseUrl||block.baseUrl||S.endpoint||"";out.apiKey=out.apiKey||envKey||block.apiKey||"";out.model=out.model||pickModel(block,modelKey||provider)||"";return out}try{var r=f.readFileSync(s,"utf-8");var cfg=JSON.parse(r);global.__SOCRATOPIA_SET__={};Object.keys(cfg).forEach(function(k){global.__SOCRATOPIA_SET__[k]=cfg[k]});global.__SOCRATOPIA_SET__.strong=normalize(cfg.strong,"strong");cfg.kb&&(global.__SOCRATOPIA_SET__.kb=normalize(cfg.kb,"kb"));global.__SOCRATOPIA_SET__.weak=normalize(cfg.weak,"weak");cfg.vision&&(global.__SOCRATOPIA_SET__.vision=normalize(cfg.vision,"gemini"));cfg.premium&&(global.__SOCRATOPIA_SET__.premium=normalize(cfg.premium,"premium"));console.log("[set] Loaded from "+s+" (normalized)")}catch(e){global.__SOCRATOPIA_SET__={strong:normalize({group:"gpt"},"strong"),weak:normalize({group:"gpt"},"weak")};console.warn("[set] Could not load "+s+": "+e.message+", derived from settings.json")}})();
// __KB_DISTILL__: 切页时把窗口原文提炼成"已核实知识"块。
// 优先用教材已建知识库(knowledge_base/index.json + cards/),否则用 set.strong 现场提炼。
// 任意失败都回退返回原文,保证教学链路绝不中断。失败/无强模型时返回 null,调用方用原文。
// 内存缓存中间件(下方包装):相同窗口不重复提炼;并发调用(chat 切页 + jump-page 同窗口)合并为一次。
async function __KB_DISTILL_IMPL__(rawText, startPage, endPage, textbookDir, resumeState) {
  try {
    var fs = require("fs"), path = require("path");
    if (!rawText || !rawText.trim()) return null;

    var __RESUME__ = global.__RESUME__ || null;
    var distillStartPage = startPage;
    var distillEndPage = endPage;

    function pageRangeText() {
      return distillStartPage + "-" + distillEndPage;
    }

    function pageKindLabel() {
      try {
        var mf = path.join(textbookDir, "pages.json");
        if (fs.existsSync(mf)) {
          var manifest = JSON.parse(fs.readFileSync(mf, "utf-8"));
          if (manifest && manifest.format === "markdown") return "Markdown 逻辑页/分段";
          if (manifest && manifest.format === "pptx") return "幻灯片页";
          if (manifest && manifest.format === "epub") return "电子书逻辑页";
        }
      } catch (e) {}
      return "教材页";
    }

    function pageTitleHint() {
      try {
        var mf = path.join(textbookDir, "pages.json");
        if (!fs.existsSync(mf)) return "";
        var manifest = JSON.parse(fs.readFileSync(mf, "utf-8"));
        var pages = Array.isArray(manifest && manifest.pages) ? manifest.pages : [];
        var seen = {}, titles = [];
        pages.forEach(function (p) {
          var n = Number(p.pageNum || p.page);
          var title = (p.title || "").trim();
          if (!title || !n || n < distillStartPage || n > distillEndPage || seen[title]) return;
          seen[title] = true;
          titles.push("p." + n + " " + title.slice(0, 60));
        });
        if (!titles.length) return "";
        return "页码/分段标题: " + titles.slice(0, 6).join("; ");
      } catch (e) {
        return "";
      }
    }

    function renderCards(cards, teachingMap) {
      if (!cards || !cards.length) return null;
      // 如果有教学地图,按 phase 分组渲染;否则回退为全量平铺
      if (teachingMap && teachingMap.sequence && teachingMap.sequence.length) {
        var cardMap = {}; cards.forEach(function (c) { if (c.concept_id) cardMap[c.concept_id] = c; if (c.title) cardMap[c.title] = c; });
        // 由续课状态定位焦点阶段;无续课状态时用窗口起点定位，仍无法定位才退回阶段 1。
        var focusState = resumeState || (startPage ? { lastTaughtPage: startPage, currentPage: startPage, explicitStartPage: true } : null);
        var focus = (__RESUME__ && focusState) ? __RESUME__.focusFromState(teachingMap, cardMap, focusState) : null;
        var focusIdx = (focus && typeof focus.phaseIndex === "number") ? focus.phaseIndex : 0;
        var completedSet = (focus && focus.completedSet) ? focus.completedSet : {};
        var lastFocusText = focus ? focus.lastFocusText : null;
        var lastTaughtPage = focus ? focus.lastTaughtPage : null;
        var resumed = !!(resumeState && (focus && (focus.phaseIndex !== null || lastTaughtPage != null)));
        function phaseVisibleIds(phase) {
          return (phase.card_ids || []).filter(function (cid) { return !!cardMap[cid]; });
        }
        if (!phaseVisibleIds(teachingMap.sequence[focusIdx] || {}).length) {
          for (var visiblePi = 0; visiblePi < teachingMap.sequence.length; visiblePi++) {
            if (phaseVisibleIds(teachingMap.sequence[visiblePi]).length) {
              focusIdx = visiblePi;
              break;
            }
          }
        }
        var orderedQueue = [];
        teachingMap.sequence.forEach(function (phase, pi) {
          phaseVisibleIds(phase).forEach(function (cid, ci) {
            orderedQueue.push({ cid: cid, phaseIndex: pi, cardIndex: ci });
          });
        });
        var currentQueueIndex = (focus && typeof focus.queueIndex === "number") ? focus.queueIndex : -1;
        if (currentQueueIndex < 0 || currentQueueIndex >= orderedQueue.length) {
          currentQueueIndex = orderedQueue.findIndex(function (entry) { return entry.phaseIndex === focusIdx; });
          if (currentQueueIndex < 0) currentQueueIndex = 0;
        }
        var expandedQueue = orderedQueue.slice(currentQueueIndex, currentQueueIndex + 3);
        var expandedLookup = {};
        expandedQueue.forEach(function (entry, index) { expandedLookup[entry.cid] = index + 1; });
        var activeConceptId = expandedQueue.length
          ? String((cardMap[expandedQueue[0].cid] && cardMap[expandedQueue[0].cid].concept_id) || expandedQueue[0].cid)
          : null;
        var parts = ["## 教学地图（第 " + pageRangeText() + " 页）"];
        function expandCard(cid, queueIndex, queueTotal) {
          var c = cardMap[cid]; if (!c) return;
          var b = ["#### " + (c.title || cid), "*[本轮可见队列 " + queueIndex + "/" + queueTotal + " · concept_id: " + (c.concept_id || cid) + "]*"];
          if (c.definition) b.push(c.definition);
          if (c.key_points && c.key_points.length) b.push("要点:\n- " + c.key_points.join("\n- "));
          if (c.examples && c.examples.length) b.push("示例:\n- " + c.examples.join("\n- "));
          if (c.misconceptions && c.misconceptions.length) b.push("常见误区:\n- " + c.misconceptions.join("\n- "));
          if (c.qa_pairs && c.qa_pairs.length) b.push("自测:\n" + c.qa_pairs.map(function (q) { return "Q: " + q.q + "\nA: " + q.a; }).join("\n"));
          parts.push(b.join("\n"));
        }
        teachingMap.sequence.forEach(function (phase, pi) {
          var phaseLabel = "### 阶段 " + (pi + 1) + ": " + (phase.label || "");
          var visibleCardIds = phaseVisibleIds(phase);
          if (!visibleCardIds.length) return;
          if (pi < focusIdx || completedSet[pi]) {
            // 已学过的阶段:折叠,标注已学,除非学生主动要求不重讲
            var titlesDone = visibleCardIds.map(function (cid) { var c = cardMap[cid]; return c ? c.title : cid; });
            parts.push(phaseLabel + "\n*(上一节课已学过，除非学生主动要求，不要重讲)* 涉及: " + titlesDone.join(", "));
          } else {
            var expandedHere = visibleCardIds.filter(function (cid) { return !!expandedLookup[cid]; });
            var hiddenHere = visibleCardIds.filter(function (cid) { return !expandedLookup[cid]; });
            if (expandedHere.length) {
              parts.push(phaseLabel + "\n" + (pi === focusIdx ? "**[当前教学焦点 / 队列起点]**" : "**[紧邻后续教学队列]**") + " 目标: " + (phase.teach_goal || ""));
              expandedHere.forEach(function (cid) { expandCard(cid, expandedLookup[cid], expandedQueue.length); });
              if (hiddenHere.length) {
                var laterTitles = hiddenHere.map(function (cid) { var c = cardMap[cid]; return c ? c.title : cid; });
                parts.push("本阶段稍后内容（当前不要展开）: " + laterTitles.join(", "));
              }
              if (phase.branches && phase.branches.length) parts.push("可延伸方向: " + phase.branches.join("; "));
            } else {
              var titles = visibleCardIds.map(function (cid) { var c = cardMap[cid]; return c ? c.title : cid; });
              parts.push(phaseLabel + "\n目标: " + (phase.teach_goal || "") + "\n涉及: " + titles.join(", ") + "\n*(完成当前可见队列后再展开)*");
            }
          }
        });
        var focusNo = focusIdx + 1;
        var pageKind = pageKindLabel();
        var pageHint = pageTitleHint();
        if (pageKind !== "教材页") parts.splice(1, 0, "*页码说明: 第 " + pageRangeText() + " 页是" + pageKind + ", 用于课堂定位、进度记录和自动续读。*");
        if (pageHint) parts.splice(pageKind !== "教材页" ? 2 : 1, 0, "*" + pageHint + "*");
        var resumeNote = "";
        if (resumed && focus && focus.phaseIndex !== null) {
          resumeNote = "\n0. 续课提示:根据上一节课进度，当前焦点是【阶段 " + focusNo + "】" + (lastTaughtPage != null ? "（上一节课实际教学到第 " + lastTaughtPage + " 页）" : "") + "。标注\"已学过\"的前序阶段不要重讲，除非学生主动要求。";
        } else if (resumeState) {
          resumeNote = "\n0. 续课提示:根据上一节课进度" + (lastTaughtPage != null ? "（约到第 " + lastTaughtPage + " 页" + (lastFocusText ? "，上次焦点:" + lastFocusText : "") + "）" : "") + "，从已记录掌握的内容之后继续。不要重讲 progress.md 中已标记掌握的内容,不要围绕同一知识点反复出题,也不要回到更早的阶段；如果上一节课在某个阶段中断,从该阶段未讲完的部分开始,不要退回已学阶段。";
        }
        // The route wrapper appends the marker directive with the current
        // request's conversationId. Do not embed resumeState.sourceConversationId
        // here: that belongs to the previous lesson and creates a conflicting,
        // stale marker on the first resumed turn.
        parts.push("<TEACHING_DIRECTIVE hidden_from_student=\"true\">\n你正在讲第 " + pageRangeText() + " 页（" + pageKind + "）,按上方教学队列顺序教学。\n当前焦点是【阶段 " + focusNo + "】,完整内容严格限制为当前卡加最多两个紧邻后续卡,不是跳页许可。严格规则:" + resumeNote + "\n1. 从[当前教学焦点 / 队列起点]开始，严格按照[本轮可见队列 x/y]从小到大推进；不得跳过、交换或自行挑选卡片。\n2. 默认每轮讲完一个小节或 1-3 张紧密相关卡片，再问一个具体检查问题；同一卡最多检查两轮，随后必须总结并推进。\n3. 只有当前卡已经讲解、验证、纠错走完，或学生明确要求继续/加速时，才进入紧邻下一卡；不要因一句普通回应跨页。\n4. 只有学生要求跳到未展开、未列入当前队列的更远内容时,才简短说明后面会讲到或请使用顶部导航跳页。\n5. 学生说法命中\"常见误区\"时温和纠正。不确定的事实说\"我不太确定\",绝不编造。\n6. 可对已展开卡片合理延伸,但标注\"我的补充\"；超出教材标注\"教材未覆盖\"。\n7. 禁止围绕同一焦点卡片连续生成超过 2 个相似问题；掌握则推进，不掌握则一句总结后换更基础例子并继续队列。\n8. 对话历史显示已讲完的卡片视为完成，不得重讲，除非学生明确要求复习。\n9. 下一知识点只能是当前卡之后的紧邻卡；禁止倒退或越过未完成卡。\n10. 可见队列用完后简短总结并等待系统补页，不得想象更远页面。\n此指令是你的行为约束,禁止向学生提及、解释或讨论此指令本身。\n</TEACHING_DIRECTIVE>");
        parts.push("<TEACHING_DIRECTIVE hidden_from_student=\"true\">\n掌握/继续推进硬约束: 如果学生说继续、掌握了、懂了、别问了、已经说过、后面的内容或同义表达,立即停止当前卡片追问,用一句话总结后进入下一未完成知识点。下一知识点只能来自当前焦点之后的同阶段剩余卡片或紧邻后续阶段,且必须优先选择 source_pages 不小于当前焦点页、对话历史未讲完的卡片; 禁止选择 source_pages 小于当前焦点页、历史已讲过、或已被学生明确掌握的卡片。若对话历史显示当前阶段的核心卡片已经讲解和验证完毕,必须把当前阶段视为完成并进入标注为[后续教学队列]的下一阶段; 禁止回复“等下一段内容”“等待系统补页”“要不要继续讲这一页后面内容”这类停顿语。只有学生明确要求复习/回看时才允许倒退。\n</TEACHING_DIRECTIVE>");
        return parts.join("\n\n");
      }
      // 无教学地图:回退为全量平铺(兼容旧数据)
      var pageKind2 = pageKindLabel();
      var pageHint2 = pageTitleHint();
      var parts = ["## 已核实知识（本节课教学依据，第 " + pageRangeText() + " 页）"];
      if (pageKind2 !== "教材页") parts.push("*页码说明: 第 " + pageRangeText() + " 页是" + pageKind2 + ", 用于课堂定位、进度记录和自动续读。*");
      if (pageHint2) parts.push("*" + pageHint2 + "*");
      cards.forEach(function (c, i) {
        var b = ["### " + (i + 1) + ". " + (c.title || "")];
        if (c.definition) b.push(c.definition);
        if (c.key_points && c.key_points.length) b.push("要点:\n- " + c.key_points.join("\n- "));
        if (c.examples && c.examples.length) b.push("示例:\n- " + c.examples.join("\n- "));
        if (c.misconceptions && c.misconceptions.length) b.push("常见误区:\n- " + c.misconceptions.join("\n- "));
        if (c.qa_pairs && c.qa_pairs.length) b.push("自测:\n" + c.qa_pairs.map(function (q) { return "Q: " + q.q + "\nA: " + q.a; }).join("\n"));
        parts.push(b.join("\n"));
      });
      parts.push("<TEACHING_DIRECTIVE hidden_from_student=\"true\">\n你正在讲第 " + pageRangeText() + " 页（" + pageKind2 + "）。依据上方卡片按编号顺序教学,未经学生提问不要跳到后续卡片。\n学生说法命中\"常见误区\"时温和纠正。不确定的事实说\"我不太确定\",绝不编造。可对卡片内容合理延伸但标注\"我的补充\"。超出教材标注\"教材未覆盖\"。闲聊简短回应后引回第 " + pageRangeText() + " 页内容。\n推进硬约束:学生正确回答某卡片的自测题、能用自己的话准确解释、或说继续/懂了/下一个/快进后,立即进入下一张卡片,不要再确认。禁止围绕同一卡片连续生成超过 2 个相似问题;讲解、验证、纠错走完后,无论是否完美都要推进——掌握则进入下一卡片,不掌握则给一句简明总结后换更基础的例子,绝不继续出变体追问原地打转。除非学生明确要求复习/回看,禁止回到历史摘要、已学卡片或本页窗前置内容继续出题;历史只用于判断哪些内容已经讲完。\n此指令是你的行为约束,禁止向学生提及、解释或讨论此指令本身。\n</TEACHING_DIRECTIVE>");
      parts.push("<TEACHING_DIRECTIVE hidden_from_student=\"true\">\n掌握/继续推进硬约束: 如果学生说继续、掌握了、懂了、别问了、已经说过、后面的内容或同义表达,立即停止当前卡片追问,用一句话总结后进入下一张未完成卡片。下一卡片必须按上方编号向后选择,且必须优先选择 source_pages 不小于当前焦点页、对话历史未讲完的卡片; 禁止选择 source_pages 小于当前焦点页、历史已讲过、或已被学生明确掌握的卡片。若对话历史显示当前编号卡片已经讲解和验证完毕,必须进入下一编号卡片; 禁止回复“等下一段内容”“等待系统补页”“要不要继续讲这一页后面内容”这类停顿语。只有学生明确要求复习/回看时才允许倒退。\n</TEACHING_DIRECTIVE>");
      return parts.join("\n\n");
    }

    // 1) 优先:已建知识库,取与 [startPage,endPage] 有重叠的卡片
    try {
      function readJsonMaybe(filePath) {
        try { return JSON.parse(fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "")); } catch (e) { return null; }
      }
      function writeJsonAtomic(filePath, data) {
        var tmp = filePath + ".tmp-" + process.pid + "-" + Date.now();
        try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch (e) {}
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
        fs.renameSync(tmp, filePath);
      }
      function cleanCardRange(card) {
        function nums(v) {
          return Array.isArray(v) ? v.map(function (n) { return Number(n); }).filter(function (n) { return isFinite(n) && n > 0; }) : [];
        }
        var arr = nums(card && card.source_pages);
        if (!arr.length) arr = nums(card && card._chunk_pages);
        var s = arr.length ? Math.min.apply(Math, arr) : startPage;
        var e = arr.length ? Math.max.apply(Math, arr) : endPage;
        if (!isFinite(s) || s <= 0) s = startPage || 1;
        if (!isFinite(e) || e <= 0) e = s;
        if (e < s) { var t = s; s = e; e = t; }
        if (card) card.source_pages = [s, e];
        return [s, e];
      }
      function sortCards(cards) {
        (cards || []).forEach(function (card) { cleanCardRange(card); });
        return KBQuality.sortCards(cards);
      }
      function loadCardFiles(cardsDir) {
        if (!fs.existsSync(cardsDir)) return [];
        return sortCards(fs.readdirSync(cardsDir).filter(function (name) { return /\.json$/i.test(name); }).map(function (name) {
          var card = readJsonMaybe(path.join(cardsDir, name));
          if (!card || typeof card !== "object") return null;
          if (!card.concept_id) card.concept_id = name.replace(/\.json$/i, "");
          cleanCardRange(card);
          return card;
        }).filter(Boolean));
      }
      function fallbackTeachingMap(cards) {
        cards = sortCards(cards);
        if (!cards.length) return null;
        var segments = [];
        for (var i = 0; i < cards.length; i += 16) {
          var seg = cards.slice(i, i + 16);
          var segStart = Math.min.apply(Math, seg.map(function (c) { return cleanCardRange(c)[0]; }));
          var segEnd = Math.max.apply(Math, seg.map(function (c) { return cleanCardRange(c)[1]; }));
          var phaseCount = Math.max(1, Math.min(5, Math.ceil(seg.length / 4)));
          var phaseSize = Math.max(1, Math.ceil(seg.length / phaseCount));
          var sequence = [];
          for (var j = 0; j < seg.length; j += phaseSize) {
            var group = seg.slice(j, j + phaseSize);
            var ps = Math.min.apply(Math, group.map(function (c) { return cleanCardRange(c)[0]; }));
            var pe = Math.max.apply(Math, group.map(function (c) { return cleanCardRange(c)[1]; }));
            sequence.push({
              phase: sequence.length + 1,
              label: "\u7b2c " + ps + "-" + pe + " \u9875",
              card_ids: group.map(function (c) { return c.concept_id; }),
              teach_goal: "\u6309\u6559\u6750\u9875\u5e8f\u8bb2\u6e05\u672c\u9636\u6bb5\u77e5\u8bc6\u70b9\u3002",
              branches: []
            });
          }
          segments.push({ page_range: [segStart, segEnd], sequence: sequence, generated_by: "runtime-repair" });
        }
        return { version: 3, ordering: "chunk-ordinal-then-source-page", generated_at: new Date().toISOString(), segments: segments, fallback_segments: segments.length };
      }
      function ensureKbArtifacts() {
        var kbDir = path.join(textbookDir, "knowledge_base");
        var cardsDir = path.join(kbDir, "cards");
        var idxPath0 = path.join(kbDir, "index.json");
        var tmPath0 = path.join(kbDir, "teaching_map.json");
        var status0 = readJsonMaybe(path.join(kbDir, "build_status.json"));
        if (status0 && status0.state !== "done") {
          console.log("[kb] build state=" + status0.state + "; refusing to recover partial index/map");
          return;
        }
        if ((fs.existsSync(idxPath0) && fs.existsSync(tmPath0)) || !fs.existsSync(cardsDir)) return;
        var cards = loadCardFiles(cardsDir);
        if (!cards.length) return;
        var recovered = false;
        if (!fs.existsSync(idxPath0)) {
          var now = new Date().toISOString();
          writeJsonAtomic(idxPath0, {
            textbook: "",
            title: "",
            lang: "zh",
            built_at: now,
            updated_at: now,
            recovered_from_cards: true,
            card_count: cards.length,
            needs_verification_count: cards.filter(function (c) { return !!c.needs_verification; }).length,
            cards: cards.map(function (c) {
              return { concept_id: c.concept_id, title: c.title || "", difficulty: c.difficulty, source_pages: cleanCardRange(c), needs_verification: !!c.needs_verification };
            })
          });
          recovered = true;
        }
        if (!fs.existsSync(tmPath0)) {
          var tmap0 = fallbackTeachingMap(cards);
          if (tmap0) { writeJsonAtomic(tmPath0, tmap0); recovered = true; }
        }
        if (recovered) {
          try {
            writeJsonAtomic(path.join(kbDir, "build_status.json"), {
              state: "partial",
              recovered_from_cards: true,
              cardCount: cards.length,
              hasTeachingMap: fs.existsSync(tmPath0),
              activationEligible: false,
              updatedAt: new Date().toISOString()
            });
          } catch (e) {}
          console.log("[kb] recovered knowledge_base artifacts from cards: " + cards.length);
        }
      }
      ensureKbArtifacts();
        var idxPath = path.join(textbookDir, "knowledge_base", "index.json");
        var kbStatus = readJsonMaybe(path.join(textbookDir, "knowledge_base", "build_status.json"));
        var legacyTerminalRatio = 0;
        if (kbStatus && Array.isArray(kbStatus.log)) {
          var legacyDone = kbStatus.log.filter(function (event) { return event && event.type === "chunk_done"; });
          var legacyNone = legacyDone.filter(function (event) { return event && event.method === "none"; });
          legacyTerminalRatio = legacyDone.length ? legacyNone.length / legacyDone.length : 0;
        }
        var legacyMapDegraded = false;
        try {
          var legacyTm = readJsonMaybe(path.join(textbookDir, "knowledge_base", "teaching_map.json"));
          legacyMapDegraded = !!(legacyTm && Array.isArray(legacyTm.segments) && legacyTm.segments.length && Number(legacyTm.fallback_segments) === legacyTm.segments.length);
        } catch (e0) {}
        var prebuiltBlocked = kbStatus && (kbStatus.state !== "done" || kbStatus.activationEligible === false ||
          (kbStatus.activationEligible == null && (legacyTerminalRatio >= 0.25 || legacyMapDegraded)));
        if (prebuiltBlocked) console.log("[kb] prebuilt KB unavailable while state=" + kbStatus.state + "; using live page text");
        if (fs.existsSync(idxPath) && !prebuiltBlocked) {
        var idx = JSON.parse(fs.readFileSync(idxPath, "utf-8"));
        // 尝试加载教学地图
        var tMap = null;
        var cardPageRangeByKey = {};
        (idx.cards || []).forEach(function (c) {
          var r = cleanCardRange(c);
          if (c.concept_id != null) cardPageRangeByKey[String(c.concept_id)] = r;
          if (c.title != null) cardPageRangeByKey[String(c.title)] = r;
        });
        function focusPageForMap() {
          var p = resumeState && (resumeState.lastTaughtPage || resumeState.currentPage || resumeState.windowStartPage);
          p = Number(p || startPage || 1);
          return isFinite(p) && p > 0 ? p : (startPage || 1);
        }
        function supplementedSegment(seg) {
          if (!seg || typeof seg !== "object") return seg;
          var s = null, e = null;
          var pr = seg.page_range;
          if (pr && pr.length >= 2) {
            var ps = Number(pr[0]), pe = Number(pr[1]);
            if (isFinite(ps) && ps > 0) s = ps;
            if (isFinite(pe) && pe > 0) e = pe;
          }
          (seg.sequence || []).forEach(function (phase) {
            (phase.card_ids || []).forEach(function (cid) {
              var r = cardPageRangeByKey[String(cid)];
              if (!r || r.length < 2) return;
              s = s == null ? r[0] : Math.min(s, r[0]);
              e = e == null ? r[1] : Math.max(e, r[1]);
            });
          });
          if (!(s > 0 && e > 0)) return seg;
          if (e < s) { var tmp = s; s = e; e = tmp; }
          if (pr && Number(pr[0]) === s && Number(pr[1]) === e) return seg;
          var copy = {};
          Object.keys(seg).forEach(function (k) { copy[k] = seg[k]; });
          copy.page_range = [s, e];
          copy._supplemented_page_range = true;
          return copy;
        }
        function selectTeachingMapSegment(segments) {
          var focusPage = focusPageForMap();
          var best = null, bestScore = -1, bestSpan = 999999;
          (segments || []).forEach(function (seg) {
            seg = supplementedSegment(seg);
            var pr = seg && seg.page_range;
            if (!pr || pr.length < 2) return;
            var s = Number(pr[0]), e = Number(pr[1]);
            if (!(isFinite(s) && isFinite(e) && s > 0 && e > 0)) return;
            if (e < s) { var tmp = s; s = e; e = tmp; }
            var overlapsWindow = s <= endPage && e >= startPage;
            var containsFocus = s <= focusPage && e >= focusPage;
            if (!overlapsWindow && !containsFocus) return;
            var os = Math.max(s, startPage), oe = Math.min(e, endPage);
            var overlap = oe >= os ? (oe - os + 1) : 0;
            var score = (containsFocus ? 1000 : 0) + (overlap ? 100 + overlap : 0) + (s <= startPage && e >= startPage ? 50 : 0) - Math.abs(s - startPage) / 100;
            var span = e - s;
            if (!best || score > bestScore || (score === bestScore && span < bestSpan)) {
              best = seg; bestScore = score; bestSpan = span;
            }
          });
          return best;
        }
        try {
          var tmPath = path.join(textbookDir, "knowledge_base", "teaching_map.json");
          if (fs.existsSync(tmPath)) {
            var tmAll = JSON.parse(fs.readFileSync(tmPath, "utf-8"));
            var tmSegments = tmAll.segments || [];
            var expectedMapIds = (idx.cards || []).map(function (card) { return String(card && card.concept_id || ""); }).filter(Boolean);
            var actualMapIds = [];
            tmSegments.forEach(function (seg) {
              (seg && seg.sequence || []).forEach(function (phase) {
                (phase && phase.card_ids || []).forEach(function (id) { actualMapIds.push(String(id || "")); });
              });
            });
            var needsOrderRepair = Number(tmAll.version || 0) < 3 || actualMapIds.length !== expectedMapIds.length ||
              actualMapIds.some(function (id, index) { return id !== expectedMapIds[index]; });
            if (needsOrderRepair) {
              var repairedMap = fallbackTeachingMap(loadCardFiles(path.join(textbookDir, "knowledge_base", "cards")));
              if (repairedMap) {
                tmAll = repairedMap;
                console.log("[kb] rebuilt legacy/fallback teaching map in memory using chunk ordinal order");
              }
            }
            // 查找与当前页范围匹配的地图段
            var segments = tmAll.segments || [tmAll];
            tMap = selectTeachingMapSegment(segments);
          }
        } catch (e2) { console.warn("[kb] 教学地图加载失败: " + e2.message); }
        var effectiveEndPage = endPage;
        var mapCardIds = null;
        if (tMap && tMap.page_range && tMap.page_range.length >= 2) {
          mapCardIds = {};
          (tMap.sequence || []).forEach(function (phase) {
            (phase.card_ids || []).forEach(function (cid) { if (cid != null) mapCardIds[String(cid)] = true; });
          });
          var me = Number(tMap.page_range[1]);
          if (isFinite(me) && me > 0) effectiveEndPage = Math.min(endPage, Math.max(startPage, me));
        } else {
          var maxPrebuiltPages = Math.max(4, Number(process.env.SOCRATOPIA_KB_PREBUILT_MAX_PAGES) || 12);
          if (endPage - startPage + 1 > maxPrebuiltPages) effectiveEndPage = startPage + maxPrebuiltPages - 1;
        }
        var hits = (idx.cards || []).filter(function (c) {
          if (mapCardIds && !(mapCardIds[String(c.concept_id)] || mapCardIds[String(c.title)])) return false;
          var sp = c.source_pages; if (!sp || sp.length < 2) return false;
          return sp[0] <= effectiveEndPage && sp[1] >= startPage;
        });
        var loaded = [];
        hits.forEach(function (c) {
          try { loaded.push(JSON.parse(fs.readFileSync(path.join(textbookDir, "knowledge_base", "cards", c.concept_id + ".json"), "utf-8"))); } catch (e) {}
        });
        distillEndPage = effectiveEndPage;
        var rendered = renderCards(loaded, tMap);
        if (rendered) {
          rendered = "<!-- kbRange: " + pageRangeText() + " -->\n" + rendered;
          try { global.__KB_DISTILL_LAST_RANGE__ = { startPage: distillStartPage, endPage: distillEndPage }; } catch (e3) {}
          console.log("[kb] prebuilt focused cards " + loaded.length + (tMap ? " +map" : "") + (tMap && tMap._supplemented_page_range ? "+range" : "") + " (teaching p." + pageRangeText() + ")");
          return rendered;
        }
        distillEndPage = endPage;
      }
    } catch (e) { console.warn("[kb] 读取已建库失败: " + e.message); }

    // 2) 兜底:用路由模型现场提炼(默认 mini,内容失败时升级 premium 一次;不写盘)
    var SET = global.__SOCRATOPIA_SET__ || {};
    var ROUTER = global.__MODEL_ROUTER__ || null;
    var S = SET.kb || SET.strong;
    if (!S || !S.baseUrl || !S.apiKey || !S.model) return null;
    var sys = "你是一名严谨的学科知识库构建专家,正在把一本教材的原文整理成\u201c已核实知识卡片\u201d。\n这些卡片将来会被一个能力较弱、较廉价的大模型直接用于教学,因此卡片必须:\n1. 准确——只依据给定原文,不臆造原文没有的内容;\n2. 自足——弱模型不读原文也能照卡片把这个知识点讲清楚;\n3. 可核实——凡是你对某条事实没有十足把握(可能是教材笔误、版本差异、记忆模糊),必须把该卡片的 needs_verification 置为 true,并在 verify_query 写出用于联网核实的检索式;\n4. 可渲染——涉及公式、矩阵、分段式、递推式、坐标、图形标注或表格化结构时,优先保留/改写为 Markdown LaTeX:行内用 $...$,独立公式用 $$...$$;矩阵用 \\begin{bmatrix}...\\end{bmatrix},对齐用 aligned/cases/array。不要用纯 ASCII 方框硬画数学结构,除非原文就是代码或命令。\n\n只用简体中文输出。";
    // 输入过大或 KB 超时时按页窗收窄，避免把教材原文直接按字符截断到半页。
    function splitPageBlocks(text) {
      var re = /---\s*(?:第\s*(\d+)\s*[页頁]|Page\s*(\d+))\s*---[^\n]*(?:\r?\n)?/g;
      var matches = [], m;
      while ((m = re.exec(text)) !== null) matches.push({ index: m.index, page: parseInt(m[1] || m[2], 10) });
      if (!matches.length) return [];
      return matches.map(function (hit, i) {
        var next = matches[i + 1];
        return { page: hit.page, text: text.slice(hit.index, next ? next.index : text.length) };
      }).filter(function (b) { return b.page > 0 && b.text.trim(); });
    }
    function narrowToPages(text, maxPages, maxChars, forceReduce) {
      var blocks = splitPageBlocks(text);
      if (blocks.length < 2) return null;
      var limit = Math.max(1, Math.min(maxPages || blocks.length, blocks.length));
      if (forceReduce && limit >= blocks.length) limit = Math.max(1, Math.ceil(blocks.length / 2));
      var chosen = blocks.slice(0, limit);
      if (maxChars) {
        while (chosen.length > 1 && chosen.map(function (b) { return b.text; }).join("").length > maxChars) chosen.pop();
      }
      if (chosen.length >= blocks.length && !maxChars && forceReduce) return null;
      return {
        text: chosen.map(function (b) { return b.text; }).join("").trim(),
        startPage: chosen[0].page,
        endPage: chosen[chosen.length - 1].page,
        pageCount: chosen.length
      };
    }
    function retryNarrowByRetention(text) {
      var blocks = splitPageBlocks(text);
      if (blocks.length < 2) return null;
      var ratio = (S.retryKeepRatio && +S.retryKeepRatio) || 0.75;
      if (!(ratio > 0 && ratio < 1)) ratio = 0.75;
      var keep = Math.max(1, Math.ceil(blocks.length * ratio));
      if (keep >= blocks.length) keep = blocks.length - 1;
      return narrowToPages(text, keep, null, false);
    }
    function synthesizePageMarkers(text, firstPage) {
      if (!text || !text.trim() || splitPageBlocks(text).length > 0) return null;
      var source = text.trim();
      var maxChars = (S.syntheticPageChars && +S.syntheticPageChars) || 3000;
      var blocks = [], headingRe = /^(#{1,3})\s+.+$/gm, hits = [], m;
      while ((m = headingRe.exec(source)) !== null) hits.push({ index: m.index });
      if (hits.length > 1) {
        if (hits[0].index > 0 && source.slice(0, hits[0].index).trim()) blocks.push(source.slice(0, hits[0].index).trim());
        for (var hi = 0; hi < hits.length; hi++) {
          var nextHit = hits[hi + 1];
          var chunk = source.slice(hits[hi].index, nextHit ? nextHit.index : source.length).trim();
          if (chunk) blocks.push(chunk);
        }
      } else {
        blocks = source.split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
      }
      var pages = [], cur = "";
      blocks.forEach(function (b) {
        if (cur && cur.length + b.length + 2 > maxChars) {
          pages.push(cur.trim());
          cur = b;
        } else {
          cur += (cur ? "\n\n" : "") + b;
        }
      });
      cur.trim() && pages.push(cur.trim());
      if (!pages.length) pages = [source];
      var start = Math.max(1, Number(firstPage) || 1);
      return {
        text: pages.map(function (p, i) { return "--- 第 " + (start + i) + " 页 ---\n" + p; }).join("\n\n"),
        startPage: start,
        endPage: start + pages.length - 1,
        pageCount: pages.length
      };
    }
    var KB_MAX_INPUT = (S.maxInputChars && +S.maxInputChars) || 40000;
    var rawForLLM = rawText;
    var syntheticMarked = synthesizePageMarkers(rawForLLM, startPage);
    if (syntheticMarked) {
      rawForLLM = syntheticMarked.text;
      distillStartPage = syntheticMarked.startPage;
      distillEndPage = syntheticMarked.endPage;
      console.log("[kb] synthesized logical page markers for unmarked text " + startPage + "-" + endPage + " -> " + pageRangeText() + ", chunks=" + syntheticMarked.pageCount + ", chars " + rawText.length + " -> " + rawForLLM.length);
    }
    if (rawForLLM.length > KB_MAX_INPUT) {
      var initialNarrow = narrowToPages(rawForLLM, (S.maxInputPages && +S.maxInputPages) || 30, KB_MAX_INPUT, false);
      if (initialNarrow) {
        rawForLLM = initialNarrow.text;
        distillStartPage = initialNarrow.startPage;
        distillEndPage = initialNarrow.endPage;
        console.log("[kb] input page-window reduced " + startPage + "-" + endPage + " -> " + pageRangeText() + ", chars " + rawText.length + " -> " + rawForLLM.length);
      } else {
        console.warn("[kb] input too long but page markers were not found; keeping full window chars=" + rawForLLM.length);
      }
    }
    var usr = "下面是教材第 " + pageRangeText() + " 页的原文(含页码标记)。\n请从中抽取**独立的知识点**,每个知识点产出一张卡片,并产出一个教学序列(teaching_sequence)指导弱模型按顺序教学。忽略目录、页眉页脚、纯插图说明。\n\n严格输出如下 JSON(不要加 markdown 代码块标记,不要任何额外文字):\n" +
      "{\"cards\":[{\"title\":\"知识点名称(简短)\",\"definition\":\"准确、自足的定义/说明,弱模型据此即可讲解\",\"key_points\":[\"要点1\",\"要点2\"],\"examples\":[\"来自或贴合原文的示例;公式/矩阵/分段式优先用 Markdown LaTeX,代码用文本表示\"],\"misconceptions\":[\"学习者常见的错误理解(如能从原文推断)\"],\"qa_pairs\":[{\"q\":\"考察该点的问题\",\"a\":\"标准答案\"}],\"difficulty\":1,\"prerequisites\":[\"前置知识点名称\"],\"source_pages\":[" + distillStartPage + "," + distillEndPage + "],\"needs_verification\":false,\"verify_query\":\"\"}],\"teaching_sequence\":[{\"phase\":1,\"label\":\"阶段标题\",\"card_ids\":[\"对应卡片title\"],\"teach_goal\":\"本阶段教学目标\",\"branches\":[\"可延伸方向\"]}]}\n\n要求:\n- difficulty 取 1-3(1 入门 / 2 进阶 / 3 综合)。\n- source_pages 必须落在 " + pageRangeText() + " 范围内。\n- teaching_sequence 将卡片按教学逻辑分为 2-5 个阶段,每阶段 2-4 张卡片,前序阶段是后续阶段的前置知识。card_ids 用卡片的 title 字段。\n- 如果知识点包含数学表达、二维布局、表格关系、图形标注或递推/DP/矩阵等结构,请在 definition/key_points/examples/qa_pairs 中给出 weak 可直接照用的 LaTeX 写法,例如 $$\\begin{bmatrix} A & B \\\\ C & D \\end{bmatrix}$$、$$f(n)=\\begin{cases}1,&n=1\\\\f(n-1)+f(n-2),&n>1\\end{cases}$$。\n- 对任何你不确定的事实,把该卡片 needs_verification 设为 true,并写出 verify_query。\n- 没有内容可抽取时返回 {\"cards\":[],\"teaching_sequence\":[]}。\n\n原文如下:\n----------------\n" + rawForLLM + "\n----------------";
    // 单次 HTTP 提炼(给定模型块)。Use https module directly to avoid Next.js patched global.fetch hanging issue
    function postOnce(block) {
      var https = require("https"), http = require("http");
      var url = new URL(block.baseUrl.replace(/\/$/, "") + "/chat/completions");
      var mod = url.protocol === "https:" ? https : http;
      var postBody = JSON.stringify({ model: block.model, max_tokens: 8096, stream: false, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: usr }] });
      console.log("[kb] 发起提炼请求: " + url.href + " model=" + block.model + " bodyLen=" + postBody.length);
      return new Promise(function (resolve, reject) {
        var t0 = Date.now();
        var timeoutMs = Math.max(180000, Number(process.env.SOCRATOPIA_KB_DISTILL_TIMEOUT_MS) || 360000);
        var to = setTimeout(function () { req.destroy(); reject(new Error("KB timeout " + Math.round(timeoutMs / 1000) + "s")); }, timeoutMs);
        var opts = { method: "POST", agent: false, headers: { "Content-Type": "application/json", "Authorization": "Bearer " + block.apiKey, "Content-Length": Buffer.byteLength(postBody), "Connection": "close" } };
        if (url.protocol === "https:") opts.ALPNProtocols = ["http/1.1"];
        var req = mod.request(url, opts, function (res) {
          console.log("[kb] 收到响应 status=" + res.statusCode + " elapsed=" + (Date.now() - t0) + "ms");
          var chunks = [];
          res.on("data", function (c) { chunks.push(c); });
          res.on("end", function () {
            clearTimeout(to);
            var body = Buffer.concat(chunks).toString("utf-8");
            console.log("[kb] 响应完成 bodyLen=" + body.length + " elapsed=" + (Date.now() - t0) + "ms");
            if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode + ": " + body.slice(0, 200))); return; }
            try {
              var parsed = JSON.parse(body.trim());
              var m2 = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
              if (!m2) { reject(new Error("响应格式错误：无 choices[0].message")); return; }
              var finalContent = m2.content || m2.reasoning_content || "";
              if (!finalContent) { reject(new Error("LLM API empty response")); return; }
              console.log("[kb] 提取内容长度=" + finalContent.length);
              resolve(finalContent);
            } catch (e) { reject(new Error("JSON parse: " + e.message)); }
          });
        });
        req.on("error", function (e) { console.warn("[kb] req error: " + e.message + " elapsed=" + (Date.now() - t0) + "ms"); clearTimeout(to); reject(e); });
        req.write(postBody);
        req.end();
      });
    }
    function extractBalanced(str, from) {
      var depth = 0, inStr = false, esc = false;
      for (var i = from; i < str.length; i++) {
        var ch = str[i];
        if (inStr) {
          if (esc) { esc = false; }
          else if (ch === '\\') { esc = true; }
          else if (ch === '"') { inStr = false; }
        } else {
          if (ch === '"') { inStr = true; }
          else if (ch === '{') { depth++; }
          else if (ch === '}') { depth--; if (depth === 0) return str.slice(from, i + 1); }
        }
      }
      return null;
    }
    // 把内容字符串解析为 {cards, teaching_sequence}(容错扫描推理文本)。
    function parseContent(content) {
      try { return JSON.parse(content.trim()); } catch (e0) {
        var best = null, bestN = -1, re = /\{\s*"cards"/g, m;
        while ((m = re.exec(content)) !== null) {
          var blk = extractBalanced(content, m.index);
          if (!blk) continue;
          try {
            var cand = JSON.parse(blk);
            var n = (cand && cand.cards && cand.cards.length) || 0;
            if (n > bestN) { bestN = n; best = cand; }
          } catch (eb) {}
        }
        if (best) { console.log("[kb] 从推理文本提取最佳 JSON 块, cards=" + bestN); return best; }
        throw e0;
      }
    }

    function refreshUserPrompt(nextRaw, nextStartPage, nextEndPage) {
      var oldRaw = rawForLLM;
      var oldRange = pageRangeText();
      var oldSource = "[" + distillStartPage + "," + distillEndPage + "]";
      rawForLLM = nextRaw;
      if (nextStartPage && nextEndPage) {
        distillStartPage = nextStartPage;
        distillEndPage = nextEndPage;
      }
      if (oldRaw && usr.indexOf(oldRaw) >= 0) usr = usr.split(oldRaw).join(rawForLLM);
      usr = usr.split(oldRange).join(pageRangeText());
      usr = usr.split(oldSource).join("[" + distillStartPage + "," + distillEndPage + "]");
    }
    var lastDistillFailure = null;
    async function callDistillOnce() {
      lastDistillFailure = null;
      if (ROUTER && ROUTER.callRoutedLLM) {
        // 路由:kb_distill 默认 mini,内容失败(空/JSON解析失败/0卡)升级 premium 一次。
        var res = await ROUTER.callRoutedLLM(
          { role: SET.kb ? "kb" : "strong", task: "kb_distill", inputChars: rawForLLM.length, requiresJson: true, baseConfig: SET },
          function (route) {
            var block = (route.tier === "high") ? (SET.premium || S) : S;
            // 路由块缺 baseUrl/apiKey 时退回已校验的 S。
            if (!block || !block.baseUrl || !block.apiKey || !block.model) block = S;
            return postOnce(block);
          }
        );
        lastDistillFailure = res && res.failure || null;
        return res && res.content;
      }
      // 路由器缺失:保持旧行为,直接用 S 单次调用。
      try { return await postOnce(S); } catch (e) { lastDistillFailure = { kind: /timeout|abort/i.test(String(e && e.message)) ? "timeout" : "network" }; console.warn("[kb] 提炼失败: " + (e && e.message)); return null; }
    }

    var content = await callDistillOnce();
    if (!content || !content.trim()) {
      var retryNarrow = retryNarrowByRetention(rawForLLM);
      if (retryNarrow && (retryNarrow.startPage !== distillStartPage || retryNarrow.endPage !== distillEndPage)) {
        var firstFailureKind = (lastDistillFailure && lastDistillFailure.kind) || "empty";
        refreshUserPrompt(retryNarrow.text, retryNarrow.startPage, retryNarrow.endPage);
        if (firstFailureKind === "timeout" || firstFailureKind === "network") {
          console.warn("[kb] " + firstFailureKind + ", 跳过缩窗重试,回退原文避免阻塞对话");
          return null;
        }
        console.warn("[kb] " + firstFailureKind + ", 按75%保留比例缩小页窗口重试 " + startPage + "-" + endPage + " -> " + pageRangeText());
        content = await callDistillOnce();
        if ((!content || !content.trim()) && firstFailureKind === "timeout" && lastDistillFailure && lastDistillFailure.kind === "timeout") {
          console.warn("[kb] timeout twice, 放弃 KB 提炼,回退原文灌输");
          return null;
        }
      }
    }
    if (!content || !content.trim()) { console.warn("[kb] API 返回空内容"); return null; }
    var obj = parseContent(content);
    var rendered2 = renderCards(obj.cards, obj.teaching_sequence ? {sequence: obj.teaching_sequence, page_range: [distillStartPage, distillEndPage]} : null);
    if (rendered2) console.log("[kb] 现场提炼 " + (obj.cards || []).length + " 张 (p." + pageRangeText() + ")");
    if (rendered2) rendered2 = "<!-- kbRange: " + pageRangeText() + " -->\n" + rendered2;
    try { global.__KB_DISTILL_LAST_RANGE__ = { startPage: distillStartPage, endPage: distillEndPage }; } catch (e) {}
    return rendered2;
  } catch (e) {
    console.warn("[kb] __KB_DISTILL__ 失败,回退原文: " + (e && e.message));
    return null;
  }
}
// 内存缓存 + 并发合并中间件:
//   - 缓存键 = sha256(textbookDir|start|end|rawText),原文不变即命中,毫秒级返回,跳过 LLM 调用。
//   - 只缓存成功的非空结果;失败/空(null)不缓存,允许下次重试(避免把瞬时超时或配置缺失永久钉死)。
//   - 并发合并:chat 切页与 jump-page 对同一窗口同时触发时复用同一个 Promise,只调一次 LLM。
//   - 进程内缓存(随重启清空),容量上限 __KB_CACHE_MAX__,满则淘汰最久未用(LRU)。
var __KB_CACHE__ = new Map();
var __KB_INFLIGHT__ = new Map();
var __KB_CACHE_MAX__ = 50;
var __KB_RENDER_VERSION__ = "queue-v8-focused-prebuilt-kb-window";
var __KB_FOREGROUND_WAIT_MS__ = process.env.SOCRATOPIA_KB_DISTILL_FOREGROUND_WAIT_MS !== undefined
  ? Math.max(0, Number(process.env.SOCRATOPIA_KB_DISTILL_FOREGROUND_WAIT_MS) || 0)
  : 3500;
function __kbWait__(ms) {
  return new Promise(function (resolve) { setTimeout(function () { resolve(null); }, ms); });
}
function __kbStoreResult__(key, rawText, startPage, endPage, textbookDir, result, resumeState) {
  if (!result) return;
  if (__KB_CACHE__.size >= __KB_CACHE_MAX__) {
    var oldest = __KB_CACHE__.keys().next().value;
    if (oldest !== undefined) __KB_CACHE__.delete(oldest);
  }
  __KB_CACHE__.set(key, result);
  __kbWriteDiskCache__(rawText, startPage, endPage, textbookDir, result, resumeState);
}
function __kbStartDistillJob__(rawText, startPage, endPage, textbookDir, resumeState, useRuntimeCache, key, inflightKey) {
  if (__KB_INFLIGHT__.has(inflightKey)) return __KB_INFLIGHT__.get(inflightKey);
  var p = (async function () {
    try {
      var result = await __KB_DISTILL_IMPL__(rawText, startPage, endPage, textbookDir, resumeState);
      if (result && useRuntimeCache) __kbStoreResult__(key, rawText, startPage, endPage, textbookDir, result, resumeState);
      return result;
    } finally {
      __KB_INFLIGHT__.delete(inflightKey);
    }
  })();
  __KB_INFLIGHT__.set(inflightKey, p);
  return p;
}
function __kbSetLastRange__(rendered, fallbackStart, fallbackEnd) {
  try {
    var m = typeof rendered === "string" && rendered.match(/^<!-- kbRange: (\d+)-(\d+) -->/);
    global.__KB_DISTILL_LAST_RANGE__ = m ? { startPage: parseInt(m[1], 10), endPage: parseInt(m[2], 10) } : { startPage: fallbackStart, endPage: fallbackEnd };
  } catch (e) {}
}
function __kbHasPrebuiltMap__(textbookDir) {
  try {
    var fs = require("fs"), path = require("path");
    var kbDir = path.join(String(textbookDir || ""), "knowledge_base");
    return fs.existsSync(path.join(kbDir, "index.json")) && fs.existsSync(path.join(kbDir, "teaching_map.json"));
  } catch (e) {
    return false;
  }
}
function __kbCacheKey__(rawText, startPage, endPage, textbookDir, resumeState) {
  var rh = (global.__RESUME__ && resumeState) ? global.__RESUME__.stateHash(resumeState) : "";
  try {
    return require("crypto").createHash("sha256").update(__KB_RENDER_VERSION__ + "|" + String(textbookDir) + "|" + startPage + "|" + endPage + "|" + rh + "|" + (rawText || "")).digest("hex");
  } catch (e) {
    return __KB_RENDER_VERSION__ + "|" + String(textbookDir) + "|" + startPage + "|" + endPage + "|" + rh + "|" + (rawText || "").length;
  }
}
function __kbDiskCacheInfo__(rawText, startPage, endPage, textbookDir, resumeState) {
  try {
    var crypto = require("crypto"), path = require("path");
    // rawHash 含 resumeState:不同续课进度即使原文/页范围相同也不共用同一份渲染串。
    var rh = (global.__RESUME__ && resumeState) ? global.__RESUME__.stateHash(resumeState) : "";
    var hash = crypto.createHash("sha256").update(__KB_RENDER_VERSION__ + "|" + (rawText || "") + "|rs:" + rh).digest("hex");
    var dir = path.join(String(textbookDir || ""), "knowledge_base", "runtime_cache");
    return { hash: hash, rsHash: rh, dir: dir, indexPath: path.join(dir, "index.json"), fileName: "p" + startPage + "-" + endPage + "-" + hash.slice(0, 16) + ".md" };
  } catch (e) {
    return null;
  }
}
function __kbReadDiskCache__(rawText, startPage, endPage, textbookDir, resumeState) {
  try {
    var fs = require("fs"), path = require("path");
    var info = __kbDiskCacheInfo__(rawText, startPage, endPage, textbookDir, resumeState);
    if (!info || !fs.existsSync(info.indexPath)) return null;
    var idx = JSON.parse(fs.readFileSync(info.indexPath, "utf-8"));
    var entries = Array.isArray(idx.entries) ? idx.entries : [];
    // 只允许 exact rawHash(已含 resumeState)命中。rawHash 不一致时绝不回退 sameRange/covered,
    // 否则不同进度/不同原文会拿到旧 runtime_cache 的"当前焦点",导致续课重讲阶段 1。
    var hit = entries.find(function (e) { return e && e.startPage === startPage && e.endPage === endPage && e.rawHash === info.hash; });
    if (!hit || !hit.fileName) return null;
    var file = path.join(info.dir, hit.fileName);
    if (!fs.existsSync(file)) return null;
    var body = fs.readFileSync(file, "utf-8");
    if (!body || !body.trim()) return null;
    console.log("[kb] 磁盘缓存命中 (p." + startPage + "-" + endPage + ", exact rawHash)");
    return body;
  } catch (e) {
    console.warn("[kb] 读取磁盘缓存失败: " + (e && e.message));
    return null;
  }
}
function __kbWriteDiskCache__(rawText, startPage, endPage, textbookDir, rendered, resumeState) {
  try {
    if (!rendered || !rendered.trim()) return;
    var fs = require("fs"), path = require("path");
    var actualStartPage = startPage;
    var actualEndPage = endPage;
    var rangeMatch = String(rendered).match(/^<!-- kbRange: (\d+)-(\d+) -->/);
    if (rangeMatch) {
      actualStartPage = parseInt(rangeMatch[1], 10) || startPage;
      actualEndPage = parseInt(rangeMatch[2], 10) || endPage;
    }
    var info = __kbDiskCacheInfo__(rawText, actualStartPage, actualEndPage, textbookDir, resumeState);
    if (!info) return;
    fs.mkdirSync(info.dir, { recursive: true });
    var filePath = path.join(info.dir, info.fileName);
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, rendered, "utf-8");
    var idx = { version: 1, entries: [] };
    if (fs.existsSync(info.indexPath)) {
      try { idx = JSON.parse(fs.readFileSync(info.indexPath, "utf-8")); } catch (e) {}
      if (!Array.isArray(idx.entries)) idx.entries = [];
    }
    idx.entries = idx.entries.filter(function (e) {
      return !(e && e.startPage === actualStartPage && e.endPage === actualEndPage && e.rawHash === info.hash);
    });
    idx.entries.unshift({
      startPage: actualStartPage,
      endPage: actualEndPage,
      requestedStartPage: startPage,
      requestedEndPage: endPage,
      rawHash: info.hash,
      rsHash: info.rsHash,
      fileName: info.fileName,
      updatedAt: new Date().toISOString()
    });
    idx.entries = idx.entries.slice(0, 100);
    fs.writeFileSync(info.indexPath, JSON.stringify(idx, null, 2), "utf-8");
  } catch (e) {
    console.warn("[kb] 写入磁盘缓存失败: " + (e && e.message));
  }
}
global.__KB_DISTILL__ = async function (rawText, startPage, endPage, textbookDir, resumeState) {
  if (!rawText || !rawText.trim()) return null;
  try { global.__KB_DISTILL_LAST_RANGE__ = { startPage: startPage, endPage: endPage }; } catch (e) {}
  // 向后兼容:旧调用方不传 resumeState(=undefined),行为与原来一致。
  var key = __kbCacheKey__(rawText, startPage, endPage, textbookDir, resumeState);
  var useRuntimeCache = !__kbHasPrebuiltMap__(textbookDir);
  var inflightKey = useRuntimeCache ? key : key + "|live-prebuilt";
  if (!useRuntimeCache) console.log("[kb] prebuilt map present, live-rendering teaching map and skipping runtime cache (p." + startPage + "-" + endPage + ")");
  if (useRuntimeCache && __KB_CACHE__.has(key)) {
    var hit = __KB_CACHE__.get(key);
    __KB_CACHE__.delete(key); __KB_CACHE__.set(key, hit); // 触碰以维持 LRU 顺序
    console.log("[kb] 缓存命中 (p." + startPage + "-" + endPage + ")");
    __kbSetLastRange__(hit, startPage, endPage);
    return hit;
  }
  var diskHit = useRuntimeCache ? __kbReadDiskCache__(rawText, startPage, endPage, textbookDir, resumeState) : null;
  if (diskHit) {
    if (__KB_CACHE__.size >= __KB_CACHE_MAX__) {
      var oldest0 = __KB_CACHE__.keys().next().value;
      if (oldest0 !== undefined) __KB_CACHE__.delete(oldest0);
    }
    __KB_CACHE__.set(key, diskHit);
    __kbSetLastRange__(diskHit, startPage, endPage);
    return diskHit;
  }
  if (__KB_INFLIGHT__.has(inflightKey)) {
    console.log("[kb] 合并并发请求 (p." + startPage + "-" + endPage + ")");
    if (!__KB_FOREGROUND_WAIT_MS__) return __KB_INFLIGHT__.get(inflightKey);
    var existing = __KB_INFLIGHT__.get(inflightKey);
    var racedExisting = await Promise.race([existing, __kbWait__(__KB_FOREGROUND_WAIT_MS__)]);
    if (!racedExisting) console.log("[kb] inflight still running after " + __KB_FOREGROUND_WAIT_MS__ + "ms, foreground falls back to raw text (p." + startPage + "-" + endPage + ")");
    return racedExisting;
  }
  var p = __kbStartDistillJob__(rawText, startPage, endPage, textbookDir, resumeState, useRuntimeCache, key, inflightKey);
  if (!__KB_FOREGROUND_WAIT_MS__) return p;
  var raced = await Promise.race([p, __kbWait__(__KB_FOREGROUND_WAIT_MS__)]);
  if (!raced) console.log("[kb] distill still running after " + __KB_FOREGROUND_WAIT_MS__ + "ms, foreground falls back to raw text (p." + startPage + "-" + endPage + ")");
  return raced;
};
global.__KB_DISTILL_PREFETCH__ = function (rawText, startPage, endPage, textbookDir, resumeState) {
  if (!rawText || !rawText.trim()) return null;
  var key = __kbCacheKey__(rawText, startPage, endPage, textbookDir, resumeState);
  var useRuntimeCache = !__kbHasPrebuiltMap__(textbookDir);
  var inflightKey = useRuntimeCache ? key : key + "|live-prebuilt";
  if (useRuntimeCache && __KB_CACHE__.has(key)) return __KB_CACHE__.get(key);
  var diskHit = useRuntimeCache ? __kbReadDiskCache__(rawText, startPage, endPage, textbookDir, resumeState) : null;
  if (diskHit) {
    __kbStoreResult__(key, rawText, startPage, endPage, textbookDir, diskHit, resumeState);
    return diskHit;
  }
  if (__KB_INFLIGHT__.has(inflightKey)) {
    console.log("[kb] 预约提炼已在队列中 (p." + startPage + "-" + endPage + ")");
    return null;
  }
  console.log("[kb] 预约后台提炼 (p." + startPage + "-" + endPage + ")");
  __kbStartDistillJob__(rawText, startPage, endPage, textbookDir, resumeState, useRuntimeCache, key, inflightKey)
    .catch(function (e) { console.warn("[kb] 预约后台提炼失败: " + (e && e.message)); });
  return null;
};
;global.__RULES_DIR__=require("path").join(__dirname,"..","rules");global.__FS__=require("fs");global.__PATH__=require("path");(function(){var f=global.__FS__;var p=global.__PATH__;var rd=global.__RULES_DIR__;var sd=p.join(process.env.CONTENT_ROOT||"","..","rules");try{if(f.existsSync(sd)){f.mkdirSync(rd,{recursive:!0});var fl=f.readdirSync(sd);fl.forEach(function(n){var sf=p.join(sd,n);var tf=p.join(rd,n);if(f.statSync(sf).isFile()&&!f.existsSync(tf)){f.copyFileSync(sf,tf);console.log("[rules] Seeded: "+n)}})}}catch(e){console.warn("[rules] Seed failed: "+e.message)}})()
;function __loadOptionalGlobal__(name, file, label, describe) {
  try {
    var mod = require(file);
    global[name] = mod;
    console.log(label + " loaded" + (describe ? ", " + describe(mod) : ""));
  } catch (e) {
    console.warn(label + " failed to load: " + e.message);
    global[name] = null;
  }
}
;[
  ["__ADAPTIVE__", "./lib/adaptive/data-layer.js", "[adaptive] Data layer", function (m) { return "root: " + m.DATA_ROOT(); }],
  ["__ADAPTIVE_CONCEPT_GRAPH__", "./lib/adaptive/concept-graph-builder.js", "[adaptive] Concept graph builder"],
  ["__ADAPTIVE_DIAGNOSTICIAN__", "./lib/adaptive/diagnostician.js", "[adaptive] Diagnostician"],
  ["__PRACTICE__", "./lib/practice/data-layer.js", "[practice] Data layer"],
  ["__PRACTICE_SOURCE__", "./lib/practice/source-adapter.js", "[practice] Source adapter"],
  ["__PRACTICE_TUTOR__", "./lib/practice/tutoring-session.js", "[practice] Tutoring session"],
  ["__RESUME__", "./lib/resume/progress-resume.js", "[resume] Progress-resume helper"],
  ["__MD_CURSOR__", "./lib/markdown/progress-cursor.js", "[markdown] Progress cursor helper"],
  ["__PROGRESS_GUARD__", "./lib/progress/progress-guard.js", "[progress-guard] Progress guard helper"],
  ["__KB_PROGRESS__", "./lib/progress/kb-progress.js", "[kb-progress] Knowledge-card progress helper"],
  ["__LONG_REASONING__", "./lib/reasoning/long-context.js", "[long-reasoning] Long-context helper"],
  ["__MODEL_ROUTER__", "./lib/model-router.js", "[model-router]"],
  ["__KNOWLEDGE_SOURCE__", "./lib/knowledge/source-router.js", "[knowledge] Source router"]
].forEach(function (m) { __loadOptionalGlobal__(m[0], m[1], m[2], m[3]); })
;if (global.__KB_PROGRESS__ && global.__KB_PROGRESS__.installRouteRequireHook) {
  global.__KB_PROGRESS__.installRouteRequireHook();
}

const currentPort = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'

let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
const nextConfig = {"env":{},"typescript":{"ignoreBuildErrors":false},"typedRoutes":false,"distDir":"./.next","cleanDistDir":true,"assetPrefix":"","cacheMaxMemorySize":52428800,"configOrigin":"next.config.ts","useFileSystemPublicRoutes":true,"generateEtags":true,"pageExtensions":["tsx","ts","jsx","js"],"poweredByHeader":true,"compress":true,"images":{"deviceSizes":[640,750,828,1080,1200,1920,2048,3840],"imageSizes":[32,48,64,96,128,256,384],"path":"/_next/image","loader":"default","loaderFile":"","domains":[],"disableStaticImages":false,"minimumCacheTTL":14400,"formats":["image/webp"],"maximumRedirects":3,"maximumResponseBody":50000000,"dangerouslyAllowLocalIP":false,"dangerouslyAllowSVG":false,"contentSecurityPolicy":"script-src 'none'; frame-src 'none'; sandbox;","contentDispositionType":"attachment","localPatterns":[{"pathname":"**","search":""}],"remotePatterns":[],"qualities":[75],"unoptimized":false},"devIndicators":{"position":"bottom-left"},"onDemandEntries":{"maxInactiveAge":60000,"pagesBufferLength":5},"basePath":"","sassOptions":{},"trailingSlash":false,"i18n":null,"productionBrowserSourceMaps":false,"excludeDefaultMomentLocales":true,"reactProductionProfiling":false,"reactStrictMode":null,"reactMaxHeadersLength":6000,"httpAgentOptions":{"keepAlive":true},"logging":{},"compiler":{},"expireTime":31536000,"staticPageGenerationTimeout":60,"output":"standalone","modularizeImports":{"@mui/icons-material":{"transform":"@mui/icons-material/{{member}}"},"lodash":{"transform":"lodash/{{member}}"}},"outputFileTracingRoot":"/Users/leminwu/Documents/Github/socralab-app/v2","cacheComponents":false,"cacheLife":{"default":{"stale":300,"revalidate":900,"expire":4294967294},"seconds":{"stale":30,"revalidate":1,"expire":60},"minutes":{"stale":300,"revalidate":60,"expire":3600},"hours":{"stale":300,"revalidate":3600,"expire":86400},"days":{"stale":300,"revalidate":86400,"expire":604800},"weeks":{"stale":300,"revalidate":604800,"expire":2592000},"max":{"stale":300,"revalidate":2592000,"expire":31536000}},"cacheHandlers":{},"experimental":{"useSkewCookie":false,"cssChunking":true,"multiZoneDraftMode":false,"appNavFailHandling":false,"prerenderEarlyExit":true,"serverMinification":true,"linkNoTouchStart":false,"caseSensitiveRoutes":false,"dynamicOnHover":false,"preloadEntriesOnStart":true,"clientRouterFilter":true,"clientRouterFilterRedirects":false,"fetchCacheKeyPrefix":"","proxyPrefetch":"flexible","optimisticClientCache":true,"manualClientBasePath":false,"cpus":13,"memoryBasedWorkersCount":false,"imgOptConcurrency":null,"imgOptTimeoutInSeconds":7,"imgOptMaxInputPixels":268402689,"imgOptSequentialRead":null,"imgOptSkipMetadata":null,"isrFlushToDisk":true,"workerThreads":false,"optimizeCss":false,"nextScriptWorkers":false,"scrollRestoration":false,"externalDir":false,"disableOptimizedLoading":false,"gzipSize":true,"craCompat":false,"esmExternals":true,"fullySpecified":false,"swcTraceProfiling":false,"forceSwcTransforms":false,"largePageDataBytes":128000,"typedEnv":false,"parallelServerCompiles":false,"parallelServerBuildTraces":false,"ppr":false,"authInterrupts":false,"webpackMemoryOptimizations":false,"optimizeServerReact":true,"viewTransition":false,"removeUncaughtErrorAndRejectionListeners":false,"validateRSCRequestHeaders":false,"staleTimes":{"dynamic":0,"static":300},"reactDebugChannel":false,"serverComponentsHmrCache":true,"staticGenerationMaxConcurrency":8,"staticGenerationMinPagesPerWorker":25,"transitionIndicator":false,"inlineCss":false,"useCache":false,"globalNotFound":false,"browserDebugInfoInTerminal":false,"lockDistDir":true,"isolatedDevBuild":true,"proxyClientMaxBodySize":10485760,"hideLogsAfterAbort":false,"mcpServer":true,"turbopackFileSystemCacheForDev":true,"turbopackFileSystemCacheForBuild":false,"turbopackInferModuleSideEffects":false,"optimizePackageImports":["lucide-react","date-fns","lodash-es","ramda","antd","react-bootstrap","ahooks","@ant-design/icons","@headlessui/react","@headlessui-float/react","@heroicons/react/20/solid","@heroicons/react/24/solid","@heroicons/react/24/outline","@visx/visx","@tremor/react","rxjs","@mui/material","@mui/icons-material","recharts","react-use","effect","@effect/schema","@effect/platform","@effect/platform-node","@effect/platform-browser","@effect/platform-bun","@effect/sql","@effect/sql-mssql","@effect/sql-mysql2","@effect/sql-pg","@effect/sql-sqlite-node","@effect/sql-sqlite-bun","@effect/sql-sqlite-wasm","@effect/sql-sqlite-react-native","@effect/rpc","@effect/rpc-http","@effect/typeclass","@effect/experimental","@effect/opentelemetry","@material-ui/core","@material-ui/icons","@tabler/icons-react","mui-core","react-icons/ai","react-icons/bi","react-icons/bs","react-icons/cg","react-icons/ci","react-icons/di","react-icons/fa","react-icons/fa6","react-icons/fc","react-icons/fi","react-icons/gi","react-icons/go","react-icons/gr","react-icons/hi","react-icons/hi2","react-icons/im","react-icons/io","react-icons/io5","react-icons/lia","react-icons/lib","react-icons/lu","react-icons/md","react-icons/pi","react-icons/ri","react-icons/rx","react-icons/si","react-icons/sl","react-icons/tb","react-icons/tfi","react-icons/ti","react-icons/vsc","react-icons/wi"],"trustHostHeader":false,"isExperimentalCompile":false},"htmlLimitedBots":"[\\w-]+-Google|Google-[\\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight","bundlePagesRouterDependencies":false,"configFileName":"next.config.ts","serverExternalPackages":["openai"],"turbopack":{"root":"/Users/leminwu/Documents/Github/socralab-app/v2"},"distDirRoot":".next"}

process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)

require('next')
const { startServer } = require('next/dist/server/lib/start-server')

if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined
}

startServer({
  dir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
  keepAliveTimeout,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
