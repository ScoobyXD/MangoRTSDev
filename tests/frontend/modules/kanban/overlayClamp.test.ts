import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NODE_EDITOR_OVERLAY_RATIO,
  KANBAN_NODE_EDITOR_OVERLAY_EDGE_GUTTER_PX,
  clampNodeEditorOverlayRatio,
  getNodeEditorOverlayMinLeftPx,
  nodeEditorOverlayRatioStorageKey,
} from "../../../../frontend/src/modules/kanban/KanbanContentModel.js";

function rect(left: number, right: number, top = 0, bottom = 100): DOMRect {
  return {
    left,
    right,
    top,
    bottom,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

function element(bounds: DOMRect, parentElement: unknown = null): HTMLElement {
  return {
    parentElement,
    getBoundingClientRect: () => bounds,
  } as HTMLElement;
}

test("node editor overlay minimum left keeps a buffer past the app sidebar", (t: any) => {
  const originalDocument = globalThis.document;
  const sidebar = element(rect(10, 250));
  const resizeHandle = element(rect(250, 260));
  globalThis.document = {
    querySelector: (selector: string) => {
      if (selector === "[data-app-sidebar=\"primary\"]") return sidebar;
      if (selector === "[data-app-sidebar-resize-handle=\"primary\"]") return resizeHandle;
      return null;
    },
  } as Document;
  t.after(() => {
    globalThis.document = originalDocument;
  });

  const arena = element(rect(260, 1600));
  const kanbanBoard = element(rect(520, 1600), { parentElement: arena });

  assert.equal(getNodeEditorOverlayMinLeftPx(kanbanBoard, true), -246);
  assert.equal(kanbanBoard.getBoundingClientRect().left + getNodeEditorOverlayMinLeftPx(kanbanBoard, true), 274);
});

test("node editor overlay minimum left leaves non-arena boards at their own left edge", (t: any) => {
  const originalDocument = globalThis.document;
  const sidebar = element(rect(10, 250));
  const resizeHandle = element(rect(250, 260));
  globalThis.document = {
    querySelector: (selector: string) => {
      if (selector === "[data-app-sidebar=\"primary\"]") return sidebar;
      if (selector === "[data-app-sidebar-resize-handle=\"primary\"]") return resizeHandle;
      return null;
    },
  } as Document;
  t.after(() => {
    globalThis.document = originalDocument;
  });

  const kanbanBoard = element(rect(300, 1200));

  assert.equal(getNodeEditorOverlayMinLeftPx(kanbanBoard, false), 0);
});

test("non-fullscreen Kanban node shells use the near-edge board geometry", () => {
  assert.equal(KANBAN_NODE_EDITOR_OVERLAY_EDGE_GUTTER_PX, 8);
  assert.equal(nodeEditorOverlayRatioStorageKey("company", "frame"), "kanban-node-editor-overlay-ratio-v3:company:frame");
  assert.deepEqual(DEFAULT_NODE_EDITOR_OVERLAY_RATIO, { left: 0.01, top: 0.01, width: 0.98, height: 0.98 });
  assert.deepEqual(clampNodeEditorOverlayRatio({ top: 0, height: 1 }), {
    left: 0.01,
    top: 0.01,
    width: 0.98,
    height: 0.98,
  });
});
