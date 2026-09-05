import assert from "node:assert/strict";
import test from "node:test";
import { completeStepMapLayout, defaultStepMapRoute, moveStepMapBox, stepMapPath, stepMapSequence, type ProcessStepMapLayout, type StepMapBox, type StepMapResizeHandle } from "../../../../frontend/src/modules/kanban/processStepMapGeometry.js";
import type { ProcessStep, ProcessStepRelationship } from "../../../../frontend/src/modules/kanban/processWork.js";

const steps: ProcessStep[] = [
  { process_step_id: "a", logic_gate_id: "process", name: "Receive", position: 1000 },
  { process_step_id: "b", logic_gate_id: "process", name: "Check", position: 2000 },
];
const edge: ProcessStepRelationship = { resource_operational_relationship_id: "edge", source: { resource_type: "process_step", resource_id: "a" }, target: { resource_type: "process_step", resource_id: "b" } };
const sequenceBox = (id: string, x: number, y = 0): StepMapBox => ({ process_step_id: id, x, y, width: 112, height: 56 });
const sequenceEdge = (source: string, target: string): ProcessStepRelationship => ({ resource_operational_relationship_id: `${source}-${target}`, source: { resource_type: "process_step", resource_id: source }, target: { resource_type: "process_step", resource_id: target } });

test("Step sequence handles empty and single-Step maps", () => {
  assert.deepEqual(stepMapSequence([], []), new Map());
  assert.deepEqual(stepMapSequence([sequenceBox("only", 200)], []), new Map([["only", 1]]));
});

test("Step sequence starts at the leftmost box and follows connections without rewriting inputs", () => {
  const boxes = [sequenceBox("last", 160), sequenceBox("middle", 320), sequenceBox("first", 0)];
  const relationships = [sequenceEdge("middle", "last"), sequenceEdge("first", "middle")];
  const original = structuredClone({ boxes, relationships });
  assert.deepEqual(stepMapSequence(boxes, relationships), new Map([["first", 1], ["middle", 2], ["last", 3]]));
  assert.deepEqual({ boxes, relationships }, original, "numbering must not reorder, move, rename, or replace canonical inputs");
});

test("Step sequence gives branch siblings equal numbers and merged Steps their shortest directed distance", () => {
  const boxes = [sequenceBox("start", 0), sequenceBox("upper", 160), sequenceBox("lower", 160, 160), sequenceBox("extra", 320), sequenceBox("merge", 480), sequenceBox("finish", 640)];
  const relationships = [sequenceEdge("start", "upper"), sequenceEdge("upper", "extra"), sequenceEdge("extra", "merge"), sequenceEdge("start", "lower"), sequenceEdge("lower", "merge"), sequenceEdge("merge", "finish")];
  const expected = new Map([["start", 1], ["upper", 2], ["lower", 2], ["extra", 3], ["merge", 3], ["finish", 4]]);
  assert.deepEqual(stepMapSequence(boxes, relationships), expected);
  assert.deepEqual(stepMapSequence(boxes, [...relationships].reverse()), expected, "relationship order cannot choose a longer route");
});

test("Step sequence terminates on loops and never increases numbers through repeated edges", () => {
  const boxes = [sequenceBox("a", 0), sequenceBox("b", 160), sequenceBox("c", 320)];
  const relationships = [sequenceEdge("a", "b"), sequenceEdge("b", "c"), sequenceEdge("c", "a"), sequenceEdge("b", "b"), sequenceEdge("a", "b")];
  assert.deepEqual(stepMapSequence(boxes, relationships), new Map([["a", 1], ["b", 2], ["c", 3]]));
});

test("Step sequence leaves unreachable boxes unnumbered and ignores missing endpoints", () => {
  const boxes = [sequenceBox("start", 0), sequenceBox("isolated", 160), sequenceBox("cycle-a", 320), sequenceBox("cycle-b", 480)];
  const relationships = [sequenceEdge("isolated", "start"), sequenceEdge("start", "missing"), sequenceEdge("missing", "isolated"), sequenceEdge("cycle-a", "cycle-b"), sequenceEdge("cycle-b", "cycle-a")];
  assert.deepEqual(stepMapSequence(boxes, relationships), new Map([["start", 1]]));
});

