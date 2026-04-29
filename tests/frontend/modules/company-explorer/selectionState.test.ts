import test from "node:test";
import assert from "node:assert/strict";
import { applyExplorerRowSelection } from "../../../../frontend/src/modules/company-explorer/selectionState.js";

test("clicking the same row still increments broadcast revision", () => {
  const initial = { selectedTreeID: "node-a", selectedNodeID: "a", broadcastRevision: 4 };
  const next = applyExplorerRowSelection(initial, { id: "node-a", kind: "node", nodeID: "a" });
  assert.equal(next.broadcastRevision, 5);
  assert.equal(next.selectedTreeID, "node-a");
  assert.equal(next.selectedNodeID, "a");
});

test("selecting folder-all clears selected node scope", () => {
  const initial = { selectedTreeID: "node-a", selectedNodeID: "a", broadcastRevision: 0 };
  const next = applyExplorerRowSelection(initial, { id: "folder-all", kind: "folder" });
  assert.equal(next.selectedNodeID, "");
  assert.equal(next.selectedTreeID, "folder-all");
});

test("selecting non-reset folders preserves node selection", () => {
  const initial = { selectedTreeID: "node-a", selectedNodeID: "a", broadcastRevision: 1 };
  const next = applyExplorerRowSelection(initial, { id: "folder-notes", kind: "folder" });
  assert.equal(next.selectedNodeID, "a");
  assert.equal(next.selectedTreeID, "folder-notes");
});
