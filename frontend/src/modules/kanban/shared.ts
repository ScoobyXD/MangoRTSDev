export const EXPLORER_ENTITY_DRAG_MIME = "application/x-mango-explorer-entity";
export const KANBAN_CARD_DRAG_MIME = "application/x-mango-kanban-card";
export const KANBAN_COLUMN_DRAG_MIME = "application/x-mango-kanban-column";
export const KANBAN_COLUMN_TITLE_TEXT_TRANSFORM = "none";
export const KANBAN_MODULE_TOP_CLEARANCE_PX = 38;
export const KANBAN_DEFAULT_COLUMN_WIDTH_PX = 260;
export const KANBAN_MIN_COLUMN_WIDTH_PX = 180;
export const KANBAN_MAX_COLUMN_WIDTH_PX = 520;

export type KanbanItemType = "node" | "logic_gate";

export type ExplorerEntityDragPayload = {
  itemType: KanbanItemType;
  itemID: string;
  label: string;
};

export type KanbanColumn = {
  company_id: string;
  board_id: string;
  column_id: string;
  title: string;
  position: number;
  width_px: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type KanbanCard = {
  company_id: string;
  board_id: string;
  card_id: string;
  column_id: string;
  item_type: KanbanItemType;
  item_id: string;
  title_snapshot: string;
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type KanbanCardDragPayload = {
  cardID: string;
  sourceColumnID: string;
};

export type KanbanColumnDragPayload = {
  columnID: string;
};

export type KanbanColumnPositionUpdate = {
  columnID: string;
  position: number;
};

export function isKanbanItemType(value: unknown): value is KanbanItemType {
  return value === "node" || value === "logic_gate";
}

export function sanitizeExplorerEntityDragPayload(value: unknown): ExplorerEntityDragPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { itemType?: unknown; itemID?: unknown; label?: unknown };
  if (!isKanbanItemType(candidate.itemType)) return null;
  if (typeof candidate.itemID !== "string" || candidate.itemID.trim() === "") return null;
  const label = typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : candidate.itemID.trim();
  return { itemType: candidate.itemType, itemID: candidate.itemID.trim(), label };
}

export function parseExplorerEntityDragPayload(raw: string): ExplorerEntityDragPayload | null {
  try {
    return sanitizeExplorerEntityDragPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function serializeExplorerEntityDragPayload(payload: ExplorerEntityDragPayload): string {
  return JSON.stringify(payload);
}

export function parseKanbanCardDragPayload(raw: string): KanbanCardDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as { cardID?: unknown; sourceColumnID?: unknown };
    if (typeof parsed.cardID !== "string" || parsed.cardID.trim() === "") return null;
    if (typeof parsed.sourceColumnID !== "string" || parsed.sourceColumnID.trim() === "") return null;
    return { cardID: parsed.cardID.trim(), sourceColumnID: parsed.sourceColumnID.trim() };
  } catch {
    return null;
  }
}

export function parseKanbanColumnDragPayload(raw: string): KanbanColumnDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as { columnID?: unknown };
    if (typeof parsed.columnID !== "string" || parsed.columnID.trim() === "") return null;
    return { columnID: parsed.columnID.trim() };
  } catch {
    return null;
  }
}

export function clampColumnWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx)) return KANBAN_DEFAULT_COLUMN_WIDTH_PX;
  return Math.max(KANBAN_MIN_COLUMN_WIDTH_PX, Math.min(KANBAN_MAX_COLUMN_WIDTH_PX, Math.round(widthPx)));
}

export function getColumnWidth(column: Pick<KanbanColumn, "width_px">): number {
  return clampColumnWidth(column.width_px || KANBAN_DEFAULT_COLUMN_WIDTH_PX);
}

export function sortColumns(columns: KanbanColumn[]): KanbanColumn[] {
  return [...columns].sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp));
}

export function nextColumnPosition(columns: Pick<KanbanColumn, "position">[]): number {
  let next = 1000;
  for (const column of columns) {
    if (column.position >= next) next = column.position + 1000;
  }
  return next;
}

function buildCompactedColumnUpdates(columns: KanbanColumn[]): KanbanColumnPositionUpdate[] {
  return columns.map((column, index) => ({ columnID: column.column_id, position: (index + 1) * 1000 }));
}

export function buildColumnReorderPlan(columns: KanbanColumn[], draggedColumnID: string, targetColumnID: string | null): { columns: KanbanColumn[]; updates: KanbanColumnPositionUpdate[] } {
  const sorted = sortColumns(columns);
  const dragged = sorted.find((column) => column.column_id === draggedColumnID);
  if (!dragged || dragged.column_id === targetColumnID) return { columns: sorted, updates: [] };

  const withoutDragged = sorted.filter((column) => column.column_id !== draggedColumnID);
  const targetIndex = targetColumnID ? withoutDragged.findIndex((column) => column.column_id === targetColumnID) : withoutDragged.length;
  if (targetIndex < 0) return { columns: sorted, updates: [] };

  const reordered = [
    ...withoutDragged.slice(0, targetIndex),
    dragged,
    ...withoutDragged.slice(targetIndex),
  ];
  const prev = reordered[targetIndex - 1];
  const next = reordered[targetIndex + 1];
  const hasRoomBeforeNext = !next || (prev ? next.position - prev.position > 1 : next.position > 1);

  if (!hasRoomBeforeNext) {
    const updates = buildCompactedColumnUpdates(reordered);
    const byID = new Map(updates.map((update) => [update.columnID, update.position]));
    return { columns: sortColumns(reordered.map((column) => ({ ...column, position: byID.get(column.column_id) ?? column.position }))), updates };
  }

  const position = prev && next
    ? Math.floor((prev.position + next.position) / 2)
    : prev
      ? prev.position + 1000
      : Math.max(1, (next?.position ?? 1001) - 1000);
  return {
    columns: sortColumns(reordered.map((column) => (column.column_id === draggedColumnID ? { ...column, position } : column))),
    updates: [{ columnID: draggedColumnID, position }],
  };
}

export function nextCardPosition(cards: Pick<KanbanCard, "column_id" | "position">[], columnID: string): number {
  let next = 1000;
  for (const card of cards) {
    if (card.column_id !== columnID) continue;
    if (card.position >= next) next = card.position + 1000;
  }
  return next;
}

export function groupCardsByColumn(cards: KanbanCard[]): Map<string, KanbanCard[]> {
  const grouped = new Map<string, KanbanCard[]>();
  for (const card of cards) {
    const list = grouped.get(card.column_id) ?? [];
    list.push(card);
    grouped.set(card.column_id, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp));
  }
  return grouped;
}
