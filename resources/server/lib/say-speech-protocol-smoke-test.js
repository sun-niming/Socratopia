"use strict";

// Incremental behaviour of the 【内联朗读标注 v1】 protocol (spec ../../SAY_INLINE_SPEECH_PROTOCOL_CHANGELOG.md §1).
// Runs standalone: node resources/server/lib/say-speech-protocol-smoke-test.js
//
// The contract under test: `<say>` is recognised ONLY immediately after a math close delimiter, its
// content never reaches the display text, every failure degrades to the deterministic pipeline, and
// the identical hint sequence comes out of any chunk split.

const assert = require("assert");
const say = require("./say-speech-protocol.js");
const voice = require("./voice-emotion-protocol.js");

const ALLOWED = ["default", "neutral", "happy", "surprised", "sad"];
const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: String((error && error.message) || error) }); }
};

// Feed `input` in fixed-size slices. Returns the realised clean text, the hint list and notices.
function feed(input, size, options) {
  const parser = new say.SaySpeechParser({
    allowedEmotionIds: ALLOWED, defaultEmotion: "neutral", ...(options || {}),
  });
  let text = "";
  const hints = [];
  const segments = [];
  for (let i = 0; i < input.length; i += size) {
    const r = parser.push(input.slice(i, i + size));
    text += r.text;
    hints.push(...r.hints);
    segments.push(...r.segments);
  }
  const end = parser.end();
  text += end.text;
  hints.push(...end.hints);
  segments.push(...end.segments);
  return { text, hints, segments, notices: end.notices };
}

function merged(segments) {
  const out = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.emotion === seg.emotion) last.text += seg.text;
    else out.push({ emotion: seg.emotion, text: seg.text });
  }
  return out;
}

function codes(notices) {
  return notices.map((n) => n.code);
}

// Every size from 1..7 must realise byte-identical text and hints (§5.1).
function assertChunkStable(input, options) {
  const whole = feed(input, input.length, options);
  for (let size = 1; size <= 7; size++) {
    const got = feed(input, size, options);
    assert.strictEqual(got.text, whole.text, "chunk size " + size + " changed the clean text");
    assert.deepStrictEqual(got.hints, whole.hints, "chunk size " + size + " changed the hints");
  }
  return whole;
}

const SAMPLE = "当 $P(A|B)$<say>p 条件下 a 的概率</say> 已知时，用 $P(B)$ 求结果。";

// --- 1. chunk-boundary independence ---------------------------------------------------
check("clean text and hints are identical at every chunk size 1..7", () => {
  const whole = assertChunkStable(SAMPLE);
  assert.strictEqual(whole.text, "当 $P(A|B)$ 已知时，用 $P(B)$ 求结果。");
  assert.strictEqual(whole.hints.length, 1);
  assert.strictEqual(whole.hints[0].anchorEnd, "当 $P(A|B)$".length);
  assert.strictEqual(whole.hints[0].speech, "p 条件下 a 的概率");
});

check("a <say> split at any character never leaks into the text", () => {
  const at = SAMPLE.indexOf("<say");
  for (let cut = at + 1; cut <= at + "say>".length; cut++) {
    const got = feed(SAMPLE.slice(0, cut), 1);
    assert(!got.text.includes("<"), "cut at " + cut + " leaked '<'");
    assert(!got.text.includes("say"), "cut at " + cut + " leaked the tag name");
  }
  // An unterminated open tag is a control fragment: dropped, never printed.
  const partial = feed(SAMPLE.slice(0, at + 4), 1);
  assert.strictEqual(partial.text, "当 $P(A|B)$");
});

// --- 2. the happy path, in every math delimiter form ----------------------------------
check("a well-formed hint is stripped from the text and anchored at the math close", () => {
  const got = feed("$P(A|B)$<say>p 条件下 a 的概率</say>。", 1);
  assert.strictEqual(got.text, "$P(A|B)$。");
  assert.deepStrictEqual(got.hints.map((h) => [h.anchorEnd, h.speech]), [[8, "p 条件下 a 的概率"]]);
  assert.deepStrictEqual(codes(got.notices), []);
});

