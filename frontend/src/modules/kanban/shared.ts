import type React from "react";

export const EXPLORER_ENTITY_DRAG_MIME = "application/x-mango-explorer-entity";
export const KANBAN_CARD_DRAG_MIME = "application/x-mango-kanban-card";
export const KANBAN_COLUMN_DRAG_MIME = "application/x-mango-kanban-column";
export const EVENT_KANBAN_BOARDS_UPDATED = "mangorts:kanban-boards-updated";
export const KANBAN_COLUMN_TITLE_TEXT_TRANSFORM = "none";
export const KANBAN_MODULE_TOP_CLEARANCE_PX = 38;
export const KANBAN_DEFAULT_COLUMN_WIDTH_PX = 260;
export const KANBAN_MIN_COLUMN_WIDTH_PX = 180;
export const KANBAN_MAX_COLUMN_WIDTH_PX = 2000;
export const KANBAN_DEFAULT_COLUMN_HEIGHT_PX = 240;
export const KANBAN_MIN_COLUMN_HEIGHT_PX = 160;
export const KANBAN_MAX_COLUMN_HEIGHT_PX = 10000;
export const KANBAN_DEFAULT_COLUMN_ITEM_COLOR = "#fbb152";
export const KANBAN_DEFAULT_BOARD_TITLE = "Kanban board";
export const KANBAN_LOGIC_GATE_PENDING_COLOR = "#808080";
export const KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR = "#ff9500";
export const KANBAN_LOGIC_GATE_DONE_COLOR = "#39ff14";
export const KANBAN_ISSUE_CARD_COLOR = "#ffd400";

export type KanbanDragPreviewItem = {
  label: string;
  color?: string;
};

export type ExplorerEntityDragItem = {
  nodeID: string;
  label: string;
};

export type ExplorerEntityDragPayload = {
  itemType: "node";
  nodeID: string;
  label: string;
} | {
  itemType: "node_batch";
  nodes: ExplorerEntityDragItem[];
};

