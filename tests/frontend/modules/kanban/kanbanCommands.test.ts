import test from "node:test";
import assert from "node:assert/strict";
import {
  addExplorerNodesToKanbanColumnCommand,
  createKanbanColumnCommand,
  deleteKanbanCardsCommand,
  moveKanbanCardsToPriorityGroupCommand,
  reorderKanbanCardsCommand,
  reorderKanbanColumnsCommand,
  toggleKanbanCardIssueCommand,
  type KanbanCommandClient,
  type KanbanCommandContext,
} from "../../../../frontend/src/modules/kanban/kanbanCommands.js";
import {
  KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
  KANBAN_DEFAULT_COLUMN_WIDTH_PX,
  logicGateKanbanBoardID,
  type KanbanCard,
  type KanbanColumn,
} from "../../../../frontend/src/modules/kanban/shared.js";

const context: KanbanCommandContext = {
  apiBase: "https://api.test",
  companyID: "company-1",
  boardID: "board-1",
};

function column(overrides: Partial<KanbanColumn>): KanbanColumn {
  return {
    company_id: context.companyID,
    board_id: context.boardID,
    column_id: "todo",
    title: "Todo",
    position: 1000,
    width_px: KANBAN_DEFAULT_COLUMN_WIDTH_PX,
    height_px: KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
    item_color: "#fbb152",
    created_timestamp: "2026-05-01T00:00:00.000Z",
    updated_timestamp: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function card(overrides: Partial<KanbanCard>): KanbanCard {
  return {
    company_id: context.companyID,
    board_id: context.boardID,
    card_id: "card-1",
    column_id: "todo",
    node_id: "node-1",
    node_title: "Node 1",
    description_snapshot: "",
    position: 1000,
    created_timestamp: "2026-05-01T00:00:00.000Z",
    updated_timestamp: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createClient(): {
  client: KanbanCommandClient;
  calls: {
    createColumn: unknown[][];
    updateColumn: unknown[];
    moveCard: unknown[];
    upsertCard: unknown[];
    deleteCard: string[];
    deleteColumn: string[];
    assignNodeToLogicGateStatus: unknown[];
    moveLogicGateAssignment: unknown[];
    removeLogicGateAssignment: unknown[];
    setLogicGateAssignmentIssue: unknown[];
  };
} {
  const calls = {
    createColumn: [] as unknown[][],
    updateColumn: [] as unknown[],
    moveCard: [] as unknown[],
    upsertCard: [] as unknown[],
    deleteCard: [] as string[],
    deleteColumn: [] as string[],
    assignNodeToLogicGateStatus: [] as unknown[],
    moveLogicGateAssignment: [] as unknown[],
    removeLogicGateAssignment: [] as unknown[],
    setLogicGateAssignmentIssue: [] as unknown[],
  };
  const client: KanbanCommandClient = {
    async createColumn(apiBase, companyID, boardID, title, position, widthPx, heightPx, itemColor) {
      calls.createColumn.push([apiBase, companyID, boardID, title, position, widthPx, heightPx, itemColor]);
      return column({
        column_id: "created-column",
        title,
        position: position ?? 0,
        width_px: widthPx ?? 0,
        height_px: heightPx ?? 0,
        item_color: itemColor ?? "#fbb152",
      });
    },
    async updateColumn(args) {
      calls.updateColumn.push(args);
      return column({
        column_id: args.columnID,
        title: args.title ?? "Updated",
        position: args.position ?? 1000,
        width_px: args.widthPx ?? KANBAN_DEFAULT_COLUMN_WIDTH_PX,
        height_px: args.heightPx ?? KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
        item_color: args.itemColor ?? "#fbb152",
      });
    },
    async deleteColumn(_apiBase, _companyID, _boardID, columnID) {
      calls.deleteColumn.push(columnID);
    },
    async moveCard(args) {
      calls.moveCard.push(args);
      return card({
        card_id: args.cardID,
        column_id: args.columnID ?? "todo",
        is_issue: args.isIssue ?? false,
        position: args.position ?? 1000,
      });
    },
    async upsertCard(args) {
      calls.upsertCard.push(args);
      return card({
        card_id: `card-${args.nodeID}`,
        column_id: args.columnID,
        node_id: args.nodeID,
        node_title: args.nodeTitle,
        position: args.position,
      });
    },
    async deleteCard(_apiBase, _companyID, _boardID, cardID) {
      calls.deleteCard.push(cardID);
    },
    async assignNodeToLogicGateStatus(args) {
      calls.assignNodeToLogicGateStatus.push(args);
      return {
        card: card({
          card_id: "card-" + args.nodeID,
          column_id: args.columnID ?? "todo",
          node_id: args.nodeID,
          node_title: args.nodeTitle ?? args.nodeID,
          logic_gate_id: args.logicGateID,
          position: args.position ?? 1000,
        }),
        node: {
          company_id: args.companyID,
          node_id: args.nodeID,
          name: args.nodeTitle ?? args.nodeID,
          priority: args.priority,
          created_timestamp: "2026-05-01T00:00:00.000Z",
        },
        gvic_projection_rows: [],
      };
    },
    async moveLogicGateAssignment(args) {
      calls.moveLogicGateAssignment.push(args);
      return {
        card: card({
          card_id: "card-" + args.nodeID,
          column_id: args.columnID ?? "todo",
          node_id: args.nodeID,
          logic_gate_id: args.logicGateID,
          priority: args.priority,
          position: args.position ?? 1000,
        }),
        node: {
          company_id: args.companyID,
          node_id: args.nodeID,
          name: args.nodeID,
          priority: args.priority,
          created_timestamp: "2026-05-01T00:00:00.000Z",
        },
        gvic_projection_rows: [],
      };
    },
    async removeLogicGateAssignment(args) {
      calls.removeLogicGateAssignment.push(args);
      return {
        card: card({ card_id: "card-" + args.nodeID, node_id: args.nodeID, logic_gate_id: args.logicGateID }),
        node: {
          company_id: args.companyID,
          node_id: args.nodeID,
          name: args.nodeID,
          created_timestamp: "2026-05-01T00:00:00.000Z",
        },
        gvic_projection_rows: [],
      };
    },
    async setLogicGateAssignmentIssue(args) {
      calls.setLogicGateAssignmentIssue.push(args);
      return {
        card: card({ card_id: "card-" + args.nodeID, node_id: args.nodeID, logic_gate_id: args.logicGateID, is_issue: args.isIssue }),
        node: {
          company_id: args.companyID,
          node_id: args.nodeID,
          name: args.nodeID,
          created_timestamp: "2026-05-01T00:00:00.000Z",
        },
        gvic_projection_rows: [],
      };
    },
  };
  return { client, calls };
}

test("createKanbanColumnCommand creates one bounded column write with default layout", async () => {
  const { client, calls } = createClient();
  const result = await createKanbanColumnCommand({
    context,
    columns: [
      column({ column_id: "todo", position: 1000 }),
      column({ column_id: "done", position: 3000 }),
    ],
    client,
  });

  assert.equal(result.column_id, "created-column");
  assert.deepEqual(calls.createColumn[0], [
    context.apiBase,
    context.companyID,
    context.boardID,
    "New Column Name",
    4000,
    KANBAN_DEFAULT_COLUMN_WIDTH_PX,
    KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
    undefined,
  ]);
});

test("reorderKanbanColumnsCommand plans sparse positions and persists only changed columns", async () => {
  const { client, calls } = createClient();
  const optimistic: KanbanColumn[][] = [];
  const result = await reorderKanbanColumnsCommand({
    context,
    columns: [
      column({ column_id: "left", position: 1000 }),
      column({ column_id: "middle", position: 2000 }),
      column({ column_id: "right", position: 3000 }),
    ],
    draggedColumnID: "left",
    targetColumnID: null,
    onOptimisticColumns: (columns) => optimistic.push(columns),
    client,
  });

  assert.deepEqual(result.columns.map((item) => item.column_id), ["middle", "right", "left"]);
  assert.deepEqual(result.updates, [{ columnID: "left", position: 4000 }]);
  assert.equal(calls.updateColumn.length, 1);
  assert.deepEqual(optimistic[0].map((item) => item.column_id), ["middle", "right", "left"]);
});

test("reorderKanbanCardsCommand shares selected-card move semantics with headless callers", async () => {
  const { client, calls } = createClient();
  const result = await reorderKanbanCardsCommand({
    context,
    cards: [
      card({ card_id: "todo-a", node_id: "node-a", column_id: "todo", position: 1000 }),
      card({ card_id: "todo-b", node_id: "node-b", column_id: "todo", position: 2000 }),
      card({ card_id: "doing-a", node_id: "node-c", column_id: "doing", position: 1000 }),
      card({ card_id: "doing-b", node_id: "node-d", column_id: "doing", position: 2000 }),
    ],
    cardIDs: ["todo-a", "todo-b"],
    columnID: "doing",
    targetCardID: "doing-b",
    client,
  });

  assert.deepEqual(result.updates, [
    { cardID: "todo-a", columnID: "doing", position: 1333 },
    { cardID: "todo-b", columnID: "doing", position: 1666 },
  ]);
  assert.equal(calls.moveCard.length, 2);
  assert.deepEqual(result.persistedCards.map((item) => item.card_id), ["todo-a", "todo-b"]);
});

test("moveKanbanCardsToPriorityGroupCommand updates priority and manual order", async () => {
  const { client, calls } = createClient();
  const optimistic: KanbanCard[][] = [];
  const result = await moveKanbanCardsToPriorityGroupCommand({
    context: { ...context, boardID: logicGateKanbanBoardID("gate-1") },
    cards: [
      card({ card_id: "p1-a", node_id: "node-a", column_id: "doing", logic_gate_id: "gate-1", priority: 1, position: 1000 }),
      card({ card_id: "p2-a", node_id: "node-b", column_id: "doing", logic_gate_id: "gate-1", priority: 2, position: 2000 }),
      card({ card_id: "p1-b", node_id: "node-c", column_id: "doing", logic_gate_id: "gate-1", priority: 1, position: 3000 }),
    ],
    cardIDs: ["p2-a"],
    columnID: "doing",
    priority: 1,
    targetCardID: "p1-a",
    placement: "before",
    onOptimisticCards: (cards) => optimistic.push(cards),
    client,
  });

  assert.deepEqual(result.updates, [{ cardID: "p2-a", columnID: "doing", position: 1 }]);
  assert.equal(optimistic[0].find((item) => item.card_id === "p2-a")?.priority, 1);
  assert.equal(calls.moveLogicGateAssignment.length, 1);
  assert.deepEqual(calls.moveLogicGateAssignment[0], {
    apiBase: context.apiBase,
    companyID: context.companyID,
    logicGateID: "gate-1",
    nodeID: "node-b",
    columnID: "doing",
    mutationOrigin: "kanban",
    priority: 1,
    position: 1,
  });
});

test("moveKanbanCardsToPriorityGroupCommand can skip manual position writes", async () => {
  const { client, calls } = createClient();
  const result = await moveKanbanCardsToPriorityGroupCommand({
    context: { ...context, boardID: logicGateKanbanBoardID("gate-1") },
    cards: [
      card({ card_id: "p1-a", node_id: "node-a", column_id: "doing", logic_gate_id: "gate-1", priority: 1, position: 1000 }),
      card({ card_id: "p2-a", node_id: "node-b", column_id: "doing", logic_gate_id: "gate-1", priority: 2, position: 2000 }),
    ],
    cardIDs: ["p2-a"],
    columnID: "doing",
    priority: 1,
    targetCardID: "p1-a",
    manualReorderEnabled: false,
    client,
  });

  assert.deepEqual(result.updates, []);
  assert.equal((calls.moveLogicGateAssignment[0] as { priority?: number; position?: number }).priority, 1);
  assert.equal((calls.moveLogicGateAssignment[0] as { priority?: number; position?: number }).position, undefined);
});

test("addExplorerNodesToKanbanColumnCommand dedupes drag rows before API upserts", async () => {
  const { client, calls } = createClient();
  const optimistic: KanbanCard[][] = [];
  const result = await addExplorerNodesToKanbanColumnCommand({
    context,
    cards: [card({ card_id: "existing", node_id: "node-0", column_id: "todo", position: 1000 })],
    columnID: "todo",
    items: [
      { nodeID: " node-1 ", label: " Alpha " },
      { nodeID: "node-1", label: "Duplicate" },
      { nodeID: "node-2", label: "" },
      { nodeID: " ", label: "ignored" },
    ],
    now: () => "2026-05-04T00:00:00.000Z",
    onOptimisticCards: (cards) => optimistic.push(cards),
    client,
  });

  assert.deepEqual(optimistic[0].map((item) => [item.node_id, item.node_title, item.position]), [
    ["node-1", "Alpha", 2000],
    ["node-2", "node-2", 3000],
  ]);
  assert.equal(calls.upsertCard.length, 2);
  assert.deepEqual(result.savedCards.map((item) => item.node_id), ["node-1", "node-2"]);
  assert.deepEqual(Array.from(result.nodeIDs), ["node-1", "node-2"]);
});

test("addExplorerNodesToKanbanColumnCommand sends priority for Logic Gate assignments", async () => {
  const { client, calls } = createClient();
  const result = await addExplorerNodesToKanbanColumnCommand({
    context: { ...context, boardID: logicGateKanbanBoardID("gate-1") },
    cards: [],
    columnID: "todo",
    items: [{ nodeID: "node-1", label: "Alpha" }],
    priority: 2,
    client,
  });

  assert.equal(result.savedCards.length, 1);
  assert.equal(calls.upsertCard.length, 0);
  assert.equal(calls.assignNodeToLogicGateStatus.length, 1);
  assert.equal((calls.assignNodeToLogicGateStatus[0] as { priority?: number }).priority, 2);
});

test("toggleKanbanCardIssueCommand persists issue status without moving the card", async () => {
  const { client, calls } = createClient();
  const result = await toggleKanbanCardIssueCommand({
    context,
    card: card({ card_id: "card-issue", column_id: "doing", position: 4000 }),
    isIssue: true,
    client,
  });
  assert.equal(result.is_issue, true);
  assert.deepEqual(calls.moveCard[0], {
    apiBase: context.apiBase,
    companyID: context.companyID,
    boardID: context.boardID,
    cardID: "card-issue",
    isIssue: true,
  });
});

test("deleteKanbanCardsCommand trims and dedupes card API deletes", async () => {
  const { client, calls } = createClient();
  const deleted = await deleteKanbanCardsCommand({
    context,
    cardIDs: [" card-a ", "card-a", "", "card-b"],
    client,
  });

  assert.deepEqual(deleted, ["card-a", "card-b"]);
  assert.deepEqual(calls.deleteCard, ["card-a", "card-b"]);
});
