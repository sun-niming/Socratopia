// serialize.js — message blocks -> LLM request content.
//
// Confidence ladder (plan §5.4), in order:
//   1. the block carries reliable text (learner note, visual description, or OCR
//      at/above `ocrThreshold`)  -> flatten to "[图片: <text>]" plain text
//   2. no reliable text AND the classroom model declares vision -> emit an
//      OpenAI-compatible `image_url` content part with an inline data URL
//   3. otherwise -> the placeholder "[图片: 未识别]"
//
// SVG assets never need the vision branch: the source is already text, so they
// always take step 1 with their semantic title.
//
// This module performs NO file or network IO: whatever base64 the caller has is
// injected through options.  A plain string `content` without asset anchors is
// returned untouched (the same message object, byte-identical string) so legacy
// conversations cost nothing.  Strings carrying `asset://<id>` anchors (the
// frontend inserts `![图片](asset://<id>)` as plain text) walk the same ladder:
// each anchor is resolved through the injected `resolveRecord` callback and is
// replaced inline by "[图片: <text>]" / an image_url part / the placeholder.
"use strict";

var DEFAULTS = Object.freeze({
  visionEnabled: false,
  maxImagesPerTurn: 3,
  maxImageBytes: 4 * 1024 * 1024,
  ocrThreshold: 0.6,
  placeholder: "[图片: 未识别]",
});

var ASSET_ID_RE = /^ast_[0-9a-f]{16}$/;
// Matches the markdown image wrapper the frontend emits (`![图片](asset://<id>)`)
// first, then a bare `asset://<id>`.  Group 1 = wrapped id, group 2 = bare id.
var ASSET_ANCHOR_SOURCE = "!\\[[^\\]\\n]*\\]\\(asset://(ast_[0-9a-f]{16})\\)|asset://(ast_[0-9a-f]{16})";

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionNumber(value, fallback) {
  var number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function resolveOptions(options) {
  var input = isRecord(options) ? options : {};
  return {
    visionEnabled: input.visionEnabled === undefined ? DEFAULTS.visionEnabled : !!input.visionEnabled,
    // `textOnly` lets the five non-chat LLM call sites consume flattened text
    // only, without ever producing a multimodal part.
    textOnly: !!input.textOnly,
    maxImagesPerTurn: optionNumber(input.maxImagesPerTurn, DEFAULTS.maxImagesPerTurn),
    maxImageBytes: optionNumber(input.maxImageBytes, DEFAULTS.maxImageBytes),
    ocrThreshold: optionNumber(input.ocrThreshold, DEFAULTS.ocrThreshold),
    placeholder: typeof input.placeholder === "string" && input.placeholder ? input.placeholder : DEFAULTS.placeholder,
    images: input.images || null,
    resolveImage: typeof input.resolveImage === "function" ? input.resolveImage : null,
    resolveRecord: typeof input.resolveRecord === "function" ? input.resolveRecord : null,
  };
}

function textOf(value, limit) {
  if (typeof value !== "string") return null;
  var text = value.trim();
  if (!text) return null;
  return limit && text.length > limit ? text.slice(0, limit) : text;
}

// The text that makes the vision branch unnecessary, or null when nothing about
// this block is trustworthy enough to stand in for the picture.
function reliableText(block, options) {
  var direct = textOf(block.text) || textOf(block.caption) || textOf(block.visualDescription) || textOf(block.alt);
  if (direct) return direct;
  var ocr = textOf(block.ocrText);
  if (!ocr) return null;
  var confidence = Number(block.ocrConfidence);
  if (Number.isFinite(confidence)) {
    return confidence >= options.ocrThreshold ? ocr : null;
  }
  // No confidence recorded: treat OCR as reliable only when it looks substantive.
  return ocr.length >= 4 ? ocr : null;
}

function svgLabel(block) {
  return textOf(block.svgTitle) || textOf(block.caption) || textOf(block.text) || "SVG 示意图";
}

function isSvgBlock(block) {
  if (block.kind === "svg") return true;
  return typeof block.svgSource === "string" && block.svgSource.length > 0;
}

function imagePayload(block, options) {
  if (typeof block.dataUrl === "string" && block.dataUrl.indexOf("data:") === 0) return block.dataUrl;
  if (typeof block.base64 === "string" && block.base64) {
    return "data:" + (block.mimeType || "image/png") + ";base64," + block.base64;
  }
  var injected = null;
  if (options.images) {
    injected = typeof options.images.get === "function" ? options.images.get(block.assetId) : options.images[block.assetId];
  }
  if (!injected && options.resolveImage) injected = options.resolveImage(block.assetId);
  if (!injected) return null;
  if (typeof injected === "string") return injected.indexOf("data:") === 0 ? injected : "data:image/png;base64," + injected;
  if (typeof injected.dataUrl === "string") return injected.dataUrl;
  if (typeof injected.base64 === "string") {
    return "data:" + (injected.mimeType || "image/png") + ";base64," + injected.base64;
  }
  return null;
}

function dataUrlBytes(dataUrl) {
  var comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  var payload = dataUrl.slice(comma + 1);
  var padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(payload.length * 3 / 4) - padding);
}

