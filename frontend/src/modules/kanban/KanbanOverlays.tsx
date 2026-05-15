import React from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { EditorContent } from "../editor/EditorContent";
import { normalizeKanbanColumnItemColor, type KanbanCard, type KanbanColumn } from "./shared";
import {
  contextMenuButtonStyle,
  contextMenuHoverHandlers,
  nodeEditorOverlayResizeHandles,
  type NodeEditorOverlayRatio,
  type NodeEditorOverlayState,
  type OverlayResizeState,
} from "./KanbanContentModel";

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
  onCreateNodeInColumn: (columnID: string) => void;
  onEditColumn: (columnID: string) => void;
  onRequestColumnDelete: (columnID: string) => void;
  onPersistColumnItemColor: (columnID: string, color: string) => void;
  onToggleCardIssue: (card: KanbanCard, isIssue: boolean) => void;
  onRevertCardsToMyTriage: (cardIDs: string[]) => void;
  onRequestNodeDeleteFromCards: (cardIDs: string[]) => void;
  onRequestCardDelete: (cardIDs: string[]) => void;
}) {
  return (
    <>
      {contextColumn && columnContextMenu && (
        <FrameRightClickMenu x={columnContextMenu.x} y={columnContextMenu.y} onClose={onCloseColumnMenu}>
          <button type="button" style={contextMenuButtonStyle} onClick={() => onCreateNodeInColumn(contextColumn.column_id)} {...contextMenuHoverHandlers}>
            Create new node
          </button>
          <button type="button" style={contextMenuButtonStyle} onClick={() => onEditColumn(contextColumn.column_id)} {...contextMenuHoverHandlers}>
            Rename column
          </button>
          <button type="button" style={{ ...contextMenuButtonStyle, color: "#c62828" }} onClick={() => onRequestColumnDelete(contextColumn.column_id)} {...contextMenuHoverHandlers}>
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
          <button type="button" style={contextMenuButtonStyle} onClick={() => onRevertCardsToMyTriage(contextCardSelectionIDs)} {...contextMenuHoverHandlers}>
            Revert back to Pending
          </button>
          <button type="button" style={{ ...contextMenuButtonStyle, color: "#c62828" }} onClick={() => onRequestNodeDeleteFromCards(contextCardSelectionIDs)} {...contextMenuHoverHandlers}>
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
}: {
  overlay: NodeEditorOverlayState;
  ratio: NodeEditorOverlayRatio;
  boardRootRef: React.RefObject<HTMLDivElement | null>;
  resizeRef: React.MutableRefObject<OverlayResizeState | null>;
  frameID: string;
  accent: string;
  theme: "mango" | "teal" | "light" | "dark";
  onClose: () => void;
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
        border: "1px solid rgba(255, 136, 32, 0.54)",
        borderRadius: 16,
        background: "#ffffff",
        boxShadow: "0 18px 42px rgba(36, 18, 10, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.72)",
        overflow: "hidden",
        cursor: "default",
      }}
    >
      <button
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
          border: "1px solid #8b0000",
          borderRadius: 4,
          background: "#ff1f1f",
          color: "#ffffff",
          fontSize: 16,
          fontWeight: 600,
          lineHeight: "20px",
          cursor: "pointer",
        }}
      >
        X
      </button>
      <EditorContent
        accent={accent}
        widgetId={`${frameID}:node-editor-overlay:${overlay.nodeID}`}
        theme={theme}
        forcedEntityKind="node"
        forcedEntityID={overlay.nodeID}
        forcedLabel={overlay.nodeTitle}
      />
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
  background: "rgba(0,0,0,0.28)",
  zIndex: 120,
  display: "grid",
  placeItems: "center",
};

const modalPanelStyle: React.CSSProperties = {
  width: "min(420px, 90%)",
  borderRadius: 10,
  border: "1px solid rgba(255,136,32,0.45)",
  background: "rgba(255,255,255,0.95)",
  padding: 12,
  display: "grid",
  gap: 10,
};

const yesButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(255,136,32,0.45)",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 700,
};

const noButtonStyle: React.CSSProperties = {
  border: "1px solid #ff3d7f",
  boxShadow: "inset 0 0 0 1px rgba(255,130,170,0.25), 0 0 10px rgba(255,61,127,0.18)",
  color: "#8b123f",
  background: "#fff",
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
          <button type="button" onClick={onConfirm} style={yesButtonStyle}>Yes</button>
          <button type="button" onClick={onCancel} style={noButtonStyle}>No</button>
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
