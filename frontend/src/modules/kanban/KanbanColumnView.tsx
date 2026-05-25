import type React from "react";
import {
  KANBAN_COLUMN_DRAG_MIME,
  KANBAN_COLUMN_TITLE_TEXT_TRANSFORM,
  KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
  getColumnHeight,
  getColumnWidth,
  hexToRgba,
  normalizeKanbanColumnItemColor,
  type KanbanCard,
  type KanbanColumn,
} from "./shared";

export type KanbanColumnResizeState = {
  axis: "width" | "height";
  columnID: string;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  currentWidth: number;
  currentHeight: number;
  minHeight?: number;
};

type KanbanColumnViewProps = {
  column: KanbanColumn;
  columnCards: KanbanCard[];
  renderedCards: React.ReactNode;
  accent: string;
  line: string;
  subtext: string;
  text: string;
  laneBackground: string;
  laneBorder: string;
  laneShadow: string;
  draggingColumnID: string;
  dragOverColumnID: string;
  editingColumnID: string;
  resizeRef: React.MutableRefObject<KanbanColumnResizeState | null>;
  onBlankMouseDown: React.MouseEventHandler<HTMLElement>;
  onSetCardContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; cardID: string } | null>>;
  onSetColumnContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; columnID: string } | null>>;
  onSetDraggingColumnID: React.Dispatch<React.SetStateAction<string>>;
  onSetDragOverColumnID: React.Dispatch<React.SetStateAction<string>>;
  onSetColumns: React.Dispatch<React.SetStateAction<KanbanColumn[]>>;
  onSetEditingColumnID: React.Dispatch<React.SetStateAction<string>>;
  onCommitColumnTitle: (columnID: string, title: string) => void;
  onRefreshBoard: () => void;
  onRequestColumnDelete: (columnID: string) => void;
  onCreateNodeInColumn: (columnID: string, anchor: { x: number; y: number }) => void;
  onDropColumn: (event: React.DragEvent<HTMLElement>, columnID: string) => void;
  dataTransferIncludes: (event: React.DragEvent, mime: string) => boolean;
  showCreateNodeButton?: boolean;
  minimumColumnHeightPx?: number;
};