// The label that lets a string anchor stand in for the picture, or null when the
// record says nothing trustworthy.  Asset records reuse the block field names
// (caption/ocrText/ocrConfidence), so the same ladder applies.
function recordLabel(record, options) {
  if (!isRecord(record) || record.deleted) return null;
  if (record.kind === "svg") return textOf(record.svgTitle) || textOf(record.caption) || "SVG 示意图";
  return reliableText(record, options);
}

// The last-resort label for an anchor whose picture never reaches the model.
// A textbook figure still knows its page, and "教材 第 174 页插图" beats a blank
// "未识别": the tutor can at least refer to it and ask for the caption.
// Only the placeholder text changes — a non-null recordLabel still short-circuits
// the vision branch, so visionEnabled=true keeps sending the bytes.
function refLabel(record) {
  if (!isRecord(record)) return null;
  var ref = record.ref;
  var page = isRecord(ref) ? Number(ref.page) : NaN;
  if (Number.isFinite(page) && page > 0) return "教材 第 " + page + " 页插图";
  return null;
}

function placeholderFor(record, options) {
  var label = refLabel(record);
  return label ? figureTextFor(label, record && record.id) : options.placeholder;
}

// The canonical markdown for an anchor — exactly what the tutor should write back
// into its reply, so the client renders a thumbnail instead of a bare link.
// A figure in the LLM input is written exactly like the tutor must write it back:
// a canonical anchor.  The old "[图片: <label>]" text made the model imitate a form
// that has no id — so a copied figure persisted as a dead placeholder.  The text
// form survives only when no asset id exists to cite.
function figureTextFor(label, assetId) {
  var id = textOf(assetId);
  if (id && ASSET_ID_RE.test(id)) return anchorMarkdown(id, label);
  return "[图片: " + label + "]";
}

function anchorMarkdown(assetId, label) {
  return "![" + (textOf(label) || "图片") + "](asset://" + assetId + ")";
}

// True when this turn's byte budget may be spent on `assetId`.  With no allow
// set (callers that build a one-off state object) every anchor is eligible.
function allowVision(state, assetId) {
  return !state.visionAllow || state.visionAllow.has(assetId);
}

