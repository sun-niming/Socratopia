"use strict";

// Streaming voice: the page releases finished sentences to the narration filter
// while the assistant is still typing, so the first sentence can start playing
// early.  The segmentation must not cut through a narration paragraph.
//
// Narration is written `*青衣……。*` (rules: 旁白一律用单星号斜体，独立成段).  A plain
// sentence split releases `*青衣……。` as soon as the full stop arrives — an
// unterminated emphasis span, which the filter cannot recognise, so the narration
// (and the leftover `*`, as its own fragment) was synthesised and spoken.  The
// splitter therefore holds a fragment back while a stage-direction span opened at
// the start of a line is still open, and both call sites share one helper so the
// streaming release and the completion flush agree.
//
// The behaviour section below runs the *shipped* fragmenter together with the
// *shipped* narration filter, so the assertions see the text that would really be
// handed to the synthesiser, not the presence of a keyword.

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

const HELPER = "__socratopiaSpeechFragments";
const SENTENCE_SPLIT = String.raw`/(?<=[。！？])|(?<=[A-Za-z\u4e00-\u9fff][.!?])\s+|\n\s*\n+/`;
const SENTENCE_SPLIT_SOURCE = String.raw`(?<=[。！？])|(?<=[A-Za-z\u4e00-\u9fff][.!?])\s+|\n\s*\n+`;
const chunkPath = path.join(bundleDir, "..", "4137-131d0676e3b5bef7.js");

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

// --- 1. both call sites segment with the marker-aware helper ------------------------
const helperSources = new Set();

for (const name of bundles) {
  const source = fs.readFileSync(path.join(bundleDir, name), "utf8");
  assert(
    source.includes(`${HELPER}(l,${SENTENCE_SPLIT}),r=Math.max(0,t.length-1)`),
    `${name}: streaming TTS must release complete sentences before the LLM finishes`
  );
  assert(
    source.includes(`${HELPER}(t,${SENTENCE_SPLIT})`),
    `${name}: final flush must use the same sentence segmentation`
  );
  assert(
    !source.includes(`l.split(${SENTENCE_SPLIT}),r=Math.max(0,t.length-1)`),
    `${name}: the sentence split must not run inside an open narration span`
  );
  assert(
    source.split(HELPER).length - 1 === 3,
    `${name}: the fragmenter must be defined once and used only by the two voice call sites (chat display must not depend on it)`
  );
  assert(
    source.includes("a.synthesisChain.then(()=>(0,el.synthesizeStream)"),
    `${name}: next synthesis must start after producer completion, without waiting for prior playback`
  );
  assert(
    source.includes('let t=e[e.length-1]?.content||l||"";'),
    `${name}: completion must prefer the full assistant message over partial typewriter text`
  );
  assert(
    !source.includes("l.split(/\\n\\s*\\n+/),r=Math.max(0,t.length-1)"),
    `${name}: paragraph-only streaming gate must be removed`
  );
  helperSources.add(sliceFunction(source, HELPER));
}

assert.strictEqual(helperSources.size, 1, "every page bundle must carry the same fragmenter");

// --- 2. the shipped fragmenter and the shipped filter, driven like the page ----------
function loadFilter() {
  const chunk = fs.readFileSync(chunkPath, "utf8");
  const end = chunk.indexOf("root.SocratopiaMathSpeechAdapter=adapter;");
  assert(end > 0, "the shipped narration filter is missing from the voice runtime chunk");
  return new Function(chunk.slice(0, chunk.indexOf("})();", end) + 4) + "; return globalThis.SocratopiaMathSpeechAdapter;")();
}

const fragment = new Function(helperSources.values().next().value + "; return " + HELPER + ";")();
const filter = loadFilter();
const SENTENCE_SPLIT_RE = new RegExp(SENTENCE_SPLIT_SOURCE);

// mirror of the page effect: while streaming, everything but the last fragment is
// released; the completed message then flushes whatever is left
function release(full, chunks, flush) {
  const out = [];
  let released = 0;
  let text = "";
  const step = value => {
    const parts = fragment(value, SENTENCE_SPLIT_RE);
    const limit = Math.max(0, parts.length - 1);
    for (let i = released; i < limit; i++) if (parts[i].trim()) out.push(parts[i]);
    released = limit;
  };
  for (const chunk of chunks) { text += chunk; step(text); }
  if (flush === false) return out;
  const parts = fragment(full, SENTENCE_SPLIT_RE);
  for (let i = released; i < parts.length; i++) if (parts[i].trim()) out.push(parts[i]);
  return out;
}

