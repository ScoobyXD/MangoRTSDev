import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultProcessMapRoutePoints,
  fitProcessMapViewState,
  normalizeProcessMapRoutePoints,
  orthogonalizeProcessMapRoutePoints,
  processMapDeepestContainingFolder,
  processMapDeckTileSize,
  processMapInputAnchor,
  processMapOrthogonalPathPoints,
  processMapOutputAnchor,
  processMapPlacementBounds,
  processMapPlacementDisplayLOD,
  processMapPlacementLOD,
  resizeProcessMapPlacement,
} from "../../../../frontend/src/modules/process-map/processMapGeometry.js";

type ContainmentFolder = Parameters<typeof processMapDeepestContainingFolder>[1][number];

function folder(
  resourceID: string,
  bounds: { x: number; y: number; width: number; height: number },
  mapParentFolderID: string | null = null,
): ContainmentFolder {
  return {
    restricted: false,
    presentation: "editing",
    resource_type: "company_explorer_folder",
    resource_id: resourceID,
    name: resourceID,
    map_parent_folder_id: mapParentFolderID,
    grid_x: bounds.x,
    grid_y: bounds.y,
    grid_width: bounds.width,
    grid_height: bounds.height,
    can_edit: true,
    revision: 1,
    created_timestamp: "created",
    updated_timestamp: "updated",
  } as ContainmentFolder;
}

test("saved global dimensions define placement bounds and physical side anchors", () => {
  const placement = { grid_x: -4, grid_y: 8, grid_width: 11, grid_height: 7 };
  assert.deepEqual(processMapPlacementBounds(placement), {
    min_x: -4,
    min_y: 8,
    max_x: 7,
    max_y: 15,
  });
  assert.deepEqual(processMapInputAnchor(placement), { x: -4, y: 11.5 });
  assert.deepEqual(processMapOutputAnchor(placement), { x: 7, y: 11.5 });
});

test("the deepest eligible saved map Folder contains the final placement independently from Explorer", () => {
  const outer = folder("outer", { x: 0, y: 0, width: 30, height: 24 });
  const inner = folder("inner", { x: 5, y: 4, width: 12, height: 10 }, "outer");
  const unrelated = folder("unrelated", { x: 40, y: 40, width: 10, height: 10 });
  const folders = [outer, unrelated, inner];

  assert.equal(
    processMapDeepestContainingFolder({ min_x: 7, min_y: 6, max_x: 12, max_y: 10 }, folders)?.resource_id,
    "inner",
  );
  assert.equal(
    processMapDeepestContainingFolder({ min_x: 7, min_y: 6, max_x: 12, max_y: 10 }, folders, "inner")?.resource_id,
    "outer",
    "a moved Folder cannot choose itself as its map parent",
  );
  assert.equal(
    processMapDeepestContainingFolder({ min_x: 16, min_y: 10, max_x: 22, max_y: 16 }, folders)?.resource_id,
    "outer",
    "partial overlap with a nested fence does not count as containment",
  );
  assert.equal(
    processMapDeepestContainingFolder({ min_x: -2, min_y: -2, max_x: 2, max_y: 2 }, folders),
    null,
  );
});

test("LOD follows each placement's projected screen size", () => {
  assert.equal(processMapPlacementLOD({ grid_width: 7, grid_height: 5 }, 0.25), "whole");
  assert.equal(processMapPlacementLOD({ grid_width: 7, grid_height: 5 }, 6), "normal");
  assert.equal(processMapPlacementLOD({ grid_width: 7, grid_height: 5 }, 24), "editing");

  assert.equal(processMapPlacementLOD({ grid_width: 2, grid_height: 2 }, 8), "whole");
  assert.equal(processMapPlacementLOD({ grid_width: 20, grid_height: 20 }, 8), "editing");
});

test("one tile zoom carries conservative size-specific ceilings while fractional client LOD stays exact", () => {
  const boundaryPlacement = { grid_width: 8, grid_height: 8, presentation: "normal" as const };
  assert.equal(processMapPlacementLOD(boundaryPlacement, 2.9), "whole");
  assert.equal(processMapPlacementDisplayLOD(boundaryPlacement, 2.9), "whole");
  assert.equal(processMapPlacementLOD(boundaryPlacement, 3.1), "normal");
  assert.equal(processMapPlacementDisplayLOD(boundaryPlacement, 3.1), "normal");

  const pixelsPerGridUnit = 3.25;
  const smaller = { grid_width: 8, grid_height: 8, presentation: "normal" as const };
  const larger = { grid_width: 30, grid_height: 30, presentation: "editing" as const };
  assert.equal(processMapPlacementLOD(smaller, pixelsPerGridUnit), "normal");
  assert.equal(processMapPlacementLOD(larger, pixelsPerGridUnit), "editing");
  assert.equal(processMapPlacementDisplayLOD(smaller, pixelsPerGridUnit), "normal");
  assert.equal(processMapPlacementDisplayLOD(larger, pixelsPerGridUnit), "editing");

  assert.equal(
    processMapPlacementDisplayLOD({ ...larger, presentation: "normal" }, pixelsPerGridUnit),
    "normal",
    "the declared ceiling defensively caps detail even if client scale moves beyond it",
  );
});

