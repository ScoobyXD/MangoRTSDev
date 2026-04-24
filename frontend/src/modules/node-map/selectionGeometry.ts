export type SelectionRect = { minX: number; minY: number; maxX: number; maxY: number };
export type Point = { x: number; y: number };

const pointInRect = (point: Point, rect: SelectionRect) => point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;

const orientation = (a: Point, b: Point, c: Point) => {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-7) return 0;
  return value > 0 ? 1 : 2;
};

const onSegment = (a: Point, b: Point, c: Point) => (
  b.x <= Math.max(a.x, c.x) && b.x >= Math.min(a.x, c.x) && b.y <= Math.max(a.y, c.y) && b.y >= Math.min(a.y, c.y)
);

const segmentsIntersect = (p1: Point, q1: Point, p2: Point, q2: Point) => {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
};

export const doesPolylineIntersectRect = (points: Point[], rect: SelectionRect) => {
  if (points.length === 0) return false;
  if (points.some((point) => pointInRect(point, rect))) return true;

  const rectSegments: Array<[Point, Point]> = [
    [{ x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY }],
    [{ x: rect.maxX, y: rect.minY }, { x: rect.maxX, y: rect.maxY }],
    [{ x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }],
    [{ x: rect.minX, y: rect.maxY }, { x: rect.minX, y: rect.minY }],
  ];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segMinX = Math.min(start.x, end.x);
    const segMaxX = Math.max(start.x, end.x);
    const segMinY = Math.min(start.y, end.y);
    const segMaxY = Math.max(start.y, end.y);
    if (segMaxX < rect.minX || segMinX > rect.maxX || segMaxY < rect.minY || segMinY > rect.maxY) continue;
    for (const [left, right] of rectSegments) {
      if (segmentsIntersect(start, end, left, right)) return true;
    }
  }

  return false;
};
