"use strict";

// Shared voice catalog and synthesis-request resolution.
//
// Single source of truth for the emotion-capable voices is
// resources/server/public/voice-catalog.json (also served to the browser at
// /voice-catalog.json).  The original style voices keep living in the inline tables of
// chunk 4137 and the groupchat route; this module never rewrites them.
//
// The browser cannot require() this file, so chunk 4137 carries a mirror of
// resolveVoiceRequest().  resources/server/lib/voice-catalog-parity-smoke-test.js runs the
// same case table through both implementations so they cannot drift apart silently.

const MODES = new Set(["default", "fixed", "auto"]);

// Emotion ids that may never be used: 厌恶 was dropped for this release and 'angry' must not be
// accepted as a synonym for the deliberately softer playful_angry.
const FORBIDDEN_TAGS = new Set([
  "disgust", "disgusted", "厌恶",
  "angry", "anger", "生气",
  "other", "其他",
  "愤怒", "暴怒",
]);

const EMOTION_LABELS = {
  default: "默认",
  neutral: "中立",
  happy: "开心",
  surprised: "吃惊",
  sad: "难过",
  fearful: "恐惧",
  playful_angry: "佯怒",
};

const DEFAULT_BLOCK = {
  voiceId: null,
  displayName: null,
  version: null,
  gptModelName: null,
  sovitsModelName: null,
  refAudioPath: null,
  promptText: null,
  promptLanguage: "中文",
  resolvedReferenceId: null,
  resolvedEmotion: null,
  weightRevision: null,
  referenceRevision: null,
  reason: null,
};

class VoiceError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "VoiceError";
    this.code = code;
    this.details = details || null;
  }
}

function validateCatalog(catalog) {
  const problems = [];
  if (!catalog || typeof catalog !== "object") return ["catalog is not an object"];
  const voices = catalog.voices;
  if (!voices || typeof voices !== "object") return ["catalog.voices is missing"];
  for (const [voiceId, voice] of Object.entries(voices)) {
    const at = "voices." + voiceId;
    if (voice.voiceId !== voiceId) problems.push(at + ": voiceId does not match its key");
    if (!voice.displayName) problems.push(at + ": displayName is missing");
    if (!voice.gptModelName || !voice.sovitsModelName) problems.push(at + ": model names are missing");
    if (voice.version !== "v4" && voice.version !== "v2ProPlus") {
      problems.push(at + ": unexpected version " + String(voice.version));
    }
    const refs = voice.references;
    if (!refs || typeof refs !== "object" || !Object.keys(refs).length) {
      problems.push(at + ": references are missing");
      continue;
    }
    for (const [refId, ref] of Object.entries(refs)) {
      const ra = at + ".references." + refId;
      if (FORBIDDEN_TAGS.has(refId)) problems.push(ra + ": forbidden emotion id is exposed");
      if (!ref.audioPath) problems.push(ra + ": audioPath is missing");
      if (!ref.promptText) problems.push(ra + ": promptText is missing");
      if (ref.enabled === undefined) problems.push(ra + ": enabled flag is missing");
      if (ref.enabled && !EMOTION_LABELS[refId]) problems.push(ra + ": unknown emotion id");
    }
    if (!refs[voice.defaultReferenceId]) {
      problems.push(at + ": defaultReferenceId " + String(voice.defaultReferenceId) + " has no reference");
    } else if (refs[voice.defaultReferenceId].enabled === false) {
      problems.push(at + ": default reference is disabled");
    }
  }
  return problems;
}

// The one resolution order (spec §3.1).  Pure: no I/O, no service probes.
function resolveReference(voice, options) {
  const mode = MODES.has(options && options.mode) ? options.mode : "default";
  const requested = options && options.emotion ? String(options.emotion) : null;
  const refs = voice.references || {};
  const usable = (id) => Boolean(id && refs[id] && refs[id].enabled !== false);

  if (mode === "default") return { referenceId: voice.defaultReferenceId, reason: "mode_default" };

  if (mode === "fixed") {
    if (requested && usable(requested)) return { referenceId: requested, reason: "fixed" };
    return { referenceId: voice.defaultReferenceId, reason: requested ? "fixed_unavailable_fallback" : "fixed_unset_fallback" };
  }

  // auto
  if (!requested) return { referenceId: voice.defaultReferenceId, reason: "auto_unlabelled" };
  const normalized = requested.trim().toLowerCase();
  if (normalized === "default") return { referenceId: voice.defaultReferenceId, reason: "auto_default_tag" };
  if (FORBIDDEN_TAGS.has(normalized)) return { referenceId: voice.defaultReferenceId, reason: "auto_forbidden_tag" };
  if (!usable(normalized)) return { referenceId: voice.defaultReferenceId, reason: "auto_unknown_tag" };
  return { referenceId: normalized, reason: "auto" };
}

function allowedEmotionIds(voice) {
  const ids = ["default"];
  for (const [refId, ref] of Object.entries(voice.references || {})) {
    if (ref.enabled === false) continue;
    // The literal "default" tag is already first; a concrete id that happens to be the
    // default reference (e.g. 阮·梅 -> neutral) stays selectable under its own name too.
    if (refId === "default") continue;
    ids.push(refId);
  }
  return ids;
}

