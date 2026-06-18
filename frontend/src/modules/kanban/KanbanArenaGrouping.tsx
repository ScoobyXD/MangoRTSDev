import React from "react";
import {
  KANBAN_CARD_DRAG_MIME,
  KANBAN_GROUP_FIELDS,
  KANBAN_ISSUE_CARD_COLOR,
  KANBAN_LOGIC_GATE_BACKLOG_COLOR,
  KANBAN_LOGIC_GATE_DONE_COLOR,
  KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR,
  KANBAN_LOGIC_GATE_PENDING_COLOR,
  KANBAN_LOGIC_GATE_REQUESTED_COLOR,
  KANBAN_LOGIC_GATE_VERIFY_COLOR,
  KANBAN_NODE_PRIORITY_STYLE_OPTIONS,
  hexToRgba,
  parseKanbanCardDragPayload,
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
  KANBAN_ACTIVE_SURFACE,
  KANBAN_EDGE_FRAME,
  KANBAN_PANEL_BACKGROUND,
  KANBAN_PANEL_SHADOW,
  KANBAN_SHADOW,
  KANBAN_SOFT_BORDER,
  KANBAN_SURFACE,
  dataTransferIncludes,
} from "./KanbanContentModel";

export type ArenaGroupMenuID = "toolbar-x" | "toolbar-y";

type ArenaGroupSelectProps = {
  value: KanbanGroupField;
  onChange: (value: KanbanGroupField) => void;
  label: "X-Axis" | "Y-axis";
  menuID: ArenaGroupMenuID;
  sortDirection: KanbanGroupSortDirection;
  onToggleSortDirection: () => void;
  menuOpen: boolean;
  onSetMenuOpen: (menuID: ArenaGroupMenuID | null) => void;
  isDark: boolean;
  line: string;
  cardBackground: string;
  text: string;
};

