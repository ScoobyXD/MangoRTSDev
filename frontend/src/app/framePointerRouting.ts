export const FRAME_INTERACTIVE_SELECTOR = '[data-frame-interactive="true"]';

export type ClosestTarget = {
  closest?: (selector: string) => unknown;
};

export function isFrameInteractiveTarget(target: ClosestTarget | null | undefined): boolean {
  return Boolean(target?.closest?.(FRAME_INTERACTIVE_SELECTOR));
}
