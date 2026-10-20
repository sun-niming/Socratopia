"use strict";

// Static smoke test for the selection dock (public/selection-dock.js) and its
// injection point. Mirrors lib/close-reading/ui-smoke-test.js: no app, no network.

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var serverRoot = path.resolve(__dirname, "..");
var serverDir = serverRoot;

var html = fs.readFileSync(path.join(serverDir, ".next", "server", "app", "index.html"), "utf8");
assert(html.includes("/selection-dock.js?v="), "index.html must load the dock");
assert(
  html.indexOf("/asset-capture.js") < html.indexOf("/selection-dock.js"),
  "dock loads after asset-capture (scope helper)"
);

var dock = fs.readFileSync(path.join(serverRoot, "public", "selection-dock.js"), "utf8");

// Runtime contract: never own an Audio element, always go through the voice module.
var code = dock.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert(!code.includes("new Audio("), "dock must not construct Audio");
assert(!code.includes("/api/tts-audio"), "dock must not fetch cached audio");
assert(dock.includes("__SOCRATOPIA_VOICE__"), "dock reads the published voice module");
assert(dock.includes(".speak("), "dock calls the shared speak()");
assert(dock.includes("voicePlayer.stop()"), "dock stops through the shared player");

[
  "data-socratopia-selection-dock",
  "data-socratopia-selection-action",
  "data-socratopia-source-dialog",
  "data-socratopia-source-image",
  "data-socratopia-source-prev",
  "data-socratopia-source-next",
  "data-socratopia-source-counter",
  "data-socratopia-source-close",
  "getSelection",
  "selectionchange",
  "textFromRange",
  "application/x-tex",
  "chat-input-textarea",
  "HTMLTextAreaElement.prototype",
  "insertText",
  "/api/textbook?page-image=1",
  "readingRange",
  "totalPages",
  "Escape",
  "explain",
  "companion",
  "speak",
  "source",
  "socratopia:page#",
  "__SOCRATOPIA_SELECTION_DOCK_OPEN_PAGE__",
  "socratopia-page-chip",
  "linkifyPages",
].forEach(function (token) {
  assert(dock.includes(token), "dock missing: " + token);
});

// Four first-wave actions plus a close affordance.
["explain", "companion", "speak", "source"].forEach(function (action) {
  assert(dock.includes('dockButton("' + action + '"'), "missing action button: " + action);
});
assert(dock.includes('setAttribute("data-socratopia-selection-action", "close")'), "missing close button");

// 解释 / 问伙伴 no longer push into the主聊天框: they open a side panel.
[
  "data-socratopia-selection-panel",
  "data-socratopia-panel-close",
  "data-socratopia-panel-quote",
  "data-socratopia-panel-companions",
  "data-socratopia-panel-companion",
  "data-socratopia-panel-input",
  "data-socratopia-panel-answer",
  "data-socratopia-panel-send",
  "data-socratopia-panel-speak",
  "data-socratopia-panel-insert",
  "openPanel(",
  "closePanel(",
  "panelAbort",
  "renderMarkdown",
  "katexPipeline",
  "webpackRequire",
  "companionList",
  "voiceForCompanion",
  "/api/world?profileId=",
  "/api/companion/avatar",
  "copyText",
].forEach(function (token) {
  assert(dock.includes(token), "panel missing: " + token);
});

// Both windows are panes in a resizable split screen (editor-style), not floating
// cards over the reading column: the main column gives up room, a divider drags
// the boundary, and the width survives a reload.
assert(dock.includes("function ensureSplit("), "windows must sit in a split layout");
assert(dock.includes('"socratopia.split.width"'), "split width must persist");
assert(dock.includes("mountPane("), "both windows must mount into the split pane");
assert(dock.includes("data-socratopia-split-tabs"), "the split pane must be tabbed");
assert(dock.includes("teardownSplit"), "closing the last tab must restore the layout");
assert(dock.includes("__socratopiaTabLabel"), "renamed panes must update their tab");
assert(
  dock.includes('panel && panel.style.display !== "none"'),
  "Escape must close only the active pane"
);
assert(!/right:0;bottom:0;width:min/.test(dock), "windows must not be pinned over the column");
assert(dock.includes("clampRect") || dock.includes("Math.max(300"), "split width must stay in bounds");
// The page's own fixed action buttons sit at the viewport edge and would be
// covered by the pane; they have to move with it and come back on teardown.
assert(dock.includes("offsetFloaters("), "fixed page buttons must clear the pane");
assert(dock.includes("data-socratopia-asset-button"), "capture button must be offset");
assert(dock.includes("data-socratopia-figure-button"), "figure button must be offset");
assert(dock.includes("MutationObserver"), "late-mounted buttons must be offset too");

