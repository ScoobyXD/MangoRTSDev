import type { EditorChatAttachment } from "../editor/editorProjection.js";
import type { EditorChatEntityLink } from "../editor/chatEntityLinks.js";
import { editorChatEntityLinkPayloads, parseEditorChatEntityLinks } from "../editor/chatEntityLinks.js";

export type HuddleNodeWorkspaceRequest = <T>(
  path: string,
  init?: RequestInit & { json?: unknown },
) => Promise<T>;

export type HuddleNodeTextBox = {
  textbox_id: string;
  title: string;
  revision: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type HuddleNodeChat = {
  chat_id: string;
  textbox_id: string;
  parent_chat_id?: string;
  selection_quote?: string;
  selection_start?: number;
  selection_end?: number;
  message: string;
  author_id: string;
  author_display_name: string;
  entity_links: EditorChatEntityLink[];
  attachments: EditorChatAttachment[];
  mentioned_user_ids: string[];
  mentioned_group_ids: string[];
  revision: number;
  created_timestamp: string;
  updated_timestamp: string;
  edited_timestamp?: string;
};

export type HuddleNodeWorkspace = {
  textboxes: HuddleNodeTextBox[];
  chats: HuddleNodeChat[];
};

type HuddleNodeWorkspacePayload = {
  textboxes?: unknown;
  chats?: unknown;
};

export async function getHuddleNodeWorkspace(
  requestJSON: HuddleNodeWorkspaceRequest,
  input: { companyID: string; huddleNodeID: string },
): Promise<HuddleNodeWorkspace> {
  const payload = await requestJSON<HuddleNodeWorkspacePayload>(
    `/v1/huddle-nodes/${encodeURIComponent(input.huddleNodeID.trim())}/workspace?company_id=${encodeURIComponent(input.companyID.trim())}`,
  );
  return normalizeHuddleNodeWorkspace(payload);
}

export async function createHuddleNodeTextBox(
  requestJSON: HuddleNodeWorkspaceRequest,
  input: { companyID: string; huddleNodeID: string; title: string },
): Promise<HuddleNodeTextBox> {
  const payload = await requestJSON<{ textbox?: unknown }>(
    `/v1/huddle-nodes/${encodeURIComponent(input.huddleNodeID.trim())}/textboxes`,
    { method: "POST", json: { company_id: input.companyID.trim(), title: input.title.trim() } },
  );
  return normalizeTextBox(payload.textbox);
}

export async function updateHuddleNodeTextBoxTitle(
  requestJSON: HuddleNodeWorkspaceRequest,
  input: { companyID: string; huddleNodeID: string; textBoxID: string; title: string },
): Promise<number> {
  const payload = await requestJSON<{ projection_revision?: unknown }>(editorTextBoxPath(input), {
    method: "PATCH",
    json: { title: input.title.trim() },
  });
  return integer(payload.projection_revision);
}

export async function deleteHuddleNodeTextBox(
  requestJSON: HuddleNodeWorkspaceRequest,
  input: { companyID: string; huddleNodeID: string; textBoxID: string; revision: number },
): Promise<void> {
  await requestJSON(editorTextBoxPath(input), {
    method: "DELETE",
    json: {
      operation_id: crypto.randomUUID(),
      client_id: crypto.randomUUID(),
      base_revision: input.revision,
    },
  });
}

export async function createHuddleNodeChat(
  requestJSON: HuddleNodeWorkspaceRequest,
  input: {
    companyID: string;
    huddleNodeID: string;
    textBoxID: string;
    parentChatID?: string;
    message: string;
    entityLinks?: readonly EditorChatEntityLink[];
    selectionQuote?: string;
    selectionStart?: number;
    selectionEnd?: number;
    mentionedUserIDs?: readonly string[];
    mentionedGroupIDs?: readonly string[];
  },
): Promise<HuddleNodeChat> {
  const message = input.message.trim();
  const payload = await requestJSON<{ chat?: unknown }>(
    `/v1/huddle-nodes/${encodeURIComponent(input.huddleNodeID.trim())}/chats`,
    {
      method: "POST",
      json: {
        company_id: input.companyID.trim(),
        textbox_id: input.textBoxID.trim(),
        parent_chat_id: input.parentChatID?.trim() || undefined,
        selection_quote: input.selectionQuote?.trim() || undefined,
        selection_start: input.selectionStart,
        selection_end: input.selectionEnd,
        message,
        entity_links: editorChatEntityLinkPayloads(message, input.entityLinks ?? []),
        mentioned_user_ids: uniqueStrings(input.mentionedUserIDs ?? []),
        mentioned_group_ids: uniqueStrings(input.mentionedGroupIDs ?? []),
      },
    },
  );
  return normalizeChat(payload.chat);
}

export async function updateHuddleNodeChat(
  requestJSON: HuddleNodeWorkspaceRequest,
  input: {
    companyID: string;
    huddleNodeID: string;
    textBoxID: string;
    chatID: string;
    revision: number;
    parentChatID?: string;
    message: string;
    entityLinks?: readonly EditorChatEntityLink[];
    selectionQuote?: string;
    selectionStart?: number;
    selectionEnd?: number;
    mentionedUserIDs?: readonly string[];
    mentionedGroupIDs?: readonly string[];
  },
): Promise<HuddleNodeChat> {
  const message = input.message.trim();
  const payload = await requestJSON<{ chat?: unknown }>(huddleNodeChatPath(input), {
    method: "PUT",
    json: {
      company_id: input.companyID.trim(),
      textbox_id: input.textBoxID.trim(),
      parent_chat_id: input.parentChatID?.trim() || undefined,
      selection_quote: input.selectionQuote?.trim() || undefined,
      selection_start: input.selectionStart,
      selection_end: input.selectionEnd,
      message,
      entity_links: editorChatEntityLinkPayloads(message, input.entityLinks ?? []),
      mentioned_user_ids: uniqueStrings(input.mentionedUserIDs ?? []),
      mentioned_group_ids: uniqueStrings(input.mentionedGroupIDs ?? []),
      base_revision: input.revision,
    },
  });
  return normalizeChat(payload.chat);
}

export async function deleteHuddleNodeChat(
  requestJSON: HuddleNodeWorkspaceRequest,
  input: { companyID: string; huddleNodeID: string; chatID: string; revision: number },
): Promise<void> {
  await requestJSON(
    `${huddleNodeChatPath(input)}?company_id=${encodeURIComponent(input.companyID.trim())}&revision=${encodeURIComponent(String(input.revision))}`,
    { method: "DELETE" },
  );
}

export function normalizeHuddleNodeWorkspace(payload: HuddleNodeWorkspacePayload): HuddleNodeWorkspace {
  return {
    textboxes: Array.isArray(payload.textboxes) ? payload.textboxes.map(normalizeTextBox) : [],
    chats: Array.isArray(payload.chats) ? payload.chats.map(normalizeChat) : [],
  };
}

function normalizeTextBox(value: unknown): HuddleNodeTextBox {
  const record = object(value);
  const textBoxID = string(record.textbox_id);
  if (!textBoxID) throw new Error("huddle_node_textbox_id_missing");
  return {
    textbox_id: textBoxID,
    title: string(record.title) || "Text box",
    revision: integer(record.revision),
    created_timestamp: string(record.created_timestamp),
    updated_timestamp: string(record.updated_timestamp),
  };
}

function normalizeChat(value: unknown): HuddleNodeChat {
  const record = object(value);
  const chatID = string(record.chat_id);
  const textBoxID = string(record.textbox_id);
  const message = typeof record.message === "string" ? record.message : "";
  if (!chatID || !textBoxID) throw new Error("huddle_node_chat_identity_missing");
  return {
    chat_id: chatID,
    textbox_id: textBoxID,
    parent_chat_id: string(record.parent_chat_id) || undefined,
    selection_quote: string(record.selection_quote) || undefined,
    selection_start: optionalInteger(record.selection_start),
    selection_end: optionalInteger(record.selection_end),
    message,
    author_id: string(record.author_id),
    author_display_name: string(record.author_display_name) || "Unknown user",
    entity_links: parseEditorChatEntityLinks(record.entity_links, message),
    attachments: normalizeAttachments(record.attachments),
    mentioned_user_ids: strings(record.mentioned_user_ids),
    mentioned_group_ids: strings(record.mentioned_group_ids),
    revision: integer(record.revision),
    created_timestamp: string(record.created_timestamp),
    updated_timestamp: string(record.updated_timestamp),
    edited_timestamp: string(record.edited_timestamp) || undefined,
  };
}

function normalizeAttachments(value: unknown): EditorChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const record = object(candidate);
    const id = string(record.attachmentID) || string(record.attachment_id) || string(record.id);
    if (!id) return [];
    return [{
      id,
      attachmentID: id,
      name: string(record.name) || string(record.filename) || "attachment",
      type: string(record.type) || string(record.mime_type) || "application/octet-stream",
      size: integer(record.size) || integer(record.byte_size),
    }];
  });
}

function editorTextBoxPath(input: { companyID: string; huddleNodeID: string; textBoxID: string }): string {
  return `/v1/editor-json/huddle_node/${encodeURIComponent(input.huddleNodeID.trim())}/documents/${encodeURIComponent(input.textBoxID.trim())}?company_id=${encodeURIComponent(input.companyID.trim())}`;
}

function huddleNodeChatPath(input: { huddleNodeID: string; chatID: string }): string {
  return `/v1/huddle-nodes/${encodeURIComponent(input.huddleNodeID.trim())}/chats/${encodeURIComponent(input.chatID.trim())}`;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value.filter((item): item is string => typeof item === "string")) : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}
