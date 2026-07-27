import type { RequestJSON } from "../NodeWorkspaceSurfaceShared.js";
import type {
  NodeV2AttachmentLink,
  NodeV2Comment,
  NodeV2CommentThread,
  NodeV2Cursor,
  NodeV2EmailMessage,
  NodeV2EmailThread,
  NodeV2SyncPage,
  NodeV2TextBox,
  NodeV2TimelineItem,
  NodeV2Workspace,
} from "./nodeV2Types.js";

export type NodeV2Client = ReturnType<typeof createNodeV2Client>;

function encodeCursor(cursor?: NodeV2Cursor): string {
  if (!cursor) return "";
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function query(companyID: string, values: Record<string, string | number | boolean | undefined> = {}): string {
  const params = new URLSearchParams({ company_id: companyID });
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
}

export function createNodeV2Client(requestJSON: RequestJSON, companyID: string, nodeID: string) {
  const root = `/v1/nodes/${encodeURIComponent(nodeID)}/v2`;
  return {
    workspace: (limit = 30) => requestJSON<NodeV2Workspace>(`${root}/workspace?${query(companyID, { limit })}`),
    timeline: (cursor?: NodeV2Cursor, limit = 30) => requestJSON<{ items: NodeV2TimelineItem[]; next_cursor?: NodeV2Cursor }>(`${root}/timeline?${query(companyID, { cursor: encodeCursor(cursor), limit })}`),
    createTextbox: (idempotencyKey: string) => requestJSON<{ textbox: NodeV2TextBox; timeline_item: NodeV2TimelineItem }>(`${root}/textboxes?${query(companyID)}`, jsonInit("POST", { idempotency_key: idempotencyKey })),
    textbox: (textboxID: string) => requestJSON<NodeV2TextBox>(`${root}/textboxes/${encodeURIComponent(textboxID)}?${query(companyID)}`),
    archiveTextbox: (textboxID: string, archived: boolean) => requestJSON<NodeV2TextBox>(`${root}/textboxes/${encodeURIComponent(textboxID)}?${query(companyID)}`, jsonInit("PATCH", { archived })),
    orderTextboxes: (textboxIDs: string[]) => requestJSON<{ textboxes: NodeV2TextBox[] }>(`${root}/textbox-order?${query(companyID)}`, jsonInit("PUT", { textbox_ids: textboxIDs })),
    sync: (textboxID: string, afterSequence: number, includeCheckpoint: boolean) => requestJSON<NodeV2SyncPage>(`${root}/textboxes/${encodeURIComponent(textboxID)}/sync?${query(companyID, { after_sequence: afterSequence, include_checkpoint: includeCheckpoint ? 1 : 0, limit: 512 })}`),
    appendUpdate: (textboxID: string, body: Record<string, unknown>, keepalive = false) => requestJSON<{ update_sequence: number }>(`${root}/textboxes/${encodeURIComponent(textboxID)}/updates?${query(companyID)}`, { ...jsonInit("POST", body), keepalive }),
    checkpoint: (textboxID: string, body: Record<string, unknown>) => requestJSON<NodeV2TextBox>(`${root}/textboxes/${encodeURIComponent(textboxID)}/checkpoints?${query(companyID)}`, jsonInit("POST", body)),
    comments: (textboxID: string, cursor?: NodeV2Cursor, limit = 30) => requestJSON<{ threads: NodeV2CommentThread[]; next_cursor?: NodeV2Cursor }>(`${root}/textboxes/${encodeURIComponent(textboxID)}/comments?${query(companyID, { cursor: encodeCursor(cursor), limit })}`),
    createComment: (textboxID: string, body: Record<string, unknown>) => requestJSON<NodeV2CommentThread>(`${root}/textboxes/${encodeURIComponent(textboxID)}/comments?${query(companyID)}`, jsonInit("POST", body)),
    reply: (textboxID: string, threadID: string, body: Record<string, unknown>) => requestJSON<NodeV2Comment>(`${root}/textboxes/${encodeURIComponent(textboxID)}/comments/${encodeURIComponent(threadID)}/replies?${query(companyID)}`, jsonInit("POST", body)),
    attachments: (cursor?: NodeV2Cursor, limit = 30) => requestJSON<{ items: NodeV2AttachmentLink[]; next_cursor?: NodeV2Cursor }>(`${root}/attachments?${query(companyID, { cursor: encodeCursor(cursor), limit })}`),
    linkAttachment: (textboxID: string, attachmentID: string, relationshipKind: "file_attachment" | "inline_image", deleted = false) => requestJSON<NodeV2AttachmentLink>(`${root}/textboxes/${encodeURIComponent(textboxID)}/attachments?${query(companyID)}`, jsonInit("POST", { attachment_id: attachmentID, relationship_kind: relationshipKind, deleted })),
    emails: (cursor?: NodeV2Cursor, limit = 30) => requestJSON<{ items: NodeV2EmailThread[]; next_cursor?: NodeV2Cursor }>(`${root}/emails?${query(companyID, { cursor: encodeCursor(cursor), limit })}`),
    emailMessages: (threadID: string, afterOrder = 0, includeBody = false) => requestJSON<{ items: NodeV2EmailMessage[]; next_order?: number; has_more: boolean }>(`${root}/emails/${encodeURIComponent(threadID)}/messages?${query(companyID, { after_order: afterOrder, include_body: includeBody ? 1 : 0, limit: 30 })}`),
    linkEmail: (textboxID: string, emailThreadID: string, emailMessageID = "", deleted = false) => requestJSON<{ ok: boolean }>(`${root}/textboxes/${encodeURIComponent(textboxID)}/email-links?${query(companyID)}`, jsonInit("POST", { email_thread_id: emailThreadID, email_message_id: emailMessageID, deleted })),
  };
}
