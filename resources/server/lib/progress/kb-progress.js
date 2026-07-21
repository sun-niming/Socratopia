"use strict";

var fs = require("fs");
var path = require("path");
var Resume = require("../resume/progress-resume.js");

var MARKER_OPEN = "<!-- kbProgress:";
var MARKER_RE = /<!--\s*kbProgress\s*:(\{[\s\S]*?\})\s*-->/g;

function normalizePage(value) {
  var page = Number(value);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch (e) { return null; }
}

function parseProgressMarker(text) {
  text = String(text || "");
  var found = null;
  var match;
  MARKER_RE.lastIndex = 0;
  while ((match = MARKER_RE.exec(text)) !== null) {
    try {
      var parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed === "object") found = parsed;
    } catch (e) {}
  }
  return found;
}

function stripProgressMarkers(text) {
  return String(text || "")
    .replace(/<!--\s*(?:kbProgress|mdProgress)\s*:[\s\S]*?-->/g, "")
    .trimEnd();
}

function createStreamStripper() {
  var buffer = "";
  var dropping = false;

  function commentPrefixLength(value) {
    var open = "<!--";
    for (var len = Math.min(open.length - 1, value.length); len > 0; len--) {
      if (value.endsWith(open.slice(0, len))) return len;
    }
    return 0;
  }

  function closePrefixLength(value) {
    var close = "-->";
    for (var len = Math.min(close.length - 1, value.length); len > 0; len--) {
      if (value.endsWith(close.slice(0, len))) return len;
    }
    return 0;
  }

  function classifyCandidate(value) {
    if (!value.startsWith("<!--")) return "none";
    var rest = value.slice(4).replace(/^\s+/, "");
    var names = ["kbProgress", "mdProgress"];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name.startsWith(rest)) return "partial";
      if (rest.startsWith(name)) {
        var afterName = rest.slice(name.length);
        if (!afterName || /^\s*$/.test(afterName)) return "partial";
        if (/^\s*:/.test(afterName)) return "marker";
      }
    }
    return "none";
  }

  return {
    push: function (chunk) {
      buffer += String(chunk || "");
      var out = "";
      for (;;) {
        if (dropping) {
          var close = buffer.indexOf("-->");
          if (close < 0) {
            var closeKeep = closePrefixLength(buffer);
            buffer = closeKeep ? buffer.slice(-closeKeep) : "";
            return out;
          }
          buffer = buffer.slice(close + 3);
          dropping = false;
          continue;
        }
        var markerAt = buffer.indexOf("<!--");
        if (markerAt >= 0) {
          out += buffer.slice(0, markerAt);
          buffer = buffer.slice(markerAt);
          var classification = classifyCandidate(buffer);
          if (classification === "partial") return out;
          if (classification === "marker") {
            buffer = buffer.slice(buffer.indexOf(":") + 1);
            dropping = true;
            continue;
          }
          out += buffer.slice(0, 1);
          buffer = buffer.slice(1);
          continue;
        }
        var keep = commentPrefixLength(buffer);
        if (keep) {
          out += buffer.slice(0, -keep);
          buffer = buffer.slice(-keep);
        } else {
          out += buffer;
          buffer = "";
        }
        return out;
      }
    },
    flush: function () {
      if (dropping) { buffer = ""; return ""; }
      var out = buffer;
      buffer = "";
      return out;
    },
  };
}

