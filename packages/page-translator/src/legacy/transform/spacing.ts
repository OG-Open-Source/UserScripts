import type { PunctNormMode, SpacingMode } from "../config";

const CJK_RE =
  /[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/u;
const HW_WORD_RE = /[A-Za-z0-9]/u;
const HW_CLOSE_RE = /[)\]]/u;

const URL_RE =
  /https?:\/\/[^\s\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF<>()[\]「」『』【】（）]+/giu;

// Insert space only between ideographic/syllabic CJK and half-width words/brackets.
// Full-width punctuation (【】〖〗「」『』（）［］｛｝！？。，＂’：；、) is NOT in CJK_RE
// and therefore never receives extra spaces on either side.
const CJK_HYPHEN_NUM =
  /([\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])-(\d)/gu;
const CJK_TO_HW =
  /([\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])([A-Za-z0-9([])/gu;
const HW_TO_CJK =
  /([A-Za-z0-9%!)\]])([\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])/gu;
const PCT_TO_PAREN = /%([([])/gu;

const FW_ALNUM_RE = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/gu;
const CJK_PARENS_RE =
  /[ \t]*\(([^()]*?[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF][^()]*?)\)[ \t]*/gu;
const CJK_ADJ_PUNCT_RE =
  /([\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF）])([,.!?:;])[ \t]*/gu;
const FW_PUNCT_TRAIL_SPACE_RE = /([，。！？：；（）])[ \t]+/gu;
const LATIN_COMMA_SPACE_RE = /([A-Za-z]),([A-Za-z])/gu;
const LATIN_PERIOD_SPACE_RE = /([a-z])\.([A-Z][a-z])/gu;

const HALF_TO_FULL_PUNCT: Record<string, string> = {
  ",": "，",
  ".": "。",
  "!": "！",
  "?": "？",
  ":": "：",
  ";": "；",
};

export function normalizePunctuation(
  text: string,
  mode: PunctNormMode
): string {
  if (!text || mode === "off") {
    return text;
  }

  const urls: string[] = [];
  const masked = text.replace(URL_RE, (m) => {
    const idx = urls.length;
    urls.push(m);
    return `\uE000U${idx}\uE001`;
  });

  const norm = masked
    .replace(FW_ALNUM_RE, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfe_e0)
    )
    .replace(/\u3000/gu, " ")
    .replace(CJK_PARENS_RE, (_, inner: string) => `（${inner.trim()}）`)
    .replace(
      CJK_ADJ_PUNCT_RE,
      (_, cjk: string, p: string) => `${cjk}${HALF_TO_FULL_PUNCT[p] ?? p}`
    )
    .replace(FW_PUNCT_TRAIL_SPACE_RE, "$1")
    .replace(LATIN_COMMA_SPACE_RE, "$1, $2")
    .replace(LATIN_PERIOD_SPACE_RE, "$1. $2");

  if (urls.length === 0) {
    return norm;
  }
  return norm.replace(/\uE000U(\d+)\uE001/gu, (_, n) => urls[Number(n)] ?? "");
}

export function needsSpaceBetween(left: string, right: string): boolean {
  if (!(left && right)) {
    return false;
  }
  if (
    CJK_RE.test(left) &&
    (HW_WORD_RE.test(right) || right === "(" || right === "[")
  ) {
    return true;
  }
  if (
    (HW_WORD_RE.test(left) ||
      left === "%" ||
      left === "!" ||
      HW_CLOSE_RE.test(left)) &&
    CJK_RE.test(right)
  ) {
    return true;
  }
  return false;
}

export function spaceCjkText(text: string): string {
  if (!text) {
    return text;
  }
  const urls: string[] = [];
  const masked = text.replace(URL_RE, (m) => {
    const idx = urls.length;
    urls.push(m);
    return `\uE000U${idx}\uE001`;
  });

  const spaced = masked
    .replace(CJK_HYPHEN_NUM, "$1 - $2")
    .replace(PCT_TO_PAREN, "% $1")
    .replace(CJK_TO_HW, "$1 $2")
    .replace(HW_TO_CJK, "$1 $2");

  if (urls.length === 0) {
    return spaced;
  }
  return spaced.replace(
    /\uE000U(\d+)\uE001/gu,
    (_, n) => urls[Number(n)] ?? ""
  );
}

export interface SpacingPreviewResult {
  insertedSpaces: number;
  norm: string;
  out: string;
}

export function inspectTextSpacing(
  raw: string,
  punctNorm: PunctNormMode,
  spacingMode: SpacingMode
): SpacingPreviewResult {
  const norm = normalizePunctuation(raw, punctNorm);
  const useJs = spacingMode === "js" || spacingMode === "both";
  const out = useJs ? spaceCjkText(norm) : norm;
  return { norm, out, insertedSpaces: Math.max(0, out.length - norm.length) };
}

export function formatDebugSpacingMarks(before: string, after: string): string {
  let out = "";
  let i = 0;
  let j = 0;
  while (j < after.length) {
    const ca = after[j]!;
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

export function applyPunctNormToFragment(
  root: Node,
  mode: PunctNormMode,
  skipPredicate?: (el: Element) => boolean
): void {
  if (mode === "off") {
    return;
  }

  function walk(node: Node, skip: boolean): void {
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
      const el = node as Element;
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

export function applySpacingToFragment(
  root: Node,
  options?: { skipPredicate?: (el: Element) => boolean; debugMarks?: boolean }
): void {
  const skipPredicate = options?.skipPredicate;
  const textNodes: Array<{ node: Text; skip: boolean }> = [];

  function walk(node: Node, inheritedSkip: boolean): void {
    if (node.nodeType === 3) {
      textNodes.push({ node: node as Text, skip: inheritedSkip });
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) {
      return;
    }

    let skip = inheritedSkip;
    if (node.nodeType === 1) {
      const el = node as Element;
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
      entry.node.nodeValue = options?.debugMarks
        ? formatDebugSpacingMarks(before, spaced)
        : spaced;
    }
  }

  // Handle inline element seams without inserting extra DOM nodes
  for (let i = 0; i < textNodes.length - 1; i++) {
    const cur = textNodes[i]!;
    const next = textNodes[i + 1]!;
    if (cur.skip && next.skip) {
      continue;
    }
    const leftVal = cur.node.nodeValue ?? "";
    const rightVal = next.node.nodeValue ?? "";
    if (!(leftVal && rightVal)) {
      continue;
    }
    const leftChar = leftVal[leftVal.length - 1]!;
    const rightChar = rightVal[0]!;

    let shouldSpace = needsSpaceBetween(leftChar, rightChar);
    if (!shouldSpace && (cur.skip || next.skip)) {
      const ASCII_PRINTABLE = /^[\x21-\x7E]$/u;
      if (
        !cur.skip &&
        next.skip &&
        CJK_RE.test(leftChar) &&
        ASCII_PRINTABLE.test(rightChar)
      ) {
        shouldSpace = true;
      } else if (
        cur.skip &&
        !next.skip &&
        ASCII_PRINTABLE.test(leftChar) &&
        CJK_RE.test(rightChar)
      ) {
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
