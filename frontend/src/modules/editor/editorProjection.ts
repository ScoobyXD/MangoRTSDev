export type EditorProjectionItem = {
  information_id: string;
  type: string;
  information: string;
  is_deleted?: boolean;
  revision?: number;
  created_timestamp?: string;
  updated_timestamp?: string;
};

export const EDITOR_TEXT_BLOCK_TYPE = "Text box";
export const EDITOR_TEXT_BLOCK_CHAT_TYPE = "Text block chat";
export const EDITOR_ATTACHED_EMAIL_TYPE = "Attached email";
export const EDITOR_TEXT_BLOCK_CONTENT_PREFIX = "<!-- mango-node-text-block-v1 -->";

export type EditorTextBlockProjection<T extends EditorProjectionItem = EditorProjectionItem> = T & {
  type: typeof EDITOR_TEXT_BLOCK_TYPE;
};

export type EditorChatAttachment = {
  id: string;
  attachmentID?: string;
  name: string;
  type: string;
  size: number;
  dataURL?: string;
  /** Transient composer-only state. Durable projection payloads never serialize it. */
  transferState?: "processing" | "failed";
};

export type EditorTextBlockChatMessage = {
  id: string;
  blockID: string;
  parentID?: string;
  selectionSource?: "text" | "email";
  selectionMessageID?: string;
  selectionQuote?: string;
  selectionStart?: number;
  selectionEnd?: number;
  authorID: string;
  authorName: string;
  message: string;
  createdTimestamp: string;
  attachments: EditorChatAttachment[];
  mentionedUserIDs?: string[];
  mentionedGroupIDs?: string[];
};

export function canDeleteEditorTextBlockChatMessage(message: Pick<EditorTextBlockChatMessage, "authorID">, currentUserID: string): boolean {
  const authorID = message.authorID.trim();
  const userID = currentUserID.trim();
  return Boolean(authorID && userID && authorID === userID);
}

export type EditorAttachedEmail = {
  id: string;
  blockID?: string;
  collaborationID?: string;
  messageID: string;
  threadID?: string;
  sharedInboxID?: string;
  accountEmail?: string;
  subject: string;
  snippet?: string;
  from?: string;
  date?: number;
  attachedTimestamp: string;
};

export type EditorTextBlockContent = {
  title: string;
  document: string;
  attachments?: EditorChatAttachment[];
};

function compareProjectionFreshness(a: EditorProjectionItem, b: EditorProjectionItem): number {
  const updated = (a.updated_timestamp ?? "").localeCompare(b.updated_timestamp ?? "");
  if (updated !== 0) return updated;
  const created = (a.created_timestamp ?? "").localeCompare(b.created_timestamp ?? "");
  if (created !== 0) return created;
  return a.information_id.localeCompare(b.information_id);
}

function compareProjectionCreated(a: EditorProjectionItem, b: EditorProjectionItem): number {
  const created = (a.created_timestamp ?? "").localeCompare(b.created_timestamp ?? "");
  if (created !== 0) return created;
  return a.information_id.localeCompare(b.information_id);
}

export function selectCurrentEditorTextProjection<T extends EditorProjectionItem>(items: T[]): T | null {
  let current: T | null = null;
  for (const item of items) {
    if (item.type !== EDITOR_TEXT_BLOCK_TYPE) continue;
    if (!current || compareProjectionFreshness(current, item) < 0) current = item;
  }
  return current;
}

export function listEditorTextBlockProjections<T extends EditorProjectionItem>(items: T[]): EditorTextBlockProjection<T>[] {
  return items
    .filter((item): item is EditorTextBlockProjection<T> => item.type === EDITOR_TEXT_BLOCK_TYPE)
    .slice()
    .sort((a, b) => -compareProjectionCreated(a, b));
}

export function parseEditorTextBlockChats(items: EditorProjectionItem[]): EditorTextBlockChatMessage[] {
  return items
    .filter((item) => item.type === EDITOR_TEXT_BLOCK_CHAT_TYPE)
    .map(parseEditorTextBlockChat)
    .filter((item): item is EditorTextBlockChatMessage => item !== null)
    .sort((a, b) => {
      const created = a.createdTimestamp.localeCompare(b.createdTimestamp);
      if (created !== 0) return created;
      return a.id.localeCompare(b.id);
    });
}

