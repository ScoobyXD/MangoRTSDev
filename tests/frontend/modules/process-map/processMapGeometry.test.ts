import assert from "node:assert/strict";
import test from "node:test";

import {
  PROCESS_MAP_GRID_PX,
  PROCESS_MAP_FOLDER_FOOTPRINT,
  PROCESS_MAP_PROCESS_FOOTPRINT,
  PROCESS_MAP_RESTRICTED_FOOTPRINT,
  defaultProcessMapRoutePoints,
  insertProcessMapRoutePoint,
  normalizeProcessMapRoutePoints,
  orthogonalizeProcessMapRoutePoints,
  processMapFlowToGridPosition,
  processMapFlowToRoutePoint,
  processMapGridPointToFlowPosition,
  processMapGridToFlowPosition,
  processMapInputAnchor,
  processMapOutputAnchor,
  processMapRoutePointToSurfaceCenter,
  processMapTracePath,
} from "../../../../frontend/src/modules/process-map/processMapGeometry.js";

function tracePathPoints(path: string): Array<{ x: number; y: number }> {
  return [...path.matchAll(/[ML]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

function assertOrthogonalTracePath(path: string): void {
  const points = tracePathPoints(path);
  assert.ok(points.length >= 2);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    assert.ok(previous.x === current.x || previous.y === current.y, `${path} contains a diagonal segment`);
  }
}

test("Process Map geometry keeps fixed footprints and snaps signed grid coordinates", () => {
  assert.equal(PROCESS_MAP_GRID_PX, 28);
  assert.deepEqual(PROCESS_MAP_FOLDER_FOOTPRINT, { width: 7, height: 7 });
  assert.deepEqual(PROCESS_MAP_PROCESS_FOOTPRINT, { width: 7, height: 5 });
  assert.deepEqual(PROCESS_MAP_RESTRICTED_FOOTPRINT, { width: 4, height: 3 });
  assert.notEqual(PROCESS_MAP_RESTRICTED_FOOTPRINT, PROCESS_MAP_PROCESS_FOOTPRINT);
  assert.deepEqual(processMapGridToFlowPosition({ x: -3, y: 7 }), { x: -84, y: 196 });
  assert.deepEqual(processMapFlowToGridPosition({ x: -70, y: 181 }), { x: -2, y: 6 });
  assert.deepEqual(processMapGridPointToFlowPosition({ x: 1.5, y: -2.5 }), { x: 42, y: -70 });
  assert.deepEqual(processMapFlowToRoutePoint({ x: 70, y: 42 }), { x: 3, y: 2 });
  assert.deepEqual(processMapFlowToRoutePoint({ x: 56.01, y: 55.99 }), { x: 3, y: 2 });
  assert.deepEqual(processMapFlowToRoutePoint({ x: 55.99, y: 56.01 }), { x: 2, y: 3 });
});

test("Process Map derives one centered left input and right output from placement and type", () => {
  assert.deepEqual(processMapInputAnchor({ x: 4, y: 8 }, "company_explorer_folder"), { x: 4, y: 11.5 });
  assert.deepEqual(processMapOutputAnchor({ x: 4, y: 8 }, "company_explorer_folder"), { x: 11, y: 11.5 });
  assert.deepEqual(processMapInputAnchor({ x: 12, y: 3 }, "logic_gate"), { x: 12, y: 5.5 });
  assert.deepEqual(processMapOutputAnchor({ x: 12, y: 3 }, "logic_gate"), { x: 19, y: 5.5 });
});

test("Process Map route helpers store bounded integer points and render only orthogonal segments", () => {
  const normalized = normalizeProcessMapRoutePoints([{ x: 1.2, y: -2.8 }, { x: 1.2, y: -2.8 }]);
  assert.deepEqual(normalized, [{ x: 1, y: -3 }]);
  assert.deepEqual(orthogonalizeProcessMapRoutePoints([{ x: 1, y: 1 }, { x: 4, y: 5 }]), [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 5 },
  ]);
  assertOrthogonalTracePath(processMapTracePath({ x: 0, y: 0.5 }, [{ x: 3, y: 2 }], { x: 6, y: 4.5 }));
  assertOrthogonalTracePath(processMapTracePath({ x: 0, y: 0.5 }, [], { x: 6, y: 4.5 }));
  assert.deepEqual(defaultProcessMapRoutePoints({ x: 3, y: 1 }, { x: 9, y: 5 }), [
    { x: 6, y: 1 },
    { x: 6, y: 5 },
  ]);
  const backwardRoute = defaultProcessMapRoutePoints({ x: 16, y: 4.5 }, { x: 4, y: 4.5 });
  assert.deepEqual(backwardRoute, [
    { x: 18, y: 5 },
    { x: 18, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 5 },
  ]);
  const backwardPolyline = tracePathPoints(processMapTracePath(
    { x: 16, y: 4.5 },
    backwardRoute,
    { x: 4, y: 4.5 },
  ));
  assert.ok(backwardPolyline[1].x > 16 * PROCESS_MAP_GRID_PX && backwardPolyline[1].y === 4.5 * PROCESS_MAP_GRID_PX, "a backward trace must first leave horizontally through the right output");
  assert.ok(backwardPolyline[backwardPolyline.length - 2].x < 4 * PROCESS_MAP_GRID_PX && backwardPolyline[backwardPolyline.length - 2].y === 4.5 * PROCESS_MAP_GRID_PX, "a backward trace must approach the left input horizontally from the left");
  assertOrthogonalTracePath(processMapTracePath({ x: 16, y: 4.5 }, backwardRoute, { x: 4, y: 4.5 }));
  const emptyBackwardPolyline = tracePathPoints(processMapTracePath(
    { x: 16, y: 4.5 },
    [],
    { x: 4, y: 4.5 },
  ));
  assert.ok(emptyBackwardPolyline[1].x > 16 * PROCESS_MAP_GRID_PX && emptyBackwardPolyline[1].y === 4.5 * PROCESS_MAP_GRID_PX, "an empty backward trace must first leave horizontally through the right output");
  assert.ok(emptyBackwardPolyline[emptyBackwardPolyline.length - 2].x < 4 * PROCESS_MAP_GRID_PX && emptyBackwardPolyline[emptyBackwardPolyline.length - 2].y === 4.5 * PROCESS_MAP_GRID_PX, "an empty backward trace must approach the left input horizontally from the left");
  assertOrthogonalTracePath(processMapTracePath({ x: 16, y: 4.5 }, [], { x: 4, y: 4.5 }));
  assert.deepEqual(
    insertProcessMapRoutePoint({ x: 0, y: 0 }, [{ x: 5, y: 0 }], { x: 5, y: 5 }, { x: 4, y: 4 }),
    [{ x: 5, y: 0 }, { x: 4, y: 4 }],
  );
  assert.deepEqual(processMapRoutePointToSurfaceCenter({ x: 3, y: 2 }), { x: 2.5, y: 1.5 });
  assert.equal(
    processMapTracePath({ x: 0, y: 0.5 }, [{ x: 3, y: 2 }], { x: 6, y: 4.5 }),
    "M 0 14 L 70 14 L 70 126 L 168 126",
  );
  const staleOutAndBackRoute = [{ x: 3, y: 1 }, { x: 3, y: 2 }];
  const savedRoute = staleOutAndBackRoute.map((point) => ({ ...point }));
  assert.equal(
    processMapTracePath({ x: 0, y: 0.5 }, staleOutAndBackRoute, { x: 6, y: 0.5 }),
    "M 0 14 L 168 14",
    "rendering removes an exact out-and-back bulge from an otherwise straight ribbon",
  );
  assert.deepEqual(staleOutAndBackRoute, savedRoute, "render simplification does not rewrite saved route points");
});
