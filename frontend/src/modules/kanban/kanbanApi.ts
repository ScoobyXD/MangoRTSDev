import { requestJSON } from "../api/requestJSON.js";
import type { CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import type { LogicGateRaciRole, LogicGateRecord } from "../logic-gate-map/shared.js";
import type { NodeRecord } from "../node-map/shared.js";
import { markWorkspaceSnapshotScopeStale } from "../workspace/workspaceSnapshotCache.js";
import { logicGateIDFromKanbanBoardID, logicGateKanbanBoardID } from "./shared.js";
import type { KanbanBoard, KanbanCard, KanbanColumn, LogicGateArenaView } from "./shared.js";

type CacheEntry<T> = {
  value: T;
  fetchedAt: number;
};

const KANBAN_BOARD_LIST_TTL_MS = 2 * 60_000;
const LOGIC_GATE_ARENA_VIEW_TTL_MS = 5 * 60_000;

const boardListCache = new Map<string, CacheEntry<KanbanBoard[]>>();
const logicGateArenaViewCache = new Map<string, CacheEntry<LogicGateArenaView>>();

function markKanbanWorkspaceSnapshotStale(apiBase: string, companyID: string, boardID: string): void {
  const cleanBoardID = boardID.trim();
  if (!cleanBoardID) return;
  markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "kanban", boardID: cleanBoardID });
}

function markNodeMapWorkspaceSnapshotStale(apiBase: string, companyID: string): void {
  markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "node_map" });
}

function markLogicGateAssignmentWorkspaceSnapshotsStale(args: { apiBase: string; companyID: string; logicGateID?: string; fromLogicGateID?: string; nodeID?: string }): void {
  const logicGateID = args.logicGateID?.trim() ?? "";
  const fromLogicGateID = args.fromLogicGateID?.trim() ?? "";
  if (logicGateID) markKanbanWorkspaceSnapshotStale(args.apiBase, args.companyID, logicGateKanbanBoardID(logicGateID));
  if (fromLogicGateID && fromLogicGateID !== logicGateID) markKanbanWorkspaceSnapshotStale(args.apiBase, args.companyID, logicGateKanbanBoardID(fromLogicGateID));
  if (args.nodeID?.trim()) markNodeMapWorkspaceSnapshotStale(args.apiBase, args.companyID);
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  return search.toString();
}

export async function listKanbanColumns(apiBase: string, companyID: string, boardID: string): Promise<KanbanColumn[]> {
  const params = query({ company_id: companyID, board_id: boardID });
  const payload = await requestJSON<{ columns?: KanbanColumn[] }>(apiBase, `/v1/kanban/columns?${params}`);
  return payload.columns ?? [];
}

export async function listKanbanBoards(apiBase: string, companyID: string, limit = 100, afterPosition = 0, logicGateID = ""): Promise<KanbanBoard[]> {
  const params = query({ company_id: companyID, limit, after_position: afterPosition > 0 ? afterPosition : undefined, logic_gate_id: logicGateID });
  const cacheKey = `${apiBase}:${params}`;
  const cached = readCache(boardListCache.get(cacheKey) ?? null, KANBAN_BOARD_LIST_TTL_MS, cloneBoards);
  if (cached) return cached;
  const payload = await requestJSON<{ boards?: KanbanBoard[] }>(apiBase, `/v1/kanban/boards?${params}`);
  const boards = payload.boards ?? [];
  boardListCache.set(cacheKey, { value: cloneBoards(boards), fetchedAt: Date.now() });
  return boards;
}

