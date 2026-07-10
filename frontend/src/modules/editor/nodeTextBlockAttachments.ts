import type { MangoResourceAttachment } from "../attachments/attachmentApi.js";
import type { EditorChatAttachment } from "./editorProjection.js";

export type AttachmentUploadCandidateRejection<T> = {
  candidate: T;
  reason: "file_too_large" | "total_too_large";
};

export type AttachmentUploadCandidateSelection<T> = {
  accepted: T[];
  rejected: AttachmentUploadCandidateRejection<T>[];
  acceptedBytes: number;
};

export type SelectAttachmentUploadCandidatesInput<T extends { size: number }> = {
  candidates: readonly T[];
  existingBytes: number;
  pendingBytes: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

export function selectAttachmentUploadCandidates<T extends { size: number }>(
  input: SelectAttachmentUploadCandidatesInput<T>,
): AttachmentUploadCandidateSelection<T> {
  const accepted: T[] = [];
  const rejected: AttachmentUploadCandidateRejection<T>[] = [];
  let acceptedBytes = 0;
  const startingBytes = nonNegativeFiniteNumber(input.existingBytes) + nonNegativeFiniteNumber(input.pendingBytes);
  const maxFileBytes = nonNegativeFiniteNumber(input.maxFileBytes);
  const maxTotalBytes = nonNegativeFiniteNumber(input.maxTotalBytes);
  for (const candidate of input.candidates) {
    const size = nonNegativeFiniteNumber(candidate.size);
    if (size > maxFileBytes) {
      rejected.push({ candidate, reason: "file_too_large" });
      continue;
    }
    if (startingBytes + acceptedBytes + size > maxTotalBytes) {
      rejected.push({ candidate, reason: "total_too_large" });
      continue;
    }
    accepted.push(candidate);
    acceptedBytes += size;
  }
  return { accepted, rejected, acceptedBytes };
}

export function appendUniqueEditorAttachments(
  latest: readonly EditorChatAttachment[],
  incoming: readonly EditorChatAttachment[],
): EditorChatAttachment[] {
  const result = [...latest];
  const knownIDs = new Set(latest.map(editorAttachmentDurableID).filter(Boolean));
  for (const attachment of incoming) {
    const durableID = editorAttachmentDurableID(attachment);
    if (durableID && knownIDs.has(durableID)) continue;
    if (durableID) knownIDs.add(durableID);
    result.push(attachment);
  }
  return result;
}

export function totalTextBlockAttachmentBytes(
  projectionAttachments: readonly EditorChatAttachment[],
  resourceAttachments: readonly MangoResourceAttachment[],
): number {
  const bytesByAttachmentID = new Map<string, number>();
  let unkeyedBytes = 0;
  for (const resourceAttachment of resourceAttachments) {
    const attachment = resourceAttachment.attachment;
    if (!attachment) continue;
    const durableID = attachment.attachment_id.trim() || resourceAttachment.attachment_id.trim();
    const size = nonNegativeFiniteNumber(attachment.byte_size);
    if (durableID) {
      if (!bytesByAttachmentID.has(durableID)) bytesByAttachmentID.set(durableID, size);
    } else {
      unkeyedBytes += size;
    }
  }
  for (const attachment of projectionAttachments) {
    const durableID = editorAttachmentDurableID(attachment);
    const size = nonNegativeFiniteNumber(attachment.size);
    if (durableID) {
      if (!bytesByAttachmentID.has(durableID)) bytesByAttachmentID.set(durableID, size);
    } else {
      unkeyedBytes += size;
    }
  }
  return unkeyedBytes + Array.from(bytesByAttachmentID.values()).reduce((total, size) => total + size, 0);
}

export function textBlockAttachmentContextLabel(
  informationID: string | undefined,
  textBlockTitleByID: ReadonlyMap<string, string>,
): string {
  const cleanInformationID = informationID?.trim() ?? "";
  if (!cleanInformationID) return "Node";
  const title = textBlockTitleByID.get(cleanInformationID)?.trim() ?? "";
  return title || "Deleted text box";
}

function editorAttachmentDurableID(attachment: EditorChatAttachment): string {
  return attachment.attachmentID?.trim() || attachment.id.trim();
}

function nonNegativeFiniteNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
