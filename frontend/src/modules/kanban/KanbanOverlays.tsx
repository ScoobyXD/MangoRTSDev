import React from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { requestAppSidebarPin } from "../../app/sidebarPins";
import { MinimizeToLineIcon } from "../../app/nodeEditorPopupControls";
import { normalizeKanbanColumnItemColor, type KanbanCard, type KanbanColumn } from "./shared";
import {
  contextMenuButtonStyle,
  contextMenuHoverHandlers,
  KANBAN_EDGE_FRAME,
  KANBAN_PANEL_BACKGROUND,
  KANBAN_PANEL_SHADOW,
  KANBAN_SHADOW,
  KANBAN_SOFT_BORDER,
  KANBAN_SURFACE,
  nodeEditorOverlayResizeHandles,
  type NodeEditorOverlayRatio,
  type NodeEditorOverlayState,
  type OverlayResizeState,
} from "./KanbanContentModel";

const LazyKanbanNodeEditorContent = React.lazy(() => import("../editor/EditorContent").then((module) => ({
  default: module.EditorContent as React.FC<{
    accent: string;
    widgetId?: string;
    theme?: "mango" | "teal" | "light" | "dark";
    forcedEntityKind?: "node" | "logic_gate";
    forcedEntityID?: string;
    forcedLabel?: string;
  }>,
})));

export function KanbanContextMenus({
  contextColumn,
  columnContextMenu,
  contextCard,
  cardContextMenu,
  arenaMode,
  contextCardSelectionIDs,
  onCloseColumnMenu,
  onCloseCardMenu,
  onCreateNodeInColumn,
  onEditColumn,
  onRequestColumnDelete,
  onPersistColumnItemColor,
  onToggleCardIssue,
  onRenameNode,
  onRevertCardsToMyTriage,
  onRequestNodeDeleteFromCards,
  onRequestCardDelete,
}: {
  contextColumn: KanbanColumn | null;
  columnContextMenu: { x: number; y: number; columnID: string } | null;
  contextCard: KanbanCard | null;
  cardContextMenu: { x: number; y: number; cardID: string } | null;
  arenaMode: boolean;
  contextCardSelectionIDs: string[];
  onCloseColumnMenu: () => void;
  onCloseCardMenu: () => void;
  onCreateNodeInColumn: (columnID: string, anchor: { x: number; y: number }) => void;
  onEditColumn: (columnID: string) => void;
  onRequestColumnDelete: (columnID: string) => void;
  onPersistColumnItemColor: (columnID: string, color: string) => void;
  onToggleCardIssue: (card: KanbanCard, isIssue: boolean) => void;
  onRenameNode: (card: KanbanCard) => void;
  onRevertCardsToMyTriage: (cardIDs: string[]) => void;
  onRequestNodeDeleteFromCards: (cardIDs: string[]) => void;
  onRequestCardDelete: (cardIDs: string[]) => void;
}) {
  return (
    <>
      {contextColumn && columnContextMenu && (
        <FrameRightClickMenu x={columnContextMenu.x} y={columnContextMenu.y} onClose={onCloseColumnMenu}>
          <button type="button" style={contextMenuButtonStyle} onClick={() => onCreateNodeInColumn(contextColumn.column_id, { x: columnContextMenu.x, y: columnContextMenu.y })} {...contextMenuHoverHandlers}>
            Create new node
          </button>
          <button type="button" style={contextMenuButtonStyle} onClick={() => onEditColumn(contextColumn.column_id)} {...contextMenuHoverHandlers}>
            Rename column
          </button>
          <button type="button" style={{ ...contextMenuButtonStyle, color: "#334155" }} onClick={() => onRequestColumnDelete(contextColumn.column_id)} {...contextMenuHoverHandlers}>
            Delete column
          </button>
          <label style={{ ...contextMenuButtonStyle, cursor: "default", justifyContent: "space-between" }}>
            <span>Column color</span>
            <input
              type="color"
              value={normalizeKanbanColumnItemColor(contextColumn.item_color)}
              onChange={(event) => onPersistColumnItemColor(contextColumn.column_id, event.target.value)}
              style={{ width: 34, height: 24, border: "1px solid #d0d0d0", background: "#fff", cursor: "pointer", padding: 0 }}
            />
          </label>
        </FrameRightClickMenu>
      )}
      {contextCard && cardContextMenu && (
        <FrameRightClickMenu x={cardContextMenu.x} y={cardContextMenu.y} onClose={onCloseCardMenu}>
          {!arenaMode && (
            <button type="button" style={contextMenuButtonStyle} onClick={() => onToggleCardIssue(contextCard, !contextCard.is_issue)} {...contextMenuHoverHandlers}>
              {contextCard.is_issue ? "Clear Issue" : "Mark Issue"}
            </button>
          )}
          <button
            type="button"
            style={contextMenuButtonStyle}
            onClick={() => {
              requestAppSidebarPin({ kind: "node", id: contextCard.node_id, label: contextCard.node_title });
              onCloseCardMenu();
            }}
            {...contextMenuHoverHandlers}
          >
            Pin Node
          </button>
          <button type="button" style={contextMenuButtonStyle} onClick={() => onRenameNode(contextCard)} {...contextMenuHoverHandlers}>
            Rename node
          </button>
          <button type="button" style={contextMenuButtonStyle} onClick={() => onRevertCardsToMyTriage(contextCardSelectionIDs)} {...contextMenuHoverHandlers}>
            Revert back to Pending
          </button>
          <button type="button" style={{ ...contextMenuButtonStyle, color: "#334155" }} onClick={() => onRequestNodeDeleteFromCards(contextCardSelectionIDs)} {...contextMenuHoverHandlers}>
            Delete node
          </button>
          <button type="button" style={contextMenuButtonStyle} onClick={() => onRequestCardDelete(contextCardSelectionIDs)} {...contextMenuHoverHandlers}>
            Remove node from Kanban Board
          </button>
        </FrameRightClickMenu>
      )}
    </>
  );
}

