import type { CompanyExplorerFolderKind, CompanyExplorerFolderScopeType, CompanyExplorerSystemFolderKey } from "../folders/companyExplorerFolders.js";
import type { CompanyExplorerV2EntityType } from "./companyExplorerLazyApi.js";
import type { LogicGateGVICRole } from "../logic-gate-map/shared.js";
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
  kind: "folder" | "node" | "logic_gate" | "project" | "kanban";
  entityID?: string;
  entityType?: CompanyExplorerV2EntityType;
  edgeID?: string;
  resourceID?: string;
  parentEntityID?: string;
  nodeID?: string;
  logicGateID?: string;
  projectID?: string;
  kanbanBoardID?: string;
  folderID?: string;
  parentFolderID?: string;
  folderKind?: CompanyExplorerFolderKind;
  folderScopeType?: CompanyExplorerFolderScopeType;
  folderScopeID?: string;
  systemKey?: CompanyExplorerSystemFolderKey;
  protectedDefaultFolder?: boolean;
  hasPermissionRules?: boolean;
  folderLabel?: string;
  scopeLevel: number;
  position: number;
  createdTimestamp: string;
  hasChildren?: boolean;
  parentLogicGateID?: string;
  GVICRole?: LogicGateGVICRole | "other";
  syntheticKind?: "GVIC_folder" | "logic_gate_children" | "default_scope_folder" | "search_path";
};

export type ExplorerDragPayload = ExplorerDropPayload;
export type ExplorerDeleteTarget = NonNullable<ReturnType<typeof resolveExplorerDeleteTarget>>;
export type ExplorerRenameTarget = NonNullable<ReturnType<typeof resolveExplorerRenameTarget>>;
export type ExplorerRenameDraft = { treeID: string; target: ExplorerRenameTarget; value: string };
export type ExplorerRowOrderUpdate = { row: ExplorerTreeNode; position: number };
export type CompanyExplorerShareTarget = { folderID: string; label: string };
export type CompanyExplorerFolderPermissionsTarget = { folderID: string; label: string; permissionsPath?: string };
export type CompanyExplorerOpenInNewTabTarget = { kind: "node" | "logic_gate" | "project"; id: string };
export type CompanyExplorerPinTarget = CompanyExplorerOpenInNewTabTarget & { name: string };
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
  permissionsTarget: CompanyExplorerFolderPermissionsTarget | null;
  openInNewTabTarget: CompanyExplorerOpenInNewTabTarget | null;
  pinTarget: CompanyExplorerPinTarget | null;
  renameTreeID: string;
  renameLabel: string;
  contextKind: CompanyExplorerFolderKind | null;
  createPosition: number;
  createNodeLogicGateID: string;
  createNodeLogicGateTreeID: string;
  createLogicGateGVICRole: LogicGateGVICRole | "";
  createFolderScopeType?: CompanyExplorerFolderScopeType;
  createFolderScopeID?: string;
  canCreateFolder: boolean;
  canCreateNode: boolean;
  canCreateLogicGate: boolean;
  canCreateProject: boolean;
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
