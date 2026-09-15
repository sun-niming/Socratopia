"use strict";

// Client half of 【语音表达协议 v1】, exercised as behaviour rather than as text presence.
//
// The helpers are sliced out of the shipped page bundles and run against the real server
// parser (lib/voice-emotion-protocol.js), so the two halves are checked against one another:
// the offsets the server reports are the offsets the page looks up, the fragmenter the page
// already ships decides which emotion a sentence inherits, and a replayed message synthesises
// once per saved segment with that segment's emotion and never re-decides it.
//
// Also pins the per-bundle identity of the injected helper block, so the five retained page
// variants cannot drift apart.

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const protocol = require(path.join(__dirname, "..", "..", "..", "..", "lib", "voice-emotion-protocol.js"));

const bundles = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
];

const HELPER_NAMES = [
  "__socratopiaEmotionModeSetting",
  "__socratopiaFixedEmotionSetting",
  "__socratopiaVoiceIdForSlot",
  "__socratopiaVoiceRequestFields",
  "__socratopiaSegmentMerge",
  "__socratopiaSegmentUpdate",
  "__socratopiaPublishSegments",
  "__socratopiaLiveSegments",
  "__socratopiaFragmentOffset",
  "__socratopiaEmotionAt",
  "__socratopiaCleanSegments",
  "__socratopiaWithSpeechSegments",
  "__socratopiaSpeakStep",
  "__socratopiaSpeakMessage"
];

const HELPERS_START = 'let tv=["npc_a","npc_b","npc_c","npc_d"];';
const HELPERS_END = "function __socratopiaSpeakMessage(";

function sliceFunction(source, name) {
  const from = source.indexOf("function " + name + "(");
  assert(from >= 0, name + ": helper missing from the bundle");
  let depth = 0;
  for (let i = source.indexOf("{", from); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) return source.slice(from, i + 1); }
  }
  assert.fail(name + ": helper is not terminated");
}

// The injected block: everything between the slot list and the last helper's closing brace.
function helperBlock(source) {
  const from = source.indexOf(HELPERS_START);
  assert(from >= 0, "the helper block was not injected");
  const end = source.indexOf(HELPERS_END, from);
  assert(end >= 0, "the replay helper is missing");
  const body = sliceFunction(source.slice(end), "__socratopiaSpeakMessage");
  return source.slice(from + HELPERS_START.length, end + body.length);
}

function loadHelpers(source, env) {
  const code = HELPER_NAMES.map(function (name) { return sliceFunction(source, name); }).join("");
  const factory = new Function(
    "el", "tb", "tg", "tv", "localStorage", "globalThis",
    code + "; return {" + HELPER_NAMES.join(",") + "};"
  );
  return factory(
    env.el || {},
    env.tb || function () { return null; },
    env.tg || function (pronoun) { return pronoun === "他" ? "male" : "female"; },
    ["npc_a", "npc_b", "npc_c", "npc_d"],
    env.localStorage || { getItem: function () { return null; }, setItem: function () {} },
    env.globalThis || {}
  );
}

