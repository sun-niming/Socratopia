"use strict";

if (process.env.SOCRATOPIA_RUN_TTS_LIVE !== "1") {
  console.log("SKIP tts classic stream cancellation live check: set SOCRATOPIA_RUN_TTS_LIVE=1 to use a real local TTS service");
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
    const factory = pushed?.[1]?.[4137];
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (...args) => {
    fetchCalls.push(String(args[0]));
    return originalFetch(...args);
  };

  try {
    const voice = loadVoiceExports();
    const controller = new AbortController();
    const longStream = await voice.synthesizeStream(
      "这是前端取消验收的第一句话。第二句话保持生成任务活跃。第三句话用于等待 AbortSignal 发送取消请求。第四句话用于验证不会继续阻塞后续语音。",
      "soft_girl",
      1,
      controller.signal
    );
    const iterator = longStream[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.strictEqual(first.done, false, "frontend cancel test did not receive first audio");
    assert.strictEqual(first.value.seq, 0, "frontend cancel test first sequence changed");
    controller.abort();
    await longStream.done.catch(() => {});
    await delay(300);
    assert(
      fetchCalls.some(url => url.endsWith("/infer_classic_stream/cancel")),
      "AbortSignal did not send an explicit stream cancel request"
    );

    const followUpStartedAt = Date.now();
    const followUp = await voice.synthesizeStream(
      "这是前端取消后的后续请求，用于确认共享模型锁已经释放。",
      "soft_girl",
      1,
      AbortSignal.timeout(60_000)
    );
    const chunks = [];
    for await (const chunk of followUp) chunks.push(chunk);
    const followUpMs = Date.now() - followUpStartedAt;
    assert(chunks.length > 0, "follow-up frontend stream produced no audio chunks");
    assert(followUpMs < 30_000, "follow-up frontend stream waited too long after cancellation");

    console.log(JSON.stringify({
      result: "PASS",
      cancelRequests: fetchCalls.filter(url => url.endsWith("/infer_classic_stream/cancel")).length,
      followUpChunks: chunks.length,
      followUpMs
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
