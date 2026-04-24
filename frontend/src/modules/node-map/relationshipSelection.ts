export type ScreenPoint = { x: number; y: number };

export type ScreenRect = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const EPSILON = 0.000001;

const pointInRect = (point: ScreenPoint, rect: ScreenRect) => (
  point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
);

const orientation = (a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) => {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < EPSILON) return 0;
  return value > 0 ? 1 : 2;
};

const onSegment = (a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) => (
  b.x <= Math.max(a.x, c.x) + EPSILON &&
  b.x + EPSILON >= Math.min(a.x, c.x) &&
  b.y <= Math.max(a.y, c.y) + EPSILON &&
  b.y + EPSILON >= Math.min(a.y, c.y)
);

const segmentsIntersect = (a1: ScreenPoint, a2: ScreenPoint, b1: ScreenPoint, b2: ScreenPoint) => {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
};

export const segmentIntersectsRect = (from: ScreenPoint, to: ScreenPoint, rect: ScreenRect) => {
  if (pointInRect(from, rect) || pointInRect(to, rect)) return true;

  if (Math.max(from.x, to.x) < rect.minX || Math.min(from.x, to.x) > rect.maxX) return false;
  if (Math.max(from.y, to.y) < rect.minY || Math.min(from.y, to.y) > rect.maxY) return false;

  const topLeft = { x: rect.minX, y: rect.minY };
  const topRight = { x: rect.maxX, y: rect.minY };
  const bottomLeft = { x: rect.minX, y: rect.maxY };
  const bottomRight = { x: rect.maxX, y: rect.maxY };

  return (
    segmentsIntersect(from, to, topLeft, topRight) ||
    segmentsIntersect(from, to, topRight, bottomRight) ||
    segmentsIntersect(from, to, bottomRight, bottomLeft) ||
    segmentsIntersect(from, to, bottomLeft, topLeft)
  );
};

export const pathIntersectsRect = (points: ScreenPoint[], rect: ScreenRect) => {
  if (points.length < 2) return false;
  for (let i = 1; i < points.length; i += 1) {
    if (segmentIntersectsRect(points[i - 1], points[i], rect)) return true;
  }
  return false;
};