function makeStorage(values, throwOn) {
  return {
    getItem(key) {
      if (throwOn) throw new Error("storage disabled");
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem() {}
  };
}

const sources = new Map();
for (const name of bundles) {
  const file = path.join(__dirname, name);
  assert(fs.existsSync(file), "missing page bundle: " + name);
  sources.set(name, fs.readFileSync(file, "utf8"));
}
const reference = sources.get(bundles[0]);

// --- 1. the five retained page variants carry the same helper block --------------------
{
  const expected = crypto.createHash("sha256").update(helperBlock(reference)).digest("hex").slice(0, 12);
  for (const name of bundles) {
    const actual = crypto.createHash("sha256").update(helperBlock(sources.get(name))).digest("hex").slice(0, 12);
    assert.strictEqual(actual, expected, name + ": the emotion helper block drifted from the batch");
  }
  for (const name of bundles) {
    const source = sources.get(name);
    assert(
      source.includes("__socratopiaEmotionAt(__socratopiaLiveSegments(B)"),
      name + ": the streamed fragments must resolve their emotion from the live segments"
    );
    assert(
      source.includes("__socratopiaSpeakMessage(r.content,eU,r.id,eW,r.speechSegments)"),
      name + ": replay must go through the segment-aware synthesis"
    );
    assert(
      source.includes('__socratopiaPublishSegments(r,s&&s.id||null,_voiceSegments,t)'),
      name + ": the turn must collect the speech_segment_* events"
    );
    assert(
      source.includes("__socratopiaWithSpeechSegments("),
      name + ": the assistant message must be stored with its speech segments"
    );
    assert(
      source.includes(",...s?.speechSegments?{speechSegments:s.speechSegments}:{},"),
      name + ": the message store must keep the speech segments"
    );
  }
}

// --- 2. the request carries the voice and the emotion settings ------------------------
{
  const calls = [];
  const helpers = loadHelpers(reference, {
    tb(options) { calls.push(options); return "cipher"; },
    localStorage: makeStorage({
      socratopia_voice_emotion_mode: "auto",
      socratopia_voice_emotion_fixed: "happy"
    })
  });

  const companions = [{ candidateId: "fixture_a", pronoun: "她" }, null, null, null];
  assert.strictEqual(
    helpers.__socratopiaVoiceIdForSlot({ fixture_a: "cipher" }, "chinese", companions, "npc_a"),
    "cipher",
    "the turn must send the same voice key the message list plays through"
  );
  assert.deepStrictEqual(
    calls[0],
    { candidateId: "fixture_a", gender: "female", worldLanguage: "chinese", companionVoices: { fixture_a: "cipher" } },
    "the voice key must be resolved with the same inputs the message list uses"
  );
  assert.strictEqual(
    helpers.__socratopiaVoiceIdForSlot({}, "chinese", companions, "npc_c"),
    null,
    "an empty companion slot has no voice to resolve"
  );
  assert.strictEqual(
    helpers.__socratopiaVoiceIdForSlot({}, "chinese", companions, "npc_z"),
    null,
    "an unknown slot has no voice to resolve"
  );

  assert.deepStrictEqual(
    helpers.__socratopiaVoiceRequestFields("cipher"),
    { voiceId: "cipher", emotionMode: "auto", emotionFixed: void 0 },
    "自动情绪 must travel without a fixed emotion: the per-segment tag decides"
  );
  assert.deepStrictEqual(
    helpers.__socratopiaVoiceRequestFields(null),
    { voiceId: void 0, emotionMode: "auto", emotionFixed: void 0 },
    "an unresolved voice degrades to no voiceId; the mode still travels"
  );
}

// --- 3. settings parsing never invents a mode -----------------------------------------
{
  const modeOf = values => loadHelpers(reference, { localStorage: makeStorage(values) });
  assert.strictEqual(modeOf({}).__socratopiaEmotionModeSetting(), "default", "the default mode must stay 默认音色");
  assert.strictEqual(modeOf({ socratopia_voice_emotion_mode: "auto" }).__socratopiaEmotionModeSetting(), "auto");
  assert.strictEqual(modeOf({ socratopia_voice_emotion_mode: "fixed" }).__socratopiaEmotionModeSetting(), "fixed");
  assert.strictEqual(modeOf({ socratopia_voice_emotion_mode: "angry" }).__socratopiaEmotionModeSetting(), "default", "an unknown mode must not leak through");
  assert.strictEqual(modeOf({}).__socratopiaEmotionModeSetting === undefined, false);
  assert.strictEqual(
    loadHelpers(reference, { localStorage: makeStorage({}, true) }).__socratopiaEmotionModeSetting(),
    "default",
    "a disabled localStorage must not break the turn"
  );
  assert.deepStrictEqual(
    loadHelpers(reference, { localStorage: makeStorage({ socratopia_voice_emotion_mode: "fixed", socratopia_voice_emotion_fixed: "sad" }) })
      .__socratopiaVoiceRequestFields("cipher"),
    { voiceId: "cipher", emotionMode: "fixed", emotionFixed: "sad" },
    "固定情绪 must travel with the chosen emotion"
  );
  assert.strictEqual(
    loadHelpers(reference, { localStorage: makeStorage({ socratopia_voice_emotion_mode: "default", socratopia_voice_emotion_fixed: "sad" }) })
      .__socratopiaVoiceRequestFields("cipher").emotionFixed,
    void 0,
    "the fixed emotion must not be sent in 默认音色 mode"
  );
}

// --- 4. segment merging and the live bridge --------------------------------------------
{
  const live = {};
  const helpers = loadHelpers(reference, { globalThis: live });
  const segments = [];

  helpers.__socratopiaSegmentMerge(segments, { type: "speech_segment_start", segmentId: "m:s0", emotion: "happy", voiceId: "cipher", speakerId: "npc_a" });
  helpers.__socratopiaSegmentMerge(segments, { type: "speech_segment_delta", segmentId: "m:s0", text: "你好", start: 0, end: 2 });
  helpers.__socratopiaSegmentMerge(segments, { type: "speech_segment_delta", segmentId: "m:s0", text: "，这是第一段。", start: 2, end: 9 });
  helpers.__socratopiaSegmentMerge(segments, { type: "speech_segment_start", segmentId: "m:s1", emotion: "sad" });
  helpers.__socratopiaSegmentMerge(segments, { type: "speech_segment_delta", segmentId: "m:s1", text: "可惜不对。", start: 9, end: 14 });
  helpers.__socratopiaSegmentMerge(segments, { type: "speech_segment_end", segmentId: "m:s1", start: 9, end: 14 });
  helpers.__socratopiaPublishSegments("conv-1", "m", segments, null);

  assert.strictEqual(segments.length, 2, "one entry per segment");
  assert.deepStrictEqual(
    segments.map(s => [s.segmentId, s.emotion, s.start, s.end]),
    [["m:s0", "happy", 0, 9], ["m:s1", "sad", 9, 14]],
    "a start event without offsets must still merge into the delta's range"
  );

  assert.strictEqual(helpers.__socratopiaLiveSegments("conv-1"), segments, "the live bridge must expose the current turn");
  assert.strictEqual(helpers.__socratopiaLiveSegments("conv-2"), null, "a stale turn must not be reused by another conversation");
  assert.strictEqual(
    helpers.__socratopiaEmotionAt(null, 0),
    null,
    "no segments means no emotion, which means the voice default"
  );
  assert.strictEqual(helpers.__socratopiaEmotionAt(segments, 0), "happy");
  assert.strictEqual(helpers.__socratopiaEmotionAt(segments, 8), "happy", "the last character of a segment still belongs to it");
  assert.strictEqual(helpers.__socratopiaEmotionAt(segments, 9), "sad", "the first character of the next segment belongs to it");
  assert.strictEqual(helpers.__socratopiaEmotionAt(segments, 14), null, "an offset past the text has no emotion");

  assert.deepStrictEqual(
    helpers.__socratopiaCleanSegments(segments),
    [
      { segmentId: "m:s0", emotion: "happy", voiceId: "cipher", speakerId: "npc_a", start: 0, end: 9 },
      { segmentId: "m:s1", emotion: "sad", voiceId: null, speakerId: null, start: 9, end: 14 }
    ],
    "only the offsets and the metadata are persisted, never the text"
  );
  assert.strictEqual(helpers.__socratopiaCleanSegments([]), null, "an empty segment list must not be stored");
  assert.strictEqual(helpers.__socratopiaWithSpeechSegments(void 0, []), void 0, "a turn with no segments must not gain an empty field");
  assert.deepStrictEqual(
    helpers.__socratopiaWithSpeechSegments({ reasoningContent: "r" }, segments),
    { reasoningContent: "r", speechSegments: helpers.__socratopiaCleanSegments(segments) },
    "the stored extra must keep what was already there"
  );
}

// --- 5. the shipped fragmenter and the real server parser agree on the offsets ----------
const SENTENCE_SPLIT = String.raw`/(?<=[。！？])|(?<=[A-Za-z\u4e00-\u9fff][.!?])\s+|\n\s*\n+/`;
const fragment = new Function(sliceFunction(reference, "__socratopiaSpeechFragments") + "; return __socratopiaSpeechFragments;")();
const SENTENCE_SPLIT_RE = new RegExp(String.raw`(?<=[。！？])|(?<=[A-Za-z\u4e00-\u9fff][.!?])\s+|\n\s*\n+`);

const HEAD = "对，你已经找到关键条件了！";
const MIDDLE = "可惜这一步代入之后结果并不成立。";
const TAIL = "最后我们把两段合起来看。";
const TAGGED = '<voice emotion="happy">' + HEAD + "</voice><voice emotion=\"sad\">" + MIDDLE + "</voice>" + TAIL;
const CLEAN = HEAD + MIDDLE + TAIL;

function serverSegments(text, frameSize) {
  const tracker = protocol.createSegmentTracker({
    messageId: "m", speakerId: "npc_a", voiceId: "cipher",
    allowedEmotionIds: ["default", "surprised", "happy", "sad"],
    defaultEmotion: "happy", maxCandidate: 128
  });
  const events = [];
  for (let at = 0; at < text.length; at += frameSize) {
    const frame = tracker.push(text.slice(at, at + frameSize));
    for (const event of frame.events) events.push(event);
  }
  const end = tracker.end();
  for (const event of end.events) events.push(event);
  return { clean: events.filter(e => e.type === "speech_segment_delta").map(e => e.text).join(""), events };
}

// Replays the page's own consumption: merge the events, then resolve each released fragment.
function emotionPerFragment(events, clean) {
  const helpers = loadHelpers(reference, { globalThis: {} });
  const segments = [];
  for (const event of events) helpers.__socratopiaSegmentMerge(segments, event);
  const parts = fragment(clean, SENTENCE_SPLIT_RE);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].trim()) continue;
    out.push({
      text: parts[i],
      emotion: helpers.__socratopiaEmotionAt(segments, helpers.__socratopiaFragmentOffset(parts, i))
    });
  }
  return { out, segments: helpers.__socratopiaCleanSegments(segments) };
}

