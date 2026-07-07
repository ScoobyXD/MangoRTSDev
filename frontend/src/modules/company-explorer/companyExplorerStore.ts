import type { NodeRecord } from "../node-map/shared.js";
import {
  type LogicGateRecord as LogicGateApiRecord,
  type NodeRecord as LogicGateRecord,
  toLogicGateCanvasRecord,
} from "../logic-gate-map/shared.js";
import type {
  CompanyExplorerFolder,
  CompanyExplorerFolderItem,
} from "../folders/companyExplorerFolders.js";
import type { KanbanBoard, KanbanBoardsUpdatedDetail } from "../kanban/shared.js";
import type { ProjectRecord } from "../project-management/projectManagementApi.js";
import { collectFolderSubtreeIDs } from "./companyExplorerDragDrop.js";
import type { CompanyExplorerV2Row } from "./companyExplorerLazyApi.js";

export type CompanyExplorerSnapshotPayload = {
  nodes?: NodeRecord[];
  logic_gates?: LogicGateApiRecord[];
  projects?: ProjectRecord[];
  folders?: CompanyExplorerFolder[];
  folder_items?: CompanyExplorerFolderItem[];
  rows?: CompanyExplorerV2Row[];
};

export type CompanyExplorerWorkspaceStreamEnvelope = {
  company_id?: string;
  type?: string;
  data?: Record<string, unknown>;
};

