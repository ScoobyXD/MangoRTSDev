const FOOTPRINT_GRID = 12;

export type NodeFootprintPosition = { x: number; y: number };
export type NodeFootprintSize = { w: number; h: number };
export type NodeFootprintRectangle = NodeFootprintPosition & NodeFootprintSize;

export type NodeFootprintLayout = {
  positions: Record<string, NodeFootprintPosition>;
  sizes: Record<string, NodeFootprintSize>;
};

export function rectanglesOverlapWithGap(
  first: NodeFootprintRectangle,
  second: NodeFootprintRectangle,
  gap = 0,
): boolean {
  const safeGap = Math.max(0, finiteOr(gap, 0));
  return first.x < second.x + second.w + safeGap
    && first.x + first.w + safeGap > second.x
    && first.y < second.y + second.h + safeGap
    && first.y + first.h + safeGap > second.y;
}

export function resizeNodeFootprint(input: {
  nodeID: string;
  nextSize: NodeFootprintSize;
  nextPosition?: NodeFootprintPosition;
  positions: Record<string, NodeFootprintPosition>;
  sizes: Record<string, NodeFootprintSize>;
  defaultSize: NodeFootprintSize;
  worldWidth: number;
  worldHeight: number;
  gap?: number;
  verticalAnchor?: "bottom" | "top";
}): NodeFootprintLayout {
  const worldWidth = snappedWorldExtent(input.worldWidth);
  const worldHeight = snappedWorldExtent(input.worldHeight);
  const defaultSize = boundSize(input.defaultSize, worldWidth, worldHeight);
  const gap = snapGap(input.gap ?? FOOTPRINT_GRID);
  const nodeIDs = Array.from(new Set([
    ...Object.keys(input.positions),
    ...Object.keys(input.sizes),
    input.nodeID,
  ])).filter(Boolean);

  const sizes: Record<string, NodeFootprintSize> = {};
  const positions: Record<string, NodeFootprintPosition> = {};
  for (const nodeID of nodeIDs) {
    sizes[nodeID] = boundSize(input.sizes[nodeID] ?? defaultSize, worldWidth, worldHeight);
    positions[nodeID] = normalizePosition(
      input.positions[nodeID] ?? { x: 0, y: 0 },
      sizes[nodeID],
      worldWidth,
      worldHeight,
    );
  }

  const previousSize = sizes[input.nodeID] ?? defaultSize;
  const previousPosition = positions[input.nodeID] ?? { x: 0, y: 0 };
  const nextSize = normalizeSize(input.nextSize, worldWidth, worldHeight);
  const desiredPosition = input.nextPosition ?? {
    x: previousPosition.x,
    y: input.verticalAnchor === "top"
      ? previousPosition.y
      : previousPosition.y + previousSize.h - nextSize.h,
  };

  sizes[input.nodeID] = nextSize;
  positions[input.nodeID] = normalizePosition(
    { x: desiredPosition.x, y: Math.max(0, desiredPosition.y) },
    nextSize,
    worldWidth,
    worldHeight,
  );

  const expanded = nextSize.w > previousSize.w || nextSize.h > previousSize.h;
  if (!expanded) return { positions, sizes };

  const activeID = input.nodeID;
  const movableIDs = nodeIDs.filter((nodeID) => nodeID !== activeID).sort();
  const rectFor = (nodeID: string): NodeFootprintRectangle => ({
    ...positions[nodeID]!,
    ...sizes[nodeID]!,
  });

  const restorePositions = (snapshot: Record<string, NodeFootprintPosition>): void => {
    for (const nodeID of nodeIDs) positions[nodeID] = { ...snapshot[nodeID]! };
  };
  const snapshotPositions = (): Record<string, NodeFootprintPosition> => Object.fromEntries(
    nodeIDs.map((nodeID) => [nodeID, { ...positions[nodeID]! }]),
  );

  const pushNode = (nodeID: string, obstacleID: string, protectedIDs: ReadonlySet<string>): boolean => {
    const beforeAttempt = snapshotPositions();
    const target = rectFor(nodeID);
    const obstacle = rectFor(obstacleID);
    const verticalDirections: Direction[] = target.y + target.h / 2 < obstacle.y + obstacle.h / 2
      ? ["up", "down"]
      : ["down", "up"];
    const horizontalDirections: Direction[] = target.x + target.w / 2 < obstacle.x + obstacle.w / 2
      ? ["left", "right"]
      : ["right", "left"];

    for (const direction of [verticalDirections[0]!, ...horizontalDirections, verticalDirections[1]!]) {
      restorePositions(beforeAttempt);
      const candidate = positionOutside(rectFor(nodeID), rectFor(obstacleID), direction, gap, worldWidth, worldHeight);
      if (!candidate) continue;
      positions[nodeID] = candidate;

      if (Array.from(protectedIDs).some((protectedID) => (
        rectanglesOverlapWithGap(rectFor(nodeID), rectFor(protectedID), gap)
      ))) continue;

      const collisions = movableIDs.filter((otherID) => (
        otherID !== nodeID
        && !protectedIDs.has(otherID)
        && rectanglesOverlapWithGap(rectFor(nodeID), rectFor(otherID), gap)
      ));
      const nextProtected = new Set(protectedIDs);
      nextProtected.add(nodeID);
      if (!collisions.every((collisionID) => pushNode(collisionID, nodeID, nextProtected))) continue;

      const stillOverlaps = nodeIDs.some((otherID) => (
        otherID !== nodeID
        && rectanglesOverlapWithGap(rectFor(nodeID), rectFor(otherID), gap)
      ));
      if (!stillOverlaps) return true;
    }

    restorePositions(beforeAttempt);
    return false;
  };

  for (const nodeID of movableIDs) {
    if (!rectanglesOverlapWithGap(rectFor(activeID), rectFor(nodeID), gap)) continue;
    pushNode(nodeID, activeID, new Set([activeID]));
  }

  return { positions, sizes };
}

