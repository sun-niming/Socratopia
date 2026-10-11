"use strict";

// The groupchat half of the voice-emotion protocol (spec §4.2, §5, §8 step 4, §10.2 #15).
// The route is one minified line, so this test slices the shipped functions out of it and runs
// them for real: voice-key resolution, the per-line cleaning pass, the emotion-aware synthesis
// call, and the prompt-block injection.  Nothing here re-implements the route; every assertion
// exercises the compiled code.
//
// Runs standalone: node resources/server/lib/groupchat-emotion-smoke-test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const lib = require("./voice-catalog.js");
const protocol = require("./voice-emotion-protocol.js");

const ROOT = path.join(__dirname, "..", "..", "..");
const GROUPCHAT = path.join(ROOT, "resources/server/.next/server/app/api/groupchat/route.js");
const catalog = lib.load();

const results = [];
let chain = Promise.resolve();
function check(name, fn) {
  chain = chain
    .then(fn)
    .then(() => results.push({ name, ok: true }))
    .catch((error) => results.push({ name, ok: false, error: String((error && error.message) || error) }));
  return chain;
}

// --- slicing the shipped route -----------------------------------------------------------

function sliceBalanced(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) break;
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") { i = source.indexOf("\n", i); if (i < 0) break; continue; }
    if (ch === "/" && source[i + 1] === "*") { i = source.indexOf("*/", i) + 1; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error("unbalanced braces from offset " + start);
}

function sliceFunction(source, landmark) {
  const start = source.indexOf(landmark);
  assert(start >= 0, "landmark missing: " + landmark);
  return source.slice(start, sliceBalanced(source, start));
}

function between(source, startMark, endMark) {
  const start = source.indexOf(startMark);
  assert(start >= 0, "start marker missing: " + startMark);
  const end = source.indexOf(endMark, start);
  assert(end > start, "end marker missing: " + endMark);
  return source.slice(start, end);
}

// The whole module-scope prologue (legacy table + voice helpers) plus the two TTS functions, and
// the two request-scope fragments (cleaning pass, prompt-block builder) wrapped as callables.
function buildSandbox(options) {
  const o = options || {};
  const source = fs.readFileSync(GROUPCHAT, "utf8");
  const moduleHead = source.slice(source.indexOf("var _ttsV={"), source.indexOf("function _ttsK(t,e){"));
  const cleanLoop = between(source, "var _lineEmotion=[];", "var _ttsJobs=[];");
  const voiceBlock = between(source, 'let _voiceBlock="";', "return{system:r.join(");
  const body = [
    moduleHead,
    sliceFunction(source, "function _ttsK("),
    sliceFunction(source, "async function _ttsS("),
    "function _runClean(o,_nameToVk,_slotNames,_voiceEmotionMode){" + cleanLoop + "return{lines:o,emotions:_lineEmotion}}",
    "function _runVoiceBlock(m,_voiceOpts){" + voiceBlock + "return _voiceBlock}",
    "exports.voiceKey=_groupVoiceKey;exports.cleanLine=_groupCleanLine;exports.synth=_ttsS;" +
      "exports.key=_ttsK;exports.runClean=_runClean;exports.runVoiceBlock=_runVoiceBlock;" +
      "exports.ttsVoices=Object.keys(_ttsV);",
  ].join("");
  const posts = [];
  const writes = [];
  const fetchStub = async (url, init) => {
    if (!String(url).includes("infer_classic")) {
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    posts.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ audio_url: "http://0.0.0.0:8000/a.wav" }) };
  };
  const sandbox = {};
  new Function("fetch", "global", "process", "Buffer", "require", "exports", body)(
    fetchStub,
    {
      __FS__: o.fs || {
        existsSync: () => false,
        mkdirSync: () => {},
        writeFileSync: (file, data) => writes.push([file, data]),
      },
      __PATH__: path,
      __VOICE_CATALOG__: lib,
      __VOICE_EMOTION__: protocol,
    },
    { env: { PROJECT_ROOT: path.join(ROOT, "tmp") } },
    Buffer,
    () => { throw new Error("fs/path must come from the injected globals"); },
    sandbox);
  return Object.assign(sandbox, { posts, writes });
}

const sandbox = buildSandbox();

// --- voice-key resolution ----------------------------------------------------------------

