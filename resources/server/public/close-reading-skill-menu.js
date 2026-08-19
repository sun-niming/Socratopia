(function () {
  "use strict";
  if (window.__SOCRATOPIA_CLOSE_READING_MENU__) return;
  window.__SOCRATOPIA_CLOSE_READING_MENU__ = true;

  var menu = null;
  var activeInput = null;
  var skillButton = null;
  var syncScheduled = false;

  function isChinese() {
    return /^zh/i.test(document.documentElement.lang || navigator.language || "zh");
  }

  function inputValue(input, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function selectSkill() {
    if (!activeInput) return;
    var current = activeInput.value || "";
    var next = /^\s*\/[^\s]*/.test(current)
      ? current.replace(/^\s*\/[^\s]*\s*/, "/Close_Reading ")
      : "/Close_Reading " + current;
    inputValue(activeInput, next);
    closeMenu();
    activeInput.focus();
    requestAnimationFrame(function () {
      activeInput.setSelectionRange(next.length, next.length);
    });
  }

  function closeMenu() {
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    menu = null;
  }

  function positionMenu() {
    if (!menu || !activeInput) return;
    var rect = activeInput.getBoundingClientRect();
    var width = Math.min(440, Math.max(300, rect.width));
    menu.style.width = width + "px";
    menu.style.left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left)) + "px";
    menu.style.top = Math.max(12, rect.top - menu.offsetHeight - 10) + "px";
  }

  function positionButton() {
    if (!skillButton || !isUsableInput(activeInput)) return;
    var rect = activeInput.getBoundingClientRect();
    skillButton.style.left = Math.max(12, rect.right - 42) + "px";
    skillButton.style.top = Math.max(12, rect.top + 8) + "px";
  }

  function positionAll() {
    positionButton();
    positionMenu();
  }

  function openMenu(input) {
    activeInput = input;
    if (menu) return positionMenu();
    var zh = isChinese();
    menu = document.createElement("div");
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", zh ? "技能建议" : "Skill suggestions");
    menu.style.cssText = "position:fixed;z-index:2147483000;padding:8px;border:1px solid var(--border,#d8d8df);border-radius:12px;background:var(--surface-raised,var(--background,#fff));color:var(--foreground,#1f2937);box-shadow:0 12px 32px rgba(0,0,0,.18);font-family:inherit;";
    var heading = document.createElement("div");
    heading.textContent = zh ? "技能" : "SKILLS";
    heading.style.cssText = "padding:4px 8px 7px;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--muted,#6b7280);";
    var item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "true");
    item.style.cssText = "display:flex;width:100%;align-items:flex-start;gap:10px;padding:10px;border:0;border-radius:9px;text-align:left;background:var(--accent-bg,#f1efff);color:inherit;cursor:pointer;font-family:inherit;";
    item.innerHTML = '<span aria-hidden="true" style="display:flex;width:28px;height:28px;align-items:center;justify-content:center;flex:none;border-radius:7px;background:var(--accent-solid,#6d5bd0);color:white;font-weight:800">/</span>' +
      '<span style="display:block;min-width:0;flex:1"><span style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:650"><span>/Close_Reading</span><span style="padding:1px 6px;border-radius:999px;border:1px solid var(--accent-border,#c9c2f2);font-size:10px;color:var(--accent,#6d5bd0)">' + (zh ? "PDF 精读" : "PDF Close Reading") + '</span></span><span style="display:block;margin-top:3px;font-size:12px;line-height:1.35;color:var(--muted,#6b7280)">' + (zh ? "按页读取原文、代码或公式，不改变课堂进度" : "Read exact PDF text, code or formulas without changing lesson progress") + "</span></span>";
    item.addEventListener("mousedown", function (event) { event.preventDefault(); });
    item.addEventListener("click", selectSkill);
    menu.appendChild(heading);
    menu.appendChild(item);
    document.body.appendChild(menu);
    positionMenu();
  }

  function shouldOpen(input) {
    return /^\s*\/[^\s]*$/.test(input.value || "");
  }

  function isUsableInput(input) {
    if (!input || !input.isConnected || input.disabled || input.readOnly) return false;
    var rect = input.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20 || input.getClientRects().length === 0) return false;
    var style = window.getComputedStyle(input);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function removeUi() {
    closeMenu();
    if (skillButton && skillButton.parentNode) skillButton.parentNode.removeChild(skillButton);
    skillButton = null;
    activeInput = null;
  }

  function syncUi() {
    var inputs = document.querySelectorAll('[data-testid="chat-input-textarea"]');
    var input = null;
    for (var i = 0; i < inputs.length; i++) {
      if (isUsableInput(inputs[i])) { input = inputs[i]; break; }
    }
    if (!input) return removeUi();
    activeInput = input;
    ensureButton(input);
    if (shouldOpen(input)) openMenu(input); else closeMenu();
  }

  function scheduleSyncUi() {
    if (syncScheduled) return;
    syncScheduled = true;
    var run = function () {
      syncScheduled = false;
      syncUi();
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 16);
    }
  }

  function ensureButton(input) {
    if (!isUsableInput(input)) return removeUi();
    activeInput = input;
    if (!skillButton || !skillButton.isConnected) {
      skillButton = document.createElement("button");
      skillButton.type = "button";
      skillButton.textContent = "/";
      skillButton.setAttribute("aria-label", isChinese() ? "打开技能菜单" : "Open Skills menu");
      skillButton.title = isChinese() ? "技能（也可在输入框键入 /）" : "Skills (or type / in the message box)";
      skillButton.style.cssText = "position:fixed;z-index:2147482990;width:34px;height:34px;border:1px solid var(--border,#d8d8df);border-radius:8px;background:color-mix(in oklab,var(--background,#fff) 88%,transparent);color:var(--foreground,#374151);font:700 17px/1 inherit;opacity:.72;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.06);";
      skillButton.addEventListener("mousedown", function (event) { event.preventDefault(); });
      skillButton.addEventListener("click", function () {
        if (!activeInput) return;
        if (!/^\s*\//.test(activeInput.value || "")) inputValue(activeInput, "/");
        activeInput.focus();
        openMenu(activeInput);
      });
      document.body.appendChild(skillButton);
    }
    positionButton();
  }

  document.addEventListener("focusin", function (event) {
    var input = event.target && event.target.closest && event.target.closest('[data-testid="chat-input-textarea"]');
    if (!isUsableInput(input)) return;
    activeInput = input;
    ensureButton(input);
    if (shouldOpen(input)) openMenu(input);
  });

  document.addEventListener("input", function (event) {
    var input = event.target && event.target.matches && event.target.matches('[data-testid="chat-input-textarea"]') ? event.target : null;
    if (!isUsableInput(input)) return removeUi();
    activeInput = input;
    ensureButton(input);
    if (shouldOpen(input)) openMenu(input); else closeMenu();
  }, true);

  document.addEventListener("keydown", function (event) {
    if (!menu || event.target !== activeInput) return;
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectSkill();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMenu();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
    }
  }, true);

  document.addEventListener("mousedown", function (event) {
    if (menu && !menu.contains(event.target) && event.target !== skillButton) closeMenu();
  }, true);
  window.addEventListener("resize", positionAll);
  window.addEventListener("scroll", positionAll, true);

  new MutationObserver(scheduleSyncUi).observe(document.documentElement, { childList: true, subtree: true });
  syncUi();
})();
