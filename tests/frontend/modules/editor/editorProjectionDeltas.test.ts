import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEditorProjectionEnvelope,
  editorRealtimeScope,
  type EditorProjectionDeltaEnvelope,
  type EditorProjectionRow,
} from "../../../../frontend/src/modules/editor/editorProjectionDeltas.js";

function row(overrides: Partial<EditorProjectionRow> = {}): EditorProjectionRow {
  return {
    company_id: "company-1",
    resource_type: "node",
    resource_id: "node-1",
    node_id: "node-1",
    information_id: "info-1",
    type: "Text box",
    information: "Initial text",
    created_timestamp: "2026-06-03T01:00:00.000Z",
    updated_timestamp: "2026-06-03T01:00:00.000Z",
    ...overrides,
  };
}

function envelope(overrides: Partial<EditorProjectionDeltaEnvelope> = {}): EditorProjectionDeltaEnvelope {
  return {
    company_id: "company-1",
    scope: "editor:node:node-1",
    projection: "editor",
    sequence: 1,
    resource_type: "node",
    resource_id: "node-1",
    deltas: [],
    ...overrides,
  };
}

test("builds editor realtime scopes for node and logic gate resources", () => {
  assert.equal(editorRealtimeScope("node", " node-1 "), "editor:node:node-1");
  assert.equal(editorRealtimeScope("logic_gate", " gate-1 "), "editor:logic_gate:gate-1");
});

test("applies editor upsert, patch, and delete deltas locally", () => {
  const upserted = applyEditorProjectionEnvelope({
    envelope: envelope({
      deltas: [{
        operation: "upsert",
        row_key: { resource_type: "node", resource_id: "node-1", information_id: "info-1" },
        row: row({ information: "Created text" }),
      }],
    }),
    companyID: "company-1",
    resourceType: "node",
    resourceID: "node-1",
    scope: "editor:node:node-1",
    items: [],
  });

  assert.equal(upserted.fallback, false);
  assert.equal(upserted.changed, true);
  assert.equal(upserted.items.length, 1);
  assert.equal(upserted.items[0].information, "Created text");
  assert.equal(upserted.lastSequence, 1);

  const patched = applyEditorProjectionEnvelope({
    envelope: envelope({
      sequence: 2,
      deltas: [{
        operation: "patch",
        row_key: { resource_type: "node", resource_id: "node-1", information_id: "info-1" },
        patch: { information: "Patched text", updated_timestamp: "2026-06-03T02:00:00.000Z" },
      }],
    }),
    companyID: "company-1",
    resourceType: "node",
    resourceID: "node-1",
    scope: "editor:node:node-1",
    items: upserted.items,
    lastSequence: upserted.lastSequence,
  });

  assert.equal(patched.fallback, false);
  assert.equal(patched.items[0].information, "Patched text");
  assert.equal(patched.items[0].updated_timestamp, "2026-06-03T02:00:00.000Z");
  assert.equal(patched.lastSequence, 2);

  const deleted = applyEditorProjectionEnvelope({
    envelope: envelope({
      sequence: 3,
      deltas: [{
        operation: "delete",
        row_key: { resource_type: "node", resource_id: "node-1", information_id: "info-1" },
      }],
    }),
    companyID: "company-1",
    resourceType: "node",
    resourceID: "node-1",
    scope: "editor:node:node-1",
    items: patched.items,
    lastSequence: patched.lastSequence,
  });

  assert.equal(deleted.fallback, false);
  assert.deepEqual(deleted.items, []);
  assert.deepEqual(deleted.removedInformationIDs, ["info-1"]);
  assert.equal(deleted.lastSequence, 3);
});

test("requests fallback for editor sequence gaps", () => {
  const result = applyEditorProjectionEnvelope({
    envelope: envelope({ sequence: 5, deltas: [] }),
    companyID: "company-1",
    resourceType: "node",
    resourceID: "node-1",
    scope: "editor:node:node-1",
    items: [row()],
    lastSequence: 3,
  });

  assert.equal(result.fallback, true);
  assert.equal(result.fallbackReason, "sequence_gap");
  assert.equal(result.lastSequence, 3);
});

test("requests fallback for wrong editor scope or resource", () => {
  const wrongScope = applyEditorProjectionEnvelope({
    envelope: envelope({ scope: "editor:node:other-node" }),
    companyID: "company-1",
    resourceType: "node",
    resourceID: "node-1",
    scope: "editor:node:node-1",
    items: [row()],
  });
  assert.equal(wrongScope.fallback, true);
  assert.equal(wrongScope.fallbackReason, "wrong_scope");

  const wrongResource = applyEditorProjectionEnvelope({
    envelope: envelope({ resource_id: "other-node" }),
    companyID: "company-1",
    resourceType: "node",
    resourceID: "node-1",
    scope: "editor:node:node-1",
    items: [row()],
  });
  assert.equal(wrongResource.fallback, true);
  assert.equal(wrongResource.fallbackReason, "wrong_resource");
});

test("requests fallback when patching a missing editor row", () => {
  const result = applyEditorProjectionEnvelope({
    envelope: envelope({
      deltas: [{
        operation: "patch",
        row_key: { resource_type: "node", resource_id: "node-1", information_id: "missing-info" },
        patch: { information: "Missing row" },
      }],
    }),
    companyID: "company-1",
    resourceType: "node",
    resourceID: "node-1",
    scope: "editor:node:node-1",
    items: [row()],
  });

  assert.equal(result.fallback, true);
  assert.equal(result.fallbackReason, "missing_existing_row");
});
