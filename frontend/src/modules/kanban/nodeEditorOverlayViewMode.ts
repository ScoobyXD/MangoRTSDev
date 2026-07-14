export type OpenNodeEditorOverlay = {
  nodeID: string;
};

export function shouldResetNodeEditorOverlayViewMode(current: OpenNodeEditorOverlay | null, requestedNodeID: string): boolean {
  const cleanRequestedNodeID = requestedNodeID.trim();
  return !cleanRequestedNodeID || current?.nodeID !== cleanRequestedNodeID;
}
