import assert from "node:assert/strict";
import test from "node:test";
import { completeStepMapLayout, defaultStepMapRoute, moveStepMapBox, stepMapPath, type ProcessStepMapLayout } from "../../../../frontend/src/modules/kanban/processStepMapGeometry.js";
import type { ProcessStep, ProcessStepRelationship } from "../../../../frontend/src/modules/kanban/processWork.js";

const steps: ProcessStep[] = [
  { process_step_id: "a", logic_gate_id: "process", name: "Receive", position: 1000 },
  { process_step_id: "b", logic_gate_id: "process", name: "Check", position: 2000 },
];
const edge: ProcessStepRelationship = { resource_operational_relationship_id: "edge", source: { resource_type: "process_step", resource_id: "a" }, target: { resource_type: "process_step", resource_id: "b" } };

test("Step geometry follows IDs through Board reordering, removes deleted endpoints, and never invents edges", () => {
  const layout: ProcessStepMapLayout = { revision: 8, steps: [{ process_step_id: "a", x: 320, y: 160, width: 224, height: 112 }], routes: [{ resource_operational_relationship_id: "edge", points: [{ x: 640, y: 256 }] }] };
  const filled = completeStepMapLayout(layout, steps, [edge]);
  const reordered = completeStepMapLayout(filled, steps.map((step) => ({ ...step, position: 3000 - step.position })), [edge]);
  assert.deepEqual(reordered.steps, filled.steps);
  assert.deepEqual(reordered.routes, layout.routes);
  const removed = completeStepMapLayout(filled, [steps[0]], [edge]);
  assert.deepEqual(removed.steps, layout.steps);
  assert.deepEqual(removed.routes, []);
  assert.equal(layout.steps.length, 1, "rendering defaults must not mutate saved state");
  assert.equal(completeStepMapLayout(filled, steps, []).routes.length, 0);
});

test("new Step geometry avoids saved boxes and resize preserves identity and bounds", () => {
  const base: ProcessStepMapLayout = { revision: 0, steps: [{ process_step_id: "a", x: 48, y: 48, width: 800, height: 160 }], routes: [] };
  const next = completeStepMapLayout(base, steps, []);
  const added = next.steps.find((box) => box.process_step_id === "b")!;
  assert.ok(added.x >= 864 || added.y >= 224, "the new Step must not cover an existing saved Step");
  const resized = moveStepMapBox(next.steps[0], { x: -1000, y: -1000 }, true);
  assert.equal(resized.process_step_id, "a");
  assert.deepEqual([resized.width, resized.height], [160, 96]);
  assert.deepEqual([resized.x, resized.y], [48, 48]);
  const moved = moveStepMapBox(resized, { x: 25, y: 41 });
  assert.deepEqual([moved.x, moved.y], [80, 96]);
  assert.deepEqual([moved.width, moved.height], [160, 96]);
});

test("manual route points produce orthogonal paths with anchors derived from current Step bounds", () => {
  const source = { process_step_id: "a", x: 48, y: 64, width: 224, height: 112 };
  const target = { process_step_id: "b", x: 480, y: 320, width: 224, height: 112 };
  const points = [{ x: 352, y: 224 }, { x: 400, y: 272 }];
  const path = stepMapPath(source, target, points);
  const coordinates = [...path.matchAll(/[ML] (-?\d+) (-?\d+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
  assert.deepEqual(coordinates[0], { x: 272, y: 120 });
  assert.deepEqual(coordinates[coordinates.length - 1], { x: 480, y: 376 });
  for (let index = 1; index < coordinates.length; index += 1) assert.ok(coordinates[index].x === coordinates[index - 1].x || coordinates[index].y === coordinates[index - 1].y);
  for (const point of points) assert.ok(coordinates.some((item) => item.x === point.x && item.y === point.y));
  assert.match(stepMapPath({ ...source, width: 320 }, target, points), /^M 368 120 /);
  const aligned = { ...target, y: source.y };
  const automatic = defaultStepMapRoute(source, aligned);
  assert.equal(automatic[0].y, 120, "a derived route must not add a grid-snapping zigzag between aligned anchors");
  assert.ok([...stepMapPath(source, aligned, automatic).matchAll(/[ML] (-?\d+) (-?\d+)/g)].every((match) => Number(match[2]) === 120));
});
