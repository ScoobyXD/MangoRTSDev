import { getApiAccessToken, getAuthSessionCacheGeneration, isAuthEnabled, isTerminalAuthFailureActive, markTerminalAuthFailure } from "../../auth/cognitoAuth.js";
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
  storage_bucket?: string;
  storage_key?: string;
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

export type ImportRemoteMangoImageAttachmentInput = {
  companyID: string;
  resourceType: MangoAttachmentResourceType;
  resourceID: string;
  sourceURL: string;
  originalFilename?: string;
  informationID?: string;
  editorSurface?: string;
};

export type ListMangoResourceAttachmentsInput = {
  apiBase?: string;
  cacheScope?: string;
  companyID: string;
  resourceType: MangoAttachmentResourceType;
  resourceID: string;
};

export type UnlinkMangoResourceAttachmentInput = ListMangoResourceAttachmentsInput & {
  attachmentID: string;
};

export type DeleteMangoAttachmentInput = UnlinkMangoResourceAttachmentInput;

export type LinkMangoResourceAttachmentInput = UnlinkMangoResourceAttachmentInput & {
  relationshipKind: MangoAttachmentRelationshipKind;
  informationID?: string;
  messageID?: string;
  editorSurface?: string;
};

type ResourceAttachmentCacheEntry = {
  authGeneration: number;
  expiresAt: number;
  value?: MangoResourceAttachmentListResponse;
  inflight?: Promise<MangoResourceAttachmentListResponse>;
};

const RESOURCE_ATTACHMENT_CACHE_TTL_MS = 30_000;
const resourceAttachmentCache = new Map<string, ResourceAttachmentCacheEntry>();
const resourceAttachmentGeneration = new Map<string, number>();
const ATTACHMENT_BLOB_CACHE_TTL_MS = 2 * 60_000;
const ATTACHMENT_BLOB_CACHE_MAX_BYTES = 32 * 1024 * 1024;
type AttachmentBlobCacheEntry = {
  abortTimer?: ReturnType<typeof setTimeout>;
  authGeneration: number;
  byteSize: number;
  consumers: number;
  controller: AbortController;
  expiresAt: number;
  lastUsedAt: number;
  promise: Promise<Blob>;
  settled: boolean;
  variant: MangoAttachmentVariantType;
};
const attachmentBlobCache = new Map<string, AttachmentBlobCacheEntry>();

function pruneAttachmentBlobCache(authGeneration: number): void {
  const now = Date.now();
  for (const [key, entry] of attachmentBlobCache) {
    if (entry.authGeneration !== authGeneration || (entry.expiresAt > 0 && entry.expiresAt <= now)) {
      if (entry.abortTimer) clearTimeout(entry.abortTimer);
      if (!entry.settled) entry.controller.abort();
      attachmentBlobCache.delete(key);
    }
  }
  let retainedBytes = Array.from(attachmentBlobCache.values()).reduce((total, entry) => total + entry.byteSize, 0);
  if (retainedBytes <= ATTACHMENT_BLOB_CACHE_MAX_BYTES) return;
  const oldestFirst = Array.from(attachmentBlobCache.entries()).sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
  for (const [key, entry] of oldestFirst) {
    if (retainedBytes <= ATTACHMENT_BLOB_CACHE_MAX_BYTES) break;
    if (entry.expiresAt === 0) continue;
    attachmentBlobCache.delete(key);
    retainedBytes -= entry.byteSize;
  }
}

function cloneResourceAttachmentList(value: MangoResourceAttachmentListResponse): MangoResourceAttachmentListResponse {
  return {
    ...value,
    attachments: (value.attachments ?? []).map((item) => ({
      ...item,
      attachment: item.attachment ? { ...item.attachment } : undefined,
    })),
  };
}

function resourceAttachmentCacheKey(input: ListMangoResourceAttachmentsInput): string {
  const requestScope = input.apiBase?.trim() || input.cacheScope?.trim() || "default";
  return `${requestScope}\u0000${input.companyID.trim()}\u0000${input.resourceType}\u0000${input.resourceID.trim()}`;
}

function readResourceAttachmentGeneration(cacheKey: string): number {
  return resourceAttachmentGeneration.get(cacheKey) ?? 0;
}

function bumpResourceAttachmentGeneration(cacheKey: string): void {
  resourceAttachmentGeneration.set(cacheKey, readResourceAttachmentGeneration(cacheKey) + 1);
}

