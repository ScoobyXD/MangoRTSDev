import type { CompanyExplorerFolderKind, CompanyExplorerSystemFolderKey } from "../folders/companyExplorerFolders.js";
import type {
  ExplorerCreationTargets,
  ExplorerDropPayload,
  ExplorerFindEntity,
  ExplorerRowDropPlacement,
  ExplorerSelectionDomain,
  resolveExplorerDeleteTarget,
  resolveExplorerRenameTarget,
} from "./treePresentation.js";

export type ExplorerTreeNode = {
  id: string;
  label: string;
  depth: number;
  kind: "folder" | "node" | "logic_gate" | "kanban";
  nodeID?: string;
  logicGateID?: string;
  kanbanBoardID?: string;
  folderID?: string;
  parentFolderID?: string;
  folderKind?: CompanyExplorerFolderKind;
  systemKey?: CompanyExplorerSystemFolderKey;
  folderLabel?: string;
  scopeLevel: number;
  position: number;
  createdTimestamp: string;
};

export type ExplorerDragPayload = ExplorerDropPayload;
export type ExplorerDeleteTarget = NonNullable<ReturnType<typeof resolveExplorerDeleteTarget>>;
export type ExplorerRenameTarget = NonNullable<ReturnType<typeof resolveExplorerRenameTarget>>;
export type ExplorerRenameDraft = { treeID: string; target: ExplorerRenameTarget; value: string };
export type ExplorerRowOrderUpdate = { row: ExplorerTreeNode; position: number };
export type ExplorerFindTarget = { kind: "node"; id: string } | { kind: "logic_gate"; id: string };
export type CompanyExplorerShareTarget = { folderID: string; label: string };
export type CompanyExplorerFindRequestDetail = {
  companyID?: string;
  sourceFrameID?: string;
  targetFrameIDs?: string[];
  entities?: Array<{ kind?: string; id?: string }>;
  changedAt?: number;
};

export type CompanyExplorerContextMenuState = {
  x: number;
  y: number;
  targets: ExplorerCreationTargets;
  deleteTarget: ExplorerDeleteTargetWithLabel | null;
  deleteTargets: ExplorerDeleteTargetWithLabel[];
  renameTarget: ExplorerRenameTarget | null;
  findTarget: ExplorerFindTarget | null;
  shareTarget: CompanyExplorerShareTarget | null;
  renameTreeID: string;
  renameLabel: string;
  contextKind: CompanyExplorerFolderKind | null;
  createPosition: number;
  canCreateBothFolderTypes: boolean;
  canCreateFolder: boolean;
  canCreateNode: boolean;
  canCreateLogicGate: boolean;
};

export type ExplorerVirtualizedTree = {
  rows: ExplorerTreeNode[];
  topSpacer: number;
  bottomSpacer: number;
};

export type ExplorerDeleteTargetWithLabel = ExplorerDeleteTarget & {
  label?: string;
  treeID?: string;
};

export type {
  ExplorerFindEntity,
  ExplorerRowDropPlacement,
  ExplorerSelectionDomain,
};
