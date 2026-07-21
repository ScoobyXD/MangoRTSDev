import type { EditorChatAttachment } from "./editorProjection.js";
import {
  linkMangoResourceAttachment,
  type AttachmentRequestJSON,
  type MangoAttachmentResourceType,
} from "../attachments/attachmentApi.js";

export type TextBlockImageChatDraft = {
  blockID: string;
  dataURL: string;
  attachmentID?: string;
  filename?: string;
  mimeType: string;
  size: number;
};

type TransferTextBlockImageToChatDraftOptions = {
  image: TextBlockImageChatDraft;
  requestJSON: AttachmentRequestJSON;
  companyID: string;
  resourceType: MangoAttachmentResourceType;
  resourceID: string;
  editorSurface: string;
  createPendingID: () => string;
  uploadLegacyImage: () => Promise<EditorChatAttachment>;
  onStage: (attachment: EditorChatAttachment) => void;
  onResolve: (pendingID: string, attachment: EditorChatAttachment) => void;
  onReject: (pendingID: string, cause: unknown) => void;
};

export type NodeAttachmentUploadScope = {
  companyID: string;
  nodeID: string;
  canEdit: boolean;
  generation: number;
};

export function nodeAttachmentUploadScopeMatches(
  started: NodeAttachmentUploadScope,
  current: NodeAttachmentUploadScope,
): boolean {
  return current.generation === started.generation
    && current.companyID === started.companyID
    && current.nodeID === started.nodeID
    && current.canEdit;
}

export function visibleNodeAttachmentUploads<T extends { attachmentID?: string; progress: { state: string } }>(
  uploads: readonly T[],
  completedAttachmentIDs: ReadonlySet<string>,
): T[] {
  return uploads.filter((item) => (
    item.progress.state !== "complete"
    || !item.attachmentID
    || !completedAttachmentIDs.has(item.attachmentID)
  ));
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
export function stageEditorChatAttachmentTransfer(
  current: readonly EditorChatAttachment[],
  attachment: EditorChatAttachment,
): EditorChatAttachment[] {
  return appendUniqueEditorAttachments(current, [attachment]);
}

export function resolveEditorChatAttachmentTransfer(
  current: readonly EditorChatAttachment[],
  pendingID: string,
  attachment: EditorChatAttachment,
): EditorChatAttachment[] {
  return appendUniqueEditorAttachments(
    current.filter((item) => item.id !== pendingID),
    [{ ...attachment, transferState: undefined }],
  );
}

export function failEditorChatAttachmentTransfer(
  current: readonly EditorChatAttachment[],
  pendingID: string,
): EditorChatAttachment[] {
  return current.map((attachment) => (
    attachment.id === pendingID ? { ...attachment, transferState: "failed" } : attachment
  ));
}

export function editorChatAttachmentsReadyForSubmit(attachments: readonly EditorChatAttachment[]): boolean {
  return attachments.every((attachment) => !attachment.transferState);
}

/**
 * Stages the selected image synchronously so the composer opens immediately.
 * Existing attachment-backed images only create the missing chat relationship;
 * they never download or upload the file bytes again.
 */
export async function transferTextBlockImageToChatDraft(
  options: TransferTextBlockImageToChatDraftOptions,
): Promise<EditorChatAttachment> {
  const attachmentID = options.image.attachmentID?.trim() ?? "";
  const pendingID = `pending-image-chat:${options.createPendingID()}`;
  const staged: EditorChatAttachment = {
    id: pendingID,
    attachmentID: attachmentID || undefined,
    name: options.image.filename?.trim() || "editor-image.png",
    type: options.image.mimeType.trim() || "image/png",
    size: Number.isFinite(options.image.size) && options.image.size > 0 ? Math.round(options.image.size) : 0,
    dataURL: options.image.dataURL,
    transferState: "processing",
  };
  options.onStage(staged);

  try {
    let resolved: EditorChatAttachment;
    if (attachmentID) {
      await linkMangoResourceAttachment(options.requestJSON, {
        companyID: options.companyID,
        resourceType: options.resourceType,
        resourceID: options.resourceID,
        attachmentID,
        relationshipKind: "chat_attachment",
        informationID: options.image.blockID,
        editorSurface: options.editorSurface,
      });
      resolved = {
        id: attachmentID,
        attachmentID,
        name: staged.name,
        type: staged.type,
        size: staged.size,
      };
    } else {
      resolved = await options.uploadLegacyImage();
    }
    options.onResolve(pendingID, resolved);
    return resolved;
  } catch (cause) {
    options.onReject(pendingID, cause);
    throw cause;
  }
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

export function formatNodeAttachmentListError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  if (!message || /^failed to fetch$/i.test(message) || /networkerror/i.test(message)) {
    return "Attachments are temporarily unavailable. Retry from the attachment menu.";
  }
  return message;
}

function editorAttachmentDurableID(attachment: EditorChatAttachment): string {
  return attachment.attachmentID?.trim() || attachment.id.trim();
}
