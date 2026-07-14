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

/** Keeps image controls in the image's own scrolling coordinate space. */
export function resolveTextBlockImageActionLayout(
  frameRect: TextBlockImageActionRect,
  wrapperRect: Pick<TextBlockImageActionRect, "left" | "top">,
  viewportRect: TextBlockImageActionRect,
): TextBlockImageActionLayout | null {
  const visible = frameRect.right > viewportRect.left
    && frameRect.left < viewportRect.right
    && frameRect.bottom > viewportRect.top
    && frameRect.top < viewportRect.bottom;
  if (!visible) return null;
  return {
    x: frameRect.right - wrapperRect.left + 8,
    y: frameRect.top - wrapperRect.top + 4,
    downloadX: frameRect.right - wrapperRect.left - 32,
    downloadY: frameRect.bottom - wrapperRect.top - 32,
  };
}