// Resolves `asset://<id>` anchors inside a plain string message.  Returns null
// when the string carries no anchor (caller keeps the message untouched).  When
// every anchor flattens to text the result is a new string; the first anchor
// that needs the vision branch upgrades the whole message to a parts array.
function stringToLlmInput(content, state) {
  var options = state.options;
  if (content.indexOf("asset://") === -1) return null;
  var re = new RegExp(ASSET_ANCHOR_SOURCE, "g");
  var match;
  var lastIndex = 0;
  var text = "";
  var parts = [];
  var multimodal = false;
  var matched = false;
  function pushText(value) {
    text += value;
    if (value) parts.push({ type: "text", text: value });
  }
  while ((match = re.exec(content)) !== null) {
    matched = true;
    var assetId = match[1] || match[2];
    pushText(content.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    var record = options.resolveRecord ? options.resolveRecord(assetId) : null;
    var label = recordLabel(record, options);
    if (label) {
      pushText(figureTextFor(label, assetId));
      continue;
    }
    var dataUrl = null;
    if (record && options.visionEnabled && !options.textOnly && state.visionBudget > 0 && allowVision(state, assetId)) {
      var candidate = imagePayload({ assetId: assetId }, options);
      if (candidate && dataUrlBytes(candidate) > 0 && dataUrlBytes(candidate) <= options.maxImageBytes) dataUrl = candidate;
    }
    if (dataUrl) {
      state.visionBudget -= 1;
      state.visionUsed += 1;
      multimodal = true;
      // Keep the anchor beside the picture.  An image part alone loses the id, so
      // the tutor could see the figure but never cite it back into its own reply.
      pushText(anchorMarkdown(assetId, label));
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
      continue;
    }
    pushText(placeholderFor(record, options));
  }
  pushText(content.slice(lastIndex));
  if (!matched) return null;
  return { content: multimodal ? parts : text };
}

// Converts one message.  Returns the identical object for anchor-free strings.
function messageToLlmInput(message, state) {
  var options = state.options;
  if (!isRecord(message)) return message;
  if (typeof message.content === "string") {
    var converted = stringToLlmInput(message.content, state);
    if (!converted) return message;
    var copyString = {};
    Object.keys(message).forEach(function (key) { copyString[key] = message[key]; });
    copyString.content = converted.content;
    return copyString;
  }
  if (!Array.isArray(message.content)) return message;

  var parts = [];

  for (var i = 0; i < message.content.length; i += 1) {
    var block = message.content[i];
    if (typeof block === "string") {
      parts.push({ type: "text", text: block });
      continue;
    }
    if (!isRecord(block)) continue;

    if (block.type === "text") {
      parts.push({ type: "text", text: typeof block.text === "string" ? block.text : "" });
      continue;
    }

    if (block.type !== "image") {
      // Unknown future block type: keep it verbatim so nothing is silently lost.
      parts.push(block);
      continue;
    }

    if (isSvgBlock(block)) {
      parts.push({ type: "text", text: figureTextFor(svgLabel(block), block.assetId) });
      continue;
    }

    var label = reliableText(block, options);
    if (label) {
      parts.push({ type: "text", text: figureTextFor(label, block.assetId) });
      continue;
    }

    if (options.visionEnabled && !options.textOnly && state.visionBudget > 0 && allowVision(state, block.assetId)) {
      var dataUrl = imagePayload(block, options);
      if (dataUrl && dataUrlBytes(dataUrl) > 0 && dataUrlBytes(dataUrl) <= options.maxImageBytes) {
        state.visionBudget -= 1;
        state.visionUsed += 1;
        parts.push({ type: "text", text: anchorMarkdown(block.assetId, label) });
        parts.push({ type: "image_url", image_url: { url: dataUrl } });
        continue;
      }
    }

    parts.push({ type: "text", text: placeholderFor(block, options) });
  }

  // Collapse only when every part is text; an unknown block type must stay a
  // block so nothing is silently dropped.
  var allText = parts.every(function (part) { return part && part.type === "text"; });
  if (allText) {
    var joined = parts.map(function (part) { return part.text; }).join("\n");
    var copy = {};
    Object.keys(message).forEach(function (key) { copy[key] = message[key]; });
    copy.content = joined;
    return copy;
  }

  var out = {};
  Object.keys(message).forEach(function (key) { out[key] = message[key]; });
  out.content = parts;
  return out;
}

// The most recent `limit` anchored asset ids, newest first.  The messages are
// walked oldest -> newest when the parts are built, so without this the per-turn
// byte budget would be spent on the *oldest* pictures and the figure the lesson
// just reached would never reach the model.
function newestAnchorIds(messages, limit) {
  var out = [];
  if (!(limit > 0)) return out;
  var re = new RegExp(ASSET_ANCHOR_SOURCE, "g");
  for (var i = messages.length - 1; i >= 0 && out.length < limit; i -= 1) {
    var content = messages[i] && messages[i].content;
    var ids = [];
    if (typeof content === "string") {
      re.lastIndex = 0;
      var match;
      while ((match = re.exec(content)) !== null) ids.push(match[1] || match[2]);
    } else if (Array.isArray(content)) {
      content.forEach(function (block) {
        if (isRecord(block) && typeof block.assetId === "string") ids.push(block.assetId);
      });
    }
    for (var j = ids.length - 1; j >= 0 && out.length < limit; j -= 1) out.push(ids[j]);
  }
  return out;
}

// messages: array of {role, content}.  Restored/dropped fields are preserved.
function messagesToLlmInput(messages, options) {
  var list = Array.isArray(messages) ? messages : [];
  var state = { options: resolveOptions(options), visionBudget: 0, visionUsed: 0, visionAllow: null };
  state.visionBudget = state.options.textOnly ? 0 : state.options.maxImagesPerTurn;
  if (!state.options.textOnly && state.options.visionEnabled) {
    state.visionAllow = new Set(newestAnchorIds(list, state.options.maxImagesPerTurn));
  }
  var out = list.map(function (message) { return messageToLlmInput(message, state); });
  out.visionUsed = state.visionUsed;
  return out;
}

// True when any message carries a structured content array (i.e. the value did
// not come from a legacy plain-text conversation).
function hasBlocks(messages) {
  return (Array.isArray(messages) ? messages : []).some(function (message) {
    return isRecord(message) && Array.isArray(message.content);
  });
}

// Flattens one content value to text only.  Used by the non-chat LLM call sites
// that must never emit a multimodal part.
function blocksToText(content, options) {
  var merged = resolveOptions(options);
  merged.visionEnabled = false;
  merged.textOnly = true;
  var message = { role: "user", content: content };
  return messageToLlmInput(message, { options: merged, visionBudget: 0, visionUsed: 0 }).content;
}

// Builds an `resolveImage` callback that pulls bytes straight from the globals
// server.js installs.  Living here lets the compiled chat route pass a single
// expression instead of re-implementing store lookups inside a webpack bundle.
// Prefers the 256px sharp thumbnail (far cheaper for the gateway) and never
// throws: an unreadable asset degrades to the placeholder.
function createGlobalImageResolver(options) {
  options = isRecord(options) ? options : {};
  var preferThumb = options.preferThumb !== false;
  var cache = new Map();
  return function (assetId) {
    if (typeof assetId !== "string" || !assetId) return null;
    if (cache.has(assetId)) return cache.get(assetId);
    var out = null;
    try {
      var store = global.__ASSETS__;
      var index = global.__ASSETS_INDEX__;
      if (store && index) {
        var fs = global.__FS__ || require("fs");
        var scope = {
          accountId: options.accountId,
          profileId: options.profileId,
          worldId: options.worldId,
          projectRoot: options.projectRoot,
        };
        var record = index.get(assetId, scope);
        if (record) {
          var variant = preferThumb && record.thumb ? "thumb" : null;
          var file = store.readAssetFile(assetId, variant, scope);
          var buffer = fs.readFileSync(file.path);
          out = { base64: buffer.toString("base64"), mimeType: file.contentType };
        }
      }
    } catch (_) {
      out = null;
    }
    cache.set(assetId, out);
    return out;
  };
}

// Builds a `resolveRecord` callback that looks asset records up through the
// injected memory index.  Needed for the string-anchor path regardless of the
// vision switch: flattening "[图片: <caption>]" requires the record, not just
// the bytes.  Never throws; an unknown id resolves to null (placeholder).  An
// explicit `accountId` (a caller outside a request context) wins over the
// ambient account, so the same scope always resolves the same world.
function createGlobalRecordResolver(options) {
  options = isRecord(options) ? options : {};
  var cache = new Map();
  return function (assetId) {
    if (typeof assetId !== "string" || !ASSET_ID_RE.test(assetId)) return null;
    if (cache.has(assetId)) return cache.get(assetId);
    var record = null;
    try {
      var index = global.__ASSETS_INDEX__;
      if (index) {
        record = index.get(assetId, {
          accountId: options.accountId,
          profileId: options.profileId,
          worldId: options.worldId,
          projectRoot: options.projectRoot,
        }) || null;
      }
    } catch (_) {
      record = null;
    }
    cache.set(assetId, record);
    return record;
  };
}

// Builds the per-turn "[可用插图]" prompt block.  The model cannot invent an
// asset id, so if the tutor is ever expected to put a figure *into* its reply the
// ids have to travel in the prompt.  This conversation's figures come first; the
// rest of the world's newest fill the remaining slots, because a figure captured
// in an earlier chat is just as citable and an id resolves world-wide.
// Returns "" when the world has no figure at all.
var CATALOGUE_MAX = 12;
function figureCatalogue(input) {
  input = isRecord(input) ? input : {};
  var currentBook = textOf(input.textbookId, 60);
  // A record from a different textbook than the chat's own: still citable, but labelled.
  function foreignBook(record) {
    var book = record && record.ref && textOf(record.ref.bookId, 60);
    return !!(currentBook && book && book !== currentBook);
  }
  var index = global.__ASSETS_INDEX__;
  var conversationId = textOf(input.conversationId);
  if (!index || typeof index.list !== "function") return figureOrderGuide(input);
  var scope = {
    accountId: input.accountId,
    profileId: input.profileId,
    worldId: input.worldId,
    projectRoot: input.projectRoot,
  };
  function list(filter) {
    try {
      return index.list(filter, scope) || [];
    } catch (_) {
      return [];
    }
  }
  function getRecord(id) {
    try {
      return typeof index.get === "function" ? index.get(id, scope) : null;
    } catch (_) {
      return null;
    }
  }
  var records = [];
  var seen = new Set();
  function add(record) {
    if (!record || record.deleted || !record.id || seen.has(record.id) || records.length >= CATALOGUE_MAX) return;
    seen.add(record.id);
    records.push(record);
  }
  // 1) what this conversation is literally looking at right now (newest first),
  //    otherwise a just-pasted screenshot could be seen but never cited back.
  if (Array.isArray(input.messages)) {
    newestAnchorIds(input.messages, CATALOGUE_MAX).forEach(function (id) { add(getRecord(id)); });
  }
  // 2) figures captured into this conversation
  if (conversationId) list({ kind: "textbook-figure", conversationId: conversationId, limit: CATALOGUE_MAX }).forEach(add);
  // 3) the world's newest figures — same book first, other books only as labelled filler:
  //    a web-deck crop listed beside a textbook crop is otherwise indistinguishable, and
  //    the model then cites the wrong book (seen live: a flex-shrink page in a 编译原理 chat).
  if (records.length < CATALOGUE_MAX) {
    var pool = list({ kind: "textbook-figure", limit: CATALOGUE_MAX * 2 });
    pool.filter(function (record) { return !foreignBook(record); }).forEach(add);
    if (records.length < CATALOGUE_MAX) pool.forEach(add);
  }
  if (!records.length) return figureOrderGuide(input);
  var en = "english" === input.lang;
  var lines = [en ? "## Figures you can cite" : "## 可用插图"];
  lines.push(en
    ? "You may put these pictures into your reply by copying the anchor exactly; the client renders it as a click-to-zoom thumbnail. Pictures in the transcript appear in the same form, so you can reuse their ids too. Cite one only when it belongs to what you are explaining."
    : "可以把这些图放进回复里：原样复制下面的锚点即可，客户端会渲染成可点开放的缩略图；对话里出现的图也是同样的写法，可以照样回引。只在插图确实对应当前讲解时才引用，不要每轮都贴。");
  records.forEach(function (record) {
    var page = record.ref && Number(record.ref.page);
    var hasPage = Number.isFinite(page) && page > 0;
    var foreign = foreignBook(record);
    var caption = textOf(record.caption, 60) || textOf(record.ocrText, 40);
    var alt = hasPage ? (en ? "figure p." + page : "图 p." + page) : record.kind === "screenshot" ? (en ? "screenshot" : "截图") : (en ? "figure" : "图");
    var head = hasPage ? (en ? "page " + page + ": " : "第 " + page + " 页：")
      : record.kind === "screenshot" ? (en ? "screenshot: " : "截图：") : "";
    lines.push("- " + head + anchorMarkdown(record.id, alt) +
      (caption ? (en ? " (" + caption + ")" : "（" + caption + "）") : "") +
      (foreign ? (en ? " · another book" : " · 另一本书") : ""));
  });
  return lines.join("\n") + "\n\n" + figureOrderGuide(input);
}

// How to *order* a figure that does not exist yet.  Emitted even when the world
// has no figure at all, because ordering is exactly the empty case.  Materializer:
// lib/assets/intents.js (runs on the conversation write path).
function figureOrderGuide(input) {
  var en = "english" === input.lang;
  var textbookId = textOf(input.textbookId, 60);
  if (en) {
    return [
      "## Ordering a figure (when + how)",
      "Do order one: when explaining a sequence, a state machine, a hierarchy, a flow or axes — something that reads badly as prose — lead with the figure instead of waiting to be asked.",
      "Whenever you mention a figure or table from the book, crop it inline right there (`book://p<page>` is enough — drop the rect and the server boxes the figure for you; add `#x0,y0,x1,y1` only when you know roughly where it sits) — do not just write \"see figure X\".",
      "Do not: plain definitions, formula derivations, things one sentence settles; and not on every single turn.",
      "1. The textbook already shows it → crop it (a real figure beats a redrawn one): \`![figure 12-7a call/return](book://p174#0.08,0.12,0.46,0.55)\`",
      "   - the rect is page-relative 0..1 corners (x0,y0,x1,y1, origin top-left); omit \`#…\` and the server boxes the figure for you; " +
        (textbookId ? "\`book://" + textbookId + "/p174\` names the current book explicitly" : "the current book is the default"),
      "2. It is not in the book, or it is abstract (UML, sequence, state machine, flow, axes) → draw it: a fenced \`\`\`svg block, first line \`<!-- title: … -->\`, a \`viewBox\`, no \`<script>\`, under 96 KB.",
      "3. If the catalogue below already carries the id, cite it (\`![alt](asset://ast_…)\`) instead of ordering a duplicate; at most 4 new figures per turn.",
      "Note: a figure already shown in your history appears as \`![alt](asset://ast_…)\` — copy that anchor to show it again; the bare \`[图片: …]\` text is only for the case with no id.",
      "Self-check: whenever your reply says \"figure X-Y\" or \"table X-Y\", that same passage must carry a \`book://\` or \`asset://\`; the only exception is a figure outside the window whose page you do not know — call read_textbook_pages first, then crop.",
    ].join("\n");
  }
  return [
    "## 插图下单（什么时候配 + 怎么下单）",
    "该配：讲时序、状态机、层次、流程、坐标这类“光靠说说不清”的结构时，主动配一张，不必等学习者开口。",
    "提到教材上的某张图/表时，顺手把它裁出来贴进正文（`book://p<页>` 即可，矩形拿不准就省略——服务器会用视觉自动框到那张图；只有知道大致位置时才写 `#x0,y0,x1,y1`），不要只写「见图 X」。",
    "不必配：纯定义、公式推导、一句话讲得清的，保持文字；也不要每轮都配。",
    "1. 教材这一窗口本来就有对应插图 → 裁它（教材原图比自绘可信）：\`![图 12-7a 调用/返回模式](book://p174#0.08,0.12,0.46,0.55)\`",
    "   - 坐标是页内比例 0..1 的左上/右下角（x0,y0,x1,y1，左上原点）；拿不准就省略 \`#…\`，服务器会自动框到那张图；" +
      (textbookId ? "要指名当前书可写 \`book://" + textbookId + "/p174\`" : "不写书名则默认当前教材"),
    "2. 教材没有、或本来就是抽象结构（UML、时序、状态机、流程、坐标轴）→ 自己画：用 \`\`\`svg 围栏，首行写 \`<!-- title: … -->\`，必须带 \`viewBox\`、不用 \`<script>\`、不超过 96KB。",
    "3. 下面的目录里已有现成 id 就直接引用 \`![alt](asset://ast_…)\`，不要重复下单；每轮最多 4 张新图。",
    "注意：历史里出现过的图，本来就是 `![标题](asset://ast_…)` 这个形式——要重现某张图，直接照抄那个锚点；只有取不到 id 时才写成 `[图片: …]` 的简写，别把简写当正式写法。",
    "自查：只要正文写了「图 X-Y」或「表 X-Y」，同一处附近就必须跟一个 `book://` 或 `asset://`；唯一例外是那张图在窗口外、你也不知道页码——那就先 read_textbook_pages 定位，再裁。",
  ].join("\n");
}

// Reads the operator switchboard for the asset layer.  Deliberately its own
// `assets` namespace rather than reusing `set.vision`, which is already the
// vision *model* role block.  Defaults to OFF so a stock install behaves exactly
// like the pre-asset build until someone opts in.
function optionsFromGlobals(scope) {
  var settings = (global.__SOCRATOPIA_SET__ || {}).assets ||
    (global.__SOCRATOPIA_SETTINGS__ || {}).assets || {};
  var visionEnabled = settings.visionEnabled === true || settings.visionEnabled === "true";
  var options = {
    visionEnabled: visionEnabled,
    maxImagesPerTurn: settings.maxImagesPerTurn,
    maxImageBytes: settings.maxImageBytes,
    ocrThreshold: settings.ocrThreshold,
    resolveRecord: createGlobalRecordResolver(scope),
    resolveImage: null,
  };
  if (visionEnabled) {
    options.resolveImage = createGlobalImageResolver({
      accountId: scope && scope.accountId,
      profileId: scope && scope.profileId,
      worldId: scope && scope.worldId,
      preferThumb: true,
    });
  }
  return options;
}

module.exports = {
  DEFAULTS: DEFAULTS,
  messagesToLlmInput: messagesToLlmInput,
  hasBlocks: hasBlocks,
  blocksToText: blocksToText,
  figureCatalogue: figureCatalogue,
  figureOrderGuide: figureOrderGuide,
  createGlobalImageResolver: createGlobalImageResolver,
  createGlobalRecordResolver: createGlobalRecordResolver,
  optionsFromGlobals: optionsFromGlobals,
  _internals: {
    reliableText: reliableText,
    recordLabel: recordLabel,
    stringToLlmInput: stringToLlmInput,
    imagePayload: imagePayload,
    dataUrlBytes: dataUrlBytes,
    isSvgBlock: isSvgBlock,
    resolveOptions: resolveOptions,
  },
};
