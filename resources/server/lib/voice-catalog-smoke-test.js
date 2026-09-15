"use strict";

// Behaviour of the shared voice catalog / request resolver (spec §3.1, §10.1).
// Runs standalone: node resources/server/lib/voice-catalog-smoke-test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const lib = require("./voice-catalog.js");

const CATALOG_PATH = path.join(__dirname, "..", "public", "voice-catalog.json");
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: String(error && error.message || error) });
  }
};

// --- 1. roster ----------------------------------------------------------------------
check("catalog is structurally valid", () => {
  assert.deepStrictEqual(lib.validateCatalog(catalog), []);
});

check("exactly 23 emotion-capable voices, 刻律德菈 absent", () => {
  const ids = Object.keys(catalog.voices);
  assert.strictEqual(ids.length, 23);
  assert(!ids.includes("刻律德菈"));
  assert(!JSON.stringify(catalog).includes("刻律德菈"));
});

check("13 v4 and 10 v2ProPlus voices", () => {
  const versions = Object.values(catalog.voices).map((v) => v.version);
  assert.strictEqual(versions.filter((v) => v === "v4").length, 13);
  assert.strictEqual(versions.filter((v) => v === "v2ProPlus").length, 10);
});

check("62 candidate references after dropping 厌恶/其他", () => {
  const all = Object.values(catalog.voices).flatMap((v) => Object.keys(v.references));
  assert.strictEqual(all.length, 62);
  for (const banned of ["disgust", "disgusted", "other"]) assert(!all.includes(banned));
});

// --- 2. default / fallback resolution -------------------------------------------------
check("cipher resolves default/unlabelled/invalid/forbidden all to happy", () => {
  const cipher = catalog.voices.cipher;
  assert.strictEqual(cipher.defaultReferenceId, "happy");
  const cases = [
    [{ mode: "default" }, "mode_default"],
    [{ mode: "auto" }, "auto_unlabelled"],
    [{ mode: "auto", emotion: "default" }, "auto_default_tag"],
    [{ mode: "auto", emotion: "neutral" }, "auto_unknown_tag"],   // cipher has no neutral clip
    [{ mode: "auto", emotion: "angry" }, "auto_forbidden_tag"],
    [{ mode: "auto", emotion: "生气" }, "auto_forbidden_tag"],
    [{ mode: "auto", emotion: "disgust" }, "auto_forbidden_tag"],
    [{ mode: "auto", emotion: "nonsense" }, "auto_unknown_tag"],
  ];
  for (const [opts, reason] of cases) {
    const r = lib.resolveReference(cipher, opts);
    assert.strictEqual(r.referenceId, "happy", JSON.stringify(opts) + " -> " + r.referenceId);
    assert.strictEqual(r.reason, reason, JSON.stringify(opts));
  }
});

check("v2ProPlus voices default to neutral, v4 voices to their only clip", () => {
  assert.strictEqual(catalog.voices.ruan_mei.defaultReferenceId, "neutral");
  assert.strictEqual(catalog.voices.yae_miko.defaultReferenceId, "default");
  assert.strictEqual(Object.keys(catalog.voices.yae_miko.references).length, 1);
});

check("auto mode honours a legal, enabled tag", () => {
  const r = lib.resolveReference(catalog.voices.ruan_mei, { mode: "auto", emotion: "happy" });
  assert.strictEqual(r.referenceId, "happy");
  assert.strictEqual(r.reason, "auto");
});

check("fixed mode falls back to the default when the pick is unavailable", () => {
  const cipher = catalog.voices.cipher;
  assert.deepStrictEqual(
    lib.resolveReference(cipher, { mode: "fixed", emotion: "sad" }),
    { referenceId: "sad", reason: "fixed" });
  assert.deepStrictEqual(
    lib.resolveReference(cipher, { mode: "fixed", emotion: "neutral" }),
    { referenceId: "happy", reason: "fixed_unavailable_fallback" });
});

// --- 3. forbidden emotions ------------------------------------------------------------
check("厌恶/angry can never be selected, triggered or used as a fallback", () => {
  for (const voice of Object.values(catalog.voices)) {
    for (const tag of ["disgust", "disgusted", "厌恶", "angry", "anger", "生气", "愤怒", "other", "其他"]) {
      const r = lib.resolveReference(voice, { mode: "fixed", emotion: tag });
      assert.strictEqual(r.referenceId, voice.defaultReferenceId, voice.voiceId + " fixed " + tag);
      const a = lib.resolveReference(voice, { mode: "auto", emotion: tag });
      assert.strictEqual(a.referenceId, voice.defaultReferenceId, voice.voiceId + " auto " + tag);
    }
  }
});

check("no voice exposes a forbidden reference id", () => {
  for (const voice of Object.values(catalog.voices)) {
    for (const id of Object.keys(voice.references)) {
      assert(!lib.FORBIDDEN_TAGS.has(id), voice.voiceId + " exposes " + id);
    }
  }
});

// --- 4. playful_angry gating ----------------------------------------------------------
check("the 5 生气 clips are the only playful_angry candidates and none is enabled", () => {
  const holders = Object.entries(catalog.voices)
    .filter(([, v]) => v.references.playful_angry)
    .map(([id]) => id)
    .sort();
  assert.deepStrictEqual(holders, ["cipher", "fu_xuan", "huohuo", "hyacine", "robin"]);
  for (const id of holders) {
    const ref = catalog.voices[id].references.playful_angry;
    assert.strictEqual(ref.enabled, false, id + " must stay disabled until auditioned");
    assert.strictEqual(ref.sourceEmotion, "生气");
    assert.strictEqual(ref.label, "佯怒");
    assert(!lib.allowedEmotionIds(catalog.voices[id]).includes("playful_angry"), id + " leaked into the allowed list");
  }
});

