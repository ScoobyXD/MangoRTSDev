import type React from "react";
import { humanLabelOrFallback, isLikelyOpaqueEntityID } from "../entityLabels.js";

export const EXPLORER_ENTITY_DRAG_MIME = "application/x-mango-explorer-entity";
export const KANBAN_CARD_DRAG_MIME = "application/x-mango-kanban-card";
export const KANBAN_COLUMN_DRAG_MIME = "application/x-mango-kanban-column";
export const EVENT_KANBAN_BOARDS_UPDATED = "mangorts:kanban-boards-updated";
export const EVENT_KANBAN_BOARD_CONTENTS_UPDATED = "mangorts:kanban-board-contents-updated";
export const KANBAN_COLUMN_TITLE_TEXT_TRANSFORM = "none";
export const KANBAN_MODULE_TOP_CLEARANCE_PX = 38;
export const KANBAN_DEFAULT_COLUMN_WIDTH_PX = 260;
export const KANBAN_MIN_COLUMN_WIDTH_PX = 180;
export const KANBAN_MAX_COLUMN_WIDTH_PX = 2000;
export const KANBAN_DEFAULT_COLUMN_HEIGHT_PX = 240;
export const KANBAN_ARENA_DEFAULT_COLUMN_HEIGHT_PX = KANBAN_DEFAULT_COLUMN_HEIGHT_PX * 3;
export const KANBAN_MIN_COLUMN_HEIGHT_PX = 160;
export const KANBAN_MAX_COLUMN_HEIGHT_PX = 10000;
export const KANBAN_DEFAULT_COLUMN_ITEM_COLOR = "#475569";
export const KANBAN_DEFAULT_BOARD_TITLE = "Kanban board";
export const KANBAN_LOGIC_GATE_BACKLOG_COLOR = "#8b5cf6";
export const KANBAN_LOGIC_GATE_PENDING_COLOR = "#6f7b8a";
export const KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR = "#f08a24";
export const KANBAN_LOGIC_GATE_VERIFY_COLOR = "#19a8ff";
export const KANBAN_LOGIC_GATE_DONE_COLOR = "#19c879";
export const KANBAN_ISSUE_CARD_COLOR = "#7c6ee6";

const KANBAN_COLUMN_ITEM_COLOR_SET = new Set([
  "#334155",
  "#475569",
  "#64748b",
  "#808080",
  KANBAN_DEFAULT_COLUMN_ITEM_COLOR,
  KANBAN_LOGIC_GATE_BACKLOG_COLOR,
  KANBAN_LOGIC_GATE_PENDING_COLOR,
  KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR,
  KANBAN_LOGIC_GATE_VERIFY_COLOR,
  KANBAN_LOGIC_GATE_DONE_COLOR,
  KANBAN_ISSUE_CARD_COLOR,
].map((color) => color.toLowerCase()));

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

