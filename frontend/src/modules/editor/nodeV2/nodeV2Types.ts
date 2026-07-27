import type { MangoAttachment } from "../../attachments/attachmentApi.js";
import type { MangoTiptapDocument } from "../tiptap/mangoTiptapDocument.js";

export type NodeV2Cursor = {
  timestamp: string;
  id: string;
  sequence?: number;
};

export type NodeV2TextBox = {
  company_id: string;
  node_id: string;
  textbox_id: string;
  document_json: MangoTiptapDocument;
  plain_text: string;
  document_schema_version: number;
  content_revision: number;
  collaboration_epoch: string;
  latest_update_sequence: number;
  materialized_through_sequence: number;
  display_order: number;
  created_by_user_id?: string;
  updated_by_user_id?: string;
  created_timestamp: string;
  updated_timestamp: string;
  deleted_timestamp?: string;
  comment_count: number;
  attachment_count: number;
  email_link_count: number;
};

export type NodeV2TimelineItem = {
  timeline_item_id: string;
  timeline_sequence: number;
  item_type: "textbox_created" | "node_moved" | "verification_stamp";
  occurred_at: string;
  actor_user_id?: string;
  textbox_id?: string;
  movement_id?: string;
  verification_event_id?: string;
  summary_json?: Record<string, unknown>;
};

export type NodeV2YjsUpdate = {
  update_sequence: number;
  update_id: string;
  update_sha256: string;
  collaboration_epoch: string;
  client_id: string;
  payload_base64: string;
  received_timestamp: string;
};

export type NodeV2YjsCheckpoint = {
  checkpoint_id: string;
  collaboration_epoch: string;
  through_update_sequence: number;
  payload_base64: string;
  state_vector_base64: string;
  created_timestamp: string;
};

export type NodeV2SyncPage = {
  textbox: NodeV2TextBox;
  checkpoint?: NodeV2YjsCheckpoint;
  updates: NodeV2YjsUpdate[];
  next_sequence?: number;
  has_more: boolean;
};

export type NodeV2Mention = {
  principal_type: "user" | "group";
  principal_id: string;
  principal_display_name: string;
};

export type NodeV2Comment = {
  comment_id: string;
  thread_id: string;
  parent_comment_id?: string;
  author_user_id?: string;
  author_display_name: string;
  body_text: string;
  mentions: NodeV2Mention[];
  created_timestamp: string;
  deleted_timestamp?: string;
};

export type NodeV2CommentThread = {
  thread_id: string;
  textbox_id: string;
  selected_quote: string;
  anchor_before_text: string;
  anchor_after_text: string;
  anchor_format: "yjs_relative_position_v1" | "legacy_unanchored";
  anchor_status: "anchored" | "detached" | "legacy_unanchored";
  anchor_start_base64?: string;
  anchor_end_base64?: string;
  created_by_display_name: string;
  created_timestamp: string;
  comments: NodeV2Comment[];
};

export type NodeV2AttachmentLink = {
  attachment_link_id: string;
  textbox_id: string;
  relationship_kind: "file_attachment" | "inline_image";
  created_timestamp: string;
  deleted_timestamp?: string;
  attachment: MangoAttachment;
};

export type NodeV2EmailThread = {
  email_thread_id: string;
  account_email: string;
  subject: string;
  snippet: string;
  latest_message_at: number;
  message_count: number;
  hydration_status: string;
  history_complete: boolean;
  linked_textbox_ids: string[];
  linked_message_ids: string[];
  node_attached_timestamp: string;
};

export type NodeV2EmailMessage = {
  email_message_id: string;
  email_thread_id: string;
  provider_message_id: string;
  message_order: number;
  subject: string;
  snippet: string;
  date: number;
  from: Array<{ name?: string; email: string }>;
  to: Array<{ name?: string; email: string }>;
  cc: Array<{ name?: string; email: string }>;
  bcc: Array<{ name?: string; email: string }>;
  body_html?: string;
};

export type NodeV2Workspace = {
  node: { node_id: string; name: string };
  counts: { textboxes: number; archived_textboxes: number; comments: number; email_threads: number; attachments: number };
  timeline: { items: NodeV2TimelineItem[]; next_cursor?: NodeV2Cursor };
  textboxes: NodeV2TextBox[];
  archived_textboxes: NodeV2TextBox[];
  email_thread_summaries: NodeV2EmailThread[];
  email_next_cursor?: NodeV2Cursor;
  attachment_summaries: NodeV2AttachmentLink[];
  attachment_next_cursor?: NodeV2Cursor;
};
