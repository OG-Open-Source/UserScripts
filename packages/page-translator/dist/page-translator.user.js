// ==UserScript==
// @name         Page Translator
// @namespace    Violentmonkey Scripts
// @version      1.1.0
// @author       OG-Open-Source
// @description  Tag-free automatic web page translator with custom CSS presentation, CJK spacing, and Traditional/Simplified conversion.
// @downloadURL  https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/page-translator/dist/page-translator.user.js
// @updateURL    https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/page-translator/dist/page-translator.meta.js
// @match        *://*/*
// @connect      translate-pa.googleapis.com
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @connect      localhost
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function srgbToLinear(component) {
    return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
  }
  function hexToOklab(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!match) {
      return null;
    }
    const r = srgbToLinear(Number.parseInt(match[1], 16) / 255);
    const g = srgbToLinear(Number.parseInt(match[2], 16) / 255);
    const b = srgbToLinear(Number.parseInt(match[3], 16) / 255);
    const l = Math.cbrt(
      0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    );
    const m = Math.cbrt(
      0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    );
    const s = Math.cbrt(
      0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    );
    return {
      L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    };
  }
  function oklabToOklch(lab) {
    const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    let h = Math.atan2(lab.b, lab.a) * 180 / Math.PI;
    if (h < 0) {
      h += 360;
    }
    return { L: lab.L, C, h };
  }
  function formatOklch(lch, override) {
    const L = lch.L;
    const C = Math.max(0, lch.C);
    const h = lch.h;
    return `oklch(${(L * 100).toFixed(2)}% ${C.toFixed(4)} ${h.toFixed(2)})`;
  }
  function getAccessibleTextOklch(bg, chromaIntensity = 0.3) {
    const lch = oklabToOklch(bg);
    const isLight = bg.L > 0.6;
    const targetL = Math.max(
      0.05,
      Math.min(0.98, isLight ? bg.L - 0.55 : bg.L + 0.52)
    );
    return formatOklch({ L: targetL, C: lch.C * chromaIntensity, h: lch.h });
  }
  const US_UI_ATTR = "data-us-ui";
  const ICON_FONT_CLASS_RE = /\bmaterial-(?:icons(?:-[a-z-]+)?|symbols(?:-[a-z-]+)?)\b/iu;
  function markUiRoot(el, scriptId) {
    el.setAttribute(US_UI_ATTR, scriptId);
    el.setAttribute("translate", "no");
  }
  function isForeignUi(node) {
    if (!node) {
      return false;
    }
    const el = node.nodeType === 1 ? node : node.parentElement ?? null;
    if (!el) {
      return false;
    }
    if (el.hasAttribute(US_UI_ATTR) || el.hasAttribute("data-ptr-ui") || el.getAttribute("translate") === "no" || el.classList?.contains("notranslate")) {
      return true;
    }
    if (typeof el.closest === "function" && el.closest(
      `[${US_UI_ATTR}],[data-ptr-ui],[translate="no"],.notranslate`
    ) !== null) {
      return true;
    }
    const cls = el.getAttribute("class") ?? "";
    if (cls && ICON_FONT_CLASS_RE.test(cls)) {
      return true;
    }
    return false;
  }
  function isUsUiEvent(e, ownHost) {
    if (typeof e.composedPath === "function") {
      for (const node of e.composedPath()) {
        if (ownHost && node === ownHost) {
          return true;
        }
        if (node && typeof node.hasAttribute === "function" && (node.hasAttribute(US_UI_ATTR) || node.hasAttribute("data-ptr-ui"))) {
          return true;
        }
      }
    }
    const target = e.target;
    if (!target) {
      return false;
    }
    if (ownHost?.shadowRoot && target.getRootNode?.() === ownHost.shadowRoot) {
      return true;
    }
    return isForeignUi(target);
  }
  function createDragController(options) {
    const { panel, handle, stage } = options;
    const threshold = options.thresholdPx ?? 3;
    const padding = options.padding ?? 8;
    let drag = null;
    function originOf(target) {
      const tRect = target.getBoundingClientRect();
      if (!stage) {
        return { left: tRect.left, top: tRect.top };
      }
      const sRect = stage.getBoundingClientRect();
      return {
        left: tRect.left - (sRect.left + stage.clientLeft),
        top: tRect.top - (sRect.top + stage.clientTop)
      };
    }
    function clampBounds(panelRect) {
      if (!stage) {
        const view = panel.ownerDocument.defaultView;
        return {
          maxL: (view?.innerWidth ?? panelRect.right) - panelRect.width - padding,
          maxT: (view?.innerHeight ?? panelRect.bottom) - panelRect.height - padding
        };
      }
      return {
        maxL: stage.clientWidth - panelRect.width - padding,
        maxT: stage.clientHeight - panelRect.height - padding
      };
    }
    function onPointerDown(e) {
      if (e.button !== 0) {
        return;
      }
      const target = e.target;
      if (target?.closest?.("button, input, textarea, select, a")) {
        return;
      }
      const panelRect = panel.getBoundingClientRect();
      const origin = originOf(panel);
      handle.setPointerCapture?.(e.pointerId);
      drag = {
        armed: false,
        startX: e.clientX,
        startY: e.clientY,
        origL: origin.left,
        origT: origin.top,
        ...clampBounds(panelRect)
      };
    }
    function onPointerMove(e) {
      if (!drag) {
        return;
      }
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.armed) {
        if (Math.hypot(dx, dy) < threshold) {
          return;
        }
        drag.armed = true;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        handle.classList.add("dragging");
      }
      panel.style.left = `${Math.max(padding, Math.min(drag.maxL, drag.origL + dx))}px`;
      panel.style.top = `${Math.max(padding, Math.min(drag.maxT, drag.origT + dy))}px`;
    }
    function endDrag() {
      drag = null;
      handle.classList.remove("dragging");
    }
    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    return {
      destroy() {
        handle.removeEventListener("pointerdown", onPointerDown);
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", endDrag);
        handle.removeEventListener("pointercancel", endDrag);
      }
    };
  }
  let api = null;
  function configureGmApi(gm) {
    api = gm;
  }
  function getApi() {
    if (!api) {
      throw new Error(
        "[@userscripts/shared] GM API not configured — call configureGmApi() at script entry."
      );
    }
    return api;
  }
  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      const details = {
        method: options.method ?? "GET",
        url: options.url,
        timeout: options.timeout ?? 2e4,
        ...options.headers ? { headers: options.headers } : {},
        ...options.data === void 0 ? {} : { data: options.data },
        onload: (res) => {
          if (res.status >= 200 && res.status < 400) {
            resolve(res);
          } else {
            reject(new Error("HTTP " + res.status));
          }
        },
        onerror: () => reject(new Error("network error")),
        ontimeout: () => reject(new Error("timeout"))
      };
      getApi().GM_xmlhttpRequest(details);
    });
  }
  function gmFetch(url, timeout = 2e4) {
    return gmRequest({ method: "GET", url, timeout }).then(
      (res) => res.responseText
    );
  }
  function gmGet(key, defaultValue) {
    return getApi().GM_getValue(key, defaultValue);
  }
  function gmSet(key, value) {
    getApi().GM_setValue(key, value);
  }
  function gmMenuCommand(caption, onClick, options) {
    const res = getApi().GM_registerMenuCommand(caption, onClick, options);
    return typeof res === "string" || typeof res === "number" ? res : void 0;
  }
  function gmUnregisterMenuCommand(menuId) {
    getApi().GM_unregisterMenuCommand?.(menuId);
  }
  function gmAddStyle(css) {
    const res = api?.GM_addStyle?.(css);
    return res ?? null;
  }
  const MANAGER_URL = "https://og-open-source.github.io/UserScripts";
  const CACHE_KEY$1 = (scriptId) => `i18n:${scriptId}`;
  async function loadLocales(source, onChange) {
    const key = CACHE_KEY$1(source.scriptId);
    const cached = gmGet(key, null);
    const fresh = gmFetch(source.url).then(
      (body) => JSON.parse(body)
    );
    if (cached) {
      void fresh.then((next2) => {
        if (JSON.stringify(cached) !== JSON.stringify(next2)) {
          gmSet(key, next2);
          onChange?.();
        }
      });
      return cached;
    }
    const next = await fresh;
    gmSet(key, next);
    return next;
  }
  async function createI18n(options) {
    const { source, fallback, storageKey = "lang" } = options;
    const preferred = gmGet(storageKey, null) ?? detectLang();
    let file = {
      id: source.scriptId,
      default: "en-US",
      languages: [{ code: "en-US", name: "English (United States)" }]
    };
    try {
      file = await loadLocales(source, () => location.reload());
    } catch {
    }
    const known = file.languages.map((item) => item.code);
    const lang = known.includes(preferred) ? preferred : file.default;
    const entry = file.languages.find((item) => item.code === lang);
    const t = (key) => {
      if (lang === file.default) {
        return fallback[key] ?? key;
      }
      return entry?.messages?.[key] ?? fallback[key] ?? key;
    };
    const current = file.languages.find((item) => item.code === lang);
    gmMenuCommand(`Language: ${current?.name ?? lang} (${lang})`, () => {
      window.open(`${MANAGER_URL}/settings/language/`, "_blank");
    });
    return { lang, languages: file.languages, t };
  }
  function detectLang() {
    const page = (document.documentElement.lang || "en").toLowerCase();
    if (page.startsWith("zh")) {
      const traditional = page.includes("hant") || page.includes("tw") || page.includes("hk") || page.includes("mo");
      return traditional ? "zh-Hant-TW" : "zh-Hans-CN";
    }
    if (page === "en" || page.startsWith("en-")) {
      return "en-US";
    }
    return "en-US";
  }
  const REGISTRY_ELEMENT_ID = "userscript-registry";
  const PRESENCE_EVENT = "userscript:presence";
  const PRESENCE_GLOBAL = "__userscriptPresence";
  function all() {
    const root = globalThis;
    if (!root[PRESENCE_GLOBAL]) {
      root[PRESENCE_GLOBAL] = [];
    }
    return root[PRESENCE_GLOBAL];
  }
  function publishPresence(presence) {
    const merged = [];
    for (const item of [...readPresence(), ...all()]) {
      if (!merged.some((existing) => existing.id === item.id)) {
        merged.push(item);
      }
    }
    const idx = merged.findIndex((item) => item.id === presence.id);
    if (idx >= 0) {
      merged[idx] = presence;
    } else {
      merged.push(presence);
    }
    const root = globalThis;
    root[PRESENCE_GLOBAL] = merged;
    let el = document.getElementById(
      REGISTRY_ELEMENT_ID
    );
    if (!el) {
      el = document.createElement("script");
      el.type = "application/json";
      el.id = REGISTRY_ELEMENT_ID;
      document.head.append(el);
    }
    el.textContent = JSON.stringify(merged);
    window.dispatchEvent(new CustomEvent(PRESENCE_EVENT));
  }
  function readPresence() {
    const el = document.getElementById(REGISTRY_ELEMENT_ID);
    if (!el?.textContent) {
      return all();
    }
    try {
      return JSON.parse(el.textContent);
    } catch {
      return all();
    }
  }
  function isManagerPage(doc = document, loc = location) {
    if (loc.hostname === "og-open-source.github.io" && loc.pathname.startsWith("/UserScripts")) {
      return true;
    }
    return Boolean(
      doc.querySelector?.('meta[name="userscripts-manager"][content="1"]')
    );
  }
  const DARK_TOKENS = {
    bg: "oklch(17.00% 0.0140 264.00)",
    surface: "oklch(22.50% 0.0180 264.00)",
    surface2: "oklch(27.50% 0.0220 264.00)",
    surface3: "oklch(33.00% 0.0260 264.00)",
    fg: "oklch(95.00% 0.0060 264.00)",
    muted: "oklch(68.00% 0.0220 264.00)",
    accentBg: "oklch(58.00% 0.1800 255.83)",
    accentFg: "oklch(98.50% 0.0040 255.83)"
  };
  const LIGHT_TOKENS = {
    bg: "oklch(98.00% 0.0040 264.00)",
    surface: "oklch(94.50% 0.0070 264.00)",
    surface2: "oklch(90.50% 0.0100 264.00)",
    surface3: "oklch(86.00% 0.0140 264.00)",
    fg: "oklch(16.00% 0.0140 264.00)",
    muted: "oklch(46.00% 0.0240 264.00)",
    accentBg: "oklch(52.20% 0.1771 255.83)",
    accentFg: "oklch(98.00% 0.0060 255.83)"
  };
  const HEX_6_RE = /^#([a-f\d]{6})$/iu;
  const HEX_3_RE = /^#([a-f\d])([a-f\d])([a-f\d])$/iu;
  const RGB_FUNC_RE = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?%?))?\s*\)$/iu;
  function toHexByte(n) {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  }
  function cssColorToHex(raw) {
    if (!raw) {
      return null;
    }
    const s = raw.trim();
    if (HEX_6_RE.test(s)) {
      return s.toUpperCase();
    }
    const m3 = HEX_3_RE.exec(s);
    if (m3) {
      return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toUpperCase();
    }
    const mRgb = RGB_FUNC_RE.exec(s);
    if (mRgb) {
      const alphaRaw = mRgb[4];
      if (alphaRaw !== void 0) {
        const alpha = alphaRaw.endsWith("%") ? Number.parseFloat(alphaRaw) / 100 : Number.parseFloat(alphaRaw);
        if (alpha <= 0.05) {
          return null;
        }
      }
      const r = Number.parseFloat(mRgb[1] ?? "0");
      const g = Number.parseFloat(mRgb[2] ?? "0");
      const b = Number.parseFloat(mRgb[3] ?? "0");
      return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`.toUpperCase();
    }
    return null;
  }
  function probeHostColors(doc = document) {
    const view = doc.defaultView;
    const gcs = view && typeof view.getComputedStyle === "function" ? view.getComputedStyle.bind(view) : typeof getComputedStyle === "function" ? getComputedStyle : null;
    if (!gcs) {
      return null;
    }
    let bgHex = null;
    let fgHex = null;
    for (const el of [doc.body, doc.documentElement]) {
      if (!el) {
        continue;
      }
      const cs = gcs(el);
      if (!bgHex) {
        bgHex = cssColorToHex(cs.backgroundColor);
      }
      if (!fgHex) {
        fgHex = cssColorToHex(cs.color);
      }
      if (bgHex && fgHex) {
        break;
      }
    }
    if (!bgHex) {
      return null;
    }
    return { bg: bgHex, fg: fgHex ?? "#FFFFFF" };
  }
  function step(lch, dL, chromaScale) {
    const L = Math.max(0.04, Math.min(0.99, lch.L + dL));
    return formatOklch({ L, C: Math.min(0.03, lch.C * chromaScale), h: lch.h });
  }
  function resolveThemeTokens(mode, host) {
    if (mode === "system") {
      return null;
    }
    if (mode !== "host" || !host) {
      return mode === "light" ? LIGHT_TOKENS : DARK_TOKENS;
    }
    const bgHex = cssColorToHex(host.bg) ?? host.bg;
    const bg = hexToOklab(bgHex);
    if (!bg) {
      return DARK_TOKENS;
    }
    const lch = oklabToOklch(bg);
    const dark = bg.L < 0.55;
    return {
      bg: formatOklch(lch),
      surface: step(lch, dark ? 0.055 : -0.04, 0.65),
      surface2: step(lch, dark ? 0.105 : -0.08, 0.65),
      surface3: step(lch, dark ? 0.16 : -0.12, 0.65),
      fg: getAccessibleTextOklch(bg, 0.3),
      muted: formatOklch({
        L: Math.max(0.1, Math.min(0.9, dark ? bg.L + 0.45 : bg.L - 0.42)),
        C: Math.min(0.035, lch.C * 0.7),
        h: lch.h
      }),
      accentBg: dark ? DARK_TOKENS.accentBg : LIGHT_TOKENS.accentBg,
      accentFg: dark ? DARK_TOKENS.accentFg : LIGHT_TOKENS.accentFg
    };
  }
  function applyThemeModeToElement(el, mode, host) {
    el.setAttribute("data-theme-mode", mode);
    const tokens = resolveThemeTokens(mode, host);
    const vars = {
      bg: "--us-bg",
      surface: "--us-surface",
      surface2: "--us-surface-2",
      surface3: "--us-surface-3",
      fg: "--us-fg",
      muted: "--us-muted",
      accentBg: "--us-accent-bg",
      accentFg: "--us-accent-fg"
    };
    for (const [prop, cssVar] of Object.entries(vars)) {
      if (tokens) {
        el.style.setProperty(cssVar, tokens[prop]);
      } else {
        el.style.removeProperty(cssVar);
      }
    }
  }
  function scopeAttr(scopeSelector, attrSelector) {
    return scopeSelector === ":host" ? `:host(${attrSelector})` : `${scopeSelector}${attrSelector}`;
  }
  function tokenVarsBlock(tokens, colorScheme) {
    return `${colorScheme ? `  color-scheme: ${colorScheme};
` : ""}  --us-bg: ${tokens.bg};
  --us-surface: ${tokens.surface};
  --us-surface-2: ${tokens.surface2};
  --us-surface-3: ${tokens.surface3};
  --us-fg: ${tokens.fg};
  --us-muted: ${tokens.muted};
  --us-accent-bg: ${tokens.accentBg};
  --us-accent-fg: ${tokens.accentFg};
  --bg: var(--us-bg);
  --fg: var(--us-fg);
  --muted: var(--us-muted);
  --line: var(--us-surface-2);
  --surface: var(--us-surface);
  --accent: var(--us-accent-bg);`;
  }
  function getUiTokensCss(scopeSelector = ":host", hostTokens) {
    const lightTokens = resolveThemeTokens("light");
    const darkTokens = resolveThemeTokens("dark");
    const hostOverride = hostTokens ? `
${scopeAttr(scopeSelector, '[data-theme-mode="host"]')} {
${tokenVarsBlock(hostTokens)}
}` : "";
    return `
${scopeSelector} {
  color-scheme: light dark;
  /* NovaKit semantic palette (oklch) */
  --nk-purple: oklch(55.22% 0.2201 299.38);
  --nk-yellow: oklch(86.66% 0.1647 88.68);
  --nk-red: oklch(55.94% 0.1900 25.86);
  --nk-blue: oklch(52.20% 0.1771 255.83);
  --nk-gray: oklch(56.86% 0.0566 263.97);
  --nk-green: oklch(74.27% 0.2039 146.60);

  /* Borderless tonal surfaces (light default) */
${tokenVarsBlock(lightTokens)}
  --us-accent-hover: oklch(47.00% 0.1771 255.83);
  --us-focus: var(--nk-blue);

  /* NovaKit radius scale */
  --us-radius-lg: 12px;
  --us-radius-md: 8px;
  --us-radius-sm: 6px;

  --us-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --us-sans: 13px/1.48 system-ui, -apple-system, sans-serif;
  --us-shadow: 0 10px 30px oklch(15% 0.02 264 / 0.14), 0 2px 8px oklch(15% 0.02 264 / 0.07);
  --us-shadow-sm: 0 2px 8px oklch(15% 0.02 264 / 0.08);
  --us-ease: cubic-bezier(0.22, 1, 0.36, 1);

  --mono: var(--us-mono);
  font: var(--us-sans);
  color: var(--us-fg);
}

@media (prefers-color-scheme: dark) {
  ${scopeAttr(scopeSelector, ':not([data-theme-mode="light"])')} {
${tokenVarsBlock(darkTokens, "dark")}
    --us-accent-hover: oklch(63.00% 0.1800 255.83);
    --us-focus: oklch(68.00% 0.1750 255.83);
    --us-shadow: 0 14px 36px oklch(5% 0.01 264 / 0.55), 0 3px 10px oklch(5% 0.01 264 / 0.35);
    --us-shadow-sm: 0 2px 10px oklch(5% 0.01 264 / 0.40);
  }
}

${scopeAttr(scopeSelector, '[data-theme-mode="light"]')} {
${tokenVarsBlock(lightTokens, "light")}
  --us-accent-hover: oklch(47.00% 0.1771 255.83);
  --us-focus: var(--nk-blue);
  --us-shadow: 0 10px 30px oklch(15% 0.02 264 / 0.14), 0 2px 8px oklch(15% 0.02 264 / 0.07);
  --us-shadow-sm: 0 2px 8px oklch(15% 0.02 264 / 0.08);
}

${scopeAttr(scopeSelector, '[data-theme-mode="dark"]')} {
${tokenVarsBlock(darkTokens, "dark")}
  --us-accent-hover: oklch(63.00% 0.1800 255.83);
  --us-focus: oklch(68.00% 0.1750 255.83);
  --us-shadow: 0 14px 36px oklch(5% 0.01 264 / 0.55), 0 3px 10px oklch(5% 0.01 264 / 0.35);
  --us-shadow-sm: 0 2px 10px oklch(5% 0.01 264 / 0.40);
}
${hostOverride}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.us-panel {
  background: var(--us-bg);
  color: var(--us-fg);
  border-radius: var(--us-radius-lg);
  box-shadow: var(--us-shadow);
  font: var(--us-sans);
  overflow: hidden;
  contain: layout style paint;
  isolation: isolate;
}

.us-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: var(--us-surface);
  cursor: grab;
  user-select: none;
  touch-action: none;
  transition: background-color 180ms var(--us-ease);
}

.us-panel-head.dragging {
  cursor: grabbing;
  background: var(--us-surface-2);
}

.us-panel-title {
  font-weight: 600;
  font-size: 12px;
}

.us-panel-sec {
  padding: 8px 12px;
}

.us-panel-sec + .us-panel-sec {
  margin-top: 2px;
}

.us-muted {
  color: var(--us-muted);
}

.us-mono {
  font-family: var(--us-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}

.us-btn,
button.us-btn {
  position: relative;
  overflow: hidden;
  font: inherit;
  font-size: 12px;
  line-height: 1.25;
  padding: 6px 11px;
  background: var(--us-surface-2);
  color: var(--us-fg);
  border: none;
  border-radius: var(--us-radius-md);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition:
    background-color 200ms var(--us-ease),
    color 200ms var(--us-ease),
    box-shadow 220ms var(--us-ease);
}

.us-btn:hover:not(:disabled),
button.us-btn:hover:not(:disabled) {
  background: var(--us-surface-3);
  box-shadow: var(--us-shadow-sm);
}

/* Tactile color + glow pulse on press — zero scale deformation */
.us-btn:active:not(:disabled),
button.us-btn:active:not(:disabled) {
  background: var(--us-accent-bg);
  color: var(--us-accent-fg);
  box-shadow: 0 0 0 3px oklch(from var(--us-accent-bg) l c h / 0.28);
}

.us-btn.flash-done,
button.us-btn.flash-done {
  animation: us-pulse-ring 420ms var(--us-ease);
}

@keyframes us-pulse-ring {
  0% {
    box-shadow: 0 0 0 0 oklch(from var(--nk-green) l c h / 0.55);
    background: var(--nk-green);
    color: oklch(15% 0.02 146.60);
  }
  100% {
    box-shadow: 0 0 0 8px oklch(from var(--nk-green) l c h / 0);
  }
}

.us-btn:focus-visible,
button.us-btn:focus-visible,
.us-input:focus-visible {
  outline: 2px solid var(--us-focus);
  outline-offset: 2px;
}

.us-btn-sm,
button.us-btn-sm {
  padding: 4px 9px;
  font-size: 11.5px;
  border-radius: var(--us-radius-sm);
}

.us-btn-primary,
button.us-btn-primary,
.us-btn[aria-pressed="true"],
button.us-btn[aria-pressed="true"] {
  background: var(--us-accent-bg);
  color: var(--us-accent-fg);
  font-weight: 600;
}

.us-btn-primary:hover:not(:disabled),
button.us-btn-primary:hover:not(:disabled),
.us-btn[aria-pressed="true"]:hover:not(:disabled) {
  background: var(--us-accent-hover);
}

.us-btn-group {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--us-radius-md);
  background: var(--us-surface);
}

.us-btn-group > .us-btn,
.us-btn-group > button.us-btn {
  border-radius: var(--us-radius-sm);
}

.us-input,
input.us-input {
  width: 100%;
  font: inherit;
  font-size: 12px;
  padding: 6px 9px;
  background: var(--us-surface);
  color: var(--us-fg);
  border: none;
  border-radius: var(--us-radius-sm);
  transition:
    background-color 180ms var(--us-ease),
    box-shadow 200ms var(--us-ease);
}

.us-input:focus,
input.us-input:focus {
  background: var(--us-surface-2);
  box-shadow: 0 0 0 2px oklch(from var(--us-focus) l c h / 0.35);
  outline: none;
}

.us-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  background: var(--us-surface-2);
  color: var(--us-fg);
  font-size: 11px;
  line-height: 1.3;
  border-radius: var(--us-radius-sm);
  font-variant-numeric: tabular-nums;
}

.us-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  display: inline-block;
}

.us-dot.static { background: var(--nk-blue); }
.us-dot.dyn { background: var(--nk-purple); }
.us-dot.plus { background: var(--nk-green); }
.us-dot.manual { background: var(--nk-yellow); }
.us-dot.err { background: var(--nk-red); }

