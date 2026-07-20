// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { rectanglesOverlapWithGap, resizeNodeFootprint } from "../../../../frontend/src/modules/node-map/nodeFootprint.js";

const baseInput = {
  nodeID: "active",
  positions: {
    active: { x: 120, y: 240 },
    neighbor: { x: 120, y: 120 },
  },
  sizes: {
    active: { w: 120, h: 72 },
    neighbor: { w: 120, h: 72 },
  },
  defaultSize: { w: 148, h: 96 },
  worldWidth: 1200,
  worldHeight: 900,
  gap: 24,
};

test("expanding a card keeps its lower edge anchored and reflows collisions", () => {
  const input = structuredClone(baseInput);
  const result = resizeNodeFootprint({ ...input, nextSize: { w: 300, h: 300 }, verticalAnchor: "bottom" });
  assert.deepEqual(result.positions.active, { x: 120, y: 12 });
  assert.equal(
    rectanglesOverlapWithGap(
      { ...result.positions.active, ...result.sizes.active },
      { ...result.positions.neighbor, ...result.sizes.neighbor },
      24,
    ),
    false,
  );
  assert.deepEqual(input, baseInput);
});

test("growth at the world edge remains in bounds and shrinking does not move neighbors", () => {
  const atEdge = resizeNodeFootprint({
    ...baseInput,
    positions: { active: { x: 24, y: 24 }, neighbor: { x: 600, y: 600 } },
    nextSize: { w: 300, h: 300 },
    verticalAnchor: "bottom",
  });
  assert.equal(atEdge.positions.active.y, 0);

  const shrunk = resizeNodeFootprint({
    ...baseInput,
    sizes: { ...baseInput.sizes, active: { w: 300, h: 300 } },
    nextSize: { w: 120, h: 72 },
    verticalAnchor: "bottom",
  });
  assert.deepEqual(shrunk.positions.neighbor, baseInput.positions.neighbor);
});