export type CompanyExplorerStoreState = {
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  projects: ProjectRecord[];
  kanbanBoards: KanbanBoard[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  rows: CompanyExplorerV2Row[];
  folderSnapshotLoaded: boolean;
};

export type CompanyExplorerStoreAction =
  | { type: "resetSnapshot" }
  | { type: "applySnapshot"; snapshot: CompanyExplorerSnapshotPayload }
  | { type: "mergeSnapshot"; snapshot: CompanyExplorerSnapshotPayload }
  | { type: "setKanbanBoards"; boards: KanbanBoard[] }
  | { type: "applyKanbanBoardsUpdated"; companyID: string; detail?: KanbanBoardsUpdatedDetail }
  | { type: "applyWorkspaceEnvelope"; companyID: string; envelope: CompanyExplorerWorkspaceStreamEnvelope }
  | { type: "upsertFolder"; folder: CompanyExplorerFolder }
  | { type: "replaceFolder"; folder: CompanyExplorerFolder }
  | { type: "upsertFolderItems"; folderItems: CompanyExplorerFolderItem[] }
  | { type: "upsertLogicGate"; logicGate: LogicGateRecord }
  | { type: "replaceLogicGate"; logicGate: LogicGateRecord }
  | { type: "upsertProject"; project: ProjectRecord }
  | { type: "replaceProject"; project: ProjectRecord }
  | { type: "upsertV2Rows"; rows: CompanyExplorerV2Row[] }
  | { type: "removeV2Edges"; edgeIDs: ReadonlySet<string> }
  | { type: "replaceV2Children"; parentEntityID: string; rows: CompanyExplorerV2Row[] }
  | {
      type: "removeDeletedEntities";
      deletedFolderIDs: ReadonlySet<string>;
      deletedNodeIDs: ReadonlySet<string>;
      deletedLogicGateIDs: ReadonlySet<string>;
      deletedProjectIDs: ReadonlySet<string>;
      deletedKanbanBoardIDs: ReadonlySet<string>;
    }
  | { type: "restore"; state: CompanyExplorerStoreState };

type CompanyExplorerGapLike = {
  companyID: string;
  scopes: Array<{ kind: string }>;
};

export type CompanyExplorerAffectedScopeRefreshPlan = {
  hasAffectedScopes: boolean;
  hasCompanyExplorerScopes: boolean;
  refreshRoot: boolean;
  parentEntityIDs: string[];
};

export function createCompanyExplorerStoreState(): CompanyExplorerStoreState {
  return {
    nodes: [],
    logicGates: [],
    projects: [],
    kanbanBoards: [],
    folders: [],
    folderItems: [],
    rows: [],
    folderSnapshotLoaded: false,
  };
}

export function reduceCompanyExplorerStore(
  state: CompanyExplorerStoreState,
  action: CompanyExplorerStoreAction,
): CompanyExplorerStoreState {
  switch (action.type) {
    case "resetSnapshot":
      return {
        ...state,
        nodes: [],
        logicGates: [],
        projects: [],
        folders: [],
        folderItems: [],
        rows: [],
        folderSnapshotLoaded: false,
      };
    case "applySnapshot":
      return {
        ...state,
        nodes: action.snapshot.nodes ?? [],
        logicGates: (action.snapshot.logic_gates ?? []).map(toLogicGateCanvasRecord),
        projects: action.snapshot.projects ?? [],
        folders: action.snapshot.folders ?? [],
        folderItems: filterCompanyExplorerFolderItemsForExplorer(action.snapshot.folder_items ?? []),
        rows: filterCompanyExplorerV2RowsForExplorer(action.snapshot.rows ?? []),
        folderSnapshotLoaded: true,
      };
    case "mergeSnapshot":
      return {
        ...state,
        nodes: mergeByID(state.nodes, action.snapshot.nodes ?? [], (node) => node.node_id),
        logicGates: mergeByID(state.logicGates, (action.snapshot.logic_gates ?? []).map(toLogicGateCanvasRecord), (logicGate) => logicGate.logic_gate_id),
        projects: mergeByID(state.projects, action.snapshot.projects ?? [], (project) => project.project_id),
        folders: mergeByID(state.folders, action.snapshot.folders ?? [], (folder) => folder.folder_id),
        folderItems: upsertFolderItems(state.folderItems, action.snapshot.folder_items ?? []),
        rows: upsertCompanyExplorerV2Rows(state.rows, action.snapshot.rows ?? []),
        folderSnapshotLoaded: true,
      };
    case "setKanbanBoards":
      return { ...state, kanbanBoards: sortKanbanBoards(action.boards) };
    case "applyKanbanBoardsUpdated":
      return applyKanbanBoardsUpdated(state, action.companyID, action.detail);
    case "applyWorkspaceEnvelope":
      return applyWorkspaceEnvelope(state, action.companyID, action.envelope);
    case "upsertFolder":
      return { ...state, folders: upsertByID(state.folders, action.folder, (folder) => folder.folder_id) };
    case "replaceFolder":
      return { ...state, folders: replaceByID(state.folders, action.folder, (folder) => folder.folder_id) };
    case "upsertFolderItems":
      return { ...state, folderItems: upsertFolderItems(state.folderItems, action.folderItems) };
    case "upsertLogicGate":
      return { ...state, logicGates: upsertByID(state.logicGates, action.logicGate, (logicGate) => logicGate.logic_gate_id) };
    case "replaceLogicGate":
      return { ...state, logicGates: replaceByID(state.logicGates, action.logicGate, (logicGate) => logicGate.logic_gate_id) };
    case "upsertProject":
      return { ...state, projects: upsertByID(state.projects, action.project, (project) => project.project_id) };
    case "replaceProject":
      return { ...state, projects: replaceByID(state.projects, action.project, (project) => project.project_id) };
    case "upsertV2Rows":
      return { ...state, rows: upsertCompanyExplorerV2Rows(state.rows, action.rows) };
    case "removeV2Edges":
      return { ...state, rows: state.rows.filter((row) => !action.edgeIDs.has(row.edge_id ?? "")) };
    case "replaceV2Children":
      return {
        ...state,
        rows: upsertCompanyExplorerV2Rows(
          state.rows.filter((row) => (row.parent_entity_id ?? "") !== action.parentEntityID),
          action.rows,
        ),
      };
    case "removeDeletedEntities":
      return removeDeletedEntities(state, action);
    case "restore":
      return action.state;
  }
}

export function companyExplorerAffectedScopesFromEnvelope(envelope: CompanyExplorerWorkspaceStreamEnvelope): string[] {
  return cleanStringList(envelope.data?.affected_scopes);
}

export function companyExplorerRefreshPlanFromAffectedScopes({
  companyID,
  affectedScopes,
  rows,
}: {
  companyID: string;
  affectedScopes: string[];
  rows: CompanyExplorerV2Row[];
}): CompanyExplorerAffectedScopeRefreshPlan {
  const cleanCompanyID = companyID.trim();
  const parentEntityIDs: string[] = [];
  const seenParentEntityIDs = new Set<string>();
  let hasCompanyExplorerScopes = false;
  let refreshRoot = false;

  const addParentEntityID = (value: string | undefined) => {
    const clean = value?.trim() ?? "";
    if (!clean) {
      refreshRoot = true;
      return;
    }
    if (seenParentEntityIDs.has(clean)) return;
    seenParentEntityIDs.add(clean);
    parentEntityIDs.push(clean);
  };

  const addRowsForResource = (targetType: string, targetID: string) => {
    const cleanTargetID = targetID.trim();
    if (!cleanTargetID) return;
    for (const row of rows) {
      if (row.entity_type !== targetType || (row.resource_id ?? "").trim() !== cleanTargetID) continue;
      addParentEntityID(row.entity_id);
      addParentEntityID(row.parent_entity_id);
    }
  };

  for (const affectedScope of cleanStringList(affectedScopes)) {
    const [surface, targetType, ...idParts] = affectedScope.split(":").map((part) => part.trim()).filter(Boolean);
    const targetID = idParts.join(":").trim();
    if (surface !== "company_explorer" || !targetType || !targetID) continue;
    hasCompanyExplorerScopes = true;
    if (targetType === "root") {
      if (!cleanCompanyID || targetID === cleanCompanyID) refreshRoot = true;
      continue;
    }
    if (targetType === "folder") {
      addParentEntityID(targetID);
      for (const row of rows) {
        const rowResourceID = (row.resource_id ?? "").trim();
        if (row.entity_id !== targetID && !(row.entity_type === "folder" && rowResourceID === targetID)) continue;
        addParentEntityID(row.parent_entity_id);
        addParentEntityID(row.entity_id);
      }
      continue;
    }
    if (targetType === "project" || targetType === "logic_gate") {
      addRowsForResource(targetType, targetID);
    }
  }

  return {
    hasAffectedScopes: cleanStringList(affectedScopes).length > 0,
    hasCompanyExplorerScopes,
    refreshRoot,
    parentEntityIDs,
  };
}

export function shouldRefreshCompanyExplorerSnapshotForGap(gap: CompanyExplorerGapLike, companyID: string): boolean {
  if (gap.companyID !== companyID) return false;
  return gap.scopes.some((scope) => (
    scope.kind === "company_explorer" ||
    scope.kind === "kanban_board_list" ||
    scope.kind === "workspace"
  ));
}

export function shouldRefreshKanbanBoardsAfterUpdate(detail: KanbanBoardsUpdatedDetail | undefined, companyID: string): boolean {
  if (detail?.companyID && detail.companyID !== companyID) return false;
  return !detail?.deletedBoardID && !detail?.board;
}

export function shouldInvalidateKanbanBoardListForExplorerEnvelope(
  companyID: string,
  envelope: CompanyExplorerWorkspaceStreamEnvelope,
): boolean {
  if (envelope.company_id !== companyID) return false;
  return envelope.type === "kanban_board_saved"
    || envelope.type === "kanban_board_updated"
    || envelope.type === "kanban_board_deleted";
}

export function companyExplorerBranchHasMaterializedRows(
  rows: CompanyExplorerV2Row[],
  parentEntityID: string,
): boolean {
  const cleanParentEntityID = parentEntityID.trim();
  if (!cleanParentEntityID) return false;
  return rows.some((row) => (row.parent_entity_id ?? "").trim() === cleanParentEntityID && row.entity_type !== "node");
}

export function shouldLoadCompanyExplorerBranchChildren(input: {
  parentEntityID: string;
  rows: CompanyExplorerV2Row[];
  branchLoaded: boolean;
  branchStale: boolean;
  branchInflight: boolean;
}): boolean {
  if (!input.parentEntityID.trim() || input.branchInflight) return false;
  if (input.branchStale || !input.branchLoaded) return true;
  return !companyExplorerBranchHasMaterializedRows(input.rows, input.parentEntityID);
}

function applyKanbanBoardsUpdated(
  state: CompanyExplorerStoreState,
  companyID: string,
  detail: KanbanBoardsUpdatedDetail | undefined,
): CompanyExplorerStoreState {
  if (detail?.companyID && detail.companyID !== companyID) return state;
  if (detail?.deletedBoardID) {
    return {
      ...state,
      kanbanBoards: state.kanbanBoards.filter((board) => board.board_id !== detail.deletedBoardID),
      folderItems: state.folderItems.filter((item) => item.item_type !== "kanban" || item.item_id !== detail.deletedBoardID),
    };
  }
  if (detail?.board) {
    return {
      ...state,
      kanbanBoards: upsertKanbanBoard(state.kanbanBoards, detail.board),
    };
  }
  return state;
}

function applyWorkspaceEnvelope(
  state: CompanyExplorerStoreState,
  companyID: string,
  envelope: CompanyExplorerWorkspaceStreamEnvelope,
): CompanyExplorerStoreState {
  if (envelope.company_id !== companyID) return state;
  const data = envelope.data ?? {};

  if (envelope.type === "node_created" || envelope.type === "node_updated") {
    const node = asNodeRecord(data.node);
    if (!node) return state;
    return {
      ...state,
      nodes: upsertByID(state.nodes, node, (item) => item.node_id),
      rows: updateCompanyExplorerV2ResourceRows(state.rows, "node", node.node_id, node.name),
    };
  }
  if (envelope.type === "node_deleted") {
    const nodeID = typeof data.node_id === "string" ? data.node_id : "";
    if (!nodeID) return state;
    return removeDeletedEntities(state, {
      type: "removeDeletedEntities",
      deletedFolderIDs: new Set(),
      deletedNodeIDs: new Set([nodeID]),
      deletedLogicGateIDs: new Set(),
      deletedProjectIDs: new Set(),
      deletedKanbanBoardIDs: new Set(),
    });
  }
  if (envelope.type === "logic_gate_created" || envelope.type === "logic_gate_updated") {
    const logicGate = asLogicGateApiRecord(data.logic_gate);
    if (!logicGate) return state;
    const canvasRecord = toLogicGateCanvasRecord(logicGate);
    return { ...state, logicGates: upsertByID(state.logicGates, canvasRecord, (item) => item.logic_gate_id) };
  }
  if (envelope.type === "logic_gate_deleted") {
    const logicGateID = typeof data.logic_gate_id === "string" ? data.logic_gate_id : "";
    if (!logicGateID) return state;
    return {
      ...state,
      logicGates: state.logicGates.filter((logicGate) => logicGate.logic_gate_id !== logicGateID),
      folderItems: state.folderItems.filter((item) => item.item_type !== "logic_gate" || item.item_id !== logicGateID),
    };
  }
  if (envelope.type === "project_created" || envelope.type === "project_updated") {
    const project = asProjectRecord(data.project);
    return project ? { ...state, projects: upsertByID(state.projects, project, (item) => item.project_id) } : state;
  }
  if (envelope.type === "project_deleted") {
    const projectID = typeof data.project_id === "string" ? data.project_id : "";
    if (!projectID) return state;
    return {
      ...state,
      projects: state.projects.filter((project) => project.project_id !== projectID),
      folderItems: state.folderItems.filter((item) => item.item_type !== "project" || item.item_id !== projectID),
    };
  }
  if (
    envelope.type === "company_explorer_folder_created" ||
    envelope.type === "company_explorer_folder_moved" ||
    envelope.type === "company_explorer_folder_updated"
  ) {
    const row = asCompanyExplorerV2Row(data.entity);
    if (row) return { ...state, rows: upsertCompanyExplorerV2Rows(state.rows, [row]) };
    const folder = asCompanyExplorerFolder(data.folder);
    return folder ? { ...state, folders: upsertByID(state.folders, folder, (item) => item.folder_id) } : state;
  }
  if (envelope.type === "company_explorer_folder_deleted") {
    const folderID = typeof data.folder_id === "string" ? data.folder_id : "";
    if (!folderID) return state;
    const deletedFolderIDs = collectFolderSubtreeIDs(state.folders, folderID);
    if (deletedFolderIDs.size === 0) deletedFolderIDs.add(folderID);
    return {
      ...state,
      folders: state.folders.filter((folder) => !deletedFolderIDs.has(folder.folder_id)),
      folderItems: state.folderItems.filter((item) => !deletedFolderIDs.has(item.folder_id)),
      rows: state.rows.filter((row) => !deletedFolderIDs.has(row.entity_id) && !deletedFolderIDs.has(row.parent_entity_id ?? "")),
    };
  }
  if (envelope.type === "company_explorer_item_placed") {
    const row = asCompanyExplorerV2Row(data.entity);
    if (row) return { ...state, rows: upsertCompanyExplorerV2Rows(state.rows, [row]) };
    const folderItem = asCompanyExplorerFolderItem(data.folder_item);
    return folderItem ? { ...state, folderItems: upsertFolderItems(state.folderItems, [folderItem]) } : state;
  }
  if (envelope.type === "company_explorer_item_removed") {
    const edgeID = typeof data.item_id === "string" ? data.item_id : "";
    const targetType = typeof data.target_type === "string" ? data.target_type : "";
    const targetID = typeof data.target_id === "string" ? data.target_id : "";
    return {
      ...state,
      rows: edgeID ? state.rows.filter((row) => row.edge_id !== edgeID) : state.rows,
      folderItems: targetType && targetID ? state.folderItems.filter((item) => item.item_type !== targetType || item.item_id !== targetID) : state.folderItems,
    };
  }
  if (envelope.type === "kanban_board_saved" || envelope.type === "kanban_board_updated") {
    const board = asKanbanBoard(data.board);
    return board ? { ...state, kanbanBoards: upsertKanbanBoard(state.kanbanBoards, board) } : state;
  }
  if (envelope.type === "kanban_board_deleted") {
    const boardID = typeof data.board_id === "string" ? data.board_id : "";
    if (!boardID) return state;
    return {
      ...state,
      kanbanBoards: state.kanbanBoards.filter((board) => board.board_id !== boardID),
      folderItems: state.folderItems.filter((item) => item.item_type !== "kanban" || item.item_id !== boardID),
    };
  }
  return state;
}

function removeDeletedEntities(
  state: CompanyExplorerStoreState,
  action: Extract<CompanyExplorerStoreAction, { type: "removeDeletedEntities" }>,
): CompanyExplorerStoreState {
  return {
    ...state,
    folders: state.folders.filter((folder) => !action.deletedFolderIDs.has(folder.folder_id)),
    nodes: state.nodes.filter((node) => !action.deletedNodeIDs.has(node.node_id)),
    logicGates: state.logicGates.filter((logicGate) => !action.deletedLogicGateIDs.has(logicGate.logic_gate_id)),
    projects: state.projects.filter((project) => !action.deletedProjectIDs.has(project.project_id)),
    kanbanBoards: state.kanbanBoards.filter((board) => !action.deletedKanbanBoardIDs.has(board.board_id)),
    rows: state.rows.filter((row) =>
      !action.deletedFolderIDs.has(row.entity_id)
      && !action.deletedFolderIDs.has(row.parent_entity_id ?? "")
      && (row.entity_type !== "node" || (!action.deletedNodeIDs.has(row.resource_id ?? "") && !action.deletedNodeIDs.has(row.entity_id)))
      && (row.entity_type !== "logic_gate" || !action.deletedLogicGateIDs.has(row.resource_id ?? ""))
      && (row.entity_type !== "project" || !action.deletedProjectIDs.has(row.resource_id ?? ""))
    ),
    folderItems: state.folderItems.filter((item) =>
      !action.deletedFolderIDs.has(item.folder_id)
      && (item.item_type !== "node" || !action.deletedNodeIDs.has(item.item_id))
      && (item.item_type !== "logic_gate" || !action.deletedLogicGateIDs.has(item.item_id))
      && (item.item_type !== "project" || !action.deletedProjectIDs.has(item.item_id))
      && (item.item_type !== "kanban" || !action.deletedKanbanBoardIDs.has(item.item_id))
    ),
  };
}

function upsertByID<T>(items: T[], nextItem: T, getID: (item: T) => string): T[] {
  const nextID = getID(nextItem);
  return items.some((item) => getID(item) === nextID)
    ? items.map((item) => (getID(item) === nextID ? nextItem : item))
    : [...items, nextItem];
}

function mergeByID<T>(items: T[], nextItems: T[], getID: (item: T) => string): T[] {
  let merged = items;
  for (const item of nextItems) merged = upsertByID(merged, item, getID);
  return merged;
}

function replaceByID<T>(items: T[], nextItem: T, getID: (item: T) => string): T[] {
  const nextID = getID(nextItem);
  return items.map((item) => (getID(item) === nextID ? nextItem : item));
}

function upsertFolderItems(
  previous: CompanyExplorerFolderItem[],
  folderItems: CompanyExplorerFolderItem[],
): CompanyExplorerFolderItem[] {
  let next = previous;
  for (const item of filterCompanyExplorerFolderItemsForExplorer(folderItems)) {
    const exists = next.some((row) => row.item_type === item.item_type && row.item_id === item.item_id);
    next = exists
      ? next.map((row) => (row.item_type === item.item_type && row.item_id === item.item_id ? item : row))
      : [...next, item];
  }
  return next;
}

function filterCompanyExplorerFolderItemsForExplorer(items: CompanyExplorerFolderItem[]): CompanyExplorerFolderItem[] {
  return items;
}

function filterCompanyExplorerV2RowsForExplorer(rows: CompanyExplorerV2Row[]): CompanyExplorerV2Row[] {
  return rows;
}

function updateCompanyExplorerV2ResourceRows(
  rows: CompanyExplorerV2Row[],
  entityType: CompanyExplorerV2Row["entity_type"],
  resourceID: string,
  name: string,
): CompanyExplorerV2Row[] {
  const cleanResourceID = resourceID.trim();
  if (!cleanResourceID) return rows;
  let changed = false;
  const next = rows.map((row) => {
    if (row.entity_type !== entityType || (row.resource_id ?? "").trim() !== cleanResourceID || row.name === name) return row;
    changed = true;
    return { ...row, name };
  });
  return changed ? next : rows;
}

function companyExplorerV2RowKey(row: CompanyExplorerV2Row): string {
  const entityID = row.entity_id?.trim() ?? "";
  if (row.entity_type === "folder" && entityID) return `folder:${entityID}`;
  return row.edge_id?.trim() || `${row.parent_entity_id?.trim() ?? ""}:${entityID}`;
}

function upsertCompanyExplorerV2Rows(
  previous: CompanyExplorerV2Row[],
  rows: CompanyExplorerV2Row[],
): CompanyExplorerV2Row[] {
  let next = previous;
  for (const row of filterCompanyExplorerV2RowsForExplorer(rows)) {
    const rowKey = companyExplorerV2RowKey(row);
    if (!rowKey) continue;
    let replaced = false;
    const updated: CompanyExplorerV2Row[] = [];
    for (const item of next) {
      if (companyExplorerV2RowKey(item) !== rowKey) {
        updated.push(item);
        continue;
      }
      if (!replaced) {
        updated.push(row);
        replaced = true;
      }
    }
    if (!replaced) updated.push(row);
    next = updated;
  }
  return next;
}

function upsertKanbanBoard(previous: KanbanBoard[], board: KanbanBoard): KanbanBoard[] {
  return sortKanbanBoards([
    ...previous.filter((item) => item.board_id !== board.board_id),
    board,
  ]);
}

function sortKanbanBoards(boards: KanbanBoard[]): KanbanBoard[] {
  return [...boards].sort((a, b) => (
    a.position - b.position ||
    a.created_timestamp.localeCompare(b.created_timestamp) ||
    a.board_id.localeCompare(b.board_id)
  ));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const clean = item.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function asLogicGateApiRecord(value: unknown): LogicGateApiRecord | null {
  if (!isObjectRecord(value) || typeof value.logic_gate_id !== "string" || typeof value.header !== "string" || typeof value.created_timestamp !== "string") return null;
  return value as LogicGateApiRecord;
}

function asNodeRecord(value: unknown): NodeRecord | null {
  if (!isObjectRecord(value) || typeof value.node_id !== "string" || typeof value.name !== "string" || typeof value.created_timestamp !== "string") return null;
  return value as NodeRecord;
}

function asProjectRecord(value: unknown): ProjectRecord | null {
  if (!isObjectRecord(value) || typeof value.project_id !== "string" || typeof value.name !== "string" || typeof value.created_timestamp !== "string") return null;
  return value as ProjectRecord;
}

function asCompanyExplorerFolder(value: unknown): CompanyExplorerFolder | null {
  if (!isObjectRecord(value) || typeof value.folder_id !== "string" || typeof value.folder_kind !== "string" || typeof value.name !== "string") return null;
  return value as CompanyExplorerFolder;
}

function asCompanyExplorerFolderItem(value: unknown): CompanyExplorerFolderItem | null {
  if (!isObjectRecord(value) || typeof value.folder_id !== "string" || typeof value.item_type !== "string" || typeof value.item_id !== "string") return null;
  return value as CompanyExplorerFolderItem;
}

function asCompanyExplorerV2Row(value: unknown): CompanyExplorerV2Row | null {
  if (!isObjectRecord(value) || typeof value.entity_id !== "string" || typeof value.entity_type !== "string" || typeof value.name !== "string") return null;
  return value as CompanyExplorerV2Row;
}

function asKanbanBoard(value: unknown): KanbanBoard | null {
  if (!isObjectRecord(value) || typeof value.board_id !== "string") return null;
  return value as KanbanBoard;
}
