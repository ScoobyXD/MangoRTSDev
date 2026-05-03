import test from "node:test";
import assert from "node:assert/strict";
import { resolveNodeMapDeleteSelection, shouldIgnoreMapDeleteKeyTarget } from "../../../../frontend/src/modules/node-map/NodeMapControls.js";

type DeleteRoutingInput = {
  canvasActive: boolean;
  hasSelection: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
};

const shouldHandleDelete = (input: DeleteRoutingInput) => {
  if (!input.hasSelection) return false;
  if (shouldIgnoreMapDeleteKeyTarget(input.target)) return false;
  return true;
};

test("ignores delete when inline title editing has focus even if canvas is active", () => {
  assert.equal(shouldHandleDelete({
    canvasActive: true,
    hasSelection: true,
    target: { isContentEditable: true },
  }), false);
});

test("ignores delete for editable target when canvas is not active", () => {
  assert.equal(shouldHandleDelete({
    canvasActive: false,
    hasSelection: true,
    target: { tagName: "TEXTAREA", isContentEditable: false },
  }), false);
});

test("ignores delete when nothing is selected", () => {
  assert.equal(shouldHandleDelete({
    canvasActive: true,
    hasSelection: false,
    target: null,
  }), false);
});

test("delete routing prefers the full multi-node selection over the primary node", () => {
  assert.deepEqual(resolveNodeMapDeleteSelection({
    selectedNodeID: "node-a",
    selectedNodeIDs: new Set(["node-a", "node-b", "node-c"]),
    selectedRelationshipIDs: new Set(),
  }), {
    nodeIDs: ["node-a", "node-b", "node-c"],
    relationshipIDs: [],
  });
});

test("delete routing falls back to primary node when no multi-selection exists", () => {
  assert.deepEqual(resolveNodeMapDeleteSelection({
    selectedNodeID: "node-a",
    selectedNodeIDs: new Set(),
    selectedRelationshipIDs: new Set(["rel-1"]),
  }), {
    nodeIDs: ["node-a"],
    relationshipIDs: ["rel-1"],
  });
});
