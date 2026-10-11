"use strict";

// Proves classic-stream failures are classified by layer instead of being degraded
// mechanically, and that every layer keeps its original status/code for diagnosis:
//
//   service unavailable (404/405/501) -> single explicit fallback, its failure is
//                                        reported as tts_fallback_failed
//   every other failure               -> surfaced, never silently degraded
//   zero audio                        -> structured terminal, not a success
//
// The local TTS service is faked on loopback; no real TTS process is involved.

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

function loadVoice(baseUrl) {
  const chunkSource = fs.readFileSync(bundlePath, "utf8");
  const priorSelf = globalThis.self;
  const priorLocalStorage = globalThis.localStorage;
  globalThis.self = { webpackChunk_N_E: [] };
  globalThis.localStorage = { getItem() { return null; }, removeItem() {}, setItem() {} };
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
    };
    factory({}, exports, webpackRequire);
    return exports;
  } finally {
    if (priorSelf === undefined) delete globalThis.self; else globalThis.self = priorSelf;
    if (priorLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = priorLocalStorage;
  }
}

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

async function attempt(run) {
  try {
    return { value: await run(), error: null };
  } catch (error) {
    return { value: undefined, error: error };
  }
}

function ndjson(res, events) {
  res.writeHead(200, { "Content-Type": "application/x-ndjson", "X-TTS-Protocol": "classic-stream-ndjson-v1" });
  for (const event of events) res.write(JSON.stringify(event) + "\n");
  res.end();
}

