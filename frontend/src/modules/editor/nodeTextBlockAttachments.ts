import type { EditorChatAttachment } from "./editorProjection.js";

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