async function synthesisInput(full, chunks) {
  const handed = [];
  for (const piece of release(full, chunks)) {
    const speech = await filter(piece);
    if (speech) handed.push(speech);
  }
  return handed;
}

const NARRATION = "*青衣把那杯放到凉了半截的茶抿了一口，才把笔落回纸上。*";
const DIALOGUE = "\"先生今日讲得好。\"";

(async () => {
  // the reported case: a narration paragraph alone must reach synthesis zero times
  for (const [label, chunks] of [
    ["character by character", [...NARRATION]],
    ["in one delta", [NARRATION]]
  ]) {
    assert.deepStrictEqual(
      await synthesisInput(NARRATION, chunks),
      [],
      "pure narration streamed " + label + " must not be synthesised at all"
    );
  }

  // ... and it must not be released early either: while streaming, a narration span
  // that has not closed yet stays with the filter's next input
  const partial = NARRATION.slice(0, -1);
  assert.deepStrictEqual(
    release(partial, [...partial], false),
    [],
    "an unclosed narration span must not be released while the closing marker is missing"
  );

  // mixed narration and dialogue: only the dialogue survives
  for (const [label, chunks] of [
    ["character by character", [...(NARRATION + "\n\n" + DIALOGUE)]],
    ["in one delta", [NARRATION + "\n\n" + DIALOGUE]]
  ]) {
    const spoken = await synthesisInput(NARRATION + "\n\n" + DIALOGUE, chunks);
    assert.deepStrictEqual(spoken.filter(text => text.includes("青衣")), [], label + ": narration must be filtered out of a mixed message");
    assert(spoken.some(text => text.includes("先生今日讲得好")), label + ": the dialogue in a mixed message must still be spoken");
  }

  // a narration span covering two sentences is still one narration paragraph
  assert.deepStrictEqual(
    await synthesisInput("*青衣点头。她抬起眼。*", [new Array(13).join("x")]),
    [],
    "a narration span holding more than one sentence must be filtered as one paragraph"
  );

  // A stage direction that stresses a word carries a nested span ("**else**", or a bare "*else*"
  // if the model forgets the doubling rule).  Neither the narration filter nor the fragmenter may
  // treat that inner marker as the end of the stage direction: doing so both spoke the narration
  // and posted a lone "*" to the synthesiser.
  const STAGE = "*宵宫把纸条转过来，指尖点在那个";
  const NESTED = [
    ["doubled marker", STAGE + " **else** 上。*"],
    ["bare marker", STAGE + " *else* 上。*"],
    ["underscore marker", "_宵宫把纸条转过来，指尖点在那个 __else__ 上。_"]
  ];
  for (const [label, narration] of NESTED) {
    for (const [mode, chunks] of [["in one delta", [narration + "\n\n" + DIALOGUE]], ["character by character", [...(narration + "\n\n" + DIALOGUE)]]]) {
      const spoken = await synthesisInput(narration + "\n\n" + DIALOGUE, chunks);
      assert.deepStrictEqual(spoken.filter((text) => text.includes("宵宫") || text.includes("*")), [], label + " narration streamed " + mode + " must leave no narration and no lone marker");
      // the splitter may still cut the closing quote off the dialogue; joined, it must be the whole line
      assert.strictEqual(spoken.join(""), DIALOGUE, label + " narration streamed " + mode + " must leave the dialogue intact");
    }
    assert.deepStrictEqual(await synthesisInput(narration, [...narration]), [], label + " narration alone must not be synthesised");
    assert.deepStrictEqual(await synthesisInput(narration, [narration]), [], label + " narration alone in one delta must not be synthesised");
  }

  // emphasis must keep being read: bold is the documented emphasis marker
  assert.deepStrictEqual(
    await synthesisInput("这个道理**非常重要**，你要记住。", ["这个道理**非常重要**，你要记住。"]),
    ["这个道理非常重要，你要记住。"],
    "bold emphasis must still be spoken"
  );
  assert.deepStrictEqual(
    await synthesisInput("这句话里的*重心*在第二个字。", ["这句话里的*重心*在第二个字。"]),
    ["这句话里的重心在第二个字。"],
    "inline italic emphasis inside a sentence must still be spoken"
  );

  // a markdown bullet opening a line is not a narration span
  const bullets = await synthesisInput("* 第一项要点。\n* 第二项要点。", ["* 第一项要点。\n* 第二项要点。"]);
  assert(bullets.some(text => text.includes("第一项要点")), "a bullet list must still be spoken");
  assert(bullets.some(text => text.includes("第二项要点")), "a bullet list must not be swallowed by the span hold");

  // the whitelisted label form stays filtered
  assert.deepStrictEqual(
    await synthesisInput("旁白：青衣把那杯放到凉了半截的茶抿了一口。", ["旁白：青衣把那杯放到凉了半截的茶抿了一口。"]),
    [],
    "an explicit narration label must stay filtered"
  );

  // shapes the stage-direction rule must NOT swallow: a whole-line bold is emphasis in speech,
  // and a span that opens a line but ends inside it is not a stage direction
  assert.deepStrictEqual(
    await synthesisInput("**完全加粗**。", ["**完全加粗**。"]),
    ["完全加粗。"],
    "a whole-line bold is speech, not narration"
  );
  assert.deepStrictEqual(
    await synthesisInput("*重点*在这里。", ["*重点*在这里。"]),
    ["重点在这里。"],
    "a span that starts a line but closes inside it is speech"
  );
  assert.deepStrictEqual(
    await synthesisInput("*青衣点头。*后面还有话。", ["*青衣点头。*后面还有话。"]),
    ["青衣点头。后面还有话。"],
    "a narration span followed by prose on the same line is speech"
  );

  // An ```svg fence orders a figure; its source is drawing instructions, never prose.
  // A blank line inside the fence is common in a drawn diagram, and the paragraph
  // splitter used to cut there — the tail half no longer *opens* with the fence, so
  // the adapter saw ordinary text and read `  <text ...>main()</text>` aloud.  The
  // splitter now holds the cut while a fence is still open, so no released fragment
  // can carry fence source without carrying the fence that marks it silent.
  const SVG_BODY = [
    '<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">',
    '  <rect x="20" y="40" width="120" height="40" fill="#eef"/>',
    "",
    '  <text x="30" y="66">main()</text>',
    "</svg>"
  ].join("\n");
  const FIGURE_REPLY = "把 $I_0$ 和它的 $*$ 边画出来就是：\n\n```svg\n<!-- title: GOTO 状态 -->\n" + SVG_BODY + "\n```\n\n换你走一步。";

  for (const [label, chunks] of [
    ["in one delta", [FIGURE_REPLY]],
    ["character by character", [...FIGURE_REPLY]]
  ]) {
    const spoken = await synthesisInput(FIGURE_REPLY, chunks);
    const leaked = spoken.filter((text) => /<svg|viewBox|<rect|<text|<\/svg>|```|--- title:/.test(text));
    assert.deepStrictEqual(leaked, [], label + ": svg fence source must never reach the synthesiser");
    assert(spoken.some((text) => text.includes("换你走一步")), label + ": the prose after the figure must still be spoken");
  }

  // the fragmenter, not luck: an open fence must hold the cut at a blank line too
  const fenceParts = fragment("前言。\n\n```svg\n" + SVG_BODY + "\n```\n\n收尾。", SENTENCE_SPLIT_RE);
  for (const piece of fenceParts) {
    const ticks = (piece.match(/```/g) || []).length;
    assert.strictEqual(ticks % 2, 0, "every released fragment must be fence-balanced: " + JSON.stringify(piece.slice(0, 60)));
  }
  assert.strictEqual(
    fenceParts.filter((piece) => /<text|<\/svg>/.test(piece)).length,
    1,
    "the whole fence must stay in one fragment"
  );

  console.log(JSON.stringify({
    result: "PASS",
    bundles: bundles.length,
    helper: "single",
    narrationSynthesis: 0,
    mixedDialogueSpoken: true,
    emphasisSpoken: true,
    svgFenceSpoken: 0
  }, null, 2));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
