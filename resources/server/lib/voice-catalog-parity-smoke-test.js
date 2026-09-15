"use strict";

// The browser cannot require() lib/voice-catalog.js, so chunk 4137 carries a mirror of the
// resolution rules and of the picker projection.  This test loads the real compiled module and
// runs one case table through it and through the server lib, so the page, the groupchat route
// and the server cannot drift apart silently.
//
// Runs standalone: node resources/server/lib/voice-catalog-parity-smoke-test.js

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const lib = require("./voice-catalog.js");

const ROOT = path.join(__dirname, "..", "..", "..");
const CHUNK = path.join(ROOT, "resources/server/.next/static/chunks/4137-131d0676e3b5bef7.js");
const GROUPCHAT = path.join(ROOT, "resources/server/.next/server/app/api/groupchat/route.js");

const catalog = lib.load();
const VOICES = Object.keys(catalog.voices);
const results = [];

// Checks run one at a time: loading the browser module swaps globalThis.fetch / localStorage /
// self, so two concurrent loads would capture each other's requests.
let chain = Promise.resolve();
function check(name, fn) {
  chain = chain
    .then(fn)
    .then(() => results.push({ name, ok: true }))
    .catch((error) => results.push({ name, ok: false, error: String((error && error.message) || error) }));
  return chain;
}

// --- the compiled browser module --------------------------------------------------------
function makeStorage(values) {
  const store = Object.assign({}, values || {});
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
  };
}

// Loads the real webpack module 4137 from the shipped bundle, with the TTS origin pointed at
// `baseUrl` and every outgoing request captured.
async function withVoiceModule(options, fn) {
  const { storage, baseUrl } = options || {};
  const prior = {
    self: globalThis.self,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
  };
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.self = { webpackChunk_N_E: [] };
  globalThis.localStorage = makeStorage(storage);
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.startsWith("/voice-catalog.json")) {
      requests.push({ url: target });
      return { ok: true, status: 200, json: async () => catalog };
    }
    requests.push({ url: target, body: init && init.body ? JSON.parse(init.body) : null });
    if (target.includes("/infer_classic_stream")) return realFetch(url, init);
    if (target.includes("/infer_classic")) {
      return { ok: true, status: 200, json: async () => ({ audio_url: "http://0.0.0.0:8000/audio/x.wav" }) };
    }
    if (target.includes("/audio/")) return { ok: true, status: 200, blob: async () => ({ size: 0 }) };
    return realFetch(url, init);
  };
  try {
    eval(fs.readFileSync(CHUNK, "utf8"));
    const pushed = globalThis.self.webpackChunk_N_E.at(-1);
    const factory = pushed && pushed[1] && pushed[1][4137];
    assert(factory, "webpack module 4137 missing from the bundle");
    const exports = {};
    const webpackRequire = (id) => {
      if (id === 1660) return { tE: baseUrl || "http://127.0.0.1:8000", mj: () => "local-session" };
      if (id === 508) return { A: { emit: () => {} } };
      throw new Error("unexpected module dependency: " + id);
    };
    webpackRequire.r = (target) => Object.defineProperty(target, "__esModule", { value: true });
    webpackRequire.d = (target, definitions) => {
      for (const name of Object.keys(definitions)) {
        Object.defineProperty(target, name, { enumerable: true, get: definitions[name] });
      }
    };
    factory({}, exports, webpackRequire);
    if (!options || options.loadCatalog !== false) await exports.refreshCatalogIfStale();
    return await fn(exports, requests);
  } finally {
    for (const key of Object.keys(prior)) {
      if (prior[key] === undefined) delete globalThis[key];
      else globalThis[key] = prior[key];
    }
  }
}

// --- 1. the picker merges the catalog into the bundled snapshot -----------------------
check("the catalog fetch adds the 23 voices without dropping the bundled style voices", async () => {
  await withVoiceModule({ loadCatalog: false }, async (voice, requests) => {
    const before = Array.from(voice.VOICE_LIBRARY);
    assert.strictEqual(before.length, voice.BUNDLED_SNAPSHOT.length, "the bundled snapshot is the initial picker list");
    assert(before.every((entry) => !VOICES.includes(entry.key)), "no catalog voice may be bundled statically");

    await voice.refreshCatalogIfStale();
    const requested = requests.filter((r) => r.url.startsWith("/voice-catalog.json"));
    assert.strictEqual(requested.length, 1, "the catalog is fetched from the app itself, exactly once");
    assert(!requests.some((r) => r.url.includes("/api/")), "the picker must not call a protected route");

    const after = Array.from(voice.VOICE_LIBRARY);
    assert.strictEqual(after.length, before.length + 23, "the fetch must add exactly the 23 catalog voices");
    assert.deepStrictEqual(after.slice(0, before.length), before, "the bundled style voices must survive the merge");
    assert.deepStrictEqual(after.slice(before.length), lib.listVoices(catalog),
      "the picker projection must match listVoices()");
  });
});

