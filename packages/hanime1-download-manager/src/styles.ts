/**
 * Injected stylesheet.
 *
 * Style priority (see CONTRIBUTING.md): site-native classes first, then
 * hand-rolled CSS for the parts the site has no component for. Everything
 * else uses native classes: .more-horiz-panel / .more-horiz-item for menus,
 * .video-show-action-btn for buttons, .stat-item for thumbnail overlay chips.
 *
 * Only the few things the site has no native component for are styled here:
 * hover-show transition, the fixed tick geometry, and the tooltip.
 *
 * Colors are NEVER hardcoded — they are probed off the site's own CSS via
 * @userscripts/shared's probeTheme() and injected as CSS variables below, so
 * injected UI follows the site's theme (dark/light) automatically.
 */
import type { NativeTheme } from "@userscripts/shared";

/** CSS class names reused from the site's own markup. */
export const NATIVE_MENU_CLASS = "more-horiz-panel dropdown-menu";
export const NATIVE_ITEM_CLASS = "more-horiz-item";

/** Build the <style> element and append it to <head>. */
export function injectStyles(theme: NativeTheme): HTMLStyleElement {
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
