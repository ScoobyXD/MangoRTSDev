import React from "react";
import {
  KANBAN_GROUP_FIELDS,
  type KanbanCard,
  type KanbanGroupedBoardLayout,
  type KanbanGroupField,
  type KanbanGroupSortDirection,
} from "./shared";
import {
  ARENA_GROUP_COLUMN_WIDTH_PX,
  ARENA_GROUP_FRAME_BACKGROUND,
  ARENA_GROUP_FRAME_SHADOW,
  ARENA_GROUP_GLASS_BORDER_DARK,
  ARENA_GROUP_GLASS_BORDER_LIGHT,
  ARENA_GROUP_MIN_CELL_HEIGHT_PX,
  ARENA_GROUP_ROW_LABEL_WIDTH_PX,
  KanbanCheckIcon,
  KanbanDisclosureIcon,
} from "./KanbanContentModel";

type AxisID = "x" | "y";

type ArenaGroupSelectProps = {
  value: KanbanGroupField;
  onChange: (value: KanbanGroupField) => void;
  label: "X-Axis" | "Y-axis";
  axis: AxisID;
  sortDirection: KanbanGroupSortDirection;
  onToggleSortDirection: () => void;
  layout?: "inline" | "compact";
  menuOpen: boolean;
  onSetMenuOpen: (axis: AxisID | null) => void;
  isDark: boolean;
  line: string;
  cardBackground: string;
  text: string;
};

