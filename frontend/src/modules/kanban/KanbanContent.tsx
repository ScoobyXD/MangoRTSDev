import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EVENT_EXPLORER_CONTEXT_UPDATED } from "../node-map/eventbus";
import { NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../logic-gate-map/shared";
import { createKanbanColumn, deleteKanbanColumn, listKanbanCards, listKanbanColumns, moveKanbanCard, updateKanbanColumn, upsertKanbanCard } from "./kanbanApi";
import {
  EXPLORER_ENTITY_DRAG_MIME,
  KANBAN_CARD_DRAG_MIME,
  KANBAN_CARD_SUMMARY_ATTRIBUTES,
  KANBAN_CARD_SUMMARY_ATTRIBUTE_LABELS,
  KANBAN_COLUMN_DRAG_MIME,
  KANBAN_COLUMN_TITLE_TEXT_TRANSFORM,
  KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
  KANBAN_DEFAULT_COLUMN_WIDTH_PX,
  KANBAN_MODULE_TOP_CLEARANCE_PX,
  buildColumnReorderPlan,
  clampColumnHeight,
  clampColumnWidth,
  defaultKanbanCardMetadata,
  getColumnHeight,
  getColumnWidth,
  getKanbanCardSummaryAttributeValue,
  getKanbanConditionalColor,
  groupCardsByColumn,
  nextCardPosition,
  nextColumnPosition,
  parseExplorerEntityDragPayload,
  parseKanbanCardDragPayload,
  parseKanbanColumnDragPayload,
  sortColumns,
  type KanbanCard,
  type KanbanColumn,
  type KanbanColumnDropPlacement,
  type KanbanItemType,
} from "./shared";

type HighlightedEntity = { itemType: KanbanItemType; itemID: string } | null;

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

function readLinkedExplorerSelection(companyID: string, scope: string): HighlightedEntity {
  try {
    const nodeRaw = localStorage.getItem(`${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`);
    if (nodeRaw) {
      const parsed = JSON.parse(nodeRaw) as { selectedNodeID?: unknown };
      if (typeof parsed.selectedNodeID === "string" && parsed.selectedNodeID.trim()) {
        return { itemType: "node", itemID: parsed.selectedNodeID.trim() };
      }
    }
    const logicRaw = localStorage.getItem(`${LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`);
    if (logicRaw) {
      const parsed = JSON.parse(logicRaw) as { selectedLogicGateID?: unknown; selectedNodeID?: unknown };
      const id = typeof parsed.selectedLogicGateID === "string" ? parsed.selectedLogicGateID : parsed.selectedNodeID;
      if (typeof id === "string" && id.trim()) return { itemType: "logic_gate", itemID: id.trim() };
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
  const columnTitleByID = useMemo(() => new Map(orderedColumns.map((column) => [column.column_id, column.title])), [orderedColumns]);
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
    const status = columnTitleByID.get(columnID) ?? "Unspecified";
    setCards((previous) => previous.map((card) => (card.card_id === cardID ? { ...card, column_id: columnID, position, status, status_entered_timestamp: movedAt, last_activity: "moved card", updated_timestamp: movedAt } : card)));
    try {
      const moved = await moveKanbanCard({ apiBase, companyID, boardID, cardID, columnID, position });
      setCards((previous) => previous.map((card) => (card.card_id === moved.card_id ? moved : card)));
    } catch {
      setError("Card move failed");
      refreshBoard();
    }
  }, [apiBase, boardID, cards, columnTitleByID, companyID, refreshBoard]);

  const addEntityToColumn = useCallback(async (columnID: string, itemType: KanbanItemType, itemID: string, label: string) => {
    const position = nextCardPosition(cards, columnID);
    const now = new Date().toISOString();
    const optimistic: KanbanCard = {
      company_id: companyID,
      board_id: boardID,
      card_id: `pending-${itemType}-${itemID}`,
      column_id: columnID,
      item_type: itemType,
      item_id: itemID,
      title_snapshot: label,
      ...defaultKanbanCardMetadata({ item_type: itemType, column_id: columnID, created_timestamp: now, updated_timestamp: now }, columnTitleByID.get(columnID)),
      position,
      created_timestamp: now,
      updated_timestamp: now,
    };
    setCards((previous) => [...previous.filter((card) => !(card.item_type === itemType && card.item_id === itemID)), optimistic]);
    try {
      const saved = await upsertKanbanCard({ apiBase, companyID, boardID, columnID, itemType, itemID, titleSnapshot: label, position });
      setCards((previous) => [...previous.filter((card) => card.card_id !== optimistic.card_id && !(card.item_type === itemType && card.item_id === itemID)), saved]);
    } catch {
      setError("Drop failed");
      refreshBoard();
    }
  }, [apiBase, boardID, cards, columnTitleByID, companyID, refreshBoard]);

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
      void addEntityToColumn(columnID, explorerPayload.itemType, explorerPayload.itemID, explorerPayload.label);
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
    const highlighted = highlightedEntity?.itemType === card.item_type && highlightedEntity.itemID === card.item_id;
    const expanded = expandedCardIDs.has(card.card_id);
    const description = (card.description_snapshot ?? "").trim();
    const color = getKanbanConditionalColor(card);
    const attributes = KANBAN_CARD_SUMMARY_ATTRIBUTES
      .map((attribute) => ({ attribute, value: getKanbanCardSummaryAttributeValue(card, attribute) }))
      .filter((item) => item.value.trim());
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
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 22px", gap: 6, alignItems: "start" }}>
          <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.25, overflowWrap: "anywhere" }}>{card.title_snapshot}</div>
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
        {attributes.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
            {attributes.map(({ attribute, value }) => (
              <span key={attribute} style={{ border: `1px solid ${line}`, color: subtext, fontSize: 10, fontWeight: 700, padding: "2px 5px", overflowWrap: "anywhere" }}>
                {KANBAN_CARD_SUMMARY_ATTRIBUTE_LABELS[attribute]} {value}
              </span>
            ))}
          </div>
        )}
      </article>
    );
  };

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
                  style={{ display: "grid", gridTemplateColumns: "20px minmax(0, 1fr) 28px", alignItems: "center", borderBottom: `1px solid ${line}`, cursor: editingColumnID === column.column_id ? "default" : "grab" }}
                >
                  <span aria-hidden="true" style={{ color: subtext, fontSize: 15, lineHeight: 1, textAlign: "center" }}>::</span>
                  {editingColumnID === column.column_id ? (
                    <input
                      value={column.title}
                      autoFocus
                      draggable={false}
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
                      onDoubleClick={() => setEditingColumnID(column.column_id)}
                      style={{ minWidth: 0, color: text, fontSize: 12, fontWeight: 800, padding: "0 5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: KANBAN_COLUMN_TITLE_TEXT_TRANSFORM }}
                    >
                      {column.title}
                    </div>
                  )}
                  <button
                    title="Delete column"
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => void removeColumn(column.column_id)}
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
    </div>
  );
};
