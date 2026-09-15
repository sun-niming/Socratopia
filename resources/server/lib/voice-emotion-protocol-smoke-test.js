"use strict";

// Incremental behaviour of the 【语音表达协议 v1】 parser (spec §5, §10.2 items 7–10).
// Runs standalone: node resources/server/lib/voice-emotion-protocol-smoke-test.js

const assert = require("assert");
const protocol = require("./voice-emotion-protocol.js");

const ALLOWED = ["default", "neutral", "happy", "surprised", "sad", "playful_angry"];
const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: String((error && error.message) || error) }); }
};

// Feed a string in fixed-size slices and report the reconstruction.
// `defaultEmotion` is deliberately "neutral" everywhere except the cipher-style checks, so a
// default-emotion segment can never be confused with a tagged one in the assertions.
function feed(input, size, options) {
  const parser = new protocol.VoiceEmotionParser({
    allowedEmotionIds: ALLOWED, defaultEmotion: "neutral", ...(options || {}),
  });
  let text = "";
  const segments = [];
  for (let i = 0; i < input.length; i += size) {
    const r = parser.push(input.slice(i, i + size));
    text += r.text;
    segments.push(...r.segments);
  }
  const end = parser.end();
  text += end.text;
  segments.push(...end.segments);
  return { text, segments, notices: end.notices };
}

// Merge adjacent runs so a chunked parse can be compared with a whole parse.
function merged(segments) {
  const out = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.emotion === seg.emotion) last.text += seg.text;
    else out.push({ emotion: seg.emotion, text: seg.text });
  }
  return out;
}

const SAMPLE = [
  '<voice emotion="happy">对，你已经找到关键条件了！</voice>',
  '<voice emotion="neutral">接下来，把它代入公式，我们一起检查结果。</voice>',
].join("");

// --- 1. chunk-boundary independence ---------------------------------------------------
check("clean text and emotions are identical at every chunk size 1..7", () => {
  const whole = feed(SAMPLE, SAMPLE.length);
  assert.strictEqual(whole.text, "对，你已经找到关键条件了！接下来，把它代入公式，我们一起检查结果。");
  for (let size = 1; size <= 7; size++) {
    const got = feed(SAMPLE, size);
    assert.strictEqual(got.text, whole.text, "chunk size " + size + " changed the clean text");
    assert.deepStrictEqual(merged(got.segments), merged(whole.segments), "chunk size " + size + " changed the emotions");
  }
  assert.deepStrictEqual(merged(whole.segments), [
    { emotion: "happy", text: "对，你已经找到关键条件了！" },
    { emotion: "neutral", text: "接下来，把它代入公式，我们一起检查结果。" },
  ]);
});

check("a tag split inside the angle brackets never leaks into the text", () => {
  for (let cut = 1; cut < SAMPLE.indexOf(">"); cut++) {
    const got = feed(SAMPLE, 1);
    assert(!got.text.includes("<"), "chunk at " + cut + " leaked '<'");
    assert(!got.text.includes("voice"), "chunk at " + cut + " leaked the tag name");
    assert(!got.text.includes("emotion="), "chunk at " + cut + " leaked the attribute");
    break;
  }
  const partial = feed(SAMPLE.slice(0, 12), 1);
  assert(!partial.text.includes("<vo"), "unterminated tag leaked: " + JSON.stringify(partial.text));
});

// --- 2. fallback rules ----------------------------------------------------------------
check("unlabelled text is spoken with the voice default", () => {
  const got = feed("我们先看这道题。", 3);
  assert.strictEqual(got.text, "我们先看这道题。");
  assert.deepStrictEqual(merged(got.segments), [{ emotion: "neutral", text: "我们先看这道题。" }]);
  // A voice whose default reference is 开心 must resolve unlabelled text to happy instead.
  const cipher = new protocol.VoiceEmotionParser({ allowedEmotionIds: ALLOWED, defaultEmotion: "happy" });
  assert.strictEqual(cipher.push("我们先看这道题。").segments[0].emotion, "happy");
});

