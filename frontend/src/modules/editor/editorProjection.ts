export type EditorProjectionItem = {
  information_id: string;
  type: string;
  information: string;
  created_timestamp?: string;
  updated_timestamp?: string;
};

export const EDITOR_TEXT_BLOCK_TYPE = "Text box";
export const EDITOR_TEXT_BLOCK_CHAT_TYPE = "Text block chat";
export const EDITOR_ATTACHED_EMAIL_TYPE = "Attached email";

export type EditorTextBlockProjection<T extends EditorProjectionItem = EditorProjectionItem> = T & {
  type: typeof EDITOR_TEXT_BLOCK_TYPE;
};

export type EditorTextBlockChatMessage = {
  id: string;
  blockID: string;
  authorID: string;
  authorName: string;
  message: string;
  createdTimestamp: string;
};

export type EditorAttachedEmail = {
  id: string;
  messageID: string;
  threadID?: string;
  subject: string;
  snippet?: string;
  from?: string;
  date?: number;
  attachedTimestamp: string;
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
    .sort(compareProjectionCreated);
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
  authorID?: string;
  authorName: string;
  message: string;
  createdTimestamp: string;
}): string {
  return JSON.stringify({
    block_id: input.blockID,
    author_id: input.authorID ?? "",
    author_name: input.authorName,
    message: input.message,
    created_timestamp: input.createdTimestamp,
  });
}

export function buildEditorAttachedEmailPayload(input: {
  messageID: string;
  threadID?: string;
  subject: string;
  snippet?: string;
  from?: string;
  date?: number;
  attachedTimestamp: string;
}): string {
  return JSON.stringify({
    message_id: input.messageID,
    thread_id: input.threadID ?? "",
    subject: input.subject,
    snippet: input.snippet ?? "",
    from: input.from ?? "",
    date: input.date ?? null,
    attached_timestamp: input.attachedTimestamp,
  });
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

function numberValue(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseEditorTextBlockChat(item: EditorProjectionItem): EditorTextBlockChatMessage | null {
  const payload = parsePayload(item.information);
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const blockID = stringValue(record, "block_id");
  const message = stringValue(record, "message");
  if (!blockID || !message) return null;
  return {
    id: item.information_id,
    blockID,
    authorID: stringValue(record, "author_id"),
    authorName: stringValue(record, "author_name") || "Unknown user",
    message,
    createdTimestamp: stringValue(record, "created_timestamp") || item.created_timestamp || "",
  };
}

function parseEditorAttachedEmail(item: EditorProjectionItem): EditorAttachedEmail | null {
  const payload = parsePayload(item.information);
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const messageID = stringValue(record, "message_id");
  if (!messageID) return null;
  const threadID = stringValue(record, "thread_id");
  const snippet = stringValue(record, "snippet");
  const from = stringValue(record, "from");
  return {
    id: item.information_id,
    messageID,
    threadID: threadID || undefined,
    subject: stringValue(record, "subject") || "(no subject)",
    snippet: snippet || undefined,
    from: from || undefined,
    date: numberValue(record, "date"),
    attachedTimestamp: stringValue(record, "attached_timestamp") || item.created_timestamp || "",
  };
}
