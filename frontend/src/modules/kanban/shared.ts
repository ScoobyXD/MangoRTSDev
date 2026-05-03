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

export type KanbanGroupField =
  | "column_id"
  | "status"
  | "item_type"
  | "work_type"
  | "assigned_to"
  | "assigned_by"
  | "created_by"
  | "updated_by";

export type KanbanSortField =
  | "position"
  | "title_snapshot"
  | "status"
  | "work_type"
  | "assigned_to"
  | "item_type"
  | "created_timestamp"
  | "updated_timestamp"
  | "status_entered_timestamp";

export type KanbanVisibleAttribute =
  | "item_type"
  | "status"
  | "status_age"
  | "work_type"
  | "assigned_to"
  | "assigned_by"
  | "updated_by"
  | "last_activity";

export type KanbanFilter = {
  field: "title_snapshot" | "status" | "work_type" | "assigned_to" | "assigned_by" | "item_type";
  op: "eq" | "prefix";
  value: string;
};

export type KanbanSortSpec = {
  field: KanbanSortField;
  direction: "asc" | "desc";
};

export type KanbanViewSpec = {
  filters: KanbanFilter[];
  sort: KanbanSortSpec[];
  groupBy: KanbanGroupField[];
  collapsedGroupKeys: Set<string>;
};

export type KanbanCardGroup = {
  key: string;
  field: KanbanGroupField;
  value: string;
  label: string;
  count: number;
  collapsed: boolean;
  groups: KanbanCardGroup[];
  cards: KanbanCard[];
};

export const KANBAN_GROUP_FIELD_LABELS: Record<KanbanGroupField, string> = {
  column_id: "Status column",
  status: "Status",
  item_type: "Item type",
  work_type: "Work type",
  assigned_to: "Assigned to",
  assigned_by: "Assigned by",
  created_by: "Created by",
  updated_by: "Updated by",
};

export const KANBAN_SORT_FIELD_LABELS: Record<KanbanSortField, string> = {
  position: "Board position",
  title_snapshot: "Title",
  status: "Status",
  work_type: "Work type",
  assigned_to: "Assigned to",
  item_type: "Item type",
  created_timestamp: "Created",
  updated_timestamp: "Updated",
  status_entered_timestamp: "Status age",
};

export const KANBAN_VISIBLE_ATTRIBUTE_LABELS: Record<KanbanVisibleAttribute, string> = {
  item_type: "Item type",
  status: "Status",
  status_age: "Status age",
  work_type: "Work type",
  assigned_to: "Assigned to",
  assigned_by: "Assigned by",
  updated_by: "Updated by",
  last_activity: "Last activity",
};

export const KANBAN_GROUP_FIELDS = Object.keys(KANBAN_GROUP_FIELD_LABELS) as KanbanGroupField[];
export const KANBAN_VISIBLE_ATTRIBUTES = Object.keys(KANBAN_VISIBLE_ATTRIBUTE_LABELS) as KanbanVisibleAttribute[];
export const KANBAN_SORT_FIELDS = Object.keys(KANBAN_SORT_FIELD_LABELS) as KanbanSortField[];

export const KANBAN_DEFAULT_VISIBLE_ATTRIBUTES: KanbanVisibleAttribute[] = ["item_type", "status_age", "assigned_to", "work_type"];
export const KANBAN_DEFAULT_GROUP_BY: KanbanGroupField[] = ["column_id"];
export const KANBAN_DEFAULT_SORT: KanbanSortSpec[] = [{ field: "position", direction: "asc" }];

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

export function getKanbanCardFieldValue(card: KanbanCard, field: KanbanGroupField | KanbanSortField | KanbanFilter["field"] | KanbanVisibleAttribute, columnTitleByID: Map<string, string> = new Map()): string {
  if (field === "column_id") return card.column_id;
  if (field === "position") return String(card.position);
  if (field === "created_timestamp") return card.created_timestamp;
  if (field === "updated_timestamp") return card.updated_timestamp;
  if (field === "status_entered_timestamp") return card.status_entered_timestamp;
  if (field === "title_snapshot") return card.title_snapshot;
  if (field === "status_age") return "";
  const value = card[field as keyof KanbanCard];
  if (typeof value === "string" && value.trim()) return value;
  if (field === "status") return columnTitleByID.get(card.column_id) ?? "Unspecified";
  return "";
}

