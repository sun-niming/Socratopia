// textbook-text-index.js — "which page does this sentence come from?", plus the
// page's own text so the caller can show it instead of a screenshot.
//
// The source dialog used to guess a page from the reading cursor, which is often
// a page or two off the passage the learner actually selected.  The PDF's text
// layer knows the answer exactly, so this module extracts each page once, caches
// it, and scores a quote against every page with a longest-common-substring
// match.  A quote that really came from the book scores ~1.0; an unrelated page
// only shares boilerplate headers, so the score is small and the caller can fall
// back to the cursor.
//
// Extraction is deliberately CommonJS + the pdfjs stack pdf-page-render.js already
// resolves, so no new dependency and no worker process.
"use strict";

var fs = require("fs");
var path = require("path");

var PdfPageRender = require("./pdf-page-render.js");

// Whole-book text for one textbook is ~25 KB, so a handful of books is nothing;
// the ceiling exists so a shelf of textbooks cannot pin every parsed file.
var CACHE_LIMIT = 6;
var CACHE = new Map();

// A selection shorter than this is too generic to locate on its own.
var MIN_QUOTE_CHARS = 6;
// Long quotes are cut to a window: the middle of a selection is distinctive,
// whereas its head is often the tail of the previous paragraph.
var MAX_QUOTE_CHARS = 400;
// Below this share of the quote found on one page, the hit is boilerplate.
var MIN_SCORE = 0.28;

var cacheBytes = 0;

function normalizeChar(ch) {
  var code = ch.charCodeAt(0);
  // Full-width ASCII -> half-width, so a quote copied out of a CJK page still
  // matches the same characters pdfjs reports.  Lowercasing happens after the
  // width fold because Ａ-Ｚ sit in that block and would stay uppercase.
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0).toLowerCase();
  if (code === 0x3000) return " ";
  return ch.toLowerCase();
}

