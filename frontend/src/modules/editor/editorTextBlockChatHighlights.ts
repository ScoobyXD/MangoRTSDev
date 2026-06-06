import type { EditorTextBlockChatMessage } from "./editorProjection.js";

export type EditorTextBlockChatAnchorRange = {
  messageID: string;
  quote: string;
  startOffset: number;
  endOffset: number;
};

function cleanQuote(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanOffset(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
}

function resolveMessageAnchorRange(documentText: string, message: EditorTextBlockChatMessage): EditorTextBlockChatAnchorRange | null {
  if (message.selectionSource === "email") return null;
  const quote = cleanQuote(message.selectionQuote);
  if (!quote) return null;
  const start = cleanOffset(message.selectionStart);
  const end = cleanOffset(message.selectionEnd);
  if (start !== null && end !== null && end > start && end <= documentText.length && documentText.slice(start, end) === quote) {
    return {
      messageID: message.id,
      quote,
      startOffset: start,
      endOffset: end,
    };
  }

  const fallbackStart = documentText.indexOf(quote);
  if (fallbackStart < 0) return null;
  return {
    messageID: message.id,
    quote,
    startOffset: fallbackStart,
    endOffset: fallbackStart + quote.length,
  };
}

export function resolveEditorTextBlockChatAnchorRanges(
  documentText: string,
  messages: EditorTextBlockChatMessage[],
): EditorTextBlockChatAnchorRange[] {
  if (!documentText || messages.length === 0) return [];
  return messages
    .map((message) => resolveMessageAnchorRange(documentText, message))
    .filter((range): range is EditorTextBlockChatAnchorRange => range !== null);
}

export function resolveEditorTextBlockChatAnchorMessageID(
  messages: EditorTextBlockChatMessage[],
  messageID: string,
): string {
  const trimmedMessageID = messageID.trim();
  if (!trimmedMessageID) return "";
  const messagesByID = new Map(messages.map((message) => [message.id, message]));
  const seen = new Set<string>();
  let cursor = trimmedMessageID;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const message = messagesByID.get(cursor);
    if (!message) return "";
    if (message.selectionSource !== "email" && cleanQuote(message.selectionQuote)) return message.id;
    cursor = message.parentID ?? "";
  }
  return "";
}