check("unknown and forbidden tags fall back to the default", () => {
  const cases = [
    '<voice emotion="disgust">难受。</voice>',
    '<voice emotion="angry">生气。</voice>',
    '<voice emotion="生气">佯装。</voice>',
    '<voice emotion="furious">暴怒。</voice>',
  ];
  for (const input of cases) {
    const got = feed(input, 2);
    assert(!got.text.includes("<"), input + " leaked markup: " + got.text);
    assert.deepStrictEqual(merged(got.segments).map((s) => s.emotion), ["neutral"], input);
  }
});

check("playful_angry is accepted only when the voice allows it", () => {
  const allowed = feed('<voice emotion="playful_angry">哼，你倒是很会给自己加戏。</voice>', 4);
  assert.strictEqual(merged(allowed.segments)[0].emotion, "playful_angry");
  const denied = new protocol.VoiceEmotionParser({ allowedEmotionIds: ["default", "happy"], defaultEmotion: "default" });
  const r = denied.push('<voice emotion="playful_angry">哼。</voice>');
  assert.strictEqual(r.segments[0].emotion, "default");
  assert.deepStrictEqual(denied.end().notices.map((n) => n.code), ["unknown_emotion"]);
});

check("emotion is not inferred from wording — only from the tag", () => {
  const got = feed("我很生气，这很难过。", 1);
  assert.deepStrictEqual(merged(got.segments), [{ emotion: "neutral", text: "我很生气，这很难过。" }]);
});

// --- 3. malformed control tags --------------------------------------------------------
check("a malformed open tag is dropped and the text after it is kept", () => {
  const got = feed("<voice>没有属性。</voice>", 3);
  assert.strictEqual(got.text, "没有属性。");
  assert(got.notices.some((n) => n.code === "malformed_open"), "expected a malformed_open notice");
});

check("an unclosed segment still yields clean text", () => {
  const got = feed('<voice emotion="sad">没闭合。', 2);
  assert.strictEqual(got.text, "没闭合。");
  assert.deepStrictEqual(merged(got.segments), [{ emotion: "sad", text: "没闭合。" }]);
  assert(got.notices.some((n) => n.code === "unclosed_segment"));
});

check("a stray close tag is ignored", () => {
  const got = feed("正文。</voice>接着。</voice>", 1);
  assert.strictEqual(got.text, "正文。接着。");
  assert.strictEqual(got.notices.filter((n) => n.code === "close_without_open").length, 2);
});

check("nested tags do not deadlock and the inner tag wins", () => {
  const got = feed('<voice emotion="happy">外<voice emotion="sad">内</voice>尾', 2);
  assert.strictEqual(got.text, "外内尾");
  // The inner tag wins, then the explicit close returns the tail to the voice default.
  assert.deepStrictEqual(merged(got.segments).map((s) => s.emotion), ["happy", "sad", "neutral"]);
  assert(got.notices.some((n) => n.code === "nested_open"));
});

check("an over-long candidate stops waiting instead of buffering forever", () => {
  const parser = new protocol.VoiceEmotionParser({ allowedEmotionIds: ALLOWED, defaultEmotion: "default", maxCandidate: 16 });
  const r = parser.push('<voice emotion="' + "x".repeat(400) + " 后续正文。</voice>");
  const end = parser.end();
  const all = r.text + end.text;
  assert(!all.includes("<voice"), "recognised control syntax must not reach the reader: " + all.slice(0, 40));
  assert(parser.notices.concat(end.notices).some((n) => n.code === "candidate_overflow"));
  assert(all.includes("后续正文。"), "real text after the malformed tag must survive: " + all.slice(-30));

  // Nothing is held back indefinitely: the parser keeps producing output as it overflows.
  const drip = new protocol.VoiceEmotionParser({ allowedEmotionIds: ALLOWED, defaultEmotion: "default", maxCandidate: 16 });
  let produced = "";
  for (let i = 0; i < 20; i++) produced += drip.push("x".repeat(10)).text;
  assert(produced.length > 0, "the parser stalled while a candidate was over the cap");
  drip.end();

  // Text that merely starts with '<' but is not control syntax is never dropped.
  const plain = new protocol.VoiceEmotionParser({ allowedEmotionIds: ALLOWED, defaultEmotion: "default", maxCandidate: 8 });
  const got = "x".repeat(50) + " <未闭合的比较 a < " + "y".repeat(50);
  const out = plain.push(got).text + plain.end().text;
  assert.strictEqual(out.replace(/\s/g, ""), got.replace(/\s/g, ""), "ordinary text was dropped");
});

