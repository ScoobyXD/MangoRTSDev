import type { NodeDirection, NodePosition, NodeRecord } from "./shared";
import { clamp, MINI_GRID, NODE_H, NODE_W, snapToGrid } from "./shared";

export type NodeMapRoutingGrid = {
  step: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
};

export function getNodeMapAnchorPoint({
  nodeID,
  side,
  nodePositions,
  nodeWidth = NODE_W,
  nodeHeight = NODE_H,
}: {
  nodeID: string;
  side: NodeDirection;
  nodePositions: Record<string, NodePosition>;
  nodeWidth?: number;
  nodeHeight?: number;
}): { x: number; y: number } | null {
  const pos = nodePositions[nodeID];
  if (!pos) return null;
  if (side === "left") return { x: pos.x, y: pos.y + nodeHeight / 2 };
  if (side === "right") return { x: pos.x + nodeWidth, y: pos.y + nodeHeight / 2 };
  if (side === "top") return { x: pos.x + nodeWidth / 2, y: pos.y };
  return { x: pos.x + nodeWidth / 2, y: pos.y + nodeHeight };
}

export function buildNodeMapRelationshipRoutingGrid({
  nodes,
  nodePositions,
  worldWidth,
  worldHeight,
  nodeWidth = NODE_W,
  nodeHeight = NODE_H,
  step = MINI_GRID,
}: {
  nodes: NodeRecord[];
  nodePositions: Record<string, NodePosition>;
  worldWidth: number;
  worldHeight: number;
  nodeWidth?: number;
  nodeHeight?: number;
  step?: number;
}): NodeMapRoutingGrid {
  const cols = Math.floor(worldWidth / step) + 1;
  const rows = Math.floor(worldHeight / step) + 1;
  const blocked = new Uint8Array(cols * rows);
  const margin = step;

  for (const node of nodes) {
    const pos = nodePositions[node.node_id];
    if (!pos) continue;
    const minX = Math.max(0, Math.floor((pos.x - margin) / step));
    const maxX = Math.min(cols - 1, Math.ceil((pos.x + nodeWidth + margin) / step));
    const minY = Math.max(0, Math.floor((pos.y - margin) / step));
    const maxY = Math.min(rows - 1, Math.ceil((pos.y + nodeHeight + margin) / step));
    for (let gy = minY; gy <= maxY; gy += 1) {
      for (let gx = minX; gx <= maxX; gx += 1) {
        blocked[gy * cols + gx] = 1;
      }
    }
  }

  return { step, cols, rows, blocked };
}

function simplifyOrthogonalPoints(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const collapsed = points.filter((point, index, list) => {
    if (index === 0) return true;
    const prev = list[index - 1];
    return prev.x !== point.x || prev.y !== point.y;
  });

  const simplified = [collapsed[0]];
  for (let i = 1; i < collapsed.length - 1; i += 1) {
    const prev = simplified[simplified.length - 1];
    const currentPoint = collapsed[i];
    const next = collapsed[i + 1];
    const sameLine = (prev.x === currentPoint.x && currentPoint.x === next.x) || (prev.y === currentPoint.y && currentPoint.y === next.y);
    if (!sameLine) simplified.push(currentPoint);
  }
  simplified.push(collapsed[collapsed.length - 1]);
  return simplified.map((point) => ({ x: snapToGrid(point.x), y: snapToGrid(point.y) }));
}

export function routeNodeMapOrthogonalPath({
  from,
  fromOut,
  toIn,
  to,
  sourceNodeID,
  targetNodeID,
  nodePositions,
  routingGrid,
  nodeWidth = NODE_W,
  nodeHeight = NODE_H,
}: {
  from: { x: number; y: number };
  fromOut: { x: number; y: number };
  toIn: { x: number; y: number };
  to: { x: number; y: number };
  sourceNodeID: string;
  targetNodeID: string;
  nodePositions: Record<string, NodePosition>;
  routingGrid: NodeMapRoutingGrid;
  nodeWidth?: number;
  nodeHeight?: number;
}): { x: number; y: number }[] {
  const { step, cols, rows, blocked } = routingGrid;
  const toCell = (point: { x: number; y: number }) => ({
    gx: clamp(Math.round(point.x / step), 0, cols - 1),
    gy: clamp(Math.round(point.y / step), 0, rows - 1),
  });
  const toPoint = (gx: number, gy: number) => ({ x: gx * step, y: gy * step });
  const key = (gx: number, gy: number) => gy * cols + gx;
  const sourcePos = nodePositions[sourceNodeID];
  const targetPos = nodePositions[targetNodeID];

  const isBlocked = (gx: number, gy: number) => {
    const idx = key(gx, gy);
    if (!blocked[idx]) return false;
    const worldX = gx * step;
    const worldY = gy * step;
    const isInsideSource = sourcePos && worldX >= sourcePos.x - step && worldX <= sourcePos.x + nodeWidth + step && worldY >= sourcePos.y - step && worldY <= sourcePos.y + nodeHeight + step;
    if (isInsideSource) return false;
    const isInsideTarget = targetPos && worldX >= targetPos.x - step && worldX <= targetPos.x + nodeWidth + step && worldY >= targetPos.y - step && worldY <= targetPos.y + nodeHeight + step;
    if (isInsideTarget) return false;
    return true;
  };

  const start = toCell(fromOut);
  const goal = toCell(toIn);
  const startKey = key(start.gx, start.gy);
  const goalKey = key(goal.gx, goal.gy);
  const queue = [startKey];
  const cameFrom = new Int32Array(cols * rows).fill(-1);
  const visited = new Uint8Array(cols * rows);
  visited[startKey] = 1;
  let found = false;

  for (let pointer = 0; pointer < queue.length; pointer += 1) {
    const current = queue[pointer];
    if (current === goalKey) {
      found = true;
      break;
    }
    const gx = current % cols;
    const gy = Math.floor(current / cols);
    const neighbors = [
      { gx: gx + 1, gy },
      { gx: gx - 1, gy },
      { gx, gy: gy + 1 },
      { gx, gy: gy - 1 },
    ];
    for (const next of neighbors) {
      if (next.gx < 0 || next.gx >= cols || next.gy < 0 || next.gy >= rows) continue;
      const nextKey = key(next.gx, next.gy);
      if (visited[nextKey]) continue;
      if (isBlocked(next.gx, next.gy) && nextKey !== goalKey) continue;
      visited[nextKey] = 1;
      cameFrom[nextKey] = current;
      queue.push(nextKey);
    }
  }

  const fallback = [from, fromOut, { x: toIn.x, y: fromOut.y }, toIn, to];
  if (!found) return fallback.map((point) => ({ x: snapToGrid(point.x), y: snapToGrid(point.y) }));

  const cells: number[] = [];
  let current = goalKey;
  while (current !== -1) {
    cells.push(current);
    if (current === startKey) break;
    current = cameFrom[current];
  }
  cells.reverse();

  const routed = cells.map((cell) => toPoint(cell % cols, Math.floor(cell / cols)));
  return simplifyOrthogonalPoints([from, fromOut, ...routed, toIn, to]);
}

