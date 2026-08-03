import type { EditorTextBlockContent } from "./editorProjection.js";
const DEFAULT_NODE_TEXT_BLOCK_TITLE = "Hello I am a title";

export type NodeEmailChatHostBlock = {
  id: string;
  emailMessageID?: string;
  createdTimestamp?: string;
};

export type NodeEmailChatReference = {
  blockID: string;
};

export type NodeEmailOriginReference = {
  messageID: string;
  blockID?: string;
};

export function createOrdinaryNodeTextBlockContent(): EditorTextBlockContent {
  return {
    title: DEFAULT_NODE_TEXT_BLOCK_TITLE,
    document: "",
    attachments: [],
  };
}

export function createEmailLinkedNodeTextBlockContent(input: {
  title: string;
  document?: string;
  messageID: string;
  accent: string;
}): EditorTextBlockContent {
  return {
    title: input.title,
    document: input.document ?? "",
    attachments: [],
    emailMessageID: input.messageID.trim(),
    emailAccent: input.accent.trim(),
  };
}

/**
 * Old email-created nodes stored chat against the attached-email projection ID.
 * Resolve that legacy conversation to a stable text box instead of whichever
 * box happens to be first after a new box is prepended.
 */
export function resolveLegacyEmailChatHostBlockID(
  blocks: readonly NodeEmailChatHostBlock[],
  origin: NodeEmailOriginReference | null | undefined,
): string {
  const messageID = origin?.messageID.trim() ?? "";
  if (!messageID || blocks.length === 0) return "";

  const linkedBlock = blocks.find((block) => block.emailMessageID?.trim() === messageID);
  if (linkedBlock) return linkedBlock.id.trim();

  const declaredBlockID = origin?.blockID?.trim() ?? "";
  if (declaredBlockID && blocks.some((block) => block.id.trim() === declaredBlockID)) return declaredBlockID;

  return blocks.reduce<NodeEmailChatHostBlock | null>((oldest, block) => {
    if (!oldest) return block;
    const blockCreated = block.createdTimestamp?.trim() ?? "";
    const oldestCreated = oldest.createdTimestamp?.trim() ?? "";
    if (!blockCreated) return oldest;
    if (!oldestCreated || blockCreated < oldestCreated) return block;
    if (blockCreated === oldestCreated && block.id < oldest.id) return block;
    return oldest;
  }, null)?.id.trim() ?? "";
}

/** Opens chat automatically only when that text box already owns messages. */
export function defaultOpenTextBlockChatIDs(
  blockIDs: readonly string[],
  chatReferences: readonly NodeEmailChatReference[],
  legacyEmailChatBlockID = "",
  legacyEmailChatHostBlockID = "",
): string[] {
  const validBlockIDs = new Set(blockIDs.map((blockID) => blockID.trim()).filter(Boolean));
  const openBlockIDs = new Set<string>();
  const legacyID = legacyEmailChatBlockID.trim();
  const legacyHostID = legacyEmailChatHostBlockID.trim();
  for (const reference of chatReferences) {
    const chatBlockID = reference.blockID.trim();
    if (validBlockIDs.has(chatBlockID)) openBlockIDs.add(chatBlockID);
    else if (chatBlockID === legacyID && validBlockIDs.has(legacyHostID)) openBlockIDs.add(legacyHostID);
  }
  return blockIDs.map((blockID) => blockID.trim()).filter((blockID) => openBlockIDs.has(blockID));
}
