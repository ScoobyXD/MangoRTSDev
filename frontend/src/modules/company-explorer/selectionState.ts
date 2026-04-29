export type ExplorerSelectionState = {
  selectedTreeID: string;
  selectedNodeID: string;
  // Increments on every intentional user selection click so linked modules
  // can receive an event even when the row identity did not change.
  broadcastRevision: number;
};

export type ExplorerSelectionRow = {
  id: string;
  kind: "folder" | "node";
  nodeID?: string;
};

export function applyExplorerRowSelection(state: ExplorerSelectionState, row: ExplorerSelectionRow): ExplorerSelectionState {
  const nextTreeID = row.id;
  const nextNodeID = row.kind === "node" ? (row.nodeID ?? "") : (row.id === "folder-all" ? "" : state.selectedNodeID);
  return {
    selectedTreeID: nextTreeID,
    selectedNodeID: nextNodeID,
    broadcastRevision: state.broadcastRevision + 1,
  };
}