export type KanbanBoard = {
  company_id: string;
  board_id: string;
  logic_gate_id?: string | null;
  title: string;
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type KanbanBoardsUpdatedDetail = {
  companyID?: string;
  board?: KanbanBoard;
  deletedBoardID?: string;
};

export type KanbanColumn = {
  company_id: string;
  board_id: string;
  column_id: string;
  title: string;
  position: number;
  width_px: number;
  height_px: number;
  item_color: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type KanbanCard = {
  company_id: string;
  board_id: string;
  card_id: string;
  column_id: string;
  node_id: string;
  logic_gate_id?: string | null;
  node_title: string;
  description_snapshot: string;
  is_issue?: boolean;
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type LogicGateArenaLogicGate = {
  company_id: string;
  logic_gate_id: string;
  header: string;
  created_timestamp: string;
};

export type LogicGateArenaView = {
  logic_gate: LogicGateArenaLogicGate;
  board: KanbanBoard;
  columns: KanbanColumn[];
  cards: KanbanCard[];
  cards_limit: number;
};

export type KanbanCardDragPayload = {
  cardID: string;
  cardIDs: string[];
  sourceColumnID: string;
};

export type KanbanColumnDragPayload = {
  columnID: string;
};

export type KanbanColumnPositionUpdate = {
  columnID: string;
  position: number;
};

export type KanbanCardPositionUpdate = {
  cardID: string;
  columnID: string;
  position: number;
};

export type KanbanCardSelectionUpdate = {
  selectedCardIDs: Set<string>;
  anchorCardID: string;
};

export type KanbanColumnDropPlacement = "before" | "after" | "swap";
export type KanbanCardDropPlacement = "before" | "after";
export type KanbanGroupField = "status" | "person" | "priority" | "due_date";
export type KanbanGroupSortDirection = "asc" | "desc";

export type KanbanGroupNode = {
  node_id: string;
  due_date?: string | null;
  priority?: number | null;
  assignee_user_id?: string | null;
};

export type KanbanGroupUser = {
  user_id: string;
  email?: string;
  display_name?: string;
};

export type KanbanStatusNode = {
  node_id: string;
  status?: string | null;
  status_color?: string | null;
};

export type KanbanGroupedBoardRow = {
  key: string;
  label: string;
  sortValue: string | number;
  sortLast?: boolean;
};

export type KanbanGroupedBoardCell = {
  rowKey: string;
  cards: KanbanCard[];
};

export type KanbanGroupedBoardColumn = {
  key: string;
  label: string;
  cells: KanbanGroupedBoardCell[];
};

export type KanbanGroupedBoardLayout = {
  columns: KanbanGroupedBoardColumn[];
  rows: KanbanGroupedBoardRow[];
};

export const KANBAN_GROUP_FIELDS: Array<{ value: KanbanGroupField; label: string }> = [
  { value: "status", label: "Status" },
  { value: "person", label: "Person" },
  { value: "priority", label: "Priority" },
  { value: "due_date", label: "Due Date" },
];

export function getDefaultKanbanYAxisSortDirection(field: KanbanGroupField): KanbanGroupSortDirection {
  return field === "priority" ? "desc" : "asc";
}

export function isKanbanBoardDropItemType(value: unknown): value is "node" {
  return value === "node";
}

export function isKanbanColumnItemColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

export function normalizeKanbanColumnItemColor(value: unknown): string {
  return isKanbanColumnItemColor(value) ? value.trim() : KANBAN_DEFAULT_COLUMN_ITEM_COLOR;
}

export function getKanbanBoardDisplayTitle(board: Pick<KanbanBoard, "board_id" | "title">): string {
  const title = board.title.trim();
  if (title) return title;
  const boardID = board.board_id.trim();
  return boardID || KANBAN_DEFAULT_BOARD_TITLE;
}

export function logicGateKanbanBoardID(logicGateID: string): string {
  return `logic-gate:${logicGateID.trim()}`;
}

export function logicGateIDFromKanbanBoardID(boardID: string): string {
  const prefix = "logic-gate:";
  const trimmed = boardID.trim();
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : "";
}

export function sortKanbanBoards(boards: KanbanBoard[]): KanbanBoard[] {
  return [...boards].sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp) || a.board_id.localeCompare(b.board_id));
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return `rgba(251,177,82,${alpha})`;
  const value = Number.parseInt(clean, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red},${green},${blue},${alpha})`;
}

export function attachStackedDragPreview(dataTransfer: DataTransfer, items: KanbanDragPreviewItem[], accentColor: string, title: string): void {
  if (typeof document === "undefined" || items.length === 0) return;
  const visibleItems = items.slice(0, 12);
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "-1000px";
  container.style.left = "-1000px";
  container.style.width = "230px";
  container.style.padding = "8px";
  container.style.border = `1px solid ${accentColor}`;
  container.style.background = "rgba(36, 18, 10, 0.94)";
  container.style.color = "#f6f8fb";
  container.style.boxShadow = `0 10px 26px rgba(0,0,0,0.28), 0 0 18px ${hexToRgba(accentColor, 0.28)}`;
  container.style.fontFamily = "var(--mango-font-family)";
  container.style.pointerEvents = "none";
  container.style.zIndex = "99999";

  const header = document.createElement("div");
  header.textContent = `${title} (${items.length})`;
  header.style.fontSize = "10px";
  header.style.fontWeight = "800";
  header.style.letterSpacing = "0.06em";
  header.style.textTransform = "uppercase";
  header.style.marginBottom = "6px";
  header.style.color = accentColor;
  container.appendChild(header);

  for (const item of visibleItems) {
    const row = document.createElement("div");
    row.textContent = item.label;
    row.style.height = "22px";
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.marginTop = "3px";
    row.style.padding = "0 7px";
    row.style.border = "1px solid rgba(255,255,255,0.12)";
    row.style.borderLeft = `4px solid ${item.color || accentColor}`;
    row.style.background = "rgba(255,255,255,0.08)";
    row.style.fontSize = "11px";
    row.style.fontWeight = "700";
    row.style.whiteSpace = "nowrap";
    row.style.overflow = "hidden";
    row.style.textOverflow = "ellipsis";
    container.appendChild(row);
  }

  if (items.length > visibleItems.length) {
    const more = document.createElement("div");
    more.textContent = `+ ${items.length - visibleItems.length} more`;
    more.style.marginTop = "5px";
    more.style.fontSize = "10px";
    more.style.fontWeight = "800";
    more.style.color = "#fff2e0";
    container.appendChild(more);
  }

  document.body.appendChild(container);
  dataTransfer.setDragImage(container, 18, 18);
  window.setTimeout(() => container.remove(), 0);
}

export function sanitizeExplorerEntityDragPayload(value: unknown): ExplorerEntityDragPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { itemType?: unknown; nodeID?: unknown; itemID?: unknown; label?: unknown; nodes?: unknown };
  // Batch payloads come from Explorer multi-select. Sanitize each item so a
  // malformed row cannot poison the whole drop operation.
  if (candidate.itemType === "node_batch" && Array.isArray(candidate.nodes)) {
    const nodes: ExplorerEntityDragItem[] = [];
    const seen = new Set<string>();
    for (const item of candidate.nodes) {
      if (!item || typeof item !== "object") continue;
      const row = item as { nodeID?: unknown; itemID?: unknown; label?: unknown };
      const rawNodeID = typeof row.nodeID === "string" ? row.nodeID : row.itemID;
      if (typeof rawNodeID !== "string" || rawNodeID.trim() === "") continue;
      const nodeID = rawNodeID.trim();
      if (seen.has(nodeID)) continue;
      seen.add(nodeID);
      const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : nodeID;
      nodes.push({ nodeID, label });
    }
    return nodes.length > 0 ? { itemType: "node_batch", nodes } : null;
  }
  if (!isKanbanBoardDropItemType(candidate.itemType)) return null;
  const rawNodeID = typeof candidate.nodeID === "string" ? candidate.nodeID : candidate.itemID;
  if (typeof rawNodeID !== "string" || rawNodeID.trim() === "") return null;
  const nodeID = rawNodeID.trim();
  const label = typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : nodeID;
  return { itemType: "node", nodeID, label };
}

export function parseExplorerEntityDragPayload(raw: string): ExplorerEntityDragPayload | null {
  try {
    return sanitizeExplorerEntityDragPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function getExplorerEntityDragItems(payload: ExplorerEntityDragPayload | null): ExplorerEntityDragItem[] {
  if (!payload) return [];
  if (payload.itemType === "node_batch") return payload.nodes;
  return [{ nodeID: payload.nodeID, label: payload.label }];
}

export function parseExplorerEntityDragItems(raw: string): ExplorerEntityDragItem[] {
  return getExplorerEntityDragItems(parseExplorerEntityDragPayload(raw));
}

export function serializeExplorerEntityDragPayload(payload: ExplorerEntityDragPayload): string {
  return JSON.stringify(payload);
}

export function parseKanbanCardDragPayload(raw: string): KanbanCardDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as { cardID?: unknown; cardIDs?: unknown; sourceColumnID?: unknown };
    const cardIDs = Array.isArray(parsed.cardIDs)
      ? parsed.cardIDs.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
      : [];
    if (cardIDs.length === 0 && typeof parsed.cardID === "string" && parsed.cardID.trim()) cardIDs.push(parsed.cardID.trim());
    const uniqueCardIDs = Array.from(new Set(cardIDs));
    if (uniqueCardIDs.length === 0) return null;
    if (typeof parsed.sourceColumnID !== "string" || parsed.sourceColumnID.trim() === "") return null;
    return { cardID: uniqueCardIDs[0], cardIDs: uniqueCardIDs, sourceColumnID: parsed.sourceColumnID.trim() };
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
  const target = targetColumnID ? sorted.find((column) => column.column_id === targetColumnID) : null;
  if (placement === "swap") {
    if (!dragged || !target || dragged.column_id === target.column_id) return { columns: sorted, updates: [] };
    const swapped = sorted.map((column) => {
      if (column.column_id === dragged.column_id) return { ...column, position: target.position };
      if (column.column_id === target.column_id) return { ...column, position: dragged.position };
      return column;
    });
    return {
      columns: sortColumns(swapped),
      updates: [
        { columnID: dragged.column_id, position: target.position },
        { columnID: target.column_id, position: dragged.position },
      ],
    };
  }
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

function buildCompactedCardUpdates(cards: KanbanCard[], columnID: string): KanbanCardPositionUpdate[] {
  return cards
    .filter((card) => card.column_id === columnID)
    .map((card, index) => ({ cardID: card.card_id, columnID, position: (index + 1) * 1000 }));
}

export function buildCardReorderPlan(cards: KanbanCard[], draggedCardID: string, targetColumnID: string, targetCardID: string | null = null, placement: KanbanCardDropPlacement = "before"): { cards: KanbanCard[]; updates: KanbanCardPositionUpdate[] } {
  const dragged = cards.find((card) => card.card_id === draggedCardID);
  if (!dragged) return { cards, updates: [] };

  const targetColumnCards = groupCardsByColumn(cards).get(targetColumnID) ?? [];
  const withoutDragged = targetColumnCards.filter((card) => card.card_id !== draggedCardID);
  const targetIndex = targetCardID ? withoutDragged.findIndex((card) => card.card_id === targetCardID) : withoutDragged.length;
  if (targetIndex < 0) return { cards, updates: [] };

  const insertIndex = targetCardID && placement === "after" ? targetIndex + 1 : targetIndex;
  if (dragged.column_id === targetColumnID) {
    const currentIndex = targetColumnCards.findIndex((card) => card.card_id === draggedCardID);
    if (!targetCardID && currentIndex === targetColumnCards.length - 1) return { cards, updates: [] };
  }

  const moved = { ...dragged, column_id: targetColumnID };
  const reorderedTargetCards = [
    ...withoutDragged.slice(0, insertIndex),
    moved,
    ...withoutDragged.slice(insertIndex),
  ];
  const prev = reorderedTargetCards[insertIndex - 1];
  const next = reorderedTargetCards[insertIndex + 1];
  const hasRoomBeforeNext = !next || (prev ? next.position - prev.position > 1 : next.position > 1);

  if (!hasRoomBeforeNext) {
    const compacted = reorderedTargetCards.map((card, index) => ({ ...card, position: (index + 1) * 1000 }));
    const byID = new Map(compacted.map((card) => [card.card_id, card]));
    const updates = buildCompactedCardUpdates(compacted, targetColumnID);
    return {
      cards: cards.map((card) => byID.get(card.card_id) ?? (card.card_id === dragged.card_id ? moved : card)),
      updates,
    };
  }

  const position = prev && next
    ? Math.floor((prev.position + next.position) / 2)
    : prev
      ? prev.position + 1000
      : Math.max(1, (next?.position ?? 1001) - 1000);
  const updated = { ...moved, position };
  return {
    cards: cards.map((card) => (card.card_id === dragged.card_id ? updated : card)),
    updates: [{ cardID: dragged.card_id, columnID: targetColumnID, position }],
  };
}

export function buildCardBatchReorderPlan(cards: KanbanCard[], draggedCardIDs: string[], targetColumnID: string, targetCardID: string | null = null, placement: KanbanCardDropPlacement = "before"): { cards: KanbanCard[]; updates: KanbanCardPositionUpdate[] } {
  const orderedDraggedIDs = Array.from(new Set(draggedCardIDs.map((cardID) => cardID.trim()).filter(Boolean)));
  if (orderedDraggedIDs.length === 0) return { cards, updates: [] };
  if (targetCardID && orderedDraggedIDs.includes(targetCardID)) return { cards, updates: [] };

  if (orderedDraggedIDs.length === 1) {
    return buildCardReorderPlan(cards, orderedDraggedIDs[0], targetColumnID, targetCardID, placement);
  }

  const byCardID = new Map(cards.map((card) => [card.card_id, card]));
  const draggedCards = orderedDraggedIDs.map((cardID) => byCardID.get(cardID)).filter((card): card is KanbanCard => Boolean(card));
  if (draggedCards.length === 0) return { cards, updates: [] };

  const draggedIDSet = new Set(draggedCards.map((card) => card.card_id));
  const remainingCards = cards.filter((card) => !draggedIDSet.has(card.card_id));
  const targetColumnCards = groupCardsByColumn(remainingCards).get(targetColumnID) ?? [];
  const targetIndex = targetCardID ? targetColumnCards.findIndex((card) => card.card_id === targetCardID) : targetColumnCards.length;
  if (targetIndex < 0) return { cards, updates: [] };

  const insertIndex = targetCardID && placement === "after" ? targetIndex + 1 : targetIndex;
  const movedCards = draggedCards.map((card) => ({ ...card, column_id: targetColumnID }));
  const reorderedTargetCards = [
    ...targetColumnCards.slice(0, insertIndex),
    ...movedCards,
    ...targetColumnCards.slice(insertIndex),
  ];
  const movedCount = movedCards.length;
  const prev = reorderedTargetCards[insertIndex - 1];
  const next = reorderedTargetCards[insertIndex + movedCount];
  const updatedByID = new Map<string, KanbanCard>();

  const applySparsePositions = (positions: number[]): KanbanCardPositionUpdate[] => {
    return movedCards.map((card, index) => {
      const updated = { ...card, position: positions[index] };
      updatedByID.set(card.card_id, updated);
      return { cardID: card.card_id, columnID: targetColumnID, position: updated.position };
    });
  };

  let updates: KanbanCardPositionUpdate[];
  if (prev && next && next.position - prev.position > movedCount) {
    const step = Math.floor((next.position - prev.position) / (movedCount + 1));
    updates = applySparsePositions(movedCards.map((_, index) => prev.position + step * (index + 1)));
  } else if (prev && !next) {
    updates = applySparsePositions(movedCards.map((_, index) => prev.position + 1000 * (index + 1)));
  } else if (!prev && next && next.position > movedCount) {
    const step = Math.floor(next.position / (movedCount + 1));
    updates = applySparsePositions(movedCards.map((_, index) => step * (index + 1)));
  } else {
    updates = reorderedTargetCards.map((card, index) => {
      const updated = { ...card, column_id: targetColumnID, position: (index + 1) * 1000 };
      updatedByID.set(card.card_id, updated);
      return { cardID: card.card_id, columnID: targetColumnID, position: updated.position };
    });
  }

  return {
    cards: cards.map((card) => updatedByID.get(card.card_id) ?? card),
    updates,
  };
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

function normalizeKanbanStatusLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function shouldRefreshKanbanBoardForNodeStatusChange(args: {
  node: KanbanStatusNode;
  columns: Pick<KanbanColumn, "column_id" | "title">[];
  cards: Pick<KanbanCard, "node_id" | "column_id" | "is_issue">[];
}): boolean {
  const nodeID = args.node.node_id.trim();
  if (!nodeID) return false;
  const visibleCards = args.cards.filter((card) => card.node_id === nodeID);
  if (visibleCards.length === 0) return false;

  const status = normalizeKanbanStatusLabel(args.node.status);
  if (!status) return false;
  if (status === "issue") return visibleCards.some((card) => !card.is_issue);

  const targetColumn = args.columns.find((column) => normalizeKanbanStatusLabel(column.title) === status);
  if (!targetColumn) return false;
  return visibleCards.some((card) => card.column_id !== targetColumn.column_id || card.is_issue);
}

function kanbanStatusGroupFromColumn(column: Pick<KanbanColumn, "title" | "position">): KanbanGroupedBoardRow {
  const label = column.title.trim() || "No status";
  return { key: `status:${label.toLowerCase()}`, label, sortValue: column.position };
}

function getKanbanPriorityGroupLabel(priority: number): string {
  if (priority === 1) return "1 Low Priority";
  if (priority === 2) return "2 Medium-Low Priority";
  if (priority === 3) return "3 Medium Priority";
  if (priority === 4) return "4 High Priority";
  if (priority === 5) return "5 URGENT";
  return "0 Unassigned";
}

export function getKanbanGroupValue(
  card: KanbanCard,
  field: KanbanGroupField,
  columnByID: ReadonlyMap<string, Pick<KanbanColumn, "title" | "position">>,
  nodeByID: ReadonlyMap<string, KanbanGroupNode>,
  userByID: ReadonlyMap<string, KanbanGroupUser>,
): KanbanGroupedBoardRow {
  const node = nodeByID.get(card.node_id);
  if (field === "status") {
    if (card.is_issue) return { key: "issue", label: "Issue", sortValue: Number.MAX_SAFE_INTEGER };
    const column = columnByID.get(card.column_id);
    return column ? kanbanStatusGroupFromColumn(column) : { key: "status:no-status", label: "No status", sortValue: Number.MAX_SAFE_INTEGER - 1 };
  }
  if (field === "person") {
    const assignee = node?.assignee_user_id?.trim();
    if (!assignee) return { key: "person:unassigned", label: "Unassigned", sortValue: "" };
    const user = userByID.get(assignee);
    const name = user?.display_name?.trim();
    const email = user?.email?.trim();
    const label = name || email || assignee;
    return { key: `person:${assignee}`, label, sortValue: label.toLowerCase() };
  }
  if (field === "priority") {
    const priority = node?.priority ?? 0;
    const normalized = priority > 0 ? Math.max(1, Math.min(5, Math.round(priority))) : 0;
    return { key: `priority:${normalized}`, label: getKanbanPriorityGroupLabel(normalized), sortValue: normalized };
  }
  const dueDate = node?.due_date?.trim();
  return dueDate ? { key: `due:${dueDate}`, label: dueDate, sortValue: dueDate } : { key: "due:none", label: "No due date", sortValue: "", sortLast: true };
}

function addUniqueKanbanGroup(target: KanbanGroupedBoardRow[], seen: Set<string>, group: KanbanGroupedBoardRow): void {
  if (seen.has(group.key)) return;
  seen.add(group.key);
  target.push(group);
}

function seedKanbanGroupsForField(field: KanbanGroupField, columns: KanbanColumn[]): KanbanGroupedBoardRow[] {
  if (field !== "status") return [];
  const groups: KanbanGroupedBoardRow[] = [];
  const seen = new Set<string>();
  for (const column of sortColumns(columns)) {
    addUniqueKanbanGroup(groups, seen, kanbanStatusGroupFromColumn(column));
  }
  return groups;
}

function compareKanbanGroups(a: KanbanGroupedBoardRow, b: KanbanGroupedBoardRow): number {
  if (typeof a.sortValue === "number" && typeof b.sortValue === "number") {
    return a.sortValue - b.sortValue || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
  }
  return String(a.sortValue).localeCompare(String(b.sortValue), undefined, { numeric: true, sensitivity: "base" }) || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
}

function sortKanbanGroups(groups: KanbanGroupedBoardRow[], direction: KanbanGroupSortDirection): KanbanGroupedBoardRow[] {
  const regularGroups = groups.filter((group) => !group.sortLast).sort(compareKanbanGroups);
  const trailingGroups = groups.filter((group) => group.sortLast).sort(compareKanbanGroups);
  return direction === "desc" ? [...regularGroups.reverse(), ...trailingGroups] : [...regularGroups, ...trailingGroups];
}

export function buildKanbanGroupedBoardLayout(args: {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  xGroupBy: KanbanGroupField;
  yGroupBy: KanbanGroupField;
  xSortDirection?: KanbanGroupSortDirection;
  ySortDirection?: KanbanGroupSortDirection;
  nodeByID: ReadonlyMap<string, KanbanGroupNode>;
  userByID: ReadonlyMap<string, KanbanGroupUser>;
}): KanbanGroupedBoardLayout {
  const orderedColumns = sortColumns(args.columns);
  const columnByID = new Map(orderedColumns.map((column) => [column.column_id, column]));
  const orderedCardByID = new Map(args.cards.map((card) => [card.card_id, card]));
  const orderedCards = getOrderedKanbanCardIDs(orderedColumns, args.cards)
    .map((cardID) => orderedCardByID.get(cardID))
    .filter((card): card is KanbanCard => Boolean(card));
  const columns = seedKanbanGroupsForField(args.xGroupBy, orderedColumns);
  const rows = seedKanbanGroupsForField(args.yGroupBy, orderedColumns);
  const seenColumns = new Set(columns.map((column) => column.key));
  const seenRows = new Set(rows.map((row) => row.key));
  const cardsByColumnAndRow = new Map<string, Map<string, KanbanCard[]>>();

  for (const card of orderedCards) {
    const column = getKanbanGroupValue(card, args.xGroupBy, columnByID, args.nodeByID, args.userByID);
    const row = getKanbanGroupValue(card, args.yGroupBy, columnByID, args.nodeByID, args.userByID);
    addUniqueKanbanGroup(columns, seenColumns, column);
    addUniqueKanbanGroup(rows, seenRows, row);
    const rowMap = cardsByColumnAndRow.get(column.key) ?? new Map<string, KanbanCard[]>();
    const list = rowMap.get(row.key) ?? [];
    list.push(card);
    rowMap.set(row.key, list);
    cardsByColumnAndRow.set(column.key, rowMap);
  }

  const sortedColumns = sortKanbanGroups(columns, args.xSortDirection ?? "asc");
  const sortedRows = sortKanbanGroups(rows, args.ySortDirection ?? "asc");

  return {
    columns: sortedColumns.map((column) => {
      const rowMap = cardsByColumnAndRow.get(column.key) ?? new Map<string, KanbanCard[]>();
      return {
        ...column,
        cells: sortedRows.map((row) => ({ rowKey: row.key, cards: rowMap.get(row.key) ?? [] })),
      };
    }),
    rows: sortedRows,
  };
}

export function getOrderedKanbanCardIDs(columns: KanbanColumn[], cards: KanbanCard[]): string[] {
  const grouped = groupCardsByColumn(cards);
  const ordered: string[] = [];
  for (const column of sortColumns(columns)) {
    for (const card of grouped.get(column.column_id) ?? []) {
      ordered.push(card.card_id);
    }
  }
  return ordered;
}

// Match the visual board order instead of DOM order so Shift selection works the
// same way for UI users and headless callers that reuse this helper in tests.
export function buildKanbanCardSelectionUpdate(args: {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  selectedCardIDs: Set<string>;
  anchorCardID: string;
  clickedCardID: string;
  shiftKey?: boolean;
  additiveKey?: boolean;
}): KanbanCardSelectionUpdate {
  const orderedIDs = getOrderedKanbanCardIDs(args.columns, args.cards);
  if (!orderedIDs.includes(args.clickedCardID)) {
    return { selectedCardIDs: new Set(args.selectedCardIDs), anchorCardID: args.anchorCardID };
  }

  if (args.shiftKey && args.anchorCardID && orderedIDs.includes(args.anchorCardID)) {
    const anchorIndex = orderedIDs.indexOf(args.anchorCardID);
    const clickedIndex = orderedIDs.indexOf(args.clickedCardID);
    const [start, end] = anchorIndex <= clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
    const range = orderedIDs.slice(start, end + 1);
    const selected = new Set(args.selectedCardIDs);
    for (const cardID of range) selected.add(cardID);
    return { selectedCardIDs: new Set(orderedIDs.filter((cardID) => selected.has(cardID))), anchorCardID: args.anchorCardID };
  }

  if (args.additiveKey) {
    const selected = new Set(args.selectedCardIDs);
    if (selected.has(args.clickedCardID)) selected.delete(args.clickedCardID);
    else selected.add(args.clickedCardID);
    return { selectedCardIDs: new Set(orderedIDs.filter((cardID) => selected.has(cardID))), anchorCardID: args.clickedCardID };
  }

  return { selectedCardIDs: new Set([args.clickedCardID]), anchorCardID: args.clickedCardID };
}

export function getKanbanConditionalColor(card: KanbanCard, columnColorByID: Map<string, string> = new Map()): string {
  if (card.is_issue) return KANBAN_ISSUE_CARD_COLOR;
  const columnColor = columnColorByID.get(card.column_id);
  if (isKanbanColumnItemColor(columnColor)) return columnColor;

  const palette = ["#fbb152", "#fea94e", "#fe9b46", "#ff8820"];
  const value = card.node_id || card.column_id || "empty";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function getKanbanCardColorRailStyle(color: string): React.CSSProperties {
  return {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 5,
    background: isKanbanColumnItemColor(color) ? color : KANBAN_DEFAULT_COLUMN_ITEM_COLOR,
    pointerEvents: "none",
  };
}
