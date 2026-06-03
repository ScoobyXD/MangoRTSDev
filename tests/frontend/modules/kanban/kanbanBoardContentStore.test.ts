import test from "node:test";
import assert from "node:assert/strict";
import {
  getKanbanBoardContentsSingleFlight,
  invalidateKanbanBoardContentsCache,
} from "../../../../frontend/src/modules/kanban/KanbanBoardContentStore.js";
import { invalidateLogicGateArenaViewCache } from "../../../../frontend/src/modules/kanban/kanbanApi.js";
import {
  logicGateKanbanBoardID,
  type KanbanBoard,
  type KanbanCard,
  type KanbanColumn,
} from "../../../../frontend/src/modules/kanban/shared.js";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
}

test("Kanban board content store loads Logic Gate board contents from v2 work read", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const apiBase = "https://api.example.test";
  const companyID = "company-1";
  const logicGateID = "gate-1";
  const boardID = logicGateKanbanBoardID(logicGateID);
  invalidateKanbanBoardContentsCache(apiBase, companyID, boardID);
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);

  const board: KanbanBoard = {
    company_id: companyID,
    board_id: boardID,
    logic_gate_id: logicGateID,
    title: "Gate",
    position: 1000,
    created_timestamp: "2026-01-01T00:00:00.000Z",
    updated_timestamp: "2026-01-01T00:00:00.000Z",
  };
  const columns: KanbanColumn[] = [{
    company_id: companyID,
    board_id: boardID,
    column_id: "pending",
    title: "Pending",
    position: 1000,
    width_px: 320,
    height_px: 420,
    item_color: "#fbb152",
    created_timestamp: "2026-01-01T00:00:00.000Z",
    updated_timestamp: "2026-01-01T00:00:00.000Z",
  }];
  const cards: KanbanCard[] = [{
    company_id: companyID,
    board_id: boardID,
    card_id: "card-1",
    column_id: "pending",
    node_id: "node-1",
    node_title: "Node 1",
    description_snapshot: "",
    position: 1000,
    created_timestamp: "2026-01-01T00:00:00.000Z",
    updated_timestamp: "2026-01-01T00:00:00.000Z",
  }];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);
    return jsonResponse({
      logic_gate: { company_id: companyID, logic_gate_id: logicGateID, header: "Gate", created_timestamp: "2026-01-01T00:00:00.000Z" },
      board,
      columns,
      cards,
      cards_limit: 500,
    });
  }) as typeof fetch;

  try {
    const result = await getKanbanBoardContentsSingleFlight(apiBase, companyID, boardID);

    assert.deepEqual(result.columns.map((column) => column.column_id), ["pending"]);
    assert.deepEqual(result.cards.map((card) => card.card_id), ["card-1"]);
    assert.equal(calls.length, 1);
    assert.match(calls[0] ?? "", /\/v2\/logic-gates\/gate-1\/work\?company_id=company-1$/);
    assert.equal(calls.some((url) => url.includes("/v1/kanban/cards")), false);
    assert.equal(calls.some((url) => url.includes("/v1/kanban/columns")), false);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateKanbanBoardContentsCache(apiBase, companyID, boardID);
    invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
  }
});
