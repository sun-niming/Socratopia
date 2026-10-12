// figure-geometry-smoke-test.js — the locate path with no vision call at all.
"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const ink = require("./figure-ink.js");
const pageLines = require("./page-lines.js");

const results = [];
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    function () { results.push(true); console.log("  PASS  " + name); },
    function (e) { results.push(false); console.log("  FAIL  " + name + "\n        " + e.message); });
}

// A 40x60 page: dark block on the right two thirds, blank left margin, blank rows on top.
function fakeDecoder(columns, rows) {
  return function () {
    const raw = Buffer.alloc(columns * rows, 255);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const dark = y > rows * 0.2 && x > columns * 0.4;
        raw[y * columns + x] = dark ? 20 : 250;
      }
    }
    return raw;
  };
}

(async function main() {
  await test("ink() reports column and row coverage for a rect", async function () {
    const made = await ink.createInk(Buffer.from("x"), { decoder: fakeDecoder(96, 132) });
    assert.ok(made, "grid builds");
    const inside = made.ink([0.0, 0.0, 1.0, 1.0]);
    assert.strictEqual(inside.colCoverage.length, 96);
    assert.strictEqual(inside.rowCoverage.length, 132);
    assert.ok(inside.colCoverage[0] < 0.1, "left margin is blank: " + inside.colCoverage[0]);
    assert.ok(inside.colCoverage[95] > 0.7, "right side is ink: " + inside.colCoverage[95]);
    assert.ok(inside.rowCoverage[0] < 0.1, "top rows are blank");
    assert.ok(inside.rowCoverage[130] > 0.5, "bottom rows are ink");
  });

  await test("a missing decoder result degrades to null", async function () {
    assert.strictEqual(await ink.createInk(Buffer.from("x"), { decoder: function () { return null; } }), null);
  });

  await test("pageLines finds the newest cached entry for the page", async function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-lines-"));
    try {
      const dir = path.join(root, ".system", "ocr-cache-v1", "scopeHash", "pdfHash", "engineHash");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "173.json"), JSON.stringify({
        pdfHash: "pdfHash", page: 173, createdAt: 2,
        lines: [{ text: "图 4-34 id * id 的语法分析", box: [0.55, 0.735, 0.75, 0.753] }, { text: "x", box: [0.05, 0.1, 0.9, 0.12] }],
      }));
      const empty = path.join(root, ".system", "ocr-cache-v1", "scopeHash", "pdfHash", "oldEngine");
      fs.mkdirSync(empty, { recursive: true });
      fs.writeFileSync(path.join(empty, "173.json"), JSON.stringify({ pdfHash: "pdfHash", page: 173, createdAt: 1, lines: [] }));

      const found = await pageLines.pageLines({ pdfPath: "whatever.pdf", page: 173 }, { projectRoot: root, fs: fs, digestFile: async () => "pdfHash" });
      assert.ok(found, "entry found");
      assert.strictEqual(found.lines.length, 2);
      assert.strictEqual(found.lines[0].box[1], 0.735);
      assert.strictEqual(await pageLines.pageLines({ pdfPath: "x.pdf", page: 999 }, { projectRoot: root, fs: fs, digestFile: async () => "pdfHash" }), null);
      assert.strictEqual(await pageLines.pageLines({ pdfPath: "x.pdf", page: 0 }, { projectRoot: root, fs: fs }), null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("geometry alone produces a usable box (no vision)", async function () {
    const figureBox = require("./figure-box.js");
    const lines = [
      { text: "在第2行中", box: [0.06, 0.10, 0.94, 0.118] },
      { text: "$F", box: [0.56, 0.60, 0.60, 0.618] },
      { text: "* id $", box: [0.68, 0.60, 0.74, 0.618] },
      { text: "按照 T -> F 归约", box: [0.80, 0.60, 0.95, 0.618] },
      { text: "图 4-34 id * id 的语法分析", box: [0.55, 0.735, 0.75, 0.753] },
      { text: "输入 * 上的转换", box: [0.05, 0.775, 0.95, 0.793] },
    ];
    const made = await ink.createInk(Buffer.from("x"), { decoder: fakeDecoder(96, 132) });
    const out = figureBox.snapBox({ lines: lines, hint: "图 4-34 id*id", ink: made.ink });
    assert.strictEqual(out.reason, "geometry");
    assert.ok(out.rect[3] <= 0.766, "bottom on the caption: " + out.rect[3]);
    assert.ok(out.rect[1] < out.rect[3] && out.rect[2] > out.rect[0]);
  });

  const passed = results.filter(Boolean).length;
  console.log("\nfigure-geometry: " + passed + " passed, " + (results.length - passed) + " failed");
  if (passed !== results.length) process.exit(1);
})();
