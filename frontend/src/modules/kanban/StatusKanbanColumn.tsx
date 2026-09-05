import type React from "react";
import { KANBAN_SURFACE } from "./KanbanContentModel";
import type { ProcessStatus } from "./processWork";
import { hexToRgba } from "./shared";

export type StatusKanbanColumnProps = {
  status: ProcessStatus;
  title: string;
  color: string;
  width: number;
  height: number;
  renderedCards: React.ReactNode;
  accent: string;
  subtext: string;
  text: string;
  laneBackground: string;
  laneShadow: string;
  dropHighlighted: boolean;
  canEdit: boolean;
  busy?: boolean;
  onBlankMouseDown: React.MouseEventHandler<HTMLElement>;
  onContextMenu: React.MouseEventHandler<HTMLElement>;
  onDrop: React.DragEventHandler<HTMLElement>;
  onDragOver: React.DragEventHandler<HTMLElement>;
  onDragLeave?: React.DragEventHandler<HTMLElement>;
  onCreate: React.MouseEventHandler<HTMLButtonElement>;
  onResizeStart: (axis: "width" | "height", event: React.MouseEvent<HTMLDivElement>) => void;
  layout?: "column" | "backlog";
  minimumHeight?: number;
  stretchHeight?: boolean;
};

export const StatusKanbanColumn: React.FC<StatusKanbanColumnProps> = ({
  status,
  title,
  color,
  width,
  height,
  renderedCards,
  accent,
  subtext,
  text,
  laneBackground,
  laneShadow,
  dropHighlighted,
  canEdit,
  busy = false,
  onBlankMouseDown,
  onContextMenu,
  onDrop,
  onDragOver,
  onDragLeave,
  onCreate,
  onResizeStart,
  layout = "column",
  minimumHeight = 0,
  stretchHeight = false,
}) => {
  const isBacklogLayout = layout === "backlog";
  const headerText = `var(--status-kanban-card-text, ${text})`;
  const headerSubtext = `var(--status-kanban-card-subtext, ${subtext})`;
  const resolvedMinimumHeight = Math.max(isBacklogLayout ? 190 : 120, minimumHeight);
  const resolvedHeight = Math.max(height, resolvedMinimumHeight);
  const insertionShadow = dropHighlighted ? `0 0 0 3px ${accent}` : "";
  const columnGlow = `0 14px 30px ${hexToRgba(color, 0.16)}, 8px 8px 22px rgba(174,174,192,0.20), -7px -7px 18px rgba(255,255,255,0.86)`;
  const baseColumnShadow = laneShadow === "none" ? columnGlow : `${columnGlow}, ${laneShadow}`;
  const columnShadow = insertionShadow ? `${insertionShadow}, ${baseColumnShadow}` : baseColumnShadow;
  const columnFrame = `linear-gradient(135deg, ${hexToRgba(color, 0.86)} 0%, ${hexToRgba(color, 0.54)} 46%, ${hexToRgba(color, 0.24)} 78%, rgba(255,255,255,0.88) 100%)`;
  const columnFill = `radial-gradient(circle at 12% 10%, ${hexToRgba(color, 0.42)} 0%, ${hexToRgba(color, 0.24)} 34%, transparent 62%), linear-gradient(160deg, ${hexToRgba(color, 0.32)} 0%, ${hexToRgba(color, 0.22)} 42%, ${laneBackground} 78%, ${hexToRgba(color, 0.12)} 100%)`;

  return (
    <section
      data-kanban-status={status}
      aria-label={title}
      onMouseDown={onBlankMouseDown}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: "relative",
        flex: isBacklogLayout ? "1 1 100%" : `0 0 ${width}px`,
        width: isBacklogLayout ? "100%" : width,
        height: stretchHeight ? "100%" : resolvedHeight,
        minHeight: stretchHeight ? resolvedHeight : resolvedMinimumHeight,
        alignSelf: stretchHeight ? "stretch" : undefined,
        background: `${columnFill} padding-box, ${columnFrame} border-box`,
        border: "1px solid transparent",
        borderRadius: 16,
        boxShadow: columnShadow,
        display: "grid",
        gridTemplateRows: "42px minmax(0, 1fr)",
        cursor: "default",
        overflow: "hidden",
      }}
    >
      <div
        style={{ display: "grid", gridTemplateColumns: canEdit ? "20px minmax(0, 1fr) 28px" : "20px minmax(0, 1fr)", alignItems: "center", borderBottom: `1px solid ${hexToRgba(color, 0.38)}`, background: `linear-gradient(135deg, ${hexToRgba(color, 0.36)}, rgba(255,255,255,0.80) 58%, ${hexToRgba(color, 0.18)})`, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.82)", cursor: "default" }}
      >
        <span aria-hidden="true" style={{ color: headerSubtext, fontSize: 15, lineHeight: 1, textAlign: "center", cursor: "default" }}>::</span>
        <div
          title={title}
          style={{ minWidth: 0, color: headerText, fontSize: 12, fontWeight: 750, padding: "0 5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: "none" }}
        >
          {title}
        </div>
        {canEdit && (
          <button
            className="mango-elevated-action"
            title="Create node"
            aria-label={`Create node in ${title}`}
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            disabled={busy}
            onClick={onCreate}
            style={{ width: 24, height: 24, padding: 0, boxSizing: "border-box", border: "1px solid rgba(255,255,255,0.74)", borderRadius: 7, background: KANBAN_SURFACE, color: headerText, cursor: "pointer", fontSize: 18, lineHeight: 1, boxShadow: "3px 3px 8px rgba(174,174,192,0.18), -3px -3px 8px rgba(255,255,255,0.78)" }}
          >
            +
          </button>
        )}
      </div>
      <div
        className="kanban-column-scroll"
        onMouseDown={onBlankMouseDown}
        style={{ minHeight: 0, overflow: "auto", display: "grid", gridTemplateColumns: isBacklogLayout ? "repeat(auto-fill, minmax(210px, 1fr))" : "minmax(0, 1fr)", gridAutoRows: "max-content", alignContent: "start", alignItems: "start", rowGap: 12, columnGap: isBacklogLayout ? 12 : 0, padding: 8, ["--kanban-column-scroll-accent" as string]: color, ["--kanban-column-scroll-track" as string]: "transparent" }}
      >
        {renderedCards}
      </div>
      {!isBacklogLayout && (
        <div
          title="Resize column width"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onResizeStart("width", event);
          }}
          style={{ position: "absolute", top: 0, right: -4, bottom: 0, width: 8, cursor: "col-resize", zIndex: 2 }}
        />
      )}
      <div
        title="Resize column height"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onResizeStart("height", event);
        }}
        style={{ position: "absolute", left: 0, right: 0, bottom: -4, height: 8, cursor: "row-resize", zIndex: 2 }}
      />
    </section>
  );
};