check("no voice borrows another voice's audio", () => {
  const seen = new Map();
  for (const [id, voice] of Object.entries(catalog.voices)) {
    for (const [refId, ref] of Object.entries(voice.references)) {
      assert(!seen.has(ref.audioPath), `${id}.${refId} reuses ${seen.get(ref.audioPath)}`);
      seen.set(ref.audioPath, id + "." + refId);
    }
  }
});

// --- 5. allowed tag lists -------------------------------------------------------------
check("prompt allows only resource-backed, enabled tags", () => {
  assert.deepStrictEqual(lib.allowedEmotionIds(catalog.voices.ruan_mei),
    ["default", "neutral", "surprised", "happy", "sad"]);
  assert.deepStrictEqual(lib.allowedEmotionIds(catalog.voices.cipher),
    ["default", "surprised", "happy", "sad"]);
  assert.deepStrictEqual(lib.allowedEmotionIds(catalog.voices.yae_miko), ["default"]);
});

// --- 6. request bodies ----------------------------------------------------------------
check("v4 and v2ProPlus requests carry the resolved version and reference", () => {
  const v4 = lib.resolveVoiceRequest(catalog, { voiceId: "yae_miko", mode: "default" });
  assert.strictEqual(v4.ok, true);
  const body4 = lib.buildSynthesisBody(v4, "你好。", 1);
  assert.strictEqual(body4.version, "v4");
  assert.strictEqual(body4.gpt_model_name, "【经典】八重神子_ZH-e10");
  assert.strictEqual(body4.sovits_model_name, "【经典】八重神子_ZH_e10_s1170_l32");
  assert.strictEqual(body4.prompt_text, "嗨，小家伙们，你们来了呀。不错，很准时。");

  const v2 = lib.resolveVoiceRequest(catalog, { voiceId: "cipher", mode: "auto", emotion: "sad" });
  const body2 = lib.buildSynthesisBody(v2, "你好。", 1);
  assert.strictEqual(body2.version, "v2ProPlus");
  assert.strictEqual(body2.gpt_model_name, "【经典】赛飞儿-e10");
  assert.strictEqual(body2.sovits_model_name, "【经典】赛飞儿_e10_s250");
  assert(body2.ref_audio_path.includes("【难过】"), body2.ref_audio_path);
  assert.strictEqual(body2.text, "你好。");
  assert.strictEqual(body2.text_lang, "中英混合");
  assert.strictEqual(body2.media_type, "wav");
});

check("unknown voice is a hard failure, never a silent substitution", () => {
  const r = lib.resolveVoiceRequest(catalog, { voiceId: "does_not_exist", mode: "auto" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, "voice_unknown");
  assert.strictEqual(r.refAudioPath, null);
});

check("a disabled default reference yields voice_unavailable", () => {
  const broken = JSON.parse(JSON.stringify(catalog));
  broken.voices.cipher.references.happy.enabled = false;
  const r = lib.resolveVoiceRequest(broken, { voiceId: "cipher", mode: "default" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, "voice_unavailable");
});

// --- 7. cache identity ----------------------------------------------------------------
check("cache key separates emotions, voices and versions", () => {
  const happy = lib.resolveVoiceRequest(catalog, { voiceId: "cipher", mode: "auto", emotion: "happy" });
  const sad = lib.resolveVoiceRequest(catalog, { voiceId: "cipher", mode: "auto", emotion: "sad" });
  const k = (r, text) => lib.cacheKeyParts(r, { text, speed: 1 });
  assert.notStrictEqual(k(happy, "同一句话。"), k(sad, "同一句话。"));
  assert.strictEqual(k(happy, "同一句话。"), k(happy, "同一句话。"));
  assert.notStrictEqual(k(happy, "第一句。"), k(happy, "第二句。"));
  const robin = lib.resolveVoiceRequest(catalog, { voiceId: "robin", mode: "default" });
  assert.notStrictEqual(k(happy, "x"), k(robin, "x"));
  // default and explicit happy resolve to the same clip, so they may share a cache entry
  const explicit = lib.resolveVoiceRequest(catalog, { voiceId: "cipher", mode: "auto", emotion: "default" });
  assert.strictEqual(k(happy, "同一句话。"), k(explicit, "同一句话。"));
});

// --- 8. UI projection -----------------------------------------------------------------
check("voice picker entries never advertise a blocked emotion", () => {
  const entries = lib.listVoices(catalog);
  assert.strictEqual(entries.length, 23);
  for (const entry of entries) {
    assert(!entry.emotionIds.includes("playful_angry"), entry.key + " advertises 佯怒 before audition");
    assert(!entry.emotionIds.includes("disgust"));
    assert(entry.emotionIds.includes("default"));
  }
  const cipher = entries.find((e) => e.key === "cipher");
  assert.strictEqual(cipher.label, "赛飞儿");
  assert.strictEqual(cipher.defaultEmotion, "happy");
  assert.strictEqual(cipher.hasMultipleReferences, true);
});

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({
  result: failed.length ? "FAIL" : "PASS",
  total: results.length,
  failed: failed.length,
  failures: failed,
}, null, 2));
if (failed.length) process.exitCode = 1;
