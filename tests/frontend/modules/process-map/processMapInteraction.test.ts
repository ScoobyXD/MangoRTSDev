import assert from "node:assert/strict";
import test from "node:test";

import {
  createProcessMapSettlementGate,
  isValidProcessMapConnection,
  shouldApplyProcessMapCommit,
  shouldApplyProcessMapMutationAck,
  transparentVectorRefinementStrategy,
} from "../../../../frontend/src/modules/process-map/processMapInteraction.js";

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("connections keep exact directed endpoint identities", () => {
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "gate-1", sourceHandle: "output", targetHandle: "input" }), true);
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "folder-1", sourceHandle: "output", targetHandle: "input" }), false);
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "gate-1", sourceHandle: "input", targetHandle: "output" }), false);
  assert.equal(isValidProcessMapConnection({ source: null, target: "gate-1", sourceHandle: "output", targetHandle: "input" }), false);
});

test("mutation acknowledgements cannot replace a newer canonical generation", () => {
  assert.equal(shouldApplyProcessMapCommit(3, 4), true);
  assert.equal(shouldApplyProcessMapCommit(4, 4), true);
  assert.equal(shouldApplyProcessMapCommit(4, 3), false);
  assert.equal(shouldApplyProcessMapMutationAck(4, 4, 3, 3), true);
  assert.equal(shouldApplyProcessMapMutationAck(4, 5, 3, 3), false);
  assert.equal(shouldApplyProcessMapMutationAck(4, 4, 2, 3), false);
});

test("camera settlement waits for one quiet, all-inactive generation", async () => {
  let settled = 0;
  const gate = createProcessMapSettlementGate({ delayMs: 15, onSettle: () => { settled += 1; } });
  try {
    gate.onInteractionStateChange({ isDragging: false, isPanning: false, isZooming: true, inTransition: false });
    gate.onViewStateChange();
    await wait(4);
    gate.onViewStateChange();
    await wait(4);
    gate.onViewStateChange();
    await wait(20);
    assert.equal(settled, 0, "quiet-period expiry cannot load while deck still reports interaction");

    gate.onInteractionStateChange({ isDragging: false, isPanning: false, isZooming: false, inTransition: false });
    await wait(1);
    assert.equal(settled, 1, "release settles even when it produces no final view event");

    gate.onViewStateChange();
    gate.onViewStateChange();
    gate.onViewStateChange();
    await wait(20);
    assert.equal(settled, 2, "a wheel burst produces one settled LOD snapshot, not one per tick");
  } finally {
    gate.dispose();
  }
});

test("transparent-vector refinement keeps one loaded covering level until the complete replacement is ready", () => {
  const tiles: Parameters<typeof transparentVectorRefinementStrategy>[0] = [
    { index: { x: 0, y: 0, z: 0 }, isSelected: false, isVisible: false, isLoaded: true, content: { level: "coarse" } },
    { index: { x: 0, y: 0, z: 1 }, isSelected: true, isVisible: true, isLoaded: true, content: { level: "fine" } },
    { index: { x: 1, y: 0, z: 1 }, isSelected: true, isVisible: true, isLoaded: true, content: { level: "fine" } },
    { index: { x: 0, y: 1, z: 1 }, isSelected: true, isVisible: true, isLoaded: true, content: { level: "fine" } },
    { index: { x: 1, y: 1, z: 1 }, isSelected: true, isVisible: true, isLoaded: true, content: null },
  ];

  transparentVectorRefinementStrategy(tiles);
  assert.equal(tiles[0].isVisible, true);
  assert.deepEqual(tiles.slice(1).map((tile) => tile.isVisible), [false, false, false, false], "a selected null-content tile cannot replace valid coarse geometry");

  tiles[4].content = { level: "fine" };
  transparentVectorRefinementStrategy(tiles);
  assert.equal(tiles[0].isVisible, false);
  assert.deepEqual(tiles.slice(1).map((tile) => tile.isVisible), [true, true, true, true]);

  tiles[2].isLoaded = false;
  transparentVectorRefinementStrategy(tiles);
  assert.equal(tiles[2].isVisible, true, "cached tile content remains drawable while its replacement reloads");
  tiles[2].isLoaded = true;

  tiles[4].content = null;
  transparentVectorRefinementStrategy(tiles);
  assert.equal(tiles[0].isVisible, true, "failed or unavailable finer coverage retains valid coarse geometry");
  assert.deepEqual(tiles.slice(1).map((tile) => tile.isVisible), [false, false, false, false]);
});