var DROP = /[\s\u00a0\u2000-\u200b\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65,.!?;:'"()[\]{}\-_/\\|*#`~+=<>@&%$^•·…—–]/;

// Normalize a page to comparable characters while remembering where each one
// came from, so a match offset can be mapped back onto the readable text.
function normalizeWithMap(text) {
  var chars = [];
  var offsets = [];
  for (var i = 0; i < text.length; i += 1) {
    var ch = text[i];
    if (DROP.test(ch)) continue;
    var mapped = normalizeChar(ch);
    for (var j = 0; j < mapped.length; j += 1) {
      chars.push(mapped[j]);
      offsets.push(i);
    }
  }
  return { norm: chars.join(""), offsets: offsets };
}

function normalizePlain(text) {
  var chars = [];
  for (var i = 0; i < text.length; i += 1) {
    if (DROP.test(text[i])) continue;
    chars.push(normalizeChar(text[i]));
  }
  return chars.join("");
}

function median(values) {
  if (!values.length) return 0;
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  return sorted[Math.floor(sorted.length / 2)];
}

// pdfjs hands back one item per text run with its own baseline and height.
// Joining it flat gives a wall of characters ("...运输层位千应用层..."), so rebuild
// the page's own line structure first: a baseline jump or a backwards x means a
// new line.  Headings are lines set noticeably larger than the page's normal
// body size, which is what makes the text view readable instead of a slab.
function layoutBlocks(items) {
  var lines = [];
  var line = null;
  var lastY = null;
  var lastX = null;
  for (var i = 0; i < items.length; i += 1) {
    var item = items[i];
    var str = String(item.str || "");
    if (!str) continue;
    var transform = item.transform || [1, 0, 0, 1, 0, 0];
    var y = Math.round(transform[5]);
    var x = transform[4];
    var size = Math.abs(item.height || 0) || Math.abs(transform[3]) || 0;
    var broke = line === null || (lastY !== null && Math.abs(y - lastY) > Math.max(2, size * 0.5)) || (lastX !== null && x < lastX - size);
    if (broke) {
      line = { text: "", size: size, y: y };
      lines.push(line);
    }
    line.text += str;
    line.size = Math.max(line.size, size);
    lastY = y;
    lastX = x + str.length * size * 0.5;
  }
  if (!lines.length) return [];

  var body = median(lines.map(function (item) { return item.size; })) || 1;
  var blocks = [];
  var current = null;
  var previous = null;
  for (var j = 0; j < lines.length; j += 1) {
    var value = lines[j].text.replace(/\s+/g, " ").trim();
    if (!value) continue;
    var heading = lines[j].size > body * 1.25 && value.length < 80;
    var gap = previous ? Math.abs(previous.y - lines[j].y) : 0;
    // A heading always stands alone; body lines only break on a visible gap, so
    // consecutive lines of one paragraph stay in the same block.
    var newBlock = !current || heading || current.type === "heading" || gap > body * 1.9;
    if (newBlock) {
      current = { type: heading ? "heading" : "paragraph", text: value };
      blocks.push(current);
    } else {
      // Latin words need the space back where the line wrapped mid-word.
      var glue = /[A-Za-z0-9]$/.test(current.text) && /^[A-Za-z0-9]/.test(value) ? " " : "";
      current.text += glue + value;
    }
    previous = lines[j];
  }
  // A single lazy line is not a paragraph; keep the page from looking shredded.
  for (var k = 0; k < blocks.length - 1; k += 1) {
    if (blocks[k].text.length < 8 && blocks[k + 1].type === blocks[k].type) {
      blocks[k + 1].text = blocks[k].text + blocks[k + 1].text;
      blocks.splice(k, 1);
      k -= 1;
    }
  }
  return blocks.filter(function (block) { return block.text; });
}

async function loadPages(pdfPath) {
  var pdfjs = null;
  var canvas = null;
  var canvasPath = PdfPageRender._internals.resolveDependency("@napi-rs/canvas/index.js");
  canvas = require(canvasPath);
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = canvas.DOMMatrix;
  if (!globalThis.ImageData) globalThis.ImageData = canvas.ImageData;
  if (!globalThis.Path2D) globalThis.Path2D = canvas.Path2D;
  var url = require("url");
  pdfjs = await import(url.pathToFileURL(PdfPageRender._internals.resolveDependency("pdfjs-dist/legacy/build/pdf.mjs")).href);
  pdfjs.GlobalWorkerOptions.workerSrc = url.pathToFileURL(
    PdfPageRender._internals.resolveDependency("pdfjs-dist/legacy/build/pdf.worker.mjs")
  ).href;

  // A private document: the renderer's own cache would thrash against the
  // page rasters the dialog loads at the same time.
  var data = new Uint8Array(fs.readFileSync(pdfPath));
  var doc = await pdfjs.getDocument({ data: data, useSystemFonts: true, disableAutoFetch: true, disableStream: true }).promise;
  var pages = [];
  try {
    for (var pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      var page = await doc.getPage(pageNumber);
      var content = await page.getTextContent();
      // pdfjs emits one item per run; rebuild lines so paragraphs stay readable,
      // then join the blocks with a blank line so the flat form (used for
      // matching) never glues two paragraphs together.
      var blocks = layoutBlocks(content.items);
      page.cleanup();
      var text = blocks
        .map(function (block) { return block.text; })
        .join("\n\n")
        .replace(/[ \t]+/g, " ")
        .trim();
      var mapped = normalizeWithMap(text);
      // Remember where each block sits in the joined text so the dialog can
      // rebuild the structure and mark the one that contains the hit.
      var cursor = 0;
      blocks.forEach(function (block) {
        var at = text.indexOf(block.text, cursor);
        block.start = at < 0 ? cursor : at;
        block.end = block.start + block.text.length;
        cursor = block.end;
      });
      pages.push({
        page: pageNumber,
        text: text,
        blocks: blocks,
        grams: gramSet(mapped.norm),
        norm: mapped.norm,
        offsets: mapped.offsets,
      });
    }
  } finally {
    Promise.resolve(doc.destroy()).catch(function () { /* nothing to clean up */ });
  }
  return pages;
}

function cacheKey(pdfPath) {
  var stat = fs.statSync(pdfPath);
  return path.resolve(pdfPath) + "|" + stat.mtimeMs + "|" + stat.size;
}

function evict() {
  while (CACHE.size > CACHE_LIMIT) {
    var oldest = CACHE.keys().next().value;
    var entry = CACHE.get(oldest);
    CACHE.delete(oldest);
    cacheBytes -= entry.bytes || 0;
  }
}

// extractPages(pdfPath) -> [{ page, text, norm, offsets }] (cached)
async function extractPages(pdfPath) {
  if (typeof pdfPath !== "string" || !pdfPath) {
    throw PdfPageRender.codedError("textbook_source_missing", "pdfPath is required", 404);
  }
  var key = cacheKey(pdfPath);
  var hit = CACHE.get(key);
  if (hit) {
    CACHE.delete(key);
    CACHE.set(key, hit);
    return hit.pages;
  }
  var pages = await loadPages(pdfPath);
  var bytes = pages.reduce(function (sum, page) { return sum + page.text.length + page.offsets.length * 4; }, 0);
  CACHE.set(key, { pages: pages, bytes: bytes });
  cacheBytes += bytes;
  evict();
  return pages;
}

function clearCache() {
  var size = CACHE.size;
  CACHE.clear();
  cacheBytes = 0;
  return size;
}

function cacheSize() {
  return CACHE.size;
}

// Longest common substring length between `quote` and `page`, plus where it ends.
// One rolling row against the page keeps this O(len(quote) * len(page)).
function longestCommon(quote, page) {
  if (!quote || !page) return { length: 0, end: -1 };
  var cols = page.length + 1;
  var prev = new Uint16Array(cols);
  var cur = new Uint16Array(cols);
  var best = 0;
  var bestEnd = -1;
  for (var i = 1; i <= quote.length; i += 1) {
    var ch = quote.charAt(i - 1);
    for (var j = 1; j <= page.length; j += 1) {
      if (ch === page.charAt(j - 1)) {
        var value = prev[j - 1] + 1;
        cur[j] = value;
        if (value > best) {
          best = value;
          bestEnd = j;
        }
      } else {
        cur[j] = 0;
      }
    }
    var swap = prev;
    prev = cur;
    cur = swap;
    cur.fill(0);
  }
  return { length: best, end: bestEnd };
}

function quoteWindow(quote) {
  var value = normalizePlain(String(quote || ""));
  if (value.length <= MAX_QUOTE_CHARS) return value;
  var start = Math.floor((value.length - MAX_QUOTE_CHARS) / 2);
  return value.slice(start, start + MAX_QUOTE_CHARS);
}

// A single longest common substring only measures one run, so a quote whose
// words are right but whose connectives were rewritten scores low even when it
// plainly came from the page.  Coverage — the share of the quote's 4-grams that
// appear anywhere on the page — is the robust signal; the longest run is kept as
// a bonus so a verbatim sentence still wins over a page that merely shares
// vocabulary.
var GRAM = 4;

function gramSet(norm) {
  var set = new Set();
  for (var i = 0; i + GRAM <= norm.length; i += 1) set.add(norm.substr(i, GRAM));
  return set;
}

function coverage(needle, grams) {
  if (!grams || !grams.size) return 0;
  var seen = new Uint8Array(needle.length);
  var hit = 0;
  for (var i = 0; i + GRAM <= needle.length; i += 1) {
    if (!grams.has(needle.substr(i, GRAM))) continue;
    for (var j = i; j < i + GRAM; j += 1) {
      if (!seen[j]) {
        seen[j] = 1;
        hit += 1;
      }
    }
  }
  return hit / needle.length;
}

// locateInPages(pages, quote) -> { page, score, matchLength, text, before, match, after }
async function locateInPages(pages, quote) {
  var needle = quoteWindow(quote);
  if (needle.length < MIN_QUOTE_CHARS) {
    return { page: null, score: 0, matchLength: needle.length, reason: "quote_too_short" };
  }
  var best = null;
  var bestScore = 0;
  for (var i = 0; i < pages.length; i += 1) {
    var page = pages[i];
    if (!page.norm) continue;
    if (!page.grams) page.grams = gramSet(page.norm);
    var found = longestCommon(needle, page.norm);
    var score = coverage(needle, page.grams) + Math.min(1, found.length / 24) * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = { page: page, end: found.end, length: found.length };
    }
  }
  if (!best || (best.length < MIN_QUOTE_CHARS && bestScore < MIN_SCORE) || bestScore < MIN_SCORE) {
    return {
      page: best ? best.page.page : null,
      score: Math.round(bestScore * 1000) / 1000,
      matchLength: best ? best.length : 0,
      reason: best ? "low_score" : "not_found",
    };
  }

  // Map the normalized hit back to characters in the readable text.
  var startNorm = best.end - best.length;
  var start = best.page.offsets[startNorm];
  var end = best.page.offsets[best.end - 1] + 1;
  var text = best.page.text;
  var context = 180;
  return {
    page: best.page.page,
    score: Math.round(bestScore * 1000) / 1000,
    matchLength: best.length,
    totalPages: pages.length,
    text: text,
    blocks: markHitBlocks(best.page.blocks || [], best.page, quote),
    before: text.slice(Math.max(0, start - context), start),
    match: text.slice(start, end),
    after: text.slice(end, end + context),
  };
}

