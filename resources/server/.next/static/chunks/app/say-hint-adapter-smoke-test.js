"use strict";

// Client half of 【内联朗读标注 v1】: a `speech_hint` published by the server must reach the
// shipped adapter as an exact per-fragment anchor lookup, and a hit must skip the
// /api/math-speech round trip entirely.
//
// Runs the *shipped* adapter (cut out of the 4137 chunk) and the *shipped* hint helper (cut out
// of the page bundles), so the assertions see the real code, not a paraphrase of it.
//
// Run: node resources/server/.next/static/chunks/app/say-hint-adapter-smoke-test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const bundleDir = __dirname;
const bundles = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
];
const chunkPath = path.join(bundleDir, "..", "4137-131d0676e3b5bef7.js");
const standaloneAdapterPath = path.join(bundleDir, "..", "math-speech-adapter.js");

function sliceFunction(source, name) {
  const from = source.indexOf("function " + name + "(");
  assert(from >= 0, name + ": helper missing from the bundle");
  let depth = 0;
  for (let i = source.indexOf("{", from); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) return source.slice(from, i + 1); }
  }
  assert.fail(name + ": helper is not terminated");
}

const chunk = fs.readFileSync(chunkPath, "utf8");
const standalone = fs.readFileSync(standaloneAdapterPath, "utf8");

// --- 1. one adapter, two copies, byte-identical ---------------------------------------
assert(
  chunk.startsWith(standalone),
  "the 4137 chunk must embed the standalone adapter verbatim at its head"
);

function loadAdapter(env) {
  const end = chunk.indexOf("root.SocratopiaMathSpeechAdapter=adapter;");
  const code = chunk.slice(0, chunk.indexOf("})();", end) + 4);
  return new Function("globalThis", code + "; return globalThis.SocratopiaMathSpeechAdapter;")(env);
}

function makeEnv(fetches) {
  return {
    fetch(url, options) {
      fetches.push({ url: url, body: JSON.parse(options.body) });
      return Promise.resolve({
        ok: true,
        json() {
          return Promise.resolve({
            ok: true,
            segments: JSON.parse(options.body).segments.map(segment => (
              segment.type === "math" ? { type: "math", latex: segment.latex, ok: true, speech: "确定性读法" } : { type: "text", value: segment.value }
            ))
          });
        }
      });
    },
    AbortController: typeof AbortController === "function" ? AbortController : undefined,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };
}

