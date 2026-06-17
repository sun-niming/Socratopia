exports.id=105,exports.ids=[105],exports.modules={1891:(a,b,c)=>{"use strict";c.d(b,{I18nProvider:()=>e});var d=c(77943);(0,d.registerClientReference)(function(){throw Error("Attempted to call UI_LOCALES() from the server but UI_LOCALES is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"/Users/leminwu/Documents/Github/socralab-app/v2/src/lib/i18n.tsx","UI_LOCALES"),(0,d.registerClientReference)(function(){throw Error("Attempted to call localeToTeachingLanguage() from the server but localeToTeachingLanguage is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"/Users/leminwu/Documents/Github/socralab-app/v2/src/lib/i18n.tsx","localeToTeachingLanguage"),(0,d.registerClientReference)(function(){throw Error("Attempted to call useI18n() from the server but useI18n is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"/Users/leminwu/Documents/Github/socralab-app/v2/src/lib/i18n.tsx","useI18n"),(0,d.registerClientReference)(function(){throw Error("Attempted to call useT() from the server but useT is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"/Users/leminwu/Documents/Github/socralab-app/v2/src/lib/i18n.tsx","useT"),(0,d.registerClientReference)(function(){throw Error("Attempted to call useTranslateFor() from the server but useTranslateFor is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"/Users/leminwu/Documents/Github/socralab-app/v2/src/lib/i18n.tsx","useTranslateFor");let e=(0,d.registerClientReference)(function(){throw Error("Attempted to call I18nProvider() from the server but I18nProvider is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"/Users/leminwu/Documents/Github/socralab-app/v2/src/lib/i18n.tsx","I18nProvider")},2824:(a,b,c)=>{Promise.resolve().then(c.t.bind(c,81921,23)),Promise.resolve().then(c.t.bind(c,60440,23)),Promise.resolve().then(c.t.bind(c,84342,23)),Promise.resolve().then(c.t.bind(c,82265,23)),Promise.resolve().then(c.t.bind(c,35421,23)),Promise.resolve().then(c.t.bind(c,61335,23)),Promise.resolve().then(c.t.bind(c,70664,23)),Promise.resolve().then(c.bind(c,74661))},10250:(a,b,c)=>{var d={"./en.json":[74137,4137],"./zh-CN.json":[10354,354],"./zh-TW.json":[18214,8214]};function e(a){if(!c.o(d,a))return Promise.resolve().then(()=>{var b=Error("Cannot find module '"+a+"'");throw b.code="MODULE_NOT_FOUND",b});var b=d[a],e=b[0];return c.e(b[1]).then(()=>c.t(e,19))}e.keys=()=>Object.keys(d),e.id=10250,a.exports=e},10545:(a,b,c)=>{"use strict";c.d(b,{DialogProvider:()=>j,S:()=>k,U:()=>l});var d=c(48249),e=c(67484),f=c(74429),g=c(75025),h=c(18281);let i=(0,e.createContext)(null);function j({children:a}){let[b,c]=(0,e.useState)(null),f=(0,e.useCallback)(a=>new Promise(b=>{c(c=>(c&&("confirm"===c.kind?c.resolve(!1):c.resolve()),{kind:"confirm",...a,resolve:b}))}),[]),g=(0,e.useCallback)(a=>new Promise(b=>{c(c=>(c&&("confirm"===c.kind?c.resolve(!1):c.resolve()),{kind:"alert",...a,resolve:b}))}),[]),h=(0,e.useCallback)(()=>{c(a=>(a?.kind==="confirm"?a.resolve(!0):a?.kind==="alert"&&a.resolve(),null))},[]),j=(0,e.useCallback)(()=>{c(a=>(a?.kind==="confirm"?a.resolve(!1):a?.kind==="alert"&&a.resolve(),null))},[]);return(0,d.jsxs)(i.Provider,{value:{confirm:f,alert:g},children:[a,b?.kind==="confirm"&&(0,d.jsx)(m,{message:b.message,title:b.title,okText:b.okText,cancelText:b.cancelText,danger:b.danger,onConfirm:h,onCancel:j}),b?.kind==="alert"&&(0,d.jsx)(n,{message:b.message,title:b.title,okText:b.okText,onOk:h})]})}function k(){let a=(0,e.useContext)(i);if(!a)throw Error("useConfirm must be used inside <DialogProvider>");return a.confirm}function l(){let a=(0,e.useContext)(i);if(!a)throw Error("useAlertDialog must be used inside <DialogProvider>");return a.alert}function m({message:a,title:b,okText:c,cancelText:e,danger:i,onConfirm:j,onCancel:k}){let l=(0,g.kj)();return((0,h.Q)(!0,k),o())?(0,f.createPortal)((0,d.jsx)("div",{className:"fixed inset-0 flex items-center justify-center",style:{background:"rgba(0,0,0,0.6)",zIndex:0x7fffffff,isolation:"isolate"},onClick:k,role:"presentation",children:(0,d.jsxs)("div",{className:"rounded-2xl shadow-2xl p-6 mx-4",style:{width:420,maxWidth:"90vw",background:"var(--surface-raised)",border:"1px solid var(--border)"},onClick:a=>a.stopPropagation(),role:"alertdialog","aria-modal":"true","aria-labelledby":b?"confirm-dialog-title":void 0,"aria-describedby":"confirm-dialog-message",children:[b&&(0,d.jsx)("h2",{id:"confirm-dialog-title",className:"text-base font-semibold text-center mb-2",children:b}),(0,d.jsx)("p",{id:"confirm-dialog-message",className:"text-sm text-center whitespace-pre-line",style:{color:"var(--foreground)"},children:a}),(0,d.jsxs)("div",{className:"flex justify-center gap-3 mt-10",children:[(0,d.jsx)("button",{type:"button",onClick:k,className:"min-w-[88px] px-4 py-2 rounded-lg border text-sm transition-colors hover:bg-[var(--surface-hover)]",style:{borderColor:"var(--border)",color:"var(--foreground)"},children:e??l("common.cancel")}),(0,d.jsx)("button",{type:"button",onClick:j,autoFocus:!0,className:"min-w-[88px] px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-90",style:{background:i?"var(--danger)":"var(--accent)",color:"var(--text-inverse)"},children:c??l("common.confirm")})]})]})}),document.body):null}function n({message:a,title:b,okText:c,onOk:e}){let i=(0,g.kj)();return((0,h.Q)(!0,e),o())?(0,f.createPortal)((0,d.jsx)("div",{className:"fixed inset-0 flex items-center justify-center",style:{background:"rgba(0,0,0,0.6)",zIndex:0x7fffffff,isolation:"isolate"},onClick:e,role:"presentation",children:(0,d.jsxs)("div",{className:"rounded-2xl shadow-2xl p-6 mx-4",style:{width:420,maxWidth:"90vw",background:"var(--surface-raised)",border:"1px solid var(--border)"},onClick:a=>a.stopPropagation(),role:"alertdialog","aria-modal":"true","aria-labelledby":b?"alert-dialog-title":void 0,"aria-describedby":"alert-dialog-message",children:[b&&(0,d.jsx)("h2",{id:"alert-dialog-title",className:"text-base font-semibold text-center mb-2",children:b}),(0,d.jsx)("p",{id:"alert-dialog-message",className:"text-sm text-center whitespace-pre-line",style:{color:"var(--foreground)"},children:a}),(0,d.jsx)("div",{className:"flex justify-center mt-10",children:(0,d.jsx)("button",{type:"button",onClick:e,autoFocus:!0,className:"min-w-[88px] px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-90",style:{background:"var(--accent)",color:"var(--text-inverse)"},children:c??i("common.ok")})})]})}),document.body):null}function o(){let[a,b]=(0,e.useState)(!1);return a}},15976:(a,b,c)=>{Promise.resolve().then(c.t.bind(c,95547,23)),Promise.resolve().then(c.t.bind(c,15098,23)),Promise.resolve().then(c.t.bind(c,47644,23)),Promise.resolve().then(c.t.bind(c,33859,23)),Promise.resolve().then(c.t.bind(c,98099,23)),Promise.resolve().then(c.t.bind(c,16237,23)),Promise.resolve().then(c.t.bind(c,98562,23)),Promise.resolve().then(c.t.bind(c,36675,23))},18281:(a,b,c)=>{"use strict";c.d(b,{Q:()=>e});var d=c(67484);function e(a,b){(0,d.useRef)(b).current=b}},19568:(a,b,c)=>{Promise.resolve().then(c.t.bind(c,81921,23))},30674:(a,b,c)=>{"use strict";c.d(b,{default:()=>d});let d=(0,c(77943).registerClientReference)(function(){throw Error("Attempted to call the default export of \"/Users/leminwu/Documents/Github/socralab-app/v2/src/components/common/MathClipboardEnhancer.tsx\" from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"/Users/leminwu/Documents/Github/socralab-app/v2/src/components/common/MathClipboardEnhancer.tsx","default")},55091:(a,b,c)=>{"use strict";Object.defineProperty(b,"__esModule",{value:!0}),Object.defineProperty(b,"default",{enumerable:!0,get:function(){return f}});let d=c(5735),e=c(22675);function f(){return(0,d.jsx)(e.HTTPAccessErrorFallback,{status:404,message:"This page could not be found."})}("function"==typeof b.default||"object"==typeof b.default&&null!==b.default)&&void 0===b.default.__esModule&&(Object.defineProperty(b.default,"__esModule",{value:!0}),Object.assign(b.default,b),a.exports=b.default)},61135:()=>{},62015:(a,b,c)=>{"use strict";c.d(b,{DialogProvider:()=>e});var d=c(77943);let e=(0,d.registerClientReference)(function(){throw Error("Attempted to call DialogProvider() from the server but DialogProvider is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"/Users/leminwu/Documents/Github/socralab-app/v2/src/components/common/DialogProvider.tsx","DialogProvider");(0,d.registerClientReference)(function(){throw Error("Attempted to call useConfirm() from the server but useConfirm is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"/Users/leminwu/Documents/Github/socralab-app/v2/src/components/common/DialogProvider.tsx","useConfirm"),(0,d.registerClientReference)(function(){throw Error("Attempted to call useAlertDialog() from the server but useAlertDialog is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"/Users/leminwu/Documents/Github/socralab-app/v2/src/components/common/DialogProvider.tsx","useAlertDialog")},75025:(a,b,c)=>{"use strict";c.d(b,{I18nProvider:()=>l,Nw:()=>k,kj:()=>j,s9:()=>i,vm:()=>f,xj:()=>g});var d=c(48249),e=c(67484);let f=[{id:"zh-CN",label:"简体中文"},{id:"zh-TW",label:"繁體中文"},{id:"en",label:"English"}];function g(a){return"en"===a?"english":"zh-TW"===a?"chinese-traditional":"chinese"}let h=(0,e.createContext)({locale:"zh-CN",setLocale:()=>{},t:a=>a});function i(){return(0,e.useContext)(h)}function j(){return(0,e.useContext)(h).t}function k(a){let[b,c]=(0,e.useState)({});return(0,e.useCallback)((a,c)=>{let d=b[a]??a;if(c)for(let[a,b]of Object.entries(c))d=d.replace(RegExp(`\\{${a}\\}`,"g"),String(b));return d},[b])}function l({children:a}){let[b,c]=(0,e.useState)("zh-CN"),[f,g]=(0,e.useState)({}),i=(0,e.useCallback)(a=>{c(a),localStorage.setItem("socralab_ui_locale",a)},[]),j=(0,e.useCallback)((a,b)=>{let c=f[a]??a;if(b)for(let[a,d]of Object.entries(b))c=c.replace(RegExp(`\\{${a}\\}`,"g"),String(d));return c},[f]);return(0,d.jsx)(h.Provider,{value:{locale:b,setLocale:i,t:j},children:a})}},76537:(a,b,c)=>{"use strict";c.r(b),c.d(b,{default:()=>j,metadata:()=>h});var d=c(5735);c(61135);var e=c(1891),f=c(62015),g=c(30674);let h={title:"Socratopia",description:"Socratic Roleplay Learning"},i=`
(function () {
  try {
    var LIGHT = { paper:1, autumn:1, sakura:1, lavender:1, ocean:1, sunset:1, grassland:1, mist:1, celadon:1, "hc-light":1 };
    var DARK  = { socratopia:1, "steel-blue":1, amber:1, "deep-sea":1, "ink-bamboo":1, charcoal:1, lacquer:1, inkstone:1, twilight:1, "hc-dark":1 };

    function prefersDark() {
      try { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); }
      catch (e) { return false; }
    }

    function apply(lightId, darkId, mode) {
      var resolved = mode === "dark" ? darkId : lightId;
      if (!LIGHT[resolved] && !DARK[resolved]) resolved = mode === "dark" ? "socratopia" : "paper";
      var root = document.documentElement;
      root.setAttribute("data-theme", resolved);
      if (mode === "dark") root.classList.add("dark");
      else root.classList.remove("dark");
    }

    function tryHintBlob(raw) {
      try {
        if (!raw) return false;
        var p = JSON.parse(raw);
        if (p && (p.mode === "light" || p.mode === "dark")) {
          apply(LIGHT[p.lightThemeId] ? p.lightThemeId : "paper",
                DARK[p.darkThemeId] ? p.darkThemeId : "socratopia",
                p.mode);
          return true;
        }
      } catch (e) {}
      return false;
    }

    // 1. Active-account pointer → namespaced hint.
    try {
      var activeId = localStorage.getItem("socralab_active_account_id");
      if (activeId) {
        var nsHint = localStorage.getItem("socralab_theme_hint_v2_" + activeId);
        if (tryHintBlob(nsHint)) return;
      }
    } catch (e) {}

    // 2. Un-namespaced v2 hint (legacy installs + bootstrap fallback).
    try {
      if (tryHintBlob(localStorage.getItem("socralab_theme_hint_v2"))) return;
    } catch (e) {}

    // 3. v1 hint — translate inline
    try {
      var h1 = localStorage.getItem("socralab_theme_hint");
      if (h1) {
        var q = JSON.parse(h1);
        if (q && typeof q.themeId === "string") {
          var m = (q.themeMode === "light" || q.themeMode === "dark") ? q.themeMode : (prefersDark() ? "dark" : "light");
          var l = "paper", d = "socratopia";
          if (q.themeId === "hc-light") l = "hc-light";
          else if (q.themeId === "hc-dark") d = "hc-dark";
          else if (LIGHT[q.themeId]) l = q.themeId;
          else if (DARK[q.themeId]) d = q.themeId;
          apply(l, d, m);
          return;
        }
      }
    } catch (e) {}

    // 4. Scan settings blobs for legacy fields
    function fromBlob(blob) {
      try {
        var o = JSON.parse(blob); if (!o || typeof o !== "object") return null;
        if (typeof o.lightThemeId === "string" && (o.themeMode === "light" || o.themeMode === "dark")) {
          return { l: LIGHT[o.lightThemeId] ? o.lightThemeId : "paper",
                   d: DARK[o.darkThemeId] ? o.darkThemeId : "socratopia",
                   m: o.themeMode };
        }
        if (typeof o.themeId === "string") {
          var mm = (o.themeMode === "light" || o.themeMode === "dark") ? o.themeMode : (prefersDark() ? "dark" : "light");
          var ll = "paper", dd = "socratopia";
          if (o.themeId === "hc-light") ll = "hc-light";
          else if (o.themeId === "hc-dark") dd = "hc-dark";
          else if (LIGHT[o.themeId]) ll = o.themeId;
          else if (DARK[o.themeId]) dd = o.themeId;
          return { l: ll, d: dd, m: mm };
        }
        if (typeof o.theme === "string") {
          if (o.theme === "light")  return { l: "paper", d: "socratopia", m: "light" };
          if (o.theme === "dark")   return { l: "paper", d: "socratopia", m: "dark" };
          if (o.theme === "system") return { l: "paper", d: "socratopia", m: prefersDark() ? "dark" : "light" };
        }
        return null;
      } catch (e) { return null; }
    }
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("socralab_settings") === 0) {
          var r = fromBlob(localStorage.getItem(k));
          if (r) { apply(r.l, r.d, r.m); return; }
        }
      }
    } catch (e) {}

    // 5. Brand-new install: default to socratopia (问道, dark) so the
    // transition from the blue orientation screen is seamless. Mirrors
    // DEFAULT_SETTINGS.themeMode in lib/constants.ts. Avoids FOUC when
    // the system is in light mode.
    apply("paper", "socratopia", "dark");
  } catch (e) {
    // On any error, fall through — React will correct on hydrate.
    try { document.documentElement.setAttribute("data-theme", "paper"); } catch (_e) {}
  }
})();

/* ---- UI font scale pre-hydration ---- */
/* Read uiFontScale from the most-likely settings blob and adjust the html
 * font-size BEFORE React mounts. Tailwind utilities are rem-based, so this
 * scales text + paddings + most spacing as a coherent unit, without
 * affecting vh/vw layout (which we deliberately want — keeps the fixed
 * 100vh app shell perfectly fitted at any scale). On any failure, fall
 * through; the page.tsx useEffect re-applies within ~50ms of hydration. */
(function () {
  try {
    function readScale(raw) {
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (o && typeof o.uiFontScale === "number" && o.uiFontScale > 0) {
        return o.uiFontScale;
      }
      return null;
    }
    var scale = null;
    try {
      var activeId = localStorage.getItem("socralab_active_account_id");
      if (activeId) scale = readScale(localStorage.getItem("socralab_settings_" + activeId));
    } catch (e) {}
    if (scale == null) {
      try { scale = readScale(localStorage.getItem("socralab_settings")); } catch (e) {}
    }
    if (scale == null) {
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf("socralab_settings") === 0) {
            scale = readScale(localStorage.getItem(k));
            if (scale != null) break;
          }
        }
      } catch (e) {}
    }
    if (scale != null && scale !== 1) {
      document.documentElement.style.fontSize = (16 * scale) + "px";
    }
    // Sidebar dampened-scale CSS variable. Set even at scale=1 so the var
    // is always defined and Sidebar.tsx's var(--sidebar-font-base, 16px)
    // fallback never has to kick in — keeps behavior consistent in dev / SSR.
    // Anchored at 14px (= chat text-sm at scale=1), not 16px: nav-style
    // short labels read visually heavier per px than chat prose, so a
    // chat-text-sm anchor keeps the two surfaces visually balanced.
    var s = (scale != null) ? scale : 1;
    var sidebarScale = 1 + (s - 1) * 0.6;
    document.documentElement.style.setProperty("--sidebar-font-base", (14 * sidebarScale) + "px");
    /* Defensive: if a previous build wrote a zoom value to the root, clear
     * it so old localStorage doesn't keep the broken behaviour around. */
    try {
      if (document.documentElement.style.zoom) {
        document.documentElement.style.zoom = "";
      }
    } catch (e) {}
  } catch (e) { /* ignore — React re-applies */ }
})();
`;function j({children:a}){return(0,d.jsxs)("html",{lang:"en",suppressHydrationWarning:!0,children:[(0,d.jsx)("head",{children:(0,d.jsx)("script",{dangerouslySetInnerHTML:{__html:i}})}),(0,d.jsx)("body",{className:"antialiased",children:(0,d.jsxs)(e.I18nProvider,{children:[(0,d.jsx)(f.DialogProvider,{children:a}),(0,d.jsx)(g.default,{})]})})]})}},77776:(a,b,c)=>{Promise.resolve().then(c.t.bind(c,95547,23))},78001:(a,b,c)=>{Promise.resolve().then(c.bind(c,10545)),Promise.resolve().then(c.bind(c,92688)),Promise.resolve().then(c.bind(c,75025))},78335:()=>{},87729:(a,b,c)=>{Promise.resolve().then(c.bind(c,62015)),Promise.resolve().then(c.bind(c,30674)),Promise.resolve().then(c.bind(c,1891))},92688:(a,b,c)=>{"use strict";function d(){return null}c.d(b,{default:()=>d}),c(67484)},96487:()=>{}};