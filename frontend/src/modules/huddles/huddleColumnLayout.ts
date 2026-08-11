export type HuddleColumnLayout = readonly [number, number, number];

export const DEFAULT_HUDDLE_COLUMN_LAYOUT: HuddleColumnLayout = [0.5, 0.2, 0.3];

export function resizeHuddleColumns(
  layout: HuddleColumnLayout,
  divider: 0 | 1,
  deltaFraction: number,
  minimums: HuddleColumnLayout = [0.24, 0.14, 0.2],
): HuddleColumnLayout {
  const next = [...layout] as [number, number, number];
  const leftIndex = divider;
  const rightIndex = divider + 1;
  const pairTotal = next[leftIndex] + next[rightIndex];
  const nextLeft = Math.max(minimums[leftIndex], Math.min(pairTotal - minimums[rightIndex], next[leftIndex] + deltaFraction));
  next[leftIndex] = nextLeft;
  next[rightIndex] = pairTotal - nextLeft;
  return next;
}