check("the picker never advertises a blocked or unauditioned emotion", async () => {
  await withVoiceModule({}, async (voice) => {
    for (const key of VOICES) {
      const entry = voice.getVoice(key);
      assert(entry, key + " must be selectable");
      assert.strictEqual(entry.production, true, key + " must be usable");
      assert.strictEqual(entry.scoreAtCuration, 40, key + " must sort below every curated voice");
      assert(!entry.emotionIds.includes("playful_angry"), key + " advertises 佯怒 before audition");
      assert(!entry.emotionIds.includes("disgust"), key + " advertises 厌恶");
      assert(entry.emotionIds.includes("default"), key + " must offer the default tag");
    }
    assert.strictEqual(voice.getVoice("cipher").defaultEmotion, "happy", "赛飞儿 defaults to 开心");
    assert(voice.getVoice("soft_girl"), "a legacy style voice stays selectable");
  });
});

// --- 2. the same emotion resolves to the same reference on both sides ------------------
const EMOTIONS = [
  undefined, null, "", "default", "neutral", "happy", "sad", "surprised", "fearful",
  "playful_angry", "angry", "生气", "disgust", "厌恶", "nonsense", "  HAPPY  ",
];

check("the browser posts exactly the reference the server lib resolves, for every voice", async () => {
  const modes = [
    { name: "default", storage: {} },
    { name: "auto", storage: { socratopia_voice_emotion_mode: "auto" } },
    { name: "fixed->sad", storage: { socratopia_voice_emotion_mode: "fixed", socratopia_voice_emotion_fixed: "sad" } },
    { name: "fixed->neutral", storage: { socratopia_voice_emotion_mode: "fixed", socratopia_voice_emotion_fixed: "neutral" } },
    { name: "fixed->unset", storage: { socratopia_voice_emotion_mode: "fixed" } },
  ];
  let compared = 0;
  for (const mode of modes) {
    await withVoiceModule({ storage: mode.storage }, async (voice, requests) => {
      for (const voiceId of VOICES) {
        for (const emotion of EMOTIONS) {
          const before = requests.length;
          await voice.synthesize("同一句话。", voiceId, 1, undefined, emotion);
          const posts = requests.slice(before).filter((r) => r.url.includes("/infer_classic"));
          assert.strictEqual(posts.length, 1, voiceId + " must post exactly one synthesis request");
          const sent = posts[0].body;
          // In fixed mode the pick wins and the per-message tag is ignored, so the expectation
          // is built from the setting rather than from the tag.
          const modeName = mode.name.split("->")[0];
          const effective = modeName === "fixed" ? mode.storage.socratopia_voice_emotion_fixed : emotion;
          const expected = lib.resolveClassicEntry(catalog, voiceId, { mode: modeName, emotion: effective }).entry;
          assert.strictEqual(sent.version, expected.version, voiceId + " " + mode.name + " " + emotion + " version");
          assert.strictEqual(sent.gpt_model_name, expected.g, voiceId + " " + mode.name + " gpt model");
          assert.strictEqual(sent.sovits_model_name, expected.s, voiceId + " " + mode.name + " sovits model");
          assert.strictEqual(sent.ref_audio_path, expected.r,
            voiceId + " " + mode.name + " " + emotion + " reference audio");
          assert.strictEqual(sent.prompt_text, expected.p, voiceId + " " + mode.name + " prompt text");
          assert.strictEqual(sent.prompt_text_lang, expected.promptLanguage, voiceId + " prompt language");
          assert.strictEqual(sent.text, "同一句话。", voiceId + " must send the clean text unchanged");
          assert.strictEqual(sent.text_lang, "中英混合");
          compared++;
        }
      }
    });
  }
  assert.strictEqual(compared, modes.length * VOICES.length * EMOTIONS.length);
});

