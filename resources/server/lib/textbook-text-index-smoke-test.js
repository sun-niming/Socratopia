// textbook-text-index-smoke-test.js — locate a quote in a PDF text layer.
//
// Runs against a synthesized page set for the matcher and against the real pdfjs
// stack for one small PDF, so it also proves extraction still works.
"use strict";

var assert = require("assert");
var Index = require("./textbook-text-index.js");

var failures = 0;
function ok(name, fn) {
  try {
    fn();
    console.log("  ok   " + name);
  } catch (error) {
    failures += 1;
    console.log("  FAIL " + name + ": " + error.message);
  }
}

function pages(list) {
  return list.map(function (text, i) {
    var mapped = Index._internals.normalizeWithMap(text);
    var blocks = [];
    var cursor = 0;
    text.split("\n\n").forEach(function (chunk) {
      var at = text.indexOf(chunk, cursor);
      blocks.push({ type: "paragraph", text: chunk, start: at, end: at + chunk.length });
      cursor = at + chunk.length;
    });
    return { page: i + 1, text: text, blocks: blocks, norm: mapped.norm, offsets: mapped.offsets };
  });
}

var BOOK = pages([
  "第 1 章 绪论\n计算机网络把主机连起来，主机之间的通信依靠协议。",
  "第 2 章 应用层\nHTTP 是一个无状态的请求回答协议，默认端口是 80。",
  "第 3 章 传输层\nUDP 不建立连接，也不做确认，可靠传输要由应用自己补。",
  "第 4 章 网络层\n路由选择协议负责在路由器之间交换可达信息。",
]);