{
  const expected = [
    { text: HEAD, emotion: "happy" },
    { text: MIDDLE, emotion: "sad" },
    { text: TAIL, emotion: "happy" } // unmarked text inherits the voice default (赛飞儿: 开心)
  ];
  const expectedSegments = [
    { segmentId: "m:s0", emotion: "happy", voiceId: "cipher", speakerId: "npc_a", start: 0, end: HEAD.length },
    { segmentId: "m:s1", emotion: "sad", voiceId: "cipher", speakerId: "npc_a", start: HEAD.length, end: HEAD.length + MIDDLE.length },
    { segmentId: "m:s2", emotion: "happy", voiceId: "cipher", speakerId: "npc_a", start: HEAD.length + MIDDLE.length, end: CLEAN.length }
  ];

  for (const frameSize of [1, 2, 3, 7, 64, TAGGED.length]) {
    const { clean, events } = serverSegments(TAGGED, frameSize);
    assert.strictEqual(clean, CLEAN, "clean text drifted at frame size " + frameSize);
    const { out, segments } = emotionPerFragment(events, clean);
    assert.deepStrictEqual(out, expected, "per-sentence emotion drifted at frame size " + frameSize);
    assert.deepStrictEqual(segments, expectedSegments, "persisted segments drifted at frame size " + frameSize);
  }

  // A sentence split across a segment boundary inherits the emotion it starts in.
  const split = serverSegments('<voice emotion="happy">先看这一步。</voice><voice emotion="sad">可是它不成立。</voice>', 5);
  const helpers = loadHelpers(reference, { globalThis: {} });
  const segments = [];
  for (const event of split.events) helpers.__socratopiaSegmentMerge(segments, event);
  assert.strictEqual(helpers.__socratopiaEmotionAt(segments, 0), "happy");
  assert.strictEqual(helpers.__socratopiaEmotionAt(segments, CLEAN.length + 0), null, "offsets belong to one message only");
}

