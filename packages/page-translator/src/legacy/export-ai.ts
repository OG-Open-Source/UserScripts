import type { StyleReader } from "./capture/display-role";
import { encodeInlineNodes } from "./capture/inline-codec";
import { collectSegments } from "./capture/segmenter";
import type { CompiledSiteDelta } from "./site-rules";
import type { SiteLocaleTable } from "./transform/template";
import {
  extractTemplate,
  matchSiteTranslation,
  suggestScopeSelector,
} from "./transform/template";

export interface AiExportSegmentItem {
  heading?: string;
  id: string;
  kind: "static" | "dynamic";
  preview: string;
  scope?: string;
  template: string;
}

export interface AiExportBundle {
  count: number;
  markdown: string;
  payload: string;
  prompt: string;
}

function findHeadingContext(el: Element): string {
  let cur: Element | null = el.parentElement;
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

export function buildAiTranslationExport(
  doc: Document,
  delta: CompiledSiteDelta,
  options: {
    getStyle?: StyleReader;
    hostname: string;
    siteTable?: SiteLocaleTable | null;
    targetLang: string;
  }
): AiExportBundle {
  const root = doc.body ?? doc.documentElement;
  const segs = root
    ? collectSegments(
        root,
        delta,
        options.getStyle ? { getStyle: options.getStyle } : undefined
      )
    : [];

  const seenKeys = new Set<string>();
  const items: AiExportSegmentItem[] = [];

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
      preview: seg.nodes
        .map((n) => n.textContent ?? "")
        .join("")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 120),
      ...(scope ? { scope } : {}),
      ...(heading ? { heading } : {}),
    });
  }

  const jsonObj = {
    version: 1,
    host: options.hostname,
    targetLang: options.targetLang,
    segments: items,
  };
  const payload = JSON.stringify(jsonObj, null, 2);

  const mdLines: string[] = [
    `# ${doc.title || options.hostname} (${options.hostname})`,
    "",
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
    "```",
  ].join("\n");

  return { count: items.length, payload, markdown, prompt };
}

export interface ParsedAiImport {
  dynamic: Record<string, string>;
  scoped: Record<
    string,
    { dynamic?: Record<string, string>; static?: Record<string, string> }
  >;
  static: Record<string, string>;
  translationsMap: Record<string, string>;
}

/**
 * Parse AI-generated JSON back into template -> translation drafts.
 * Accepts `{ translations: { template: translation } }` or a `SiteTranslationsFile`.
 */
export function parseAiTranslationImport(
  raw: string,
  targetLang: string
): ParsedAiImport {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid JSON object.");
  }

  const out: ParsedAiImport = {
    static: {},
    dynamic: {},
    scoped: {},
    translationsMap: {},
  };

  if (
    "translations" in parsed &&
    parsed.translations &&
    typeof parsed.translations === "object"
  ) {
    for (const [k, v] of Object.entries(
      parsed.translations as Record<string, unknown>
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

  if (
    "locales" in parsed &&
    parsed.locales &&
    typeof parsed.locales === "object"
  ) {
    const locales = parsed.locales as Record<string, unknown>;
    const table = (locales[targetLang] ?? Object.values(locales)[0]) as
      | {
          dynamic?: Record<string, string>;
          scoped?: Record<
            string,
            {
              dynamic?: Record<string, string>;
              static?: Record<string, string>;
            }
          >;
          static?: Record<string, string>;
        }
      | undefined;
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
          ...(sc.static ? { static: { ...sc.static } } : {}),
          ...(sc.dynamic ? { dynamic: { ...sc.dynamic } } : {}),
        };
      }
    }
    return out;
  }

  throw new Error("Expected { translations } or { locales } JSON.");
}
