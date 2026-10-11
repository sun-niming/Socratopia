// asset-capture-ui-smoke-test.js — covers the frontend half of the asset layer:
// the hand-written public/asset-capture.js companion script (executed against a
// tiny DOM stub) and the two surgical patches in the live page bundle.
//
// Static bundle assertions are unavoidable here: the page chunk is minified
// webpack output with no source maps, so the renderer override can only be
// proven by its shipped shape.
//
// Run by hand (the matrix skips .next/):
//   node resources/server/.next/static/chunks/app/asset-capture-ui-smoke-test.js
"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var APP_DIR = __dirname;
var STATIC_CHUNKS = path.join(APP_DIR, "..");
// app -> chunks -> static -> .next -> resources/server
var SERVER_DIR = path.join(APP_DIR, "..", "..", "..", "..");
var PAGE_CHUNK = path.join(APP_DIR, "page-87daa6ca210ab9dc.js");
var INDEX_HTML = path.join(SERVER_DIR, ".next", "server", "app", "index.html");
var PUBLIC_SCRIPT = path.join(SERVER_DIR, "public", "asset-capture.js");

var results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name: name, ok: true });
    console.log("  PASS  " + name);
  } catch (error) {
    results.push({ name: name, ok: false });
    console.log("  FAIL  " + name);
    console.log("        " + (error && error.stack ? error.stack.split("\n").slice(0, 5).join("\n        ") : error));
  }
}

function parse(file) {
  require("acorn").parse(fs.readFileSync(file, "utf-8"), { ecmaVersion: 2022 });
}

// ---- minimal DOM stub -----------------------------------------------------

function makeElement(tag) {
  var element = {
    tagName: String(tag || "div").toUpperCase(),
    children: [],
    attributes: {},
    listeners: {},
    style: { cssText: "" },
    dataset: {},
    className: "",
    innerHTML: "",
    textContent: "",
    isConnected: false,
    setAttribute: function (name, value) { element.attributes[name] = String(value); },
    getAttribute: function (name) { return element.attributes[name]; },
    appendChild: function (child) { element.children.push(child); child.parentNode = element; return child; },
    removeChild: function (child) {
      element.children = element.children.filter(function (c) { return c !== child; });
      return child;
    },
    remove: function () { if (element.parentNode) element.parentNode.removeChild(element); },
    addEventListener: function (name, fn) { (element.listeners[name] = element.listeners[name] || []).push(fn); },
    removeEventListener: function (name, fn) {
      element.listeners[name] = (element.listeners[name] || []).filter(function (f) { return f !== fn; });
    },
    dispatchEvent: function (event) {
      (element.listeners[event.type] || []).forEach(function (fn) { fn(event); });
      return true;
    },
    focus: function () { element.focused = true; },
    querySelector: function () { return null; },
    getBoundingClientRect: function () { return { x: 0, y: 0, width: 0, height: 0 }; },
    click: function () { element.dispatchEvent({ type: "click", preventDefault: function () {}, stopPropagation: function () {} }); },
  };
  Object.defineProperty(element, "firstChild", {
    configurable: true,
    get: function () { return element.children[0] || null; },
  });
  return element;
}

function makeDom() {
  var body = makeElement("body");
  var head = makeElement("head");
  var documentElement = makeElement("html");
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  var document = {
    readyState: "complete",
    body: body,
    head: head,
    documentElement: documentElement,
    createElement: makeElement,
    querySelector: function (selector) {
      if (selector.indexOf("data-socratopia-asset-button") !== -1) {
        return body.children.filter(function (c) { return c.attributes["data-socratopia-asset-button"]; })[0] || null;
      }
      if (selector.indexOf("data-socratopia-figure-button") !== -1) {
        return body.children.filter(function (c) { return c.attributes["data-socratopia-figure-button"]; })[0] || null;
      }
      if (selector.indexOf("textarea") !== -1) return document.__textarea || null;
      return null;
    },
    addEventListener: function (name, fn) { (document.__listeners[name] = document.__listeners[name] || []).push(fn); },
    removeEventListener: function () {},
    __listeners: {},
    dispatchEvent: function (event) {
      (document.__listeners[event.type] || []).forEach(function (fn) { fn(event); });
      return true;
    },
  };

  function Storage() { this.map = Object.create(null); }
  Storage.prototype.getItem = function (k) { return k in this.map ? this.map[k] : null; };
  Storage.prototype.setItem = function (k, v) { this.map[k] = String(v); };
  Storage.prototype.removeItem = function (k) { delete this.map[k]; };

  var window = {
    document: document,
    sessionStorage: new Storage(),
    localStorage: new Storage(),
    fetch: null,
    HTMLTextAreaElement: function HTMLTextAreaElement() {},
    HTMLInputElement: function HTMLInputElement() {},
    Event: function Event(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); },
    CustomEvent: function CustomEvent(type) { this.type = type; },
    electronAPI: null,
    __SOCRATOPIA_ASSET_CAPTURE__: null,
    addEventListener: function (name, fn) { (window.__listeners[name] = window.__listeners[name] || []).push(fn); },
    removeEventListener: function () {},
    __listeners: {},
    requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: function () { return 0; },
    clearInterval: function () {},
    matchMedia: function () { return { matches: false }; },
  };
  [window.HTMLTextAreaElement, window.HTMLInputElement].forEach(function (Ctor) {
    Object.defineProperty(Ctor.prototype, "value", {
      configurable: true,
      get: function () { return this.__value || ""; },
      set: function (v) { this.__value = String(v); },
    });
  });
  window.window = window;

  return { window: window, document: document, body: body };
}

