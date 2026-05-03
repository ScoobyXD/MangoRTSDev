import type { KanbanCard, KanbanColumn, KanbanFilter, KanbanGroupField, KanbanItemType, KanbanSortSpec, KanbanVisibleAttribute } from "./shared";

type FetchJSONOptions = {
  method?: string;
  body?: unknown;
};

async function fetchJSON<T>(apiBase: string, path: string, options: FetchJSONOptions = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`kanban_api_${response.status}`);
  }
  return response.json() as Promise<T>;
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

export async function createKanbanColumn(apiBase: string, companyID: string, boardID: string, title: string, position?: number, widthPx?: number): Promise<KanbanColumn> {
  return fetchJSON<KanbanColumn>(apiBase, "/v1/kanban/columns", {
    method: "POST",
    body: { company_id: companyID, board_id: boardID, title, position, width_px: widthPx },
  });
}

export async function updateKanbanColumn(args: {
  apiBase: string;
  companyID: string;
  boardID: string;
  columnID: string;
  title?: string;
  position?: number;
  widthPx?: number;
}): Promise<KanbanColumn> {
  return fetchJSON<KanbanColumn>(args.apiBase, `/v1/kanban/columns/${encodeURIComponent(args.columnID)}`, {
    method: "PUT",
    body: {
      company_id: args.companyID,
      board_id: args.boardID,
      title: args.title,
      position: args.position,
      width_px: args.widthPx,
    },
  });
}

export async function deleteKanbanColumn(apiBase: string, companyID: string, boardID: string, columnID: string): Promise<void> {
  const params = query({ company_id: companyID, board_id: boardID });
  await fetchJSON<{ status?: string }>(apiBase, `/v1/kanban/columns/${encodeURIComponent(columnID)}?${params}`, { method: "DELETE" });
}

export async function listKanbanCards(apiBase: string, companyID: string, boardID: string, columnID = "", limit = 200, afterPosition = 0): Promise<KanbanCard[]> {
  const params = query({ company_id: companyID, board_id: boardID, column_id: columnID, limit, after_position: afterPosition > 0 ? afterPosition : undefined });
  const payload = await fetchJSON<{ cards?: KanbanCard[] }>(apiBase, `/v1/kanban/cards?${params}`);
  return payload.cards ?? [];
}

export type KanbanQueryResponse = {
  company_id: string;
  board_id: string;
  limit: number;
  group_by: KanbanGroupField[];
  visible_attributes: KanbanVisibleAttribute[];
  cards: KanbanCard[];
  groups: unknown[];
};

export async function queryKanbanBoard(args: {
  apiBase: string;
  companyID: string;
  boardID: string;
  filters: KanbanFilter[];
  sort: KanbanSortSpec[];
  groupBy: KanbanGroupField[];
  visibleAttributes: KanbanVisibleAttribute[];
  collapsedGroupKeys: string[];
  limit?: number;
}): Promise<KanbanQueryResponse> {
  return fetchJSON<KanbanQueryResponse>(args.apiBase, "/v1/kanban/query", {
    method: "POST",
    body: {
      company_id: args.companyID,
      board_id: args.boardID,
      filters: args.filters,
      sort: args.sort,
      group_by: args.groupBy,
      visible_attributes: args.visibleAttributes,
      collapsed_groups: args.collapsedGroupKeys,
      limit: args.limit ?? 500,
    },
  });
}

export async function upsertKanbanCard(args: {
  apiBase: string;
  companyID: string;
  boardID: string;
  columnID: string;
  itemType: KanbanItemType;
  itemID: string;
  titleSnapshot: string;
  position: number;
  status?: string;
  workType?: string;
  assignedTo?: string;
  assignedBy?: string;
  actorID?: string;
  descriptionSnapshot?: string;
  lastActivity?: string;
}): Promise<KanbanCard> {
  return fetchJSON<KanbanCard>(args.apiBase, "/v1/kanban/cards", {
    method: "POST",
    body: {
      company_id: args.companyID,
      board_id: args.boardID,
      column_id: args.columnID,
      item_type: args.itemType,
      item_id: args.itemID,
      title_snapshot: args.titleSnapshot,
      position: args.position,
      status: args.status,
      work_type: args.workType,
      assigned_to: args.assignedTo,
      assigned_by: args.assignedBy,
      actor_id: args.actorID,
      description_snapshot: args.descriptionSnapshot,
      last_activity: args.lastActivity,
    },
  });
}

export async function moveKanbanCard(args: {
  apiBase: string;
  companyID: string;
  boardID: string;
  cardID: string;
  columnID: string;
  position: number;
  status?: string;
  workType?: string;
  assignedTo?: string;
  assignedBy?: string;
  actorID?: string;
  descriptionSnapshot?: string;
  lastActivity?: string;
}): Promise<KanbanCard> {
  return fetchJSON<KanbanCard>(args.apiBase, `/v1/kanban/cards/${encodeURIComponent(args.cardID)}`, {
    method: "PUT",
    body: {
      company_id: args.companyID,
      board_id: args.boardID,
      column_id: args.columnID,
      position: args.position,
      status: args.status,
      work_type: args.workType,
      assigned_to: args.assignedTo,
      assigned_by: args.assignedBy,
      actor_id: args.actorID,
      description_snapshot: args.descriptionSnapshot,
      last_activity: args.lastActivity,
    },
  });
}
