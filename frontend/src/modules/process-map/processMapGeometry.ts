// These implementation bounds keep the smallest saved placement visible from a
// whole-company fit through editing detail without turning camera or tile state
// into business data. Tile/cache/request values are deliberately bounded.
export const PROCESS_MAP_MAX_ROUTE_POINTS = 256;
export const PROCESS_MAP_PROCESS_DROP_WIDTH_PX = 196;
export const PROCESS_MAP_PROCESS_DROP_HEIGHT_PX = 140;
export const PROCESS_MAP_FOLDER_DROP_WIDTH_PX = 196;
export const PROCESS_MAP_FOLDER_DROP_HEIGHT_PX = 196;
export const PROCESS_MAP_PROCESS_MIN_WIDTH = 2;
export const PROCESS_MAP_PROCESS_MIN_HEIGHT = 1;
export const PROCESS_MAP_FOLDER_MIN_WIDTH = 2;
export const PROCESS_MAP_FOLDER_MIN_HEIGHT = 2;
export const PROCESS_MAP_MAX_DIMENSION = 1_000_000;
export const PROCESS_MAP_RESTRICTED_WIDTH = 4;
export const PROCESS_MAP_RESTRICTED_HEIGHT = 3;
export const PROCESS_MAP_TILE_SIZE = 256;
export const PROCESS_MAP_TILE_CACHE_BYTES = 32 * 1024 * 1024;
export const PROCESS_MAP_MAX_TILE_REQUESTS = 6;
export const PROCESS_MAP_TILE_DEBOUNCE_MS = 60;
export const PROCESS_MAP_SETTLE_DELAY_MS = 180;
export const PROCESS_MAP_NORMAL_LOD_MIN_PX = 24;
export const PROCESS_MAP_EDITING_LOD_MIN_PX = 96;
export const PROCESS_MAP_MIN_CAMERA_ZOOM = -24;
export const PROCESS_MAP_MAX_CAMERA_ZOOM = 20;
export const PROCESS_MAP_SAFE_WORLD_COORDINATE = 1_000_000_000;

export function processMapDeckTileSize(tileSize: number, maxTileZoom: number): number {
  return tileSize * 2 ** maxTileZoom;
}

export type ProcessMapResourceType = "company_explorer_folder" | "logic_gate";

export type ProcessMapGridPoint = { x: number; y: number };

export type ProcessMapBounds = {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
};

export type ProcessMapPlacementGeometry = {
  grid_x: number;
  grid_y: number;
  grid_width: number;
  grid_height: number;
};

export type ProcessMapViewState = {
  target: [number, number, number];
  zoom: number;
  minZoom: number;
  maxZoom: number;
};

export type ProcessMapPlacementLOD = "whole" | "normal" | "editing";

type ProcessMapFolderGeometry = ProcessMapPlacementGeometry & {
  resource_id: string;
  map_parent_folder_id: string | null;
};

export function snapProcessMapGridCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export function snapProcessMapDimensions(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(1, snapProcessMapGridCoordinate(width)),
    height: Math.max(1, snapProcessMapGridCoordinate(height)),
  };
}

export function processMapMinimumPlacementDimensions(resourceType: ProcessMapResourceType): { width: number; height: number } {
  return resourceType === "company_explorer_folder"
    ? { width: PROCESS_MAP_FOLDER_MIN_WIDTH, height: PROCESS_MAP_FOLDER_MIN_HEIGHT }
    : { width: PROCESS_MAP_PROCESS_MIN_WIDTH, height: PROCESS_MAP_PROCESS_MIN_HEIGHT };
}

export function processMapInitialPlacementDimensions(
  resourceType: ProcessMapResourceType,
  pixelsPerGridUnit: number,
): { width: number; height: number } {
  const scale = Number.isFinite(pixelsPerGridUnit) && pixelsPerGridUnit > 0 ? pixelsPerGridUnit : 1;
  const target = resourceType === "company_explorer_folder"
    ? { width: PROCESS_MAP_FOLDER_DROP_WIDTH_PX, height: PROCESS_MAP_FOLDER_DROP_HEIGHT_PX }
    : { width: PROCESS_MAP_PROCESS_DROP_WIDTH_PX, height: PROCESS_MAP_PROCESS_DROP_HEIGHT_PX };
  const minimum = processMapMinimumPlacementDimensions(resourceType);
  return {
    width: Math.min(PROCESS_MAP_MAX_DIMENSION, Math.max(minimum.width, Math.round(target.width / scale))),
    height: Math.min(PROCESS_MAP_MAX_DIMENSION, Math.max(minimum.height, Math.round(target.height / scale))),
  };
}