function ArenaGroupSelect({
  value,
  onChange,
  label,
  axis,
  sortDirection,
  onToggleSortDirection,
  layout = "inline",
  menuOpen,
  onSetMenuOpen,
  isDark,
  line,
  cardBackground,
  text,
}: ArenaGroupSelectProps) {
  const selectedField = KANBAN_GROUP_FIELDS.find((field) => field.value === value) ?? KANBAN_GROUP_FIELDS[0];
  const groupMenuAccent = "rgb(0, 233, 255)";
  const selectedBackground = isDark ? "rgba(0, 188, 212, 0.18)" : "rgba(0, 188, 212, 0.22)";
  const hoveredBackground = "rgba(0, 188, 212, 0.14)";
  const sortLabel = sortDirection === "asc" ? "Asc" : "Desc";
  const compact = layout === "compact";
  const sortButton = (
    <button
      type="button"
      title={`${label} sort ${sortDirection === "asc" ? "ascending" : "descending"}`}
      onClick={onToggleSortDirection}
      style={{
        height: compact ? 20 : 28,
        minWidth: compact ? 44 : undefined,
        border: `1px solid ${line}`,
        borderRadius: compact ? 4 : 6,
        background: cardBackground,
        color: text,
        font: "inherit",
        fontSize: compact ? 9 : 10.5,
        fontWeight: 500,
        cursor: "pointer",
        padding: compact ? "0 5px" : "0 8px",
        textAlign: "center",
      }}
    >
      {sortLabel}
    </button>
  );

  const selectButton = (
    <span style={{ position: "relative", minWidth: 0, width: "100%" }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        onClick={() => onSetMenuOpen(menuOpen ? null : axis)}
        style={{
          width: "100%",
          minHeight: 28,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 16px",
          alignItems: "center",
          gap: 8,
          border: `1px solid ${menuOpen ? groupMenuAccent : line}`,
          borderRadius: 6,
          background: menuOpen ? selectedBackground : cardBackground,
          color: menuOpen ? groupMenuAccent : text,
          font: "inherit",
          fontSize: 11,
          fontWeight: 500,
          padding: compact ? "4px 6px" : "4px 8px",
          cursor: "pointer",
          textAlign: "left",
          boxShadow: menuOpen ? "0 0 0 2px rgba(0, 188, 212, 0.14)" : "none",
        }}
      >
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedField.label}</span>
        <span aria-hidden="true" style={{ display: "grid", placeItems: "center", transform: menuOpen ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}>
          <KanbanDisclosureIcon color="currentColor" />
        </span>
      </button>
      {menuOpen && (
        <div
          role="listbox"
          aria-label={`${label} grouping`}
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 5px)",
            left: 0,
            width: "min(220px, 78vw)",
            padding: 5,
            border: "1px solid rgba(0, 188, 212, 0.34)",
            borderRadius: 6,
            background: "#ffffff",
            boxShadow: "0 12px 28px rgba(0,16,20,0.18)",
            color: "#111827",
          }}
        >
          {KANBAN_GROUP_FIELDS.map((field) => {
            const selected = field.value === value;
            return (
              <button
                key={field.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(field.value);
                  onSetMenuOpen(null);
                }}
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "18px minmax(0, 1fr)",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 28,
                  border: "none",
                  borderRadius: 5,
                  background: selected ? selectedBackground : "transparent",
                  color: selected ? groupMenuAccent : "#111827",
                  font: "inherit",
                  fontSize: 11,
                  fontWeight: selected ? 700 : 500,
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "4px 7px",
                }}
                onMouseEnter={(event) => {
                  if (!selected) event.currentTarget.style.background = hoveredBackground;
                }}
                onMouseLeave={(event) => {
                  if (!selected) event.currentTarget.style.background = "transparent";
                }}
              >
                <span aria-hidden="true" style={{ width: 18, height: 18, display: "grid", placeItems: "center" }}>
                  {selected && <KanbanCheckIcon color={groupMenuAccent} />}
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{field.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );

  if (compact) {
    return (
      <div data-arena-group-controls="true" style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: text, opacity: 0.72 }}>{label}</span>
        <span style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 4, minWidth: 0 }}>
          {selectButton}
          {sortButton}
        </span>
      </div>
    );
  }

  return (
    <div data-arena-group-controls="true" style={{ display: "grid", gridTemplateColumns: "52px minmax(0, 160px) auto", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span style={{ color: text, opacity: 0.72, fontSize: 10.5, fontWeight: 700, textAlign: "right" }}>{label}</span>
      {selectButton}
      {sortButton}
    </div>
  );
}

export function KanbanArenaGroupingControls({
  controlsRef,
  groupingOpen,
  onToggleGroupingOpen,
  xGroupBy,
  yGroupBy,
  xSortDirection,
  ySortDirection,
  menuOpen,
  onSetMenuOpen,
  onSetXGroupBy,
  onSetYGroupBy,
  onToggleXSortDirection,
  onToggleYSortDirection,
  isDark,
  line,
  cardBackground,
  text,
}: {
  controlsRef: React.RefObject<HTMLDivElement | null>;
  groupingOpen: boolean;
  onToggleGroupingOpen: () => void;
  xGroupBy: KanbanGroupField;
  yGroupBy: KanbanGroupField;
  xSortDirection: KanbanGroupSortDirection;
  ySortDirection: KanbanGroupSortDirection;
  menuOpen: AxisID | null;
  onSetMenuOpen: (axis: AxisID | null) => void;
  onSetXGroupBy: (value: KanbanGroupField) => void;
  onSetYGroupBy: (value: KanbanGroupField) => void;
  onToggleXSortDirection: () => void;
  onToggleYSortDirection: () => void;
  isDark: boolean;
  line: string;
  cardBackground: string;
  text: string;
}) {
  return (
    <div ref={controlsRef as React.Ref<HTMLDivElement>} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, margin: "0 0 8px 0", minHeight: 32 }}>
      <button
        type="button"
        onClick={onToggleGroupingOpen}
        style={{
          height: 28,
          border: `1px solid ${groupingOpen ? "rgb(0, 233, 255)" : line}`,
          borderRadius: 6,
          background: groupingOpen ? "rgba(0, 188, 212, 0.16)" : cardBackground,
          color: groupingOpen ? "rgb(0, 233, 255)" : text,
          font: "inherit",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          padding: "0 9px",
        }}
      >
        Group
      </button>
      <ArenaGroupSelect value={yGroupBy} onChange={onSetYGroupBy} label="Y-axis" axis="y" sortDirection={ySortDirection} onToggleSortDirection={onToggleYSortDirection} menuOpen={menuOpen === "y"} onSetMenuOpen={onSetMenuOpen} isDark={isDark} line={line} cardBackground={cardBackground} text={text} />
      <ArenaGroupSelect value={xGroupBy} onChange={onSetXGroupBy} label="X-Axis" axis="x" sortDirection={xSortDirection} onToggleSortDirection={onToggleXSortDirection} menuOpen={menuOpen === "x"} onSetMenuOpen={onSetMenuOpen} isDark={isDark} line={line} cardBackground={cardBackground} text={text} />
    </div>
  );
}

