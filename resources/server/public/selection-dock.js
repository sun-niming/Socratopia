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
      viewText: "文字",
      viewImage: "页图",
      notFound: "第 {n} 页没有提取到文字",
      locating: "按选区定位页码…",
      fallbackNote: "这句没能在正文里定位到（可能是扫描页），先跳到教学进度这一页。",
      staleNote: "这句没能在正文里定位到，教学进度也停在这一页之前，先跳到当前阅读窗口的起点。",
      noText: "这段没有可朗读的文字",
      quote: "原文",
      insertExplain: "解释这段内容：",
      insertCompanion: "关于这段内容：",
      noFollowUp: "（直接讲清即可：三到五句，不要复述引文，也不要在结尾再抛一个问题。）",
      prev: "上一页",
      next: "下一页",
      jumpTo: "跳到指定页（回车跳转，Esc 取消）",
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
      closePanel: "关闭",
      floatPane: "浮动 / 停靠",
      dockPane: "停靠到右侧"
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
      viewText: "文字",
      viewImage: "頁圖",
      notFound: "第 {n} 頁沒有擷取到文字",
      locating: "按選取範圍定位頁碼…",
      fallbackNote: "這句未能在正文裡定位（可能是掃描頁），先跳到教學進度這一頁。",
      staleNote: "這句未能在正文裡定位，教學進度也停在這一頁之前，先跳到目前閱讀視窗的起點。",
      noText: "這段沒有可朗讀的文字",
      quote: "原文",
      insertExplain: "解釋這段內容：",
      insertCompanion: "關於這段內容：",
      noFollowUp: "（直接講清即可：三到五句，不要複述引文，也不要在結尾再拋一個問題。）",
      prev: "上一頁",
      next: "下一頁",
      jumpTo: "跳到指定頁（Enter 跳轉，Esc 取消）",
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
      closePanel: "關閉",
      floatPane: "浮動 / 停靠",
      dockPane: "停靠到右側"
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
      viewText: "Text",
      viewImage: "Page image",
      notFound: "No text extracted from page {n}",
      locating: "Locating the page from the selection…",
      fallbackNote: "This passage could not be located in the text layer (a scanned page?), so the page the lesson has reached is shown.",
      staleNote: "This passage could not be located and the lesson progress stops before it, so the start of the current reading window is shown.",
      noText: "Nothing to read in this selection",
      quote: "Quoted text",
      insertExplain: "Explain this passage:",
      insertCompanion: "About this passage:",
      noFollowUp: "(Just explain it plainly: 3-5 sentences, do not restate the quote, and do not end on another question.)",
      prev: "Previous page",
      next: "Next page",
      jumpTo: "Jump to page (Enter to go, Esc to cancel)",
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
      closePanel: "Close",
      floatPane: "Float / dock",
      dockPane: "Dock to the right"
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
  var textToken = 0;
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

  // ---- 右侧容器：解释 / 问伙伴 / 原文共用 -------------------------------------
  //
  // 学习区是一块自己摆的容器（编辑器 / LeetCode 那种分屏）：默认停靠右侧，抓标题条
  // 能拖到左边或右边，也可以干脆浮在页面任意处；四条边和四角都能拉。停靠时还多一条
  // 中间分隔条。位置、尺寸、停靠方向都记进 localStorage，下次照旧。
  var LAYOUT_KEY = "socratopia.split.layout";
  var DOCK_SNAP = 0.16;
  var MIN_W = 320;
  var MIN_H = 220;
  var GRIP_BOX = {
    n: "left:7px;right:7px;top:0;height:7px",
    s: "left:7px;right:7px;bottom:0;height:7px",
    e: "top:7px;bottom:7px;right:0;width:7px",
    w: "top:7px;bottom:7px;left:0;width:7px",
    ne: "top:0;right:0;width:13px;height:13px",
    nw: "top:0;left:0;width:13px;height:13px",
    se: "bottom:0;right:0;width:13px;height:13px",
    sw: "bottom:0;left:0;width:13px;height:13px"
  };
  var GRIP_CURSOR = {
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    nw: "nwse-resize",
    se: "nwse-resize"
  };
  var splitWrap = null;
  var splitPane = null;
  var splitSeq = 0;
  var floaterObserver = null;
  var layout = readLayout();

  function readLayout() {
    var fallback = { mode: "right", x: 0, y: 0, w: 0, h: 0 };
    var parsed = null;
    try {
      parsed = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) || "null");
    } catch (_) {
      return fallback;
    }
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      mode: parsed.mode === "left" || parsed.mode === "float" ? parsed.mode : "right",
      x: Number(parsed.x) || 0,
      y: Number(parsed.y) || 0,
      w: Number(parsed.w) || 0,
      h: Number(parsed.h) || 0
    };
  }

  function rememberLayout() {
    try {
      window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch (_) {}
  }

  function dockWidth() {
    var max = Math.max(MIN_W, window.innerWidth - 380);
    var width = layout.w > 0 ? layout.w : Math.min(560, window.innerWidth * 0.44);
    return Math.round(Math.max(MIN_W, Math.min(width, max)));
  }

  function floatRect() {
    var w = Math.round(Math.max(MIN_W, Math.min(layout.w || 520, window.innerWidth - 24)));
    var h = Math.round(Math.max(MIN_H, Math.min(layout.h || 440, window.innerHeight - 24)));
    return {
      w: w,
      h: h,
      x: Math.round(Math.max(0, Math.min(layout.x, window.innerWidth - w))),
      y: Math.round(Math.max(0, Math.min(layout.y, window.innerHeight - h)))
    };
  }

  // 拖动过程中不做夹取，免得贴着屏幕边就被弹回来；松手时再交给 applyLayout 收边。
  function paintRaw() {
    var divider = splitWrap.querySelector("[data-socratopia-split-divider]");
    if (divider) divider.style.display = "none";
    splitPane.style.position = "fixed";
    splitPane.style.order = "";
    if (divider) divider.style.order = "";
    splitPane.style.left = Math.round(layout.x) + "px";
    splitPane.style.top = Math.round(layout.y) + "px";
    splitPane.style.width = Math.round(layout.w) + "px";
    splitPane.style.height = Math.round(layout.h) + "px";
    splitPane.style.border = "1px solid var(--border,rgba(255,255,255,.16))";
    splitPane.style.borderRadius = "12px";
    splitPane.style.boxShadow = "0 24px 64px rgba(0,0,0,.48)";
  }

  function applyLayout() {
    if (!splitWrap || !splitPane) return;
    var divider = splitWrap.querySelector("[data-socratopia-split-divider]");
    var app = splitWrap.__socratopiaApp;
    splitPane.style.position = "";
    splitPane.style.left = "";
    splitPane.style.top = "";
    splitPane.style.height = "";
    splitPane.style.order = "";
    splitPane.style.border = "0";
    splitPane.style.borderRadius = "0";
    splitPane.style.boxShadow = "none";
    if (divider) divider.style.display = "";
    if (divider) divider.style.order = "";
    if (app) {
      app.style.flex = "1 1 auto";
      app.style.minWidth = "0";
      app.style.height = "100%";
    }
    if (layout.mode === "float") {
      var rect = floatRect();
      layout.x = rect.x;
      layout.y = rect.y;
      layout.w = rect.w;
      layout.h = rect.h;
      paintRaw();
      offsetFloaters(null);
      return;
    }
    splitPane.style.width = dockWidth() + "px";
    if (layout.mode === "left") {
      // pane 排到最左、分隔条紧随其后、主列垫底：靠 order 而不是挪 DOM
      splitPane.style.order = "-2";
      if (divider) divider.style.order = "-1";
      splitPane.style.borderRight = "1px solid var(--border,rgba(255,255,255,.12))";
    } else {
      splitPane.style.borderLeft = "1px solid var(--border,rgba(255,255,255,.12))";
    }
    offsetFloaters(layout.mode === "right" ? splitPane.offsetWidth : null);
  }

  // 一次拖拽 / 拉伸的公共骨架：按下记起点，移动改 layout，松手吸附并落盘。
  function beginGesture(kind, dir, event) {
    if (!splitPane || event.button !== 0) return;
    if (kind === "move" && event.target.closest && (event.target.closest("[data-socratopia-split-tab-close]") || event.target.closest("[data-socratopia-split-float]"))) return;
    // 页签是可点的按钮，按住时不要让它抢走拖拽
    event.preventDefault();
    var rect = splitPane.getBoundingClientRect();
    var box = { x: event.clientX, y: event.clientY, l: rect.left, t: rect.top, w: rect.width, h: rect.height };
    var draft = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    // 停靠态左右拉边等价于改停靠宽度，不必先转成浮层
    var stay = kind === "resize" && layout.mode !== "float" && (dir === "e" || dir === "w");

    function paint(moveEvent) {
      var dx = moveEvent.clientX - box.x;
      var dy = moveEvent.clientY - box.y;
      if (kind === "move") {
        draft.x = box.l + dx;
        draft.y = box.t + dy;
        layout.mode = "float";
      } else {
        draft.w = box.w;
        draft.h = box.h;
        if (dir.indexOf("e") >= 0) draft.w = box.w + dx;
        if (dir.indexOf("w") >= 0) {
          draft.w = box.w - dx;
          draft.x = box.l + dx;
        }
        if (dir.indexOf("s") >= 0) draft.h = box.h + dy;
        if (dir.indexOf("n") >= 0) {
          draft.h = box.h - dy;
          draft.y = box.t + dy;
        }
        if (draft.w < MIN_W) {
          if (dir.indexOf("w") >= 0) draft.x = box.l + box.w - MIN_W;
          draft.w = MIN_W;
        }
        if (draft.h < MIN_H) {
          if (dir.indexOf("n") >= 0) draft.y = box.t + box.h - MIN_H;
          draft.h = MIN_H;
        }
        if (stay) {
          layout.w = Math.round(draft.w);
          splitPane.style.width = layout.w + "px";
          offsetFloaters(layout.mode === "right" ? layout.w : null);
          return;
        }
        layout.mode = "float";
      }
      layout.x = draft.x;
      layout.y = draft.y;
      layout.w = draft.w;
      layout.h = draft.h;
      paintRaw();
    }

    function stop(upEvent) {
      document.removeEventListener("mousemove", paint, true);
      document.removeEventListener("mouseup", stop, true);
      document.removeEventListener("selectstart", block, true);
      // 拖到左右两侧的窄条里就吸附停靠，其余位置留成浮层。判据用松手时的指针位置，
      // 不用面板中心：面板一宽，中心离边就远，用户手已经贴边了却不吸附。
      if (kind === "move") {
        var edge = window.innerWidth * DOCK_SNAP;
        var at = upEvent && typeof upEvent.clientX === "number" ? upEvent.clientX : draft.x + draft.w / 2;
        if (at < edge) layout.mode = "left";
        else if (at > window.innerWidth - edge) layout.mode = "right";
      }
      applyLayout();
      rememberLayout();
    }

    var block = function (ev) {
      ev.preventDefault();
    };
    document.addEventListener("mousemove", paint, true);
    document.addEventListener("mouseup", stop, true);
    document.addEventListener("selectstart", block, true);
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
    splitWrap.__socratopiaApp = app;

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
      "position:relative;flex:0 0 auto;display:flex;flex-direction:column;min-width:0;overflow:hidden;" +
      "background:var(--surface-raised,#161618);" +
      "border-left:1px solid var(--border,rgba(255,255,255,.12))";

    var tabs = document.createElement("div");
    tabs.setAttribute("data-socratopia-split-tabs", "1");
    tabs.setAttribute("role", "tablist");
    // 标题条兼作拖动手柄
    tabs.style.cssText =
      "flex:0 0 auto;display:flex;align-items:stretch;gap:2px;overflow-x:auto;cursor:grab;" +
      "background:var(--surface-sunken,#0f0f11);border-bottom:1px solid var(--border,rgba(255,255,255,.12))";
    tabs.addEventListener("mousedown", function (event) {
      beginGesture("move", "", event);
    });

    var body = document.createElement("div");
    body.setAttribute("data-socratopia-split-body", "1");
    body.style.cssText = "flex:1 1 auto;display:flex;flex-direction:column;min-height:0;min-width:0";

    splitPane.appendChild(tabs);
    splitPane.appendChild(body);

    // 四边 + 四角的拉伸把手
    Object.keys(GRIP_BOX).forEach(function (dir) {
      var grip = document.createElement("div");
      grip.setAttribute("data-socratopia-split-grip", dir);
      grip.style.cssText = "position:absolute;z-index:3;" + GRIP_BOX[dir] + ";cursor:" + GRIP_CURSOR[dir];
      grip.addEventListener("mousedown", function (event) {
        beginGesture("resize", dir, event);
      });
      splitPane.appendChild(grip);
    });

    host.insertBefore(splitWrap, app);
    splitWrap.appendChild(app);
    splitWrap.appendChild(divider);
    splitWrap.appendChild(splitPane);

    divider.addEventListener("mousedown", function (event) {
      beginGesture("resize", layout.mode === "left" ? "e" : "w", event);
    });

    var floatBtn = document.createElement("button");
    floatBtn.type = "button";
    floatBtn.setAttribute("data-socratopia-split-float", "1");
    floatBtn.textContent = layout.mode === "float" ? "⇥" : "⤢";
    floatBtn.style.cssText =
      "flex:0 0 auto;align-self:center;margin:0 6px;border:1px solid var(--border,rgba(255,255,255,.18));" +
      "border-radius:6px;background:transparent;color:inherit;font-size:12px;line-height:1;" +
      "padding:4px 6px;cursor:pointer;opacity:.85";
    floatBtn.title = layout.mode === "float" ? t("dockPane") : t("floatPane");
    floatBtn.addEventListener("click", function () {
      if (layout.mode === "float") {
        layout.mode = "right";
      } else {
        var rect = splitPane.getBoundingClientRect();
        layout.mode = "float";
        layout.x = Math.max(12, rect.left - 80);
        layout.y = Math.max(12, rect.top + 48);
        // 停靠宽度往往偏窄，浮起来给一个能读的宽度，别把面板挤成一条
        layout.w = Math.min(Math.max(rect.width, 560), window.innerWidth - 40);
        layout.h = Math.max(MIN_H, Math.min(rect.height, window.innerHeight - 80));
      }
      floatBtn.textContent = layout.mode === "float" ? "⇥" : "⤢";
      floatBtn.title = layout.mode === "float" ? t("dockPane") : t("floatPane");
      applyLayout();
      rememberLayout();
    });
    // 浮动按钮钉在最前面：页签一多就横向滚动，放末尾会被推出视野
    tabs.appendChild(floatBtn);

    applyLayout();

    window.addEventListener("resize", function () {
      if (!splitPane || !splitPane.isConnected) return;
      applyLayout();
    });

    // 那两个按钮也可能是分栏之后才挂上的（换世界时才出现引图按钮），补一次
    if (!floaterObserver && window.MutationObserver) {
      floaterObserver = new MutationObserver(function () {
        if (splitPane && splitPane.isConnected) offsetFloaters(layout.mode === "right" ? splitPane.offsetWidth : null);
      });
      floaterObserver.observe(document.body, { childList: true });
    }

    return splitPane;
  }

  function teardownSplit() {
    if (!splitWrap) return;
    var app = splitWrap.__socratopiaApp;
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

  function openSourceDialog(initialPage, opts) {
    var selection = dockSelection;
    var quoted = selection ? selection.text : "";
    var fromFallback = !!(opts && opts.fallback);
    var fromStale = !!(opts && opts.stale);
    var scope = lastScope;
    if (!scope || !scope.textbookId) {
      resolveScope().then(function (resolved) {
        if (!resolved || !resolved.textbookId) {
          toast(t("noBook"));
          return;
        }
        lastScope = resolved;
        openSourceDialog(initialPage, opts);
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

    // 文字视图：页码由选区在 PDF 文本层里定位得出，直接给文字，不必等页图，
    // 也不必靠页码猜。服务端按原页的版式切了块（标题 / 段落 / 命中段），这里照排。
    var textView = document.createElement("div");
    textView.setAttribute("data-socratopia-source-text", "1");
    textView.setAttribute("data-socratopia-source-blocks", "1");
    textView.style.cssText =
      "display:none;align-self:flex-start;width:100%;box-sizing:border-box;padding:14px 18px 22px;" +
      "font-size:13.5px;line-height:1.9;color:var(--foreground,#f4f4f5)";
    stage.appendChild(textView);

    function fillText(blocks, flat) {
      textView.textContent = "";
      var list = Array.isArray(blocks) ? blocks : [];
      if (!list.length) {
        textView.style.whiteSpace = "pre-wrap";
        textView.textContent = flat || "";
        return null;
      }
      textView.style.whiteSpace = "normal";
      var hitNode = null;
      list.forEach(function (block, index) {
        var isHeading = block.type === "heading";
        var node = document.createElement(isHeading ? "h3" : "p");
        node.setAttribute("data-socratopia-source-block", isHeading ? "heading" : "paragraph");
        if (block.hit) node.setAttribute("data-socratopia-source-hit", "1");
        node.textContent = block.text;
        node.style.cssText = isHeading
          ? "margin:" + (index ? "16px" : "0") + " 0 8px;font-size:14.5px;font-weight:600;line-height:1.6;" +
            "padding-left:8px;border-left:3px solid var(--accent-solid,#3a6df0)"
          : "margin:0 0 10px;text-indent:0";
        if (block.hit) {
          node.style.background = "color-mix(in srgb, var(--accent-solid,#3a6df0) 16%, transparent)";
          node.style.borderRadius = "4px";
          node.style.padding = "2px 6px";
          node.style.margin = "0 -6px 10px";
          if (!hitNode) hitNode = node;
        }
        textView.appendChild(node);
      });
      return hitNode;
    }

    var image = document.createElement("img");
    image.setAttribute("data-socratopia-source-image", "1");
    image.alt = quoted ? quoted.slice(0, 80) : t("title");
    image.style.cssText = "max-width:100%;height:auto;display:block";
    stage.appendChild(image);

    var sourceNote = document.createElement("div");
    sourceNote.setAttribute("data-socratopia-source-note", "1");
    sourceNote.style.cssText =
      "display:none;font-size:12px;line-height:1.6;color:var(--text-muted,#a1a1aa);padding-left:8px";

    var view = "image";
    function setView(next) {
      view = next === "text" ? "text" : "image";
      textView.style.display = view === "text" ? "block" : "none";
      image.style.display = view === "text" ? "none" : "block";
      stage.style.alignItems = view === "text" ? "flex-start" : "center";
      textToggle.style.borderColor =
        view === "text" ? "var(--accent-solid,#3a6df0)" : "var(--border,rgba(255,255,255,.18))";
      imageToggle.style.borderColor =
        view === "image" ? "var(--accent-solid,#3a6df0)" : "var(--border,rgba(255,255,255,.18))";
    }

    var foot = document.createElement("div");
    foot.style.cssText =
      "display:flex;flex-direction:column;gap:6px;font-size:13px;padding-left:16px;align-items:stretch";
    var navRow = document.createElement("div");
    navRow.style.cssText = "display:flex;align-items:center;gap:8px;justify-content:center";
    foot.appendChild(navRow);
    var toolRow = document.createElement("div");
    toolRow.style.cssText = "display:flex;align-items:center;gap:8px;justify-content:center";
    foot.appendChild(toolRow);

    var prev = document.createElement("button");
    prev.type = "button";
    prev.setAttribute("data-socratopia-source-prev", "1");
    prev.setAttribute("aria-label", t("prev"));
    prev.textContent = "‹";
    prev.style.cssText = "border:1px solid var(--border,rgba(255,255,255,.18));background:transparent;color:inherit;" +
      "border-radius:9999px;width:28px;height:28px;cursor:pointer;line-height:1";

    // 页码本身是个输入框：`1 / 80` 里的「1」可以直接改，回车或失焦就跳过去。
    // 光靠 ‹ › 走二十页要点二十下，语义定位又不可靠时这是唯一的快路。
    var counter = document.createElement("input");
    counter.type = "text";
    counter.inputMode = "numeric";
    counter.setAttribute("data-socratopia-source-counter", "1");
    counter.setAttribute("aria-label", t("jumpTo"));
    counter.style.cssText =
      "width:44px;text-align:right;padding:3px 4px;font:inherit;font-size:13px;" +
      "border:1px solid var(--border,rgba(255,255,255,.18));border-radius:5px;background:transparent;color:inherit";
    // 静止时也不藏边框：看起来是能改的，人才会去点它。
    counter.addEventListener("focus", function () {
      counter.style.borderColor = "var(--accent-solid,#3a6df0)";
    });
    counter.addEventListener("blur", function () {
      counter.style.borderColor = "var(--border,rgba(255,255,255,.18))";
    });
    var totalLabel = document.createElement("span");
    totalLabel.setAttribute("data-socratopia-source-total", "1");
    totalLabel.style.cssText = "min-width:34px;color:var(--text-muted,#a1a1aa)";

    function paintCounter() {
      counter.value = String(page);
      totalLabel.textContent = total ? " / " + total : "";
      counter.style.width = (String(page).length + 2) * 8 + "px";
    }

    // 输入越界就夹进 [1, total]；没变就什么都不做，免得白取一次页图。
    function jumpToTyped() {
      var typed = parseInt(String(counter.value).replace(/\D/g, ""), 10);
      if (!Number.isInteger(typed) || typed < 1 || (total && typed > total)) {
        paintCounter();
        return;
      }
      if (typed === page) {
        paintCounter();
        return;
      }
      load(typed);
    }
    counter.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        jumpToTyped();
        counter.blur();
      } else if (event.key === "Escape") {
        // Esc 在这里只撤销输入；不拦住的话会冒到 document 把整个抽屉关掉
        event.stopPropagation();
        paintCounter();
        counter.blur();
      }
    });
    counter.addEventListener("blur", jumpToTyped);
    counter.addEventListener("focus", function () {
      counter.select();
    });

    var next = document.createElement("button");
    next.type = "button";
    next.setAttribute("data-socratopia-source-next", "1");
    next.setAttribute("aria-label", t("next"));
    next.textContent = "›";
    next.style.cssText = prev.style.cssText;

    var toggleStyle =
      "border:1px solid var(--border,rgba(255,255,255,.18));background:transparent;color:inherit;" +
      "border-radius:6px;font-size:12px;line-height:1;padding:5px 8px;cursor:pointer";
    var textToggle = document.createElement("button");
    textToggle.type = "button";
    textToggle.setAttribute("data-socratopia-source-view-text", "1");
    textToggle.textContent = t("viewText");
    textToggle.style.cssText = toggleStyle;
    textToggle.addEventListener("click", function () {
      setView("text");
    });
    var imageToggle = document.createElement("button");
    imageToggle.type = "button";
    imageToggle.setAttribute("data-socratopia-source-view-image", "1");
    imageToggle.textContent = t("viewImage");
    imageToggle.style.cssText = toggleStyle;
    imageToggle.addEventListener("click", function () {
      setView("image");
    });

    // 页图在前、文字在后：按页翻的时候先看到的是页，不是一屏字。取到的文字
    // 照样填进文字视图，按「文字」立刻就看得到。
    toolRow.appendChild(imageToggle);
    toolRow.appendChild(textToggle);
    navRow.appendChild(prev);
    navRow.appendChild(counter);
    navRow.appendChild(totalLabel);
    navRow.appendChild(next);

    // 一页一页走二十页要点二十下；给一条能直接填目的页的滑杆，能拖也能键盘
    // 微调，松手才 load（input 里只跟手，change 才真的取页图）。
    var slider = document.createElement("input");
    slider.type = "range";
    slider.min = "1";
    slider.max = "1";
    slider.value = "1";
    slider.step = "1";
    slider.setAttribute("data-socratopia-source-slider", "1");
    slider.setAttribute("aria-label", t("jumpTo"));
    slider.style.cssText = "width:100%;box-sizing:border-box;accent-color:var(--accent-solid,#3a6df0);cursor:pointer;margin:0";
    slider.addEventListener("input", function () {
      counter.value = slider.value;
    });
    slider.addEventListener("change", function () {
      var target = parseInt(slider.value, 10);
      if (Number.isInteger(target) && target !== page) load(target);
    });

    function paintSlider() {
      if (!total) {
        slider.max = "1";
        slider.disabled = true;
        slider.style.opacity = ".4";
        return;
      }
      slider.disabled = false;
      slider.style.opacity = "1";
      slider.max = String(total);
      slider.value = String(Math.min(page, total));
    }
    // 滑杆贴着翻页行走：两者都是「去哪儿」，视图开关才是另一类。
    foot.insertBefore(slider, toolRow);

    panel.appendChild(head);
    head.appendChild(title);
    title.appendChild(pageHint);
    panel.appendChild(quote);
    // 兜底页不是选中的那句所在页，得说清楚，否则看起来又像对错了页
    if (fromFallback) {
      sourceNote.textContent = t(fromStale ? "staleNote" : "fallbackNote");
      sourceNote.style.display = "block";
    }
    panel.appendChild(sourceNote);
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
      paintCounter();
      paintSlider();
      prev.disabled = page <= 1;
      next.disabled = total ? page >= total : false;
      // 每次翻页先回到页图：用户按「下一页」是想看下一页长什么样，不是想接着
      // 读上一页那段文字。文字照旧在后台取，按「文字」随时切回。
      setView("image");

      if (fetchTimer) clearTimeout(fetchTimer);
      var warmHit = keptPages.indexOf(pageUrl(scope, page, 960)) >= 0;
      if (warmHit) fetchPage(page);
      else fetchTimer = setTimeout(function () {
        fetchPage(page);
      }, 120);
      fetchText(page);
    }

    // 文字视图按页取：页码定位与文字是同一份索引，取到就切到文字视图——页图只是
    // 补充，用户真正要核的是「这句是不是原文」。带上引文，服务端才能标出命中段。
    function fetchText(targetPage) {
      var token = ++textToken;
      if (view === "text") textView.textContent = t("locating");
      fetch(
        "/api/textbook?locate=1&profileId=" + encodeURIComponent(scope.profileId) +
          "&worldId=" + encodeURIComponent(scope.worldId) +
          "&textbookId=" + encodeURIComponent(scope.textbookId) +
          "&page=" + targetPage +
          (quoted ? "&quote=" + encodeURIComponent(quoted.slice(0, 400)) : "")
      )
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .then(function (data) {
          if (token !== textToken || page !== targetPage) return;
          var text = String((data && data.text) || "").trim();
          if (!text) {
            textView.textContent = t("notFound", { n: targetPage });
            if (view === "text") setView("image");
            return;
          }
          fillText(data && data.blocks, text);
          // 取到文字不切视图：翻页先看到的应该是页，文字留在「文字」键后面
          setView(view);
          if (data && Number.isInteger(Number(data.totalPages)) && !total) {
            total = Number(data.totalPages);
            paintCounter();
            paintSlider();
            next.disabled = page >= total;
          }
          // 文字页可能很长，落到命中段上，别让人从页眉找起
          var hitNode = textView.querySelector("[data-socratopia-source-hit]");
          if (hitNode) {
            requestAnimationFrame(function () {
              if (hitNode.isConnected) hitNode.scrollIntoView({ block: "center" });
            });
          }
        })
        .catch(function () {
          if (token !== textToken) return;
          textView.textContent = t("notFound", { n: targetPage });
        });
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
              paintCounter();
              paintSlider();
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
          paintCounter();
          paintSlider();
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
        var found = progressPage(data && data.readingRange);
        if (found) lastPage = found.page;
        return lastPage;
      })
      .catch(function () {
        return lastPage;
      });
  }

  // 教学进度页。不能直接信 taughtPage：它可能停在很旧的练习标记上（实测第 134 页，
  // 而阅读窗口已经推到 139-147），只有落在窗口里才算这条进度还新鲜；落不进就说明
  // 窗口比它新，退到窗口起点。
  // 返回 { page, fresh }：fresh 表示这条页码确实是当前教学进度，而不是窗口兜底。
  function progressPage(range) {
    if (!range) return null;
    var taught = Number(range.taughtPage || range.lastTaughtPage);
    var start = Number(range.startPage);
    var end = Number(range.endPage);
    if (Number.isInteger(taught) && taught >= 1 && (!start || (taught >= start && taught <= (end || start)))) {
      return { page: taught, fresh: true };
    }
    return Number.isInteger(start) && start >= 1 ? { page: start, fresh: false } : null;
  }

  // 教学里“原文”到底是哪一页：模型每轮引用原文都会在同一行紧跟一个页码 chip
  // `[☰ p.12](socratopia:page#12)`，那才是这一轮真正在讲的那一页。阅读游标只是
  // “读到哪”，落后于对话。先信 chip，其次才信选区定位，最后才退进度。
  var CHIP_SELECTOR = 'a[href^="socratopia:page#"]';
  // 线上的消息气泡带的是 data-msg-id（data-message-id 只出现在部分旧快照里），两个都要认。
  var MESSAGE_SELECTOR = "[data-msg-id],[data-message-id]";

  function chipPage(node) {
    var anchor = node && node.closest ? node.closest(CHIP_SELECTOR) : null;
    var page = anchor ? Number(String(anchor.getAttribute("href")).split("#")[1]) : null;
    return Number.isInteger(page) && page >= 1 ? page : null;
  }

  // 选区所在消息里、选区之后的第一个 chip；同一轮里最贴近这句引文的页码。
  function paragraphChipPage(selection) {
    var range = selection && selection.range;
    if (!range) return null;
    var host = range.commonAncestorContainer;
    host = host.nodeType === 1 ? host : host.parentNode;
    var message = host && host.closest ? host.closest(MESSAGE_SELECTOR) : null;
    if (!message) return chipPage(host);
    var direct = chipPage(host);
    if (direct) return direct;
    var chips = message.querySelectorAll(CHIP_SELECTOR);
    for (var i = 0; i < chips.length; i++) {
      // comparePoint 返回 1 表示这个 chip 落在选区之后 —— 就是紧跟这句的那个
      try {
        if (range.comparePoint(chips[i], 0) >= 0) return chipPage(chips[i]);
      } catch (_) {
        return chipPage(chips[0]);
      }
    }
    return chips.length ? chipPage(chips[chips.length - 1]) : null;
  }

  // 最新一轮里最后出现的 chip：教学推进到哪儿，原文就跟到哪儿。
  function latestTaughtChipPage() {
    var messages = document.querySelectorAll(MESSAGE_SELECTOR);
    for (var i = messages.length - 1; i >= 0; i--) {
      var chips = messages[i].querySelectorAll(CHIP_SELECTOR);
      if (chips.length) {
        var page = chipPage(chips[chips.length - 1]);
        if (page) return page;
      }
    }
    return null;
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
    var raw = String(tex).trim();
    if (raw.indexOf("<svg") < 0) return "<pre><code>" + escapeHtml(raw) + "</code></pre>";
    // 模型几乎从不写 xmlns，而 <img> 里的 data-URI SVG 少了命名空间会解码成长宽 0 的破图
    // （实测缺 xmlns → naturalWidth 0，补上 → 300）。注释/XML 声明要留在最前面，
    // 所以只替换 <svg 这个开标签，不动其它位置。
    // 另一个坑：模型常在围栏里写成「正文 + 注释 + svg + 下面接着一段正文」，而 data-URI
    // 里的 SVG 文档**前后都只能有空白**（实测前后多一段文字 → 0；只有空白 → 300）。
    // 所以先剪出 <svg>…</svg> 本体，只把紧贴根标签的标题注释重新贴回去。
    var start = raw.search(/<svg[\s>]/i);
    var lead = /(?:(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*)+)$/i.exec(raw.slice(0, start));
    var prefix = lead ? lead[0] : "";
    var close = raw.lastIndexOf("</svg>");
    var source = close > 0 ? prefix + raw.slice(start, close + 6) : raw;
    if (source.indexOf("xmlns") < 0) {
      source = source.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
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
              // 用户明确要求：解释 / 问伙伴都不要再套一层追问，别让问题越滚越多。
              "\n\n" + t("noFollowUp")
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
      // 用户说的“原文随教学推进”就是这一条：教学每轮讲哪一页，原文就跟哪一页。
      // 所以顺序是 —— 这句引文所在消息里紧跟它的页码 chip（模型当轮自己标的出处）
      // → 引文在 PDF 文本层里的定位 → 最近一轮的 chip → 才退阅读进度。
      // 以前一律用 cursor，cursor 是“读到哪”，永远落后于对话。
      resolveScope()
        .then(function (scope) {
          if (!scope || !scope.textbookId) {
            toast(t("noBook"));
            return;
          }
          lastScope = scope;
          var chip = paragraphChipPage(selection);
          if (chip) {
            openSourceDialog(chip);
            return;
          }
          var quote = String(selection.text || "").trim();
          var located = quote
            ? fetch(
                "/api/textbook?locate=1&profileId=" + encodeURIComponent(scope.profileId) +
                  "&worldId=" + encodeURIComponent(scope.worldId) +
                  "&textbookId=" + encodeURIComponent(scope.textbookId) +
                  "&quote=" + encodeURIComponent(quote.slice(0, 400))
              )
                .then(function (response) {
                  return response.ok ? response.json() : null;
                })
                .catch(function () {
                  return null;
                })
            : Promise.resolve(null);
          return located.then(function (hit) {
            if (hit && hit.ok && Number.isInteger(Number(hit.page))) {
              openSourceDialog(Number(hit.page));
              return;
            }
            var taught = latestTaughtChipPage();
            if (taught) {
              openSourceDialog(taught);
              return;
            }
            // 都没有（扫描书没有文本层、模型这轮没标页码）只能退回进度：教学已经讲到
            // 第几页比窗口起点更接近用户真正想核的地方，窗口 startPage 只是最后兜底。
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
                var found = progressPage(data && data.readingRange);
                openSourceDialog(found ? found.page : 1, { fallback: true, stale: !found || !found.fresh });
              })
              .catch(function () {
                openSourceDialog(1, { fallback: true });
              });
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
