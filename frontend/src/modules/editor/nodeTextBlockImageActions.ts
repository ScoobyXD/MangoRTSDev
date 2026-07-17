export type TextBlockImageActionRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type TextBlockImageActionLayout = {
  x: number;
  y: number;
  downloadX: number;
  downloadY: number;
};

const IMAGE_ACTION_SURFACE_WIDTH = 72;
const IMAGE_ACTION_SURFACE_HEIGHT = 38;
const IMAGE_ACTION_BUTTON_SIZE = 28;
const IMAGE_ACTION_VIEWPORT_MARGIN = 8;

function clampImageActionCoordinate(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
}

/** Returns fixed viewport coordinates for controls rendered in the elevated app layer. */
export function resolveTextBlockImageActionLayout(
  frameRect: TextBlockImageActionRect,
  editorViewportRect: TextBlockImageActionRect,
  appViewportRect: TextBlockImageActionRect,
): TextBlockImageActionLayout | null {
  const visible = frameRect.right > editorViewportRect.left
    && frameRect.left < editorViewportRect.right
    && frameRect.bottom > editorViewportRect.top
    && frameRect.top < editorViewportRect.bottom;
  if (!visible) return null;
  return {
    x: clampImageActionCoordinate(
      frameRect.right + 8,
      appViewportRect.left + IMAGE_ACTION_VIEWPORT_MARGIN,
      appViewportRect.right - IMAGE_ACTION_SURFACE_WIDTH - IMAGE_ACTION_VIEWPORT_MARGIN,
    ),
    y: clampImageActionCoordinate(
      frameRect.top + 4,
      appViewportRect.top + IMAGE_ACTION_VIEWPORT_MARGIN,
      appViewportRect.bottom - IMAGE_ACTION_SURFACE_HEIGHT - IMAGE_ACTION_VIEWPORT_MARGIN,
    ),
    downloadX: clampImageActionCoordinate(
      frameRect.right - 32,
      appViewportRect.left + IMAGE_ACTION_VIEWPORT_MARGIN,
      appViewportRect.right - IMAGE_ACTION_BUTTON_SIZE - IMAGE_ACTION_VIEWPORT_MARGIN,
    ),
    downloadY: clampImageActionCoordinate(
      frameRect.bottom - 32,
      appViewportRect.top + IMAGE_ACTION_VIEWPORT_MARGIN,
      appViewportRect.bottom - IMAGE_ACTION_BUTTON_SIZE - IMAGE_ACTION_VIEWPORT_MARGIN,
    ),
  };
}