export async function getLogicGateArenaView(apiBase: string, companyID: string, logicGateID: string): Promise<LogicGateArenaView> {
  const params = query({ company_id: companyID });
  const cacheKey = `${apiBase}:company_id=${encodeURIComponent(companyID)}&logic_gate_id=${encodeURIComponent(logicGateID)}`;
  const cached = readCache(logicGateArenaViewCache.get(cacheKey) ?? null, LOGIC_GATE_ARENA_VIEW_TTL_MS, cloneLogicGateArenaView);
  if (cached) return cached;
  const view = await requestJSON<LogicGateArenaView>(apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/work?${params}`);
  logicGateArenaViewCache.set(cacheKey, { value: cloneLogicGateArenaView(view), fetchedAt: Date.now() });
  return view;
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

export async function listKanbanCards(apiBase: string, companyID: string, boardID: string, columnID = "", limit = 200, afterPosition = 0): Promise<KanbanCard[]> {
  const params = query({ company_id: companyID, board_id: boardID, column_id: columnID, limit, after_position: afterPosition > 0 ? afterPosition : undefined });
  const payload = await requestJSON<{ cards?: KanbanCard[] }>(apiBase, `/v1/kanban/cards?${params}`);
  return payload.cards ?? [];
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
  markNodeMapWorkspaceSnapshotStale(args.apiBase, args.companyID);
  return card;
}

export type RacioMatrixProjectionRow = {
  company_id: string;
  user_id: string;
  resource_type: "node" | "logic_gate";
  resource_id: string;
  logic_gate_id?: string;
  display_title: string;
  status?: string;
  status_color?: string;
  due_date?: string;
  priority?: number;
  assignee_user_id?: string;
  assignee_display_name?: string;
  assignee_email?: string;
  resource_created_timestamp: string;
  updated_timestamp: string;
};

export type LogicGateAssignmentCommandResult = { card: KanbanCard; node: NodeRecord; racio_projection_rows: RacioMatrixProjectionRow[] };
type LogicGateAssignmentMutationOrigin = "kanban" | "matrix";

export type RacioMatrixNodeCreateResult = {
  node: NodeRecord;
  logic_gate?: LogicGateRecord;
  assignment?: unknown;
  card?: KanbanCard;
  folder_items?: CompanyExplorerFolderItem[];
  racio_projection_rows: RacioMatrixProjectionRow[];
};

type LogicGateAssignmentCommandPayload = Omit<LogicGateAssignmentCommandResult, "racio_projection_rows"> & {
  racio_projection_rows?: RacioMatrixProjectionRow[] | null;
};

type RacioMatrixNodeCreatePayload = Omit<RacioMatrixNodeCreateResult, "racio_projection_rows"> & {
  racio_projection_rows?: RacioMatrixProjectionRow[] | null;
};

function normalizeRacioProjectionRows(rows?: RacioMatrixProjectionRow[] | null): RacioMatrixProjectionRow[] {
  return Array.isArray(rows) ? rows : [];
}

function normalizeLogicGateAssignmentCommandResult(payload: LogicGateAssignmentCommandPayload): LogicGateAssignmentCommandResult {
  return {
    card: { ...payload.card },
    node: { ...payload.node },
    racio_projection_rows: normalizeRacioProjectionRows(payload.racio_projection_rows),
  };
}

export async function createRacioMatrixNode(args: {
  apiBase: string;
  companyID: string;
  title: string;
  logicGateID?: string;
  createLogicGateHeader?: string;
  creatorLogicGateRaciRole?: LogicGateRaciRole;
  status?: string;
  columnID?: string;
  priority?: number | null;
  position?: number;
  isIssue?: boolean;
}): Promise<RacioMatrixNodeCreateResult> {
  const payload = await requestJSON<RacioMatrixNodeCreatePayload>(args.apiBase, "/v2/racio-matrix/nodes", {
    method: "POST",
    json: {
      company_id: args.companyID,
      title: args.title,
      logic_gate_id: args.logicGateID,
      create_logic_gate_header: args.createLogicGateHeader,
      creator_logic_gate_raci_role: args.creatorLogicGateRaciRole,
      mutation_origin: "matrix",
      status: args.status ?? args.columnID,
      priority: args.priority,
      position: args.position,
      is_issue: args.isIssue,
      assignee_policy: "first_responsible",
    },
  });
  if (payload.logic_gate?.logic_gate_id) {
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, payload.logic_gate.logic_gate_id);
  }
  if (payload.card?.board_id) {
    markKanbanWorkspaceSnapshotStale(args.apiBase, args.companyID, payload.card.board_id);
  }
  markNodeMapWorkspaceSnapshotStale(args.apiBase, args.companyID);
  return {
    ...payload,
    racio_projection_rows: normalizeRacioProjectionRows(payload.racio_projection_rows),
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
      assignee_policy: "first_responsible",
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
  assigneePolicy?: string;
  mutationOrigin?: LogicGateAssignmentMutationOrigin;
}): Promise<LogicGateAssignmentCommandResult> {
  if (!args.fromLogicGateID || args.fromLogicGateID === args.logicGateID) {
    const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/logic-gates/${encodeURIComponent(args.logicGateID)}/nodes/${encodeURIComponent(args.nodeID)}/state`, {
      method: "PUT",
      json: {
        company_id: args.companyID,
        status: args.status ?? args.columnID,
        mutation_origin: args.mutationOrigin ?? "matrix",
        position: args.position,
        priority: args.priority,
        assignee_policy: args.assigneePolicy,
      },
    });
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, args.logicGateID);
    markLogicGateAssignmentWorkspaceSnapshotsStale({ apiBase: args.apiBase, companyID: args.companyID, logicGateID: args.logicGateID, fromLogicGateID: args.fromLogicGateID, nodeID: args.nodeID });
    return normalizeLogicGateAssignmentCommandResult(payload);
  }
  const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/racio-matrix/nodes/${encodeURIComponent(args.nodeID)}/move`, {
    method: "POST",
    json: {
      company_id: args.companyID,
      to_logic_gate_id: args.logicGateID,
      from_logic_gate_id: args.fromLogicGateID,
      status: args.status,
      column_id: args.columnID,
      mutation_origin: args.mutationOrigin ?? "matrix",
      position: args.position,
      priority: args.priority,
      assignee_policy: args.assigneePolicy,
    },
  });
  invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, args.logicGateID);
  markLogicGateAssignmentWorkspaceSnapshotsStale({ apiBase: args.apiBase, companyID: args.companyID, logicGateID: args.logicGateID, fromLogicGateID: args.fromLogicGateID, nodeID: args.nodeID });
  return normalizeLogicGateAssignmentCommandResult(payload);
}

export async function removeLogicGateAssignment(args: {
  apiBase: string;
  companyID: string;
  logicGateID?: string;
  nodeID: string;
  fallbackStatus?: string | null;
  fallbackStatusColor?: string | null;
}): Promise<LogicGateAssignmentCommandResult> {
  const logicGateID = args.logicGateID?.trim() ?? "";
  if (logicGateID) {
    const params = query({
      company_id: args.companyID,
      fallback_status: args.fallbackStatus ?? undefined,
      fallback_status_color: args.fallbackStatusColor ?? undefined,
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
      fallback_status_color: args.fallbackStatusColor,
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
  const prefix = `${apiBase}:company_id=${encodeURIComponent(companyID)}`;
  for (const key of Array.from(boardListCache.keys())) {
    if (key.startsWith(prefix)) boardListCache.delete(key);
  }
}

export function invalidateLogicGateArenaViewCache(apiBase: string, companyID: string, logicGateID = ""): void {
  const cleanLogicGateID = logicGateID.trim();
  const prefix = `${apiBase}:company_id=${encodeURIComponent(companyID)}&logic_gate_id=`;
  for (const key of Array.from(logicGateArenaViewCache.keys())) {
    if (!key.startsWith(prefix)) continue;
    if (!cleanLogicGateID || key === `${prefix}${encodeURIComponent(cleanLogicGateID)}`) {
      logicGateArenaViewCache.delete(key);
    }
  }
}

function readCache<T>(entry: CacheEntry<T> | null, maxAgeMs: number, clone: (value: T) => T): T | null {
  if (!entry || Date.now() - entry.fetchedAt > maxAgeMs) return null;
  return clone(entry.value);
}

function cloneBoards(boards: KanbanBoard[]): KanbanBoard[] {
  return boards.map((board) => ({ ...board }));
}

function cloneLogicGateArenaView(view: LogicGateArenaView): LogicGateArenaView {
  return {
    logic_gate: { ...view.logic_gate },
    board: { ...view.board },
    columns: view.columns.map((column) => ({ ...column })),
    cards: view.cards.map((card) => ({ ...card })),
    cards_limit: view.cards_limit,
  };
}