check("13 voices speak v4 and 10 speak v2ProPlus, on the wire", async () => {
  await withVoiceModule({}, async (voice, requests) => {
    const versions = {};
    for (const voiceId of VOICES) {
      const before = requests.length;
      await voice.synthesize("你好。", voiceId, 1);
      const sent = requests.slice(before).find((r) => r.url.includes("/infer_classic"));
      assert(sent, voiceId + " must post a synthesis request (captured " + (requests.length - before) + " calls)");
      versions[voiceId] = sent.body.version;
    }
    assert.strictEqual(Object.values(versions).filter((v) => v === "v4").length, 13);
    assert.strictEqual(Object.values(versions).filter((v) => v === "v2ProPlus").length, 10);
    assert(!Object.values(versions).some((v) => v === undefined), "no voice may fall back to the legacy version");
  });
});

check("a legacy style voice keeps its bundled table entry and version", async () => {
  await withVoiceModule({}, async (voice, requests) => {
    const before = requests.length;
    await voice.synthesize("你好。", "soft_girl", 1, undefined, "sad");
    const body = requests.slice(before).find((r) => r.url.includes("/infer_classic")).body;
    assert.strictEqual(body.version, "v4");
    assert.strictEqual(body.gpt_model_name, "【经典】Funina-e15");
    assert(body.ref_audio_path.includes("芙宁娜"), body.ref_audio_path);
    // An unknown key still falls back to the historical default instead of failing.
    const before2 = requests.length;
    await voice.synthesize("你好。", "not_a_voice", 1);
    assert.strictEqual(requests.slice(before2).find((r) => r.url.includes("/infer_classic")).body.gpt_model_name, "【经典】Funina-e15");
  });
});

