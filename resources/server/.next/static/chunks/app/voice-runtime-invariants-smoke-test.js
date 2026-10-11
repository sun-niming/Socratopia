"use strict";

// Cross-bundle invariants for the voice runtime.  This test is the permanent form of
// the pre-flight proof that all five page bundles carry byte-identical voice wiring:
// it hashes the three voice regions in every bundle, refuses to run if they drift,
// and then pins the failure-reporting / zero-audio / ownership behaviour that the
// player must expose.  No protected URL may ever reach an <audio> element.

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const bundleDir = __dirname;
const bundles = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
];
const chunkPath = path.join(bundleDir, "..", "4137-131d0676e3b5bef7.js");

const REGIONS = {
  "voice-eY": ["let eY=(0,n.useCallback)((e,t,r,__socratopiaEmotion,__socratopiaSpeechOffset)=>{", "}).catch(()=>{})},[en]);", true],
  "voice-effect": ["(0,n.useEffect)(()=>{if(!el.VOICE_ENABLED||!M){", "}},[l,s,M,eU,eW,e,eY,B,U]),", true],
  "replay-tp": ["function tp({trackId:e,conversationId:t,audioCachedAt:r,className:s}){", "function tx({onTopup:e,onCancel:t}){", false]
};

function regionOf(source, name) {
  const [start, end, inclusive] = REGIONS[name];
  const from = source.indexOf(start);
  assert(from >= 0, name + ": start landmark missing");
  const to = source.indexOf(end, from);
  assert(to >= 0, name + ": end landmark missing");
  return source.slice(from, inclusive ? to + end.length : to);
}