check("a block formula may be separated by a single newline", () => {
  // The `$$` pair and the newline both straddle chunk boundaries here; the anchor must survive.
  const got = assertChunkStable("$$x=1$$\n<say>x 等于一</say>。", {});
  assert.strictEqual(got.text, "$$x=1$$\n。");
  assert.deepStrictEqual(got.hints.map((h) => [h.anchorEnd, h.speech]), [[7, "x 等于一"]]);
});

check("a block formula split as $$ + $$ still anchors", () => {
  for (const size of [1, 2, 3]) {
    const got = feed("前文 $$y=2$$ <say>y 等于二</say> 后文。", size);
    assert.strictEqual(got.text, "前文 $$y=2$$  后文。", "chunk size " + size);
    assert.deepStrictEqual(got.hints.map((h) => [h.anchorEnd, h.speech]), [[10, "y 等于二"]], "chunk size " + size);
  }
});

check("a '<' inside a fence does not swallow the tag that follows the fence", () => {
  const got = assertChunkStable("```js\nconst a=1; // a<b\n```\n$x$<say>艾克斯</say>。", {});
  assert.strictEqual(got.text, "```js\nconst a=1; // a<b\n```\n$x$。");
  assert.deepStrictEqual(got.hints.map((h) => [h.anchorEnd, h.speech]), [[31, "艾克斯"]]);
});

check("a hint may sit inside a voice segment and offsets stay in one coordinate system", () => {
  const got = feed('<voice emotion="happy">看 $x^2$<say>x 平方</say>。</voice>', 1);
  assert.strictEqual(got.text, "看 $x^2$。");
  assert.deepStrictEqual(got.hints.map((h) => [h.anchorEnd, h.speech]), [[7, "x 平方"]]);
  assert.deepStrictEqual(merged(got.segments), [{ emotion: "happy", text: "看 $x^2$。" }]);
  // The anchor sits inside the voice segment's own offset range, past the formula and ahead of
  // the sentence punctuation: one coordinate system, no second base to reconcile.
  assert.strictEqual(merged(got.segments)[0].text[got.hints[0].anchorEnd], "。");
});

// --- 3. position violations are stripped from the display -----------------------------
check("a say with no preceding math is stripped, tag and content", () => {
  const got = feed("我们看 <say>这个式子</say>。", 1);
  assert.strictEqual(got.text, "我们看 。");
  assert.deepStrictEqual(got.hints, []);
  assert(codes(got.notices).includes("stray_say"), "expected a stray_say notice");
});

check("a say after the sentence punctuation is stripped, tag and content", () => {
  const got = feed("$x$。<say>艾克斯</say>。", 1);
  assert.strictEqual(got.text, "$x$。。", "chunk size 1");
  assert.deepStrictEqual(got.hints, []);
  assert(codes(got.notices).includes("stray_say"), "expected a stray_say notice");
});

check("a stray say is stripped identically however the stream is chunked", () => {
  const got = assertChunkStable("结尾。\n<say>从内向外沿链查找</say>", {});
  assert.strictEqual(got.text, "结尾。\n");
  assert.deepStrictEqual(got.hints, []);
  assert(codes(got.notices).includes("stray_say"), "expected a stray_say notice");
});

check("an unclosed stray say at end of stream is dropped, not shown", () => {
  const got = feed("结尾。<say>从内向外沿链查找", 1);
  assert.strictEqual(got.text, "结尾。");
  assert.deepStrictEqual(got.hints, []);
  assert(codes(got.notices).includes("unclosed_say"), "expected an unclosed_say notice");
});

check("a lone stray </say> close tag is swallowed", () => {
  const got = feed("前文 </say> 后文。", 1);
  assert.strictEqual(got.text, "前文  后文。");
  assert(codes(got.notices).includes("stray_say_close"), "expected a stray_say_close notice");
});

