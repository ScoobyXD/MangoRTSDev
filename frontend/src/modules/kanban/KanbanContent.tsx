import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveConnectedFrameTargets } from "../linkingGraph";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import { getNodeTitle, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { getNodeRelationshipGraphSnapshot, subscribeNodeRelationshipGraph } from "../node-map/NodeRelationshipGraph";
import { publishLiveSelection, readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../selectionCoordinator";
import { createKanbanBoard, listKanbanBoards, listKanbanCards, listKanbanColumns, updateKanbanBoard } from "./kanbanApi";
import {
  addExplorerNodesToKanbanColumnCommand,
  createKanbanColumnCommand,
  deleteKanbanCardsCommand,
  deleteKanbanColumnCommand,
  persistKanbanColumnLayoutCommand,
  renameKanbanColumnCommand,
  reorderKanbanCardsCommand,
  reorderKanbanColumnsCommand,
  type KanbanCommandContext,
} from "./kanbanCommands";
import { KanbanBoardSidebar } from "./KanbanBoardSidebar";
import { KanbanCardView } from "./KanbanCardView";
import { KanbanColumnView } from "./KanbanColumnView";
import {
  EXPLORER_ENTITY_DRAG_MIME,
  KANBAN_CARD_DRAG_MIME,
  KANBAN_COLUMN_DRAG_MIME,
  KANBAN_DEFAULT_BOARD_TITLE,
  KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
  KANBAN_MODULE_TOP_CLEARANCE_PX,
  attachStackedDragPreview,
  buildKanbanCardSelectionUpdate,
  clampColumnHeight,
  clampColumnWidth,
  getKanbanBoardDisplayTitle,
  getKanbanConditionalColor,
  getOrderedKanbanCardIDs,
  groupCardsByColumn,
  normalizeKanbanColumnItemColor,
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

function publishKanbanSelectionToLinkedFrames(companyID: string, sourceFrameID: string, nodeID: string, nodeTitle: string, selectedNodeIDs: string[] = [nodeID]): void {
  if (!nodeID) return;
  try {
    const edges = readFrameLinksFromStorage();
    const registry = readFrameRegistryFromStorage();
    const targetFrameIDs = resolveConnectedFrameTargets({ sourceFrameID, edges, registry });
    publishLiveSelection({
      companyID,
      entityKind: "node",
      entityID: nodeID,
      label: nodeTitle,
      sourceFrameID,
      sourceModule: "kanban",
      targetFrameIDs,
      selectedTreeID: `node-${nodeID}`,
      selectedTreeIDs: selectedNodeIDs.map((id) => `node-${id}`),
      selectedEntityIDs: selectedNodeIDs,
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
  const [allBoardsOpen, setAllBoardsOpen] = useState(false);
  const [boardSearchQuery, setBoardSearchQuery] = useState("");
  const [editingBoardTitle, setEditingBoardTitle] = useState(false);
  const [boardTitleDraft, setBoardTitleDraft] = useState("");
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [explorerFolders, setExplorerFolders] = useState<CompanyExplorerFolder[]>([]);
  const [explorerFolderItems, setExplorerFolderItems] = useState<CompanyExplorerFolderItem[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const frameID = frameBoardID;
  const boardID = activeBoardID;
  const kanbanCommandContext = useMemo<KanbanCommandContext>(() => ({ apiBase, companyID, boardID }), [apiBase, boardID, companyID]);
  const [highlightedEntity, setHighlightedEntity] = useState<HighlightedEntity>(() => readLinkedExplorerSelection(companyID, frameID));
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
  const filteredBoardRows = useMemo(() => {
    const query = boardSearchQuery.trim().toLowerCase();
    if (!query) return boardRows;
    return boardRows.filter((board) => getKanbanBoardDisplayTitle(board).toLowerCase().includes(query));
  }, [boardRows, boardSearchQuery]);
  const boardFolderLabelByID = useMemo(() => {
    const folderByID = new Map(explorerFolders.map((folder) => [folder.folder_id, folder]));
    const folderPathLabel = (folderID: string): string => {
      const labels: string[] = [];
      let currentID = folderID;
      const seen = new Set<string>();
      while (currentID && !seen.has(currentID)) {
        seen.add(currentID);
        const folder = folderByID.get(currentID);
        if (!folder) break;
        labels.unshift(folder.name);
        currentID = folder.parent_folder_id ?? "";
      }
      return labels.join(" / ") || "Company";
    };
    const labels = new Map<string, string>();
    for (const item of explorerFolderItems) {
      if (item.item_type !== "kanban") continue;
      labels.set(item.item_id, folderPathLabel(item.folder_id));
    }
    return labels;
  }, [explorerFolderItems, explorerFolders]);
  const filteredBoardGroups = useMemo(() => {
    const groups = new Map<string, KanbanBoard[]>();
    for (const board of filteredBoardRows) {
      const folderLabel = boardFolderLabelByID.get(board.board_id) ?? "Company";
      const bucket = groups.get(folderLabel) ?? [];
      bucket.push(board);
      groups.set(folderLabel, bucket);
    }
    return Array.from(groups, ([folderLabel, items]) => ({ folderLabel, items }));
  }, [boardFolderLabelByID, filteredBoardRows]);

  const refreshBoards = useCallback(async () => {
    setBoardsLoading(true);
    try {
      const [nextBoards, folderPayload, folderItemPayload] = await Promise.all([
        listKanbanBoards(apiBase, companyID, 200),
        fetch(`${apiBase}/v1/company-explorer/folders?company_id=${encodeURIComponent(companyID)}`),
        fetch(`${apiBase}/v1/company-explorer/folder-items?company_id=${encodeURIComponent(companyID)}&item_type=kanban`),
      ]);
      setBoards(sortKanbanBoards(nextBoards));
      if (folderPayload.ok) {
        const parsed = await folderPayload.json() as { folders?: CompanyExplorerFolder[] };
        setExplorerFolders(parsed.folders ?? []);
      }
      if (folderItemPayload.ok) {
        const parsed = await folderItemPayload.json() as { folder_items?: CompanyExplorerFolderItem[] };
        setExplorerFolderItems(parsed.folder_items ?? []);
      }
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
      setAllBoardsOpen(false);
    } catch {
      setError("Kanban board create failed");
    }
  }, [apiBase, companyID]);

  const commitBoardTitle = useCallback(async (title: string) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setEditingBoardTitle(false);
      return;
    }
    setBoards((previous) => previous.map((board) => (board.board_id === boardID ? { ...board, title: cleanTitle } : board)));
    setError("");
    try {
      const saved = activeBoard
        ? await updateKanbanBoard(apiBase, companyID, boardID, cleanTitle)
        : await createKanbanBoard(apiBase, companyID, cleanTitle, boardID);
      setBoards((previous) => sortKanbanBoards([
        ...previous.filter((board) => board.board_id !== saved.board_id),
        saved,
      ]));
      setEditingBoardTitle(false);
    } catch {
      setError("Kanban board rename failed");
      setEditingBoardTitle(false);
      void refreshBoards();
    }
  }, [activeBoard, apiBase, boardID, companyID, refreshBoards]);

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
      if (selection.companyID !== companyID || selection.sourceFrameID === frameID) return;
      if (selection.entityKind === "kanban" && selection.entityID.trim()) {
        setSelectedCardIDs(new Set());
        setSelectionAnchorCardID("");
        setHighlightedEntity(null);
        setActiveBoardID(selection.entityID.trim());
        return;
      }
      if (selection.entityKind === "node" && selection.entityID.trim()) {
        const selectedNodeIDs = new Set((selection.selectedEntityIDs?.length ? selection.selectedEntityIDs : [selection.entityID]).map((id) => id.trim()).filter(Boolean));
        const selectedCards = cards.filter((card) => selectedNodeIDs.has(card.node_id));
        setSelectedCardIDs(new Set(selectedCards.map((card) => card.card_id)));
        setSelectionAnchorCardID(selectedCards[0]?.card_id ?? "");
        setHighlightedEntity({ nodeID: selection.entityID.trim() });
        return;
      }
      setHighlightedEntity(null);
      setSelectedCardIDs(new Set());
      setSelectionAnchorCardID("");
    };
    const liveSelection = readLiveSelectionForFrame(companyID, frameID);
    if (liveSelection) applyLiveSelection(liveSelection);
    return subscribeLiveSelection(frameID, applyLiveSelection);
  }, [cards, companyID, frameID]);

  const addColumn = useCallback(async () => {
    setError("");
    try {
      const column = await createKanbanColumnCommand({ context: kanbanCommandContext, columns });
      setColumns((previous) => [...previous, column].sort((a, b) => a.position - b.position));
      setEditingColumnID(column.column_id);
      void refreshBoards();
    } catch {
      setError("Column create failed");
    }
  }, [columns, kanbanCommandContext, refreshBoards]);

  const commitColumnTitle = useCallback(async (columnID: string, title: string) => {
    setError("");
    try {
      const updated = await renameKanbanColumnCommand({ context: kanbanCommandContext, columns, columnID, title });
      if (!updated) return;
      setColumns((previous) => previous.map((column) => (column.column_id === columnID ? updated : column)));
      setEditingColumnID("");
    } catch {
      setError("Column rename failed");
      refreshBoard();
    }
  }, [columns, kanbanCommandContext, refreshBoard]);

  const removeColumn = useCallback(async (columnID: string) => {
    const previousColumns = columns;
    const previousCards = cards;
    setColumns((current) => current.filter((column) => column.column_id !== columnID));
    setCards((current) => current.filter((card) => card.column_id !== columnID));
    setError("");
    try {
      await deleteKanbanColumnCommand({ context: kanbanCommandContext, columnID });
    } catch {
      setError("Column delete failed");
      setColumns(previousColumns);
      setCards(previousCards);
    }
  }, [cards, columns, kanbanCommandContext]);

  const requestColumnDelete = useCallback((columnID: string) => {
    const column = columns.find((item) => item.column_id === columnID);
    if (!column) return;
    setColumnContextMenu(null);
    setCardContextMenu(null);
    setDeleteColumnConfirmation({ columnID, title: column.title });
  }, [columns]);

  const reorderColumn = useCallback(async (draggedColumnID: string, targetColumnID: string | null, placement: KanbanColumnDropPlacement = "before") => {
    setDraggingColumnID("");
    setDragOverColumnID("");
    setError("");
    try {
      await reorderKanbanColumnsCommand({
        context: kanbanCommandContext,
        columns,
        draggedColumnID,
        targetColumnID,
        placement,
        onOptimisticColumns: setColumns,
      });
    } catch {
      setError("Column reorder failed");
      refreshBoard();
    }
  }, [columns, kanbanCommandContext, refreshBoard]);

  const persistColumnSize = useCallback(async (columnID: string, size: { widthPx?: number; heightPx?: number }) => {
    setError("");
    try {
      const updated = await persistKanbanColumnLayoutCommand({ context: kanbanCommandContext, columnID, ...size });
      setColumns((previous) => previous.map((column) => (column.column_id === updated.column_id ? updated : column)));
    } catch {
      setError("Column resize failed");
      refreshBoard();
    }
  }, [kanbanCommandContext, refreshBoard]);

  const persistColumnItemColor = useCallback(async (columnID: string, itemColor: string) => {
    const cleanColor = normalizeKanbanColumnItemColor(itemColor);
    setColumns((previous) => previous.map((column) => (column.column_id === columnID ? { ...column, item_color: cleanColor } : column)));
    setError("");
    try {
      const updated = await persistKanbanColumnLayoutCommand({ context: kanbanCommandContext, columnID, itemColor: cleanColor });
      setColumns((previous) => previous.map((column) => (column.column_id === updated.column_id ? updated : column)));
    } catch {
      setError("Column color update failed");
      refreshBoard();
    }
  }, [kanbanCommandContext, refreshBoard]);

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
    setDragOverCard(null);
    setError("");
    try {
      const result = await reorderKanbanCardsCommand({
        context: kanbanCommandContext,
        cards,
        cardIDs,
        columnID,
        targetCardID,
        placement,
        onOptimisticCards: setCards,
      });
      const byID = new Map(result.persistedCards.map((card) => [card.card_id, card]));
      setCards((previous) => previous.map((card) => byID.get(card.card_id) ?? card));
    } catch {
      setError("Card reorder failed");
      refreshBoard();
    }
  }, [cards, kanbanCommandContext, refreshBoard]);

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
      const selectedNodeIDs = cards.filter((card) => next.selectedCardIDs.has(card.card_id)).map((card) => card.node_id);
      publishKanbanSelectionToLinkedFrames(companyID, frameID, clickedCard.node_id, clickedCard.node_title, selectedNodeIDs);
    }
  }, [cards, companyID, frameID, orderedColumns, selectedCardIDs, selectionAnchorCardID]);

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
      await deleteKanbanCardsCommand({ context: kanbanCommandContext, cardIDs: Array.from(ids) });
    } catch {
      setError("Card delete failed");
      setCards(previousCards);
    }
  }, [cards, kanbanCommandContext]);

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
    try {
      const result = await addExplorerNodesToKanbanColumnCommand({
        context: kanbanCommandContext,
        cards,
        columnID,
        items,
        onOptimisticCards: (optimisticCards, nodeIDs) => {
          setCards((previous) => [...previous.filter((card) => !nodeIDs.has(card.node_id)), ...optimisticCards]);
        },
      });
      if (result.savedCards.length === 0) return;
      setCards((previous) => [...previous.filter((card) => !result.optimisticCardIDs.has(card.card_id) && !result.nodeIDs.has(card.node_id)), ...result.savedCards]);
    } catch {
      setError("Drop failed");
      refreshBoard();
    }
  }, [cards, kanbanCommandContext, refreshBoard]);

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
    const color = getKanbanConditionalColor(card, columnColorByID);
    return (
      <KanbanCardView
        key={card.card_id}
        card={card}
        color={color}
        highlighted={highlighted}
        selected={selected}
        dragBefore={dragBefore}
        dragAfter={dragAfter}
        line={line}
        cardBackground={cardBackground}
        text={text}
        subtext={subtext}
        accent={accent}
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
          publishKanbanSelectionToLinkedFrames(companyID, frameID, card.node_id, card.node_title, [card.node_id]);
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
      />
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
      <KanbanBoardSidebar
        activeBoardTitle={activeBoardTitle}
        boardID={boardID}
        boardTitleDraft={boardTitleDraft}
        boardSearchQuery={boardSearchQuery}
        allBoardsOpen={allBoardsOpen}
        boardsLoading={boardsLoading}
        filteredBoardRowsLength={filteredBoardRows.length}
        filteredBoardGroups={filteredBoardGroups}
        accent={accent}
        line={line}
        text={text}
        subtext={subtext}
        isDark={isDark}
        theme={theme}
        editingBoardTitle={editingBoardTitle}
        onSetBoardTitleDraft={setBoardTitleDraft}
        onSetBoardSearchQuery={setBoardSearchQuery}
        onSetEditingBoardTitle={setEditingBoardTitle}
        onToggleAllBoards={() => {
          setAllBoardsOpen((open) => !open);
          void refreshBoards();
        }}
        onCommitBoardTitle={(title) => void commitBoardTitle(title)}
        onRefreshBoards={() => void refreshBoards()}
        onSaveCurrentBoardView={() => void saveCurrentBoardView()}
        onCreateNewBoardView={() => void createNewBoardView()}
        onSelectBoard={(nextBoardID) => {
          setSelectedCardIDs(new Set());
          setSelectionAnchorCardID("");
          setActiveBoardID(nextBoardID);
          setAllBoardsOpen(false);
        }}
      />
      <div className="kanban-board-scroll" style={{ height: "100%", overflow: "auto", padding: "12px 12px 14px", boxSizing: "border-box", ["--kanban-board-scroll-accent" as string]: theme === "light" ? "rgb(0, 233, 255)" : accent, ["--kanban-board-scroll-track" as string]: isDark ? "rgba(255,255,255,0.08)" : "rgba(0, 233, 255, 0.08)" }}>
        {error && <div style={{ marginBottom: 8, color: "#c62828", fontSize: 11, fontWeight: 700 }}>{error}</div>}
        {loading && <div style={{ color: subtext, fontSize: 12 }}>Loading board...</div>}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: KANBAN_DEFAULT_COLUMN_HEIGHT_PX + 18, paddingBottom: 16 }}>
          {orderedColumns.map((column) => {
            const columnCards = cardsByColumn.get(column.column_id) ?? [];
            return (
              <KanbanColumnView
                key={column.column_id}
                column={column}
                columnCards={columnCards}
                renderedCards={columnCards.map((card) => renderCard(card))}
                accent={accent}
                line={line}
                subtext={subtext}
                text={text}
                laneBackground={laneBackground}
                laneBorder={laneBorder}
                laneShadow={laneShadow}
                draggingColumnID={draggingColumnID}
                dragOverColumnID={dragOverColumnID}
                editingColumnID={editingColumnID}
                resizeRef={resizeRef}
                onBlankMouseDown={clearCardSelectionFromBlankClick}
                onSetCardContextMenu={setCardContextMenu}
                onSetColumnContextMenu={setColumnContextMenu}
                onSetDraggingColumnID={setDraggingColumnID}
                onSetDragOverColumnID={setDragOverColumnID}
                onSetColumns={setColumns}
                onSetEditingColumnID={setEditingColumnID}
                onCommitColumnTitle={(columnID, title) => void commitColumnTitle(columnID, title)}
                onRefreshBoard={() => void refreshBoard()}
                onRequestColumnDelete={requestColumnDelete}
                onDropColumn={onDropColumn}
                dataTransferIncludes={dataTransferIncludes}
              />
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
            style={contextMenuButtonStyle}
            onClick={() => {
              publishKanbanSelectionToLinkedFrames(companyID, frameID, contextCard.node_id, contextCard.node_title, [contextCard.node_id]);
              setCardContextMenu(null);
            }}
            {...contextMenuHoverHandlers}
          >
            Find on company explorer
          </button>
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
