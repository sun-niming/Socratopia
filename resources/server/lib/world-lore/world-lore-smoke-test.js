/**
 * Smoke test for lib/world-lore/retriever.js — 04-minimal-verification.md §2 的 T1。
 * Run: node resources/server/lib/world-lore/world-lore-smoke-test.js
 *
 * 覆盖 T1 七条（同 world 命中、跨 world／跨账户不命中、超 cutoff 不命中、私密只对
 * allow 可见、低相关返空、不超卡片数/字符预算、同输入稳定），外加两条契约要点：
 * 被过滤的私密卡不得泄漏存在性、冲突组只留主卡并附「另说」。夹具内联，不读盘。
 */
"use strict";
var R = require("./retriever.js");

var pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.error("  FAIL: " + label); }
}
function eq(a, b, label) { ok(a === b, label + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }

// 来源层级：S001 游戏内（世界观内），S002 社区汇总
var NATURES = { S001: "游戏内文献（BWIKI镜像）", S002: "社区设定汇总（引用游戏内容）" };
function src(sid) { return [{ sourceId: sid, url: "https://e/" + sid, work: "w", locator: "l" }]; }

var ID = 0;
function card(over) {
  ID++;
  var base = {
    schemaVersion: 1, cardId: "amphoreus.world.c" + ID, canon: "amphoreus", type: "world",
    title: "标题" + ID, summary: "内容" + ID, evidence: ["证据"], characters: [], locations: [],
    factions: [], aliases: [], timeRange: { from: null, to: null },
    knowledgeScope: { level: "public", allow: [], deny: [] },
    claimType: "derived_summary", reliability: "secondary", spoilerLevel: "3.0",
    sources: src("S001")
  };
  for (var k in over) base[k] = over[k];
  return base;
}

// —— 夹具：amphoreus（acc1 / p1 / w_amp），截止 3.7 ——
var HER = card({ cardId: "amphoreus.location.okhema.001", type: "location", title: "奥赫玛",
  summary: "永恒圣城，刻法勒庇护下人类最后的避难所。", aliases: ["奥赫玛", "永恒圣城"],
  locations: ["okhema"], spoilerLevel: "3.0" });
var STORY_NOW = card({ cardId: "amphoreus.history.now.001", type: "history", title: "第二次逐火之旅",
  summary: "逐火之旅正在进行。", spoilerLevel: "3.7" });
var FUTURE = card({ cardId: "amphoreus.history.future.001", type: "history", title: "二相乐园篇的剧情",
  summary: "二相乐园篇的逐火之旅余波。", spoilerLevel: "4.0" });
var SECRET = card({ cardId: "amphoreus.secret.arson.001", type: "secret", title: "盗火行者的童年阴影",
  summary: "那道高大的黑色身影与盗火行者同源。",
  knowledgeScope: { level: "secret", allow: ["phainon"], deny: [] } });
var CONFLICT_A = card({ cardId: "amphoreus.history.roll.001", type: "history", title: "刻律德菈的结局（残卷记载）",
  summary: "从众人视野中彻底消失。", sources: src("S001") });
var CONFLICT_B = card({ cardId: "amphoreus.history.chron.001", type: "history", title: "刻律德菈的结局（编年史记载）",
  summary: "遇刺身亡，实为自杀。", sources: src("S002"), conflictsWith: [CONFLICT_A.cardId] });
CONFLICT_A.conflictsWith = [CONFLICT_B.cardId];

// 用于预算测试的若干"什么都沾"的卡
var FILLER = [];
for (var i = 0; i < 5; i++) {
  FILLER.push(card({ cardId: "amphoreus.culture.fill" + i + ".001", type: "culture",
    title: "节庆" + i, summary: "利衡币与节庆的日常。", spoilerLevel: "3.0" }));
}

var ELSEWHERE = card({ cardId: "amphoreus.faction.xuanfeng.001", type: "faction",
  title: "悬锋王朝", summary: "悬锋城的武邦与逐火之旅的盟友。", locations: ["xuanfeng"] });
var TEV_CARD = card({ cardId: "teyvat.culture.mora.001", canon: "teyvat", type: "culture",
  title: "摩拉", summary: "摩拉是提瓦特通行大陆的钱。", spoilerLevel: "第一章·第一幕",
  timeRange: { from: null, to: "第一章·第一幕" }, versionRange: { from: null, to: "1.0" } });
// 版本侧超过 versionFloor(7.0) 的卡：章·幕在截止点内，但版本轴应把它挡掉
var TEV_FUTURE = card({ cardId: "teyvat.history.future.001", canon: "teyvat", type: "history",
  title: "摩拉的来龙", summary: "摩拉的铸造与岩神之心有关。", spoilerLevel: "第一章·第一幕",
  timeRange: { from: null, to: "第一章·第一幕" }, versionRange: { from: null, to: "8.0" } });

function scopeOf(worldId, accountId, profileId, canon, cards) {
  return { accountId: accountId, profileId: profileId, worldId: worldId, canon: canon, cards: cards,
    aliases: { "永恒圣城": [HER.cardId] }, sourceNatures: NATURES,
    manifest: { canon: canon, canonCutoff: canon === "amphoreus"
      ? { axis: "hsr-version", value: "3.7" }
      : { axis: "genshin-chapter-act", value: "第七章·第二幕", versionFloor: "7.0" } } };
}

var INDEX = R.createIndex({ scopes: [
  scopeOf("w_amp", "acc1", "p1", "amphoreus",
    [HER, STORY_NOW, FUTURE, SECRET, CONFLICT_A, CONFLICT_B, ELSEWHERE].concat(FILLER)),
  scopeOf("w_tev", "acc1", "p1", "teyvat", [TEV_CARD, TEV_FUTURE]),
  scopeOf("w_amp", "acc2", "p2", "amphoreus", [HER])
] });

var BASE = { worldId: "w_amp", accountId: "acc1", profileId: "p1", speaker: "phainon" };
function q(text, over) {
  var req = { worldId: BASE.worldId, accountId: BASE.accountId, profileId: BASE.profileId,
    speaker: BASE.speaker, query: text };
  for (var k in (over || {})) req[k] = over[k];
  return R.retrieve(INDEX, req);
}
function ids(res) { return res.items.map(function (i) { return i.cardId; }); }

console.log("== T1-1 同 world 公共卡可以命中 ==");
(function () {
  var res = q("奥赫玛是什么地方");
  ok(ids(res).indexOf(HER.cardId) !== -1, "命中奥赫玛卡");
  eq(res.items[0].cardId, HER.cardId, "最相关者排第一");
  ok(res.items[0].matched.length > 0, "带命中依据");
  ok(res.items[0].sources[0].url === "https://e/S001", "带完整来源元数据");
})();

console.log("== T1-2 另一个 world 或账户的卡不可命中 ==");
(function () {
  ok(ids(q("奥赫玛")).indexOf(TEV_CARD.cardId) === -1, "另一个 world 的卡不出现");
  ok(ids(q("摩拉", { worldId: "w_tev" })).indexOf(TEV_CARD.cardId) !== -1, "切到该 world 则命中");
  ok(ids(q("摩拉", { worldId: "w_tev" })).indexOf(HER.cardId) === -1, "反向也不串");
  ok(ids(q("奥赫玛", { accountId: "acc2", profileId: "p2" })).length === 1, "同账户换 profile 命中该 scope");
  ok(ids(q("奥赫玛", { accountId: "acc2", profileId: "p1" })).length === 0, "账户/profile 不匹配则整体排除");
  ok(q("奥赫玛", { accountId: "acc_none" }).items.length === 0, "未知账户返回空");
  // 提瓦特双轴：章·幕未超截止，但版本侧超 versionFloor 也要挡住
  var tev = q("摩拉", { worldId: "w_tev" });
  ok(ids(tev).indexOf(TEV_CARD.cardId) !== -1, "章·幕与版本都在界内 -> 命中");
  ok(ids(tev).indexOf(TEV_FUTURE.cardId) === -1, "versionRange 超出 versionFloor -> 挡住");
})();

console.log("== T1-3 超过 canon cutoff 的卡不可命中 ==");
(function () {
  ok(ids(q("逐火之旅")).indexOf(STORY_NOW.cardId) !== -1, "截止点之内的卡命中");
  ok(ids(q("逐火之旅")).indexOf(FUTURE.cardId) === -1, "超过 3.7 的卡不出现");
  // 显式收紧 cutoff 后，边缘卡也出去
  var tight = q("逐火之旅", { canonCutoff: { axis: "hsr-version", value: "3.0" } });
  ok(ids(tight).indexOf(STORY_NOW.cardId) === -1, "3.7 的卡在 3.0 cutoff 下不可见");
})();

console.log("== T1-4 私密卡只对 allow 角色可见 ==");
(function () {
  ok(ids(q("盗火行者")).indexOf(SECRET.cardId) !== -1, "allow 角色命中");
  ok(ids(q("盗火行者", { speaker: "mydei" })).indexOf(SECRET.cardId) === -1, "非 allow 角色不命中");
  ok(ids(q("盗火行者", { speaker: undefined })).indexOf(SECRET.cardId) === -1, "无说话人时不命中");
})();

console.log("== 被过滤的私密卡不泄漏存在性 ==");
(function () {
  var res = q("盗火行者", { speaker: "mydei" });
  var flat = JSON.stringify(res);
  ok(flat.indexOf(SECRET.cardId) === -1, "返回体里不含被过滤卡的任何痕迹");
  ok(res.droppedByBudget === 0, "也没有因过滤产生的计数");
})();

console.log("== T1-5 低相关查询返回空，不凑满条数 ==");
(function () {
  eq(q("zzzzz").items.length, 0, "完全无关 -> 空");
  eq(q("").items.length, 0, "空查询 -> 空");
  eq(q("锣鼓搭子").items.length, 0, "语料里没有的 bigram -> 空");
  var res = q("日常");                       // 只在 FILLER 的 summary 里命中一个 bigram
  ok(res.items.length > 0, "一个字段命中即入选，不因达不到高档位而返空");
  ok(res.items.length < INDEX.scopes[0].cards.length, "不是全量返回，不凑满条数");
  eq(res.items[0].score, R.FIELD_WEIGHT.summaryGram, "该命中就是单条 summary 分");
  ok(R.MIN_SCORE <= R.FIELD_WEIGHT.summaryGram, "下限不高于单字段 bigram 分");
})();

console.log("== T1-6 结果不超过卡片数和字符预算 ==");
(function () {
  var res = q("利衡币与节庆的日常", { maxCards: 2 });
  ok(res.items.length <= 2, "不超过 maxCards");
  ok(res.truncated === true, "被裁则 truncated 为真");
  var tight = q("利衡币与节庆的日常", { maxChars: 200 });
  ok(tight.chars <= 200, "不超过 maxChars（实际 " + tight.chars + "）");
  eq(q("奥赫玛", { maxCards: 0 }).items.length, 0, "maxCards=0 返回空");
})();

console.log("== T1-7 相同输入结果稳定 ==");
(function () {
  var first = ids(q("奥赫玛")).join(",");
  var stable = true;
  for (var i = 0; i < 200; i++) { if (ids(q("奥赫玛")).join(",") !== first) { stable = false; break; } }
  ok(stable, "200 次同输入同结果");
  // 与候选顺序无关：作用域与卡片顺序打乱后仍一致
  var shuffled = R.createIndex({ scopes: [scopeOf("w_amp", "acc1", "p1", "amphoreus",
    [].concat(FILLER, [CONFLICT_B, SECRET, FUTURE, STORY_NOW, CONFLICT_A, HER]))] });
  eq(R.retrieve(shuffled, { worldId: "w_amp", accountId: "acc1", profileId: "p1",
      speaker: "phainon", query: "奥赫玛" }).items[0].cardId, HER.cardId, "乱序输入同一结果");
})();

console.log("== 过滤钩子：类型、地点、见证范围 ==");
(function () {
  eq(ids(q("奥赫玛", { types: ["location"] }))[0], HER.cardId, "types 命中");
  ok(ids(q("奥赫玛", { types: ["secret"] })).length === 0, "types 不含则排除");
  ok(ids(q("逐火之旅", { location: "okhema" })).indexOf(ELSEWHERE.cardId) === -1, "挂了别的地点则排除");
  ok(ids(q("逐火之旅", { location: "xuanfeng" })).indexOf(ELSEWHERE.cardId) !== -1, "地点相符则命中");
  ok(ids(q("逐火之旅", { location: "okhema" })).indexOf(STORY_NOW.cardId) !== -1, "未挂地点的卡不受地点过滤");
  var witnessed = card({ cardId: "amphoreus.history.evt.001", type: "history",
    title: "亲历的事件", summary: "亲历的事件经过。", eventIds: ["evt_1"] });
  var idx2 = R.createIndex({ scopes: [scopeOf("w_e", "acc1", "p1", "amphoreus", [witnessed])] });
  var call = function (ev) { return R.retrieve(idx2, { worldId: "w_e", speaker: "phainon",
      query: "亲历的事件", witnessedEventIds: ev }).items.length; };
  eq(call(["evt_1"]), 1, "见证过则命中");
  eq(call(["evt_9"]), 0, "未见证则不命中");
  eq(call(undefined), 0, "没有见证范围时事件卡不可见");
})();

console.log("== 冲突组：只留主卡，副卡以「另说」附出且不重复出现 ==");
(function () {
  var res = q("刻律德菈的结局");
  ok(ids(res).indexOf(CONFLICT_A.cardId) !== -1, "世界观内那一侧为主卡");
  ok(ids(res).indexOf(CONFLICT_B.cardId) === -1, "副卡不再作为独立条目出现");
  var primary = res.items.filter(function (i) { return i.cardId === CONFLICT_A.cardId; })[0];
  eq(primary.alternates.length, 1, "主卡挂了一条附注");
  ok(primary.alternates[0].note.indexOf("另有一说：") === 0, "附注用固定前缀");
  ok(primary.alternates[0].note.indexOf("社区整理") !== -1, "附注标注来源层级");
  eq(primary.alternates[0].cardId, CONFLICT_B.cardId, "附注指向另一侧");
  ok(res.chars > 0, "附注也计入字符预算");
})();

console.log("== 入参不被改动，返回的是新对象 ==");
(function () {
  var res = q("奥赫玛");
  res.items[0].title = "改了";
  eq(q("奥赫玛").items[0].title, "奥赫玛", "再次检索不受上一次返回值影响");
  ok(INDEX.scopes[0].cards.length === 12, "索引卡片数不变");
})();

console.log("");
console.log("world-lore smoke: " + (fail === 0 ? "PASS" : "FAIL") +
  " (" + pass + " passed, " + fail + " failed)");
process.exit(fail === 0 ? 0 : 1);
