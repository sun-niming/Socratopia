/* asset-capture.js — classroom screenshot entry for the asset layer.
 *
 * Hand-written companion script (same idiom as close-reading-skill-menu.js):
 * the compiled React bundle gives no cheap seam for a new button, so this file
 * owns its own DOM:
 *
 *   floating 截图 button -> the main process hides the app window and freezes
 *   the WHOLE screen (desktopCapturer) -> drag a marquee over the frozen frame
 *   (PDF readers, browsers, anything) -> crop locally on a canvas ->
 *   POST /api/assets -> insert the `![图片](asset://<id>)` anchor into the
 *   composer, so the message stays plain markdown (zero migration) while the
 *   anchor carries the hyperlink semantics the asset layer is built on.
 *
 * Also exposes window.__SOCRATOPIA_ASSET_OPEN__ for the renderer's thumbnail
 * click-to-zoom, and window.__SOCRATOPIA_ASSET_URL__ for src building.
 *
 * The second entry (T13d) quotes a textbook figure instead of the screen: pick a
 * page, the SERVER renders it to a PNG (GET /api/textbook?page-image=1), the user
 * frames a region with the very same pickRegionOnImage marquee, and the
 * normalized rect is POSTed as a `textbook-figure` asset, which the server turns
 * into an ordinary raster.  The message renderer therefore needs no knowledge of
 * textbooks at all.
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || window.__SOCRATOPIA_ASSET_CAPTURE__) return;

  var SCOPE_KEY = "socratopia_asset_scope";
  var api = { version: 2 };
  window.__SOCRATOPIA_ASSET_CAPTURE__ = api;

  var scope = null;
  var scopeInflight = null;
  var busy = false;

  // ---- scope ---------------------------------------------------------------
  // The asset route does not need a scope to READ (an `asset://` id resolves by
  // scan) but POST has to name the world, so resolve it once, lazily, from the
  // app's own APIs and remember it for the session.
  function loadStoredScope() {
    try {
      var raw = window.sessionStorage.getItem(SCOPE_KEY) || window.localStorage.getItem(SCOPE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.profileId && parsed.worldId) return parsed;
    } catch (_) {}
    return null;
  }

  function storeScope(value) {
    try {
      var raw = JSON.stringify(value);
      window.sessionStorage.setItem(SCOPE_KEY, raw);
      window.localStorage.setItem(SCOPE_KEY, raw);
    } catch (_) {}
  }

  // Retries cover the window where the app's /api fetch wrapper (auth header)
  // has not been installed yet.
  function getJSON(url) {
    var attempt = 0;
    function once() {
      return window.fetch(url, { headers: { Accept: "application/json" } }).then(function (response) {
        if ((response.status === 401 || response.status === 403) && attempt < 4) {
          attempt += 1;
          return new Promise(function (r) { setTimeout(r, 250 * attempt); }).then(once);
        }
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      });
    }
    return once();
  }

  function resolveScope(force) {
    if (scope && !force) return Promise.resolve(scope);
    if (scopeInflight) return scopeInflight;
    scopeInflight = getJSON("/api/profile").then(function (profiles) {
      var profileId = profiles && (profiles.activeProfileId ||
        (Array.isArray(profiles.profiles) && profiles.profiles[0] && profiles.profiles[0].id));
      if (!profileId) throw new Error("未找到档案");
      return getJSON("/api/world?profileId=" + encodeURIComponent(profileId)).then(function (worlds) {
        var active = worlds && worlds.active;
        var worldId = (active && (active.worldId || active.id)) ||
          (Array.isArray(worlds.worlds) && worlds.worlds[0] && worlds.worlds[0].id);
        if (!worldId) throw new Error("未找到世界");
        scope = { profileId: profileId, worldId: worldId };
        storeScope(scope);
        window.__SOCRATOPIA_ASSET_SCOPE__ = scope;
        return scope;
      });
    }).then(function (value) {
      scopeInflight = null;
      return value;
    }, function (error) {
      scopeInflight = null;
      throw error;
    });
    return scopeInflight;
  }

  // ---- shared helpers ------------------------------------------------------
  api.url = function (assetId, variant) {
    var url = "/api/assets/" + encodeURIComponent(assetId);
    var params = [];
    if (variant === "thumb") params.push("thumb=1");
    if (variant === "meta") params.push("meta=1");
    if (scope) {
      params.push("profileId=" + encodeURIComponent(scope.profileId));
      params.push("worldId=" + encodeURIComponent(scope.worldId));
    }
    return params.length ? url + "?" + params.join("&") : url;
  };
  window.__SOCRATOPIA_ASSET_URL__ = api.url;

  // Metadata (kind / page / caption) for the provenance badge.  Cached per id; the
  // record never changes because an asset id is content-addressed by creation.
  var metaCache = Object.create(null);
  api.metaCache = metaCache;
  api.meta = function (assetId, callback) {
    if (!assetId) return null;
    var hit = metaCache[assetId];
    if (hit) {
      if (callback) callback(hit);
      return hit;
    }
    if (metaCache[assetId] === null) {
      // in flight: remember the callback
      (api.metaWaiters = api.metaWaiters || Object.create(null))[assetId] =
        (api.metaWaiters[assetId] || []).concat(callback ? [callback] : []);
      return null;
    }
    metaCache[assetId] = null;
    var waiters = api.metaWaiters || (api.metaWaiters = Object.create(null));
    waiters[assetId] = callback ? [callback] : [];
    fetch(api.url(assetId, "meta"), { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (body) {
        var asset = body && body.asset ? body.asset : null;
        metaCache[assetId] = asset || {};
        (waiters[assetId] || []).forEach(function (fn) { try { fn(metaCache[assetId]); } catch (_) {} });
        waiters[assetId] = [];
      })
      .catch(function () {
        metaCache[assetId] = {};
        (waiters[assetId] || []).forEach(function (fn) { try { fn(metaCache[assetId]); } catch (_) {} });
        waiters[assetId] = [];
      });
    return null;
  };
  api.metaLabel = function (asset) {
    if (!asset || typeof asset !== "object") return "";
    var page = asset.ref && Number(asset.ref.page);
    if (asset.kind === "textbook-figure") return Number.isFinite(page) && page > 0 ? "教材 p." + page : "教材原图";
    if (asset.kind === "svg") return "AI 自绘";
    if (asset.kind === "screenshot") return "截图";
    return "插图";
  };
  window.__SOCRATOPIA_ASSET_META__ = api.meta;
  window.__SOCRATOPIA_ASSET_META_LABEL__ = api.metaLabel;

  function toast(message, tone) {
    var el = document.createElement("div");
    el.setAttribute("data-socratopia-toast", "1");
    el.textContent = message;
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:28px;z-index:2147483600;" +
      "padding:8px 14px;border-radius:9999px;font-size:13px;line-height:1.4;max-width:70vw;text-align:center;" +
      "color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.28);pointer-events:none;opacity:0;transition:opacity .16s;" +
      "background:" + (tone === "error" ? "rgba(190,60,60,.94)" : "rgba(40,42,48,.94)");
    (document.body || document.documentElement).appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = "1"; });
    setTimeout(function () {
      el.style.opacity = "0";
      setTimeout(function () { el.remove(); }, 200);
    }, tone === "error" ? 4200 : 2400);
  }
  api.toast = toast;

  // ---- authenticated image loading --------------------------------------------
  // <img src> cannot carry the capability header, so /api/assets URLs 401 when
  // used directly (P0 real-machine bug: bubbles showed the alt text instead of
  // the thumbnail).  Fetch through the app's auth-injecting window.fetch and
  // swap in a blob: URL.  Cached per URL for the session.
  var blobCache = {};
  var hydrateDebug = { sweeps: 0, found: 0, ok: 0, fail: 0, lastError: null, attempts: {} };
  window.__SOCRATOPIA_ASSET_HYDRATE_DEBUG__ = hydrateDebug;

  // Fire-and-forget breadcrumb.  The renderer console is invisible unless the app
  // runs with --enable-logging, so a bogus /api/assets/__probe id (400) doubles as
  // a channel into the server log: there the real src strings, the global's type
  // and the failure counts become readable.  Never throws, never blocks.
  var beaconed = {};
  function beacon(stage, extra) {
    try {
      if (typeof window.fetch !== "function") return;
      var parts = ["stage=" + encodeURIComponent(stage)];
      Object.keys(extra || {}).forEach(function (key) {
        var value = extra[key];
        if (value === undefined || value === null || value === "") return;
        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value).slice(0, 200)));
      });
      window.fetch("/api/assets/__probe?" + parts.join("&"), { headers: { Accept: "application/json" }, cache: "no-store" })
        .then(function () {}, function () {});
    } catch (_) { /* diagnostics must never break rendering */ }
  }
  function beaconOnce(key, stage, extra) {
    if (beaconed[key]) return;
    beaconed[key] = true;
    beacon(stage, extra);
  }
  api._beacon = beacon;
  api._beaconOnce = beaconOnce;

  // `location` is a global outside the sandboxed smoke-test DOM, hence the guard.
  function pageHref() {
    try {
      if (typeof location === "undefined" || !location) return "";
      return String(location.pathname || "") + String(location.search || "");
    } catch (_) {
      return "";
    }
  }
  api._pageHref = pageHref;

  function assetIdOf(src) {
    if (!src) return "";
    if (src.indexOf("asset://") === 0) return src.slice("asset://".length).split(/[?#]/)[0];
    var match = /\/api\/assets\/([^/?#]+)/.exec(src);
    return match ? decodeURIComponent(match[1]) : "";
  }
  api._assetIdOf = assetIdOf;

  // Last resort so a failure is never a silent broken icon: a visible "打开图片"
  // link (click = lightbox, which re-fetches through the authenticated channel).
  function markFailure(img, assetUrl, reason) {
    if (!img || !img.setAttribute) return;
    img.setAttribute("data-socratopia-asset-failed", "1");
    var parent = img.parentNode;
    if (!parent || typeof parent.appendChild !== "function") return;
    var already = parent.querySelector && parent.querySelector("[data-socratopia-asset-link]");
    var id = assetIdOf(assetUrl);
    beaconOnce("fail:" + assetUrl, "blob-fail", {
      src: (img.getAttribute && img.getAttribute("src")) || "",
      url: assetUrl,
      id: id,
      err: reason || "",
    });
    if (already) return;
    var link = document.createElement("a");
    link.setAttribute("data-socratopia-asset-link", "1");
    link.href = assetUrl;
    link.textContent = "打开图片";
    link.title = reason ? "图片未能直接加载（" + reason + "）" : "图片未能直接加载";
    link.style.cssText = "display:inline-block;margin:0 6px;font-size:12px;opacity:.7;text-decoration:underline;cursor:pointer";
    link.addEventListener("click", function (event) {
      event.preventDefault();
      if (id && api.open) api.open(id);
      else if (window.open) window.open(assetUrl, "_blank");
    });
    parent.appendChild(link);
  }
  api._markFailure = markFailure;

  function blobUrl(assetUrl) {
    if (blobCache[assetUrl]) return blobCache[assetUrl];
    var promise = Promise.resolve(null);
    if (window.fetch && window.URL && typeof window.URL.createObjectURL === "function") {
      // no-store matters: an early 401 (capability not minted yet) used to be able to
      // shadow every later attempt through the HTTP cache, and the sweep would then
      // "retry" straight into the same cached failure.
      promise = window.fetch(assetUrl, { headers: { Accept: "image/*" }, cache: "no-store" }).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.blob();
      }).then(function (blob) {
        return window.URL.createObjectURL(blob);
      }).catch(function (error) {
        hydrateDebug.lastError = error ? String(error && error.message || error) : "unknown";
        // A transient failure (capability not minted yet at boot, server restart)
        // must not brick this URL for the whole session: drop the cached promise so
        // the next sweep retries instead of replaying the same rejection.
        delete blobCache[assetUrl];
        return null;
      });
    } else {
      hydrateDebug.lastError = "no fetch/createObjectURL";
    }
    blobCache[assetUrl] = promise;
    return promise;
  }
  api._blobUrl = blobUrl;

  // Converts rendered asset <img> elements (markdown thumbnails) to blob URLs.
  // Accepts an explicit list so the smoke test can drive it without a real DOM.
  // Two DOM shapes must be caught:
  //   1. src="/api/assets/..."  — rendered after __SOCRATOPIA_ASSET_URL__ was installed
  //   2. src="asset://<id>"     — rendered BEFORE this script ran (React keeps the
  //      raw protocol URL; the browser cannot load it, hence the broken image)
  var lastHydrateToast = "";
  function hydrateImages(imgs) {
    var list = imgs;
    if (!list) {
      if (typeof document.querySelectorAll !== "function") return;
      list = document.querySelectorAll('img[src^="asset://"], img[src*="/api/assets/"], img[src*="page-image=1"]');
      // The asset route resolves an id without a scope, but a scope keeps the URL
      // shape identical to what the app itself emits; resolve it once, then re-sweep.
      if (!scope) {
        resolveScope().then(function () { if (scope) hydrateImages([]); }, function () {});
      }
      if (!list.length && document.querySelectorAll("img").length) {
        // Nothing matched although <img> exists: record what the DOM actually holds.
        var all = document.querySelectorAll("img");
        beaconOnce("no-asset-img:" + all.length, "no-asset-img", {
          href: pageHref(),
          imgs: all.length,
          urlGlobal: typeof window.__SOCRATOPIA_ASSET_URL__,
          sample: Array.prototype.map.call(all, function (one) { return one.getAttribute && one.getAttribute("src"); }).slice(0, 4).join(" | "),
        });
      }
    }
    var found = 0;
    Array.prototype.forEach.call(list, function (img) {
      if (!img || (img.getAttribute && img.getAttribute("data-socratopia-asset-hydrated"))) return;
      var src = img.src || (img.getAttribute && img.getAttribute("src")) || "";
      if (src.indexOf("blob:") === 0) return;
      var assetUrl = src;
      if (src.indexOf("asset://") === 0) {
        assetUrl = api.url(src.slice("asset://".length), "thumb");
      } else if (src.indexOf("/api/assets/") === -1 && src.indexOf("page-image=1") === -1) {
        return;
      }
      found += 1;
      beaconOnce("found:" + assetUrl, "sweep-found", { src: src.slice(0, 120), url: assetUrl.slice(0, 160) });
      if (img.setAttribute) img.setAttribute("data-socratopia-asset-hydrated", "1");
      blobUrl(assetUrl).then(function (objectUrl) {
        if (objectUrl) {
          img.src = objectUrl;
          hydrateDebug.ok += 1;
        } else {
          hydrateDebug.fail += 1;
          var attempts = (hydrateDebug.attempts[assetUrl] = (hydrateDebug.attempts[assetUrl] || 0) + 1);
          // Three strikes, then leave a visible way in instead of a dead icon.
          if (attempts >= 3) markFailure(img, assetUrl, hydrateDebug.lastError);
          if (img.removeAttribute) img.removeAttribute("data-socratopia-asset-hydrated"); // retry next sweep
        }
      });
    });
    hydrateDebug.sweeps += 1;
    hydrateDebug.found += found;
    // The sweep runs every 1.2s while a chat is on screen, so a toast on every
    // newly-found image gets noisy ("图片加载: 发现2 成功2 失败0").  Off by default:
    // a real failure stays visible in place through markFailure() after three strikes.
    // Flip HYDRATE_TOAST to true when debugging hydration.
    var HYDRATE_TOAST = false;
    if (HYDRATE_TOAST && found > 0) {
      var signature = found + "/" + hydrateDebug.ok + "/" + hydrateDebug.fail + "/" + (hydrateDebug.lastError || "");
      if (signature !== lastHydrateToast) {
        lastHydrateToast = signature;
        toast("图片加载: 发现" + found + " 成功" + hydrateDebug.ok + " 失败" + hydrateDebug.fail +
          (hydrateDebug.lastError ? " (" + hydrateDebug.lastError + ")" : ""),
          hydrateDebug.fail > 0 ? "error" : undefined);
      }
    }
  }
  api._hydrateImages = hydrateImages;

  // ---- click-to-zoom -------------------------------------------------------
  var lightbox = null;
  api.open = function (assetId) {
    if (!assetId) return;
    if (!lightbox) {
      lightbox = document.createElement("div");
      lightbox.setAttribute("data-socratopia-asset-lightbox", "1");
      lightbox.style.cssText = "position:fixed;inset:0;z-index:2147483500;display:none;align-items:center;" +
        "justify-content:center;background:rgba(0,0,0,.72);cursor:zoom-out;padding:24px;box-sizing:border-box";
      var img = document.createElement("img");
      img.style.cssText = "max-width:96vw;max-height:92vh;border-radius:8px;box-shadow:0 12px 48px rgba(0,0,0,.5);background:#fff";
      lightbox.appendChild(img);
      lightbox.addEventListener("click", function () { lightbox.style.display = "none"; });
      (document.body || document.documentElement).appendChild(lightbox);
      var onKey = function (event) {
        if (event.key === "Escape" && lightbox.style.display === "flex") lightbox.style.display = "none";
      };
      document.addEventListener("keydown", onKey, true);
    }
    var target = api.url(assetId, null);
    lightbox.firstChild.alt = "asset " + assetId;
    lightbox.style.display = "flex";
    if (window.fetch && window.URL && typeof window.URL.createObjectURL === "function") {
      blobUrl(target).then(function (objectUrl) {
        lightbox.firstChild.src = objectUrl || target;
      });
    } else {
      lightbox.firstChild.src = target;
    }
  };
  window.__SOCRATOPIA_ASSET_OPEN__ = api.open;

  // ---- region picking on a frozen screen frame -------------------------------
  // Pure mapping, exported for tests: client coords -> device-pixel crop rect
  // inside the frozen frame (the frame is letterboxed by max-width/max-height,
  // so the img's bounding rect is the coordinate base, not the viewport's).
  function mapRegion(startX, startY, endX, endY, imgRect, naturalWidth, naturalHeight) {
    if (!imgRect || !imgRect.width || !imgRect.height || !naturalWidth || !naturalHeight) return null;
    var rectLeft = imgRect.left != null ? imgRect.left : imgRect.x;
    var rectTop = imgRect.top != null ? imgRect.top : imgRect.y;
    var scaleX = naturalWidth / imgRect.width;
    var scaleY = naturalHeight / imgRect.height;
    var left = Math.max(rectLeft, Math.min(Math.min(startX, endX), rectLeft + imgRect.width));
    var right = Math.max(rectLeft, Math.min(Math.max(startX, endX), rectLeft + imgRect.width));
    var top = Math.max(rectTop, Math.min(Math.min(startY, endY), rectTop + imgRect.height));
    var bottom = Math.max(rectTop, Math.min(Math.max(startY, endY), rectTop + imgRect.height));
    var region = {
      x: Math.round((left - rectLeft) * scaleX),
      y: Math.round((top - rectTop) * scaleY),
      width: Math.round((right - left) * scaleX),
      height: Math.round((bottom - top) * scaleY)
    };
    if (region.width < 4 || region.height < 4) return null;
    return region;
  }
  api._mapRegion = mapRegion;

  // Resolves with a device-pixel {x,y,width,height} into the frozen frame, or
  // null when cancelled.
  function pickRegionOnImage(img) {
    return new Promise(function (resolve) {
      var root = document.createElement("div");
      root.setAttribute("data-socratopia-asset-marquee", "1");
      root.style.cssText = "position:fixed;inset:0;z-index:2147483400;cursor:crosshair;" +
        "background:rgba(10,10,12,.96);display:flex;align-items:center;justify-content:center";
      img.style.cssText = "max-width:100vw;max-height:100vh;display:block;user-select:none";
      var box = document.createElement("div");
      box.style.cssText = "position:fixed;display:none;border:1px solid rgba(255,255,255,.95);" +
        "background:rgba(120,180,255,.20);box-shadow:0 0 0 1px rgba(0,0,0,.35);pointer-events:none";
      var hint = document.createElement("div");
      hint.textContent = "在冻结的屏幕上拖动框选（PDF、网页、任何窗口）· Esc 取消";
      hint.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:6px 14px;" +
        "border-radius:9999px;background:rgba(40,42,48,.92);color:#fff;font-size:13px;pointer-events:none";
      root.appendChild(img);
      root.appendChild(box);
      root.appendChild(hint);
      (document.body || document.documentElement).appendChild(root);

      var start = null;
      var done = false;

      function finish(result) {
        if (done) return;
        done = true;
        root.removeEventListener("mousedown", onDown, true);
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
        document.removeEventListener("keydown", onKey, true);
        root.remove();
        resolve(result);
      }

      function paint(event) {
        if (!start) return;
        box.style.display = "block";
        box.style.left = Math.min(start.x, event.clientX) + "px";
        box.style.top = Math.min(start.y, event.clientY) + "px";
        box.style.width = Math.abs(event.clientX - start.x) + "px";
        box.style.height = Math.abs(event.clientY - start.y) + "px";
      }

      function onDown(event) {
        if (event.button !== 0) return;
        start = { x: event.clientX, y: event.clientY };
        paint(event);
        event.preventDefault();
        event.stopPropagation();
      }

      function onMove(event) {
        paint(event);
      }

      function onUp(event) {
        if (!start) return finish(null);
        finish(mapRegion(start.x, start.y, event.clientX, event.clientY,
          img.getBoundingClientRect(), img.naturalWidth, img.naturalHeight));
      }

      function onKey(event) {
        if (event.key === "Escape") finish(null);
      }

      root.addEventListener("mousedown", onDown, true);
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
      document.addEventListener("keydown", onKey, true);
    });
  }

  function loadFrame(pngBase64) {
    return new Promise(function (resolve, reject) {
      var img = document.createElement("img");
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("屏幕帧加载失败")); };
      img.src = "data:image/png;base64," + pngBase64;
    });
  }

  function cropFrame(img, region) {
    var canvas = document.createElement("canvas");
    canvas.width = region.width;
    canvas.height = region.height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
    var url = canvas.toDataURL("image/png");
    return url.slice(url.indexOf(",") + 1);
  }

  // ---- composer insertion --------------------------------------------------
  // React tracks the textarea value through a native setter, so assigning
  // `.value` directly is invisible to it; go through the prototype setter and
  // dispatch a bubbling input event.
  function composer() {
    return document.querySelector('textarea[data-testid="chat-input-textarea"]') ||
      document.querySelector("textarea");
  }

  function insertAnchor(assetId, label) {
    var field = composer();
    var anchor = "![" + (label || "图片") + "](asset://" + assetId + ")";
    if (!field) return false;
    var prototype = field.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(prototype, "value");
    var current = field.value || "";
    var spacer = current && !/\s$/.test(current) ? " " : "";
    var next = current + spacer + anchor + " ";
    if (setter && setter.set) setter.set.call(field, next);
    else field.value = next;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    try { field.focus(); } catch (_) {}
    return true;
  }
  api.insertAnchor = insertAnchor;

  // ---- capture -------------------------------------------------------------
  function uploadPng(pngBase64) {
    return resolveScope().then(function (resolved) {
      return window.fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "screenshot",
          pngBase64: pngBase64,
          profileId: resolved.profileId,
          worldId: resolved.worldId,
          tags: ["screenshot"]
        })
      });
    }).then(function (response) {
      if (!response.ok) return response.text().then(function (text) { throw new Error(text || ("HTTP " + response.status)); });
      return response.json();
    }).then(function (created) {
      if (!created || !created.assetId) throw new Error("资产创建失败");
      var inserted = insertAnchor(created.assetId);
      toast(inserted ? "已插入截图，发送即可" : "截图已保存：" + created.assetId);
      return created.assetId;
    });
  }

  // Freezes the whole screen (any window, PDF reader included — the app hides
  // itself first), lets the user drag a marquee over the frozen frame, crops
  // locally on a canvas, then uploads the region as a screenshot asset.
  api.capture = function () {
    if (busy) return Promise.resolve(null);
    var bridge = window.electronAPI;
    if (!bridge || typeof bridge.captureScreen !== "function") {
      toast("截屏需要桌面应用（未找到 captureScreen）", "error");
      return Promise.resolve(null);
    }
    busy = true;
    return bridge.captureScreen().then(function (result) {
      if (!result || !result.ok || !result.pngBase64) {
        throw new Error((result && result.message) || "截屏失败");
      }
      return loadFrame(result.pngBase64);
    }).then(function (img) {
      return pickRegionOnImage(img).then(function (region) {
        if (!region) return null;
        return cropFrame(img, region);
      });
    }).then(function (pngBase64) {
      if (!pngBase64) return null;
      return uploadPng(pngBase64);
    }).catch(function (error) {
      toast("截图失败：" + ((error && error.message) || error), "error");
      return null;
    }).then(function (value) {
      busy = false;
      return value;
    }, function (error) {
      busy = false;
      throw error;
    });
  };

  // ---- textbook figure entry (T13d) ------------------------------------------
  // A classroom session may or may not sit on a textbook, and the compiled app
  // gives no seam to read the active conversation.  Two app APIs are enough: the
  // server answers "does this world have an active textbook" (GET /api/textbook
  // -> activeTextbookId) and the app's own /api/reading-context call names the
  // conversation it is teaching, so the entry appears and disappears with the
  // session instead of being scraped out of the DOM.
  var FIGURE_POLL_MS = 6000;
  var FIGURE_PREVIEW_WIDTH = 1400;
  var figureContext = null;
  var figurePolledAt = 0;
  var figurePollInflight = null;

  function queryParam(url, key) {
    var match = new RegExp("[?&]" + key + "=([^&#]*)").exec(String(url || ""));
    if (!match) return "";
    try { return decodeURIComponent(match[1]); } catch (_) { return ""; }
  }

  function observeReadingContext(input) {
    var raw = typeof input === "string" ? input : (input && input.url);
    if (!raw || raw.indexOf("/api/reading-context") === -1) return;
    var textbookId = queryParam(raw, "textbookId");
    var profileId = queryParam(raw, "profileId");
    var worldId = queryParam(raw, "worldId");
    if (!textbookId || !profileId || !worldId) return;
    figureContext = {
      profileId: profileId,
      worldId: worldId,
      textbookId: textbookId,
      conversationId: queryParam(raw, "conversationId")
    };
  }
  api._observeReadingContext = observeReadingContext;

  // The app patches window.fetch for its capability header and its own module
  // fetch goes through __SOCRATOPIA_NATIVE_FETCH__ instead, so wrap both.  The
  // marker keeps a function from being wrapped twice by the periodic re-check.
  function observedFetch(fn) {
    var wrapped = function (input, init) {
      observeReadingContext(input);
      return fn.apply(this, arguments);
    };
    wrapped.__socratopiaFigureObserver = true;
    return wrapped;
  }

  function observeFetch() {
    if (typeof window.fetch === "function" && !window.fetch.__socratopiaFigureObserver) {
      window.fetch = observedFetch(window.fetch);
    }
    if (typeof window.__SOCRATOPIA_NATIVE_FETCH__ === "function" &&
      !window.__SOCRATOPIA_NATIVE_FETCH__.__socratopiaFigureObserver) {
      window.__SOCRATOPIA_NATIVE_FETCH__ = observedFetch(window.__SOCRATOPIA_NATIVE_FETCH__);
    }
  }
  api._observeFetch = observeFetch;

  // Throttled "which textbook is this world on" refresh; never rejects, so an
  // unreachable API keeps the entry hidden instead of breaking boot.
  function refreshFigureContext(force) {
    if (figurePollInflight) return figurePollInflight;
    var now = Date.now();
    if (!force && now - figurePolledAt < FIGURE_POLL_MS) return Promise.resolve(figureContext);
    figurePolledAt = now;
    // Wrapped so a synchronous failure (no window.fetch yet) becomes a rejection
    // instead of escaping boot().
    figurePollInflight = Promise.resolve().then(function () {
      return resolveScope();
    }).then(function (resolved) {
      return getJSON("/api/textbook?profileId=" + encodeURIComponent(resolved.profileId) +
        "&worldId=" + encodeURIComponent(resolved.worldId));
    }).then(function (data) {
      var textbookId = data && typeof data.activeTextbookId === "string" ? data.activeTextbookId : "";
      if (textbookId) {
        figureContext = {
          profileId: (figureContext && figureContext.profileId) || scope.profileId,
          worldId: (figureContext && figureContext.worldId) || scope.worldId,
          textbookId: textbookId,
          conversationId: (figureContext && figureContext.conversationId) || ""
        };
      } else if (figureContext) {
        figureContext.textbookId = "";
      }
      return figureContext;
    }).catch(function () {
      return figureContext;
    }).then(function (value) {
      figurePollInflight = null;
      return value;
    }, function (error) {
      figurePollInflight = null;
      throw error;
    });
    return figurePollInflight;
  }
  api._refreshFigureContext = refreshFigureContext;
  api._figureContext = function () { return figureContext; };

  function figurePageUrl(context, page, maxWidth) {
    return "/api/textbook?page-image=1" +
      "&profileId=" + encodeURIComponent(context.profileId) +
      "&worldId=" + encodeURIComponent(context.worldId) +
      "&textbookId=" + encodeURIComponent(context.textbookId) +
      "&page=" + encodeURIComponent(page) +
      "&maxWidth=" + encodeURIComponent(maxWidth);
  }

  // Opens the picker on the page the lesson is actually on.
  function figureDefaultPage(context) {
    var url = "/api/reading-context?profileId=" + encodeURIComponent(context.profileId) +
      "&worldId=" + encodeURIComponent(context.worldId) +
      "&textbookId=" + encodeURIComponent(context.textbookId) +
      (context.conversationId ? "&conversationId=" + encodeURIComponent(context.conversationId) : "");
    return getJSON(url).then(function (data) {
      var start = data && data.readingRange && Number(data.readingRange.startPage);
      return Number.isInteger(start) && start >= 1 ? start : 1;
    }).catch(function () { return 1; });
  }

  // Device-pixel marquee -> normalized rect: the only coordinate shape that
  // crosses to the server, so preview and crop agree at any DPI (plan §3).
  function normalizedRect(region, width, height) {
    if (!region || !width || !height) return null;
    function ratio(value) { return Math.round(Math.min(1, Math.max(0, value)) * 1e4) / 1e4; }
    var rect = [
      ratio(region.x / width),
      ratio(region.y / height),
      ratio((region.x + region.width) / width),
      ratio((region.y + region.height) / height)
    ];
    if (rect[2] <= rect[0] || rect[3] <= rect[1]) return null;
    return rect;
  }
  api._normalizedRect = normalizedRect;

  function uploadFigure(context, page, rect) {
    return window.fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "textbook-figure",
        profileId: context.profileId,
        worldId: context.worldId,
        conversationId: context.conversationId || undefined,
        ref: { textbookId: context.textbookId, page: page, rect: rect },
        tags: ["textbook-figure"]
      })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || !data || !data.assetId) {
          throw new Error((data && (data.message || data.code)) || ("HTTP " + response.status));
        }
        return data.assetId;
      });
    }).catch(function (error) {
      toast("插图保存失败：" + ((error && error.message) || error), "error");
      return null;
    });
  }

  // Page preview + marquee + upload, all in one overlay.  Resolves with the new
  // asset id, or null when the user closes the dialog.
  function openFigureDialog(context, startPage) {
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.setAttribute("data-socratopia-figure-dialog", "1");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483300;display:flex;align-items:center;" +
        "justify-content:center;padding:24px;box-sizing:border-box;background:rgba(12,12,14,.62)";
      var panel = document.createElement("div");
      panel.style.cssText = "display:flex;flex-direction:column;gap:10px;width:min(900px,92vw);max-height:92vh;" +
        "padding:16px;border-radius:14px;background:var(--background,#fff);color:var(--foreground,#222);" +
        "box-shadow:0 18px 48px rgba(0,0,0,.36)";
      var head = document.createElement("div");
      head.style.cssText = "display:flex;align-items:center;gap:10px";
      var title = document.createElement("div");
      title.textContent = "引用教材插图";
      title.style.cssText = "flex:1;font-size:14px;font-weight:600";
      var close = document.createElement("button");
      close.type = "button";
      close.setAttribute("data-socratopia-figure-close", "1");
      close.textContent = "×";
      close.style.cssText = "border:0;background:transparent;cursor:pointer;font-size:20px;line-height:1;color:inherit";
      head.appendChild(title);
      head.appendChild(close);

      var controls = document.createElement("div");
      controls.style.cssText = "display:flex;align-items:center;gap:8px;font-size:13px";
      var pageLabel = document.createElement("span");
      pageLabel.textContent = "页码";
      var pageField = document.createElement("input");
      pageField.type = "number";
      pageField.min = "1";
      pageField.setAttribute("data-socratopia-figure-page", "1");
      pageField.style.cssText = "width:80px;padding:4px 8px;border-radius:8px;" +
        "border:1px solid var(--border, rgba(0,0,0,.16));background:transparent;color:inherit";
      var pickButton = document.createElement("button");
      pickButton.type = "button";
      pickButton.setAttribute("data-socratopia-figure-pick", "1");
      pickButton.textContent = "框选插图";
      pickButton.style.cssText = "margin-left:auto;padding:6px 14px;border-radius:9999px;border:0;cursor:pointer;" +
        "background:var(--accent, #3a6df0);color:#fff;font-size:13px;font-weight:600";
      controls.appendChild(pageLabel);
      controls.appendChild(pageField);
      controls.appendChild(pickButton);

      var status = document.createElement("div");
      status.setAttribute("data-socratopia-figure-status", "1");
      status.style.cssText = "font-size:12px;line-height:1.5;color:var(--muted, #666)";
      var preview = document.createElement("div");
      preview.style.cssText = "flex:1;min-height:200px;display:flex;align-items:center;" +
        "justify-content:center;overflow:hidden";
      var img = document.createElement("img");
      img.setAttribute("data-socratopia-figure-preview", "1");
      img.alt = "教材页预览";
      img.style.cssText = "max-width:100%;max-height:66vh;border-radius:8px;" +
        "border:1px solid var(--border, rgba(0,0,0,.14));background:#fff";
      preview.appendChild(img);

      panel.appendChild(head);
      panel.appendChild(controls);
      panel.appendChild(status);
      panel.appendChild(preview);
      overlay.appendChild(panel);
      (document.body || document.documentElement).appendChild(overlay);

      var page = startPage;
      var loaded = false;
      var picking = false;
      var done = false;

      function finish(value) {
        if (done) return;
        done = true;
        close.removeEventListener("click", onClose);
        overlay.removeEventListener("click", onBackdrop);
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        resolve(value);
      }

      function onClose() { finish(null); }
      function onBackdrop(event) { if (event.target === overlay) finish(null); }
      function onKey(event) { if (event.key === "Escape" && !picking) finish(null); }

      function loadPage(next) {
        page = next;
        pageField.value = String(page);
        loaded = false;
        status.textContent = "正在渲染第 " + page + " 页…";
        return blobUrl(figurePageUrl(context, page, FIGURE_PREVIEW_WIDTH)).then(function (objectUrl) {
          if (!objectUrl) throw new Error("页图加载失败");
          return new Promise(function (ready, fail) {
            img.onload = function () { ready(img); };
            img.onerror = function () { fail(new Error("页图加载失败")); };
            img.src = objectUrl;
          });
        }).then(function () {
          loaded = true;
          status.textContent = "第 " + page + " 页已就绪 · 点「框选插图」在页面上拖动框选 · Esc 取消";
        }).catch(function (error) {
          status.textContent = "第 " + page + " 页加载失败：" + ((error && error.message) || error);
        });
      }

      function pick() {
        if (!loaded) { toast("页图还没加载好"); return Promise.resolve(null); }
        picking = true;
        return pickRegionOnImage(img).then(function (region) {
          picking = false;
          var rect = normalizedRect(region, img.naturalWidth, img.naturalHeight);
          if (!rect) { status.textContent = "框选已取消或选区太小，请重新框选"; return null; }
          status.textContent = "正在保存插图…";
          return uploadFigure(context, page, rect).then(function (assetId) {
            if (!assetId) { status.textContent = "保存失败，可重新框选重试"; return null; }
            var inserted = insertAnchor(assetId, "图 p." + page);
            toast(inserted ? "已插入教材插图 p." + page + "，发送即可" : "插图已保存：" + assetId);
            finish(assetId);
            return assetId;
          });
        });
      }

      close.addEventListener("click", onClose);
      overlay.addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKey, true);
      pageField.addEventListener("change", function () {
        var next = Number(pageField.value);
        loadPage(Number.isInteger(next) && next >= 1 ? next : 1);
      });
      pickButton.addEventListener("click", function (event) {
        event.preventDefault();
        pick();
      });
      loadPage(startPage);

      api._figureDialog = { overlay: overlay, img: img, loadPage: loadPage, pick: pick };
    });
  }

  api.referenceFigure = function () {
    if (busy) return Promise.resolve(null);
    busy = true;
    return refreshFigureContext(true).then(function (context) {
      if (!context || !context.textbookId) {
        toast("当前世界还没有激活的教材", "error");
        return null;
      }
      return figureDefaultPage(context).then(function (startPage) {
        return openFigureDialog(context, startPage);
      });
    }).catch(function (error) {
      toast("引用插图失败：" + ((error && error.message) || error), "error");
      return null;
    }).then(function (value) {
      busy = false;
      return value;
    }, function (error) {
      busy = false;
      throw error;
    });
  };

  // ---- button --------------------------------------------------------------
  function mountButton() {
    if (document.querySelector("[data-socratopia-asset-button]")) return;
    var button = document.createElement("button");
    button.setAttribute("data-socratopia-asset-button", "1");
    button.type = "button";
    button.title = "截取屏幕区域（PDF、网页、任意窗口，插入到输入框）";
    button.setAttribute("aria-label", "截取屏幕区域");
    button.style.cssText = "position:fixed;right:20px;bottom:116px;z-index:2147482000;width:38px;height:38px;" +
      "border-radius:9999px;border:1px solid var(--border, rgba(0,0,0,.14));cursor:pointer;" +
      "background:var(--background, #fff);color:var(--foreground, #222);box-shadow:0 4px 16px rgba(0,0,0,.16);" +
      "display:flex;align-items:center;justify-content:center;padding:0;font-size:17px;line-height:1";
    button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/>' +
      '<path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/>' +
      '<rect x="8" y="8" width="8" height="8" rx="1"/></svg>';
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      api.capture();
    });
    (document.body || document.documentElement).appendChild(button);
  }

  // Hidden until the world has an active textbook, so a no-textbook session is
  // untouched by the entry (plan §6, review anchor 4).
  function mountFigureButton() {
    if (document.querySelector("[data-socratopia-figure-button]")) return;
    var button = document.createElement("button");
    button.setAttribute("data-socratopia-figure-button", "1");
    button.type = "button";
    button.title = "引用本页教材插图（框选后插入到输入框）";
    button.setAttribute("aria-label", "引用本页教材插图");
    button.style.cssText = "position:fixed;right:20px;bottom:164px;z-index:2147482000;width:38px;height:38px;" +
      "border-radius:9999px;border:1px solid var(--border, rgba(0,0,0,.14));cursor:pointer;" +
      "background:var(--background, #fff);color:var(--foreground, #222);box-shadow:0 4px 16px rgba(0,0,0,.16);" +
      "display:none;align-items:center;justify-content:center;padding:0;font-size:17px;line-height:1";
    button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.4"/>' +
      '<path d="M4.5 17.5l4.5-4.5 3 3 3-3 4.5 4.5"/></svg>';
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      api.referenceFigure();
    });
    (document.body || document.documentElement).appendChild(button);
  }

  function syncFigureButton() {
    var button = document.querySelector("[data-socratopia-figure-button]");
    if (!button) return Promise.resolve(null);
    return refreshFigureContext().then(function (context) {
      button.style.display = context && context.textbookId ? "flex" : "none";
      return context;
    });
  }
  api._syncFigureButton = syncFigureButton;

  api.mount = mountButton;
  api.mountFigureButton = mountFigureButton;

  function boot() {
    mountButton();
    mountFigureButton();
    observeFetch();
    scope = loadStoredScope();
    if (scope) window.__SOCRATOPIA_ASSET_SCOPE__ = scope;
    // One breadcrumb per page load: the renderer's capability surface, so a broken
    // thumbnail can be diagnosed from the server log alone.
    beacon("boot", {
      href: pageHref(),
      urlGlobal: typeof window.__SOCRATOPIA_ASSET_URL__,
      fetch: typeof window.fetch,
      createObjectURL: typeof (window.URL && window.URL.createObjectURL),
      scope: scope ? "stored" : "none",
      imgs: typeof document.querySelectorAll === "function" ? document.querySelectorAll("img").length : -1,
    });
    hydrateImages();
    syncFigureButton();
    // The body may be replaced by the router; re-assert the buttons cheaply and
    // keep converting freshly rendered asset thumbnails to blob URLs.
    setInterval(function () {
      if (!document.querySelector("[data-socratopia-asset-button]")) mountButton();
      if (!document.querySelector("[data-socratopia-figure-button]")) mountFigureButton();
      observeFetch();
      syncFigureButton();
      hydrateImages();
    }, 2000);
  }

  // Installed before the app's async chunk can capture window.fetch: the chunk
  // may run during parsing, i.e. before DOMContentLoaded reaches boot().
  observeFetch();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
