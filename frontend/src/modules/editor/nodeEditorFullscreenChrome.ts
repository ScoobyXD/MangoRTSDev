export const NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX = 12;
export const NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX = 8;
export const EVENT_NODE_EDITOR_FULLSCREEN_CHROME_CHANGED = "mangorts:node-editor-fullscreen-chrome-changed";

let nodeEditorFullscreenChromeCount = 0;

function dispatchNodeEditorFullscreenChromeChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NODE_EDITOR_FULLSCREEN_CHROME_CHANGED, {
    detail: { active: nodeEditorFullscreenChromeCount > 0 },
  }));
}

export function readNodeEditorFullscreenChromeActive(): boolean {
  return nodeEditorFullscreenChromeCount > 0;
}

export function setNodeEditorFullscreenChromeActive(active: boolean): () => void {
  if (!active) return () => {};
  nodeEditorFullscreenChromeCount += 1;
  dispatchNodeEditorFullscreenChromeChange();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    nodeEditorFullscreenChromeCount = Math.max(0, nodeEditorFullscreenChromeCount - 1);
    dispatchNodeEditorFullscreenChromeChange();
  };
}

export function subscribeNodeEditorFullscreenChrome(listener: (active: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(readNodeEditorFullscreenChromeActive());
  window.addEventListener(EVENT_NODE_EDITOR_FULLSCREEN_CHROME_CHANGED, handler);
  return () => window.removeEventListener(EVENT_NODE_EDITOR_FULLSCREEN_CHROME_CHANGED, handler);
}

export function fullscreenNodeEditorViewportRect(): { left: number; top: number; width: number; height: number } {
  if (typeof window === "undefined") return { left: 0, top: 0, width: 900, height: 640 };
  return {
    left: NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX,
    top: NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX,
    width: Math.max(420, window.innerWidth - (NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX * 2)),
    height: Math.max(320, window.innerHeight - (NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX * 2)),
  };
}