function loadPublicScript(dom) {
  var source = fs.readFileSync(PUBLIC_SCRIPT, "utf8");
  var sandbox = {
    window: dom.window,
    document: dom.document,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: function () { return 0; },
    clearInterval: function () {},
    requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
    Promise: Promise,
    JSON: JSON,
    Object: Object,
    Array: Array,
    String: String,
    Number: Number,
    Math: Math,
    Error: Error,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
  };
  sandbox.globalThis = sandbox;
  sandbox.window.fetch = dom.window.fetch;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: PUBLIC_SCRIPT });
  return dom.window.__SOCRATOPIA_ASSET_CAPTURE__;
}

// ---- textbook figure helpers (T13d) --------------------------------------

function jsonResponse(body, status) {
  return {
    ok: (status || 200) < 400,
    status: status || 200,
    json: function () { return Promise.resolve(body); },
    text: function () { return Promise.resolve(JSON.stringify(body)); },
    blob: function () { return Promise.resolve({ size: 0 }); },
  };
}

function blobResponse(size) {
  return {
    ok: true,
    status: 200,
    blob: function () { return Promise.resolve({ size: size }); },
    json: function () { return Promise.resolve({}); },
  };
}

function findIn(root, attribute) {
  var hit = null;
  (root.children || []).forEach(function (child) {
    if (hit) return;
    if (child.attributes && child.attributes[attribute] !== undefined) { hit = child; return; }
    hit = findIn(child, attribute);
  });
  return hit;
}

function figureButton(dom) {
  return dom.body.children.filter(function (c) { return c.attributes["data-socratopia-figure-button"]; })[0] || null;
}

function figureDialog(dom) {
  return dom.body.children.filter(function (c) { return c.attributes["data-socratopia-figure-dialog"]; })[0] || null;
}

// A DOM whose fetch answers the four endpoints the figure entry touches, so the
// whole page -> marquee -> POST flow runs without a real server or PDF.
function makeFigureDom(options) {
  options = options || {};
  var dom = makeDom();
  var calls = { posts: [], pageImages: 0, textbooks: 0, readingContext: 0 };
  dom.calls = calls;
  dom.window.URL = { createObjectURL: function (blob) { return "blob:page:" + blob.size; } };
  dom.window.fetch = function (url, init) {
    var method = (init && init.method) || "GET";
    if (method === "POST") {
      calls.posts.push(JSON.parse(init.body));
      return Promise.resolve(jsonResponse({ ok: true, assetId: "ast_0123456789abcdef" }, 201));
    }
    if (url.indexOf("/api/profile") === 0) return Promise.resolve(jsonResponse({ activeProfileId: "p1" }));
    if (url.indexOf("/api/world") === 0) return Promise.resolve(jsonResponse({ active: { worldId: "w1" } }));
    if (url.indexOf("/api/textbook?page-image=1") === 0) {
      calls.pageImages += 1;
      return Promise.resolve(blobResponse(4096));
    }
    if (url.indexOf("/api/textbook?") === 0) {
      calls.textbooks += 1;
      return Promise.resolve(jsonResponse({
        textbooks: [{ id: "book-1" }],
        activeTextbookId: options.activeTextbookId === undefined ? "book-1" : options.activeTextbookId,
      }));
    }
    if (url.indexOf("/api/reading-context") === 0) {
      calls.readingContext += 1;
      return Promise.resolve(jsonResponse({ readingRange: { startPage: 7, endPage: 9, totalPages: 120 }, toc: [] }));
    }
    return Promise.resolve(jsonResponse({ ok: true }));
  };
  return dom;
}

