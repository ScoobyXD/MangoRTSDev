import { getApiAccessToken, isAuthEnabled, isTerminalAuthFailureActive, markTerminalAuthFailure } from "../../auth/cognitoAuth.js";
import { requestJSON, type RequestJSONInit } from "../api/requestJSON.js";
import {
  uploadBrowserAttachment,
  type MangoAttachmentUploadProgress,
} from "./attachmentDirectUpload.js";

export type { MangoAttachmentUploadProgress, MangoAttachmentUploadState } from "./attachmentDirectUpload.js";

export type MangoAttachmentVariantType = "original" | "display" | "thumbnail";
export type MangoAttachmentSourceKind = "user_upload" | "editor_paste" | "chat_upload" | "email_incoming" | "email_outgoing" | "migration_inline_image";
export type MangoAttachmentRelationshipKind = "inline_image" | "file_attachment" | "chat_attachment" | "email_attachment" | "email_inline_attachment" | "migrated_inline_image";
export type MangoAttachmentResourceType =
  | "node"
  | "logic_gate"
  | "project"
  | "node_chat_message"
  | "logic_gate_chat_message"
  | "project_chat_message"
  | "email_message"
  | "email_draft"
  | "email_signature"
  | "attached_email"
  | "shared_inbox"
  | "company_explorer_folder"
  | "shared_inbox_folder";

export type MangoAttachment = {
  company_id: string;
  attachment_id: string;
  uploaded_by_user_id?: string;
  original_filename: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  sha256_verification_method?: "s3_full" | "server_stream" | "client_reported";
  storage_checksum_algorithm?: string;
  storage_checksum_value?: string;
  storage_checksum_type?: string;
  storage_bucket: string;
  storage_key: string;
  original_width?: number;
  original_height?: number;
  source_kind: MangoAttachmentSourceKind;
  source_provider?: string;
  created_timestamp: string;
  deleted_timestamp?: string;
};

export type MangoResourceAttachment = {
  resource_attachment_id: string;
  company_id: string;
  resource_type: MangoAttachmentResourceType;
  resource_id: string;
  attachment_id: string;
  information_id?: string;
  message_id?: string;
  editor_surface?: string;
  relationship_kind: MangoAttachmentRelationshipKind;
  created_by_user_id?: string;
  created_timestamp: string;
  deleted_timestamp?: string;
  attachment?: MangoAttachment;
};

export type MangoAttachmentUploadResponse = {
  attachment: MangoAttachment;
  resource_attachment: MangoResourceAttachment;
};

export type MangoResourceAttachmentListResponse = {
  company_id: string;
  resource_type: MangoAttachmentResourceType;
  resource_id: string;
  attachments: MangoResourceAttachment[];
};

export type AttachmentRequestJSON = <T>(path: string, init?: RequestJSONInit) => Promise<T>;

export type UploadMangoAttachmentInput = {
  companyID: string;
  resourceType: MangoAttachmentResourceType;
  resourceID: string;
  file: File;
  sourceKind: MangoAttachmentSourceKind;
  relationshipKind: MangoAttachmentRelationshipKind;
  informationID?: string;
  messageID?: string;
  editorSurface?: string;
  sourceProvider?: string;
  originalWidth?: number;
  originalHeight?: number;
  signal?: AbortSignal;
  onProgress?: (progress: MangoAttachmentUploadProgress) => void;
};

export type ListMangoResourceAttachmentsInput = {
  companyID: string;
  resourceType: MangoAttachmentResourceType;
  resourceID: string;
};

export type UnlinkMangoResourceAttachmentInput = ListMangoResourceAttachmentsInput & {
  attachmentID: string;
};

export type MangoResourceAttachmentFilter = {
  relationshipKind?: MangoAttachmentRelationshipKind;
  editorSurface?: string;
};

export async function listMangoResourceAttachments(
  request: AttachmentRequestJSON,
  input: ListMangoResourceAttachmentsInput,
): Promise<MangoResourceAttachmentListResponse> {
  const query = new URLSearchParams({ company_id: input.companyID.trim() });
  return request<MangoResourceAttachmentListResponse>(
    `/v1/resources/${encodeURIComponent(input.resourceType)}/${encodeURIComponent(input.resourceID.trim())}/attachments?${query.toString()}`,
  );
}

export async function unlinkMangoResourceAttachment(
  request: AttachmentRequestJSON,
  input: UnlinkMangoResourceAttachmentInput,
): Promise<void> {
  const companyID = input.companyID.trim();
  const resourceID = input.resourceID.trim();
  const attachmentID = input.attachmentID.trim();
  if (!companyID || !resourceID || !attachmentID) throw new Error("attachment_resource_context_required");
  const query = new URLSearchParams({ company_id: companyID });
  await request<{ status: string }>(
    `/v1/resources/${encodeURIComponent(input.resourceType)}/${encodeURIComponent(resourceID)}/attachments/${encodeURIComponent(attachmentID)}?${query.toString()}`,
    { method: "DELETE" },
  );
}

export function filterMangoResourceAttachments(
  items: readonly MangoResourceAttachment[],
  filter: MangoResourceAttachmentFilter,
): MangoResourceAttachment[] {
  const editorSurface = filter.editorSurface?.trim();
  return items.filter((item) => (
    (!filter.relationshipKind || item.relationship_kind === filter.relationshipKind)
    && (!editorSurface || item.editor_surface?.trim() === editorSurface)
    && !item.deleted_timestamp
    && !!item.attachment
    && !item.attachment.deleted_timestamp
  ));
}

