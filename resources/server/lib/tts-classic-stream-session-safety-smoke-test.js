"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ttsRoot = process.env.SOCRATOPIA_TTS_ROOT || "D:\\model_tts\\GPT-SoVITS-1007-cu124\\GPT-SoVITS-1007-cu124";
const gsvi = fs.readFileSync(path.join(ttsRoot, "gsvi.py"), "utf8");
const voiceBundle = fs.readFileSync(path.join(__dirname, "..", ".next", "static", "chunks", "4137-131d0676e3b5bef7.js"), "utf8");

assert(gsvi.includes("CLASSIC_STREAM_MAX_SESSIONS = 8"), "classic stream sessions must have a hard pending limit");
assert(gsvi.includes("STREAM_REQUEST_ID_PATTERN"), "stream request ids must be length/character validated");
assert(gsvi.includes('terminal_event = ("no_audio", None)'), "zero-frame generation must not be reported as successful end");
assert(gsvi.includes('if event_type == "no_audio":'), "network stream must emit a structured no_audio_frames error");
assert(gsvi.includes('"code": "no_audio_frames"'), "zero-frame error code must be stable");

const finishIndex = gsvi.indexOf("self._finish(terminal_event)");
const doneIndex = gsvi.indexOf("self.done_event.set()", finishIndex);
assert(finishIndex >= 0 && doneIndex > finishIndex, "terminal event must be queued before done_event is set");

const eventsStart = gsvi.indexOf("def _classic_stream_events(");
const sessionStart = gsvi.indexOf("session.start()", eventsStart);
const startYield = gsvi.indexOf('"type": "start"', eventsStart);
assert(sessionStart >= 0 && sessionStart < startYield, "session must start inside protected cleanup scope before the start event is yielded");

assert(voiceBundle.includes("SocratopiaTtsValidSpeech"), "frontend must reject pure-symbol speech fragments before TTS");
assert(voiceBundle.includes('"no_audio_frames"'), "frontend must recognize zero-audio as a silent, contained segment");
assert(voiceBundle.includes("/^\\*+/.test(n)"), "frontend must skip leading-asterisk narration/action lines before TTS");
assert(voiceBundle.includes("/\\*+$/.test(n)"), "frontend must skip trailing-asterisk narration/action lines before TTS");

console.log("tts classic stream session safety smoke: PASS");