export const KanbanColumnView: React.FC<KanbanColumnViewProps> = ({
  column,
  columnCards: _columnCards,
  renderedCards,
  accent,
  line: _line,
  subtext,
  text,
  laneBackground,
  laneBorder,
  laneShadow,
  draggingColumnID,
  dragOverColumnID,
  editingColumnID,
  resizeRef,
  onBlankMouseDown,
  onSetCardContextMenu,
  onSetColumnContextMenu,
  onSetDraggingColumnID,
  onSetDragOverColumnID,
  onSetColumns,
  onSetEditingColumnID,
  onCommitColumnTitle,
  onRefreshBoard,
  onRequestColumnDelete,
  onCreateNodeInColumn,
  onDropColumn,
  dataTransferIncludes,
  showCreateNodeButton = true,
  minimumColumnHeightPx,
}) => {
  const columnWidth = getColumnWidth(column);
  const minimumColumnHeight = Math.max(KANBAN_DEFAULT_COLUMN_HEIGHT_PX / 2, minimumColumnHeightPx ?? 0);
  const columnHeight = Math.max(getColumnHeight(column), minimumColumnHeight);
  const columnColor = normalizeKanbanColumnItemColor(column.item_color);
  const columnDropActive = dragOverColumnID === column.column_id;
  const insertionShadow = columnDropActive ? `0 0 0 3px ${accent}` : "";
  const columnShadow = insertionShadow ? (laneShadow === "none" ? insertionShadow : `${insertionShadow}, ${laneShadow}`) : laneShadow;

  return (
    <section
      onMouseDown={onBlankMouseDown}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSetCardContextMenu(null);
        onSetColumnContextMenu({ x: event.clientX, y: event.clientY, columnID: column.column_id });
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (dataTransferIncludes(event, KANBAN_COLUMN_DRAG_MIME) && draggingColumnID !== column.column_id) {
          onSetDragOverColumnID(column.column_id);
        }
      }}
      onDragLeave={() => onSetDragOverColumnID((previous) => (previous === column.column_id ? "" : previous))}
      onDrop={(event) => onDropColumn(event, column.column_id)}
      style={{
        position: "relative",
        flex: `0 0 ${columnWidth}px`,
        width: columnWidth,
        height: columnHeight,
        minHeight: minimumColumnHeight,
        background: `linear-gradient(180deg, ${hexToRgba(columnColor, 0.1)}, ${laneBackground} 78px)`,
        border: `1px solid ${columnColor || laneBorder}`,
        boxShadow: columnShadow,
        display: "grid",
        gridTemplateRows: "42px minmax(0, 1fr)",
        opacity: draggingColumnID === column.column_id ? 0.72 : 1,
        cursor: "default",
      }}
    >
      <div
        draggable={editingColumnID !== column.column_id}
        onDragStart={(event) => {
          if (editingColumnID === column.column_id) return;
          onSetDraggingColumnID(column.column_id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(KANBAN_COLUMN_DRAG_MIME, JSON.stringify({ columnID: column.column_id }));
        }}
        onDragEnd={() => {
          onSetDraggingColumnID("");
          onSetDragOverColumnID("");
        }}
        style={{ display: "grid", gridTemplateColumns: showCreateNodeButton ? "20px minmax(0, 1fr) 28px 28px" : "20px minmax(0, 1fr) 28px", alignItems: "center", borderBottom: `1px solid ${hexToRgba(columnColor, 0.72)}`, background: hexToRgba(columnColor, 0.12), cursor: "default" }}
      >
        <span aria-hidden="true" style={{ color: subtext, fontSize: 15, lineHeight: 1, textAlign: "center", cursor: editingColumnID === column.column_id ? "default" : "grab" }}>::</span>
        {editingColumnID === column.column_id ? (
          <input
            value={column.title}
            autoFocus
            draggable={false}
            onFocus={(event) => event.currentTarget.select()}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = event.target.value;
              onSetColumns((previous) => previous.map((item) => (item.column_id === column.column_id ? { ...item, title: value } : item)));
            }}
            onBlur={(event) => onCommitColumnTitle(column.column_id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                onSetEditingColumnID("");
                onRefreshBoard();
              }
            }}
            // Column titles are user-authored board data. Preserve casing so
            // names keep the exact meaning users and agents assigned.
            style={{ height: 40, width: "100%", minWidth: 0, border: "none", background: "transparent", color: text, fontSize: 12, fontWeight: 500, padding: "0 5px", outline: "none", textTransform: KANBAN_COLUMN_TITLE_TEXT_TRANSFORM }}
          />
        ) : (
          <div
            title={column.title}
            onClick={() => onSetEditingColumnID(column.column_id)}
            style={{ minWidth: 0, color: text, fontSize: 12, fontWeight: 500, padding: "0 5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: KANBAN_COLUMN_TITLE_TEXT_TRANSFORM, cursor: "text" }}
          >
            {column.title}
          </div>
        )}
        {showCreateNodeButton && (
          <button
            title="Create node"
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => onCreateNodeInColumn(column.column_id, { x: event.clientX, y: event.clientY })}
            style={{ width: 28, height: 28, border: "none", background: "transparent", color: text, cursor: "pointer", fontSize: 20, lineHeight: 1 }}
          >
            +
          </button>
        )}
        <button
          title="Delete column"
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onRequestColumnDelete(column.column_id)}
          style={{ width: 28, height: 28, border: "none", background: "transparent", color: subtext, cursor: "pointer", fontSize: 20, lineHeight: 1 }}
        >
          x
        </button>
      </div>
      <div
        className="kanban-column-scroll"
        onMouseDown={onBlankMouseDown}
        style={{ minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", gap: 8, padding: 8, ["--kanban-column-scroll-accent" as string]: columnColor, ["--kanban-column-scroll-track" as string]: "transparent" }}
      >
        {renderedCards}
      </div>
      <div
        title="Resize column width"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          resizeRef.current = {
            axis: "width",
            columnID: column.column_id,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: columnWidth,
            startHeight: columnHeight,
            currentWidth: columnWidth,
            currentHeight: columnHeight,
            minHeight: minimumColumnHeight,
          };
        }}
        style={{ position: "absolute", top: 0, right: -4, bottom: 0, width: 8, cursor: "col-resize", zIndex: 2 }}
      />
      <div
        title="Resize column height"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          resizeRef.current = {
            axis: "height",
            columnID: column.column_id,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: columnWidth,
            startHeight: columnHeight,
            currentWidth: columnWidth,
            currentHeight: columnHeight,
            minHeight: minimumColumnHeight,
          };
        }}
        style={{ position: "absolute", left: 0, right: 0, bottom: -4, height: 8, cursor: "row-resize", zIndex: 2 }}
      />
    </section>
  );
};
