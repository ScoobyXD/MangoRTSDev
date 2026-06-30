import { type NodeRecord } from "../node-map/shared.js";
import { type LogicGateRecord as LogicGateApiRecord } from "../logic-gate-map/shared.js";
import {
  type CompanyExplorerFolder,
  type CompanyExplorerFolderItem,
  type CompanyExplorerFolderKind,
  type CompanyExplorerItemType,
  type CompanyExplorerSystemFolderKey,
} from "../folders/companyExplorerFolders.js";
import { collectFolderSubtreeIDs } from "./companyExplorerDragDrop.js";
import {
  type ExplorerDeleteTarget,
  type ExplorerDeleteTargetWithLabel,
  type ExplorerTreeNode,
} from "./companyExplorerTypes.js";
import { isExplorerSystemFolderKey } from "./treePresentation.js";

export type WorkspaceStreamEnvelope = {
  company_id: string;
  type: string;
  data?: Record<string, unknown>;
};

export type CompanyExplorerFolderItemAssignment = {
  folder_id: string;
  item_type: CompanyExplorerItemType;
  item_id: string;
  position?: number;
};

export type CompanyExplorerFolderItemsBatchResponse = {
  folder_items?: CompanyExplorerFolderItem[];
};

export type CompanyExplorerWorkspaceEntityBatchResponse = {
  nodes?: NodeRecord[];
  logic_gates?: LogicGateApiRecord[];
  folder_items?: CompanyExplorerFolderItem[];
};

export type CompanyExplorerDeleteBatchResponse = {
  status?: string;
  targets?: Array<{ kind: string; id: string }>;
};

export type CompanyExplorerFolderShare = {
  company_id: string;
  folder_id: string;
  email: string;
  user_id?: string;
  status: string;
  invited_by_user_id: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type CompanyExplorerFolderSharesResponse = {
  shares?: CompanyExplorerFolderShare[];
};

export type CompanyExplorerFolderShareInviteResponse = {
  share?: CompanyExplorerFolderShare;
  invitation?: { token?: string; email?: string };
  cognito_invite_status?: string;
};

export type CompanyExplorerFolderShareDialog = {
  folderID: string;
  label: string;
  email: string;
  shares: CompanyExplorerFolderShare[];
  loading: boolean;
  busy: boolean;
  error: string;
  message: string;
  invitationToken: string;
};

export type CompanyExplorerDeleteConfirmationSummary = {
  title: string;
  detail: string;
  targetList: string;
  totalThings: number;
  requiresFolderAcknowledgement: boolean;
};

export type CompanyExplorerSearchResultSummary = {
  treeID: string;
  label: string;
  kind: ExplorerTreeNode["kind"];
  depth: number;
  folderLabel?: string;
  systemKey?: CompanyExplorerSystemFolderKey;
  mangoDefaultFolder?: boolean;
  hasChildren?: boolean;
};

export type CompanyExplorerSearchSelectionRequest = {
  treeID: string;
  requestID: number;
};

export type CompanyExplorerTriageMessageDropTarget =
  | { kind: "project"; projectID: string; parentEntityID?: string; label: string }
  | { kind: "logic_gate"; logicGateID: string; parentEntityID?: string; label: string };

export type CompanyExplorerTriageMessageDropHandler = (
  target: CompanyExplorerTriageMessageDropTarget,
  messageIDs: string[],
  point: { x: number; y: number },
  source?: { sharedInboxID?: string; companyID?: string },
) => void;

export type CompanyExplorerContentProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  useParentScroll?: boolean;
  theme?: "mango" | "teal" | "light" | "dark";
  selectionTargetFrameIDs?: string[];
  scopedRootFolderKind?: CompanyExplorerFolderKind;
  scopedRootFolderName?: string;
  externalSearchQuery?: string;
  externalSearchSelectionRequest?: CompanyExplorerSearchSelectionRequest | null;
  onSearchResultsChange?: (results: CompanyExplorerSearchResultSummary[]) => void;
  onSearchResultSelect?: () => void;
  onTriageMessagesDrop?: CompanyExplorerTriageMessageDropHandler;
};

export type CompanyExplorerContextMenuActionID =
  | "open_in_new_tab"
  | "pin"
  | "folder_permissions"
  | "create_folder"
  | "create_logic_gate"
  | "create_project"
  | "rename"
  | "delete";

export type CompanyExplorerContextMenuAction = {
  id: CompanyExplorerContextMenuActionID;
  label: string;
  enabled: boolean;
};

export function buildCompanyExplorerContextMenuSections(input: {
  openInNewTabEnabled?: boolean;
  pinEnabled?: boolean;
  permissionsEnabled: boolean;
  createFolderEnabled: boolean;
  createLogicGateEnabled: boolean;
  createProjectEnabled: boolean;
  renameEnabled: boolean;
  deleteEnabled: boolean;
}): CompanyExplorerContextMenuAction[][] {
  const resourceActions: CompanyExplorerContextMenuAction[] = [
    ...(input.openInNewTabEnabled ? [{ id: "open_in_new_tab", label: "Open in new browser tab", enabled: true } as CompanyExplorerContextMenuAction] : []),
    ...(input.pinEnabled ? [{ id: "pin", label: "Pin", enabled: true } as CompanyExplorerContextMenuAction] : []),
  ];
  return [
    [
      ...resourceActions,
      { id: "folder_permissions", label: "Folder Permissions", enabled: input.permissionsEnabled },
    ],
    [
      { id: "create_folder", label: "Create New Folder", enabled: input.createFolderEnabled },
      { id: "create_logic_gate", label: "Create Logic Gate", enabled: input.createLogicGateEnabled },
      { id: "create_project", label: "Create Project", enabled: input.createProjectEnabled },
    ],
    [
      { id: "rename", label: "Rename", enabled: input.renameEnabled },
      { id: "delete", label: "Delete", enabled: input.deleteEnabled },
    ],
  ];
}

