1:"$Sreact.fragment"
6:I[7123,[],""]
:HL["/_next/static/css/d8e594ee5ed41f08.css","style"]
2:T1ba6,
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
0:{"P":null,"b":"njVXGb7usguW54RCIuA0Z","c":["",""],"q":"","i":false,"f":[[["",{"children":["__PAGE__",{}]},"$undefined","$undefined",true],[["$","$1","c",{"children":[[["$","link","0",{"rel":"stylesheet","href":"/_next/static/css/d8e594ee5ed41f08.css","precedence":"next","crossOrigin":"$undefined","nonce":"$undefined"}]],["$","html",null,{"lang":"en","suppressHydrationWarning":true,"children":[["$","head",null,{"children":["$","script",null,{"dangerouslySetInnerHTML":{"__html":"$2"}}]}],"$L3"]}]]}],{"children":["$L4",{},null,false,false]},null,false,false],"$L5",false]],"m":"$undefined","G":["$6",[]],"S":true}
7:I[1551,["7177","static/chunks/app/layout-2ee9395c59630c5a.js"],"I18nProvider"]
8:I[1919,["7177","static/chunks/app/layout-2ee9395c59630c5a.js"],"DialogProvider"]
9:I[7121,[],""]
a:I[4581,[],""]
b:I[2984,["7177","static/chunks/app/layout-2ee9395c59630c5a.js"],"default"]
c:I[1304,[],"ClientPageRoot"]
d:I[5027,["7330","static/chunks/d3ac728e-7c3d15b5c35eb56c.js","6626","static/chunks/6626-94bd6b870272b92e.js","4137","static/chunks/4137-131d0676e3b5bef7.js","8974","static/chunks/app/page-3a1fef7566e26c43.js"],"default"]
10:I[484,[],"OutletBoundary"]
11:"$Sreact.suspense"
13:I[484,[],"ViewportBoundary"]
15:I[484,[],"MetadataBoundary"]
3:["$","body",null,{"className":"antialiased","children":["$","$L7",null,{"children":[["$","$L8",null,{"children":["$","$L9",null,{"parallelRouterKey":"children","error":"$undefined","errorStyles":"$undefined","errorScripts":"$undefined","template":["$","$La",null,{}],"templateStyles":"$undefined","templateScripts":"$undefined","notFound":[[["$","title",null,{"children":"404: This page could not be found."}],["$","div",null,{"style":{"fontFamily":"system-ui,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif,\"Apple Color Emoji\",\"Segoe UI Emoji\"","height":"100vh","textAlign":"center","display":"flex","flexDirection":"column","alignItems":"center","justifyContent":"center"},"children":["$","div",null,{"children":[["$","style",null,{"dangerouslySetInnerHTML":{"__html":"body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}"}}],["$","h1",null,{"className":"next-error-h1","style":{"display":"inline-block","margin":"0 20px 0 0","padding":"0 23px 0 0","fontSize":24,"fontWeight":500,"verticalAlign":"top","lineHeight":"49px"},"children":404}],["$","div",null,{"style":{"display":"inline-block"},"children":["$","h2",null,{"style":{"fontSize":14,"fontWeight":400,"lineHeight":"49px","margin":0},"children":"This page could not be found."}]}]]}]}]],[]],"forbidden":"$undefined","unauthorized":"$undefined"}]}],["$","$Lb",null,{}]]}]}]
4:["$","$1","c",{"children":[["$","$Lc",null,{"Component":"$d","serverProvidedParams":{"searchParams":{},"params":{},"promises":["$@e","$@f"]}}],null,["$","$L10",null,{"children":["$","$11",null,{"name":"Next.MetadataOutlet","children":"$@12"}]}]]}]
5:["$","$1","h",{"children":[null,["$","$L13",null,{"children":"$L14"}],["$","div",null,{"hidden":true,"children":["$","$L15",null,{"children":["$","$11",null,{"name":"Next.Metadata","children":"$L16"}]}]}],null]}]
e:{}
f:"$4:props:children:0:props:serverProvidedParams:params"
14:[["$","meta","0",{"charSet":"utf-8"}],["$","meta","1",{"name":"viewport","content":"width=device-width, initial-scale=1"}]]
12:null
16:[["$","title","0",{"children":"Socratopia"}],["$","meta","1",{"name":"description","content":"Socratic Roleplay Learning"}]]
