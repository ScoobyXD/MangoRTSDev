export const PROCESS_MAP_GRID_PX = 28;
export const PROCESS_MAP_MAX_ROUTE_POINTS = 256;

export type ProcessMapResourceType = "company_explorer_folder" | "logic_gate";

export type ProcessMapGridPoint = {
  x: number;
  y: number;
};

export type ProcessMapFootprint = {
  width: number;
  height: number;
};

export const PROCESS_MAP_FOLDER_FOOTPRINT: ProcessMapFootprint = { width: 5, height: 5 };
export const PROCESS_MAP_PROCESS_FOOTPRINT: ProcessMapFootprint = { width: 4, height: 3 };
export const PROCESS_MAP_RESTRICTED_FOOTPRINT: ProcessMapFootprint = PROCESS_MAP_PROCESS_FOOTPRINT;

export function processMapFootprint(resourceType?: ProcessMapResourceType, restricted = false): ProcessMapFootprint {
  if (restricted) return PROCESS_MAP_RESTRICTED_FOOTPRINT;
  return resourceType === "company_explorer_folder" ? PROCESS_MAP_FOLDER_FOOTPRINT : PROCESS_MAP_PROCESS_FOOTPRINT;
}

export function snapProcessMapGridCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export function processMapGridToFlowPosition(point: ProcessMapGridPoint): ProcessMapGridPoint {
  return {
    x: snapProcessMapGridCoordinate(point.x) * PROCESS_MAP_GRID_PX,
    y: snapProcessMapGridCoordinate(point.y) * PROCESS_MAP_GRID_PX,
  };
}

export function processMapGridPointToFlowPosition(point: ProcessMapGridPoint): ProcessMapGridPoint {
  return { x: point.x * PROCESS_MAP_GRID_PX, y: point.y * PROCESS_MAP_GRID_PX };
}

export function processMapFlowToGridPosition(point: ProcessMapGridPoint): ProcessMapGridPoint {
  return {
    x: snapProcessMapGridCoordinate(point.x / PROCESS_MAP_GRID_PX),
    y: snapProcessMapGridCoordinate(point.y / PROCESS_MAP_GRID_PX),
  };
}

export function processMapFlowToRoutePoint(point: ProcessMapGridPoint): ProcessMapGridPoint {
  return {
    x: snapProcessMapGridCoordinate((point.x / PROCESS_MAP_GRID_PX) + 0.5),
    y: snapProcessMapGridCoordinate((point.y / PROCESS_MAP_GRID_PX) + 0.5),
  };
}

export function processMapRoutePointToSurfaceCenter(point: ProcessMapGridPoint): ProcessMapGridPoint {
  return { x: point.x - 0.5, y: point.y - 0.5 };
}

export function processMapInputAnchor(
  placement: ProcessMapGridPoint,
  resourceType: ProcessMapResourceType,
): ProcessMapGridPoint {
  const footprint = processMapFootprint(resourceType);
  return { x: placement.x, y: placement.y + footprint.height / 2 };
}

export function processMapOutputAnchor(
  placement: ProcessMapGridPoint,
  resourceType: ProcessMapResourceType,
): ProcessMapGridPoint {
  const footprint = processMapFootprint(resourceType);
  return { x: placement.x + footprint.width, y: placement.y + footprint.height / 2 };
}