export function createInitialCompanyExplorerExpandedRows(): Set<string> {
  return new Set();
}

const SYSTEM_FOLDER_CHILD_BY_ROW_PREFIX: Array<[string, CompanyExplorerSystemFolderKey]> = [
  ["system-active-node-", "active_nodes"],
  ["system-active-project-", "active_projects"],
  ["system-history-node-", "history"],
];

export function getSystemFolderKeyForTreeRowID(rowID: string): CompanyExplorerSystemFolderKey | "" {
  return SYSTEM_FOLDER_CHILD_BY_ROW_PREFIX.find(([prefix]) => rowID.startsWith(prefix))?.[1] ?? "";
}

function getDeleteVocabulary(kind: ExplorerDeleteTarget["kind"], plural = false): string {
  if (kind === "folder") return plural ? "folders" : "folder";
  if (kind === "node") return plural ? "nodes" : "node";
  if (kind === "logic_gate") return plural ? "Logic Gates" : "Logic Gate";
  if (kind === "project") return plural ? "projects" : "project";
  return plural ? "Kanban Boards" : "Kanban Board";
}

function joinHumanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function getDeleteTargetLabel(target: ExplorerDeleteTargetWithLabel): string {
  const label = target.label?.trim() || target.id;
  return `${getDeleteVocabulary(target.kind)} "${label}"`;
}

export function buildDeleteConfirmationSummary(input: {
  targets: ExplorerDeleteTargetWithLabel[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
}): CompanyExplorerDeleteConfirmationSummary {
  const counts = new Map<ExplorerDeleteTarget["kind"], number>();
  let totalThings = 0;
  for (const target of input.targets) {
    counts.set(target.kind, (counts.get(target.kind) ?? 0) + 1);
    if (target.kind === "folder") {
      const subtreeIDs = collectFolderSubtreeIDs(input.folders, target.id);
      const folderCount = subtreeIDs.size || 1;
      const itemCount = input.folderItems.filter((item) => subtreeIDs.has(item.folder_id)).length;
      totalThings += folderCount + itemCount;
    } else {
      totalThings += 1;
    }
  }
  totalThings = Math.max(totalThings, input.targets.length);
  const requiresFolderAcknowledgement = input.targets.some((target) => target.kind === "folder");
  const targetList = input.targets.slice(0, 6).map(getDeleteTargetLabel);
  if (input.targets.length > targetList.length) targetList.push(`${input.targets.length - targetList.length} more`);

  if (input.targets.length === 1) {
    const target = input.targets[0];
    const vocabulary = getDeleteVocabulary(target.kind);
    return {
      title: `Are you sure you want to delete this ${vocabulary}: ${target.label?.trim() || target.id}?`,
      detail: `This moves ${totalThings} thing${totalThings === 1 ? "" : "s"} to the Recycle Bin.`,
      targetList: getDeleteTargetLabel(target),
      totalThings,
      requiresFolderAcknowledgement,
    };
  }

  const kindDetails = Array.from(counts.entries())
    .map(([kind, count]) => `${count} ${getDeleteVocabulary(kind, count !== 1)}`);
  return {
    title: `Are you sure you want to delete these ${totalThings} things?`,
    detail: `This moves ${joinHumanList(kindDetails)} to the Recycle Bin.`,
    targetList: joinHumanList(targetList),
    totalThings,
    requiresFolderAcknowledgement,
  };
}

export function findProtectedSystemFolderInDeleteTargets(
  targets: ExplorerDeleteTargetWithLabel[],
  folders: CompanyExplorerFolder[],
): CompanyExplorerFolder | null {
  for (const target of targets) {
    if (target.kind !== "folder") continue;
    const subtreeIDs = collectFolderSubtreeIDs(folders, target.id);
    const protectedFolder = folders.find((folder) => subtreeIDs.has(folder.folder_id) && isExplorerSystemFolderKey(folder.system_key));
    if (protectedFolder) return protectedFolder;
  }
  return null;
}

function normalizeExplorerRootFolderLabel(value: string): string {
  return value.trim().toLowerCase();
}

export function filterExplorerRowsForCustomTopLevel(input: {
  rows: ExplorerTreeNode[];
  hiddenRootFolderNames?: Iterable<string>;
}): ExplorerTreeNode[] {
  const hiddenRootFolderNames = new Set(
    Array.from(input.hiddenRootFolderNames ?? [], normalizeExplorerRootFolderLabel).filter(Boolean),
  );
  const customRows: ExplorerTreeNode[] = [];
  let skippedRootDepth: number | null = null;
  for (const row of input.rows) {
    if (row.kind === "node") continue;
    if (skippedRootDepth !== null) {
      if (row.depth > skippedRootDepth) continue;
      skippedRootDepth = null;
    }
    const isRootFolder = row.kind === "folder" && row.depth === 0;
    const isDefaultRootFolder = isRootFolder && (
      Boolean(row.systemKey)
      || row.syntheticKind === "default_scope_folder"
      || row.syntheticKind === "GVIC_folder"
      || hiddenRootFolderNames.has(normalizeExplorerRootFolderLabel(row.label))
    );
    if (isDefaultRootFolder) {
      skippedRootDepth = row.depth;
      continue;
    }
    customRows.push(row);
  }
  return customRows;
}