function loadQueue(textbookDir) {
  var kbDir = path.join(String(textbookDir || ""), "knowledge_base");
  var status = readJson(path.join(kbDir, "build_status.json"));
  if (status && (status.state !== "done" || status.activationEligible === false)) {
    return { queue: [], cardMap: {}, teachingMap: null };
  }
  var teachingMap = readJson(path.join(kbDir, "teaching_map.json"));
  var index = readJson(path.join(kbDir, "index.json"));
  if (!teachingMap || !index) return { queue: [], cardMap: {}, teachingMap: teachingMap };
  var summaries = Array.isArray(index.cards) ? index.cards : [];
  var cardMap = {};
  summaries.forEach(function (summary) {
    var id = summary && summary.concept_id;
    if (!id) return;
    var full = readJson(path.join(kbDir, "cards", id + ".json")) || summary;
    cardMap[String(id)] = full;
    if (full.title) cardMap[String(full.title)] = full;
  });

  var phaseGroups = [];
  if (Array.isArray(teachingMap.sequence)) phaseGroups.push({ segmentIndex: 0, sequence: teachingMap.sequence });
  if (Array.isArray(teachingMap.segments)) {
    teachingMap.segments.forEach(function (segment, segmentIndex) {
      if (segment && Array.isArray(segment.sequence)) phaseGroups.push({ segmentIndex: segmentIndex, sequence: segment.sequence });
    });
  }
  var queue = [];
  var globalPhase = 0;
  phaseGroups.forEach(function (group) {
    group.sequence.forEach(function (phase, localPhase) {
      (phase.card_ids || []).forEach(function (cardId, cardIndex) {
        var card = cardMap[String(cardId)] || null;
        if (!card) return;
        queue.push({
          queueIndex: queue.length,
          segmentIndex: group.segmentIndex,
          phaseIndex: globalPhase,
          localPhaseIndex: localPhase,
          cardIndex: cardIndex,
          cardId: String(cardId),
          conceptId: String(card.concept_id || cardId),
          title: String(card.title || cardId),
          sourcePages: Array.isArray(card.source_pages) ? card.source_pages.map(Number) : [],
          card: card,
        });
      });
      globalPhase++;
    });
  });
  return { queue: queue, cardMap: cardMap, teachingMap: teachingMap };
}

function queueAliases(queue) {
  var aliases = {};
  queue.forEach(function (entry, index) {
    [entry.cardId, entry.conceptId, entry.title].forEach(function (value) {
      if (value != null && aliases[String(value)] === undefined) aliases[String(value)] = index;
    });
  });
  return aliases;
}

function completedLookup(state) {
  var done = {};
  (state.completedConceptIds || []).forEach(function (id) { done[String(id)] = true; });
  (state.completedTitles || []).forEach(function (id) { done[String(id)] = true; });
  return done;
}

function entryIntersectsRange(entry, loadedStart, loadedEnd) {
  var pages = entry && entry.sourcePages;
  return !!(loadedStart && loadedEnd && Array.isArray(pages) && pages.length >= 2 &&
    pages[0] <= loadedEnd && pages[pages.length - 1] >= loadedStart);
}

function initialQueueIndex(queue, state, loadedRange) {
  if (!queue.length) return null;
  var aliases = queueAliases(queue);
  var loadedStart = normalizePage(loadedRange && loadedRange.startPage);
  var loadedEnd = normalizePage(loadedRange && loadedRange.endPage);
  if (state.activeConceptId && aliases[String(state.activeConceptId)] !== undefined) {
    var activeIndex = aliases[String(state.activeConceptId)];
    if (!loadedStart || !loadedEnd || entryIntersectsRange(queue[activeIndex], loadedStart, loadedEnd)) return activeIndex;
  }
  var done = completedLookup(state);
  var page = normalizePage(state.lastTaughtPage || state.currentPage);
  for (var i = 0; i < queue.length; i++) {
    var entry = queue[i];
    if (done[entry.conceptId] || done[entry.cardId] || done[entry.title]) continue;
    var pages = entry.sourcePages;
    if (page && pages.length >= 2 && pages[0] <= page && pages[pages.length - 1] >= page &&
        (!loadedStart || !loadedEnd || entryIntersectsRange(entry, loadedStart, loadedEnd))) return i;
  }
  if (loadedStart && loadedEnd) {
    for (var j = 0; j < queue.length; j++) {
      if (entryIntersectsRange(queue[j], loadedStart, loadedEnd)) return j;
    }
  }
  for (var k = 0; k < queue.length; k++) {
    var q = queue[k];
    if (!done[q.conceptId] && !done[q.cardId] && !done[q.title]) return k;
  }
  return queue.length - 1;
}

