import type { EmailAttachment } from "./communicationsApi.js";

const EMAIL_CID_REFERENCE_PATTERN = /\bcid:([^"'\s>)]+)/gi;

export function normalizeEmailContentID(value: string | undefined): string {
  let clean = value?.trim() ?? "";
  if (!clean) return "";
  clean = clean.replace(/^cid:/i, "").trim();
  clean = clean.replace(/^["']|["']$/g, "").trim();
  clean = clean.replace(/^<|>$/g, "").trim();
  clean = clean.replace(/^&lt;/i, "").replace(/&gt;$/i, "").trim();
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // Some providers send raw Content-ID values; keep the undecoded value.
  }
  return clean.trim().toLowerCase();
}

export function emailAttachmentIsInlineContent(
  attachment: Pick<EmailAttachment, "content_disposition" | "content_id" | "is_inline">,
): boolean {
  return Boolean(attachment.is_inline)
    || Boolean(attachment.content_id?.trim())
    || attachment.content_disposition?.trim().toLowerCase() === "inline";
}

export function emailAttachmentHasResolvableContent(
  attachment: Pick<EmailAttachment, "attachment_id" | "content" | "id">,
): boolean {
  return Boolean(attachment.attachment_id?.trim())
    || Boolean(attachment.id?.trim())
    || Boolean(attachment.content?.trim());
}

export function emailAttachmentContentIDKeys(
  attachment: Pick<EmailAttachment, "content_disposition" | "content_id" | "filename" | "id" | "is_inline">,
): string[] {
  const keys = new Set<string>();
  const add = (value: string | undefined) => {
    const key = normalizeEmailContentID(value);
    if (key) keys.add(key);
  };
  add(attachment.content_id);
  if (emailAttachmentIsInlineContent(attachment)) {
    add(attachment.id);
    add(attachment.filename);
  }
  return Array.from(keys);
}

export function emailBodyContentIDReferences(body: string): Set<string> {
  const references = new Set<string>();
  EMAIL_CID_REFERENCE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EMAIL_CID_REFERENCE_PATTERN.exec(body)) !== null) {
    const key = normalizeEmailContentID(match[1]);
    if (key) references.add(key);
  }
  return references;
}

export function emailAttachmentIsReferencedInline(body: string, attachment: EmailAttachment): boolean {
  const references = emailBodyContentIDReferences(body);
  if (references.size === 0) return false;
  return emailAttachmentContentIDKeys(attachment).some((key) => references.has(key));
}

export function visibleEmailAttachmentsForBody(body: string, attachments: EmailAttachment[]): EmailAttachment[] {
  if (!body.trim() || attachments.length === 0) return attachments;
  return attachments.filter((attachment) => !emailAttachmentIsReferencedInline(body, attachment));
}
