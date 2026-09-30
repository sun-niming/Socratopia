// retriever.js — 本地确定性世界知识检索。无网络、无向量库、无外部服务。
//
// 契约见 docs/shared-world-continuity/02-data-and-prompt-contracts.md §6：
// **过滤先于排名**（作用域 → cutoff → 说话人权限 → 见证范围 → 类型/地点 → 相关性 →
// 去重与预算），且被过滤掉的私密卡不得以任何字段泄漏存在性。
//
// 本模块是纯逻辑：`createIndex` 收对象、`retrieve` 收请求、返回新对象，不改入参。
// 只有 `loadIndexFromDir` 碰文件系统——手写 lib 允许 `require("fs")`（该限制只针对
// `.next/server/chunks/*.js`）。
//
// 排序与轴比较一律复用同目录既有实现，不另写一套：
//   version-order.js   截止版本与可见性
//   conflict-order.js  冲突组的主副与「另说」文案
"use strict";

var fsDefault = null;
function fs() {
  if (!fsDefault) fsDefault = require("fs");
  return fsDefault;
}

var VO = require("./version-order.js");
var CO = require("./conflict-order.js");

var DEFAULT_MAX_CARDS = 6;
var DEFAULT_MAX_CHARS = 3200;

// 相关性下限：至少要有一个实打实的字段命中。单条 summary bigram 记 2 分，够得着；
// 完全无关、或只在拿不准的地方蹭到一个 token 的，达不到。避免"沾一点就返回一堆"。
var MIN_SCORE = 2;

// bigram 命中的单字段计分上限，防止长文本靠量堆分。
var BIGRAM_CAP = 3;

var FIELD_WEIGHT = {
  alias: 8,      // 查询里出现了该卡的别名（含别名表补足的中文关键词）
  title: 6,      // 标题整体命中
  character: 4,  // 点名了某个角色
  location: 4,   // 点名了某个地点
  titleGram: 3,
  summaryGram: 2,
  evidenceGram: 1,
  factionGram: 1
};