export function resizeProcessMapPlacement(
  placement: ProcessMapPlacementGeometry,
  resourceType: ProcessMapResourceType,
  deltaX: number,
  deltaY: number,
  horizontal: "west" | "east",
  vertical: "north" | "south",
): ProcessMapPlacementGeometry {
  const minimum = processMapMinimumPlacementDimensions(resourceType);
  let minX = placement.grid_x;
  let minY = placement.grid_y;
  let maxX = placement.grid_x + placement.grid_width;
  let maxY = placement.grid_y + placement.grid_height;
  if (horizontal === "west") minX = Math.min(maxX - minimum.width, minX + deltaX);
  else maxX = Math.max(minX + minimum.width, maxX + deltaX);
  if (vertical === "north") minY = Math.min(maxY - minimum.height, minY + deltaY);
  else maxY = Math.max(minY + minimum.height, maxY + deltaY);
  return {
    grid_x: minX,
    grid_y: minY,
    grid_width: maxX - minX,
    grid_height: maxY - minY,
  };
}

export function processMapPlacementBounds(placement: ProcessMapPlacementGeometry): ProcessMapBounds {
  return {
    min_x: placement.grid_x,
    min_y: placement.grid_y,
    max_x: placement.grid_x + placement.grid_width,
    max_y: placement.grid_y + placement.grid_height,
  };
}

export function processMapBoundsContain(outer: ProcessMapBounds, inner: ProcessMapBounds): boolean {
  return inner.min_x >= outer.min_x
    && inner.min_y >= outer.min_y
    && inner.max_x <= outer.max_x
    && inner.max_y <= outer.max_y;
}

function folderDepth(folder: ProcessMapFolderGeometry, byID: ReadonlyMap<string, ProcessMapFolderGeometry>): number {
  let depth = 0;
  let current: ProcessMapFolderGeometry | undefined = folder;
  const visited = new Set<string>();
  while (current?.map_parent_folder_id) {
    if (visited.has(current.resource_id)) return -1;
    visited.add(current.resource_id);
    current = byID.get(current.map_parent_folder_id);
    if (!current) return depth;
    depth += 1;
  }
  return depth;
}

function folderDescendsFrom(folder: ProcessMapFolderGeometry, ancestorID: string, byID: ReadonlyMap<string, ProcessMapFolderGeometry>): boolean {
  let parentID = folder.map_parent_folder_id;
  const visited = new Set<string>();
  while (parentID) {
    if (parentID === ancestorID) return true;
    if (visited.has(parentID)) return true;
    visited.add(parentID);
    parentID = byID.get(parentID)?.map_parent_folder_id ?? null;
  }
  return false;
}

export function processMapDeepestContainingFolder<T extends ProcessMapFolderGeometry>(
  finalBounds: ProcessMapBounds,
  folders: readonly T[],
  excludedFolderID?: string,
): T | null {
  const byID = new Map(folders.map((folder) => [folder.resource_id, folder]));
  return folders
    .filter((folder) => folder.resource_id !== excludedFolderID)
    .filter((folder) => !excludedFolderID || !folderDescendsFrom(folder, excludedFolderID, byID))
    .filter((folder) => processMapBoundsContain(processMapPlacementBounds(folder), finalBounds))
    .sort((left, right) => {
      const depthDelta = folderDepth(right, byID) - folderDepth(left, byID);
      if (depthDelta) return depthDelta;
      const leftArea = left.grid_width * left.grid_height;
      const rightArea = right.grid_width * right.grid_height;
      return leftArea - rightArea || left.resource_id.localeCompare(right.resource_id);
    })[0] ?? null;
}

export function processMapPlacementLOD(
  placement: Pick<ProcessMapPlacementGeometry, "grid_width" | "grid_height">,
  pixelsPerGridUnit: number,
): ProcessMapPlacementLOD {
  const shortestProjectedSide = Math.min(placement.grid_width, placement.grid_height) * Math.max(0, pixelsPerGridUnit);
  if (shortestProjectedSide >= PROCESS_MAP_EDITING_LOD_MIN_PX) return "editing";
  if (shortestProjectedSide >= PROCESS_MAP_NORMAL_LOD_MIN_PX) return "normal";
  return "whole";
}

export function processMapCappedLOD(
  exactLOD: ProcessMapPlacementLOD,
  maxPresentation: ProcessMapPlacementLOD,
): ProcessMapPlacementLOD {
  const rank: Record<ProcessMapPlacementLOD, number> = { whole: 0, normal: 1, editing: 2 };
  return rank[exactLOD] <= rank[maxPresentation] ? exactLOD : maxPresentation;
}

export function processMapPlacementDisplayLOD(
  placement: Pick<ProcessMapPlacementGeometry, "grid_width" | "grid_height"> & { presentation: ProcessMapPlacementLOD },
  pixelsPerGridUnit: number,
): ProcessMapPlacementLOD {
  return processMapCappedLOD(processMapPlacementLOD(placement, pixelsPerGridUnit), placement.presentation);
}