.us-chevron {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--us-muted);
  transition: transform 240ms var(--us-ease), color 180ms var(--us-ease);
}

[aria-expanded="true"] .us-chevron {
  transform: rotate(180deg);
  color: var(--us-fg);
}

.us-checkbox,
input.us-checkbox {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
  width: 16px;
  height: 16px;
  flex: none;
  border: none;
  border-radius: var(--us-radius-sm);
  background: var(--us-surface-2);
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  transition: background-color 200ms var(--us-ease), box-shadow 200ms var(--us-ease);
}

.us-checkbox:hover,
input.us-checkbox:hover {
  background: var(--us-surface-3);
}

.us-checkbox:active,
input.us-checkbox:active {
  box-shadow: 0 0 0 3px oklch(from var(--us-accent-bg) l c h / 0.28);
}

.us-checkbox::after,
input.us-checkbox::after {
  content: "";
  width: 8px;
  height: 4.5px;
  border-left: 1.8px solid var(--us-accent-fg);
  border-bottom: 1.8px solid var(--us-accent-fg);
  transform: translateY(-1px) rotate(-45deg);
  opacity: 0;
  transition: opacity 180ms var(--us-ease);
}

.us-checkbox:checked,
input.us-checkbox:checked {
  background: var(--us-accent-bg);
}

.us-checkbox:checked::after,
input.us-checkbox:checked::after {
  opacity: 1;
}

.us-collapse {
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
  transition: grid-template-rows 260ms var(--us-ease), opacity 200ms var(--us-ease);
}

.us-collapse[data-collapsed="true"] {
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
}