// locate(pdfPath, quote) -> same shape as locateInPages, pages extracted on demand
async function locate(pdfPath, quote) {
  var pages = await extractPages(pdfPath);
  return locateInPages(pages, quote);
}

function markHitBlocks(blocks, page, quote) {
  var needle = quoteWindow(quote);
  if (!needle || needle.length < MIN_QUOTE_CHARS || !page.norm) {
    return blocks.map(function (block) {
      return { type: block.type, text: block.text, hit: false };
    });
  }
  var found = longestCommon(needle, page.norm);
  var start = found.end - found.length;
  var end = found.end;
  var hitStart = start >= 0 && found.length ? page.offsets[start] : -1;
  var hitEnd = end > 0 && found.length ? page.offsets[end - 1] + 1 : -1;
  return blocks.map(function (block) {
    return {
      type: block.type,
      text: block.text,
      hit: hitStart >= 0 && block.end > hitStart && block.start < hitEnd,
    };
  });
}

// pageText(pdfPath, page, quote?) -> { page, totalPages, text, blocks } | null
// `quote` marks the block that actually holds the selection, so the dialog can
// highlight it instead of making the learner hunt for their own sentence.
async function pageText(pdfPath, page, quote) {
  var number = Number(page);
  if (!Number.isInteger(number) || number < 1) return null;
  var pages = await extractPages(pdfPath);
  if (number > pages.length) return null;
  var found = pages[number - 1];
  var blocks = markHitBlocks(found.blocks || [], found, quote);
  return {
    page: number,
    totalPages: pages.length,
    text: found.text,
    blocks: blocks,
  };
}

module.exports = {
  extractPages: extractPages,
  locate: locate,
  pageText: pageText,
  locateInPages: locateInPages,
  normalizePlain: normalizePlain,
  clearCache: clearCache,
  cacheSize: cacheSize,
  CACHE_LIMIT: CACHE_LIMIT,
  MIN_QUOTE_CHARS: MIN_QUOTE_CHARS,
  MIN_SCORE: MIN_SCORE,
  MAX_QUOTE_CHARS: MAX_QUOTE_CHARS,
  _internals: {
    normalizeWithMap: normalizeWithMap,
    longestCommon: longestCommon,
    quoteWindow: quoteWindow,
    layoutBlocks: layoutBlocks,
    cacheBytes: function () { return cacheBytes; },
  },
};
