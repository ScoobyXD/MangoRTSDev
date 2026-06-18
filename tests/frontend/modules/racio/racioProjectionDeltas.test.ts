import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRacioProjectionEnvelope,
  racioRealtimeScope,
  type RacioProjectionDeltaEnvelope,
} from "../../../../frontend/src/modules/racio/racioProjectionDeltas.js";
import type { RacioMatrixProjectionRow } from "../../../../frontend/src/modules/kanban/kanbanApi.js";

function row(overrides: Partial<RacioMatrixProjectionRow> = {}): RacioMatrixProjectionRow {
  return {
    company_id: "company-1",
    user_id: "user-1",
    resource_type: "node",
    resource_id: "node-1",
    logic_gate_id: "gate-1",
    display_title: "Alpha",
    status: "todo",
    status_color: "#64748b",
    due_date: "2026-06-03",
    priority: 2,
    assignee_user_id: "user-1",
    assignee_display_name: "Casey",
    assignee_email: "casey@example.com",
    resource_created_timestamp: "2026-06-01T00:00:00.000Z",
    updated_timestamp: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

function envelope(overrides: Partial<RacioProjectionDeltaEnvelope> = {}): RacioProjectionDeltaEnvelope {
  return {
    company_id: "company-1",
    projection: "racio_matrix",
    projection_scope: "user:user-1",
    projection_sequence: 1,
    projected_timestamp: "2026-06-02T00:00:00.000Z",
    deltas: [],
    ...overrides,
  };
}

test("builds the GVIC realtime user scope", () => {
  assert.equal(racioRealtimeScope(" user-1 "), "racio:user:user-1");
});

test("applies GVIC upsert and delete projection deltas locally", () => {
  const upserted = applyRacioProjectionEnvelope({
    envelope: envelope({
      deltas: [{
        operation: "upsert",
        row_key: { user_id: "user-1", resource_type: "node", resource_id: "node-1" },
        row: row({ display_title: "Updated node" }),
      }],
    }),
    companyID: "company-1",
    userID: "user-1",
    rows: [],
  });

  assert.equal(upserted.fallback, false);
  assert.equal(upserted.changed, true);
  assert.equal(upserted.rows.length, 1);
  assert.equal(upserted.rows[0].display_title, "Updated node");
  assert.equal(upserted.lastSequence, 1);

  const deleted = applyRacioProjectionEnvelope({
    envelope: envelope({
      projection_sequence: 2,
      deltas: [{
        operation: "delete",
        row_key: { user_id: "user-1", resource_type: "node", resource_id: "node-1" },
      }],
    }),
    companyID: "company-1",
    userID: "user-1",
    rows: upserted.rows,
    lastSequence: upserted.lastSequence,
  });

  assert.equal(deleted.fallback, false);
  assert.equal(deleted.changed, true);
  assert.deepEqual(deleted.rows, []);
  assert.deepEqual(deleted.removedRowKeys, [{ user_id: "user-1", resource_type: "node", resource_id: "node-1" }]);
  assert.equal(deleted.lastSequence, 2);
});

test("applies GVIC patch deltas to an existing row", () => {
  const patched = applyRacioProjectionEnvelope({
    envelope: envelope({
      deltas: [{
        operation: "patch",
        row_key: { user_id: "user-1", resource_type: "node", resource_id: "node-1" },
        patch: { display_title: "Patched node", priority: 5, due_date: undefined },
      }],
    }),
    companyID: "company-1",
    userID: "user-1",
    rows: [row()],
  });

  assert.equal(patched.fallback, false);
  assert.equal(patched.rows[0].display_title, "Patched node");
  assert.equal(patched.rows[0].priority, 5);
  assert.equal(patched.rows[0].due_date, undefined);
  assert.deepEqual(patched.upsertedRows.map((item) => item.resource_id), ["node-1"]);
});

test("requests fallback for GVIC projection sequence gaps", () => {
  const result = applyRacioProjectionEnvelope({
    envelope: envelope({ projection_sequence: 7, deltas: [] }),
    companyID: "company-1",
    userID: "user-1",
    rows: [row()],
    lastSequence: 3,
  });

  assert.equal(result.fallback, true);
  assert.equal(result.fallbackReason, "sequence_gap");
  assert.equal(result.lastSequence, 3);
});

test("rejects GVIC deltas for the wrong user", () => {
  const result = applyRacioProjectionEnvelope({
    envelope: envelope({
      deltas: [{
        operation: "upsert",
        row_key: { user_id: "user-2", resource_type: "node", resource_id: "node-2" },
        row: row({ user_id: "user-2", resource_id: "node-2" }),
      }],
    }),
    companyID: "company-1",
    userID: "user-1",
    rows: [],
  });

  assert.equal(result.fallback, true);
  assert.equal(result.fallbackReason, "wrong_user");
});
