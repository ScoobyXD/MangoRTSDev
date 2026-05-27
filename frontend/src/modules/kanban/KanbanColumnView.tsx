import type React from "react";
import {
  KANBAN_COLUMN_DRAG_MIME,
  KANBAN_COLUMN_TITLE_TEXT_TRANSFORM,
  KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
  getColumnHeight,
  getColumnWidth,
  getKanbanColumnDisplayColor,
  hexToRgba,
  type KanbanCard,
  type KanbanColumn,
} from "./shared";
import { KANBAN_SURFACE } from "./KanbanContentModel";

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
  laneBorder: _laneBorder,
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
  const columnColor = getKanbanColumnDisplayColor(column);
  const columnDropActive = dragOverColumnID === column.column_id;
  const insertionShadow = columnDropActive ? `0 0 0 3px ${accent}` : "";
  const columnGlow = `0 14px 30px ${hexToRgba(columnColor, 0.16)}, 8px 8px 22px rgba(174,174,192,0.20), -7px -7px 18px rgba(255,255,255,0.86)`;
  const baseColumnShadow = laneShadow === "none" ? columnGlow : `${columnGlow}, ${laneShadow}`;
  const columnShadow = insertionShadow ? `${insertionShadow}, ${baseColumnShadow}` : baseColumnShadow;
  const columnFrame = `linear-gradient(135deg, ${hexToRgba(columnColor, 0.82)} 0%, ${hexToRgba(columnColor, 0.38)} 34%, rgba(92, 238, 255, 0.58) 58%, rgba(183, 124, 255, 0.58) 82%, rgba(255,255,255,0.88) 100%)`;

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
        background: `linear-gradient(180deg, ${hexToRgba(columnColor, 0.24)} 0%, ${hexToRgba(columnColor, 0.10)} 126px, ${laneBackground} 54%, rgba(255,255,255,0.62) 100%) padding-box, ${columnFrame} border-box`,
        border: "1px solid transparent",
        borderRadius: 16,
        boxShadow: columnShadow,
        display: "grid",
        gridTemplateRows: "42px minmax(0, 1fr)",
        opacity: draggingColumnID === column.column_id ? 0.72 : 1,
        cursor: "default",
        overflow: "hidden",
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
        style={{ display: "grid", gridTemplateColumns: showCreateNodeButton ? "20px minmax(0, 1fr) 28px 28px" : "20px minmax(0, 1fr) 28px", alignItems: "center", borderBottom: `1px solid ${hexToRgba(columnColor, 0.34)}`, background: `linear-gradient(135deg, ${hexToRgba(columnColor, 0.24)}, rgba(255,255,255,0.76) 46%, ${hexToRgba(columnColor, 0.10)})`, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.82)", cursor: "default" }}
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
            style={{ height: 40, width: "100%", minWidth: 0, border: "none", background: "transparent", color: text, fontSize: 12, fontWeight: 750, padding: "0 5px", outline: "none", textTransform: KANBAN_COLUMN_TITLE_TEXT_TRANSFORM }}
          />
        ) : (
          <div
            title={column.title}
            onClick={() => onSetEditingColumnID(column.column_id)}
            style={{ minWidth: 0, color: text, fontSize: 12, fontWeight: 750, padding: "0 5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: KANBAN_COLUMN_TITLE_TEXT_TRANSFORM, cursor: "text" }}
          >
            {column.title}
          </div>
        )}
        {showCreateNodeButton && (
          <button
            className="mango-elevated-action"
            title="Create node"
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => onCreateNodeInColumn(column.column_id, { x: event.clientX, y: event.clientY })}
            style={{ width: 24, height: 24, border: "1px solid rgba(255,255,255,0.74)", borderRadius: 7, background: KANBAN_SURFACE, color: text, cursor: "pointer", fontSize: 18, lineHeight: 1, boxShadow: "3px 3px 8px rgba(174,174,192,0.18), -3px -3px 8px rgba(255,255,255,0.78)" }}
          >
            +
          </button>
        )}
        <button
          className="mango-elevated-action"
          title="Delete column"
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onRequestColumnDelete(column.column_id)}
          style={{ width: 24, height: 24, border: "1px solid rgba(255,255,255,0.74)", borderRadius: 7, background: KANBAN_SURFACE, color: subtext, cursor: "pointer", fontSize: 17, lineHeight: 1, boxShadow: "3px 3px 8px rgba(174,174,192,0.18), -3px -3px 8px rgba(255,255,255,0.78)" }}
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