export function invalidateMangoResourceAttachmentsCache(
  request: AttachmentRequestJSON,
  input?: Partial<ListMangoResourceAttachmentsInput>,
): void {
  void request;
  const apiBase = input?.apiBase?.trim() ?? "";
  const cacheScope = input?.cacheScope?.trim() ?? "";
  const companyID = input?.companyID?.trim() ?? "";
  const resourceType = input?.resourceType;
  const resourceID = input?.resourceID?.trim() ?? "";
  const keys = new Set([...resourceAttachmentCache.keys(), ...resourceAttachmentGeneration.keys()]);
  for (const key of keys) {
    const [cachedScope, cachedCompanyID, cachedResourceType, cachedResourceID] = key.split("\u0000");
    if (apiBase && cachedScope !== apiBase) continue;
    if (cacheScope && cachedScope !== cacheScope) continue;
    if (companyID && cachedCompanyID !== companyID) continue;
    if (resourceType && cachedResourceType !== resourceType) continue;
    if (resourceID && cachedResourceID !== resourceID) continue;
    bumpResourceAttachmentGeneration(key);
    resourceAttachmentCache.delete(key);
  }
}

export type MangoResourceAttachmentFilter = {
  relationshipKind?: MangoAttachmentRelationshipKind;
  editorSurface?: string;
};

export async function listMangoResourceAttachments(
  request: AttachmentRequestJSON,
  input: ListMangoResourceAttachmentsInput,
): Promise<MangoResourceAttachmentListResponse> {
  const cacheKey = resourceAttachmentCacheKey(input);
  const authGeneration = getAuthSessionCacheGeneration();
  const invalidationGeneration = readResourceAttachmentGeneration(cacheKey);
  const cached = resourceAttachmentCache.get(cacheKey);
  if (cached?.authGeneration === authGeneration && cached.value && cached.expiresAt > Date.now()) return cloneResourceAttachmentList(cached.value);
  if (cached?.authGeneration === authGeneration && cached.inflight) {
    const value = await cached.inflight;
    if (getAuthSessionCacheGeneration() !== authGeneration || readResourceAttachmentGeneration(cacheKey) !== invalidationGeneration) {
      throw new DOMException("The attachment metadata read became stale.", "AbortError");
    }
    return cloneResourceAttachmentList(value);
  }
  if (cached) resourceAttachmentCache.delete(cacheKey);
  const query = new URLSearchParams({ company_id: input.companyID.trim() });
  const inflight = request<MangoResourceAttachmentListResponse>(
    `/v1/resources/${encodeURIComponent(input.resourceType)}/${encodeURIComponent(input.resourceID.trim())}/attachments?${query.toString()}`,
  ).then((value) => {
    if (getAuthSessionCacheGeneration() === authGeneration
      && readResourceAttachmentGeneration(cacheKey) === invalidationGeneration
      && resourceAttachmentCache.get(cacheKey)?.inflight === inflight) {
      resourceAttachmentCache.set(cacheKey, {
        authGeneration,
        expiresAt: Date.now() + RESOURCE_ATTACHMENT_CACHE_TTL_MS,
        value: cloneResourceAttachmentList(value),
      });
    }
    return value;
  }).catch((cause) => {
    if (resourceAttachmentCache.get(cacheKey)?.inflight === inflight) resourceAttachmentCache.delete(cacheKey);
    throw cause;
  });
  resourceAttachmentCache.set(cacheKey, { authGeneration, expiresAt: 0, inflight });
  const value = await inflight;
  if (getAuthSessionCacheGeneration() !== authGeneration || readResourceAttachmentGeneration(cacheKey) !== invalidationGeneration) {
    throw new DOMException("The attachment metadata read became stale.", "AbortError");
  }
  return cloneResourceAttachmentList(value);
}

export async function deleteMangoAttachmentPermanently(
  request: AttachmentRequestJSON,
  input: DeleteMangoAttachmentInput,
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
  invalidateMangoResourceAttachmentsCache(request, input);
}

export async function linkMangoResourceAttachment(
  request: AttachmentRequestJSON,
  input: LinkMangoResourceAttachmentInput,
): Promise<MangoResourceAttachment> {
  const companyID = input.companyID.trim();
  const resourceID = input.resourceID.trim();
  const attachmentID = input.attachmentID.trim();
  if (!companyID || !resourceID || !attachmentID) throw new Error("attachment_resource_context_required");
  const path = "/v1/resources/" + encodeURIComponent(input.resourceType) + "/" + encodeURIComponent(resourceID) + "/attachments";
  const response = await request<{ resource_attachment: MangoResourceAttachment }>(
    path,
    {
      method: "POST",
      json: {
        company_id: companyID,
        attachment_id: attachmentID,
        relationship_kind: input.relationshipKind,
        information_id: input.informationID?.trim() || undefined,
        message_id: input.messageID?.trim() || undefined,
        editor_surface: input.editorSurface?.trim() || undefined,
      },
    },
  );
  invalidateMangoResourceAttachmentsCache(request, input);
  return response.resource_attachment;
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
  const response = await uploadBrowserAttachment(request, input);
  invalidateMangoResourceAttachmentsCache(request, input);
  return response;
}

