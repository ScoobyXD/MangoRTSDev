import { requestJSON } from "../api/requestJSON.js";
import type { Account } from "../accounts/accountsApi.js";
import type { CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import type { LogicGateGVICRole, LogicGateRecord } from "../logic-gates/types.js";
import type { NodeRecord } from "../nodes/types.js";
import { markWorkspaceSnapshotScopeStale } from "../workspace/workspaceSnapshotCache.js";
import {
  invalidateKanbanBoardContentsCache,
  invalidateKanbanBoardContentsForCompany,
} from "./KanbanBoardContentStore.js";
import {
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  logicGateIDFromKanbanBoardID,
  logicGateKanbanBoardID,
} from "./shared.js";
import type { KanbanBoard, KanbanBoardContentsUpdatedDetail, KanbanCard, KanbanColumn } from "./shared.js";

type CacheEntry<T> = {
  value: T;
  fetchedAt: number;
};

const KANBAN_BOARD_LIST_TTL_MS = 2 * 60_000;

const boardListCache = new Map<string, CacheEntry<KanbanBoard[]>>();
const boardListGenerationByScope = new Map<string, number>();

function boardListScopeKey(apiBase: string, companyID: string): string {
  return `${apiBase}\u0000${companyID.trim()}`;
}

function readBoardListGeneration(apiBase: string, companyID: string): number {
  return boardListGenerationByScope.get(boardListScopeKey(apiBase, companyID)) ?? 0;
}

function bumpBoardListGeneration(apiBase: string, companyID: string): void {
  const scopeKey = boardListScopeKey(apiBase, companyID);
  boardListGenerationByScope.set(scopeKey, (boardListGenerationByScope.get(scopeKey) ?? 0) + 1);
}


function markKanbanWorkspaceSnapshotStale(apiBase: string, companyID: string, boardID: string): void {
  const cleanBoardID = boardID.trim();
  if (!cleanBoardID) return;
  markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "kanban", boardID: cleanBoardID });
}

function markNodeWorkspaceSnapshotStale(apiBase: string, companyID: string): void {
  markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "full" });
}

function markLogicGateAssignmentWorkspaceSnapshotsStale(args: { apiBase: string; companyID: string; logicGateID?: string; fromLogicGateID?: string; nodeID?: string }): void {
  const logicGateID = args.logicGateID?.trim() ?? "";
  const fromLogicGateID = args.fromLogicGateID?.trim() ?? "";
  if (logicGateID) markKanbanWorkspaceSnapshotStale(args.apiBase, args.companyID, logicGateKanbanBoardID(logicGateID));
  if (fromLogicGateID && fromLogicGateID !== logicGateID) markKanbanWorkspaceSnapshotStale(args.apiBase, args.companyID, logicGateKanbanBoardID(fromLogicGateID));
  if (args.nodeID?.trim()) markNodeWorkspaceSnapshotStale(args.apiBase, args.companyID);
}

function reconcileCommittedCrossLogicGateAssignment(args: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  fromLogicGateID: string;
  nodeID: string;
}): void {
  const logicGateIDs = Array.from(new Set([
    args.fromLogicGateID.trim(),
    args.logicGateID.trim(),
  ].filter(Boolean)));
  for (const logicGateID of logicGateIDs) {
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, logicGateID);
  }
  markLogicGateAssignmentWorkspaceSnapshotsStale(args);
  if (typeof window === "undefined") return;
  for (const logicGateID of logicGateIDs) {
    const boardID = logicGateKanbanBoardID(logicGateID);
    window.dispatchEvent(new CustomEvent<KanbanBoardContentsUpdatedDetail>(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, {
      detail: { companyID: args.companyID, boardID, logicGateID },
    }));
  }
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  return search.toString();
}

export async function listKanbanBoards(apiBase: string, companyID: string, limit = 100, afterPosition = 0, logicGateID = ""): Promise<KanbanBoard[]> {
  const params = query({ company_id: companyID, limit, after_position: afterPosition > 0 ? afterPosition : undefined, logic_gate_id: logicGateID });
  const cacheKey = `${apiBase}:${params}`;
  const cached = readCache(boardListCache.get(cacheKey) ?? null, KANBAN_BOARD_LIST_TTL_MS, cloneBoards);
  if (cached) return cached;
  const generation = readBoardListGeneration(apiBase, companyID);
  const payload = await requestJSON<{ boards?: KanbanBoard[] }>(apiBase, `/v1/kanban/boards?${params}`);
  const boards = payload.boards ?? [];
  if (readBoardListGeneration(apiBase, companyID) === generation) boardListCache.set(cacheKey, { value: cloneBoards(boards), fetchedAt: Date.now() });
  return boards;
}

