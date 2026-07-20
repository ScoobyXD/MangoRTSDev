export const UPDATES_NODE_PANEL_DEFAULT_MAIN_RATIO = 0.55;
export const UPDATES_NODE_PANEL_RESIZER_WIDTH_PX = 10;

const UPDATES_NODE_PANEL_MIN_RATIO = 0.2;
const UPDATES_NODE_PANEL_MAX_RATIO = 0.8;
const UPDATES_NODE_PANEL_MIN_MAIN_PX = 360;
const UPDATES_NODE_PANEL_MIN_NODE_PX = 420;
const UPDATES_NODE_PANEL_NARROW_MIN_MAIN_RATIO = 0.45;
const UPDATES_NODE_PANEL_NARROW_MAX_MAIN_RATIO = 0.55;

export function normalizeUpdatesNodePanelMainRatio(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return UPDATES_NODE_PANEL_DEFAULT_MAIN_RATIO;
  return Math.min(UPDATES_NODE_PANEL_MAX_RATIO, Math.max(UPDATES_NODE_PANEL_MIN_RATIO, parsed));
}

export function resolveUpdatesNodePanelMainRatio(input: {
  pointerClientX: number;
  containerLeft: number;
  containerWidth: number;
  paddingLeft?: number;
  paddingRight?: number;
}): number {
  const paddingLeft = Math.max(0, input.paddingLeft ?? 0);
  const paddingRight = Math.max(0, input.paddingRight ?? 0);
  const availableWidth = Math.max(
    1,
    input.containerWidth - paddingLeft - paddingRight - UPDATES_NODE_PANEL_RESIZER_WIDTH_PX,
  );
  const rawRatio = (input.pointerClientX - input.containerLeft - paddingLeft) / availableWidth;
  const minimumRatio = Math.min(UPDATES_NODE_PANEL_NARROW_MIN_MAIN_RATIO, UPDATES_NODE_PANEL_MIN_MAIN_PX / availableWidth);
  const maximumRatio = Math.max(UPDATES_NODE_PANEL_NARROW_MAX_MAIN_RATIO, 1 - UPDATES_NODE_PANEL_MIN_NODE_PX / availableWidth);
  return normalizeUpdatesNodePanelMainRatio(Math.min(maximumRatio, Math.max(minimumRatio, rawRatio)));
}

export function nudgeUpdatesNodePanelMainRatio(ratio: number, direction: -1 | 1): number {
  return normalizeUpdatesNodePanelMainRatio(ratio + direction * 0.025);
}

export function updatesNodePanelGridTemplate(ratio: number): string {
  const mainRatio = Number(normalizeUpdatesNodePanelMainRatio(ratio).toFixed(4));
  const nodeRatio = Number((1 - mainRatio).toFixed(4));
  return `minmax(0, ${mainRatio}fr) ${UPDATES_NODE_PANEL_RESIZER_WIDTH_PX}px minmax(0, ${nodeRatio}fr)`;
}