test("Step sequence breaks equal x positions by y, then exact ID, independently of array order", () => {
  const boxes = [sequenceBox("z", 0, 32), sequenceBox("b", 0, 16), sequenceBox("a", 0, 16), sequenceBox("higher", 16, -100)];
  assert.deepEqual(stepMapSequence(boxes, []), new Map([["a", 1]]));
  assert.deepEqual(stepMapSequence([...boxes].reverse(), []), new Map([["a", 1]]));
  assert.deepEqual(stepMapSequence([...boxes, sequenceBox("left", -16, 1000)], []), new Map([["left", 1]]), "x takes precedence over y");
});

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
  assert.deepEqual([added.width, added.height], [112, 56], "new Steps occupy one-quarter the previous 224 by 112 area");
  assert.deepEqual(next.steps[0], base.steps[0], "existing authored sizes must not shrink");
  const resized = moveStepMapBox(next.steps[0], { x: -1000, y: -1000 }, "se");
  assert.equal(resized.process_step_id, "a");
  assert.deepEqual([resized.width, resized.height], [112, 56]);
  assert.deepEqual([resized.x, resized.y], [48, 48]);
  const moved = moveStepMapBox(resized, { x: 25, y: 41 });
  assert.deepEqual([moved.x, moved.y], [80, 96]);
  assert.deepEqual([moved.width, moved.height], [112, 56]);
});

test("each corner and side resize handle moves only its edges and retains the opposite anchor", () => {
  const box = { process_step_id: "a", x: 100, y: 200, width: 224, height: 112 };
  const expected: Record<StepMapResizeHandle, number[]> = {
    n: [100, 248, 224, 64], ne: [100, 248, 256, 64], e: [100, 200, 256, 112], se: [100, 200, 256, 160],
    s: [100, 200, 224, 160], sw: [132, 200, 192, 160], w: [132, 200, 192, 112], nw: [132, 248, 192, 64],
  };
  for (const handle of Object.keys(expected) as StepMapResizeHandle[]) {
    const resized = moveStepMapBox(box, { x: 25, y: 41 }, handle);
    assert.equal(resized.process_step_id, box.process_step_id);
    assert.deepEqual([resized.x, resized.y, resized.width, resized.height], expected[handle], handle);
  }
  const compact = { ...box, width: 112, height: 56 };
  assert.deepEqual(moveStepMapBox(compact, { x: 0, y: 0 }, "se"), compact, "a click must not round the compact height up");
  assert.equal(moveStepMapBox(compact, { x: 0, y: 16 }, "s").height, 72, "resizing follows the 16px grid from the authored size");
});

test("resizing clamps size and coordinates while keeping the opposite edge fixed", () => {
  const box = { process_step_id: "a", x: 100, y: 200, width: 224, height: 112 };
  const small = moveStepMapBox(box, { x: 1000, y: 1000 }, "nw");
  assert.deepEqual(small, { ...box, x: 212, y: 256, width: 112, height: 56 });
  const large = moveStepMapBox(box, { x: -20000, y: -20000 }, "nw");
  assert.deepEqual(large, { ...box, x: -9676, y: -9688, width: 10000, height: 10000 });
  for (const coordinate of [-999990, 999990]) {
    const original = { ...box, x: coordinate, y: coordinate };
    const resized = moveStepMapBox(original, { x: coordinate < 0 ? -64 : 1000, y: coordinate < 0 ? -64 : 1000 }, "nw");
    assert.ok(resized.x >= -1000000 && resized.x <= 1000000);
    assert.ok(resized.y >= -1000000 && resized.y <= 1000000);
    assert.equal(resized.x + resized.width, original.x + original.width);
    assert.equal(resized.y + resized.height, original.y + original.height);
  }
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