function validateProgressMarker(marker, opts) {
  opts = opts || {};
  var queue = opts.queue || [];
  var state = opts.state || {};
  var textbookId = String(opts.textbookId || "");
  var conversationId = String(opts.conversationId || "");
  var loadedStart = normalizePage(opts.loadedRange && opts.loadedRange.startPage);
  var loadedEnd = normalizePage(opts.loadedRange && opts.loadedRange.endPage);
  function reject(reason) { return { ok: false, reason: reason }; }

  if (!marker || typeof marker !== "object") return reject("missing_marker");
  if (!textbookId || String(marker.textbookId || "") !== textbookId) return reject("textbook_mismatch");
  if (!conversationId || String(marker.sourceConversationId || "") !== conversationId) return reject("conversation_mismatch");
  if (!loadedStart || !loadedEnd || loadedEnd < loadedStart) return reject("invalid_loaded_range");
  if (!queue.length) return reject("empty_queue");

  var aliases = queueAliases(queue);
  var currentIndex = initialQueueIndex(queue, state, opts.loadedRange);
  if (currentIndex === null) return reject("cannot_locate_current_card");
  if (!entryIntersectsRange(queue[currentIndex], loadedStart, loadedEnd)) return reject("current_concept_outside_loaded_range");
  var completed = Array.isArray(marker.newlyCompletedConceptIds)
    ? marker.newlyCompletedConceptIds
    : Array.isArray(marker.completedConceptIds) ? marker.completedConceptIds : [];
  var doneAlready = completedLookup(state);
  var novel = [];
  var seen = {};
  completed.forEach(function (id) {
    var key = String(id || "");
    var index = aliases[key];
    if (index === undefined) { novel.push({ invalid: key }); return; }
    var canonical = queue[index].conceptId;
    if (doneAlready[canonical] || doneAlready[queue[index].title] || doneAlready[queue[index].cardId]) return;
    if (!seen[canonical]) { seen[canonical] = true; novel.push({ index: index, id: canonical }); }
  });
  if (novel.some(function (item) { return item.invalid !== undefined; })) return reject("unknown_completed_concept");
  if (novel.length > 3) return reject("pace_limit_exceeded");
  for (var ni = 0; ni < novel.length; ni++) {
    if (novel[ni].index !== currentIndex + ni) return reject("non_contiguous_completion");
  }

  var requestedActive = String(marker.activeConceptId || queue[currentIndex].conceptId);
  var activeIndex = aliases[requestedActive];
  if (activeIndex === undefined) return reject("unknown_active_concept");
  var expectedIndex = Math.min(queue.length - 1, currentIndex + novel.length);
  if (activeIndex !== currentIndex && activeIndex !== expectedIndex) return reject("non_contiguous_active_concept");
  if (novel.length && activeIndex === currentIndex && currentIndex < queue.length - 1) return reject("completed_card_still_active");
  if (!entryIntersectsRange(queue[activeIndex], loadedStart, loadedEnd)) return reject("active_concept_outside_loaded_range");

  var lastPage = normalizePage(marker.lastTaughtPage);
  if (!lastPage || lastPage < loadedStart || lastPage > loadedEnd) return reject("taught_page_outside_loaded_range");
  for (var ci = 0; ci < novel.length; ci++) {
    if (!entryIntersectsRange(queue[novel[ci].index], loadedStart, loadedEnd)) {
      return reject("completed_concept_outside_loaded_range");
    }
  }

  return {
    ok: true,
    reason: "accepted",
    currentIndex: currentIndex,
    activeIndex: activeIndex,
    activeConceptId: queue[activeIndex].conceptId,
    newlyCompletedConceptIds: novel.map(function (item) { return item.id; }),
    newlyCompletedTitles: novel.map(function (item) { return queue[item.index].title; }),
    lastTaughtPage: lastPage,
  };
}

function commitAssistantProgress(textbookDir, opts) {
  opts = opts || {};
  var marker = opts.marker || parseProgressMarker(opts.responseText);
  if (!marker) return { ok: false, reason: "missing_marker", unchanged: true };
  var loaded = loadQueue(textbookDir);
  var state = Resume.readState(textbookDir) || {};
  var decision = validateProgressMarker(marker, {
    queue: loaded.queue,
    state: state,
    textbookId: opts.textbookId,
    conversationId: opts.conversationId,
    loadedRange: opts.loadedRange,
  });
  if (!decision.ok) return Object.assign({ unchanged: true }, decision);
  var now = new Date().toISOString();
  var sameLesson = String(state.sourceConversationId || "") === String(opts.conversationId || "");
  var lessonStartPage = sameLesson
    ? normalizePage(state.lessonStartPage) || normalizePage(opts.loadedRange && opts.loadedRange.startPage) || decision.lastTaughtPage
    : normalizePage(opts.loadedRange && opts.loadedRange.startPage) || decision.lastTaughtPage;
  var next = Resume.writeState(textbookDir, {
    textbookId: String(opts.textbookId || ""),
    sourceConversationId: String(opts.conversationId || ""),
    lessonStartPage: lessonStartPage,
    activeConceptId: decision.activeConceptId,
    completedConceptIds: decision.newlyCompletedConceptIds,
    completedTitles: decision.newlyCompletedTitles,
    lastTaughtPage: decision.lastTaughtPage,
    currentPage: decision.lastTaughtPage,
    taughtCursor: {
      chunkId: "concept-" + decision.activeConceptId,
      ordinal: decision.activeIndex,
      startPage: decision.lastTaughtPage,
      endPage: decision.lastTaughtPage,
      status: "active",
      ready: true,
      committedAt: now,
      reason: "validated_kb_marker",
    },
  });
  if (!next) return { ok: false, reason: "state_write_failed", unchanged: true };
  return Object.assign({ state: next }, decision);
}

