export const EXPLORER_ENTITY_DRAG_MIME = "application/x-mango-explorer-entity";
export const KANBAN_CARD_DRAG_MIME = "application/x-mango-kanban-card";

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
