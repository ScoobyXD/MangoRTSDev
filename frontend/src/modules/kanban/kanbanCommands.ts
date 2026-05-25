import {
  assignNodeToLogicGateStatus,
  createKanbanColumn,
  deleteKanbanCard,
  deleteKanbanColumn,
  moveKanbanCard,
  moveLogicGateAssignment,
  removeLogicGateAssignment,
  setLogicGateAssignmentIssue,
  updateKanbanColumn,
  upsertKanbanCard,
} from "./kanbanApi.js";
import {
  KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
  KANBAN_DEFAULT_COLUMN_WIDTH_PX,
  buildCardBatchReorderPlan,
  buildColumnReorderPlan,
  nextCardPosition,
  nextColumnPosition,
  normalizeKanbanColumnItemColor,
  logicGateIDFromKanbanBoardID,
  type ExplorerEntityDragItem,
  type KanbanCard,
  type KanbanCardDropPlacement,
  type KanbanCardPositionUpdate,
  type KanbanColumn,
  type KanbanColumnDropPlacement,
  type KanbanColumnPositionUpdate,
} from "./shared.js";

export type KanbanCommandContext = {
  apiBase: string;
  companyID: string;
  boardID: string;
};

export type KanbanCommandClient = {
  assignNodeToLogicGateStatus: typeof assignNodeToLogicGateStatus;
  createColumn: typeof createKanbanColumn;
  updateColumn: typeof updateKanbanColumn;
  deleteColumn: typeof deleteKanbanColumn;
  moveCard: typeof moveKanbanCard;
  upsertCard: typeof upsertKanbanCard;
  deleteCard: typeof deleteKanbanCard;
  moveLogicGateAssignment: typeof moveLogicGateAssignment;
  removeLogicGateAssignment: typeof removeLogicGateAssignment;
  setLogicGateAssignmentIssue: typeof setLogicGateAssignmentIssue;
};

const defaultKanbanCommandClient: KanbanCommandClient = {
  assignNodeToLogicGateStatus,
  createColumn: createKanbanColumn,
  updateColumn: updateKanbanColumn,
  deleteColumn: deleteKanbanColumn,
  moveCard: moveKanbanCard,
  upsertCard: upsertKanbanCard,
  deleteCard: deleteKanbanCard,
  moveLogicGateAssignment,
  removeLogicGateAssignment,
  setLogicGateAssignmentIssue,
};

function logicGateIDForCard(context: KanbanCommandContext, card?: Pick<KanbanCard, "logic_gate_id" | "board_id"> | null): string {
  return (card?.logic_gate_id ?? "").trim() || logicGateIDFromKanbanBoardID(card?.board_id ?? context.boardID);
}

export async function createKanbanColumnCommand(args: {
  context: KanbanCommandContext;
  columns: KanbanColumn[];
  title?: string;
  client?: KanbanCommandClient;
}): Promise<KanbanColumn> {
  const { context, columns, title = "New Column Name", client = defaultKanbanCommandClient } = args;
  return client.createColumn(
    context.apiBase,
    context.companyID,
    context.boardID,
    title,
    nextColumnPosition(columns),
    KANBAN_DEFAULT_COLUMN_WIDTH_PX,
    KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
  );
}

export async function renameKanbanColumnCommand(args: {
  context: KanbanCommandContext;
  columns: KanbanColumn[];
  columnID: string;
  title: string;
  client?: KanbanCommandClient;
}): Promise<KanbanColumn | null> {
  const { context, columns, columnID, client = defaultKanbanCommandClient } = args;
  const cleanTitle = args.title.trim();
  if (!cleanTitle || !columns.some((column) => column.column_id === columnID)) return null;
  return client.updateColumn({
    apiBase: context.apiBase,
    companyID: context.companyID,
    boardID: context.boardID,
    columnID,
    title: cleanTitle,
  });
}

export async function deleteKanbanColumnCommand(args: {
  context: KanbanCommandContext;
  columnID: string;
  client?: KanbanCommandClient;
}): Promise<void> {
  const { context, columnID, client = defaultKanbanCommandClient } = args;
  await client.deleteColumn(context.apiBase, context.companyID, context.boardID, columnID);
}

