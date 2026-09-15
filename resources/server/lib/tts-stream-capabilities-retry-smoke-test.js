"use strict";

// Proves the classic-stream capability probe is not cached permanently on failure
// while concurrent callers still share a single in-flight probe:
//
//   - a failed probe is retried on the next synthesis,
//   - a successful probe is remembered,
//   - N concurrent syntheses issue exactly one probe request.

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const bundlePath = path.resolve(__dirname, "..", ".next", "static", "chunks", "4137-131d0676e3b5bef7.js");

function wavBuffer() {
  const bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WAVE", 8, "ascii");
  return bytes;
}

// "probe" asks the client to verify the streaming capability before using it.
let streamMode = "probe";
globalThis.localStorage = {
  getItem(key) { return key === "socratopia_tts_stream_mode" ? streamMode : null; },
  removeItem() {},
  setItem() {}
};

function loadVoice(baseUrl) {
  const chunkSource = fs.readFileSync(bundlePath, "utf8");
  const priorSelf = globalThis.self;
  globalThis.self = { webpackChunk_N_E: [] };
  try {
    eval(chunkSource);
    const pushed = globalThis.self.webpackChunk_N_E.at(-1);
    const factory = pushed && pushed[1] && pushed[1][4137];
    assert(factory, "webpack module 4137 missing");
    const exports = {};
    function webpackRequire(moduleId) {
      if (moduleId === 1660) return { tE: baseUrl, mj: function () { return "local-session"; } };
      if (moduleId === 508) return { A: { emit: function () {} } };
      throw new Error("unexpected module dependency: " + moduleId);
    }
    webpackRequire.r = function (target) { Object.defineProperty(target, "__esModule", { value: true }); };
    webpackRequire.d = function (target, definitions) {
      Object.keys(definitions).forEach(function (name) {
        Object.defineProperty(target, name, { enumerable: true, get: definitions[name] });
      });
    }
    factory({}, exports, webpackRequire);
    return exports;
  } finally {
    if (priorSelf === undefined) delete globalThis.self; else globalThis.self = priorSelf;
  }
}

async function consume(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

async function main() {
  const counts = { capabilities: 0, stream: 0, classic: 0 };
  const state = { capabilitiesFailures: 0, capabilitiesDelayMs: 0, baseUrl: null };

  const server = http.createServer(function (request, response) {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/capabilities") {
      counts.capabilities += 1;
      const shouldFail = state.capabilitiesFailures > 0;
      if (shouldFail) state.capabilitiesFailures -= 1;
      const send = function () {
        if (shouldFail) {
          response.writeHead(503, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "tts service warming up" }));
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ tts: { classic_stream: { protocol: "classic-stream-ndjson-v1" } } }));
      };
      if (state.capabilitiesDelayMs > 0) setTimeout(send, state.capabilitiesDelayMs);
      else send();
      return;
    }
    if (pathname === "/infer_classic") {
      counts.classic += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ audio_url: state.baseUrl + "/audio.wav" }));
      return;
    }
    if (pathname === "/audio.wav") {
      response.writeHead(200, { "Content-Type": "audio/wav" });
      response.end(wavBuffer());
      return;
    }
    if (pathname === "/infer_classic_stream") {
      counts.stream += 1;
      response.writeHead(200, { "Content-Type": "application/x-ndjson", "X-TTS-Protocol": "classic-stream-ndjson-v1" });
      response.write(JSON.stringify({ type: "start", protocol: "classic-stream-ndjson-v1" }) + "\n");
      response.write(JSON.stringify({ type: "audio", seq: 0, mime: "audio/wav", data: wavBuffer().toString("base64") }) + "\n");
      response.write(JSON.stringify({ type: "end", chunks: 1 }) + "\n");
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    state.baseUrl = "http://127.0.0.1:" + server.address().port;
    const text = "第一句话用于语音探针验收。";

    // --- a failed probe must be retried on the next synthesis ------------------------
    {
      state.capabilitiesFailures = 1;
      const voice = loadVoice(state.baseUrl);

      const first = await voice.synthesizeStream(text, "soft_girl", 1, AbortSignal.timeout(8000));
      const firstChunks = await consume(first);
      const afterFirst = { capabilities: counts.capabilities, classic: counts.classic, stream: counts.stream };

      const second = await voice.synthesizeStream(text, "soft_girl", 1, AbortSignal.timeout(8000));
      const secondChunks = await consume(second);
      const afterSecond = { capabilities: counts.capabilities, classic: counts.classic, stream: counts.stream };

      const third = await voice.synthesizeStream(text, "soft_girl", 1, AbortSignal.timeout(8000));
      const thirdChunks = await consume(third);

      assert.strictEqual(afterFirst.capabilities, 1, "the first synthesis must probe the streaming capability");
      assert.strictEqual(afterFirst.classic, 1, "a failed probe must use the non-stream path once");
      assert.strictEqual(afterFirst.stream, 0, "a failed probe must not use the streaming path");

      assert.strictEqual(afterSecond.capabilities, 2, "a failed capability probe must not be cached permanently");
      assert.strictEqual(afterSecond.stream, 1, "a recovered capability probe must switch back to the streaming path");
      assert(!second.fallbackReason, "a recovered capability probe must not degrade");
      assert.strictEqual(secondChunks.length, 1, "the recovered streaming path must deliver audio");

      assert.strictEqual(counts.capabilities, 2, "a successful capability probe must be remembered");
      assert.strictEqual(thirdChunks.length, 1, "the remembered probe must keep using the streaming path");

      assert(first.fallbackReason && first.fallbackReason.code === "tts_capabilities_failed", "a failed probe must report why the stream was not used");
      assert.strictEqual(firstChunks.length, 1, "the non-stream path must still deliver audio");
    }

    // --- concurrent syntheses must share a single in-flight probe --------------------
    {
      const before = { capabilities: counts.capabilities, stream: counts.stream };
      state.capabilitiesFailures = 0;
      state.capabilitiesDelayMs = 120;
      const voice = loadVoice(state.baseUrl);

      const streams = await Promise.all([
        voice.synthesizeStream(text, "soft_girl", 1, AbortSignal.timeout(8000)),
        voice.synthesizeStream(text, "soft_girl", 1, AbortSignal.timeout(8000)),
        voice.synthesizeStream(text, "soft_girl", 1, AbortSignal.timeout(8000)),
        voice.synthesizeStream(text, "soft_girl", 1, AbortSignal.timeout(8000))
      ]);
      const chunks = await Promise.all(streams.map(consume));

      assert.strictEqual(counts.capabilities - before.capabilities, 1, "concurrent syntheses must share one in-flight capability probe");
      assert.strictEqual(counts.stream - before.stream, 4, "concurrent syntheses must all use the streaming path");
      chunks.forEach(function (entry, index) {
        assert.strictEqual(entry.length, 1, "concurrent stream " + index + " must deliver audio");
      });
      state.capabilitiesDelayMs = 0;
    }

    console.log(JSON.stringify({ result: "PASS", counters: counts }, null, 2));
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