check("a companion's voice key is resolved in exactly one place, language first", () => {
  const V = { "huohuo:zh": "cipher", "huohuo:en": "yae_miko", huohuo: "klee" };
  // Explicit language binding wins, then the other language, then the bare binding.
  assert.strictEqual(sandbox.voiceKey({ candidateId: "huohuo" }, V, "chinese"), "cipher");
  assert.strictEqual(sandbox.voiceKey({ candidateId: "huohuo" }, V, "english"), "yae_miko");
  assert.strictEqual(sandbox.voiceKey({ candidateId: "huohuo" }, { huohuo: "klee" }, "chinese"), "klee");
  assert.strictEqual(sandbox.voiceKey({ candidateId: "huohuo" }, { "huohuo:en": "yae_miko" }, "chinese"), "yae_miko");
});

check("the world's own voice binding outranks the shipped default tables", () => {
  assert.strictEqual(sandbox.voiceKey({ candidateId: "qiu_lingni" }, null, "chinese"), "warmhearted_girl");
  assert.strictEqual(sandbox.voiceKey({ candidateId: "huohuo", voiceKey: "robin" }, null, "chinese"), "robin");
  assert.strictEqual(sandbox.voiceKey({ candidateId: "huohuo", voice: "robin" }, null, "chinese"), "robin");
  assert.strictEqual(sandbox.voiceKey({ candidateId: "unknown", customName: "芙宁娜" }, null, "chinese"), "soft_girl");
  assert.strictEqual(sandbox.voiceKey({ candidateId: "unknown", name: "姬子" }, null, "chinese"), "mature_woman");
  assert.strictEqual(sandbox.voiceKey({ candidateId: "qiu_lingni" }, { "qiu_lingni:zh": "kafka" }, "chinese"), "kafka");
});

check("an unknown companion still lands on a real style voice", () => {
  const key = sandbox.voiceKey({ candidateId: "nobody_at_all" }, null, "chinese");
  assert(sandbox.ttsVoices.includes(key), key + " must be a style voice from the route's own table");
  assert.strictEqual(sandbox.voiceKey({ candidateId: "nobody_at_all" }, null, "chinese"), key, "must be stable");
  assert.strictEqual(sandbox.voiceKey(null, null, "chinese"), null, "a missing companion must not throw");
});

// --- per-line cleaning -------------------------------------------------------------------

const CIPHER = "cipher";
const CIPHER_DEFAULT = catalog.voices.cipher.defaultReferenceId;

check("a catalog companion keeps its tagged emotion and loses the tags", () => {
  const happy = sandbox.cleanLine('<voice emotion="happy">今天先看这道题。</voice>', CIPHER, "auto");
  assert.strictEqual(happy.text, "今天先看这道题。");
  assert.strictEqual(happy.emotion, "happy");
  const sad = sandbox.cleanLine('<voice emotion="sad">我不太确定。</voice>', CIPHER, "auto");
  assert.strictEqual(sad.text, "我不太确定。");
  assert.strictEqual(sad.emotion, "sad");
  // A line becomes one clip, so its first segment decides: text before the first tag speaks in
  // the voice's default reference, exactly as it would without any tag at all.
  const mixed = sandbox.cleanLine('前面那句<voice emotion="sad">我不太确定。</voice>', CIPHER, "auto");
  assert.strictEqual(mixed.text, "前面那句我不太确定。");
  assert.strictEqual(mixed.emotion, CIPHER_DEFAULT);
});

check("plain prose stays byte-identical and speaks in the default reference", () => {
  const plain = sandbox.cleanLine("这是一句普通话。", CIPHER, "auto");
  assert.strictEqual(plain.text, "这是一句普通话。");
  assert.strictEqual(plain.emotion, CIPHER_DEFAULT);
  const lt = sandbox.cleanLine("3 < 5 且 a<b 都保持字面。", CIPHER, "auto");
  assert.strictEqual(lt.text, "3 < 5 且 a<b 都保持字面。");
  assert.strictEqual(lt.emotion, CIPHER_DEFAULT);
});

check("forbidden and malformed tags are stripped but never spoken", () => {
  const disgust = sandbox.cleanLine('<voice emotion="disgust">哼。</voice>', CIPHER, "auto");
  assert.strictEqual(disgust.text, "哼。");
  assert.strictEqual(disgust.emotion, CIPHER_DEFAULT, "a refused tag falls back to the default clip");
  const bogus = sandbox.cleanLine('<voice emotion="triumphant">好吧。</voice>', CIPHER, "auto");
  assert.strictEqual(bogus.text, "好吧。");
  assert.strictEqual(bogus.emotion, CIPHER_DEFAULT);
  const unclosed = sandbox.cleanLine('<voice emotion="sad">话没说完', CIPHER, "auto");
  assert.strictEqual(unclosed.text, "话没说完");
  assert.strictEqual(unclosed.emotion, "sad", "an unclosed tag still opens its segment");
  const stray = sandbox.cleanLine("</voice>收尾。", CIPHER, "auto");
  assert.strictEqual(stray.text, "收尾。");
  assert.strictEqual(stray.emotion, CIPHER_DEFAULT);
});