export async function persistKanbanColumnLayoutCommand(args: {
  context: KanbanCommandContext;
  columnID: string;
  widthPx?: number;
  heightPx?: number;
  itemColor?: string;
  client?: KanbanCommandClient;
}): Promise<KanbanColumn> {
  const { context, columnID, client = defaultKanbanCommandClient } = args;
  return client.updateColumn({
    apiBase: context.apiBase,
    companyID: context.companyID,
    boardID: context.boardID,
    columnID,
    widthPx: args.widthPx,
    heightPx: args.heightPx,
    itemColor: args.itemColor === undefined ? undefined : normalizeKanbanColumnItemColor(args.itemColor),
  });
}

export async function reorderKanbanColumnsCommand(args: {
  context: KanbanCommandContext;
  columns: KanbanColumn[];
  draggedColumnID: string;
  targetColumnID: string | null;
  placement?: KanbanColumnDropPlacement;
  onOptimisticColumns?: (columns: KanbanColumn[]) => void;
  client?: KanbanCommandClient;
}): Promise<{
  columns: KanbanColumn[];
  updates: KanbanColumnPositionUpdate[];
  persistedColumns: KanbanColumn[];
}> {
  const { context, columns, draggedColumnID, targetColumnID, placement = "before", onOptimisticColumns, client = defaultKanbanCommandClient } = args;
  const plan = buildColumnReorderPlan(columns, draggedColumnID, targetColumnID, placement);
  if (plan.updates.length === 0) return { columns: plan.columns, updates: [], persistedColumns: [] };
  onOptimisticColumns?.(plan.columns);
  const persistedColumns = await Promise.all(plan.updates.map((update) => client.updateColumn({
    apiBase: context.apiBase,
    companyID: context.companyID,
    boardID: context.boardID,
    columnID: update.columnID,
    position: update.position,
  })));
  return { columns: plan.columns, updates: plan.updates, persistedColumns };
}

export async function reorderKanbanCardsCommand(args: {
  context: KanbanCommandContext;
  cards: KanbanCard[];
  cardIDs: string[];
  columnID: string;
  targetCardID?: string | null;
  placement?: KanbanCardDropPlacement;
  onOptimisticCards?: (cards: KanbanCard[]) => void;
  client?: KanbanCommandClient;
}): Promise<{
  cards: KanbanCard[];
  updates: KanbanCardPositionUpdate[];
  persistedCards: KanbanCard[];
}> {
  const { context, cards, cardIDs, columnID, targetCardID = null, placement = "before", onOptimisticCards, client = defaultKanbanCommandClient } = args;
  const plan = buildCardBatchReorderPlan(cards, cardIDs, columnID, targetCardID, placement);
  if (plan.updates.length === 0) return { cards: plan.cards, updates: [], persistedCards: [] };
  onOptimisticCards?.(plan.cards);
  const cardByID = new Map(cards.map((card) => [card.card_id, card]));
  const persistedCards = await Promise.all(plan.updates.map(async (update) => {
    const card = cardByID.get(update.cardID);
    const logicGateID = logicGateIDForCard(context, card);
    if (card && logicGateID) {
      const result = await client.moveLogicGateAssignment({
        apiBase: context.apiBase,
        companyID: context.companyID,
        logicGateID,
        nodeID: card.node_id,
        columnID: update.columnID,
        position: update.position,
      });
      return result.card;
    }
    return client.moveCard({
      apiBase: context.apiBase,
      companyID: context.companyID,
      boardID: context.boardID,
      cardID: update.cardID,
      columnID: update.columnID,
      position: update.position,
    });
  }));
  return { cards: plan.cards, updates: plan.updates, persistedCards };
}

function dedupeExplorerItems(items: ExplorerEntityDragItem[]): ExplorerEntityDragItem[] {
  const dedupedItems: ExplorerEntityDragItem[] = [];
  const seenNodeIDs = new Set<string>();
  for (const item of items) {
    const nodeID = item.nodeID.trim();
    if (!nodeID || seenNodeIDs.has(nodeID)) continue;
    seenNodeIDs.add(nodeID);
    dedupedItems.push({ nodeID, label: item.label.trim() || nodeID });
  }
  return dedupedItems;
}