export function getKanbanGroupLabel(field: KanbanGroupField, value: string, columnTitleByID: Map<string, string> = new Map()): string {
  if (field === "column_id") return columnTitleByID.get(value) ?? "Missing column";
  if (!value.trim()) return field === "assigned_to" || field === "assigned_by" ? "Unassigned" : "Unspecified";
  if (field === "item_type") return value === "logic_gate" ? "Logic Gate" : "Node";
  return value;
}

export function matchesKanbanFilters(card: KanbanCard, filters: KanbanFilter[], columnTitleByID: Map<string, string> = new Map()): boolean {
  for (const filter of filters) {
    const target = getKanbanCardFieldValue(card, filter.field, columnTitleByID).trim().toLowerCase();
    const value = filter.value.trim().toLowerCase();
    if (!value) continue;
    if (filter.op === "prefix") {
      if (!target.startsWith(value)) return false;
      continue;
    }
    if (target !== value) return false;
  }
  return true;
}

function compareKanbanCards(a: KanbanCard, b: KanbanCard, sort: KanbanSortSpec, columnTitleByID: Map<string, string>): number {
  if (sort.field === "position") return a.position - b.position;
  if (sort.field === "created_timestamp" || sort.field === "updated_timestamp" || sort.field === "status_entered_timestamp") {
    return Date.parse(getKanbanCardFieldValue(a, sort.field, columnTitleByID)) - Date.parse(getKanbanCardFieldValue(b, sort.field, columnTitleByID));
  }
  return getKanbanCardFieldValue(a, sort.field, columnTitleByID).localeCompare(getKanbanCardFieldValue(b, sort.field, columnTitleByID), undefined, { sensitivity: "base" });
}

export function filterAndSortKanbanCards(cards: KanbanCard[], spec: Pick<KanbanViewSpec, "filters" | "sort">, columnTitleByID: Map<string, string> = new Map()): KanbanCard[] {
  const sortSpecs = spec.sort.length ? spec.sort : KANBAN_DEFAULT_SORT;
  return cards
    .filter((card) => matchesKanbanFilters(card, spec.filters, columnTitleByID))
    .sort((a, b) => {
      for (const sortSpec of sortSpecs) {
        const compared = compareKanbanCards(a, b, sortSpec, columnTitleByID);
        if (compared !== 0) return sortSpec.direction === "desc" ? -compared : compared;
      }
      return a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp);
    });
}

export function buildKanbanCardGroups(cards: KanbanCard[], groupBy: KanbanGroupField[], collapsedGroupKeys: Set<string>, columnTitleByID: Map<string, string> = new Map(), prefix = ""): KanbanCardGroup[] {
  if (groupBy.length === 0) return [];
  const field = groupBy[0];
  const buckets = new Map<string, KanbanCard[]>();
  for (const card of cards) {
    const value = getKanbanCardFieldValue(card, field, columnTitleByID);
    const bucket = buckets.get(value) ?? [];
    bucket.push(card);
    buckets.set(value, bucket);
  }

  // Grouping is pure and deterministic so UI and future headless agents can reuse
  // the same query spec and get the same shape without reading React state.
  return Array.from(buckets.entries())
    .sort(([a], [b]) => getKanbanGroupLabel(field, a, columnTitleByID).localeCompare(getKanbanGroupLabel(field, b, columnTitleByID), undefined, { sensitivity: "base" }))
    .map(([value, bucket]) => {
      const key = prefix ? `${prefix}|${field}=${value}` : `${field}=${value}`;
      const collapsed = collapsedGroupKeys.has(key);
      return {
        key,
        field,
        value,
        label: getKanbanGroupLabel(field, value, columnTitleByID),
        count: bucket.length,
        collapsed,
        groups: collapsed ? [] : buildKanbanCardGroups(bucket, groupBy.slice(1), collapsedGroupKeys, columnTitleByID, key),
        cards: collapsed || groupBy.length > 1 ? [] : bucket,
      };
    });
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

export function getKanbanConditionalColor(card: KanbanCard, field: KanbanGroupField, columnTitleByID: Map<string, string> = new Map()): string {
  const palette = ["#2f7d62", "#245c9f", "#9a5b16", "#8f3d56", "#4f6f1f", "#66752c", "#7d4ea3", "#0f766e"];
  const value = getKanbanCardFieldValue(card, field, columnTitleByID) || "empty";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}