check("tags inside code, math and inline code stay literal", () => {
  const fenced = '看这段：\n```html\n<voice emotion="happy">x</voice>\n```\n结束。';
  const out = sandbox.cleanLine(fenced, CIPHER, "auto");
  assert(out.text.includes('<voice emotion="happy">x</voice>'), out.text);
  const inline = sandbox.cleanLine('写作 `<voice emotion="happy">` 是标签。', CIPHER, "auto");
  assert(inline.text.includes('<voice emotion="happy">'), inline.text);
  const math = sandbox.cleanLine('公式 $$<voice emotion="happy">$$ 结束。', CIPHER, "auto");
  assert(math.text.includes('<voice emotion="happy">'), math.text);
});

check("a non-catalog companion never gains an emotion", () => {
  const legacy = sandbox.cleanLine('<voice emotion="happy">你好呀。</voice>', "soft_girl", "auto");
  assert.strictEqual(legacy.text, "你好呀。", "tags must still leave the transcript");
  assert.strictEqual(legacy.emotion, null, "a legacy style voice has no emotion references");
  const fallback = sandbox.cleanLine('<voice emotion="happy">你好呀。</voice>', "nobody_at_all", "auto");
  assert.strictEqual(fallback.emotion, null);
});

check("outside auto mode the tags are stripped and ignored", () => {
  for (const mode of ["default", "fixed", undefined]) {
    const out = sandbox.cleanLine('<voice emotion="happy">你好呀。</voice>', CIPHER, mode);
    assert.strictEqual(out.text, "你好呀。", "mode " + mode);
    assert.strictEqual(out.emotion, null, "mode " + mode);
  }
});

// --- synthesis: emotion reaches the request and the cache key ------------------------------

async function synth(text, voiceKey, emotion, mode) {
  sandbox.posts.length = 0;
  await sandbox.synth(text, voiceKey, "n", undefined, emotion || null, mode || "default");
  return sandbox.posts[0];
}

check("auto mode speaks the tagged emotion's reference", async () => {
  const happy = await synth("同一句话。", CIPHER, "happy", "auto");
  const sad = await synth("同一句话。", CIPHER, "sad", "auto");
  assert.strictEqual(happy.version, "v2ProPlus");
  assert.strictEqual(sad.version, "v2ProPlus");
  assert.strictEqual(happy.prompt_text, catalog.voices.cipher.references.happy.promptText);
  assert.strictEqual(sad.prompt_text, catalog.voices.cipher.references.sad.promptText);
  assert.notStrictEqual(happy.ref_audio_path, sad.ref_audio_path, "emotions must not share a clip");
  assert.strictEqual(happy.text, "同一句话。", "the spoken text is the cleaned line");
});

check("each emotion has its own cache entry, and repeats share one", async () => {
  const keyOf = (voiceId, emotion, text) => sandbox.key(
    (() => {
      const ce = lib.resolveClassicEntry(catalog, voiceId, { mode: "auto", emotion });
      return ce && ce.ok ? lib.cacheKeyParts(ce.resolved, { text, speed: 1 }) : voiceId + "|" + text;
    })());
  assert.notStrictEqual(keyOf(CIPHER, "happy", "同一句话。"), keyOf(CIPHER, "sad", "同一句话。"));
  assert.strictEqual(keyOf(CIPHER, "happy", "同一句话。"), keyOf(CIPHER, "happy", "同一句话。"));
});

check("fixed mode pins one reference regardless of the line's tag", async () => {
  const pinned = await synth("同一句话。", CIPHER, "sad", "fixed");
  assert.strictEqual(pinned.prompt_text, catalog.voices.cipher.references.sad.promptText);
});

check("a legacy style voice ignores the emotion entirely", async () => {
  const plain = await synth("同一句话。", "soft_girl", null, "default");
  const tagged = await synth("同一句话。", "soft_girl", "happy", "auto");
  assert.strictEqual(plain.gpt_model_name, "【经典】Funina-e15");
  assert.deepStrictEqual(tagged, plain, "the legacy request body must not move");
  assert.strictEqual(
    sandbox.key("soft_girl|同一句话。"),
    sandbox.key("soft_girl", "同一句话。"),
    "legacy cache keys stay flat");
});

// --- the cleaning pass over a whole reply -------------------------------------------------