export async function importRemoteMangoImageAttachment(
  request: AttachmentRequestJSON,
  input: ImportRemoteMangoImageAttachmentInput,
): Promise<MangoAttachmentUploadResponse> {
  const companyID = input.companyID.trim();
  const resourceID = input.resourceID.trim();
  const sourceURL = input.sourceURL.trim();
  if (!companyID || !resourceID || !sourceURL) throw new Error("attachment_resource_context_required");
  const response = await request<MangoAttachmentUploadResponse>(
    "/v1/attachments/imports/remote-image",
    {
      method: "POST",
      json: {
        company_id: companyID,
        resource_type: input.resourceType,
        resource_id: resourceID,
        source_url: sourceURL,
        original_filename: input.originalFilename?.trim() || undefined,
        information_id: input.informationID?.trim() || undefined,
        editor_surface: input.editorSurface?.trim() || undefined,
      },
    },
  );
  invalidateMangoResourceAttachmentsCache(request, input);
  return response;
}

export function mangoAttachmentContentPath(companyID: string, attachmentID: string, variant: MangoAttachmentVariantType = "display"): string {
  const query = new URLSearchParams({ company_id: companyID.trim(), variant });
  return `/v1/attachments/${encodeURIComponent(attachmentID.trim())}/content?${query.toString()}`;
}

export function mangoEmailDraftResourceID(input: { draftID: string }): string {
  return input.draftID.trim();
}

export function mangoEmailSignatureResourceID(input: { signatureID?: string }): string {
  return input.signatureID?.trim() ?? "";
}

export function mangoEmailMessageResourceID(input: { messageID: string }): string {
  return input.messageID.trim();
}
export async function fetchMangoAttachmentBlob(
  apiBase: string,
  companyID: string,
  attachmentID: string,
  variant: MangoAttachmentVariantType = "original",
  options: { signal?: AbortSignal } = {},
): Promise<Blob> {
  const authGeneration = getAuthSessionCacheGeneration();
  pruneAttachmentBlobCache(authGeneration);
  const cacheKey = [apiBase.trim(), companyID.trim(), String(authGeneration), attachmentID.trim(), variant].join("\u0000");
  let entry = attachmentBlobCache.get(cacheKey);
  if (!entry) {
    const controller = new AbortController();
    const promise = fetchMangoAttachmentBlobUncached(apiBase, companyID, attachmentID, variant, controller.signal);
    entry = { authGeneration, byteSize: 0, consumers: 0, controller, expiresAt: 0, lastUsedAt: Date.now(), promise, settled: false, variant };
    attachmentBlobCache.set(cacheKey, entry);
    void promise.then((blob) => {
      entry!.settled = true;
      if (getAuthSessionCacheGeneration() !== authGeneration) {
        if (attachmentBlobCache.get(cacheKey)?.promise === promise) attachmentBlobCache.delete(cacheKey);
        return;
      }
      if (attachmentBlobCache.get(cacheKey)?.promise !== promise) return;
      if (variant === "original" || blob.size > ATTACHMENT_BLOB_CACHE_MAX_BYTES) {
        attachmentBlobCache.delete(cacheKey);
        return;
      }
      entry!.byteSize = blob.size;
      entry!.expiresAt = Date.now() + ATTACHMENT_BLOB_CACHE_TTL_MS;
      entry!.lastUsedAt = Date.now();
      pruneAttachmentBlobCache(authGeneration);
    }).catch(() => {
      entry!.settled = true;
      if (attachmentBlobCache.get(cacheKey)?.promise === promise) attachmentBlobCache.delete(cacheKey);
    });
  }
  if (entry.abortTimer) {
    clearTimeout(entry.abortTimer);
    entry.abortTimer = undefined;
  }
  entry.lastUsedAt = Date.now();
  entry.consumers += 1;
  return waitForAttachmentBlob(entry.promise, authGeneration, options.signal).finally(() => {
    entry!.consumers = Math.max(0, entry!.consumers - 1);
    if (entry!.consumers === 0 && !entry!.settled) {
      entry!.abortTimer = setTimeout(() => {
        entry!.abortTimer = undefined;
        if (entry!.consumers !== 0 || entry!.settled) return;
        entry!.controller.abort();
        if (attachmentBlobCache.get(cacheKey) === entry) attachmentBlobCache.delete(cacheKey);
      }, 0);
    }
  });
}

async function fetchMangoAttachmentBlobUncached(
  apiBase: string,
  companyID: string,
  attachmentID: string,
  variant: MangoAttachmentVariantType,
  signal: AbortSignal,
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
    signal,
  });
  if (response.status === 401 && isAuthEnabled()) {
    markTerminalAuthFailure("http_401");
    throw new Error("http_401");
  }
  if (!response.ok) throw new Error(`attachment_content_${response.status}`);
  return response.blob();
}

function waitForAttachmentBlob(inflight: Promise<Blob>, authGeneration: number, signal?: AbortSignal): Promise<Blob> {
  const checked = inflight.then((blob) => {
    if (getAuthSessionCacheGeneration() !== authGeneration) throw new DOMException("The auth session changed.", "AbortError");
    return blob;
  });
  if (!signal) return checked;
  if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  return new Promise<Blob>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    void checked.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
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
