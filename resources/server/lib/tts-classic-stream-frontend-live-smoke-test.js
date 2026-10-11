"use strict";

if (process.env.SOCRATOPIA_RUN_TTS_LIVE !== "1") {
  console.log("SKIP tts classic stream frontend live check: set SOCRATOPIA_RUN_TTS_LIVE=1 to use a real local TTS service");
  process.exit(0);
}

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.SOCRATOPIA_TTS_BASE_URL || "http://127.0.0.1:8000";
const bundlePath = path.resolve(__dirname, "..", ".next", "static", "chunks", "4137-131d0676e3b5bef7.js");

function loadVoiceExports() {
  const chunkSource = fs.readFileSync(bundlePath, "utf8");
  const priorSelf = globalThis.self;
  const priorLocalStorage = globalThis.localStorage;
  globalThis.self = { webpackChunk_N_E: [] };
  globalThis.localStorage = {
    getItem() { return null; },
    removeItem() {},
    setItem() {}
  };

  try {
    eval(chunkSource);
    const pushed = globalThis.self.webpackChunk_N_E.at(-1);
    assert(pushed, "voice bundle did not register a webpack chunk");
    const factory = pushed[1]?.[4137];
    assert(factory, "webpack module 4137 missing from voice bundle");

    const exports = {};
    function webpackRequire(moduleId) {
      if (moduleId === 1660) return { tE: baseUrl, mj: () => "local-session" };
      if (moduleId === 508) return { A: { emit() {} } };
      throw new Error("unexpected module dependency: " + moduleId);
    }
    webpackRequire.r = target => Object.defineProperty(target, "__esModule", { value: true });
    webpackRequire.d = (target, definitions) => {
      for (const [name, getter] of Object.entries(definitions)) {
        Object.defineProperty(target, name, { enumerable: true, get: getter });
      }
    };
    factory({}, exports, webpackRequire);
    return exports;
  } finally {
    if (priorSelf === undefined) delete globalThis.self;
    else globalThis.self = priorSelf;
    if (priorLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = priorLocalStorage;
  }
}

async function main() {
  const voice = loadVoiceExports();
  assert.strictEqual(typeof voice.synthesizeStream, "function", "synthesizeStream export missing");
  globalThis.localStorage = {
    getItem() { return "force"; },
    removeItem() {},
    setItem() {}
  };

  const stream = await voice.synthesizeStream(
    "这是前端 bundle 直接消费经典流式语音的验收测试。第二句话用于验证多个片段被逐一转换为 Blob。第三句话用于验证不会等待响应完成后才返回音频。",
    "soft_girl",
    1,
    AbortSignal.timeout(120_000)
  );

  const chunks = [];
  const firstChunkStartedAt = Date.now();
  for await (const chunk of stream) {
    chunks.push({
      seq: chunk.seq,
      type: chunk.audio.type,
      size: chunk.audio.size,
      receivedAt: Date.now()
    });
  }
  const totalMs = Date.now() - firstChunkStartedAt;

  assert(chunks.length > 0, "frontend stream reader produced no Blob chunks");
  chunks.forEach((chunk, index) => {
    assert.strictEqual(chunk.seq, index, "frontend stream reader changed chunk ordering");
    assert.strictEqual(chunk.type, "audio/wav", "frontend stream reader changed MIME type");
    assert(chunk.size > 44, "frontend stream reader produced an invalid WAV Blob");
  });

  const zeroAudioStream = await voice.synthesizeStream(
    "---",
    "soft_girl",
    1,
    AbortSignal.timeout(60_000)
  );
  let zeroAudioChunks = 0;
  for await (const chunk of zeroAudioStream) {
    zeroAudioChunks += 1;
  }
  assert.strictEqual(zeroAudioChunks, 0, "structured no_audio_frames must finish silently without Blob output");

  console.log(JSON.stringify({
    result: "PASS",
    chunks: chunks.length,
    zeroAudioChunks,
    firstChunkWaitMs: chunks[0].receivedAt - firstChunkStartedAt,
    totalMs
  }));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
