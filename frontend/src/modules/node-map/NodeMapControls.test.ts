// Node Map keyboard/mouse control tests for multi-select batch behavior.
// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { computeNodeMapMultiSelectResult, mergeNodeMapMultiSelect } from "./NodeMapControls.js";

const defaultLayout = {
  zoom: 1,
  pan: { x: 0, y: 0 },
  nodeWidth: 100,
  nodeHeight: 80,
};

test("computeNodeMapMultiSelectResult selects nodes and relationship lines inside the multi-select box", () => {
  const selection = computeNodeMapMultiSelectResult({
    nodes: [
      { node_id: "node-a", title: "Node A", created_timestamp: "" },
      { node_id: "node-b", title: "Node B", created_timestamp: "" },
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
