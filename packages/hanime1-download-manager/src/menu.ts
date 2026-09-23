/**
 * Quality menu (dropdown).
 *
 * Uses the site's own .more-horiz-panel / .more-horiz-item classes for the
 * exact native look (bg #282828, blur, radius 12px, width 135px). The menu is
 * attached to document.body in document coordinates so it (a) scrolls with
 * the page like the site's own panels, and (b) is a direct child of body —
 * no card or video element can stack above it.
 */
import { queryQualities } from "./api";
import { NATIVE_ITEM_CLASS, NATIVE_MENU_CLASS } from "./styles";

export interface MenuApi {
  /** Close the currently open menu, if any. */
  close: () => void;
  /** Whether a menu is currently open (used by the MutationObserver). */
  isOpen: () => boolean;
  /** The currently open menu element, or null (used by the MutationObserver). */
  element: () => HTMLDivElement | null;
  /** Open the quality menu anchored below a trigger button. */
  open: (btn: HTMLElement, videoId: string) => void;
  /** Ask the user to pick a batch quality (centered modal-style menu). */
  askQuality: (qualities: string[]) => Promise<string | null>;
}

export function createMenu(
  t: (key: string) => string,
  startDownload: (btn: HTMLElement, videoId: string, quality: string) => void,
): MenuApi {
  let openMenu: HTMLDivElement | null = null;

  function closeMenu(): void {
    if (openMenu) {
      // Release the pinned trigger button.
      document.querySelectorAll(".h1dl-pinned").forEach((el) => {
        el.classList.remove("h1dl-pinned");
      });
      openMenu.remove();
      openMenu = null;
    }
  }

  // Collapse any Bootstrap 3 dropdown the site itself opened (the share /
  // report / more_horiz panels). Bootstrap tracks open state via .open on
  // the .dropdown wrapper; removing it hides the panel and its backdrop.
  function closeSiteDropdowns(): void {
    document.querySelectorAll(".dropdown.open, .open").forEach((el: Element) => {
      el.classList.remove("open");
      el.setAttribute("aria-expanded", "false");
    });
  }

  function placeMenu(menu: HTMLDivElement, btn: HTMLElement): void {
    // Measure the visual button element: on the watch page `btn` is an <a>
    // whose inner .video-show-action-btn is the pill the user sees.
    // getBoundingClientRect includes margin-top displacement, so subtract it
    // to get the exact native 4px gap (panel top:40px under a 36px toggle).
    const visual = (btn.querySelector(".video-show-action-btn") as HTMLElement) || btn;
    const vRect = visual.getBoundingClientRect();
    const cs = getComputedStyle(visual);
    const mt = Number.parseFloat(cs.marginTop) || 0;
    const sx = window.scrollX || window.pageXOffset;
    const sy = window.scrollY || window.pageYOffset;
    const menuW = menu.offsetWidth;
    let left = vRect.left + sx;
    const top = vRect.bottom - mt + sy + 4;
    // Keep on screen horizontally.
    if (vRect.left + menuW > window.innerWidth - 8) {
      left = window.innerWidth + sx - menuW - 8;
    }
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = top + "px";
  }

  function openQualityMenu(btn: HTMLElement, videoId: string): void {
    // Repeat click on the same trigger closes its menu (native dropdown
    // behavior). closeMenu() below removes menus from other triggers, so
    // at most one menu is ever open at a time.
    if (openMenu && openMenu.dataset.trigger === btn.dataset.h1dlTrigger) {
      closeMenu();
      return;
    }
    closeMenu();
    // Also collapse the site's own open dropdown (share/report/more).
    closeSiteDropdowns();
    const menu = document.createElement("div");
    menu.className = NATIVE_MENU_CLASS;
    menu.style.cssText = "display:block!important;z-index:2147483647;top:-9999px;left:-9999px";
    // Tag the menu with its trigger so a repeat click toggles it closed.
    // Random id: only needs to be unique per trigger, not cryptographically
    // secure — it just namespaces open menus against repeat clicks.
    const triggerId = "t" + Math.random().toString(36).slice(2, 9);
    btn.dataset.h1dlTrigger = triggerId;
    menu.dataset.trigger = triggerId;

    const header = document.createElement("div");
    header.className = NATIVE_ITEM_CLASS;
    header.style.cssText = "cursor:default;color:#aaa;font-size:12px";
    header.textContent = t("loadingQualities");
    menu.appendChild(header);

    // Keep the triggering button visible while the menu is open.
    btn.classList.add("h1dl-pinned");

    document.body.appendChild(menu);
    openMenu = menu;

    placeMenu(menu, btn);

    queryQualities(videoId).then((list) => {
      // Menu may have been closed while querying.
      if (openMenu !== menu) return;
      header.remove();
      if (!list.length) {
        header.textContent = t("noQualities");
        header.style.cursor = "default";
        menu.appendChild(header);
        return;
      }
      list.forEach((info) => {
        const item = document.createElement("div");
        item.className = NATIVE_ITEM_CLASS;
        // Icon priority: site-native first. hanime1 loads Material
        // Icons site-wide, so the menu reuses it — identical glyphs at
        // no extra payload. Fall back to Lucide only on sites without
        // an icon font.
        const icon = document.createElement("i");
        icon.className = "material-icons";
        icon.textContent = "play_circle_filled";
        const span = document.createElement("span");
        span.textContent = info.quality;
        item.append(icon, span);
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          closeMenu();
          startDownload(btn, videoId, info.quality);
        });
        menu.appendChild(item);
      });
      placeMenu(menu, btn);
    });

    // Defer document click listener to the next macrotask so the current
    // click event (which triggered the menu) does not immediately close it.
    setTimeout(() => {
      document.addEventListener("click", closeMenu, { once: true });
    }, 0);
  }

  function askQuality(qualities: string[]): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      closeMenu();
      const menu = document.createElement("div");
      menu.className = NATIVE_MENU_CLASS;
      menu.style.cssText =
        "position:fixed;z-index:2147483647;display:block;left:50%;top:30%;transform:translateX(-50%)";
      const header = document.createElement("div");
      header.className = NATIVE_ITEM_CLASS;
      header.style.cssText = "cursor:default;color:#aaa;font-size:12px";
      header.textContent = t("chooseBatchQuality");
      menu.appendChild(header);
      qualities.forEach((q) => {
        const item = document.createElement("div");
        item.className = NATIVE_ITEM_CLASS;
        // Site-native Material Icons (see the quality menu above).
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
        menu.appendChild(item);
      });
      document.body.appendChild(menu);
      openMenu = menu;
      // Clicking outside cancels the batch.
      setTimeout(() => {
        document.addEventListener(
          "click",
          () => {
            closeMenu();
            resolve(null);
          },
          { once: true },
        );
      }, 0);
    });
  }

  return {
    close: closeMenu,
    isOpen: () => openMenu !== null,
    element: () => openMenu,
    open: openQualityMenu,
    askQuality,
  };
}