// Opens the dialog and returns its parts, already with a loaded page image.
async function openFigureDialog(dom, api) {
  var promise = api.referenceFigure();
  await flush();
  await flush();
  var dialog = figureDialog(dom);
  assert.ok(dialog, "the figure dialog must open");
  var preview = findIn(dialog, "data-socratopia-figure-preview");
  preview.naturalWidth = 1400;
  preview.naturalHeight = 2000;
  preview.getBoundingClientRect = function () { return { left: 0, top: 0, width: 700, height: 1000 }; };
  assert.strictEqual(typeof preview.onload, "function", "the page image must be wired for loading");
  preview.onload();
  await flush();
  return { promise: promise, dialog: dialog, preview: preview };
}

function clickEvent() {
  return { type: "click", preventDefault: function () {}, stopPropagation: function () {} };
}

// ---- static bundle assertions --------------------------------------------

console.log("asset-capture ui");

test("the shell loads only the live page chunk and references the capture script", function () {
  var html = fs.readFileSync(INDEX_HTML, "utf8");
  var pages = (html.match(/chunks\/app\/page-[a-z0-9]+\.js/g) || []);
  var unique = pages.filter(function (p, i) { return pages.indexOf(p) === i; });
  assert.deepStrictEqual(unique, ["chunks/app/page-87daa6ca210ab9dc.js"],
    "only the live page chunk may be referenced, got " + JSON.stringify(unique));
  assert.ok(html.indexOf('/asset-capture.js?v=') !== -1, "the shell must load /asset-capture.js");
  assert.ok(html.indexOf('/asset-capture.js?v=') < html.indexOf("</head>"), "must be a head script so it boots before the app");
});

test("both frontend files parse", function () {
  parse(PAGE_CHUNK);
  parse(PUBLIC_SCRIPT);
});

test("the shell loads the bumped capture script and the figure entry reuses the marquee", function () {
  var html = fs.readFileSync(INDEX_HTML, "utf8");
  assert.ok(html.indexOf("/asset-capture.js?v=20261010-6") !== -1, "the script query must advance with the file");
  var source = fs.readFileSync(PUBLIC_SCRIPT, "utf8");
  assert.ok(source.indexOf("pickRegionOnImage(img)") !== -1, "the marquee must be reused, not re-implemented");
  assert.ok(source.indexOf("page-image=1") !== -1, "the preview must come from the server's page-image action");
  assert.ok(source.indexOf('kind: "textbook-figure"') !== -1, "the asset kind must be the server-rendered figure");
  assert.ok(source.indexOf("normalizedRect(") !== -1, "the rect must cross normalized, never in pixels");
  assert.strictEqual(source.indexOf("getDocument"), -1, "the frontend still needs no pdfjs");
  assert.ok(source.indexOf("activeTextbookId") !== -1, "visibility must follow the world's active textbook");
});

test("the markdown renderer gained an asset:// img override", function () {
  var t = fs.readFileSync(PAGE_CHUNK, "utf8");
  assert.ok(t.indexOf('img:({src:_s,alt:_alt,node:_nd') !== -1, "img override missing");
  assert.ok(t.indexOf('__SOCRATOPIA_ASSET_URL__') !== -1, "thumbnail URL builder missing");
  // The builder must not be optional: a missing global left the raw asset:// URL,
  // which the browser cannot load, and produced no request at all.
  assert.ok(t.indexOf('||function(_i){return"/api/assets/"') !== -1, "no literal URL fallback");
  // The real root cause: react-markdown's default urlTransform drops unknown
  // protocols, so the component receives NO src while the original URL still lives
  // on the hast node.  Reading node.properties.src is what makes the branch run.
  assert.ok(t.indexOf('_nd&&_nd.properties&&_nd.properties.src') !== -1, "no node.properties.src fallback");
  assert.ok(t.indexOf('_b._beaconOnce("img:"+_id,"img-props"') !== -1, "no img-props breadcrumb");
  assert.ok(t.indexOf(')(_id,"thumb")') !== -1, "thumbnail URL missing");
  assert.ok(t.indexOf("__SOCRATOPIA_ASSET_OPEN__(_id)") !== -1, "click-to-zoom missing");
  assert.ok(t.indexOf('title:"点击放大"') !== -1, "no affordance title");
  assert.ok(t.indexOf('alt:_alt||"图片"') !== -1, "no fallback alt");
  // The non-asset branch must still render an ordinary img, and must not leak the
  // hast node as a node="[object Object]" attribute.
  assert.ok(t.indexOf('(0,a.jsx)("img",{..._ir,src:_s,alt:_alt,loading:"lazy"})') !== -1, "plain img fallback missing");
});