export function KanbanNodeEditorOverlay({
  overlay,
  ratio,
  boardRootRef,
  resizeRef,
  frameID,
  accent,
  theme,
  onClose,
  onCollapseToTab,
}: {
  overlay: NodeEditorOverlayState;
  ratio: NodeEditorOverlayRatio;
  boardRootRef: React.RefObject<HTMLDivElement | null>;
  resizeRef: React.MutableRefObject<OverlayResizeState | null>;
  frameID: string;
  accent: string;
  theme: "mango" | "teal" | "light" | "dark";
  onClose: () => void;
  onCollapseToTab: () => void;
}) {
  return (
    <div
      data-frame-interactive="true"
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        zIndex: 40,
        top: "6%",
        left: "50%",
        width: `${Math.round(ratio.width * 1000) / 10}%`,
        height: `${Math.round(ratio.height * 1000) / 10}%`,
        maxWidth: "calc(100% - 44px)",
        maxHeight: "calc(100% - 64px)",
        transform: "translateX(-50%)",
        minWidth: "min(420px, calc(100% - 44px))",
        minHeight: "min(320px, calc(100% - 64px))",
        border: "1px solid transparent",
        borderRadius: 18,
        background: `${KANBAN_PANEL_BACKGROUND} padding-box, ${KANBAN_EDGE_FRAME} border-box`,
        boxShadow: KANBAN_PANEL_SHADOW,
        overflow: "hidden",
        cursor: "default",
      }}
    >
      <button
        className="mango-elevated-action"
        type="button"
        title="Collapse node editor to app tab"
        aria-label="Collapse node editor to app tab"
        onClick={onCollapseToTab}
        style={{
          position: "absolute",
          top: 7,
          right: 38,
          zIndex: 8,
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
        }}
      >
        <MinimizeToLineIcon />
      </button>
      <button
        className="mango-elevated-action"
        type="button"
        title="Close node editor"
        onClick={onClose}
        style={{
          position: "absolute",
          top: 7,
          right: 8,
          zIndex: 8,
          width: 24,
          height: 24,
          border: "1px solid transparent",
          borderRadius: 8,
          background: `${KANBAN_SURFACE} padding-box, ${KANBAN_EDGE_FRAME} border-box`,
          color: "#0f172a",
          fontSize: 16,
          fontWeight: 600,
          lineHeight: "20px",
          cursor: "pointer",
          boxShadow: KANBAN_SHADOW,
        }}
      >
        X
      </button>
      <React.Suspense fallback={<div aria-busy="true" style={{ width: "100%", height: "100%", background: KANBAN_PANEL_BACKGROUND }} />}>
        <LazyKanbanNodeEditorContent
          accent={accent}
          widgetId={`${frameID}:node-editor-overlay:${overlay.nodeID}`}
          theme={theme}
          forcedEntityKind="node"
          forcedEntityID={overlay.nodeID}
          forcedLabel={overlay.nodeTitle}
        />
      </React.Suspense>
      {nodeEditorOverlayResizeHandles.map((handle) => (
        <span
          key={handle.key}
          aria-hidden="true"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const boardBounds = boardRootRef.current?.getBoundingClientRect();
            const boardWidth = boardBounds?.width ?? window.innerWidth;
            const boardHeight = boardBounds?.height ?? window.innerHeight;
            resizeRef.current = {
              edges: handle.edges,
              startX: event.clientX,
              startY: event.clientY,
              startWidth: boardWidth * ratio.width,
              startHeight: boardHeight * ratio.height,
              boardWidth,
              boardHeight,
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
    </div>
  );
}

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(241, 245, 249, 0.66)",
  backdropFilter: "blur(14px) saturate(1.18)",
  WebkitBackdropFilter: "blur(14px) saturate(1.18)",
  zIndex: 120,
  display: "grid",
  placeItems: "center",
};

const modalPanelStyle: React.CSSProperties = {
  width: "min(420px, 90%)",
  borderRadius: 16,
  border: `1px solid ${KANBAN_SOFT_BORDER}`,
  background: KANBAN_PANEL_BACKGROUND,
  padding: 12,
  display: "grid",
  gap: 10,
  boxShadow: KANBAN_PANEL_SHADOW,
};

const yesButtonStyle: React.CSSProperties = {
  border: `1px solid ${KANBAN_SOFT_BORDER}`,
  borderRadius: 10,
  background: KANBAN_SURFACE,
  cursor: "pointer",
  fontWeight: 700,
  boxShadow: KANBAN_SHADOW,
};

const noButtonStyle: React.CSSProperties = {
  border: "1px solid transparent",
  borderRadius: 10,
  boxShadow: `${KANBAN_SHADOW}, 0 0 14px rgba(183, 124, 255, 0.18)`,
  color: "#334155",
  background: `${KANBAN_SURFACE} padding-box, ${KANBAN_EDGE_FRAME} border-box`,
  cursor: "pointer",
  fontWeight: 700,
};

function ModalShell({ title, detail, onConfirm, onCancel }: {
  title: React.ReactNode;
  detail: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={modalBackdropStyle}>
      <div style={modalPanelStyle}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#111111" }}>{title}</div>
        <div style={{ fontSize: 11, lineHeight: 1.35, color: "#2e2e2e" }}>{detail}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button className="mango-elevated-action" type="button" onClick={onConfirm} style={yesButtonStyle}>Yes</button>
          <button className="mango-elevated-action" type="button" onClick={onCancel} style={noButtonStyle}>No</button>
        </div>
      </div>
    </div>
  );
}

export function KanbanDeleteConfirmations({
  deleteNodeConfirmation,
  deleteCardConfirmation,
  deleteColumnConfirmation,
  onRemoveNodes,
  onRemoveCards,
  onRemoveColumn,
  onCancelNodeDelete,
  onCancelCardDelete,
  onCancelColumnDelete,
}: {
  deleteNodeConfirmation: { nodeIDs: string[] } | null;
  deleteCardConfirmation: { cardIDs: string[] } | null;
  deleteColumnConfirmation: { columnID: string; title: string } | null;
  onRemoveNodes: (nodeIDs: string[]) => void;
  onRemoveCards: (cardIDs: string[]) => void;
  onRemoveColumn: (columnID: string) => void;
  onCancelNodeDelete: () => void;
  onCancelCardDelete: () => void;
  onCancelColumnDelete: () => void;
}) {
  if (deleteNodeConfirmation) {
    return (
      <ModalShell
        title={`Are you sure you want to delete ${deleteNodeConfirmation.nodeIDs.length} node${deleteNodeConfirmation.nodeIDs.length === 1 ? "" : "s"}?`}
        detail="This deletes the underlying node data and removes its Kanban placements."
        onConfirm={() => onRemoveNodes(deleteNodeConfirmation.nodeIDs)}
        onCancel={onCancelNodeDelete}
      />
    );
  }
  if (deleteCardConfirmation) {
    return (
      <ModalShell
        title={`Are you sure you want to remove ${deleteCardConfirmation.cardIDs.length} node${deleteCardConfirmation.cardIDs.length === 1 ? "" : "s"} from this Kanban Board?`}
        detail={`The underlying node${deleteCardConfirmation.cardIDs.length === 1 ? "" : "s"} will continue to exist outside this board.`}
        onConfirm={() => onRemoveCards(deleteCardConfirmation.cardIDs)}
        onCancel={onCancelCardDelete}
      />
    );
  }
  if (deleteColumnConfirmation) {
    return (
      <ModalShell
        title="Are you sure you want to delete this Kanban column?"
        detail={`This removes "${deleteColumnConfirmation.title}" and all cards in that column immediately.`}
        onConfirm={() => onRemoveColumn(deleteColumnConfirmation.columnID)}
        onCancel={onCancelColumnDelete}
      />
    );
  }
  return null;
}
