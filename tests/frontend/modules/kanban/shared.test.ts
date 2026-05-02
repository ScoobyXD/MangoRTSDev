import test from "node:test";
import assert from "node:assert/strict";
import { groupCardsByColumn, nextCardPosition, parseExplorerEntityDragPayload, sanitizeExplorerEntityDragPayload } from "../../../../frontend/src/modules/kanban/shared.js";

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
    {
      company_id: "c",
      board_id: "b",
      card_id: "late",
      column_id: "todo",
      item_type: "node",
      item_id: "node-2",
      title_snapshot: "late",
      position: 2000,
      created_timestamp: "2026-05-01T00:00:02.000Z",
      updated_timestamp: "2026-05-01T00:00:02.000Z",
    },
    {
      company_id: "c",
      board_id: "b",
      card_id: "early",
      column_id: "todo",
      item_type: "logic_gate",
      item_id: "gate-1",
      title_snapshot: "early",
      position: 1000,
      created_timestamp: "2026-05-01T00:00:01.000Z",
      updated_timestamp: "2026-05-01T00:00:01.000Z",
    },
  ]);
  assert.deepEqual((grouped.get("todo") ?? []).map((card) => card.card_id), ["early", "late"]);
});
