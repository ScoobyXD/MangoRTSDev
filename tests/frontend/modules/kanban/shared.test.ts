import test from "node:test";
import assert from "node:assert/strict";
import { KANBAN_COLUMN_TITLE_TEXT_TRANSFORM, KANBAN_DEFAULT_COLUMN_HEIGHT_PX, KANBAN_DEFAULT_COLUMN_ITEM_COLOR, KANBAN_DEFAULT_COLUMN_WIDTH_PX, KANBAN_MODULE_TOP_CLEARANCE_PX, buildCardReorderPlan, buildColumnReorderPlan, clampColumnHeight, clampColumnWidth, getKanbanConditionalColor, groupCardsByColumn, isKanbanBoardDropItemType, nextCardPosition, nextColumnPosition, normalizeKanbanColumnItemColor, parseExplorerEntityDragPayload, sanitizeExplorerEntityDragPayload, type KanbanCard } from "../../../../frontend/src/modules/kanban/shared.js";

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
