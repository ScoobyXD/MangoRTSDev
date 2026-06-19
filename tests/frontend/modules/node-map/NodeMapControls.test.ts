// Node Map keyboard/mouse control tests for multi-select batch behavior.
// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { computeNodeMapMultiSelectResult, mergeNodeMapMultiSelect, resolveNodeMapBlankCanvasSelection, resolveNodeMapDragStartSelection, resolveNodeMapPointerSelection, shouldTreatNodeMapGestureAsClick } from "../../../../frontend/src/modules/node-map/NodeMapControls.js";

const defaultLayout = {
  zoom: 1,
  pan: { x: 0, y: 0 },
  nodeWidth: 100,
  nodeHeight: 80,
};

test("computeNodeMapMultiSelectResult selects nodes and relationship lines inside the multi-select box", () => {
  const selection = computeNodeMapMultiSelectResult({
    nodes: [
      { node_id: "node-a", name: "Node A", created_timestamp: "" },
      { node_id: "node-b", name: "Node B", created_timestamp: "" },
    ],
    nodePositions: {
      "node-a": { x: 20, y: 20 },
      "node-b": { x: 260, y: 20 },
    },
    relationshipPaths: [
      { id: "rel-a-b", points: [{ x: 120, y: 60 }, { x: 260, y: 60 }] },
    ],
    multiSelectBox: { startX: 0, startY: 0, currentX: 200, currentY: 200, active: true, additive: true },
    ...defaultLayout,
  });

  assert.deepEqual(Array.from(selection.selectedNodeIDs), ["node-a"]);
  assert.deepEqual(Array.from(selection.selectedRelationshipIDs), ["rel-a-b"]);
});

test("mergeNodeMapMultiSelect keeps previous multi-select batch when additive mode is enabled", () => {
  const merged = mergeNodeMapMultiSelect(new Set(["node-prev"]), new Set(["node-new"]), true);
  assert.deepEqual(Array.from(merged).sort(), ["node-new", "node-prev"]);
});

test("multi-select additive behavior remains session-based when modifier key changes before pointerup", () => {
  const merged = mergeNodeMapMultiSelect(new Set(["rel-prev"]), new Set(["rel-new"]), true);
  assert.deepEqual(Array.from(merged).sort(), ["rel-new", "rel-prev"]);
});

test("plain node click collapses an existing multi-select batch to the clicked node", () => {
  const selection = resolveNodeMapPointerSelection({
    selectedNodeIDs: new Set(["node-a", "node-b", "node-c"]),
    nodeID: "node-b",
    additive: false,
  });
  assert.deepEqual(Array.from(selection.selectedNodeIDs), ["node-b"]);
  assert.equal(selection.selectedNodeID, "node-b");
});

test("modifier node click still toggles membership for additive selection", () => {
  const selection = resolveNodeMapPointerSelection({
    selectedNodeIDs: new Set(["node-a", "node-b"]),
    nodeID: "node-b",
    additive: true,
  });
  assert.deepEqual(Array.from(selection.selectedNodeIDs), ["node-a"]);
  assert.equal(selection.selectedNodeID, "node-a");
});

test("blank canvas click keeps a single node selected for linked editor context", () => {
  const selection = resolveNodeMapBlankCanvasSelection({
    selectedNodeID: "node-a",
    selectedNodeIDs: new Set(["node-a"]),
    selectedRelationshipIDs: new Set(),
  });

  assert.equal(selection.selectedNodeID, "node-a");
  assert.deepEqual(Array.from(selection.selectedNodeIDs), ["node-a"]);
  assert.deepEqual(Array.from(selection.selectedRelationshipIDs), []);
});

test("blank canvas click clears multi-select batches", () => {
  const selection = resolveNodeMapBlankCanvasSelection({
    selectedNodeID: "node-a",
    selectedNodeIDs: new Set(["node-a", "node-b"]),
    selectedRelationshipIDs: new Set(),
  });

  assert.equal(selection.selectedNodeID, "");
  assert.deepEqual(Array.from(selection.selectedNodeIDs), []);
});

test("drag start on an already selected batch keeps the full batch together", () => {
  const selection = resolveNodeMapDragStartSelection({
    selectedNodeID: "node-a",
    selectedNodeIDs: new Set(["node-a", "node-b", "node-c"]),
    nodeID: "node-b",
  });

  assert.equal(selection.selectedNodeID, "node-a");
  assert.deepEqual(selection.dragNodeIDs, ["node-a", "node-b", "node-c"]);
  assert.deepEqual(Array.from(selection.selectedNodeIDs), ["node-a", "node-b", "node-c"]);
  assert.equal(selection.clearSelectionOnClick, false);
});

test("drag start on an unselected node still collapses to that node", () => {
  const selection = resolveNodeMapDragStartSelection({
    selectedNodeID: "node-a",
    selectedNodeIDs: new Set(["node-a", "node-b"]),
    nodeID: "node-c",
  });

  assert.equal(selection.selectedNodeID, "node-c");
  assert.deepEqual(selection.dragNodeIDs, ["node-c"]);
  assert.equal(selection.clearSelectionOnClick, false);
});

test("click-vs-drag threshold separates deselect clicks from batch drags", () => {
  assert.equal(shouldTreatNodeMapGestureAsClick({ startMouseX: 10, startMouseY: 10, endMouseX: 12, endMouseY: 13 }), true);
  assert.equal(shouldTreatNodeMapGestureAsClick({ startMouseX: 10, startMouseY: 10, endMouseX: 18, endMouseY: 10 }), false);
});