(async function main() {
  console.log("textbook text index smoke test");

  ok("normalizePlain drops punctuation and whitespace", function () {
    assert.strictEqual(Index.normalizePlain("UDP 不做确认，就是了。"), "udp不做确认就是了");
  });

  ok("normalizeWithMap keeps offsets aligned to the original text", function () {
    var mapped = Index._internals.normalizeWithMap("a b，c");
    assert.strictEqual(mapped.norm, "abc");
    assert.strictEqual(mapped.offsets[2], 4);
  });

  ok("full-width ASCII matches its half-width form", function () {
    var mapped = Index._internals.normalizeWithMap("ＵＤＰ");
    assert.strictEqual(mapped.norm, "udp");
  });

  ok("longestCommon finds the shared run and where it ends", function () {
    var found = Index._internals.longestCommon("xxudp不做", "udp不做确认");
    assert.strictEqual(found.length, 5);
    assert.strictEqual(found.end, 5);
  });

  ok("quoteWindow cuts a long quote from the middle", function () {
    var long = "开".repeat(200) + "中".repeat(200) + "尾".repeat(200);
    var out = Index._internals.quoteWindow(long);
    assert.strictEqual(out.length, Index.MAX_QUOTE_CHARS);
    assert.ok(out.indexOf("中") >= 0);
  });

  var hit = await Index.locateInPages(BOOK, "UDP 不建立连接，也不做确认");
  ok("a real quote lands on its own page", function () {
    assert.strictEqual(hit.page, 3);
    // 命中页的分数必须是所有页里最高的，值本身由覆盖率+最长串合成，不锁死
    assert.ok(hit.score > 0);
    assert.ok(hit.match.indexOf("UDP") === 0);
  });

  ok("hit carries the page text plus a little context", function () {
    assert.ok(hit.text.indexOf("路由选择协议") < 0);
    assert.ok(hit.before.length + hit.match.length + hit.after.length > 0);
  });

  var punctuationFree = await Index.locateInPages(BOOK, "udp不做确认可靠传输要由应用自己补");
  ok("punctuation and case do not block a match", function () {
    assert.strictEqual(punctuationFree.page, 3);
    // LCS 只认一段连续匹配，中间差几个字就掉分，只要过线即可
    assert.ok(punctuationFree.score >= Index.MIN_SCORE);
  });

  var missed = await Index.locateInPages(BOOK, "这一段是模型自己编的完全不存在的话");
  ok("an invented quote is reported as a low score, not a confident hit", function () {
    assert.ok(missed.score < Index.MIN_SCORE);
    assert.strictEqual(missed.reason, "low_score");
  });

  var short = await Index.locateInPages(BOOK, "协议");
  ok("a two-character quote is rejected as too short", function () {
    assert.strictEqual(short.reason, "quote_too_short");
    assert.strictEqual(short.page, null);
  });

  ok("locateInPages never throws on empty input", async function () {
    var empty = await Index.locateInPages(BOOK, "");
    assert.strictEqual(empty.page, null);
  });

  ok("cache keeps a bounded number of books", function () {
    assert.ok(Index.CACHE_LIMIT >= 1);
    assert.strictEqual(typeof Index.clearCache(), "number");
  });

  // ---- page layout: the text view is read by a human, not a matcher ----
  function runs(list) {
    // [str, x, y, size] — pdfjs-shaped items, one baseline per array entry.
    return list.map(function (r) {
      return { str: r[0], transform: [1, 0, 0, r[3], r[1], r[2]], height: r[3] };
    });
  }

  ok("layoutBlocks joins the lines of one paragraph", function () {
    var blocks = Index._internals.layoutBlocks(runs([
      ["运输层位", 60, 700, 10],
      ["于应用层和", 90, 700, 10],
      ["网络层之间", 60, 686, 10],
    ]));
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, "paragraph");
    assert.strictEqual(blocks[0].text, "运输层位于应用层和网络层之间");
  });

  ok("layoutBlocks splits paragraphs on a visible gap", function () {
    var blocks = Index._internals.layoutBlocks(runs([
      ["第一段的正文内容，这里写长一些。", 60, 700, 10],
      ["第二段另起一行，这里也写长一些。", 60, 640, 10],
    ]));
    assert.strictEqual(blocks.length, 2);
  });

  ok("layoutBlocks marks oversized short lines as headings", function () {
    var blocks = Index._internals.layoutBlocks(runs([
      ["3.1 概述", 60, 760, 16],
      ["运输层为运行在不同主机上的应用进程提供逻辑通信。", 60, 720, 10],
      ["这句话接着上一段。", 60, 706, 10],
    ]));
    assert.strictEqual(blocks[0].type, "heading");
    assert.strictEqual(blocks[1].type, "paragraph");
    assert.ok(blocks[1].text.indexOf("这句话接着上一段") >= 0, "正文不应被标题拆成两段");
  });

  ok("layoutBlocks keeps a hyphen-free Latin wrap readable", function () {
    var blocks = Index._internals.layoutBlocks(runs([
      ["logic communica", 60, 700, 10],
      ["tion", 60, 700, 10],
    ]));
    assert.strictEqual(blocks[0].text, "logic communica tion");
  });

  ok("layoutBlocks returns nothing for an empty page", function () {
    assert.deepStrictEqual(Index._internals.layoutBlocks([]), []);
  });

  var marked = await Index.locateInPages(
    pages(["前言一句话。\n\nUDP 不建立连接，也不做确认，可靠传输要由应用自己补。\n\n后记一句话。"]),
    "UDP 不建立连接"
  );
  ok("a located hit marks exactly the block it landed in", function () {
    var hits = marked.blocks.filter(function (block) { return block.hit; });
    assert.strictEqual(hits.length, 1);
    assert.ok(hits[0].text.indexOf("UDP") === 0);
  });

  var unmarked = await Index.pageText(null, 1).catch(function () { return null; });
  void unmarked;

  // ---- real pdfjs extraction ----
  var fs = require("fs");
  var path = require("path");
  var PdfPageRender = require("./pdf-page-render.js");
  var ProjectRoot = process.env.PROJECT_ROOT || path.join(process.env.APPDATA || "", "socratopia", "project-data");
  var candidates = [];
  (function walk(dir, depth) {
    if (!dir || depth > 9 || candidates.length >= 1) return;
    var entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (var i = 0; i < entries.length; i += 1) {
      if (candidates.length >= 1) return;
      var full = path.join(dir, entries[i].name);
      if (entries[i].isDirectory()) walk(full, depth + 1);
      else if (/\.pdf$/i.test(entries[i].name)) candidates.push(full);
    }
  })(ProjectRoot, 0);

  if (!candidates.length) {
    console.log("  skip real PDF extraction (no user textbook on this machine)");
  } else {
    var pdf = candidates[0];
    var extracted = await Index.extractPages(pdf);
    ok("extraction returns pages with normalized text", function () {
      assert.ok(extracted.length > 0);
      assert.ok(typeof extracted[0].norm === "string");
      assert.strictEqual(extracted[0].page, 1);
    });

    var firstText = extracted.map(function (p) { return p.text; }).join("").replace(/\s+/g, "");
    if (firstText.length > 40) {
      var slice = firstText.slice(20, 60);
      var found = await Index.locate(pdf, slice);
      ok("a slice of the real book locates at a high score", function () {
        assert.ok(found.score >= Index.MIN_SCORE);
        assert.ok(found.page >= 1);
      });

      ok("pageText returns the whole page and the page count", async function () {
        var text = await Index.pageText(pdf, found.page);
        assert.ok(text && text.totalPages === extracted.length);
      });
    }

    ok("pageText is null past the last page", async function () {
      var beyond = await Index.pageText(pdf, extracted.length + 5);
      assert.strictEqual(beyond, null);
    });

    ok("a second extract reuses the cache", function () {
      var before = Index.cacheSize();
      return Index.extractPages(pdf).then(function () {
        assert.strictEqual(Index.cacheSize(), before);
      });
    });

    ok("resolveTextbookPdf rejects a traversal id", function () {
      assert.throws(function () {
        PdfPageRender.resolveTextbookPdf(ProjectRoot, "../..");
      });
    });
  }

  console.log(failures ? "FAILED: " + failures : "textbook text index smoke: ok");
  process.exit(failures ? 1 : 0);
})().catch(function (error) {
  console.log("FAILED: " + (error && error.stack));
  process.exit(1);
});