var PUNCT = /[\s，。、；：「」『』（）()“”‘’"'…—－\-·!?！？,.:;]+/g;

function normalize(text) {
  return String(text === null || text === undefined ? "" : text)
    .toLowerCase().replace(PUNCT, "");
}

function cjkBigrams(run) {
  var out = [];
  if (run.length === 1) return [run];
  for (var i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  return out;
}

// 拉丁词按空白/标点切；CJK 段取 bigram。确定性、无词典。
function tokenize(text) {
  var n = normalize(text);
  if (!n) return [];
  var tokens = [];
  var latin = n.match(/[a-z0-9_]+/g) || [];
  tokens = tokens.concat(latin);
  var cjkRuns = n.match(/[\u4e00-\u9fff]+/g) || [];
  for (var i = 0; i < cjkRuns.length; i++) tokens = tokens.concat(cjkBigrams(cjkRuns[i]));
  return tokens;
}

function uniq(arr) {
  var seen = {}, out = [];
  for (var i = 0; i < arr.length; i++) {
    if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
  }
  return out;
}

function countGrams(tokens, haystackNormalized) {
  var hits = 0;
  var toks = uniq(tokens);
  for (var i = 0; i < toks.length; i++) {
    if (toks[i].length >= 2 && haystackNormalized.indexOf(toks[i]) !== -1) hits++;
  }
  return Math.min(hits, BIGRAM_CAP);
}

// 说话人可见性：public 人人可见；否则必须显式 allow，deny 再逐出。
function canSee(card, speaker) {
  var ks = card.knowledgeScope || {};
  if (ks.level === "public") return true;
  var deny = ks.deny || [];
  if (speaker && deny.indexOf(speaker) !== -1) return false;
  var allow = ks.allow || [];
  if (!allow.length) return false;
  return !!speaker && allow.indexOf(speaker) !== -1;
}

// 一条卡片的字符成本：进入上下文的实际负担，不只是 summary。
function cardCost(card) {
  return String(card.title || "").length +
    String(card.summary || "").length +
    (card.evidence || []).join("").length +
    (card.sources || []).map(function (s) { return String(s.url || "").length; })
      .reduce(function (a, b) { return a + b; }, 0);
}

function visibleAtCutoff(card, cutoff) {
  if (!cutoff || !cutoff.value) return true;
  if (!VO.isVisibleAt(card.spoilerLevel, cutoff.value, cutoff.axis)) return false;
  // 提瓦特双轴：版本侧另有一道下界（D018）。缺 versionRange 的卡不因此被排除。
  if (cutoff.versionFloor && card.versionRange && card.versionRange.to) {
    if (!VO.isVisibleAt(card.versionRange.to, cutoff.versionFloor, "genshin-version")) return false;
  }
  return true;
}

function witnessesPass(card, witnessedEventIds) {
  var ids = card.eventIds;
  if (!ids || !ids.length) return true;             // 卡片未绑定事件则不受见证范围约束
  if (!witnessedEventIds || !witnessedEventIds.length) return false;
  for (var i = 0; i < ids.length; i++) {
    if (witnessedEventIds.indexOf(ids[i]) !== -1) return true;
  }
  return false;
}

function locationPass(card, location) {
  if (!location) return true;
  var locs = card.locations || [];
  if (!locs.length) return true;                     // 非地点类卡片不受地点过滤
  return locs.indexOf(location) !== -1;
}

// 评分：纯函数、整数、只看查询与卡片字段。
function scoreCard(card, query, aliasHits) {
  var q = normalize(query);
  var qTokens = tokenize(query);
  var matched = [];
  var score = 0;

  if (aliasHits && aliasHits.length) {
    score += FIELD_WEIGHT.alias * aliasHits.length;
    matched.push("alias:" + aliasHits.join(","));
  }
  var title = normalize(card.title);
  if (q && title && (q.indexOf(title) !== -1 || title.indexOf(q) !== -1)) {
    score += FIELD_WEIGHT.title; matched.push("title");
  }
  var chars = card.characters || [];
  for (var i = 0; i < chars.length; i++) {
    if (q.indexOf(normalize(chars[i])) !== -1) { score += FIELD_WEIGHT.character; matched.push("character:" + chars[i]); }
  }
  var locs = card.locations || [];
  for (var j = 0; j < locs.length; j++) {
    if (q.indexOf(normalize(locs[j])) !== -1) { score += FIELD_WEIGHT.location; matched.push("location:" + locs[j]); }
  }
  var tg = countGrams(qTokens, title);
  if (tg) { score += FIELD_WEIGHT.titleGram * tg; matched.push("titleGram:" + tg); }
  var sg = countGrams(qTokens, normalize(card.summary));
  if (sg) { score += FIELD_WEIGHT.summaryGram * sg; matched.push("summaryGram:" + sg); }
  var eg = countGrams(qTokens, normalize((card.evidence || []).join("")));
  if (eg) { score += FIELD_WEIGHT.evidenceGram * eg; matched.push("evidenceGram:" + eg); }
  var fg = countGrams(qTokens, normalize((card.factions || []).join("")));
  if (fg) { score += FIELD_WEIGHT.factionGram * fg; matched.push("factionGram:" + fg); }

  return { score: score, matched: matched };
}

// ---------------------------------------------------------------------------

/**
 * 建索引。spec = { scopes: [ { accountId, profileId, worldId, canon, cards, aliases,
 *                              sourceNatures, manifest } ] }
 * 卡片与作用域都不被改动。
 */
function createIndex(spec) {
  if (!spec || !Array.isArray(spec.scopes)) {
    throw new Error("createIndex 需要 { scopes: [...] }");
  }
  var scopes = spec.scopes.map(function (s) {
    // 别名表是 alias -> [cardId]，索引时反建成 normalized(alias) -> [cardId]，
    // 免得每张卡都去扫全表。中文关键词补足靠的正是这张表（01 阶段 B）。
    var aliasIndex = {};
    Object.keys(s.aliases || {}).forEach(function (alias) {
      var key = normalize(alias);
      if (!key) return;
      aliasIndex[key] = (aliasIndex[key] || []).concat(s.aliases[alias]);
    });
    return {
      accountId: s.accountId || "",
      profileId: s.profileId || "",
      worldId: s.worldId || "",
      canon: s.canon || "",
      cards: s.cards || [],
      aliases: s.aliases || {},
      aliasIndex: aliasIndex,
      sourceNatures: s.sourceNatures || {},
      manifest: s.manifest || {}
    };
  });
  return { scopes: scopes };
}

// 查询里出现了哪些别名 key，以及它们指向哪些卡。
function aliasLookup(scope, query) {
  var qn = normalize(query);
  var byCard = {};
  if (!qn) return byCard;
  Object.keys(scope.aliasIndex).forEach(function (key) {
    if (key.length < 2 || qn.indexOf(key) === -1) return;
    scope.aliasIndex[key].forEach(function (cardId) {
      (byCard[cardId] = byCard[cardId] || []).push(key);
    });
  });
  return byCard;
}

function scopeMatches(scope, request) {
  if (request.accountId && scope.accountId && scope.accountId !== request.accountId) return false;
  if (request.profileId && scope.profileId && scope.profileId !== request.profileId) return false;
  if (request.worldId && scope.worldId && scope.worldId !== request.worldId) return false;
  return true;
}

/**
 * 检索。request 字段见 02 §6；除 query 外都可省。
 * 返回 { items, chars, truncated, droppedByBudget }。items 内每项可带 `alternates`。
 */
function retrieve(index, request) {
  var req = request || {};
  var maxCards = req.maxCards === undefined ? DEFAULT_MAX_CARDS : req.maxCards;
  var maxChars = req.maxChars === undefined ? DEFAULT_MAX_CHARS : req.maxChars;
  var query = req.query || "";

  // 1) 作用域
  var scopes = index.scopes.filter(function (s) { return scopeMatches(s, req); });

  var candidates = [];
  var passed = {};   // cardId -> {card, scope}：过了全部过滤但可能没到分数线的也留着，
                     // 冲突副卡要在其中找——副卡自己分数低不代表主卡该没有"另说"。
  scopes.forEach(function (scope) {
    var cutoff = req.canonCutoff || scope.manifest.canonCutoff || null;
    var aliasByCard = aliasLookup(scope, query);
    scope.cards.forEach(function (card) {
      // 2) canon 与截止版本
      if (!visibleAtCutoff(card, cutoff)) return;
      // 3) 说话人知识权限
      if (!canSee(card, req.speaker)) return;
      // 4) 事件见证范围
      if (!witnessesPass(card, req.witnessedEventIds)) return;
      // 5) 类型与地点
      if (req.types && req.types.length && req.types.indexOf(card.type) === -1) return;
      if (!locationPass(card, req.location)) return;

      passed[card.cardId] = { card: card, scope: scope };
      var scored = scoreCard(card, query, aliasByCard[card.cardId] || []);
      if (scored.score < MIN_SCORE) return;
      candidates.push({ card: card, scope: scope, score: scored.score, matched: scored.matched });
    });
  });

  // 6) 相关性排名：分数降序，同分按 cardId 升序（确定性，与输入顺序无关）
  candidates.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.card.cardId < b.card.cardId ? -1 : (a.card.cardId > b.card.cardId ? 1 : 0);
  });

  // 7) 去重与预算
  var entryById = {}, items = [], chars = 0, dropped = 0;
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (entryById[c.card.cardId]) continue;
    if (items.length >= maxCards) { dropped++; continue; }
    var cost = cardCost(c.card);
    if (chars + cost > maxChars) { dropped++; continue; }
    entryById[c.card.cardId] = c;
    chars += cost;
    items.push(c);
  }

  // 冲突组：一条命中即整组命中，但**只留主卡**——主卡进目录，副卡以「另说」一行附出。
  // 附带时机不成立时，副卡仍作独立条目留着，否则那条事实会凭空消失。
  var groups = {};
  Object.keys(entryById).concat(Object.keys(passed)).forEach(function (id) {
    var ids = [id].concat(passed[id] ? (passed[id].card.conflictsWith || []) : []);
    ids.forEach(function (o) {
      if (passed[id] && passed[o] && o !== id) {
        var key = [id, o].sort().join("::");
        groups[key] = true;
      }
    });
  });

  Object.keys(groups).forEach(function (key) {
    var pair = key.split("::");
    var members = pair.map(function (id) { return passed[id]; }).filter(Boolean);
    if (members.length < 2) return;
    var scope = members[0].scope;
    var ranked = CO.rankGroup(members.map(function (m) { return m.card; }),
      { sourceNatures: scope.sourceNatures, speaker: req.speaker });
    var primaryEntry = entryById[ranked.primary.cardId];
    if (!primaryEntry) return;                       // 主卡没入选就谈不上附注
    if (primaryEntry.alternates && primaryEntry.alternates.length) return;
    var altEntry = entryById[ranked.alternates[0].cardId];
    var alt = ranked.alternates[0];
    var note = CO.formatAlternate(alt, scope.sourceNatures);

    // 附带时机（三条任一）：查询命中该组别名/标题、说话人是当事角色、或预算尚有余。
    var qn = normalize(query);
    var groupAliasHit = qn.indexOf(normalize(alt.title)) !== -1 ||
      (alt.aliases || []).some(function (a) {
        var an = normalize(a);
        return an.length >= 2 && qn.indexOf(an) !== -1;
      });
    var speakerIsParty = [ranked.primary, alt].some(function (c) {
      return (c.characters || []).indexOf(req.speaker) !== -1;
    });
    var budgetRoom = cardCost(ranked.primary) < maxChars / 2;
    if (!(groupAliasHit || speakerIsParty || budgetRoom)) return;

    var freed = altEntry ? cardCost(alt) : 0;
    if (chars - freed + note.length > maxChars) return;
    if (altEntry) {                                  // 副卡已在目录里 -> 撤下，改由附注承载
      delete entryById[alt.cardId];
      items = items.filter(function (e) { return e.card.cardId !== alt.cardId; });
      chars -= freed;
    }
    primaryEntry.alternates = [{
      cardId: alt.cardId, title: alt.title,
      layer: CO.cardLayer(alt, scope.sourceNatures),
      note: note, reason: ranked.reason
    }];
    chars += note.length;
  });

  return {
    items: items.map(function (e) {
      return {
        cardId: e.card.cardId, canon: e.card.canon, type: e.card.type,
        title: e.card.title, summary: e.card.summary, evidence: e.card.evidence,
        characters: e.card.characters, locations: e.card.locations, factions: e.card.factions,
        timeRange: e.card.timeRange, versionRange: e.card.versionRange,
        spoilerLevel: e.card.spoilerLevel, claimType: e.card.claimType,
        reliability: e.card.reliability, knowledgeScope: e.card.knowledgeScope,
        sources: e.card.sources,
        score: e.score, matched: e.matched,
        alternates: e.alternates || []
      };
    }),
    chars: chars,
    truncated: dropped > 0,
    droppedByBudget: dropped
  };
}

