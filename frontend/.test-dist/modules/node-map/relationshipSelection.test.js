// Relationship selection hit-test geometry tests for marquee and line segments.
// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { pathIntersectsRect, segmentIntersectsRect } from "./relationshipSelection.js";
test("detects segment intersection when segment crosses rectangle", () => {
    const intersects = segmentIntersectsRect({ x: 0, y: 0 }, { x: 10, y: 10 }, { minX: 4, maxX: 6, minY: 4, maxY: 6 });
    assert.equal(intersects, true);
});
test("returns false when segment misses rectangle bounds", () => {
    const intersects = segmentIntersectsRect({ x: 0, y: 0 }, { x: 3, y: 3 }, { minX: 4, maxX: 6, minY: 4, maxY: 6 });
    assert.equal(intersects, false);
});
test("detects path intersection when any polyline segment intersects rectangle", () => {
    const intersects = pathIntersectsRect([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 10 },
        { x: 12, y: 10 },
    ], { minX: 4, maxX: 6, minY: 4, maxY: 6 });
    assert.equal(intersects, true);
});
test("detects intersection when a segment lies on a rectangle boundary", () => {
    const intersects = segmentIntersectsRect({ x: 4, y: 0 }, { x: 4, y: 10 }, { minX: 4, maxX: 6, minY: 4, maxY: 6 });
    assert.equal(intersects, true);
});
test("returns false for a path fully outside the selection rectangle", () => {
    const intersects = pathIntersectsRect([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
    ], { minX: 4, maxX: 8, minY: 4, maxY: 8 });
    assert.equal(intersects, false);
});