function sha(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

const sources = new Map();
const identity = {};

for (const name of bundles) {
  const file = path.join(bundleDir, name);
  assert(fs.existsSync(file), "missing page bundle: " + name);
  const source = fs.readFileSync(file, "utf8");
  sources.set(name, source);
  identity[name] = {};
  for (const regionName of Object.keys(REGIONS)) {
    const text = regionOf(source, regionName);
    identity[name][regionName] = { length: text.length, sha: sha(text) };
  }
}

// --- 1. every page bundle must carry byte-identical voice wiring ---------------------
const reference = bundles[0];
for (const regionName of Object.keys(REGIONS)) {
  const expected = identity[reference][regionName];
  for (const name of bundles) {
    const actual = identity[name][regionName];
    assert.strictEqual(
      actual.sha,
      expected.sha,
      name + ": " + regionName + " differs from " + reference + " (batch edit would desynchronise the bundles)"
    );
    assert.strictEqual(actual.length, expected.length, name + ": " + regionName + " length differs");
  }
}

// --- 2. page bundles must never hand a protected URL to the player -------------------
for (const name of bundles) {
  const source = sources.get(name);
  assert(!source.includes("/api/tts-audio"), name + ": the page bundle must never reference the protected audio route");
  assert(!source.includes("new Audio("), name + ": the page bundle must not construct audio elements directly");
  assert(source.includes("el.voicePlayer.play("), name + ": playback must go through the shared player");
}

// --- 3. page bundles must report synthesis and playback failures ---------------------
for (const name of bundles) {
  const region = regionOf(sources.get(name), "voice-eY");
  assert(
    region.includes('console.error("[voice-stream] synthesis failed:",n),el.voicePlayer.setError(a.trackId,n)'),
    name + ": a failed synthesis must be reported to the player, not only logged"
  );
  assert(
    region.includes('catch(n){el.voicePlayer.isCancelled(a.trackId)||(console.error("[voice-stream] playback failed:",n),el.voicePlayer.setError(a.trackId,n))}'),
    name + ": a failed playback must be reported to the player, not swallowed"
  );
  assert(
    !region.includes("el.voicePlayer.play(t.audio,a.trackId)}catch{}"),
    name + ": the bare play() catch must be replaced by a reporting catch"
  );
  assert(
    region.includes('catch(e){el.voicePlayer.isCancelled(a.trackId)||(console.error("[voice-stream] playback chain failed:",e),el.voicePlayer.setError(a.trackId,e))}'),
    name + ": the per-message chain must contain the failure and still report it"
  );
}

// --- 4. zero-audio segments must be skipped explicitly, never counted as success ------
for (const name of bundles) {
  const source = sources.get(name);
  const region = regionOf(source, "voice-eY");
  assert(
    region.includes('"tts_no_audio_frames"===i?.terminal?.code'),
    name + ": the page must read the structured zero-audio terminal value"
  );
  const skipIndex = region.indexOf('"tts_no_audio_frames"===i?.terminal?.code');
  const skipBranch = region.slice(skipIndex, skipIndex + 260);
  assert(
    skipBranch.includes("el.voicePlayer.setEmpty(a.trackId"),
    name + ": a zero-audio segment must leave the loading state explicitly"
  );
  assert(
    !skipBranch.includes("setError"),
    name + ": a zero-audio segment must not be reported as a synthesis error"
  );
  const effectRegion = regionOf(source, "voice-effect");
  assert(
    effectRegion.includes("t.then(()=>{i.hasPlayedAny||"),
    name + ": a track that produced no audio at all must still reach a terminal state"
  );
  assert(
    effectRegion.includes('el.voicePlayer.setEmpty(v,"tts_no_audio_frames")'),
    name + ": the terminal fallback must use the structured zero-audio reason"
  );
  assert(
    effectRegion.includes('"loading"!==el.voicePlayer.getSnapshot().state||'),
    name + ": the terminal fallback must not overwrite an already reported error"
  );

  // A block-scoped stream binding that reuses the name of the chunk array it is read
  // from puts the array in TDZ: `let s=e[r]` then throws ReferenceError, and the
  // chain's trailing .catch(()=>{}) swallows it, leaving the player on "loading"
  // forever with no play() call at all.
  const loop = region.match(/for\(let (\w+)=0;\1<(\w+)\.length;\1\+\+\)\{let (\w+)=(\2)\[\1\]/);
  assert(loop, name + ": the voice chain must iterate the chunk array with a for/let loop");
  assert(
    !region.includes("let{stream:" + loop[2] + ","),
    name + ": the destructured stream must not shadow the iterated chunk array '" + loop[2] +
      "' (shadows it in TDZ for the whole block, so `" + loop[3] + "=" + loop[2] + "[" + loop[1] + "]` throws and the chain dies silently)"
  );
}

// --- 5. the cached replay path must load audio before playing it ---------------------
for (const name of bundles) {
  const region = regionOf(sources.get(name), "replay-tp");
  const readIndex = region.indexOf("await A(t,e)");
  const playIndex = region.indexOf("await el.voicePlayer.play(t,e)");
  assert(readIndex >= 0, name + ": the replay path must read the cached audio before playing");
  assert(playIndex > readIndex, name + ": the replay path must play only after the cached audio is loaded");
  assert(region.includes('el.voicePlayer.setError(e,"cache empty")'), name + ": an empty cache entry must surface as an error");
}

// --- 6. the voice runtime must own each Blob URL per play instance -------------------
{
  assert(fs.existsSync(chunkPath), "missing voice runtime chunk");
  const chunk = fs.readFileSync(chunkPath, "utf8");

  assert(
    !chunk.includes("this.cleanup(),this.cancelPendingIdle()"),
    "a late ended callback must not run the shared cleanup that revokes the live URL"
  );
  assert(
    !chunk.includes('this.audio!==r?e():r.ended||this.emit({state:"paused"'),
    "the paused callback must use the same ownership rule as the other callbacks"
  );
  assert(
    chunk.includes('this.audio===r'),
    "the player must identify the owning audio element before mutating state"
  );
  assert(
    chunk.includes("URL.revokeObjectURL(l)"),
    "each play instance must release its own Blob URL"
  );
  assert(
    chunk.includes("setEmpty(e){") || chunk.includes("setEmpty(e,t){"),
    "the player must expose an explicit empty terminal transition"
  );
  assert(
    chunk.includes("lastOutcome"),
    "a zero-audio segment must record a structured outcome"
  );
  assert(!chunk.includes("invalid_stream"), "stream failures must use the layered error codes");
  for (const code of [
    "tts_stream_http_error",
    "tts_stream_network_error",
    "tts_stream_protocol_error",
    "tts_invalid_start",
    "tts_stream_closed_before_end",
    "tts_no_audio_frames",
    "tts_fallback_failed",
    "tts_capabilities_failed"
  ]) {
    assert(chunk.includes(code), "the runtime must expose the stable code " + code);
  }

  // --- 7. the capability probe must retry, and deduplicate concurrent callers --------
  assert(
    !chunk.includes("SocratopiaTtsStreamCapabilitiesPromise||("),
    "a failed capability probe must not be cached by a single unconditional promise"
  );
  assert(
    chunk.includes("SocratopiaTtsStreamCapabilitiesOk"),
    "a successful capability probe must be remembered explicitly"
  );

  // --- 8. the local TTS service must stay outside the /api capability gate -----------
  assert(chunk.includes('tE+"/infer_classic_stream"'), "stream synthesis must call the absolute local TTS endpoint");
  assert(chunk.includes('tE+"/capabilities"'), "the capability probe must call the absolute local TTS endpoint");
  assert(!chunk.includes('"/api/tts-audio"'), "the voice runtime must not depend on the protected audio route");
}

// --- 9. the chunk chain must actually reach the player, not just look correct ---------
// Structure assertions above cannot see a runtime throw, so run the real compiled
// consumer against stubs and require one play() per synthesised frame.
const runtime = [];

async function runChain(name) {
  const region = regionOf(sources.get(name), "voice-eY");
  const anchor = region.indexOf("a.chain=a.chain.then(");
  assert(anchor >= 0, name + ": the chain consumer is missing");
  const arrowStart = region.indexOf("async e=>{", anchor);
  assert(arrowStart >= 0, name + ": the chain consumer callback is missing");
  let depth = 0, end = -1;
  for (let i = region.indexOf("{", arrowStart); i < region.length; i++) {
    if (region[i] === "{") depth++;
    else if (region[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert(end > 0, name + ": the chain consumer callback is not terminated");
  const source = region.slice(arrowStart, end);

  const frames = 3;
  const calls = { play: 0, recorded: 0, setError: [], setEmpty: [] };
  const logs = [];
  const player = {
    isCancelled: () => false,
    play: async () => { calls.play++; },
    setError: (id, e) => calls.setError.push([id, String((e && e.message) || e)]),
    setEmpty: (id, code) => calls.setEmpty.push([id, code])
  };
  const track = {
    chain: Promise.resolve(),
    trackId: "track-smoke",
    hasPlayedAny: false,
    pendingPauseMs: 0,
    synthesisChain: Promise.resolve(),
    recordedChunks: []
  };
  const stream = {
    terminal: { code: null },
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: async () => (i++ < frames ? { value: { audio: { frame: i } }, done: false } : { value: undefined, done: true }) };
    }
  };

  const consumer = new Function("el", "a", "console", "return (" + source + ");")(
    { voicePlayer: player },
    track,
    { error: (...args) => logs.push(args.map(String).join(" ")) }
  );

  const outcome = await Promise.allSettled([consumer([Promise.resolve({ stream, error: null })])]);
  assert.strictEqual(outcome[0].status, "fulfilled", name + ": the chunk chain threw and was swallowed: " + (outcome[0].reason && outcome[0].reason.message));
  assert.strictEqual(calls.play, frames, name + ": every synthesised frame must reach the player (play() called " + calls.play + " of " + frames + " times)");
  assert.strictEqual(track.recordedChunks.length, frames, name + ": every frame must be recorded for the replay cache");
  assert.deepStrictEqual(calls.setError, [], name + ": a healthy chain must not report an error");
  assert.deepStrictEqual(calls.setEmpty, [], name + ": a healthy chain must not report a zero-audio segment");
  assert.deepStrictEqual(logs, [], name + ": a healthy chain must not log a failure");
  runtime.push({ bundle: name, frames, play: calls.play, recorded: track.recordedChunks.length });
}

(async () => {
  for (const name of bundles) await runChain(name);
  console.log(JSON.stringify({
    result: "PASS",
    identity: identity,
    bundles: bundles.length,
    runtime: runtime
  }, null, 2));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