export function fitProcessMapViewState(
  bounds: ProcessMapBounds | null,
  viewport: { width: number; height: number },
  options: { padding?: number; minZoom?: number; maxZoom?: number } = {},
): ProcessMapViewState {
  const minZoom = options.minZoom ?? PROCESS_MAP_MIN_CAMERA_ZOOM;
  const maxZoom = options.maxZoom ?? PROCESS_MAP_MAX_CAMERA_ZOOM;
  if (!bounds) return { target: [0, 0, 0], zoom: 0, minZoom, maxZoom };
  const padding = Math.max(0, options.padding ?? 64);
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const worldWidth = Math.max(1, bounds.max_x - bounds.min_x);
  const worldHeight = Math.max(1, bounds.max_y - bounds.min_y);
  const scale = Math.max(Number.MIN_VALUE, Math.min(availableWidth / worldWidth, availableHeight / worldHeight));
  return {
    target: [(bounds.min_x + bounds.max_x) / 2, (bounds.min_y + bounds.max_y) / 2, 0],
    zoom: Math.max(minZoom, Math.min(maxZoom, Math.log2(scale))),
    minZoom,
    maxZoom,
  };
}

export function processMapInputAnchor(placement: ProcessMapPlacementGeometry): ProcessMapGridPoint {
  return { x: placement.grid_x, y: placement.grid_y + placement.grid_height / 2 };
}

export function processMapOutputAnchor(placement: ProcessMapPlacementGeometry): ProcessMapGridPoint {
  return { x: placement.grid_x + placement.grid_width, y: placement.grid_y + placement.grid_height / 2 };
}

function samePoint(left: ProcessMapGridPoint, right: ProcessMapGridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function appendDistinct(points: ProcessMapGridPoint[], point: ProcessMapGridPoint): void {
  if (!points.length || !samePoint(points[points.length - 1], point)) points.push(point);
}

function appendSimplifiedRenderedPoint(points: ProcessMapGridPoint[], point: ProcessMapGridPoint): void {
  appendDistinct(points, point);
  while (points.length >= 3) {
    const end = points.length - 1;
    const before = points[end - 2];
    const middle = points[end - 1];
    const after = points[end];
    if (!((before.x === middle.x && middle.x === after.x) || (before.y === middle.y && middle.y === after.y))) return;
    points.splice(end - 1, 1);
    if (points.length >= 2 && samePoint(points[points.length - 2], points[points.length - 1])) points.pop();
  }
}

export function normalizeProcessMapRoutePoints(points: readonly ProcessMapGridPoint[]): ProcessMapGridPoint[] {
  const normalized: ProcessMapGridPoint[] = [];
  for (const point of points.slice(0, PROCESS_MAP_MAX_ROUTE_POINTS)) {
    appendDistinct(normalized, { x: snapProcessMapGridCoordinate(point.x), y: snapProcessMapGridCoordinate(point.y) });
  }
  return normalized;
}

export function orthogonalizeProcessMapRoutePoints(points: readonly ProcessMapGridPoint[]): ProcessMapGridPoint[] {
  const normalized = normalizeProcessMapRoutePoints(points);
  if (normalized.length < 2) return normalized;
  const orthogonal: ProcessMapGridPoint[] = [normalized[0]];
  for (const point of normalized.slice(1)) {
    const previous = orthogonal[orthogonal.length - 1];
    if (previous.x !== point.x && previous.y !== point.y) appendDistinct(orthogonal, { x: point.x, y: previous.y });
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
  if (source.y === target.y) return [];
  const middleX = snapProcessMapGridCoordinate((source.x + target.x) / 2);
  return normalizeProcessMapRoutePoints([
    { x: middleX, y: sourceY },
    { x: middleX, y: targetY },
  ]).filter((point) => !samePoint(point, source) && !samePoint(point, target));
}

export function processMapOrthogonalPathPoints(
  source: ProcessMapGridPoint,
  routePoints: readonly ProcessMapGridPoint[],
  target: ProcessMapGridPoint,
): ProcessMapGridPoint[] {
  const requested = [source, ...routePoints, target];
  const rendered: ProcessMapGridPoint[] = [];
  for (const [index, point] of requested.entries()) {
    const previous = rendered[rendered.length - 1];
    if (previous && previous.x !== point.x && previous.y !== point.y) {
      appendSimplifiedRenderedPoint(rendered, index === requested.length - 1
        ? { x: previous.x, y: point.y }
        : { x: point.x, y: previous.y });
    }
    appendSimplifiedRenderedPoint(rendered, point);
  }
  return rendered;
}

function pointToSegmentDistanceSquared(point: ProcessMapGridPoint, start: ProcessMapGridPoint, end: ProcessMapGridPoint): number {
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
  next.splice(insertionIndex, 0, { x: snapProcessMapGridCoordinate(point.x), y: snapProcessMapGridCoordinate(point.y) });
  return next;
}