async function main() {
  const counts = { capabilities: 0, stream: 0, classic: 0, cancel: 0, audio: 0 };
  const state = { scenario: "none", baseUrl: null };

  const server = http.createServer(function (request, response) {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/capabilities") {
      counts.capabilities += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ tts: { classic_stream: { protocol: "classic-stream-ndjson-v1" } } }));
      return;
    }
    if (pathname === "/infer_classic_stream/cancel") {
      counts.cancel += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
      return;
    }
    if (pathname === "/infer_classic") {
      counts.classic += 1;
      if (state.scenario === "http404_fallback_fail") {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ msg: "no classic model" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ audio_url: state.baseUrl + "/audio.wav" }));
      return;
    }
    if (pathname === "/audio.wav") {
      counts.audio += 1;
      response.writeHead(200, { "Content-Type": "audio/wav" });
      response.end(wavBuffer());
      return;
    }
    if (pathname === "/infer_classic_stream") {
      counts.stream += 1;
      switch (state.scenario) {
        case "http500_body_code":
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ code: "model_not_loaded", msg: "model not loaded" }));
          return;
        case "http500_no_body":
          response.writeHead(500);
          response.end();
          return;
        case "http401":
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ code: "auth_missing", msg: "missing capability" }));
          return;
        case "http404_fallback_ok":
        case "http404_fallback_fail":
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ msg: "stream endpoint missing" }));
          return;
        case "network":
          response.socket.destroy();
          return;
        case "not_ndjson":
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end("<html>not a stream</html>");
          return;
        case "bad_start":
          ndjson(response, [{ type: "start", protocol: "classic-stream-legacy-v0" }]);
          return;
        case "audio_before_start":
          ndjson(response, [{ type: "audio", seq: 0, mime: "audio/wav", data: wavBuffer().toString("base64") }]);
          return;
        case "closed_before_end":
          ndjson(response, [{ type: "start", protocol: "classic-stream-ndjson-v1" }]);
          return;
        case "no_audio_event":
          ndjson(response, [
            { type: "start", protocol: "classic-stream-ndjson-v1" },
            { type: "error", code: "no_audio_frames", message: "no audio frames produced" }
          ]);
          return;
        case "end_zero_frames":
          ndjson(response, [
            { type: "start", protocol: "classic-stream-ndjson-v1" },
            { type: "end", chunks: 0 }
          ]);
          return;
        default:
          response.writeHead(500);
          response.end();
      }
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
    const baseUrl = "http://127.0.0.1:" + server.address().port;
    state.baseUrl = baseUrl;

    async function run(scenario, options) {
      state.scenario = scenario;
      const before = { capabilities: counts.capabilities, stream: counts.stream, classic: counts.classic };
      const voice = loadVoice(baseUrl);
      const text = "第一句用于语音验收。第二句用于验证降级路径。";
      const outcome = await attempt(function () {
        return voice.synthesizeStream(text, "soft_girl", 1, (options && options.signal) || AbortSignal.timeout(8000)).then(async function (stream) {
          return { stream: stream, chunks: await collect(stream) };
        });
      });
      return {
        error: outcome.error,
        value: outcome.value,
        delta: { stream: counts.stream - before.stream, classic: counts.classic - before.classic }
      };
    }

    // --- HTTP failures that carry a provider code keep it, and never degrade ---------
    {
      const run1 = await run("http500_body_code");
      assert(run1.error instanceof Error, "a 500 stream response must fail");
      assert.strictEqual(run1.error.code, "model_not_loaded", "a provider error code must be preserved");
      assert(run1.error.details && run1.error.details.layer === "tts_stream_http_error", "the HTTP layer must be recorded");
      assert.strictEqual(run1.error.details.originalStatus, 500, "the original HTTP status must be recorded");
      assert.strictEqual(run1.delta.classic, 0, "an HTTP failure must not silently degrade to the non-stream path");
    }

    {
      const run1 = await run("http500_no_body");
      assert(run1.error instanceof Error, "a bodiless 500 must fail");
      assert.strictEqual(run1.error.code, "tts_stream_http_error", "a bodiless HTTP failure must use the stable layer code");
      assert.strictEqual(run1.error.details.originalCode, null, "a bodiless HTTP failure must record that no provider code existed");
      assert.strictEqual(run1.delta.classic, 0, "a bodiless HTTP failure must not silently degrade");
    }

    {
      const run1 = await run("http401");
      assert(run1.error instanceof Error, "an unauthorised stream response must fail");
      assert.strictEqual(run1.error.code, "auth_missing", "an auth failure must keep the provider code");
      assert.strictEqual(run1.error.details.layer, "tts_stream_http_error", "an auth failure must be classified, not degraded");
      assert.strictEqual(run1.error.details.originalStatus, 401, "an auth failure must keep its status");
      assert.strictEqual(run1.delta.classic, 0, "an auth failure must never degrade to a second, unauthenticated request");
    }

    // --- only a missing stream endpoint degrades, and the degradation is observable --
    {
      const run1 = await run("http404_fallback_ok");
      assert(!run1.error, "a missing stream endpoint must degrade instead of failing: " + (run1.error && run1.error.stack));
      assert.strictEqual(run1.delta.classic, 1, "a missing stream endpoint must use the non-stream path exactly once");
      assert(run1.value.stream.fallbackReason && run1.value.stream.fallbackReason.code === "tts_stream_http_error", "the degraded stream must report why it degraded");
      assert.strictEqual(run1.value.chunks.length, 1, "the degraded stream must still deliver audio");
    }

    {
      const run1 = await run("http404_fallback_fail");
      assert(run1.error instanceof Error, "a failed degradation must surface");
      assert.strictEqual(run1.error.code, "tts_fallback_failed", "a failed degradation must use the stable fallback code");
      assert.strictEqual(run1.error.details.originalCode, "tts_stream_http_error", "a failed degradation must keep the original stream-layer code");
      assert.strictEqual(run1.error.details.originalStatus, 404, "a failed degradation must keep the original stream status");
      assert(run1.error.details.cause, "a failed degradation must keep the fallback error as the cause");
    }

    // --- transport failures are surfaced, never degraded -----------------------------
    {
      const run1 = await run("network");
      assert(run1.error instanceof Error, "a dropped connection must fail");
      assert.strictEqual(run1.error.code, "tts_stream_network_error", "a transport failure must use the stable network code");
      assert.strictEqual(run1.delta.classic, 0, "a transport failure must not silently degrade to the non-stream path");
      assert(run1.error.details && run1.error.details.cause, "a transport failure must keep the original fetch error");
    }

    // --- protocol failures are surfaced with their own codes -------------------------
    {
      const run1 = await run("not_ndjson");
      assert(run1.error instanceof Error, "a non-stream response must fail");
      assert.strictEqual(run1.error.code, "tts_stream_protocol_error", "a protocol mismatch must use the stable protocol code");
      assert(run1.error.details.contentType.indexOf("text/html") >= 0, "a protocol mismatch must record the offending content type");
      assert.strictEqual(run1.delta.classic, 0, "a protocol mismatch must not silently degrade");
    }

    {
      const run1 = await run("bad_start");
      assert(run1.error instanceof Error, "an invalid start frame must fail");
      assert.strictEqual(run1.error.code, "tts_invalid_start", "an invalid start frame must use the stable start code");
      assert.strictEqual(run1.delta.classic, 0, "an invalid start frame must not silently degrade");
    }

    {
      const run1 = await run("audio_before_start");
      assert(run1.error instanceof Error, "audio before start must fail");
      assert.strictEqual(run1.error.code, "tts_stream_protocol_error", "an out-of-order frame must use the stable protocol code");
      assert.strictEqual(run1.delta.classic, 0, "an out-of-order frame must not silently degrade");
    }

    {
      const run1 = await run("closed_before_end");
      assert(run1.error instanceof Error, "a stream closed before end must fail");
      assert.strictEqual(run1.error.code, "tts_stream_closed_before_end", "an incomplete stream must use the stable truncation code");
      assert.strictEqual(run1.delta.classic, 0, "a truncated stream must not silently degrade");
    }

    // --- zero audio is structured, never a success and never a stuck track -----------
    {
      const run1 = await run("no_audio_event");
      assert(!run1.error, "a structured no_audio_frames error must not throw at the stream layer");
      assert.strictEqual(run1.value.chunks.length, 0, "a zero-audio stream must not emit Blob chunks");
      assert(run1.value.stream.terminal, "a zero-audio stream must expose a structured terminal value");
      assert.strictEqual(run1.value.stream.terminal.code, "tts_no_audio_frames", "the terminal value must keep the structured code");
      assert.strictEqual(run1.value.stream.terminal.audioFrames, 0, "the terminal value must record that no frame was produced");
      assert(run1.value.stream.terminal.requestId, "the terminal value must record the request id for diagnosis");
      assert.strictEqual(run1.delta.classic, 0, "a zero-audio segment must not silently degrade");
    }

    {
      const run1 = await run("end_zero_frames");
      assert(!run1.error, "an end frame without audio must not throw at the stream layer");
      assert.strictEqual(run1.value.chunks.length, 0, "an end frame without audio must not emit Blob chunks");
      assert(run1.value.stream.terminal && run1.value.stream.terminal.code === "tts_no_audio_frames", "an end frame without audio must be reported as zero audio");
      assert.strictEqual(run1.delta.classic, 0, "an end frame without audio must not silently degrade");
    }

    // --- abort stays an abort --------------------------------------------------------
    {
      const controller = new AbortController();
      controller.abort();
      const run1 = await run("http404_fallback_ok", { signal: controller.signal });
      assert(run1.error instanceof Error, "an aborted request must reject");
      assert.strictEqual(run1.error.name, "AbortError", "an aborted request must stay an AbortError");
      assert.strictEqual(run1.delta.classic, 0, "an aborted request must not degrade into a fallback synthesis");
    }

    console.log(JSON.stringify({
      result: "PASS",
      counters: counts,
      checks: [
        "http500_body_code",
        "http500_no_body",
        "http401",
        "http404_fallback_ok",
        "http404_fallback_fail",
        "network",
        "not_ndjson",
        "bad_start",
        "audio_before_start",
        "closed_before_end",
        "no_audio_event",
        "end_zero_frames",
        "abort"
      ]
    }, null, 2));
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
