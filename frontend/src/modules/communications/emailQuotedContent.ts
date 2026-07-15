export type EmailQuotedContentSplit = {
  authoredBody: string;
  hasQuotedHistory: boolean;
};

const EMAIL_HTML_PATTERN = /<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/i;
const HTML_QUOTE_CONTAINER_PATTERNS = [
  /<(?:blockquote|div|section|table|span)\b[^>]*(?:gmail_quote|gmail_extra|yahoo_quoted|protonmail_quote|moz-cite-prefix|zmail_extra|icloud_quote|divRplyFwdMsg|appendonsend|OutlookMessageHeader|quoted-text|replyForwardMessage)[^>]*>/gi,
  /<blockquote\b[^>]*(?:type\s*=\s*["']?cite\b|\bcite\s*=|data-original-content\s*=)[^>]*>/gi,
  /<!--\s*(?:begin\s+)?(?:original|quoted)\s+message\s*-->/gi,
  /-{2,}\s*(?:<[^>]+>\s*)*(?:Original|Forwarded)\s+Message\s*(?:<[^>]+>\s*)*-{2,}/gi,
];

function decodeEmailTextEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function emailVisibleText(value: string): string {
  return decodeEmailTextEntities(value)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(?:div|p|li|tr|table|section|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function meaningfulAuthoredPrefix(value: string): boolean {
  return emailVisibleText(value).replace(/[>\s-]+/g, "").length > 0;
}

function normalizedHTMLPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || typeof DOMParser === "undefined") return trimmed;
  try {
    const parsed = new DOMParser().parseFromString(trimmed, "text/html");
    return parsed.body.innerHTML.trim();
  } catch {
    return trimmed;
  }
}

function earliestHTMLQuoteContainer(body: string): number {
  let boundary = -1;
  for (const pattern of HTML_QUOTE_CONTAINER_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
      if (!meaningfulAuthoredPrefix(body.slice(0, match.index))) continue;
      boundary = boundary < 0 ? match.index : Math.min(boundary, match.index);
      break;
    }
  }
  return boundary;
}

function nearestOutlookHTMLBoundary(body: string): number {
  const fromLabelPattern = /<(?:b|strong)\b[^>]*>\s*From:\s*<\/(?:b|strong)>/gi;
  for (let match = fromLabelPattern.exec(body); match; match = fromLabelPattern.exec(body)) {
    const suffixText = emailVisibleText(body.slice(match.index, match.index + 5000));
    const headerLabels = [/(?:^|\n)\s*(?:Sent|Date):/im, /(?:^|\n)\s*To:/im, /(?:^|\n)\s*Subject:/im]
      .filter((pattern) => pattern.test(suffixText)).length;
    if (headerLabels < 2 || !meaningfulAuthoredPrefix(body.slice(0, match.index))) continue;

    const searchStart = Math.max(0, match.index - 1000);
    const leadingHTML = body.slice(searchStart, match.index);
    const horizontalRuleOffset = leadingHTML.toLowerCase().lastIndexOf("<hr");
    if (horizontalRuleOffset >= 0) return searchStart + horizontalRuleOffset;
    const blockOffsets = ["<div", "<table", "<p"].map((token) => leadingHTML.toLowerCase().lastIndexOf(token));
    const blockOffset = Math.max(...blockOffsets);
    return blockOffset >= 0 ? searchStart + blockOffset : match.index;
  }
  return -1;
}

function splitHTMLQuotedHistory(body: string): EmailQuotedContentSplit {
  const containerBoundary = earliestHTMLQuoteContainer(body);
  const outlookBoundary = nearestOutlookHTMLBoundary(body);
  const candidates = [containerBoundary, outlookBoundary].filter((candidate) => candidate >= 0);
  if (candidates.length === 0) return { authoredBody: body, hasQuotedHistory: false };
  const boundary = Math.min(...candidates);
  const authoredBody = normalizedHTMLPrefix(body.slice(0, boundary));
  if (!meaningfulAuthoredPrefix(authoredBody)) return { authoredBody: body, hasQuotedHistory: false };
  return { authoredBody, hasQuotedHistory: true };
}

function plainHeaderBlockStartsAt(lines: string[], index: number): boolean {
  if (!/^\s*From:\s+\S/i.test(lines[index] ?? "")) return false;
  const headerWindow = lines.slice(index, index + 9).join("\n");
  const matchingLabels = [/^\s*(?:Sent|Date):/im, /^\s*To:/im, /^\s*Subject:/im]
    .filter((pattern) => pattern.test(headerWindow)).length;
  return matchingLabels >= 2;
}

function quotedPlainTextRunStartsAt(lines: string[], index: number): boolean {
  if (!/^\s*>/.test(lines[index] ?? "")) return false;
  const remainingLines = lines.slice(index);
  const quoteLineCount = remainingLines.filter((line) => /^\s*>/.test(line)).length;
  if (quoteLineCount < 2 || !remainingLines.every((line) => !line.trim() || /^\s*>/.test(line))) return false;

  const unquotedRun = remainingLines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n");
  if (/^\s*On\s+.{3,}\s+wrote:\s*$/im.test(unquotedRun)) return true;
  if (!/^\s*From:\s+\S/im.test(unquotedRun)) return false;
  const matchingLabels = [/^\s*(?:Sent|Date):/im, /^\s*To:/im, /^\s*Subject:/im]
    .filter((pattern) => pattern.test(unquotedRun)).length;
  return matchingLabels >= 2;
}

function plainTextQuoteBoundary(lines: string[]): number {
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const precedingBody = lines.slice(0, index).join("\n");
    if (!meaningfulAuthoredPrefix(precedingBody)) continue;
    if (/^\s*-{2,}\s*(?:Original|Forwarded)\s+Message\s*-{2,}\s*$/i.test(line)) return index;
    if (/^\s*On\s+.{3,}\s+wrote:\s*$/i.test(line) && meaningfulAuthoredPrefix(lines.slice(index + 1).join("\n"))) return index;
    if (plainHeaderBlockStartsAt(lines, index)) return index;
    if (quotedPlainTextRunStartsAt(lines, index)) return index;
  }
  return -1;
}

function splitPlainTextQuotedHistory(body: string): EmailQuotedContentSplit {
  const lineEnding = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const boundary = plainTextQuoteBoundary(lines);
  if (boundary < 0) return { authoredBody: body, hasQuotedHistory: false };
  const authoredBody = lines.slice(0, boundary).join(lineEnding).trimEnd();
  if (!meaningfulAuthoredPrefix(authoredBody)) return { authoredBody: body, hasQuotedHistory: false };
  return { authoredBody, hasQuotedHistory: true };
}

/**
 * Derives the newly authored portion of a provider message for thread display.
 * The caller must retain the original body for reply/forward fidelity and any
 * explicit "show quoted history" affordance.
 */
export function splitEmailQuotedHistory(body: string): EmailQuotedContentSplit {
  if (!body.trim()) return { authoredBody: body, hasQuotedHistory: false };
  return EMAIL_HTML_PATTERN.test(body)
    ? splitHTMLQuotedHistory(body)
    : splitPlainTextQuotedHistory(body);
}