function markerDirective(opts) {
  opts = opts || {};
  var visible = (opts.visibleConceptIds || []).map(String).filter(Boolean).slice(0, 3);
  var active = String(opts.activeConceptId || visible[0] || "");
  var textbookId = String(opts.textbookId || "");
  var conversationId = String(opts.conversationId || "");
  return "每次教学回复正文结束后，必须追加一行隐藏进度标记：<!-- kbProgress:{\"schemaVersion\":1,\"textbookId\":\"" +
    textbookId + "\",\"sourceConversationId\":\"" + conversationId +
    "\",\"activeConceptId\":\"" + active +
    "\",\"newlyCompletedConceptIds\":[],\"lastTaughtPage\":当前实际讲到的页码} -->。" +
    "activeConceptId 只能是本轮当前卡或按顺序完成后紧邻的下一卡；本轮可用顺序为[" + visible.join(", ") +
    "]。只把本轮确实讲清并完成检查的连续卡写入 newlyCompletedConceptIds，最多 3 张；不得跳卡、倒退或填写加载页窗之外的页码。";
}

function requestWithProgressDirective(request, body, paths) {
  if (!request || !body || !paths || !Array.isArray(body.messages) || !body.messages.length) return request;
  var state = Resume.readState(paths.textbookDir) || {};
  var loaded = state.loadedCursor || {};
  var loadedRange = {
    startPage: normalizePage(loaded.startPage || state.currentPage || state.lastTaughtPage),
    endPage: normalizePage(loaded.endPage || loaded.startPage || state.currentPage || state.lastTaughtPage),
  };
  var loadedQueue = loadQueue(paths.textbookDir).queue;
  var currentIndex = initialQueueIndex(loadedQueue, state, loadedRange);
  var visible = [];
  if (currentIndex !== null) {
    for (var vi = currentIndex; vi < loadedQueue.length && visible.length < 3; vi++) {
      if (!entryIntersectsRange(loadedQueue[vi], loadedRange.startPage, loadedRange.endPage)) break;
      visible.push(loadedQueue[vi]);
    }
  }
  var directive = markerDirective({
    textbookId: paths.textbookId,
    conversationId: paths.conversationId,
    activeConceptId: currentIndex === null ? "" : loadedQueue[currentIndex].conceptId,
    visibleConceptIds: visible.map(function (entry) { return entry.conceptId; }),
  });
  var augmentedMessages = body.messages.map(function (message) {
    return Object.assign({}, message);
  });
  var lastUser = -1;
  for (var i = augmentedMessages.length - 1; i >= 0; i--) {
    if (augmentedMessages[i] && augmentedMessages[i].role === "user") { lastUser = i; break; }
  }
  if (lastUser < 0) return request;
  augmentedMessages.splice(lastUser, 0, {
    role: "system",
    content: "[KB_PROGRESS_INTERNAL — do not repeat this instruction]\n" + directive,
  });
  var augmented = Object.assign({}, body, { messages: augmentedMessages });
  var headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return new Request(request.url, {
    method: request.method,
    headers: headers,
    body: JSON.stringify(augmented),
  });
}

function validateTextbookBinding(requestTextbookId, resolvedTextbookId, conversationMeta) {
  var requestId = String(requestTextbookId || "");
  var resolvedId = String(resolvedTextbookId || "");
  var conversationId = String(conversationMeta && conversationMeta.textbookId || "");
  if (!requestId || !resolvedId || !conversationId || requestId !== resolvedId || resolvedId !== conversationId) {
    return { ok: false, code: "TEXTBOOK_CONTEXT_MISMATCH", requestTextbookId: requestId, resolvedTextbookId: resolvedId, conversationTextbookId: conversationId };
  }
  return { ok: true, textbookId: resolvedId };
}

