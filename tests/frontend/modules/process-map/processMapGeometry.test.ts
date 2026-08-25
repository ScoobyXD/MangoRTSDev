import assert from "node:assert/strict";
import test from "node:test";

import {
  PROCESS_MAP_FOLDER_FOOTPRINT,
  PROCESS_MAP_PROCESS_FOOTPRINT,
  PROCESS_MAP_RESTRICTED_FOOTPRINT,
  defaultProcessMapRoutePoints,
  insertProcessMapRoutePoint,
  normalizeProcessMapRoutePoints,
  orthogonalizeProcessMapRoutePoints,
  processMapFlowToGridPosition,
  processMapGridToFlowPosition,
  processMapInputAnchor,
  processMapOrthogonalPolyline,
  processMapOutputAnchor,
} from "../../../../frontend/src/modules/process-map/processMapGeometry.js";

test("Process Map geometry keeps fixed footprints and snaps signed grid coordinates", () => {
  assert.deepEqual(PROCESS_MAP_FOLDER_FOOTPRINT, { width: 5, height: 5 });
  assert.deepEqual(PROCESS_MAP_PROCESS_FOOTPRINT, { width: 4, height: 3 });
  assert.equal(PROCESS_MAP_RESTRICTED_FOOTPRINT, PROCESS_MAP_PROCESS_FOOTPRINT);
  assert.deepEqual(processMapGridToFlowPosition({ x: -3, y: 7 }), { x: -84, y: 196 });
  assert.deepEqual(processMapFlowToGridPosition({ x: -70, y: 181 }), { x: -2, y: 6 });
});

test("Process Map derives one centered left input and right output from placement and type", () => {
  assert.deepEqual(processMapInputAnchor({ x: 4, y: 8 }, "company_explorer_folder"), { x: 4, y: 10.5 });
  assert.deepEqual(processMapOutputAnchor({ x: 4, y: 8 }, "company_explorer_folder"), { x: 9, y: 10.5 });
  assert.deepEqual(processMapInputAnchor({ x: 12, y: 3 }, "logic_gate"), { x: 12, y: 4.5 });
  assert.deepEqual(processMapOutputAnchor({ x: 12, y: 3 }, "logic_gate"), { x: 16, y: 4.5 });
});

test("Process Map route helpers store bounded integer points and render only orthogonal segments", () => {
  const normalized = normalizeProcessMapRoutePoints([{ x: 1.2, y: -2.8 }, { x: 1.2, y: -2.8 }]);
  assert.deepEqual(normalized, [{ x: 1, y: -3 }]);
  assert.deepEqual(orthogonalizeProcessMapRoutePoints([{ x: 1, y: 1 }, { x: 4, y: 5 }]), [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 5 },
  ]);
  const polyline = processMapOrthogonalPolyline({ x: 0, y: 0.5 }, [{ x: 3, y: 2 }], { x: 6, y: 4.5 });
  for (let index = 1; index < polyline.length; index += 1) {
    const previous = polyline[index - 1];
    const current = polyline[index];
    assert.ok(previous.x === current.x || previous.y === current.y);
  }
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
  const backwardPolyline = processMapOrthogonalPolyline(
    { x: 16, y: 4.5 },
    backwardRoute,
    { x: 4, y: 4.5 },
  );
  assert.ok(backwardPolyline[1].x > 16 && backwardPolyline[1].y === 4.5, "a backward trace must first leave horizontally through the right output");
  assert.ok(backwardPolyline[backwardPolyline.length - 2].x < 4 && backwardPolyline[backwardPolyline.length - 2].y === 4.5, "a backward trace must approach the left input horizontally from the left");
  assert.deepEqual(
    insertProcessMapRoutePoint({ x: 0, y: 0 }, [{ x: 5, y: 0 }], { x: 5, y: 5 }, { x: 4, y: 4 }),
    [{ x: 5, y: 0 }, { x: 4, y: 4 }],
  );
});
