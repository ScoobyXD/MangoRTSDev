export type EmailTextBoxLinkState = {
  linkedEmailMessageIDs: readonly string[];
  stagedEmailMessageID?: string;
  temporaryEmailChat?: boolean;
  color?: string;
};

export const EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME = "application/x-mango-email-message-text-box-link";

export type EmailMessageTextBoxLinkDragData = {
  emailMessageID: string;
  sourceTextBoxID?: string;
};

export function writeEmailMessageTextBoxLinkDrag(dataTransfer: DataTransfer, emailMessageID: string, sourceTextBoxID = ""): void {
  const cleanEmailMessageID = emailMessageID.trim();
  if (!cleanEmailMessageID) throw new Error("email_message_id_missing");
  dataTransfer.effectAllowed = sourceTextBoxID.trim() ? "move" : "copy";
  dataTransfer.setData(EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME, JSON.stringify({
    email_message_id: cleanEmailMessageID,
    ...(sourceTextBoxID.trim() ? { source_textbox_id: sourceTextBoxID.trim() } : {}),
  }));
}

export function parseEmailMessageTextBoxLinkDrag(dataTransfer: DataTransfer): EmailMessageTextBoxLinkDragData | null {
  const raw = dataTransfer.getData(EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { email_message_id?: unknown; source_textbox_id?: unknown };
    const emailMessageID = typeof parsed.email_message_id === "string" ? parsed.email_message_id.trim() : "";
    const sourceTextBoxID = typeof parsed.source_textbox_id === "string" ? parsed.source_textbox_id.trim() : "";
    return emailMessageID ? { emailMessageID, sourceTextBoxID: sourceTextBoxID || undefined } : null;
  } catch {
    return null;
  }
}

export function normalizeLinkedEmailMessageIDs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const messageIDs: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const messageID = candidate.trim();
    if (!messageID || seen.has(messageID)) continue;
    seen.add(messageID);
    messageIDs.push(messageID);
  }
  return messageIDs;
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
    if (!color) return [];
    return textBox.linkedEmailMessageIDs.map((messageID) => [messageID.trim(), color] as const).filter(([messageID]) => Boolean(messageID));
  }));
}

export function compareStoredEmailTimestamps(
  left: { date?: number; emailMessageID: string },
  right: { date?: number; emailMessageID: string },
): number {
  const leftDate = Number.isFinite(left.date) ? Number(left.date) : Number.MAX_SAFE_INTEGER;
  const rightDate = Number.isFinite(right.date) ? Number(right.date) : Number.MAX_SAFE_INTEGER;
  return leftDate - rightDate || left.emailMessageID.localeCompare(right.emailMessageID);
}