export function parseEditorAttachedEmails(items: EditorProjectionItem[]): EditorAttachedEmail[] {
  return items
    .filter((item) => item.type === EDITOR_ATTACHED_EMAIL_TYPE)
    .map(parseEditorAttachedEmail)
    .filter((item): item is EditorAttachedEmail => item !== null)
    .sort((a, b) => b.attachedTimestamp.localeCompare(a.attachedTimestamp));
}

export function buildEditorTextBlockChatPayload(input: {
  blockID: string;
  parentID?: string;
  selectionSource?: "text" | "email";
  selectionMessageID?: string;
  selectionQuote?: string;
  selectionStart?: number;
  selectionEnd?: number;
  authorID?: string;
  authorName: string;
  message: string;
  createdTimestamp: string;
  attachments?: EditorChatAttachment[];
  mentionedUserIDs?: string[];
  mentionedGroupIDs?: string[];
}): string {
  return JSON.stringify({
    block_id: input.blockID,
    parent_id: input.parentID ?? "",
    selection_source: input.selectionSource ?? "text",
    selection_message_id: input.selectionMessageID?.trim() ?? "",
    selection_quote: input.selectionQuote?.trim() ?? "",
    selection_start: Number.isFinite(input.selectionStart) ? input.selectionStart : null,
    selection_end: Number.isFinite(input.selectionEnd) ? input.selectionEnd : null,
    author_id: input.authorID ?? "",
    author_name: input.authorName,
    message: input.message,
    created_timestamp: input.createdTimestamp,
    attachments: normalizeChatAttachments(input.attachments ?? []).map(editorAttachmentReferencePayload),
    mentioned_user_ids: uniqueStringList(input.mentionedUserIDs ?? []),
    mentioned_group_ids: uniqueStringList(input.mentionedGroupIDs ?? []),
  });
}

export function buildEditorAttachedEmailPayload(input: {
  blockID?: string;
  collaborationID?: string;
  messageID: string;
  threadID?: string;
  sharedInboxID?: string;
  accountEmail?: string;
  subject: string;
  snippet?: string;
  from?: string;
  date?: number;
  attachedTimestamp: string;
}): string {
  return JSON.stringify({
    block_id: input.blockID?.trim() ?? "",
    collaboration_id: input.collaborationID?.trim() ?? "",
    message_id: input.messageID,
    thread_id: input.threadID ?? "",
    shared_inbox_id: input.sharedInboxID?.trim() ?? "",
    account_email: input.accountEmail?.trim() ?? "",
    subject: input.subject,
    snippet: input.snippet ?? "",
    from: input.from ?? "",
    date: input.date ?? null,
    attached_timestamp: input.attachedTimestamp,
  });
}

export function parseEditorTextBlockContent(value: string): EditorTextBlockContent {
  if (!value.startsWith(EDITOR_TEXT_BLOCK_CONTENT_PREFIX)) return { title: "", document: value, attachments: [] };
  const payload = parsePayload(value.slice(EDITOR_TEXT_BLOCK_CONTENT_PREFIX.length));
  if (!payload || typeof payload !== "object") return { title: "", document: "", attachments: [] };
  const record = payload as Record<string, unknown>;
  return {
    title: stringValue(record, "title"),
    document: rawStringValue(record, "document"),
    attachments: parseEditorChatAttachments(record.attachments),
  };
}

export function buildEditorTextBlockContentPayload(input: EditorTextBlockContent): string {
  const title = input.title.trim();
  const document = input.document.trim() ? input.document : "";
  const attachments = normalizeChatAttachments(input.attachments ?? []);
  if (!title && !document && attachments.length === 0) return "";
  return `${EDITOR_TEXT_BLOCK_CONTENT_PREFIX}${JSON.stringify({
    title,
    document,
    attachments: attachments.map(editorAttachmentReferencePayload),
  })}`;
}

function parsePayload(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function stringValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function rawStringValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function stringListValue(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value) ? uniqueStringList(value.filter((item): item is string => typeof item === "string")) : [];
}