// --- 6. the groupchat request carries the same voice and emotion settings ---------------
{
  for (const name of bundles) {
    const source = sources.get(name);
    assert(
      source.includes("companionVoices:__socratopiaCompanionVoices})"),
      name + ": the groupchat component must accept the companion voice bindings"
    );
    assert(
      source.includes("companionVoices:O.companionVoices,"),
      name + ": the page must hand the settings' bindings to the groupchat"
    );
    assert.strictEqual(
      source.split("companionVoices:O.companionVoices,companionVoices:").length - 1,
      0,
      name + ": the binding prop must be passed exactly once"
    );
    // Both groupchat PUT bodies (the SSE turn and the broadcast) carry the same fields the
    // classroom sends: the per-companion voice bindings plus the emotion settings.
    assert.strictEqual(
      source.split("accessMode:h,sessionToken:f,companionVoices:__socratopiaCompanionVoices,...__socratopiaVoiceRequestFields()}").length - 1,
      2,
      name + ": both groupchat requests must carry the bindings and the emotion settings"
    );
  }
}

// --- 7. replay synthesises once per segment, in order, with its own emotion -------------
function replayCalls(content, speechSegments, speed) {
  const calls = [];
  const helpers = loadHelpers(reference, {
    el: { speak: (text, voiceId, trackId, atSpeed, emotion) => { calls.push({ text, voiceId, trackId, speed: atSpeed, emotion }); return Promise.resolve(); } }
  });
  return helpers.__socratopiaSpeakMessage(content, "cipher", "msg-1", speed, speechSegments).then(() => calls);
}

