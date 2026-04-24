// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { doesPolylineIntersectRect } from "./selectionGeometry.js";

test("detects polyline hit when a path point is inside the selection box", () => {
  const result = doesPolylineIntersectRect(
    [{ x: 5, y: 5 }, { x: 10, y: 10 }],
    { minX: 0, minY: 0, maxX: 6, maxY: 6 },
  );
  assert.equal(result, true);
});

test("detects polyline hit when a segment crosses the selection box", () => {
  const result = doesPolylineIntersectRect(
    [{ x: -10, y: 2 }, { x: 10, y: 2 }],
    { minX: 0, minY: 0, maxX: 4, maxY: 4 },
  );
  assert.equal(result, true);
});

test("returns false when the polyline stays outside the selection box", () => {
  const result = doesPolylineIntersectRect(
    [{ x: -10, y: -10 }, { x: -2, y: -2 }, { x: -1, y: -8 }],
    { minX: 0, minY: 0, maxX: 6, maxY: 6 },
  );
  assert.equal(result, false);
});