function uniqueStringList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function numberValue(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerValue(payload: Record<string, unknown>, key: string): number | undefined {
  const value = numberValue(payload, key);
  return value === undefined ? undefined : Math.trunc(value);
}

function normalizeChatAttachments(items: EditorChatAttachment[]): EditorChatAttachment[] {
  return items
    .map((item) => ({
      id: item.id.trim(),
      attachmentID: item.attachmentID?.trim() || undefined,
      name: item.name.trim(),
      type: item.type.trim(),
      size: Number.isFinite(item.size) && item.size > 0 ? Math.round(item.size) : 0,
      dataURL: item.dataURL?.trim() || undefined,
    }))
    .filter((item) => item.id && item.name);
}

function editorAttachmentReferencePayload(attachment: EditorChatAttachment): Record<string, unknown> {
  const attachmentID = attachment.attachmentID?.trim() || attachment.id.trim();
  return {
    id: attachmentID,
    attachment_id: attachmentID,
    name: attachment.name,
    filename: attachment.name,
    type: attachment.type,
    mime_type: attachment.type,
    size: attachment.size,
    byte_size: attachment.size,
  };
}

function parseEditorChatAttachments(value: unknown): EditorChatAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: EditorChatAttachment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const attachmentID = typeof record.attachment_id === "string"
      ? record.attachment_id.trim()
      : typeof record.attachmentID === "string"
        ? record.attachmentID.trim()
        : "";
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : attachmentID;
    const name = typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : typeof record.filename === "string"
        ? record.filename.trim()
        : "";
    if (!id || !name) continue;
    const type = typeof record.type === "string" && record.type.trim()
      ? record.type.trim()
      : typeof record.mime_type === "string"
        ? record.mime_type.trim()
        : "";
    const rawSize = typeof record.size === "number" ? record.size : record.byte_size;
    const size = typeof rawSize === "number" && Number.isFinite(rawSize) && rawSize > 0 ? Math.round(rawSize) : 0;
    const dataURL = typeof record.data_url === "string"
      ? record.data_url.trim()
      : typeof record.dataURL === "string"
        ? record.dataURL.trim()
        : "";
    attachments.push({ id, attachmentID: attachmentID || undefined, name, type, size, dataURL: dataURL || undefined });
  }
  return attachments;
}

function parseEditorTextBlockChat(item: EditorProjectionItem): EditorTextBlockChatMessage | null {
  const payload = parsePayload(item.information);
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const blockID = stringValue(record, "block_id");
  const message = stringValue(record, "message");
  const attachments = parseEditorChatAttachments(record.attachments);
  if (!blockID || (!message && attachments.length === 0)) return null;
  const parentID = stringValue(record, "parent_id");
  return {
    id: item.information_id,
    blockID,
    parentID: parentID || undefined,
    selectionSource: stringValue(record, "selection_source") === "email" ? "email" : "text",
    selectionMessageID: stringValue(record, "selection_message_id") || undefined,
    selectionQuote: stringValue(record, "selection_quote") || undefined,
    selectionStart: integerValue(record, "selection_start"),
    selectionEnd: integerValue(record, "selection_end"),
    authorID: stringValue(record, "author_id"),
    authorName: stringValue(record, "author_name") || "Unknown user",
    message,
    createdTimestamp: stringValue(record, "created_timestamp") || item.created_timestamp || "",
    attachments,
    mentionedUserIDs: stringListValue(record, "mentioned_user_ids"),
    mentionedGroupIDs: stringListValue(record, "mentioned_group_ids"),
  };
}

function parseEditorAttachedEmail(item: EditorProjectionItem): EditorAttachedEmail | null {
  const payload = parsePayload(item.information);
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const messageID = stringValue(record, "message_id");
  if (!messageID) return null;
  const blockID = stringValue(record, "block_id");
  const collaborationID = stringValue(record, "collaboration_id");
  const threadID = stringValue(record, "thread_id");
  const sharedInboxID = stringValue(record, "shared_inbox_id");
  const accountEmail = stringValue(record, "account_email");
  const snippet = stringValue(record, "snippet");
  const from = stringValue(record, "from");
  return {
    id: item.information_id,
    blockID: blockID || undefined,
    collaborationID: collaborationID || undefined,
    messageID,
    threadID: threadID || undefined,
    sharedInboxID: sharedInboxID || undefined,
    accountEmail: accountEmail || undefined,
    subject: stringValue(record, "subject") || "(no subject)",
    snippet: snippet || undefined,
    from: from || undefined,
    date: numberValue(record, "date"),
    attachedTimestamp: stringValue(record, "attached_timestamp") || item.created_timestamp || "",
  };
}