export function routeNodeMapDraftPath({
  from,
  fromOut,
  cursor,
  sourceNodeID,
  nodePositions,
  routingGrid,
  nodeWidth = NODE_W,
  nodeHeight = NODE_H,
}: {
  from: { x: number; y: number };
  fromOut: { x: number; y: number };
  cursor: { x: number; y: number };
  sourceNodeID: string;
  nodePositions: Record<string, NodePosition>;
  routingGrid: NodeMapRoutingGrid;
  nodeWidth?: number;
  nodeHeight?: number;
}): { x: number; y: number }[] {
  const { step, cols, rows, blocked } = routingGrid;
  const toCell = (point: { x: number; y: number }) => ({
    gx: clamp(Math.round(point.x / step), 0, cols - 1),
    gy: clamp(Math.round(point.y / step), 0, rows - 1),
  });
  const toPoint = (gx: number, gy: number) => ({ x: gx * step, y: gy * step });
  const key = (gx: number, gy: number) => gy * cols + gx;
  const sourcePos = nodePositions[sourceNodeID];

  const isBlocked = (gx: number, gy: number) => {
    const idx = key(gx, gy);
    if (!blocked[idx]) return false;
    const worldX = gx * step;
    const worldY = gy * step;
    const isInsideSource = sourcePos && worldX >= sourcePos.x - step && worldX <= sourcePos.x + nodeWidth + step && worldY >= sourcePos.y - step && worldY <= sourcePos.y + nodeHeight + step;
    if (isInsideSource) return false;
    return true;
  };

  const start = toCell(fromOut);
  const goal = toCell(cursor);
  const startKey = key(start.gx, start.gy);
  const goalKey = key(goal.gx, goal.gy);
  const queue = [startKey];
  const cameFrom = new Int32Array(cols * rows).fill(-1);
  const visited = new Uint8Array(cols * rows);
  visited[startKey] = 1;
  let found = false;

  for (let pointer = 0; pointer < queue.length; pointer += 1) {
    const current = queue[pointer];
    if (current === goalKey) {
      found = true;
      break;
    }
    const gx = current % cols;
    const gy = Math.floor(current / cols);
    const neighbors = [
      { gx: gx + 1, gy },
      { gx: gx - 1, gy },
      { gx, gy: gy + 1 },
      { gx, gy: gy - 1 },
    ];
    for (const next of neighbors) {
      if (next.gx < 0 || next.gx >= cols || next.gy < 0 || next.gy >= rows) continue;
      const nextKey = key(next.gx, next.gy);
      if (visited[nextKey]) continue;
      if (isBlocked(next.gx, next.gy) && nextKey !== goalKey) continue;
      visited[nextKey] = 1;
      cameFrom[nextKey] = current;
      queue.push(nextKey);
    }
  }

  const snappedCursor = { x: snapToGrid(cursor.x), y: snapToGrid(cursor.y) };
  const fallback = [from, fromOut, { x: snappedCursor.x, y: fromOut.y }, snappedCursor];
  if (!found) return fallback;

  const cells: number[] = [];
  let current = goalKey;
  while (current !== -1) {
    cells.push(current);
    if (current === startKey) break;
    current = cameFrom[current];
  }
  cells.reverse();
  const routed = cells.map((cell) => toPoint(cell % cols, Math.floor(cell / cols)));
  return simplifyOrthogonalPoints([from, fromOut, ...routed, snappedCursor]);
}
