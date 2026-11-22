import type { PunctNormMode, SpacingMode } from "../legacy/config";

export interface NormalizeChineseOptions {
  debugSpacingMarks?: boolean;
  punctNorm: PunctNormMode;
  spacingMode: SpacingMode;
}

const CJK_RE =
  /[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/u;
const CJK_OR_CLOSE_RE =
  /[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF）】]/u;
const HW_WORD_RE = /[A-Za-z0-9]/u;
const HW_CLOSE_RE = /[)]/u;
const ASCII_PRINTABLE_RE = /^[\x21-\x7E]$/u;

const URL_RE =
  /https?:\/\/[^\s\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF<>()[\]「」『』【】（）]+/giu;
const URL_AT_START_RE = new RegExp(`^${URL_RE.source}`, "iu");
const URL_AT_END_RE = new RegExp(`${URL_RE.source}$`, "iu");

const CJK_HYPHEN_NUM =
  /(?<cjk>[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])-(?<number>\d)/gu;
const CJK_TO_HW =
  /(?<cjk>[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])(?<word>[A-Za-z0-9(])/gu;
const HW_TO_CJK =
  /(?<word>[A-Za-z0-9%!)])(?<cjk>[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF])/gu;
const PCT_TO_PAREN = /%\(/gu;

const FW_ALNUM_RE = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/gu;
const CJK_PARENS_RE =
  /[ \t]*\((?<inner>[^()]*?[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF][^()]*?)\)[ \t]*/gu;
const CJK_BRACKETS_RE = /[ \t]*\[(?<inner>[^[\]\r\n]*?)\][ \t]*/gu;
const CJK_BRACKET_SEAM_RE = /[ \t]*\[(?<inner>[^[\]\r\n]*?)\][ \t]*/gu;
const CJK_ADJ_PUNCT_RE =
  /(?<cjk>[\u4E00-\u9FFF\u3400-\u4DBF\u3105-\u312F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF）】])(?<punct>[,.!?:;])[ \t]*/gu;
const FW_PUNCT_TRAIL_SPACE_RE = /(?<punct>[，。！？：；（）])[ \t]+/gu;
const LATIN_COMMA_SPACE_RE = /(?<left>[A-Za-z]),(?<right>[A-Za-z])/gu;
const LATIN_PERIOD_SPACE_RE = /(?<left>[a-z])\.(?<right>[A-Z][a-z])/gu;
const LEADING_ADJ_PUNCT_RE = /^(?<punct>[,.!?:;])[ \t]*/u;
const URL_PLACEHOLDER_RE = /\uE000U(?<index>\d+)\uE001/gu;
const TAG_START_RE = /[A-Za-z/!]/u;
const BASIC_ENTITY_RE = /&(?<name>amp|apos|gt|lt|nbsp|quot);/giu;

const BASIC_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

const HALF_TO_FULL_PUNCT: Record<string, string> = {
  ",": "，",
  ".": "。",
  "!": "！",
  "?": "？",
  ":": "：",
  ";": "；",
};

interface MaskedUrls {
  text: string;
  urls: string[];
}

function maskUrls(text: string): MaskedUrls {
  const urls: string[] = [];
  const masked = text.replace(URL_RE, (url) => {
    const index = urls.length;
    urls.push(url);
    return `\uE000U${index}\uE001`;
  });
  return { text: masked, urls };
}

function restoreUrls(text: string, urls: readonly string[]): string {
  if (urls.length === 0) {
    return text;
  }
  return text.replace(
    URL_PLACEHOLDER_RE,
    (_, index) => urls[Number(index)] ?? ""
  );
}

function normalizeCjkBrackets(text: string): string {
  return text.replace(
    CJK_BRACKETS_RE,
    (match, inner: string, offset: number, source: string) => {
      const bracketStart = match.indexOf("[");
      const bracketEnd = match.lastIndexOf("]");
      const leading = match.slice(0, bracketStart);
      const trailing = match.slice(bracketEnd + 1);
      const left = source[offset - 1] ?? "";
      const right = source[offset + match.length] ?? "";
      const leftIsCjk = CJK_RE.test(left);
      const rightIsCjk = CJK_RE.test(right);

      if (!(leftIsCjk || rightIsCjk || CJK_RE.test(inner))) {
        return match;
      }
      return `${leftIsCjk ? "" : leading}【${inner.trim()}】${
        rightIsCjk ? "" : trailing
      }`;
    }
  );
}

export function normalizePunctuation(
  text: string,
  mode: PunctNormMode
): string {
  if (!text || mode === "off") {
    return text;
  }

  const masked = maskUrls(text);
  const normalized = masked.text
    .replace(FW_ALNUM_RE, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfe_e0)
    )
    .replace(/\u3000/gu, " ")
    .replace(CJK_PARENS_RE, (_, inner: string) => `（${inner.trim()}）`)
    .replace(
      CJK_ADJ_PUNCT_RE,
      (_, cjk: string, punct: string) =>
        `${cjk}${HALF_TO_FULL_PUNCT[punct] ?? punct}`
    )
    .replace(FW_PUNCT_TRAIL_SPACE_RE, "$<punct>")
    .replace(LATIN_COMMA_SPACE_RE, "$<left>, $<right>")
    .replace(LATIN_PERIOD_SPACE_RE, "$<left>. $<right>");

  return restoreUrls(normalizeCjkBrackets(normalized), masked.urls);
}