// A blob URL served from asset-capture's `blobCache` outlives the object URL, so
// revoking it directly leaves a dead cached string: the second open of the same
// page decodes nothing and pops "页图加载失败". Release has to go through the
// module that owns the cache, and the outgoing page has to stay painted until the
// incoming one has decoded.
assert(dock.includes("_releaseBlob"), "blobs must be released through asset-capture");
assert.strictEqual(
  (dock.match(/revokeObjectURL/g) || []).length,
  1,
  "dock must only revoke directly as the no-cache fallback"
);
assert(dock.includes("keptPages"), "paged-in blob buffers have to be retained");
assert(dock.includes('addEventListener("load", settle)'), "the page swap must wait for decode");
assert(dock.includes("function warm("), "neighbouring pages must be prefetched");
var capture = fs.readFileSync(path.join(serverRoot, "public", "asset-capture.js"), "utf8");
assert(capture.includes("api._releaseBlob = releaseBlob"), "asset-capture must expose blob release");

// The panel turn must stay off the main conversation (no conversationId → no
// auto-advance / continuity replay) and must not touch the main message list.
assert(dock.includes('"/api/chat"'), "panel must call the chat route");
assert(
  !/conversationId:\s*scope\.conversationId/.test(dock),
  "panel request must omit conversationId"
);

// 问伙伴 has to be able to name a companion: slot id + instance + candidate.
assert(dock.includes('character: panelState.mode === "companion"'), "panel must bind a character");
assert(dock.includes("body.companionInstanceId"), "panel must send the chosen instance");
assert(dock.includes("body.candidateId"), "panel must send the chosen candidate");

// Teaching language must follow the world, not the UI chrome, and never be a
// hardcoded constant. The quote block has to go through the markdown renderer
// so the selected formulas show as formulas instead of raw `$...$`.
assert(dock.includes("teachingLanguage: teachingLanguage(scope)"), "teaching language must come from the world");
assert(dock.includes('"/api/world?profileId="'), "world language has to be fetched");
assert(dock.includes("renderMarkdown(selection.text, quote)"), "panel quote must render markdown");
assert(dock.includes("renderMarkdown(quoted, quote)"), "source quote must render markdown");

// The dock has to survive a scroll while the selection is still on screen
// (dragging a selection and smooth scrolling both fire scroll), but still get
// out of the way once the selection leaves the viewport. Its rect also has to
// be clamped into the viewport: a selection scrolled out of view returns a
// negative `getBoundingClientRect().top` and would park the dock off-screen.
(function () {
  var at = dock.indexOf('window.addEventListener("scroll"');
  var body = dock.slice(at, dock.indexOf('window.addEventListener("resize"', at));
  assert(body.includes("box.bottom < 0 || box.top > window.innerHeight"), "scroll must only hide off-screen");
  assert(body.includes("placeDock(dockSelection.range)"), "scroll must re-place the dock");
  assert(
    dock.includes("top = Math.max(EDGE_PAD, Math.min(top, viewportH - height - EDGE_PAD))"),
    "dock top must be clamped into the viewport"
  );
})();

// Guard flag so a double injection cannot bind twice.
assert(dock.includes("__SOCRATOPIA_SELECTION_DOCK__"), "dock needs an idempotence guard");

// The page bundles must publish the handles the dock depends on.
var bundleRoot = path.join(serverDir, ".next", "static", "chunks", "app");
[
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js",
].forEach(function (name) {
  var bundle = fs.readFileSync(path.join(bundleRoot, name), "utf8");
  assert(bundle.includes("window.__SOCRATOPIA_VOICE__=el"), name + " voice handle");
  assert(bundle.includes("window.__SOCRATOPIA_SPEECH_VOICE__=eU"), name + " voice key handle");
  assert(bundle.includes("socratopia:page#"), name + " page chip renderer");
  assert(bundle.includes("__SOCRATOPIA_SELECTION_DOCK_OPEN_PAGE__"), name + " page chip handler");
});

// The tutor has to emit the chip at all - the convention lives in the prompt.
var route = fs.readFileSync(
  path.join(serverDir, ".next", "server", "app", "api", "chat", "route.js"),
  "utf8"
);
assert(route.includes("socratopia:page#"), "chat route must teach the page-chip convention");
["english", "chinese-traditional", "chinese"].forEach(function (lang) {
  assert(route.indexOf("socratopia:page#") >= 0, lang);
});
assert.strictEqual(
  (route.split("socratopia:page#").length - 1),
  6,
  "chip convention must exist in all three languages (example + target each)"
);

// Bare page references have to become chips even when the model forgets the
// markdown link, and an already-linked chip must not be wrapped twice.
(function () {
  var at = dock.indexOf("function linkifyPages");
  var body = dock.slice(at, dock.indexOf("window.__SOCRATOPIA_SELECTION_DOCK_LINKIFY__", at));
  var fn = new Function(body + "; return linkifyPages;")();
  assert(fn("[p.182]") === "[☰ p.182](socratopia:page#182)", "bare [p.N] must become a chip");
  assert(fn("见 p.12 处") === "见 [☰ p.12](socratopia:page#12) 处", "bare p.N must become a chip");
  assert(fn("☰ p.7") === "[☰ p.7](socratopia:page#7)", "bare ☰ p.N must become a chip");
  assert(fn("[p.186-187]") === "[☰ p.186](socratopia:page#186)", "a page range links to its first page");
  assert(
    fn("已链接 [☰ p.9](socratopia:page#9)") === "已链接 [☰ p.9](socratopia:page#9)",
    "already-linked chip must survive untouched"
  );
})();