// ---------------------------------------------------------------------------

/**
 * 从发布包目录读索引。dir 下需有 manifest.json、cards.jsonl；
 * aliases.json 与 source-layers.json 可选（缺了不影响正确性，只影响别名补足与
 * 冲突主副的来源层级判定）。
 */
function loadIndexFromDir(dir, scope) {
  var path = require("path");
  var s = scope || {};
  var cards = fs().readFileSync(path.join(dir, "cards.jsonl"), "utf8")
    .split("\n").filter(function (l) { return l.trim(); })
    .map(function (l) { return JSON.parse(l); });
  var manifest = JSON.parse(fs().readFileSync(path.join(dir, "manifest.json"), "utf8"));
  var readIf = function (name) {
    var p = path.join(dir, name);
    return fs().existsSync(p) ? JSON.parse(fs().readFileSync(p, "utf8")) : null;
  };
  var aliases = readIf("aliases.json");
  var layers = readIf("source-layers.json");
  return createIndex({
    scopes: [{
      accountId: s.accountId, profileId: s.profileId,
      worldId: s.worldId || manifest.worldId, canon: manifest.canon,
      cards: cards, manifest: manifest,
      aliases: (aliases && aliases.aliases) || {},
      sourceNatures: (layers && layers.sourceNatures) || {}
    }]
  });
}

module.exports = {
  DEFAULT_MAX_CARDS: DEFAULT_MAX_CARDS,
  DEFAULT_MAX_CHARS: DEFAULT_MAX_CHARS,
  MIN_SCORE: MIN_SCORE,
  FIELD_WEIGHT: FIELD_WEIGHT,
  createIndex: createIndex,
  retrieve: retrieve,
  loadIndexFromDir: loadIndexFromDir,
  canSee: canSee,
  cardCost: cardCost,
  visibleAtCutoff: visibleAtCutoff,
  tokenize: tokenize,
  normalize: normalize
};