check("every line is cleaned before it is archived or sent", () => {
  const lines = [
    "[10:00] 芙宁娜: <voice emotion=\"happy\">晚上好。</voice>",
    "[10:00] 茜特菈莉: <voice emotion=\"sad\">我不太确定。</voice>",
    "（旁白行）",
    "[10:01] 芙宁娜: 这是一句普通话。",
  ];
  const nameToVk = { 芙宁娜: "soft_girl", 茜特菈莉: CIPHER };
  const out = sandbox.runClean(lines.slice(), nameToVk, {}, "auto");
  assert.deepStrictEqual(out.lines, [
    "[10:00] 芙宁娜: 晚上好。",
    "[10:00] 茜特菈莉: 我不太确定。",
    "（旁白行）",
    "[10:01] 芙宁娜: 这是一句普通话。",
  ]);
  assert.deepStrictEqual(out.emotions, [null, "sad", null, null],
    "the emotion array stays index-aligned with the lines, and legacy speakers stay null");
});

check("the cleaning pass is a no-op outside auto mode", () => {
  const lines = ['[10:00] 茜特菈莉: <voice emotion="sad">我不太确定。</voice>'];
  const out = sandbox.runClean(lines.slice(), { 茜特菈莉: CIPHER }, {}, "default");
  assert.deepStrictEqual(out.lines, ["[10:00] 茜特菈莉: 我不太确定。"]);
  assert.deepStrictEqual(out.emotions, [null]);
});

// --- the prompt block ---------------------------------------------------------------------

const CIPHER_NAME = catalog.voices.cipher.displayName;

check("each catalog companion gets one protocol block, legacy companions get none", () => {
  const m = [
    { candidateId: "qiu_lingni", name: "丘玲妮" },
    { candidateId: "unknown", name: "芙宁娜" },
  ];
  const opts = { companionVoices: { "qiu_lingni:zh": CIPHER }, language: "chinese", mode: "auto" };
  const block = sandbox.runVoiceBlock(m, opts);
  assert.strictEqual(block.split("【语音表达协议 v1】").length - 1, 1, block);
  assert(block.includes(CIPHER_NAME), block.slice(-400));
  assert(block.includes(CIPHER_NAME + "的默认参考是开心；这决定声音表达，不要求她每句话都写成兴奋语气。"),
    "a happy default must be described as a tone, not as an instruction");
  assert(!block.includes("单星号"), "the groupchat bans '*' so its block must drop that rule");
  assert(block.startsWith("\r\n\r\n---\r\n\r\n"), "the block must be appended as a prompt section");
  // A roster of legacy style voices gets no protocol at all.
  assert.strictEqual(sandbox.runVoiceBlock([{ candidateId: "unknown", name: "芙宁娜" }], opts), "");
});

check("two companions on the same voice share one block", () => {
  const m = [
    { candidateId: "a", name: "甲", voiceKey: CIPHER },
    { candidateId: "b", name: "乙", voiceKey: CIPHER },
  ];
  const block = sandbox.runVoiceBlock(m, { companionVoices: null, language: "chinese", mode: "auto" });
  assert.strictEqual(block.split("【语音表达协议 v1】").length - 1, 1, block);
});

check("the block is only injected in auto mode", () => {
  const m = [{ candidateId: "a", name: "甲", voiceKey: CIPHER }];
  for (const mode of ["default", "fixed", undefined, null]) {
    assert.strictEqual(
      sandbox.runVoiceBlock(m, { companionVoices: null, language: "chinese", mode }),
      "", "mode " + mode);
  }
  assert.strictEqual(sandbox.runVoiceBlock(m, undefined), "", "no voice options at all");
});

check("the classroom block keeps the narration rule the groupchat drops", () => {
  const classroom = protocol.buildPromptBlock({ displayName: "芙宁娜", allowedEmotionIds: ["default", "happy"] });
  assert(classroom.includes("单星号"), "the default block must stay verbatim");
  const groupchat = protocol.buildPromptBlock({
    displayName: "芙宁娜", allowedEmotionIds: ["default", "happy"], actionNarrationRule: false });
  assert(!groupchat.includes("单星号"), groupchat);
  assert(groupchat.includes("【语音表达协议 v1】"));
  assert.strictEqual(classroom.split("\n").length - groupchat.split("\n").length, 1,
    "exactly the narration line is dropped");
});

// --- report ------------------------------------------------------------------------------

(async () => {
  await chain;
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({
    result: failed.length ? "FAIL" : "PASS",
    total: results.length, failed: failed.length, failures: failed,
  }, null, 2));
  if (failed.length) process.exitCode = 1;
})();
