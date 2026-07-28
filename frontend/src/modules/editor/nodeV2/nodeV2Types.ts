import type { MangoAttachment } from "../../attachments/attachmentApi.js";
import type { MangoTiptapDocument } from "../tiptap/mangoTiptapDocument.js";

export type NodeV2Cursor = {
  v: 1;
  kind: "node_v2_timeline" | "node_v2_textboxes_active" | "node_v2_textboxes_archived" | "node_v2_comments" | "node_v2_comment_replies" | "node_v2_attachments" | "node_v2_email_threads" | "node_v2_email_messages";
  timestamp?: string;
  id: string;
  sequence?: number;
  order?: number;
};

export type NodeV2Availability = {
  active: boolean;
  reason?: "node_v2_schema_unavailable" | "workspace_not_converted";
};

export type NodeV2TextBoxSummary = {
  company_id: string;
  node_id: string;
  textbox_id: string;
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

export type NodeV2TextBox = NodeV2TextBoxSummary & {
  document_json: MangoTiptapDocument;
  plain_text: string;
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

export type NodeV2AnchorFormat = "none" | "legacy_offsets_v1" | "yjs_relative_v1";
export type NodeV2AnchorStatus = "anchored" | "uniquely_recovered" | "ambiguous" | "unanchored" | "deleted_range";

export type NodeV2CommentThread = {
  thread_id: string;
  textbox_id: string;
  selected_quote: string;
  anchor_before_text: string;
  anchor_after_text: string;
  anchor_format: NodeV2AnchorFormat;
  anchor_status: NodeV2AnchorStatus;
  anchor_start_base64?: string;
  anchor_end_base64?: string;
  created_by_display_name: string;
  created_timestamp: string;
  comments: NodeV2Comment[];
  comment_count: number;
  comments_next_cursor?: NodeV2Cursor;
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
  download_status: "partial" | "downloading" | "complete" | "failed";
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
  placement: { logic_gate_id?: string; logic_gate_name?: string; status_key?: string; column_id?: string; is_issue: boolean };
  gvic_summary: Array<{ assignment_id: string; role_key: string; principal_type: string; principal_id: string; principal_name: string }>;
  counts: { textboxes: number; archived_textboxes: number; comments: number; email_threads: number; attachments: number };
  timeline: { items: NodeV2TimelineItem[]; next_cursor?: NodeV2Cursor };
  textboxes: NodeV2TextBoxSummary[];
  textbox_next_cursor?: NodeV2Cursor;
  archived_textboxes: NodeV2TextBoxSummary[];
  archived_next_cursor?: NodeV2Cursor;
  email_thread_summaries: NodeV2EmailThread[];
  email_next_cursor?: NodeV2Cursor;
  attachment_summaries: NodeV2AttachmentLink[];
  attachment_next_cursor?: NodeV2Cursor;
};