export function groupMangoResourceAttachmentsByInformationID(
  items: readonly MangoResourceAttachment[],
): Map<string, MangoResourceAttachment[]> {
  const grouped = new Map<string, MangoResourceAttachment[]>();
  for (const item of items) {
    const informationID = item.information_id?.trim() ?? "";
    const group = grouped.get(informationID) ?? [];
    group.push(item);
    grouped.set(informationID, group);
  }
  return grouped;
}

export async function uploadMangoAttachment(
  request: AttachmentRequestJSON,
  input: UploadMangoAttachmentInput,
): Promise<MangoAttachmentUploadResponse> {
  return uploadBrowserAttachment(request, input);
}

export function mangoAttachmentContentPath(companyID: string, attachmentID: string, variant: MangoAttachmentVariantType = "display"): string {
  const query = new URLSearchParams({ company_id: companyID.trim(), variant });
  return `/v1/attachments/${encodeURIComponent(attachmentID.trim())}/content?${query.toString()}`;
}

export function mangoEmailDraftResourceID(input: { draftID: string; userID?: string; sharedInboxID?: string }): string {
  const draftID = input.draftID.trim();
  const sharedInboxID = input.sharedInboxID?.trim() ?? "";
  if (sharedInboxID) return `shared:${encodeURIComponent(sharedInboxID)}:${encodeURIComponent(draftID)}`;
  return `personal:${encodeURIComponent(input.userID?.trim() ?? "")}:${encodeURIComponent(draftID)}`;
}

export function mangoEmailSignatureResourceID(input: { userID?: string; accountEmail?: string; sharedInboxID?: string }): string {
  const sharedInboxID = input.sharedInboxID?.trim() ?? "";
  if (sharedInboxID) return `shared:${encodeURIComponent(sharedInboxID)}`;
  return `personal:${encodeURIComponent(input.userID?.trim() ?? "")}:${encodeURIComponent(input.accountEmail?.trim().toLowerCase() ?? "")}`;
}

export function mangoEmailMessageResourceID(input: { messageID: string; userID?: string; sharedInboxID?: string }): string {
  const messageID = input.messageID.trim();
  const sharedInboxID = input.sharedInboxID?.trim() ?? "";
  if (sharedInboxID) return `shared:${encodeURIComponent(sharedInboxID)}:${encodeURIComponent(messageID)}`;
  return `personal:${encodeURIComponent(input.userID?.trim() ?? "")}:${encodeURIComponent(messageID)}`;
}

export function mangoAttachedEmailResourceID(input: { nodeID: string; messageID: string }): string {
  return `node:${encodeURIComponent(input.nodeID.trim())}:message:${encodeURIComponent(input.messageID.trim())}`;
}

export async function fetchMangoAttachmentBlob(
  apiBase: string,
  companyID: string,
  attachmentID: string,
  variant: MangoAttachmentVariantType = "original",
  options: { signal?: AbortSignal } = {},
): Promise<Blob> {
  const headers = new Headers();
  if (isAuthEnabled()) {
    if (isTerminalAuthFailureActive()) throw new Error("terminal_auth_failure_active");
    const token = await getApiAccessToken();
    if (!token) {
      markTerminalAuthFailure("missing_access_token");
      throw new Error("missing_access_token");
    }
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${apiBase}${mangoAttachmentContentPath(companyID, attachmentID, variant)}`, {
    method: "GET",
    headers,
    signal: options.signal,
  });
  if (response.status === 401 && isAuthEnabled()) {
    markTerminalAuthFailure("http_401");
    throw new Error("http_401");
  }
  if (!response.ok) throw new Error(`attachment_content_${response.status}`);
  return response.blob();
}

export async function loadMangoAttachmentObjectURL(
  apiBase: string,
  companyID: string,
  attachmentID: string,
  variant: MangoAttachmentVariantType = "display",
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const blob = await fetchMangoAttachmentBlob(apiBase, companyID, attachmentID, variant, options);
  return URL.createObjectURL(blob);
}

export async function downloadMangoAttachment(input: {
  apiBase: string;
  companyID: string;
  attachmentID: string;
  filename?: string;
  variant?: MangoAttachmentVariantType;
}): Promise<void> {
  if (typeof document === "undefined") return;
  const blob = await fetchMangoAttachmentBlob(
    input.apiBase,
    input.companyID,
    input.attachmentID,
    input.variant ?? "original",
  );
  const href = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = href;
    link.download = input.filename?.trim() || "attachment";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(href);
  }
}

export function fileFromDataURL(dataURL: string, filename: string): File | null {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataURL.trim());
  if (!match || typeof atob === "undefined" || typeof File === "undefined") return null;
  const mimeType = match[1] || "application/octet-stream";
  const binary = atob(match[2].replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], filename.trim() || "attachment", { type: mimeType });
}

export function defaultAttachmentRequestJSON(apiBase: string): AttachmentRequestJSON {
  return <T>(path: string, init?: RequestJSONInit) => requestJSON<T>(apiBase, path, init);
}
