"use strict";

// 章末习题上下文压缩的回归测试（2026-09-13）。
//
// 覆盖：
//   * 从原书窗口里按题号取出完整题干（容忍 OCR 常见混淆：l/I→1、O→0，以及 "2 . 7 节" 这类空格）；
//   * 选题阶段按队列给出各题题干；
//   * 知识库依据只挑强匹配的卡片，弱匹配一律不给；
//   * 兜底原文段落落在习题区之前的讲解正文；
//   * 任何一环不成立（题号找不到、不是习题模式、知识库读不到）都回退到 ok:false，
//     调用方保持原来的整段窗口。

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var E = require("./exercise-context.js");

var root = fs.mkdtempSync(path.join(os.tmpdir(), "exercise-context-"));
var kbDir = path.join(root, "knowledge_base");
fs.mkdirSync(path.join(kbDir, "cards"), { recursive: true });

var reading = [
  "<!-- startPage: 125 endPage: 136 -->",
  "--- 第 130 页 ---",
  "2.7 套接字编程",
  "UDP 服务器只需要一个套接字，TCP 服务器需要两个：欢迎套接字与连接套接字。",
  "--- 第 131 页 ---",
  "客户点击超链接后，若本地没有 DNS 缓存，需要先做 DNS 查询再建立 TCP 连接。",
  "--- 第 132 页 ---",
  "课后习题和问题",
  "R26. 2.7 节中所描述的 UDP 服务器仅需要一个套接字，而 TCP 服务器需要两个套接字。为什么？",
  "如果 TCP 服务器支持 n 个并行连接，那么 TCP 服务器将需要多少个套接字？",
  "R27. 服务器程序为什么必须先于客户程序运行？",
  "--- 第 133 页 ---",
  "习题",
  "Pl. 是非判断题。",
  "a. 客户将发送一个请求报文并接收 4 个响应报文。",
  "P7. 假定主机在解析 IP 地址之前访问了 n 个 DNS 服务器，相继的 RTT 为 RTT1 … RTTn，",
  "则从点击超链接到收到对象需要多长时间？",
  "PIO. 考虑一条 10 米短链路，发送方能够以 150bps 速率双向传输。",
  "a 求出总时延。",
  "b. 若分组长度为 100000 比特呢？",
].join("\n");

var cards = [
  {
    concept_id: "330_dns_web_latency",
    title: "DNS 查询与单对象 Web 访问时延",
    definition: "本地无 DNS 缓存时，总时延为 DNS 查询时延、TCP 握手时延与 HTTP 请求响应时延之和。",
    key_points: ["DNS 查询总时延为各 RTT 之和。", "建立 TCP 连接需要 1 个 RTT。", "请求并收到小对象还需要 1 个 RTT。"],
    misconceptions: ["把 DNS 查询的往返时间算成 0。"],
    qa_pairs: [{ q: "访问 n 个 DNS 服务器后取回一个小对象要多久？", a: "总时延 = RTT1+…+RTTn+2×RTT0。" }],
    source_pages: [131, 133],
  },
  {
    concept_id: "331_socket_pair",
    title: "TCP 服务器的欢迎套接字与连接套接字",
    definition: "TCP 服务器用欢迎套接字接受连接，并为每条连接创建专门的连接套接字。",
    key_points: ["UDP 服务器只有一个套接字。", "TCP 服务器每接受一条连接就多一个连接套接字。"],
    source_pages: [130, 132],
  },
  {
    concept_id: "900_generic_distractor",
    title: "计算机网络中的分组交换",
    definition: "分组交换把数据切成小段，通过网络逐跳转发。",
    key_points: ["节点之间共享链路。"],
    source_pages: [10, 12],
  },
];
fs.writeFileSync(path.join(kbDir, "index.json"), JSON.stringify({ cards: cards }));
cards.forEach(function (card) { fs.writeFileSync(path.join(kbDir, "cards", card.concept_id + ".json"), JSON.stringify(card)); });
var reader = E.kbReaderForDir(kbDir);
var failures = 0;

