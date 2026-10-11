"use strict";

// Table announcement: a markdown table in a tutor reply must not be read cell by cell.
// The adapter replaces the whole block with one short sentence and publishes the reading
// budget as `pauseAfterMs`, and the page holds the next fragment back for exactly that long.
//
// Two invariants matter and both are asserted against the *shipped* code, not a copy:
//   1. the spoken number and the real pause come from one calculation, so they cannot disagree;
//   2. nothing inside the table reaches /api/math-speech, which is the actual win — the previous
//      behaviour converted every `$id_1 * id_2$` cell through a round trip.
//
// Wiring checks (fragment 3) are structural: the chain is minified, so the pause bookkeeping is
// read from the bundles and `__socratopiaSpeechCall` is executed for its pause forwarding.

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

// --- the shipped adapter, loaded exactly as the page loads it -------------------------
function loadAdapter() {
  const chunk = fs.readFileSync(chunkPath, "utf8");
  const end = chunk.indexOf("root.SocratopiaMathSpeechAdapter=adapter;");
  assert(end > 0, "the shipped adapter is missing from the voice runtime chunk");
  return new Function(chunk.slice(0, chunk.indexOf("})();", end) + 4) + "; return globalThis.SocratopiaMathSpeechAdapter;")();
}

const adapter = loadAdapter();

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls++;
  return { ok: true, json: async () => ({ ok: true, segments: [{ type: "text", value: "x" }] }) };
};

const HEAD = "| \u6700\u53f3\u53e5\u578b | \u53e5\u67c4 | \u5f52\u7ea6\u7528\u7684\u4ea7\u751f\u5f0f |\n| --- | --- | --- |\n";
const ROWS = [
  "| $id_1 * id_2$ | $id_1$ | $F \\to id$ |",
  "| $F * id_2$ | $F$ | $T \\to F$ |",
  "| $T * id_2$ | $id_2$ | $F \\to id$ |",
  "| $T * F$ | $T * F$ | $T \\to T * F$ |",
  "| $T$ | $T$ | $E \\to T$ |"
].join("\n");
const TABLE_18 = HEAD + ROWS + "\n";
const SMALL = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
const WIDE = "| a | b | c | d | e |\n| --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 |\n| 6 | 7 | 8 | 9 | 10 |\n";

