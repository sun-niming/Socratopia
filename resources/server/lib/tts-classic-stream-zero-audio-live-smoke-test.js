"use strict";

const assert = require("assert");

const baseUrl = process.env.SOCRATOPIA_TTS_BASE_URL || "http://127.0.0.1:8000";

async function readEvents(response) {
  const reader = response.body?.getReader();
  assert(reader, "zero-audio test response has no readable body");
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  const events = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
  }
  pending += decoder.decode();
  if (pending.trim()) events.push(JSON.parse(pending));
  return events;
}

async function main() {
  const response = await fetch(`${baseUrl}/infer_classic_stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/x-ndjson" },
    body: JSON.stringify({
      request_id: "zero-audio-smoke-20260901",
      version: "v4",
      gpt_model_name: "【经典】Funina-e15",
      sovits_model_name: "【经典】Funina_e8_s464",
      ref_audio_path: "./参考音频/芙宁娜参考文本及语音/原神全角色中文语音-枫丹-芙宁娜-闲聊  茶会_爱给网_aigei_com.mp3",
      prompt_text: "茶会是淑女的必修课，如果你想学习茶会礼仪的话，我可以教你哦~",
      prompt_text_lang: "中文",
      text: "---",
      text_lang: "中英混合",
      batch_size: 1,
      media_type: "wav"
    }),
    signal: AbortSignal.timeout(60_000)
  });
  assert.strictEqual(response.status, 200, "zero-audio stream must start with a protocol response");
  const events = await readEvents(response);
  assert.strictEqual(events[0]?.type, "start", "zero-audio stream must begin with start");
  assert(!events.some(event => event.type === "audio"), "pure-symbol input unexpectedly produced audio");
  assert(!events.some(event => event.type === "end"), "zero-audio stream must not report successful end");
  const error = events.find(event => event.type === "error");
  assert(error, "zero-audio stream must emit a structured error");
  assert.strictEqual(error.code, "no_audio_frames", "zero-audio error code changed");
  console.log(JSON.stringify({ result: "PASS", events: events.map(event => event.type), code: error.code }));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