test("asset:// links open the lightbox", function () {
  var t = fs.readFileSync(PAGE_CHUNK, "utf8");
  assert.ok(t.indexOf('0===_h.indexOf("asset://")?(0,a.jsx)("a"') !== -1, "anchor branch missing");
  assert.ok(t.indexOf('_an&&_an.properties&&_an.properties.href') !== -1, "no node.properties.href fallback");
  assert.ok(t.indexOf('__SOCRATOPIA_ASSET_OPEN__(_h.slice(8))') !== -1, "anchor zoom handler missing");
});

test("a ```svg fence renders as a diagram even before the server rewrites it", function () {
  // The live bubble keeps the model's raw fence until the conversation is saved and
  // re-read, so the client renders an inline-svg data URL for `language-svg` blocks.
  var t = fs.readFileSync(PAGE_CHUNK, "utf8");
  assert.ok(t.indexOf('pre:({children:_pc,node:_pn') !== -1, "pre override missing");
  assert.ok(t.indexOf('_cls.indexOf("language-svg")>=0') !== -1, "language-svg detection missing");
  assert.ok(t.indexOf('"data:image/svg+xml;base64,"+window.btoa(unescape(encodeURIComponent(') !== -1,
    "no data-url svg render (must not inline the svg as DOM)");
  assert.ok(t.indexOf('(0,a.jsx)("pre",{..._pr,children:_pc})') !== -1, "non-svg code must fall back to <pre>");
});

test("the message bubble coerces structured content to markdown", function () {
  var t = fs.readFileSync(PAGE_CHUNK, "utf8");
  assert.ok(t.indexOf("Array.isArray(c)?c.map(_mb=>") !== -1, "array coercion missing");
  assert.ok(t.indexOf('"![图片](asset://"+_mb.assetId+")"') !== -1, "image block is not mapped to an anchor");
  assert.ok(t.indexOf('...(n?{preserveLineBreaks:!0}:{isStreaming:o})') !== -1, "prop branches must be preserved");
});

test("the image sweep is quiet by default and toasts are marked", function () {
  // The sweep runs every 1.2s; a toast per newly-found image was pure noise.
  var script = fs.readFileSync(PUBLIC_SCRIPT, "utf8");
  assert.ok(script.indexOf("var HYDRATE_TOAST = false") !== -1, "the sweep toast must default to off");
  // A streaming book:// order renders /api/textbook?page-image=1, which is auth-protected;
  // it only shows up if the sweep hydrates it into a blob like every other image.
  assert.ok(script.indexOf('img[src*="page-image=1"]') !== -1, "book preview images hydrate too");
  assert.ok(script.indexOf('src.indexOf("page-image=1") === -1') !== -1, "book preview urls must pass the /api filter");
  assert.ok(script.indexOf('"data-socratopia-toast"') !== -1, "toasts need a marker so they can be queried");
  var flag = script.indexOf("HYDRATE_TOAST && found > 0");
  assert.ok(flag > 0, "the toast call must sit behind the flag");
});

test("the provenance badge reads kind/page from the meta channel", function () {
  var script = fs.readFileSync(PUBLIC_SCRIPT, "utf8");
  assert.ok(script.indexOf('variant === "meta"') !== -1, "no meta variant on the url builder");
  assert.ok(script.indexOf('api.url(assetId, "meta")') !== -1, "meta fetch must use the scoped url");
  assert.ok(script.indexOf("window.__SOCRATOPIA_ASSET_META__ = api.meta") !== -1, "meta channel not exposed");
  assert.ok(script.indexOf("window.__SOCRATOPIA_ASSET_META_LABEL__ = api.metaLabel") !== -1, "label helper not exposed");
  assert.ok(script.indexOf('"教材 p." + page') !== -1, "a textbook figure must name its page");
  assert.ok(script.indexOf('"AI 自绘"') !== -1, "a drawn diagram must be labelled as such");
  assert.ok(script.indexOf('"截图"') !== -1, "a screenshot must be labelled as such");
  // The override must actually render it, and must not fetch during render.
  var page = fs.readFileSync(PAGE_CHUNK, "utf8");
  assert.ok(page.indexOf("__SOCRATOPIA_ASSET_META_LABEL__") !== -1, "badge not rendered by the img override");
  assert.ok(page.indexOf("metaCache") !== -1, "render must read the cache, not start a fetch");
  assert.ok(page.indexOf("n.useEffect(") !== -1, "meta must arrive through an effect re-render");
});

