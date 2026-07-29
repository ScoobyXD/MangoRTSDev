export type EditorSelectionActionRect = {
  left: number;
  right: number;
  top: number;
  height: number;
};

export function calculateEditorSelectionActionPosition(options: {
  rect: EditorSelectionActionRect;
  isForwardSelection: boolean;
  boundaryWidth: number;
  containerLeft?: number;
  containerTop?: number;
  offsetX?: number;
  rightInset?: number;
  scrollLeft?: number;
  scrollTop?: number;
}): { left: number; top: number } {
  const containerLeft = options.containerLeft ?? 0;
  const containerTop = options.containerTop ?? 0;
  const relativeLeft = options.rect.left - containerLeft;
  const relativeRight = options.rect.right - containerLeft;
  const preferredLeft = (
    options.isForwardSelection ? relativeRight + 8 : relativeLeft - 36
  ) + (options.offsetX ?? 0);
  const minLeft = 8 + Math.max(0, options.offsetX ?? 0);
  const maxLeft = Math.max(minLeft, options.boundaryWidth - 36 - (options.rightInset ?? 0));
  return {
    left: Math.max(minLeft, Math.min(Math.round(preferredLeft), maxLeft)) + (options.scrollLeft ?? 0),
    top: Math.max(6, Math.round(options.rect.top - containerTop + ((options.rect.height - 28) / 2))) + (options.scrollTop ?? 0),
  };
}