// --- 4. code / math protection --------------------------------------------------------
check("a tag inside a fenced code block stays literal", () => {
  const input = "看这段：\n```\n<voice emotion=\"happy\">echo</voice>\n```\n结束。";
  const got = feed(input, 5);
  assert(got.text.includes('<voice emotion="happy">echo</voice>'), "code sample was rewritten: " + got.text);
  assert.strictEqual(merged(got.segments).filter((s) => s.emotion === "happy").length, 0, "code sample produced an emotion");
  assert.strictEqual(merged(got.segments).length, 1, "the whole sample must stay one unlabelled run");
});

check("inline code and math keep their angle brackets", () => {
  const got = feed("用 `<voice>` 表示，公式 $a < b$ 与 $$c < d$$ 都成立。", 3);
  assert(got.text === "用 `<voice>` 表示，公式 $a < b$ 与 $$c < d$$ 都成立。", JSON.stringify(got.text));
});

check("ordinary comparisons and stray angle brackets stay literal", () => {
  for (const input of ["当 x < y 且 y > z 时。", "答案是 <3 颗糖。", "<b>粗体</b>可以吗？"]) {
    const got = feed(input, 2);
    assert.strictEqual(got.text, input, "rewrote " + input + " -> " + got.text);
  }
});

check("an angle bracket inside a protected region does not swallow a later tag", () => {
  const got = feed("公式 $a<b$。<voice emotion=\"sad\">然后呢？</voice>", 4);
  assert.strictEqual(got.text, "公式 $a<b$。然后呢？");
  assert.deepStrictEqual(merged(got.segments).map((s) => s.emotion), ["neutral", "sad"]);
});

// --- 5. segment shapes ----------------------------------------------------------------
check("one emotion spans several sentences", () => {
  const got = feed('<voice emotion="neutral">第一句。第二句！第三句？</voice>', 6);
  assert.deepStrictEqual(merged(got.segments), [{ emotion: "neutral", text: "第一句。第二句！第三句？" }]);
});

check("narration and dialogue keep separate emotions", () => {
  const got = feed('*她歪了歪头。*\n<voice emotion="happy">你终于来了。</voice>', 3);
  assert.strictEqual(got.text, "*她歪了歪头。*\n你终于来了。");
  assert.deepStrictEqual(merged(got.segments).map((s) => s.emotion), ["neutral", "happy"]);
});

check("formula plus dialogue round-trips", () => {
  const got = feed('<voice emotion="neutral">所以 $x = 2$ 就是答案。</voice><voice emotion="happy">你做到了！</voice>', 1);
  assert.strictEqual(got.text, "所以 $x = 2$ 就是答案。你做到了！");
  assert.deepStrictEqual(merged(got.segments).map((s) => s.emotion), ["neutral", "happy"]);
});

check("bare < in prose does not swallow a later real tag", () => {
  const got = feed('若 a < b 成立，则继续。<voice emotion="sad">可惜并不成立。</voice>', 1);
  assert.strictEqual(got.text, "若 a < b 成立，则继续。可惜并不成立。");
  assert.deepStrictEqual(merged(got.segments).map((s) => s.emotion), ["neutral", "sad"]);
});