export async function createKanbanBoard(apiBase: string, companyID: string, title: string, boardID = "", position?: number): Promise<KanbanBoard> {
  const board = await requestJSON<KanbanBoard>(apiBase, "/v1/kanban/boards", {
    method: "POST",
    json: { company_id: companyID, board_id: boardID, title, position },
  });
  invalidateKanbanBoardListCache(apiBase, companyID);
  markKanbanWorkspaceSnapshotStale(apiBase, companyID, board.board_id);
  return board;
}

export async function updateKanbanBoard(apiBase: string, companyID: string, boardID: string, title: string, position?: number): Promise<KanbanBoard> {
  const board = await requestJSON<KanbanBoard>(apiBase, `/v1/kanban/boards/${encodeURIComponent(boardID)}`, {
    method: "PUT",
    json: { company_id: companyID, title, position },
  });
  invalidateKanbanBoardListCache(apiBase, companyID);
  invalidateLogicGateArenaViewCache(apiBase, companyID, board.logic_gate_id ?? logicGateIDFromKanbanBoardID(board.board_id));
  markKanbanWorkspaceSnapshotStale(apiBase, companyID, board.board_id || boardID);
  return board;
}

export async function deleteKanbanBoard(apiBase: string, companyID: string, boardID: string): Promise<void> {
  const params = query({ company_id: companyID });
  await requestJSON<{ status?: string }>(apiBase, `/v1/kanban/boards/${encodeURIComponent(boardID)}?${params}`, { method: "DELETE" });
  invalidateKanbanBoardListCache(apiBase, companyID);
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateIDFromKanbanBoardID(boardID));
  markKanbanWorkspaceSnapshotStale(apiBase, companyID, boardID);
}

export async function createKanbanColumn(apiBase: string, companyID: string, boardID: string, title: string, position?: number, widthPx?: number, heightPx?: number, itemColor?: string): Promise<KanbanColumn> {
  const column = await requestJSON<KanbanColumn>(apiBase, "/v1/kanban/columns", {
    method: "POST",
    json: { company_id: companyID, board_id: boardID, title, position, width_px: widthPx, height_px: heightPx, item_color: itemColor },
  });
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateIDFromKanbanBoardID(boardID));
  markKanbanWorkspaceSnapshotStale(apiBase, companyID, boardID);
  return column;
}

export async function updateKanbanColumn(args: {
  apiBase: string;
  companyID: string;
  boardID: string;
  columnID: string;
  title?: string;
  position?: number;
  widthPx?: number;
  heightPx?: number;
  itemColor?: string;
}): Promise<KanbanColumn> {
  const column = await requestJSON<KanbanColumn>(args.apiBase, `/v1/kanban/columns/${encodeURIComponent(args.columnID)}`, {
    method: "PUT",
    json: {
      company_id: args.companyID,
      board_id: args.boardID,
      title: args.title,
      position: args.position,
      width_px: args.widthPx,
      height_px: args.heightPx,
      item_color: args.itemColor,
    },
  });
  invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, logicGateIDFromKanbanBoardID(args.boardID));
  markKanbanWorkspaceSnapshotStale(args.apiBase, args.companyID, args.boardID);
  return column;
}

export async function deleteKanbanColumn(apiBase: string, companyID: string, boardID: string, columnID: string): Promise<void> {
  const params = query({ company_id: companyID, board_id: boardID });
  await requestJSON<{ status?: string }>(apiBase, `/v1/kanban/columns/${encodeURIComponent(columnID)}?${params}`, { method: "DELETE" });
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateIDFromKanbanBoardID(boardID));
  markKanbanWorkspaceSnapshotStale(apiBase, companyID, boardID);
}

