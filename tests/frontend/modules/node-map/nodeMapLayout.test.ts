import test from "node:test";
import assert from "node:assert/strict";
import { reconcileNodeMapPositions } from "../../../../frontend/src/modules/node-map/shared.js";

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
