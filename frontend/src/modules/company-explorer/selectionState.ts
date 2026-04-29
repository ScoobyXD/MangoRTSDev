export type ExplorerSelectionState = {
  selectedTreeID: string;
  selectedNodeID: string;
};

export type ExplorerSelectionRow = {
  id: string;
  kind: "folder" | "node";
  nodeID?: string;
  scopeLevel: number;
  label: string;
};

export type ExplorerSelectionPayload = {
  selectedTreeID: string;
  selectedNodeID: string;
  scopeLevel: number;
  selectedLabel: string;
};

// Deterministic selection mapping keeps ID-first linking explicit and testable.
export function deriveExplorerSelectionFromRow(state: ExplorerSelectionState, row: ExplorerSelectionRow): ExplorerSelectionPayload {
  const selectedNodeID = row.kind === "node" ? (row.nodeID ?? "") : (row.id === "folder-all" ? "" : state.selectedNodeID);
  return {
    selectedTreeID: row.id,
    selectedNodeID,
    scopeLevel: row.scopeLevel,
    selectedLabel: row.label,
  };
}
