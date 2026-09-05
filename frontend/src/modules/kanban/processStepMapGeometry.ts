import type { ProcessStep, ProcessStepRelationship } from "./processWork.js";

export type StepMapPoint = { x: number; y: number };
export type StepMapBox = StepMapPoint & { process_step_id: string; width: number; height: number };
export type StepMapResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export type StepMapRoute = { resource_operational_relationship_id: string; points: StepMapPoint[] };
export type ProcessStepMapLayout = { revision: number; steps: StepMapBox[]; routes: StepMapRoute[] };

export const STEP_MAP_GRID = 16;
export const STEP_MAP_MIN_WIDTH = 112;
export const STEP_MAP_MIN_HEIGHT = 56;
export const STEP_MAP_MAX_SIZE = 10000;
export const STEP_MAP_MAX_COORDINATE = 1000000;

export function snapStepMapCoordinate(value: number): number {
  return Math.max(-STEP_MAP_MAX_COORDINATE, Math.min(STEP_MAP_MAX_COORDINATE, Math.round(value / STEP_MAP_GRID) * STEP_MAP_GRID));
}

/** Geometry belongs to exact Step/edge IDs; Board order only seeds missing boxes. */
export function completeStepMapLayout(layout: ProcessStepMapLayout, steps: readonly ProcessStep[], relationships: readonly ProcessStepRelationship[]): ProcessStepMapLayout {
  const ids = new Set(steps.map((step) => step.process_step_id));
  const edgeIDs = new Set(relationships.filter((edge) => ids.has(edge.source.resource_id) && ids.has(edge.target.resource_id)).map((edge) => edge.resource_operational_relationship_id));
  const boxes = layout.steps.filter((box) => ids.has(box.process_step_id)).map((box) => ({ ...box }));
  const savedIDs = new Set(boxes.map((box) => box.process_step_id));
  let slot = 0;
  for (const step of [...steps].sort((a, b) => a.position - b.position || a.process_step_id.localeCompare(b.process_step_id))) {
    if (savedIDs.has(step.process_step_id)) continue;
    let box: StepMapBox;
    do {
      box = { process_step_id: step.process_step_id, x: 64 + (slot % 4) * 288, y: 64 + Math.floor(slot / 4) * 208, width: STEP_MAP_MIN_WIDTH, height: STEP_MAP_MIN_HEIGHT };
      slot += 1;
    } while (boxes.some((other) => box.x < other.x + other.width + 16 && box.x + box.width + 16 > other.x && box.y < other.y + other.height + 16 && box.y + box.height + 16 > other.y));
    boxes.push(box);
  }
  return { revision: layout.revision, steps: boxes, routes: layout.routes.filter((route) => edgeIDs.has(route.resource_operational_relationship_id)).map((route) => ({ ...route, points: route.points.map((point) => ({ ...point })) })) };
}

/** Visual sequence follows directed flow from the leftmost Step without changing Board order. */
export function stepMapSequence(boxes: readonly StepMapBox[], relationships: readonly ProcessStepRelationship[]): Map<string, number> {
  const sequence = new Map<string, number>();
  if (!boxes.length) return sequence;
  let first = boxes[0];
  const nextByID = new Map<string, string[]>();
  for (const box of boxes) {
    nextByID.set(box.process_step_id, []);
    if (box.x < first.x || (box.x === first.x && (box.y < first.y || (box.y === first.y && box.process_step_id < first.process_step_id)))) first = box;
  }
  for (const relationship of relationships) {
    const next = nextByID.get(relationship.source.resource_id);
    if (next && nextByID.has(relationship.target.resource_id)) next.push(relationship.target.resource_id);
  }
  sequence.set(first.process_step_id, 1);
  const queue = [first.process_step_id];
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    const number = sequence.get(id)! + 1;
    for (const nextID of nextByID.get(id)!) {
      if (sequence.has(nextID)) continue;
      sequence.set(nextID, number);
      queue.push(nextID);
    }
  }
  return sequence;
}

export function moveStepMapBox(box: StepMapBox, delta: StepMapPoint, resize: StepMapResizeHandle | false = false): StepMapBox {
  if (!resize) return { ...box, x: snapStepMapCoordinate(box.x + delta.x), y: snapStepMapCoordinate(box.y + delta.y) };
  const west = resize.includes("w"), north = resize.includes("n");
  // Snap the motion so existing dimensions and the opposite edge stay fixed.
  const width = west || resize.includes("e")
    ? Math.max(STEP_MAP_MIN_WIDTH, Math.min(STEP_MAP_MAX_SIZE, box.width + snapStepMapCoordinate(delta.x) * (west ? -1 : 1)))
    : box.width;
  const height = north || resize.includes("s")
    ? Math.max(STEP_MAP_MIN_HEIGHT, Math.min(STEP_MAP_MAX_SIZE, box.height + snapStepMapCoordinate(delta.y) * (north ? -1 : 1)))
    : box.height;
  const x = west ? Math.max(-STEP_MAP_MAX_COORDINATE, Math.min(STEP_MAP_MAX_COORDINATE, box.x + box.width - width)) : box.x;
  const y = north ? Math.max(-STEP_MAP_MAX_COORDINATE, Math.min(STEP_MAP_MAX_COORDINATE, box.y + box.height - height)) : box.y;
  return { ...box, x, y, width: west ? box.x + box.width - x : width, height: north ? box.y + box.height - y : height };
}

export function stepMapAnchors(source: StepMapBox, target: StepMapBox): { start: StepMapPoint; end: StepMapPoint } {
  return { start: { x: source.x + source.width, y: source.y + source.height / 2 }, end: { x: target.x, y: target.y + target.height / 2 } };
}

export function defaultStepMapRoute(source: StepMapBox, target: StepMapBox): StepMapPoint[] {
  const { start, end } = stepMapAnchors(source, target);
  const x = snapStepMapCoordinate(end.x > start.x + 32 ? (start.x + end.x) / 2 : start.x + 48);
  return [{ x, y: Math.round((start.y + end.y) / 2) }];
}

/** Waypoints are authored; orthogonal elbows and endpoint anchors are derived. */
export function stepMapPath(source: StepMapBox, target: StepMapBox, points: readonly StepMapPoint[]): string {
  const { start, end } = stepMapAnchors(source, target);
  const route: StepMapPoint[] = [start];
  let previous = start;
  for (const point of points) {
    route.push({ x: point.x, y: previous.y }, point);
    previous = point;
  }
  const approachX = end.x - 24;
  route.push({ x: approachX, y: previous.y }, { x: approachX, y: end.y }, end);
  return route.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

export function stepMapBounds(layout: ProcessStepMapLayout): { x: number; y: number; width: number; height: number } {
  const points = layout.routes.flatMap((route) => route.points);
  const x = Math.min(0, ...layout.steps.map((box) => box.x - 64), ...points.map((point) => point.x - 64));
  const y = Math.min(0, ...layout.steps.map((box) => box.y - 64), ...points.map((point) => point.y - 64));
  return { x, y, width: Math.max(640, ...layout.steps.map((box) => box.x + box.width + 96), ...points.map((point) => point.x + 96)) - x, height: Math.max(400, ...layout.steps.map((box) => box.y + box.height + 96), ...points.map((point) => point.y + 96)) - y };
}