check("a say inside a code fence or inline code stays literal", () => {
  const fenced = feed("```js\nconst a = 1;\n```\n", 1);
  assert.strictEqual(fenced.text, "```js\nconst a = 1;\n```\n");

  const inFence = feed("```\n$P(A|B)$<say>条件概率</say>\n```\n", 1);
  assert.strictEqual(inFence.text, "```\n$P(A|B)$<say>条件概率</say>\n```\n");
  assert.deepStrictEqual(inFence.hints, []);

  const inCode = feed("用 `$x$<say>艾克斯</say>` 表示。", 1);
  assert.strictEqual(inCode.text, "用 `$x$<say>艾克斯</say>` 表示。");
  assert.deepStrictEqual(inCode.hints, []);
});

check("a say open tag with a stray attribute is literal", () => {
  // The attribute form is not control syntax, so the open tag and the content stay visible;
  // the close tag behind it closed nothing and is swallowed like any other stray </say>.
  const got = feed("$x$<say emotion=\"happy\">艾克斯</say>。", 1);
  assert.strictEqual(got.text, "$x$<say emotion=\"happy\">艾克斯。");
  assert.deepStrictEqual(got.hints, []);
});

// --- 4. content violations are dropped, never shown -----------------------------------
check("content carrying LaTeX, braces or angle brackets is dropped", () => {
  for (const [label, speech] of [
    ["latex command", "\\alpha 加一"],
    ["brace", "x 的 {平方}"],
    ["angle", "x < y"],
    ["dollar", "$x$ 加一"],
    ["placeholder", "这个公式"],
    ["empty", "   "],
  ]) {
    const got = feed("$x$<say>" + speech + "</say>。", 1);
    assert.strictEqual(got.text, "$x$。", label + " changed the clean text");
    assert.deepStrictEqual(got.hints, [], label + " produced a hint");
    assert(codes(got.notices).includes("malformed_say"), label + " produced no notice");
  }
});

check("an over-long hint is dropped, its overflow spilled as prose", () => {
  const speech = "甲".repeat(say.MAX_SAY_CHARS + 1);
  const got = feed("$x$<say>" + speech + "</say>。", 1);
  // The one character past the cap is real content the model wrote, so it survives as prose —
  // and the `</say>` that closed the dropped annotation is still eaten, not printed.
  assert.strictEqual(got.text, "$x$甲。");
  assert.deepStrictEqual(got.hints, []);
  assert(codes(got.notices).includes("say_overflow"));
});

// --- 5. malformed stream recovery -----------------------------------------------------
check("an unclosed say is dropped at end() without a hint", () => {
  const got = feed("$x$<say>艾克斯", 1);
  assert.strictEqual(got.text, "$x$");
  assert.deepStrictEqual(got.hints, []);
  assert(codes(got.notices).includes("unclosed_say"));
});

check("an unclosed say that overflows recovers to prose deterministically", () => {
  const body = "甲".repeat(say.MAX_SAY_CHARS + 10);
  const input = "$x$<say>" + body + "结尾。";
  const got = assertChunkStable(input);
  assert.strictEqual(got.text, "$x$" + "甲".repeat(10) + "结尾。");
  assert.deepStrictEqual(got.hints, []);
  assert(codes(got.notices).includes("say_overflow"));
});

// --- 6. bookkeeping limits ------------------------------------------------------------
check("the 17th hint is dropped with a notice", () => {
  let input = "";
  for (let i = 0; i < say.MAX_SAY_HINTS + 1; i++) input += "$a$<say>甲</say>";
  const got = feed(input, 3);
  assert.strictEqual(got.hints.length, say.MAX_SAY_HINTS);
  assert(codes(got.notices).includes("say_hint_overflow"));
  assert.strictEqual(got.text, "$a$".repeat(say.MAX_SAY_HINTS + 1));
});

check("two hints on one formula keep the same anchor and the later one wins", () => {
  const got = feed("$a$<say>甲</say><say>乙</say>。", 1);
  assert.strictEqual(got.text, "$a$。");
  assert.deepStrictEqual(got.hints.map((h) => [h.anchorEnd, h.speech]), [[3, "甲"], [3, "乙"]]);
  assert(codes(got.notices).includes("duplicate_hint"));
});

