export type TextBlockChatProjectionReference = {
  id: string;
  blockID: string;
};

export type InitialTextBlockCreationState = {
  canEdit: boolean;
  projectionsLoaded: boolean;
  nodeID: string;
  editorSequence: number;
  loadedTextBlockCount: number;
  renderedTextBlockCount: number;
  suppressAutomaticCreation?: boolean;
};

export function shouldCreateInitialTextBlock(state: InitialTextBlockCreationState): boolean {
  return state.canEdit
    && state.projectionsLoaded
    && Boolean(state.nodeID.trim())
    && state.editorSequence === 0
    && state.loadedTextBlockCount === 0
    && state.renderedTextBlockCount === 0
    && state.suppressAutomaticCreation !== true;
}

export function projectionIDsForTextBlockDeletion(
  blockID: string,
  chatMessages: readonly TextBlockChatProjectionReference[],
): string[] {
  const cleanBlockID = blockID.trim();
  if (!cleanBlockID) return [];
  const projectionIDs = new Set<string>([cleanBlockID]);
  for (const message of chatMessages) {
    if (message.blockID.trim() !== cleanBlockID) continue;
    const messageID = message.id.trim();
    if (messageID) projectionIDs.add(messageID);
  }
  return Array.from(projectionIDs);
}

export function resolveAttachedEmailHostBlockID(
  blockIDs: readonly string[],
  focusedBlockID: string,
): string {
  const survivingBlockIDs = blockIDs.map((blockID) => blockID.trim()).filter(Boolean);
  const focused = focusedBlockID.trim();
  if (focused && survivingBlockIDs.includes(focused)) return focused;
  return survivingBlockIDs[0] ?? "";
}
