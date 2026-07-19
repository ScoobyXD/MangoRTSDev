import type { EditorTextBlockContent } from "./editorProjection.js";
const DEFAULT_NODE_TEXT_BLOCK_TITLE = "Hello I am a title";

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
