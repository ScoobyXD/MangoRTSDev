export type EmailBodyHighlightRange = {
  id: string;
  quote: string;
  startOffset: number;
  endOffset: number;
};

export type EmailBodyActiveHighlight = Omit<EmailBodyHighlightRange, "id">;

type ResolvedEmailBodyHighlightRange = EmailBodyHighlightRange & {
  active: boolean;
  start: number;
  end: number;
};

const EMAIL_BODY_HIGHLIGHT_ATTRIBUTE = "data-mango-email-body-highlight";

function resolvedRange(
  text: string,
  highlight: EmailBodyHighlightRange,
  active: boolean,
): ResolvedEmailBodyHighlightRange | null {
  const quote = highlight.quote.trim();
  if (!quote) return null;
  let start = Math.max(0, Math.min(text.length, Math.round(highlight.startOffset)));
  let end = Math.max(start, Math.min(text.length, Math.round(highlight.endOffset)));
  if (end <= start || text.slice(start, end) !== quote) {
    const found = text.indexOf(quote);
    if (found < 0) return null;
    start = found;
    end = found + quote.length;
  }
  return { ...highlight, quote, active, start, end };
}

function unwrapExistingHighlights(document: Document): void {
  const highlights = Array.from(document.body?.querySelectorAll<HTMLElement>(`[${EMAIL_BODY_HIGHLIGHT_ATTRIBUTE}]`) ?? []);
  highlights.forEach((highlight) => highlight.replaceWith(...Array.from(highlight.childNodes)));
  document.body?.normalize();
}

function emailBodyTextNodes(document: Document): Text[] {
  if (!document.body) return [];
  const showText = document.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = document.createTreeWalker(document.body, showText);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const owner = textNode.parentElement;
    if (textNode.data && !owner?.closest("script, style, noscript")) nodes.push(textNode);
    node = walker.nextNode();
  }
  return nodes;
}

function wrapRange(document: Document, range: ResolvedEmailBodyHighlightRange): void {
  let offset = 0;
  for (const textNode of emailBodyTextNodes(document)) {
    const nodeStart = offset;
    const nodeEnd = nodeStart + textNode.data.length;
    offset = nodeEnd;
    if (range.start >= nodeEnd || range.end <= nodeStart) continue;
    const localStart = Math.max(0, range.start - nodeStart);
    const localEnd = Math.min(textNode.data.length, range.end - nodeStart);
    if (localEnd <= localStart) continue;
    let selectedNode = textNode;
    if (localStart > 0) selectedNode = textNode.splitText(localStart);
    const selectedLength = localEnd - localStart;
    if (selectedLength < selectedNode.data.length) selectedNode.splitText(selectedLength);
    const marker = document.createElement("span");
    marker.setAttribute(EMAIL_BODY_HIGHLIGHT_ATTRIBUTE, range.active ? "active" : "stored");
    marker.setAttribute("data-mango-email-highlight-id", range.id);
    marker.style.borderRadius = "4px";
    marker.style.background = range.active
      ? "linear-gradient(135deg, rgba(255,255,80,0.88), rgba(250,245,24,0.78))"
      : "linear-gradient(135deg, rgba(254,255,102,0.72), rgba(250,232,28,0.58))";
    marker.style.boxShadow = range.active
      ? "0 0 0 2px rgba(234,179,8,0.72), 0 0 18px rgba(250,255,0,0.34)"
      : "0 0 0 1px rgba(234,179,8,0.32)";
    selectedNode.parentNode?.replaceChild(marker, selectedNode);
    marker.appendChild(selectedNode);
  }
}

/** Paints persisted and active chat selections inside a sandboxed rich-email body document. */
export function applyEmailBodyHighlights(
  document: Document | null | undefined,
  highlights: readonly EmailBodyHighlightRange[],
  activeSelection?: EmailBodyActiveHighlight | null,
): void {
  if (!document?.body) return;
  unwrapExistingHighlights(document);
  const text = document.body.textContent ?? "";
  const active = activeSelection?.quote.trim()
    ? resolvedRange(text, { id: "active-email-chat-selection", ...activeSelection }, true)
    : null;
  const candidates = [
    ...(active ? [active] : []),
    ...highlights.flatMap((highlight) => {
      const resolved = resolvedRange(text, highlight, false);
      return resolved ? [resolved] : [];
    }),
  ];
  const selected: ResolvedEmailBodyHighlightRange[] = [];
  for (const candidate of candidates) {
    if (selected.some((current) => candidate.start < current.end && candidate.end > current.start)) continue;
    selected.push(candidate);
  }
  selected.sort((left, right) => right.start - left.start || right.end - left.end);
  selected.forEach((range) => wrapRange(document, range));
}
