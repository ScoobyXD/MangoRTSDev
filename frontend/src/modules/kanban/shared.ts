export const EXPLORER_ENTITY_DRAG_MIME = "application/x-mango-explorer-entity";
export const KANBAN_CARD_DRAG_MIME = "application/x-mango-kanban-card";
export const KANBAN_COLUMN_DRAG_MIME = "application/x-mango-kanban-column";
export const KANBAN_COLUMN_TITLE_TEXT_TRANSFORM = "none";
export const KANBAN_MODULE_TOP_CLEARANCE_PX = 38;
export const KANBAN_DEFAULT_COLUMN_WIDTH_PX = 260;
export const KANBAN_MIN_COLUMN_WIDTH_PX = 180;
export const KANBAN_MAX_COLUMN_WIDTH_PX = 520;
export const KANBAN_DEFAULT_COLUMN_HEIGHT_PX = 240;
export const KANBAN_MIN_COLUMN_HEIGHT_PX = 160;
export const KANBAN_MAX_COLUMN_HEIGHT_PX = 720;

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
  height_px: number;
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
  description_snapshot: string;
  position: number;
  status: string;
  work_type: string;
  assigned_to: string;
  assigned_by: string;
  created_by: string;
  updated_by: string;
  last_activity: string;
  status_entered_timestamp: string;
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

export type KanbanColumnDropPlacement = "before" | "after";

export type KanbanCardSummaryAttribute = "item_type" | "status_age" | "assigned_to" | "work_type";

export const KANBAN_CARD_SUMMARY_ATTRIBUTES: KanbanCardSummaryAttribute[] = ["item_type", "status_age", "assigned_to", "work_type"];

export const KANBAN_CARD_SUMMARY_ATTRIBUTE_LABELS: Record<KanbanCardSummaryAttribute, string> = {
  item_type: "Item type",
  status_age: "Status age",
  assigned_to: "Assigned to",
  work_type: "Work type",
};

export function isKanbanItemType(value: unknown): value is KanbanItemType {
  return value === "node" || value === "logic_gate";
}

export function defaultKanbanCardMetadata(input: Pick<KanbanCard, "item_type" | "column_id" | "created_timestamp" | "updated_timestamp"> & Partial<KanbanCard>, columnTitle = "Unspecified"): Pick<KanbanCard, "description_snapshot" | "status" | "work_type" | "assigned_to" | "assigned_by" | "created_by" | "updated_by" | "last_activity" | "status_entered_timestamp"> {
  const now = input.updated_timestamp || input.created_timestamp || new Date().toISOString();
  return {
    description_snapshot: input.description_snapshot ?? "",
    status: (input.status ?? columnTitle).trim() || "Unspecified",
    work_type: (input.work_type ?? (input.item_type === "logic_gate" ? "Logic Gate" : "Node")).trim(),
    assigned_to: input.assigned_to ?? "",
    assigned_by: input.assigned_by ?? "",
    created_by: input.created_by ?? "",
    updated_by: input.updated_by ?? "",
    last_activity: input.last_activity ?? "",
    status_entered_timestamp: input.status_entered_timestamp || now,
  };
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

export function clampColumnHeight(heightPx: number): number {
  if (!Number.isFinite(heightPx)) return KANBAN_DEFAULT_COLUMN_HEIGHT_PX;
  return Math.max(KANBAN_MIN_COLUMN_HEIGHT_PX, Math.min(KANBAN_MAX_COLUMN_HEIGHT_PX, Math.round(heightPx)));
}

export function getColumnWidth(column: Pick<KanbanColumn, "width_px">): number {
  return clampColumnWidth(column.width_px || KANBAN_DEFAULT_COLUMN_WIDTH_PX);
}

export function getColumnHeight(column: Pick<KanbanColumn, "height_px">): number {
  return clampColumnHeight(column.height_px || KANBAN_DEFAULT_COLUMN_HEIGHT_PX);
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

function resolveColumnDropTarget(columns: KanbanColumn[], draggedColumnID: string, targetColumnID: string | null, placement: KanbanColumnDropPlacement): string | null {
  if (targetColumnID === draggedColumnID) return draggedColumnID;
  if (!targetColumnID || placement === "before") return targetColumnID;
  const withoutDragged = sortColumns(columns).filter((column) => column.column_id !== draggedColumnID);
  const targetIndex = withoutDragged.findIndex((column) => column.column_id === targetColumnID);
  if (targetIndex < 0 || targetIndex === withoutDragged.length - 1) return null;
  return withoutDragged[targetIndex + 1].column_id;
}

export function buildColumnReorderPlan(columns: KanbanColumn[], draggedColumnID: string, targetColumnID: string | null, placement: KanbanColumnDropPlacement = "before"): { columns: KanbanColumn[]; updates: KanbanColumnPositionUpdate[] } {
  const sorted = sortColumns(columns);
  const dragged = sorted.find((column) => column.column_id === draggedColumnID);
  const resolvedTargetID = resolveColumnDropTarget(sorted, draggedColumnID, targetColumnID, placement);
  if (!dragged || dragged.column_id === resolvedTargetID) return { columns: sorted, updates: [] };

  const withoutDragged = sorted.filter((column) => column.column_id !== draggedColumnID);
  const targetIndex = resolvedTargetID ? withoutDragged.findIndex((column) => column.column_id === resolvedTargetID) : withoutDragged.length;
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

export function formatKanbanStatusAge(card: Pick<KanbanCard, "status_entered_timestamp">, nowMs = Date.now()): string {
  const startedMs = Date.parse(card.status_entered_timestamp);
  if (!Number.isFinite(startedMs)) return "unknown";
  const elapsedMinutes = Math.max(0, Math.floor((nowMs - startedMs) / 60000));
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 48) return `${elapsedHours}h`;
  return `${Math.floor(elapsedHours / 24)}d`;
}

export function getKanbanItemTypeLabel(itemType: KanbanItemType): string {
  return itemType === "logic_gate" ? "Logic Gate" : "Node";
}

export function getKanbanCardSummaryAttributeValue(card: KanbanCard, attribute: KanbanCardSummaryAttribute): string {
  if (attribute === "item_type") return getKanbanItemTypeLabel(card.item_type);
  if (attribute === "status_age") return formatKanbanStatusAge(card);
  if (attribute === "assigned_to") return card.assigned_to.trim();
  return card.work_type.trim();
}

export function getKanbanConditionalColor(card: KanbanCard): string {
  const palette = ["#2f7d62", "#245c9f", "#9a5b16", "#8f3d56", "#4f6f1f", "#66752c", "#7d4ea3", "#0f766e"];
  const value = card.status.trim() || card.column_id || "empty";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}
