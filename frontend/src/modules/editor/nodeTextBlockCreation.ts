import type { EditorTextBlockContent } from "./editorProjection.js";
const DEFAULT_NODE_TEXT_BLOCK_TITLE = "Hello I am a title";

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