// --- 3. the streaming call carries the same resolved version and reference ------------
check("the streaming call posts the same version and reference as the non-streaming one", async () => {
  const audio = Buffer.from("RIFF____WAVE____").toString("base64");
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (c) => chunks.push(c));
    request.on("end", () => {
      server.lastBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "Content-Type": "application/x-ndjson", "X-TTS-Protocol": "classic-stream-ndjson-v1" });
      response.write(JSON.stringify({ type: "start", protocol: "classic-stream-ndjson-v1" }) + "\n");
      response.write(JSON.stringify({ type: "audio", seq: 0, mime: "audio/wav", data: audio }) + "\n");
      response.write(JSON.stringify({ type: "end", chunks: 1 }) + "\n");
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = "http://127.0.0.1:" + server.address().port;
    await withVoiceModule({ baseUrl, storage: { socratopia_voice_emotion_mode: "auto" } }, async (voice) => {
      for (const [voiceId, emotion] of [["cipher", "sad"], ["yae_miko", undefined], ["ruan_mei", "happy"]]) {
        const stream = await voice.synthesizeStream("同一句话。", voiceId, 1, AbortSignal.timeout(5000), emotion);
        const frames = [];
        for await (const frame of stream) frames.push(frame);
        assert.strictEqual(frames.length, 1, voiceId + " must deliver the audio frame");
        const expected = lib.resolveClassicEntry(catalog, voiceId, { mode: "auto", emotion }).entry;
        const sent = server.lastBody;
        assert.strictEqual(sent.version, expected.version, voiceId + " stream version");
        assert.strictEqual(sent.gpt_model_name, expected.g, voiceId + " stream gpt model");
        assert.strictEqual(sent.ref_audio_path, expected.r, voiceId + " stream reference");
        assert.strictEqual(sent.prompt_text, expected.p, voiceId + " stream prompt text");
        assert.strictEqual(sent.text, "同一句话。");
        assert.strictEqual(sent.media_type, "wav");
        assert.strictEqual(frames[0].voiceKey, voiceId);
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// --- 4. the groupchat route resolves through the same shared resolver ------------------
// Brace matching that skips string literals, template interpolations and comments, so a `{`
// inside a reference prompt or a URL cannot throw the match off.
function sliceBalanced(source, start) {
  const open = source.indexOf("{", start);
  assert(open >= 0, "no function body after offset " + start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      for (i++; i < source.length; i++) {
        if (source[i] === "\\") { i++; continue; }
        if (source[i] === quote) break;
        if (quote === "`" && source[i] === "$" && source[i + 1] === "{") i = sliceBalanced(source, i + 1) - 1;
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

function runGroupchatTts(voiceKey, text) {
  const source = fs.readFileSync(GROUPCHAT, "utf8");
  const tableStart = source.indexOf("var _ttsV={");
  // The module-scope voice helpers sit between the table and _ttsK, so the table is delimited
  // by the TTS queue state that has always closed that declaration (and that _ttsS still uses).
  const tableEndMark = ",_ttsQL=[],_ttsRN=0;";
  const tableEndAt = source.indexOf(tableEndMark, tableStart);
  assert(tableStart >= 0 && tableEndAt > tableStart, "the legacy style-voice table must stay in the route");
  const tableEnd = tableEndAt + tableEndMark.length;
  const body = [
    source.slice(tableStart, tableEnd) + ";",
    sliceFunction(source, "function _ttsK("),
    sliceFunction(source, "async function _ttsS("),
  ].join("");
  const posts = [];
  const fetchStub = async (url, init) => {
    if (!String(url).includes("infer_classic")) return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    posts.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ audio_url: "http://0.0.0.0:8000/a.wav" }) };
  };
  const sandbox = {};
  new Function("fetch", "global", "process", "Buffer", "require", "exports", body + ";exports.synth=_ttsS;exports.key=_ttsK;")(
    fetchStub,
    {
      __FS__: { existsSync: () => false, mkdirSync: () => {}, writeFileSync: () => {} },
      __PATH__: path,
      __VOICE_CATALOG__: lib,
    },
    { env: { PROJECT_ROOT: path.join(ROOT, "tmp") } },
    Buffer,
    () => { throw new Error("fs/path must come from the injected globals"); },
    sandbox);
  return sandbox.synth(text, voiceKey, "n", undefined).then(() => ({ posts, key: sandbox.key }));
}

check("the groupchat route posts the resolved version, reference and prompt text", async () => {
  const v2 = await runGroupchatTts("cipher", "先看这道题。");
  assert.strictEqual(v2.posts[0].version, "v2ProPlus");
  assert(v2.posts[0].ref_audio_path.includes("【开心】"), v2.posts[0].ref_audio_path);
  assert.strictEqual(v2.posts[0].prompt_text, catalog.voices.cipher.references.happy.promptText);

  const v4 = await runGroupchatTts("yae_miko", "先看这道题。");
  assert.strictEqual(v4.posts[0].version, "v4");
  assert.strictEqual(v4.posts[0].gpt_model_name, catalog.voices.yae_miko.gptModelName);
  assert.strictEqual(v4.posts[0].ref_audio_path, catalog.voices.yae_miko.references.default.audioPath);

  // A legacy style voice keeps its table entry and its flat cache key, byte for byte.
  const legacy = await runGroupchatTts("soft_girl", "先看这道题。");
  assert.strictEqual(legacy.posts[0].version, "v4");
  assert.strictEqual(legacy.posts[0].gpt_model_name, "【经典】Funina-e15");
  assert.strictEqual(legacy.key("soft_girl", "先看这道题。"), legacy.key("soft_girl|先看这道题。"));
});

check("the cache key separates voices and emotions, and legacy keys are unchanged", () => {
  const keyOf = (voiceId, emotion) => lib.cacheKeyParts(
    lib.resolveClassicEntry(catalog, voiceId, { mode: "auto", emotion }).resolved, { text: "同一句话。", speed: 1 });
  assert.notStrictEqual(keyOf("cipher", "happy"), keyOf("cipher", "sad"), "emotions must not share an entry");
  assert.strictEqual(keyOf("cipher", "happy"), keyOf("cipher", "happy"));
  assert.notStrictEqual(keyOf("cipher", "happy"), keyOf("huohuo", "happy"), "two voices must not share an entry");
  assert.notStrictEqual(
    lib.cacheKeyParts(lib.resolveClassicEntry(catalog, "cipher", {}).resolved, { text: "第一句。" }),
    lib.cacheKeyParts(lib.resolveClassicEntry(catalog, "cipher", {}).resolved, { text: "第二句。" }));
  // 赛飞儿 default and an explicit happy tag resolve to the same clip, so they may share an entry.
  assert.strictEqual(
    lib.cacheKeyParts(lib.resolveClassicEntry(catalog, "cipher", {}).resolved, { text: "同一句话。" }),
    lib.cacheKeyParts(lib.resolveClassicEntry(catalog, "cipher", { mode: "auto", emotion: "happy" }).resolved, { text: "同一句话。" }));
});

// --- report ---------------------------------------------------------------------------
(async () => {
  await chain;
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({
    result: failed.length ? "FAIL" : "PASS",
    total: results.length, failed: failed.length, failures: failed,
  }, null, 2));
  if (failed.length) process.exitCode = 1;
})();
