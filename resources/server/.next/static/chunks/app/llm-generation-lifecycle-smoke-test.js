"use strict";

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

for (const name of bundles) {
  const source = fs.readFileSync(path.join(__dirname, name), "utf8");
  assert(
    source.includes("SocratopiaGenerationDone"),
    `${name}: LLM generation completion must be tracked separately from request cleanup`
  );
  assert(
    source.includes('eM(!0),SocratopiaSetGenerationDone(!1),eO("")'),
    `${name}: each turn must reset generation completion before reading SSE`
  );
  assert(
    source.includes('e>0&&Z(r,e),eY(),SocratopiaSetGenerationDone(!0),eq("calm")'),
    `${name}: the usage event must flush the complete typewriter buffer before TTS finalization`
  );
  assert(
    source.includes("isStreaming:e_&&!SocratopiaGenerationDone,streamContent:eF"),
    `${name}: chat rendering and TTS finalization must follow generation, not background cleanup`
  );
  assert(
    source.includes("disabled:e_,isStreaming:e_&&!SocratopiaGenerationDone"),
    `${name}: controls must stop showing generation while remaining disabled during cleanup`
  );
}

console.log("llm generation lifecycle bundle smoke: PASS");