// Full request resolution for both the non-streaming and the streaming call.
function resolveVoiceRequest(catalog, options) {
  const opts = options || {};
  const voiceId = opts.voiceId ? String(opts.voiceId) : "";
  const voice = catalog && catalog.voices ? catalog.voices[voiceId] : null;

  if (!voice) {
    return { ok: false, error: new VoiceError("unknown voice: " + voiceId, "voice_unknown", { voiceId }), ...DEFAULT_BLOCK, voiceId };
  }
  const { referenceId, reason } = resolveReference(voice, opts);
  const ref = voice.references[referenceId];
  if (!ref || ref.enabled === false) {
    // Never silently borrow another voice's audio.
    return {
      ok: false,
      error: new VoiceError("default reference unavailable for " + voiceId, "voice_unavailable", { voiceId, referenceId }),
      ...DEFAULT_BLOCK, voiceId, displayName: voice.displayName, version: voice.version,
    };
  }
  return {
    ok: true,
    error: null,
    voiceId,
    displayName: voice.displayName,
    version: voice.version,
    gptModelName: voice.gptModelName,
    sovitsModelName: voice.sovitsModelName,
    refAudioPath: ref.audioPath,
    promptText: ref.promptText,
    promptLanguage: ref.promptLanguage || "中文",
    resolvedReferenceId: referenceId,
    resolvedEmotion: referenceId,
    weightRevision: voice.weightRevision || null,
    referenceRevision: ref.audioRevision || null,
    reason,
  };
}

// Adapter for the two consumers that still keep a legacy style-voice table of the shape
// {g,s,r,p} (browser chunk 4137 and the groupchat route).  Returns null when the key is not a
// catalog voice, so those tables keep working untouched; otherwise `entry` is the request
// fields and `resolved` is the cache identity (spec §6: the two call sites must not each
// implement their own fallback rules).
function resolveClassicEntry(catalog, voiceId, options) {
  const voice = catalog && catalog.voices ? catalog.voices[String(voiceId)] : null;
  if (!voice) return null;
  const resolved = resolveVoiceRequest(catalog, { ...(options || {}), voiceId: String(voiceId) });
  if (!resolved.ok) return { ok: false, voiceId: String(voiceId), resolved, error: resolved.error, entry: null, emotion: null };
  return {
    ok: true,
    voiceId: resolved.voiceId,
    resolved,
    emotion: resolved.resolvedEmotion,
    entry: {
      version: resolved.version,
      g: resolved.gptModelName,
      s: resolved.sovitsModelName,
      r: resolved.refAudioPath,
      p: resolved.promptText,
      promptLanguage: resolved.promptLanguage,
    },
  };
}

// Cache identity must cover everything that changes the audio (spec §6).
function cacheKeyParts(resolved, extra) {
  const e = extra || {};
  return [
    "v2",
    resolved.voiceId,
    resolved.version,
    resolved.weightRevision || "",
    resolved.resolvedReferenceId,
    resolved.referenceRevision || "",
    resolved.promptText,
    resolved.promptLanguage,
    e.textLanguage || "中英混合",
    String(e.speed == null ? 1 : e.speed),
    e.text || "",
  ].join("\u0001");
}

function buildSynthesisBody(resolved, text, speed) {
  return {
    version: resolved.version,
    gpt_model_name: resolved.gptModelName,
    sovits_model_name: resolved.sovitsModelName,
    ref_audio_path: resolved.refAudioPath,
    prompt_text: resolved.promptText,
    prompt_text_lang: resolved.promptLanguage,
    text,
    text_lang: "中英混合",
    speed_facter: speed || 1,
    media_type: "wav",
  };
}

// Voice picker entries for the 23 new voices, in the shape BUNDLED_SNAPSHOT uses.
function listVoices(catalog, scores) {
  const out = [];
  for (const voice of Object.values(catalog.voices || {})) {
    out.push({
      key: voice.voiceId,
      label: voice.displayName,
      group: voice.group,
      gender: voice.gender,
      language: voice.language || "zh",
      production: true,
      intendedStyle: voice.displayName + " · 情绪参考音频",
      sampleUrl: null,
      // Sorted below every curated style voice so an added character can never become the
      // automatic default for its gender/language bucket.
      scoreAtCuration: (scores && scores[voice.voiceId]) == null ? 40 : scores[voice.voiceId],
      version: voice.version,
      defaultReferenceId: voice.defaultReferenceId,
      defaultEmotion: voice.defaultEmotion,
      emotionIds: allowedEmotionIds(voice),
      hasMultipleReferences: Object.keys(voice.references).length > 1,
    });
  }
  return out;
}

const CATALOG_FILE = require("path").join(__dirname, "..", "public", "voice-catalog.json");

let cached = null;

// Reads (and structurally validates) the catalog once per process.  Path/hash changes require a
// restart, which matches how the rest of the server config behaves.
function load(filePath) {
  if (cached) return cached;
  const target = filePath || CATALOG_FILE;
  const fsImpl = require("fs");
  const catalog = JSON.parse(fsImpl.readFileSync(target, "utf8"));
  const problems = validateCatalog(catalog);
  if (problems.length) {
    throw new Error("voice catalog invalid: " + problems.slice(0, 5).join("; "));
  }
  cached = catalog;
  return catalog;
}

module.exports = {
  MODES,
  FORBIDDEN_TAGS,
  EMOTION_LABELS,
  VoiceError,
  validateCatalog,
  resolveReference,
  resolveVoiceRequest,
  resolveClassicEntry,
  allowedEmotionIds,
  cacheKeyParts,
  buildSynthesisBody,
  listVoices,
  load,
  CATALOG_FILE,
};
