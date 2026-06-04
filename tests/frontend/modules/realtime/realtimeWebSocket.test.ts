import assert from "node:assert/strict";
import test from "node:test";

import { applyKanbanProjectionEnvelope, type KanbanProjectionEnvelope } from "../../../../frontend/src/modules/kanban/kanbanProjectionDeltas.js";
import {
  parseRealtimeMessage,
  type RealtimeErrorMessage,
  type RealtimeProjectionDeltaMessage,
  type RealtimeSnapshotRefetchMessage,
  type RealtimeSubscriptionAcceptedMessage,
  type RealtimeSubscriptionRejectedMessage,
} from "../../../../frontend/src/modules/realtime/realtimeWebSocket.js";

test("parses realtime accepted, rejected, delta, refetch, and error messages", () => {
  const accepted = parseRealtimeMessage(JSON.stringify({ type: "subscription.accepted", scope: "board:A", current_sequence: 7 })) as RealtimeSubscriptionAcceptedMessage;
  assert.equal(accepted.type, "subscription.accepted");
  assert.equal(accepted.scope, "board:A");
  assert.equal(accepted.current_sequence, 7);

  const rejected = parseRealtimeMessage(JSON.stringify({ type: "subscription.rejected", scope: "board:B", error: "access_denied" })) as RealtimeSubscriptionRejectedMessage;
  assert.equal(rejected.type, "subscription.rejected");
  assert.equal(rejected.scope, "board:B");
  assert.equal(rejected.error, "access_denied");

  const delta = parseRealtimeMessage(JSON.stringify({
    type: "projection.delta",
    scope: "board:A",
    sequence: 8,
    projection: "kanban_board",
    projection_sequence: 8,
    deltas: [{ operation: "delete", row_key: { board_id: "A", card_id: "card-1" } }],
  })) as RealtimeProjectionDeltaMessage;
  assert.equal(delta.type, "projection.delta");
  assert.equal(delta.scope, "board:A");
  assert.equal(delta.sequence, 8);
  assert.equal(delta.projection_sequence, 8);
  assert.equal(delta.deltas.length, 1);

  const refetch = parseRealtimeMessage(JSON.stringify({ type: "snapshot.refetch", scope: "board:A", sequence: 9, reason: "sequence_unavailable" })) as RealtimeSnapshotRefetchMessage;
  assert.equal(refetch.type, "snapshot.refetch");
  assert.equal(refetch.scope, "board:A");
  assert.equal(refetch.sequence, 9);
  assert.equal(refetch.reason, "sequence_unavailable");

  const error = parseRealtimeMessage(JSON.stringify({ type: "error", error: "invalid_json" })) as RealtimeErrorMessage;
  assert.equal(error.type, "error");
  assert.equal(error.error, "invalid_json");
});

test("applies Kanban upsert and delete from realtime projection delta without refetch", () => {
  const versions = new Map<string, number>();
  const upsert = parseRealtimeMessage(JSON.stringify({
    type: "projection.delta",
    company_id: "company-1",
    scope: "board:board-A",
    sequence: 1,
    projection: "kanban_board",
    projection_scope: "board:board-A",
    projection_sequence: 1,
    projected_timestamp: "2026-06-03T10:00:00.000Z",
    deltas: [{
      operation: "upsert",
      row_key: { board_id: "board-A", card_id: "card-1", node_id: "node-1" },
      row: {
        company_id: "company-1",
        board_id: "board-A",
        card_id: "card-1",
        column_id: "pending",
        node_id: "node-1",
        logic_gate_id: "gate-1",
        node_title: "Realtime card",
        description_snapshot: "",
        is_issue: false,
        position: 1000,
        created_timestamp: "2026-06-03T10:00:00.000Z",
        updated_timestamp: "2026-06-03T10:00:00.000Z",
        projection_updated_timestamp: "2026-06-03T10:00:00.000Z",
      },
    }],
  })) as RealtimeProjectionDeltaMessage;

  const upserted = applyKanbanProjectionEnvelope({
    envelope: upsert as unknown as KanbanProjectionEnvelope,
    companyID: "company-1",
    boardID: "board-A",
    cards: [],
    versions,
  });
  assert.equal(upserted.fallback, false);
  assert.equal(upserted.changed, true);
  assert.equal(upserted.cards.length, 1);
  assert.equal(upserted.cards[0].card_id, "card-1");

  const deleted = applyKanbanProjectionEnvelope({
    envelope: parseRealtimeMessage(JSON.stringify({
      type: "projection.delta",
      company_id: "company-1",
      scope: "board:board-A",
      sequence: 2,
      projection: "kanban_board",
      projection_scope: "board:board-A",
      projection_sequence: 2,
      projected_timestamp: "2026-06-03T10:00:01.000Z",
      deltas: [{ operation: "delete", row_key: { board_id: "board-A", card_id: "card-1" } }],
    })) as unknown as KanbanProjectionEnvelope,
    companyID: "company-1",
    boardID: "board-A",
    cards: upserted.cards,
    versions,
    lastSequence: upserted.lastSequence,
  });

  assert.equal(deleted.fallback, false);
  assert.equal(deleted.changed, true);
  assert.equal(deleted.cards.length, 0);
  assert.deepEqual(deleted.removedCardIDs, ["card-1"]);
});