test("a figure is drawn on its own white ground, all three surfaces", function () {
  // A transparent AI diagram (dark strokes meant for paper) sat on a black JPEG
  // thumbnail and on the bubble background; every surface must carry a ground.
  var t = fs.readFileSync(PAGE_CHUNK, "utf8");
  assert.ok(t.indexOf('objectFit:"contain",display:"block",background:"#fff"') !== -1,
    "the message-view asset img has no white ground");
  assert.ok(t.indexOf('display:"block",margin:"0.4rem 0",background:"#fff"') !== -1,
    "the live ```svg fence render has no white ground");
  var script = fs.readFileSync(PUBLIC_SCRIPT, "utf8");
  assert.ok(script.indexOf("shadow:0 12px 48px rgba(0,0,0,.5);background:#fff") !== -1,
    "the lightbox has no white ground");
});

test("svg assets are script-inert: always loaded through <img src>, never inlined", function () {
  // T12's sanitize requirement. An SVG rendered as an image document has
  // scripting disabled and never fires its own onclick/onload, so a malicious
  // <script> or onload= inside the SVG cannot run — no sanitizer needed.
  var t = fs.readFileSync(PAGE_CHUNK, "utf8");
  var start = t.indexOf("img:({src:_s");
  var imgBranch = t.slice(start, t.indexOf("...s?{ul:", start));
  assert.ok(imgBranch.indexOf("__SOCRATOPIA_ASSET_URL__") !== -1, "the img must resolve through the asset URL");
  assert.ok(imgBranch.indexOf("dangerouslySetInnerHTML") === -1, "no innerHTML escape hatch");
  assert.ok(t.indexOf("svgSource") === -1, "the bundle has no inline SVG parse path");
  // The thumbnail is what the message shows; opening it swaps to the original.
  assert.ok(imgBranch.indexOf('"thumb"') !== -1);
  assert.ok(t.indexOf('__SOCRATOPIA_ASSET_OPEN__(_id)') !== -1);
});

// ---- behavioural assertions on the public script -------------------------

test("the capture script mounts a button and exposes its API", function () {
  var dom = makeDom();
  var api = loadPublicScript(dom);
  assert.ok(api, "window.__SOCRATOPIA_ASSET_CAPTURE__ missing");
  assert.strictEqual(typeof api.capture, "function");
  assert.strictEqual(typeof api.open, "function");
  assert.strictEqual(typeof api.url, "function");
  assert.strictEqual(typeof api.insertAnchor, "function");
  assert.strictEqual(typeof dom.window.__SOCRATOPIA_ASSET_OPEN__, "function");
  assert.strictEqual(typeof dom.window.__SOCRATOPIA_ASSET_URL__, "function");
  var buttons = dom.body.children.filter(function (c) { return c.attributes["data-socratopia-asset-button"]; });
  assert.strictEqual(buttons.length, 1, "expected exactly one capture button");
  assert.ok(buttons[0].style.cssText.indexOf("position:fixed") !== -1);
});

test("api.url builds a scope-free thumbnail URL before a scope is known", function () {
  var dom = makeDom();
  var api = loadPublicScript(dom);
  assert.strictEqual(api.url("ast_0123456789abcdef", "thumb"), "/api/assets/ast_0123456789abcdef?thumb=1");
  assert.strictEqual(api.url("ast_0123456789abcdef", null), "/api/assets/ast_0123456789abcdef");
});

test("insertAnchor writes through the native setter and fires a bubbling input event", function () {
  var dom = makeDom();
  var api = loadPublicScript(dom);
  var textarea = makeElement("textarea");
  // A real textarea inherits the native `value` accessor the script writes through.
  Object.setPrototypeOf(textarea, dom.window.HTMLTextAreaElement.prototype);
  textarea.setAttribute("data-testid", "chat-input-textarea");
  textarea.__value = "已经写了一半";
  var events = [];
  textarea.addEventListener("input", function (event) { events.push(event); });
  dom.document.__textarea = textarea;

  assert.strictEqual(api.insertAnchor("ast_0123456789abcdef"), true);
  assert.strictEqual(textarea.value, "已经写了一半 ![图片](asset://ast_0123456789abcdef) ");
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].bubbles, true);
  assert.strictEqual(textarea.focused, true);
});

