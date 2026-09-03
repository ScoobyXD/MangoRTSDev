import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeExplorerEntityDragPayload, parseExplorerEntityDragPayload, parseExplorerEntityDragItems, isNodeDropItemType } from "../../../../frontend/src/modules/kanban/shared.js";

test("sanitizes explorer drag payloads and keeps Process drops on exact Nodes", () => {
  assert.deepEqual(sanitizeExplorerEntityDragPayload({ itemType: "node", nodeID: "node-1", label: " Alpha " }), {
    itemType: "node",
    nodeID: "node-1",
    label: "Alpha",
  });
  assert.equal(parseExplorerEntityDragPayload(JSON.stringify({ itemType: "node", itemID: "legacy-node", label: "" })), null);
  assert.equal(parseExplorerEntityDragPayload(JSON.stringify({ itemType: "logic_gate", itemID: "gate-1", label: "" })), null);
  assert.equal(sanitizeExplorerEntityDragPayload({ itemType: "file", itemID: "x", label: "x" }), null);
  assert.equal(isNodeDropItemType("node"), true);
  assert.equal(isNodeDropItemType("logic_gate"), false);
  assert.deepEqual(parseExplorerEntityDragItems(JSON.stringify({
    itemType: "node_batch",
    nodes: [
      { nodeID: "node-1", label: "Alpha" },
      { nodeID: "node-2", label: "Beta" },
      { nodeID: "node-1", label: "Duplicate" },
      { nodeID: "  ", label: "Invalid" },
    ],
  })), [
    { nodeID: "node-1", label: "Alpha" },
    { nodeID: "node-2", label: "Beta" },
  ]);
});
