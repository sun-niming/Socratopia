/*
 * selection-dock.js — 选中即朗读 / 问伙伴 / 解释 / 指到原文
 *
 * 注入方式与 /asset-capture.js、/close-reading-skill-menu.js 一致：
 * 由 index.html 里的 <script defer> 加载，自带早退守卫，不依赖 webpack 模块。
 *
 * 依赖（都已在运行时存在）：
 *   window.__SOCRATOPIA_VOICE__           —— 页面 bundle 暴露的 4137 模块（speak / voicePlayer / DEFAULT_VOICE_KEY）
 *   window.__SOCRATOPIA_SPEECH_VOICE__    —— 当前会话音色，由页面 bundle 每次解析时刷新
 *   window.__SOCRATOPIA_ASSET_CAPTURE__   —— 复用它的 _refreshFigureContext() 拿 profile/world/textbook 作用域
 *
 * 硬约束（与 voice-runtime-invariants 测试一致）：本文件不 new Audio()，一律走 voicePlayer。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || window.__SOCRATOPIA_SELECTION_DOCK__) return;
  window.__SOCRATOPIA_SELECTION_DOCK__ = "1";

  var DEBOUNCE_MS = 220;
  var MIN_CHARS = 2;
  var MAX_CHARS = 1600;
  var DOCK_GAP = 8;
  var EDGE_PAD = 10;

  // ---- i18n -----------------------------------------------------------------
  var STRINGS = {
    "zh-CN": {
      explain: "解释",
      companion: "问伙伴",
      speak: "朗读",
      speakBusy: "停止",
      source: "原文",
      close: "关闭",
      title: "原文",
      page: "第 {n} 页",
      noBook: "当前世界还没有激活的教材",
      loadFailed: "页图加载失败",
      noText: "这段没有可朗读的文字",
      quote: "原文",
      insertExplain: "解释这段内容：",
      insertCompanion: "关于这段内容：",
      prev: "上一页",
      next: "下一页",
      panelExplain: "解释这段",
      panelCompanion: "问伙伴",
      panelQuote: "引用",
      pickCompanion: "选一个伙伴来问",
      noCompanion: "这个世界还没有可用的伙伴",
      askPlaceholder: "就这段内容追问一句（回车发送）",
      send: "发送",
      speakAll: "朗读",
      stop: "停止",
      insertToChat: "插到聊天框",
      inserted: "已插入聊天框",
      copied: "已复制",
      thinking: "思考中…",
      failed: "出错了",
      answerFailed: "没有取到回答",
      emptyAnswer: "（空回答）",
      closePanel: "关闭"
    },
    "zh-TW": {
      explain: "解釋",
      companion: "問夥伴",
      speak: "朗讀",
      speakBusy: "停止",
      source: "原文",
      close: "關閉",
      title: "原文",
      page: "第 {n} 頁",
      noBook: "目前世界還沒有啟用的教材",
      loadFailed: "頁圖載入失敗",
      noText: "這段沒有可朗讀的文字",
      quote: "原文",
      insertExplain: "解釋這段內容：",
      insertCompanion: "關於這段內容：",
      prev: "上一頁",
      next: "下一頁",
      panelExplain: "解釋這段",
      panelCompanion: "問夥伴",
      panelQuote: "引用",
      pickCompanion: "選一個夥伴來問",
      noCompanion: "這個世界還沒有可用的夥伴",
      askPlaceholder: "就這段內容追問一句（Enter 送出）",
      send: "送出",
      speakAll: "朗讀",
      stop: "停止",
      insertToChat: "插到聊天框",
      inserted: "已插入聊天框",
      copied: "已複製",
      thinking: "思考中…",
      failed: "出錯了",
      answerFailed: "沒有取到回答",
      emptyAnswer: "（空回答）",
      closePanel: "關閉"
    },
    en: {
      explain: "Explain",
      companion: "Ask companion",
      speak: "Read aloud",
      speakBusy: "Stop",
      source: "Source",
      close: "Close",
      title: "Source",
      page: "Page {n}",
      noBook: "This world has no active textbook",
      loadFailed: "Could not load the page",
      noText: "Nothing to read in this selection",
      quote: "Quoted text",
      insertExplain: "Explain this passage:",
      insertCompanion: "About this passage:",
      prev: "Previous page",
      next: "Next page",
      panelExplain: "Explain this",
      panelCompanion: "Ask a companion",
      panelQuote: "Quote",
      pickCompanion: "Pick a companion to ask",
      noCompanion: "No companions in this world yet",
      askPlaceholder: "Ask about this passage (Enter to send)",
      send: "Send",
      speakAll: "Read aloud",
      stop: "Stop",
      insertToChat: "Insert into chat",
      inserted: "Inserted into chat",
      copied: "Copied",
      thinking: "Thinking…",
      failed: "Something went wrong",
      answerFailed: "No answer came back",
      emptyAnswer: "(empty answer)",
      closePanel: "Close"
    }
  };

  function locale() {
    var raw = "";
    try {
      raw = localStorage.getItem("socralab_ui_locale") || "";
    } catch (_) {}
    if (!raw) {
      try {
        raw = navigator.language || "";
      } catch (_) {}
    }
    var tag = String(raw).toLowerCase();
    if (tag.indexOf("zh-tw") === 0 || tag.indexOf("zh-hant") === 0) return "zh-TW";
    if (tag.indexOf("zh") === 0) return "zh-CN";
    return "en";
  }

  function t(key, vars) {
    var table = STRINGS[locale()] || STRINGS["zh-CN"];
    var text = table[key] || STRINGS["zh-CN"][key] || key;
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, function (all, name) {
      return vars[name] === undefined ? all : String(vars[name]);
    });
  }

  // ---- 作用域（复用 asset-capture 已解析好的 profile/world/textbook） ----
  function capture() {
    return window.__SOCRATOPIA_ASSET_CAPTURE__ || null;
  }

  function resolveScope() {
    var api = capture();
    if (api && typeof api._refreshFigureContext === "function") {
      return Promise.resolve(api._refreshFigureContext());
    }
    var stored = window.__SOCRATOPIA_ASSET_SCOPE__ || null;
    return Promise.resolve(stored);
  }

  var lastScope = null;

  // 教学语言跟着世界走（与页面 bundle 的映射一致），拿不到再退回界面语言
  var worldLanguage = null;

  function loadWorldLanguage(scope) {
    if (worldLanguage || !scope || !scope.profileId) return Promise.resolve(worldLanguage);
    return fetch("/api/world?profileId=" + encodeURIComponent(scope.profileId))
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        if (!data) return null;
        var list = data.worlds || [];
        var id = scope.worldId;
        var hit = null;
        for (var i = 0; i < list.length; i++) {
          if (list[i].worldId === id || list[i].id === id) hit = list[i];
        }
        worldLanguage = (hit && hit.language) || null;
        return worldLanguage;
      })
      .catch(function () {
        return null;
      });
  }

  function teachingLanguage(scope) {
    var world = (scope && scope.worldLanguage) || worldLanguage;
    if (world === "english" || world === "en") return "english";
    if (world === "chinese-traditional" || world === "zh-TW") return "chinese-traditional";
    if (world === "chinese" || world === "zh") return "chinese";
    var tag = locale();
    return tag === "en" ? "english" : tag === "zh-TW" ? "chinese-traditional" : "chinese";
  }

  function pageUrl(scope, page, maxWidth) {
    return (
      "/api/textbook?page-image=1" +
      "&profileId=" + encodeURIComponent(scope.profileId) +
      "&worldId=" + encodeURIComponent(scope.worldId) +
      "&textbookId=" + encodeURIComponent(scope.textbookId) +
      "&page=" + encodeURIComponent(page) +
      "&maxWidth=" + encodeURIComponent(maxWidth)
    );
  }

  // ---- toast ----------------------------------------------------------------
  var toastTimer = null;

  function toast(message) {
    var node = document.getElementById("socratopia-selection-toast");
    if (!node) {
      node = document.createElement("div");
      node.id = "socratopia-selection-toast";
      node.setAttribute("data-socratopia-selection-toast", "1");
      node.style.cssText =
        "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483400;" +
        "padding:8px 16px;border-radius:10px;font-size:13px;pointer-events:none;" +
        "background:var(--surface-raised,#222);color:var(--foreground,#fff);" +
        "box-shadow:0 10px 28px rgba(0,0,0,.32);opacity:0;transition:opacity .16s ease";
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.style.opacity = "1";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      node.style.opacity = "0";
    }, 2200);
  }

  // ---- 选区取值（公式要还原成 $tex$，否则 selection.toString() 是乱码） ----
  function annotationFor(node) {
    var annotation = node.querySelector('annotation[encoding="application/x-tex"]');
    return annotation ? (annotation.textContent || "").trim() : "";
  }

  function textFromRange(range) {
    var holder = document.createElement("div");
    holder.appendChild(range.cloneContents());
    var math = holder.querySelectorAll(".katex");
    for (var i = 0; i < math.length; i++) {
      var tex = annotationFor(math[i]);
      if (!tex) continue;
      var replacement = document.createElement("span");
      replacement.textContent = "$" + tex + "$";
      if (math[i].parentNode) math[i].parentNode.replaceChild(replacement, math[i]);
    }
    return (holder.textContent || "").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  }

  // ---- 输入框写入（与 asset-capture 相同的原生 setter 手法） ----
  function composer() {
    return document.querySelector('textarea[data-testid="chat-input-textarea"]') || null;
  }

  function copyText(body) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(body).catch(function () {});
        return true;
      }
    } catch (_) {}
    try {
      var box = document.createElement("textarea");
      box.value = body;
      box.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(box);
      box.select();
      document.execCommand("copy");
      box.remove();
      return true;
    } catch (_) {}
    return false;
  }

  function insertText(body) {
    var field = composer();
    if (!field) return false;
    var descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    var current = field.value || "";
    var spacer = current && !/\s$/.test(current) ? "\n\n" : "";
    var next = current + spacer + body + (/\n$/.test(body) ? "" : "\n");
    if (descriptor && descriptor.set) descriptor.set.call(field, next);
    else field.value = next;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    try {
      field.focus();
    } catch (_) {}
    return true;
  }

  // ---- 浮条 -----------------------------------------------------------------
  var dock = null;
  var dockSelection = null;
  var dockExpanded = false;
  var debounceTimer = null;
  var speaking = false;

  function currentSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    if (range.collapsed) return null;
    var anchor = range.commonAncestorContainer;
    var element = anchor.nodeType === 1 ? anchor : anchor.parentNode;
    if (!element) return null;
    if (element.closest && (element.closest('[data-testid="chat-input-textarea"]') || element.closest("[data-socratopia-source-dialog]") || element.closest("[data-socratopia-selection-panel]"))) {
      return null;
    }
    var text = textFromRange(range);
    if (text.length < MIN_CHARS) return null;
    return { range: range, text: text };
  }

  function ensureDock() {
    if (dock) return dock;
    dock = document.createElement("div");
    dock.setAttribute("data-socratopia-selection-dock", "1");
    dock.setAttribute("role", "toolbar");
    dock.style.cssText =
      "position:fixed;z-index:2147483310;display:none;align-items:center;gap:2px;" +
      "padding:4px;border-radius:9999px;" +
      "background:var(--surface-raised,#1c1c1f);border:1px solid var(--border,rgba(255,255,255,.14));" +
      "box-shadow:0 10px 30px rgba(0,0,0,.34)";
    dock.addEventListener("mousedown", function (event) {
      // 保住选区：按下浮条时不让浏览器清掉它
      event.preventDefault();
    });
    dock.addEventListener("click", function (event) {
      var button = event.target.closest && event.target.closest("[data-socratopia-selection-action]");
      if (button) runAction(button.getAttribute("data-socratopia-selection-action"));
    });
    document.body.appendChild(dock);
    return dock;
  }

  function dockButton(id, label, primary) {
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-socratopia-selection-action", id);
    button.textContent = label;
    button.style.cssText =
      "border:0;border-radius:9999px;padding:6px 12px;font-size:13px;line-height:1.2;cursor:pointer;" +
      "white-space:nowrap;background:transparent;color:var(--foreground,#f4f4f5)";
    if (primary) {
      button.style.background = "var(--accent-solid,#3a6df0)";
      button.style.color = "var(--text-inverse,#fff)";
      button.style.fontWeight = "600";
    }
    button.addEventListener("mouseenter", function () {
      if (!primary) button.style.background = "var(--surface-hover,rgba(255,255,255,.08))";
    });
    button.addEventListener("mouseleave", function () {
      if (!primary) button.style.background = "transparent";
    });
    return button;
  }

  function paintDock() {
    var node = ensureDock();
    node.textContent = "";
    node.appendChild(dockButton("explain", t("explain")));
    node.appendChild(dockButton("companion", t("companion")));
    var speakButton = dockButton("speak", speaking ? t("speakBusy") : t("speak"), true);
    speakButton.setAttribute("title", t("speak"));
    node.appendChild(speakButton);
    node.appendChild(dockButton("source", t("source")));

    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("data-socratopia-selection-action", "close");
    close.setAttribute("aria-label", t("close"));
    close.textContent = "×";
    close.style.cssText =
      "border:0;background:transparent;cursor:pointer;padding:6px 10px;font-size:16px;line-height:1;" +
      "border-radius:9999px;color:var(--text-muted,#a1a1aa)";
    close.addEventListener("mouseenter", function () {
      close.style.background = "var(--surface-hover,rgba(255,255,255,.08))";
    });
    close.addEventListener("mouseleave", function () {
      close.style.background = "transparent";
    });
    node.appendChild(close);
  }

  function placeDock(range) {
    var node = ensureDock();
    paintDock();
    node.style.display = "flex";
    node.style.visibility = "hidden";

    var rect = range.getBoundingClientRect();
    var box = node.getBoundingClientRect();
    var width = box.width;
    var height = box.height;
    var viewportW = window.innerWidth;
    var viewportH = window.innerHeight;

    var left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(EDGE_PAD, Math.min(left, viewportW - width - EDGE_PAD));

    var top = rect.bottom + DOCK_GAP;
    if (top + height > viewportH - EDGE_PAD) {
      var above = rect.top - height - DOCK_GAP;
      top = above >= EDGE_PAD ? above : Math.max(EDGE_PAD, viewportH - height - EDGE_PAD);
    }
    // 选区被自动滚动带出视口时，rect 可能是负数：兜底夹回可视区，别让浮条贴在屏幕外
    top = Math.max(EDGE_PAD, Math.min(top, viewportH - height - EDGE_PAD));

    node.style.left = Math.round(left) + "px";
    node.style.top = Math.round(top) + "px";
    node.style.visibility = "visible";
  }

  function hideDock() {
    if (!dock) return;
    if (speaking) return; // 播放中保持浮条，方便再点一次停止
    dock.style.display = "none";
    dockSelection = null;
  }

  function showDockFor(selection) {
    dockSelection = selection;
    dockExpanded = true;
    placeDock(selection.range);
  }

  function evaluateSelection() {
    if (speaking) return;
    var selection = currentSelection();
    if (!selection) {
      hideDock();
      return;
    }
    if (dockExpanded && dockSelection && dockSelection.text === selection.text && dock && dock.style.display !== "none") {
      placeDock(selection.range);
      return;
    }
    showDockFor(selection);
  }

  // ---- 朗读 -----------------------------------------------------------------
  function voiceModule() {
    return window.__SOCRATOPIA_VOICE__ || null;
  }

  function speakCurrent() {
    var selection = dockSelection;
    if (!selection) return;
    if (speaking) {
      stopSpeaking();
      return;
    }
    var voice = voiceModule();
    if (!voice || typeof voice.speak !== "function") {
      toast(t("noText"));
      return;
    }
    var text = selection.text.slice(0, MAX_CHARS);
    if (!text.trim()) {
      toast(t("noText"));
      return;
    }
    speaking = true;
    if (dock) paintDock();
    var voiceKey = window.__SOCRATOPIA_SPEECH_VOICE__ || voice.DEFAULT_VOICE_KEY;
    var speed = window.__SOCRATOPIA_SPEECH_SPEED__ || 1;
    var trackId = "sel-" + Date.now();
    Promise.resolve()
      .then(function () {
        return voice.speak(text, voiceKey, trackId, speed);
      })
      .catch(function () {})
      .then(function () {
        speaking = false;
        if (dock) paintDock();
        // 选区通常已丢失，播放结束后收起浮条
        var remaining = window.getSelection();
        if (!remaining || remaining.isCollapsed) hideDock();
      });
  }

  function stopSpeaking() {
    var voice = voiceModule();
    try {
      if (voice && voice.voicePlayer && typeof voice.voicePlayer.stop === "function") voice.voicePlayer.stop();
    } catch (_) {}
    speaking = false;
    if (dock) paintDock();
  }

  // ---- 原文弹窗 -------------------------------------------------------------
  var dialog = null;
  var dialogUnmount = null;
  var loadToken = 0;
  var fetchTimer = null;
  // Request URLs whose object URLs this dialog still holds. Kept (not revoked) while
  // paging so the warmed neighbours decode instantly on ‹/›, and all released on
  // close. Releasing on every swap used to hand back revoked URLs from the shared
  // cache ("页图加载失败").
  var keptPages = [];
  var KEPT_PAGES_LIMIT = 8;

  function releaseUrl(url) {
    if (!url) return;
    var at = keptPages.indexOf(url);
    if (at >= 0) keptPages.splice(at, 1);
    var api = capture();
    if (api && typeof api._releaseBlob === "function") api._releaseBlob(url);
    else {
      var pending = pendingBlobs[url];
      if (pending)
        Promise.resolve(pending).then(function (objectUrl) {
          if (!objectUrl) return;
          try {
            window.URL.revokeObjectURL(objectUrl);
          } catch (_) {}
        });
    }
  }

  // Fallback for the no-asset-capture path (kept small and only for that path).
  var pendingBlobs = Object.create(null);

  function releaseBlob() {
    keptPages.slice().forEach(releaseUrl);
    keptPages = [];
  }

  // ---- 右侧分栏：解释 / 问伙伴 / 原文共用 -------------------------------------
  //
  // 采用编辑器那种“左右分栏”而不是浮层：主聊天列让出右侧的空间，中间是可拖的
  // 分隔条。右侧是一块带页签的容器，关掉全部页签就把主列还回原处；宽度记进
  // localStorage。
  var SPLIT_KEY = "socratopia.split.width";
  var splitWrap = null;
  var splitPane = null;
  var splitSeq = 0;
  var floaterObserver = null;

  function splitWidth(limit) {
    var stored = Number(window.localStorage.getItem(SPLIT_KEY));
    var max = Math.max(320, Math.min(limit || window.innerWidth * 0.7, window.innerWidth - 380));
    var width = Number.isFinite(stored) && stored > 0 ? stored : Math.min(560, window.innerWidth * 0.44);
    return Math.round(Math.max(300, Math.min(width, max)));
  }

  function ensureSplit() {
    if (splitWrap && splitWrap.isConnected) return splitPane;
    var host = document.body;
    var app = null;
    var kids = host.children;
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i];
      if (kid.tagName === "DIV" && kid.offsetWidth > 200 && kid !== splitWrap) {
        app = kid;
        break;
      }
    }
    if (!app) return null;

    splitWrap = document.createElement("div");
    splitWrap.setAttribute("data-socratopia-split", "1");
    splitWrap.style.cssText = "display:flex;height:100vh;width:100%;overflow:hidden";

    var divider = document.createElement("div");
    divider.setAttribute("data-socratopia-split-divider", "1");
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-orientation", "vertical");
    divider.style.cssText =
      "flex:0 0 6px;cursor:col-resize;background:var(--border,rgba(255,255,255,.12));" +
      "transition:background .15s";

    splitPane = document.createElement("div");
    splitPane.setAttribute("data-socratopia-split-pane", "1");
    splitPane.style.cssText =
      "flex:0 0 auto;display:flex;flex-direction:column;min-width:0;overflow:hidden;" +
      "background:var(--surface-raised,#161618);" +
      "border-left:1px solid var(--border,rgba(255,255,255,.12))";

    var tabs = document.createElement("div");
    tabs.setAttribute("data-socratopia-split-tabs", "1");
    tabs.setAttribute("role", "tablist");
    tabs.style.cssText =
      "flex:0 0 auto;display:flex;align-items:stretch;gap:2px;overflow-x:auto;" +
      "background:var(--surface-sunken,#0f0f11);border-bottom:1px solid var(--border,rgba(255,255,255,.12))";

    var body = document.createElement("div");
    body.setAttribute("data-socratopia-split-body", "1");
    body.style.cssText = "flex:1 1 auto;display:flex;flex-direction:column;min-height:0;min-width:0";

    splitPane.appendChild(tabs);
    splitPane.appendChild(body);

    host.insertBefore(splitWrap, app);
    splitWrap.appendChild(app);
    splitWrap.appendChild(divider);
    splitWrap.appendChild(splitPane);

    app.style.flex = "1 1 auto";
    app.style.minWidth = "0";
    app.style.height = "100%";
    splitPane.style.width = splitWidth() + "px";

    // 分隔条：按住左右拖即可改宽度
    var sizing = null;
    divider.addEventListener("mousedown", function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      sizing = { startX: event.clientX, width: splitPane.offsetWidth };
      var paint = function (moveEvent) {
        var next = sizing.width - (moveEvent.clientX - sizing.startX);
        var max = Math.max(300, window.innerWidth - 380);
        splitPane.style.width = Math.round(Math.max(300, Math.min(next, max))) + "px";
        offsetFloaters(splitPane.offsetWidth);
      };
      var stop = function () {
        sizing = null;
        document.removeEventListener("mousemove", paint, true);
        document.removeEventListener("mouseup", stop, true);
        document.removeEventListener("selectstart", block, true);
        try {
          window.localStorage.setItem(SPLIT_KEY, String(splitPane.offsetWidth));
        } catch (_) {}
        offsetFloaters(splitPane.offsetWidth);
      };
      var block = function (ev) {
        ev.preventDefault();
      };
      document.addEventListener("mousemove", paint, true);
      document.addEventListener("mouseup", stop, true);
      document.addEventListener("selectstart", block, true);
    });

    window.addEventListener("resize", function () {
      if (!splitPane || !splitPane.isConnected) return;
      splitPane.style.width = splitWidth(splitPane.offsetWidth) + "px";
      offsetFloaters(splitPane.offsetWidth);
    });

    offsetFloaters(splitPane.offsetWidth);

    // 那两个按钮也可能是分栏之后才挂上的（换世界时才出现引图按钮），补一次
    if (!floaterObserver && window.MutationObserver) {
      floaterObserver = new MutationObserver(function () {
        if (splitPane && splitPane.isConnected) offsetFloaters(splitPane.offsetWidth);
      });
      floaterObserver.observe(document.body, { childList: true });
    }

    return splitPane;
  }

  function teardownSplit() {
    if (!splitWrap) return;
    var app = splitWrap.children[0];
    if (app) {
      app.style.flex = "";
      app.style.minWidth = "";
      app.style.height = "";
      splitWrap.parentElement.insertBefore(app, splitWrap);
    }
    splitWrap.remove();
    splitWrap = null;
    splitPane = null;
    offsetFloaters(null);
  }

  // 右侧分栏是浮动的，但页面那几个 `position:fixed;right:20px` 的按钮
  // （asset-capture 的截屏 / 引图）也钉在视口右边，会被分栏压住。开着分栏时
  // 把它们一并左移，分栏合上再还原。
  var FLOATER_SELECTOR = '[data-socratopia-asset-button],[data-socratopia-figure-button]';

  function offsetFloaters(paneWidth) {
    var nodes = document.querySelectorAll(FLOATER_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node.__socratopiaBaseRight) node.__socratopiaBaseRight = "20px";
      if (paneWidth == null) {
        node.style.right = node.__socratopiaBaseRight;
        continue;
      }
      node.style.right = Math.round(paneWidth + 20) + "px";
    }
  }

  // 往右侧分栏开一个页签；返回释放函数（关窗时调用）
  function mountPane(node, head, label, onClose) {
    var pane = ensureSplit();
    if (!pane) {
      // 兜底：主列都找不到时退回浮层，至少还能用
      node.style.cssText += ";position:fixed;right:16px;top:16px;width:min(520px,92vw);height:70vh;border-radius:12px";
      document.body.appendChild(node);
      return function () {
        node.remove();
      };
    }

    var tabs = pane.querySelector("[data-socratopia-split-tabs]");
    var body = pane.querySelector("[data-socratopia-split-body]");
    var id = "t" + ++splitSeq;

    node.setAttribute("data-socratopia-pane-item", id);
    node.style.flex = "1 1 auto";
    node.style.minHeight = "0";
    node.style.borderRadius = "0";
    node.style.border = "0";
    node.style.boxShadow = "none";
    // 页签已经带标题与关闭键，窗口自己的标题行不再重复
    if (head) head.style.display = "none";
    body.appendChild(node);

    var tab = document.createElement("button");
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("data-socratopia-split-tab", id);
    tab.style.cssText =
      "display:flex;align-items:center;gap:6px;border:0;background:transparent;color:inherit;" +
      "font-size:12.5px;padding:8px 8px 8px 12px;cursor:pointer;white-space:nowrap;" +
      "border-bottom:2px solid transparent;opacity:.6";
    var tabLabel = document.createElement("span");
    tabLabel.textContent = label;
    var tabClose = document.createElement("span");
    tabClose.setAttribute("data-socratopia-split-tab-close", id);
    tabClose.setAttribute("aria-label", t("close"));
    tabClose.textContent = "×";
    tabClose.style.cssText = "font-size:15px;line-height:1;padding:0 2px;border-radius:4px";
    tab.appendChild(tabLabel);
    tab.appendChild(tabClose);
    tabs.appendChild(tab);
    // 标题行被页签取代了，需要改名的窗口用它更新页签
    node.__socratopiaTabLabel = function (text) {
      tabLabel.textContent = text;
    };
    function activate() {
      for (var i = 0; i < body.children.length; i++) {
        body.children[i].style.display = body.children[i].getAttribute("data-socratopia-pane-item") === id ? "flex" : "none";
      }
      for (var j = 0; j < tabs.children.length; j++) {
        var on = tabs.children[j] === tab;
        tabs.children[j].style.opacity = on ? "1" : ".6";
        tabs.children[j].style.borderBottomColor = on ? "var(--accent-solid,#3a6df0)" : "transparent";
      }
    }
    tab.addEventListener("click", function (event) {
      if (event.target === tabClose) return;
      activate();
    });
    tabClose.addEventListener("click", function (event) {
      event.stopPropagation();
      onClose();
    });
    activate();

    return function () {
      node.remove();
      tab.remove();
      if (body.children.length) {
        var last = body.children[body.children.length - 1];
        var lastId = last.getAttribute("data-socratopia-pane-item");
        var lastTab = tabs.querySelector('[data-socratopia-split-tab="' + lastId + '"]');
        if (lastTab) lastTab.click();
      } else if (splitWrap) {
        teardownSplit();
      }
    };
  }

  function closeDialog() {
    if (!dialog) return;
    if (dialogUnmount) dialogUnmount();
    dialogUnmount = null;
    dialog.remove();
    dialog = null;
    loadToken++;
    if (fetchTimer) {
      clearTimeout(fetchTimer);
      fetchTimer = null;
    }
    releaseBlob();
  }

  function openSourceDialog(initialPage) {
    var selection = dockSelection;
    var quoted = selection ? selection.text : "";
    var scope = lastScope;
    if (!scope || !scope.textbookId) {
      resolveScope().then(function (resolved) {
        if (!resolved || !resolved.textbookId) {
          toast(t("noBook"));
          return;
        }
        lastScope = resolved;
        openSourceDialog(initialPage);
      });
      return;
    }

    closeDialog();
    var page = Math.max(1, Number(initialPage) || 1);
    var total = 0;

    dialog = document.createElement("div");
    dialog.setAttribute("data-socratopia-source-dialog", "1");
    dialog.style.cssText =
      "position:relative;box-sizing:border-box;min-height:0;" +
      "display:flex;flex-direction:column;background:var(--surface-raised,#161618);" +
      "color:var(--foreground,#f4f4f5);border:1px solid var(--border,rgba(255,255,255,.14));" +
      "border-radius:12px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.45)";

    var panel = document.createElement("div");
    panel.style.cssText =
      "display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;padding:14px 16px 16px;" +
      "background:var(--surface-raised,#161618);color:var(--foreground,#f4f4f5)";

    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:10px";

    var title = document.createElement("div");
    title.style.cssText = "flex:1;font-size:14px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    title.appendChild(document.createTextNode(t("title")));
    var titleText = title.firstChild;
    var pageHint = document.createElement("span");
    pageHint.setAttribute("data-socratopia-source-page", "1");
    pageHint.style.cssText = "margin-left:8px;font-weight:400;color:var(--text-muted,#a1a1aa)";

    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("data-socratopia-source-close", "1");
    close.setAttribute("aria-label", t("close"));
    close.textContent = "×";
    close.style.cssText = "border:0;background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer;padding:2px 6px";
    close.addEventListener("click", closeDialog);
    head.appendChild(title);
    head.appendChild(close);

    var quote = document.createElement("div");
    quote.setAttribute("data-socratopia-source-quote", "1");
    quote.style.cssText =
      "font-size:12px;line-height:1.6;color:var(--text-muted,#a1a1aa);max-height:72px;overflow:auto;" +
      "padding-left:8px;border-left:2px solid var(--border,rgba(255,255,255,.18))";
    renderMarkdown(quoted, quote);

    var stage = document.createElement("div");
    stage.style.cssText =
      "flex:1;min-height:200px;display:flex;align-items:center;justify-content:center;overflow:auto;" +
      "background:var(--surface-sunken,#0f0f11);border-radius:10px";

    var image = document.createElement("img");
    image.setAttribute("data-socratopia-source-image", "1");
    image.alt = quoted ? quoted.slice(0, 80) : t("title");
    image.style.cssText = "max-width:100%;height:auto;display:block";
    stage.appendChild(image);

    var foot = document.createElement("div");
    foot.style.cssText = "display:flex;align-items:center;gap:8px;justify-content:center;font-size:13px;padding-left:16px";

    var prev = document.createElement("button");
    prev.type = "button";
    prev.setAttribute("data-socratopia-source-prev", "1");
    prev.setAttribute("aria-label", t("prev"));
    prev.textContent = "‹";
    prev.style.cssText = "border:1px solid var(--border,rgba(255,255,255,.18));background:transparent;color:inherit;" +
      "border-radius:9999px;width:28px;height:28px;cursor:pointer;line-height:1";

    var counter = document.createElement("span");
    counter.setAttribute("data-socratopia-source-counter", "1");
    counter.style.cssText = "min-width:64px;text-align:center;color:var(--text-muted,#a1a1aa)";

    var next = document.createElement("button");
    next.type = "button";
    next.setAttribute("data-socratopia-source-next", "1");
    next.setAttribute("aria-label", t("next"));
    next.textContent = "›";
    next.style.cssText = prev.style.cssText;
    foot.appendChild(prev);
    foot.appendChild(counter);
    foot.appendChild(next);

    panel.appendChild(head);
    head.appendChild(title);
    title.appendChild(pageHint);
    panel.appendChild(quote);
    panel.appendChild(stage);
    panel.appendChild(foot);
    dialog.appendChild(panel);
    dialogUnmount = mountPane(dialog, head, t("title"), closeDialog);

    // Clicking ‹/› fast used to fire one render request per click and pile them up
    // (40 rapid clicks = 40 cold pdfjs renders, ~60s). The visible page flips at
    // once, the fetch is debounced, and a page already retained locally skips the
    // delay entirely.
    function load(targetPage) {
      if (total && targetPage > total) return;
      if (targetPage < 1) return;
      page = targetPage;
      pageHint.textContent = " · " + t("page", { n: page });
      if (dialog && dialog.__socratopiaTabLabel) dialog.__socratopiaTabLabel(t("title") + " · " + t("page", { n: page }));
      counter.textContent = total ? page + " / " + total : String(page);
      prev.disabled = page <= 1;
      next.disabled = total ? page >= total : false;

      if (fetchTimer) clearTimeout(fetchTimer);
      var warmHit = keptPages.indexOf(pageUrl(scope, page, 960)) >= 0;
      if (warmHit) fetchPage(page);
      else fetchTimer = setTimeout(function () {
        fetchPage(page);
      }, 120);
    }

    function fetchPage(targetPage) {
      fetchTimer = null;
      page = targetPage;
      // 走 asset-capture 的 blob 通道：直连 <img src> 会被 HTTP 缓存里的早期 401 顶住，
      // 它的 _blobUrl 用 cache:"no-store" 避开这一点，失败时再退回直连地址。
      var url = pageUrl(scope, page, 960);
      var token = ++loadToken;
      var api = capture();
      if (keptPages.indexOf(url) < 0) keptPages.push(url);
      trimKept();
      var pending = api && typeof api._blobUrl === "function" ? api._blobUrl(url) : Promise.resolve(null);
      if (!api || typeof api._releaseBlob !== "function") pendingBlobs[url] = pending;
      Promise.resolve(pending)
        .then(function (blob) {
          if (token !== loadToken) return;
          applySource(blob || url, url);
        })
        .catch(function () {
          if (token !== loadToken) return;
          applySource(url, url);
        });
    }

    // Retain the neighbourhood (warmed both ways), release the rest. Every URL is
    // examined at most once per call, so a full-near buffer cannot loop.
    function trimKept() {
      var budget = keptPages.length;
      while (keptPages.length > KEPT_PAGES_LIMIT && budget-- > 0) {
        var url = keptPages.shift();
        var text = String(url);
        var near =
          text.indexOf("&page=" + page + "&") >= 0 ||
          text.indexOf("&page=" + (page - 1) + "&") >= 0 ||
          text.indexOf("&page=" + (page + 1) + "&") >= 0;
        if (near) keptPages.push(url);
        else releaseUrl(url);
      }
    }

    // The outgoing bitmap stays in place until the incoming one has decoded, so a
    // page turn no longer blanks the stage (the old code dropped opacity to .5 and
    // swapped src immediately). Warmed neighbours land from the same cache.
    function applySource(src, sourceUrl) {
      var settle = function () {
        image.removeEventListener("load", settle);
        image.removeEventListener("error", fail);
        image.style.opacity = "1";
        if (typeof warm === "function") warm(page);
      };
      var fail = function () {
        image.removeEventListener("load", settle);
        image.removeEventListener("error", fail);
        image.style.opacity = "1";
        toast(t("loadFailed"));
        // A stale cached URL fails to decode; drop it so the next load refetches
        // instead of replaying the dead one.
        if (sourceUrl) releaseUrl(sourceUrl);
      };
      image.addEventListener("load", settle);
      image.addEventListener("error", fail);

      // Assigning src to an <img> that still shows the previous page keeps that
      // page painted through the network window; only the empty first stage dims.
      if (!image.getAttribute("src")) image.style.opacity = ".35";
      image.src = src;
      return src;
    }

    prev.addEventListener("click", function () {
      load(page - 1);
    });
    next.addEventListener("click", function () {
      load(page + 1);
    });

    // Warm the two neighbours after the visible page has settled: `blobUrl` is
    // cached per URL, so the prefetch turns the next ‹/› into a cache hit. Bounded
    // to one in-flight pair and skipped while the user is still paging.
    function warm(targetPage) {
      if (warm.timer) clearTimeout(warm.timer);
      warm.timer = setTimeout(function () {
        if (!dialog || page !== targetPage) return;
        var api = capture();
        if (!api || typeof api._blobUrl !== "function") return;
        [targetPage + 1, targetPage - 1].forEach(function (near) {
          if (near < 1 || (total && near > total)) return;
          var url = pageUrl(scope, near, 960);
          if (keptPages.indexOf(url) < 0) keptPages.push(url);
          try {
            var pending = api._blobUrl(url);
            if (typeof api._releaseBlob !== "function") pendingBlobs[url] = pending;
          } catch (_) {}
        });
        trimKept();
      }, 220);
    }

    load(page);

    // 书名与总页数都来自服务端；拿不到就退化成通用标题与单页
    fetch(
      "/api/textbook?profileId=" + encodeURIComponent(scope.profileId) +
        "&worldId=" + encodeURIComponent(scope.worldId)
    )
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        var list = (data && data.textbooks) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].id === scope.textbookId) {
            if (list[i].title && titleText) titleText.textContent = list[i].title;
            var pages = Number(list[i].numPages);
            if (Number.isInteger(pages) && pages > 0) {
              total = pages;
              counter.textContent = page + " / " + total;
              next.disabled = page >= total;
            }
            return;
          }
        }
      })
      .catch(function () {});

    fetch(
      "/api/reading-context?profileId=" + encodeURIComponent(scope.profileId) +
        "&worldId=" + encodeURIComponent(scope.worldId) +
        "&textbookId=" + encodeURIComponent(scope.textbookId) +
        (scope.conversationId ? "&conversationId=" + encodeURIComponent(scope.conversationId) : "")
    )
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        var range = data && data.readingRange;
        var value = range && Number(range.totalPages);
        if (!total && Number.isInteger(value) && value > 0) {
          total = value;
          counter.textContent = page + " / " + total;
          next.disabled = page >= total;
        }
      })
      .catch(function () {});
  }

  // ---- 当前页（给面板答案的页码 chip 用） ------------------------------------
  var lastPage = null;

  function rememberPage(scope) {
    if (!scope || !scope.profileId || !scope.worldId) return Promise.resolve(null);
    return fetch(
      "/api/reading-context?profileId=" + encodeURIComponent(scope.profileId) +
        "&worldId=" + encodeURIComponent(scope.worldId) +
        (scope.textbookId ? "&textbookId=" + encodeURIComponent(scope.textbookId) : "") +
        (scope.conversationId ? "&conversationId=" + encodeURIComponent(scope.conversationId) : "")
    )
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        var range = data && data.readingRange;
        var page = Number(range && (range.taughtPage || range.startPage));
        if (Number.isInteger(page) && page > 0) lastPage = page;
        return lastPage;
      })
      .catch(function () {
        return lastPage;
      });
  }

  // 页签用：把选区压成一句短标题（去掉换行、限长）
  function pageLabel(selection) {
    var text = String((selection && selection.text) || "").replace(/\s+/g, " ").trim();
    if (text.length > 16) text = text.slice(0, 16) + "…";
    return text || t("title");
  }

  // 模型基本不会自己写页码，这里在提问里把当页和格式一起给它。
  function pageHint() {
    if (lastPage) {
      return "\n\n（本段出自第 " + lastPage + " 页。若提到出处，句末用 [p." + lastPage + "] 标出，不要写成别的形式。）";
    }
    return "\n\n（若提到出处，句末用 [p.页码] 标出。）";
  }

  // ---- 页码 chip：`[☰ p.12](socratopia:page#12)` 由 markdown 渲染层调到 ----
  function openPage(page) {
    if (!Number.isInteger(page) || page < 1) return;
    dockSelection = null;
    resolveScope()
      .then(function (scope) {
        if (!scope || !scope.textbookId) {
          toast(t("noBook"));
          return;
        }
        lastScope = scope;
        openSourceDialog(page);
      })
      .catch(function () {
        toast(t("noBook"));
      });
  }

  window.__SOCRATOPIA_SELECTION_DOCK_OPEN_PAGE__ = openPage;

  // ---- markdown 渲染：面板答案 / 原文引用共用 --------------------------------

  // ---- 独立面板：解释 / 问伙伴（不走主聊天窗口）-----------------------------
  //
  // 弹窗自带 markdown + KaTeX 渲染、伙伴选择与朗读；对话直接打到 /api/chat，
  // 不带 conversationId，因此不会在主线会话里留下痕迹，也不会触发自动推进。
  var panel = null;
  var panelUnmount = null;
  var panelState = null;
  var panelAbort = null;
  var panelSpeaking = null;

  function webpackRequire() {
    if (window.__wpReq) return window.__wpReq;
    try {
      window.webpackChunk_N_E.push([
        [Math.floor(Math.random() * 1e6) + 900000],
        {},
        function (req) {
          window.__wpReq = req;
        }
      ]);
    } catch (_) {}
    return window.__wpReq || null;
  }

  var markdownPipe = null;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 会话气泡里的 ```svg 围栏由 page-*.js 的 pre 覆盖渲染成一张内联图；面板走的是自己的
  // markdown 管线，没有那个覆盖，所以这里复刻一份：SVG 转 data-URI 图，尺寸取自 viewBox。
  function svgFigure(tex) {
    var source = String(tex).trim();
    if (source.indexOf("<svg") < 0) return "<pre><code>" + escapeHtml(source) + "</code></pre>";
    var box = /viewBox\s*=\s*["']([^"']+)["']/i.exec(source);
    var parts = box ? String(box[1]).trim().split(/[\s,]+/) : [];
    var width = Number(parts[2]) > 0 ? Math.round(Number(parts[2])) : 0;
    var height = Number(parts[3]) > 0 ? Math.round(Number(parts[3])) : 0;
    var uri = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(source)));
    return (
      '<img class="socratopia-svg-figure" alt="SVG" src="' + uri + '"' +
      (width ? ' width="' + width + '"' : "") +
      (height ? ' height="' + height + '"' : "") +
      ' loading="lazy">'
    );
  }

  function katexPipeline() {
    if (markdownPipe) return Promise.resolve(markdownPipe);
    var req = webpackRequire();
    if (!req) return Promise.resolve(null);
    return Promise.all([
      Promise.resolve().then(function () {
        return req(1876);
      }),
      req.e(2152).then(req.bind(req, 2152)),
      req.e(9978).then(req.bind(req, 9978)).then(function (m) {
        return m.default;
      }),
      Promise.resolve().then(req.bind(req, 1650)).then(function (m) {
        return m.default;
      }),
      req.e(6933).then(req.bind(req, 6933)).then(function (m) {
        return m.default;
      }),
      req.e(804).then(req.bind(req, 804)).then(function (m) {
        return m.default;
      }),
      req.e(7564).then(req.bind(req, 7564)).then(function (m) {
        return m.default;
      }),
      req.e(8740).then(req.bind(req, 8740)).then(function (m) {
        return m.default;
      })
    ])
      .then(function (mods) {
        var katex = mods[0] && (mods[0].default || mods[0]);
        var unified = mods[1].unified;
        var pipe = unified()
          .use(mods[2])
          .use(mods[3])
          .use(mods[4])
          .use(mods[5], { allowDangerousHtml: true })
          .use(mods[6], { detect: true })
          .use(mods[7], { allowDangerousHtml: true });
        markdownPipe = { katex: katex, pipe: pipe };
        return markdownPipe;
      })
      .catch(function () {
        return null;
      });
  }

  // 模型常常只写纯文本页码（`[p.182]`、`[p.170-171]`、`见 p.12 处`），不写 markdown 链接。
  // 裸页码补成 chip 链接（区间取首页）；已经是合法链接的先摘出去，免得被套两层。
  function linkifyPages(source) {
    var stashed = [];
    var text = String(source).replace(/\[[^\]\n]*\]\(socratopia:page#\d+\)/g, function (all) {
      stashed.push(all);
      return "\u0000" + (stashed.length - 1) + "\u0000";
    });
    text = text
      .replace(/\[(?:☰\s*)?p\.(\d{1,6})(?:\s*[-–~]\s*\d{1,6})?\](?!\()/g, function (all, page) {
        stashed.push("[☰ p." + page + "](socratopia:page#" + page + ")");
        return "\u0000" + (stashed.length - 1) + "\u0000";
      })
      .replace(/(^|[\s(（])(?:☰\s*)?p\.(\d{1,6})(?![\d-])/g, function (all, lead, page) {
        return lead + "[☰ p." + page + "](socratopia:page#" + page + ")";
      });
    return text.replace(/\u0000(\d+)\u0000/g, function (all, index) {
      return stashed[Number(index)] === undefined ? all : stashed[Number(index)];
    });
  }

  window.__SOCRATOPIA_SELECTION_DOCK_LINKIFY__ = linkifyPages;

  window.__SOCRATOPIA_SELECTION_DOCK_RENDER__ = renderMarkdown;

  function renderMarkdown(source, target) {
    target.__socratopiaRaw = source;
    target.textContent = source;
    katexPipeline().then(function (built) {
      if (!built || target.__socratopiaRaw !== source) return;
      var stash = [];
      var html = String(source);
      var hold = function (tex, display) {
        var slot = "SOCRBTPH" + stash.length + "X";
        try {
          stash.push(
            built.katex.renderToString(tex.trim(), {
              displayMode: display,
              throwOnError: false,
              errorColor: "inherit"
            })
          );
        } catch (_) {
          stash.push("<code>" + escapeHtml(tex) + "</code>");
        }
        return slot;
      };
      // 气泡里 ```svg 围栏是画出来的一张图（见 page-*.js 的 pre 覆盖），面板也要一样，
      // 否则模型画的图在面板里退化成一坨源码。整段先摘走，渲染完再换成 data-URI 图。
      var marks = [];
      var liftSvg = function (tex) {
        var slot = "SOCRSVG" + marks.length + "X";
        marks.push(svgFigure(tex));
        return "\n\n" + slot + "\n\n";
      };
      // `\$` 是数学里的转义美元符（`$\$$`），先用哨兵替掉，否则会被当成定界符。
      // 公式必须整段先摘出来再补 chip：模型会把页码紧贴在公式后面（`$c/d/\$$[p.186]`）。
      // 教材正文常拿一个裸 `$` 当符号（`$ 是有道理的`、`只能是 $。`）。开定界符后面不跟
      // 空白、收定界符前面不带空白，才认作公式；否则两个裸 `$` 会被配成一对 `$$…$$`，
      // 把中间整段吞成行间公式。
      var esc = "\u0001";
      html = String(source)
        .replace(/```[ \t]*svg[^\n]*\n([\s\S]*?)```/g, function (all, tex) {
          return liftSvg(tex);
        })
        .replace(/\\\$/g, esc)
        .replace(/\$\$(?![\s$])([\s\S]+?)(?<![\s$])\$\$/g, function (all, tex) {
          return hold(tex.split(esc).join("\\$"), true);
        })
        .replace(/\$(?![\s$])([^$\n]+?)(?<![\s$])\$/g, function (all, tex) {
          return hold(tex.split(esc).join("\\$"), false);
        })
        .split(esc)
        .join("\\$");
      html = linkifyPages(html);
      // 模型常把末尾的追问整段包在尖括号里（`<…？>`），markdown 会当成 HTML 标签原样转义。
      // 整行都被尖括号包住的改成行内引用，既不被吃掉又保留它和正文的区分。
      html = html.replace(/^<([^<>\n][^<>\n]*)>[ \t]*$/gm, function (all, line) {
        if (/^\/?(?:div|span|br|p|img|a|table|tbody|tr|td|th|ul|ol|li|strong|em|code|pre|h[1-6]|hr|blockquote|details|summary|svg)(?:\s|\/|$)/.test(line)) {
          return all;
        }
        return "> " + line.trim();
      });
      var out = "";
      try {
        out = String(built.pipe.processSync(html));
      } catch (_) {
        return;
      }
      out = out.replace(/SOCRBTPH(\d+)X/g, function (all, index) {
        return stash[Number(index)] === undefined ? all : stash[Number(index)];
      });
      out = out.replace(/SOCRSVG(\d+)X/g, function (all, index) {
        return marks[Number(index)] === undefined ? all : marks[Number(index)];
      });
      target.__socratopiaRaw = source;
      target.innerHTML = out;
      var chips = target.querySelectorAll('a[href^="socratopia:page#"]');
      for (var i = 0; i < chips.length; i++) {
        chips[i].setAttribute("data-socratopia-page-chip", "1");
        chips[i].className = "socratopia-page-chip";
      }
    });
  }

  function speakText(text, voiceKey, onDone) {
    var voice = voiceModule();
    if (!voice || typeof voice.speak !== "function" || !text.trim()) {
      onDone && onDone();
      return;
    }
    Promise.resolve()
      .then(function () {
        return voice.speak(text, voiceKey, "panel-" + Date.now(), 1);
      })
      .catch(function () {})
      .then(function () {
        onDone && onDone();
      });
  }

  function stopPanelSpeech() {
    var voice = voiceModule();
    try {
      if (voice && voice.voicePlayer && typeof voice.voicePlayer.stop === "function") voice.voicePlayer.stop();
    } catch (_) {}
    panelSpeaking = null;
  }

  // 音色：优先 settings 里为这个伙伴存过的音色，其次按性别走默认音色
  function voiceForCompanion(companion) {
    var voice = voiceModule();
    if (!voice) return null;
    var language = "zh";
    try {
      var accountId = localStorage.getItem("socralab_active_account_id");
      var raw = localStorage.getItem(accountId ? "socralab_settings_" + accountId : "socralab_settings");
      if (raw) {
        var settings = JSON.parse(raw) || {};
        var map = settings.companionVoices || {};
        var direct = map[companion.candidateId] || map[companion.candidateId + ":" + language];
        if (direct) return direct;
      }
    } catch (_) {}
    var gender = companion.pronoun === "他" ? "male" : "female";
    if (typeof voice.defaultVoiceFor === "function") {
      return voice.defaultVoiceFor(gender, language) || voice.DEFAULT_VOICE_KEY;
    }
    return voice.DEFAULT_VOICE_KEY;
  }

  function companionList() {
    var scope = lastScope || window.__SOCRATOPIA_ASSET_SCOPE__ || null;
    if (!scope || !scope.profileId) return Promise.resolve([]);
    return fetch("/api/world?profileId=" + encodeURIComponent(scope.profileId))
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        var slots = ["npc_a", "npc_b", "npc_c", "npc_d"];
        var list = (data && data.companions) || [];
        var worldId = (data && data.active && data.active.worldId) || scope.worldId;
        var out = [];
        for (var i = 0; i < list.length && i < slots.length; i++) {
          if (!list[i]) continue;
          out.push({
            slotId: slots[i],
            name: list[i].customName || list[i].name || slots[i],
            pronoun: list[i].pronoun || "",
            candidateId: list[i].candidateId || "",
            companionInstanceId: list[i].companionInstanceId || "",
            color: list[i].color || "var(--accent)",
            avatarUrl:
              "/api/companion/avatar?profileId=" + encodeURIComponent(scope.profileId) +
              "&worldId=" + encodeURIComponent(worldId) + "&slotId=" + slots[i]
          });
        }
        return out;
      })
      .catch(function () {
        return [];
      });
  }

  function closePanel() {
    if (panelAbort) {
      try {
        panelAbort.abort();
      } catch (_) {}
      panelAbort = null;
    }
    stopPanelSpeech();
    if (panelUnmount) panelUnmount();
    panelUnmount = null;
    if (panel) panel.remove();
    panel = null;
    panelState = null;
  }

  function openPanel(mode, selection) {
    if (!selection) return;
    closePanel();
    panelState = { mode: mode, text: selection.text, companions: [], chosen: null, busy: false };
    rememberPage(lastScope || window.__SOCRATOPIA_ASSET_SCOPE__);

    panel = document.createElement("div");
    panel.setAttribute("data-socratopia-selection-panel", "1");
    panel.style.cssText =
      "position:relative;box-sizing:border-box;min-height:0;" +
      "display:flex;flex-direction:column;background:var(--surface-raised,#161618);" +
      "color:var(--foreground,#f4f4f5);border:1px solid var(--border,rgba(255,255,255,.14));" +
      "border-radius:12px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.45)";

    var head = document.createElement("div");
    head.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border,rgba(255,255,255,.12))";

    var heading = document.createElement("div");
    heading.style.cssText = "flex:1;font-size:14px;font-weight:600";
    heading.textContent = mode === "companion" ? t("panelCompanion") : t("panelExplain");
    var chosenLabel = null;
    if (mode === "companion") {
      chosenLabel = document.createElement("span");
      chosenLabel.setAttribute("data-socratopia-panel-chosen", "1");
      chosenLabel.style.cssText = "margin-left:6px;font-weight:400;color:var(--text-muted,#a1a1aa)";
      heading.appendChild(chosenLabel);
    }

    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("data-socratopia-panel-close", "1");
    close.setAttribute("aria-label", t("closePanel"));
    close.textContent = "×";
    close.style.cssText = "border:0;background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer;padding:2px 6px";
    close.addEventListener("click", closePanel);
    head.appendChild(heading);
    head.appendChild(close);

    var quote = document.createElement("div");
    quote.setAttribute("data-socratopia-panel-quote", "1");
    quote.style.cssText =
      "margin:12px 14px 0;padding:8px 10px;font-size:12px;line-height:1.65;max-height:110px;overflow:auto;" +
      "color:var(--text-muted,#a1a1aa);background:var(--surface-sunken,#0f0f11);border-radius:8px;" +
      "border-left:2px solid var(--accent,rgba(255,255,255,.2))";
    renderMarkdown(selection.text, quote);

    panel.appendChild(head);
    panel.appendChild(quote);

    if (mode === "companion") {
      var pickerLabel = document.createElement("div");
      pickerLabel.style.cssText = "margin:12px 14px 6px;font-size:12px;color:var(--text-muted,#a1a1aa)";
      pickerLabel.textContent = t("pickCompanion");
      var picker = document.createElement("div");
      picker.setAttribute("data-socratopia-panel-companions", "1");
      picker.style.cssText = "display:flex;gap:6px;padding:0 14px;flex-wrap:wrap";
      panel.appendChild(pickerLabel);
      panel.appendChild(picker);

      companionList().then(function (list) {
        if (!panel || panelState.mode !== "companion") return;
        panelState.companions = list;
        if (!list.length) {
          pickerLabel.textContent = t("noCompanion");
          return;
        }
        panelState.chosen = list[0];
        list.forEach(function (companion) {
          var chip = document.createElement("button");
          chip.type = "button";
          chip.setAttribute("data-socratopia-panel-companion", companion.slotId);
          chip.style.cssText =
            "display:flex;align-items:center;gap:6px;padding:4px 10px 4px 4px;border-radius:9999px;" +
            "font-size:12px;cursor:pointer;background:var(--surface-sunken,#0f0f11);" +
            "color:inherit;border:1px solid var(--border,rgba(255,255,255,.14))";

          var avatar = document.createElement("img");
          avatar.src = companion.avatarUrl;
          avatar.alt = companion.name;
          avatar.style.cssText = "width:20px;height:20px;border-radius:9999px;object-fit:cover";
          chip.appendChild(avatar);
          chip.appendChild(document.createTextNode(companion.name));

          var paint = function () {
            var on = panelState && panelState.chosen === companion;
            chip.style.borderColor = on ? "var(--accent-solid,#3a6df0)" : "var(--border,rgba(255,255,255,.14))";
            chip.style.background = on ? "var(--accent-bg,rgba(58,109,240,.16))" : "var(--surface-sunken,#0f0f11)";
          };
          chip.__paint = paint;
          chip.addEventListener("click", function () {
            panelState.chosen = companion;
            for (var i = 0; i < picker.children.length; i++) {
              var other = picker.children[i];
              if (other.__paint) other.__paint();
            }
            if (chosenLabel) chosenLabel.textContent = "· " + companion.name;
            if (panel.__socratopiaTabLabel) panel.__socratopiaTabLabel(t("panelCompanion") + " · " + companion.name);
            if (input) input.focus();
          });
          if (panelState.chosen === companion && chosenLabel) chosenLabel.textContent = "· " + companion.name;
          paint();
          picker.appendChild(chip);
        });
      });
    }

    var input = document.createElement("textarea");
    input.setAttribute("data-socratopia-panel-input", "1");
    input.setAttribute("rows", "2");
    input.placeholder = t("askPlaceholder");
    input.style.cssText =
      "margin:10px 14px 0;padding:8px 10px;font-size:13px;line-height:1.5;resize:vertical;min-height:52px;" +
      "border-radius:8px;background:var(--surface-sunken,#0f0f11);color:inherit;" +
      "border:1px solid var(--border,rgba(255,255,255,.14));font-family:inherit";
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        ask();
      }
    });
    panel.appendChild(input);

    var answer = document.createElement("div");
    answer.setAttribute("data-socratopia-panel-answer", "1");
    answer.className = "markdown-content";
    answer.style.cssText =
      "flex:1;min-height:0;overflow:auto;padding:12px 14px;font-size:13.5px;line-height:1.75";
    panel.appendChild(answer);

    answer.addEventListener("click", function (event) {
      var link = event.target.closest && event.target.closest('a[href^="socratopia:page#"]');
      if (!link) return;
      event.preventDefault();
      var page = Number(String(link.getAttribute("href")).split("#")[1]);
      if (Number.isInteger(page) && page > 0) openPage(page);
    });

    var foot = document.createElement("div");
    foot.style.cssText =
      "display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px 10px 24px;" +
      "border-top:1px solid var(--border,rgba(255,255,255,.12))";

    var send = document.createElement("button");
    send.type = "button";
    send.setAttribute("data-socratopia-panel-send", "1");
    send.textContent = t("send");
    send.style.cssText =
      "border:0;border-radius:8px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;" +
      "background:var(--accent-solid,#3a6df0);color:var(--text-inverse,#fff)";
    send.addEventListener("click", function () {
      ask();
    });

    var speak = document.createElement("button");
    speak.type = "button";
    speak.setAttribute("data-socratopia-panel-speak", "1");
    speak.textContent = t("speakAll");
    speak.disabled = true;
    speak.style.cssText =
      "border:1px solid var(--border,rgba(255,255,255,.18));border-radius:8px;padding:7px 12px;" +
      "font-size:13px;cursor:pointer;background:transparent;color:inherit;opacity:.55";

    var insert = document.createElement("button");
    insert.type = "button";
    insert.setAttribute("data-socratopia-panel-insert", "1");
    insert.textContent = t("insertToChat");
    insert.style.cssText = speak.style.cssText;

    foot.appendChild(send);
    foot.appendChild(speak);
    foot.appendChild(insert);
    panel.appendChild(foot);

    panelUnmount = mountPane(
      panel,
      head,
      mode === "companion" ? t("panelCompanion") : t("panelExplain"),
      closePanel
    );

    if (mode === "explain") ask();

    function ask() {
      if (!panelState || panelState.busy) return;
      var scope = lastScope;
      if (!scope || !scope.profileId || !scope.worldId) {
        resolveScope().then(function (resolved) {
          if (!resolved) {
            toast(t("failed"));
            return;
          }
          lastScope = resolved;
          ask();
        });
        return;
      }
      var followUp = (input.value || "").trim();
      loadWorldLanguage(scope).then(function () {
        if (!panelState || panelState.busy) return;
        post();
      });

      // 注意：不能叫 `send`，会遮住同名的发送按钮变量
      function post() {
      var body = {
        messages: [
          {
            role: "user",
            content:
              (panelState.mode === "companion" ? t("insertCompanion") : t("insertExplain")) +
              "\n\n「" + panelState.text + "」" +
              (followUp ? "\n\n" + followUp : "") +
              pageHint() +
              (panelState.mode === "companion"
                ? "\n\n（只需回答这段引文相关的问题，三到五句，不要复述引文。）"
                : "")
          }
        ],
        character: panelState.mode === "companion" && panelState.chosen ? panelState.chosen.slotId : "npc_a",
        teachingLanguage: teachingLanguage(scope),
        profileId: scope.profileId,
        worldId: scope.worldId,
        accessMode: "hosted",
        sessionToken: "local-session",
        clientTotalTokens: 24000
      };
      if (panelState.mode === "companion" && panelState.chosen) {
        if (panelState.chosen.companionInstanceId) body.companionInstanceId = panelState.chosen.companionInstanceId;
        if (panelState.chosen.candidateId) body.candidateId = panelState.chosen.candidateId;
      }
      if (scope.textbookId) body.textbookId = scope.textbookId;

      panelState.busy = true;
      panelState.answerText = "";
      input.value = "";
      answer.textContent = t("thinking");
      speak.disabled = true;
      send.disabled = true;
      send.style.opacity = ".6";
      panelAbort = new AbortController();
      var currentAbort = panelAbort;

      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: currentAbort.signal
      })
        .then(function (response) {
          if (!response.ok || !response.body) throw new Error("chat_" + response.status);
          var reader = response.body.getReader();
          var decoder = new TextDecoder();
          var buffer = "";
          var first = true;
          return (function pump() {
            return reader.read().then(function (chunk) {
              if (chunk.done) return;
              buffer += decoder.decode(chunk.value, { stream: true });
              var parts = buffer.split("\n\n");
              buffer = parts.pop() || "";
              for (var i = 0; i < parts.length; i++) {
                var line = parts[i].trim();
                if (line.indexOf("data: ") !== 0) continue;
                var event;
                try {
                  event = JSON.parse(line.slice(6));
                } catch (_) {
                  continue;
                }
                if (event.type === "text" && event.text) {
                  if (first) {
                    first = false;
                    panelState.answerText = "";
                    answer.textContent = "";
                  }
                  panelState.answerText += event.text;
                  renderMarkdown(panelState.answerText, answer);
                  answer.scrollTop = answer.scrollHeight;
                } else if (event.type === "error") {
                  throw new Error(String(event.error || "chat_error"));
                }
              }
              return pump();
            });
          })();
        })
        .then(function () {
          if (currentAbort !== panelAbort) return;
          if (!panelState.answerText) panelState.answerText = t("emptyAnswer");
          renderMarkdown(panelState.answerText, answer);
          speak.disabled = false;
          speak.style.opacity = "1";
          speak.onclick = function () {
            if (panelSpeaking) {
              stopPanelSpeech();
              speak.textContent = t("speakAll");
              return;
            }
            var voiceKey =
              panelState.mode === "companion" && panelState.chosen
                ? voiceForCompanion(panelState.chosen)
                : window.__SOCRATOPIA_SPEECH_VOICE__ || null;
            var text = String(panelState.answerText || "").replace(/\[(☰ )?p\.\d+\]\(socratopia:page#\d+\)/g, "").slice(0, MAX_CHARS);
            if (!text.trim()) return;
            panelSpeaking = "1";
            speak.textContent = t("stop");
            speakText(text, voiceKey, function () {
              panelSpeaking = null;
              speak.textContent = t("speakAll");
            });
          };
        })
        .catch(function (error) {
          if (currentAbort !== panelAbort || (error && error.name === "AbortError")) return;
          panelState.answerText = "";
          renderMarkdown("**" + t("failed") + "** " + escapeHtml(String((error && error.message) || "")), answer);
        })
        .then(function () {
          if (currentAbort !== panelAbort) return;
          panelState.busy = false;
          send.disabled = false;
          send.style.opacity = "1";
          panelAbort = null;
          if (panel) input.focus();
        });
      }
    }

    insert.addEventListener("click", function () {
      var text = (panelState.answerText || "").trim();
      if (!text) return;
      var name = panelState.chosen ? panelState.chosen.name : "";
      var label = t("quote") + (name ? " · " + name : "");
      var ok = insertText(label + "：\n\n「" + panelState.text + "」\n\n" + text + "\n");
      if (!ok) copyText(label + "：" + panelState.text + "\n\n" + text);
      toast(ok ? t("inserted") : t("copied"));
    });

    if (mode === "explain") input.focus();
  }

  // ---- 动作分派 -------------------------------------------------------------
  function runAction(action) {
    var selection = dockSelection;
    if (!selection) return;
    if (action === "close") {
      hideDock();
      try {
        window.getSelection().removeAllRanges();
      } catch (_) {}
      return;
    }
    if (action === "speak") {
      speakCurrent();
      return;
    }
    if (action === "explain") {
      openPanel("explain", selection);
      hideDock();
      return;
    }
    if (action === "companion") {
      openPanel("companion", selection);
      hideDock();
      return;
    }
    if (action === "source") {
      resolveScope()
        .then(function (scope) {
          if (!scope || !scope.textbookId) {
            toast(t("noBook"));
            return;
          }
          lastScope = scope;
          return fetch(
            "/api/reading-context?profileId=" + encodeURIComponent(scope.profileId) +
              "&worldId=" + encodeURIComponent(scope.worldId) +
              "&textbookId=" + encodeURIComponent(scope.textbookId) +
              (scope.conversationId ? "&conversationId=" + encodeURIComponent(scope.conversationId) : "")
          )
            .then(function (response) {
              return response.ok ? response.json() : null;
            })
            .then(function (data) {
              var start = data && data.readingRange && Number(data.readingRange.startPage);
              openSourceDialog(Number.isInteger(start) && start >= 1 ? start : 1);
            })
            .catch(function () {
              openSourceDialog(1);
            });
        })
        .catch(function () {
          toast(t("noBook"));
        });
    }
  }

  dock = null;

  // ---- 输入框预览 -----------------------------------------------------------
  // 「插入」把原文与答案原样写进 textarea，可 textarea 只认纯文本：`$I_6$`、
  // 表格、```svg 到那儿全退成源码，跟气泡里的样子对不上。给它垫一层只读预览，
  // 走同一个 renderMarkdown（同样的 katex / svg / 页码 chip），用户看到的即是成品的模样。
  var previewNode = null;
  var previewTimer = null;
  var PREVIEW_MARKUP = /\$|```|^\s*(?:[-*+|#]|\d+\.)|\]\(|<\w+/m;

  function ensurePreview() {
    if (previewNode && previewNode.isConnected) return previewNode;
    previewNode = document.createElement("div");
    previewNode.setAttribute("data-socratopia-composer-preview", "1");
    previewNode.setAttribute("aria-hidden", "true");
    previewNode.style.cssText =
      "max-width:50rem;margin:0 auto 6px;max-height:28vh;overflow:auto;padding:6px 10px;" +
      "font-size:12.5px;line-height:1.65;border-radius:10px;" +
      "color:var(--text-muted,#a1a1aa);background:var(--surface-sunken,rgba(127,127,127,.09));" +
      "border:1px dashed var(--border,rgba(127,127,127,.28))";
    return previewNode;
  }

  function syncComposerPreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      previewTimer = null;
      var field = composer();
      if (!field || !field.parentElement) {
        if (previewNode && previewNode.isConnected) previewNode.remove();
        return;
      }
      var value = field.value || "";
      if (!value.trim() || !PREVIEW_MARKUP.test(value)) {
        if (previewNode && previewNode.isConnected) previewNode.style.display = "none";
        return;
      }
      var node = ensurePreview();
      var column = field.parentElement.parentElement;
      if (node.parentNode !== column) column.insertBefore(node, field.parentElement);
      node.style.display = "block";
      renderMarkdown(value, node);
    }, 140);
  }

  document.addEventListener("input", function (event) {
    var field = composer();
    if (field && event.target === field) syncComposerPreview();
  });

  var style = document.createElement("style");
  style.setAttribute("data-socratopia-selection-style", "1");
  style.textContent =
    ".socratopia-page-chip{display:inline-flex;align-items:center;gap:2px;padding:0 6px;margin:0 2px;" +
    "border-radius:9999px;font-size:.86em;line-height:1.5;text-decoration:none;white-space:nowrap;" +
    "background:var(--surface-raised,rgba(255,255,255,.1));color:var(--accent,#93bbe2);" +
    "border:1px solid var(--border,rgba(255,255,255,.18));cursor:pointer}" +
    ".socratopia-page-chip:hover{background:var(--surface-hover,rgba(255,255,255,.16))}" +
    ".socratopia-svg-figure{display:block;max-width:100%;max-height:22rem;object-fit:contain;" +
    "margin:.5rem 0;background:#fff;border-radius:6px}";
  (document.head || document.documentElement).appendChild(style);

  document.addEventListener("mousedown", function (event) {
    ensureDock();
  });

  document.addEventListener("selectionchange", function () {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(evaluateSelection, DEBOUNCE_MS);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    // 只关当前活动的页签，别把另一个也关掉
    if (panel && panel.style.display !== "none") {
      closePanel();
      return;
    }
    if (dialog && dialog.style.display !== "none") {
      closeDialog();
      return;
    }
    if (speaking) stopSpeaking();
    hideDock();
  });

  // 滚动不再一律收掉浮条：选区还在视口里就跟着走（拖动选择/平滑滚动都会触发 scroll），
  // 真滚出视口才收起。
  window.addEventListener("scroll", function () {
    if (speaking || !dock || dock.style.display === "none") return;
    if (!dockSelection) {
      hideDock();
      return;
    }
    var box;
    try {
      box = dockSelection.range.getBoundingClientRect();
    } catch (_) {
      hideDock();
      return;
    }
    if (!box || box.bottom < 0 || box.top > window.innerHeight) {
      hideDock();
      return;
    }
    placeDock(dockSelection.range);
  }, true);

  window.addEventListener("resize", function () {
    if (dock && dock.style.display !== "none" && dockSelection && !speaking) {
      placeDock(dockSelection.range);
      return;
    }
    hideDock();
  });
})();
