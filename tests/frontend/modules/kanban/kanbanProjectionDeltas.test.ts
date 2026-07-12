import test from "node:test";
import assert from "node:assert/strict";
import {
  applyKanbanProjectionEnvelope,
  beginKanbanProjectionFallback,
  finishKanbanProjectionFallback,
  kanbanCardFromProjectionRow,
  nextKanbanProjectionCursor,
  seedKanbanProjectionVersions,
  type KanbanBoardProjectionRow,
  type KanbanProjectionEnvelope,
} from "../../../../frontend/src/modules/kanban/kanbanProjectionDeltas.js";
import type { KanbanCard } from "../../../../frontend/src/modules/kanban/shared.js";

function card(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    company_id: "company-1",
    board_id: "board-1",
    card_id: "card-1",
    column_id: "todo",
    node_id: "node-1",
    logic_gate_id: "gate-1",
    node_title: "Alpha",
    description_snapshot: "",
    position: 1000,
    created_timestamp: "2026-06-01T00:00:00.000Z",
    updated_timestamp: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function row(overrides: Partial<KanbanBoardProjectionRow> = {}): KanbanBoardProjectionRow {
  return {
    company_id: "company-1",
    board_id: "board-1",
    card_id: "card-1",
    column_id: "doing",
    node_id: "node-1",
    logic_gate_id: "gate-1",
    node_title: "Alpha updated",
    description_snapshot: "",
    is_issue: false,
    position: 2000,
    due_date: "2026-06-03",
    priority: 2,
    created_from_email: true,
    created_timestamp: "2026-06-01T00:00:00.000Z",
    updated_timestamp: "2026-06-02T00:00:00.000Z",
    projection_updated_timestamp: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

function envelope(overrides: Partial<KanbanProjectionEnvelope> = {}): KanbanProjectionEnvelope {
  return {
    company_id: "company-1",
    projection: "kanban_board",
    projection_sequence: 4,
    projected_timestamp: "2026-06-02T00:00:00.000Z",
    deltas: [],
    ...overrides,
  };
}

test("converts Kanban projection rows into card metadata", () => {
  const converted = kanbanCardFromProjectionRow(row());

  assert.equal(converted?.card_id, "card-1");
  assert.equal(converted?.column_id, "doing");
  assert.equal(converted?.node_title, "Alpha updated");
  assert.equal(converted?.due_date, "2026-06-03");
  assert.equal(converted?.priority, 2);
  assert.equal(converted?.created_from_email, true);
});

test("applies Kanban upsert and delete projection deltas locally", () => {
  const versions = new Map<string, number>();
  const upsert = applyKanbanProjectionEnvelope({
    envelope: envelope({ deltas: [{ operation: "upsert", row: row() }] }),
    companyID: "company-1",
    boardID: "board-1",
    cards: [card()],
    versions,
  });

  assert.equal(upsert.fallback, false);
  assert.equal(upsert.changed, true);
  assert.equal(upsert.cards[0]?.column_id, "doing");
  assert.equal(upsert.cards[0]?.priority, 2);

  const deleted = applyKanbanProjectionEnvelope({
    envelope: envelope({
      projection_sequence: 5,
      projected_timestamp: "2026-06-02T00:00:01.000Z",
      deltas: [{
        operation: "delete",
        row_key: { company_id: "company-1", board_id: "board-1", card_id: "card-1", logic_gate_id: "gate-1", node_id: "node-1" },
        projected_timestamp: "2026-06-02T00:00:01.000Z",
      }],
    }),
    companyID: "company-1",
    boardID: "board-1",
    cards: upsert.cards,
    versions,
    lastSequence: upsert.lastSequence,
  });

  assert.equal(deleted.fallback, false);
  assert.deepEqual(deleted.cards, []);
  assert.deepEqual(deleted.removedCardIDs, ["card-1"]);
});

test("ignores delayed older Kanban deltas instead of overwriting newer card state", () => {
  const versions = new Map<string, number>();
  const current = card({
    column_id: "done",
    node_title: "Newest",
    projection_updated_timestamp: "2026-06-02T00:00:10.000Z",
    updated_timestamp: "2026-06-02T00:00:10.000Z",
  });
  seedKanbanProjectionVersions([current], versions);

  const result = applyKanbanProjectionEnvelope({
    envelope: envelope({
      projection_sequence: 8,
      projected_timestamp: "2026-06-02T00:00:20.000Z",
      deltas: [{ operation: "upsert", row: row({ column_id: "todo", projection_updated_timestamp: "2026-06-02T00:00:01.000Z" }) }],
    }),
    companyID: "company-1",
    boardID: "board-1",
    cards: [current],
    versions,
    lastSequence: 7,
  });

  assert.equal(result.fallback, false);
  assert.equal(result.changed, false);
  assert.equal(result.cards[0]?.column_id, "done");
  assert.equal(result.cards[0]?.node_title, "Newest");
});

test("patch deltas update known card fields without refetch", () => {
  const versions = new Map<string, number>();
  const result = applyKanbanProjectionEnvelope({
    envelope: envelope({
      deltas: [{
        operation: "patch",
        row_key: { company_id: "company-1", board_id: "board-1", card_id: "card-1" },
        patch: { priority: 1, due_date: null, created_from_email: true, projection_updated_timestamp: "2026-06-02T00:00:03.000Z" },
      }],
    }),
    companyID: "company-1",
    boardID: "board-1",
    cards: [card({ due_date: "2026-06-03", priority: 5 })],
    versions,
  });

  assert.equal(result.fallback, false);
  assert.equal(result.cards[0]?.priority, 1);
  assert.equal(result.cards[0]?.due_date, null);
  assert.equal(result.cards[0]?.created_from_email, true);
});

test("requests targeted fallback for projection sequence gaps and unknown delta operations", () => {
  const gap = applyKanbanProjectionEnvelope({
    envelope: envelope({ projection_sequence: 10, deltas: [] }),
    companyID: "company-1",
    boardID: "board-1",
    cards: [card()],
    versions: new Map(),
    lastSequence: 4,
  });

  assert.equal(gap.fallback, true);
  assert.equal(gap.fallbackReason, "sequence_gap");
  assert.equal(gap.lastSequence, 4);

  const unknown = applyKanbanProjectionEnvelope({
    envelope: envelope({ deltas: [{ operation: "replace", row: row() }] }),
    companyID: "company-1",
    boardID: "board-1",
    cards: [card()],
    versions: new Map(),
  });

  assert.equal(unknown.fallback, true);
  assert.equal(unknown.fallbackReason, "unknown_delta_operation");
});

test("advances Kanban projection cursor only after successful fallback recovery", () => {
  let cursor: number | undefined = 4;
  const inFlightBoards = new Set<string>();

  assert.equal(beginKanbanProjectionFallback(inFlightBoards, "board-1"), true);
  finishKanbanProjectionFallback(inFlightBoards, "board-1");
  assert.equal(cursor, 4);

  assert.equal(beginKanbanProjectionFallback(inFlightBoards, "board-1"), true);
  cursor = nextKanbanProjectionCursor(cursor, 10);
  finishKanbanProjectionFallback(inFlightBoards, "board-1");
  assert.equal(cursor, 10);
});

test("suppresses repeated Kanban projection fallback refetches while pending", () => {
  const inFlightBoards = new Set<string>();

  assert.equal(beginKanbanProjectionFallback(inFlightBoards, "board-1"), true);
  assert.equal(beginKanbanProjectionFallback(inFlightBoards, "board-1"), false);
  assert.equal(beginKanbanProjectionFallback(inFlightBoards, "board-2"), true);

  finishKanbanProjectionFallback(inFlightBoards, "board-1");
  assert.equal(beginKanbanProjectionFallback(inFlightBoards, "board-1"), true);
});