function samePoint(left: ProcessMapGridPoint, right: ProcessMapGridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function appendDistinct(points: ProcessMapGridPoint[], point: ProcessMapGridPoint): void {
  if (!points.length || !samePoint(points[points.length - 1], point)) points.push(point);
}

export function normalizeProcessMapRoutePoints(points: readonly ProcessMapGridPoint[]): ProcessMapGridPoint[] {
  const normalized: ProcessMapGridPoint[] = [];
  for (const point of points.slice(0, PROCESS_MAP_MAX_ROUTE_POINTS)) {
    appendDistinct(normalized, {
      x: snapProcessMapGridCoordinate(point.x),
      y: snapProcessMapGridCoordinate(point.y),
    });
  }
  return normalized;
}

export function orthogonalizeProcessMapRoutePoints(points: readonly ProcessMapGridPoint[]): ProcessMapGridPoint[] {
  const normalized = normalizeProcessMapRoutePoints(points);
  if (normalized.length < 2) return normalized;
  const orthogonal: ProcessMapGridPoint[] = [normalized[0]];
  for (const point of normalized.slice(1)) {
    const previous = orthogonal[orthogonal.length - 1];
    if (previous.x !== point.x && previous.y !== point.y) {
      appendDistinct(orthogonal, { x: point.x, y: previous.y });
    }
    appendDistinct(orthogonal, point);
    if (orthogonal.length >= PROCESS_MAP_MAX_ROUTE_POINTS) break;
  }
  return orthogonal.slice(0, PROCESS_MAP_MAX_ROUTE_POINTS);
}

export function defaultProcessMapRoutePoints(
  source: ProcessMapGridPoint,
  target: ProcessMapGridPoint,
): ProcessMapGridPoint[] {
  const sourceY = snapProcessMapGridCoordinate(source.y);
  const targetY = snapProcessMapGridCoordinate(target.y);
  if (source.x >= target.x) {
    const sourceExitX = snapProcessMapGridCoordinate(source.x + 2);
    const targetEntryX = snapProcessMapGridCoordinate(target.x - 2);
    const clearanceY = snapProcessMapGridCoordinate(Math.floor(Math.min(source.y, target.y)) - 3);
    return normalizeProcessMapRoutePoints([
      { x: sourceExitX, y: sourceY },
      { x: sourceExitX, y: clearanceY },
      { x: targetEntryX, y: clearanceY },
      { x: targetEntryX, y: targetY },
    ]).filter((point) => !samePoint(point, source) && !samePoint(point, target));
  }
  const middleX = snapProcessMapGridCoordinate((source.x + target.x) / 2);
  if (sourceY === targetY) return [];
  return normalizeProcessMapRoutePoints([
    { x: middleX, y: sourceY },
    { x: middleX, y: targetY },
  ]);
}

function renderProcessMapOrthogonalPolyline(
  source: ProcessMapGridPoint,
  routePoints: readonly ProcessMapGridPoint[],
  target: ProcessMapGridPoint,
): ProcessMapGridPoint[] {
  if (routePoints.length === 0) {
    const fallback = defaultProcessMapRoutePoints(source, target);
    if (fallback.length === 0) return [source, target];
    return renderProcessMapOrthogonalPolyline(
      source,
      fallback.map(processMapRoutePointToSurfaceCenter),
      target,
    );
  }
  const requested = [source, ...routePoints, target];
  const rendered: ProcessMapGridPoint[] = [];
  for (const [index, point] of requested.entries()) {
    const previous = rendered[rendered.length - 1];
    if (previous && previous.x !== point.x && previous.y !== point.y) {
      appendDistinct(rendered, index === requested.length - 1
        ? { x: previous.x, y: point.y }
        : { x: point.x, y: previous.y });
    }
    appendDistinct(rendered, point);
  }
  return rendered;
}

function pointToSegmentDistanceSquared(
  point: ProcessMapGridPoint,
  start: ProcessMapGridPoint,
  end: ProcessMapGridPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const projectedX = start.x + projection * dx;
  const projectedY = start.y + projection * dy;
  return (point.x - projectedX) ** 2 + (point.y - projectedY) ** 2;
}

export function insertProcessMapRoutePoint(
  source: ProcessMapGridPoint,
  routePoints: readonly ProcessMapGridPoint[],
  target: ProcessMapGridPoint,
  point: ProcessMapGridPoint,
): ProcessMapGridPoint[] {
  const normalized = normalizeProcessMapRoutePoints(routePoints);
  const sequence = [source, ...normalized, target];
  let insertionIndex = normalized.length;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < sequence.length - 1; index += 1) {
    const distance = pointToSegmentDistanceSquared(point, sequence[index], sequence[index + 1]);
    if (distance >= nearestDistance) continue;
    nearestDistance = distance;
    insertionIndex = index;
  }
  const next = [...normalized];
  next.splice(insertionIndex, 0, {
    x: snapProcessMapGridCoordinate(point.x),
    y: snapProcessMapGridCoordinate(point.y),
  });
  return next;
}

export function processMapTracePath(
  source: ProcessMapGridPoint,
  routePoints: readonly ProcessMapGridPoint[],
  target: ProcessMapGridPoint,
): string {
  const surfaceCenters = routePoints.map(processMapRoutePointToSurfaceCenter);
  const points = renderProcessMapOrthogonalPolyline(source, surfaceCenters, target)
    .map(processMapGridPointToFlowPosition);
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}