export async function upsertKanbanCard(args: {
  apiBase: string;
  companyID: string;
  boardID: string;
  columnID: string;
  nodeID: string;
  nodeTitle: string;
  position: number;
  descriptionSnapshot?: string;
}): Promise<KanbanCard> {
  const card = await requestJSON<KanbanCard>(args.apiBase, "/v1/kanban/cards", {
    method: "POST",
    json: {
      company_id: args.companyID,
      board_id: args.boardID,
      column_id: args.columnID,
      node_id: args.nodeID,
      node_title: args.nodeTitle,
      position: args.position,
      description_snapshot: args.descriptionSnapshot,
    },
  });
  invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, logicGateIDFromKanbanBoardID(args.boardID));
  markKanbanWorkspaceSnapshotStale(args.apiBase, args.companyID, args.boardID);
  markNodeWorkspaceSnapshotStale(args.apiBase, args.companyID);
  return card;
}

export type GVICMatrixProjectionRow = {
  company_id: string;
  projection_row_id: string;
  user_id: string;
  node_name: string;
  gvic_assignment?: string;
  responsible_user_ids?: string[];
  priority?: number;
  project_id?: string;
  project_name?: string;
  logic_gate_id?: string;
  logic_gate_name?: string;
  node_id: string;
  status?: string;
  due_date?: string;
  accounts?: Account[];
  created_timestamp: string;
  updated_timestamp: string;
  sort_order?: number;
};

export type LogicGateAssignmentCommandResult = { card: KanbanCard; node: NodeRecord; gvic_projection_rows: GVICMatrixProjectionRow[] };
type LogicGateAssignmentMutationOrigin = "company_explorer" | "kanban" | "matrix";

export type GVICMatrixNodeCreateResult = {
  node: NodeRecord;
  logic_gate?: LogicGateRecord;
  assignment?: unknown;
  card?: KanbanCard;
  folder_items?: CompanyExplorerFolderItem[];
  gvic_projection_rows: GVICMatrixProjectionRow[];
};

type LogicGateAssignmentCommandPayload = Omit<LogicGateAssignmentCommandResult, "gvic_projection_rows"> & {
  gvic_projection_rows?: GVICMatrixProjectionRow[] | null;
};

type GVICMatrixNodeCreatePayload = Omit<GVICMatrixNodeCreateResult, "gvic_projection_rows"> & {
  gvic_projection_rows?: GVICMatrixProjectionRow[] | null;
};

function normalizeGVICMatrixProjectionRows(rows?: GVICMatrixProjectionRow[] | null): GVICMatrixProjectionRow[] {
  return Array.isArray(rows) ? rows : [];
}

function normalizeLogicGateAssignmentCommandResult(payload: LogicGateAssignmentCommandPayload): LogicGateAssignmentCommandResult {
  return {
    card: { ...payload.card },
    node: { ...payload.node },
    gvic_projection_rows: normalizeGVICMatrixProjectionRows(payload.gvic_projection_rows),
  };
}

export async function createGVICMatrixNode(args: {
  apiBase: string;
  companyID: string;
  name: string;
  logicGateID?: string;
  createLogicGateHeader?: string;
  creatorLogicGateGVICRole?: LogicGateGVICRole;
  status?: string;
  columnID?: string;
  priority?: number | null;
  position?: number;
  isIssue?: boolean;
}): Promise<GVICMatrixNodeCreateResult> {
  const payload = await requestJSON<GVICMatrixNodeCreatePayload>(args.apiBase, "/v2/gvic-matrix/nodes", {
    method: "POST",
    json: {
      company_id: args.companyID,
      name: args.name,
      logic_gate_id: args.logicGateID,
      create_logic_gate_header: args.createLogicGateHeader,
      creator_logic_gate_gvic_role: args.creatorLogicGateGVICRole,
      mutation_origin: "matrix",
      status: args.status ?? args.columnID,
      priority: args.priority,
      position: args.position,
      is_issue: args.isIssue,
    },
  });
  if (payload.logic_gate?.logic_gate_id) {
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, payload.logic_gate.logic_gate_id);
  }
  if (payload.card?.board_id) {
    markKanbanWorkspaceSnapshotStale(args.apiBase, args.companyID, payload.card.board_id);
  }
  markNodeWorkspaceSnapshotStale(args.apiBase, args.companyID);
  return {
    ...payload,
    gvic_projection_rows: normalizeGVICMatrixProjectionRows(payload.gvic_projection_rows),
  };
}

