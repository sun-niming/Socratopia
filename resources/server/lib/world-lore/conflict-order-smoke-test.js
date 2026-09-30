/**
 * Smoke test for lib/world-lore/conflict-order.js — pure logic, no network, no fixtures on disk.
 * Run: node resources/server/lib/world-lore/conflict-order-smoke-test.js
 *
 * fixture 用真实的那一对冲突卡（刻律德菈的结局，S021 残卷 vs S002 编年史）。
 */
"use strict";
var C = require("./conflict-order.js");

var pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.error("  FAIL: " + label); }
}
function eq(a, b, label) { ok(a === b, label + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function throws(fn, label) {
  try { fn(); ok(false, label + " (did not throw)"); }
  catch (e) { ok(e instanceof C.ConflictError, label + " (threw " + e.name + ")"); }
}

// 真实来源层级：S021 是游戏内文献，S002 是社区设定汇总
var NATURES = { S021: "游戏内文献（BWIKI镜像）", S002: "社区设定汇总（引用游戏内容）" };

function card(id, over) {
  var base = {
    cardId: id, canon: "amphoreus", type: "history", summary: "刻律德菈的结局。第二句。",
    characters: [], reliability: "secondary", sources: [{ sourceId: "S021" }]
  };
  for (var k in (over || {})) base[k] = over[k];
  return base;
}

console.log("== 来源层级只有三档，拿不准记 unknown 而不是猜 ==");
eq(C.sourceLayer("游戏内文献（BWIKI镜像）"), C.LAYER_IN_WORLD, "游戏内 -> in-world");
eq(C.sourceLayer("游戏内任务正文（BWIKI整理／镜像）"), C.LAYER_IN_WORLD, "任务正文也属游戏内");
eq(C.sourceLayer("社区设定汇总（引用游戏内容）"), C.LAYER_COMMUNITY, "社区 -> community");
eq(C.sourceLayer("社区资料索引"), C.LAYER_COMMUNITY, "社区索引 -> community");
eq(C.sourceLayer(""), C.LAYER_UNKNOWN, "空串 -> unknown");
eq(C.sourceLayer(undefined), C.LAYER_UNKNOWN, "undefined -> unknown");
eq(C.sourceLayer("别的来源"), C.LAYER_UNKNOWN, "不认识 -> unknown");
eq(C.sourceLayer("社区引用游戏内容确立"), C.LAYER_COMMUNITY, "同时含两词时以社区为准（保守）");

console.log("== 卡片层级取其来源里最弱的一档 ==");
eq(C.cardLayer(card("a"), NATURES), C.LAYER_IN_WORLD, "只引游戏内 -> in-world");
eq(C.cardLayer(card("a", { sources: [{ sourceId: "S021" }, { sourceId: "S002" }] }), NATURES),
   C.LAYER_COMMUNITY, "引到社区汇总就不算纯原著");
eq(C.cardLayer(card("a", { sources: [{ sourceId: "S021" }, { sourceId: "S999" }] }), NATURES),
   C.LAYER_UNKNOWN, "含未定来源 -> unknown（比两级都弱）");
eq(C.cardLayer(card("a", { sources: [] }), NATURES), C.LAYER_UNKNOWN, "无来源 -> unknown");

console.log("== 当事人优先：只在**恰有一侧**当事时生效 ==");
(function () {
  var hers = card("x", { characters: ["aglaea"] });
  var others = card("y");
  eq(C.compareCards(hers, others, { speaker: "aglaea", sourceNatures: NATURES }), -1,
     "说话人那一侧排前");
  eq(C.compareCards(others, hers, { speaker: "aglaea", sourceNatures: NATURES }), 1,
     "对调后结论相反");
  eq(C.rankGroup([others, hers], { speaker: "aglaea", sourceNatures: NATURES }).reason,
     "speaker-party", "reason 记 speaker-party");

  // 真实数据里那一对冲突卡两侧的 characters 都是 aglaea；再让它们的来源层级也有别，
  // 才能看出"当事人这一级并列后确实落回了层级"而不是被别的级别吸收。
  var hers = card("x", { characters: ["aglaea"], sources: [{ sourceId: "S021" }] });
  var theirs = card("y", { characters: ["aglaea"], sources: [{ sourceId: "S002" }] });
  eq(C.rankGroup([hers, theirs], { speaker: "aglaea", sourceNatures: NATURES }).reason,
     "source-layer", "两侧都当事 -> 该级并列，落回来源层级");
  eq(C.rankGroup([hers, theirs], { speaker: "mydei", sourceNatures: NATURES }).reason,
     "source-layer", "两侧都不当事 -> 同样落回来源层级");

  // 全对称的一对（同层级、同 reliability、两侧都不是当事）：只剩 cardId 可依，仍是确定的。
  var t1 = card("b", { characters: ["aglaea"] });
  var t2 = card("a", { characters: ["aglaea"] });
  eq(C.rankGroup([t1, t2], { speaker: "aglaea", sourceNatures: NATURES }).reason,
     "cardId", "全对称时以 cardId 定序");
  eq(C.rankGroup([t1, t2], { speaker: "aglaea", sourceNatures: NATURES }).primary.cardId,
     "a", "cardId 字典序");
})();

console.log("== 没有当事人时按来源层级：世界观内优先 ==");
(function () {
  var inWorld = card("a", { sources: [{ sourceId: "S021" }] });
  var community = card("b", { sources: [{ sourceId: "S002" }] });
  var g = C.rankGroup([community, inWorld], { sourceNatures: NATURES });
  eq(g.primary.cardId, "a", "残卷（世界观内）为主");
  eq(g.alternates[0].cardId, "b", "社区整理为另说");
  eq(g.reason, "source-layer", "reason 记 source-layer");
  // 与输入顺序无关
  eq(C.rankGroup([inWorld, community], { sourceNatures: NATURES }).primary.cardId, "a",
     "输入顺序不影响结果");
})();

console.log("== 层级并列时看 reliability，再并列才看 cardId ==");
(function () {
  var weak = card("a", { reliability: "tertiary" });
  var strong = card("b", { reliability: "primary" });
  eq(C.rankGroup([weak, strong], { sourceNatures: NATURES }).primary.cardId, "b", "primary 优先");
  eq(C.rankGroup([weak, strong], { sourceNatures: NATURES }).reason, "reliability", "reason 记 reliability");

  var x = card("a"), y = card("b");
  eq(C.rankGroup([y, x], { sourceNatures: NATURES }).primary.cardId, "a", "全并列时按 cardId");
  eq(C.rankGroup([y, x], { sourceNatures: NATURES }).reason, "cardId", "reason 记 cardId");
  eq(C.compareCards(x, x, { sourceNatures: NATURES }), 0, "同卡比较为 0");
})();

console.log("== 三张以上也能排，且顺序与逐对一致 ==");
(function () {
  var g = C.rankGroup([card("c", { sources: [{ sourceId: "S002" }] }),
                       card("a", { sources: [{ sourceId: "S021" }] }),
                       card("b", { sources: [{ sourceId: "S021" }], reliability: "tertiary" })],
                      { sourceNatures: NATURES });
  eq(g.primary.cardId, "a", "最强者为主");
  eq(g.alternates.map(function (c) { return c.cardId; }).join(","), "b,c", "其余按同一顺序排列");
})();

console.log("== 确定性：200 次同一输入结果不变 ==");
(function () {
  var set = [card("b", { sources: [{ sourceId: "S002" }] }), card("a")];
  var first = C.rankGroup(set, { sourceNatures: NATURES }).primary.cardId;
  for (var i = 0; i < 200; i++) {
    if (C.rankGroup(set, { sourceNatures: NATURES }).primary.cardId !== first) { fail++; break; }
  }
  ok(true, "稳定");
  // 原数组不被就地改动
  var orig = [card("z"), card("a")];
  C.rankGroup(orig, { sourceNatures: NATURES });
  eq(orig[0].cardId, "z", "rankGroup 不改动入参数组");
})();

console.log("== 「另说」是固定前缀 + 首句 + 层级标注 ==");
(function () {
  var c = card("a", { summary: "刻律德菈从众人视野中彻底消失；政局直到阿格莱雅拨乱反正。",
                      sources: [{ sourceId: "S021" }] });
  var s = C.formatAlternate(c, NATURES);
  ok(s.indexOf(C.ALTERNATE_PREFIX) === 0, "以「另有一说：」开头");
  eq(s, "另有一说：刻律德菈从众人视野中彻底消失（世界观内）", "首句 + 层级标注");
  ok(C.formatAlternate(card("a", { sources: [{ sourceId: "S002" }] }), NATURES)
       .indexOf("（社区整理）") !== -1, "社区来源标注为社区整理");
})();

console.log("== 坏输入显式抛错 ==");
throws(function () { C.rankGroup([]); }, "空数组");
throws(function () { C.rankGroup([card("a")]); }, "单张卡");
throws(function () { C.rankGroup(null); }, "null");
ok(C.ConflictError.prototype instanceof Error, "ConflictError 继承 Error");

console.log("");
console.log("conflict-order smoke: " + (fail === 0 ? "PASS" : "FAIL") +
  " (" + pass + " passed, " + fail + " failed)");
process.exit(fail === 0 ? 0 : 1);