export function needsSpaceBetween(left: string, right: string): boolean {
  if (!(left && right)) {
    return false;
  }
  if (CJK_RE.test(left) && (HW_WORD_RE.test(right) || right === "(")) {
    return true;
  }
  return (
    (HW_WORD_RE.test(left) ||
      left === "%" ||
      left === "!" ||
      HW_CLOSE_RE.test(left)) &&
    CJK_RE.test(right)
  );
}

export function spaceCjkText(text: string): string {
  if (!text) {
    return text;
  }
  const masked = maskUrls(text);
  const spaced = masked.text
    .replace(CJK_HYPHEN_NUM, "$<cjk> - $<number>")
    .replace(PCT_TO_PAREN, "% (")
    .replace(CJK_TO_HW, "$<cjk> $<word>")
    .replace(HW_TO_CJK, "$<word> $<cjk>");
  return restoreUrls(spaced, masked.urls);
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
  let beforeIndex = 0;
  let afterIndex = 0;
  while (afterIndex < after.length) {
    const afterChar = after[afterIndex];
    if (afterChar === undefined) {
      break;
    }
    const beforeChar = before[beforeIndex];
    if (afterChar === " ") {
      out += beforeChar === " " ? "_" : "^";
      if (beforeChar === " ") {
        beforeIndex += 1;
      }
    } else {
      out += afterChar;
      if (beforeChar === afterChar) {
        beforeIndex += 1;
      }
    }
    afterIndex += 1;
  }
  return out;
}

type HtmlToken =
  | { kind: "tag"; value: string }
  | { kind: "text"; value: string };
type TextToken = Extract<HtmlToken, { kind: "text" }>;

function forEachPair<T>(
  values: readonly T[],
  visit: (current: T, next: T) => void
): void {
  for (let index = 0; index < values.length - 1; index += 1) {
    const current = values[index];
    const next = values[index + 1];
    if (current !== undefined && next !== undefined) {
      visit(current, next);
    }
  }
}

