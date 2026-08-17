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
