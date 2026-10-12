// figure-box-smoke-test.js — the p173 case, reproduced.
"use strict";
const assert = require("assert");
const lib = require("./figure-box.js");

const results = [];
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    function () { results.push(true); console.log("  PASS  " + name); },
    function (e) { results.push(false); console.log("  FAIL  " + name + "\n        " + e.message); });
}

// A page shaped like KUyw p173: text column on the left, the figure on the right with its
// caption underneath, then three lines of body copy under the caption.
function page() {
  const lines = [
    { text: "在第2行中", box: [0.06, 0.10, 0.94, 0.118] },
    { text: "图 4-33 规范 LR(0) 项集族的计算", box: [0.55, 0.34, 0.78, 0.358] },
    { text: "平，手指", box: [0.03, 0.42, 0.50, 0.438] },
    { text: "里点正对着", box: [0.03, 0.455, 0.50, 0.473] },
    { text: "$F", box: [0.56, 0.60, 0.60, 0.618] },
    { text: "* id $", box: [0.68, 0.60, 0.74, 0.618] },
    { text: "按照 T -> F 归约", box: [0.80, 0.60, 0.95, 0.618] },
    { text: "$E", box: [0.56, 0.68, 0.60, 0.698] },
    { text: "$", box: [0.68, 0.68, 0.70, 0.698] },
    { text: "接受", box: [0.80, 0.68, 0.86, 0.698] },
    { text: "图 4-34 id * id 的语法分析", box: [0.55, 0.735, 0.75, 0.753] },
    { text: "输入 * 上的转换，因此我们选择归约。", box: [0.05, 0.775, 0.95, 0.793] },
    { text: "过将相应产生式的体，产生式的", box: [0.05, 0.805, 0.95, 0.823] },
    { text: "面入栈中来实现。现在栈中保存的是状态，", box: [0.05, 0.835, 0.95, 0.853] },
  ];
  return lines;
}

// Ink: the figure covers the right side; the first tenth of the rough width is the text sliver.
function ink(rect) {
  // Above the figure's top (0.60) the page is blank, which is what stops the upward walk.
  const blank = Array.isArray(rect) && rect[3] <= 0.605;
  return {
    colCoverage: [0.12, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.9, 0.9],
    rowCoverage: blank ? [0, 0, 0, 0, 0, 0] : [0.05, 0.8, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
  };
}

(async function main() {
  await test("findCaption picks the caption the alt text names", function () {
    const found = lib.findCaption(page(), "图 4-34 id*id 的语法分析");
    assert.ok(found, "must find a caption");
    assert.strictEqual(lib.captionLabel(found.line), "图 4-34");
    assert.strictEqual(lib.findCaption(page(), "表 9-9 x"), null, "unknown label -> null");
  });

  await test("findCaption without a hint takes the lowest caption on the page", function () {
    const found = lib.findCaption(page(), "");
    assert.strictEqual(lib.captionLabel(found.line), "图 4-34");
  });

  await test("a rough vision box is snapped to the caption and the figure columns", function () {
    const rough = [0.548, 0.573, 0.962, 0.815]; // the real, visibly wrong box
    const out = lib.snapBox({ lines: page(), hint: "图 4-34 id*id 的语法分析", rough: rough, ink: ink });
    assert.strictEqual(out.reason, "snapped");
    assert.strictEqual(out.caption, "图 4-34");
    const [x0, y0, x1, y1] = out.rect;
    assert.ok(y1 <= 0.766 && y1 >= 0.75, "bottom must sit on the caption, not in the body copy: " + y1);
    assert.ok(x0 > 0.56, "left edge must clear the neighbouring text column: " + x0);
    assert.ok(x1 > 0.9, "right edge keeps the figure: " + x1);
    assert.ok(y0 >= 0.57 && y0 <= 0.615, "top sits on the figure's first tight line: " + y0);
  });

  await test("without a rough box the caption decides, bounded by the previous caption", function () {
    const out = lib.snapBox({ lines: page(), hint: "图 4-34 id*id 的语法分析" });
    assert.strictEqual(out.reason, "geometry");
    const [x0, y0, x1, y1] = out.rect;
    assert.ok(y0 >= 0.57 && y0 <= 0.615, "top stops at the gap above the figure: " + y0);
    assert.ok(y1 <= 0.766 && y1 >= 0.75, "bottom on the caption: " + y1);
    assert.ok(Math.abs(x0 - 0.55) < 0.03, "starts at the caption column: " + x0);
    assert.ok(x1 > 0.9, "keeps the figure width: " + x1);
  });

  await test("a greedy rough top is pulled down to the figure", function () {
    const out = lib.snapBox({ lines: page(), hint: "图 4-34", rough: [0.5, 0.1, 0.9, 0.8] });
    assert.ok(out.rect[1] >= 0.57 && out.rect[1] <= 0.615, "a greedy rough top is pulled to the figure: " + out.rect[1]);
  });

  await test("degenerate inputs degrade instead of throwing", function () {
    assert.strictEqual(lib.snapBox({ lines: [] }).reason, "no_lines");
    assert.strictEqual(lib.snapBox({ lines: [{ text: "纯正文", box: [0.1, 0.1, 0.9, 0.2] }] }).reason, "no_caption");
    // a caption with no room above it
    const tight = [{ text: "图 1-1 x", box: [0.1, 0.03, 0.4, 0.05] }];
    const out = lib.snapBox({ lines: tight, hint: "图 1-1" });
    assert.ok(out.rect === null || out.rect[1] >= 0, JSON.stringify(out));
  });

  await test("sane() rejects slivers and whole pages", function () {
    assert.strictEqual(lib.sane([0.5, 0.2, 0.55, 0.8]), null);
    assert.strictEqual(lib.sane([0, 0, 1, 1]), null);
    assert.deepStrictEqual(lib.sane([0.1, 0.2, 0.9, 0.6]), [0.1, 0.2, 0.9, 0.6]);
  });

  const passed = results.filter(Boolean).length;
  console.log("\nfigure-box: " + passed + " passed, " + (results.length - passed) + " failed");
  if (passed !== results.length) process.exit(1);
})();
