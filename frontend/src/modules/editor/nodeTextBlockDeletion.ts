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

export function resolveAttachedEmailHostBlockID(
  blockIDs: readonly string[],
  focusedBlockID: string,
): string {
  const survivingBlockIDs = blockIDs.map((blockID) => blockID.trim()).filter(Boolean);
  const focused = focusedBlockID.trim();
  if (focused && survivingBlockIDs.includes(focused)) return focused;
  return survivingBlockIDs[0] ?? "";
}
