"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const serverRoot = path.resolve(__dirname, "..", ".next", "server");
const definers = [
  "chunks/4092.js", "chunks/1576.js", "app/api/concept-summary/route.js",
  "app/api/flashcard/route.js", "app/api/companion/reconcile-persona/route.js",
  "app/api/custom-companions/merge-persona/route.js"
];
function instantiate(relative) {
  const exported = {};
  require(path.join(serverRoot, relative)).modules[64092]({}, exported, {
    d(target, getters) {
      for (const [key, getter] of Object.entries(getters)) Object.defineProperty(target, key, { get: getter });
    }
  });
  return exported.callLLM;
}
async function main() {
  const originalFetch = global.fetch;
  const originalSettings = global.__SOCRATOPIA_SETTINGS__;
  global.__SOCRATOPIA_SETTINGS__ = {};
  let finishReason = "length";
  let status = 200;
  global.fetch = async () => new Response(JSON.stringify(status === 200 ? {
    choices: [{ message: { content: "synthetic report" }, finish_reason: finishReason }],
    usage: { completion_tokens: 8192 }
  } : { error: { message: "synthetic rate limit" } }), { status, headers: { "Content-Type": "application/json" } });
  const input = { provider: "gpt", apiKey: "test-only", baseURL: "http://mock.invalid/v1", model: "mock-model", messages: [], systemPrompt: "test", purpose: "end-class" };
  try {
    const chatSource = fs.readFileSync(path.join(serverRoot, "app/api/chat/route.js"), "utf8");
    const helperStart = chatSource.indexOf('async function k(a,b,c,d,e,f,h,i="end-class")');
    const helperEnd = chatSource.indexOf('d()}catch(a){d(a)}})},21820:', helperStart);
    assert(helperStart >= 0 && helperEnd > helperStart);
    const helper = vm.runInNewContext("(" + chatSource.slice(helperStart, helperEnd) + ")", {
      g: { callLLM: options => options }, global: { __SOCRATOPIA_SET__: { strong: { model: "deepseek-test" } } }
    });
    const endOptions = await helper("test-only", "", "", "prompt", [], {}, undefined);
    assert.strictEqual(endOptions.maxTokens, 8192);
    assert.strictEqual(endOptions.thinking, false);
    const summaryOptions = await helper("test-only", "", "", "prompt", [], {}, undefined, "summary");
    assert.strictEqual(summaryOptions.maxTokens, undefined);
    assert.strictEqual(summaryOptions.thinking, undefined);
    console.log("PASS end-class-only output budget and thinking options");
    for (const relative of definers.slice(0, 2)) {
      const call = instantiate(relative);
      finishReason = "length";
      await assert.rejects(call(input), error => error.code === "END_CLASS_OUTPUT_TRUNCATED");
      console.log("PASS " + relative + " rejects provider truncation");
      assert.strictEqual(await call({ ...input, purpose: "summary" }), "synthetic report", "other callers retain their behavior");
      finishReason = "stop";
      assert.strictEqual(await call(input), "synthetic report");
      finishReason = undefined;
      assert.strictEqual(await call(input), "synthetic report", "legacy providers may omit finish_reason");
      status = 429;
      finishReason = "length";
      // Older definers return empty text for HTTP errors; preserve that existing
      // behavior, but never misclassify an HTTP error as output truncation.
      await call(input).catch(error => assert.notStrictEqual(error.code, "END_CLASS_OUTPUT_TRUNCATED"));
      status = 200;
    }
    for (const relative of definers) {
      assert(fs.readFileSync(path.join(serverRoot, relative), "utf8").includes('code="END_CLASS_OUTPUT_TRUNCATED"'), relative + " must carry truncation detection");
    }
    console.log("end-class LLM smoke: PASS (two live module definitions, all six synchronized)");
  } finally {
    global.fetch = originalFetch;
    global.__SOCRATOPIA_SETTINGS__ = originalSettings;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
