import { serializeEditorDocumentHTML } from "../richTextEditing.js";

export type EmailTextBoxLinkState = {
  linkedEmailMessageIDs: readonly string[];
  stagedEmailMessageID?: string;
  temporaryEmailChat?: boolean;
  color?: string;
};

export const EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME = "application/x-mango-email-message-text-box-link";

export type EmailMessageTextBoxLinkDragData = {
  emailMessageID: string;
};

export const EMAIL_TEXT_BOX_COLORS = [
  "#0EA5E9",
  "#14B8A6",
  "#8B5CF6",
  "#F59E0B",
  "#22C55E",
  "#6366F1",
  "#06B6D4",
  "#84CC16",
  "#A855F7",
  "#10B981",
  "#EAB308",
  "#3B82F6",
] as const;

export function nextEmailTextBoxColor(existingColors: Iterable<string>): string {
  const normalized = Array.from(existingColors, (color) => color.trim().toUpperCase()).filter(Boolean);
  const used = new Set(normalized);
  return EMAIL_TEXT_BOX_COLORS.find((color) => !used.has(color))
    ?? EMAIL_TEXT_BOX_COLORS[normalized.length % EMAIL_TEXT_BOX_COLORS.length]
    ?? EMAIL_TEXT_BOX_COLORS[0];
}

export function writeEmailMessageTextBoxLinkDrag(dataTransfer: DataTransfer, emailMessageID: string): void {
  const cleanEmailMessageID = emailMessageID.trim();
  if (!cleanEmailMessageID) throw new Error("email_message_id_missing");
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME, JSON.stringify({
    email_message_id: cleanEmailMessageID,
  }));
}

export function parseEmailMessageTextBoxLinkDrag(dataTransfer: DataTransfer): EmailMessageTextBoxLinkDragData | null {
  const raw = dataTransfer.getData(EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { email_message_id?: unknown };
    const emailMessageID = typeof parsed.email_message_id === "string" ? parsed.email_message_id.trim() : "";
    return emailMessageID ? { emailMessageID } : null;
  } catch {
    return null;
  }
}

export function textBoxHasLinkedEmailMessage(
  textBox: Pick<EmailTextBoxLinkState, "linkedEmailMessageIDs">,
  messageID: string,
): boolean {
  const cleanMessageID = messageID.trim();
  return Boolean(cleanMessageID && textBox.linkedEmailMessageIDs.some((candidate) => candidate.trim() === cleanMessageID));
}

export function textBoxMatchesEmailSelection(
  textBox: Pick<EmailTextBoxLinkState, "linkedEmailMessageIDs" | "stagedEmailMessageID" | "temporaryEmailChat">,
  messageID: string,
): boolean {
  if (textBoxHasLinkedEmailMessage(textBox, messageID)) return true;
  const cleanMessageID = messageID.trim();
  return Boolean(textBox.temporaryEmailChat && cleanMessageID && textBox.stagedEmailMessageID?.trim() === cleanMessageID);
}

export function linkedEmailMessageAccents(
  textBoxes: readonly Pick<EmailTextBoxLinkState, "linkedEmailMessageIDs" | "color">[],
): Record<string, string> {
  return Object.fromEntries(textBoxes.flatMap((textBox) => {
    const color = textBox.color?.trim() ?? "";
    return textBox.linkedEmailMessageIDs.map((messageID) => [messageID.trim(), color] as const).filter(([messageID]) => Boolean(messageID));
  }));
}

export function moveEmailChatComposerEntry<T>(
  entries: Record<string, T>,
  sourceTextBoxID: string,
  destinationTextBoxID: string,
): Record<string, T> {
  if (!Object.prototype.hasOwnProperty.call(entries, sourceTextBoxID)) return entries;
  const next = { ...entries, [destinationTextBoxID]: entries[sourceTextBoxID] as T };
  delete next[sourceTextBoxID];
  return next;
}

export function createEmailSelectionDocument(ownerDocument: Document, quote: string): string {
  const container = ownerDocument.createElement("div");
  const paragraph = ownerDocument.createElement("div");
  quote.split(/\r\n|\r|\n/).forEach((line, index) => {
    if (index > 0) paragraph.appendChild(ownerDocument.createElement("br"));
    paragraph.appendChild(ownerDocument.createTextNode(line));
  });
  container.appendChild(paragraph);
  return serializeEditorDocumentHTML(container);
}
