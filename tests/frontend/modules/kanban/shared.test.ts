import test from "node:test";
import assert from "node:assert/strict";
import { KANBAN_COLUMN_TITLE_TEXT_TRANSFORM, KANBAN_DEFAULT_COLUMN_WIDTH_PX, KANBAN_MODULE_TOP_CLEARANCE_PX, buildColumnReorderPlan, buildKanbanCardGroups, clampColumnWidth, filterAndSortKanbanCards, formatKanbanStatusAge, getKanbanConditionalColor, groupCardsByColumn, nextCardPosition, nextColumnPosition, parseExplorerEntityDragPayload, sanitizeExplorerEntityDragPayload, type KanbanCard } from "../../../../frontend/src/modules/kanban/shared.js";

function card(overrides: Partial<KanbanCard>): KanbanCard {
  return {
    company_id: "c",
    board_id: "b",
    card_id: "card",
    column_id: "todo",
    item_type: "node",
    item_id: "node-1",
    title_snapshot: "card",
    description_snapshot: "",
    position: 1000,
    status: "Ready",
    work_type: "Node",
    assigned_to: "",
    assigned_by: "",
    created_by: "",
    updated_by: "",
    last_activity: "",
    status_entered_timestamp: "2026-05-01T00:00:00.000Z",
    created_timestamp: "2026-05-01T00:00:00.000Z",
    updated_timestamp: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

test("sanitizes explorer drag payloads for node and logic gate drops", () => {
  assert.deepEqual(sanitizeExplorerEntityDragPayload({ itemType: "node", itemID: "node-1", label: " Alpha " }), {
    itemType: "node",
    itemID: "node-1",
    label: "Alpha",
  });
  assert.deepEqual(parseExplorerEntityDragPayload(JSON.stringify({ itemType: "logic_gate", itemID: "gate-1", label: "" })), {
    itemType: "logic_gate",
    itemID: "gate-1",
    label: "gate-1",
  });
  assert.equal(sanitizeExplorerEntityDragPayload({ itemType: "file", itemID: "x", label: "x" }), null);
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
      item_id: "node-2",
      title_snapshot: "late",
      position: 2000,
      created_timestamp: "2026-05-01T00:00:02.000Z",
      updated_timestamp: "2026-05-01T00:00:02.000Z",
    }),
    card({
      card_id: "early",
      item_type: "logic_gate",
      item_id: "gate-1",
      title_snapshot: "early",
      position: 1000,
      created_timestamp: "2026-05-01T00:00:01.000Z",
      updated_timestamp: "2026-05-01T00:00:01.000Z",
    }),
  ]);
  assert.deepEqual((grouped.get("todo") ?? []).map((card) => card.card_id), ["early", "late"]);
});

test("kanban query helpers filter, sort, group, color, and calculate status age", () => {
  const columns = new Map([["todo", "Ready"], ["done", "Done"]]);
  const cards = [
    card({ card_id: "beta", title_snapshot: "Beta task", column_id: "done", status: "Done", work_type: "Bug", assigned_to: "agent-1", position: 2000 }),
    card({ card_id: "alpha", title_snapshot: "Alpha task", column_id: "todo", status: "Ready", work_type: "Feature", assigned_to: "person-1", position: 1000 }),
    card({ card_id: "alpha-later", title_snapshot: "Alpha later", column_id: "todo", status: "Ready", work_type: "Bug", assigned_to: "agent-1", position: 3000 }),
  ];

  const filtered = filterAndSortKanbanCards(cards, {
    filters: [{ field: "title_snapshot", op: "prefix", value: "Alpha" }],
    sort: [{ field: "work_type", direction: "asc" }],
  }, columns);
  assert.deepEqual(filtered.map((item) => item.card_id), ["alpha-later", "alpha"]);

  const groups = buildKanbanCardGroups(cards, ["assigned_to", "work_type"], new Set(["assigned_to=agent-1"]), columns);
  assert.equal(groups.find((group) => group.value === "agent-1")?.collapsed, true);
  assert.equal(groups.find((group) => group.value === "person-1")?.groups[0]?.label, "Feature");

  assert.equal(formatKanbanStatusAge(card({ status_entered_timestamp: "2026-05-01T00:00:00.000Z" }), Date.parse("2026-05-03T00:00:00.000Z")), "2d");
  assert.match(getKanbanConditionalColor(cards[0], "assigned_to", columns), /^#[0-9a-f]{6}$/i);
});

test("column layout helpers keep reorder and resize writes bounded", () => {
  const columns = [
    { company_id: "c", board_id: "b", column_id: "left", title: "Left", position: 1000, width_px: 260, created_timestamp: "2026-05-01T00:00:01.000Z", updated_timestamp: "2026-05-01T00:00:01.000Z" },
    { company_id: "c", board_id: "b", column_id: "middle", title: "Middle", position: 2000, width_px: 260, created_timestamp: "2026-05-01T00:00:02.000Z", updated_timestamp: "2026-05-01T00:00:02.000Z" },
    { company_id: "c", board_id: "b", column_id: "right", title: "Right", position: 3000, width_px: 260, created_timestamp: "2026-05-01T00:00:03.000Z", updated_timestamp: "2026-05-01T00:00:03.000Z" },
  ];
  const plan = buildColumnReorderPlan(columns, "left", null);
  assert.deepEqual(plan.columns.map((column) => column.column_id), ["middle", "right", "left"]);
  assert.deepEqual(plan.updates, [{ columnID: "left", position: 4000 }]);
  assert.equal(nextColumnPosition(columns), 4000);
  assert.equal(clampColumnWidth(9999), 520);
  assert.equal(clampColumnWidth(Number.NaN), KANBAN_DEFAULT_COLUMN_WIDTH_PX);
});

test("kanban visual contract preserves column title casing and frame-header clearance", () => {
  assert.equal(KANBAN_COLUMN_TITLE_TEXT_TRANSFORM, "none");
  assert.ok(KANBAN_MODULE_TOP_CLEARANCE_PX >= 34);
});