function ArenaGroupSelect({
  value,
  onChange,
  label,
  menuID,
  sortDirection,
  onToggleSortDirection,
  menuOpen,
  onSetMenuOpen,
  isDark,
  line,
  cardBackground,
  text,
}: ArenaGroupSelectProps) {
  const selectedField = KANBAN_GROUP_FIELDS.find((field) => field.value === value) ?? KANBAN_GROUP_FIELDS[0];
  const groupMenuAccent = "rgb(71, 85, 105)";
  const selectedBackground = isDark ? "rgba(100, 116, 139, 0.18)" : `${KANBAN_ACTIVE_SURFACE} padding-box, ${KANBAN_EDGE_FRAME} border-box`;
  const hoveredBackground = "rgba(100, 116, 139, 0.14)";
  const sortLabel = sortDirection === "asc" ? "Asc" : "Desc";
  const sortButton = (
    <button
      className="mango-elevated-action"
      type="button"
      title={`${label} sort ${sortDirection === "asc" ? "ascending" : "descending"}`}
      onClick={onToggleSortDirection}
      style={{
        height: 28,
        border: isDark ? `1px solid ${line}` : `1px solid ${KANBAN_SOFT_BORDER}`,
        borderRadius: 8,
        background: isDark ? cardBackground : KANBAN_SURFACE,
        color: text,
        font: "inherit",
        fontSize: 10.5,
        fontWeight: 500,
        cursor: "pointer",
        padding: "0 8px",
        textAlign: "center",
        boxShadow: isDark ? "none" : KANBAN_SHADOW,
      }}
    >
      {sortLabel}
    </button>
  );

  const selectButton = (
    <span style={{ position: "relative", minWidth: 0, width: "100%" }}>
      <button
        className="mango-elevated-action"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        onClick={() => onSetMenuOpen(menuOpen ? null : menuID)}
        style={{
          width: "100%",
          minHeight: 28,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 16px",
          alignItems: "center",
          gap: 8,
          border: menuOpen && !isDark ? "1px solid transparent" : `1px solid ${menuOpen ? groupMenuAccent : (isDark ? line : KANBAN_SOFT_BORDER)}`,
          borderRadius: 8,
          background: menuOpen ? selectedBackground : (isDark ? cardBackground : KANBAN_SURFACE),
          color: menuOpen ? groupMenuAccent : text,
          font: "inherit",
          fontSize: 11,
          fontWeight: 500,
          padding: "4px 8px",
          cursor: "pointer",
          textAlign: "left",
          boxShadow: isDark ? (menuOpen ? "0 0 0 2px rgba(100, 116, 139, 0.14)" : "none") : KANBAN_SHADOW,
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
            border: `1px solid ${KANBAN_SOFT_BORDER}`,
            borderRadius: 12,
            background: KANBAN_PANEL_BACKGROUND,
            boxShadow: KANBAN_PANEL_SHADOW,
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
                  border: "1px solid transparent",
                  borderRadius: 9,
                  background: selected ? selectedBackground : "transparent",
                  color: selected ? groupMenuAccent : "#111827",
                  font: "inherit",
                  fontSize: 11,
                  fontWeight: selected ? 700 : 500,
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "4px 7px",
                  boxShadow: selected && !isDark ? "0 8px 20px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.86)" : undefined,
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
  menuOpen: ArenaGroupMenuID | null;
  onSetMenuOpen: (menuID: ArenaGroupMenuID | null) => void;
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
    <div ref={controlsRef as React.Ref<HTMLDivElement>} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, margin: 0, minHeight: 32 }}>
      <button
        className="mango-elevated-action"
        type="button"
        onClick={onToggleGroupingOpen}
        style={{
          height: 28,
          border: groupingOpen && !isDark ? "1px solid transparent" : `1px solid ${groupingOpen ? "rgb(71, 85, 105)" : (isDark ? line : KANBAN_SOFT_BORDER)}`,
          borderRadius: "8px 8px 0 0",
          background: groupingOpen && !isDark ? `${KANBAN_ACTIVE_SURFACE} padding-box, ${KANBAN_EDGE_FRAME} border-box` : (groupingOpen ? "rgba(100, 116, 139, 0.16)" : (isDark ? cardBackground : KANBAN_SURFACE)),
          color: groupingOpen ? "rgb(71, 85, 105)" : text,
          font: "inherit",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          padding: "0 9px",
          boxShadow: isDark ? "none" : KANBAN_SHADOW,
        }}
      >
        Group
      </button>
      {groupingOpen && (
        <>
          <ArenaGroupSelect value={yGroupBy} onChange={onSetYGroupBy} label="Y-axis" menuID="toolbar-y" sortDirection={ySortDirection} onToggleSortDirection={onToggleYSortDirection} menuOpen={menuOpen === "toolbar-y"} onSetMenuOpen={onSetMenuOpen} isDark={isDark} line={line} cardBackground={cardBackground} text={text} />
          <ArenaGroupSelect value={xGroupBy} onChange={onSetXGroupBy} label="X-Axis" menuID="toolbar-x" sortDirection={xSortDirection} onToggleSortDirection={onToggleXSortDirection} menuOpen={menuOpen === "toolbar-x"} onSetMenuOpen={onSetMenuOpen} isDark={isDark} line={line} cardBackground={cardBackground} text={text} />
        </>
      )}
    </div>
  );
}

export type KanbanArenaGroupedCellContext = {
  columnKey: string;
  rowKey: string;
};