(async () => {
  const segments = [
    { segmentId: "m:s0", emotion: "happy", voiceId: "cipher", speakerId: "npc_a", start: 0, end: HEAD.length },
    { segmentId: "m:s1", emotion: "sad", voiceId: "cipher", speakerId: "npc_a", start: HEAD.length, end: HEAD.length + MIDDLE.length },
    { segmentId: "m:s2", emotion: "happy", voiceId: "cipher", speakerId: "npc_a", start: HEAD.length + MIDDLE.length, end: CLEAN.length }
  ];

  const calls = await replayCalls(CLEAN, segments, 1.25);
  assert.deepStrictEqual(
    calls,
    [
      { text: HEAD, voiceId: "cipher", trackId: "msg-1", speed: 1.25, emotion: "happy" },
      { text: MIDDLE, voiceId: "cipher", trackId: "msg-1", speed: 1.25, emotion: "sad" },
      { text: TAIL, voiceId: "cipher", trackId: "msg-1", speed: 1.25, emotion: "happy" }
    ],
    "each saved segment must be spoken once, in order, with its own emotion"
  );

  // A legacy message has no metadata: one call, no emotion, the voice default applies.
  const legacy = await replayCalls(CLEAN, null, 1);
  assert.deepStrictEqual(
    legacy,
    [{ text: CLEAN, voiceId: "cipher", trackId: "msg-1", speed: 1, emotion: void 0 }],
    "an old message must keep exactly the previous replay behaviour"
  );

  // An aborted turn keeps the text that was never labelled.
  const partial = await replayCalls(CLEAN, segments.slice(0, 1), 1);
  assert.deepStrictEqual(
    partial.map(c => [c.text, c.emotion]),
    [[HEAD, "happy"], [MIDDLE + TAIL, void 0]],
    "text past the last segment must still be spoken, with no emotion"
  );

  // Narration-only segments are filtered downstream, so they are never counted twice.
  const empty = await replayCalls("", null, 1);
  assert.deepStrictEqual(empty, [{ text: "", voiceId: "cipher", trackId: "msg-1", speed: 1, emotion: void 0 }]);

  console.log(JSON.stringify({
    result: "PASS",
    bundles: bundles.length,
    helperBlock: crypto.createHash("sha256").update(helperBlock(reference)).digest("hex").slice(0, 12),
    frameSizes: [1, 2, 3, 7, 64, TAGGED.length],
    replayCalls: calls.length,
    legacyReplayCalls: legacy.length
  }, null, 2));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
