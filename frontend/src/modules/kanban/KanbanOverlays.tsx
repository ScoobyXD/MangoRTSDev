import React from "react";

import { confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";

import { AppModalPortal, useAppViewportAnchorRect } from "../../app/AppModalPortal";

import { requestAppSidebarPin } from "../../app/sidebarPins";

import { UnifiedNodeShell, type UnifiedNodeShellAction } from "../editor/UnifiedNodeShell";

import { NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX, NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX, setNodeEditorFullscreenChromeActive } from "../editor/nodeEditorFullscreenChrome";

import { KANBAN_NODE_EDITOR_OVERLAY_EDGE_GUTTER_PX, getNodeEditorOverlayMinLeftPx, KANBAN_EDGE_FRAME, KANBAN_PANEL_BACKGROUND, KANBAN_PANEL_SHADOW, KANBAN_SHADOW, KANBAN_SOFT_BORDER, KANBAN_SURFACE, nodeEditorOverlayResizeHandles, type NodeEditorOverlayRatio, type NodeEditorOverlayState, type OverlayResizeState } from "./KanbanContentModel";

const LazyKanbanNodeEditorContent = React.lazy(() => import("../editor/EditorContent").then((module) => ({
  default: module.EditorContent as React.FC<{
    accent: string;
    widgetId?: string;
    theme?: "mango" | "teal" | "light" | "dark";
    forcedEntityKind?: "node" | "logic_gate";
    forcedEntityID?: string;
    forcedLabel?: string;
    onBeforeHierarchyNavigate?: () => void;
  }>,
})));

export function KanbanNodeEditorOverlay({
  overlay,
  ratio,
  boardRootRef,
  resizeRef,
  frameID,
  accent,
  theme,
  allowHorizontalOverflow = false,
  fullscreen = false,
  onToggleFullscreen,
  onResizeStart,
  onLinkedLeftResizeStart,
  onClose,
  onCollapseToTab,
  onOpenInNewTab,
  onRequestDelete,
}: {
  overlay: NodeEditorOverlayState;
  ratio: NodeEditorOverlayRatio;
  boardRootRef: React.RefObject<HTMLDivElement | null>;
  resizeRef: React.MutableRefObject<OverlayResizeState | null>;
  frameID: string;
  accent: string;
  theme: "mango" | "teal" | "light" | "dark";
  allowHorizontalOverflow?: boolean;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onResizeStart?: () => void;
  onLinkedLeftResizeStart?: () => boolean;
  onClose: () => void;
  onCollapseToTab: () => void;
  onOpenInNewTab?: () => void;
  onRequestDelete?: (nodeID: string, position?: ConfirmActionMenuPosition) => void;
}) {
  const boardRect = useAppViewportAnchorRect(boardRootRef);
  const boardWidth = boardRect?.width ?? 0;
  const boardHeight = boardRect?.height ?? 0;
  const minLeftPx = getNodeEditorOverlayMinLeftPx(boardRootRef.current, allowHorizontalOverflow);
  const renderedLeft = boardWidth > 0
    ? Math.max(ratio.left, minLeftPx / boardWidth)
    : ratio.left;
  const renderedLeftPx = boardWidth * renderedLeft;
  const availableWidthPx = boardWidth > 0 ? Math.max(1, boardWidth - renderedLeftPx - KANBAN_NODE_EDITOR_OVERLAY_EDGE_GUTTER_PX) : 0;
  const renderedWidth = boardWidth > 0 ? Math.min(ratio.width, availableWidthPx / boardWidth) : ratio.width;
  const normalTopPx = (boardRect?.top ?? 0) + boardHeight * ratio.top;
  const normalLeftPx = (boardRect?.left ?? 0) + renderedLeftPx;
  const normalHeightPx = boardHeight * ratio.height;
  const normalMaxHeightPx = Math.max(1, boardHeight - KANBAN_NODE_EDITOR_OVERLAY_EDGE_GUTTER_PX);

  React.useEffect(() => setNodeEditorFullscreenChromeActive(fullscreen), [fullscreen]);


  return (
    <AppModalPortal ownerDocument={boardRootRef.current?.ownerDocument} trapFocus={fullscreen} onRequestClose={onClose}>
      <div data-mango-editor-overlay-backdrop={fullscreen ? "modal" : "modeless"} style={{ position: "fixed", inset: 0, zIndex: 1, background: fullscreen ? "rgba(15, 23, 42, 0.18)" : "transparent", pointerEvents: fullscreen ? "auto" : "none" }}>
      <UnifiedNodeShell
      surfaceID="kanban-node-overlay"
      title={overlay.nodeTitle}
      actionButtonClassName="mango-elevated-action"
      role="dialog"
      ariaModal={fullscreen}
      actionButtonStyle={overlayHeaderButtonStyle}
      closeButtonStyle={overlayHeaderButtonStyle}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      actions={([
        onRequestDelete ? {
          id: "delete",
          danger: true,
          onClick: (event: React.MouseEvent<HTMLButtonElement>) => onRequestDelete(overlay.nodeID, confirmMenuPositionFromElement(event.currentTarget)),
        } : null,
        onOpenInNewTab ? {
          id: "open-in-new-tab",
          onClick: onOpenInNewTab,
        } : null,
        {
          id: "pin",
          title: "Pin node to Pinned",
          ariaLabel: "Pin node to Pinned",
          onClick: () => requestAppSidebarPin({ kind: "node", id: overlay.nodeID, name: overlay.nodeTitle }),
        },
        onToggleFullscreen ? {
          id: "fullscreen",
          pressed: fullscreen,
          onClick: onToggleFullscreen,
        } : null,
        {
          id: "minimize",
          onClick: onCollapseToTab,
        },
        {
          id: "close",
          onClick: onClose,
        },
      ].filter(Boolean) as UnifiedNodeShellAction[])}
      style={{
        position: "fixed",
        zIndex: 2,
        top: fullscreen ? NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX : normalTopPx,
        left: fullscreen ? NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX : normalLeftPx,
        width: fullscreen ? `calc(100vw - ${NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX * 2}px)` : renderedWidth * boardWidth,
        height: fullscreen ? `calc(100vh - ${NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX * 2}px)` : normalHeightPx,
        maxWidth: fullscreen ? `calc(100vw - ${NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX * 2}px)` : availableWidthPx,
        maxHeight: fullscreen ? `calc(100vh - ${NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX * 2}px)` : normalMaxHeightPx,
        minWidth: fullscreen ? 0 : Math.min(420, Math.max(1, availableWidthPx)),
        minHeight: fullscreen ? 0 : Math.min(320, normalMaxHeightPx),
        visibility: !fullscreen && !boardRect ? "hidden" : "visible",
        border: "1px solid transparent",
        borderRadius: fullscreen ? 14 : 18,
        background: `${KANBAN_PANEL_BACKGROUND} padding-box, ${KANBAN_EDGE_FRAME} border-box`,
        boxShadow: KANBAN_PANEL_SHADOW,
        overflow: "hidden",
        cursor: "default",
        pointerEvents: "auto",
      }}
      chrome={nodeEditorOverlayResizeHandles.map((handle) => (
        <span
          key={handle.key}
          aria-hidden="true"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onResizeStart?.();
            const boardBounds = boardRootRef.current?.getBoundingClientRect();
            const boardWidth = boardBounds?.width ?? window.innerWidth;
            const boardHeight = boardBounds?.height ?? window.innerHeight;
            const linkedLeftResize = Boolean(handle.edges.left && onLinkedLeftResizeStart?.());
            resizeRef.current = {
              edges: handle.edges,
              startX: event.clientX,
              startY: event.clientY,
              startLeft: boardWidth * ratio.left,
              startTop: boardHeight * ratio.top,
              startWidth: boardWidth * ratio.width,
              startHeight: boardHeight * ratio.height,
              boardWidth,
              boardHeight,
              minLeft: getNodeEditorOverlayMinLeftPx(boardRootRef.current, allowHorizontalOverflow),
              linkedLeftResize,
            };
          }}
          style={{
            position: "absolute",
            zIndex: 9,
            cursor: handle.cursor,
            ...handle.style,
          }}
        />
      ))}
    >
      <React.Suspense fallback={<div aria-busy="true" style={{ width: "100%", height: "100%", background: KANBAN_PANEL_BACKGROUND }} />}>
        <LazyKanbanNodeEditorContent
          accent={accent}
          widgetId={`${frameID}:node-editor-overlay:${overlay.nodeID}`}
          theme={theme}
          forcedEntityKind="node"
          forcedEntityID={overlay.nodeID}
          forcedLabel={overlay.nodeTitle}
          onBeforeHierarchyNavigate={fullscreen ? (onToggleFullscreen ?? onClose) : undefined}
        />
      </React.Suspense>
      </UnifiedNodeShell>
      </div>
    </AppModalPortal>
  );
}

const overlayHeaderButtonStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 80,
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: `1px solid ${KANBAN_SOFT_BORDER}`,
  borderRadius: 8,
  background: KANBAN_SURFACE,
  color: "#334155",
  padding: 0,
  cursor: "pointer",
  boxShadow: KANBAN_SHADOW,
};