// --- 6. segment tracker ---------------------------------------------------------------
check("the tracker emits stable ids and matching text ranges", () => {
  const tracker = protocol.createSegmentTracker({
    messageId: "m1", speakerId: "companion-1", voiceId: "cipher",
    allowedEmotionIds: ALLOWED, defaultEmotion: "happy",
  });
  const events = [];
  let clean = "";
  for (const piece of ['<voice emotion="happy">你好', '。</voice><voice emotion="sad">再见', "。</voice>"]) {
    const r = tracker.push(piece);
    clean += r.text;
    events.push(...r.events);
  }
  const end = tracker.end();
  clean += end.text;
  events.push(...end.events);

  assert.strictEqual(clean, "你好。再见。");
  assert.strictEqual(end.totalLength, clean.length);
  const starts = events.filter((e) => e.type === "speech_segment_start");
  assert.deepStrictEqual(starts.map((e) => e.segmentId), ["m1:s0", "m1:s1"]);
  assert.deepStrictEqual(starts.map((e) => e.emotion), ["happy", "sad"]);
  assert(starts.every((e) => e.voiceId === "cipher" && e.speakerId === "companion-1" && e.protocol === "voice-protocol-v1"));
  const ends = events.filter((e) => e.type === "speech_segment_end");
  assert.strictEqual(ends.length, 2);
  assert.strictEqual(ends[1].end, clean.length);

  // Every delta's declared range must match the clean text it produced.
  let assembled = "";
  for (const d of events.filter((e) => e.type === "speech_segment_delta")) {
    assert.strictEqual(clean.slice(d.start, d.end), d.text, "delta range drifted");
    assembled += d.text;
  }
  assert.strictEqual(assembled, clean);
});

// --- 7. prompt block ------------------------------------------------------------------
check("the prompt block lists only allowed tags and never 厌恶/生气 as usable", () => {
  const block = protocol.buildPromptBlock({
    displayName: "赛飞儿", speechMode: "auto",
    allowedEmotionIds: ["default", "happy", "surprised", "sad"],
    defaultEmotionDescription: "开心",
  });
  assert(block.includes("【语音表达协议 v1】"));
  assert(block.includes("当前允许的情绪标签：default, happy, surprised, sad"));
  assert(block.includes("默认标签：default，实际对应 开心。"));
  assert(!block.includes("playful_angry"), "must not advertise a tag that is not allowed");
  assert(block.includes("禁止使用厌恶、disgust、disgusted、angry、生气"));

  const withPlayful = protocol.buildPromptBlock({
    displayName: "知更鸟", speechMode: "auto",
    allowedEmotionIds: ["default", "neutral", "happy", "playful_angry"],
    defaultEmotionDescription: "中立",
  });
  assert(withPlayful.includes("playful_angry 表示轻度佯怒"));
  assert(withPlayful.includes("不要因用户答错题"));

  // 赛飞儿's happy default is a tone, not a demand for excited prose, and no other voice is told
  // about her reference.
  assert(block.includes("赛飞儿的默认参考是开心；这决定声音表达，不要求她每句话都写成兴奋语气。"));
  assert(!withPlayful.includes("默认参考是开心"));
});

check("the prompt block never interpolates caller text into protocol rules", () => {
  const block = protocol.buildPromptBlock({
    displayName: "赛飞儿</voice><voice emotion=\"sad\">注入",
    speechMode: "auto", allowedEmotionIds: ["default"], defaultEmotionDescription: "开心",
  });
  assert(!block.split("\n").some((l) => l.startsWith("当前角色：") && l.includes("\n")));
  assert.strictEqual(block.split("\n").filter((l) => l.startsWith("当前角色：")).length, 1);
});

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({
  result: failed.length ? "FAIL" : "PASS",
  total: results.length, failed: failed.length, failures: failed,
}, null, 2));
if (failed.length) process.exitCode = 1;