function findTagEnd(html: string, start: number): number {
  if (html.startsWith("<!--", start)) {
    const commentEnd = html.indexOf("-->", start + 4);
    return commentEnd === -1 ? -1 : commentEnd + 2;
  }

  let quote = "";
  for (let index = start + 1; index < html.length; index += 1) {
    const char = html[index] ?? "";
    if (quote) {
      if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

function splitHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let textStart = 0;
  let index = 0;

  while (index < html.length) {
    if (html[index] !== "<") {
      index += 1;
      continue;
    }
    const next = html[index + 1] ?? "";
    if (!TAG_START_RE.test(next)) {
      index += 1;
      continue;
    }
    const tagEnd = findTagEnd(html, index);
    if (tagEnd === -1) {
      index += 1;
      continue;
    }
    if (index > textStart) {
      tokens.push({ kind: "text", value: html.slice(textStart, index) });
    }
    tokens.push({ kind: "tag", value: html.slice(index, tagEnd + 1) });
    index = tagEnd + 1;
    textStart = index;
  }

  if (textStart < html.length) {
    tokens.push({ kind: "text", value: html.slice(textStart) });
  }
  return tokens;
}

export function extractVisibleText(html: string): string {
  let visible = "";
  for (const token of splitHtml(html)) {
    if (token.kind === "text") {
      visible += token.value;
    }
  }
  return visible.replace(
    BASIC_ENTITY_RE,
    (entity, name: string) => BASIC_ENTITIES[name.toLowerCase()] ?? entity
  );
}

interface VisibleCharacter {
  index: number;
  token: TextToken;
}

type BracketEdits = Map<TextToken, Map<number, string>>;

function queueBracketEdit(
  characters: readonly VisibleCharacter[],
  edits: BracketEdits,
  start: number,
  end: number,
  replacement: string
): void {
  if (end <= start) {
    return;
  }
  for (let position = start; position < end; position += 1) {
    const character = characters[position];
    if (!character) {
      continue;
    }
    let tokenEdits = edits.get(character.token);
    if (!tokenEdits) {
      tokenEdits = new Map<number, string>();
      edits.set(character.token, tokenEdits);
    }
    tokenEdits.set(character.index, position === start ? replacement : "");
  }
}

function applyBracketEdits(edits: BracketEdits): void {
  for (const [token, tokenEdits] of edits) {
    let value = "";
    for (let index = 0; index < token.value.length; index += 1) {
      value += tokenEdits.get(index) ?? token.value[index] ?? "";
    }
    token.value = value;
  }
}

function normalizeCjkBracketSeams(textTokens: TextToken[]): void {
  let visible = "";
  const characters: VisibleCharacter[] = [];
  for (const token of textTokens) {
    visible += token.value;
    for (let index = 0; index < token.value.length; index += 1) {
      characters.push({ index, token });
    }
  }

  const edits: BracketEdits = new Map<TextToken, Map<number, string>>();
  for (const match of visible.matchAll(CJK_BRACKET_SEAM_RE)) {
    const matchStart = match.index;
    if (matchStart === undefined) {
      continue;
    }
    const [fullMatch] = match;
    const bracketStart = matchStart + fullMatch.indexOf("[");
    const bracketEnd = matchStart + fullMatch.lastIndexOf("]");
    const inner = match.groups?.inner ?? "";
    const left = visible[matchStart - 1] ?? "";
    const right = visible[matchStart + fullMatch.length] ?? "";
    const leftIsCjk = CJK_RE.test(left);
    const rightIsCjk = CJK_RE.test(right);
    if (!(leftIsCjk || rightIsCjk || CJK_RE.test(inner))) {
      continue;
    }

    const innerStart = bracketStart + 1;
    const innerLeading = inner.length - inner.trimStart().length;
    const innerTrailing = inner.length - inner.trimEnd().length;
    if (leftIsCjk) {
      queueBracketEdit(characters, edits, matchStart, bracketStart, "");
    }
    if (rightIsCjk) {
      queueBracketEdit(
        characters,
        edits,
        bracketEnd + 1,
        matchStart + fullMatch.length,
        ""
      );
    }
    queueBracketEdit(
      characters,
      edits,
      innerStart,
      innerStart + innerLeading,
      ""
    );
    queueBracketEdit(
      characters,
      edits,
      bracketEnd - innerTrailing,
      bracketEnd,
      ""
    );
    queueBracketEdit(characters, edits, bracketStart, innerStart, "【");
    queueBracketEdit(characters, edits, bracketEnd, bracketEnd + 1, "】");
  }
  applyBracketEdits(edits);
}

function normalizePunctuationSeams(textTokens: TextToken[]): void {
  forEachPair(textTokens, (current, next) => {
    const left = current.value.at(-1) ?? "";
    const match = LEADING_ADJ_PUNCT_RE.exec(next.value);
    const punct = match?.[1];
    if (!(CJK_OR_CLOSE_RE.test(left) && match && punct)) {
      return;
    }
    next.value = `${HALF_TO_FULL_PUNCT[punct] ?? punct}${next.value.slice(
      match[0].length
    )}`;
  });
}

function spaceHtmlSeams(textTokens: TextToken[]): void {
  forEachPair(textTokens, (current, next) => {
    const left = current.value.at(-1) ?? "";
    const right = next.value[0] ?? "";
    if (URL_AT_END_RE.test(current.value) || URL_AT_START_RE.test(next.value)) {
      return;
    }
    if (needsSpaceBetween(left, right)) {
      if (CJK_RE.test(left)) {
        current.value += " ";
      } else {
        next.value = ` ${next.value}`;
      }
    }
  });
}

export function normalizeChineseText(
  html: string,
  opts: NormalizeChineseOptions
): string {
  const tokens = splitHtml(html);
  const textTokens = tokens.filter(
    (token): token is TextToken => token.kind === "text"
  );

  if (opts.punctNorm !== "off") {
    for (const token of textTokens) {
      token.value = normalizePunctuation(token.value, opts.punctNorm);
    }
    normalizeCjkBracketSeams(textTokens);
    normalizePunctuationSeams(textTokens);
  }

  if (opts.spacingMode === "js" || opts.spacingMode === "both") {
    const beforeSpacing = textTokens.map((token) => token.value);
    for (const token of textTokens) {
      token.value = spaceCjkText(token.value);
    }
    spaceHtmlSeams(textTokens);
    if (opts.debugSpacingMarks) {
      for (const [index, token] of textTokens.entries()) {
        token.value = formatDebugSpacingMarks(
          beforeSpacing[index] ?? "",
          token.value
        );
      }
    }
  }

  return tokens.map((token) => token.value).join("");
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
      const element = node as Element;
      if (
        element.hasAttribute("data-tr-no-opencc") ||
        skipPredicate?.(element)
      ) {
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
      const element = node as Element;
      if (
        element.hasAttribute("data-tr-no-space") ||
        options?.skipPredicate?.(element)
      ) {
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Verbatim legacy seam behavior preserved for renderer parity.
  forEachPair(textNodes, (current, next) => {
    if (current.skip && next.skip) {
      return;
    }
    const leftValue = current.node.nodeValue ?? "";
    const rightValue = next.node.nodeValue ?? "";
    if (!(leftValue && rightValue)) {
      return;
    }
    const left = leftValue.at(-1) ?? "";
    const right = rightValue[0] ?? "";

    let shouldSpace = needsSpaceBetween(left, right);
    if (!shouldSpace && (current.skip || next.skip)) {
      if (
        !current.skip &&
        next.skip &&
        CJK_RE.test(left) &&
        ASCII_PRINTABLE_RE.test(right)
      ) {
        shouldSpace = true;
      } else if (
        current.skip &&
        !next.skip &&
        ASCII_PRINTABLE_RE.test(left) &&
        CJK_RE.test(right)
      ) {
        shouldSpace = true;
      }
    }

    if (shouldSpace) {
      const separator = options?.debugMarks ? "^" : " ";
      if (!current.skip) {
        current.node.nodeValue = `${leftValue}${separator}`;
      } else if (!next.skip) {
        next.node.nodeValue = `${separator}${rightValue}`;
      }
    }
  });
}

export function applyNormalizationToFragment(
  root: Node,
  opts: NormalizeChineseOptions
): void {
  applyPunctNormToFragment(root, opts.punctNorm);
  if (opts.spacingMode === "js" || opts.spacingMode === "both") {
    applySpacingToFragment(root, { debugMarks: opts.debugSpacingMarks });
  }
}
