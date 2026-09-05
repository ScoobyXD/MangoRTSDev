import assert from "node:assert/strict";
import test from "node:test";

import {
  createProcessMapSettlementGate,
  isValidProcessMapConnection,
  processMapDragSelectionBounds,
  processMapPlacementsInsideBounds,
  shouldApplyProcessMapCommit,
  shouldApplyProcessMapMutationAck,
  transparentVectorRefinementStrategy,
  type ProcessMapRefinementTile,
} from "../../../../frontend/src/modules/process-map/processMapInteraction.js";

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function refine(tiles: ProcessMapRefinementTile[]): void {
  // This is the state Tileset2D supplies to a custom refinement callback.
  for (const tile of tiles) tile.isVisible = tile.isSelected;
  transparentVectorRefinementStrategy(tiles);
}

test("connections keep exact directed endpoint identities", () => {
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "gate-1", sourceHandle: "output", targetHandle: "input" }), true);
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "folder-1", sourceHandle: "output", targetHandle: "input" }), false);
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "gate-1", sourceHandle: "input", targetHandle: "output" }), false);
  assert.equal(isValidProcessMapConnection({ source: null, target: "gate-1", sourceHandle: "output", targetHandle: "input" }), false);
});

test("reverse drag normalizes one company-world selection rectangle", () => {
  assert.deepEqual(
    processMapDragSelectionBounds({ x: 20, y: 15 }, { x: -5, y: -10 }),
    { min_x: -5, min_y: -10, max_x: 20, max_y: 15 },
  );
});

test("drag selection includes complete edge-aligned placements and excludes partial overlaps", () => {
  const bounds = processMapDragSelectionBounds({ x: 20, y: 15 }, { x: -5, y: -10 });
  const selected = processMapPlacementsInsideBounds([
    { resource_type: "company_explorer_folder", resource_id: "edge-aligned", grid_x: -5, grid_y: -10, grid_width: 25, grid_height: 25 },
    { resource_type: "logic_gate", resource_id: "inside", grid_x: 0, grid_y: 0, grid_width: 10, grid_height: 5 },
    { resource_type: "logic_gate", resource_id: "left-overlap", grid_x: -6, grid_y: 0, grid_width: 2, grid_height: 2 },
    { resource_type: "logic_gate", resource_id: "right-overlap", grid_x: 19, grid_y: 0, grid_width: 2, grid_height: 2 },
    { resource_type: "logic_gate", resource_id: "outside", grid_x: 30, grid_y: 30, grid_width: 2, grid_height: 2 },
  ], bounds);

  assert.deepEqual(
    [...selected].sort(),
    ["company_explorer_folder:edge-aligned", "logic_gate:inside"],
    "selection is inclusive at every boundary but requires the complete placement rectangle",
  );
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
    { index: { x: 0, y: 0, z: 0 }, parent: null, isSelected: false, isVisible: false, isLoaded: true, content: { level: "coarse" } },
    { index: { x: 0, y: 0, z: 1 }, parent: null, isSelected: true, isVisible: true, isLoaded: true, content: { level: "fine" } },
    { index: { x: 1, y: 0, z: 1 }, parent: null, isSelected: true, isVisible: true, isLoaded: true, content: { level: "fine" } },
    { index: { x: 0, y: 1, z: 1 }, parent: null, isSelected: true, isVisible: true, isLoaded: true, content: { level: "fine" } },
    { index: { x: 1, y: 1, z: 1 }, parent: null, isSelected: true, isVisible: true, isLoaded: true, content: null },
  ];
  for (const tile of tiles.slice(1)) tile.parent = tiles[0];

  refine(tiles);
  assert.equal(tiles[0].isVisible, true);
  assert.deepEqual(tiles.slice(1).map((tile) => tile.isVisible), [false, false, false, false], "a selected null-content tile cannot replace valid coarse geometry");

  tiles[4].content = { level: "fine" };
  refine(tiles);
  assert.equal(tiles[0].isVisible, false);
  assert.deepEqual(tiles.slice(1).map((tile) => tile.isVisible), [true, true, true, true]);

  tiles[2].isLoaded = false;
  refine(tiles);
  assert.equal(tiles[2].isVisible, true, "cached tile content remains drawable while its replacement reloads");
  tiles[2].isLoaded = true;

  tiles[4].content = null;
  refine(tiles);
  assert.equal(tiles[0].isVisible, true, "failed or unavailable finer coverage retains valid coarse geometry");
  assert.deepEqual(tiles.slice(1).map((tile) => tile.isVisible), [false, false, false, false]);
});

test("complete selected coverage never traverses cached ancestors", () => {
  const tiles: ProcessMapRefinementTile[] = Array.from({ length: 256 }, (_, x) => ({
    index: { x, y: 0, z: 2 }, isSelected: x < 4, isVisible: x < 4, isLoaded: true, content: {},
    get parent(): never { throw new Error("complete coverage needs no ancestor lookup"); },
  }));
  refine(tiles);
  assert.equal(tiles.filter((tile) => tile.isVisible).length, 4);
});

test("substitute ancestors never overlap one another across sparse cached levels", () => {
  const tile = (z: number, x: number, selected: boolean, content: unknown, parent: ProcessMapRefinementTile | null): ProcessMapRefinementTile => ({
    index: { z, x, y: 0 }, parent, isSelected: selected, isVisible: selected, isLoaded: content != null, content,
  });
  const root = tile(0, 0, false, {}, null);
  const left = tile(1, 0, false, {}, root);
  const emptyRight = tile(1, 1, false, null, root);
  const missingLeft = tile(3, 0, true, null, left);
  const readyLeft = tile(3, 1, true, {}, left);
  const missingRight = tile(3, 4, true, null, emptyRight);
  const tiles = [readyLeft, missingLeft, left, missingRight, root, emptyRight];
  refine(tiles);
  assert.deepEqual(tiles.filter((entry) => entry.isVisible), [root], "higher fallback suppresses every overlapping lower layer regardless of header order");
  missingRight.content = {};
  refine(tiles);
  assert.deepEqual(tiles.filter((entry) => entry.isVisible), [left, missingRight]);
});
