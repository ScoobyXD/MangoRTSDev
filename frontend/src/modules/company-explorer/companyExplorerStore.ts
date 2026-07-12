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
import type { CompanyExplorerSearchResult, CompanyExplorerV2Row } from "./companyExplorerLazyApi.js";
import type { CompanyExplorerEntityTitleUpdate } from "./companyExplorerLocalEntityUpdates.js";

export type CompanyExplorerSnapshotPayload = {
  nodes?: NodeRecord[];
  logic_gates?: LogicGateApiRecord[];
  projects?: ProjectRecord[];
  folders?: CompanyExplorerFolder[];
  folder_items?: CompanyExplorerFolderItem[];
  rows?: CompanyExplorerV2Row[];
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
  | { type: "upsertFolder"; folder: CompanyExplorerFolder }
  | { type: "replaceFolder"; folder: CompanyExplorerFolder }
  | { type: "upsertFolderItems"; folderItems: CompanyExplorerFolderItem[] }
  | { type: "upsertLogicGate"; logicGate: LogicGateRecord }
  | { type: "replaceLogicGate"; logicGate: LogicGateRecord }
  | { type: "upsertProject"; project: ProjectRecord }
  | { type: "replaceProject"; project: ProjectRecord }
  | { type: "applyEntityTitleUpdate"; update: CompanyExplorerEntityTitleUpdate }
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
    case "applyEntityTitleUpdate":
      return applyCompanyExplorerEntityTitleUpdate(state, action.update);
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

export function applyCompanyExplorerEntityTitleUpdate(
  state: CompanyExplorerStoreState,
  update: CompanyExplorerEntityTitleUpdate,
): CompanyExplorerStoreState {
  if (!update.resourceID.trim() || !update.title.trim()) return state;
  const title = update.title.trim();
  return {
    ...state,
    nodes: update.entityType === "node"
      ? state.nodes.map((node) => node.node_id === update.resourceID ? { ...node, name: title } : node)
      : state.nodes,
    logicGates: update.entityType === "logic_gate"
      ? state.logicGates.map((logicGate) => logicGate.logic_gate_id === update.resourceID
        ? { ...logicGate, header: title, name: title, title }
        : logicGate)
      : state.logicGates,
    rows: state.rows.map((row) => (
      row.entity_type === update.entityType
      && (row.resource_id || row.entity_id) === update.resourceID
        ? { ...row, name: title }
        : row
    )),
  };
}

export function applyCompanyExplorerSearchTitleUpdate(
  results: CompanyExplorerSearchResult[],
  update: CompanyExplorerEntityTitleUpdate,
): CompanyExplorerSearchResult[] {
  const title = update.title.trim();
  if (!update.resourceID.trim() || !title) return results;
  return results.map((result) => ({
    ...result,
    display_name: result.resource_type === update.entityType && result.resource_id === update.resourceID
      ? title
      : result.display_name,
    location_path: result.location_path.map((segment) => (
      segment.entity_type === update.entityType
      && (segment.resource_id || segment.entity_id) === update.resourceID
        ? { ...segment, name: title }
        : segment
    )),
  }));
}

export function shouldRefreshKanbanBoardsAfterUpdate(detail: KanbanBoardsUpdatedDetail | undefined, companyID: string): boolean {
  if (detail?.companyID && detail.companyID !== companyID) return false;
  return !detail?.deletedBoardID && !detail?.board;
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
  return items.filter((item) => item.item_type !== "node");
}

function filterCompanyExplorerV2RowsForExplorer(rows: CompanyExplorerV2Row[]): CompanyExplorerV2Row[] {
  return rows.filter((row) => row.entity_type !== "node");
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
