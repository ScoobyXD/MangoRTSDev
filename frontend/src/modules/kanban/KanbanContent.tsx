import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { EVENT_EXPLORER_CONTEXT_UPDATED } from "../node-map/eventbus";
import { NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { createKanbanColumn, deleteKanbanColumn, listKanbanCards, listKanbanColumns, moveKanbanCard, updateKanbanColumn, upsertKanbanCard } from "./kanbanApi";
import {
  EXPLORER_ENTITY_DRAG_MIME,
  KANBAN_CARD_DRAG_MIME,
  KANBAN_COLUMN_DRAG_MIME,
  KANBAN_COLUMN_TITLE_TEXT_TRANSFORM,
  KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
  KANBAN_DEFAULT_COLUMN_WIDTH_PX,
  KANBAN_MODULE_TOP_CLEARANCE_PX,
  buildColumnReorderPlan,
  clampColumnHeight,
  clampColumnWidth,
  getColumnHeight,
  getColumnWidth,
  getKanbanConditionalColor,
  groupCardsByColumn,
  normalizeKanbanColumnItemColor,
  nextCardPosition,
  nextColumnPosition,
  parseExplorerEntityDragPayload,
  parseKanbanCardDragPayload,
  parseKanbanColumnDragPayload,
  sortColumns,
  type KanbanCard,
  type KanbanColumn,
  type KanbanColumnDropPlacement,
} from "./shared";

type HighlightedEntity = { nodeID: string } | null;

type ColumnResizeState = {
  axis: "width" | "height";
  columnID: string;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  currentWidth: number;
  currentHeight: number;
};

const contextMenuButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "9px 16px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  fontFamily: "'IBM Plex Mono', monospace",
  background: "none",
  border: "none",
  color: "#333",
  cursor: "pointer",
  textAlign: "left",
};

const contextMenuHoverHandlers = {
  onMouseEnter: (event: React.MouseEvent) => { (event.currentTarget as HTMLElement).style.background = "#f5f5f5"; },
  onMouseLeave: (event: React.MouseEvent) => { (event.currentTarget as HTMLElement).style.background = "none"; },
};

const NodeDocumentIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
    <path d="M4 1.75h5.25L12 4.5v9.75H4z" fill="none" stroke={color} strokeWidth="1.35" />
    <path d="M9.25 1.75V4.5H12M5.75 7.25h4.5M5.75 9.5h4.5M5.75 11.75h3" fill="none" stroke={color} strokeWidth="1.15" />
  </svg>
);