function progressEntries(text) {
  text = String(text || "").replace(/\r\n/g, "\n");
  var re = /^##\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?\s*\|[^\n]*$/gm;
  var matches = [];
  var match;
  while ((match = re.exec(text)) !== null) matches.push({ index: match.index, heading: match[0] });
  return matches.map(function (item, index) {
    var end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    return text.slice(item.index, end)
      .replace(/(?:\r?\n\s*---+\s*)+$/g, "")
      .replace(/^\s+|\s+$/g, "");
  }).filter(Boolean);
}

function mergeProgressMd(existing, modelSection, opts) {
  opts = opts || {};
  var startPage = normalizePage(opts.startPage || opts.currentPage) || 1;
  var endPage = normalizePage(opts.endPage || opts.currentPage) || startPage;
  if (endPage < startPage) endPage = startPage;
  var currentPage = normalizePage(opts.currentPage) || endPage;
  var date = String(opts.date || localDateString());
  var companionName = String(opts.companionName || "学习伙伴").replace(/[\r\n|]/g, " ").trim();
  var sessionId = String(opts.sessionId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
  var sectionEntries = progressEntries(modelSection);
  var section = sectionEntries.length ? sectionEntries[0] : String(modelSection || "").trim();
  section = section
    .replace(/^#(?!#).*$/gm, "")
    .replace(/^p\.\s*\d+\s*-\s*\d+\s*\|.*$/gim, "")
    .replace(/^---+$/gm, "")
    .trim();
  if (/^##\s+/m.test(section)) section = section.replace(/^##[^\n]*\n?/, "").trim();
  if (!section) section = opts.emptySummary || "本节课未产生可验证的新教学进度。";
  var title = String(opts.title || "本节课学习记录").replace(/[\r\n]/g, " ").trim();
  var sessionMarker = sessionId ? "<!-- sourceConversationId:" + sessionId + " -->\n" : "";
  var entry = "## " + date + " | " + companionName + "\n" + sessionMarker +
    "p." + startPage + "-" + endPage + " | " + title + "\n" + section;
  var prior = progressEntries(existing).filter(function (old) {
    if (sessionId) return old.indexOf("<!-- sourceConversationId:" + sessionId + " -->") < 0;
    return old.trim() !== entry.trim();
  });
  var all = [entry].concat(prior).slice(0, 5);
  var header = opts.lang === "english" ? "# Current Page: Page " + currentPage
    : opts.lang === "chinese-traditional" ? "# 當前頁碼：第 " + currentPage + " 頁"
    : "# 当前页码：第 " + currentPage + " 页";
  return header + "\n\n---\n\n" + all.join("\n\n---\n\n") + "\n";
}

function localDateString(value) {
  var d = value instanceof Date ? value : new Date();
  return String(d.getFullYear()).padStart(4, "0") + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function findConcept(textbookDir, patterns, startPage, endPage) {
  var loaded = loadQueue(textbookDir);
  patterns = (patterns || []).map(function (p) { return p instanceof RegExp ? p : new RegExp(String(p), "i"); });
  startPage = normalizePage(startPage) || 1;
  endPage = normalizePage(endPage) || startPage;
  var inRange = loaded.queue.filter(function (entry) {
    var pages = entry.sourcePages;
    return pages.length >= 2 && pages[0] <= endPage && pages[pages.length - 1] >= startPage;
  });
  for (var i = 0; i < inRange.length; i++) {
    var haystack = [inRange[i].title, inRange[i].card && inRange[i].card.definition]
      .concat(inRange[i].card && inRange[i].card.key_points || []).join("\n");
    if (patterns.some(function (pattern) { pattern.lastIndex = 0; return pattern.test(haystack); })) return inRange[i];
  }
  return inRange[0] || null;
}

function safeSegment(value) {
  value = String(value || "");
  if (!value || value.length > 128 || value.indexOf("..") >= 0 || /[\\/\x00-\x1f]/.test(value)) return null;
  return value;
}

function requestPaths(request, body) {
  var profileId = safeSegment(body.profileId || "default");
  var worldId = safeSegment(body.worldId);
  var textbookId = safeSegment(body.textbookId);
  var conversationId = safeSegment(body.conversationId);
  if (!profileId || !worldId || !textbookId || !conversationId) return null;
  var root = path.resolve(process.env.PROJECT_ROOT || "");
  if (!root) return null;
  var accountId = safeSegment(request && request.headers && request.headers.get("X-Account-Id") || "local") || "local";
  var accountWorld = path.join(root, "accounts", accountId, "profiles", profileId, "worlds", worldId);
  var legacyWorld = path.join(root, "profiles", profileId, "worlds", worldId);
  var worldDir = fs.existsSync(accountWorld) || !fs.existsSync(legacyWorld) ? accountWorld : legacyWorld;
  return {
    root: root,
    worldDir: worldDir,
    textbookDir: path.join(worldDir, "textbooks", textbookId),
    textbookId: textbookId,
    conversationId: conversationId,
    textbookIndex: path.join(worldDir, "textbooks", "textbook_index.json"),
    worldConfig: path.join(worldDir, "world.json"),
  };
}

function loadConversationMeta(paths) {
  if (!paths) return null;
  var candidates = [
    path.join(paths.worldDir, "chats", paths.conversationId + ".json"),
    path.join(paths.worldDir, "conversations", paths.conversationId + ".json"),
    path.join(paths.worldDir, "conversation_meta", paths.conversationId + ".json"),
  ];
  for (var i = 0; i < candidates.length; i++) {
    var value = readJson(candidates[i]);
    if (value && typeof value === "object") return value;
  }
  return null;
}

function isEndClassRequest(body) {
  var messages = body && body.messages;
  if (!Array.isArray(messages) || !messages.length) return false;
  var content = String(messages[messages.length - 1] && messages[messages.length - 1].content || "").trim();
  return /^\[(?:下课|下課|结束课程|結束課程|end\s*(?:class|lesson))\]/i.test(content) || /^\/end[-_ ]?(?:class|lesson)(?:\s|$)/i.test(content);
}

function shouldTrackTeachingProgress(body, endClass) {
  body = body || {};
  return !endClass && !body.autoReply && !body.nuwaMode;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var tmp = file + ".tmp";
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, file);
}

function syncTextbookCurrentPage(paths, page) {
  page = normalizePage(page);
  if (!paths || !page) return false;
  var index = readJson(paths.textbookIndex);
  if (!index || !Array.isArray(index.textbooks)) return false;
  var changed = false;
  index.textbooks.forEach(function (book) {
    if (book && String(book.id) === paths.textbookId && book.currentPage !== page) {
      book.currentPage = page;
      changed = true;
    }
  });
  if (!changed) return false;
  index.updatedAt = new Date().toISOString();
  atomicWrite(paths.textbookIndex, JSON.stringify(index, null, 2));
  return true;
}

function companionName(paths, body) {
  var fallback = String(body.character || "学习伙伴");
  var config = readJson(paths && paths.worldConfig) ||
    readJson(paths && path.join(paths.worldDir, "world_meta.json")) ||
    readJson(paths && path.join(paths.worldDir, "world.json"));
  var companions = config && config.companions;
  if (!Array.isArray(companions)) return fallback;
  var slots = ["a", "b", "c", "d", "npc_a", "npc_b", "npc_c", "npc_d"];
  var raw = String(body.character || "");
  var index = slots.indexOf(raw);
  if (index >= 4) index -= 4;
  var companion = index >= 0 ? companions[index] : null;
  return String(companion && (companion.customName || companion.name) || fallback);
}

function textbookTitle(paths) {
  var index = readJson(paths && paths.textbookIndex);
  var books = index && index.textbooks;
  if (Array.isArray(books)) {
    for (var i = 0; i < books.length; i++) {
      if (books[i] && String(books[i].id) === paths.textbookId) {
        return String(books[i].title || books[i].fileName || paths.textbookId).trim() || paths.textbookId;
      }
    }
  }
  return paths ? paths.textbookId : "教材";
}

function rewriteEndClassProgress(context, latestLoadedRange) {
  var paths = context.paths;
  if (!paths) return;
  var preState = context.preState || {};
  var currentPage = normalizePage(preState.lastTaughtPage || preState.currentPage) ||
    Resume.parseProgressPage(context.previousProgress) ||
    normalizePage(latestLoadedRange && latestLoadedRange.startPage) || 1;
  var sameLesson = String(preState.sourceConversationId || "") === paths.conversationId;
  var startPage = sameLesson ? normalizePage(preState.lessonStartPage) : null;
  startPage = startPage || normalizePage(latestLoadedRange && latestLoadedRange.startPage) || currentPage;
  if (startPage > currentPage) startPage = currentPage;
  var progressPath = path.join(paths.textbookDir, "progress.md");
  var generated = "";
  try { generated = fs.readFileSync(progressPath, "utf-8"); } catch (e) {}
  var merged = mergeProgressMd(context.previousProgress, generated, {
    startPage: startPage,
    endPage: currentPage,
    currentPage: currentPage,
    date: localDateString(),
    companionName: companionName(paths, context.body),
    title: textbookTitle(paths) + " - 本节课",
    lang: context.body.teachingLanguage || "chinese",
    sessionId: paths.conversationId,
  });
  atomicWrite(progressPath, merged);
  Resume.writeState(paths.textbookDir, {
    textbookId: paths.textbookId,
    sourceConversationId: paths.conversationId,
    lessonStartPage: startPage,
    activeConceptId: preState.activeConceptId,
    completedConceptIds: preState.completedConceptIds || [],
    completedTitles: preState.completedTitles || [],
    resetCompleted: true,
    lastTaughtPage: currentPage,
    currentPage: currentPage,
    loadedCursor: preState.loadedCursor,
    taughtCursor: preState.taughtCursor || {
      chunkId: "end-class-" + String(currentPage).padStart(4, "0"),
      ordinal: currentPage,
      startPage: currentPage,
      endPage: currentPage,
      status: "active",
      ready: true,
      committedAt: new Date().toISOString(),
      reason: "end_class_backend_merge",
    },
  });
  syncTextbookCurrentPage(paths, currentPage);
}

function transformSseResponse(response, context) {
  if (!response || !response.body) return response;
  var contentType = String(response.headers && response.headers.get("content-type") || "");
  if (contentType.indexOf("text/event-stream") < 0) return response;
  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var encoder = new TextEncoder();
  var stripper = createStreamStripper();
  var rawAssistant = "";
  var pending = "";
  var pendingDone = null;
  var sawError = false;
  var latestLoadedRange = null;

  function eventText(obj) { return "data: " + JSON.stringify(obj) + "\n\n"; }
  function handleEvent(raw) {
    var lines = String(raw || "").split(/\r?\n/);
    var data = lines.filter(function (line) { return line.startsWith("data:"); })
      .map(function (line) { return line.slice(5).trim(); }).join("\n");
    if (!data) return raw + "\n\n";
    var obj;
    try { obj = JSON.parse(data); } catch (e) { return raw + "\n\n"; }
    if (obj.type === "text" && typeof obj.text === "string") {
      rawAssistant += obj.text;
      var visible = stripper.push(obj.text);
      if (!visible) return "";
      obj.text = visible;
      return eventText(obj);
    }
    if (obj.type === "reading_range" && obj.startPage != null && obj.endPage != null) {
      latestLoadedRange = { startPage: obj.loadedStartPage || obj.startPage, endPage: obj.loadedEndPage || obj.endPage };
    }
    if (obj.type === "error") sawError = true;
    if (obj.type === "done") { pendingDone = obj; return ""; }
    return eventText(obj);
  }

  var stream = new ReadableStream({
    async start(controller) {
      try {
        for (;;) {
          var result = await reader.read();
          if (result.done) break;
          pending += decoder.decode(result.value, { stream: true });
          var parts = pending.split(/\r?\n\r?\n/);
          pending = parts.pop() || "";
          for (var i = 0; i < parts.length; i++) {
            var output = handleEvent(parts[i]);
            if (output) controller.enqueue(encoder.encode(output));
          }
        }
        pending += decoder.decode();
        if (pending.trim()) {
          var tailEvent = handleEvent(pending);
          if (tailEvent) controller.enqueue(encoder.encode(tailEvent));
        }
        var flushed = stripper.flush();
        if (flushed) controller.enqueue(encoder.encode(eventText({ type: "text", text: flushed })));

        if (!sawError) {
          if (context.endClass) {
            rewriteEndClassProgress(context, latestLoadedRange);
          } else if (context.paths && context.trackProgress !== false) {
            var meta = context.conversationMeta || loadConversationMeta(context.paths);
            var binding = validateTextbookBinding(context.body.textbookId, context.paths.textbookId, meta);
            if (binding.ok) {
              var existingState = Resume.readState(context.paths.textbookDir) || {};
              var range = latestLoadedRange || existingState.loadedCursor;
              var committed = commitAssistantProgress(context.paths.textbookDir, {
                responseText: rawAssistant,
                textbookId: context.paths.textbookId,
                conversationId: context.paths.conversationId,
                loadedRange: range,
              });
              if (committed.ok) syncTextbookCurrentPage(context.paths, committed.lastTaughtPage);
              else if (committed.reason !== "missing_marker") console.warn("[kb-progress] marker rejected:", committed.reason);
            }
          }
        }
        if (pendingDone) controller.enqueue(encoder.encode(eventText(pendingDone)));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) { try { return reader.cancel(reason); } catch (e) {} },
  });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function installRouteWrapper(exported) {
  if (!exported || exported.__kbProgressWrapped) return exported;
  try { Object.defineProperty(exported, "__kbProgressWrapped", { value: true }); } catch (e) {}
  Promise.resolve(exported).then(function (resolved) {
    var routeModule = resolved && resolved.routeModule;
    var methods = routeModule && routeModule.methods;
    if (!methods || typeof methods.POST !== "function" || methods.POST.__kbProgressWrapped) return;
    var originalPost = methods.POST;
    var wrapped = async function (request, routeContext) {
      var body = null;
      try { body = await request.clone().json(); } catch (e) {}
      if (!body || typeof body !== "object") return originalPost.call(this, request, routeContext);
      var paths = requestPaths(request, body);
      var endClass = isEndClassRequest(body);
      var trackProgress = shouldTrackTeachingProgress(body, endClass);
      var conversationMeta = paths ? loadConversationMeta(paths) : null;
      if (endClass) {
        var binding = validateTextbookBinding(body.textbookId, paths && paths.textbookId, conversationMeta);
        if (!binding.ok) {
          return new Response(JSON.stringify({ error: "Textbook context mismatch; no post-class files were written.", code: binding.code }), {
            status: 409,
            headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
          });
        }
      }
      var context = { body: body, paths: paths, endClass: endClass, trackProgress: trackProgress, conversationMeta: conversationMeta };
      if (endClass && paths) {
        context.preState = Resume.readState(paths.textbookDir) || null;
        try { context.previousProgress = fs.readFileSync(path.join(paths.textbookDir, "progress.md"), "utf-8"); } catch (e) { context.previousProgress = ""; }
      }
      var requestForRoute = trackProgress && paths ? requestWithProgressDirective(request, body, paths) : request;
      var response = await originalPost.call(this, requestForRoute, routeContext);
      return transformSseResponse(response, context);
    };
    Object.defineProperty(wrapped, "__kbProgressWrapped", { value: true });
    methods.POST = wrapped;
  }).catch(function (error) { console.warn("[kb-progress] route wrapper install failed:", error && error.message); });
  return exported;
}

function installRouteRequireHook() {
  if (global.__KB_PROGRESS_ROUTE_HOOK__) return;
  global.__KB_PROGRESS_ROUTE_HOOK__ = true;
  var Module = require("module");
  var originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    var exported = originalLoad.apply(this, arguments);
    var normalized = String(request || "").replace(/\\/g, "/");
    if (/\/app\/api\/chat\/route\.js$/.test(normalized)) {
      Module._load = originalLoad;
      installRouteWrapper(exported);
    }
    return exported;
  };
}

module.exports = {
  MARKER_OPEN: MARKER_OPEN,
  parseProgressMarker: parseProgressMarker,
  stripProgressMarkers: stripProgressMarkers,
  createStreamStripper: createStreamStripper,
  loadQueue: loadQueue,
  initialQueueIndex: initialQueueIndex,
  validateProgressMarker: validateProgressMarker,
  commitAssistantProgress: commitAssistantProgress,
  markerDirective: markerDirective,
  requestWithProgressDirective: requestWithProgressDirective,
  validateTextbookBinding: validateTextbookBinding,
  progressEntries: progressEntries,
  mergeProgressMd: mergeProgressMd,
  localDateString: localDateString,
  findConcept: findConcept,
  requestPaths: requestPaths,
  loadConversationMeta: loadConversationMeta,
  isEndClassRequest: isEndClassRequest,
  shouldTrackTeachingProgress: shouldTrackTeachingProgress,
  companionName: companionName,
  transformSseResponse: transformSseResponse,
  installRouteWrapper: installRouteWrapper,
  installRouteRequireHook: installRouteRequireHook,
};
