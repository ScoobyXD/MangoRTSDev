import test from "node:test";
import assert from "node:assert/strict";
import { deriveExplorerSelectionFromRow } from "../../../../frontend/src/modules/company-explorer/selectionState.js";

test("node row selection maps title row to canonical node id", () => {
  const next = deriveExplorerSelectionFromRow(
    { selectedTreeID: "folder-all", selectedNodeID: "" },
    { id: "node-123", kind: "node", nodeID: "123", scopeLevel: 3, label: "Q2 Planning Note" },
  );
  assert.equal(next.selectedTreeID, "node-123");
  assert.equal(next.selectedNodeID, "123");
  assert.equal(next.scopeLevel, 3);
});

test("folder-all clears selected node scope", () => {
  const next = deriveExplorerSelectionFromRow(
    { selectedTreeID: "node-123", selectedNodeID: "123" },
    { id: "folder-all", kind: "folder", scopeLevel: 1, label: "All Nodes (14)" },
  );
  assert.equal(next.selectedNodeID, "");
});

test("non-reset folders preserve selected node id", () => {
  const next = deriveExplorerSelectionFromRow(
    { selectedTreeID: "node-123", selectedNodeID: "123" },
    { id: "folder-notes", kind: "folder", scopeLevel: 1, label: "Knowledge Notes" },
  );
  assert.equal(next.selectedNodeID, "123");
  assert.equal(next.selectedTreeID, "folder-notes");
});