function readLinkedExplorerSelection(companyID: string, scope: string): HighlightedEntity {
  try {
    const nodeRaw = localStorage.getItem(`${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`);
    if (nodeRaw) {
      const parsed = JSON.parse(nodeRaw) as { selectedNodeID?: unknown };
      if (typeof parsed.selectedNodeID === "string" && parsed.selectedNodeID.trim()) {
        return { nodeID: parsed.selectedNodeID.trim() };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function dataTransferIncludes(event: React.DragEvent, mime: string): boolean {
  return Array.from(event.dataTransfer.types).includes(mime);
}

function columnDropPlacement(event: React.DragEvent<HTMLElement>): KanbanColumnDropPlacement {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientX > bounds.left + bounds.width / 2 ? "after" : "before";
}

export const KanbanContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }> = ({ accent, widgetId, theme = "teal" }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const boardID = widgetId?.trim() ? widgetId : "global-kanban";
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [highlightedEntity, setHighlightedEntity] = useState<HighlightedEntity>(() => readLinkedExplorerSelection(companyID, boardID));
  const [editingColumnID, setEditingColumnID] = useState("");
  const [draggingColumnID, setDraggingColumnID] = useState("");
  const [dragOverColumn, setDragOverColumn] = useState<{ columnID: string; placement: KanbanColumnDropPlacement } | null>(null);
  const [expandedCardIDs, setExpandedCardIDs] = useState<Set<string>>(() => new Set());
  const [addColumnHover, setAddColumnHover] = useState(false);
  const [columnContextMenu, setColumnContextMenu] = useState<{ x: number; y: number; columnID: string } | null>(null);
  const [deleteColumnConfirmation, setDeleteColumnConfirmation] = useState<{ columnID: string; title: string } | null>(null);
  const resizeRef = useRef<ColumnResizeState | null>(null);

  const isDark = theme === "dark";
  const surface = isDark ? "#11161b" : "#ffffff";
  const text = isDark ? "#f6f8fb" : "#102226";
  const subtext = isDark ? "#b8c4cc" : "#52666c";
  const line = isDark ? "rgba(255,255,255,0.16)" : "rgba(8, 52, 58, 0.16)";
  const laneBackground = isDark ? "#1a2229" : "#ffffff";
  const laneBorder = isDark ? "rgba(255,255,255,0.18)" : "rgba(17,17,17,0.78)";
  const laneShadow = isDark ? "none" : "0 4px 12px rgba(16,24,40,0.08)";
  const cardBackground = isDark ? "#101418" : "#ffffff";

  const orderedColumns = useMemo(() => sortColumns(columns), [columns]);
  const columnColorByID = useMemo(() => new Map(orderedColumns.map((column) => [column.column_id, normalizeKanbanColumnItemColor(column.item_color)])), [orderedColumns]);
  const cardsByColumn = useMemo(() => groupCardsByColumn(cards), [cards]);

  const refreshBoard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextColumns, nextCards] = await Promise.all([
        listKanbanColumns(apiBase, companyID, boardID),
        // The UI renders a bounded first window. Headless agents should page by
        // column through the cards API instead of loading company-scale boards.
        listKanbanCards(apiBase, companyID, boardID, "", 500),
      ]);
      setColumns(sortColumns(nextColumns));
      setCards(nextCards);
    } catch {
      setError("Kanban board API unavailable");
    } finally {
      setLoading(false);
    }
  }, [apiBase, boardID, companyID]);

  useEffect(() => {
    refreshBoard();
  }, [refreshBoard]);

  useEffect(() => {
    const refreshSelection = () => setHighlightedEntity(readLinkedExplorerSelection(companyID, boardID));
    const onExplorerContext = (event: Event) => {
      const detail = (event as CustomEvent<{ targetID?: string }>).detail;
      if (!detail || detail.targetID !== boardID) return;
      refreshSelection();
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (!event.key.endsWith(`:${companyID}:${boardID}`)) return;
      refreshSelection();
    };
    window.addEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContext);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContext);
      window.removeEventListener("storage", onStorage);
    };
  }, [boardID, companyID]);

  const addColumn = useCallback(async () => {
    setError("");
    try {
      const column = await createKanbanColumn(
        apiBase,
        companyID,
        boardID,
        "New Column Name",
        nextColumnPosition(columns),
        KANBAN_DEFAULT_COLUMN_WIDTH_PX,
        KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
      );
      setColumns((previous) => [...previous, column].sort((a, b) => a.position - b.position));
      setEditingColumnID(column.column_id);
    } catch {
      setError("Column create failed");
    }
  }, [apiBase, boardID, columns, companyID]);

  const commitColumnTitle = useCallback(async (columnID: string, title: string) => {
    const cleanTitle = title.trim();
    const existing = columns.find((column) => column.column_id === columnID);
    if (!existing || !cleanTitle) return;
    setError("");
    try {
      const updated = await updateKanbanColumn({ apiBase, companyID, boardID, columnID, title: cleanTitle });
      setColumns((previous) => previous.map((column) => (column.column_id === columnID ? updated : column)));
      setEditingColumnID("");
    } catch {
      setError("Column rename failed");
      refreshBoard();
    }
  }, [apiBase, boardID, columns, companyID, refreshBoard]);

  const removeColumn = useCallback(async (columnID: string) => {
    const previousColumns = columns;
    const previousCards = cards;
    setColumns((current) => current.filter((column) => column.column_id !== columnID));
    setCards((current) => current.filter((card) => card.column_id !== columnID));
    setError("");
    try {
      await deleteKanbanColumn(apiBase, companyID, boardID, columnID);
    } catch {
      setError("Column delete failed");
      setColumns(previousColumns);
      setCards(previousCards);
    }
  }, [apiBase, boardID, cards, columns, companyID]);

  const requestColumnDelete = useCallback((columnID: string) => {
    const column = columns.find((item) => item.column_id === columnID);
    if (!column) return;
    setColumnContextMenu(null);
    setDeleteColumnConfirmation({ columnID, title: column.title });
  }, [columns]);

  const reorderColumn = useCallback(async (draggedColumnID: string, targetColumnID: string | null, placement: KanbanColumnDropPlacement = "before") => {
    const plan = buildColumnReorderPlan(columns, draggedColumnID, targetColumnID, placement);
    if (plan.updates.length === 0) {
      setDraggingColumnID("");
      setDragOverColumn(null);
      return;
    }
    setColumns(plan.columns);
    setDraggingColumnID("");
    setDragOverColumn(null);
    setError("");
    try {
      // Sparse positions keep most reorders to a single API write. Compaction is
      // rare and still limited to visible board columns.
      await Promise.all(plan.updates.map((update) => updateKanbanColumn({
        apiBase,
        companyID,
        boardID,
        columnID: update.columnID,
        position: update.position,
      })));
    } catch {
      setError("Column reorder failed");
      refreshBoard();
    }
  }, [apiBase, boardID, columns, companyID, refreshBoard]);

  const persistColumnSize = useCallback(async (columnID: string, size: { widthPx?: number; heightPx?: number }) => {
    setError("");
    try {
      const updated = await updateKanbanColumn({ apiBase, companyID, boardID, columnID, ...size });
      setColumns((previous) => previous.map((column) => (column.column_id === updated.column_id ? updated : column)));
    } catch {
      setError("Column resize failed");
      refreshBoard();
    }
  }, [apiBase, boardID, companyID, refreshBoard]);

  const persistColumnItemColor = useCallback(async (columnID: string, itemColor: string) => {
    const cleanColor = normalizeKanbanColumnItemColor(itemColor);
    setColumns((previous) => previous.map((column) => (column.column_id === columnID ? { ...column, item_color: cleanColor } : column)));
    setError("");
    try {
      const updated = await updateKanbanColumn({ apiBase, companyID, boardID, columnID, itemColor: cleanColor });
      setColumns((previous) => previous.map((column) => (column.column_id === updated.column_id ? updated : column)));
    } catch {
      setError("Column color update failed");
      refreshBoard();
    }
  }, [apiBase, boardID, companyID, refreshBoard]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const resize = resizeRef.current;
      if (!resize) return;
      if (resize.axis === "width") {
        const widthPx = clampColumnWidth(resize.startWidth + event.clientX - resize.startX);
        resize.currentWidth = widthPx;
        setColumns((previous) => previous.map((column) => (column.column_id === resize.columnID ? { ...column, width_px: widthPx } : column)));
        return;
      }
      const heightPx = clampColumnHeight(resize.startHeight + event.clientY - resize.startY);
      resize.currentHeight = heightPx;
      setColumns((previous) => previous.map((column) => (column.column_id === resize.columnID ? { ...column, height_px: heightPx } : column)));
    };
    const onUp = () => {
      const resize = resizeRef.current;
      if (!resize) return;
      resizeRef.current = null;
      if (resize.axis === "width") {
        void persistColumnSize(resize.columnID, { widthPx: resize.currentWidth });
        return;
      }
      void persistColumnSize(resize.columnID, { heightPx: resize.currentHeight });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [persistColumnSize]);

  const moveCardToColumn = useCallback(async (cardID: string, columnID: string) => {
    const position = nextCardPosition(cards, columnID);
    const movedAt = new Date().toISOString();
    setCards((previous) => previous.map((card) => (card.card_id === cardID ? { ...card, column_id: columnID, position, updated_timestamp: movedAt } : card)));
    try {
      const moved = await moveKanbanCard({ apiBase, companyID, boardID, cardID, columnID, position });
      setCards((previous) => previous.map((card) => (card.card_id === moved.card_id ? moved : card)));
    } catch {
      setError("Card move failed");
      refreshBoard();
    }
  }, [apiBase, boardID, cards, companyID, refreshBoard]);

  const addEntityToColumn = useCallback(async (columnID: string, nodeID: string, label: string) => {
    const position = nextCardPosition(cards, columnID);
    const now = new Date().toISOString();
    const optimistic: KanbanCard = {
      company_id: companyID,
      board_id: boardID,
      card_id: `pending-node-${nodeID}`,
      column_id: columnID,
      node_id: nodeID,
      node_title: label,
      description_snapshot: "",
      position,
      created_timestamp: now,
      updated_timestamp: now,
    };
    setCards((previous) => [...previous.filter((card) => card.node_id !== nodeID), optimistic]);
    try {
      const saved = await upsertKanbanCard({ apiBase, companyID, boardID, columnID, nodeID, nodeTitle: label, position });
      setCards((previous) => [...previous.filter((card) => card.card_id !== optimistic.card_id && card.node_id !== nodeID), saved]);
    } catch {
      setError("Drop failed");
      refreshBoard();
    }
  }, [apiBase, boardID, cards, companyID, refreshBoard]);

  const onDropColumn = useCallback((event: React.DragEvent<HTMLElement>, columnID: string) => {
    event.preventDefault();
    setDragOverColumn(null);
    const columnPayload = parseKanbanColumnDragPayload(event.dataTransfer.getData(KANBAN_COLUMN_DRAG_MIME));
    if (columnPayload) {
      void reorderColumn(columnPayload.columnID, columnID, columnDropPlacement(event));
      return;
    }
    const cardPayload = parseKanbanCardDragPayload(event.dataTransfer.getData(KANBAN_CARD_DRAG_MIME));
    if (cardPayload) {
      if (cardPayload.sourceColumnID !== columnID) void moveCardToColumn(cardPayload.cardID, columnID);
      return;
    }
    const explorerPayload = parseExplorerEntityDragPayload(event.dataTransfer.getData(EXPLORER_ENTITY_DRAG_MIME));
    if (explorerPayload) {
      void addEntityToColumn(columnID, explorerPayload.nodeID, explorerPayload.label);
    }
  }, [addEntityToColumn, moveCardToColumn, reorderColumn]);

  const onDropAtEnd = useCallback((event: React.DragEvent) => {
    const columnPayload = parseKanbanColumnDragPayload(event.dataTransfer.getData(KANBAN_COLUMN_DRAG_MIME));
    if (!columnPayload) return;
    event.preventDefault();
    void reorderColumn(columnPayload.columnID, null);
  }, [reorderColumn]);

  const toggleCardExpanded = useCallback((cardID: string) => {
    setExpandedCardIDs((previous) => {
      const next = new Set(previous);
      if (next.has(cardID)) {
        next.delete(cardID);
      } else {
        next.add(cardID);
      }
      return next;
    });
  }, []);

  const renderCard = (card: KanbanCard): React.ReactNode => {
    const highlighted = highlightedEntity?.nodeID === card.node_id;
    const expanded = expandedCardIDs.has(card.card_id);
    const description = (card.description_snapshot ?? "").trim();
    const color = getKanbanConditionalColor(card, columnColorByID);
    return (
      <article
        key={card.card_id}
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(KANBAN_CARD_DRAG_MIME, JSON.stringify({ cardID: card.card_id, sourceColumnID: card.column_id }));
        }}
        style={{
          border: `1px solid ${highlighted ? accent : line}`,
          borderLeft: `5px solid ${color}`,
          background: cardBackground,
          color: text,
          padding: "8px 9px",
          minHeight: 58,
          cursor: "grab",
          boxShadow: highlighted ? `0 0 0 1px ${accent} inset` : undefined,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "16px minmax(0, 1fr) 22px", gap: 6, alignItems: "start" }}>
          <span title="Node" style={{ width: 16, height: 16, marginTop: 1, display: "grid", placeItems: "center" }}>
            <NodeDocumentIcon color={color} />
          </span>
          <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.25, overflowWrap: "anywhere" }}>{card.node_title}</div>
          <button
            type="button"
            title={expanded ? "Collapse card text" : "Expand card text"}
            onClick={() => toggleCardExpanded(card.card_id)}
            style={{ width: 22, height: 22, border: `1px solid ${line}`, background: "transparent", color: subtext, cursor: "pointer", fontSize: 11, lineHeight: 1 }}
          >
            {expanded ? "^" : "v"}
          </button>
        </div>
        {description && (
          <div style={{ marginTop: 7, color: subtext, fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere", maxHeight: expanded ? undefined : 32, overflow: "hidden" }}>
            {description}
          </div>
        )}
      </article>
    );
  };

  const contextColumn = columnContextMenu ? columns.find((column) => column.column_id === columnContextMenu.columnID) : null;

  return (
    <div
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      style={{ position: "relative", width: "100%", height: "100%", boxSizing: "border-box", paddingTop: KANBAN_MODULE_TOP_CLEARANCE_PX, background: surface, color: text, overflow: "hidden" }}
    >
      <div style={{ position: "absolute", top: KANBAN_MODULE_TOP_CLEARANCE_PX - 1, left: 0, right: 0, borderBottom: `1px solid ${line}`, pointerEvents: "none" }} />
      <div style={{ height: "100%", overflow: "auto", padding: "12px 12px 14px", boxSizing: "border-box" }}>
        {error && <div style={{ marginBottom: 8, color: "#c62828", fontSize: 11, fontWeight: 700 }}>{error}</div>}
        {loading && <div style={{ color: subtext, fontSize: 12 }}>Loading board...</div>}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: KANBAN_DEFAULT_COLUMN_HEIGHT_PX + 18, paddingBottom: 16 }}>
          {orderedColumns.map((column) => {
            const columnCards = cardsByColumn.get(column.column_id) ?? [];
            const columnWidth = getColumnWidth(column);
            const columnHeight = getColumnHeight(column);
            const insertBefore = dragOverColumn?.columnID === column.column_id && dragOverColumn.placement === "before";
            const insertAfter = dragOverColumn?.columnID === column.column_id && dragOverColumn.placement === "after";
            const insertionShadow = insertBefore ? `-3px 0 0 ${accent}` : insertAfter ? `3px 0 0 ${accent}` : "";
            const columnShadow = insertionShadow ? (laneShadow === "none" ? insertionShadow : `${insertionShadow}, ${laneShadow}`) : laneShadow;
            return (
              <section
                key={column.column_id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setColumnContextMenu({ x: event.clientX, y: event.clientY, columnID: column.column_id });
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dataTransferIncludes(event, KANBAN_COLUMN_DRAG_MIME) && draggingColumnID !== column.column_id) {
                    setDragOverColumn({ columnID: column.column_id, placement: columnDropPlacement(event) });
                  }
                }}
                onDragLeave={() => setDragOverColumn((previous) => (previous?.columnID === column.column_id ? null : previous))}
                onDrop={(event) => onDropColumn(event, column.column_id)}
                style={{
                  position: "relative",
                  flex: `0 0 ${columnWidth}px`,
                  height: columnHeight,
                  minHeight: KANBAN_DEFAULT_COLUMN_HEIGHT_PX / 2,
                  background: laneBackground,
                  border: `1px solid ${laneBorder}`,
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
                    setDraggingColumnID(column.column_id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(KANBAN_COLUMN_DRAG_MIME, JSON.stringify({ columnID: column.column_id }));
                  }}
                  onDragEnd={() => {
                    setDraggingColumnID("");
                    setDragOverColumn(null);
                  }}
                  style={{ display: "grid", gridTemplateColumns: "20px minmax(0, 1fr) 28px", alignItems: "center", borderBottom: `1px solid ${line}`, cursor: "default" }}
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
                        setColumns((previous) => previous.map((item) => (item.column_id === column.column_id ? { ...item, title: value } : item)));
                      }}
                      onBlur={(event) => commitColumnTitle(column.column_id, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          setEditingColumnID("");
                          void refreshBoard();
                        }
                      }}
                      // Column titles are user-authored board data. Preserve casing so
                      // names keep the exact meaning users and agents assigned.
                      style={{ height: 40, width: "100%", minWidth: 0, border: "none", background: "transparent", color: text, fontSize: 12, fontWeight: 800, padding: "0 5px", outline: "none", textTransform: KANBAN_COLUMN_TITLE_TEXT_TRANSFORM }}
                    />
                  ) : (
                    <div
                      title={column.title}
                      onClick={() => setEditingColumnID(column.column_id)}
                      style={{ minWidth: 0, color: text, fontSize: 12, fontWeight: 800, padding: "0 5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: KANBAN_COLUMN_TITLE_TEXT_TRANSFORM, cursor: "text" }}
                    >
                      {column.title}
                    </div>
                  )}
                  <button
                    title="Delete column"
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => requestColumnDelete(column.column_id)}
                    style={{ width: 28, height: 28, border: "none", background: "transparent", color: subtext, cursor: "pointer", fontSize: 20, lineHeight: 1 }}
                  >
                    x
                  </button>
                </div>
                <div style={{ minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", gap: 8, padding: 8 }}>
                  {columnCards.map((card) => renderCard(card))}
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
                    };
                  }}
                  style={{ position: "absolute", left: 0, right: 0, bottom: -4, height: 8, cursor: "row-resize", zIndex: 2 }}
                />
              </section>
            );
          })}
          <button
            type="button"
            title="Add column"
            onClick={() => void addColumn()}
            onMouseEnter={() => setAddColumnHover(true)}
            onMouseLeave={() => setAddColumnHover(false)}
            onDragOver={(event) => {
              if (dataTransferIncludes(event, KANBAN_COLUMN_DRAG_MIME)) event.preventDefault();
            }}
            onDrop={onDropAtEnd}
            style={{
              flex: "0 0 72px",
              width: 72,
              height: 72,
              border: "1.5px solid #111111",
              background: "#ffffff",
              color: "#111111",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              fontSize: 34,
              fontWeight: 500,
              lineHeight: 1,
              boxShadow: addColumnHover ? "0 8px 18px rgba(16,24,40,0.18)" : "none",
              transition: "box-shadow 120ms ease, transform 120ms ease",
              transform: addColumnHover ? "translateY(-1px)" : "none",
            }}
          >
            +
          </button>
        </div>
      </div>
      {contextColumn && columnContextMenu && (
        <FrameRightClickMenu x={columnContextMenu.x} y={columnContextMenu.y} onClose={() => setColumnContextMenu(null)}>
          <button
            type="button"
            style={contextMenuButtonStyle}
            onClick={() => {
              setEditingColumnID(contextColumn.column_id);
              setColumnContextMenu(null);
            }}
            {...contextMenuHoverHandlers}
          >
            Rename column
          </button>
          <button
            type="button"
            style={{ ...contextMenuButtonStyle, color: "#c62828" }}
            onClick={() => requestColumnDelete(contextColumn.column_id)}
            {...contextMenuHoverHandlers}
          >
            Delete column
          </button>
          <label style={{ ...contextMenuButtonStyle, cursor: "default", justifyContent: "space-between" }}>
            <span>Item color</span>
            <input
              type="color"
              value={normalizeKanbanColumnItemColor(contextColumn.item_color)}
              onChange={(event) => void persistColumnItemColor(contextColumn.column_id, event.target.value)}
              style={{ width: 34, height: 24, border: "1px solid #d0d0d0", background: "#fff", cursor: "pointer", padding: 0 }}
            />
          </label>
        </FrameRightClickMenu>
      )}
      {deleteColumnConfirmation && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center" }}>
          <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(0,233,255,0.45)", background: "rgba(255,255,255,0.95)", padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#111111" }}>
              Are you sure you want to delete this Kanban column?
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.35, color: "#2e2e2e" }}>
              This removes "{deleteColumnConfirmation.title}" and all cards in that column immediately.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  void removeColumn(deleteColumnConfirmation.columnID);
                  setDeleteColumnConfirmation(null);
                }}
                style={{ border: "1px solid rgba(0,233,255,0.45)", background: "#fff", cursor: "pointer", fontWeight: 700 }}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setDeleteColumnConfirmation(null)}
                style={{ border: "1px solid #ff3d7f", boxShadow: "inset 0 0 0 1px rgba(255,130,170,0.25), 0 0 10px rgba(255,61,127,0.18)", color: "#8b123f", background: "#fff", cursor: "pointer", fontWeight: 700 }}
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
