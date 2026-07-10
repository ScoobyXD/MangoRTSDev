export type ChatTextLinkSegment = {
  text: string;
  href?: string;
};

const CHAT_TEXT_URL_PATTERN = /\b(?:(?:https?:\/\/|www\.)[^\s<>]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>]*)?)/gi;
const CHAT_TEXT_URL_TRAILING_PUNCTUATION = /[.,!?;:'"\]\)}]+$/;

export function splitChatTextLinks(text: string): ChatTextLinkSegment[] {
  if (!text) return [];
  const segments: ChatTextLinkSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CHAT_TEXT_URL_PATTERN)) {
    const start = match.index ?? 0;
    const rawMatch = match[0];
    if (start > 0 && text[start - 1] === "@") continue;
    const cleanURL = rawMatch.replace(CHAT_TEXT_URL_TRAILING_PUNCTUATION, "");
    if (!cleanURL) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    segments.push({
      text: cleanURL,
      href: /^https?:\/\//i.test(cleanURL) ? cleanURL : `https://${cleanURL}`,
    });
    const cleanEnd = start + cleanURL.length;
    const rawEnd = start + rawMatch.length;
    if (rawEnd > cleanEnd) segments.push({ text: text.slice(cleanEnd, rawEnd) });
    cursor = rawEnd;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments.length > 0 ? segments : [{ text }];
}
