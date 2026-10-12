// lib/assets/intents.js — turns a *figure order* inside an assistant message into a
// real asset, so the tutor can order a figure the way it orders prose.
//
// The model writes markdown-native orders that stay readable if materialization
// fails:
//
//   ![图 12-7a 调用/返回模式](book://<textbookId>/p174#0.08,0.12,0.46,0.55)   crop the textbook//   ```svg                                                                    draw it yourself
//   <svg viewBox="0 0 400 200">…</svg>
//   ```
//
// Materialization replaces the order with `![alt](asset://ast_<hex>)`.  It runs on
// the conversation write path (POST /api/conversations), so:
//   * the stored message is the resolved form (and the next turn's history shows
//     the tutor its own figure as an image part),
//   * the client may keep sending the unresolved order — every save re-resolves,
//     and the lookups below make that cheap and idempotent.
//
// Nothing here may throw into the turn: a failed order degrades to readable text.
"use strict";

var store = require("./store.js");

var MAX_ORDERS_PER_MESSAGE = 4;
var MAX_SVG_BYTES = 96 * 1024;
var CROP_MAX_WIDTH = 1400;
var locate = require("./locate-figure.js");

// Operator switches.  assets.boxMode: "geometry" (default) snaps the box to the caption and the
// ink; "vision" keeps the old model-regression path; "off" trusts whatever the model wrote.
// assets.locateFigures === false is the older spelling of "no vision locate".
function boxMode() {
  var block = (global.__SOCRATOPIA_SET__ || {}).assets || (global.__SOCRATOPIA_SETTINGS__ || {}).assets || {};
  if (block.locateFigures === false || block.locateFigures === "false") return "off";
  var mode = String(block.boxMode || "geometry").toLowerCase();
  return mode === "vision" || mode === "off" || mode === "geometry" ? mode : "geometry";
}
function figureLocateEnabled() {
  return boxMode() !== "off";
}
function figureGeometryEnabled() {
  return boxMode() === "geometry";
}

// The cached OCR lines for the page plus an ink profile; null when the page has no boxes yet.
async function geometryBox(pdfPath, page, hint, rough, pageRender) {
  var lines = await require("./page-lines.js").pageLines({ pdfPath: pdfPath, page: page });
  if (!lines || !lines.lines.length) return null;
  var figureBox = require("./figure-box.js");
  var ink = null;
  try {
    // Render big enough that ink columns are meaningful; renderPageRegion caches the raster.
    var rendered = await pageRender.renderPageRegion(pdfPath, page, null, { maxWidth: 1100 });
    var made = await require("./figure-ink.js").createInk(rendered.png);
    ink = made ? made.ink : null;
  } catch (error) {
    ink = null;
  }
  return figureBox.snapBox({ lines: lines.lines, hint: hint, rough: rough, ink: ink });
}
var MIN_SIDE = 0.03;
var MAX_AREA = 0.6;