(async () => {
  // --- 1. the reported table: announced, and its formulas never leave the page ---------
  for (const [label, lead, expected] of [
    ["neutral lead-in", "\u5148\u8bb0\u4f4f\u8fd9\u4e2a\u89c4\u5f8b\uff1a\n\n", "\u7ed9\u4f60\u5341\u4e94\u79d2\uff0c\u5148\u770b\u8fd9\u5f20\u8868\u3002"],
    ["lead-in already named the table", "\u4e09\u79cd\u5f52\u7ea6\u7684\u4ea7\u751f\u5f0f\u5982\u4e0b\uff1a\n\n", "\u7ed9\u4f60\u5341\u4e94\u79d2\u3002"]
  ]) {
    fetchCalls = 0;
    const result = await adapter.adapt(lead + TABLE_18, { locale: "zh-Hans" });
    assert(result.text.endsWith(expected), label + ": table sentence is " + JSON.stringify(result.text));
    assert.strictEqual(result.pauseAfterMs, 15000, label + ": 6x3 = 18 cells must map to fifteen seconds");
    assert.strictEqual(fetchCalls, 0, label + ": a table must not cost an /api/math-speech round trip");
    assert.strictEqual(result.stats.math, 0, label + ": no cell formula may be parsed as math");
    assert.strictEqual(result.stats.tables, 1, label + ": exactly one table must be announced");
  }

  // --- 2. the reading budget is bucketed by cells, then capped ------------------------
  const budget = async (markdown) => (await adapter.adapt(markdown, { locale: "zh-Hans" })).pauseAfterMs;
  assert.strictEqual(await budget(TABLE_18), 15000, "13-24 cells -> fifteen seconds");
  assert.strictEqual(await budget(WIDE), 20000, "a five-column table steps one bucket up");
  assert.strictEqual(await budget("| a | b |\n| --- | --- |\n| 1 | 2 |\n"), 0, "six cells or fewer stay read aloud");
  assert.strictEqual(
    await budget("| a | b | c |\n| --- | --- | --- |\n" + "| 1 | 2 | 3 |\n".repeat(8)),
    20000,
    "twenty seconds is the cap"
  );
  // two tables normally land in two fragments (the splitter breaks on a blank line), so each
  // carries its own wait; when one fragment does hold both, the longer budget wins
  const twoTables = adapter.parseMarkdown(TABLE_18 + "\n" + TABLE_18);
  assert.deepStrictEqual(
    twoTables.segments.filter((segment) => segment.table).map((segment) => segment.tablePauseMs),
    [15000, 10000],
    "a second table in the same message steps one bucket down"
  );
  assert.strictEqual(
    (await adapter.adapt(TABLE_18 + "\n" + TABLE_18, { locale: "zh-Hans" })).pauseAfterMs,
    15000,
    "one fragment holding two tables waits for the longer one"
  );
  for (const markdown of [TABLE_18, WIDE]) {
    const seconds = await budget(markdown);
    assert(seconds % 5000 === 0 && seconds <= 20000, "every budget must be a whole 5s step under the cap");
  }

  // --- 3. detection: the shape, not the pipes ------------------------------------------
  const notATable = await adapter.adapt("|a|b| \u4e0d\u662f\u8868\u683c\n\n\u6b63\u6587\u3002\n", { locale: "zh-Hans" });
  assert.strictEqual(notATable.pauseAfterMs, 0, "a pipe without a delimiter row is not a table");

  const formulaFirst = await adapter.adapt("| $id_1 * id_2$ | \u53e5\u67c4 |\n| --- | --- |\n" + "| $F$ | $T$ |\n".repeat(4), { locale: "zh-Hans" });
  assert(formulaFirst.text.includes("\u79d2"), "a table whose first cell is a formula must still be detected");
  assert.strictEqual(formulaFirst.stats.math, 0, "its cells must still skip the math round trip");

  const parsed = adapter.parseMarkdown(TABLE_18);
  const tableSegment = parsed.segments.find((segment) => segment.protected === "markdown-table");
  assert(tableSegment, "the table must be one protected segment");
  assert.deepStrictEqual(tableSegment.table, { rows: 6, cols: 3, cells: 18 }, "shape is rows x cols including the header");
  assert.strictEqual(tableSegment.tablePauseMs, 15000, "the segment carries its own budget");

  // ordinary markdown must be untouched by the new reader
  const plain = await adapter.adapt("\u666e\u901a\u4e00\u53e5\u3002\n\n- \u9879\u4e00\n- \u9879\u4e8c\n", { locale: "zh-Hans" });
  assert.strictEqual(plain.pauseAfterMs, 0, "a bullet list is not a table");
  assert(plain.text.includes("\u666e\u901a\u4e00\u53e5"), "prose must pass through unchanged");

  // --- 4. bundle wiring: the page applies the published pause ------------------------
  const WIRING = [
    ["a.pendingPauseMs=Math.max(a.pendingPauseMs,a.batchPauseMs||0),a.batchPauseMs=__p;",
      ": a batch stores its own pause and installs the previous one, so the gap lands after the sentence"],
    ["let __x=Math.max(i.pendingPauseMs||0,i.batchPauseMs||0);i.pendingPauseMs=0,i.batchPauseMs=0;",
      ": a trailing table must still get its wait when no later fragment consumes the pause"],
    [".adapt(e,t)", ": the object form of the adapter must be used to read pauseAfterMs"]
  ];

  function assertWiring(dir, label) {
    for (const name of bundles) {
      const source = fs.readFileSync(path.join(dir, name), "utf8");
      assert.strictEqual(source.split("function __socratopiaSpeechCall(").length - 1, 1, label + name + ": pause forwarding helper must exist once");
      for (const [needle, why] of WIRING) assert(source.includes(needle), label + name + why);
      assert(!source.includes("?globalThis.SocratopiaMathSpeechAdapter(e,{"), label + name + ": the string-returning call form must be gone");
      assert.strictEqual(source.split("__socratopiaSpeechFragments").length - 1, 3, label + name + ": the fragmenter contract must not change");
    }
  }

  assertWiring(bundleDir, "");

  // the committed win-unpacked snapshot must not drift; it is a separate build variant, so the
  // adapter head is compared against its own copy rather than against this tree's
  const snapshotDir = path.join(bundleDir, "..", "..", "..", "..", "..", "..", "win-unpacked", "resources", "server", ".next", "static", "chunks", "app");
  let snapshotChecked = false;
  if (fs.existsSync(snapshotDir)) {
    snapshotChecked = true;
    assertWiring(snapshotDir, "win-unpacked/");
    for (const dir of [path.join(bundleDir, ".."), path.join(snapshotDir, "..")]) {
      const chunk = fs.readFileSync(path.join(dir, "4137-131d0676e3b5bef7.js"), "utf8");
      const own = fs.readFileSync(path.join(dir, "math-speech-adapter.js"), "utf8");
      const marker = chunk.indexOf('console.log("[DETECT-4137]');
      assert(marker > 0, dir + ": chunk marker missing");
      assert.strictEqual(chunk.slice(0, marker).replace(/\s+$/, ""), own.replace(/\s+$/, ""), dir + ": the chunk head must stay identical to its adapter file");
      assert(chunk.includes("TABLE_SECONDS_CN"), dir + ": the snapshot adapter must carry the table patch");
    }
  }

  // the shipped helper forwards the budget and tolerates both adapter shapes
  const helperSource = sliceFunction(fs.readFileSync(path.join(bundleDir, bundles[0]), "utf8"), "__socratopiaSpeechCall");
  const speechCall = new Function("globalThis", helperSource + "; return __socratopiaSpeechCall;")(globalThis);

  // --- 5. ordering: the gap must land *after* the announcement, never before it -------
  // The shipped statements that move the budget through the chain are lifted out of the bundle
  // verbatim, so an off-by-one batch in the bookkeeping cannot hide behind a re-implementation.
  const first = fs.readFileSync(path.join(bundleDir, bundles[0]), "utf8");
  const installSource = "a.pendingPauseMs=Math.max(a.pendingPauseMs,a.batchPauseMs||0),a.batchPauseMs=__p;";
  const consumeShipped = "let t=a.hasPlayedAny?(a.pendingPauseMs>0?a.pendingPauseMs:1500):0;a.pendingPauseMs=0,a.hasPlayedAny=!0;";
  const tailShipped = "let __x=Math.max(i.pendingPauseMs||0,i.batchPauseMs||0);i.pendingPauseMs=0,i.batchPauseMs=0;";
  for (const [label, source] of [["install", installSource], ["consume", consumeShipped], ["tail", tailShipped]]) {
    assert(first.includes(source), "the shipped " + label + " statement changed: " + source);
  }
  const install = new Function("a", "__p", installSource);
  const consume = new Function("a", consumeShipped + "return t;");
  const tail = new Function("i", tailShipped + "return __x;");

  const track = { hasPlayedAny: false, pendingPauseMs: 0 };
  const gaps = [];
  for (const pause of [0, 15000, 0]) { install(track, pause); gaps.push(consume(track)); }
  assert.strictEqual(gaps[2], 15000, "fifteen seconds must sit between the announcement and the next sentence, got " + JSON.stringify(gaps));

  const trailing = { hasPlayedAny: true, pendingPauseMs: 0 };
  install(trailing, 15000);
  consume(trailing);
  assert.strictEqual(tail(trailing), 15000, "a table closing the message must still be waited for");

  const consumed = { hasPlayedAny: true, pendingPauseMs: 0 };
  install(consumed, 15000);
  install(consumed, 0);
  assert.strictEqual(consume(consumed), 15000, "the following fragment must actually take the wait");
  assert.strictEqual(tail(consumed), 0, "and nothing may be left over once it was taken");


  globalThis.SocratopiaMathSpeechAdapter = { adapt: async () => ({ text: "\u7ed9\u4f60\u5341\u4e94\u79d2\u3002", pauseAfterMs: 15000 }) };
  assert.deepStrictEqual(await speechCall("x", {}), { text: "\u7ed9\u4f60\u5341\u4e94\u79d2\u3002", pauseAfterMs: 15000 }, "the budget must survive the helper");
  globalThis.SocratopiaMathSpeechAdapter = { adapt: async () => "\u7eaf\u5b57\u7b26\u4e32" };
  assert.deepStrictEqual(await speechCall("x", {}), { text: "\u7eaf\u5b57\u7b26\u4e32", pauseAfterMs: 0 }, "a string result means no pause");
  globalThis.SocratopiaMathSpeechAdapter = undefined;
  assert.deepStrictEqual(await speechCall("x", {}), { text: "", pauseAfterMs: 0 }, "a missing adapter must not throw");

  console.log(JSON.stringify({
    result: "PASS",
    bundles: bundles.length,
    snapshotChecked: snapshotChecked,
    tableCells: tableSegment.table.cells,
    announcedSeconds: tableSegment.tablePauseMs / 1000,
    mathRoundTripsForTable: 0,
    gapAfterAnnouncementMs: gaps[2],
    budgets: { "18 cells": 15000, "wide 3x5": 20000, "<=6 cells": 0, "second table": 10000, cap: 20000 }
  }, null, 2));
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
