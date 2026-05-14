import { requestJSON } from "../api/requestJSON.js";
import { invalidateWorkspaceSnapshot } from "../workspace/workspaceSnapshotCache.js";
import { logicGateIDFromKanbanBoardID } from "./shared.js";
import type { KanbanBoard, KanbanCard, KanbanColumn, LogicGateArenaView } from "./shared.js";

type FetchJSONOptions = {
  method?: string;
  body?: unknown;
};

type CacheEntry<T> = {
  value: T;
  fetchedAt: number;
};

const KANBAN_BOARD_LIST_TTL_MS = 2 * 60_000;
const LOGIC_GATE_ARENA_VIEW_TTL_MS = 5 * 60_000;

const boardListCache = new Map<string, CacheEntry<KanbanBoard[]>>();
const logicGateArenaViewCache = new Map<string, CacheEntry<LogicGateArenaView>>();

async function fetchJSON<T>(apiBase: string, path: string, options: FetchJSONOptions = {}): Promise<T> {
  return requestJSON<T>(apiBase, path, {
    method: options.method ?? "GET",
    json: options.body,
  });
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
  const payload = await fetchJSON<{ columns?: KanbanColumn[] }>(apiBase, `/v1/kanban/columns?${params}`);
  return payload.columns ?? [];
}

export async function listKanbanBoards(apiBase: string, companyID: string, limit = 100, afterPosition = 0, logicGateID = ""): Promise<KanbanBoard[]> {
  const params = query({ company_id: companyID, limit, after_position: afterPosition > 0 ? afterPosition : undefined, logic_gate_id: logicGateID });
  const cacheKey = `${apiBase}:${params}`;
  const cached = readCache(boardListCache.get(cacheKey) ?? null, KANBAN_BOARD_LIST_TTL_MS, cloneBoards);
  if (cached) return cached;
  const payload = await fetchJSON<{ boards?: KanbanBoard[] }>(apiBase, `/v1/kanban/boards?${params}`);
  const boards = payload.boards ?? [];
  boardListCache.set(cacheKey, { value: cloneBoards(boards), fetchedAt: Date.now() });
  return boards;
}

export async function getLogicGateArenaView(apiBase: string, companyID: string, logicGateID: string): Promise<LogicGateArenaView> {
  const params = query({ company_id: companyID, logic_gate_id: logicGateID });
  const cacheKey = `${apiBase}:${params}`;
  const cached = readCache(logicGateArenaViewCache.get(cacheKey) ?? null, LOGIC_GATE_ARENA_VIEW_TTL_MS, cloneLogicGateArenaView);
  if (cached) return cached;
  const view = await fetchJSON<LogicGateArenaView>(apiBase, `/v1/logic-gate-arena?${params}`);
  logicGateArenaViewCache.set(cacheKey, { value: cloneLogicGateArenaView(view), fetchedAt: Date.now() });
  return view;
}

export async function createKanbanBoard(apiBase: string, companyID: string, title: string, boardID = "", position?: number): Promise<KanbanBoard> {
  const board = await fetchJSON<KanbanBoard>(apiBase, "/v1/kanban/boards", {
    method: "POST",
    body: { company_id: companyID, board_id: boardID, title, position },
  });
  invalidateKanbanBoardListCache(apiBase, companyID);
  invalidateWorkspaceSnapshot(apiBase, companyID);
  return board;
}

export async function updateKanbanBoard(apiBase: string, companyID: string, boardID: string, title: string, position?: number): Promise<KanbanBoard> {
  const board = await fetchJSON<KanbanBoard>(apiBase, `/v1/kanban/boards/${encodeURIComponent(boardID)}`, {
    method: "PUT",
    body: { company_id: companyID, title, position },
  });
  invalidateKanbanBoardListCache(apiBase, companyID);
  invalidateLogicGateArenaViewCache(apiBase, companyID, board.logic_gate_id ?? logicGateIDFromKanbanBoardID(board.board_id));
  invalidateWorkspaceSnapshot(apiBase, companyID);
  return board;
}

export async function deleteKanbanBoard(apiBase: string, companyID: string, boardID: string): Promise<void> {
  const params = query({ company_id: companyID });
  await fetchJSON<{ status?: string }>(apiBase, `/v1/kanban/boards/${encodeURIComponent(boardID)}?${params}`, { method: "DELETE" });
  invalidateKanbanBoardListCache(apiBase, companyID);
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateIDFromKanbanBoardID(boardID));
  invalidateWorkspaceSnapshot(apiBase, companyID);
}

export async function createKanbanColumn(apiBase: string, companyID: string, boardID: string, title: string, position?: number, widthPx?: number, heightPx?: number, itemColor?: string): Promise<KanbanColumn> {
  const column = await fetchJSON<KanbanColumn>(apiBase, "/v1/kanban/columns", {
    method: "POST",
    body: { company_id: companyID, board_id: boardID, title, position, width_px: widthPx, height_px: heightPx, item_color: itemColor },
  });
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateIDFromKanbanBoardID(boardID));
  invalidateWorkspaceSnapshot(apiBase, companyID);
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
  const column = await fetchJSON<KanbanColumn>(args.apiBase, `/v1/kanban/columns/${encodeURIComponent(args.columnID)}`, {
    method: "PUT",
    body: {
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
  invalidateWorkspaceSnapshot(args.apiBase, args.companyID);
  return column;
}

export async function deleteKanbanColumn(apiBase: string, companyID: string, boardID: string, columnID: string): Promise<void> {
  const params = query({ company_id: companyID, board_id: boardID });
  await fetchJSON<{ status?: string }>(apiBase, `/v1/kanban/columns/${encodeURIComponent(columnID)}?${params}`, { method: "DELETE" });
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateIDFromKanbanBoardID(boardID));
  invalidateWorkspaceSnapshot(apiBase, companyID);
}

export async function listKanbanCards(apiBase: string, companyID: string, boardID: string, columnID = "", limit = 200, afterPosition = 0): Promise<KanbanCard[]> {
  const params = query({ company_id: companyID, board_id: boardID, column_id: columnID, limit, after_position: afterPosition > 0 ? afterPosition : undefined });
  const payload = await fetchJSON<{ cards?: KanbanCard[] }>(apiBase, `/v1/kanban/cards?${params}`);
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
  const card = await fetchJSON<KanbanCard>(args.apiBase, "/v1/kanban/cards", {
    method: "POST",
    body: {
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
  invalidateWorkspaceSnapshot(args.apiBase, args.companyID);
  return card;
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
  const card = await fetchJSON<KanbanCard>(args.apiBase, `/v1/kanban/cards/${encodeURIComponent(args.cardID)}`, {
    method: "PUT",
    body: {
      company_id: args.companyID,
      board_id: args.boardID,
      column_id: args.columnID,
      position: args.position,
      is_issue: args.isIssue,
    },
  });
  invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, logicGateIDFromKanbanBoardID(args.boardID));
  invalidateWorkspaceSnapshot(args.apiBase, args.companyID);
  return card;
}

export async function deleteKanbanCard(apiBase: string, companyID: string, boardID: string, cardID: string): Promise<void> {
  const params = query({ company_id: companyID, board_id: boardID });
  await fetchJSON<{ status?: string }>(apiBase, `/v1/kanban/cards/${encodeURIComponent(cardID)}?${params}`, { method: "DELETE" });
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateIDFromKanbanBoardID(boardID));
  invalidateWorkspaceSnapshot(apiBase, companyID);
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
