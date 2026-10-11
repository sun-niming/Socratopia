"use strict";

// A failed sentence must never abort the whole message: the async-iterator error is
// contained inside the per-message playback chain (no rethrow, playback continues)
// while still being reported to the player.  Containment must not become silence.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const bundles = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
];

const CHAIN_START = "let eY=(0,n.useCallback)((e,t,r,__socratopiaEmotion,__socratopiaSpeechOffset)=>{";
const CHAIN_END = "}).catch(()=>{})},[en]);";
const CONTAINMENT = 'catch(e){el.voicePlayer.isCancelled(a.trackId)||(console.error("[voice-stream] playback chain failed:",e),el.voicePlayer.setError(a.trackId,e))}';

for (const name of bundles) {
  const source = fs.readFileSync(path.join(__dirname, name), "utf8");
  const from = source.indexOf(CHAIN_START);
  assert(from >= 0, name + ": per-message playback chain missing");
  const to = source.indexOf(CHAIN_END, from);
  assert(to >= 0, name + ": per-message playback chain end missing");
  const chain = source.slice(from, to + CHAIN_END.length);

  assert(
    chain.includes(CONTAINMENT),
    name + ": async iterator errors must be contained inside the per-message playback chain"
  );
  const catchIndex = chain.indexOf(CONTAINMENT);
  const afterCatch = chain.slice(catchIndex, catchIndex + CONTAINMENT.length + 40);
  assert(
    afterCatch.indexOf("throw") < 0,
    name + ": the contained failure must not be rethrown out of the playback chain"
  );
  assert(
    chain.indexOf("catch(e){throw") < 0,
    name + ": the playback chain must not rethrow iterator failures"
  );
}

console.log("voice stream error containment smoke: PASS");
