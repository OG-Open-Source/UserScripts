const STOP_WORDS = new Set([
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
  "Update",
]);

const TOKEN_RE = /\b[A-Za-z][A-Za-z0-9._+-]{1,31}\b/gu;
const CAMEL_OR_ACRONYM = /(?:[a-z][A-Z]|[A-Z]{2,}|[A-Za-z]\.[A-Za-z])/u;
const LEADING_UPPER_RE = /^[A-Z]/u;
const HTML_TAG_SPLIT_RE = /(?<tag><[^>]+>)/gu;
const KW_OPEN_RE = /^<span\b[^>]*data-ptr-kw\b/iu;
const SPAN_CLOSE_RE = /^<\/span\s*>$/iu;

export function extractPageKeywords(texts: readonly string[]): string[] {
  const segCounts = new Map<string, number>();

  for (const text of texts) {
    const seenInSeg = new Set<string>();
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

  const out: string[] = [];
  for (const [token, count] of segCounts) {
    if (count < 2) {
      continue;
    }
    if (
      CAMEL_OR_ACRONYM.test(token) ||
      (count >= 3 && LEADING_UPPER_RE.test(token))
    ) {
      out.push(token);
    }
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function maskKeywordsInHtml(
  html: string,
  keywords: readonly string[]
): string {
  const clean = Array.from(
    new Set(keywords.map((k) => k.trim()).filter((k) => k.length >= 2))
  ).sort((a, b) => b.length - a.length);
  if (clean.length === 0) {
    return html;
  }

  const pattern = new RegExp(
    `\\b(?<kw>${clean.map(escapeRegex).join("|")})\\b`,
    "gu"
  );

  // Split around HTML tags so attributes and tag names are never altered.
  const parts = html.split(HTML_TAG_SPLIT_RE);
  let insideKw = 0;
  return parts
    .map((part) => {
      if (part.startsWith("<") && part.endsWith(">")) {
        if (KW_OPEN_RE.test(part)) {
          insideKw += 1;
        } else if (insideKw > 0 && SPAN_CLOSE_RE.test(part)) {
          insideKw -= 1;
        }
        return part;
      }
      if (insideKw > 0) {
        return part;
      }
      return part.replace(
        pattern,
        '<span translate="no" data-ptr-kw="1">$<kw></span>'
      );
    })
    .join("");
}
