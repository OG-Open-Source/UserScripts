import "./lit-dom";

import { markUiRoot } from "@userscripts/shared";
import type { RenderOptions } from "lit";
import { render as litRender } from "lit";
import { cleanupLitDomGlobal, setLitCreationScope } from "./lit-dom";

cleanupLitDomGlobal();

export type LitRootPart = ReturnType<typeof litRender>;

export interface LitShadowMountOptions {
  css: string;
  doc: Document;
  hostId: string;
  mountTarget?: HTMLElement | null;
  uiTag?: string;
}

export interface LitShadowMount {
  destroy: () => void;
  host: HTMLElement;
  mountEl: HTMLDivElement;
  render: (template: unknown) => LitRootPart;
  shadow: ShadowRoot;
  styleEl: HTMLStyleElement;
}

export function renderLit(
  template: unknown,
  container: HTMLElement | DocumentFragment,
  doc: Document,
  options?: RenderOptions
): LitRootPart {
  setLitCreationScope(doc);
  return litRender(template, container, {
    ...options,
    creationScope: options?.creationScope ?? doc,
  });
}

export function mountLitShadow(options: LitShadowMountOptions): LitShadowMount {
  const { css, doc, hostId, mountTarget, uiTag = "ptr" } = options;
  const existing = doc.querySelector(`#${hostId}`);
  if (existing) {
    existing.remove();
  }

  const host = doc.createElement("div");
  host.id = hostId;
  markUiRoot(host, uiTag);

  const shadow = host.attachShadow({ mode: "open" });
  const styleEl = doc.createElement("style");
  styleEl.textContent = css;

  const mountEl = doc.createElement("div");
  mountEl.className = "ptr-lit-root";

  shadow.append(styleEl, mountEl);
  (mountTarget ?? doc.body ?? doc.documentElement).append(host);

  return {
    host,
    shadow,
    styleEl,
    mountEl,
    render(template: unknown): LitRootPart {
      return renderLit(template, mountEl, doc);
    },
    destroy(): void {
      host.remove();
    },
  };
}