function normalizeArenaGroupKeyValue(groupKey: string, prefix: string): string {
  return groupKey.startsWith(prefix) ? groupKey.slice(prefix.length).trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

function arenaGroupAccent(field: KanbanGroupField, groupKey: string): string {
  if (field === "status") {
    if (groupKey === "issue") return KANBAN_ISSUE_CARD_COLOR;
    const status = normalizeArenaGroupKeyValue(groupKey, "status:");
    if (status === "requested") return KANBAN_LOGIC_GATE_REQUESTED_COLOR;
    if (status === "backlog") return KANBAN_LOGIC_GATE_BACKLOG_COLOR;
    if (status === "pending") return KANBAN_LOGIC_GATE_PENDING_COLOR;
    if (status === "in_progress") return KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR;
    if (status === "review") return KANBAN_LOGIC_GATE_VERIFY_COLOR;
    if (status === "done") return KANBAN_LOGIC_GATE_DONE_COLOR;
    return "";
  }
  if (field === "priority") {
    const priority = normalizeArenaGroupKeyValue(groupKey, "priority:");
    return KANBAN_NODE_PRIORITY_STYLE_OPTIONS.find((option) => option.value === priority)?.color ?? "";
  }
  if (field === "person") return "#db2777";
  if (field === "due_date") return "#0891b2";
  return "";
}

function arenaGroupCellBackground(isDark: boolean, columnAccent: string, rowAccent: string): string {
  const first = columnAccent || rowAccent || "#475569";
  const second = rowAccent || columnAccent || "#0891b2";
  return isDark
    ? `linear-gradient(135deg, ${hexToRgba(first, 0.34)}, rgba(15, 23, 42, 0.80) 48%, ${hexToRgba(second, 0.27)}), ${ARENA_GROUP_FRAME_BACKGROUND}`
    : `linear-gradient(135deg, ${hexToRgba(first, 0.28)}, rgba(255,255,255,0.90) 45%, ${hexToRgba(second, 0.24)}), ${ARENA_GROUP_FRAME_BACKGROUND}`;
}

function arenaGroupLabelBackground(isDark: boolean, accent: string): string {
  if (!accent) return ARENA_GROUP_FRAME_BACKGROUND;
  return isDark
    ? `linear-gradient(135deg, ${hexToRgba(accent, 0.36)}, rgba(15, 23, 42, 0.76))`
    : `linear-gradient(135deg, ${hexToRgba(accent, 0.22)}, rgba(255,255,255,0.94))`;
}

export function KanbanArenaGroupedBoard({
  groupedBoard,
  xGroupBy,
  yGroupBy,
  isDark,
  text,
  renderCard,
  onDropCardIDsToCell,
  onCreateNodeInCell,
  onCellContextMenu,
}: {
  groupedBoard: KanbanGroupedBoardLayout;
  xGroupBy: KanbanGroupField;
  yGroupBy: KanbanGroupField;
  isDark: boolean;
  text: string;
  renderCard: (card: KanbanCard, groupedCell?: KanbanArenaGroupedCellContext) => React.ReactNode;
  onDropCardIDsToCell?: (cardIDs: string[], columnKey: string, rowKey: string) => void;
  onCreateNodeInCell?: (columnKey: string, rowKey: string) => void;
  onCellContextMenu?: (columnKey: string, rowKey: string, event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const [activeDropCellKey, setActiveDropCellKey] = React.useState("");
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
      <div aria-hidden="true" style={{ position: "sticky", left: 0, zIndex: 7, border: `1px solid ${glassBorder}`, borderTopLeftRadius: 8, background: groupFrameBackground, boxShadow: groupFrameShadow, padding: 8 }} />
      {groupedBoard.columns.map((column, columnIndex) => {
        const columnAccent = arenaGroupAccent(xGroupBy, column.key);
        return (
          <div key={column.key} style={{ border: `1px solid ${columnAccent ? hexToRgba(columnAccent, 0.40) : glassBorder}`, borderLeft: columnIndex === 0 ? "none" : undefined, borderTopRightRadius: columnIndex === groupedBoard.columns.length - 1 ? 8 : 0, background: arenaGroupLabelBackground(isDark, columnAccent), boxShadow: columnAccent ? `${groupFrameShadow}, inset 0 -2px 0 ${hexToRgba(columnAccent, 0.72)}` : groupFrameShadow, padding: 8, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: columnAccent || text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{column.label}</div>
          </div>
        );
      })}
      {groupedBoard.rows.flatMap((row, rowIndex) => {
        const rowAccent = arenaGroupAccent(yGroupBy, row.key);
        return [
        <div key={`row-label:${row.key}`} style={{ position: "sticky", left: 0, zIndex: 6, border: `1px solid ${rowAccent ? hexToRgba(rowAccent, 0.40) : glassBorder}`, borderTop: rowIndex === 0 ? "none" : undefined, borderBottomLeftRadius: rowIndex === rowCount - 1 ? 8 : 0, background: arenaGroupLabelBackground(isDark, rowAccent), boxShadow: rowAccent ? `${groupFrameShadow}, inset -2px 0 0 ${hexToRgba(rowAccent, 0.72)}` : groupFrameShadow, padding: 8, display: "flex", alignItems: "center", minHeight: ARENA_GROUP_MIN_CELL_HEIGHT_PX, color: rowAccent || text, fontSize: 11, fontWeight: 800 }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{row.label}</span>
        </div>,
        ...groupedBoard.columns.map((column, columnIndex) => {
          const cell = column.cells.find((item) => item.rowKey === row.key) ?? { rowKey: row.key, cards: [] };
          const cellKey = `cell:${column.key}:${row.key}`;
          const activeDrop = activeDropCellKey === cellKey;
          const columnAccent = arenaGroupAccent(xGroupBy, column.key);
          const activeAccent = columnAccent || rowAccent || "#475569";
          return (
            <div
              key={cellKey}
              onContextMenu={(event) => {
                if (!onCellContextMenu) return;
                event.preventDefault();
                event.stopPropagation();
                onCellContextMenu(column.key, row.key, event);
              }}
              onDragOver={(event) => {
                if (!onDropCardIDsToCell || !dataTransferIncludes(event, KANBAN_CARD_DRAG_MIME)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                setActiveDropCellKey(cellKey);
              }}
              onDragLeave={(event) => {
                const relatedTarget = event.relatedTarget;
                if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
                setActiveDropCellKey((current) => (current === cellKey ? "" : current));
              }}
              onDrop={(event) => {
                if (!onDropCardIDsToCell) return;
                const cardPayload = parseKanbanCardDragPayload(event.dataTransfer.getData(KANBAN_CARD_DRAG_MIME));
                if (!cardPayload) return;
                event.preventDefault();
                event.stopPropagation();
                setActiveDropCellKey("");
                onDropCardIDsToCell(cardPayload.cardIDs, column.key, row.key);
              }}
              style={{
                minHeight: ARENA_GROUP_MIN_CELL_HEIGHT_PX,
                display: "grid",
                alignContent: "start",
                gap: 8,
                border: `1px solid ${glassBorder}`,
                borderLeft: columnIndex === 0 ? "none" : undefined,
                borderTop: rowIndex === 0 ? "none" : undefined,
                borderBottomRightRadius: rowIndex === rowCount - 1 && columnIndex === groupedBoard.columns.length - 1 ? 8 : 0,
                background: arenaGroupCellBackground(isDark, columnAccent, rowAccent),
                boxShadow: activeDrop ? `${groupFrameShadow}, inset 0 0 0 2px ${hexToRgba(activeAccent, 0.48)}` : groupFrameShadow,
                padding: 8,
              }}
            >
              {onCreateNodeInCell && (
                <button
                  className="mango-elevated-action"
                  type="button"
                  title="Create node in this cell"
                  onClick={() => onCreateNodeInCell(column.key, row.key)}
                  style={{
                    justifySelf: "end",
                    width: 26,
                    height: 24,
                    border: `1px solid ${glassBorder}`,
                    borderRadius: 7,
                    background: isDark ? "rgba(15, 23, 42, 0.78)" : "rgba(255,255,255,0.88)",
                    color: text,
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 16,
                    fontWeight: 800,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  +
                </button>
              )}
              {cell.cards.map((card) => renderCard(card, { columnKey: column.key, rowKey: row.key }))}
            </div>
          );
        }),
      ];
      })}
    </div>
  );
}