function check(name, fn) {
  try { fn(); console.log("  ok  " + name); }
  catch (error) { failures++; console.log("  FAIL " + name + " - " + (error && error.message)); }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log("  ok  " + name); }
  catch (error) { failures++; console.log("  FAIL " + name + " - " + (error && error.message)); }
}

function taskFor(id, queue, phase) {
  return { mode: "exercise", exerciseQueue: queue || ["R26", "R27", "P1", "P7", "P10"], currentExerciseId: id, phase: phase || "awaiting_answer" };
}

(async function () {
  // ============ 题干定位 ============
  check("题干从题号取到下一个题号为止，并保留子问", function () {
    var found = E.findExerciseStem(reading, "R26");
    assert.strictEqual(found.page, 132, "题号所在页由页标记推断");
    assert.ok(found.stem.indexOf("仅需要一个套接字") >= 0);
    assert.ok(found.stem.indexOf("n 个并行连接") >= 0, "跨行的后半问必须带上");
    assert.strictEqual(found.stem.indexOf("R27"), -1, "不在下一题之后截取");
  });
  check("多行子问跟着题干一起走", function () {
    var found = E.findExerciseStem(reading, "P10");
    assert.strictEqual(found.id, "P10");
    assert.ok(found.stem.indexOf("求出总时延") >= 0, "子问 a 属于本题");
    assert.ok(found.stem.indexOf("100000 比特") >= 0, "子问 b 属于本题");
  });
  check("OCR 混淆的题号仍然定位得到", function () {
    assert.strictEqual(E.normalizeExerciseId("PIO"), "P10");
    assert.strictEqual(E.normalizeExerciseId("Pl"), "P1");
    assert.strictEqual(E.normalizeExerciseId("Rl"), "R1");
    assert.strictEqual(E.normalizeExerciseId("P7"), "P7");
    assert.strictEqual(E.normalizeExerciseId("章末"), null);
    assert.ok(E.findExerciseStem(reading, "P10"), "PIO 可被 P10 找到");
  });
  check("找不到题号时返回 null，而不是给一段猜的内容", function () {
    assert.strictEqual(E.findExerciseStem(reading, "P99"), null);
    assert.strictEqual(E.findExerciseStem(reading, "R99"), null);
  });

  // ============ 选题阶段 ============
  check("选题阶段按队列顺序列出题干", function () {
    var listed = E.listQueueStems(reading, ["R26", "R27", "P7"], 5200);
    assert.strictEqual(listed.lines.length, 3);
    assert.ok(listed.lines[0].indexOf("- R26：") === 0, "第一条是队列第一题，实际 " + listed.lines[0]);
    assert.ok(listed.lines[2].indexOf("- P7：") === 0, "队列顺序保持不变");
    assert.strictEqual(listed.page, 132, "锚点取第一道能找到的题所在页");
  });

  // ============ 知识库依据 ============
  await checkAsync("依据卡片只挑强匹配，通用卡片不会被塞进来", async function () {
    var found = E.findExerciseStem(reading, "P7");
    var picked = await E.mineEvidence(reader, found.stem + " P7", found.page, { maxCards: 2 });
    var titles = picked.map(function (card) { return card.title; });
    assert.ok(titles.indexOf("DNS 查询与单对象 Web 访问时延") >= 0, "命中的是 DNS 时延卡片，实际 " + titles.join("、"));
    assert.strictEqual(titles.indexOf("计算机网络中的分组交换"), -1, "通用卡片不得进入依据");
    assert.ok((picked[0].definition || "").length > 0, "依据来自卡片详情，而不是索引里的标题");
  });
  await checkAsync("题号本身不进入打分（R26 不会被当成关键词）", async function () {
    var found = E.findExerciseStem(reading, "R26");
    var picked = await E.mineEvidence(reader, found.stem + " R26", found.page, { maxCards: 2 });
    var titles = picked.map(function (card) { return card.title; });
    assert.ok(titles.indexOf("TCP 服务器的欢迎套接字与连接套接字") >= 0, "套接字题命中套接字卡片，实际 " + titles.join("、"));
    assert.strictEqual(titles.indexOf("DNS 查询与单对象 Web 访问时延"), -1, "不相关卡片不得进入");
  });
  await checkAsync("知识库读不到时只发题干，不会报错", async function () {
    var broken = E.kbReaderForDir(path.join(root, "missing"));
    var result = await E.buildExerciseContext({ readingText: reading, task: taskFor("P7"), readKbFile: broken, limit: 5200 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.stats.evidenceCards, 0);
    assert.ok(result.block.indexOf("需要多长时间") >= 0, "题干仍然完整");
  });

  // ============ 组装 ============
  await checkAsync("当前题块包含完整题干、依据与按需读取的说明", async function () {
    var result = await E.buildExerciseContext({ readingText: reading, task: taskFor("P7"), kbDir: kbDir, limit: 5200 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.stats.stage, "per-item");
    assert.strictEqual(result.stats.exerciseId, "P7");
    assert.ok(result.block.indexOf("题干（原书原文，完整）") >= 0);
    assert.ok(result.block.indexOf("则从点击超链接到收到对象需要多长时间？") >= 0, "题干完整带上");
    assert.ok(result.block.indexOf("DNS 查询与单对象 Web 访问时延") >= 0, "依据卡片带上");
    assert.ok(result.block.indexOf("read_textbook_pages") >= 0, "明确按需读取");
    assert.ok(result.block.length <= 5200);
  });
  await checkAsync("兜底原文落在习题区之前的讲解正文", async function () {
    var result = await E.buildExerciseContext({ readingText: reading, task: taskFor("P7"), kbDir: kbDir, limit: 5200 });
    assert.ok(result.excerpt.length > 0);
    assert.ok(result.excerpt.indexOf("UDP 服务器只需要一个套接字") >= 0, "拿到的是 2.7 讲解正文");
    assert.strictEqual(result.excerpt.indexOf("是非判断题"), -1, "不是题号列表");
    assert.strictEqual(result.excerpt.indexOf("课后习题和问题"), -1, "习题区本身不进兜底段落");
  });
  await checkAsync("选题阶段给出全部题干且不带概念依据", async function () {
    var result = await E.buildExerciseContext({ readingText: reading, task: taskFor("", ["R26", "R27", "P7"], "selecting"), kbDir: kbDir, limit: 5200 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.stats.stage, "selection");
    assert.ok(result.block.indexOf("当前阶段：选题") >= 0);
    assert.ok(result.block.indexOf("R26") >= 0 && result.block.indexOf("P7") >= 0);
    assert.strictEqual(result.stats.evidenceCards, 0, "选题阶段不预先绑定依据");
  });
  await checkAsync("超限时先丢依据卡，题干一定保留", async function () {
    var result = await E.buildExerciseContext({ readingText: reading, task: taskFor("P7"), kbDir: kbDir, limit: 700 });
    assert.strictEqual(result.ok, true);
    assert.ok(result.block.indexOf("则从点击超链接到收到对象需要多长时间？") >= 0, "题干仍然完整");
    assert.ok(result.block.length <= 900);
  });
  await checkAsync("不是习题模式或题号找不到时回退，不产出压缩块", async function () {
    var notExercise = await E.buildExerciseContext({ readingText: reading, task: { mode: "lecture" }, kbDir: kbDir });
    assert.strictEqual(notExercise.ok, false);
    assert.strictEqual(notExercise.reason, "not-exercise");
    var missing = await E.buildExerciseContext({ readingText: reading, task: taskFor("P99"), kbDir: kbDir });
    assert.strictEqual(missing.ok, false);
    assert.strictEqual(missing.reason, "stem-not-found");
    var empty = await E.buildExerciseContext({ readingText: "   ", task: taskFor("P7"), kbDir: kbDir });
    assert.strictEqual(empty.ok, false);
  });

  fs.rmSync(root, { recursive: true, force: true });
  if (failures) {
    console.error("\nexercise-context smoke: FAIL (" + failures + ")");
    process.exitCode = 1;
  } else {
    console.log("exercise-context smoke: PASS");
  }
})().catch(function (error) {
  console.error(error && error.stack || error);
  process.exit(1);
});