// Math has to be lifted out before page linking: the model writes the chip
// straight after the closing `$` (`$c/d/\$$[p.186]`), and `\$` is an escaped
// dollar inside math, not a delimiter.
(function () {
  var at = dock.indexOf("function renderMarkdown");
  var body = dock.slice(at, dock.indexOf("function speakText", at));
  assert(body.includes('.replace(/\\\\\\$/g, esc)'), "escaped dollars must be sentinel-substituted first");
  assert(body.indexOf("linkifyPages(html)") > body.indexOf("/\\$([^$\\n]+?)\\$/g"), "math must be lifted before linking");
  // The model often wraps the closing follow-up question in angle brackets,
  // which markdown would swallow as an HTML tag. Those lines become quotes,
  // but real HTML the model emits has to stay as-is.
  assert(body.includes('html.replace(/^<([^<>\\n][^<>\\n]*)>'), "angle-wrapped follow-up must become a quote");
  assert(body.includes("div|span|br|p|img|a|table"), "real HTML tags must be excluded");
})();

// A ```svg fence is a drawn figure in the message bubble (the bundle's `pre`
// override turns it into a data-URI image); the panel's own pipeline has to do
// the same, or the figure degrades into raw source text.
(function () {
  var at = dock.indexOf("function svgFigure");
  assert(at > 0, "panel must convert svg fences");
  var body = dock.slice(at, dock.indexOf("function katexPipeline", at));
  var fn = new Function("escapeHtml", body + "; return svgFigure;")(function (t) {
    return String(t);
  });
  var figure = fn('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect/></svg>');
  assert(figure.includes('class="socratopia-svg-figure"'), "svg fence must become a figure");
  assert(figure.includes("data:image/svg+xml;base64,"), "svg must be inlined as a data URI");
  assert(figure.includes('width="120"') && figure.includes('height="60"'), "viewBox must size the figure");
  assert(fn("not svg").includes("<pre><code>"), "a non-svg fence must fall back to code");
  // Models never write xmlns; without it a data-URI <img> decodes to naturalWidth 0.
  var src = function (markup) {
    return Buffer.from(fn(markup).split("base64,")[1].split('"')[0], "base64").toString("utf8");
  };
  assert(src('<svg viewBox="0 0 10 10"><rect/></svg>').includes('xmlns="http://www.w3.org/2000/svg"'), "a missing xmlns must be added");
  assert.strictEqual(
    (src('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>').match(/xmlns=/g) || []).length,
    1,
    "xmlns must not be doubled"
  );
  // The title comment must stay in front of the root, never behind it.
  var titled = src('<!-- title: 图 -->\n<svg viewBox="0 0 10 10"><rect/></svg>');
  assert(titled.indexOf("<!-- title:") === 0, "the title comment must stay first");
  assert(titled.indexOf('<svg xmlns=') > 0, "xmlns must land on the svg tag");
  var render = dock.slice(dock.indexOf("function renderMarkdown"), dock.indexOf("function speakText"));
  assert(render.indexOf("svg[^\\n]*\\n") < render.indexOf("/\\\\\\$/g"), "svg fences must be lifted before math");
  assert(render.includes("SOCRSVG"), "svg placeholders must be restored after rendering");
})();

// The panel has to tell the model which page the passage is on and in what
// shape to mark it; the model does not volunteer page numbers on its own.
assert(dock.includes('"/api/reading-context?profileId="'), "panel must resolve the current page");
assert(dock.includes("range.taughtPage || range.startPage"), "page must come from the reading window");
assert(dock.includes("[p."), "page hint must state the expected shape");

// A textarea only holds plain text, so `$I_6$` / tables / ```svg written by
// "insert" arrived as raw source next to a bubble that renders them. The
// composer preview has to reuse the panel's own pipeline, not a second one.
(function () {
  assert(dock.includes("data-socratopia-composer-preview"), "composer needs a preview surface");
  var sync = dock.slice(dock.indexOf("function syncComposerPreview"), dock.indexOf("var style = document.createElement"));
  assert(sync.includes("renderMarkdown(value, node)"), "preview must use the shared markdown pipeline");
  assert(sync.includes("field.parentElement.parentElement"), "preview must sit above the composer row");
  assert(dock.includes('document.addEventListener("input"'), "typing must refresh the preview");
  assert(sync.includes("PREVIEW_MARKUP.test(value)"), "plain prose must not force a preview");
})();

console.log("selection dock static smoke: ok");
