import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EVENT_EXPLORER_CONTEXT_UPDATED } from "../node-map/eventbus";
import { NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../logic-gate-map/shared";
import { createKanbanColumn, deleteKanbanColumn, listKanbanCards, listKanbanColumns, moveKanbanCard, updateKanbanColumn, upsertKanbanCard } from "./kanbanApi";
import {
  EXPLORER_ENTITY_DRAG_MIME,
  KANBAN_CARD_DRAG_MIME,
  KANBAN_COLUMN_DRAG_MIME,
  KANBAN_COLUMN_TITLE_TEXT_TRANSFORM,
  KANBAN_DEFAULT_COLUMN_WIDTH_PX,
  KANBAN_DEFAULT_GROUP_BY,
  KANBAN_DEFAULT_SORT,
  KANBAN_DEFAULT_VISIBLE_ATTRIBUTES,
  KANBAN_GROUP_FIELD_LABELS,
  KANBAN_GROUP_FIELDS,
  KANBAN_MODULE_TOP_CLEARANCE_PX,
  KANBAN_SORT_FIELD_LABELS,
  KANBAN_SORT_FIELDS,
  KANBAN_VISIBLE_ATTRIBUTE_LABELS,
  KANBAN_VISIBLE_ATTRIBUTES,
  buildKanbanCardGroups,
  buildColumnReorderPlan,
  clampColumnWidth,
  defaultKanbanCardMetadata,
  filterAndSortKanbanCards,
  formatKanbanStatusAge,
  getKanbanCardFieldValue,
  getKanbanConditionalColor,
  getKanbanGroupLabel,
  getColumnWidth,
  groupCardsByColumn,
  nextColumnPosition,
  nextCardPosition,
  parseKanbanColumnDragPayload,
  parseExplorerEntityDragPayload,
  parseKanbanCardDragPayload,
  sortColumns,
  type KanbanCard,
  type KanbanCardGroup,
  type KanbanColumn,
  type KanbanFilter,
  type KanbanGroupField,
  type KanbanItemType,
  type KanbanSortField,
  type KanbanVisibleAttribute,
} from "./shared";

type HighlightedEntity = { itemType: KanbanItemType; itemID: string } | null;

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
  const [groupByFields, setGroupByFields] = useState<KanbanGroupField[]>(KANBAN_DEFAULT_GROUP_BY);
  const [filterField, setFilterField] = useState<KanbanFilter["field"]>("title_snapshot");
  const [filterValue, setFilterValue] = useState("");
  const [sortField, setSortField] = useState<KanbanSortField>(KANBAN_DEFAULT_SORT[0].field);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(KANBAN_DEFAULT_SORT[0].direction);
  const [visibleAttributes, setVisibleAttributes] = useState<Set<KanbanVisibleAttribute>>(() => new Set(KANBAN_DEFAULT_VISIBLE_ATTRIBUTES));
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => new Set());
  const [expandedCardIDs, setExpandedCardIDs] = useState<Set<string>>(() => new Set());
  const [colorBy, setColorBy] = useState<KanbanGroupField>("status");
  const resizeRef = useRef<{ columnID: string; startX: number; startWidth: number } | null>(null);

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
  const kanbanFilters = useMemo<KanbanFilter[]>(() => {
    const value = filterValue.trim();
    if (!value) return [];
    return [{ field: filterField, op: filterField === "title_snapshot" ? "prefix" : "eq", value }];
  }, [filterField, filterValue]);
  const sortedVisibleCards = useMemo(() => filterAndSortKanbanCards(cards, {
    filters: kanbanFilters,
    sort: [{ field: sortField, direction: sortDirection }],
  }, columnTitleByID), [cards, columnTitleByID, kanbanFilters, sortDirection, sortField]);
  const cardsByColumn = useMemo(() => groupCardsByColumn(sortedVisibleCards), [sortedVisibleCards]);
  const effectiveGroupBy = groupByFields.length ? groupByFields : KANBAN_DEFAULT_GROUP_BY;
  const rootGroups = useMemo(() => buildKanbanCardGroups(sortedVisibleCards, effectiveGroupBy, collapsedGroupKeys, columnTitleByID), [collapsedGroupKeys, columnTitleByID, effectiveGroupBy, sortedVisibleCards]);
  const visibleAttributeList = useMemo(() => KANBAN_VISIBLE_ATTRIBUTES.filter((attribute) => visibleAttributes.has(attribute)), [visibleAttributes]);

  const refreshBoard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextColumns, nextCards] = await Promise.all([
        listKanbanColumns(apiBase, companyID, boardID),
        // The UI reads the first window only. Headless agents should page through the API
        // by column when operating at larger scale instead of rendering everything.
        listKanbanCards(apiBase, companyID, boardID, "", 500),
      ]);
      setColumns(sortColumns(nextColumns));
      setCards(nextCards);
    } catch {
      setError("Kanban API unavailable");
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

  const reorderColumn = useCallback(async (draggedColumnID: string, targetColumnID: string | null) => {
    const plan = buildColumnReorderPlan(columns, draggedColumnID, targetColumnID);
    if (plan.updates.length === 0) return;
    setColumns(plan.columns);
    setDraggingColumnID("");
    setError("");
    try {
      // Most reorders are one write thanks to sparse positions. A rare compaction only
      // rewrites the visible board columns when positions no longer have room.
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

  const persistColumnWidth = useCallback(async (columnID: string, widthPx: number) => {
    setError("");
    try {
      const updated = await updateKanbanColumn({ apiBase, companyID, boardID, columnID, widthPx });
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
      const widthPx = clampColumnWidth(resize.startWidth + event.clientX - resize.startX);
      setColumns((previous) => previous.map((column) => (column.column_id === resize.columnID ? { ...column, width_px: widthPx } : column)));
    };
    const onUp = () => {
      const resize = resizeRef.current;
      if (!resize) return;
      resizeRef.current = null;
      const column = columns.find((item) => item.column_id === resize.columnID);
      if (column) void persistColumnWidth(resize.columnID, getColumnWidth(column));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [columns, persistColumnWidth]);

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

  const onDropColumn = useCallback((event: React.DragEvent, columnID: string) => {
    event.preventDefault();
    const columnPayload = parseKanbanColumnDragPayload(event.dataTransfer.getData(KANBAN_COLUMN_DRAG_MIME));
    if (columnPayload) {
      reorderColumn(columnPayload.columnID, columnID);
      return;
    }
    const cardPayload = parseKanbanCardDragPayload(event.dataTransfer.getData(KANBAN_CARD_DRAG_MIME));
    if (cardPayload) {
      if (cardPayload.sourceColumnID !== columnID) moveCardToColumn(cardPayload.cardID, columnID);
      return;
    }
    const explorerPayload = parseExplorerEntityDragPayload(event.dataTransfer.getData(EXPLORER_ENTITY_DRAG_MIME));
    if (explorerPayload) {
      addEntityToColumn(columnID, explorerPayload.itemType, explorerPayload.itemID, explorerPayload.label);
    }
  }, [addEntityToColumn, moveCardToColumn, reorderColumn]);

  const onDropAtEnd = useCallback((event: React.DragEvent) => {
    const columnPayload = parseKanbanColumnDragPayload(event.dataTransfer.getData(KANBAN_COLUMN_DRAG_MIME));
    if (!columnPayload) return;
    event.preventDefault();
    reorderColumn(columnPayload.columnID, null);
  }, [reorderColumn]);

  const addGroupField = useCallback((field: KanbanGroupField) => {
    setGroupByFields((previous) => (previous.includes(field) ? previous : [...previous, field]));
  }, []);

  const removeGroupField = useCallback((field: KanbanGroupField) => {
    setGroupByFields((previous) => previous.filter((item) => item !== field));
    setCollapsedGroupKeys(new Set());
  }, []);

  const toggleVisibleAttribute = useCallback((attribute: KanbanVisibleAttribute) => {
    setVisibleAttributes((previous) => {
      const next = new Set(previous);
      if (next.has(attribute)) {
        next.delete(attribute);
      } else {
        next.add(attribute);
      }
      return next;
    });
  }, []);

  const toggleGroupCollapsed = useCallback((key: string) => {
    setCollapsedGroupKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

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

  const renderAttribute = (card: KanbanCard, attribute: KanbanVisibleAttribute): React.ReactNode => {
    if (attribute === "status_age") return `${KANBAN_VISIBLE_ATTRIBUTE_LABELS[attribute]} ${formatKanbanStatusAge(card)}`;
    const value = getKanbanCardFieldValue(card, attribute, columnTitleByID);
    if (!value.trim()) return null;
    const displayValue = attribute === "item_type" ? getKanbanGroupLabel("item_type", value, columnTitleByID) : value;
    return `${KANBAN_VISIBLE_ATTRIBUTE_LABELS[attribute]} ${displayValue}`;
  };

  const renderCard = (card: KanbanCard): React.ReactNode => {
    const highlighted = highlightedEntity?.itemType === card.item_type && highlightedEntity.itemID === card.item_id;
    const expanded = expandedCardIDs.has(card.card_id);
    const description = (card.description_snapshot ?? "").trim();
    const color = getKanbanConditionalColor(card, colorBy, columnTitleByID);
    const attributes = visibleAttributeList.map((attribute) => ({ attribute, value: renderAttribute(card, attribute) })).filter((item) => item.value);
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
                {value}
              </span>
            ))}
          </div>
        )}
      </article>
    );
  };

  const renderCardGroups = (groups: KanbanCardGroup[], depth = 0): React.ReactNode => (
    <div style={{ display: "grid", alignContent: "start", gap: 8 }}>
      {groups.map((group) => (
        <section key={group.key} style={{ border: `1px solid ${line}`, background: depth % 2 === 0 ? "rgba(127,127,127,0.04)" : "transparent" }}>
          <button
            type="button"
            onClick={() => toggleGroupCollapsed(group.key)}
            style={{ width: "100%", minHeight: 30, display: "grid", gridTemplateColumns: "18px minmax(0, 1fr) auto", alignItems: "center", gap: 6, border: "none", borderBottom: group.collapsed ? "none" : `1px solid ${line}`, background: "transparent", color: text, cursor: "pointer", padding: "5px 7px", textAlign: "left" }}
          >
            <span style={{ color: subtext, fontSize: 11 }}>{group.collapsed ? ">" : "v"}</span>
            <span style={{ minWidth: 0, fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.label}</span>
            <span style={{ color: subtext, fontSize: 10, fontWeight: 800 }}>{group.count}</span>
          </button>
          {!group.collapsed && (
            <div style={{ display: "grid", alignContent: "start", gap: 8, padding: 7 }}>
              {group.groups.length > 0 ? renderCardGroups(group.groups, depth + 1) : group.cards.map((card) => renderCard(card))}
            </div>
          )}
        </section>
      ))}
    </div>
  );

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
        <div style={{ display: "grid", gap: 8, marginBottom: 10, borderBottom: `1px solid ${line}`, paddingBottom: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {groupByFields.map((field) => (
              <button
                key={field}
                type="button"
                title="Remove group"
                onClick={() => removeGroupField(field)}
                style={{ minHeight: 28, border: `1px solid ${line}`, background: "transparent", color: text, cursor: "pointer", fontSize: 11, fontWeight: 800, padding: "0 8px" }}
              >
                {KANBAN_GROUP_FIELD_LABELS[field]} x
              </button>
            ))}
            <select
              aria-label="Add group"
              value=""
              onChange={(event) => {
                const value = event.target.value as KanbanGroupField;
                if (value) addGroupField(value);
              }}
              style={{ minHeight: 28, border: `1px solid ${line}`, background: surface, color: text, fontSize: 11, fontWeight: 700 }}
            >
              <option value="">Group</option>
              {KANBAN_GROUP_FIELDS.filter((field) => !groupByFields.includes(field)).map((field) => (
                <option key={field} value={field}>{KANBAN_GROUP_FIELD_LABELS[field]}</option>
              ))}
            </select>
            <select
              aria-label="Filter field"
              value={filterField}
              onChange={(event) => setFilterField(event.target.value as KanbanFilter["field"])}
              style={{ minHeight: 28, border: `1px solid ${line}`, background: surface, color: text, fontSize: 11, fontWeight: 700 }}
            >
              {(["title_snapshot", "status", "work_type", "assigned_to", "assigned_by", "item_type"] as KanbanFilter["field"][]).map((field) => (
                <option key={field} value={field}>{field === "title_snapshot" ? "Title" : field.replace(/_/g, " ")}</option>
              ))}
            </select>
            <input
              aria-label="Filter value"
              value={filterValue}
              onChange={(event) => setFilterValue(event.target.value)}
              placeholder="Filter"
              style={{ minHeight: 28, width: 150, minWidth: 0, border: `1px solid ${line}`, background: surface, color: text, fontSize: 11, padding: "0 8px", boxSizing: "border-box" }}
            />
            <select
              aria-label="Sort field"
              value={sortField}
              onChange={(event) => setSortField(event.target.value as KanbanSortField)}
              style={{ minHeight: 28, border: `1px solid ${line}`, background: surface, color: text, fontSize: 11, fontWeight: 700 }}
            >
              {KANBAN_SORT_FIELDS.map((field) => (
                <option key={field} value={field}>{KANBAN_SORT_FIELD_LABELS[field]}</option>
              ))}
            </select>
            <button
              type="button"
              title="Toggle sort direction"
              onClick={() => setSortDirection((previous) => (previous === "asc" ? "desc" : "asc"))}
              style={{ width: 36, minHeight: 28, border: `1px solid ${line}`, background: "transparent", color: text, cursor: "pointer", fontSize: 11, fontWeight: 800 }}
            >
              {sortDirection === "asc" ? "AZ" : "ZA"}
            </button>
            <select
              aria-label="Color by"
              value={colorBy}
              onChange={(event) => setColorBy(event.target.value as KanbanGroupField)}
              style={{ minHeight: 28, border: `1px solid ${line}`, background: surface, color: text, fontSize: 11, fontWeight: 700 }}
            >
              {KANBAN_GROUP_FIELDS.map((field) => (
                <option key={field} value={field}>{KANBAN_GROUP_FIELD_LABELS[field]}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {KANBAN_VISIBLE_ATTRIBUTES.map((attribute) => (
              <label key={attribute} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: subtext, fontSize: 10, fontWeight: 800 }}>
                <input
                  type="checkbox"
                  checked={visibleAttributes.has(attribute)}
                  onChange={() => toggleVisibleAttribute(attribute)}
                  style={{ width: 14, height: 14 }}
                />
                {KANBAN_VISIBLE_ATTRIBUTE_LABELS[attribute]}
              </label>
            ))}
          </div>
        </div>
        {effectiveGroupBy[0] !== "column_id" ? (
          <div style={{ display: "flex", alignItems: "stretch", gap: 10, minHeight: "100%" }}>
            {rootGroups.map((group) => (
              <section key={group.key} style={{ flex: "0 0 280px", minHeight: "100%", background: laneBackground, border: `1px solid ${laneBorder}`, boxShadow: laneShadow, display: "grid", gridTemplateRows: "42px minmax(0, 1fr)" }}>
                <button
                  type="button"
                  onClick={() => toggleGroupCollapsed(group.key)}
                  style={{ display: "grid", gridTemplateColumns: "24px minmax(0, 1fr) auto", alignItems: "center", gap: 6, border: "none", borderBottom: group.collapsed ? "none" : `1px solid ${line}`, background: "transparent", color: text, cursor: "pointer", padding: "0 8px", textAlign: "left" }}
                >
                  <span style={{ color: subtext, fontSize: 11 }}>{group.collapsed ? ">" : "v"}</span>
                  <span style={{ minWidth: 0, fontSize: 12, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.label}</span>
                  <span style={{ color: subtext, fontSize: 10, fontWeight: 800 }}>{group.count}</span>
                </button>
                {!group.collapsed && (
                  <div style={{ minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", gap: 8, padding: 8 }}>
                    {group.groups.length > 0 ? renderCardGroups(group.groups, 1) : group.cards.map((card) => renderCard(card))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
        <div style={{ display: "flex", alignItems: "stretch", gap: 10, minHeight: "100%" }}>
          {orderedColumns.map((column) => {
            const columnCards = cardsByColumn.get(column.column_id) ?? [];
            const columnWidth = getColumnWidth(column);
            const nestedGroupFields = effectiveGroupBy.filter((field) => field !== "column_id");
            const nestedGroups = buildKanbanCardGroups(columnCards, nestedGroupFields, collapsedGroupKeys, columnTitleByID, `column_id=${column.column_id}`);
            return (
              <section
                key={column.column_id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => onDropColumn(event, column.column_id)}
                style={{ position: "relative", flex: `0 0 ${columnWidth}px`, minHeight: "100%", background: laneBackground, border: `1px solid ${laneBorder}`, boxShadow: laneShadow, display: "grid", gridTemplateRows: "42px minmax(0, 1fr)", opacity: draggingColumnID === column.column_id ? 0.72 : 1 }}
              >
                <div
                  draggable
                  onDragStart={(event) => {
                    setDraggingColumnID(column.column_id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(KANBAN_COLUMN_DRAG_MIME, JSON.stringify({ columnID: column.column_id }));
                  }}
                  onDragEnd={() => setDraggingColumnID("")}
                  style={{ display: "grid", gridTemplateColumns: "20px minmax(0, 1fr) 28px", alignItems: "center", borderBottom: `1px solid ${line}`, cursor: "grab" }}
                >
                  <span aria-hidden="true" style={{ color: subtext, fontSize: 16, lineHeight: 1, textAlign: "center" }}>⋮</span>
                  <input
                    value={column.title}
                    autoFocus={editingColumnID === column.column_id}
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
                    // Column titles are user-authored board data. Preserve casing here so
                    // the UI does not silently change meaning or naming conventions.
                    style={{ height: 40, width: "100%", minWidth: 0, border: "none", background: "transparent", color: text, fontSize: 12, fontWeight: 800, padding: "0 5px", outline: "none", textTransform: KANBAN_COLUMN_TITLE_TEXT_TRANSFORM }}
                  />
                  <button
                    title="Delete column"
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => void removeColumn(column.column_id)}
                    style={{ width: 28, height: 28, border: "none", background: "transparent", color: subtext, cursor: "pointer", fontSize: 20, lineHeight: 1 }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", gap: 8, padding: 8 }}>
                  {nestedGroups.length > 0 ? renderCardGroups(nestedGroups, 1) : columnCards.map((card) => renderCard(card))}
                </div>
                <div
                  title="Resize column"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    resizeRef.current = { columnID: column.column_id, startX: event.clientX, startWidth: columnWidth };
                  }}
                  style={{ position: "absolute", top: 0, right: -4, bottom: 0, width: 8, cursor: "col-resize", zIndex: 2 }}
                />
              </section>
            );
          })}
          <button
            type="button"
            title="Add column"
            onClick={() => void addColumn()}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(KANBAN_COLUMN_DRAG_MIME)) event.preventDefault();
            }}
            onDrop={onDropAtEnd}
            style={{ flex: "0 0 92px", minHeight: "100%", border: `1px dashed ${laneBorder}`, background: "transparent", color: accent, cursor: "pointer", display: "grid", placeItems: "center", fontSize: 42, lineHeight: 1 }}
          >
            +
          </button>
        </div>
        )}
      </div>
    </div>
  );
};
