import type { KanbanCard, KanbanColumn } from "./shared";

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

export async function createKanbanColumn(apiBase: string, companyID: string, boardID: string, title: string, position?: number, widthPx?: number, heightPx?: number, itemColor?: string): Promise<KanbanColumn> {
  return fetchJSON<KanbanColumn>(apiBase, "/v1/kanban/columns", {
    method: "POST",
    body: { company_id: companyID, board_id: boardID, title, position, width_px: widthPx, height_px: heightPx, item_color: itemColor },
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
  heightPx?: number;
  itemColor?: string;
}): Promise<KanbanColumn> {
  return fetchJSON<KanbanColumn>(args.apiBase, `/v1/kanban/columns/${encodeURIComponent(args.columnID)}`, {
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
  return fetchJSON<KanbanCard>(args.apiBase, "/v1/kanban/cards", {
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
}

export async function moveKanbanCard(args: {
  apiBase: string;
  companyID: string;
  boardID: string;
  cardID: string;
  columnID: string;
  position: number;
}): Promise<KanbanCard> {
  return fetchJSON<KanbanCard>(args.apiBase, `/v1/kanban/cards/${encodeURIComponent(args.cardID)}`, {
    method: "PUT",
    body: {
      company_id: args.companyID,
      board_id: args.boardID,
      column_id: args.columnID,
      position: args.position,
    },
  });
}

export async function deleteKanbanCard(apiBase: string, companyID: string, boardID: string, cardID: string): Promise<void> {
  const params = query({ company_id: companyID, board_id: boardID });
  await fetchJSON<{ status?: string }>(apiBase, `/v1/kanban/cards/${encodeURIComponent(cardID)}?${params}`, { method: "DELETE" });
}
