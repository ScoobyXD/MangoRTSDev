import test from "node:test";
import assert from "node:assert/strict";
import { KANBAN_COLUMN_TITLE_TEXT_TRANSFORM, KANBAN_DEFAULT_COLUMN_HEIGHT_PX, KANBAN_DEFAULT_COLUMN_ITEM_COLOR, KANBAN_DEFAULT_COLUMN_WIDTH_PX, KANBAN_MODULE_TOP_CLEARANCE_PX, buildCardBatchReorderPlan, buildCardReorderPlan, buildColumnReorderPlan, buildKanbanCardSelectionUpdate, clampColumnHeight, clampColumnWidth, getKanbanConditionalColor, getOrderedKanbanCardIDs, groupCardsByColumn, isKanbanBoardDropItemType, nextCardPosition, nextColumnPosition, normalizeKanbanColumnItemColor, parseExplorerEntityDragItems, parseExplorerEntityDragPayload, parseKanbanCardDragPayload, sanitizeExplorerEntityDragPayload, type KanbanCard, type KanbanColumn } from "../../../../frontend/src/modules/kanban/shared.js";

function card(overrides: Partial<KanbanCard>): KanbanCard {
  return {
    company_id: "c",
    board_id: "b",
    card_id: "card",
    column_id: "todo",
    node_id: "node-1",
    node_title: "card",
    description_snapshot: "",
    position: 1000,
    created_timestamp: "2026-05-01T00:00:00.000Z",
    updated_timestamp: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function column(overrides: Partial<KanbanColumn>): KanbanColumn {
  return {
    company_id: "c",
    board_id: "b",
    column_id: "todo",
    title: "Column",
    position: 1000,
    width_px: 260,
    height_px: 240,
    item_color: "#2f7d62",
    created_timestamp: "2026-05-01T00:00:00.000Z",
    updated_timestamp: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

test("sanitizes explorer drag payloads and keeps board drops node-only", () => {
  assert.deepEqual(sanitizeExplorerEntityDragPayload({ itemType: "node", nodeID: "node-1", label: " Alpha " }), {
    itemType: "node",
    nodeID: "node-1",
    label: "Alpha",
  });
  assert.deepEqual(parseExplorerEntityDragPayload(JSON.stringify({ itemType: "node", itemID: "legacy-node", label: "" })), {
    itemType: "node",
    nodeID: "legacy-node",
    label: "legacy-node",
  });
  assert.equal(parseExplorerEntityDragPayload(JSON.stringify({ itemType: "logic_gate", itemID: "gate-1", label: "" })), null);
  assert.equal(sanitizeExplorerEntityDragPayload({ itemType: "file", itemID: "x", label: "x" }), null);
  assert.equal(isKanbanBoardDropItemType("node"), true);
  assert.equal(isKanbanBoardDropItemType("logic_gate"), false);
  assert.deepEqual(parseExplorerEntityDragItems(JSON.stringify({
    itemType: "node_batch",
    nodes: [
      { nodeID: "node-1", label: "Alpha" },
      { nodeID: "node-2", label: "Beta" },
      { nodeID: "node-1", label: "Duplicate" },
      { nodeID: "  ", label: "Invalid" },
    ],
  })), [
    { nodeID: "node-1", label: "Alpha" },
    { nodeID: "node-2", label: "Beta" },
  ]);
});

test("nextCardPosition appends inside the target column only", () => {
  const cards = [
    { column_id: "todo", position: 1000 },
    { column_id: "todo", position: 2000 },
    { column_id: "done", position: 9000 },
  ];
  assert.equal(nextCardPosition(cards, "todo"), 3000);
  assert.equal(nextCardPosition(cards, "empty"), 1000);
});

test("groupCardsByColumn sorts each column by stable board position", () => {
  const grouped = groupCardsByColumn([
    card({
      card_id: "late",
      node_id: "node-2",
      node_title: "late",
      position: 2000,
      created_timestamp: "2026-05-01T00:00:02.000Z",
      updated_timestamp: "2026-05-01T00:00:02.000Z",
    }),
    card({
      card_id: "early",
      node_id: "node-3",
      node_title: "early",
      position: 1000,
      created_timestamp: "2026-05-01T00:00:01.000Z",
      updated_timestamp: "2026-05-01T00:00:01.000Z",
    }),
  ]);
  assert.deepEqual((grouped.get("todo") ?? []).map((card) => card.card_id), ["early", "late"]);
});

test("card selection helper supports ranges and additive toggles across columns", () => {
  const columns = [
    column({ column_id: "left", title: "Left", position: 1000 }),
    column({ column_id: "middle", title: "Middle", position: 2000 }),
    column({ column_id: "right", title: "Right", position: 3000 }),
  ];
  const cards = [
    card({ card_id: "left-a", column_id: "left", node_id: "node-a", position: 1000 }),
    card({ card_id: "middle-a", column_id: "middle", node_id: "node-b", position: 1000 }),
    card({ card_id: "middle-b", column_id: "middle", node_id: "node-c", position: 2000 }),
    card({ card_id: "right-a", column_id: "right", node_id: "node-d", position: 1000 }),
  ];

  assert.deepEqual(getOrderedKanbanCardIDs(columns, cards), ["left-a", "middle-a", "middle-b", "right-a"]);

  const selectedFirst = buildKanbanCardSelectionUpdate({
    columns,
    cards,
    selectedCardIDs: new Set(),
    anchorCardID: "",
    clickedCardID: "left-a",
  });
  assert.deepEqual(Array.from(selectedFirst.selectedCardIDs), ["left-a"]);
  assert.equal(selectedFirst.anchorCardID, "left-a");

  const selectedRange = buildKanbanCardSelectionUpdate({
    columns,
    cards,
    selectedCardIDs: selectedFirst.selectedCardIDs,
    anchorCardID: selectedFirst.anchorCardID,
    clickedCardID: "middle-b",
    shiftKey: true,
  });
  assert.deepEqual(Array.from(selectedRange.selectedCardIDs), ["left-a", "middle-a", "middle-b"]);
  assert.equal(selectedRange.anchorCardID, "left-a");

  const toggledMiddle = buildKanbanCardSelectionUpdate({
    columns,
    cards,
    selectedCardIDs: selectedRange.selectedCardIDs,
    anchorCardID: selectedRange.anchorCardID,
    clickedCardID: "middle-a",
    additiveKey: true,
  });
  assert.deepEqual(Array.from(toggledMiddle.selectedCardIDs), ["left-a", "middle-b"]);
  assert.equal(toggledMiddle.anchorCardID, "middle-a");

  const continuousRange = buildKanbanCardSelectionUpdate({
    columns,
    cards,
    selectedCardIDs: toggledMiddle.selectedCardIDs,
    anchorCardID: toggledMiddle.anchorCardID,
    clickedCardID: "right-a",
    shiftKey: true,
  });
  assert.deepEqual(Array.from(continuousRange.selectedCardIDs), ["left-a", "middle-a", "middle-b", "right-a"]);
  assert.equal(continuousRange.anchorCardID, "middle-a");
});

test("kanban card helpers color node cards without view-query state", () => {
  const cards = [
    card({ card_id: "beta", node_title: "Beta task", column_id: "done", position: 2000 }),
    card({ card_id: "alpha", node_title: "Alpha task", column_id: "todo", position: 1000 }),
    card({ card_id: "alpha-later", node_title: "Alpha later", column_id: "todo", position: 3000 }),
  ];

  assert.equal(getKanbanConditionalColor(cards[0], new Map([["done", "#123abc"]])), "#123abc");
  assert.equal(normalizeKanbanColumnItemColor("not-a-color"), KANBAN_DEFAULT_COLUMN_ITEM_COLOR);
});

test("card reorder helper moves cards vertically with bounded position writes", () => {
  const cards = [
    card({ card_id: "alpha", node_id: "node-a", position: 1000 }),
    card({ card_id: "beta", node_id: "node-b", position: 2000 }),
    card({ card_id: "gamma", node_id: "node-c", position: 3000 }),
  ];
  const plan = buildCardReorderPlan(cards, "alpha", "todo", "beta", "after");
  const sorted = groupCardsByColumn(plan.cards).get("todo") ?? [];

  assert.deepEqual(sorted.map((item) => item.card_id), ["beta", "alpha", "gamma"]);
  assert.deepEqual(plan.updates, [{ cardID: "alpha", columnID: "todo", position: 2500 }]);
});

test("card batch reorder helper moves selected cards together", () => {
  const cards = [
    card({ card_id: "todo-a", node_id: "node-a", column_id: "todo", position: 1000 }),
    card({ card_id: "todo-b", node_id: "node-b", column_id: "todo", position: 2000 }),
    card({ card_id: "doing-a", node_id: "node-c", column_id: "doing", position: 1000 }),
    card({ card_id: "doing-b", node_id: "node-d", column_id: "doing", position: 2000 }),
  ];
  const payload = parseKanbanCardDragPayload(JSON.stringify({ cardID: "todo-a", cardIDs: ["todo-a", "todo-b"], sourceColumnID: "todo" }));
  assert.deepEqual(payload?.cardIDs, ["todo-a", "todo-b"]);

  const plan = buildCardBatchReorderPlan(cards, payload?.cardIDs ?? [], "doing", "doing-b", "before");
  const sorted = groupCardsByColumn(plan.cards).get("doing") ?? [];
  assert.deepEqual(sorted.map((item) => item.card_id), ["doing-a", "todo-a", "todo-b", "doing-b"]);
  assert.deepEqual(plan.updates, [
    { cardID: "todo-a", columnID: "doing", position: 1333 },
    { cardID: "todo-b", columnID: "doing", position: 1666 },
  ]);
});

test("column layout helpers keep reorder and resize writes bounded", () => {
  const columns = [
    { company_id: "c", board_id: "b", column_id: "left", title: "Left", position: 1000, width_px: 260, height_px: 240, item_color: "#2f7d62", created_timestamp: "2026-05-01T00:00:01.000Z", updated_timestamp: "2026-05-01T00:00:01.000Z" },
    { company_id: "c", board_id: "b", column_id: "middle", title: "Middle", position: 2000, width_px: 260, height_px: 240, item_color: "#245c9f", created_timestamp: "2026-05-01T00:00:02.000Z", updated_timestamp: "2026-05-01T00:00:02.000Z" },
    { company_id: "c", board_id: "b", column_id: "right", title: "Right", position: 3000, width_px: 260, height_px: 240, item_color: "#9a5b16", created_timestamp: "2026-05-01T00:00:03.000Z", updated_timestamp: "2026-05-01T00:00:03.000Z" },
  ];
  const plan = buildColumnReorderPlan(columns, "left", null);
  assert.deepEqual(plan.columns.map((column) => column.column_id), ["middle", "right", "left"]);
  assert.deepEqual(plan.updates, [{ columnID: "left", position: 4000 }]);
  const afterPlan = buildColumnReorderPlan(columns, "left", "middle", "after");
  assert.deepEqual(afterPlan.columns.map((column) => column.column_id), ["middle", "left", "right"]);
  const swapPlan = buildColumnReorderPlan(columns, "left", "middle", "swap");
  assert.deepEqual(swapPlan.columns.map((column) => column.column_id), ["middle", "left", "right"]);
  assert.deepEqual(swapPlan.updates, [{ columnID: "left", position: 2000 }, { columnID: "middle", position: 1000 }]);
  assert.equal(nextColumnPosition(columns), 4000);
  assert.equal(clampColumnWidth(9999), 520);
  assert.equal(clampColumnWidth(Number.NaN), KANBAN_DEFAULT_COLUMN_WIDTH_PX);
  assert.equal(clampColumnHeight(9999), 720);
  assert.equal(clampColumnHeight(Number.NaN), KANBAN_DEFAULT_COLUMN_HEIGHT_PX);
});

test("kanban visual contract preserves column title casing and frame-header clearance", () => {
  assert.equal(KANBAN_COLUMN_TITLE_TEXT_TRANSFORM, "none");
  assert.ok(KANBAN_MODULE_TOP_CLEARANCE_PX >= 34);
});
