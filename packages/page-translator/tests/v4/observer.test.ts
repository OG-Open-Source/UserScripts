import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createViewportObserver } from "../../src/capture/observer";
import type { SiteStructureAdapter } from "../../src/structure/adapter";
import { parseSiteDelta } from "../../src/structure/site-rules";

test("createViewportObserver scopes initial scan via adapter.captureScope and skips excluded regions", () => {
  const win = new Window();
  win.document.body.innerHTML = `
    <header><div id="top">Topbar text</div></header>
    <main><div id="content">Main prose</div></main>
  `;
  const seen: string[] = [];
  const adapter: SiteStructureAdapter = {
    id: "custom",
    detect: () => true,
    regions: (doc) => ({
      content: Array.from(doc.querySelectorAll("main")),
    }),
    captureScope: (doc) => Array.from(doc.querySelectorAll("main")),
    onSpaNavigate: (doc) => Array.from(doc.querySelectorAll("main")),
    elementPolicy: () => "prose",
  };

  const observer = createViewportObserver({
    root: win.document.body as unknown as Element,
    delta: parseSiteDelta(""),
    adapter,
    onVisibleSegments(segs) {
      for (const seg of segs) {
        seen.push(seg.nodes.map((n) => n.textContent).join(""));
      }
    },
  });

  observer.scan();
  observer.stop();
  expect(seen).toEqual(["Main prose"]);
});
