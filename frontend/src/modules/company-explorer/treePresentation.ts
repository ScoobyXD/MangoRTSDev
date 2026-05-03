import type { CompanyExplorerFolderKind } from "../folders/companyExplorerFolders.js";

export type ExplorerTreeEntityKind = "folder" | "node" | "logic_gate";

export type ExplorerCreationContextRow = {
  kind: ExplorerTreeEntityKind;
  nodeID?: string;
  logicGateID?: string;
  folderID?: string;
  folderKind?: CompanyExplorerFolderKind;
};

export type ExplorerDropPayload = {
  kind: ExplorerTreeEntityKind;
  folderID?: string;
  folderKind?: CompanyExplorerFolderKind;
  itemID?: string;
  itemType?: CompanyExplorerFolderKind;
};

export type ExplorerDropTarget = {
  folderID: string;
  folderKind: CompanyExplorerFolderKind;
  treeID: string;
};

export type ExplorerCreationTargets = {
  preferredFolderKind: CompanyExplorerFolderKind;
  preferredFolderParentID: string;
  nodeFolderParentID: string;
  logicGateFolderParentID: string;
  nodeParentFolderID: string;
  logicGateParentFolderID: string;
};

export const EXPLORER_DEFAULT_EXPANDED_ROW_IDS = ["folder-root"] as const;
export const EXPLORER_ROOT_ROW_ORDER = ["folder-root"] as const;
export const EXPLORER_ROOT_ROW_LABELS = {
  "folder-root": "Company",
} as const;

export function formatExplorerFolderLabel(name: string): string {
  return name;
}

export function resolveExplorerDropTarget(row?: ExplorerCreationContextRow | null, payload?: ExplorerDropPayload | null): ExplorerDropTarget | null {
  if (!row || !payload || !row.folderID || !row.folderKind) return null;

  // Drag events fire on the row under the pointer. A file row already carries
  // its containing folderID, so users can drop anywhere inside that visible
  // folder section without us scanning the DOM or the full tree on every hover.
  if (payload.kind === "folder") {
    if (!payload.folderID || payload.folderID === row.folderID || payload.folderKind !== row.folderKind) return null;
    return { folderID: row.folderID, folderKind: row.folderKind, treeID: `workspace-folder-${row.folderID}` };
  }

  if (!payload.itemID || payload.itemType !== row.folderKind) return null;
  return { folderID: row.folderID, folderKind: row.folderKind, treeID: `workspace-folder-${row.folderID}` };
}

export function resolveExplorerCreationTargets(row?: ExplorerCreationContextRow | null): ExplorerCreationTargets {
  const nodeParentFolderID = row?.folderKind === "node" || row?.kind === "node" ? row.folderID ?? "" : "";
  const logicGateParentFolderID = row?.folderKind === "logic_gate" || row?.kind === "logic_gate" ? row.folderID ?? "" : "";
  const nodeFolderParentID = nodeParentFolderID;
  const logicGateFolderParentID = logicGateParentFolderID;
  const preferredFolderKind: CompanyExplorerFolderKind = row?.folderKind === "logic_gate" || row?.kind === "logic_gate" ? "logic_gate" : "node";

  return {
    preferredFolderKind,
    preferredFolderParentID: preferredFolderKind === "logic_gate" ? logicGateParentFolderID : nodeParentFolderID,
    nodeFolderParentID,
    logicGateFolderParentID,
    nodeParentFolderID,
    logicGateParentFolderID,
  };
}

export function resolveExplorerDeleteTarget(row?: ExplorerCreationContextRow | null):
  | { kind: "folder"; id: string; folderKind: CompanyExplorerFolderKind }
  | { kind: "node"; id: string }
  | { kind: "logic_gate"; id: string }
  | null {
  if (!row) return null;
  if (row.kind === "folder" && row.folderID && row.folderKind) return { kind: "folder", id: row.folderID, folderKind: row.folderKind };
  if (row.kind === "node" && row.nodeID) return { kind: "node", id: row.nodeID };
  if (row.kind === "logic_gate" && row.logicGateID) return { kind: "logic_gate", id: row.logicGateID };
  return null;
}

export function resolveExplorerRenameTarget(row?: ExplorerCreationContextRow | null):
  | { kind: "folder"; id: string }
  | { kind: "node"; id: string }
  | { kind: "logic_gate"; id: string }
  | null {
  if (!row) return null;
  if (row.kind === "folder" && row.folderID) return { kind: "folder", id: row.folderID };
  if (row.kind === "node" && row.nodeID) return { kind: "node", id: row.nodeID };
  if (row.kind === "logic_gate" && row.logicGateID) return { kind: "logic_gate", id: row.logicGateID };
  return null;
}

export function resolveExplorerClickSelection(input: {
  orderedIDs: string[];
  previousSelectedIDs: Set<string>;
  anchorID: string;
  clickedID: string;
  shiftKey: boolean;
  ctrlKey: boolean;
}): { selectedIDs: Set<string>; anchorID: string } {
  const { orderedIDs, previousSelectedIDs, anchorID, clickedID, shiftKey, ctrlKey } = input;
  if (!clickedID) return { selectedIDs: new Set(previousSelectedIDs), anchorID };

  if (shiftKey && anchorID) {
    const anchorIndex = orderedIDs.indexOf(anchorID);
    const clickedIndex = orderedIDs.indexOf(clickedID);
    if (anchorIndex >= 0 && clickedIndex >= 0) {
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      const range = orderedIDs.slice(start, end + 1);
      // Shift-click is additive in Company Explorer: users often build a
      // precise set with Ctrl, then add a visible range without losing it.
      const selectedIDs = new Set(previousSelectedIDs);
      for (const id of range) selectedIDs.add(id);
      return { selectedIDs, anchorID };
    }
  }

  if (ctrlKey) {
    const selectedIDs = new Set(previousSelectedIDs);
    if (selectedIDs.has(clickedID)) selectedIDs.delete(clickedID);
    else selectedIDs.add(clickedID);
    return { selectedIDs, anchorID: clickedID };
  }

  return { selectedIDs: new Set([clickedID]), anchorID: clickedID };
}