(async () => {
  // --- 2. a hint is used verbatim and costs no request -------------------------------
  {
    const fetches = [];
    const adapter = loadAdapter(makeEnv(fetches));
    const input = "$P(A|B)$ 表示条件概率。";
    const result = await adapter.adapt(input, {
      hints: end => (end === "$P(A|B)$".length ? "p 条件下 a 的概率" : null)
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.text, "p 条件下 a 的概率 表示条件概率。", "the model's own reading must be spoken");
    assert.strictEqual(fetches.length, 0, "a hinted formula must not be sent to /api/math-speech");
    assert.strictEqual(result.diagnostics.hintApplied, 1);
    const math = result.segments.find(segment => segment.type === "math");
    assert.strictEqual(math.hintApplied, true, "the applied hint must be visible on the segment");
    assert.strictEqual(math.ok, true);
    assert.strictEqual(math.fallback, false);
    assert.strictEqual(math.latex, "P(A|B)", "the raw formula must survive for display");
  }

  // --- 3. an unhinted formula keeps the deterministic pipeline ------------------------
  {
    const fetches = [];
    const adapter = loadAdapter(makeEnv(fetches));
    const result = await adapter.adapt("$x^2$ 加一。", { hints: () => null });
    assert.strictEqual(fetches.length, 1, "an unhinted formula must still be converted by the route");
    assert.strictEqual(result.text, "确定性读法 加一。");
    assert.strictEqual(result.diagnostics.hintApplied, 0);
  }

  // --- 4. mixed: only the hinted formula is skipped in the request ---------------------
  {
    const fetches = [];
    const adapter = loadAdapter(makeEnv(fetches));
    const result = await adapter.adapt("先看 $P(A|B)$，再看 $x^2$。", {
      hints: end => (end === "先看 $P(A|B)$".length ? "p 条件下 a 的概率" : null)
    });
    assert.strictEqual(fetches.length, 1);
    assert.deepStrictEqual(
      fetches[0].body.segments.filter(s => s.type === "math").map(s => s.latex),
      ["x^2"],
      "only the unhinted formula must be requested"
    );
    assert.strictEqual(result.text, "先看 p 条件下 a 的概率，再看 确定性读法。");
    assert.strictEqual(result.diagnostics.hintApplied, 1);
  }

  // --- 5. no hints at all is byte-identical to the previous behaviour ------------------
  {
    const withNull = await loadAdapter(makeEnv([])).adapt("$x^2$ 加一。", { hints: null });
    const without = await loadAdapter(makeEnv([])).adapt("$x^2$ 加一。", {});
    assert.strictEqual(withNull.text, without.text);
    assert.strictEqual(withNull.diagnostics.hintApplied, 0);
    assert.strictEqual(without.diagnostics.hintApplied, 0);
  }

  // --- 6. a throwing lookup degrades instead of breaking the sentence ------------------
  {
    const fetches = [];
    const adapter = loadAdapter(makeEnv(fetches));
    const result = await adapter.adapt("$x$ 加一。", {
      hints: () => { throw new Error("bridge exploded"); }
    });
    assert.strictEqual(result.text, "确定性读法 加一。");
    assert.strictEqual(fetches.length, 1, "a broken bridge must fall back to the route");
  }

  // --- 6b. a hint carrying markdown markers is cleaned like any other spoken text -----------
  {
    const fetches = [];
    const adapter = loadAdapter(makeEnv(fetches));
    const result = await adapter.adapt("$P(A|B)$ 表示条件概率。", {
      hints: end => (end === "$P(A|B)$".length ? "**p 条件下 a 的概率**" : null)
    });
    assert.strictEqual(result.text, "p 条件下 a 的概率 表示条件概率。", "asterisks must not be spoken");
    assert.strictEqual(fetches.length, 0);
    // A hint that cleans down to nothing must still be spoken verbatim, not dropped.
    const raw = await loadAdapter(makeEnv([])).adapt("$x$ 加一。", { hints: () => "**" });
    assert.strictEqual(raw.text, "** 加一。");
  }

  // --- 7. every page bundle carries the same plumbing ---------------------------------
  const helperSources = new Set();
  for (const name of bundles) {
    const source = fs.readFileSync(path.join(bundleDir, name), "utf8");
    assert(
      source.includes('else if("speech_hint"===t.type){_voiceHints.push(t),globalThis.__SocratopiaLiveSpeechHints__={conversationId:r||null,messageId:s&&s.id||null,hints:_voiceHints}}'),
      name + ": the turn must collect speech_hint events in the ordered SSE handler"
    );
    assert(
      source.includes("hints:__socratopiaHintLookup(__socratopiaSpeechOffset,a.trackId)"),
      name + ": the adapter must receive the fragment's absolute offset and the turn's id"
    );
    assert.strictEqual(
      source.split("__socratopiaFragmentOffset(t,e)),__socratopiaFragmentOffset(t,e))").length - 1,
      1,
      name + ": the streamed fragment must hand its own offset to the synthesiser"
    );
    assert.strictEqual(
      source.split("__socratopiaFragmentOffset(e,t)),__socratopiaFragmentOffset(e,t))").length - 1,
      1,
      name + ": the final flush must hand its own offset too"
    );
    assert.strictEqual(
      source.split("function __socratopiaHintLookup(").length - 1,
      source.split("function __socratopiaSpeakMessage(").length - 1,
      name + ": every copy of the injected helper block must carry the lookup"
    );
    helperSources.add(sliceFunction(source, "__socratopiaHintLookup"));
  }
  assert.strictEqual(helperSources.size, 1, "the five page bundles must carry the same lookup");

  // --- 8. the shipped lookup resolves an anchor exactly --------------------------------
  const lookup = new Function(
    "globalThis",
    helperSources.values().next().value + "; return __socratopiaHintLookup;"
  );
  // Resolve one anchor the way the adapter would: bridge in the global, the fragment's absolute
  // offset and the track id that has to match the turn the bridge was published for, then the
  // formula's own end offset inside that fragment.
  const resolve = (bridge, offset, localEnd, trackId) => {
    const fn = lookup({ __SocratopiaLiveSpeechHints__: bridge })(offset, trackId === undefined ? "msg-1" : trackId);
    return typeof fn === "function" ? fn(localEnd) : null;
  };
  {
    const bridge = {
      conversationId: "conv-1",
      messageId: "msg-1",
      hints: [{ anchorEnd: 8, speech: "p 条件下 a 的概率" }, { anchorEnd: 30, speech: "第二个" }]
    };
    assert.strictEqual(resolve(bridge, 0, 8), "p 条件下 a 的概率", "the anchor must resolve inside its fragment");
    assert.strictEqual(resolve(bridge, 0, 30), "第二个");
    assert.strictEqual(resolve(bridge, 5, 3), "p 条件下 a 的概率", "the fragment base must be subtracted");
    assert.strictEqual(resolve(bridge, 0, 9), null, "an off-by-one anchor must not match");
    assert.strictEqual(resolve(bridge, 0, 0), null);

    // A stale bridge from the previous turn must not leak into this one.
    assert.strictEqual(resolve(bridge, 0, 8, "msg-2"), null);
    // A turn that published nothing has no lookup at all.
    assert.strictEqual(resolve(undefined, 0, 8), null);
    // An unknown track id still resolves: the bridge is the best information available.
    assert.strictEqual(resolve(bridge, 0, 8, ""), "p 条件下 a 的概率");
    // A non-numeric offset must not match by accident.
    assert.strictEqual(resolve(bridge, void 0, 8), null);
  }

  console.log(JSON.stringify({
    result: "PASS",
    bundles: bundles.length,
    adapterParity: true,
    hintedFetchSkipped: true,
    mixedRequestSegments: 1,
    helperCopiesPerBundle: fs.readFileSync(path.join(bundleDir, bundles[0]), "utf8").split("function __socratopiaHintLookup(").length - 1
  }, null, 2));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