export function KanbanArenaGroupedBoard({
  groupedBoard,
  yGroupBy,
  xGroupBy,
  ySortDirection,
  xSortDirection,
  menuOpen,
  onSetMenuOpen,
  onSetYGroupBy,
  onSetXGroupBy,
  onToggleYSortDirection,
  onToggleXSortDirection,
  isDark,
  line,
  cardBackground,
  text,
  renderCard,
}: {
  groupedBoard: KanbanGroupedBoardLayout;
  yGroupBy: KanbanGroupField;
  xGroupBy: KanbanGroupField;
  ySortDirection: KanbanGroupSortDirection;
  xSortDirection: KanbanGroupSortDirection;
  menuOpen: AxisID | null;
  onSetMenuOpen: (axis: AxisID | null) => void;
  onSetYGroupBy: (value: KanbanGroupField) => void;
  onSetXGroupBy: (value: KanbanGroupField) => void;
  onToggleYSortDirection: () => void;
  onToggleXSortDirection: () => void;
  isDark: boolean;
  line: string;
  cardBackground: string;
  text: string;
  renderCard: (card: KanbanCard) => React.ReactNode;
}) {
  const glassBorder = isDark ? ARENA_GROUP_GLASS_BORDER_DARK : ARENA_GROUP_GLASS_BORDER_LIGHT;
  const groupFrameBackground = ARENA_GROUP_FRAME_BACKGROUND;
  const groupFrameShadow = ARENA_GROUP_FRAME_SHADOW;
  const rowCount = Math.max(1, groupedBoard.rows.length);

  if (groupedBoard.columns.length === 0 || groupedBoard.rows.length === 0) {
    return <div style={{ minHeight: 140, display: "grid", placeItems: "center", color: text, opacity: 0.72, fontSize: 12, fontWeight: 600 }}>No cards</div>;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${ARENA_GROUP_ROW_LABEL_WIDTH_PX}px repeat(${groupedBoard.columns.length}, minmax(${ARENA_GROUP_COLUMN_WIDTH_PX}px, 1fr))`,
        minWidth: ARENA_GROUP_ROW_LABEL_WIDTH_PX + groupedBoard.columns.length * ARENA_GROUP_COLUMN_WIDTH_PX,
        alignItems: "stretch",
      }}
    >
      <div style={{ position: "sticky", left: 0, zIndex: 7, border: `1px solid ${glassBorder}`, borderTopLeftRadius: 8, background: groupFrameBackground, boxShadow: groupFrameShadow, padding: 8 }}>
        <ArenaGroupSelect value={yGroupBy} onChange={onSetYGroupBy} label="Y-axis" axis="y" sortDirection={ySortDirection} onToggleSortDirection={onToggleYSortDirection} layout="compact" menuOpen={menuOpen === "y"} onSetMenuOpen={onSetMenuOpen} isDark={isDark} line={line} cardBackground={cardBackground} text={text} />
      </div>
      {groupedBoard.columns.map((column, columnIndex) => (
        <div key={column.key} style={{ border: `1px solid ${glassBorder}`, borderLeft: columnIndex === 0 ? "none" : undefined, borderTopRightRadius: columnIndex === groupedBoard.columns.length - 1 ? 8 : 0, background: groupFrameBackground, boxShadow: groupFrameShadow, padding: 8, minWidth: 0 }}>
          {columnIndex === 0 ? (
            <ArenaGroupSelect value={xGroupBy} onChange={onSetXGroupBy} label="X-Axis" axis="x" sortDirection={xSortDirection} onToggleSortDirection={onToggleXSortDirection} layout="compact" menuOpen={menuOpen === "x"} onSetMenuOpen={onSetMenuOpen} isDark={isDark} line={line} cardBackground={cardBackground} text={text} />
          ) : (
            <div style={{ minHeight: 44 }} />
          )}
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{column.label}</div>
        </div>
      ))}
      {groupedBoard.rows.flatMap((row, rowIndex) => [
        <div key={`row-label:${row.key}`} style={{ position: "sticky", left: 0, zIndex: 6, border: `1px solid ${glassBorder}`, borderTop: rowIndex === 0 ? "none" : undefined, borderBottomLeftRadius: rowIndex === rowCount - 1 ? 8 : 0, background: groupFrameBackground, boxShadow: groupFrameShadow, padding: 8, display: "flex", alignItems: "center", minHeight: ARENA_GROUP_MIN_CELL_HEIGHT_PX, color: text, fontSize: 11, fontWeight: 700 }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{row.label}</span>
        </div>,
        ...groupedBoard.columns.map((column, columnIndex) => {
          const cell = column.cells.find((item) => item.rowKey === row.key) ?? { rowKey: row.key, cards: [] };
          return (
            <div
              key={`cell:${column.key}:${row.key}`}
              style={{
                minHeight: ARENA_GROUP_MIN_CELL_HEIGHT_PX,
                display: "grid",
                alignContent: "start",
                gap: 8,
                border: `1px solid ${glassBorder}`,
                borderLeft: columnIndex === 0 ? "none" : undefined,
                borderTop: rowIndex === 0 ? "none" : undefined,
                borderBottomRightRadius: rowIndex === rowCount - 1 && columnIndex === groupedBoard.columns.length - 1 ? 8 : 0,
                background: groupFrameBackground,
                boxShadow: groupFrameShadow,
                padding: 8,
              }}
            >
              {cell.cards.map((card) => renderCard(card))}
            </div>
          );
        }),
      ])}
    </div>
  );
}
