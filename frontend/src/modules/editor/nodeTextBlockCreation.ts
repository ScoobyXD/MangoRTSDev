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

export function nextNodeTextBlockColor(existingColors: Iterable<string>): string {
  const normalized = Array.from(existingColors, (color) => color.trim().toUpperCase()).filter(Boolean);
  const used = new Set(normalized);
  return NODE_TEXT_BLOCK_COLORS.find((color) => !used.has(color))
    ?? NODE_TEXT_BLOCK_COLORS[normalized.length % NODE_TEXT_BLOCK_COLORS.length]
    ?? NODE_TEXT_BLOCK_COLORS[0];
}

export type NodeEmailChatReference = {
  blockID: string;
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
  color: string;
}): EditorTextBlockContent {
  return {
    title: input.title,
    document: input.document ?? "",
    attachments: [],
    color: input.color.trim().toUpperCase(),
  };
}

/** Opens chat automatically only when that text box already owns messages. */
export function defaultOpenTextBlockChatIDs(
  blockIDs: readonly string[],
  chatReferences: readonly NodeEmailChatReference[],
): string[] {
  const validBlockIDs = new Set(blockIDs.map((blockID) => blockID.trim()).filter(Boolean));
  const openBlockIDs = new Set<string>();
  for (const reference of chatReferences) {
    const chatBlockID = reference.blockID.trim();
    if (validBlockIDs.has(chatBlockID)) openBlockIDs.add(chatBlockID);
  }
  return blockIDs.map((blockID) => blockID.trim()).filter((blockID) => openBlockIDs.has(blockID));
}