// ![alt](book://<textbookId>/p<page>#x0,y0,x1,y1) — the id and the rect are optional,
// so the short form `book://p174#…` means "the book we are reading now".  The rect
// is the same normalized corner box the marquee flow and lib/pdf-page-render use.
var BOOK_ORDER_RE = /!\[([\s\S]*?)\]\(\s*book:\/\/(?:([^/\s)#]+)\/)?p(\d{1,5})(?:#([0-9.,\s]+))?\s*\)/g;
var SVG_FENCE_RE = /```svg[ \t]*\r?\n([\s\S]*?)```/g;
var SVG_TITLE_RE = /<!--\s*title:\s*([^>]*?)\s*-->/i;

function log(message) {
  console.log("[assets] " + message);
}

function warn(message) {
  console.warn("[assets] " + message);
}

function parseRect(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  var parts = raw.split(",").map(function (piece) { return Number(piece.trim()); });
  if (parts.length !== 4) return { invalid: "rect needs 4 numbers" };
  if (parts.some(function (value) { return !Number.isFinite(value); })) return { invalid: "rect has a non-number" };
  var box = [parts[0], parts[1], parts[2], parts[3]];
  if (box.some(function (value) { return value < 0 || value > 1; })) return { invalid: "rect values outside 0..1" };
  var width = box[2] - box[0];
  var height = box[3] - box[1];
  if (width <= 0 || height <= 0) return { invalid: "rect has no area" };
  if (width < MIN_SIDE || height < MIN_SIDE) return { invalid: "rect thinner than 3%" };
  return { value: box };
}

// A drawn diagram must survive being served as <img src>: no scripts, a viewBox so
// it scales, and a small size so the whole thing stays inline.
function validateSvgSource(source) {
  var svg = String(source || "").trim();
  if (!svg) return { invalid: "empty" };
  if (!/^<svg[\s>]/i.test(svg)) return { invalid: "not an <svg> root" };
  if (!/<\/svg>\s*$/i.test(svg)) return { invalid: "unclosed <svg>" };
  if (!/\sviewBox\s*=/.test(svg)) return { invalid: "no viewBox" };
  if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES) return { invalid: "larger than 96 KB" };
  if (/<script[\s>]/i.test(svg)) return { invalid: "contains <script>" };
  return { value: svg };
}

function worldDirOf(scope) {
  try {
    return store.resolveScope(scope).worldDir;
  } catch (_) {
    return null;
  }
}

// `book://p174` omits the id: fall back to the book this conversation reads, or —
// when the world has exactly one textbook — to that one.
function textbookIdFor(ctx, explicit) {
  if (explicit) return explicit;
  if (ctx.textbookId) return ctx.textbookId;
  var worldDir = worldDirOf(ctx.scope);
  if (!worldDir) return null;
  try {
    var fs = require("fs");
    var names = fs.readdirSync(require("path").join(worldDir, "textbooks")).filter(function (name) {
      return !name.startsWith(".");
    });
    var withPdf = names.filter(function (name) {
      try {
        return require("fs").readdirSync(require("path").join(worldDir, "textbooks", name))
          .some(function (file) { return /\.pdf$/i.test(file); });
      } catch (_) {
        return false;
      }
    });
    return withPdf.length === 1 ? withPdf[0] : null;
  } catch (_) {
    return null;
  }
}

function anchorMarkdown(alt, id) {
  var label = String(alt || "").replace(/[[\]]/g, "").trim() || "插图";
  return "![" + label + "](asset://" + id + ")";
}

// Resolves one `book://` order.  Returns the replacement markdown, or null when the
// order cannot be honoured (the caller keeps the original text).
async function resolveBookOrder(order, ctx) {
  var alt = order.alt;
  var textbookId = textbookIdFor(ctx, order.textbookId);
  var page = order.page;
  var rect = order.rect;

  if (!textbookId) throw new Error("no current textbook to crop from");
  if (rect && rect.invalid) {
    warn("book order p" + page + " rejected (" + rect.invalid + "); using the whole page");
    rect = null;
  }

  // A textbook-figure ref always carries a rect, so "whole page" is the full box.
  var box = rect && rect.value ? rect.value : [0, 0, 1, 1];

  var pageRender = require("../pdf-page-render.js");
  var worldDir = worldDirOf(ctx.scope);
  if (!worldDir) throw new Error("no world directory for scope");

  // resolveTextbookPdf accepts the textbook id, the pdf name, or a path.
  var target = pageRender.resolveTextbookPdf(worldDir, textbookId);
  var pdfPath = typeof target === "string" ? target : target && (target.path || target.pdfPath);
  if (!pdfPath) throw new Error("textbook " + textbookId + " has no pdf");

  // The tutor usually knows *that* a figure is there but not its box; a whole-page crop of a
  // dense scan is unreadable.  Ask the vision locator for a tight box (one small call, cached,
  // and only when the model did not pin one).  Any failure keeps the whole page.
  var boxSource = "model";
  if (figureGeometryEnabled()) {
    try {
      var snapped = await geometryBox(pdfPath, page, alt, rect ? box : null, pageRender);
      if (snapped && snapped.rect) {
        box = snapped.rect;
        rect = { value: box };
        boxSource = "geometry:" + snapped.reason + (snapped.caption ? "/" + snapped.caption : "");
        warn("book order p" + page + " box snapped " + JSON.stringify(box) + " via " + boxSource + (alt ? " (" + String(alt).slice(0, 24) + ")" : ""));
      } else if (snapped) {
        warn("book order p" + page + " geometry skipped: " + snapped.reason);
      }
    } catch (error) {
      warn("book order p" + page + " geometry threw: " + ((error && error.message) || error));
    }
  }
  if (boxSource === "model" && figureLocateEnabled() && locate.isWholePage(box)) {
    try {
      var found = await locate.locateFigure(null, { pdfPath: pdfPath, page: page, hint: alt, timeoutMs: 12000 });
      if (found && found.rect) {
        box = found.rect;
        rect = { value: box };
        boxSource = "vision";
        warn("book order p" + page + " box located: " + JSON.stringify(box) + (alt ? " (" + String(alt).slice(0, 30) + ")" : ""));
      } else {
        warn("book order p" + page + " locate skipped: " + ((found && found.reason) || "unknown"));
      }
    } catch (error) {
      warn("book order p" + page + " locate threw: " + ((error && error.message) || error));
    }
  }

  var refKeyed = { textbookId: textbookId, page: page, rect: box };
  var existing = store.findFigureByRef(refKeyed, ctx.scope);
  if (existing) return anchorMarkdown(alt, existing.id);

  var rendered = await pageRender.renderPageRegion(pdfPath, page, box, { maxWidth: CROP_MAX_WIDTH });  var created = await store.createAsset({
    kind: "textbook-figure",
    ref: refKeyed,
    boxSource: boxSource,
    pngBuffer: rendered.png,
    caption: alt || null,
    scope: ctx.scope,
  });
  return anchorMarkdown(alt, created.assetId);
}

// Resolves one ```svg fence into an asset + anchor.
async function resolveSvgOrder(order, ctx) {
  var check = validateSvgSource(order.source);
  if (check.invalid) {
    warn("svg order rejected (" + check.invalid + ")");
    return null;
  }
  var created = await store.createAsset({
    kind: "svg",
    svgSource: check.value,
    svgTitle: order.title || null,
    caption: order.title || null,
    scope: ctx.scope,
  });
  return anchorMarkdown(order.title || "示意图", created.assetId);
}

// Rewrites every order in one message body.  Never throws.
async function materializeText(text, ctx) {
  if (typeof text !== "string" || text.indexOf("book://") < 0 && text.indexOf("```svg") < 0) return text;
  ctx = ctx || {};
  ctx.scope = ctx.scope || { profileId: ctx.profileId, worldId: ctx.worldId, projectRoot: ctx.projectRoot };
  ctx.attempted = ctx.attempted || { count: 0 };

  var out = text;
  var bookOrders = [];
  BOOK_ORDER_RE.lastIndex = 0;
  var match;
  while ((match = BOOK_ORDER_RE.exec(text)) !== null) {
    var rect = parseRect(match[4]);
    bookOrders.push({ full: match[0], alt: match[1], textbookId: match[2], page: Number(match[3]), rect: rect });
  }
  for (var i = 0; i < bookOrders.length; i += 1) {
    if (ctx.attempted.count >= MAX_ORDERS_PER_MESSAGE) break;
    ctx.attempted.count += 1;
    try {
      var replacement = await resolveBookOrder(bookOrders[i], ctx);
      if (replacement) out = out.replace(bookOrders[i].full, replacement);
    } catch (error) {
      warn("book order p" + bookOrders[i].page + " failed: " + (error && (error.message || error.code)));
    }
  }

  var svgOrders = [];
  SVG_FENCE_RE.lastIndex = 0;
  while ((match = SVG_FENCE_RE.exec(out)) !== null) {
    var body = match[1];
    var titleMatch = SVG_TITLE_RE.exec(body);
    svgOrders.push({
      full: match[0],
      title: titleMatch ? titleMatch[1] : "",
      source: titleMatch ? body.replace(SVG_TITLE_RE, "").trim() : body.trim(),
    });
  }
  for (var j = 0; j < svgOrders.length; j += 1) {
    if (ctx.attempted.count >= MAX_ORDERS_PER_MESSAGE) break;
    ctx.attempted.count += 1;
    try {
      var svgReplacement = await resolveSvgOrder(svgOrders[j], ctx);
      if (svgReplacement) out = out.replace(svgOrders[j].full, svgReplacement);
    } catch (error) {
      warn("svg order failed: " + (error && (error.message || error.code)));
    }
  }
  return out;
}

// Walks a conversation object in place: only assistant messages carry orders, and
// only string content (a structured/image part list has nowhere to put markdown).
async function materializeConversation(conversation, ctx) {
  if (!conversation || !Array.isArray(conversation.messages)) return { rewritten: 0 };
  ctx = ctx || {};
  var scope = {
    projectRoot: ctx.projectRoot,
    profileId: ctx.profileId || conversation.profileId,
    worldId: ctx.worldId || conversation.worldId,
    accountId: ctx.accountId,
  };
  var attempted = { count: 0 };
  var messageCtx = {
    scope: scope,
    attempted: attempted,
    textbookId: ctx.textbookId || conversation.textbookId || null,
  };
  var rewritten = 0;
  for (var i = 0; i < conversation.messages.length; i += 1) {
    var message = conversation.messages[i];
    if (!message || message.role !== "assistant" || typeof message.content !== "string") continue;
    if (message.content.indexOf("book://") < 0 && message.content.indexOf("```svg") < 0) continue;
    var before = message.content;
    message.content = await materializeText(before, messageCtx);
    if (message.content !== before) rewritten += 1;
  }
  if (rewritten) log("materialized figure orders in " + rewritten + " message(s)");
  return { rewritten: rewritten };
}

// Convenience for tests / one-off calls.
function materialize(messageOrText, ctx) {
  if (typeof messageOrText === "string") return materializeText(messageOrText, ctx);
  return materializeConversation(messageOrText, ctx);
}

module.exports = {
  materialize: materialize,
  materializeText: materializeText,
  materializeConversation: materializeConversation,
  parseRect: parseRect,
  validateSvgSource: validateSvgSource,
  MAX_ORDERS_PER_MESSAGE: MAX_ORDERS_PER_MESSAGE,
  BOOK_ORDER_RE: BOOK_ORDER_RE,
  SVG_FENCE_RE: SVG_FENCE_RE,
};