export type KanbanBoardContentsUpdatedDetail = {
  companyID?: string;
  boardID: string;
  logicGateID?: string;
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
  due_date?: string | null;
  priority?: number | null;
  assignee_user_id?: string | null;
  assignee_name?: string | null;
  assignee_email?: string | null;
  projection_updated_timestamp?: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type KanbanCardNodeMetadata = {
  node_id: string;
  due_date?: string | null;
  priority?: number | null;
  assignee_user_id?: string | null;
  assignee_name?: string | null;
  assignee_email?: string | null;
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
  nodes?: KanbanCardNodeMetadata[];
  cards_limit: number;
  projection_sequence?: number;
};

export function hydrateKanbanCardsFromNodes(cards: KanbanCard[], nodes: KanbanCardNodeMetadata[] = []): KanbanCard[] {
  if (nodes.length === 0 || cards.length === 0) return cards;
  const nodeByID = new Map(nodes.map((node) => [node.node_id, node]));
  return cards.map((card) => {
    const node = nodeByID.get(card.node_id);
    if (!node) return card;
    return {
      ...card,
      due_date: card.due_date ?? node.due_date ?? null,
      priority: card.priority ?? node.priority ?? null,
      assignee_user_id: card.assignee_user_id ?? node.assignee_user_id ?? null,
      assignee_name: card.assignee_name ?? node.assignee_name ?? null,
      assignee_email: card.assignee_email ?? node.assignee_email ?? null,
    };
  });
}

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

export type KanbanGroupDropAssignment = {
  columnID?: string;
  isIssue?: boolean;
  assigneeUserID?: string | null;
  priority?: number | null;
  dueDate?: string | null;
};

export const KANBAN_GROUP_FIELDS: Array<{ value: KanbanGroupField; label: string }> = [
  { value: "status", label: "Status" },
  { value: "person", label: "Person" },
  { value: "priority", label: "Priority" },
  { value: "due_date", label: "Due Date" },
];

const DEFAULT_KANBAN_Y_AXIS_SORT_DIRECTION: Record<KanbanGroupField, KanbanGroupSortDirection> = {
  status: "asc",
  person: "asc",
  priority: "asc",
  due_date: "asc",
};

export function getDefaultKanbanYAxisSortDirection(field: KanbanGroupField): KanbanGroupSortDirection {
  return DEFAULT_KANBAN_Y_AXIS_SORT_DIRECTION[field];
}

export function isKanbanBoardDropItemType(value: unknown): value is "node" {
  return value === "node";
}

export function isKanbanColumnItemColor(value: unknown): value is string {
  return typeof value === "string" && KANBAN_COLUMN_ITEM_COLOR_SET.has(value.trim().toLowerCase());
}

export function normalizeKanbanColumnItemColor(value: unknown): string {
  return isKanbanColumnItemColor(value) ? value.trim().toLowerCase() : KANBAN_DEFAULT_COLUMN_ITEM_COLOR;
}

export function getKanbanStatusColumnColor(title: string): string | null {
  const normalized = title.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (normalized === "backlog" || normalized === "backlogs") return KANBAN_LOGIC_GATE_BACKLOG_COLOR;
  if (normalized === "pending") return KANBAN_LOGIC_GATE_PENDING_COLOR;
  if (normalized === "in progress") return KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR;
  if (normalized === "verify" || normalized === "verification") return KANBAN_LOGIC_GATE_VERIFY_COLOR;
  if (normalized === "done" || normalized === "complete" || normalized === "completed") return KANBAN_LOGIC_GATE_DONE_COLOR;
  return null;
}

export function getKanbanColumnDisplayColor(column: Pick<KanbanColumn, "title" | "item_color">): string {
  return getKanbanStatusColumnColor(column.title) ?? normalizeKanbanColumnItemColor(column.item_color);
}

export function isKanbanBacklogColumn(column: Pick<KanbanColumn, "column_id" | "title">): boolean {
  const normalizedColumnID = column.column_id.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  const normalizedTitle = column.title.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return normalizedColumnID === "backlog" || normalizedColumnID === "backlogs" || normalizedTitle === "backlog" || normalizedTitle === "backlogs";
}

export function getKanbanBoardDisplayTitle(board: Pick<KanbanBoard, "board_id" | "title" | "logic_gate_id">): string {
  const logicGateID = board.logic_gate_id?.trim() || logicGateIDFromKanbanBoardID(board.board_id);
  const title = board.title.trim();
  if (title && (!logicGateID || (title !== logicGateID && title !== logicGateKanbanBoardID(logicGateID) && !isLikelyOpaqueEntityID(title)))) return title;
  if (logicGateID) return "Logic Gate";
  return humanLabelOrFallback(board.board_id, KANBAN_DEFAULT_BOARD_TITLE);
}

export function logicGateKanbanBoardID(logicGateID: string): string {
  return `logic-gate:${logicGateID.trim()}`;
}

export function logicGateIDFromKanbanBoardID(boardID: string): string {
  const prefix = "logic-gate:";
  const trimmed = boardID.trim();
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : "";
}

export function createClientUUIDv7(now: () => number = () => Date.now(), randomValues?: (bytes: Uint8Array) => Uint8Array): string {
  const bytes = new Uint8Array(16);
  const fillRandom = randomValues ?? globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  if (fillRandom) {
    fillRandom(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }

  const timestamp = BigInt(Math.max(0, Math.floor(now()))) & 0xffffffffffffn;
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}

export function sortKanbanBoards(boards: KanbanBoard[]): KanbanBoard[] {
  return [...boards].sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp) || a.board_id.localeCompare(b.board_id));
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return `rgba(100,116,139,${alpha})`;
  const value = Number.parseInt(clean, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red},${green},${blue},${alpha})`;
}

export function attachStackedDragPreview(dataTransfer: DataTransfer, items: KanbanDragPreviewItem[], _accentColor: string, title: string): void {
  if (typeof document === "undefined" || items.length === 0) return;
  const iconKind = /logic gate/i.test(title) ? "logic_gate" : "node";
  const layerCount = Math.min(3, items.length);
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "-1000px";
  container.style.left = "-1000px";
  container.style.width = "56px";
  container.style.height = "56px";
  container.style.opacity = "0.72";
  container.style.filter = "grayscale(1) drop-shadow(0 12px 18px rgba(15, 23, 42, 0.26))";
  container.style.pointerEvents = "none";
  container.style.zIndex = "99999";

  for (let index = layerCount - 1; index >= 0; index -= 1) {
    const ghost = document.createElement("div");
    ghost.style.position = "absolute";
    ghost.style.left = `${index * 5}px`;
    ghost.style.top = `${index * 4}px`;
    ghost.style.width = "46px";
    ghost.style.height = "46px";
    ghost.style.display = "grid";
    ghost.style.placeItems = "center";
    ghost.style.border = "1px solid rgba(100, 116, 139, 0.32)";
    ghost.style.borderRadius = "8px";
    ghost.style.background = "rgba(248, 250, 252, 0.78)";
    ghost.style.color = "rgba(51, 65, 85, 0.72)";
    ghost.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.82), 0 6px 12px rgba(15, 23, 42, 0.12)";
    ghost.innerHTML = iconKind === "logic_gate" ? logicGateDragPreviewIcon() : nodeDragPreviewIcon();
    container.appendChild(ghost);
  }

  document.body.appendChild(container);
  dataTransfer.setDragImage(container, 24, 24);
  window.setTimeout(() => container.remove(), 0);
}

function nodeDragPreviewIcon(): string {
  return `<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M7 3.5h7.25L18 7.25V20.5H7z" fill="rgba(255,255,255,0.58)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M14.25 3.5v4h4" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M9.7 12h5.2M9.7 15h5.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}

