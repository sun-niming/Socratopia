// conflict-order.js — 冲突卡组的确定性排序与「另说」附注格式。
//
// 资料里同一件事常有互异记载（例：amphoreus 刻律德菈的结局，S002 编年史作「遇刺身亡
// （实为自杀）」、S021 残卷作「从众人视野中彻底消失」）。02 要求冲突分别建卡、不静默
// 合并；检索时也不能把两条都塞进去就完事，否则模型会把它们自行调和成一个结论。
//
// 因此约定：命中主卡即命中整组，副卡只在必要时以固定前缀「另有一说：」附一行。
// 本模块只负责**排序与格式化**，不做检索、不碰字符预算——预算由调用方（retriever／
// compiler）裁定，本模块给出可由调用方直接比较的确定性顺序。
//
// 主副顺序四级，逐级只在上一级并列时才使用：
//   1. 当事人优先——说话人恰好是**且仅是一侧**的当事角色（`characters` 含 speaker）。
//      两侧都含说话人（或都不含）时该级并列，落回下一级；这不是罕见情况，
//      同一事件里的两个人本就可能同时挂在两侧卡上。
//   2. 来源层级——世界观内（`sourceNature` 含「游戏内」）优先于社区整理（含「社区」）。
//      卡片层级取**其来源里最弱的一档**：只要引到社区汇总，就不算纯世界观内，
//      免得把社区重排当成原著（03 §2「分别标记」）。
//   3. `reliability` primary > secondary > tertiary。
//   4. `cardId` 字典序——保证同输入稳定、与输入顺序无关。
//
// 不变量：`rankPair(a, b) === rankPair(a, b)`；且把参数对调后 primary／alternate 互换。
"use strict";

var LAYER_IN_WORLD = "in-world";
var LAYER_COMMUNITY = "community";
var LAYER_UNKNOWN = "unknown";

var LAYER_LABEL = {
  "in-world": "世界观内",
  "community": "社区整理",
  "unknown": "来源层级未定"
};

var RELIABILITY_RANK = { primary: 0, secondary: 1, tertiary: 2 };

var ALTERNATE_PREFIX = "另有一说：";

function ConflictError(message) {
  this.name = "ConflictError";
  this.message = message;
  if (Error.captureStackTrace) Error.captureStackTrace(this, ConflictError);
}
ConflictError.prototype = Object.create(Error.prototype);
ConflictError.prototype.constructor = ConflictError;

// 单条来源的层级。语料里只有「游戏内…」与「社区…」两族，其余显式记为未定而不是猜。
//
// **先认「社区」再认「游戏内」**，不是随手写的顺序：「社区设定汇总（引用游戏内**容**）」
// 里恰好含有「游戏内」这个子串，先认游戏内会把它判成原著。社区汇总引用游戏内容本就
// 两头都沾，取社区一档更保守。
function sourceLayer(sourceNature) {
  if (typeof sourceNature !== "string") return LAYER_UNKNOWN;
  if (sourceNature.indexOf("社区") !== -1) return LAYER_COMMUNITY;
  if (sourceNature.indexOf("游戏内") !== -1) return LAYER_IN_WORLD;
  return LAYER_UNKNOWN;
}

// 卡片层级 = 其来源里最弱的一档。`unknown` 比两级都弱：拿不准时不许冒充原著。
function cardLayer(card, sourceNatures) {
  var ids = (card.sources || []).map(function (s) { return s.sourceId; });
  if (!ids.length) return LAYER_UNKNOWN;
  var worst = LAYER_IN_WORLD;
  for (var i = 0; i < ids.length; i++) {
    var layer = sourceLayer(sourceNatures[ids[i]]);
    if (layer === LAYER_UNKNOWN) return LAYER_UNKNOWN;
    if (layer === LAYER_COMMUNITY) worst = LAYER_COMMUNITY;
  }
  return worst;
}

function speaksFor(card, speaker) {
  return !!speaker && (card.characters || []).indexOf(speaker) !== -1;
}

function reliabilityRank(card) {
  var r = RELIABILITY_RANK[card.reliability];
  return r === undefined ? 3 : r;
}

// 返回 -1 / 0 / 1：a 是否应排在 b 之前。0 表示四级全并列。
function compareCards(a, b, options) {
  var opts = options || {};
  var natures = opts.sourceNatures || {};

  // 1. 当事人优先，仅在一侧当事时生效
  var aSide = speaksFor(a, opts.speaker);
  var bSide = speaksFor(b, opts.speaker);
  if (aSide !== bSide) return aSide ? -1 : 1;

  // 2. 来源层级
  var la = cardLayer(a, natures);
  var lb = cardLayer(b, natures);
  if (la !== lb) {
    if (la === LAYER_UNKNOWN) return 1;
    if (lb === LAYER_UNKNOWN) return -1;
    return la === LAYER_IN_WORLD ? -1 : 1;
  }

  // 3. reliability
  var ra = reliabilityRank(a);
  var rb = reliabilityRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;

  // 4. cardId 字典序，保证确定性
  if (a.cardId !== b.cardId) return a.cardId < b.cardId ? -1 : 1;
  return 0;
}

// 解析一组冲突卡。返回 { primary, alternates, reason }；alternates 已按同一顺序排好。
// `reason` 命中的是第几级，便于测试与诊断，不要放进提示词。
function rankGroup(cards, options) {
  if (!Array.isArray(cards) || cards.length < 2) {
    throw new ConflictError("rankGroup 需要至少两张卡，收到 " + (cards && cards.length));
  }
  var opts = options || {};
  var natures = opts.sourceNatures || {};
  var sorted = cards.slice().sort(function (a, b) { return compareCards(a, b, opts); });

  var top = sorted[0];
  var second = sorted[1];
  var reason;
  if (speaksFor(top, opts.speaker) !== speaksFor(second, opts.speaker)) {
    reason = "speaker-party";
  } else if (cardLayer(top, natures) !== cardLayer(second, natures)) {
    reason = "source-layer";
  } else if (reliabilityRank(top) !== reliabilityRank(second)) {
    reason = "reliability";
  } else {
    reason = "cardId";
  }
  return { primary: top, alternates: sorted.slice(1), reason: reason };
}

// 固定格式：前缀 + 副卡 summary 首句 + 来源层级标注。
// 角色可以把两者合并陈述，但必须带得出这个前缀，不能说得像只有一个版本。
function formatAlternate(card, sourceNatures) {
  var first = String(card.summary || "").split(/[。；]/)[0];
  return ALTERNATE_PREFIX + first + "（" + LAYER_LABEL[cardLayer(card, sourceNatures || {})] + "）";
}

module.exports = {
  LAYER_IN_WORLD: LAYER_IN_WORLD,
  LAYER_COMMUNITY: LAYER_COMMUNITY,
  LAYER_UNKNOWN: LAYER_UNKNOWN,
  LAYER_LABEL: LAYER_LABEL,
  ALTERNATE_PREFIX: ALTERNATE_PREFIX,
  ConflictError: ConflictError,
  sourceLayer: sourceLayer,
  cardLayer: cardLayer,
  compareCards: compareCards,
  rankGroup: rankGroup,
  formatAlternate: formatAlternate
};