test("initial fit centers the complete permission-safe bounds and remains finite at safe coordinate extremes", () => {
  const fit = fitProcessMapViewState(
    { min_x: -100, min_y: -50, max_x: 300, max_y: 50 },
    { width: 1000, height: 500 },
    { padding: 50, minZoom: -24, maxZoom: 24 },
  );
  assert.deepEqual(fit.target, [100, 0, 0]);
  assert.ok(Number.isFinite(fit.zoom));
  assert.ok(fit.zoom >= fit.minZoom && fit.zoom <= fit.maxZoom);

  const extreme = fitProcessMapViewState(
    { min_x: -2_147_483_648, min_y: -2_147_483_648, max_x: 2_147_483_647, max_y: 2_147_483_647 },
    { width: 1920, height: 1080 },
  );
  assert.ok(extreme.target.every(Number.isFinite));
  assert.ok(Number.isFinite(extreme.zoom));

  const empty = fitProcessMapViewState(null, { width: 900, height: 600 });
  assert.deepEqual(empty.target, [0, 0, 0]);
  assert.ok(Number.isFinite(empty.zoom));
});

test("deck non-geographic tile indexing exactly matches the backend z/x/y world spans", () => {
  const tileSize = 256;
  const maxTileZoom = 22;
  const deckTileSize = processMapDeckTileSize(tileSize, maxTileZoom);
  assert.equal(deckTileSize, tileSize * 2 ** maxTileZoom);
  for (const z of [0, 1, 7, 16, maxTileZoom]) {
    const deckWorldSpan = deckTileSize / 2 ** z;
    const backendWorldSpan = tileSize * 2 ** (maxTileZoom - z);
    assert.equal(deckWorldSpan, backendWorldSpan, `z=${z}`);
  }
  assert.notEqual(deckTileSize, tileSize, "ordinary 256 would shift deck selection by 2^22 tiles");
});

test("trace route helpers keep one bounded ordered integer geometry without diagonal segments", () => {
  assert.deepEqual(
    normalizeProcessMapRoutePoints([{ x: 1.2, y: -2.8 }, { x: 1.2, y: -2.8 }]),
    [{ x: 1, y: -3 }],
  );
  assert.deepEqual(
    orthogonalizeProcessMapRoutePoints([{ x: 1, y: 1 }, { x: 4, y: 5 }]),
    [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 5 }],
  );
  assert.equal(
    normalizeProcessMapRoutePoints(Array.from({ length: 257 }, (_, index) => ({ x: index, y: 0 }))).length,
    256,
    "local previews use the same hard route bound as committed writes",
  );
});

test("trace rendering removes only monotonic collinear points and preserves reversals", () => {
  assert.deepEqual(
    processMapOrthogonalPathPoints({ x: 0, y: 0 }, [{ x: 5, y: 0 }], { x: 10, y: 0 }),
    [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    "a middle point between its neighbors is redundant",
  );
  assert.deepEqual(
    processMapOrthogonalPathPoints({ x: 0, y: 0 }, [{ x: 10, y: 0 }], { x: 5, y: 0 }),
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }],
    "a horizontal backtracking waypoint remains visible",
  );
  assert.deepEqual(
    processMapOrthogonalPathPoints({ x: 3, y: 8 }, [{ x: 3, y: -4 }], { x: 3, y: 2 }),
    [{ x: 3, y: 8 }, { x: 3, y: -4 }, { x: 3, y: 2 }],
    "a vertical backtracking waypoint remains visible",
  );
});

test("new trace routes leave the output before bending and approach the input horizontally", () => {
  const source = { x: 7, y: 2.5 };
  const target = { x: 20, y: 11 };
  const route = defaultProcessMapRoutePoints(source, target);
  const path = processMapOrthogonalPathPoints(source, route, target);
  assert.ok(path[1].x > source.x && path[1].y === source.y, "the first visible segment exits right from the output");
  assert.ok(path[path.length - 2]?.y === target.y && path[path.length - 2]?.x < target.x, "the last visible segment approaches the left input horizontally");
  assert.ok(path.slice(1).every((point, index) => point.x === path[index].x || point.y === path[index].y));

  const reverseTarget = { x: -10, y: 15 };
  const reversePath = processMapOrthogonalPathPoints(source, defaultProcessMapRoutePoints(source, reverseTarget), reverseTarget);
  assert.ok(reversePath[1].x > source.x && reversePath[1].y === source.y, "reverse routes also clear the source before turning");
  assert.ok(reversePath.slice(1).every((point, index) => point.x === reversePath[index].x || point.y === reversePath[index].y));
});

test("manual resize keeps distinct minimum dimensions", () => {
  const process = resizeProcessMapPlacement(
    { grid_x: 10, grid_y: 10, grid_width: 7, grid_height: 5 },
    "logic_gate",
    100,
    100,
    "west",
    "north",
  );
  assert.deepEqual(process, { grid_x: 15, grid_y: 14, grid_width: 2, grid_height: 1 });
  const folder = resizeProcessMapPlacement(
    { grid_x: 10, grid_y: 10, grid_width: 7, grid_height: 7 },
    "company_explorer_folder",
    100,
    100,
    "west",
    "north",
  );
  assert.deepEqual(folder, { grid_x: 15, grid_y: 15, grid_width: 2, grid_height: 2 });
});
