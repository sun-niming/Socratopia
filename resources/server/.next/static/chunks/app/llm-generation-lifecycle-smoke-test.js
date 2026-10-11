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
    source.includes("isStreaming:e_&&!SocratopiaGenerationDone,streamContent:eF") ||
      source.includes("isStreaming:e_&&!SocratopiaGenerationDone&&_streamConvId===q,streamContent:_streamConvId===q?eF:void 0"),
    `${name}: chat rendering and TTS finalization must follow generation, not background cleanup`
  );
  assert(
    source.includes("disabled:e_,isStreaming:e_&&!SocratopiaGenerationDone"),
    `${name}: controls must stop showing generation while remaining disabled during cleanup`
  );
  // The live buffers are component-global, so a stream must only be painted onto the
  // conversation it belongs to. Without this, sending in a new conversation overwrites
  // an already-finished conversation's last answer while it is displayed.
  if (source.includes("_streamConvId")) {
    assert(
      source.includes("_streamConvId===q?eB:void 0") && source.includes("_streamConvId===q?eW:void 0"),
      `${name}: live stream text, tool list and mood must be scoped to the streaming conversation`
    );
    assert(
      source.includes("_setStreamConvId(_prev=>_prev===r?null:_prev)") &&
        source.includes("var _ownerStream=ro.current===l;"),
      `${name}: a finished send must not clear a newer send's live state`
    );
  }
}

console.log("llm generation lifecycle bundle smoke: PASS");