test("insertAnchor reports failure without a composer", function () {
  var dom = makeDom();
  var api = loadPublicScript(dom);
  dom.document.__textarea = null;
  assert.strictEqual(api.insertAnchor("ast_0123456789abcdef"), false);
});

test("capture without the Electron bridge toasts instead of throwing", function () {
  var dom = makeDom();
  var api = loadPublicScript(dom);
  var before = dom.body.children.length;
  var result = api.capture();
  assert.ok(result && typeof result.then === "function", "capture must return a promise");
  assert.ok(dom.body.children.length >= before, "a toast element should have been appended");
});

test("captureScreen is always optional-chained", function () {
  var source = fs.readFileSync(PUBLIC_SCRIPT, "utf8");
  assert.ok(source.indexOf("window.electronAPI") !== -1);
  assert.ok(source.indexOf('typeof bridge.captureScreen !== "function"') !== -1, "must feature-detect captureScreen");
  // No unguarded `window.electronAPI.captureScreen(` call site.
  assert.ok(source.indexOf("window.electronAPI.captureScreen(") === -1, "use the local `bridge` binding");
  assert.ok(source.indexOf("bridge.captureScreen()") !== -1);
  // The frozen-frame flow: capture first, marquee on the frame, crop on canvas.
  assert.ok(source.indexOf("pickRegionOnImage") !== -1, "marquee must run on the frozen frame");
  assert.ok(source.indexOf("toDataURL") !== -1 && source.indexOf("drawImage") !== -1, "local canvas crop missing");
});

test("mapRegion maps client coords into device pixels, letterboxing included", function () {
  var dom = makeDom();
  var api = loadPublicScript(dom);
  // The vm sandbox gives returned objects a foreign prototype, so compare
  // field-by-field instead of deepStrictEqual.
  function fields(region) {
    return region && [region.x, region.y, region.width, region.height].join(",");
  }
  // 1920x1080 frame letterboxed into a 1000x800 viewport: img renders at
  // 1000x562.5 starting at (0, 118.75).
  var imgRect = { left: 0, top: 118.75, width: 1000, height: 562.5 };
  var region = api._mapRegion(100, 218.75, 600, 518.75, imgRect, 1920, 1080);
  assert.strictEqual(fields(region), "192,192,960,576");
  // Dragging outside the image clamps to the frame edge.
  var clamped = api._mapRegion(-50, 0, 500, 400, imgRect, 1920, 1080);
  assert.strictEqual(fields(clamped), "0,0,960,540");
  // Tiny selections and degenerate inputs are rejected.
  assert.strictEqual(api._mapRegion(10, 10, 11, 11, imgRect, 1920, 1080), null);
  assert.strictEqual(api._mapRegion(0, 0, 100, 100, { left: 0, top: 0, width: 0, height: 0 }, 1920, 1080), null);
});

test("the open() lightbox reuses one overlay and targets the full-size asset", function () {
  var dom = makeDom();
  var api = loadPublicScript(dom);
  var before = dom.body.children.filter(function (c) { return c.attributes["data-socratopia-asset-lightbox"]; }).length;
  assert.strictEqual(before, 0, "lightbox must be lazy");
  api.open("ast_0123456789abcdef");
  var boxes = dom.body.children.filter(function (c) { return c.attributes["data-socratopia-asset-lightbox"]; });
  assert.strictEqual(boxes.length, 1);
  assert.strictEqual(boxes[0].style.display, "flex");
  assert.strictEqual(boxes[0].children[0].src, "/api/assets/ast_0123456789abcdef");
  api.open("ast_ffffffffffffffff");
  var again = dom.body.children.filter(function (c) { return c.attributes["data-socratopia-asset-lightbox"]; });
  assert.strictEqual(again.length, 1, "must not mount a second lightbox");
  assert.strictEqual(again[0].children[0].src, "/api/assets/ast_ffffffffffffffff");
});

test("the capture script hydrates asset images through blob URLs", function () {
  // <img src> cannot carry the capability header, so /api/assets URLs 401 when
  // used directly; the script must fetch (auth-injected) and swap to blob: URLs.
  var source = fs.readFileSync(PUBLIC_SCRIPT, "utf8");
  assert.ok(source.indexOf("createObjectURL") !== -1, "blob conversion missing");
  assert.ok(source.indexOf("data-socratopia-asset-hydrated") !== -1, "hydration marker missing");
  assert.ok(source.indexOf('img[src*="/api/assets/"]') !== -1, "img sweep selector missing");
});

// ---- async: blob channel behaviour ------------------------------------------

function flush() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }

function testAsync(name, fn) {
  return Promise.resolve().then(fn).then(
    function () { results.push({ name: name, ok: true }); console.log("  PASS  " + name); },
    function (error) {
      results.push({ name: name, ok: false });
      console.log("  FAIL  " + name);
      console.log("        " + (error && error.stack ? error.stack.split("\n").slice(0, 5).join("\n        ") : error));
    }
  );
}

function makeBlobDom(dom) {
  dom.window.fetch = function () {
    return Promise.resolve({ ok: true, status: 200, blob: function () { return Promise.resolve({ size: 8 }); } });
  };
  dom.window.URL = { createObjectURL: function (blob) { return "blob:mock:" + blob.size; } };
  return dom;
}

(async function asyncTests() {
  await testAsync("hydrateImages swaps an asset <img> to a fetched blob URL", async function () {
    var dom = makeBlobDom(makeDom());
    var api = loadPublicScript(dom);
    var img = makeElement("img");
    img.src = "/api/assets/ast_0123456789abcdef?thumb=1";
    api._hydrateImages([img]);
    await flush();
    assert.strictEqual(img.src, "blob:mock:8");
    assert.strictEqual(img.getAttribute("data-socratopia-asset-hydrated"), "1");
  });

  await testAsync("blob URLs are cached per asset URL (no double fetch)", async function () {
    var dom = makeBlobDom(makeDom());
    var fetches = 0;
    var baseFetch = dom.window.fetch;
    // The figure entry polls /api/textbook from boot and the diagnostics beacon
    // posts to /api/assets/__probe, so count real asset reads only.
    dom.window.fetch = function (url) {
      if (String(url).indexOf("/api/assets/") === 0 && String(url).indexOf("__probe") === -1) fetches += 1;
      return baseFetch(url);
    };
    var api = loadPublicScript(dom);
    var imgA = makeElement("img");
    imgA.src = "/api/assets/ast_0123456789abcdef?thumb=1";
    var imgB = makeElement("img");
    imgB.src = "/api/assets/ast_0123456789abcdef?thumb=1";
    api._hydrateImages([imgA]);
    await flush();
    api._hydrateImages([imgB]);
    await flush();
    assert.strictEqual(fetches, 1, "same URL must be fetched once, got " + fetches);
    assert.strictEqual(imgB.src, "blob:mock:8");
  });

  await testAsync("a failed fetch is not cached, so a later sweep retries and wins", async function () {
    // The real-machine shape: the first hydration races capability minting and gets a
    // 401.  If the rejected promise stays cached, every later sweep replays it and the
    // thumbnail never appears - which is exactly what happened on device.
    var dom = makeBlobDom(makeDom());
    var good = dom.window.fetch;
    var attempts = 0;
    dom.window.fetch = function (url) {
      if (String(url).indexOf("/api/assets/") !== 0) return good(url);
      if (String(url).indexOf("__probe") !== -1) return good(url);
      attempts += 1;
      if (attempts === 1) return Promise.resolve({ ok: false, status: 401 });
      return good(url);
    };
    var api = loadPublicScript(dom);
    var img = makeElement("img");
    img.removeAttribute = function (name) { delete img.attributes[name]; };
    img.src = "/api/assets/ast_0123456789abcdef?thumb=1";
    api._hydrateImages([img]);
    await flush();
    assert.strictEqual(attempts, 1, "the first attempt must happen");
    assert.strictEqual(img.src, "/api/assets/ast_0123456789abcdef?thumb=1", "src untouched on failure");
    assert.strictEqual(img.getAttribute("data-socratopia-asset-hydrated"), undefined, "marker cleared for retry");
    api._hydrateImages([img]);
    await flush();
    assert.strictEqual(attempts, 2, "the second sweep must re-fetch, not replay the rejection");
    assert.strictEqual(img.src, "blob:mock:8", "the retry hydrates");
    assert.strictEqual(img.getAttribute("data-socratopia-asset-hydrated"), "1");
  });

  await testAsync("the lightbox loads through the blob channel when fetch is available", async function () {
    var dom = makeBlobDom(makeDom());
    var api = loadPublicScript(dom);
    api.open("ast_aaaaaaaaaaaaaaaa");
    await flush();
    var boxes = dom.body.children.filter(function (c) { return c.attributes["data-socratopia-asset-lightbox"]; });
    assert.strictEqual(boxes.length, 1);
    assert.strictEqual(boxes[0].children[0].src, "blob:mock:8");
  });

  // ---- T13d: textbook figure entry -----------------------------------------

  await testAsync("the figure entry is hidden without an active textbook and appears with one", async function () {
    var without = makeFigureDom({ activeTextbookId: null });
    var apiWithout = loadPublicScript(without);
    var hidden = figureButton(without);
    assert.ok(hidden, "the entry button must be mounted");
    assert.ok(hidden.style.cssText.indexOf("display:none") !== -1, "must start hidden");
    await apiWithout._syncFigureButton();
    assert.strictEqual(hidden.style.display, "none", "no active textbook keeps it out of the way");

    var withBook = makeFigureDom();
    var apiWith = loadPublicScript(withBook);
    var shown = figureButton(withBook);
    assert.ok(shown.style.cssText.indexOf("display:none") !== -1, "hidden before the first poll");
    await apiWith._syncFigureButton();
    assert.strictEqual(shown.style.display, "flex", "an active textbook reveals the entry");
  });

  await testAsync("the figure entry toasts instead of opening a dialog without a textbook", async function () {
    var dom = makeFigureDom({ activeTextbookId: null });
    var api = loadPublicScript(dom);
    assert.strictEqual(await api.referenceFigure(), null);
    assert.strictEqual(figureDialog(dom), null);
    assert.strictEqual(dom.calls.pageImages, 0);
  });

  await testAsync("the figure flow previews the reading page, posts a normalized rect and inserts the anchor", async function () {
    var dom = makeFigureDom();
    var api = loadPublicScript(dom);
    var textarea = makeElement("textarea");
    Object.setPrototypeOf(textarea, dom.window.HTMLTextAreaElement.prototype);
    textarea.setAttribute("data-testid", "chat-input-textarea");
    dom.document.__textarea = textarea;

    var opened = await openFigureDialog(dom, api);
    // The picker opens on the page the lesson sits on, fetched from the app's own
    // reading-context endpoint, and the page image came from the server.
    assert.strictEqual(findIn(opened.dialog, "data-socratopia-figure-page").value, "7");
    assert.strictEqual(dom.calls.readingContext, 1);
    assert.strictEqual(dom.calls.pageImages, 1);
    assert.strictEqual(opened.preview.src, "blob:page:4096");

    findIn(opened.dialog, "data-socratopia-figure-pick").dispatchEvent(clickEvent());
    await flush();
    var marquee = dom.body.children.filter(function (c) { return c.attributes["data-socratopia-asset-marquee"]; })[0];
    assert.ok(marquee, "the frozen-frame marquee must be reused");
    marquee.dispatchEvent({ type: "mousedown", button: 0, clientX: 0, clientY: 0, preventDefault: function () {}, stopPropagation: function () {} });
    dom.document.dispatchEvent({ type: "mousemove", clientX: 350, clientY: 500 });
    dom.document.dispatchEvent({ type: "mouseup", clientX: 350, clientY: 500 });
    await flush();
    await flush();

    assert.strictEqual(dom.calls.posts.length, 1, "exactly one asset must be created");
    var post = dom.calls.posts[0];
    assert.strictEqual(post.kind, "textbook-figure");
    assert.strictEqual(post.profileId, "p1");
    assert.strictEqual(post.worldId, "w1");
    assert.deepStrictEqual(post.ref, { textbookId: "book-1", page: 7, rect: [0, 0, 0.5, 0.5] });
    assert.strictEqual(textarea.value, "![图 p.7](asset://ast_0123456789abcdef) ");
    assert.strictEqual(figureDialog(dom), null, "the dialog closes after a successful insert");
    assert.strictEqual(await opened.promise, "ast_0123456789abcdef");
  });

  await testAsync("a cancelled marquee keeps the dialog open and posts nothing", async function () {
    var dom = makeFigureDom();
    var api = loadPublicScript(dom);
    var opened = await openFigureDialog(dom, api);
    findIn(opened.dialog, "data-socratopia-figure-pick").dispatchEvent(clickEvent());
    await flush();
    dom.document.dispatchEvent({ type: "keydown", key: "Escape" }); // cancels the marquee
    await flush();
    await flush();
    assert.strictEqual(dom.calls.posts.length, 0);
    assert.ok(figureDialog(dom), "the dialog must survive a cancelled marquee");
    dom.document.dispatchEvent({ type: "keydown", key: "Escape" }); // closes the dialog
    await flush();
    assert.strictEqual(figureDialog(dom), null);
    assert.strictEqual(await opened.promise, null);
  });

  console.log("");
  var passed = results.filter(function (r) { return r.ok; }).length;
  var failed = results.length - passed;
  console.log("asset-capture-ui: " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();