function logicGateDragPreviewIcon(): string {
  return `<svg aria-hidden="true" width="26" height="24" viewBox="0 0 26 24" fill="none">
    <path d="M2.5 12h4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M19.3 12h4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M7 6h6.1a6 6 0 0 1 0 12H7z" fill="rgba(255,255,255,0.58)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
  </svg>`;
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
  if (priority === 1) return "1\u00A0\u00A0URGENT(<1hr)";
  if (priority === 2) return "2\u00A0\u00A0By end of day";
  if (priority === 3) return "3\u00A0\u00A0Tomorrow";
  if (priority === 4) return "4\u00A0\u00A0Sprint (1 week)";
  if (priority === 5) return "5\u00A0\u00A0Later (low priority)";
  return "No priority";
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
    const assignee = (card.assignee_user_id ?? node?.assignee_user_id ?? "").trim();
    if (!assignee) return { key: "person:unassigned", label: "Unassigned", sortValue: "" };
    const user = userByID.get(assignee);
    const name = user?.display_name?.trim() || card.assignee_name?.trim();
    const email = user?.email?.trim() || card.assignee_email?.trim();
    const label = name || email || assignee;
    return { key: `person:${assignee}`, label, sortValue: label.toLowerCase() };
  }
  if (field === "priority") {
    const priority = card.priority ?? node?.priority ?? 0;
    const normalized = priority > 0 ? Math.max(1, Math.min(5, Math.round(priority))) : 0;
    return { key: `priority:${normalized}`, label: getKanbanPriorityGroupLabel(normalized), sortValue: normalized, sortLast: normalized === 0 };
  }
  const dueDate = (card.due_date ?? node?.due_date ?? "").trim();
  return dueDate ? { key: `due:${dueDate}`, label: dueDate, sortValue: dueDate } : { key: "due:none", label: "No due date", sortValue: "", sortLast: true };
}

function applyKanbanGroupDropField(target: KanbanGroupDropAssignment, field: KanbanGroupField, groupKey: string, columns: KanbanColumn[]): void {
  if (field === "status") {
    if (groupKey === "issue") {
      target.isIssue = true;
      return;
    }
    if (groupKey === "status:no-status") return;
    const column = sortColumns(columns).find((item) => kanbanStatusGroupFromColumn(item).key === groupKey);
    if (!column) return;
    target.columnID = column.column_id;
    target.isIssue = false;
    return;
  }
  if (field === "person") {
    if (groupKey === "person:unassigned") {
      target.assigneeUserID = null;
      return;
    }
    if (!groupKey.startsWith("person:")) return;
    const assigneeUserID = groupKey.slice("person:".length).trim();
    if (assigneeUserID) target.assigneeUserID = assigneeUserID;
    return;
  }
  if (field === "priority") {
    if (!groupKey.startsWith("priority:")) return;
    const priority = Number(groupKey.slice("priority:".length));
    if (!Number.isFinite(priority)) return;
    const normalized = Math.max(0, Math.min(5, Math.round(priority)));
    target.priority = normalized > 0 ? normalized : null;
    return;
  }
  if (groupKey === "due:none") {
    target.dueDate = null;
    return;
  }
  if (groupKey.startsWith("due:")) {
    target.dueDate = groupKey.slice("due:".length).trim() || null;
  }
}

export function resolveKanbanGroupDropAssignment(args: {
  columns: KanbanColumn[];
  xGroupBy: KanbanGroupField;
  xGroupKey: string;
  yGroupBy: KanbanGroupField;
  yGroupKey: string;
}): KanbanGroupDropAssignment {
  const assignment: KanbanGroupDropAssignment = {};
  applyKanbanGroupDropField(assignment, args.xGroupBy, args.xGroupKey, args.columns);
  applyKanbanGroupDropField(assignment, args.yGroupBy, args.yGroupKey, args.columns);
  return assignment;
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

  const palette = [KANBAN_LOGIC_GATE_BACKLOG_COLOR, KANBAN_LOGIC_GATE_PENDING_COLOR, KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR, KANBAN_LOGIC_GATE_VERIFY_COLOR, KANBAN_LOGIC_GATE_DONE_COLOR];
  const value = card.node_id || card.column_id || "empty";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function getKanbanCardColorRailStyle(color: string): React.CSSProperties {
  const cleanColor = isKanbanColumnItemColor(color) ? color : KANBAN_DEFAULT_COLUMN_ITEM_COLOR;
  return {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 6,
    background: `linear-gradient(180deg, ${hexToRgba(cleanColor, 0.96)}, ${hexToRgba(cleanColor, 0.58)})`,
    boxShadow: `0 0 12px ${hexToRgba(cleanColor, 0.22)}`,
    pointerEvents: "none",
  };
}
