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
  /(?<cjk>[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])-(?<num>\d)/gu;
const CJK_TO_HW =
  /(?<cjk>[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])(?<hw>[A-Za-z0-9([])/gu;
const HW_TO_CJK =
  /(?<hw>[A-Za-z0-9%!)\]])(?<cjk>[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])/gu;
const PCT_TO_PAREN = /%(?<paren>[([])/gu;

const FW_ALNUM_RE = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/gu;
const CJK_PARENS_RE =
  /[ \t]*\((?<inner>[^()]*?[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF][^()]*?)\)[ \t]*/gu;
const CJK_ADJ_PUNCT_RE =
  /(?<cjk>[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF）])(?<punct>[,.!?:;])[ \t]*/gu;
const FW_PUNCT_TRAIL_SPACE_RE = /(?<punct>[，。！？：；（）])[ \t]+/gu;
const LATIN_COMMA_SPACE_RE = /(?<left>[A-Za-z]),(?<right>[A-Za-z])/gu;
const LATIN_PERIOD_SPACE_RE = /(?<left>[a-z])\.(?<right>[A-Z][a-z])/gu;
const URL_MASK_RE = /\uE000U(?<idx>\d+)\uE001/gu;
const ASCII_PRINTABLE_RE = /^[\x21-\x7E]$/u;

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
    .replace(FW_PUNCT_TRAIL_SPACE_RE, "$<punct>")
    .replace(LATIN_COMMA_SPACE_RE, "$<left>, $<right>")
    .replace(LATIN_PERIOD_SPACE_RE, "$<left>. $<right>");

  if (urls.length === 0) {
    return norm;
  }
  return norm.replace(URL_MASK_RE, (_, n) => urls[Number(n)] ?? "");
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
    .replace(CJK_HYPHEN_NUM, "$<cjk> - $<num>")
    .replace(PCT_TO_PAREN, "% $<paren>")
    .replace(CJK_TO_HW, "$<cjk> $<hw>")
    .replace(HW_TO_CJK, "$<hw> $<cjk>");

  if (urls.length === 0) {
    return spaced;
  }
  return spaced.replace(URL_MASK_RE, (_, n) => urls[Number(n)] ?? "");
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
    const ca = after[j];
    if (ca === undefined) {
      break;
    }
    const cb = before[i];
    if (ca === " ") {
      if (cb === " ") {
        out += "_";
        i += 1;
      } else {
        out += "^";
      }
      j += 1;
    } else {
      out += ca;
      if (cb === ca) {
        i += 1;
      }
      j += 1;
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

function shouldInsertSeamSpace(
  curSkip: boolean,
  nextSkip: boolean,
  leftChar: string,
  rightChar: string
): boolean {
  if (needsSpaceBetween(leftChar, rightChar)) {
    return true;
  }
  if (!(curSkip || nextSkip)) {
    return false;
  }
  if (!curSkip && nextSkip) {
    return CJK_RE.test(leftChar) && ASCII_PRINTABLE_RE.test(rightChar);
  }
  if (curSkip && !nextSkip) {
    return ASCII_PRINTABLE_RE.test(leftChar) && CJK_RE.test(rightChar);
  }
  return false;
}

function applySeamBetween(
  cur: { node: Text; skip: boolean },
  next: { node: Text; skip: boolean },
  debugMarks: boolean
): void {
  if (cur.skip && next.skip) {
    return;
  }
  const leftVal = cur.node.nodeValue ?? "";
  const rightVal = next.node.nodeValue ?? "";
  const leftChar = leftVal.at(-1);
  const [rightChar] = rightVal;
  if (!(leftChar && rightChar)) {
    return;
  }
  if (!shouldInsertSeamSpace(cur.skip, next.skip, leftChar, rightChar)) {
    return;
  }
  const sep = debugMarks ? "^" : " ";
  if (!cur.skip) {
    cur.node.nodeValue = `${leftVal}${sep}`;
  } else if (!next.skip) {
    next.node.nodeValue = `${sep}${rightVal}`;
  }
}

function applySeamSpacing(
  textNodes: readonly { node: Text; skip: boolean }[],
  debugMarks: boolean
): void {
  for (let i = 0; i < textNodes.length - 1; i += 1) {
    const cur = textNodes[i];
    const next = textNodes[i + 1];
    if (cur && next) {
      applySeamBetween(cur, next, debugMarks);
    }
  }
}

export function applySpacingToFragment(
  root: Node,
  options?: { skipPredicate?: (el: Element) => boolean; debugMarks?: boolean }
): void {
  const skipPredicate = options?.skipPredicate;
  const textNodes: { node: Text; skip: boolean }[] = [];

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
  applySeamSpacing(textNodes, Boolean(options?.debugMarks));
}
