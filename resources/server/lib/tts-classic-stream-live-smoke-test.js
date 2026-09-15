"use strict";

if (process.env.SOCRATOPIA_RUN_TTS_LIVE !== "1") {
  console.log("SKIP tts classic stream live check: set SOCRATOPIA_RUN_TTS_LIVE=1 to use a real local TTS service");
  process.exit(0);
}

const assert = require("assert");

const baseUrl = process.env.SOCRATOPIA_TTS_BASE_URL || "http://127.0.0.1:8000";
const referenceAudio = process.env.SOCRATOPIA_TTS_REFERENCE_AUDIO || "./参考音频/芙宁娜参考文本及语音/原神全角色中文语音-枫丹-芙宁娜-闲聊  茶会_爱给网_aigei_com.mp3";
const promptText = process.env.SOCRATOPIA_TTS_PROMPT_TEXT || "茶会是淑女的必修课，如果你想学习茶会礼仪的话，我可以教你哦~";
const gptModelName = process.env.SOCRATOPIA_TTS_GPT_MODEL || "【经典】Funina-e15";
const sovitsModelName = process.env.SOCRATOPIA_TTS_SOVITS_MODEL || "【经典】Funina_e8_s464";

function assertEvent(condition, message) {
  assert(condition, message);
}

async function readNdjson(response, onEvent) {
  const reader = response.body?.getReader();
  assert(reader, "streaming response has no readable body");
  const decoder = new TextDecoder("utf-8");
  const events = [];
  let pending = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    for (;;) {
      const boundary = pending.indexOf("\n");
      if (boundary < 0) break;
      const line = pending.slice(0, boundary);
      pending = pending.slice(boundary + 1);
      if (line.trim()) {
        const event = JSON.parse(line);
        events.push(event);
        onEvent?.(event);
      }
    }
  }

  pending += decoder.decode();
  if (pending.trim()) {
    const event = JSON.parse(pending);
    events.push(event);
    onEvent?.(event);
  }
  return events;
}

async function main() {
  const capabilitiesResponse = await fetch(`${baseUrl}/capabilities`, {
    signal: AbortSignal.timeout(10_000)
  });
  assert.strictEqual(capabilitiesResponse.status, 200, "capabilities endpoint must be available");
  const capabilities = await capabilitiesResponse.json();
  assert.strictEqual(
    capabilities?.tts?.classic_stream?.protocol,
    "classic-stream-ndjson-v1",
    "classic stream protocol capability missing"
  );

  const invalidResponse = await fetch(`${baseUrl}/infer_classic_stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "" }),
    signal: AbortSignal.timeout(10_000)
  });
  assert.strictEqual(invalidResponse.status, 400, "empty text must be rejected before generation");
  const invalidPayload = await invalidResponse.json();
  assert.strictEqual(invalidPayload.code, "empty_text", "empty text rejection code changed");

  const requestStartedAt = Date.now();
  const response = await fetch(`${baseUrl}/infer_classic_stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/x-ndjson"
    },
    body: JSON.stringify({
      version: "v4",
      gpt_model_name: gptModelName,
      sovits_model_name: sovitsModelName,
      ref_audio_path: referenceAudio,
      prompt_text: promptText,
      prompt_text_lang: "中文",
      text: "这是一次经典音色流式语音验收测试。第二句用于验证首个音频片段在完整响应结束前到达。第三句用于验证服务不会等待整个音频完成后再开始发送。第四句用于验证多个音频片段按顺序到达。",
      text_lang: "中英混合",
      speed_facter: 1,
      batch_size: 1,
      media_type: "wav"
    }),
    signal: AbortSignal.timeout(120_000)
  });

  assert.strictEqual(response.status, 200, `stream endpoint failed: ${response.status}`);
  assertEvent(
    (response.headers.get("content-type") || "").includes("application/x-ndjson"),
    "stream response content type is not NDJSON"
  );
  assert.strictEqual(response.headers.get("x-tts-protocol"), "classic-stream-ndjson-v1", "protocol response header missing");

  let firstAudioAt = null;
  const events = await readNdjson(response, event => {
    if (event.type === "audio" && firstAudioAt === null) firstAudioAt = Date.now();
  });
  const totalMs = Date.now() - requestStartedAt;
  assertEvent(events.length >= 3, "stream must emit start, audio, and end events");
  assert.strictEqual(events[0].type, "start", "first event must be start");
  assert.strictEqual(events[0].protocol, "classic-stream-ndjson-v1", "start event protocol mismatch");

  const audioEvents = events.filter(event => event.type === "audio");
  assertEvent(audioEvents.length > 0, "stream produced no audio events");
  assertEvent(firstAudioAt !== null, "first audio receipt time was not recorded");
  const firstAudioMs = firstAudioAt - requestStartedAt;
  assertEvent(firstAudioMs < totalMs, "first audio did not arrive before the stream completed");
  audioEvents.forEach((event, index) => {
    assert.strictEqual(event.seq, index, "audio event sequence is not contiguous");
    assertEvent(typeof event.data === "string" && event.data.length > 0, "audio event has no data");
    const bytes = Buffer.from(event.data, "base64");
    assertEvent(bytes.length > 44, "audio event is too small to be a WAV fragment");
    assert.strictEqual(bytes.subarray(0, 4).toString("ascii"), "RIFF", "audio event is not a self-contained WAV fragment");
  });

  const errorEvent = events.find(event => event.type === "error");
  assertEvent(!errorEvent, `stream emitted an error event: ${errorEvent?.code || "unknown"}`);
  const endEvent = events.at(-1);
  assert.strictEqual(endEvent.type, "end", "last event must be end");
  assert.strictEqual(endEvent.chunks, audioEvents.length, "end event chunk count mismatch");

  console.log(JSON.stringify({
    result: "PASS",
    protocol: events[0].protocol,
    audioChunks: audioEvents.length,
    firstAudioMs,
    totalMs
  }));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
