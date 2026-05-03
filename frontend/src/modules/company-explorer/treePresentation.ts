import type { CompanyExplorerFolderKind } from "../folders/companyExplorerFolders.js";

export type ExplorerTreeEntityKind = "folder" | "node" | "logic_gate";

export type ExplorerCreationContextRow = {
  kind: ExplorerTreeEntityKind;
  nodeID?: string;
  logicGateID?: string;
  folderID?: string;
  folderKind?: CompanyExplorerFolderKind;
};

export type ExplorerCreationTargets = {
  folderKind: CompanyExplorerFolderKind;
  folderParentID: string;
  nodeParentFolderID: string;
  logicGateParentFolderID: string;
};

export const EXPLORER_DEFAULT_EXPANDED_ROW_IDS = ["folder-root", "folder-logic", "folder-nodes"] as const;
export const EXPLORER_ROOT_ROW_ORDER = ["folder-root", "folder-logic", "folder-nodes"] as const;
export const EXPLORER_ROOT_ROW_LABELS = {
  "folder-root": "Company",
  "folder-logic": "Logic Gates",
  "folder-nodes": "Nodes",
} as const;

export function formatExplorerFolderLabel(name: string): string {
  return name;
}

export function resolveExplorerCreationTargets(row?: ExplorerCreationContextRow | null): ExplorerCreationTargets {
  const nodeParentFolderID = row?.folderKind === "node" || row?.kind === "node" ? row.folderID ?? "" : "";
  const logicGateParentFolderID = row?.folderKind === "logic_gate" || row?.kind === "logic_gate" ? row.folderID ?? "" : "";
  const folderKind: CompanyExplorerFolderKind = row?.folderKind === "logic_gate" || row?.kind === "logic_gate" ? "logic_gate" : "node";

  return {
    folderKind,
    folderParentID: folderKind === "logic_gate" ? logicGateParentFolderID : nodeParentFolderID,
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