.us-collapse-inner {
  overflow: hidden;
  min-height: 0;
}
`.trim();
  }
  var _GM_addStyle = /* @__PURE__ */ (() => typeof GM_addStyle != "undefined" ? GM_addStyle : void 0)();
  var _GM_getValue = /* @__PURE__ */ (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
  var _GM_registerMenuCommand = /* @__PURE__ */ (() => typeof GM_registerMenuCommand != "undefined" ? GM_registerMenuCommand : void 0)();
  var _GM_setValue = /* @__PURE__ */ (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
  var _GM_unregisterMenuCommand = /* @__PURE__ */ (() => typeof GM_unregisterMenuCommand != "undefined" ? GM_unregisterMenuCommand : void 0)();
  var _GM_xmlhttpRequest = /* @__PURE__ */ (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
  var _unsafeWindow = /* @__PURE__ */ (() => typeof unsafeWindow != "undefined" ? unsafeWindow : void 0)();
  const VALID_MODIFIERS = /* @__PURE__ */ new Set([
    "block",
    "inline-atomic",
    "no-spacing",
    "no-opencc",
    "keep-orig"
  ]);
  function parseSiteDelta(source) {
    const addSelectors = [];
    const removeSelectors = [];
    const modRules = [];
    for (const rawLine of source.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const op = line[0];
      const rest = line.slice(1).trim();
      if (!rest) {
        continue;
      }
      if (op === "+") {
        addSelectors.push(rest);
      } else if (op === "-") {
        removeSelectors.push(rest);
      } else if (op === "*") {
        const sepIdx = rest.lastIndexOf(":");
        if (sepIdx === -1) {
          continue;
        }
        const selector = rest.slice(0, sepIdx).trim();
        const rawMods = rest.slice(sepIdx + 1);
        if (!selector) {
          continue;
        }
        const modifiers = rawMods.split(",").map((m) => m.trim()).filter((m) => VALID_MODIFIERS.has(m));
        if (modifiers.length > 0) {
          modRules.push({ selector, modifiers });
        }
      }
    }
    return { addSelectors, removeSelectors, modRules };
  }
  function hostMatchesPattern(hostname, pattern) {
    const host = hostname.toLowerCase();
    const pat = pattern.trim().toLowerCase();
    if (!pat) {
      return false;
    }
    if (pat === "*") {
      return true;
    }
    if (pat.startsWith("*.")) {
      const base = pat.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }
    return host === pat;
  }
  function patternSpecificity(pattern) {
    const pat = pattern.trim();
    if (pat === "*") {
      return 0;
    }
    if (pat.startsWith("*.")) {
      return 1;
    }
    return 2;
  }
  const BUILTIN_SITE_DEFAULTS = {};
  function resolveSiteDeltaForHost(hostname, siteDeltas, builtInDefaults = BUILTIN_SITE_DEFAULTS) {
    const entries = [
      ...Object.entries(builtInDefaults),
      ...Object.entries(siteDeltas)
    ];
    const matched = entries.filter(([pattern]) => hostMatchesPattern(hostname, pattern)).sort(([a], [b]) => patternSpecificity(a) - patternSpecificity(b));
    const addSelectors = [];
    const removeSelectors = [];
    const modRules = [];
    for (const [, source] of matched) {
      const parsed = parseSiteDelta(source);
      addSelectors.push(...parsed.addSelectors);
      removeSelectors.push(...parsed.removeSelectors);
      modRules.push(...parsed.modRules);
    }
    return { addSelectors, removeSelectors, modRules };
  }
  function safeMatches(el, selector) {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  }
  function matchesAny(el, selectors) {
    for (const sel of selectors) {
      if (safeMatches(el, sel)) {
        return true;
      }
    }
    return false;
  }
  function matchModifiers(el, delta) {
    const out = /* @__PURE__ */ new Set();
    for (const rule of delta.modRules) {
      if (safeMatches(el, rule.selector)) {
        for (const mod of rule.modifiers) {
          out.add(mod);
        }
      }
    }
    return out;
  }
  const NON_PROSE_TAGS = /* @__PURE__ */ new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION",
    "SVG",
    "MATH",
    "CANVAS",
    "AUDIO",
    "VIDEO",
    "IFRAME",
    "OBJECT",
    "EMBED"
  ]);
  function defaultGetStyle(el) {
    const view = el.ownerDocument?.defaultView;
    const gcs = view && typeof view.getComputedStyle === "function" ? view.getComputedStyle.bind(view) : typeof getComputedStyle === "function" ? getComputedStyle : null;
    if (!gcs) {
      return { display: "block", visibility: "visible" };
    }
    const cs = gcs(el);
    return { display: cs.display, visibility: cs.visibility };
  }
  function isNonProsePrimitive(el) {
    if (NON_PROSE_TAGS.has(el.tagName.toUpperCase())) {
      return true;
    }
    if (el.isContentEditable) {
      return true;
    }
    if (el.getAttribute("contenteditable") === "true") {
      return true;
    }
    return false;
  }
  function createRoleClassifier(getStyle = defaultGetStyle) {
    const cache = /* @__PURE__ */ new WeakMap();
    function getRole(el) {
      const cached = cache.get(el);
      if (cached) {
        return cached;
      }
      const { display, visibility } = getStyle(el);
      let role;
      if (display === "none" || visibility === "hidden" || visibility === "collapse") {
        role = "hidden";
      } else if (display === "inline" || display === "inline-block" || display === "inline-flex" || display === "inline-grid" || display === "contents" || display === "ruby" || display === "ruby-text" || display === "ruby-base") {
        role = "inline";
      } else {
        role = "block";
      }
      cache.set(el, role);
      return role;
    }
    return { getRole, isNonProsePrimitive };
  }
  const HAS_TRANSLATABLE_LETTER = new RegExp("\\p{L}", "u");
  const URL_ONLY = /^https?:\/\/\S+$/iu;
  let nextSegmentSeq = 1;
  function isTranslatorManaged(el) {
    return el.id === "ptr-user-css" || el.id === "ptr-inspect-hud" || el.hasAttribute("data-tr-block") || el.hasAttribute("data-tr-orig") || el.hasAttribute("data-tr-dst") || isForeignUi(el);
  }
  function getLogicalParent(node) {
    if (node.parentElement) {
      return node.parentElement;
    }
    const pn = node.parentNode;
    if (pn && "host" in pn && pn.host) {
      return pn.host;
    }
    return null;
  }
  function collectTranslatableText(node, delta) {
    if (node.nodeType === 3) {
      return node.nodeValue ?? "";
    }
    if (node.nodeType !== 1) {
      return "";
    }
    const el = node;
    if (isNonProsePrimitive(el) || matchesAny(el, delta.removeSelectors)) {
      return "";
    }
    if (matchModifiers(el, delta).has("inline-atomic")) {
      return "";
    }
    let out = "";
    for (const child of Array.from(el.childNodes)) {
      out += collectTranslatableText(child, delta);
    }
    return out;
  }
  function hasMeaningfulText(nodes, forced, delta) {
    const raw = nodes.map(
      (n) => forced ? n.textContent ?? "" : collectTranslatableText(n, delta)
    ).join("").trim();
    if (!raw) {
      return false;
    }
    if (forced) {
      return true;
    }
    if (URL_ONLY.test(raw)) {
      return false;
    }
    return HAS_TRANSLATABLE_LETTER.test(raw);
  }
  function collectSegments(root, delta, options) {
    const classifier = createRoleClassifier(options?.getStyle);
    const splitTriggerCache = /* @__PURE__ */ new WeakMap();
    const excludedCounted = /* @__PURE__ */ new WeakSet();
    const segments = [];
    function isExcludedSubtree(el) {
      const managed = isTranslatorManaged(el);
      const excluded = managed || classifier.getRole(el) === "hidden" || matchesAny(el, delta.removeSelectors) || classifier.isNonProsePrimitive(el) && classifier.getRole(el) !== "inline";
      if (excluded && !managed && !excludedCounted.has(el)) {
        excludedCounted.add(el);
        options?.onExcluded?.();
      }
      return excluded;
    }
    const rootAncestorMods = /* @__PURE__ */ new Set();
    let ancestor = getLogicalParent(root);
    while (ancestor) {
      if (isExcludedSubtree(ancestor) || classifier.isNonProsePrimitive(ancestor)) {
        return segments;
      }
      for (const m of matchModifiers(ancestor, delta)) {
        rootAncestorMods.add(m);
      }
      ancestor = getLogicalParent(ancestor);
    }
    function containsSplitTrigger(el) {
      const cached = splitTriggerCache.get(el);
      if (cached !== void 0) {
        return cached;
      }
      let trigger = Boolean(el.shadowRoot);
      if (!trigger) {
        for (const child of Array.from(el.children)) {
          if (isExcludedSubtree(child) || classifier.getRole(child) === "block" || matchesAny(child, delta.addSelectors) || matchModifiers(child, delta).has("block") || !classifier.isNonProsePrimitive(child) && containsSplitTrigger(child)) {
            trigger = true;
            break;
          }
        }
      }
      splitTriggerCache.set(el, trigger);
      return trigger;
    }
    function flushRun(container, run, sourceRule, inheritedMods) {
      let start = 0;
      let end = run.length;
      while (start < end && run[start]?.nodeType === 3 && !(run[start]?.nodeValue ?? "").trim()) {
        start++;
      }
      while (end > start && run[end - 1]?.nodeType === 3 && !(run[end - 1]?.nodeValue ?? "").trim()) {
        end--;
      }
      const trimmed = run.slice(start, end);
      if (trimmed.length === 0) {
        return;
      }
      if (!hasMeaningfulText(trimmed, sourceRule === "+", delta)) {
        return;
      }
      const displayVal = options?.getStyle ? options.getStyle(container).display : typeof getComputedStyle === "function" ? getComputedStyle(container).display : "";
      segments.push({
        id: `seg-${nextSegmentSeq++}`,
        container,
        nodes: trimmed,
        sourceRule,
        modifiers: new Set(inheritedMods),
        displayContents: displayVal === "contents"
      });
    }
    function walkChildList(hostContainer, childNodes, forcedRule, inheritedMods) {
      let run = [];
      for (const child of Array.from(childNodes)) {
        if (child.nodeType === 3) {
          run.push(child);
          continue;
        }
        if (child.nodeType !== 1) {
          continue;
        }
        const el = child;
        if (isExcludedSubtree(el)) {
          flushRun(hostContainer, run, forcedRule, inheritedMods);
          run = [];
          continue;
        }
        if (classifier.isNonProsePrimitive(el)) {
          run.push(el);
          continue;
        }
        const isPlus = matchesAny(el, delta.addSelectors);
        const mods = matchModifiers(el, delta);
        const isBlockBoundary = Boolean(el.shadowRoot) || isPlus || mods.has("block") || classifier.getRole(el) === "block" || containsSplitTrigger(el);
        if (isBlockBoundary) {
          flushRun(hostContainer, run, forcedRule, inheritedMods);
          run = [];
          walkBlock(el, isPlus ? "+" : forcedRule, inheritedMods, mods);
        } else {
          run.push(el);
        }
      }
      flushRun(hostContainer, run, forcedRule, inheritedMods);
    }
    function walkBlock(container, forcedRule = "auto", parentMods = rootAncestorMods, precomputedMods) {
      if (isExcludedSubtree(container)) {
        return;
      }
      if (classifier.isNonProsePrimitive(container)) {
        return;
      }
      const localMods = precomputedMods ?? matchModifiers(container, delta);
      const mergedMods = localMods.size === 0 ? parentMods : /* @__PURE__ */ new Set([...parentMods, ...localMods]);
      if (container.shadowRoot) {
        options?.shadowRoots?.add(container.shadowRoot);
        walkChildList(
          container,
          container.shadowRoot.childNodes,
          forcedRule,
          mergedMods
        );
      }
      walkChildList(container, container.childNodes, forcedRule, mergedMods);
    }
    walkBlock(
      root,
      matchesAny(root, delta.addSelectors) ? "+" : "auto",
      rootAncestorMods
    );
    return segments;
  }
  function createPtrMetrics() {
    return {
      deltaCounts: { add: 0, remove: 0, mod: 0 },
      excludedCount: 0,
      shadowRootCount: 0,
      dictLoaded: false,
      dictCounts: { static: 0, dynamic: 0, scoped: 0 },
      segments: {
        total: 0,
        autoStatic: 0,
        autoDynamic: 0,
        plus: 0,
        manual: 0,
        scopedHits: 0
      },
      routing: { api: 0, opencc: 0, skip: 0 },
      languageDetectorStatus: "unavailable",
      keywordsSample: [],
      initialScanMs: null,
      lastScanMs: 0,
      nodesVisited: 0,
      mutationBatches: 0,
      totalMutationMs: 0,
      viewportPending: 0,
      viewportTriggered: 0,
      cacheHits: 0,
      cacheMisses: 0,
      apiUniquePayloads: 0,
      apiTotalJobs: 0,
      openccInitMs: null,
      apiBatches: 0,
      lastApiBatchMs: 0,
      totalApiBatchMs: 0
    };
  }
  function recordScanTiming(m, ms, nodes) {
    if (m.initialScanMs === null) {
      m.initialScanMs = ms;
    }
    m.lastScanMs = ms;
    m.nodesVisited += nodes;
  }
  function recordMutationBatch(m, ms) {
    m.mutationBatches += 1;
    m.totalMutationMs += ms;
  }
  function recordApiBatch(m, ms) {
    m.apiBatches += 1;
    m.lastApiBatchMs = ms;
    m.totalApiBatchMs += ms;
  }
  function getMetricsSnapshot(m) {
    const totalCache = m.cacheHits + m.cacheMisses;
    return {
      ...m,
      deltaCounts: { ...m.deltaCounts },
      dictCounts: { ...m.dictCounts },
      segments: { ...m.segments },
      routing: { ...m.routing },
      keywordsSample: [...m.keywordsSample],
      avgMutationMs: m.mutationBatches > 0 ? m.totalMutationMs / m.mutationBatches : 0,
      avgApiBatchMs: m.apiBatches > 0 ? m.totalApiBatchMs / m.apiBatches : 0,
      cacheHitRatePct: totalCache > 0 ? Math.round(m.cacheHits / totalCache * 1e3) / 10 : 0
    };
  }
  const OBSERVE_CONFIG$1 = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "style",
      "class",
      "hidden",
      "open",
      "aria-hidden",
      "aria-expanded"
    ]
  };
  function nowMs$1() {
    return typeof performance === "undefined" ? Date.now() : performance.now();
  }
  function isTranslatorNode(node) {
    if (node.nodeType !== 1) {
      return false;
    }
    const el = node;
    return el.id === "ptr-user-css" || el.id === "ptr-inspect-hud" || el.hasAttribute("data-tr-block") || el.hasAttribute("data-tr-orig") || el.hasAttribute("data-tr-dst") || el.closest?.("[data-tr-block]") !== null || isForeignUi(el);
  }
  function createViewportObserver(options) {
    const metrics = options.metrics;
    const seenContainers = /* @__PURE__ */ new WeakSet();
    const observedRoots = /* @__PURE__ */ new WeakSet();
    const pendingByContainer = /* @__PURE__ */ new Map();
    let stopped = false;
    let flushTimer = null;
    const pendingMutationRoots = /* @__PURE__ */ new Set();
    const intersectionObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(
      (entries) => {
        if (stopped) {
          return;
        }
        const ready = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const segs = pendingByContainer.get(entry.target);
          if (segs) {
            ready.push(...segs);
            pendingByContainer.delete(entry.target);
          }
          intersectionObserver?.unobserve(entry.target);
        }
        if (ready.length > 0) {
          if (metrics) {
            metrics.viewportTriggered += ready.length;
            metrics.viewportPending = pendingByContainer.size;
          }
          options.onVisibleSegments(ready);
        }
      },
      { rootMargin: options.rootMargin ?? "300px 0px" }
    );
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver((records) => {
      if (stopped) {
        return;
      }
      for (const rec of records) {
        if (isTranslatorNode(rec.target)) {
          continue;
        }
        if (rec.type === "attributes" && rec.target.nodeType === 1) {
          pendingMutationRoots.add(rec.target);
          continue;
        }
        if (rec.type === "childList") {
          for (const added of Array.from(rec.addedNodes)) {
            if (added.nodeType === 1 && !isTranslatorNode(added)) {
              pendingMutationRoots.add(added);
            } else if (added.nodeType === 3 && rec.target.nodeType === 1) {
              pendingMutationRoots.add(rec.target);
            }
          }
        }
      }
      if (pendingMutationRoots.size > 0 && flushTimer === null) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          const roots = Array.from(pendingMutationRoots);
          pendingMutationRoots.clear();
          const rootSet = new Set(roots);
          const scanStartedAt = nowMs$1();
          for (const r of roots) {
            if (!r.isConnected) {
              continue;
            }
            let hasQueuedAncestor = false;
            let p = r.parentElement;
            while (p) {
              if (rootSet.has(p)) {
                hasQueuedAncestor = true;
                break;
              }
              p = p.parentElement;
            }
            if (!hasQueuedAncestor) {
              scan(r);
            }
          }
          if (metrics) {
            recordMutationBatch(metrics, nowMs$1() - scanStartedAt);
          }
        }, 120);
      }
    });
    function ensureObserved(node) {
      if (!mutationObserver || observedRoots.has(node)) {
        return;
      }
      observedRoots.add(node);
      mutationObserver.observe(node, OBSERVE_CONFIG$1);
    }
    function scan(target = options.root) {
      if (stopped || isTranslatorNode(target)) {
        return;
      }
      const shadowRoots = /* @__PURE__ */ new Set();
      const scanStartedAt = nowMs$1();
      const segs = collectSegments(target, options.delta, {
        shadowRoots,
        onExcluded: () => {
          if (metrics) {
            metrics.excludedCount += 1;
          }
        }
      });
      if (metrics) {
        recordScanTiming(
          metrics,
          nowMs$1() - scanStartedAt,
          segs.reduce((n, s) => n + s.nodes.length, 0)
        );
      }
      if (shadowRoots.size > 0) {
        if (metrics) {
          metrics.shadowRootCount += shadowRoots.size;
        }
        for (const sr of shadowRoots) {
          ensureObserved(sr);
        }
        options.onShadowRoots?.(shadowRoots);
      }
      if (segs.length === 0) {
        if (metrics) {
          metrics.viewportPending = pendingByContainer.size;
        }
        return;
      }
      const immediate = [];
      for (const seg of segs) {
        if (seenContainers.has(seg.container) && seg.nodes.every(
          (n) => n.parentNode && n.parentNode.closest?.("[data-tr-block]") !== null
        )) {
          continue;
        }
        seenContainers.add(seg.container);
        const isContents = seg.displayContents ?? (typeof getComputedStyle === "function" && getComputedStyle(seg.container).display === "contents");
        if (intersectionObserver && !isContents) {
          const list = pendingByContainer.get(seg.container);
          if (list) {
            list.push(seg);
          } else {
            pendingByContainer.set(seg.container, [seg]);
            intersectionObserver.observe(seg.container);
          }
        } else {
          immediate.push(seg);
        }
      }
      if (metrics) {
        metrics.viewportPending = pendingByContainer.size;
      }
      if (immediate.length > 0) {
        options.onVisibleSegments(immediate);
      }
    }
    ensureObserved(options.root);
    return {
      scan,
      stop() {
        stopped = true;
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        pendingMutationRoots.clear();
        pendingByContainer.clear();
        intersectionObserver?.disconnect();
        mutationObserver?.disconnect();
      }
    };
  }
  const CONFIG_KEY = "ptr:config";
  const DEFAULT_CONFIG = {
    targetLang: "zh-TW",
    provider: "translate-pa",
    translatePaApiKey: "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520",
    customCss: "",
    customFont: "",
    autoSpacing: true,
    spacingMode: "both",
    punctNorm: "zh-norm",
    openccMode: "off",
    spaceSkippedCjk: false,
    themeMode: "system",
    siteDeltas: {},
    autoTranslate: false,
    debugInspect: false,
    debugSpacingMarks: false,
    volunteerMode: false,
    volunteerBlockClicks: false
  };
  function resolveSpacingMode(cfg) {
    if (cfg.spacingMode) {
      return cfg.spacingMode;
    }
    return cfg.autoSpacing ? "both" : "off";
  }
  function loadConfig() {
    const stored = gmGet(CONFIG_KEY, null);
    if (!stored || typeof stored !== "object") {
      return {
        ...DEFAULT_CONFIG,
        siteDeltas: { ...DEFAULT_CONFIG.siteDeltas }
      };
    }
    const spacingMode = stored.spacingMode ?? (stored.autoSpacing === false ? "off" : DEFAULT_CONFIG.spacingMode);
    return {
      ...DEFAULT_CONFIG,
      ...stored,
      spacingMode,
      autoSpacing: spacingMode !== "off",
      siteDeltas: {
        ...DEFAULT_CONFIG.siteDeltas,
        ...stored.siteDeltas && typeof stored.siteDeltas === "object" ? stored.siteDeltas : {}
      }
    };
  }
  function saveConfig(patch) {
    const current = loadConfig();
    const nextSpacingMode = patch.spacingMode ?? (patch.autoSpacing === void 0 ? current.spacingMode : patch.autoSpacing ? "both" : "off");
    const next = {
      ...current,
      ...patch,
      spacingMode: nextSpacingMode,
      autoSpacing: nextSpacingMode !== "off",
      ...patch.siteDeltas ? { siteDeltas: { ...patch.siteDeltas } } : {}
    };
    gmSet(CONFIG_KEY, next);
    return next;
  }
  const EMPTY_REMOTE_DELTAS = {
    version: 0,
    glossary: [],
    sites: {}
  };
  const CACHE_KEY = "ptr:remote-deltas";
  async function loadRemoteDeltas(url, onChange) {
    const cached = gmGet(CACHE_KEY, null);
    const fresh = gmFetch(url, 1e4).then(
      (body) => JSON.parse(body)
    );
    if (cached && typeof cached === "object" && cached.sites) {
      void fresh.then((next) => {
        if (JSON.stringify(cached) !== JSON.stringify(next)) {
          gmSet(CACHE_KEY, next);
          onChange?.(next);
        }
      }).catch(() => {
      });
      return cached;
    }
    try {
      const next = await fresh;
      gmSet(CACHE_KEY, next);
      return next;
    } catch {
      return EMPTY_REMOTE_DELTAS;
    }
  }
  const MESSAGES_EN = {
    translatePage: "Translate Page",
    restorePage: "Restore Original",
    inspectMode: "Capture Preview: {state}",
    volunteerMode: "Volunteer Mode: {state}",
    volunteerBlockClicks: "Volunteer Click Lock: {state}",
    openSettings: "Open Settings",
    on: "ON",
    off: "OFF",
    translating: "Translating...",
    translated: "Translated",
    error: "Translation failed",
    // Capture Preview HUD
    hudTitle: "Capture Preview",
    hudSpaceChip: "space: {mode}",
    hudAutospaceNative: "autospace: native",
    hudAutospaceUnsupported: "autospace: off/unsupported",
    segStatic: "static",
    segDynamic: "auto-dynamic",
    segPlus: "+",
    segManual: "manual",
    hoverHint: "Hover any outlined block to inspect capture metadata.",
    kvScope: "Scope",
    kvTemplate: "Template",
    kvValues: "Values",
    kvSpacing: "Spacing",
    secCapture: "1. Page Capture & Routing",
    secPerf: "2. Timing & Cache",
    mSegments: "Segments",
    mScopedHits: "Scoped Hits",
    mRouteApi: "API Route",
    mRouteOpencc: "OpenCC",
    mRouteSkip: "Skipped",
    mDict: "Dict",
    mLangDetector: "LangDetector",
    mKeywords: "Keywords",
    ldAvailable: "available",
    ldUnavailable: "unavailable",
    mInitialScan: "Initial Scan",
    mLastScan: "Last Scan",
    mNodes: "Nodes",
    mCacheHit: "Cache Hit",
    mCacheMiss: "Cache Miss",
    mCacheRate: "Cache Hit Rate",
    mApiBatches: "API Batches",
    mApiAvg: "Avg API",
    mMutations: "Mutation Batches",
    mExcluded: "Excluded",
    mShadowRoots: "Shadow Roots",
    btnDetails: "Details",
    btnExportAi: "Export for AI",
    btnCopyDiag: "Copy JSON",
    hudExportedAi: "Copied AI prompt + {count} segments to clipboard.",
    hudExportDenied: "Clipboard denied — downloaded AI prompt instead.",
    // Volunteer Workbench
    volTitle: "Volunteer · {host}",
    volLockOn: "Lock: ON",
    volLockOff: "Lock: OFF",
    volLockOnMsg: "Click lock ON — page navigation disabled.",
    volLockOffMsg: "Click lock OFF — normal clicks restored.",
    volRescan: "Rescan",
    volStatStatic: "Static",
    volStatDynamic: "Dynamic",
    volStatHits: "Manual Hits",
    volBadgeStatic: "STATIC",
    volBadgeDynamic: "DYNAMIC",
    volScope: "Scope",
    volTrans: "Trans",
    volSuggest: "Suggest",
    volPrev: "Prev",
    volNext: "Next",
    volSave: "Save & Preview",
    volCopyJson: "Copy JSON",
    volDownload: "{host}.json",
    volExportAi: "Export AI",
    volImportAi: "Import AI",
    volImportPlaceholder: "Paste AI JSON ({ translations } or SiteTranslationsFile)…",
    volImportApply: "Apply Import",
    volImportCancel: "Cancel",
    volImported: "Imported {count} draft translation(s).",
    volImportError: "Invalid AI JSON payload.",
    volSaved: "Saved draft. Preview: {preview}",
    volSavedScoped: "Saved draft (scoped to {scope}). Preview: {preview}",
    volCopied: "Copied JSON to clipboard.",
    volCopyDenied: "Clipboard denied — use Download instead.",
    volEmpty: "No translatable segments captured yet.",
    volValues: "values",
    volScopePlaceholder: "Scope CSS selector (optional)",
    volTransPlaceholder: "Enter translation ({lang})…",
    volDraftReady: "Draft ready"
  };
  function formatPtrMsg(template, vars) {
    if (!vars) {
      return template;
    }
    return template.replace(
      /\{(?<key>[A-Za-z0-9_]+)\}/gu,
      (m, k) => k in vars ? String(vars[k]) : m
    );
  }
  const HAS_LETTER = new RegExp("\\p{L}", "u");
  function escapeHtml(text) {
    return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  }
  function encodeInlineNodes(nodes, delta) {
    const slots = [];
    function serializeNode(node) {
      if (node.nodeType === 3) {
        return escapeHtml(node.nodeValue ?? "");
      }
      if (node.nodeType !== 1) {
        return "";
      }
      const el = node;
      if (matchesAny(el, delta.removeSelectors)) {
        return "";
      }
      const modifiers = matchModifiers(el, delta);
      const atomic = modifiers.has("inline-atomic") || isNonProsePrimitive(el) || !HAS_LETTER.test(el.textContent ?? "");
      const id = slots.length;
      const slot = { id, element: el, atomic, modifiers };
      slots.push(slot);
      if (atomic) {
        return `<x id="${id}"/>`;
      }
      let inner = "";
      for (const child of Array.from(el.childNodes)) {
        inner += serializeNode(child);
      }
      return `<x id="${id}">${inner}</x>`;
    }
    let payloadHtml = "";
    for (const n of nodes) {
      payloadHtml += serializeNode(n);
    }
    return { payloadHtml, slots };
  }
  function decodeTranslatedHtml(translatedHtml, slots, doc) {
    const tpl = doc.createElement("template");
    tpl.innerHTML = translatedHtml.replace(/<x(\b[^>]*)?\/>/giu, "<x$1></x>");
    const slotMap = /* @__PURE__ */ new Map();
    for (const s of slots) {
      slotMap.set(s.id, s);
    }
    function rebuild(sourceParent) {
      const out = doc.createDocumentFragment();
      for (const child of Array.from(sourceParent.childNodes)) {
        if (child.nodeType === 3) {
          out.appendChild(doc.createTextNode(child.nodeValue ?? ""));
          continue;
        }
        if (child.nodeType !== 1) {
          continue;
        }
        const el = child;
        if (el.tagName.toUpperCase() === "SPAN" && el.hasAttribute("data-ptr-kw")) {
          out.appendChild(rebuild(el));
          continue;
        }
        if (el.tagName.toUpperCase() === "X") {
          const rawId = el.getAttribute("id");
          const id = rawId === null ? Number.NaN : Number(rawId);
          const slot = slotMap.get(id);
          if (!slot) {
            out.appendChild(rebuild(el));
            continue;
          }
          if (slot.atomic) {
            const clone = slot.element.cloneNode(true);
            clone.setAttribute("data-tr-no-space", "1");
            clone.setAttribute("data-tr-no-opencc", "1");
            out.appendChild(clone);
          } else {
            const clone = slot.element.cloneNode(false);
            if (slot.modifiers.has("no-spacing")) {
              clone.setAttribute("data-tr-no-space", "1");
            }
            if (slot.modifiers.has("no-opencc")) {
              clone.setAttribute("data-tr-no-opencc", "1");
            }
            clone.appendChild(rebuild(el));
            out.appendChild(clone);
          }
        } else {
          out.appendChild(doc.createTextNode(el.textContent ?? ""));
        }
      }
      return out;
    }
    return rebuild(tpl.content);
  }
  const TOKENIZER_RE = new RegExp('(<x\\s+id="\\d+"\\s*\\/>)|(<[^>]+>)|(@[A-Za-z0-9_-]+)|((?<![A-Za-z0-9.])(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)(?![A-Za-z0-9.]))', "gu");
  function extractTemplate(payloadHtml) {
    const values = [];
    const template = payloadHtml.replace(
      TOKENIZER_RE,
      (full, atomicSlot, otherTag, handle, num) => {
        if (otherTag) {
          return otherTag;
        }
        const val = atomicSlot ?? handle ?? num;
        if (!val) {
          return full;
        }
        const idx = values.length;
        values.push(val);
        return `{v${idx}}`;
      }
    );
    return { kind: values.length > 0 ? "dynamic" : "static", template, values };
  }
  function interpolateTemplate(template, values) {
    return template.replace(/\{v(\d+)\}/gu, (m, rawIdx) => {
      const idx = Number(rawIdx);
      return idx >= 0 && idx < values.length ? values[idx] : m;
    });
  }
  function matchScopeEntry(payloadHtml, trimmed, scope, getExtracted) {
    if (!scope) {
      return null;
    }
    const staticHit = scope.static?.[payloadHtml] ?? scope.static?.[trimmed];
    if (typeof staticHit === "string") {
      return { kind: "static", html: staticHit };
    }
    const extracted = getExtracted();
    if (extracted.values.length > 0) {
      const dynHit = scope.dynamic?.[extracted.template];
      if (typeof dynHit === "string") {
        return {
          kind: "dynamic",
          html: interpolateTemplate(dynHit, extracted.values)
        };
      }
    }
    return null;
  }
  function matchSiteTranslation(payloadHtml, table, container) {
    if (!table) {
      return null;
    }
    const trimmed = payloadHtml.trim();
    let extracted = null;
    const getExtracted = () => extracted ??= extractTemplate(trimmed);
    if (container && table.scoped) {
      for (const [selector, scopeTable] of Object.entries(table.scoped)) {
        if (!(selector && scopeTable)) {
          continue;
        }
        let matched = null;
        try {
          matched = typeof container.closest === "function" ? container.closest(selector) : null;
        } catch {
          matched = null;
        }
        if (!matched) {
          continue;
        }
        const hit = matchScopeEntry(
          payloadHtml,
          trimmed,
          scopeTable,
          getExtracted
        );
        if (hit) {
          return { ...hit, scope: selector };
        }
      }
    }
    return matchScopeEntry(payloadHtml, trimmed, table, getExtracted);
  }
  const HASHED_TOKEN_RE = /^[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]{3,}$/u;
  const VALID_IDENT_RE = /^[A-Za-z_-][A-Za-z0-9_-]*$/u;
  function escapeAttrValue(value) {
    return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
  }
  function suggestScopeSelector(el) {
    let cur = el?.parentElement ?? null;
    for (let depth = 0; cur && depth < 5; depth += 1, cur = cur.parentElement) {
      const tag = cur.tagName.toLowerCase();
      if (tag === "body" || tag === "html") {
        break;
      }
      const id = cur.getAttribute("id")?.trim();
      if (id && VALID_IDENT_RE.test(id) && !HASHED_TOKEN_RE.test(id)) {
        return `#${id}`;
      }
      const testId = cur.getAttribute("data-testid")?.trim();
      if (testId) {
        return `[data-testid="${escapeAttrValue(testId)}"]`;
      }
      const ariaLabel = cur.getAttribute("aria-label")?.trim();
      if (ariaLabel) {
        return `${tag}[aria-label="${escapeAttrValue(ariaLabel)}"]`;
      }
      const rawClass = cur.getAttribute("class") ?? "";
      for (const token of rawClass.split(/\s+/u)) {
        if (token && VALID_IDENT_RE.test(token) && !HASHED_TOKEN_RE.test(token)) {
          return `.${token}`;
        }
      }
    }
    return "";
  }
  function findHeadingContext(el) {
    let cur = el.parentElement;
    for (let depth = 0; cur && depth < 6; depth += 1, cur = cur.parentElement) {
      const heading = cur.querySelector("h1, h2, h3, h4");
      const text = heading?.textContent?.replace(/\s+/gu, " ").trim();
      if (text && text.length <= 80) {
        return text;
      }
      const aria = cur.getAttribute("aria-label")?.trim();
      if (aria && aria.length <= 80) {
        return aria;
      }
    }
    return "";
  }
  function buildAiTranslationExport(doc, delta, options) {
    const root = doc.body ?? doc.documentElement;
    const segs = root ? collectSegments(
      root,
      delta,
      options.getStyle ? { getStyle: options.getStyle } : void 0
    ) : [];
    const seenKeys = /* @__PURE__ */ new Set();
    const items = [];
    for (const seg of segs) {
      const enc = encodeInlineNodes(seg.nodes, delta);
      const ext = extractTemplate(enc.payloadHtml);
      const manualHit = matchSiteTranslation(
        enc.payloadHtml,
        options.siteTable,
        seg.container
      );
      if (manualHit) {
        continue;
      }
      const scope = suggestScopeSelector(seg.container);
      const dedupKey = `${scope}::${ext.kind}::${ext.template}`;
      if (seenKeys.has(dedupKey)) {
        continue;
      }
      seenKeys.add(dedupKey);
      const heading = findHeadingContext(seg.container);
      items.push({
        id: `s${items.length + 1}`,
        kind: ext.kind,
        template: ext.template,
        preview: seg.nodes.map((n) => n.textContent ?? "").join("").replace(/\s+/gu, " ").trim().slice(0, 120),
        ...scope ? { scope } : {},
        ...heading ? { heading } : {}
      });
    }
    const jsonObj = {
      version: 1,
      host: options.hostname,
      targetLang: options.targetLang,
      segments: items
    };
    const payload = JSON.stringify(jsonObj, null, 2);
    const mdLines = [
      `# ${doc.title || options.hostname} (${options.hostname})`,
      ""
    ];
    for (const item of items) {
      const ctx = [item.heading, item.scope].filter(Boolean).join(" · ");
      mdLines.push(`- [${item.id}${ctx ? ` | ${ctx}` : ""}] ${item.template}`);
    }
    const markdown = mdLines.join("\n");
    const prompt = [
      `Translate the web page segments below for "${options.hostname}" into "${options.targetLang}".`,
      "Rules:",
      '1. Preserve every placeholder token such as {v0}, {v1} and inline tags <x id="0">...</x> or <x id="0"/> verbatim.',
      "2. Use each item's `heading` and `scope` for consistent domain terminology.",
      '3. Return ONLY valid JSON in this shape: { "translations": { "<exact template>": "<translated string>" } }',
      "",
      "```json",
      payload,
      "```"
    ].join("\n");
    return { count: items.length, payload, markdown, prompt };
  }
  function parseAiTranslationImport(raw, targetLang) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid JSON object.");
    }
    const out = {
      static: {},
      dynamic: {},
      scoped: {},
      translationsMap: {}
    };
    if ("translations" in parsed && parsed.translations && typeof parsed.translations === "object") {
      for (const [k, v] of Object.entries(
        parsed.translations
      )) {
        if (typeof v === "string" && v.trim()) {
          out.translationsMap[k] = v;
          if (/\{v\d+\}/u.test(k)) {
            out.dynamic[k] = v;
          } else {
            out.static[k] = v;
          }
        }
      }
      return out;
    }
    if ("locales" in parsed && parsed.locales && typeof parsed.locales === "object") {
      const locales = parsed.locales;
      const table = locales[targetLang] ?? Object.values(locales)[0];
      if (!table || typeof table !== "object") {
        throw new Error("Missing locale table.");
      }
      for (const [k, v] of Object.entries(table.static ?? {})) {
        if (typeof v === "string" && v.trim()) {
          out.static[k] = v;
          out.translationsMap[k] = v;
        }
      }
      for (const [k, v] of Object.entries(table.dynamic ?? {})) {
        if (typeof v === "string" && v.trim()) {
          out.dynamic[k] = v;
          out.translationsMap[k] = v;
        }
      }
      if (table.scoped && typeof table.scoped === "object") {
        for (const [sel, sc] of Object.entries(table.scoped)) {
          if (!sc || typeof sc !== "object") {
            continue;
          }
          out.scoped[sel] = {
            ...sc.static ? { static: { ...sc.static } } : {},
            ...sc.dynamic ? { dynamic: { ...sc.dynamic } } : {}
          };
        }
      }
      return out;
    }
    throw new Error("Expected { translations } or { locales } JSON.");
  }
  const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/u;
  const HW_WORD_RE = /[A-Za-z0-9]/u;
  const HW_CLOSE_RE = /[)\]]/u;
  const URL_RE = /https?:\/\/[^\s\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF<>()[\]「」『』【】（）]+/giu;
  const CJK_HYPHEN_NUM = /([\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])-(\d)/gu;
  const CJK_TO_HW = /([\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])([A-Za-z0-9([])/gu;
  const HW_TO_CJK = /([A-Za-z0-9%!)\]])([\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])/gu;
  const PCT_TO_PAREN = /%([([])/gu;
  const FW_ALNUM_RE = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/gu;
  const CJK_PARENS_RE = /[ \t]*\(([^()]*?[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF][^()]*?)\)[ \t]*/gu;
  const CJK_ADJ_PUNCT_RE = /([\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF）])([,.!?:;])[ \t]*/gu;
  const FW_PUNCT_TRAIL_SPACE_RE = /([，。！？：；（）])[ \t]+/gu;
  const LATIN_COMMA_SPACE_RE = /([A-Za-z]),([A-Za-z])/gu;
  const LATIN_PERIOD_SPACE_RE = /([a-z])\.([A-Z][a-z])/gu;
  const HALF_TO_FULL_PUNCT = {
    ",": "，",
    ".": "。",
    "!": "！",
    "?": "？",
    ":": "：",
    ";": "；"
  };
  function normalizePunctuation(text, mode) {
    if (!text || mode === "off") {
      return text;
    }
    const urls = [];
    const masked = text.replace(URL_RE, (m) => {
      const idx = urls.length;
      urls.push(m);
      return `U${idx}`;
    });
    const norm = masked.replace(
      FW_ALNUM_RE,
      (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248)
    ).replace(/\u3000/gu, " ").replace(CJK_PARENS_RE, (_, inner) => `（${inner.trim()}）`).replace(
      CJK_ADJ_PUNCT_RE,
      (_, cjk, p) => `${cjk}${HALF_TO_FULL_PUNCT[p] ?? p}`
    ).replace(FW_PUNCT_TRAIL_SPACE_RE, "$1").replace(LATIN_COMMA_SPACE_RE, "$1, $2").replace(LATIN_PERIOD_SPACE_RE, "$1. $2");
    if (urls.length === 0) {
      return norm;
    }
    return norm.replace(/\uE000U(\d+)\uE001/gu, (_, n) => urls[Number(n)] ?? "");
  }
  function needsSpaceBetween(left, right) {
    if (!(left && right)) {
      return false;
    }
    if (CJK_RE.test(left) && (HW_WORD_RE.test(right) || right === "(" || right === "[")) {
      return true;
    }
    if ((HW_WORD_RE.test(left) || left === "%" || left === "!" || HW_CLOSE_RE.test(left)) && CJK_RE.test(right)) {
      return true;
    }
    return false;
  }
  function spaceCjkText(text) {
    if (!text) {
      return text;
    }
    const urls = [];
    const masked = text.replace(URL_RE, (m) => {
      const idx = urls.length;
      urls.push(m);
      return `U${idx}`;
    });
    const spaced = masked.replace(CJK_HYPHEN_NUM, "$1 - $2").replace(PCT_TO_PAREN, "% $1").replace(CJK_TO_HW, "$1 $2").replace(HW_TO_CJK, "$1 $2");
    if (urls.length === 0) {
      return spaced;
    }
    return spaced.replace(
      /\uE000U(\d+)\uE001/gu,
      (_, n) => urls[Number(n)] ?? ""
    );
  }
  function inspectTextSpacing(raw, punctNorm, spacingMode) {
    const norm = normalizePunctuation(raw, punctNorm);
    const useJs = spacingMode === "js" || spacingMode === "both";
    const out = useJs ? spaceCjkText(norm) : norm;
    return { norm, out, insertedSpaces: Math.max(0, out.length - norm.length) };
  }
  function formatDebugSpacingMarks(before, after) {
    let out = "";
    let i = 0;
    let j = 0;
    while (j < after.length) {
      const ca = after[j];
      const cb = before[i];
      if (ca === " ") {
        if (cb === " ") {
          out += "_";
          i++;
        } else {
          out += "^";
        }
        j++;
      } else {
        out += ca;
        if (cb === ca) {
          i++;
        }
        j++;
      }
    }
    return out;
  }
  function applyPunctNormToFragment(root, mode, skipPredicate) {
    if (mode === "off") {
      return;
    }
    function walk(node, skip) {
      if (node.nodeType === 3) {
        if (!skip && node.nodeValue) {
          node.nodeValue = normalizePunctuation(node.nodeValue, mode);
        }
        return;
      }
      if (node.nodeType !== 1 && node.nodeType !== 11) {
        return;
      }
      let nextSkip = skip;
      if (node.nodeType === 1) {
        const el = node;
        if (el.hasAttribute("data-tr-no-opencc") || skipPredicate?.(el)) {
          nextSkip = true;
        }
      }
      for (const child of Array.from(node.childNodes)) {
        walk(child, nextSkip);
      }
    }
    walk(root, false);
  }
  function applySpacingToFragment(root, options) {
    const skipPredicate = options?.skipPredicate;
    const textNodes = [];
    function walk(node, inheritedSkip) {
      if (node.nodeType === 3) {
        textNodes.push({ node, skip: inheritedSkip });
        return;
      }
      if (node.nodeType !== 1 && node.nodeType !== 11) {
        return;
      }
      let skip = inheritedSkip;
      if (node.nodeType === 1) {
        const el = node;
        if (el.hasAttribute("data-tr-no-space") || skipPredicate?.(el)) {
          skip = true;
        }
      }
      for (const child of Array.from(node.childNodes)) {
        walk(child, skip);
      }
    }
    walk(root, false);
    for (const entry of textNodes) {
      if (!entry.skip && entry.node.nodeValue) {
        const before = entry.node.nodeValue;
        const spaced = spaceCjkText(before);
        entry.node.nodeValue = options?.debugMarks ? formatDebugSpacingMarks(before, spaced) : spaced;
      }
    }
    for (let i = 0; i < textNodes.length - 1; i++) {
      const cur = textNodes[i];
      const next = textNodes[i + 1];
      if (cur.skip && next.skip) {
        continue;
      }
      const leftVal = cur.node.nodeValue ?? "";
      const rightVal = next.node.nodeValue ?? "";
      if (!(leftVal && rightVal)) {
        continue;
      }
      const leftChar = leftVal[leftVal.length - 1];
      const rightChar = rightVal[0];
      let shouldSpace = needsSpaceBetween(leftChar, rightChar);
      if (!shouldSpace && (cur.skip || next.skip)) {
        const ASCII_PRINTABLE = /^[\x21-\x7E]$/u;
        if (!cur.skip && next.skip && CJK_RE.test(leftChar) && ASCII_PRINTABLE.test(rightChar)) {
          shouldSpace = true;
        } else if (cur.skip && !next.skip && ASCII_PRINTABLE.test(leftChar) && CJK_RE.test(rightChar)) {
          shouldSpace = true;
        }
      }
      if (shouldSpace) {
        const sep = options?.debugMarks ? "^" : " ";
        if (!cur.skip) {
          cur.node.nodeValue = `${leftVal}${sep}`;
        } else if (!next.skip) {
          next.node.nodeValue = `${sep}${rightVal}`;
        }
      }
    }
  }
  const segmentHostMap = /* @__PURE__ */ new WeakMap();
  function applyOpenCCToFragment(root, convert, inheritedSkip = false) {
    if (root.nodeType === 3) {
      if (!inheritedSkip && root.nodeValue) {
        root.nodeValue = convert(root.nodeValue);
      }
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 11) {
      return;
    }
    let skip = inheritedSkip;
    if (root.nodeType === 1 && root.hasAttribute("data-tr-no-opencc")) {
      skip = true;
    }
    for (const child of Array.from(root.childNodes)) {
      applyOpenCCToFragment(child, convert, skip);
    }
  }
  function renderPending(seg, doc) {
    const existing = segmentHostMap.get(seg);
    if (existing) {
      return existing;
    }
    const firstNode = seg.nodes[0];
    const parent = firstNode?.parentNode ?? seg.container;
    const blockEl = doc.createElement("span");
    blockEl.setAttribute("data-tr-block", seg.sourceRule);
    blockEl.setAttribute("data-tr-id", seg.id);
    blockEl.setAttribute("data-tr-state", "pending");
    if (seg.modifiers.size > 0) {
      blockEl.setAttribute("data-tr-mod", [...seg.modifiers].join(" "));
    }
    const origEl = doc.createElement("span");
    origEl.setAttribute("data-tr-orig", "");
    const dstEl = doc.createElement("span");
    dstEl.setAttribute("data-tr-dst", "");
    if (firstNode && firstNode.parentNode === parent) {
      parent.insertBefore(blockEl, firstNode);
    } else {
      parent.appendChild(blockEl);
    }
    for (const n of seg.nodes) {
      origEl.appendChild(n);
    }
    blockEl.appendChild(origEl);
    blockEl.appendChild(dstEl);
    segmentHostMap.set(seg, blockEl);
    return blockEl;
  }
  function renderTranslated(seg, translatedHtml, slots, postProcess, doc) {
    const blockEl = renderPending(seg, doc);
    const dstEl = blockEl.querySelector("[data-tr-dst]");
    if (!dstEl) {
      return;
    }
    const frag = decodeTranslatedHtml(translatedHtml, slots, doc);
    if (postProcess.opencc && !seg.modifiers.has("no-opencc")) {
      applyOpenCCToFragment(frag, postProcess.opencc);
    }
    if (postProcess.punctNorm && postProcess.punctNorm !== "off" && !seg.modifiers.has("no-opencc")) {
      applyPunctNormToFragment(frag, postProcess.punctNorm);
    }
    const spacingMode = postProcess.spacingMode ?? (postProcess.spacing ? "js" : "off");
    const useJsSpacing = (spacingMode === "js" || spacingMode === "both") && !seg.modifiers.has("no-spacing");
    if (useJsSpacing) {
      applySpacingToFragment(frag, { debugMarks: postProcess.debugSpacingMarks });
    }
    dstEl.textContent = "";
    dstEl.appendChild(frag);
    blockEl.setAttribute("data-tr-state", "done");
  }
  function renderError(seg, doc) {
    const blockEl = segmentHostMap.get(seg) ?? renderPending(seg, doc);
    blockEl.setAttribute("data-tr-state", "error");
  }
  function renderInspectMarker(seg, _doc, meta) {
    seg.container.setAttribute("data-tr-inspect", seg.sourceRule);
    const effectiveSpace = seg.modifiers.has("no-spacing") ? "no-spacing" : meta?.spacingMode;
    if (meta?.kind) {
      seg.container.setAttribute("data-tr-inspect-kind", meta.kind);
    }
    if (effectiveSpace) {
      seg.container.setAttribute("data-tr-inspect-space", effectiveSpace);
    }
    if (seg.modifiers.size > 0) {
      seg.container.setAttribute(
        "data-tr-inspect-mods",
        [...seg.modifiers].join(" ")
      );
    }
    const labelParts = [meta?.kind ?? seg.sourceRule];
    if (effectiveSpace) {
      labelParts.push(`space:${effectiveSpace}`);
    }
    if (seg.modifiers.size > 0) {
      labelParts.push(`mods:${[...seg.modifiers].join(",")}`);
    }
    seg.container.setAttribute("data-tr-inspect-label", labelParts.join(" | "));
  }
  function restoreAll(root) {
    for (const inspected of Array.from(
      root.querySelectorAll("[data-tr-inspect]")
    )) {
      inspected.removeAttribute("data-tr-inspect");
      inspected.removeAttribute("data-tr-inspect-kind");
      inspected.removeAttribute("data-tr-inspect-space");
      inspected.removeAttribute("data-tr-inspect-mods");
      inspected.removeAttribute("data-tr-inspect-label");
    }
    for (const block of Array.from(root.querySelectorAll("[data-tr-block]"))) {
      const parent = block.parentNode;
      const orig = block.querySelector("[data-tr-orig]");
      if (parent && orig) {
        while (orig.firstChild) {
          parent.insertBefore(orig.firstChild, block);
        }
      }
      block.remove();
    }
  }
  const STOP_WORDS = /* @__PURE__ */ new Set([
    "The",
    "This",
    "That",
    "These",
    "Those",
    "There",
    "Their",
    "They",
    "Then",
    "Than",
    "When",
    "Where",
    "What",
    "Which",
    "While",
    "Who",
    "Why",
    "How",
    "With",
    "From",
    "Into",
    "Your",
    "You",
    "Our",
    "All",
    "Any",
    "New",
    "Open",
    "Save",
    "Close",
    "Click",
    "Type",
    "Read",
    "View",
    "Edit",
    "Help",
    "Home",
    "Back",
    "Next",
    "More",
    "Light",
    "Dark",
    "Theme",
    "Default",
    "Note",
    "Warning",
    "Error",
    "Please",
    "Welcome",
    "Configure",
    "Search",
    "Filter",
    "Select",
    "Create",
    "Delete",
    "Update"
  ]);
  const TOKEN_RE = /\b[A-Za-z][A-Za-z0-9._+-]{1,31}\b/gu;
  const CAMEL_OR_ACRONYM = /(?:[a-z][A-Z]|[A-Z]{2,}|[A-Za-z]\.[A-Za-z])/u;
  function extractPageKeywords(texts) {
    const segCounts = /* @__PURE__ */ new Map();
    for (const text of texts) {
      const seenInSeg = /* @__PURE__ */ new Set();
      const matches = text.match(TOKEN_RE);
      if (!matches) {
        continue;
      }
      for (const token of matches) {
        if (STOP_WORDS.has(token)) {
          continue;
        }
        if (seenInSeg.has(token)) {
          continue;
        }
        seenInSeg.add(token);
        segCounts.set(token, (segCounts.get(token) ?? 0) + 1);
      }
    }
    const out = [];
    for (const [token, count] of segCounts) {
      if (count < 2) {
        continue;
      }
      if (CAMEL_OR_ACRONYM.test(token) || count >= 3 && /^[A-Z]/u.test(token)) {
        out.push(token);
      }
    }
    return out;
  }
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  function maskKeywordsInHtml(html, keywords) {
    const clean = Array.from(
      new Set(keywords.map((k) => k.trim()).filter((k) => k.length >= 2))
    ).sort((a, b) => b.length - a.length);
    if (clean.length === 0) {
      return html;
    }
    const pattern = new RegExp(
      `\\b(${clean.map(escapeRegex).join("|")})\\b`,
      "g"
    );
    const parts = html.split(/(<[^>]+>)/gu);
    let insideKw = 0;
    return parts.map((part) => {
      if (part.startsWith("<") && part.endsWith(">")) {
        if (/^<span\b[^>]*data-ptr-kw\b/iu.test(part)) {
          insideKw++;
        } else if (insideKw > 0 && /^<\/span\s*>$/iu.test(part)) {
          insideKw--;
        }
        return part;
      }
      if (insideKw > 0) {
        return part;
      }
      return part.replace(
        pattern,
        '<span translate="no" data-ptr-kw="1">$1</span>'
      );
    }).join("");
  }
  const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const HANGUL_RE = new RegExp("\\p{Script=Hangul}", "u");
  const HAN_RE = new RegExp("\\p{Script=Han}", "u");
  const LATIN_RE = /[A-Za-z]/u;
  const CYRILLIC_RE = new RegExp("\\p{Script=Cyrillic}", "u");
  const ARABIC_RE = new RegExp("\\p{Script=Arabic}", "u");
  const THAI_RE = new RegExp("\\p{Script=Thai}", "u");
  const GREEK_RE = new RegExp("\\p{Script=Greek}", "u");
  const HEBREW_RE = new RegExp("\\p{Script=Hebrew}", "u");
  const DEVANAGARI_RE = new RegExp("\\p{Script=Devanagari}", "u");
  const NON_LATIN_SCRIPT_TAGS = [
    [CYRILLIC_RE, "ru"],
    [ARABIC_RE, "ar"],
    [THAI_RE, "th"],
    [GREEK_RE, "el"],
    [HEBREW_RE, "he"],
    [DEVANAGARI_RE, "hi"]
  ];
  const TRAD_FINGERPRINT = new Set(
    "這為說時發們國體語網設試測驗證類開點與還原譯鍵關圖書軟體學專業務實踐機區別動靜態編輯標點符號頁碼視頻檔個會對題號電資訊錄顯無應進選擇統計機構"
  );
  const SIMP_FINGERPRINT = new Set(
    "这为说时发们国体语网设试测验证类开点与还原译键关图书软件学专业务实践机区别动静态编辑标点符号页码视频档个会对题号电资讯录显无应进选择统计机构"
  );
  function parseBcp47(tag) {
    const parts = tag.trim().split(/[-_]/u).filter(Boolean);
    if (parts.length === 0) {
      return { lang: "und" };
    }
    const lang = parts[0].toLowerCase();
    let script;
    let region;
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (p.length === 4 && /^[A-Za-z]{4}$/u.test(p)) {
        script = p[0].toUpperCase() + p.slice(1).toLowerCase();
      } else if (p.length === 2 && /^[A-Za-z]{2}$/u.test(p)) {
        region = p.toUpperCase();
      }
    }
    if (lang === "zh" && !script) {
      if (region === "TW" || region === "HK" || region === "MO") {
        script = "Hant";
      } else if (region === "CN" || region === "SG") {
        script = "Hans";
      }
    }
    return { lang, ...script ? { script } : {}, ...region ? { region } : {} };
  }
  function detectSegmentBcp47(text, elementLang) {
    if (KANA_RE.test(text)) {
      return { lang: "ja" };
    }
    if (HANGUL_RE.test(text)) {
      return { lang: "ko" };
    }
    if (HAN_RE.test(text)) {
      const parsedEl = elementLang ? parseBcp47(elementLang) : null;
      if (parsedEl && (parsedEl.lang === "ja" || parsedEl.lang === "ko")) {
        return parsedEl;
      }
      let tradCount = 0;
      let simpCount = 0;
      for (const ch of text) {
        if (TRAD_FINGERPRINT.has(ch)) {
          tradCount++;
        } else if (SIMP_FINGERPRINT.has(ch)) {
          simpCount++;
        }
      }
      if (simpCount > tradCount) {
        return { lang: "zh", script: "Hans" };
      }
      if (tradCount > simpCount) {
        return { lang: "zh", script: "Hant" };
      }
      if (parsedEl && parsedEl.lang === "zh") {
        return parsedEl;
      }
      return { lang: "zh" };
    }
    for (const [scriptRe, lang] of NON_LATIN_SCRIPT_TAGS) {
      if (scriptRe.test(text)) {
        return { lang };
      }
    }
    return { lang: LATIN_RE.test(text) ? "en" : "und" };
  }
  function routeSegment(text, targetLang, elementLang) {
    const target = parseBcp47(targetLang);
    const source = detectSegmentBcp47(text, elementLang);
    if (source.lang === "zh" && target.lang === "zh") {
      if (source.script && target.script && source.script !== target.script) {
        if (source.script === "Hans" && target.script === "Hant") {
          return {
            action: "opencc",
            mode: target.region === "TW" ? "s2twp" : "s2t"
          };
        }
        if (source.script === "Hant" && target.script === "Hans") {
          return {
            action: "opencc",
            mode: target.region === "CN" ? "tw2sp" : "t2s"
          };
        }
      }
      return { action: "skip" };
    }
    if (source.lang !== "und" && source.lang === target.lang) {
      return { action: "skip" };
    }
    return { action: "translate" };
  }
  async function probeChromeLanguageDetector() {
    try {
      const g = globalThis;
      if (!("LanguageDetector" in globalThis) || typeof g.LanguageDetector?.availability !== "function") {
        return "unavailable";
      }
      const status = await g.LanguageDetector.availability();
      return status === "available" ? "available" : "unavailable";
    } catch {
      return "unavailable";
    }
  }
  function getSharedPanelCss(hostTokens) {
    return `
${getUiTokensCss(":host", hostTokens ?? void 0)}

.ptr-panel {
  background: var(--us-bg);
  color: var(--us-fg);
  border-radius: var(--us-radius-lg);
  font: var(--us-sans);
  contain: layout style paint;
  isolation: isolate;
}

.ptr-surface {
  background: var(--us-surface);
  border-radius: var(--us-radius-sm);
}

.ptr-muted {
  color: var(--us-muted);
}

.ptr-mono {
  font-family: var(--us-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}

.ptr-btn,
button.ptr-btn {
  position: relative;
  overflow: hidden;
  font: inherit;
  font-size: 12px;
  line-height: 1.25;
  padding: 6px 11px;
  background: var(--us-surface-2);
  color: var(--us-fg);
  border: none;
  border-radius: var(--us-radius-md);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition:
    background-color 200ms var(--us-ease),
    color 200ms var(--us-ease),
    box-shadow 220ms var(--us-ease);
}

.ptr-btn:hover:not(:disabled),
button.ptr-btn:hover:not(:disabled) {
  background: var(--us-surface-3);
  box-shadow: var(--us-shadow-sm);
}

.ptr-btn:active:not(:disabled),
button.ptr-btn:active:not(:disabled) {
  background: var(--us-accent-bg);
  color: var(--us-accent-fg);
  box-shadow: 0 0 0 3px oklch(from var(--us-accent-bg) l c h / 0.28);
}

.ptr-btn:disabled,
button.ptr-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.ptr-btn.flash-done,
button.ptr-btn.flash-done {
  animation: us-pulse-ring 420ms var(--us-ease);
}

.ptr-btn-primary,
button.ptr-btn-primary,
.ptr-btn[aria-pressed="true"],
button.ptr-btn[aria-pressed="true"] {
  background: var(--us-accent-bg);
  color: var(--us-accent-fg);
  font-weight: 600;
}

.ptr-btn-primary:hover:not(:disabled),
button.ptr-btn-primary:hover:not(:disabled),
.ptr-btn[aria-pressed="true"]:hover:not(:disabled),
button.ptr-btn[aria-pressed="true"]:hover:not(:disabled) {
  background: var(--us-accent-hover);
}

.ptr-input,
input.ptr-input,
select.ptr-input,
textarea.ptr-input {
  box-sizing: border-box;
  width: 100%;
  font: inherit;
  font-size: 12px;
  padding: 6px 9px;
  background: var(--us-surface);
  color: var(--us-fg);
  border: none;
  border-radius: var(--us-radius-sm);
  transition:
    background-color 180ms var(--us-ease),
    box-shadow 200ms var(--us-ease);
}

.ptr-input:focus,
input.ptr-input:focus,
select.ptr-input:focus,
textarea.ptr-input:focus {
  background: var(--us-surface-2);
  box-shadow: 0 0 0 2px oklch(from var(--us-focus) l c h / 0.35);
  outline: none;
}

textarea.ptr-input {
  font-family: var(--us-mono);
  font-size: 11.5px;
  resize: vertical;
}

.ptr-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border-radius: var(--us-radius-sm);
  background: var(--us-surface-2);
  color: var(--us-fg);
  font-size: 11px;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}

.drag-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 12px;
  min-width: 0;
}

.drag-grip {
  width: 11px;
  height: 14px;
  color: var(--us-muted);
  flex: none;
  transition: color 180ms var(--us-ease);
}

.us-panel-head.dragging .drag-grip {
  color: var(--us-fg);
}

.us-kv {
  margin: 6px 0 0;
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 4px 8px;
  font-size: 11.5px;
  align-items: start;
}

.us-kv dt {
  color: var(--us-muted);
  font-size: 11px;
  padding-top: 2px;
}

.us-kv dd {
  margin: 0;
  min-width: 0;
  word-break: break-word;
}

.code-inline {
  display: block;
  padding: 4px 7px;
  background: var(--us-surface);
  border-radius: var(--us-radius-sm);
  font-family: var(--us-mono);
  font-size: 11px;
  word-break: break-word;
}

.us-stat-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.us-stat-cell {
  padding: 6px 8px;
  border-radius: var(--us-radius-md);
  background: var(--us-surface);
  display: grid;
  gap: 1px;
}

.us-stat-val {
  font-family: var(--us-mono);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 700;
}

.us-stat-label {
  font-size: 10.5px;
  color: var(--us-muted);
}

.us-metric-table {
  display: grid;
  grid-template-columns: 1fr auto minmax(5.5ch, auto);
  align-items: baseline;
  font-size: 11.5px;
  border-radius: var(--us-radius-md);
  background: var(--us-surface);
  padding: 3px 0;
}

.us-metric-row {
  display: contents;
}

.us-metric-row > span {
  padding: 3px 0;
}

.m-label {
  padding-left: 9px;
  padding-right: 10px;
  color: var(--us-muted);
  white-space: nowrap;
}

.m-val {
  font-family: var(--us-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  font-weight: 600;
  padding-left: 6px;
  padding-right: 6px;
}

.m-unit {
  font-family: var(--us-mono);
  color: var(--us-muted);
  text-align: left;
  padding-right: 9px;
  white-space: pre;
}
`.trim();
  }
  const INSPECT_MENU_ID = "ptr-inspect";
  const HUD_ID = "ptr-inspect-hud";
  const HUD_STYLE_ID = "ptr-inspect-hud-style";
  const OBSERVE_CONFIG = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "style",
      "class",
      "hidden",
      "open",
      "aria-hidden",
      "aria-expanded"
    ]
  };
  function nowMs() {
    return typeof performance === "undefined" ? Date.now() : performance.now();
  }
  function scheduleFrame(cb) {
    if (typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function") {
      const id2 = requestAnimationFrame(cb);
      return { id: id2, cancel: () => cancelAnimationFrame(id2) };
    }
    const id = setTimeout(cb, 16);
    return { id, cancel: () => clearTimeout(id) };
  }
  function triggerPulse$1(btn) {
    btn.classList.remove("flash-done");
    void btn.offsetWidth;
    btn.classList.add("flash-done");
  }
  function supportsTextAutospace() {
    try {
      return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("text-autospace", "normal");
    } catch {
      return false;
    }
  }
  const hudSheetCache = /* @__PURE__ */ new WeakMap();
  function applyHudCss(sr, doc, css) {
    if (typeof CSSStyleSheet !== "undefined" && Array.isArray(sr.adoptedStyleSheets)) {
      try {
        let sheet = hudSheetCache.get(sr);
        if (!sheet) {
          sheet = new CSSStyleSheet();
          hudSheetCache.set(sr, sheet);
        }
        sheet.replaceSync(css);
        if (!sr.adoptedStyleSheets.includes(sheet)) {
          sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, sheet];
        }
        return;
      } catch {
      }
    }
    let styleEl = sr.getElementById(HUD_STYLE_ID);
    if (!styleEl) {
      styleEl = doc.createElement("style");
      styleEl.id = HUD_STYLE_ID;
      sr.prepend(styleEl);
    }
    styleEl.textContent = css;
  }
  function createInspectController(options) {
    let mutationObserver = null;
    let flushTimer = null;
    const pendingRoots = /* @__PURE__ */ new Set();
    const observedRoots = /* @__PURE__ */ new WeakSet();
    const discoveredShadows = /* @__PURE__ */ new Set();
    let registeredHandle;
    let hudEl = null;
    let hudRefs = null;
    let dragController = null;
    let hoverListenerAttached = false;
    let pendingHoverHost = null;
    let lastHoverHost = null;
    let hoverRaf = null;
    let telemetryRaf = null;
    let telemetryDirty = false;
    const prevTexts = /* @__PURE__ */ new Map();
    function tr(key, vars) {
      const raw = options.t ? options.t(key) : MESSAGES_EN[key];
      return formatPtrMsg(raw, vars);
    }
    function setTextFast(el, text) {
      if (!el) {
        return;
      }
      if (prevTexts.get(el) === text) {
        return;
      }
      prevTexts.set(el, text);
      el.textContent = text;
    }
    function ensureObserved(node) {
      if (!mutationObserver || observedRoots.has(node)) {
        return;
      }
      observedRoots.add(node);
      mutationObserver.observe(node, OBSERVE_CONFIG);
    }
    const hoverMeta = /* @__PURE__ */ new WeakMap();
    function updateHudHover(label, preview, meta) {
      if (!hudRefs) {
        return;
      }
      if (meta) {
        hudRefs.hoverHintEl.hidden = true;
        hudRefs.hoverKvEl.hidden = false;
        const dotClass = meta.kind === "auto-dynamic" ? "dyn" : meta.kind === "+" ? "plus" : meta.kind === "manual" ? "manual" : "static";
        hudRefs.hoverDotEl.className = `us-dot ${dotClass}`;
        setTextFast(hudRefs.hoverKindEl, meta.kind);
        setTextFast(hudRefs.hoverRouteEl, meta.route);
        setTextFast(hudRefs.hoverSpaceEl, meta.spacingSummary);
        setTextFast(hudRefs.hoverScopeEl, meta.scope || "—");
        setTextFast(
          hudRefs.hoverTplEl,
          meta.template.slice(0, 120) || preview || "—"
        );
        setTextFast(
          hudRefs.hoverValsEl,
          meta.values.length > 0 ? meta.values.join(", ") : "—"
        );
        setTextFast(hudRefs.hoverSpacingDiffEl, meta.spacingDiff || "—");
        return;
      }
      hudRefs.hoverHintEl.hidden = false;
      hudRefs.hoverKvEl.hidden = true;
      setTextFast(
        hudRefs.hoverHintEl,
        label ? `${label}${preview ? ` — ${preview}` : ""}` : tr("hoverHint")
      );
    }
    function flushTelemetry(force = false) {
      if (!(hudRefs && options.metrics)) {
        return;
      }
      const snap = getMetricsSnapshot(options.metrics);
      setTextFast(hudRefs.countStaticEl, String(snap.segments.autoStatic));
      setTextFast(hudRefs.countDynEl, String(snap.segments.autoDynamic));
      setTextFast(hudRefs.countPlusEl, String(snap.segments.plus));
      setTextFast(hudRefs.countManualEl, String(snap.segments.manual));
      const isCollapsed = hudRefs.detailsEl.dataset.collapsed === "true";
      if (isCollapsed && !force) {
        return;
      }
      telemetryDirty = false;
      setTextFast(hudRefs.segTotalEl, String(snap.segments.total));
      setTextFast(hudRefs.segScopedEl, String(snap.segments.scopedHits));
      setTextFast(hudRefs.routeApiEl, String(snap.routing.api));
      setTextFast(hudRefs.routeOpenccEl, String(snap.routing.opencc));
      setTextFast(hudRefs.routeSkipEl, String(snap.routing.skip));
      setTextFast(
        hudRefs.dictEl,
        String(snap.dictCounts.static + snap.dictCounts.dynamic)
      );
      setTextFast(hudRefs.dictUnitEl, `\`${snap.dictCounts.scoped} sc`);
      setTextFast(
        hudRefs.ldEl,
        tr(
          snap.languageDetectorStatus === "available" ? "ldAvailable" : "ldUnavailable"
        )
      );
      setTextFast(
        hudRefs.kwEl,
        snap.keywordsSample.slice(0, 6).join(", ") || "—"
      );
      setTextFast(
        hudRefs.scanIEl,
        snap.initialScanMs === null ? "—" : snap.initialScanMs.toFixed(1)
      );
      setTextFast(hudRefs.scanLEl, snap.lastScanMs.toFixed(1));
      setTextFast(hudRefs.nodesEl, String(snap.nodesVisited));
      setTextFast(hudRefs.cacheHEl, String(snap.cacheHits));
      setTextFast(hudRefs.cacheMEl, String(snap.cacheMisses));
      setTextFast(hudRefs.cacheRateEl, String(snap.cacheHitRatePct));
      setTextFast(hudRefs.apiBEl, String(snap.apiBatches));
      setTextFast(
        hudRefs.apiAvgEl,
        snap.apiBatches > 0 ? snap.avgApiBatchMs.toFixed(1) : "—"
      );
      setTextFast(hudRefs.mutBEl, String(snap.mutationBatches));
      setTextFast(hudRefs.excludedEl, String(snap.excludedCount));
      setTextFast(hudRefs.shadowsEl, String(snap.shadowRootCount));
    }
    function scheduleTelemetryFlush() {
      telemetryDirty = true;
      if (telemetryRaf) {
        return;
      }
      telemetryRaf = scheduleFrame(() => {
        telemetryRaf = null;
        flushTelemetry(false);
      });
    }
    function buildDiagnostics() {
      const segCounts = {};
      const samples = [];
      for (const el of options.doc.querySelectorAll("[data-tr-inspect-kind]")) {
        const kind = el.getAttribute("data-tr-inspect-kind");
        if (kind) {
          segCounts[kind] = (segCounts[kind] ?? 0) + 1;
        }
        const meta = hoverMeta.get(el);
        if (meta?.snippet && samples.length < 40) {
          samples.push(meta.snippet);
        }
      }
      if (options.metrics && options.metrics.keywordsSample.length === 0 && samples.length > 0) {
        options.metrics.keywordsSample = extractPageKeywords(samples);
      }
      const out = {};
      if (options.metrics) {
        out.metrics = getMetricsSnapshot(options.metrics);
      }
      out.segmentKindCounts = segCounts;
      return JSON.stringify(out, null, 2);
    }
    function syncThemeOnHud() {
      if (!hudEl?.shadowRoot) {
        return;
      }
      const mode = options.getThemeMode?.() ?? "system";
      const hostColors = mode === "host" ? probeHostColors(options.doc) : null;
      const hostTokens = mode === "host" ? resolveThemeTokens("host", hostColors) : null;
      applyThemeModeToElement(hudEl, mode, hostColors);
      applyHudCss(hudEl.shadowRoot, options.doc, buildHudCss(hostTokens));
    }
    function buildHudCss(hostTokens) {
      return `${getSharedPanelCss(hostTokens)}
:host {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483647;
  pointer-events: none;
}
.hud {
  width: 358px;
  pointer-events: auto;
}
.chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
.hover-hint {
  color: var(--us-muted);
  font-size: 11.5px;
  padding: 6px 8px;
  background: var(--us-surface);
  border-radius: var(--us-radius-sm);
}
.sec-title {
  font-size: 10.5px;
  font-weight: 700;
  margin: 8px 0 4px;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--us-muted);
}
.sec-title:first-child { margin-top: 0; }
.us-collapse-pad { padding: 4px 12px 8px; max-height: 240px; overflow-y: auto; }
.ctrl { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.hud-msg { color: var(--us-muted); font-size: 11px; margin-top: 5px; }`;
    }
    function mountHud() {
      const parent = options.doc.body ?? options.doc.documentElement;
      if (!parent) {
        return;
      }
      if (hudEl?.isConnected && hudRefs) {
        syncThemeOnHud();
        const spacing2 = options.getSpacingMode?.() ?? "both";
        setTextFast(hudRefs.spaceEl, tr("hudSpaceChip", { mode: spacing2 }));
        flushTelemetry(false);
        return;
      }
      const existing = options.doc.getElementById(HUD_ID);
      if (existing) {
        existing.remove();
      }
      hudEl = options.doc.createElement("div");
      hudEl.id = HUD_ID;
      hudEl.setAttribute("data-ptr-ui", "1");
      markUiRoot(hudEl, "ptr");
      const sr = hudEl.attachShadow({ mode: "open" });
      const mode = options.getThemeMode?.() ?? "system";
      const hostColors = mode === "host" ? probeHostColors(options.doc) : null;
      const hostTokens = mode === "host" ? resolveThemeTokens("host", hostColors) : null;
      applyThemeModeToElement(hudEl, mode, hostColors);
      applyHudCss(sr, options.doc, buildHudCss(hostTokens));
      const tpl = options.doc.createElement("template");
      tpl.innerHTML = `
<aside class="us-panel hud" id="ptr-h-aside" aria-label="${tr("hudTitle")}">
  <div class="us-panel-head" id="ptr-h-head">
    <span class="drag-title">
      <svg class="drag-grip" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="3" r="1.1"/><circle cx="8.5" cy="3" r="1.1"/><circle cx="3.5" cy="8" r="1.1"/><circle cx="8.5" cy="8" r="1.1"/><circle cx="3.5" cy="13" r="1.1"/><circle cx="8.5" cy="13" r="1.1"/></svg>
      <span id="ptr-h-title"></span>
    </span>
    <span class="ptr-chip ptr-mono" id="ptr-h-space"></span>
  </div>
  <div class="us-panel-sec">
    <div class="chip-row">
      <span class="ptr-chip"><i class="us-dot static"></i><span id="ptr-h-l-static"></span> <span id="ptr-h-c-static">0</span></span>
      <span class="ptr-chip"><i class="us-dot dyn"></i><span id="ptr-h-l-dyn"></span> <span id="ptr-h-c-dyn">0</span></span>
      <span class="ptr-chip"><i class="us-dot plus"></i><span id="ptr-h-l-plus"></span> <span id="ptr-h-c-plus">0</span></span>
      <span class="ptr-chip"><i class="us-dot manual"></i><span id="ptr-h-l-manual"></span> <span id="ptr-h-c-manual">0</span></span>
      <span class="ptr-chip ptr-mono" id="ptr-h-autospace"></span>
    </div>
  </div>
  <div class="us-panel-sec">
    <div class="hover-hint" id="ptr-h-hover-hint"></div>
    <div id="ptr-h-hover-kv" hidden>
      <div class="chip-row">
        <span class="ptr-chip"><i class="us-dot static" id="ptr-h-hover-dot"></i><span id="ptr-h-hover-kind"></span></span>
        <span class="ptr-chip ptr-mono" id="ptr-h-hover-route"></span>
        <span class="ptr-chip ptr-mono" id="ptr-h-hover-space"></span>
      </div>
      <dl class="us-kv">
        <dt id="ptr-h-kv-scope"></dt><dd class="ptr-mono" id="ptr-h-hover-scope">—</dd>
        <dt id="ptr-h-kv-tpl"></dt><dd><code class="code-inline" id="ptr-h-hover-tpl">—</code></dd>
        <dt id="ptr-h-kv-vals"></dt><dd class="ptr-mono" id="ptr-h-hover-vals">—</dd>
        <dt id="ptr-h-kv-diff"></dt><dd class="ptr-mono" id="ptr-h-hover-diff">—</dd>
      </dl>
    </div>
  </div>
  <div class="us-collapse" id="ptr-h-details" data-collapsed="true">
    <div class="us-collapse-inner">
      <div class="us-collapse-pad">
        <div class="sec-title" id="ptr-h-sec-cap"></div>
        <div class="us-metric-table">
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-seg"></span><span class="m-val" id="ptr-h-seg-total">0</span><span class="m-unit">\`seg</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-scoped"></span><span class="m-val" id="ptr-h-seg-scoped">0</span><span class="m-unit">\`hit</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-r-api"></span><span class="m-val" id="ptr-h-route-api">0</span><span class="m-unit">\`seg</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-r-cc"></span><span class="m-val" id="ptr-h-route-opencc">0</span><span class="m-unit">\`seg</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-r-skip"></span><span class="m-val" id="ptr-h-route-skip">0</span><span class="m-unit">\`seg</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-dict"></span><span class="m-val" id="ptr-h-dict">0</span><span class="m-unit" id="ptr-h-dict-unit">\`0 sc</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-ld"></span><span class="m-val" id="ptr-h-ld">—</span><span class="m-unit"></span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-kw"></span><span class="m-val" id="ptr-h-kw">—</span><span class="m-unit"></span></div>
        </div>
        <div class="sec-title" id="ptr-h-sec-perf"></div>
        <div class="us-metric-table">
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-scani"></span><span class="m-val" id="ptr-h-scan-i">—</span><span class="m-unit">\`ms</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-scanl"></span><span class="m-val" id="ptr-h-scan-l">0.0</span><span class="m-unit">\`ms</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-nodes"></span><span class="m-val" id="ptr-h-nodes">0</span><span class="m-unit">\`node</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-ch"></span><span class="m-val" id="ptr-h-cache-h">0</span><span class="m-unit">\`hit</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-cm"></span><span class="m-val" id="ptr-h-cache-m">0</span><span class="m-unit">\`miss</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-cr"></span><span class="m-val" id="ptr-h-cache-rate">0</span><span class="m-unit">\`%</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-ab"></span><span class="m-val" id="ptr-h-api-b">0</span><span class="m-unit">\`req</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-aa"></span><span class="m-val" id="ptr-h-api-avg">—</span><span class="m-unit">\`ms</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-mb"></span><span class="m-val" id="ptr-h-mut-b">0</span><span class="m-unit">\`batch</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-ex"></span><span class="m-val" id="ptr-h-excluded">0</span><span class="m-unit">\`el</span></div>
          <div class="us-metric-row"><span class="m-label" id="ptr-h-ml-sr"></span><span class="m-val" id="ptr-h-shadows">0</span><span class="m-unit">\`root</span></div>
        </div>
      </div>
    </div>
  </div>
  <div class="us-panel-sec">
    <div class="ctrl">
      <button type="button" class="ptr-btn us-btn-sm" id="ptr-h-toggle" aria-expanded="false">
        <span id="ptr-h-toggle-lbl"></span>
        <svg class="us-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
      </button>
      <div class="us-btn-group">
        <button type="button" class="ptr-btn us-btn-sm" id="ptr-h-export-ai"></button>
        <button type="button" class="ptr-btn us-btn-sm" id="ptr-h-copy"></button>
      </div>
    </div>
    <div class="hud-msg" id="ptr-h-msg" hidden></div>
  </div>
</aside>`;
      sr.appendChild(tpl.content.cloneNode(true));
      const get = (id) => sr.getElementById(id);
      setTextFast(get("ptr-h-title"), tr("hudTitle"));
      setTextFast(get("ptr-h-l-static"), tr("segStatic"));
      setTextFast(get("ptr-h-l-dyn"), tr("segDynamic"));
      setTextFast(get("ptr-h-l-plus"), tr("segPlus"));
      setTextFast(get("ptr-h-l-manual"), tr("segManual"));
      setTextFast(
        get("ptr-h-autospace"),
        tr(
          supportsTextAutospace() ? "hudAutospaceNative" : "hudAutospaceUnsupported"
        )
      );
      setTextFast(get("ptr-h-hover-hint"), tr("hoverHint"));
      setTextFast(get("ptr-h-kv-scope"), tr("kvScope"));
      setTextFast(get("ptr-h-kv-tpl"), tr("kvTemplate"));
      setTextFast(get("ptr-h-kv-vals"), tr("kvValues"));
      setTextFast(get("ptr-h-kv-diff"), tr("kvSpacing"));
      setTextFast(get("ptr-h-sec-cap"), tr("secCapture"));
      setTextFast(get("ptr-h-sec-perf"), tr("secPerf"));
      setTextFast(get("ptr-h-ml-seg"), tr("mSegments"));
      setTextFast(get("ptr-h-ml-scoped"), tr("mScopedHits"));
      setTextFast(get("ptr-h-ml-r-api"), tr("mRouteApi"));
      setTextFast(get("ptr-h-ml-r-cc"), tr("mRouteOpencc"));
      setTextFast(get("ptr-h-ml-r-skip"), tr("mRouteSkip"));
      setTextFast(get("ptr-h-ml-dict"), tr("mDict"));
      setTextFast(get("ptr-h-ml-ld"), tr("mLangDetector"));
      setTextFast(get("ptr-h-ml-kw"), tr("mKeywords"));
      setTextFast(get("ptr-h-ml-scani"), tr("mInitialScan"));
      setTextFast(get("ptr-h-ml-scanl"), tr("mLastScan"));
      setTextFast(get("ptr-h-ml-nodes"), tr("mNodes"));
      setTextFast(get("ptr-h-ml-ch"), tr("mCacheHit"));
      setTextFast(get("ptr-h-ml-cm"), tr("mCacheMiss"));
      setTextFast(get("ptr-h-ml-cr"), tr("mCacheRate"));
      setTextFast(get("ptr-h-ml-ab"), tr("mApiBatches"));
      setTextFast(get("ptr-h-ml-aa"), tr("mApiAvg"));
      setTextFast(get("ptr-h-ml-mb"), tr("mMutations"));
      setTextFast(get("ptr-h-ml-ex"), tr("mExcluded"));
      setTextFast(get("ptr-h-ml-sr"), tr("mShadowRoots"));
      setTextFast(get("ptr-h-toggle-lbl"), tr("btnDetails"));
      setTextFast(get("ptr-h-export-ai"), tr("btnExportAi"));
      setTextFast(get("ptr-h-copy"), tr("btnCopyDiag"));
      hudRefs = {
        asideEl: get("ptr-h-aside"),
        headEl: get("ptr-h-head"),
        spaceEl: get("ptr-h-space"),
        autospaceEl: get("ptr-h-autospace"),
        hoverHintEl: get("ptr-h-hover-hint"),
        hoverKvEl: get("ptr-h-hover-kv"),
        hoverDotEl: get("ptr-h-hover-dot"),
        hoverKindEl: get("ptr-h-hover-kind"),
        hoverRouteEl: get("ptr-h-hover-route"),
        hoverSpaceEl: get("ptr-h-hover-space"),
        hoverScopeEl: get("ptr-h-hover-scope"),
        hoverTplEl: get("ptr-h-hover-tpl"),
        hoverValsEl: get("ptr-h-hover-vals"),
        hoverSpacingDiffEl: get("ptr-h-hover-diff"),
        toggleBtn: get("ptr-h-toggle"),
        exportAiBtn: get("ptr-h-export-ai"),
        copyBtn: get("ptr-h-copy"),
        detailsEl: get("ptr-h-details"),
        segTotalEl: get("ptr-h-seg-total"),
        segScopedEl: get("ptr-h-seg-scoped"),
        routeApiEl: get("ptr-h-route-api"),
        routeOpenccEl: get("ptr-h-route-opencc"),
        routeSkipEl: get("ptr-h-route-skip"),
        dictEl: get("ptr-h-dict"),
        dictUnitEl: get("ptr-h-dict-unit"),
        ldEl: get("ptr-h-ld"),
        kwEl: get("ptr-h-kw"),
        scanIEl: get("ptr-h-scan-i"),
        scanLEl: get("ptr-h-scan-l"),
        nodesEl: get("ptr-h-nodes"),
        cacheHEl: get("ptr-h-cache-h"),
        cacheMEl: get("ptr-h-cache-m"),
        cacheRateEl: get("ptr-h-cache-rate"),
        apiBEl: get("ptr-h-api-b"),
        apiAvgEl: get("ptr-h-api-avg"),
        mutBEl: get("ptr-h-mut-b"),
        excludedEl: get("ptr-h-excluded"),
        shadowsEl: get("ptr-h-shadows"),
        countStaticEl: get("ptr-h-c-static"),
        countDynEl: get("ptr-h-c-dyn"),
        countPlusEl: get("ptr-h-c-plus"),
        countManualEl: get("ptr-h-c-manual"),
        msgEl: get("ptr-h-msg")
      };
      hudRefs.toggleBtn.addEventListener("click", () => {
        if (!hudRefs) {
          return;
        }
        const nextOpen = hudRefs.detailsEl.dataset.collapsed === "true";
        hudRefs.detailsEl.dataset.collapsed = String(!nextOpen);
        hudRefs.toggleBtn.setAttribute("aria-expanded", String(nextOpen));
        if (nextOpen) {
          flushTelemetry(true);
        }
      });
      hudRefs.copyBtn.addEventListener("click", () => {
        if (!hudRefs) {
          return;
        }
        triggerPulse$1(hudRefs.copyBtn);
        try {
          void navigator.clipboard?.writeText?.(buildDiagnostics());
        } catch {
        }
      });
      hudRefs.exportAiBtn.addEventListener("click", async () => {
        if (!hudRefs) {
          return;
        }
        triggerPulse$1(hudRefs.exportAiBtn);
        const hostname = options.hostname ?? options.doc.location?.hostname ?? "page";
        const bundle = buildAiTranslationExport(options.doc, options.getDelta(), {
          hostname,
          targetLang: options.getTargetLang?.() ?? "zh-TW",
          getStyle: options.getStyle,
          siteTable: options.getSiteLocaleTable?.() ?? null
        });
        hudRefs.msgEl.hidden = false;
        try {
          await navigator.clipboard.writeText(bundle.prompt);
          setTextFast(
            hudRefs.msgEl,
            tr("hudExportedAi", { count: bundle.count })
          );
        } catch {
          const blob = new Blob([bundle.prompt], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const a = options.doc.createElement("a");
          a.href = url;
          a.download = `${hostname}-ai-export.md`;
          a.click();
          URL.revokeObjectURL(url);
          setTextFast(hudRefs.msgEl, tr("hudExportDenied"));
        }
      });
      dragController?.destroy();
      dragController = createDragController({
        panel: hudEl,
        handle: hudRefs.headEl,
        stage: null
      });
      parent.appendChild(hudEl);
      const spacing = options.getSpacingMode?.() ?? "both";
      setTextFast(hudRefs.spaceEl, tr("hudSpaceChip", { mode: spacing }));
      flushTelemetry(false);
    }
    function flushHover() {
      hoverRaf = null;
      const host = pendingHoverHost;
      if (!(host && options.isEnabled() && hudEl)) {
        return;
      }
      if (host === lastHoverHost) {
        return;
      }
      lastHoverHost = host;
      const label = host.getAttribute("data-tr-inspect-label") ?? host.getAttribute("data-tr-inspect") ?? "";
      const meta = hoverMeta.get(host);
      const snippet = meta?.snippet ?? "";
      updateHudHover(label, snippet, meta);
    }
    function onDocMouseOver(e) {
      if (!(options.isEnabled() && hudEl)) {
        return;
      }
      const raw = e.target;
      if (!raw || raw.closest?.("[data-ptr-ui],[data-us-ui]")) {
        return;
      }
      const host = raw.closest?.("[data-tr-inspect]");
      if (!host || host === lastHoverHost) {
        return;
      }
      pendingHoverHost = host;
      if (!hoverRaf) {
        hoverRaf = scheduleFrame(flushHover);
      }
    }
    function startHud() {
      mountHud();
      if (!hoverListenerAttached) {
        options.doc.addEventListener("mouseover", onDocMouseOver, {
          passive: true
        });
        hoverListenerAttached = true;
      }
    }
    function removeHud() {
      if (hoverRaf) {
        hoverRaf.cancel();
        hoverRaf = null;
      }
      if (telemetryRaf) {
        telemetryRaf.cancel();
        telemetryRaf = null;
      }
      dragController?.destroy();
      dragController = null;
      pendingHoverHost = null;
      lastHoverHost = null;
      telemetryDirty = false;
      prevTexts.clear();
      if (hoverListenerAttached) {
        options.doc.removeEventListener("mouseover", onDocMouseOver);
        hoverListenerAttached = false;
      }
      hudEl?.remove();
      options.doc.getElementById(HUD_ID)?.remove();
      hudEl = null;
      hudRefs = null;
    }
    function markSubtree(target, isInitialRoot = false) {
      if (target.id === "ptr-user-css" || target.id === HUD_ID || target.hasAttribute("data-tr-block") || target.hasAttribute("data-tr-orig") || target.hasAttribute("data-tr-dst") || target.hasAttribute("data-ptr-ui") || target.hasAttribute("data-us-ui") || target.closest?.("[data-ptr-ui],[data-us-ui]") !== null) {
        return;
      }
      const delta = options.getDelta();
      const metrics = options.metrics;
      const scanStartedAt = nowMs();
      const shadowRoots = /* @__PURE__ */ new Set();
      const segs = collectSegments(target, delta, {
        ...options.getStyle ? { getStyle: options.getStyle } : {},
        shadowRoots,
        onExcluded: () => {
          if (metrics) {
            metrics.excludedCount += 1;
          }
        }
      });
      if (metrics) {
        recordScanTiming(metrics, nowMs() - scanStartedAt, segs.length);
        metrics.shadowRootCount += shadowRoots.size;
      }
      if (shadowRoots.size > 0) {
        for (const sr of shadowRoots) {
          discoveredShadows.add(sr);
          ensureObserved(sr);
        }
        options.onShadowRoots?.(shadowRoots);
      }
      const siteTable = options.getSiteLocaleTable?.() ?? null;
      const spacingMode = options.getSpacingMode?.() ?? "both";
      const punctNorm = options.getPunctNorm?.() ?? "zh-norm";
      const targetLang = options.getTargetLang?.() ?? "";
      const plainTexts = metrics && (isInitialRoot || metrics.keywordsSample.length === 0) ? [] : null;
      for (const s of segs) {
        const encoded = encodeInlineNodes(s.nodes, delta);
        const plain = s.nodes.map((n) => n.textContent ?? "").join("").trim();
        if (plainTexts) {
          plainTexts.push(plain);
        }
        const route = routeSegment(plain, targetLang);
        const manualHit = siteTable ? matchSiteTranslation(encoded.payloadHtml, siteTable, s.container) : null;
        const ext = extractTemplate(encoded.payloadHtml);
        let kind = s.sourceRule === "+" ? "+" : "auto-static";
        if (manualHit) {
          kind = "manual";
        } else if (s.sourceRule === "auto" && ext.kind === "dynamic") {
          kind = "auto-dynamic";
        }
        if (metrics) {
          metrics.segments.total += 1;
          if (kind === "manual") {
            metrics.segments.manual += 1;
          } else if (kind === "+") {
            metrics.segments.plus += 1;
          } else if (kind === "auto-dynamic") {
            metrics.segments.autoDynamic += 1;
          } else {
            metrics.segments.autoStatic += 1;
          }
          if (kind === "manual" && manualHit?.scope) {
            metrics.segments.scopedHits += 1;
          }
          if (route.action === "skip") {
            metrics.routing.skip += 1;
          } else if (route.action === "opencc") {
            metrics.routing.opencc += 1;
          } else {
            metrics.routing.api += 1;
          }
        }
        const previewSource = manualHit?.html ? manualHit.html.replace(/<[^>]+>/gu, "") : plain;
        const spaceCheck = inspectTextSpacing(
          previewSource,
          punctNorm,
          spacingMode
        );
        const spacingSummary = spacingMode === "off" ? "off" : `+${spaceCheck.insertedSpaces} JS · ${spacingMode}`;
        const spacingDiff = spaceCheck.out === previewSource ? spacingMode === "w3c" ? "CSS text-autospace" : "—" : `${previewSource.slice(0, 36)} -> ${spaceCheck.out.slice(0, 36)}`;
        hoverMeta.set(s.container, {
          kind,
          route: `${detectSegmentBcp47(plain).lang} -> ${route.action}`,
          spacingMode,
          spacingSummary,
          spacingDiff,
          mods: [...s.modifiers].sort(),
          template: ext.template,
          values: ext.values,
          scope: manualHit?.scope ?? null,
          snippet: plain.replace(/\s+/gu, " ").slice(0, 60)
        });
        renderInspectMarker(s, options.doc, { kind, spacingMode });
      }
      if (metrics && plainTexts && plainTexts.length > 0) {
        metrics.keywordsSample = extractPageKeywords(plainTexts);
      }
      if (isInitialRoot) {
        flushTelemetry(false);
      } else if (!telemetryDirty || hudRefs?.detailsEl.dataset.collapsed === "false") {
        scheduleTelemetryFlush();
      }
    }
    function stopObserver() {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingRoots.clear();
      mutationObserver?.disconnect();
      mutationObserver = null;
      removeHud();
    }
    function startObserver(root) {
      if (mutationObserver || typeof MutationObserver === "undefined") {
        return;
      }
      mutationObserver = new MutationObserver((records) => {
        if (!options.isEnabled()) {
          return;
        }
        for (const rec of records) {
          const recEl = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
          if (recEl && (recEl.hasAttribute("data-ptr-ui") || recEl.hasAttribute("data-us-ui") || recEl.closest?.("[data-ptr-ui],[data-us-ui]"))) {
            continue;
          }
          if (rec.type === "attributes" && rec.target.nodeType === 1) {
            pendingRoots.add(rec.target);
            continue;
          }
          if (rec.type !== "childList") {
            continue;
          }
          for (const added of Array.from(rec.addedNodes)) {
            if (added.nodeType === 1) {
              const addedEl = added;
              if (!(addedEl.hasAttribute("data-ptr-ui") || addedEl.hasAttribute("data-us-ui") || addedEl.closest?.("[data-ptr-ui],[data-us-ui]"))) {
                pendingRoots.add(addedEl);
              }
            } else if (added.nodeType === 3 && rec.target.nodeType === 1) {
              pendingRoots.add(rec.target);
            }
          }
        }
        if (pendingRoots.size > 0 && flushTimer === null) {
          flushTimer = setTimeout(() => {
            flushTimer = null;
            const roots = Array.from(pendingRoots);
            pendingRoots.clear();
            const rootSet = new Set(roots);
            for (const r of roots) {
              if (!r.isConnected) {
                continue;
              }
              let hasAncestor = false;
              let p = r.parentElement;
              while (p) {
                if (rootSet.has(p)) {
                  hasAncestor = true;
                  break;
                }
                p = p.parentElement;
              }
              if (!hasAncestor) {
                markSubtree(r, false);
              }
            }
          }, 120);
        }
      });
      ensureObserved(root);
      for (const sr of discoveredShadows) {
        ensureObserved(sr);
      }
    }
    function clearMarkersIn(root) {
      for (const el of Array.from(root.querySelectorAll("[data-tr-inspect]"))) {
        el.removeAttribute("data-tr-inspect");
        el.removeAttribute("data-tr-inspect-kind");
        el.removeAttribute("data-tr-inspect-space");
        el.removeAttribute("data-tr-inspect-mods");
        el.removeAttribute("data-tr-inspect-label");
      }
    }
    function clearMarkers() {
      clearMarkersIn(options.doc);
      for (const sr of discoveredShadows) {
        clearMarkersIn(sr);
      }
    }
    function syncFromConfig() {
      const root = options.doc.body ?? options.doc.documentElement;
      if (options.isEnabled()) {
        startHud();
        if (root) {
          startObserver(root);
          markSubtree(root, true);
        }
      } else {
        stopObserver();
        clearMarkers();
      }
    }
    function registerMenu() {
      const caption = options.formatLabel ? options.formatLabel(options.isEnabled()) : tr("inspectMode", {
        state: tr(options.isEnabled() ? "on" : "off")
      });
      if (registeredHandle !== void 0 && registeredHandle !== INSPECT_MENU_ID) {
        gmUnregisterMenuCommand(registeredHandle);
      }
      const handle = gmMenuCommand(caption, toggle, { id: INSPECT_MENU_ID });
      registeredHandle = handle ?? caption;
    }
    function toggle() {
      options.setEnabled(!options.isEnabled());
      options.onAfterChange?.();
      syncFromConfig();
      registerMenu();
    }
    return {
      syncFromConfig,
      refreshTheme: syncThemeOnHud,
      registerMenu,
      toggle,
      stop: stopObserver
    };
  }
  function watchSpaNavigation(options) {
    const { win, onBeforeLeave, onSettled, settleMs = 150 } = options;
    let lastUrl = win.location?.href ?? "";
    let settleTimer = null;
    let leavingDispatched = false;
    let stopped = false;
    function triggerLeaveOnce() {
      if (stopped || leavingDispatched) {
        return;
      }
      leavingDispatched = true;
      onBeforeLeave();
    }
    function scheduleSettled() {
      if (stopped) {
        return;
      }
      leavingDispatched = false;
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
      }
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (!stopped) {
          onSettled();
        }
      }, settleMs);
    }
    function commitUrl(nextUrl) {
      if (stopped || !nextUrl || nextUrl === lastUrl) {
        return;
      }
      triggerLeaveOnce();
      lastUrl = nextUrl;
      scheduleSettled();
    }
    const origPushState = win.history.pushState.bind(win.history);
    const origReplaceState = win.history.replaceState.bind(win.history);
    function resolveUrlArg(urlArg) {
      if (!urlArg) {
        return win.location?.href ?? lastUrl;
      }
      try {
        return new URL(String(urlArg), win.location?.href ?? "https://localhost/").href;
      } catch {
        return String(urlArg);
      }
    }
    function trackPush(data, unused, url) {
      const targetUrl = resolveUrlArg(url);
      if (targetUrl !== lastUrl) {
        triggerLeaveOnce();
      }
      origPushState(data, unused, url);
      commitUrl(win.location?.href ?? targetUrl);
    }
    function trackReplace(data, unused, url) {
      const targetUrl = resolveUrlArg(url);
      if (targetUrl !== lastUrl) {
        triggerLeaveOnce();
      }
      origReplaceState(data, unused, url);
      commitUrl(win.location?.href ?? targetUrl);
    }
    try {
      win.history.pushState = (data, unused, url) => {
        trackPush(data, unused, url);
      };
    } catch {
    }
    try {
      win.history.replaceState = (data, unused, url) => {
        trackReplace(data, unused, url);
      };
    } catch {
    }
    const onPopOrHash = () => {
      commitUrl(win.location?.href ?? "");
    };
    const onTurboBefore = () => {
      triggerLeaveOnce();
    };
    const onTurboSettled = () => {
      const cur = win.location?.href ?? "";
      if (cur) {
        lastUrl = cur;
      }
      scheduleSettled();
    };
    win.addEventListener("popstate", onPopOrHash);
    win.addEventListener("hashchange", onPopOrHash);
    win.addEventListener("turbo:before-cache", onTurboBefore);
    win.addEventListener("turbo:before-render", onTurboBefore);
    win.addEventListener("turbo:load", onTurboSettled);
    win.addEventListener("turbo:render", onTurboSettled);
    win.addEventListener("turbo:frame-load", onTurboSettled);
    const doc = win.document;
    doc?.addEventListener("turbo:before-cache", onTurboBefore);
    doc?.addEventListener("turbo:before-render", onTurboBefore);
    doc?.addEventListener("turbo:load", onTurboSettled);
    doc?.addEventListener("turbo:render", onTurboSettled);
    doc?.addEventListener("turbo:frame-load", onTurboSettled);
    let lastBody = doc?.body ?? null;
    const docElObserver = typeof MutationObserver !== "undefined" && doc?.documentElement ? new MutationObserver(() => {
      if (stopped) {
        return;
      }
      const curBody = doc.body ?? null;
      if (curBody && curBody !== lastBody) {
        lastBody = curBody;
        const cur = win.location?.href ?? "";
        if (cur) {
          lastUrl = cur;
        }
        triggerLeaveOnce();
        scheduleSettled();
      }
    }) : null;
    if (docElObserver && doc?.documentElement) {
      docElObserver.observe(doc.documentElement, { childList: true });
    }
    const nav = win.navigation;
    const onNavigate = (e) => {
      if (e.navigationType === "reload") {
        return;
      }
      const dest = e.destination?.url;
      if (dest && dest !== lastUrl) {
        triggerLeaveOnce();
      }
    };
    const onNavigateSuccess = () => {
      commitUrl(win.location?.href ?? "");
    };
    nav?.addEventListener("navigate", onNavigate);
    nav?.addEventListener("navigatesuccess", onNavigateSuccess);
    return {
      stop() {
        stopped = true;
        if (settleTimer !== null) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
        docElObserver?.disconnect();
        try {
          win.history.pushState = origPushState;
        } catch {
        }
        try {
          win.history.replaceState = origReplaceState;
        } catch {
        }
        win.removeEventListener("popstate", onPopOrHash);
        win.removeEventListener("hashchange", onPopOrHash);
        win.removeEventListener("turbo:before-cache", onTurboBefore);
        win.removeEventListener("turbo:before-render", onTurboBefore);
        win.removeEventListener("turbo:load", onTurboSettled);
        win.removeEventListener("turbo:render", onTurboSettled);
        win.removeEventListener("turbo:frame-load", onTurboSettled);
        doc?.removeEventListener("turbo:before-cache", onTurboBefore);
        doc?.removeEventListener("turbo:before-render", onTurboBefore);
        doc?.removeEventListener("turbo:load", onTurboSettled);
        doc?.removeEventListener("turbo:render", onTurboSettled);
        doc?.removeEventListener("turbo:frame-load", onTurboSettled);
        nav?.removeEventListener("navigate", onNavigate);
        nav?.removeEventListener("navigatesuccess", onNavigateSuccess);
      }
    };
  }
  const STYLE_ELEMENT_ID = "ptr-user-css";
  const gmInjectedByDoc = /* @__PURE__ */ new WeakMap();
  const shadowSheetByRoot = /* @__PURE__ */ new WeakMap();
  function buildStylesheet(opts) {
    const fontVal = opts.customFont.trim() || "inherit";
    const useW3cAutospace = opts.spacingMode === "w3c" || opts.spacingMode === "both";
    const autospaceRule = useW3cAutospace ? " text-autospace: normal;" : "";
    const inspectCss = opts.debugInspect ? `
[data-tr-inspect] {
  outline: 2px dashed #3b82f6 !important;
  outline-offset: 2px !important;
}
[data-tr-inspect-kind="auto-dynamic"] {
  outline-color: #a855f7 !important;
}
[data-tr-inspect="+"],
[data-tr-inspect-kind="+"] {
  outline-color: #10b981 !important;
}
[data-tr-inspect-kind="manual"] {
  outline-color: #f59e0b !important;
}
[data-tr-inspect-mods] {
  outline-style: dotted !important;
}
` : "";
    const userCss = opts.customCss.trim();
    return `/* Page Translator base styles (overridable via custom CSS) */
:root { --ptr-font: ${fontVal}; }
[data-tr-block] { display: contents; }
[data-tr-orig] { display: none; }
[data-tr-dst] { display: contents; font-family: var(--ptr-font, inherit);${autospaceRule} }
[data-tr-state="pending"] > [data-tr-orig],
[data-tr-state="error"] > [data-tr-orig],
[data-tr-mod~="keep-orig"] > [data-tr-orig] { display: contents; }
[data-tr-state="pending"] > [data-tr-dst] { opacity: 0.65; }
${inspectCss}${userCss ? `
/* User custom CSS */
${userCss}
` : ""}`;
  }
  function syncShadowRoot(root, css, doc) {
    if (typeof CSSStyleSheet !== "undefined" && Array.isArray(root.adoptedStyleSheets)) {
      try {
        let sheet = shadowSheetByRoot.get(root);
        if (!sheet) {
          sheet = new CSSStyleSheet();
          shadowSheetByRoot.set(root, sheet);
        }
        sheet.replaceSync(css);
        if (!root.adoptedStyleSheets.includes(sheet)) {
          root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        }
        return;
      } catch {
      }
    }
    let styleEl = root.getElementById(
      STYLE_ELEMENT_ID
    );
    if (!styleEl) {
      styleEl = doc.createElement("style");
      styleEl.id = STYLE_ELEMENT_ID;
      root.appendChild(styleEl);
    }
    styleEl.textContent = css;
  }
  function syncShadowRootsOnly(doc, opts, shadowRoots) {
    const css = buildStylesheet(opts);
    for (const root of shadowRoots) {
      syncShadowRoot(root, css, doc);
    }
  }
  function syncStylesheet(doc, opts, shadowRoots) {
    const css = buildStylesheet(opts);
    if (shadowRoots) {
      for (const root of shadowRoots) {
        syncShadowRoot(root, css, doc);
      }
    }
    const prevGm = gmInjectedByDoc.get(doc);
    if (prevGm?.isConnected) {
      prevGm.textContent = css;
      return prevGm;
    }
    if (prevGm) {
      gmInjectedByDoc.delete(doc);
    }
    const viaGm = gmAddStyle(css);
    if (viaGm) {
      viaGm.id = STYLE_ELEMENT_ID;
      gmInjectedByDoc.set(doc, viaGm);
      return viaGm;
    }
    let styleEl = doc.getElementById(STYLE_ELEMENT_ID);
    if (!styleEl) {
      styleEl = doc.createElement("style");
      styleEl.id = STYLE_ELEMENT_ID;
      (doc.head ?? doc.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = css;
    return styleEl;
  }
  class Trie {
    // 使用 Map 實作 Trie 樹
    // Trie 的每個節點為一個 Map 物件
    // key 為 code point，value 為子節點（也是一個 Map）。
    // 如果 Map 物件有 trie_val 屬性，則該屬性為值字串，代表替換的字詞。
    constructor() {
      this.map = /* @__PURE__ */ new Map();
    }
    /**
     * 將一項資料加入字典樹
     * @param {string} s 要匹配的字串
     * @param {string} v 若匹配成功，則替換為此字串
     */
    addWord(s, v) {
      let { map } = this;
      for (const c of s) {
        const cp = c.codePointAt(0);
        const nextMap = map.get(cp);
        if (nextMap == null) {
          const tmp = /* @__PURE__ */ new Map();
          map.set(cp, tmp);
          map = tmp;
        } else {
          map = nextMap;
        }
      }
      map.trie_val = v;
    }
    /**
       * 讀取字典資料
       * @param {DictLike} d 字典
       */
    loadDict(d) {
      if (typeof d === "string") {
        d = d.split("|");
        for (const line of d) {
          const [l, r] = line.split(" ");
          if (typeof r !== "string") {
            throw new TypeError('Invalid dictionary entry: expected string entries to use "source replacement" format.');
          }
          this.addWord(l, r);
        }
      } else {
        for (const arr of d) {
          if (!Array.isArray(arr) || typeof arr[0] !== "string" || typeof arr[1] !== "string") {
            throw new TypeError(
              "Invalid dictionary entry: expected [source, replacement] pairs. If you are passing locale dictionaries to ConverterFactory, spread them, for example: ConverterFactory(...Locale.from.cn, ...Locale.to.hk)."
            );
          }
          const [l, r] = arr;
          this.addWord(l, r);
        }
      }
    }
    /**
     * 讀取多個字典資料
     * @param {DictLike[]} arr 字典
     */
    loadDictGroup(arr) {
      arr.slice().reverse().forEach((d) => {
        this.loadDict(d);
      });
    }
    matchPrefix(s, i) {
      const n = s.length;
      let t_curr = this.map, k = 0, v;
      for (let j = i; j < n; ) {
        const x = s.codePointAt(j);
        j += x > 65535 ? 2 : 1;
        const t_next = t_curr.get(x);
        if (typeof t_next === "undefined") {
          break;
        }
        t_curr = t_next;
        const v_curr = t_curr.trie_val;
        if (typeof v_curr !== "undefined") {
          k = j;
          v = v_curr;
        }
      }
      if (k > 0) {
        return { end: k, value: v };
      }
      return null;
    }
    segment(s) {
      const n = s.length, segments = [];
      let orig_i = null;
      for (let i = 0; i < n; ) {
        const matched = this.matchPrefix(s, i);
        if (matched) {
          if (orig_i !== null) {
            segments.push(s.slice(orig_i, i));
            orig_i = null;
          }
          segments.push(s.slice(i, matched.end));
          i = matched.end;
        } else {
          if (orig_i === null) {
            orig_i = i;
          }
          i += getUnmatchedLength(s, i);
        }
      }
      if (orig_i !== null) {
        segments.push(s.slice(orig_i, n));
      }
      return segments;
    }
    /**
     * 根據字典樹中的資料轉換字串。
     * @param {string} s 要轉換的字串
     */
    convert(s) {
      const n = s.length, arr = [];
      let orig_i = null;
      for (let i = 0; i < n; ) {
        const matched = this.matchPrefix(s, i);
        if (matched) {
          if (orig_i !== null) {
            arr.push(s.slice(orig_i, i));
            orig_i = null;
          }
          arr.push(matched.value);
          i = matched.end;
        } else {
          if (orig_i === null) {
            orig_i = i;
          }
          i += getUnmatchedLength(s, i);
        }
      }
      if (orig_i !== null) {
        arr.push(s.slice(orig_i, n));
      }
      return arr.join("");
    }
  }
  function getCodePointLength(s, i) {
    return s.codePointAt(i) > 65535 ? 2 : 1;
  }
  function getIdeographicDescriptionArity(cp) {
    if (cp >= 12272 && cp <= 12273) return 2;
    if (cp >= 12274 && cp <= 12275) return 3;
    if (cp >= 12276 && cp <= 12287) return 2;
    return 0;
  }
  function getIdeographicDescriptionSequenceEnd(s, i) {
    const cp = s.codePointAt(i);
    const arity = getIdeographicDescriptionArity(cp);
    if (arity === 0) {
      return 0;
    }
    let end = i + getCodePointLength(s, i);
    for (let n = 0; n < arity; n += 1) {
      if (end >= s.length) {
        return 0;
      }
      const childEnd = getIdeographicDescriptionSequenceEnd(s, end);
      end = childEnd || end + getCodePointLength(s, end);
    }
    return end;
  }
  function getUnmatchedLength(s, i) {
    const idsEnd = getIdeographicDescriptionSequenceEnd(s, i);
    if (idsEnd > i) {
      return idsEnd - i;
    }
    return getCodePointLength(s, i);
  }
  function ConverterFactory(...dictGroups) {
    const trieArr = normalizeConverterFactoryDictGroups(dictGroups).map((grp) => {
      const t = new Trie();
      t.loadDictGroup(grp);
      return t;
    });
    function convert(s) {
      return trieArr.reduce((res, t) => {
        return t.convert(res);
      }, s);
    }
    return convert;
  }
  function isDictPair(entry) {
    return Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string";
  }
  function isSerializedDict(dict) {
    return typeof dict === "string" && (dict === "" || dict.includes(" "));
  }
  function isDictLike(dict) {
    return typeof dict === "string" || Array.isArray(dict) && dict.every(isDictPair);
  }
  function isDictGroup(dictGroup) {
    return Array.isArray(dictGroup) && dictGroup.every((dict) => {
      return isSerializedDict(dict) || Array.isArray(dict) && dict.every(isDictPair);
    });
  }
  function isDictGroupCollection(dictGroups) {
    return Array.isArray(dictGroups) && dictGroups.every(isDictGroup);
  }
  function normalizeConverterFactoryDictGroups(dictGroups) {
    return dictGroups.flatMap((dictGroup) => {
      if (isDictGroupCollection(dictGroup)) {
        return dictGroup;
      }
      if (isDictGroup(dictGroup)) {
        return [dictGroup];
      }
      if (!Array.isArray(dictGroup)) {
        throw new TypeError("Invalid ConverterFactory argument: expected a dictionary group or locale dictionary collection.");
      }
      const groups = [];
      let i = 0;
      while (i < dictGroup.length && isDictGroup(dictGroup[i])) {
        groups.push(dictGroup[i].slice());
        i += 1;
      }
      const appendedDicts = dictGroup.slice(i);
      if (groups.length > 0 && appendedDicts.length > 0 && appendedDicts.every(isDictLike)) {
        groups[groups.length - 1].push(...appendedDicts);
        return groups;
      }
      return [dictGroup];
    });
  }
  const OPENCC_CDN_BASE = "https://cdn.jsdelivr.net/npm/opencc-js@1.4.2/dist/esm-lib/dict";
  const DICT_CACHE_PREFIX = "ptr:opencc-dict:";
  const MODE_CHAINS = {
    s2t: [
      ["STPhrases", "STPhrases_GeneratedFromRegionalPhrases", "STCharacters"]
    ],
    s2twp: [
      ["STPhrases", "STPhrases_GeneratedFromRegionalPhrases", "STCharacters"],
      ["TWPhrases", "TWVariantsPhrases", "TWVariants"]
    ],
    t2s: [["TSPhrases", "TSCharacters"]],
    tw2sp: [
      ["TWPhrasesRev", "TWVariantsRevPhrases", "TWVariantsRev"],
      ["TSPhrases", "TSCharacters"]
    ]
  };
  const OFFLINE_S2T = {
    软: "軟",
    体: "體",
    开: "開",
    发: "發",
    译: "譯",
    简: "簡",
    繁: "繁",
    网: "網",
    页: "頁",
    设: "設",
    置: "置",
    语: "語",
    言: "言"
  };
  const OFFLINE_T2S = Object.fromEntries(
    Object.entries(OFFLINE_S2T).map(([s, t]) => [t, s])
  );
  function parseExportedDictModule(source) {
    const trimmed = source.trim();
    if (!trimmed.startsWith("export default")) {
      return trimmed;
    }
    const firstQuote = trimmed.indexOf('"');
    const lastQuote = trimmed.lastIndexOf('"');
    if (firstQuote === -1 || lastQuote <= firstQuote) {
      throw new Error("Invalid OpenCC dictionary module format");
    }
    return JSON.parse(trimmed.slice(firstQuote, lastQuote + 1));
  }
  function defaultFetcher(dictName) {
    return gmFetch(`${OPENCC_CDN_BASE}/${dictName}.js`, 15e3);
  }
  async function loadDictString(dictName, fetcher) {
    const cacheKey = `${DICT_CACHE_PREFIX}${dictName}`;
    try {
      const cached = gmGet(cacheKey, null);
      if (typeof cached === "string" && cached.length > 0) {
        return cached;
      }
    } catch {
    }
    const moduleText = await fetcher(dictName);
    const dict = parseExportedDictModule(moduleText);
    try {
      gmSet(cacheKey, dict);
    } catch {
    }
    return dict;
  }
  function createOfflineFallback(mode) {
    const map = mode === "s2t" || mode === "s2twp" ? OFFLINE_S2T : OFFLINE_T2S;
    return {
      convert(text) {
        let out = "";
        for (const ch of text) {
          out += map[ch] ?? ch;
        }
        return out;
      }
    };
  }
  const converterCache = /* @__PURE__ */ new WeakMap();
  function createOpenCC(mode, fetcher = defaultFetcher) {
    let byMode = converterCache.get(fetcher);
    if (!byMode) {
      byMode = /* @__PURE__ */ new Map();
      converterCache.set(fetcher, byMode);
    }
    const hit = byMode.get(mode);
    if (hit) {
      return hit;
    }
    const promise = (async () => {
      const chainNames = MODE_CHAINS[mode];
      try {
        const groups = await Promise.all(
          chainNames.map(
            async (group) => Promise.all(group.map((name) => loadDictString(name, fetcher)))
          )
        );
        const fn = ConverterFactory(...groups);
        return { convert: fn };
      } catch {
        return createOfflineFallback(mode);
      }
    })();
    byMode.set(mode, promise);
    return promise;
  }
  function createInspectProvider() {
    return {
      id: "inspect",
      translateBatch: (items) => Promise.resolve([...items])
    };
  }
  const MAX_GROUP_ITEMS = 8;
  const MAX_GROUP_CHARS = 2400;
  function createBatchRunner(options) {
    let generation = 0;
    const pageCache = /* @__PURE__ */ new Map();
    const coalesceMs = options.coalesceMs ?? 0;
    let pendingQueue = [];
    let coalesceTimer = null;
    function buildContextGroups(uniqueEntries) {
      const byParent = /* @__PURE__ */ new Map();
      for (const entry of uniqueEntries) {
        const list = byParent.get(entry.parent) ?? [];
        list.push({ id: entry.id, html: entry.maskedPayload });
        byParent.set(entry.parent, list);
      }
      const groups = [];
      for (const items of byParent.values()) {
        let cur = [];
        let curChars = 0;
        for (const item of items) {
          if (cur.length > 0 && (cur.length >= MAX_GROUP_ITEMS || curChars + item.html.length > MAX_GROUP_CHARS)) {
            groups.push(cur);
            cur = [];
            curChars = 0;
          }
          cur.push(item);
          curChars += item.html.length;
        }
        if (cur.length > 0) {
          groups.push(cur);
        }
      }
      return groups;
    }
    async function flushCoalescedQueue() {
      coalesceTimer = null;
      const batch = pendingQueue;
      pendingQueue = [];
      if (batch.length === 0) {
        return;
      }
      const active = batch.filter((entry) => entry.gen === generation);
      for (const stale of batch) {
        if (stale.gen !== generation) {
          stale.resolve();
        }
      }
      if (active.length === 0) {
        return;
      }
      const gen = generation;
      const cfg = active[active.length - 1].cfg;
      const spacingMode = resolveSpacingMode(cfg);
      const postBase = {
        spacingMode,
        punctNorm: cfg.punctNorm,
        debugSpacingMarks: cfg.debugSpacingMarks
      };
      const provider = options.getProvider(cfg);
      const metrics = options.metrics;
      const allJobs = [];
      for (const entry of active) {
        allJobs.push(...entry.jobs);
      }
      const uniquePayloads = [];
      const payloadToIdx = /* @__PURE__ */ new Map();
      const uniqueMeta = [];
      for (const job of allJobs) {
        if (!payloadToIdx.has(job.maskedPayload)) {
          const uIdx = uniquePayloads.length;
          payloadToIdx.set(job.maskedPayload, uIdx);
          uniquePayloads.push(job.maskedPayload);
          uniqueMeta.push({
            id: `u${uIdx}`,
            maskedPayload: job.maskedPayload,
            parent: job.seg.container.parentElement
          });
        }
      }
      if (metrics) {
        metrics.apiTotalJobs += allJobs.length;
        metrics.apiUniquePayloads += uniquePayloads.length;
      }
      const openccPromise = cfg.openccMode !== "off" && options.getOpenCC ? options.getOpenCC(cfg.openccMode) : void 0;
      try {
        const apiStart = Date.now();
        const groups = buildContextGroups(uniqueMeta);
        const hasMultiGroup = groups.some((g) => g.length > 1);
        let translatedByPayloadIdx = /* @__PURE__ */ new Map();
        if (provider.translateGrouped && hasMultiGroup) {
          try {
            const groupedMap = await provider.translateGrouped(groups, {
              targetLang: cfg.targetLang
            });
            for (let i = 0; i < uniqueMeta.length; i++) {
              const val = groupedMap.get(uniqueMeta[i].id);
              if (val !== void 0) {
                translatedByPayloadIdx.set(i, val);
              }
            }
          } catch {
            translatedByPayloadIdx = /* @__PURE__ */ new Map();
          }
        }
        const missingIndices = [];
        const missingPayloads = [];
        for (let i = 0; i < uniquePayloads.length; i++) {
          if (!translatedByPayloadIdx.has(i)) {
            missingIndices.push(i);
            missingPayloads.push(uniquePayloads[i]);
          }
        }
        if (missingPayloads.length > 0) {
          const flatResults = await provider.translateBatch(missingPayloads, {
            targetLang: cfg.targetLang
          });
          for (let k = 0; k < missingIndices.length; k++) {
            const idx = missingIndices[k];
            translatedByPayloadIdx.set(
              idx,
              flatResults[k] ?? uniquePayloads[idx]
            );
          }
        }
        const opencc = openccPromise ? await openccPromise : void 0;
        if (metrics) {
          recordApiBatch(metrics, Date.now() - apiStart);
        }
        if (gen !== generation) {
          for (const entry of active) {
            entry.resolve();
          }
          return;
        }
        for (const job of allJobs) {
          const uIdx = payloadToIdx.get(job.maskedPayload);
          const translated = translatedByPayloadIdx.get(uIdx) ?? job.encoded.payloadHtml;
          pageCache.set(job.cacheKey, translated);
          renderTranslated(
            job.seg,
            translated,
            job.encoded.slots,
            {
              ...postBase,
              opencc: opencc ? (s) => opencc.convert(s) : void 0
            },
            options.doc
          );
        }
        for (const entry of active) {
          entry.resolve();
        }
      } catch (err) {
        if (gen !== generation) {
          for (const entry of active) {
            entry.resolve();
          }
          return;
        }
        console.error("[ptr] translation failed:", err);
        for (const job of allJobs) {
          renderError(job.seg, options.doc);
        }
        for (const entry of active) {
          entry.resolve();
        }
      }
    }
    function enqueueApiJobs(jobs, gen, cfg) {
      if (coalesceMs <= 0) {
        return new Promise((resolve, reject) => {
          pendingQueue.push({ jobs, gen, cfg, resolve, reject });
          void flushCoalescedQueue();
        });
      }
      return new Promise((resolve, reject) => {
        pendingQueue.push({ jobs, gen, cfg, resolve, reject });
        if (coalesceTimer === null) {
          coalesceTimer = setTimeout(() => {
            void flushCoalescedQueue();
          }, coalesceMs);
        }
      });
    }
    async function translateBatch(segments) {
      if (segments.length === 0) {
        return;
      }
      const gen = generation;
      const cfg = options.getConfig();
      const metrics = options.metrics;
      const spacingMode = resolveSpacingMode(cfg);
      const siteTable = options.getSiteLocaleTable?.() ?? null;
      const provider = options.getProvider(cfg);
      if (cfg.debugInspect && cfg.provider === "inspect") {
        for (const seg of segments) {
          const enc = encodeInlineNodes(seg.nodes, options.delta);
          const kind = seg.sourceRule === "+" ? "+" : siteTable && matchSiteTranslation(enc.payloadHtml, siteTable) ? "manual" : extractTemplate(enc.payloadHtml).kind === "dynamic" ? "auto-dynamic" : "auto-static";
          renderInspectMarker(seg, options.doc, { kind, spacingMode });
        }
        return;
      }
      const openccJobs = [];
      const apiJobs = [];
      const immediateHits = [];
      const plainTexts = segments.map(
        (s) => s.nodes.map((n) => n.textContent ?? "").join("").trim()
      );
      const pageKeywords = extractPageKeywords(plainTexts);
      const keywords = [...options.getGlossary?.() ?? [], ...pageKeywords];
      if (metrics) {
        metrics.keywordsSample = [...keywords];
      }
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const plain = plainTexts[i];
        const encoded = encodeInlineNodes(seg.nodes, options.delta);
        const manualHit = matchSiteTranslation(
          encoded.payloadHtml,
          siteTable,
          seg.container
        );
        if (cfg.debugInspect) {
          const kind = seg.sourceRule === "+" ? "+" : manualHit ? "manual" : extractTemplate(encoded.payloadHtml).kind === "dynamic" ? "auto-dynamic" : "auto-static";
          renderInspectMarker(seg, options.doc, { kind, spacingMode });
        }
        const route = routeSegment(plain, cfg.targetLang);
        if (metrics) {
          if (route.action === "skip") {
            metrics.routing.skip += 1;
          } else if (route.action === "opencc") {
            metrics.routing.opencc += 1;
          } else {
            metrics.routing.api += 1;
          }
        }
        if (route.action === "skip") {
          if (cfg.spaceSkippedCjk && spacingMode !== "off") {
            immediateHits.push({
              seg,
              encoded,
              html: encoded.payloadHtml,
              needsOpenCC: false
            });
          }
          continue;
        }
        if (route.action === "opencc") {
          openccJobs.push({ seg, encoded, mode: route.mode });
          continue;
        }
        if (manualHit) {
          if (metrics) {
            metrics.segments.manual += 1;
            if (manualHit.scope) {
              metrics.segments.scopedHits += 1;
            }
          }
          immediateHits.push({
            seg,
            encoded,
            html: manualHit.html,
            needsOpenCC: false
          });
          continue;
        }
        const maskedPayload = provider.id === "inspect" ? encoded.payloadHtml : maskKeywordsInHtml(encoded.payloadHtml, keywords);
        const cacheKey = `${cfg.targetLang}|${provider.id}|${maskedPayload}`;
        const cached = pageCache.get(cacheKey);
        if (cached !== void 0) {
          if (metrics) {
            metrics.cacheHits += 1;
          }
          immediateHits.push({
            seg,
            encoded,
            html: cached,
            needsOpenCC: cfg.openccMode !== "off"
          });
          continue;
        }
        apiJobs.push({ seg, encoded, maskedPayload, cacheKey });
        if (metrics) {
          metrics.cacheMisses += 1;
        }
      }
      const postBase = {
        spacingMode,
        punctNorm: cfg.punctNorm,
        debugSpacingMarks: cfg.debugSpacingMarks
      };
      for (const job of apiJobs) {
        renderPending(job.seg, options.doc);
      }
      const needsImmediateOpenCC = cfg.openccMode !== "off" && Boolean(options.getOpenCC) && immediateHits.some((h) => h.needsOpenCC);
      const immediateConv = needsImmediateOpenCC ? await options.getOpenCC(cfg.openccMode) : void 0;
      if (gen !== generation) {
        return;
      }
      for (const hit of immediateHits) {
        renderPending(hit.seg, options.doc);
        renderTranslated(
          hit.seg,
          hit.html,
          hit.encoded.slots,
          {
            ...postBase,
            ...hit.needsOpenCC && immediateConv ? { opencc: (s) => immediateConv.convert(s) } : {}
          },
          options.doc
        );
      }
      if (openccJobs.length > 0 && options.getOpenCC) {
        const modes = Array.from(new Set(openccJobs.map((j) => j.mode)));
        const convMap = /* @__PURE__ */ new Map();
        const openccInitStart = Date.now();
        await Promise.all(
          modes.map(async (m) => {
            convMap.set(m, await options.getOpenCC(m));
          })
        );
        if (metrics) {
          metrics.openccInitMs = Date.now() - openccInitStart;
        }
        if (gen !== generation) {
          return;
        }
        for (const job of openccJobs) {
          const conv = convMap.get(job.mode);
          renderPending(job.seg, options.doc);
          renderTranslated(
            job.seg,
            job.encoded.payloadHtml,
            job.encoded.slots,
            { ...postBase, opencc: conv ? (s) => conv.convert(s) : void 0 },
            options.doc
          );
        }
      }
      if (apiJobs.length === 0) {
        return;
      }
      await enqueueApiJobs(apiJobs, gen, cfg);
    }
    return {
      translateBatch,
      cancelAll() {
        generation++;
        if (coalesceTimer !== null) {
          clearTimeout(coalesceTimer);
          coalesceTimer = null;
        }
        const cancelled = pendingQueue;
        pendingQueue = [];
        for (const entry of cancelled) {
          entry.resolve();
        }
      },
      clearCache() {
        pageCache.clear();
      }
    };
  }
  const TRANSLATE_PA_ENDPOINT = "https://translate-pa.googleapis.com/v1/translateHtml";
  function escapeAttr(val) {
    return val.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;");
  }
  const GROUPED_ITEM_RE = /<p\b[^>]*\bdata-ptr-s=["']([^"']+)["'][^>]*>([\s\S]*?)<\/p>/giu;
  function parseGroupedResponseHtml(htmlList) {
    const out = /* @__PURE__ */ new Map();
    for (const html of htmlList) {
      GROUPED_ITEM_RE.lastIndex = 0;
      let match = GROUPED_ITEM_RE.exec(html);
      while (match !== null) {
        const id = match[1];
        const inner = match[2];
        if (id !== void 0 && inner !== void 0) {
          out.set(id, inner);
        }
        match = GROUPED_ITEM_RE.exec(html);
      }
    }
    return out;
  }
  function createTranslatePaProvider(options) {
    async function translateBatch(items, opts) {
      if (items.length === 0) {
        return [];
      }
      const payload = [
        [items, opts.sourceLang ?? "auto", opts.targetLang],
        "wt_lib"
      ];
      const res = await gmRequest({
        method: "POST",
        url: TRANSLATE_PA_ENDPOINT,
        headers: {
          "Content-Type": "application/json+protobuf",
          "X-Goog-Api-Key": options.apiKey
        },
        data: JSON.stringify(payload),
        timeout: 25e3
      });
      const parsed = JSON.parse(res.responseText);
      if (!(Array.isArray(parsed) && Array.isArray(parsed[0]))) {
        throw new Error("[ptr] Unexpected translate-pa response shape");
      }
      const translations = parsed[0];
      if (translations.length !== items.length) {
        throw new Error(
          `[ptr] translate-pa count mismatch: expected ${items.length}, got ${translations.length}`
        );
      }
      return translations.map((v) => String(v ?? ""));
    }
    async function translateGrouped(groups, opts) {
      if (groups.length === 0) {
        return /* @__PURE__ */ new Map();
      }
      const payloads = groups.map(
        (group, gIdx) => `<div data-ptr-g="${gIdx}">${group.map(
        (item) => `<p data-ptr-s="${escapeAttr(item.id)}">${item.html}</p>`
      ).join("")}</div>`
      );
      const results = await translateBatch(payloads, opts);
      return parseGroupedResponseHtml(results);
    }
    return {
      id: "translate-pa",
      translateBatch,
      translateGrouped
    };
  }
  const CACHE_PREFIX = "ptr:site-tr:";
  const CACHE_INDEX_KEY = "ptr:site-tr:__index";
  function recordCachedHost(host) {
    const clean = host.toLowerCase().trim();
    if (!clean) {
      return;
    }
    try {
      const prev = gmGet(CACHE_INDEX_KEY, []);
      const list = Array.isArray(prev) ? prev : [];
      if (!list.includes(clean)) {
        gmSet(CACHE_INDEX_KEY, [...list, clean].sort());
      }
    } catch {
    }
  }
  function removeCachedHostFromIndex(host) {
    const clean = host.toLowerCase().trim();
    try {
      const prev = gmGet(CACHE_INDEX_KEY, []);
      if (!Array.isArray(prev)) {
        return;
      }
      gmSet(
        CACHE_INDEX_KEY,
        prev.filter((h) => h !== clean)
      );
    } catch {
    }
  }
  function listCachedSiteTranslations() {
    let hosts = [];
    try {
      const idx = gmGet(CACHE_INDEX_KEY, []);
      if (Array.isArray(idx)) {
        hosts = idx;
      }
    } catch {
      return [];
    }
    const out = [];
    for (const host of hosts) {
      try {
        const entry = gmGet(
          `${CACHE_PREFIX}${host}`,
          null
        );
        if (entry && typeof entry === "object" && entry.locales) {
          out.push(entry);
        }
      } catch {
      }
    }
    return out;
  }
  function saveCachedSiteTranslations(file) {
    const host = file.host.toLowerCase().trim();
    if (!(host && file.locales) || typeof file.locales !== "object") {
      throw new Error("Invalid site translations file: missing host or locales.");
    }
    const normalized = {
      version: Number(file.version) || 1,
      host,
      locales: file.locales
    };
    gmSet(`${CACHE_PREFIX}${host}`, normalized);
    recordCachedHost(host);
  }
  function deleteCachedSiteTranslations(hostname) {
    const host = hostname.toLowerCase().trim();
    if (!host) {
      return;
    }
    gmSet(`${CACHE_PREFIX}${host}`, null);
    removeCachedHostFromIndex(host);
  }
  async function fetchJsonWithCache(url, cacheKey, host, onChange) {
    const cached = gmGet(cacheKey, null);
    const fresh = gmFetch(url, 8e3).then((body) => JSON.parse(body));
    if (cached && typeof cached === "object") {
      recordCachedHost(host);
      void fresh.then((next) => {
        if (JSON.stringify(cached) !== JSON.stringify(next)) {
          gmSet(cacheKey, next);
          recordCachedHost(host);
          onChange?.(next);
        }
      }).catch(() => {
      });
      return cached;
    }
    try {
      const next = await fresh;
      gmSet(cacheKey, next);
      recordCachedHost(host);
      return next;
    } catch {
      return null;
    }
  }
  async function loadSiteTranslations(baseUrl, hostname, onChange) {
    const host = hostname.toLowerCase();
    if (!host) {
      return null;
    }
    const cleanBase = baseUrl.replace(/\/+$/u, "");
    const rootUrl = `${cleanBase}/${encodeURIComponent(host)}.json`;
    const rootFile = await fetchJsonWithCache(
      rootUrl,
      `${CACHE_PREFIX}${host}`,
      host,
      (next) => {
        onChange?.(next);
      }
    );
    if (!rootFile?.locales) {
      return null;
    }
    return rootFile;
  }
  function pickLocaleTable(file, targetLang) {
    if (!file?.locales) {
      return null;
    }
    const exact = file.locales[targetLang];
    if (exact) {
      return exact;
    }
    const lower = targetLang.toLowerCase().replace(/_/gu, "-");
    if (lower === "zh-tw" || lower === "zh-hant") {
      return file.locales["zh-Hant-TW"] ?? file.locales["zh-Hant"] ?? null;
    }
    if (lower === "zh-cn" || lower === "zh-hans") {
      return file.locales["zh-Hans-CN"] ?? file.locales["zh-Hans"] ?? null;
    }
    const base = lower.split("-")[0];
    return base ? file.locales[base] ?? null : null;
  }
  const VOLUNTEER_MENU_ID = "ptr-volunteer";
  const VOLUNTEER_CLICK_MENU_ID = "ptr-volunteer-block-clicks";
  const VOLUNTEER_STYLE_ID = "ptr-vol-style";
  function triggerPulse(btn) {
    btn.classList.remove("flash-done");
    void btn.offsetWidth;
    btn.classList.add("flash-done");
  }
  const volSheetCache = /* @__PURE__ */ new WeakMap();
  function applyVolCss(sr, doc, css) {
    if (typeof CSSStyleSheet !== "undefined" && Array.isArray(sr.adoptedStyleSheets)) {
      try {
        let sheet = volSheetCache.get(sr);
        if (!sheet) {
          sheet = new CSSStyleSheet();
          volSheetCache.set(sr, sheet);
        }
        sheet.replaceSync(css);
        if (!sr.adoptedStyleSheets.includes(sheet)) {
          sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, sheet];
        }
        return;
      } catch {
      }
    }
    let styleEl = sr.getElementById(
      VOLUNTEER_STYLE_ID
    );
    if (!styleEl) {
      styleEl = doc.createElement("style");
      styleEl.id = VOLUNTEER_STYLE_ID;
      sr.prepend(styleEl);
    }
    styleEl.textContent = css;
  }
  function isNonEmptyScopedValue(value) {
    return value.trim() !== "";
  }
  function createVolunteerController(options) {
    let hostEl = null;
    let refs = null;
    let dragController = null;
    let registeredHandle;
    let registeredClickHandle;
    let menuRegistered = false;
    let internalClickBlocked = false;
    const draftStatic = {};
    const draftDynamic = {};
    const draftScoped = {};
    let capturedEntries = [];
    let containerToIndex = /* @__PURE__ */ new WeakMap();
    let staticCount = 0;
    let dynamicCount = 0;
    let hitCount = 0;
    let selectedIdx = 0;
    let lastRenderedIdx = -1;
    let lastRenderedKey = "";
    const prevTexts = /* @__PURE__ */ new Map();
    function tr(key, vars) {
      const raw = options.t ? options.t(key) : MESSAGES_EN[key];
      return formatPtrMsg(raw, vars);
    }
    function setTextFast(el, text) {
      if (!el) {
        return;
      }
      if (prevTexts.get(el) === text) {
        return;
      }
      prevTexts.set(el, text);
      el.textContent = text;
    }
    function isClickBlocked() {
      if (!options.isEnabled()) {
        return false;
      }
      return options.isClickBlocked ? options.isClickBlocked() : internalClickBlocked;
    }
    function setClickBlockedState(next) {
      const resolved = options.isEnabled() ? next : false;
      internalClickBlocked = resolved;
      options.setClickBlocked?.(resolved);
    }
    function getEventCaptureRoot() {
      return options.doc.defaultView ?? options.doc;
    }
    function scanPage() {
      const root = options.doc.body ?? options.doc.documentElement;
      if (!root) {
        return;
      }
      const delta = options.getDelta();
      const table = options.getSiteLocaleTable();
      const segs = collectSegments(
        root,
        delta,
        options.getStyle ? { getStyle: options.getStyle } : void 0
      );
      const nextIndex = /* @__PURE__ */ new WeakMap();
      let nextStatic = 0;
      let nextDyn = 0;
      let nextHits = 0;
      capturedEntries = segs.map((seg, idx) => {
        nextIndex.set(seg.container, idx);
        const encoded = encodeInlineNodes(seg.nodes, delta);
        const ext = extractTemplate(encoded.payloadHtml);
        const matchHit = matchSiteTranslation(
          encoded.payloadHtml,
          table,
          seg.container
        );
        const hit = Boolean(matchHit);
        if (ext.kind === "static") {
          nextStatic += 1;
        } else {
          nextDyn += 1;
        }
        if (hit) {
          nextHits += 1;
        }
        return {
          seg,
          kind: ext.kind,
          key: ext.template,
          values: ext.values,
          hit,
          matchedScope: matchHit?.scope ?? null
        };
      });
      containerToIndex = nextIndex;
      staticCount = nextStatic;
      dynamicCount = nextDyn;
      hitCount = nextHits;
      if (selectedIdx >= capturedEntries.length) {
        selectedIdx = 0;
      }
    }
    function getExportJson() {
      const staticOut = {};
      for (const [k, v] of Object.entries(draftStatic)) {
        if (isNonEmptyScopedValue(v)) {
          staticOut[k] = v;
        }
      }
      const dynamicOut = {};
      for (const [k, v] of Object.entries(draftDynamic)) {
        if (isNonEmptyScopedValue(v)) {
          dynamicOut[k] = v;
        }
      }
      const scopedOut = {};
      for (const [selector, scope] of Object.entries(draftScoped)) {
        const clean = {};
        const scopedStatic = Object.fromEntries(
          Object.entries(scope.static ?? {}).filter(
            ([, v]) => isNonEmptyScopedValue(v)
          )
        );
        const scopedDynamic = Object.fromEntries(
          Object.entries(scope.dynamic ?? {}).filter(
            ([, v]) => isNonEmptyScopedValue(v)
          )
        );
        if (Object.keys(scopedStatic).length > 0) {
          clean.static = scopedStatic;
        }
        if (Object.keys(scopedDynamic).length > 0) {
          clean.dynamic = scopedDynamic;
        }
        if (clean.static || clean.dynamic) {
          scopedOut[selector] = clean;
        }
      }
      return JSON.stringify(
        {
          version: 1,
          host: options.hostname,
          locales: {
            [options.getTargetLang()]: {
              static: staticOut,
              dynamic: dynamicOut,
              ...Object.keys(scopedOut).length > 0 ? { scoped: scopedOut } : {}
            }
          }
        },
        null,
        2
      );
    }
    function exportForAi() {
      return buildAiTranslationExport(options.doc, options.getDelta(), {
        hostname: options.hostname,
        targetLang: options.getTargetLang(),
        getStyle: options.getStyle,
        siteTable: options.getSiteLocaleTable()
      });
    }
    function importAiJson(raw) {
      const parsed = parseAiTranslationImport(raw, options.getTargetLang());
      let applied = 0;
      const entryByKey = /* @__PURE__ */ new Map();
      for (const entry of capturedEntries) {
        if (!entryByKey.has(entry.key)) {
          entryByKey.set(entry.key, entry);
        }
      }
      for (const [k, v] of Object.entries(parsed.static)) {
        const matched = entryByKey.get(k);
        if (matched && matched.kind === "dynamic") {
          draftDynamic[k] = v;
        } else {
          draftStatic[k] = v;
        }
        if (matched && !matched.hit) {
          matched.hit = true;
          hitCount += 1;
        }
        applied += 1;
      }
      for (const [k, v] of Object.entries(parsed.dynamic)) {
        draftDynamic[k] = v;
        const matched = entryByKey.get(k);
        if (matched && !matched.hit) {
          matched.hit = true;
          hitCount += 1;
        }
        applied += 1;
      }
      for (const [selector, sc] of Object.entries(parsed.scoped)) {
        const curScope = draftScoped[selector] ?? {};
        if (sc.static) {
          curScope.static = { ...curScope.static ?? {}, ...sc.static };
          applied += Object.keys(sc.static).length;
        }
        if (sc.dynamic) {
          curScope.dynamic = { ...curScope.dynamic ?? {}, ...sc.dynamic };
          applied += Object.keys(sc.dynamic).length;
        }
        draftScoped[selector] = curScope;
      }
      lastRenderedIdx = -1;
      lastRenderedKey = "";
      patchPanel();
      return { applied };
    }
    function syncClickBlockButton() {
      if (!refs) {
        return;
      }
      const blocked = isClickBlocked();
      setTextFast(refs.blockClicksBtn, tr(blocked ? "volLockOn" : "volLockOff"));
      refs.blockClicksBtn.setAttribute(
        "aria-pressed",
        blocked ? "true" : "false"
      );
      refs.blockClicksBtn.disabled = !options.isEnabled();
    }
    function updateStats() {
      if (!refs) {
        return;
      }
      setTextFast(refs.statStaticEl, String(staticCount));
      setTextFast(refs.statDynEl, String(dynamicCount));
      setTextFast(refs.statHitsEl, String(hitCount));
    }
    function patchPanel() {
      if (!(hostEl?.shadowRoot && refs)) {
        return;
      }
      const sr = hostEl.shadowRoot;
      setTextFast(refs.titleEl, tr("volTitle", { host: options.hostname }));
      updateStats();
      setTextFast(refs.dlBtn, tr("volDownload", { host: options.hostname }));
      const cur = capturedEntries[selectedIdx];
      if (cur) {
        refs.editorEl.hidden = false;
        refs.emptyEl.hidden = true;
        setTextFast(
          refs.badgeTextEl,
          tr(cur.kind === "dynamic" ? "volBadgeDynamic" : "volBadgeStatic")
        );
        refs.badgeDotEl.className = `us-dot ${cur.kind === "dynamic" ? "dyn" : "static"}`;
        setTextFast(refs.posEl, `#${selectedIdx + 1}/${capturedEntries.length}`);
        setTextFast(
          refs.valuesEl,
          cur.values.length ? `${tr("volValues")}: ${cur.values.join(", ")}` : ""
        );
        setTextFast(refs.keyEl, cur.key);
        const targetLang = options.getTargetLang();
        refs.valInput.placeholder = tr("volTransPlaceholder", {
          lang: targetLang
        });
        const selectionChanged = selectedIdx !== lastRenderedIdx || cur.key !== lastRenderedKey;
        const table = options.getSiteLocaleTable();
        const suggestedScope = cur.matchedScope ?? suggestScopeSelector(cur.seg.container);
        if ((selectionChanged || sr.activeElement !== refs.scopeInput) && (selectionChanged || !refs.scopeInput.value)) {
          refs.scopeInput.value = suggestedScope;
        }
        if (selectionChanged || sr.activeElement !== refs.valInput) {
          const activeScope = refs.scopeInput.value.trim();
          const scopedSaved = activeScope ? cur.kind === "static" ? draftScoped[activeScope]?.static?.[cur.key] ?? table?.scoped?.[activeScope]?.static?.[cur.key] : draftScoped[activeScope]?.dynamic?.[cur.key] ?? table?.scoped?.[activeScope]?.dynamic?.[cur.key] : void 0;
          const savedOrTable = scopedSaved ?? (cur.kind === "static" ? draftStatic[cur.key] ?? table?.static?.[cur.key] : draftDynamic[cur.key] ?? table?.dynamic?.[cur.key]);
          const hasPlaceholder = cur.kind === "dynamic" || /<x\s+id="\d+"/u.test(cur.key);
          refs.valInput.value = savedOrTable ?? (hasPlaceholder ? cur.key : "");
        }
        lastRenderedIdx = selectedIdx;
        lastRenderedKey = cur.key;
      } else {
        refs.editorEl.hidden = true;
        refs.emptyEl.hidden = false;
        lastRenderedIdx = -1;
        lastRenderedKey = "";
      }
      syncClickBlockButton();
    }
    function syncClickBlockMenu() {
      if (!menuRegistered) {
        return;
      }
      if (registeredClickHandle !== void 0) {
        gmUnregisterMenuCommand(registeredClickHandle);
        registeredClickHandle = void 0;
      }
      if (!options.isEnabled()) {
        return;
      }
      const blocked = isClickBlocked();
      const caption = options.formatClickBlockLabel ? options.formatClickBlockLabel(blocked) : tr("volunteerBlockClicks", { state: tr(blocked ? "on" : "off") });
      const handle = gmMenuCommand(caption, toggleClickBlock, {
        id: VOLUNTEER_CLICK_MENU_ID
      });
      registeredClickHandle = handle ?? VOLUNTEER_CLICK_MENU_ID;
    }
    function toggleClickBlock() {
      if (!options.isEnabled()) {
        return;
      }
      const next = !isClickBlocked();
      setClickBlockedState(next);
      syncClickBlockButton();
      setTextFast(refs?.msgEl, tr(next ? "volLockOnMsg" : "volLockOffMsg"));
      syncClickBlockMenu();
    }
    function onPageBlockedEvent(e) {
      if (!(options.isEnabled() && isClickBlocked())) {
        return;
      }
      if (isUsUiEvent(e, hostEl)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    }
    function onPageClick(e) {
      if (!options.isEnabled()) {
        return;
      }
      if (isUsUiEvent(e, hostEl)) {
        return;
      }
      const target = e.target;
      if (!target) {
        return;
      }
      if (isClickBlocked()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
      }
      let walk = target;
      while (walk) {
        const match = containerToIndex.get(walk);
        if (match !== void 0) {
          selectedIdx = match;
          patchPanel();
          return;
        }
        walk = walk.parentElement;
      }
    }
    function buildVolCss(hostTokens) {
      return `${getSharedPanelCss(hostTokens)}
:host {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  pointer-events: none;
}
.ptr-vol {
  width: 386px;
  pointer-events: auto;
}
.vol-meta { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 6px; }
.vol-badge { font-weight: 600; }
.box {
  background: var(--us-surface);
  padding: 7px 9px;
  border-radius: var(--us-radius-sm);
  word-break: break-word;
  max-height: 64px;
  overflow-y: auto;
  contain: layout paint;
  font-family: var(--us-mono);
  font-size: 11.5px;
}
.field-row { display: grid; grid-template-columns: 52px 1fr auto; gap: 6px; align-items: center; margin-top: 6px; }
.field-row-2 { display: grid; grid-template-columns: 52px 1fr; gap: 6px; align-items: center; margin-top: 6px; }
.field-lbl { font-size: 11.5px; color: var(--us-muted); }
.row-between { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.msg { color: var(--us-muted); font-size: 11.5px; margin-top: 6px; word-break: break-word; }
.import-box { margin-top: 8px; display: grid; gap: 6px; }`;
    }
    function syncThemeOnVol() {
      if (!hostEl?.shadowRoot) {
        return;
      }
      const mode = options.getThemeMode?.() ?? "system";
      const hostColors = mode === "host" ? probeHostColors(options.doc) : null;
      const hostTokens = mode === "host" ? resolveThemeTokens("host", hostColors) : null;
      applyThemeModeToElement(hostEl, mode, hostColors);
      applyVolCss(hostEl.shadowRoot, options.doc, buildVolCss(hostTokens));
    }
    function mount() {
      if (hostEl) {
        syncThemeOnVol();
        return;
      }
      hostEl = options.doc.createElement("div");
      hostEl.setAttribute("data-ptr-ui", "1");
      markUiRoot(hostEl, "ptr");
      const sr = hostEl.attachShadow({ mode: "open" });
      const mode = options.getThemeMode?.() ?? "system";
      const hostColors = mode === "host" ? probeHostColors(options.doc) : null;
      const hostTokens = mode === "host" ? resolveThemeTokens("host", hostColors) : null;
      applyThemeModeToElement(hostEl, mode, hostColors);
      applyVolCss(sr, options.doc, buildVolCss(hostTokens));
      const tpl = options.doc.createElement("template");
      tpl.innerHTML = `
<aside class="us-panel ptr-vol" id="ptr-v-aside" aria-label="${tr("volTitle", { host: options.hostname })}">
  <div class="us-panel-head" id="ptr-v-head">
    <span class="drag-title">
      <svg class="drag-grip" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="3" r="1.1"/><circle cx="8.5" cy="3" r="1.1"/><circle cx="3.5" cy="8" r="1.1"/><circle cx="8.5" cy="8" r="1.1"/><circle cx="3.5" cy="13" r="1.1"/><circle cx="8.5" cy="13" r="1.1"/></svg>
      <span id="ptr-v-title"></span>
    </span>
    <div class="us-btn-group">
      <button id="ptr-v-block-clicks" class="ptr-btn us-btn-sm" type="button" aria-pressed="false"></button>
      <button id="ptr-v-rescan" class="ptr-btn us-btn-sm" type="button"></button>
    </div>
  </div>
  <div class="us-panel-sec">
    <div class="us-stat-strip">
      <div class="us-stat-cell">
        <span class="us-stat-val" id="ptr-v-stat-static">0</span>
        <span class="us-stat-label" id="ptr-v-lbl-static"></span>
      </div>
      <div class="us-stat-cell">
        <span class="us-stat-val" id="ptr-v-stat-dyn">0</span>
        <span class="us-stat-label" id="ptr-v-lbl-dyn"></span>
      </div>
      <div class="us-stat-cell">
        <span class="us-stat-val" id="ptr-v-stat-hits">0</span>
        <span class="us-stat-label" id="ptr-v-lbl-hits"></span>
      </div>
    </div>
  </div>
  <div class="us-panel-sec" id="ptr-v-editor" hidden>
    <div class="vol-meta">
      <span class="ptr-chip vol-badge" id="ptr-v-badge"><i class="us-dot static" id="ptr-v-badge-dot"></i><span id="ptr-v-badge-text"></span> <span class="ptr-mono" id="ptr-v-pos"></span></span>
      <span class="ptr-muted ptr-mono" id="ptr-v-values"></span>
    </div>
    <div class="box" id="ptr-v-key"></div>
    <div class="field-row">
      <span class="field-lbl" id="ptr-v-lbl-scope"></span>
      <input id="ptr-v-scope" class="ptr-input ptr-mono" type="text" />
      <button id="ptr-v-suggest-scope" class="ptr-btn us-btn-sm" type="button"></button>
    </div>
    <div class="field-row-2">
      <span class="field-lbl" id="ptr-v-lbl-trans"></span>
      <input id="ptr-v-val" class="ptr-input" type="text" />
    </div>
    <div class="row-between">
      <div class="us-btn-group">
        <button id="ptr-v-prev" class="ptr-btn us-btn-sm" type="button"></button>
        <button id="ptr-v-next" class="ptr-btn us-btn-sm" type="button"></button>
      </div>
      <button id="ptr-v-save" class="ptr-btn ptr-btn-primary us-btn-sm" type="button"></button>
    </div>
  </div>
  <div class="us-panel-sec ptr-muted" id="ptr-v-empty" hidden></div>
  <div class="us-panel-sec">
    <div class="row-between" style="margin-top:0">
      <div class="us-btn-group">
        <button id="ptr-v-copy" class="ptr-btn us-btn-sm" type="button"></button>
        <button id="ptr-v-dl" class="ptr-btn us-btn-sm" type="button"></button>
      </div>
      <div class="us-btn-group">
        <button id="ptr-v-export-ai" class="ptr-btn us-btn-sm" type="button"></button>
        <button id="ptr-v-import-toggle" class="ptr-btn us-btn-sm" type="button"></button>
      </div>
    </div>
    <div class="import-box" id="ptr-v-import-box" hidden>
      <textarea id="ptr-v-import-input" class="ptr-input" rows="3"></textarea>
      <div class="row-between" style="margin-top:0">
        <button id="ptr-v-import-cancel" class="ptr-btn us-btn-sm" type="button"></button>
        <button id="ptr-v-import-apply" class="ptr-btn ptr-btn-primary us-btn-sm" type="button"></button>
      </div>
    </div>
    <div class="msg" id="ptr-v-msg"></div>
  </div>
</aside>`;
      sr.appendChild(tpl.content.cloneNode(true));
      const get = (id) => sr.getElementById(id);
      setTextFast(get("ptr-v-rescan"), tr("volRescan"));
      setTextFast(get("ptr-v-lbl-static"), tr("volStatStatic"));
      setTextFast(get("ptr-v-lbl-dyn"), tr("volStatDynamic"));
      setTextFast(get("ptr-v-lbl-hits"), tr("volStatHits"));
      setTextFast(get("ptr-v-lbl-scope"), tr("volScope"));
      setTextFast(get("ptr-v-lbl-trans"), tr("volTrans"));
      setTextFast(get("ptr-v-suggest-scope"), tr("volSuggest"));
      setTextFast(get("ptr-v-prev"), tr("volPrev"));
      setTextFast(get("ptr-v-next"), tr("volNext"));
      setTextFast(get("ptr-v-save"), tr("volSave"));
      setTextFast(get("ptr-v-empty"), tr("volEmpty"));
      setTextFast(get("ptr-v-copy"), tr("volCopyJson"));
      setTextFast(get("ptr-v-export-ai"), tr("volExportAi"));
      setTextFast(get("ptr-v-import-toggle"), tr("volImportAi"));
      setTextFast(get("ptr-v-import-cancel"), tr("volImportCancel"));
      setTextFast(get("ptr-v-import-apply"), tr("volImportApply"));
      setTextFast(get("ptr-v-msg"), tr("volDraftReady"));
      const scopeInput = get("ptr-v-scope");
      scopeInput.placeholder = tr("volScopePlaceholder");
      scopeInput.setAttribute("aria-label", tr("volScopePlaceholder"));
      const importInput = get("ptr-v-import-input");
      importInput.placeholder = tr("volImportPlaceholder");
      refs = {
        asideEl: get("ptr-v-aside"),
        headEl: get("ptr-v-head"),
        titleEl: get("ptr-v-title"),
        statStaticEl: get("ptr-v-stat-static"),
        statDynEl: get("ptr-v-stat-dyn"),
        statHitsEl: get("ptr-v-stat-hits"),
        editorEl: get("ptr-v-editor"),
        emptyEl: get("ptr-v-empty"),
        badgeDotEl: get("ptr-v-badge-dot"),
        badgeTextEl: get("ptr-v-badge-text"),
        posEl: get("ptr-v-pos"),
        valuesEl: get("ptr-v-values"),
        keyEl: get("ptr-v-key"),
        scopeInput,
        suggestBtn: get("ptr-v-suggest-scope"),
        valInput: get("ptr-v-val"),
        prevBtn: get("ptr-v-prev"),
        nextBtn: get("ptr-v-next"),
        saveBtn: get("ptr-v-save"),
        blockClicksBtn: get("ptr-v-block-clicks"),
        rescanBtn: get("ptr-v-rescan"),
        copyBtn: get("ptr-v-copy"),
        dlBtn: get("ptr-v-dl"),
        exportAiBtn: get("ptr-v-export-ai"),
        importToggleBtn: get("ptr-v-import-toggle"),
        importBoxEl: get("ptr-v-import-box"),
        importInput,
        importApplyBtn: get("ptr-v-import-apply"),
        importCancelBtn: get("ptr-v-import-cancel"),
        msgEl: get("ptr-v-msg")
      };
      refs.blockClicksBtn.addEventListener("click", toggleClickBlock);
      refs.rescanBtn.addEventListener("click", () => {
        if (refs) {
          triggerPulse(refs.rescanBtn);
        }
        scanPage();
        patchPanel();
      });
      refs.prevBtn.addEventListener("click", () => {
        if (capturedEntries.length > 0) {
          selectedIdx = (selectedIdx - 1 + capturedEntries.length) % capturedEntries.length;
          patchPanel();
        }
      });
      refs.nextBtn.addEventListener("click", () => {
        if (capturedEntries.length > 0) {
          selectedIdx = (selectedIdx + 1) % capturedEntries.length;
          patchPanel();
        }
      });
      refs.suggestBtn.addEventListener("click", () => {
        if (!refs) {
          return;
        }
        triggerPulse(refs.suggestBtn);
        const cur = capturedEntries[selectedIdx];
        refs.scopeInput.value = cur ? suggestScopeSelector(cur.seg.container) : "";
      });
      refs.saveBtn.addEventListener("click", () => {
        if (!refs) {
          return;
        }
        const cur = capturedEntries[selectedIdx];
        if (!cur) {
          return;
        }
        triggerPulse(refs.saveBtn);
        const val = refs.valInput.value;
        const scopeSel = refs.scopeInput.value.trim();
        if (scopeSel) {
          const scope = draftScoped[scopeSel] ?? {};
          if (cur.kind === "static") {
            scope.static = { ...scope.static ?? {}, [cur.key]: val };
          } else {
            scope.dynamic = { ...scope.dynamic ?? {}, [cur.key]: val };
          }
          draftScoped[scopeSel] = scope;
        } else if (cur.kind === "static") {
          draftStatic[cur.key] = val;
        } else {
          draftDynamic[cur.key] = val;
        }
        const wasHit = cur.hit;
        cur.hit = val.trim() !== "";
        if (cur.hit !== wasHit) {
          hitCount += cur.hit ? 1 : -1;
          updateStats();
        }
        const preview = cur.kind === "dynamic" ? interpolateTemplate(val, cur.values) : val;
        setTextFast(
          refs.msgEl,
          scopeSel ? tr("volSavedScoped", { scope: scopeSel, preview }) : tr("volSaved", { preview })
        );
      });
      refs.copyBtn.addEventListener("click", async () => {
        if (!refs) {
          return;
        }
        triggerPulse(refs.copyBtn);
        const json = getExportJson();
        try {
          await navigator.clipboard.writeText(json);
          setTextFast(refs.msgEl, tr("volCopied"));
        } catch {
          setTextFast(refs.msgEl, tr("volCopyDenied"));
        }
      });
      refs.dlBtn.addEventListener("click", () => {
        if (refs) {
          triggerPulse(refs.dlBtn);
        }
        const json = getExportJson();
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = options.doc.createElement("a");
        a.href = url;
        a.download = `${options.hostname}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
      refs.exportAiBtn.addEventListener("click", async () => {
        if (!refs) {
          return;
        }
        triggerPulse(refs.exportAiBtn);
        const bundle = exportForAi();
        try {
          await navigator.clipboard.writeText(bundle.prompt);
          setTextFast(refs.msgEl, tr("hudExportedAi", { count: bundle.count }));
        } catch {
          const blob = new Blob([bundle.prompt], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const a = options.doc.createElement("a");
          a.href = url;
          a.download = `${options.hostname}-ai-export.md`;
          a.click();
          URL.revokeObjectURL(url);
          setTextFast(refs.msgEl, tr("hudExportDenied"));
        }
      });
      refs.importToggleBtn.addEventListener("click", () => {
        if (!refs) {
          return;
        }
        refs.importBoxEl.hidden = !refs.importBoxEl.hidden;
      });
      refs.importCancelBtn.addEventListener("click", () => {
        if (refs) {
          refs.importBoxEl.hidden = true;
        }
      });
      refs.importApplyBtn.addEventListener("click", () => {
        if (!refs) {
          return;
        }
        try {
          const { applied } = importAiJson(refs.importInput.value);
          refs.importInput.value = "";
          refs.importBoxEl.hidden = true;
          triggerPulse(refs.importApplyBtn);
          setTextFast(refs.msgEl, tr("volImported", { count: applied }));
        } catch {
          setTextFast(refs.msgEl, tr("volImportError"));
        }
      });
      dragController?.destroy();
      dragController = createDragController({
        panel: hostEl,
        handle: refs.headEl,
        stage: null
      });
      (options.doc.body ?? options.doc.documentElement).appendChild(hostEl);
      const captureRoot = getEventCaptureRoot();
      captureRoot.addEventListener("click", onPageClick, true);
      captureRoot.addEventListener("auxclick", onPageBlockedEvent, true);
      captureRoot.addEventListener("submit", onPageBlockedEvent, true);
      scanPage();
      patchPanel();
    }
    function unmount() {
      const captureRoot = getEventCaptureRoot();
      captureRoot.removeEventListener("click", onPageClick, true);
      captureRoot.removeEventListener("auxclick", onPageBlockedEvent, true);
      captureRoot.removeEventListener("submit", onPageBlockedEvent, true);
      dragController?.destroy();
      dragController = null;
      hostEl?.remove();
      hostEl = null;
      refs = null;
      prevTexts.clear();
      lastRenderedIdx = -1;
      lastRenderedKey = "";
      if (menuRegistered && registeredClickHandle !== void 0) {
        gmUnregisterMenuCommand(registeredClickHandle);
        registeredClickHandle = void 0;
      }
    }
    function syncFromConfig() {
      if (options.isEnabled()) {
        mount();
        scanPage();
        patchPanel();
      } else {
        setClickBlockedState(false);
        unmount();
      }
      syncClickBlockMenu();
    }
    function registerMenu() {
      menuRegistered = true;
      const caption = options.formatLabel ? options.formatLabel(options.isEnabled()) : tr("volunteerMode", { state: tr(options.isEnabled() ? "on" : "off") });
      if (registeredHandle !== void 0 && registeredHandle !== VOLUNTEER_MENU_ID) {
        gmUnregisterMenuCommand(registeredHandle);
      }
      const handle = gmMenuCommand(caption, toggle, { id: VOLUNTEER_MENU_ID });
      registeredHandle = handle ?? caption;
      syncClickBlockMenu();
    }
    function toggle() {
      const nextEnabled = !options.isEnabled();
      options.setEnabled(nextEnabled);
      if (!nextEnabled) {
        setClickBlockedState(false);
      }
      syncFromConfig();
      registerMenu();
    }
    return {
      syncFromConfig,
      refreshTheme: syncThemeOnVol,
      registerMenu,
      toggle,
      toggleClickBlock,
      isClickBlocked,
      getExportJson,
      exportForAi,
      importAiJson,
      refresh() {
        if (options.isEnabled()) {
          scanPage();
          patchPanel();
        }
      },
      stop: unmount
    };
  }
  configureGmApi({
    GM_addStyle: _GM_addStyle,
    GM_xmlhttpRequest: _GM_xmlhttpRequest,
    GM_getValue: _GM_getValue,
    GM_setValue: _GM_setValue,
    GM_registerMenuCommand: _GM_registerMenuCommand,
    GM_unregisterMenuCommand: _GM_unregisterMenuCommand
  });
  publishPresence({
    id: "ptr",
    name: "Page Translator",
    description: "Tag-free automatic web page translator with custom CSS presentation, CJK spacing, and Traditional/Simplified conversion.",
    localeUrl: "https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/page-translator/dist/locales.json"
  });
  const ON_MANAGER = isManagerPage();
  const knownShadowRoots = /* @__PURE__ */ new Set();
  const TAB_ACTIVE_KEY = "ptr:tab-active";
  function readTabActive() {
    try {
      return sessionStorage.getItem(TAB_ACTIVE_KEY) === "1";
    } catch {
      return false;
    }
  }
  function persistTabActive(active) {
    try {
      sessionStorage.setItem(TAB_ACTIVE_KEY, active ? "1" : "0");
    } catch {
    }
  }
  function buildStyleOpts(cfg = loadConfig()) {
    return {
      customCss: cfg.customCss,
      customFont: cfg.customFont,
      debugInspect: cfg.debugInspect,
      spacingMode: resolveSpacingMode(cfg)
    };
  }
  function syncAllStyles(cfg = loadConfig()) {
    syncStylesheet(document, buildStyleOpts(cfg), knownShadowRoots);
  }
  let onThemeUpdated = null;
  window.addEventListener("userscript:settings", (event) => {
    const detail = event.detail;
    if (detail?.lang) {
      gmSet("lang", detail.lang);
    }
    const ptrPatch = detail?.ptr ? { ...detail.ptr } : detail?.themeMode ? { themeMode: detail.themeMode } : void 0;
    if (ptrPatch) {
      const next = saveConfig(ptrPatch);
      if (!ON_MANAGER) {
        syncAllStyles(next);
        onThemeUpdated?.();
      }
    }
  });
  if (ON_MANAGER) {
    window.addEventListener("userscript:ptr-request-config", () => {
      window.dispatchEvent(
        new CustomEvent("userscript:ptr-config", { detail: loadConfig() })
      );
    });
    window.addEventListener("userscript:ptr-request-dicts", () => {
      window.dispatchEvent(
        new CustomEvent("userscript:ptr-dicts", {
          detail: listCachedSiteTranslations()
        })
      );
    });
    window.addEventListener("userscript:ptr-save-dict", (event) => {
      const file = event.detail;
      if (!file) {
        return;
      }
      try {
        saveCachedSiteTranslations(file);
        window.dispatchEvent(
          new CustomEvent("userscript:ptr-dicts", {
            detail: listCachedSiteTranslations()
          })
        );
      } catch {
      }
    });
    window.addEventListener("userscript:ptr-delete-dict", (event) => {
      const host = event.detail?.host;
      if (!host) {
        return;
      }
      deleteCachedSiteTranslations(host);
      window.dispatchEvent(
        new CustomEvent("userscript:ptr-dicts", {
          detail: listCachedSiteTranslations()
        })
      );
    });
  } else {
    boot();
  }
  async function boot() {
    let remoteDeltas = EMPTY_REMOTE_DELTAS;
    let siteTranslations = null;
    const [i18n, loadedDeltas, loadedSiteTr] = await Promise.all([
      createI18n({
        source: { scriptId: "ptr", url: "https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/page-translator/dist/locales.json" },
        fallback: MESSAGES_EN
      }),
      loadRemoteDeltas("https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/page-translator/deltas.json", (next) => {
        remoteDeltas = next;
      }),
      loadSiteTranslations("https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/page-translator/translations", location.hostname, (next) => {
        siteTranslations = next;
      })
    ]);
    remoteDeltas = loadedDeltas;
    siteTranslations = loadedSiteTr;
    const metrics = createPtrMetrics();
    function syncDictMetrics() {
      metrics.dictLoaded = siteTranslations !== null;
      const table = getActiveLocaleTable();
      if (table) {
        metrics.dictCounts = {
          static: Object.keys(table.static ?? {}).length,
          dynamic: Object.keys(table.dynamic ?? {}).length,
          scoped: Object.keys(table.scoped ?? {}).length
        };
      }
    }
    function refreshSiteTranslations() {
      loadSiteTranslations("https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/page-translator/translations", location.hostname, (next) => {
        siteTranslations = next;
        syncDictMetrics();
      }).then((refreshed) => {
        if (refreshed) {
          siteTranslations = refreshed;
          syncDictMetrics();
        }
      });
    }
    syncDictMetrics();
    let activeObserver = null;
    let activeRunner = null;
    let translationActive = false;
    function resolveCurrentDelta() {
      const cfg = loadConfig();
      return resolveSiteDeltaForHost(
        location.hostname,
        cfg.siteDeltas,
        remoteDeltas.sites
      );
    }
    function getActiveLocaleTable() {
      return pickLocaleTable(siteTranslations, loadConfig().targetLang);
    }
    function registerShadowRoots(roots) {
      const added = [];
      for (const sr of roots) {
        if (!knownShadowRoots.has(sr)) {
          knownShadowRoots.add(sr);
          added.push(sr);
        }
      }
      if (added.length > 0) {
        syncShadowRootsOnly(document, buildStyleOpts(), added);
      }
    }
    function pruneDisconnectedShadowRoots() {
      for (const sr of knownShadowRoots) {
        if (!sr.host.isConnected) {
          knownShadowRoots.delete(sr);
        }
      }
    }
    function startTranslation() {
      stopTranslation(false);
      translationActive = true;
      const cfg = loadConfig();
      syncAllStyles(cfg);
      const delta = resolveCurrentDelta();
      metrics.deltaCounts = {
        add: delta.addSelectors.length,
        remove: delta.removeSelectors.length,
        mod: delta.modRules.length
      };
      probeChromeLanguageDetector().then((status) => {
        metrics.languageDetectorStatus = status;
      });
      const root = document.body ?? document.documentElement;
      activeRunner = createBatchRunner({
        doc: document,
        delta,
        coalesceMs: 25,
        getConfig: loadConfig,
        getProvider: (c) => c.provider === "inspect" ? createInspectProvider() : createTranslatePaProvider({ apiKey: c.translatePaApiKey }),
        getOpenCC: (mode) => createOpenCC(mode),
        getGlossary: () => remoteDeltas.glossary,
        getSiteLocaleTable: getActiveLocaleTable,
        metrics
      });
      const runner = activeRunner;
      activeObserver = createViewportObserver({
        root,
        delta,
        metrics,
        onShadowRoots: registerShadowRoots,
        onVisibleSegments(segs) {
          runner.translateBatch(segs);
        }
      });
      activeObserver.scan(root);
      persistTabActive(true);
    }
    function stopTranslation(clearActiveFlag = true) {
      if (clearActiveFlag) {
        translationActive = false;
        persistTabActive(false);
      }
      activeRunner?.cancelAll();
      activeRunner = null;
      activeObserver?.stop();
      activeObserver = null;
      restoreAll(document);
      for (const sr of knownShadowRoots) {
        restoreAll(sr);
      }
    }
    const inspectController = createInspectController({
      doc: document,
      hostname: location.hostname,
      metrics,
      t: i18n.t,
      getThemeMode: () => loadConfig().themeMode,
      getTargetLang: () => loadConfig().targetLang,
      getDelta: resolveCurrentDelta,
      isEnabled: () => loadConfig().debugInspect,
      setEnabled: (next) => {
        saveConfig({ debugInspect: next });
      },
      formatLabel: (on) => formatPtrMsg(i18n.t("inspectMode"), {
        state: i18n.t(on ? "on" : "off")
      }),
      onAfterChange: () => syncAllStyles(),
      onShadowRoots: registerShadowRoots,
      getSiteLocaleTable: getActiveLocaleTable,
      getSpacingMode: () => resolveSpacingMode(loadConfig()),
      getPunctNorm: () => loadConfig().punctNorm
    });
    const volunteerController = createVolunteerController({
      doc: document,
      hostname: location.hostname,
      pathname: location.pathname,
      t: i18n.t,
      getThemeMode: () => loadConfig().themeMode,
      getTargetLang: () => loadConfig().targetLang,
      getDelta: resolveCurrentDelta,
      getSiteLocaleTable: getActiveLocaleTable,
      isEnabled: () => loadConfig().volunteerMode,
      setEnabled: (next) => {
        saveConfig({
          volunteerMode: next,
          ...next ? {} : { volunteerBlockClicks: false }
        });
      },
      formatLabel: (on) => formatPtrMsg(i18n.t("volunteerMode"), {
        state: i18n.t(on ? "on" : "off")
      }),
      isClickBlocked: () => loadConfig().volunteerBlockClicks,
      setClickBlocked: (next) => {
        saveConfig({ volunteerBlockClicks: next });
      },
      formatClickBlockLabel: (blocked) => formatPtrMsg(i18n.t("volunteerBlockClicks"), {
        state: i18n.t(blocked ? "on" : "off")
      })
    });
    onThemeUpdated = () => {
      inspectController.refreshTheme();
      volunteerController.refreshTheme();
    };
    syncAllStyles();
    inspectController.syncFromConfig();
    volunteerController.syncFromConfig();
    watchSpaNavigation({
      win: typeof _unsafeWindow === "undefined" ? window : _unsafeWindow,
      onBeforeLeave() {
        const wasActive = translationActive;
        stopTranslation(false);
        translationActive = wasActive;
        inspectController.stop();
      },
      onSettled() {
        pruneDisconnectedShadowRoots();
        syncAllStyles();
        inspectController.syncFromConfig();
        volunteerController.refresh();
        if (translationActive || loadConfig().autoTranslate) {
          startTranslation();
        }
        refreshSiteTranslations();
      }
    });
    gmMenuCommand(i18n.t("translatePage"), startTranslation);
    gmMenuCommand(i18n.t("restorePage"), () => stopTranslation(true));
    inspectController.registerMenu();
    volunteerController.registerMenu();
    gmMenuCommand(i18n.t("openSettings"), () => {
      window.open(`${MANAGER_URL}/settings/translate/`, "_blank", "noopener");
    });
    if (loadConfig().autoTranslate || readTabActive()) {
      startTranslation();
    }
  }

})();