type Direction = "up" | "down" | "left" | "right";

function positionOutside(
  target: NodeFootprintRectangle,
  obstacle: NodeFootprintRectangle,
  direction: Direction,
  gap: number,
  worldWidth: number,
  worldHeight: number,
): NodeFootprintPosition | null {
  const maxX = Math.max(0, worldWidth - target.w);
  const maxY = Math.max(0, worldHeight - target.h);
  let x = clampToGrid(target.x, 0, maxX);
  let y = clampToGrid(target.y, 0, maxY);
  if (direction === "up") y = obstacle.y - gap - target.h;
  if (direction === "down") y = obstacle.y + obstacle.h + gap;
  if (direction === "left") x = obstacle.x - gap - target.w;
  if (direction === "right") x = obstacle.x + obstacle.w + gap;
  if (x < 0 || x > maxX || y < 0 || y > maxY) return null;
  return { x: snap(x), y: snap(y) };
}

function normalizeSize(size: NodeFootprintSize, worldWidth: number, worldHeight: number): NodeFootprintSize {
  return {
    w: clampToGrid(Math.max(FOOTPRINT_GRID, finiteOr(size.w, FOOTPRINT_GRID)), FOOTPRINT_GRID, worldWidth),
    h: clampToGrid(Math.max(FOOTPRINT_GRID, finiteOr(size.h, FOOTPRINT_GRID)), FOOTPRINT_GRID, worldHeight),
  };
}

function boundSize(size: NodeFootprintSize, worldWidth: number, worldHeight: number): NodeFootprintSize {
  return {
    w: Math.min(worldWidth, Math.max(FOOTPRINT_GRID, finiteOr(size.w, FOOTPRINT_GRID))),
    h: Math.min(worldHeight, Math.max(FOOTPRINT_GRID, finiteOr(size.h, FOOTPRINT_GRID))),
  };
}

function normalizePosition(
  position: NodeFootprintPosition,
  size: NodeFootprintSize,
  worldWidth: number,
  worldHeight: number,
): NodeFootprintPosition {
  return {
    x: clampToGrid(finiteOr(position.x, 0), 0, Math.max(0, worldWidth - size.w)),
    y: clampToGrid(finiteOr(position.y, 0), 0, Math.max(0, worldHeight - size.h)),
  };
}

function snappedWorldExtent(value: number): number {
  return Math.max(FOOTPRINT_GRID, Math.floor(Math.max(FOOTPRINT_GRID, finiteOr(value, FOOTPRINT_GRID)) / FOOTPRINT_GRID) * FOOTPRINT_GRID);
}

function snapGap(value: number): number {
  return Math.max(0, Math.ceil(Math.max(0, finiteOr(value, 0)) / FOOTPRINT_GRID) * FOOTPRINT_GRID);
}

function clampToGrid(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, snap(value)));
}

function snap(value: number): number {
  return Math.round(value / FOOTPRINT_GRID) * FOOTPRINT_GRID;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
