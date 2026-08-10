import type { EditorTextBlockContent } from "./editorProjection.js";
const DEFAULT_NODE_TEXT_BLOCK_TITLE = "Hello I am a title";

export const NODE_TEXT_BLOCK_COLORS = [
  "#0EA5E9",
  "#14B8A6",
  "#8B5CF6",
  "#F59E0B",
  "#22C55E",
  "#6366F1",
  "#06B6D4",
  "#84CC16",
  "#A855F7",
  "#10B981",
  "#EAB308",
  "#3B82F6",
] as const;

export const DEFAULT_NODE_TEXT_BLOCK_COLOR = NODE_TEXT_BLOCK_COLORS[0];

export function nextNodeTextBlockColor(existingColors: Iterable<string>): string {
  const normalized = Array.from(existingColors, (color) => color.trim().toUpperCase()).filter(Boolean);
  const used = new Set(normalized);
  return NODE_TEXT_BLOCK_COLORS.find((color) => !used.has(color))
    ?? NODE_TEXT_BLOCK_COLORS[normalized.length % NODE_TEXT_BLOCK_COLORS.length]
    ?? DEFAULT_NODE_TEXT_BLOCK_COLOR;
}

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

export function createOrdinaryNodeTextBlockContent(color: string): EditorTextBlockContent {
  return {
    title: DEFAULT_NODE_TEXT_BLOCK_TITLE,
    document: "",
    attachments: [],
    color: color.trim().toUpperCase(),
  };
}

export function createEmailLinkedNodeTextBlockContent(input: {
  title: string;
  document?: string;
  messageID: string;
  color: string;
}): EditorTextBlockContent {
  return {
    title: input.title,
    document: input.document ?? "",
    attachments: [],
    emailMessageID: input.messageID.trim(),
    color: input.color.trim().toUpperCase(),
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