export async function assignNodeToLogicGateStatus(args: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  nodeID: string;
  status?: string;
  columnID?: string;
  priority?: number | null;
  nodeTitle?: string;
  createNodeTitle?: string;
  position?: number;
  isIssue?: boolean;
  mutationOrigin?: LogicGateAssignmentMutationOrigin;
}): Promise<LogicGateAssignmentCommandResult> {
  const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/logic-gates/${encodeURIComponent(args.logicGateID)}/nodes`, {
    method: "POST",
    json: {
      company_id: args.companyID,
      node_id: args.nodeID,
      status: args.status ?? args.columnID,
      priority: args.priority,
      node_title: args.nodeTitle,
      create_node_title: args.createNodeTitle,
      mutation_origin: args.mutationOrigin ?? "matrix",
      position: args.position,
      is_issue: args.isIssue,
    },
  });
  invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, args.logicGateID);
  markLogicGateAssignmentWorkspaceSnapshotsStale({ apiBase: args.apiBase, companyID: args.companyID, logicGateID: args.logicGateID, nodeID: args.nodeID });
  return normalizeLogicGateAssignmentCommandResult(payload);
}

export async function moveLogicGateAssignment(args: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  nodeID: string;
  fromLogicGateID?: string;
  status?: string;
  columnID?: string;
  position?: number;
  priority?: number | null;
  mutationOrigin?: LogicGateAssignmentMutationOrigin;
}): Promise<LogicGateAssignmentCommandResult> {
  const logicGateID = args.logicGateID.trim();
  const fromLogicGateID = args.fromLogicGateID?.trim() ?? "";
  if (!fromLogicGateID || fromLogicGateID === logicGateID) {
    const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/logic-gates/${encodeURIComponent(args.logicGateID)}/nodes/${encodeURIComponent(args.nodeID)}/state`, {
      method: "PUT",
      json: {
        company_id: args.companyID,
        status: args.status ?? args.columnID,
        mutation_origin: args.mutationOrigin ?? "matrix",
        position: args.position,
        priority: args.priority,
      },
    });
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, args.logicGateID);
    markLogicGateAssignmentWorkspaceSnapshotsStale({ apiBase: args.apiBase, companyID: args.companyID, logicGateID: args.logicGateID, fromLogicGateID: args.fromLogicGateID, nodeID: args.nodeID });
    return normalizeLogicGateAssignmentCommandResult(payload);
  }
  const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/gvic-matrix/nodes/${encodeURIComponent(args.nodeID)}/move`, {
    method: "POST",
    json: {
      company_id: args.companyID,
      to_logic_gate_id: logicGateID,
      from_logic_gate_id: fromLogicGateID,
      status: args.status,
      column_id: args.columnID,
      mutation_origin: args.mutationOrigin ?? "matrix",
      position: args.position,
      priority: args.priority,
    },
  });
  reconcileCommittedCrossLogicGateAssignment({
    apiBase: args.apiBase,
    companyID: args.companyID,
    logicGateID,
    fromLogicGateID,
    nodeID: args.nodeID,
  });
  return normalizeLogicGateAssignmentCommandResult(payload);
}

export async function removeLogicGateAssignment(args: {
  apiBase: string;
  companyID: string;
  logicGateID?: string;
  nodeID: string;
  fallbackStatus?: string | null;
}): Promise<LogicGateAssignmentCommandResult> {
  const logicGateID = args.logicGateID?.trim() ?? "";
  if (logicGateID) {
    const params = query({
      company_id: args.companyID,
      fallback_status: args.fallbackStatus ?? undefined,
    });
    const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/nodes/${encodeURIComponent(args.nodeID)}?${params}`, {
      method: "DELETE",
    });
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, logicGateID);
    markLogicGateAssignmentWorkspaceSnapshotsStale({ apiBase: args.apiBase, companyID: args.companyID, logicGateID, nodeID: args.nodeID });
    return normalizeLogicGateAssignmentCommandResult(payload);
  }
  const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, "/v1/work-items/logic-gate-assignments/remove", {
    method: "POST",
    json: {
      company_id: args.companyID,
      logic_gate_id: args.logicGateID,
      node_id: args.nodeID,
      fallback_status: args.fallbackStatus,
    },
  });
  invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, args.logicGateID);
  markLogicGateAssignmentWorkspaceSnapshotsStale({ apiBase: args.apiBase, companyID: args.companyID, logicGateID: args.logicGateID, nodeID: args.nodeID });
  return normalizeLogicGateAssignmentCommandResult(payload);
}

