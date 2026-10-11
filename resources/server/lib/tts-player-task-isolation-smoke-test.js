"use strict";

// Proves the voice player isolates every play() instance:
//  - a superseded <audio> element may never mutate the live snapshot,
//  - a superseded element may never revoke the live Blob URL (each instance owns its URL),
//  - an awaited play() promise never hangs, even when its element is superseded or stopped,
//  - a zero-audio segment ends in an explicit terminal state instead of staying in "loading".

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const bundlePath = path.resolve(__dirname, "..", ".next", "static", "chunks", "4137-131d0676e3b5bef7.js");

// ---- browser stubs -----------------------------------------------------------------
const liveAudios = [];
const revoked = [];

class FakeAudio {
  constructor(url) {
    this.url = url;
    this.paused = true;
    this.ended = false;
    this.currentTime = 0;
    this.playbackRate = 1;
    this.preservesPitch = undefined;
    liveAudios.push(this);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  firePlay() { if (this.onplay) this.onplay(); }
  fireEnded() { this.ended = true; this.paused = true; if (this.onended) this.onended(); }
  fireError() { if (this.onerror) this.onerror(); }
}

globalThis.URL = {
  createObjectURL() {
    const url = "blob:probe/" + (revoked.length + liveAudios.length + 1) + "-" + Math.random().toString(36).slice(2, 8);
    return url;
  },
  revokeObjectURL(url) {
    revoked.push(url);
  }
};
globalThis.Audio = FakeAudio;

function freshPlayer() {
  const chunkSource = fs.readFileSync(bundlePath, "utf8");
  const priorSelf = globalThis.self;
  const priorLocalStorage = globalThis.localStorage;
  const events = [];
  globalThis.self = { webpackChunk_N_E: [] };
  globalThis.localStorage = { getItem() { return null; }, removeItem() {}, setItem() {} };
  try {
    eval(chunkSource);
    const pushed = globalThis.self.webpackChunk_N_E.at(-1);
    const factory = pushed && pushed[1] && pushed[1][4137];
    assert(factory, "webpack module 4137 missing");
    const exports = {};
    function webpackRequire(moduleId) {
      if (moduleId === 1660) return { tE: "http://127.0.0.1:9", mj: function () { return "local-session"; } };
      if (moduleId === 508) return { A: { emit: function (name, payload) { events.push({ name: name, payload: payload }); } } };
      throw new Error("unexpected module dependency: " + moduleId);
    }
    webpackRequire.r = function (target) { Object.defineProperty(target, "__esModule", { value: true }); };
    webpackRequire.d = function (target, definitions) {
      Object.keys(definitions).forEach(function (name) {
        Object.defineProperty(target, name, { enumerable: true, get: definitions[name] });
      });
    };
    factory({}, exports, webpackRequire);
    return { player: exports.voicePlayer, events: events };
  } finally {
    if (priorSelf === undefined) delete globalThis.self; else globalThis.self = priorSelf;
    if (priorLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = priorLocalStorage;
  }
}

function outcome(promise) {
  return Promise.race([
    promise.then(function () { return "resolved"; }, function (error) { return "rejected:" + (error && error.message); }),
    new Promise(function (resolve) { setTimeout(function () { resolve("pending"); }, 60); })
  ]);
}

function countRevoked(url) {
  return revoked.filter(function (entry) { return entry === url; }).length;
}

function blob() {
  return { type: "audio/wav", size: 128 };
}

async function main() {
  // --- 1. a late error from a superseded element must not touch the live track -------
  {
    const { player } = freshPlayer();
    player.setLoading("task-A");
    const playA = player.play(blob(), "task-A");
    const audioA = liveAudios.at(-1);
    audioA.firePlay();

    player.setLoading("task-B");
    const playB = player.play(blob(), "task-B");
    const audioB = liveAudios.at(-1);
    audioB.firePlay();
    const urlB = audioB.url;
    const playBOutcome = outcome(playB);

    audioA.fireError();

    assert.strictEqual(player.getSnapshot().state, "playing", "a late error from a superseded element must not overwrite the live state");
    assert.strictEqual(player.getSnapshot().trackId, "task-B", "a late error from a superseded element must not overwrite the live track");
    assert.strictEqual(countRevoked(urlB), 0, "a late error from a superseded element must not revoke the live Blob URL");
    assert.strictEqual(await outcome(playA), "resolved", "a superseded play() promise must resolve instead of rejecting or hanging");
    assert.strictEqual(await playBOutcome, "pending", "the superseded element must not settle the live play() promise");

    audioB.fireEnded();
    assert.strictEqual(await playB, undefined, "the live play() promise must resolve when its own element ends");
    assert.strictEqual(countRevoked(urlB), 1, "the live Blob URL must be revoked exactly once, by its own instance");
    revoked.length = 0;
  }

  // --- 2. a late ended from a superseded element must not revoke the live URL --------
  {
    const { player } = freshPlayer();
    player.setLoading("task-C");
    const playC = player.play(blob(), "task-C");
    const audioC = liveAudios.at(-1);
    audioC.firePlay();

    player.setLoading("task-D");
    const playD = player.play(blob(), "task-D");
    const audioD = liveAudios.at(-1);
    audioD.firePlay();
    const urlD = audioD.url;

    audioC.fireEnded();

    assert.strictEqual(player.getSnapshot().state, "playing", "a late ended from a superseded element must not change the live state");
    assert.strictEqual(player.getSnapshot().trackId, "task-D", "a late ended from a superseded element must not change the live track");
    assert.strictEqual(countRevoked(urlD), 0, "a late ended from a superseded element must not revoke the live Blob URL");
    assert.strictEqual(await outcome(playC), "resolved", "the superseded ended promise must settle");
    revoked.length = 0;
  }

  // --- 3. stopping must settle the pending play() promise ----------------------------
  {
    const { player } = freshPlayer();
    player.setLoading("task-E");
    const playE = player.play(blob(), "task-E");
    const audioE = liveAudios.at(-1);
    audioE.firePlay();
    player.setError("task-E", "boom");
    assert.strictEqual(player.getSnapshot().state, "error", "setError must publish the error state");
    assert.strictEqual(await outcome(playE), "resolved", "setError must settle the pending play() promise");
    revoked.length = 0;
  }

  // --- 4. zero-audio segments must end in an explicit terminal state -----------------
  {
    const { player, events } = freshPlayer();
    player.setLoading("task-F");
    assert.strictEqual(player.getSnapshot().state, "loading", "a new track starts in loading");
    assert.strictEqual(typeof player.setEmpty, "function", "the player must expose an explicit empty terminal transition");
    player.setEmpty("task-F", "tts_no_audio_frames");
    const snapshot = player.getSnapshot();
    assert.strictEqual(snapshot.state, "idle", "a zero-audio segment must not stay in loading");
    assert.strictEqual(snapshot.trackId, null, "a zero-audio segment must clear the loading track id");
    assert.strictEqual(snapshot.lastOutcome && snapshot.lastOutcome.kind, "empty", "a zero-audio segment must record a structured empty outcome");
    assert.strictEqual(snapshot.lastOutcome && snapshot.lastOutcome.reason, "tts_no_audio_frames", "the empty outcome must keep the structured reason");
    assert(
      events.some(function (event) { return event.name === "voice_synth_skipped"; }),
      "a zero-audio segment must be observable as a skipped synthesis"
    );

    player.setLoading("task-G");
    assert.strictEqual(player.getSnapshot().lastOutcome, undefined, "starting a new track must clear the previous empty outcome");
  }

  console.log("tts player task isolation smoke: PASS");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