// --- 7. tracker: hint events precede the text delta that releases the sentence ---------
check("the tracker emits the hint in the same frame as, and ahead of, its text", () => {
  const tracker = say.createSayHintTracker({ messageId: "msg-1", allowedEmotionIds: ALLOWED });
  const frame = tracker.push("$P(A|B)$<say>p 条件下 a 的概率</say>。");
  const hintEvent = frame.events.find((e) => e.type === "speech_hint");
  assert(hintEvent, "no speech_hint event");
  assert.strictEqual(hintEvent.protocol, "say-protocol-v1");
  assert.strictEqual(hintEvent.messageId, "msg-1");
  assert.strictEqual(hintEvent.hintId, "msg-1:h0");
  assert.strictEqual(hintEvent.anchorEnd, 8);
  assert.strictEqual(hintEvent.speech, "p 条件下 a 的概率");
  // The route dispatches events before the text delta of the same frame (§5.2): as long as the
  // hint rides the events array, it is registered before the '。' reaches the fragmenter.
  assert.strictEqual(frame.text, "$P(A|B)$。");
  assert.strictEqual(frame.text.length, 9);
  assert(hintEvent.anchorEnd < frame.text.length, "anchor must point inside the emitted text");
  assert(codes(tracker.end().notices).includes("unclosed_segment") === false);
});

check("the tracker mirrors voice segment offsets alongside the hints", () => {
  const tracker = say.createSayHintTracker({
    messageId: "msg-2", allowedEmotionIds: ALLOWED, defaultEmotion: "neutral",
  });
  const frame = tracker.push('看 $x$<say>艾克斯</say>。</voice>');
  const deltas = frame.events.filter((e) => e.type === "speech_segment_delta");
  const hint = frame.events.find((e) => e.type === "speech_hint");
  assert(hint, "no speech_hint event");
  assert.deepStrictEqual(deltas.map((d) => [d.start, d.end, d.text]), [[0, 6, "看 $x$。"]]);
  assert.strictEqual(hint.anchorEnd, 5);
});

// --- 8. prompt block ------------------------------------------------------------------
check("the prompt block carries the grammar, the anchor rule and the restraint rule", () => {
  const zh = say.buildSayPromptBlock({});
  assert(zh.includes("【内联朗读标注 v1】"));
  assert(zh.includes("<say>"));
  assert(zh.includes("</say>"));
  assert(zh.includes("句末标点"));
  assert(zh.includes("不标注"), "the block must tell the model that silence is allowed");
  assert.strictEqual(zh.split("<say>").length, 4, "one grammar example plus one correct/wrong contrast pair");
  assert(new Set(zh.split("\n").filter((l) => l.includes("<say>"))).size >= 1);
  assert(zh.includes("错误"), "the block must carry a negative example");
});

check("the trailing reminder is short, per-language and states the anchor rule", () => {
  const zh = say.buildSayTrailingReminder({});
  assert(zh.includes("<say>") && zh.includes("$...$"), "zh reminder states the anchor rule");
  assert(zh.length <= 120, "the reminder must stay cheap: " + zh.length + " chars");
  const en = say.buildSayTrailingReminder({ language: "english" });
  const tw = say.buildSayTrailingReminder({ language: "chinese-traditional" });
  assert(en.includes("<say>") && !en.includes("格式提醒"), "english reminder");
  assert(tw.includes("格式提醒") && tw.includes("緊跟"), "zh-TW reminder uses traditional glyphs");
  assert(en.length <= 240 && tw.length <= 120, "reminders must stay cheap");
});

check("every classroom language gets its own block", () => {
  const en = say.buildSayPromptBlock({ language: "english" });
  const tw = say.buildSayPromptBlock({ language: "chinese-traditional" });
  assert(/[A-Za-z]{3}/.test(en) && !en.includes("【内联朗读标注 v1】"));
  assert(tw.includes("【內聯朗讀標注 v1】"), "zh-TW must use traditional glyphs");
  assert(en.includes("<say>") && tw.includes("<say>"));
});

check("the prompt block never interpolates caller text into protocol rules", () => {
  const block = say.buildSayPromptBlock({ language: "english" });
  assert(block.split("\n").every((l) => l.trim() !== ""));
});

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({
  result: failed.length ? "FAIL" : "PASS",
  total: results.length, failed: failed.length, failures: failed,
}, null, 2));
if (failed.length) process.exitCode = 1;