export async function setLogicGateAssignmentIssue(args: {
  apiBase: string;
  companyID: string;
  logicGateID?: string;
  nodeID: string;
  isIssue: boolean;
}): Promise<LogicGateAssignmentCommandResult> {
  const logicGateID = args.logicGateID?.trim() ?? "";
  if (logicGateID) {
    const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/nodes/${encodeURIComponent(args.nodeID)}/state`, {
      method: "PUT",
      json: {
        company_id: args.companyID,
        is_issue: args.isIssue,
      },
    });
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, logicGateID);
    markLogicGateAssignmentWorkspaceSnapshotsStale({ apiBase: args.apiBase, companyID: args.companyID, logicGateID, nodeID: args.nodeID });
    return normalizeLogicGateAssignmentCommandResult(payload);
  }
  const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, "/v1/work-items/logic-gate-assignments/issue", {
    method: "POST",
    json: {
      company_id: args.companyID,
      logic_gate_id: args.logicGateID,
      node_id: args.nodeID,
      is_issue: args.isIssue,
    },
  });
  invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, args.logicGateID);
  markLogicGateAssignmentWorkspaceSnapshotsStale({ apiBase: args.apiBase, companyID: args.companyID, logicGateID: args.logicGateID, nodeID: args.nodeID });
  return normalizeLogicGateAssignmentCommandResult(payload);
}

export async function moveKanbanCard(args: {
  apiBase: string;
  companyID: string;
  boardID: string;
  cardID: string;
  columnID?: string;
  position?: number;
  isIssue?: boolean;
}): Promise<KanbanCard> {
  const card = await requestJSON<KanbanCard>(args.apiBase, `/v1/kanban/cards/${encodeURIComponent(args.cardID)}`, {
    method: "PUT",
    json: {
      company_id: args.companyID,
      board_id: args.boardID,
      column_id: args.columnID,
      position: args.position,
      is_issue: args.isIssue,
    },
  });
  invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, logicGateIDFromKanbanBoardID(args.boardID));
  markKanbanWorkspaceSnapshotStale(args.apiBase, args.companyID, args.boardID);
  return card;
}

export async function deleteKanbanCard(apiBase: string, companyID: string, boardID: string, cardID: string): Promise<void> {
  const params = query({ company_id: companyID, board_id: boardID });
  await requestJSON<{ status?: string }>(apiBase, `/v1/kanban/cards/${encodeURIComponent(cardID)}?${params}`, { method: "DELETE" });
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateIDFromKanbanBoardID(boardID));
  markKanbanWorkspaceSnapshotStale(apiBase, companyID, boardID);
}

export function invalidateKanbanBoardListCache(apiBase: string, companyID: string): void {
  bumpBoardListGeneration(apiBase, companyID);
  const prefix = `${apiBase}:company_id=${encodeURIComponent(companyID)}`;
  for (const key of Array.from(boardListCache.keys())) {
    if (key.startsWith(prefix)) boardListCache.delete(key);
  }
}

export function invalidateLogicGateArenaViewCache(apiBase: string, companyID: string, logicGateID = ""): void {
  const cleanLogicGateID = logicGateID.trim();
  if (cleanLogicGateID) {
    invalidateKanbanBoardContentsCache(apiBase, companyID, logicGateKanbanBoardID(cleanLogicGateID));
    return;
  }
  invalidateKanbanBoardContentsForCompany(apiBase, companyID);
}

function readCache<T>(entry: CacheEntry<T> | null, maxAgeMs: number, clone: (value: T) => T): T | null {
  if (!entry || Date.now() - entry.fetchedAt > maxAgeMs) return null;
  return clone(entry.value);
}

function cloneBoards(boards: KanbanBoard[]): KanbanBoard[] {
  return boards.map((board) => ({ ...board }));
}
