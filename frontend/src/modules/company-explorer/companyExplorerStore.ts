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

export type CompanyExplorerSnapshotPayload = {
  nodes?: NodeRecord[];
  logic_gates?: LogicGateApiRecord[];
  projects?: ProjectRecord[];
  folders?: CompanyExplorerFolder[];
  folder_items?: CompanyExplorerFolderItem[];
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
  folderSnapshotLoaded: boolean;
};

export type CompanyExplorerStoreAction =
  | { type: "resetSnapshot" }
  | { type: "applySnapshot"; snapshot: CompanyExplorerSnapshotPayload }
  | { type: "setKanbanBoards"; boards: KanbanBoard[] }
  | { type: "applyKanbanBoardsUpdated"; companyID: string; detail?: KanbanBoardsUpdatedDetail }
  | { type: "applyWorkspaceEnvelope"; companyID: string; envelope: CompanyExplorerWorkspaceStreamEnvelope }
  | { type: "upsertFolder"; folder: CompanyExplorerFolder }
  | { type: "replaceFolder"; folder: CompanyExplorerFolder }
  | { type: "upsertFolderItems"; folderItems: CompanyExplorerFolderItem[] }
  | { type: "upsertNode"; node: NodeRecord }
  | { type: "replaceNode"; node: NodeRecord }
  | { type: "upsertLogicGate"; logicGate: LogicGateRecord }
  | { type: "replaceLogicGate"; logicGate: LogicGateRecord }
  | { type: "upsertProject"; project: ProjectRecord }
  | { type: "replaceProject"; project: ProjectRecord }
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

export function createCompanyExplorerStoreState(): CompanyExplorerStoreState {
  return {
    nodes: [],
    logicGates: [],
    projects: [],
    kanbanBoards: [],
    folders: [],
    folderItems: [],
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
        folderSnapshotLoaded: false,
      };
    case "applySnapshot":
      return {
        ...state,
        nodes: action.snapshot.nodes ?? [],
        logicGates: (action.snapshot.logic_gates ?? []).map(toLogicGateCanvasRecord),
        projects: action.snapshot.projects ?? [],
        folders: action.snapshot.folders ?? [],
        folderItems: action.snapshot.folder_items ?? [],
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
    case "upsertNode":
      return { ...state, nodes: upsertByID(state.nodes, action.node, (node) => node.node_id) };
    case "replaceNode":
      return { ...state, nodes: replaceByID(state.nodes, action.node, (node) => node.node_id) };
    case "upsertLogicGate":
      return { ...state, logicGates: upsertByID(state.logicGates, action.logicGate, (logicGate) => logicGate.logic_gate_id) };
    case "replaceLogicGate":
      return { ...state, logicGates: replaceByID(state.logicGates, action.logicGate, (logicGate) => logicGate.logic_gate_id) };
    case "upsertProject":
      return { ...state, projects: upsertByID(state.projects, action.project, (project) => project.project_id) };
    case "replaceProject":
      return { ...state, projects: replaceByID(state.projects, action.project, (project) => project.project_id) };
    case "removeDeletedEntities":
      return removeDeletedEntities(state, action);
    case "restore":
      return action.state;
  }
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
    return node ? { ...state, nodes: upsertByID(state.nodes, node, (item) => item.node_id) } : state;
  }
  if (envelope.type === "node_deleted") {
    const nodeID = typeof data.node_id === "string" ? data.node_id : "";
    if (!nodeID) return state;
    return {
      ...state,
      nodes: state.nodes.filter((node) => node.node_id !== nodeID),
      folderItems: state.folderItems.filter((item) => item.item_type !== "node" || item.item_id !== nodeID),
    };
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
    };
  }
  if (envelope.type === "company_explorer_folder_item_assigned") {
    const folderItem = asCompanyExplorerFolderItem(data.folder_item);
    return folderItem ? { ...state, folderItems: upsertFolderItems(state.folderItems, [folderItem]) } : state;
  }
  if (envelope.type === "company_explorer_folder_item_removed") {
    const itemType = typeof data.item_type === "string" ? data.item_type : "";
    const itemID = typeof data.item_id === "string" ? data.item_id : "";
    if (!itemType || !itemID) return state;
    return {
      ...state,
      folderItems: state.folderItems.filter((item) => item.item_type !== itemType || item.item_id !== itemID),
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

function replaceByID<T>(items: T[], nextItem: T, getID: (item: T) => string): T[] {
  const nextID = getID(nextItem);
  return items.map((item) => (getID(item) === nextID ? nextItem : item));
}

function upsertFolderItems(
  previous: CompanyExplorerFolderItem[],
  folderItems: CompanyExplorerFolderItem[],
): CompanyExplorerFolderItem[] {
  let next = previous;
  for (const item of folderItems) {
    const exists = next.some((row) => row.item_type === item.item_type && row.item_id === item.item_id);
    next = exists
      ? next.map((row) => (row.item_type === item.item_type && row.item_id === item.item_id ? item : row))
      : [...next, item];
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

function asNodeRecord(value: unknown): NodeRecord | null {
  if (!isObjectRecord(value) || typeof value.node_id !== "string" || typeof value.title !== "string" || typeof value.created_timestamp !== "string") return null;
  return value as NodeRecord;
}

function asLogicGateApiRecord(value: unknown): LogicGateApiRecord | null {
  if (!isObjectRecord(value) || typeof value.logic_gate_id !== "string" || typeof value.header !== "string" || typeof value.created_timestamp !== "string") return null;
  return value as LogicGateApiRecord;
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

function asKanbanBoard(value: unknown): KanbanBoard | null {
  if (!isObjectRecord(value) || typeof value.board_id !== "string") return null;
  return value as KanbanBoard;
}