export async function addExplorerNodesToKanbanColumnCommand(args: {
  context: KanbanCommandContext;
  cards: KanbanCard[];
  columnID: string;
  items: ExplorerEntityDragItem[];
  priority?: number;
  now?: () => string;
  onOptimisticCards?: (optimisticCards: KanbanCard[], nodeIDs: Set<string>) => void;
  client?: KanbanCommandClient;
}): Promise<{
  optimisticCards: KanbanCard[];
  optimisticCardIDs: Set<string>;
  nodeIDs: Set<string>;
  savedCards: KanbanCard[];
}> {
  const { context, cards, columnID, items, priority, now = () => new Date().toISOString(), onOptimisticCards, client = defaultKanbanCommandClient } = args;
  const dedupedItems = dedupeExplorerItems(items);
  if (dedupedItems.length === 0) {
    return { optimisticCards: [], optimisticCardIDs: new Set(), nodeIDs: new Set(), savedCards: [] };
  }

  const logicGateID = logicGateIDFromKanbanBoardID(context.boardID);
  const hasValidPriority = typeof priority === "number" && Number.isInteger(priority) && priority >= 1 && priority <= 5;
  if (logicGateID && !hasValidPriority) {
    throw new Error("logic_gate_priority_required");
  }

  const firstPosition = nextCardPosition(cards, columnID);
  const timestamp = now();
  const optimisticCards = dedupedItems.map((item, index): KanbanCard => ({
    company_id: context.companyID,
    board_id: context.boardID,
    card_id: `pending-node-${item.nodeID}`,
    column_id: columnID,
    node_id: item.nodeID,
    node_title: item.label,
    description_snapshot: "",
    is_issue: false,
    position: firstPosition + index * 1000,
    created_timestamp: timestamp,
    updated_timestamp: timestamp,
  }));
  const nodeIDs = new Set(dedupedItems.map((item) => item.nodeID));
  const optimisticCardIDs = new Set(optimisticCards.map((card) => card.card_id));
  onOptimisticCards?.(optimisticCards, nodeIDs);

  const savedCards = await Promise.all(dedupedItems.map(async (item, index) => {
    const position = firstPosition + index * 1000;
    if (logicGateID) {
      const result = await client.assignNodeToLogicGateStatus({
        apiBase: context.apiBase,
        companyID: context.companyID,
        logicGateID,
        nodeID: item.nodeID,
        columnID,
        nodeTitle: item.label,
        position,
        priority,
      });
      return result.card;
    }
    return client.upsertCard({
      apiBase: context.apiBase,
      companyID: context.companyID,
      boardID: context.boardID,
      columnID,
      nodeID: item.nodeID,
      nodeTitle: item.label,
      position,
    });
  }));

  return { optimisticCards, optimisticCardIDs, nodeIDs, savedCards };
}

export async function toggleKanbanCardIssueCommand(args: {
  context: KanbanCommandContext;
  card: KanbanCard;
  isIssue: boolean;
  client?: KanbanCommandClient;
}): Promise<KanbanCard> {
  const { context, card, client = defaultKanbanCommandClient } = args;
  const logicGateID = logicGateIDForCard(context, card);
  if (logicGateID) {
    const result = await client.setLogicGateAssignmentIssue({
      apiBase: context.apiBase,
      companyID: context.companyID,
      logicGateID,
      nodeID: card.node_id,
      isIssue: args.isIssue,
    });
    return result.card;
  }
  return client.moveCard({
    apiBase: context.apiBase,
    companyID: context.companyID,
    boardID: context.boardID,
    cardID: card.card_id,
    isIssue: args.isIssue,
  });
}

export async function deleteKanbanCardsCommand(args: {
  context: KanbanCommandContext;
  cardIDs: string[];
  cards?: KanbanCard[];
  client?: KanbanCommandClient;
}): Promise<string[]> {
  const { context, client = defaultKanbanCommandClient } = args;
  const uniqueCardIDs = Array.from(new Set(args.cardIDs.map((cardID) => cardID.trim()).filter(Boolean)));
  const cardByID = new Map((args.cards ?? []).map((card) => [card.card_id, card]));
  await Promise.all(uniqueCardIDs.map(async (cardID) => {
    const card = cardByID.get(cardID);
    const logicGateID = logicGateIDForCard(context, card);
    if (card && logicGateID) {
      await client.removeLogicGateAssignment({
        apiBase: context.apiBase,
        companyID: context.companyID,
        logicGateID,
        nodeID: card.node_id,
      });
      return;
    }
    await client.deleteCard(context.apiBase, context.companyID, context.boardID, cardID);
  }));
  return uniqueCardIDs;
}
