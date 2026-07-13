import type { CommittedEntityTitleUpdate } from "../company-explorer/companyExplorerLocalEntityUpdates.js";
import { logicGateIDFromKanbanBoardID, type KanbanBoard, type KanbanCard } from "./shared.js";

export const KANBAN_REALTIME_LOCAL_ECHO_COALESCE_MS = 750;
export const KANBAN_REALTIME_REFRESH_DEBOUNCE_MS = 80;

export function kanbanRealtimeCanonicalRefreshDelayMs(
  now: number,
  lastLocalMutationAt: number,
  pendingLocalMutations: number,
): number {
  if (pendingLocalMutations > 0) return KANBAN_REALTIME_REFRESH_DEBOUNCE_MS;
  if (lastLocalMutationAt <= 0) return 0;
  const elapsed = Math.max(0, now - lastLocalMutationAt);
  return Math.max(0, KANBAN_REALTIME_LOCAL_ECHO_COALESCE_MS - elapsed);
}
export type KanbanAccountAssignmentTitleState = {
  nodeID: string;
  nodeTitle: string;
};

export function applyCommittedNodeTitleToKanbanAccountAssignment<T extends KanbanAccountAssignmentTitleState>(
  current: T | null,
  resourceID: string,
  title: string,
): T | null {
  if (!current || current.nodeID !== resourceID || current.nodeTitle === title) return current;
  return { ...current, nodeTitle: title };
}

export function reconcileCommittedKanbanCardTitles(
  cards: KanbanCard[],
  update: CommittedEntityTitleUpdate,
): KanbanCard[] {
  if (update.entityType !== "node") return cards;
  const resourceID = update.resourceID.trim();
  const title = update.title.trim();
  if (!resourceID || !title) return cards;
  let changed = false;
  const next = cards.map((card) => {
    if (card.node_id !== resourceID || card.node_title === title) return card;
    changed = true;
    return { ...card, node_title: title };
  });
  return changed ? next : cards;
}

export function reconcileCommittedKanbanBoardTitles(
  boards: KanbanBoard[],
  update: CommittedEntityTitleUpdate,
): KanbanBoard[] {
  if (update.entityType !== "logic_gate") return boards;
  const resourceID = update.resourceID.trim();
  const title = update.title.trim();
  if (!resourceID || !title) return boards;
  let changed = false;
  const next = boards.map((board) => {
    const logicGateID = board.logic_gate_id?.trim() || logicGateIDFromKanbanBoardID(board.board_id);
    if (logicGateID !== resourceID || board.title === title) return board;
    changed = true;
    return { ...board, title };
  });
  return changed ? next : boards;
}

export function reconcileCommittedKanbanLogicGateLabel(
  current: string,
  logicGateID: string,
  update: CommittedEntityTitleUpdate,
): string {
  if (update.entityType !== "logic_gate" || update.resourceID.trim() !== logicGateID.trim()) return current;
  const title = update.title.trim();
  return title || current;
}
