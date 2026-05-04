import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveConnectedFrameTargets } from "../linkingGraph";
import { getNodeTitle, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { getNodeRelationshipGraphSnapshot, subscribeNodeRelationshipGraph } from "../node-map/NodeRelationshipGraph";
import { publishLiveSelection, readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../selectionCoordinator";
import { createKanbanBoard, createKanbanColumn, deleteKanbanCard, deleteKanbanColumn, listKanbanBoards, listKanbanCards, listKanbanColumns, moveKanbanCard, updateKanbanColumn, upsertKanbanCard } from "./kanbanApi";
import {
  EXPLORER_ENTITY_DRAG_MIME,
  KANBAN_CARD_DRAG_MIME,
  KANBAN_COLUMN_DRAG_MIME,
  KANBAN_COLUMN_TITLE_TEXT_TRANSFORM,
  KANBAN_DEFAULT_BOARD_TITLE,
  KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
  KANBAN_DEFAULT_COLUMN_WIDTH_PX,
  KANBAN_MODULE_TOP_CLEARANCE_PX,
  attachStackedDragPreview,
  buildCardBatchReorderPlan,
  buildKanbanCardSelectionUpdate,
  buildColumnReorderPlan,
  clampColumnHeight,
  clampColumnWidth,
  getColumnHeight,
  getColumnWidth,
  getKanbanBoardDisplayTitle,
  getKanbanCardColorRailStyle,
  getKanbanConditionalColor,
  getOrderedKanbanCardIDs,
  groupCardsByColumn,
  hexToRgba,
  normalizeKanbanColumnItemColor,
  nextCardPosition,
  nextColumnPosition,
  parseExplorerEntityDragItems,
  parseKanbanCardDragPayload,
  parseKanbanColumnDragPayload,
  sortColumns,
  sortKanbanBoards,
  type KanbanBoard,
  type KanbanCard,
  type KanbanCardDropPlacement,
  type KanbanColumn,
  type KanbanColumnDropPlacement,
  type ExplorerEntityDragItem,
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

function publishKanbanSelectionToLinkedFrames(companyID: string, boardID: string, nodeID: string, nodeTitle: string): void {
  if (!nodeID) return;
  try {
    const edges = readFrameLinksFromStorage();
    const registry = readFrameRegistryFromStorage();
    const targetFrameIDs = resolveConnectedFrameTargets({ sourceFrameID: boardID, edges, registry });
    publishLiveSelection({
      companyID,
      entityKind: "node",
      entityID: nodeID,
      label: nodeTitle,
      sourceFrameID: boardID,
      sourceModule: "kanban",
      targetFrameIDs,
      selectedTreeID: `node-${nodeID}`,
    });
  } catch {
    // Selection handoff is a UI convenience; card selection must still work if the link graph is unavailable.
  }
}

function dataTransferIncludes(event: React.DragEvent, mime: string): boolean {
  return Array.from(event.dataTransfer.types).includes(mime);
}

function cardDropPlacement(event: React.DragEvent<HTMLElement>): KanbanCardDropPlacement {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
}

export const KanbanContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }> = ({ accent, widgetId, theme = "teal" }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const frameBoardID = widgetId?.trim() ? widgetId : "global-kanban";
  const [activeBoardID, setActiveBoardID] = useState(frameBoardID);
  const [activeTab, setActiveTab] = useState<"board" | "boards">("board");
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const boardID = activeBoardID;
  const [highlightedEntity, setHighlightedEntity] = useState<HighlightedEntity>(() => readLinkedExplorerSelection(companyID, boardID));
  const [editingColumnID, setEditingColumnID] = useState("");
  const [draggingColumnID, setDraggingColumnID] = useState("");
  const [dragOverColumnID, setDragOverColumnID] = useState("");
  const [dragOverCard, setDragOverCard] = useState<{ cardID: string; placement: KanbanCardDropPlacement } | null>(null);
  const [selectedCardIDs, setSelectedCardIDs] = useState<Set<string>>(() => new Set());
  const [selectionAnchorCardID, setSelectionAnchorCardID] = useState("");
  const [addColumnHover, setAddColumnHover] = useState(false);
  const [columnContextMenu, setColumnContextMenu] = useState<{ x: number; y: number; columnID: string } | null>(null);
  const [cardContextMenu, setCardContextMenu] = useState<{ x: number; y: number; cardID: string } | null>(null);
  const [deleteColumnConfirmation, setDeleteColumnConfirmation] = useState<{ columnID: string; title: string } | null>(null);
  const [deleteCardConfirmation, setDeleteCardConfirmation] = useState<{ cardIDs: string[] } | null>(null);
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

  useEffect(() => {
    setActiveBoardID(frameBoardID);
  }, [frameBoardID]);

  const orderedColumns = useMemo(() => sortColumns(columns), [columns]);
  const columnColorByID = useMemo(() => new Map(orderedColumns.map((column) => [column.column_id, normalizeKanbanColumnItemColor(column.item_color)])), [orderedColumns]);
  const cardsByColumn = useMemo(() => groupCardsByColumn(cards), [cards]);
  const orderedBoards = useMemo(() => sortKanbanBoards(boards), [boards]);
  const activeBoard = useMemo(() => orderedBoards.find((board) => board.board_id === boardID) ?? null, [boardID, orderedBoards]);
  const activeBoardTitle = activeBoard ? getKanbanBoardDisplayTitle(activeBoard) : KANBAN_DEFAULT_BOARD_TITLE;
  const boardRows = useMemo<KanbanBoard[]>(() => {
    if (activeBoard) return orderedBoards;
    return [{
      company_id: companyID,
      board_id: boardID,
      title: `${KANBAN_DEFAULT_BOARD_TITLE} (unsaved)`,
      position: 0,
      created_timestamp: "",
      updated_timestamp: "",
    }, ...orderedBoards];
  }, [activeBoard, boardID, companyID, orderedBoards]);

  const refreshBoards = useCallback(async () => {
    setBoardsLoading(true);
    try {
      const nextBoards = await listKanbanBoards(apiBase, companyID, 100);
      setBoards(sortKanbanBoards(nextBoards));
    } catch {
      setError("Kanban board list API unavailable");
    } finally {
      setBoardsLoading(false);
    }
  }, [apiBase, companyID]);

  const saveCurrentBoardView = useCallback(async () => {
    setError("");
    try {
      const title = activeBoard?.title || KANBAN_DEFAULT_BOARD_TITLE;
      const saved = await createKanbanBoard(apiBase, companyID, title, boardID);
      setBoards((previous) => sortKanbanBoards([
        ...previous.filter((board) => board.board_id !== saved.board_id),
        saved,
      ]));
    } catch {
      setError("Kanban board save failed");
    }
  }, [activeBoard?.title, apiBase, boardID, companyID]);

  const createNewBoardView = useCallback(async () => {
    setError("");
    try {
      const created = await createKanbanBoard(apiBase, companyID, "New Kanban board");
      setBoards((previous) => sortKanbanBoards([...previous, created]));
      setSelectedCardIDs(new Set());
      setSelectionAnchorCardID("");
      setActiveBoardID(created.board_id);
      setActiveTab("board");
    } catch {
      setError("Kanban board create failed");
    }
  }, [apiBase, companyID]);

  const clearCardSelection = useCallback(() => {
    setSelectedCardIDs(new Set());
    setSelectionAnchorCardID("");
  }, []);

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
    refreshBoards();
  }, [refreshBoards]);

  const syncCardTitlesFromNodeGraph = useCallback(() => {
    const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
    const titleByNodeID = new Map((snapshot.nodes ?? []).map((node) => [node.node_id, getNodeTitle(node)]));
    if (titleByNodeID.size === 0) return;
    setCards((previous) => {
      let changed = false;
      const next = previous.map((card) => {
        const title = titleByNodeID.get(card.node_id);
        if (!title || title === card.node_title) return card;
        changed = true;
        return { ...card, node_title: title };
      });
      return changed ? next : previous;
    });
  }, [apiBase, companyID]);

  useEffect(() => {
    syncCardTitlesFromNodeGraph();
    return subscribeNodeRelationshipGraph(apiBase, companyID, syncCardTitlesFromNodeGraph);
  }, [apiBase, companyID, syncCardTitlesFromNodeGraph]);

  useEffect(() => {
    const applyLiveSelection = (selection: LiveSelectionChange) => {
      if (selection.companyID !== companyID || selection.sourceFrameID === boardID) return;
      if (selection.entityKind === "node" && selection.entityID.trim()) {
        setHighlightedEntity({ nodeID: selection.entityID.trim() });
        return;
      }
      setHighlightedEntity(null);
    };
    const liveSelection = readLiveSelectionForFrame(companyID, boardID);
    if (liveSelection) applyLiveSelection(liveSelection);
    return subscribeLiveSelection(boardID, applyLiveSelection);
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
      void refreshBoards();
    } catch {
      setError("Column create failed");
    }
  }, [apiBase, boardID, columns, companyID, refreshBoards]);

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
    setCardContextMenu(null);
    setDeleteColumnConfirmation({ columnID, title: column.title });
  }, [columns]);

  const reorderColumn = useCallback(async (draggedColumnID: string, targetColumnID: string | null, placement: KanbanColumnDropPlacement = "before") => {
    const plan = buildColumnReorderPlan(columns, draggedColumnID, targetColumnID, placement);
    if (plan.updates.length === 0) {
      setDraggingColumnID("");
      setDragOverColumnID("");
      return;
    }
    setColumns(plan.columns);
    setDraggingColumnID("");
    setDragOverColumnID("");
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

  const reorderCards = useCallback(async (cardIDs: string[], columnID: string, targetCardID: string | null = null, placement: KanbanCardDropPlacement = "before") => {
    const plan = buildCardBatchReorderPlan(cards, cardIDs, columnID, targetCardID, placement);
    setDragOverCard(null);
    if (plan.updates.length === 0) return;
    setCards(plan.cards);
    setError("");
    try {
      const updatedCards = await Promise.all(plan.updates.map((update) => moveKanbanCard({
        apiBase,
        companyID,
        boardID,
        cardID: update.cardID,
        columnID: update.columnID,
        position: update.position,
      })));
      const byID = new Map(updatedCards.map((card) => [card.card_id, card]));
      setCards((previous) => previous.map((card) => byID.get(card.card_id) ?? card));
    } catch {
      setError("Card reorder failed");
      refreshBoard();
    }
  }, [apiBase, boardID, cards, companyID, refreshBoard]);

  const selectCard = useCallback((cardID: string, event: React.MouseEvent<HTMLElement>) => {
    const clickedCard = cards.find((card) => card.card_id === cardID);
    const next = buildKanbanCardSelectionUpdate({
      columns: orderedColumns,
      cards,
      selectedCardIDs,
      anchorCardID: selectionAnchorCardID,
      clickedCardID: cardID,
      shiftKey: event.shiftKey,
      additiveKey: event.ctrlKey || event.metaKey,
    });
    setSelectedCardIDs(next.selectedCardIDs);
    setSelectionAnchorCardID(next.anchorCardID);
    if (clickedCard) {
      setHighlightedEntity({ nodeID: clickedCard.node_id });
      publishKanbanSelectionToLinkedFrames(companyID, boardID, clickedCard.node_id, clickedCard.node_title);
    }
  }, [boardID, cards, companyID, orderedColumns, selectedCardIDs, selectionAnchorCardID]);

  const clearCardSelectionFromBlankClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    clearCardSelection();
  }, [clearCardSelection]);

  const requestCardDelete = useCallback((cardIDs: string[]) => {
    const existingCardIDs = new Set(cards.map((card) => card.card_id));
    const uniqueCardIDs = Array.from(new Set(cardIDs)).filter((cardID) => existingCardIDs.has(cardID));
    if (uniqueCardIDs.length === 0) return;
    setCardContextMenu(null);
    setColumnContextMenu(null);
    setDeleteCardConfirmation({ cardIDs: uniqueCardIDs });
  }, [cards]);

  const removeCards = useCallback(async (cardIDs: string[]) => {
    const ids = new Set(cardIDs);
    if (ids.size === 0) return;
    const previousCards = cards;
    setCards((current) => current.filter((card) => !ids.has(card.card_id)));
    setSelectedCardIDs((current) => new Set(Array.from(current).filter((cardID) => !ids.has(cardID))));
    setSelectionAnchorCardID((current) => (ids.has(current) ? "" : current));
    setCardContextMenu(null);
    setError("");
    try {
      await Promise.all(Array.from(ids, (cardID) => deleteKanbanCard(apiBase, companyID, boardID, cardID)));
    } catch {
      setError("Card delete failed");
      setCards(previousCards);
    }
  }, [apiBase, boardID, cards, companyID]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (selectedCardIDs.size === 0 || isEditableKeyboardTarget(event.target)) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      // The shortcut only asks for confirmation. The API delete happens from
      // the modal Yes button so selection can never remove a card by itself.
      event.preventDefault();
      event.stopPropagation();
      if (deleteCardConfirmation) return;
      requestCardDelete(Array.from(selectedCardIDs));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [deleteCardConfirmation, requestCardDelete, selectedCardIDs]);

  const addEntitiesToColumn = useCallback(async (columnID: string, items: ExplorerEntityDragItem[]) => {
    const dedupedItems: ExplorerEntityDragItem[] = [];
    const seenNodeIDs = new Set<string>();
    for (const item of items) {
      const nodeID = item.nodeID.trim();
      if (!nodeID || seenNodeIDs.has(nodeID)) continue;
      seenNodeIDs.add(nodeID);
      dedupedItems.push({ nodeID, label: item.label.trim() || nodeID });
    }
    if (dedupedItems.length === 0) return;

    const firstPosition = nextCardPosition(cards, columnID);
    const now = new Date().toISOString();
    const optimisticCards: KanbanCard[] = dedupedItems.map((item, index) => ({
      company_id: companyID,
      board_id: boardID,
      card_id: `pending-node-${item.nodeID}`,
      column_id: columnID,
      node_id: item.nodeID,
      node_title: item.label,
      description_snapshot: "",
      position: firstPosition + index * 1000,
      created_timestamp: now,
      updated_timestamp: now,
    }));
    setCards((previous) => [...previous.filter((card) => !seenNodeIDs.has(card.node_id)), ...optimisticCards]);
    try {
      const savedCards = await Promise.all(dedupedItems.map((item, index) => upsertKanbanCard({
        apiBase,
        companyID,
        boardID,
        columnID,
        nodeID: item.nodeID,
        nodeTitle: item.label,
        position: firstPosition + index * 1000,
      })));
      const optimisticCardIDs = new Set(optimisticCards.map((card) => card.card_id));
      setCards((previous) => [...previous.filter((card) => !optimisticCardIDs.has(card.card_id) && !seenNodeIDs.has(card.node_id)), ...savedCards]);
    } catch {
      setError("Drop failed");
      refreshBoard();
    }
  }, [apiBase, boardID, cards, companyID, refreshBoard]);

  const onDropColumn = useCallback((event: React.DragEvent<HTMLElement>, columnID: string) => {
    event.preventDefault();
    setDragOverColumnID("");
    setDragOverCard(null);
    const columnPayload = parseKanbanColumnDragPayload(event.dataTransfer.getData(KANBAN_COLUMN_DRAG_MIME));
    if (columnPayload) {
      void reorderColumn(columnPayload.columnID, columnID, "swap");
      return;
    }
    const cardPayload = parseKanbanCardDragPayload(event.dataTransfer.getData(KANBAN_CARD_DRAG_MIME));
    if (cardPayload) {
      void reorderCards(cardPayload.cardIDs, columnID, null);
      return;
    }
    const explorerItems = parseExplorerEntityDragItems(event.dataTransfer.getData(EXPLORER_ENTITY_DRAG_MIME));
    if (explorerItems.length > 0) {
      void addEntitiesToColumn(columnID, explorerItems);
    }
  }, [addEntitiesToColumn, reorderCards, reorderColumn]);

  const onDropAtEnd = useCallback((event: React.DragEvent) => {
    const columnPayload = parseKanbanColumnDragPayload(event.dataTransfer.getData(KANBAN_COLUMN_DRAG_MIME));
    if (!columnPayload) return;
    event.preventDefault();
    void reorderColumn(columnPayload.columnID, null);
  }, [reorderColumn]);

  const getCardDragIDs = useCallback((cardID: string): string[] => {
    if (!selectedCardIDs.has(cardID)) return [cardID];
    return getOrderedKanbanCardIDs(orderedColumns, cards).filter((candidateID) => selectedCardIDs.has(candidateID));
  }, [cards, orderedColumns, selectedCardIDs]);

  const getCardDragPreviewItems = useCallback((cardIDs: string[]) => {
    const byID = new Map(cards.map((item) => [item.card_id, item]));
    return cardIDs.map((cardID) => {
      const item = byID.get(cardID);
      return item
        ? { label: item.node_title, color: getKanbanConditionalColor(item, columnColorByID) }
        : { label: cardID, color: accent };
    });
  }, [accent, cards, columnColorByID]);

  const renderCard = (card: KanbanCard): React.ReactNode => {
    const highlighted = highlightedEntity?.nodeID === card.node_id;
    const selected = selectedCardIDs.has(card.card_id);
    const dragBefore = dragOverCard?.cardID === card.card_id && dragOverCard.placement === "before";
    const dragAfter = dragOverCard?.cardID === card.card_id && dragOverCard.placement === "after";
    const description = (card.description_snapshot ?? "").trim();
    const color = getKanbanConditionalColor(card, columnColorByID);
    return (
      <article
        key={card.card_id}
        draggable
        tabIndex={0}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          selectCard(card.card_id, event);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!selectedCardIDs.has(card.card_id)) {
            setSelectedCardIDs(new Set([card.card_id]));
            setSelectionAnchorCardID(card.card_id);
          }
          setHighlightedEntity({ nodeID: card.node_id });
          publishKanbanSelectionToLinkedFrames(companyID, boardID, card.node_id, card.node_title);
          setColumnContextMenu(null);
          setCardContextMenu({ x: event.clientX, y: event.clientY, cardID: card.card_id });
        }}
        onDragStart={(event) => {
          event.stopPropagation();
          const dragCardIDs = getCardDragIDs(card.card_id);
          if (!selectedCardIDs.has(card.card_id)) {
            setSelectedCardIDs(new Set([card.card_id]));
            setSelectionAnchorCardID(card.card_id);
          }
          setCardContextMenu(null);
          setColumnContextMenu(null);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(KANBAN_CARD_DRAG_MIME, JSON.stringify({ cardID: dragCardIDs[0], cardIDs: dragCardIDs, sourceColumnID: card.column_id }));
          attachStackedDragPreview(event.dataTransfer, getCardDragPreviewItems(dragCardIDs), color, "Kanban cards");
        }}
        onDragEnd={() => setDragOverCard(null)}
        onDragOver={(event) => {
          if (!dataTransferIncludes(event, KANBAN_CARD_DRAG_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          setDragOverCard({ cardID: card.card_id, placement: cardDropPlacement(event) });
        }}
        onDragLeave={() => setDragOverCard((previous) => (previous?.cardID === card.card_id ? null : previous))}
        onDrop={(event) => {
          const cardPayload = parseKanbanCardDragPayload(event.dataTransfer.getData(KANBAN_CARD_DRAG_MIME));
          if (!cardPayload) return;
          event.preventDefault();
          event.stopPropagation();
          void reorderCards(cardPayload.cardIDs, card.column_id, card.card_id, cardDropPlacement(event));
        }}
        style={{
          position: "relative",
          border: `1px solid ${selected ? color : (highlighted ? accent : line)}`,
          background: cardBackground,
          color: text,
          padding: "8px 9px 8px 13px",
          minHeight: 58,
          cursor: "grab",
          outline: "none",
          overflow: "hidden",
          boxShadow: [
            selected ? `0 0 0 1px ${color}, 0 0 12px ${hexToRgba(color, 0.28)}, inset 0 0 0 1px ${hexToRgba(color, 0.16)}` : "",
            highlighted && !selected ? `0 0 0 1px ${accent} inset` : "",
            dragBefore ? `0 -3px 0 ${accent}` : "",
            dragAfter ? `0 3px 0 ${accent}` : "",
          ].filter(Boolean).join(", ") || undefined,
        }}
      >
        {/* The color rail is a separate layer so selection border changes cannot erase it. */}
        <span aria-hidden="true" style={getKanbanCardColorRailStyle(color)} />
        <div style={{ display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", gap: 6, alignItems: "start" }}>
          <span title="Node" style={{ width: 16, height: 16, marginTop: 1, display: "grid", placeItems: "center" }}>
            <NodeDocumentIcon color={color} />
          </span>
          <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.25, overflowWrap: "anywhere" }}>{card.node_title}</div>
        </div>
        {description && (
          <div style={{ marginTop: 7, color: subtext, fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>
            {description}
          </div>
        )}
      </article>
    );
  };

  const contextColumn = columnContextMenu ? columns.find((column) => column.column_id === columnContextMenu.columnID) : null;
  const contextCard = cardContextMenu ? cards.find((card) => card.card_id === cardContextMenu.cardID) : null;

  return (
    <div
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      style={{ position: "relative", width: "100%", height: "100%", boxSizing: "border-box", paddingTop: KANBAN_MODULE_TOP_CLEARANCE_PX, background: surface, color: text, overflow: "hidden" }}
    >
      <div style={{ position: "absolute", top: KANBAN_MODULE_TOP_CLEARANCE_PX - 1, left: 0, right: 0, borderBottom: `1px solid ${line}`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 4, left: 8, right: 12, display: "flex", alignItems: "center", gap: 6, paddingLeft: 106, zIndex: 3, pointerEvents: "auto" }}>
        {(["board", "boards"] as const).map((tab) => {
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setActiveTab(tab);
                if (tab === "boards") void refreshBoards();
              }}
              style={{ border: `1px solid ${selected ? accent : line}`, background: selected ? (isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.98)") : (isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.86)"), color: text, fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 10px", borderRadius: 4, cursor: "pointer" }}
            >
              {tab === "board" ? "Board" : "Boards"}
            </button>
          );
        })}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: subtext, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {activeBoardTitle}
        </span>
      </div>
      {activeTab === "boards" && (
        <section style={{ position: "absolute", top: KANBAN_MODULE_TOP_CLEARANCE_PX + 8, left: 12, width: "min(390px, calc(100% - 24px))", maxHeight: "calc(100% - 58px)", display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)", border: `1px solid ${line}`, background: isDark ? "rgba(17,22,27,0.98)" : "rgba(255,255,255,0.98)", boxShadow: isDark ? "0 14px 30px rgba(0,0,0,0.36)" : "0 14px 30px rgba(16,24,40,0.16)", zIndex: 4 }}>
          <div style={{ padding: "9px 10px", borderBottom: `1px solid ${line}`, fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>
            Saved Kanban Boards
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 8, borderBottom: `1px solid ${line}` }}>
            <button type="button" onClick={() => void saveCurrentBoardView()} style={{ border: `1px solid ${accent}`, background: "transparent", color: text, cursor: "pointer", fontSize: 11, fontWeight: 800, padding: "6px 8px" }}>
              Save current
            </button>
            <button type="button" onClick={() => void createNewBoardView()} style={{ border: `1px solid ${accent}`, background: "transparent", color: text, cursor: "pointer", fontSize: 11, fontWeight: 800, padding: "6px 8px" }}>
              New board
            </button>
          </div>
          <div className="company-explorer-scroll" style={{ overflowY: "auto", overflowX: "hidden", minHeight: 0, ["--company-explorer-scroll-accent" as string]: theme === "light" ? "rgb(0, 233, 255)" : accent, ["--company-explorer-scroll-track" as string]: isDark ? "rgba(255,255,255,0.08)" : "rgba(0, 233, 255, 0.08)" }}>
            {boardsLoading && <div style={{ padding: "8px 10px", color: subtext, fontSize: 11 }}>Loading boards...</div>}
            {!boardsLoading && boardRows.length === 0 && <div style={{ padding: "8px 10px", color: subtext, fontSize: 11 }}>No saved boards</div>}
            {boardRows.map((board) => {
              const selected = board.board_id === boardID;
              return (
                <button
                  key={board.board_id}
                  type="button"
                  title={board.board_id}
                  onClick={() => {
                    setSelectedCardIDs(new Set());
                    setSelectionAnchorCardID("");
                    setActiveBoardID(board.board_id);
                    setActiveTab("board");
                  }}
                  style={{ width: "100%", display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", alignItems: "center", gap: 7, minHeight: 30, padding: "5px 9px", border: "none", borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(3,25,30,0.06)"}`, background: selected ? (isDark ? "rgba(0,233,255,0.2)" : "rgba(0, 233, 255, 0.28)") : "transparent", color: text, cursor: "pointer", textAlign: "left" }}
                >
                  <span aria-hidden="true" style={{ width: 14, height: 14, border: `1px solid ${accent}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, padding: 2 }}>
                    <span style={{ background: accent, opacity: 0.8 }} />
                    <span style={{ background: subtext, opacity: 0.55 }} />
                  </span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: selected ? 800 : 700 }}>
                    {getKanbanBoardDisplayTitle(board)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      <div className="kanban-board-scroll" style={{ height: "100%", overflow: "auto", padding: "12px 12px 14px", boxSizing: "border-box", ["--kanban-board-scroll-accent" as string]: theme === "light" ? "rgb(0, 233, 255)" : accent, ["--kanban-board-scroll-track" as string]: isDark ? "rgba(255,255,255,0.08)" : "rgba(0, 233, 255, 0.08)" }}>
        {error && <div style={{ marginBottom: 8, color: "#c62828", fontSize: 11, fontWeight: 700 }}>{error}</div>}
        {loading && <div style={{ color: subtext, fontSize: 12 }}>Loading board...</div>}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: KANBAN_DEFAULT_COLUMN_HEIGHT_PX + 18, paddingBottom: 16 }}>
          {orderedColumns.map((column) => {
            const columnCards = cardsByColumn.get(column.column_id) ?? [];
            const columnWidth = getColumnWidth(column);
            const columnHeight = getColumnHeight(column);
            const columnDropActive = dragOverColumnID === column.column_id;
            const insertionShadow = columnDropActive ? `0 0 0 3px ${accent}` : "";
            const columnShadow = insertionShadow ? (laneShadow === "none" ? insertionShadow : `${insertionShadow}, ${laneShadow}`) : laneShadow;
            return (
              <section
                key={column.column_id}
                onMouseDown={clearCardSelectionFromBlankClick}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setCardContextMenu(null);
                  setColumnContextMenu({ x: event.clientX, y: event.clientY, columnID: column.column_id });
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dataTransferIncludes(event, KANBAN_COLUMN_DRAG_MIME) && draggingColumnID !== column.column_id) {
                    setDragOverColumnID(column.column_id);
                  }
                }}
                onDragLeave={() => setDragOverColumnID((previous) => (previous === column.column_id ? "" : previous))}
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
                    setDragOverColumnID("");
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
                <div
                  onMouseDown={clearCardSelectionFromBlankClick}
                  style={{ minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", gap: 8, padding: 8 }}
                >
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
      {contextCard && cardContextMenu && (
        <FrameRightClickMenu x={cardContextMenu.x} y={cardContextMenu.y} onClose={() => setCardContextMenu(null)}>
          <button
            type="button"
            style={{ ...contextMenuButtonStyle, color: "#c62828" }}
            onClick={() => requestCardDelete(selectedCardIDs.has(contextCard.card_id) ? Array.from(selectedCardIDs) : [contextCard.card_id])}
            {...contextMenuHoverHandlers}
          >
            Delete card
          </button>
        </FrameRightClickMenu>
      )}
      {deleteCardConfirmation && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center" }}>
          <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(0,233,255,0.45)", background: "rgba(255,255,255,0.95)", padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#111111" }}>
              Are you sure you want to delete {deleteCardConfirmation.cardIDs.length} Kanban card{deleteCardConfirmation.cardIDs.length === 1 ? "" : "s"}?
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.35, color: "#2e2e2e" }}>
              This only removes the selected Kanban board card{deleteCardConfirmation.cardIDs.length === 1 ? "" : "s"}. The underlying node{deleteCardConfirmation.cardIDs.length === 1 ? "" : "s"} will continue to exist outside this board.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  void removeCards(deleteCardConfirmation.cardIDs);
                  setDeleteCardConfirmation(null);
                }}
                style={{ border: "1px solid rgba(0,233,255,0.45)", background: "#fff", cursor: "pointer", fontWeight: 700 }}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setDeleteCardConfirmation(null)}
                style={{ border: "1px solid #ff3d7f", boxShadow: "inset 0 0 0 1px rgba(255,130,170,0.25), 0 0 10px rgba(255,61,127,0.18)", color: "#8b123f", background: "#fff", cursor: "pointer", fontWeight: 700 }}
              >
                No
              </button>
            </div>
          </div>
        </div>
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
