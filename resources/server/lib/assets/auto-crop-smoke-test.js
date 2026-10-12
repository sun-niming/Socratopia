// auto-crop-smoke-test.js — a mentioned figure gets a crop without anyone asking.
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const intents = require("./intents.js");
const pageRender = require("../pdf-page-render.js");

const results = [];
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    function () { results.push(true); console.log("  PASS  " + name); },
    function (e) { results.push(false); console.log("  FAIL  " + name + "\n        " + e.message); });
}

const realResolve = pageRender.resolveTextbookPdf;
const realCaptions = require("./page-lines.js").allCaptions;
const worldRoot = fs.mkdtempSync(path.join(require("os").tmpdir(), "socratopia-autocrop-"));
const worldDir = path.join(worldRoot, "accounts", "local", "profiles", "p", "worlds", "KU");
fs.mkdirSync(path.join(worldDir, "textbooks", "KUyw"), { recursive: true });
fs.writeFileSync(path.join(worldDir, "textbooks", "KUyw", "book.pdf"), "pdf");
const ctx = { textbookId: "KUyw", autoCrop: true, scope: { projectRoot: worldRoot, accountId: "local", profileId: "p", worldId: "KU" } };

(async function main() {
  pageRender.resolveTextbookPdf = function () { return "C:\\fake\\book.pdf"; };
  require("./page-lines.js").allCaptions = async function () {
    return [
      { label: "图 4-59", page: 202, text: "图4-59一个更加先进的桌上计算器的Yacc规约", y: 0.62 },
      { label: "表 4-2", page: 44, text: "表4-2符号表", y: 0.3 },
    ];
  };

  await test("a mentioned figure is cropped right after that sentence", async function () {
    const text = "书上给出了完整写法（见图 4-59 的规约）。下一句继续讲别的。";
    const out = await intents.autoCropMentions(text, ctx);
    assert.ok(out.indexOf("book://KUyw/p202") > 0, "crop order inserted: " + out);
    assert.ok(out.indexOf("规约）。") < out.indexOf("!["), "inserted behind the sentence");
    assert.ok(out.indexOf("下一句继续讲别的") > out.indexOf("!["), "rest of the paragraph preserved");
    assert.ok(/!\[图4-59[^\]]*\]\(book:\/\/KUyw\/p202\)/.test(out), "alt carries the caption: " + out);
  });

  await test("表 works too, and the first mention wins", async function () {
    const out = await intents.autoCropMentions("先看表 4-2，再看图 4-59。", ctx);
    assert.ok(out.indexOf("book://KUyw/p44") > 0, out);
    assert.strictEqual((out.match(/book:\/\//g) || []).length, 1, "capped at one per message");
  });

  await test("text without a mention, an existing anchor, or an unknown label is left alone", async function () {
    assert.strictEqual(await intents.autoCropMentions("没有提图。", ctx), "没有提图。");
    const withAnchor = "见图 4-59 ![x](asset://ast_0123456789abcdef)";
    assert.strictEqual(await intents.autoCropMentions(withAnchor, ctx), withAnchor);
    const unknown = "见图 9-9。";
    assert.strictEqual(await intents.autoCropMentions(unknown, ctx), unknown);
  });

  await test("the pass is opt-out and only runs when asked", async function () {
    const text = "见图 4-59。";
    assert.strictEqual(await intents.autoCropMentions(text, Object.assign({}, ctx, { autoCrop: false })), text);
    global.__SOCRATOPIA_SET__ = { assets: { autoCropMentions: false } };
    assert.strictEqual(await intents.autoCropMentions(text, ctx), text);
    global.__SOCRATOPIA_SET__ = { assets: { autoCropMentions: true } };
    assert.ok((await intents.autoCropMentions(text, ctx)).indexOf("book://") > 0);
    delete global.__SOCRATOPIA_SET__;
  });

  await test("a body line that merely mentions the label is not mistaken for the caption", async function () {
    // only exact caption labels are indexed; the caller's regex requires a boundary
    const out = await intents.autoCropMentions("因为图4-59中Yacc规约的文法是二义的。", ctx);
    assert.ok(out.indexOf("book://KUyw/p202") > 0, out);
  });

  pageRender.resolveTextbookPdf = realResolve;
  require("./page-lines.js").allCaptions = realCaptions;

  const passed = results.filter(Boolean).length;
  console.log("\nauto-crop: " + passed + " passed, " + (results.length - passed) + " failed");
  if (passed !== results.length) process.exit(1);
})();
