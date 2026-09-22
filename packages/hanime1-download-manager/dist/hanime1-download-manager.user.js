// ==UserScript==
// @name         Hanime1 Download Manager
// @namespace    Violentmonkey Scripts
// @version      1.0.0
// @author       https://github.com/OG-Open-Source/UserScripts
// @description  Replace download links with a native-style quality menu, batch download mode, and in-page downloads without leaving the page. Languages: 繁體中文 / 简体中文 / English.
// @icon         https://vdownload.hembed.com/image/icon/nav_logo.png?secure=HxkFdqiVxMMXXjau9riwGg==,4855471889
// @downloadURL  https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/hanime1-download-manager/dist/hanime1-download-manager.user.js
// @updateURL    https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/hanime1-download-manager/dist/hanime1-download-manager.meta.js
// @match        *://hanime1.com/*
// @match        *://hanime1.me/*
// @match        *://hanimeone.com/*
// @match        *://hanimeone.me/*
// @connect      hanime1.com
// @connect      hanime1.me
// @connect      hanimeone.com
// @connect      hanimeone.me
// @connect      vdownload.hembed.com
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var _GM_download = /* @__PURE__ */ (() => typeof GM_download != "undefined" ? GM_download : void 0)();
  var _GM_getValue = /* @__PURE__ */ (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
  var _GM_registerMenuCommand = /* @__PURE__ */ (() => typeof GM_registerMenuCommand != "undefined" ? GM_registerMenuCommand : void 0)();
  var _GM_setValue = /* @__PURE__ */ (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
  var _GM_xmlhttpRequest = /* @__PURE__ */ (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
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
  function gmFetch(url, timeout = 2e4) {
    return new Promise((resolve, reject) => {
      const details = {
        method: "GET",
        url,
        timeout,
        onload: (res) => {
          if (res.status >= 200 && res.status < 400) resolve(res.responseText);
          else reject(new Error("HTTP " + res.status));
        },
        onerror: () => reject(new Error("network error")),
        ontimeout: () => reject(new Error("timeout"))
      };
      getApi().GM_xmlhttpRequest(details);
    });
  }
  function gmGet(key, defaultValue) {
    return getApi().GM_getValue(key, defaultValue);
  }
  function gmSet(key, value) {
    getApi().GM_setValue(key, value);
  }
  function gmMenuCommand(caption, onClick) {
    getApi().GM_registerMenuCommand(caption, onClick);
  }
  function detectLang(langs, defaultLang, storageKey = "lang") {
    const saved = gmGet(storageKey, null);
    if (saved && langs.includes(saved)) return saved;
    const nav = (navigator.language || defaultLang).toLowerCase();
    if (nav.startsWith("zh")) {
      return nav.includes("tw") || nav.includes("hk") || nav.includes("hant") ? "zh-TW" : "zh-CN";
    }
    if (langs.includes("en")) return "en";
    return defaultLang;
  }
  function createI18n(options) {
    const {
      langs,
      defaultLang,
      langNames,
      messages,
      storageKey = "lang"
    } = options;
    const lang = detectLang(langs, defaultLang, storageKey);
    const t2 = (key) => {
      return messages[lang]?.[key] ?? messages[defaultLang]?.[key] ?? key;
    };
    for (const code of langs) {
      gmMenuCommand(langNames[code] + (code === lang ? " ✓" : ""), () => {
        if (code === lang) return;
        gmSet(storageKey, code);
        location.reload();
      });
    }
    return { lang, t: t2 };
  }
  function probeTheme(options) {
    const { panelClass, actionClass, itemHover = "hsla(0,0%,100%,.2)" } = options;
    const probe = document.createElement("div");
    probe.className = panelClass;
    probe.style.cssText = "position:fixed;left:-9999px;top:-9999px;visibility:hidden;z-index:-1;display:block!important;opacity:1";
    document.body.appendChild(probe);
    probe.offsetLeft;
    const cs = getComputedStyle(probe);
    const theme = {
      panelBg: cs.backgroundColor,
      panelColor: cs.color,
      itemHover,
      actionBg: "rgb(0,0,0)"
    };
    probe.remove();
    if (actionClass) {
      const probe2 = document.createElement("div");
      probe2.className = actionClass;
      probe2.style.cssText = "position:fixed;left:-9999px;top:-9999px;visibility:hidden;z-index:-1;display:inline-block";
      document.body.appendChild(probe2);
      probe2.offsetLeft;
      theme.actionBg = getComputedStyle(probe2).backgroundColor;
      probe2.remove();
    } else {
      theme.actionBg = "rgb(0,0,0)";
    }
    return theme;
  }
  const DL_PATH = "/download?v=";
  const qualityCache = /* @__PURE__ */ new Map();
  function queryQualities(videoId) {
    if (qualityCache.has(videoId)) {
      return Promise.resolve(qualityCache.get(videoId));
    }
    return gmFetch(location.origin + DL_PATH + videoId).then((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const list = [];
      doc.querySelectorAll("table.download-table tbody tr").forEach((tr) => {
        const link = tr.querySelector("a[data-url]");
        if (!link) return;
        const m = /(\d{3,4}p)/.exec(tr.textContent ?? "");
        if (!m) return;
        list.push({
          quality: m[1],
          url: link.dataset.url,
          filename: link.getAttribute("download")
        });
      });
      qualityCache.set(videoId, list);
      return list;
    });
  }
  function extractVideoId(node) {
    const href = typeof node === "string" ? node : node?.getAttribute?.("dataset" in node ? "data-href" : "href") ?? node?.getAttribute?.("href") ?? null;
    if (href) {
      const m = /[?&]v=([^&]+)/.exec(href);
      if (m) return m[1];
    }
    if (node && typeof node === "object" && "querySelector" in node) {
      const link = node.querySelector('a[href*="watch?v="]');
      if (link) {
        const m = /[?&]v=([^&]+)/.exec(link.getAttribute("href") ?? "");
        if (m) return m[1];
      }
    }
    return null;
  }
  async function resolveWithFallback(videoId, quality, qualities) {
    const list = await queryQualities(videoId);
    const idx = qualities.indexOf(quality);
    for (let i = idx; i < qualities.length; i++) {
      const info = list.find((q) => q.quality === qualities[i]);
      if (info) return { info, quality: qualities[i] };
    }
    return null;
  }
  const QUALITIES = ["1080p", "720p", "480p"];
  function createBatch(t2, menuAskQuality, onActiveChange) {
    const batchState = /* @__PURE__ */ new Set();
    let batchBar = null;
    let batchOn = false;
    let batchQuality = null;
    const BATCH_BAR_STYLE = [
      "position:fixed",
      "right:0",
      "top:50%",
      "transform:translateY(-50%)",
      "z-index:2147483646",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "gap:6px",
      "padding:8px 6px",
      "background-color:var(--h1dl-panel-bg)",
      "-webkit-backdrop-filter:blur(8px)",
      "backdrop-filter:blur(8px)",
      "border-radius:8px 0 0 8px",
      "box-shadow:0 4px 24px rgba(0,0,0,0.5)",
      "color:var(--h1dl-panel-color)",
      "font-size:12px",
      "max-height:70vh"
    ].join(";");
    function buildBatchBar() {
      if (batchBar) return batchBar;
      const bar = document.createElement("div");
      bar.className = "h1dl-batch-bar";
      bar.style.cssText = BATCH_BAR_STYLE;
      const count = document.createElement("div");
      count.className = "h1dl-bb-count";
      count.style.cssText = "font-size:13px;font-weight:bold;line-height:1.2";
      count.textContent = "0";
      bar.appendChild(count);
      const divider1 = document.createElement("div");
      divider1.style.cssText = "width:70%;height:1px;background:var(--h1dl-item-hover);flex:none";
      bar.appendChild(divider1);
      const prog = document.createElement("div");
      prog.className = "h1dl-batch-prog";
      prog.style.cssText = [
        "display:flex",
        "flex-direction:column",
        "gap:4px",
        "align-items:center",
        "max-height:46vh",
        "overflow-y:auto",
        "scrollbar-width:thin",
        "padding:2px 0",
        "flex:0 1 auto",
        "min-height:0"
      ].join(";");
      bar.appendChild(prog);
      const divider2 = divider1.cloneNode();
      bar.appendChild(divider2);
      const mkBtn = (title, icon, onClick, extraClass) => {
        const b = document.createElement("button");
        b.className = "h1dl-bb-btn";
        if (extraClass) b.classList.add(extraClass);
        b.title = title;
        b.innerHTML = `<i class="material-icons">${icon}</i>`;
        b.addEventListener("click", onClick);
        return b;
      };
      const BP_MIN = {
        xs: 0,
        sm: 768,
        md: 992,
        lg: 1200
      };
      const BP_MAX = {
        xs: 768,
        sm: 992,
        md: 1200,
        lg: Infinity
      };
      const vw = () => window.innerWidth || document.documentElement.clientWidth || 1024;
      const isCardVisible = (card) => {
        let el = card;
        while (el && el !== document.body) {
          if (el.style?.display === "none") return false;
          const cls = el.classList;
          for (const bp of Object.keys(BP_MIN)) {
            if (cls.contains("hidden-" + bp)) {
              const w = vw();
              if (w >= BP_MIN[bp] && w < BP_MAX[bp]) return false;
            }
          }
          el = el.parentElement;
        }
        return true;
      };
      const selectAll = mkBtn(t2("selectAll"), "select_all", () => {
        batchState.forEach((entry) => {
          if (!isCardVisible(entry.card)) return;
          if (entry.state !== "downloading" && entry.state !== "done")
            setChecked(entry, true);
        });
      });
      bar.appendChild(selectAll);
      const selectNone = mkBtn(t2("selectNone"), "deselect", () => {
        batchState.forEach((entry) => {
          if (entry.state !== "downloading") setChecked(entry, false);
        });
      });
      bar.appendChild(selectNone);
      const dlBtn = mkBtn(
        t2("downloadSelected"),
        "download",
        () => void startBatchDownload(),
        "h1dl-bb-dl"
      );
      bar.appendChild(dlBtn);
      document.body.appendChild(bar);
      batchBar = bar;
      return bar;
    }
    function updateTick(entry, state, percent) {
      const tick = entry.tick;
      if (!tick) return;
      const fill = tick.querySelector(".h1dl-batch-fill");
      tick.classList.remove("done", "error");
      if (state === "downloading") {
        fill.style.width = (percent || 0) + "%";
      } else if (state === "done") {
        tick.classList.add("done");
        fill.style.width = "100%";
      } else if (state === "error") {
        tick.classList.add("error");
        fill.style.width = "100%";
      } else {
        fill.style.width = "0%";
      }
    }
    function syncTicks() {
      if (!batchBar) return;
      const prog = batchBar.querySelector(".h1dl-batch-prog");
      const checked = Array.from(batchState).filter((e) => e.checked);
      checked.forEach((entry) => {
        if (!entry.tick) {
          const tick = document.createElement("div");
          tick.className = "h1dl-batch-tick";
          tick.innerHTML = '<div class="h1dl-batch-fill"></div><span class="h1dl-batch-name"></span>';
          const titleEl = entry.card.querySelector(".title, .video-title");
          const name = titleEl ? titleEl.textContent?.trim() ?? entry.videoId : entry.videoId;
          tick.querySelector(".h1dl-batch-name").textContent = name;
          tick.title = name;
          prog.appendChild(tick);
          entry.tick = tick;
          updateTick(entry, entry.state);
        }
      });
      Array.from(batchState).forEach((entry) => {
        if (!entry.checked && entry.tick) {
          entry.tick.remove();
          entry.tick = null;
        }
      });
    }
    function updateBatchBar() {
      if (!batchBar) return;
      const pending = Array.from(batchState).filter(
        (e) => e.checked && e.state !== "done"
      );
      batchBar.querySelector(".h1dl-bb-count").textContent = String(pending.length);
      const dlBtn = batchBar.querySelector(".h1dl-bb-dl");
      dlBtn.disabled = pending.length === 0 || pending.some((e) => e.state === "downloading");
      syncTicks();
    }
    function setChecked(entry, checked) {
      entry.checked = checked;
      entry.check.classList.toggle("checked", checked);
      entry.check.querySelector(".material-icons").textContent = checked ? "check" : "";
      updateBatchBar();
      if (!checked && batchOn && !Array.from(batchState).some((e) => e.checked)) {
        setBatchMode(false);
      }
    }
    function setBatchMode(on) {
      batchOn = on;
      document.body.classList.toggle("h1dl-batch-on", on);
      if (on) {
        buildBatchBar();
        batchBar.style.display = "flex";
      } else if (batchBar) {
        batchBar.style.display = "none";
      }
    }
    async function startBatchDownload() {
      const selected = Array.from(batchState).filter(
        (e) => e.checked && e.state !== "done"
      );
      if (!selected.length) return;
      if (!batchQuality) {
        const q = await menuAskQuality(QUALITIES);
        if (!q) return;
        batchQuality = q;
      }
      const seenIds = /* @__PURE__ */ new Set();
      const downgraded = [];
      for (const entry of selected) {
        if (seenIds.has(entry.videoId)) {
          entry.state = "done";
          updateTick(entry, "done");
          entry.check.classList.add("completed");
          continue;
        }
        seenIds.add(entry.videoId);
        entry.state = "downloading";
        updateTick(entry, "downloading", 0);
        onActiveChange(1);
        const videoId = entry.videoId;
        try {
          const resolved = await resolveWithFallback(
            videoId,
            batchQuality,
            QUALITIES
          );
          if (!resolved) throw new Error("no download link found");
          if (resolved.quality !== batchQuality) {
            downgraded.push({ entry, from: batchQuality, to: resolved.quality });
          }
          await new Promise((resolve) => {
            _GM_download({
              url: resolved.info.url,
              // GM_download's name is a required string in the
              // vite-plugin-monkey types; undefined falls back to the
              // manager default at runtime.
              name: resolved.info.filename ?? void 0,
              onload: () => {
                onActiveChange(-1);
                entry.state = "done";
                updateTick(entry, "done");
                entry.check.classList.add("completed");
                resolve();
              },
              onerror: () => {
                onActiveChange(-1);
                entry.state = "error";
                updateTick(entry, "error");
                resolve();
              },
              ontimeout: () => {
                onActiveChange(-1);
                entry.state = "error";
                updateTick(entry, "error");
                resolve();
              },
              onprogress: (e) => {
                if (e?.lengthComputable) {
                  updateTick(
                    entry,
                    "downloading",
                    Math.round(e.loaded / e.total * 100)
                  );
                }
              }
            });
          });
        } catch {
          onActiveChange(-1);
          entry.state = "error";
          updateTick(entry, "error");
        }
      }
      if (downgraded.length) {
        const names = downgraded.map((d) => {
          const titleEl = d.entry.card.querySelector(".title, .video-title");
          return (titleEl ? titleEl.textContent?.trim() : d.entry.videoId) + ` (${d.from}→${d.to})`;
        }).join("\n");
        console.warn("[h1dl] " + t2("downgradeNotice") + "\n" + names);
      }
      batchQuality = null;
      updateBatchBar();
    }
    return {
      addEntry(card, videoId, check) {
        const entry = {
          card,
          check,
          videoId,
          checked: false,
          state: "idle",
          tick: null
        };
        batchState.add(entry);
        return entry;
      },
      setChecked,
      setMode: setBatchMode,
      isOn: () => batchOn,
      element: () => batchBar,
      update: updateBatchBar,
      startDownload: startBatchDownload
    };
  }
  function buildStates(t2) {
    return {
      idle: { icon: "download", label: t2("download") },
      fetching: { icon: "hourglass_empty", label: t2("fetching"), spin: true },
      downloading: { icon: "cloud_download", label: "%" },
      done: { icon: "check_circle", label: t2("done") },
      error: { icon: "error_outline", label: t2("error") }
    };
  }
  function createStateMachine(t2) {
    const STATES = buildStates(t2);
    return function setButtonState(btn, state, percent) {
      const s = STATES[state] || STATES.idle;
      const icon = btn.querySelector(".h1dl-icon");
      const label = btn.querySelector(".h1dl-label");
      if (icon) {
        icon.textContent = s.icon;
        icon.classList.toggle("h1dl-spin", !!s.spin);
      }
      if (label) {
        label.textContent = state === "downloading" && percent != null ? percent + "%" : s.label;
      }
      btn.dataset.state = state;
    };
  }
  async function startDownload(btn, videoId, quality, setState2, onActiveChange) {
    if (btn.dataset.state === "fetching" || btn.dataset.state === "downloading")
      return;
    setState2(btn, "fetching");
    onActiveChange(1);
    try {
      const list = await queryQualities(videoId);
      const info = list.find((q) => q.quality === quality);
      if (!info) throw new Error("quality not found: " + quality);
      setState2(btn, "downloading", 0);
      _GM_download({
        url: info.url,
        // GM_download's name is a required string in the vite-plugin-monkey
        // types; undefined falls back to the manager default at runtime.
        name: info.filename ?? void 0,
        onload: () => {
          onActiveChange(-1);
          setState2(btn, "done");
        },
        onerror: () => {
          onActiveChange(-1);
          setState2(btn, "error");
        },
        ontimeout: () => {
          onActiveChange(-1);
          setState2(btn, "error");
        },
        onprogress: (e) => {
          if (e?.lengthComputable) {
            setState2(btn, "downloading", Math.round(e.loaded / e.total * 100));
          }
        }
      });
    } catch (err) {
      onActiveChange(-1);
      console.warn("[h1dl] download failed:", err?.message);
      setState2(btn, "error");
    }
  }
  const LANGS = ["zh-TW", "zh-CN", "en"];
  const DEFAULT_LANG = "zh-TW";
  const LANG_NAMES = {
    "zh-TW": "繁體中文",
    "zh-CN": "简体中文",
    en: "English"
  };
  const MESSAGES = {
    "zh-TW": {
      download: "下載",
      fetching: "解析中",
      done: "完成",
      error: "失敗",
      loadingQualities: "載入畫質…",
      noQualities: "無可下載畫質",
      selectAll: "全選",
      selectNone: "全不選",
      downloadSelected: "下載已選取項目",
      chooseBatchQuality: "選擇批量下載畫質（不足時自動降級）",
      downgradeNotice: "畫質降級："
    },
    "zh-CN": {
      download: "下载",
      fetching: "解析中",
      done: "完成",
      error: "失败",
      loadingQualities: "加载画质…",
      noQualities: "无可下载画质",
      selectAll: "全选",
      selectNone: "全不选",
      downloadSelected: "下载已选取项目",
      chooseBatchQuality: "选择批量下载画质（不足时自动降级）",
      downgradeNotice: "画质降级："
    },
    en: {
      download: "Download",
      fetching: "Resolving",
      done: "Done",
      error: "Failed",
      loadingQualities: "Loading qualities…",
      noQualities: "No downloadable quality",
      selectAll: "Select all",
      selectNone: "Select none",
      downloadSelected: "Download selected",
      chooseBatchQuality: "Choose batch quality (auto-downgrade if unavailable)",
      downgradeNotice: "Quality downgraded:"
    }
  };
  function createInject(t2, menu2, batch2, setState2) {
    function buildListButton(videoId) {
      const btn = document.createElement("div");
      btn.className = "h1dl-list-btn";
      btn.setAttribute("title", t2("download"));
      btn.innerHTML = '<i class="material-icons h1dl-icon">download</i><span class="h1dl-label">' + t2("download") + "</span>";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.dataset.state === "error") {
          setState2(btn, "idle");
        }
        menu2.open(btn, videoId);
      });
      return btn;
    }
    function injectWatchPage() {
      const downloadBtn = document.getElementById("downloadBtn");
      if (downloadBtn && !downloadBtn.dataset.h1dl) {
        const videoId = extractVideoId(location.href) || extractVideoId(downloadBtn);
        if (videoId) {
          downloadBtn.dataset.h1dl = "1";
          downloadBtn.removeAttribute("href");
          downloadBtn.style.cursor = "pointer";
          const icon = downloadBtn.querySelector("#video-download-btn");
          if (icon) icon.classList.add("h1dl-icon");
          const labelContainer = icon ? icon.parentElement : downloadBtn.querySelector(
            ".video-show-action-btn"
          );
          if (labelContainer) {
            Array.from(labelContainer.childNodes).forEach((node) => {
              if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
                const span = document.createElement("span");
                span.className = "h1dl-label";
                span.textContent = node.textContent.trim();
                node.replaceWith(span);
              }
            });
          }
          downloadBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            menu2.open(downloadBtn, videoId);
          });
        }
      }
      document.querySelectorAll("a.more-horiz-download-late").forEach((a) => {
        const anchor = a;
        if (anchor.dataset.h1dl) return;
        const videoId = extractVideoId(anchor) || extractVideoId(location.href);
        if (!videoId) return;
        anchor.dataset.h1dl = "1";
        anchor.removeAttribute("href");
        anchor.style.cursor = "pointer";
        anchor.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const openDropdown = document.querySelector(
            ".more-horiz-wrapper.open"
          );
          if (openDropdown) openDropdown.classList.remove("open");
          menu2.open(anchor, videoId);
        });
      });
    }
    function injectListings() {
      document.querySelectorAll(".video-item-container").forEach((card) => {
        const el = card;
        if (el.dataset.h1dlBtn) return;
        const videoId = extractVideoId(el);
        if (!videoId) return;
        el.dataset.h1dlBtn = "1";
        el.classList.add("h1dl-card");
        const btn = buildListButton(videoId);
        const metaData = el.querySelector(".video-meta-data");
        const subtitle = el.querySelector(".subtitle");
        if (metaData) {
          metaData.after(btn);
        } else if (subtitle) {
          subtitle.appendChild(btn);
        } else {
          el.appendChild(btn);
        }
        const check = document.createElement("div");
        check.className = "h1dl-check";
        check.innerHTML = '<i class="material-icons"></i>';
        const entry = batch2.addEntry(el, videoId, check);
        check.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (entry.state === "done") return;
          if (!batch2.isOn()) batch2.setMode(true);
          batch2.setChecked(entry, !entry.checked);
        });
        el.appendChild(check);
        el.dataset.h1dlEntry = "";
      });
      if (batch2.isOn()) batch2.update();
    }
    function scan2() {
      if (location.pathname === "/watch") {
        injectWatchPage();
        injectListings();
      } else {
        injectListings();
      }
    }
    return { scan: scan2 };
  }
  const NATIVE_MENU_CLASS = "more-horiz-panel dropdown-menu";
  const NATIVE_ITEM_CLASS = "more-horiz-item";
  function injectStyles(theme) {
    const style = document.createElement("style");
    style.textContent = `
:root {
  --h1dl-panel-bg: ${theme.panelBg};
  --h1dl-panel-color: ${theme.panelColor};
  --h1dl-item-hover: ${theme.itemHover};
  --h1dl-action-bg: ${theme.actionBg};
}

.h1dl-list-btn{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;background:rgba(0,0,0,.55);color:#e9e9e9;font-size:12px;line-height:1.6;cursor:pointer;user-select:none;opacity:0;transition:opacity .15s ease-in-out;white-space:nowrap;text-decoration:none}
.h1dl-list-btn .material-icons{font-size:16px;margin-top:-1px}
.h1dl-list-btn:hover{background:rgba(0,0,0,.8)}
.h1dl-batch-on .h1dl-list-btn,.playlist-hover-wrap:hover .h1dl-list-btn,.video-item-container:hover .h1dl-list-btn{opacity:1}
.h1dl-list-btn.h1dl-pinned{opacity:1!important}
.video-item-container .subtitle{position:relative}
.video-item-container .subtitle .h1dl-list-btn{position:absolute;right:0;top:50%;transform:translateY(-50%)}
.h1dl-card{position:relative}
.h1dl-check{position:absolute;top:6px;right:6px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);border:2px solid #e9e9e9;border-radius:4px;cursor:pointer;user-select:none;color:#fff;font-size:14px;line-height:1;opacity:0;transition:opacity .15s ease-in-out;z-index:5}
.h1dl-check .material-icons{font-size:14px}
.h1dl-batch-on .h1dl-check,.h1dl-card:hover .h1dl-check{opacity:1}
.h1dl-check.checked,.h1dl-check.checked .material-icons{background:#2196f3;border-color:#2196f3;color:#fff}
.h1dl-check.completed{opacity:.35!important;cursor:default;pointer-events:none}
.h1dl-batch-tick{position:relative;height:6px;width:20px;border-radius:2px;background:var(--h1dl-action-bg);overflow:visible;flex:none}
.h1dl-batch-tick .h1dl-batch-fill{position:absolute;left:0;top:0;bottom:0;background:#2196f3;width:0%;transition:width .2s linear;border-radius:inherit}
.h1dl-batch-tick.done .h1dl-batch-fill,.h1dl-batch-tick.error .h1dl-batch-fill{width:100%}
.h1dl-batch-tick.done .h1dl-batch-fill{background:#33CC55}
.h1dl-batch-tick.error .h1dl-batch-fill{background:#CC3333}
.h1dl-batch-name{display:none;position:absolute;right:calc(100% + 6px);top:50%;transform:translateY(-50%);height:24px;line-height:24px;padding:0 8px;background:var(--h1dl-panel-bg);color:var(--h1dl-panel-color);border-radius:4px;white-space:nowrap;font-size:12px;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.6)}
.h1dl-batch-tick:hover .h1dl-batch-name{display:block}
.h1dl-batch-prog{scrollbar-width:none;-ms-overflow-style:none}
.h1dl-batch-prog::-webkit-scrollbar{display:none}
.h1dl-batch-tick::after{content:"";position:absolute;right:100%;top:-6px;bottom:-6px;width:6px}
.h1dl-batch-bar .h1dl-bb-btn{width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:0 0;border:none;border-radius:4px;color:#e9e9e9;cursor:pointer;padding:0;flex:none}
.h1dl-batch-bar .h1dl-bb-btn:hover{background-color:hsla(0,0%,100%,.2)}
.h1dl-batch-bar .h1dl-bb-btn .material-icons{font-size:20px}
.h1dl-batch-bar .h1dl-bb-dl{color:#8ab4f8}
.h1dl-batch-bar .h1dl-bb-dl:disabled{opacity:.35;cursor:not-allowed}
.h1dl-spin{animation:1.2s linear infinite h1dl-rotate}

@keyframes h1dl-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
`;
    document.head.appendChild(style);
    return style;
  }
  function createMenu(t2, startDownload2) {
    let openMenu = null;
    function closeMenu() {
      if (openMenu) {
        document.querySelectorAll(".h1dl-pinned").forEach((el) => {
          el.classList.remove("h1dl-pinned");
        });
        openMenu.remove();
        openMenu = null;
      }
    }
    function closeSiteDropdowns() {
      document.querySelectorAll(".dropdown.open, .open").forEach((el) => {
        el.classList.remove("open");
        el.setAttribute("aria-expanded", "false");
      });
    }
    function placeMenu(menu2, btn) {
      const visual = btn.querySelector(".video-show-action-btn") || btn;
      const vRect = visual.getBoundingClientRect();
      const cs = getComputedStyle(visual);
      const mt = Number.parseFloat(cs.marginTop) || 0;
      const sx = window.scrollX || window.pageXOffset;
      const sy = window.scrollY || window.pageYOffset;
      const menuW = menu2.offsetWidth;
      let left = vRect.left + sx;
      const top = vRect.bottom - mt + sy + 4;
      if (vRect.left + menuW > window.innerWidth - 8) {
        left = window.innerWidth + sx - menuW - 8;
      }
      menu2.style.left = Math.max(8, left) + "px";
      menu2.style.top = top + "px";
    }
    function openQualityMenu(btn, videoId) {
      if (openMenu && openMenu.dataset.trigger === btn.dataset.h1dlTrigger) {
        closeMenu();
        return;
      }
      closeMenu();
      closeSiteDropdowns();
      const menu2 = document.createElement("div");
      menu2.className = NATIVE_MENU_CLASS;
      menu2.style.cssText = "display:block!important;z-index:2147483647;top:-9999px;left:-9999px";
      const triggerId = "t" + Math.random().toString(36).slice(2, 9);
      btn.dataset.h1dlTrigger = triggerId;
      menu2.dataset.trigger = triggerId;
      const header = document.createElement("div");
      header.className = NATIVE_ITEM_CLASS;
      header.style.cssText = "cursor:default;color:#aaa;font-size:12px";
      header.textContent = t2("loadingQualities");
      menu2.appendChild(header);
      btn.classList.add("h1dl-pinned");
      document.body.appendChild(menu2);
      openMenu = menu2;
      placeMenu(menu2, btn);
      queryQualities(videoId).then((list) => {
        if (openMenu !== menu2) return;
        header.remove();
        if (!list.length) {
          header.textContent = t2("noQualities");
          header.style.cursor = "default";
          menu2.appendChild(header);
          return;
        }
        list.forEach((info) => {
          const item = document.createElement("div");
          item.className = NATIVE_ITEM_CLASS;
          const icon = document.createElement("i");
          icon.className = "material-icons";
          icon.textContent = "play_circle_filled";
          const span = document.createElement("span");
          span.textContent = info.quality;
          item.append(icon, span);
          item.addEventListener("click", (e) => {
            e.stopPropagation();
            closeMenu();
            startDownload2(btn, videoId, info.quality);
          });
          menu2.appendChild(item);
        });
        placeMenu(menu2, btn);
      });
      setTimeout(() => {
        document.addEventListener("click", closeMenu, { once: true });
      }, 0);
    }
    function askQuality(qualities) {
      return new Promise((resolve) => {
        closeMenu();
        const menu2 = document.createElement("div");
        menu2.className = NATIVE_MENU_CLASS;
        menu2.style.cssText = "position:fixed;z-index:2147483647;display:block;left:50%;top:30%;transform:translateX(-50%)";
        const header = document.createElement("div");
        header.className = NATIVE_ITEM_CLASS;
        header.style.cssText = "cursor:default;color:#aaa;font-size:12px";
        header.textContent = t2("chooseBatchQuality");
        menu2.appendChild(header);
        qualities.forEach((q) => {
          const item = document.createElement("div");
          item.className = NATIVE_ITEM_CLASS;
          const icon = document.createElement("i");
          icon.className = "material-icons";
          icon.textContent = "play_circle_filled";
          const span = document.createElement("span");
          span.textContent = q;
          item.append(icon, span);
          item.addEventListener("click", (e) => {
            e.stopPropagation();
            closeMenu();
            resolve(q);
          });
          menu2.appendChild(item);
        });
        document.body.appendChild(menu2);
        openMenu = menu2;
        setTimeout(() => {
          document.addEventListener(
            "click",
            () => {
              closeMenu();
              resolve(null);
            },
            { once: true }
          );
        }, 0);
      });
    }
    return {
      close: closeMenu,
      isOpen: () => openMenu !== null,
      element: () => openMenu,
      open: openQualityMenu,
      askQuality
    };
  }
  const HOSTS = ["hanime1.com", "hanime1.me", "hanimeone.com", "hanimeone.me"];
  if (!HOSTS.includes(location.hostname)) {
    throw new Error("[h1dl] not a hanime1 host");
  }
  configureGmApi({
    GM_xmlhttpRequest: _GM_xmlhttpRequest,
    GM_download: _GM_download,
    GM_getValue: _GM_getValue,
    GM_setValue: _GM_setValue,
    GM_registerMenuCommand: _GM_registerMenuCommand
  });
  const { t } = createI18n({
    langs: LANGS,
    defaultLang: DEFAULT_LANG,
    langNames: LANG_NAMES,
    messages: MESSAGES,
    storageKey: "lang"
  });
  const THEME = probeTheme({
    panelClass: "more-horiz-panel",
    actionClass: "video-show-action-btn default",
    itemHover: "hsla(0,0%,100%,.2)"
  });
  injectStyles(THEME);
  let activeDownloads = 0;
  const bumpDownloads = (delta) => {
    activeDownloads = Math.max(0, activeDownloads + delta);
    const should = activeDownloads > 0;
    if (should !== bumpDownloadsFlag) {
      bumpDownloadsFlag = should;
      window[should ? "addEventListener" : "removeEventListener"](
        "beforeunload",
        onBeforeUnload
      );
    }
  };
  let bumpDownloadsFlag = false;
  function onBeforeUnload(e) {
    e.preventDefault();
    e.returnValue = "";
  }
  const setState = createStateMachine(t);
  const singleDownload = (btn, videoId, quality) => {
    void startDownload(btn, videoId, quality, setState, bumpDownloads);
  };
  const menu = createMenu(t, singleDownload);
  const batch = createBatch(
    t,
    menu.askQuality,
    bumpDownloads
  );
  const inject = createInject(
    t,
    menu,
    batch,
    setState
  );
  let injecting = false;
  let scanTimer = null;
  function scan() {
    injecting = true;
    try {
      inject.scan();
    } finally {
      injecting = false;
    }
  }
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      scan();
    }, 300);
  }
  const observer = new MutationObserver((mutations) => {
    if (injecting) return;
    if (menu.isOpen()) {
      const openMenu = menu.element();
      const ownMutation = mutations.some(
        (m) => Array.from(m.addedNodes).includes(openMenu) || m.target === openMenu || openMenu?.contains(m.target) || batch.element() === m.target || batch.element()?.contains(m.target)
      );
      if (!ownMutation) menu.close();
    }
    scheduleScan();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "d" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      batch.setMode(!batch.isOn());
    }
  });
  scan();

})();