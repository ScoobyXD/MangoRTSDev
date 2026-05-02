import React, { useCallback, useEffect, useMemo, useState } from "react";
import { EVENT_EXPLORER_CONTEXT_UPDATED } from "../node-map/eventbus";
import { NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../logic-gate-map/shared";
import { createKanbanColumn, listKanbanCards, listKanbanColumns, moveKanbanCard, renameKanbanColumn, upsertKanbanCard } from "./kanbanApi";
import {
  EXPLORER_ENTITY_DRAG_MIME,
  KANBAN_CARD_DRAG_MIME,
  KANBAN_COLUMN_TITLE_TEXT_TRANSFORM,
  KANBAN_MODULE_TOP_CLEARANCE_PX,
  groupCardsByColumn,
  nextCardPosition,
  parseExplorerEntityDragPayload,
  parseKanbanCardDragPayload,
  type KanbanCard,
  type KanbanColumn,
  type KanbanItemType,
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
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [highlightedEntity, setHighlightedEntity] = useState<HighlightedEntity>(() => readLinkedExplorerSelection(companyID, boardID));

  const isDark = theme === "dark";
  const surface = isDark ? "#11161b" : "#ffffff";
  const text = isDark ? "#f6f8fb" : "#102226";
  const subtext = isDark ? "#b8c4cc" : "#52666c";
  const line = isDark ? "rgba(255,255,255,0.16)" : "rgba(8, 52, 58, 0.16)";
  const boardBorder = isDark ? "rgba(255,255,255,0.26)" : "#111111";
  const boardShadow = isDark ? "0 12px 26px rgba(0,0,0,0.28)" : "0 12px 24px rgba(16,24,40,0.14)";
  const laneBackground = isDark ? "#1a2229" : "#ffffff";
  const laneBorder = isDark ? "rgba(255,255,255,0.18)" : "rgba(17,17,17,0.78)";
  const laneShadow = isDark ? "none" : "0 4px 12px rgba(16,24,40,0.08)";
  const cardBackground = isDark ? "#101418" : "#ffffff";

  const cardsByColumn = useMemo(() => groupCardsByColumn(cards), [cards]);

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
      setColumns(nextColumns);
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

  const addColumn = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    const title = newColumnTitle.trim();
    if (!title) return;
    setNewColumnTitle("");
    setError("");
    try {
      const column = await createKanbanColumn(apiBase, companyID, boardID, title);
      setColumns((previous) => [...previous, column].sort((a, b) => a.position - b.position));
    } catch {
      setError("Column create failed");
      setNewColumnTitle(title);
    }
  }, [apiBase, boardID, companyID, newColumnTitle]);

  const commitColumnTitle = useCallback(async (columnID: string, title: string) => {
    const cleanTitle = title.trim();
    const existing = columns.find((column) => column.column_id === columnID);
    if (!existing || !cleanTitle) return;
    setError("");
    try {
      const updated = await renameKanbanColumn(apiBase, companyID, boardID, columnID, cleanTitle);
      setColumns((previous) => previous.map((column) => (column.column_id === columnID ? updated : column)));
    } catch {
      setError("Column rename failed");
      refreshBoard();
    }
  }, [apiBase, boardID, columns, companyID, refreshBoard]);

  const moveCardToColumn = useCallback(async (cardID: string, columnID: string) => {
    const position = nextCardPosition(cards, columnID);
    setCards((previous) => previous.map((card) => (card.card_id === cardID ? { ...card, column_id: columnID, position } : card)));
    try {
      const moved = await moveKanbanCard({ apiBase, companyID, boardID, cardID, columnID, position });
      setCards((previous) => previous.map((card) => (card.card_id === moved.card_id ? moved : card)));
    } catch {
      setError("Card move failed");
      refreshBoard();
    }
  }, [apiBase, boardID, cards, companyID, refreshBoard]);

  const addEntityToColumn = useCallback(async (columnID: string, itemType: KanbanItemType, itemID: string, label: string) => {
    const position = nextCardPosition(cards, columnID);
    const optimistic: KanbanCard = {
      company_id: companyID,
      board_id: boardID,
      card_id: `pending-${itemType}-${itemID}`,
      column_id: columnID,
      item_type: itemType,
      item_id: itemID,
      title_snapshot: label,
      position,
      created_timestamp: new Date().toISOString(),
      updated_timestamp: new Date().toISOString(),
    };
    setCards((previous) => [...previous.filter((card) => !(card.item_type === itemType && card.item_id === itemID)), optimistic]);
    try {
      const saved = await upsertKanbanCard({ apiBase, companyID, boardID, columnID, itemType, itemID, titleSnapshot: label, position });
      setCards((previous) => [...previous.filter((card) => card.card_id !== optimistic.card_id && !(card.item_type === itemType && card.item_id === itemID)), saved]);
    } catch {
      setError("Drop failed");
      refreshBoard();
    }
  }, [apiBase, boardID, cards, companyID, refreshBoard]);

  const onDropColumn = useCallback((event: React.DragEvent, columnID: string) => {
    event.preventDefault();
    const cardPayload = parseKanbanCardDragPayload(event.dataTransfer.getData(KANBAN_CARD_DRAG_MIME));
    if (cardPayload) {
      if (cardPayload.sourceColumnID !== columnID) moveCardToColumn(cardPayload.cardID, columnID);
      return;
    }
    const explorerPayload = parseExplorerEntityDragPayload(event.dataTransfer.getData(EXPLORER_ENTITY_DRAG_MIME));
    if (explorerPayload) {
      addEntityToColumn(columnID, explorerPayload.itemType, explorerPayload.itemID, explorerPayload.label);
    }
  }, [addEntityToColumn, moveCardToColumn]);

  return (
    <div
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      style={{ position: "relative", width: "100%", height: "100%", display: "grid", gridTemplateRows: "44px minmax(0, 1fr)", paddingTop: KANBAN_MODULE_TOP_CLEARANCE_PX, background: surface, color: text, overflow: "hidden" }}
    >
      <div style={{ position: "absolute", top: KANBAN_MODULE_TOP_CLEARANCE_PX - 1, left: 0, right: 0, borderBottom: `1px solid ${line}`, pointerEvents: "none" }} />
      <form onSubmit={addColumn} style={{ display: "grid", gridTemplateColumns: "1fr 34px", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: `1px solid ${line}` }}>
        <input
          value={newColumnTitle}
          onChange={(event) => setNewColumnTitle(event.target.value)}
          placeholder="Column title"
          style={{ height: 28, minWidth: 0, border: `1px solid ${line}`, background: isDark ? "#0d1115" : "#ffffff", color: text, padding: "0 9px", fontSize: 12, outline: "none" }}
        />
        <button title="Add column" type="submit" style={{ width: 34, height: 28, border: `1px solid ${accent}`, background: "transparent", color: accent, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>+</button>
      </form>

      <div style={{ minHeight: 0, overflow: "auto", padding: "12px 12px 14px" }}>
        <div style={{ display: "inline-block", minWidth: "100%", minHeight: "100%", background: surface, border: `1px solid ${boardBorder}`, boxShadow: boardShadow, padding: 10 }}>
          {error && <div style={{ marginBottom: 8, color: "#c62828", fontSize: 11, fontWeight: 700 }}>{error}</div>}
          {loading && <div style={{ color: subtext, fontSize: 12 }}>Loading board...</div>}
          {!loading && columns.length === 0 && <div style={{ color: subtext, fontSize: 12 }}>Add a column to start.</div>}
          <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(210px, 260px)", alignItems: "stretch", gap: 10, minHeight: "100%" }}>
            {columns.map((column) => {
              const columnCards = cardsByColumn.get(column.column_id) ?? [];
              return (
                <section
                  key={column.column_id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => onDropColumn(event, column.column_id)}
                  style={{ minHeight: 220, background: laneBackground, border: `1px solid ${laneBorder}`, boxShadow: laneShadow, display: "grid", gridTemplateRows: "38px 1fr" }}
                >
                  <input
                    value={column.title}
                    onChange={(event) => {
                      const value = event.target.value;
                      setColumns((previous) => previous.map((item) => (item.column_id === column.column_id ? { ...item, title: value } : item)));
                    }}
                    onBlur={(event) => commitColumnTitle(column.column_id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    // Column titles are user-authored board data. Preserve casing here so
                    // the UI does not silently change meaning or naming conventions.
                    style={{ height: 38, width: "100%", minWidth: 0, border: "none", borderBottom: `1px solid ${line}`, background: "transparent", color: text, fontSize: 12, fontWeight: 800, padding: "0 9px", outline: "none", textTransform: KANBAN_COLUMN_TITLE_TEXT_TRANSFORM }}
                  />
                  <div style={{ minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", gap: 8, padding: 8 }}>
                    {columnCards.map((card) => {
                      const highlighted = highlightedEntity?.itemType === card.item_type && highlightedEntity.itemID === card.item_id;
                      return (
                        <article
                          key={card.card_id}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(KANBAN_CARD_DRAG_MIME, JSON.stringify({ cardID: card.card_id, sourceColumnID: card.column_id }));
                          }}
                          style={{
                            border: `1px solid ${highlighted ? accent : line}`,
                            background: cardBackground,
                            color: text,
                            padding: "8px 9px",
                            minHeight: 58,
                            cursor: "grab",
                            boxShadow: highlighted ? `0 0 0 1px ${accent} inset` : undefined,
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.25, overflowWrap: "anywhere" }}>{card.title_snapshot}</div>
                          <div style={{ marginTop: 8, color: subtext, fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>{card.item_type === "logic_gate" ? "Logic Gate" : "Node"}</div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
