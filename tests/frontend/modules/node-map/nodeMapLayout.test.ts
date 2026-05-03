import test from "node:test";
import assert from "node:assert/strict";
import { changedPersistedMapPositions, persistedMapPositionsToNodePositions, reconcileNodeMapPositions } from "../../../../frontend/src/modules/node-map/shared.js";

test("reconcileNodeMapPositions preserves hidden node positions across scoped folder views", () => {
  const previous = {
    visible: { x: 240, y: 360 },
    hidden: { x: 960, y: 720 },
  };

  const next = reconcileNodeMapPositions({
    previous,
    nodes: [{ node_id: "visible" }],
    canvasWidth: 1000,
    worldWidth: 6400,
    worldHeight: 4400,
    nodeWidth: 148,
    nodeHeight: 96,
  });

  assert.equal(next, previous);
  assert.deepEqual(next.hidden, { x: 960, y: 720 });
});

test("reconcileNodeMapPositions adds positions for newly visible nodes without clearing existing layout", () => {
  const next = reconcileNodeMapPositions({
    previous: { existing: { x: 240, y: 360 } },
    nodes: [{ node_id: "existing" }, { node_id: "new" }],
    canvasWidth: 1000,
    worldWidth: 6400,
    worldHeight: 4400,
    nodeWidth: 148,
    nodeHeight: 96,
  });

  assert.deepEqual(next.existing, { x: 240, y: 360 });
  assert.deepEqual(next.new, { x: 276, y: 120 });
});

test("persistedMapPositionsToNodePositions accepts backend node and logic-gate ids", () => {
  const next = persistedMapPositionsToNodePositions({
    positions: [
      { node_id: "node-1", x: 241, y: 359 },
      { logic_gate_id: "gate-1", x: 480, y: 120 },
    ],
    worldWidth: 6400,
    worldHeight: 4400,
    nodeWidth: 148,
    nodeHeight: 96,
  });

  assert.deepEqual(next["node-1"], { x: 240, y: 360 });
  assert.deepEqual(next["gate-1"], { x: 480, y: 120 });
});

test("changedPersistedMapPositions returns only entities that need a server write", () => {
  assert.deepEqual(changedPersistedMapPositions({
    previous: {
      unchanged: { x: 10, y: 20 },
      moved: { x: 30, y: 40 },
    },
    current: {
      unchanged: { x: 10, y: 20 },
      moved: { x: 36, y: 48 },
      created: { x: 120, y: 132 },
    },
  }), [
    { entity_id: "moved", x: 36, y: 48 },
    { entity_id: "created", x: 120, y: 132 },
  ]);
});

test("changedPersistedMapPositions can ignore hidden scoped entities", () => {
  assert.deepEqual(changedPersistedMapPositions({
    previous: {
      visible: { x: 10, y: 20 },
      hidden: { x: 30, y: 40 },
    },
    current: {
      visible: { x: 15, y: 25 },
      hidden: { x: 0, y: 0 },
    },
    entityIDs: new Set(["visible"]),
  }), [
    { entity_id: "visible", x: 15, y: 25 },
  ]);
});
