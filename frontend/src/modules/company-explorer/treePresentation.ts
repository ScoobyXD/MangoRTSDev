import type { CompanyExplorerFolderKind } from "../folders/companyExplorerFolders.js";

export type ExplorerTreeEntityKind = "folder" | "node" | "logic_gate";

export type ExplorerCreationContextRow = {
  kind: ExplorerTreeEntityKind;
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
