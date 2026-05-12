import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { EditorContent } from "../editor/EditorContent";
import { readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveConnectedFrameTargets } from "../linkingGraph";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import { getNodeTitle, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, type NodeRecord } from "../node-map/shared";
import { getNodeRelationshipGraphSnapshot, removeNodeRelationshipGraphNode, subscribeNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../node-map/NodeRelationshipGraph";
import { invalidateNodeRecordStoreCaches } from "../node-map/NodeRecordStore";
import { publishLiveSelection, readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../selectionCoordinator";
import { subscribeWorkspaceStream } from "../workspace/workspaceStream";
import {
  createKanbanBoard,
  getLogicGateArenaView,
  invalidateKanbanBoardListCache,
  invalidateLogicGateArenaViewCache,
  listKanbanBoards,
  updateKanbanBoard,
} from "./kanbanApi";
import {
  getKanbanBoardContentsSingleFlight,
  hasKanbanBoardContentsCache,
  invalidateKanbanBoardContentsCache,
  primeKanbanBoardContentsCache,
} from "./KanbanBoardContentStore";
import {
  addExplorerNodesToKanbanColumnCommand,
  createKanbanColumnCommand,
  deleteKanbanCardsCommand,
  deleteKanbanColumnCommand,
  persistKanbanColumnLayoutCommand,
  renameKanbanColumnCommand,
  reorderKanbanCardsCommand,
  reorderKanbanColumnsCommand,
  toggleKanbanCardIssueCommand,
  type KanbanCommandContext,
} from "./kanbanCommands";
import { KanbanBoardSidebar } from "./KanbanBoardSidebar";
import { KanbanCardView } from "./KanbanCardView";
import { KanbanColumnView } from "./KanbanColumnView";
import {
  EXPLORER_ENTITY_DRAG_MIME,
  EVENT_KANBAN_BOARDS_UPDATED,
  KANBAN_CARD_DRAG_MIME,
  KANBAN_COLUMN_DRAG_MIME,
  KANBAN_DEFAULT_BOARD_TITLE,
  KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
  KANBAN_GROUP_FIELDS,
  KANBAN_MODULE_TOP_CLEARANCE_PX,
  attachStackedDragPreview,
  buildKanbanGroupedBoardLayout,
  buildKanbanCardSelectionUpdate,
  clampColumnHeight,
  clampColumnWidth,
  getKanbanBoardDisplayTitle,
  getKanbanConditionalColor,
  getDefaultKanbanYAxisSortDirection,
  getOrderedKanbanCardIDs,
  groupCardsByColumn,
  logicGateKanbanBoardID,
  logicGateIDFromKanbanBoardID,
  normalizeKanbanColumnItemColor,
  parseExplorerEntityDragItems,
  parseKanbanCardDragPayload,
  parseKanbanColumnDragPayload,
  shouldRefreshKanbanBoardForNodeStatusChange,
  sortColumns,
  sortKanbanBoards,
  type KanbanBoard,
  type KanbanBoardsUpdatedDetail,
  type KanbanCard,
  type KanbanCardDropPlacement,
  type KanbanColumn,
  type KanbanColumnDropPlacement,
  type KanbanGroupField,
  type KanbanGroupSortDirection,
  type ExplorerEntityDragItem,
} from "./shared";
import { getActiveCompanyID } from "../../auth/currentCompany";

type HighlightedEntity = { nodeID: string } | null;

type CompanyUser = {
  user_id: string;
  email?: string;
  display_name?: string;
};

type WorkspaceStreamEnvelope = {
  company_id: string;
  type: string;
  data?: Record<string, unknown>;
};

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

type NodeEditorOverlayState = {
  nodeID: string;
  nodeTitle: string;
};

type KanbanContentProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  theme?: "mango" | "teal" | "light" | "dark";
  arenaMode?: boolean;
  forcedLogicGateID?: string;
  forcedLogicGateLabel?: string;
};

type OverlayResizeState = {
  edges: Partial<Record<"left" | "right" | "top" | "bottom", true>>;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  boardWidth: number;
  boardHeight: number;
};

const nodeEditorOverlayResizeHandles: Array<{
  key: string;
  edges: OverlayResizeState["edges"];
  cursor: string;
  style: React.CSSProperties;
}> = [
  { key: "top-left", edges: { top: true, left: true }, cursor: "nwse-resize", style: { top: -5, left: -5, width: 10, height: 10 } },
  { key: "top-right", edges: { top: true, right: true }, cursor: "nesw-resize", style: { top: -5, right: -5, width: 10, height: 10 } },
  { key: "bottom-left", edges: { bottom: true, left: true }, cursor: "nesw-resize", style: { bottom: -5, left: -5, width: 10, height: 10 } },
  { key: "bottom-right", edges: { bottom: true, right: true }, cursor: "nwse-resize", style: { bottom: -5, right: -5, width: 10, height: 10 } },
  { key: "top", edges: { top: true }, cursor: "ns-resize", style: { top: -4, left: 18, right: 18, height: 8 } },
  { key: "bottom", edges: { bottom: true }, cursor: "ns-resize", style: { bottom: -4, left: 18, right: 18, height: 8 } },
  { key: "left", edges: { left: true }, cursor: "ew-resize", style: { left: -4, top: 18, bottom: 18, width: 8 } },
  { key: "right", edges: { right: true }, cursor: "ew-resize", style: { right: -4, top: 18, bottom: 18, width: 8 } },
];

const contextMenuButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "9px 16px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0,
  fontFamily: "var(--mango-font-family)",
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

const ARENA_GROUP_COLUMN_WIDTH_PX = 300;
const ARENA_GROUP_ROW_LABEL_WIDTH_PX = 104;
const ARENA_GROUP_MIN_CELL_HEIGHT_PX = 86;
const ARENA_GROUP_FRAME_BACKGROUND = "#ffffff";
const ARENA_GROUP_GLASS_BORDER_LIGHT = "rgba(255, 136, 32, 0.32)";
const ARENA_GROUP_GLASS_BORDER_DARK = "rgba(255, 136, 32, 0.28)";
const ARENA_GROUP_FRAME_SHADOW = "0 1px 2px rgba(15,23,42,0.06)";

const KanbanDisclosureIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style={{ display: "block" }}>
    <path d="M3.25 4.55 6 7.3l2.75-2.75" fill="none" stroke={color} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const KanbanCheckIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" style={{ display: "block" }}>
    <path d="m3.1 6.55 2.05 2.05 4.75-4.75" fill="none" stroke={color} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
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

function publishKanbanBoardSelectionToLinkedFrames(companyID: string, sourceFrameID: string, boardID: string, boardTitle: string): void {
  if (!boardID) return;
  try {
    const edges = readFrameLinksFromStorage();
    const registry = readFrameRegistryFromStorage();
    const targetFrameIDs = resolveConnectedFrameTargets({ sourceFrameID, edges, registry });
    publishLiveSelection({
      companyID,
      entityKind: "kanban",
      entityID: boardID,
      label: boardTitle,
      sourceFrameID,
      sourceModule: "kanban",
      targetFrameIDs,
      selectedTreeID: `kanban-${boardID}`,
      selectedTreeIDs: [`kanban-${boardID}`],
      selectedEntityIDs: [boardID],
    });
  } catch {
    // Board selection should not depend on link graph storage.
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

export const KanbanContent: React.FC<KanbanContentProps> = ({
  accent,
  widgetId,
  theme = "mango",
  arenaMode = false,
  forcedLogicGateID = "",
  forcedLogicGateLabel = "",
}) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = getActiveCompanyID();
  const frameBoardID = widgetId?.trim() ? widgetId : "global-kanban";
  const [activeBoardID, setActiveBoardID] = useState(frameBoardID);
  const [activeLogicGateID, setActiveLogicGateID] = useState("");
  const [activeLogicGateLabel, setActiveLogicGateLabel] = useState("");
  const [allBoardsOpen, setAllBoardsOpen] = useState(false);
  const [boardSearchQuery, setBoardSearchQuery] = useState("");
  const [arenaGroupingOpen, setArenaGroupingOpen] = useState(false);
  const [arenaGroupMenuOpen, setArenaGroupMenuOpen] = useState<"x" | "y" | null>(null);
  const [arenaXGroupBy, setArenaXGroupBy] = useState<KanbanGroupField>("status");
  const [arenaYGroupBy, setArenaYGroupBy] = useState<KanbanGroupField>("person");
  const [arenaXSortDirection, setArenaXSortDirection] = useState<KanbanGroupSortDirection>("asc");
  const [arenaYSortDirection, setArenaYSortDirection] = useState<KanbanGroupSortDirection>(() => getDefaultKanbanYAxisSortDirection("person"));
  const [editingBoardTitle, setEditingBoardTitle] = useState(false);
  const [boardTitleDraft, setBoardTitleDraft] = useState("");
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [nodeGraphRevision, setNodeGraphRevision] = useState(0);
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
  const [nodeEditorOverlay, setNodeEditorOverlay] = useState<NodeEditorOverlayState | null>(null);
  const [nodeEditorOverlayRatio, setNodeEditorOverlayRatio] = useState({ width: 0.78, height: 0.82 });
  const [deleteColumnConfirmation, setDeleteColumnConfirmation] = useState<{ columnID: string; title: string } | null>(null);
  const [deleteCardConfirmation, setDeleteCardConfirmation] = useState<{ cardIDs: string[] } | null>(null);
  const [deleteNodeConfirmation, setDeleteNodeConfirmation] = useState<{ nodeIDs: string[] } | null>(null);
  const boardRootRef = useRef<HTMLDivElement | null>(null);
  const arenaGroupControlsRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<ColumnResizeState | null>(null);
  const nodeEditorOverlayResizeRef = useRef<OverlayResizeState | null>(null);
  const activeBoardIDRef = useRef(activeBoardID);
  const frameBoardIDRef = useRef(frameBoardID);
  const boardsRef = useRef<KanbanBoard[]>([]);
  const columnsRef = useRef<KanbanColumn[]>([]);
  const cardsRef = useRef<KanbanCard[]>([]);
  const boardRefreshRequestRef = useRef(0);
  const lastLocalBoardSelectionChangedAtRef = useRef(0);

  const requestJSON = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiBase}${path}`, { ...init, headers });
    if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }, [apiBase]);

  useEffect(() => {
    let cancelled = false;
    if (!companyID) {
      setCompanyUsers([]);
      return;
    }
    (async () => {
      try {
        const payload = await requestJSON<{ users: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(companyID)}/users`);
        if (!cancelled) setCompanyUsers(payload.users ?? []);
      } catch {
        if (!cancelled) setCompanyUsers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [companyID, requestJSON]);

  const isDark = theme === "dark";
  const surface = isDark ? "#11161b" : "#ffffff";
  const text = isDark ? "#f6f8fb" : "#24120a";
  const subtext = isDark ? "#b8c4cc" : "#7c3a12";
  const line = isDark ? "rgba(255,255,255,0.16)" : "rgba(255, 136, 32, 0.16)";
  const laneBackground = isDark ? "#1a2229" : "#ffffff";
  const laneBorder = isDark ? "rgba(255,255,255,0.18)" : "rgba(17,17,17,0.78)";
  const laneShadow = isDark ? "none" : "0 4px 12px rgba(16,24,40,0.08)";
  const cardBackground = isDark ? "#101418" : "#ffffff";
  const topClearancePx = arenaMode ? 34 : KANBAN_MODULE_TOP_CLEARANCE_PX;
  const boardHeaderLeftPaddingPx = arenaMode ? 0 : 162;

  useEffect(() => {
    setActiveBoardID(frameBoardID);
    setActiveLogicGateID("");
    setActiveLogicGateLabel("");
    setNodeEditorOverlay(null);
  }, [frameBoardID]);

  useEffect(() => {
    activeBoardIDRef.current = activeBoardID;
  }, [activeBoardID]);

  useEffect(() => {
    frameBoardIDRef.current = frameBoardID;
  }, [frameBoardID]);

  useEffect(() => {
    boardsRef.current = boards;
  }, [boards]);

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    if (!arenaGroupingOpen) setArenaGroupMenuOpen(null);
  }, [arenaGroupingOpen]);

  useEffect(() => {
    if (!arenaGroupMenuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (arenaGroupControlsRef.current?.contains(event.target as Node)) return;
      if ((event.target as Element | null)?.closest?.("[data-arena-group-controls='true']")) return;
      setArenaGroupMenuOpen(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [arenaGroupMenuOpen]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const state = nodeEditorOverlayResizeRef.current;
      if (!state) return;
      event.preventDefault();
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      let width = state.startWidth;
      let height = state.startHeight;
      if (state.edges.right) width += dx;
      if (state.edges.left) width -= dx;
      if (state.edges.bottom) height += dy;
      if (state.edges.top) height -= dy;
      setNodeEditorOverlayRatio({
        width: Math.max(0.42, Math.min(width / Math.max(1, state.boardWidth), 0.96)),
        height: Math.max(0.42, Math.min(height / Math.max(1, state.boardHeight), 0.94)),
      });
    };
    const onEnd = () => {
      nodeEditorOverlayResizeRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
    };
  }, []);

  const orderedColumns = useMemo(() => sortColumns(columns), [columns]);
  const columnColorByID = useMemo(() => new Map(orderedColumns.map((column) => [column.column_id, normalizeKanbanColumnItemColor(column.item_color)])), [orderedColumns]);
  const cardsByColumn = useMemo(() => groupCardsByColumn(cards), [cards]);
  const arenaUserByID = useMemo(() => new Map(companyUsers.map((user) => [user.user_id, user])), [companyUsers]);
  const arenaNodeByID = useMemo(() => {
    const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
    return new Map((snapshot.nodes ?? []).map((node) => [node.node_id, node]));
  }, [apiBase, cards, columns, companyID, nodeGraphRevision]);
  const arenaGroupedBoard = useMemo(() => buildKanbanGroupedBoardLayout({
    columns: orderedColumns,
    cards,
    xGroupBy: arenaXGroupBy,
    yGroupBy: arenaYGroupBy,
    xSortDirection: arenaXSortDirection,
    ySortDirection: arenaYSortDirection,
    nodeByID: arenaNodeByID,
    userByID: arenaUserByID,
  }), [arenaNodeByID, arenaUserByID, arenaXGroupBy, arenaXSortDirection, arenaYGroupBy, arenaYSortDirection, cards, orderedColumns]);
  const orderedBoards = useMemo(() => sortKanbanBoards(boards), [boards]);
  const activeBoard = useMemo(() => orderedBoards.find((board) => board.board_id === boardID) ?? null, [boardID, orderedBoards]);
  const activeBoardTitle = activeBoard ? getKanbanBoardDisplayTitle(activeBoard) : (activeLogicGateLabel || KANBAN_DEFAULT_BOARD_TITLE);
  const boardRows = useMemo<KanbanBoard[]>(() => {
    if (activeBoard) return orderedBoards;
    return [{
      company_id: companyID,
      board_id: boardID,
      logic_gate_id: activeLogicGateID || null,
      title: activeLogicGateLabel || `${KANBAN_DEFAULT_BOARD_TITLE} (unsaved)`,
      position: 0,
      created_timestamp: "",
      updated_timestamp: "",
    }, ...orderedBoards];
  }, [activeBoard, activeLogicGateID, activeLogicGateLabel, boardID, companyID, orderedBoards]);
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

  const syncNodeStatusesFromCards = useCallback((statusCards: KanbanCard[], columnSource?: KanbanColumn[]) => {
    if (statusCards.length === 0) return;
    const columnsForStatus = columnSource ?? columnsRef.current;
    const columnByID = new Map(columnsForStatus.map((column) => [column.column_id, column]));
    const statusColorByColumnID = new Map(columnsForStatus.map((column) => [column.column_id, normalizeKanbanColumnItemColor(column.item_color)]));
    const nodeByID = new Map((getNodeRelationshipGraphSnapshot(apiBase, companyID).nodes ?? []).map((node) => [node.node_id, node]));
    const seenNodeIDs = new Set<string>();
    for (const card of statusCards) {
      if (seenNodeIDs.has(card.node_id)) continue;
      seenNodeIDs.add(card.node_id);
      const node = nodeByID.get(card.node_id);
      if (!node) continue;
      const column = columnByID.get(card.column_id);
      const status = card.is_issue ? "Issue" : (column?.title.trim() || "Unknown");
      const statusColor = getKanbanConditionalColor(card, statusColorByColumnID);
      invalidateNodeRecordStoreCaches(apiBase, companyID, card.node_id);
      upsertNodeRelationshipGraphNode(apiBase, companyID, { ...node, status, status_color: statusColor });
    }
  }, [apiBase, companyID]);

  const upsertBoardInList = useCallback((board: KanbanBoard) => {
    const next = sortKanbanBoards([
      ...boardsRef.current.filter((item) => item.board_id !== board.board_id),
      board,
    ]);
    boardsRef.current = next;
    setBoards(next);
  }, []);

  const invalidateArenaViewForBoard = useCallback((streamBoardID: string, logicGateID = "") => {
    const cleanLogicGateID = logicGateID.trim() || logicGateIDFromKanbanBoardID(streamBoardID);
    if (cleanLogicGateID) invalidateLogicGateArenaViewCache(apiBase, companyID, cleanLogicGateID);
  }, [apiBase, companyID]);

  const removeBoardFromList = useCallback((deletedBoardID: string) => {
    if (!deletedBoardID) return;
    invalidateKanbanBoardListCache(apiBase, companyID);
    invalidateArenaViewForBoard(deletedBoardID);
    invalidateKanbanBoardContentsCache(apiBase, companyID, deletedBoardID);
    const next = sortKanbanBoards(boardsRef.current.filter((board) => board.board_id !== deletedBoardID));
    boardsRef.current = next;
    setBoards(next);
    setExplorerFolderItems((previous) => previous.filter((item) => item.item_type !== "kanban" || item.item_id !== deletedBoardID));
    if (activeBoardIDRef.current === deletedBoardID) {
      setSelectedCardIDs(new Set());
      setSelectionAnchorCardID("");
      setHighlightedEntity(null);
      setActiveLogicGateID("");
      setActiveLogicGateLabel("");
      setNodeEditorOverlay(null);
      setActiveBoardID(next[0]?.board_id ?? frameBoardIDRef.current);
    }
  }, [apiBase, companyID, invalidateArenaViewForBoard]);

  const loadLogicGateArenaView = useCallback((logicGateID: string, expectedBoardID: string) => {
    if (!logicGateID || !expectedBoardID) return;
    setLoading(!hasKanbanBoardContentsCache(apiBase, companyID, expectedBoardID));
    void getLogicGateArenaView(apiBase, companyID, logicGateID)
      .then((view) => {
        if (activeBoardIDRef.current !== expectedBoardID) return;
        upsertBoardInList(view.board);
        const nextColumns = sortColumns(view.columns ?? []);
        const nextCards = view.cards ?? [];
        setColumns(nextColumns);
        setCards(nextCards);
        primeKanbanBoardContentsCache(apiBase, companyID, view.board.board_id, { columns: nextColumns, cards: nextCards });
        setError("");
        setLoading(false);
      })
      .catch(() => {
        if (activeBoardIDRef.current !== expectedBoardID) return;
        setError("Logic gate arena API unavailable");
        setLoading(false);
      });
  }, [apiBase, companyID, upsertBoardInList]);

  useEffect(() => {
    if (!arenaMode) return;
    const logicGateID = forcedLogicGateID.trim();
    if (!logicGateID) {
      if (activeLogicGateID) {
        setActiveLogicGateID("");
        setActiveLogicGateLabel("");
      }
      return;
    }
    const nextBoardID = logicGateKanbanBoardID(logicGateID);
    if (activeBoardIDRef.current === nextBoardID && activeLogicGateID === logicGateID) return;
    activeBoardIDRef.current = nextBoardID;
    setSelectedCardIDs(new Set());
    setSelectionAnchorCardID("");
    setHighlightedEntity(null);
    setActiveLogicGateID(logicGateID);
    setActiveLogicGateLabel(forcedLogicGateLabel.trim() || "Logic Gate Kanban");
    setNodeEditorOverlay(null);
    setActiveBoardID(nextBoardID);
    const cachedBoard = boardsRef.current.find((board) => board.board_id === nextBoardID || board.logic_gate_id === logicGateID);
    if (cachedBoard) upsertBoardInList(cachedBoard);
    loadLogicGateArenaView(logicGateID, nextBoardID);
  }, [activeLogicGateID, arenaMode, forcedLogicGateID, forcedLogicGateLabel, loadLogicGateArenaView, upsertBoardInList]);

  const refreshBoards = useCallback(async () => {
    setBoardsLoading(true);
    try {
      const [nextBoards, folderPayload, folderItemPayload] = await Promise.all([
        listKanbanBoards(apiBase, companyID, 200),
        fetch(`${apiBase}/v1/company-explorer/folders?company_id=${encodeURIComponent(companyID)}`),
        fetch(`${apiBase}/v1/company-explorer/folder-items?company_id=${encodeURIComponent(companyID)}&item_type=kanban`),
      ]);
      const sortedBoards = sortKanbanBoards(nextBoards);
      boardsRef.current = sortedBoards;
      setBoards(sortedBoards);
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
      upsertBoardInList(saved);
      window.dispatchEvent(new CustomEvent<KanbanBoardsUpdatedDetail>(EVENT_KANBAN_BOARDS_UPDATED, { detail: { companyID, board: saved } }));
    } catch {
      setError("Kanban board save failed");
    }
  }, [activeBoard?.title, apiBase, boardID, companyID, upsertBoardInList]);

  const createNewBoardView = useCallback(async () => {
    setError("");
    try {
      const created = await createKanbanBoard(apiBase, companyID, "New Kanban board");
      upsertBoardInList(created);
      setSelectedCardIDs(new Set());
      setSelectionAnchorCardID("");
      setHighlightedEntity(null);
      setActiveLogicGateID("");
      setActiveLogicGateLabel("");
      setNodeEditorOverlay(null);
      lastLocalBoardSelectionChangedAtRef.current = Date.now();
      setActiveBoardID(created.board_id);
      setAllBoardsOpen(false);
      publishKanbanBoardSelectionToLinkedFrames(companyID, frameID, created.board_id, getKanbanBoardDisplayTitle(created));
      window.dispatchEvent(new CustomEvent<KanbanBoardsUpdatedDetail>(EVENT_KANBAN_BOARDS_UPDATED, { detail: { companyID, board: created } }));
    } catch {
      setError("Kanban board create failed");
    }
  }, [apiBase, companyID, frameID, upsertBoardInList]);

  const commitBoardTitle = useCallback(async (title: string) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setEditingBoardTitle(false);
      return;
    }
    const optimisticBoards = boardsRef.current.map((board) => (board.board_id === boardID ? { ...board, title: cleanTitle } : board));
    boardsRef.current = optimisticBoards;
    setBoards(optimisticBoards);
    setError("");
    try {
      const saved = activeBoard
        ? await updateKanbanBoard(apiBase, companyID, boardID, cleanTitle)
        : await createKanbanBoard(apiBase, companyID, cleanTitle, boardID);
      upsertBoardInList(saved);
      window.dispatchEvent(new CustomEvent<KanbanBoardsUpdatedDetail>(EVENT_KANBAN_BOARDS_UPDATED, { detail: { companyID, board: saved } }));
      setEditingBoardTitle(false);
    } catch {
      setError("Kanban board rename failed");
      setEditingBoardTitle(false);
      void refreshBoards();
    }
  }, [activeBoard, apiBase, boardID, companyID, refreshBoards, upsertBoardInList]);

  const clearCardSelection = useCallback(() => {
    setSelectedCardIDs(new Set());
    setSelectionAnchorCardID("");
  }, []);

  const refreshBoard = useCallback(async (requestedBoardIDOverride?: string) => {
    const requestID = boardRefreshRequestRef.current + 1;
    boardRefreshRequestRef.current = requestID;
    const requestedBoardID = requestedBoardIDOverride?.trim() || boardID;
    setLoading(!hasKanbanBoardContentsCache(apiBase, companyID, requestedBoardID));
    setError("");
    try {
      // The UI renders a bounded first window. Headless agents should page by
      // column through the cards API instead of loading company-scale boards.
      const { columns: nextColumns, cards: nextCards } = await getKanbanBoardContentsSingleFlight(apiBase, companyID, requestedBoardID, 500);
      if (boardRefreshRequestRef.current !== requestID || activeBoardIDRef.current !== requestedBoardID) return;
      setColumns(sortColumns(nextColumns));
      setCards(nextCards);
    } catch {
      if (boardRefreshRequestRef.current !== requestID) return;
      setError("Kanban board API unavailable");
    } finally {
      if (boardRefreshRequestRef.current === requestID) setLoading(false);
    }
  }, [apiBase, boardID, companyID]);

  useEffect(() => {
    refreshBoard();
  }, [refreshBoard]);

  useEffect(() => {
    primeKanbanBoardContentsCache(apiBase, companyID, boardID, { columns, cards });
  }, [apiBase, boardID, cards, columns, companyID]);

  useEffect(() => {
    refreshBoards();
  }, [refreshBoards]);

  useEffect(() => {
    const onKanbanBoardsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<KanbanBoardsUpdatedDetail>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      if (detail?.deletedBoardID) {
        removeBoardFromList(detail.deletedBoardID);
        return;
      }
      if (detail?.board) {
        invalidateKanbanBoardListCache(apiBase, companyID);
        invalidateArenaViewForBoard(detail.board.board_id, detail.board.logic_gate_id ?? "");
        upsertBoardInList(detail.board);
        return;
      }
      invalidateKanbanBoardListCache(apiBase, companyID);
      void refreshBoards();
    };
    window.addEventListener(EVENT_KANBAN_BOARDS_UPDATED, onKanbanBoardsUpdated);
    return () => window.removeEventListener(EVENT_KANBAN_BOARDS_UPDATED, onKanbanBoardsUpdated);
  }, [apiBase, companyID, invalidateArenaViewForBoard, refreshBoards, removeBoardFromList, upsertBoardInList]);

  useEffect(() => {
    return subscribeWorkspaceStream(apiBase, companyID, {
      onEvent(event) {
        if (event.event !== "workspace" || event.data.length === 0) return;
        try {
          const envelope = JSON.parse(event.data) as WorkspaceStreamEnvelope;
          if (envelope.company_id !== companyID) return;
          const data = envelope.data ?? {};
          if (envelope.type === "kanban_board_saved" || envelope.type === "kanban_board_updated") {
            const board = data.board as KanbanBoard | undefined;
            if (!board || typeof board.board_id !== "string") return;
            invalidateKanbanBoardListCache(apiBase, companyID);
            invalidateArenaViewForBoard(board.board_id, board.logic_gate_id ?? "");
            upsertBoardInList(board);
            return;
          }
          if (envelope.type === "kanban_board_deleted") {
            const boardID = typeof data.board_id === "string" ? data.board_id : "";
            if (boardID) removeBoardFromList(boardID);
            return;
          }
          if (envelope.type === "logic_gate_updated") {
            const logicGate = data.logic_gate as { logic_gate_id?: unknown; header?: unknown } | undefined;
            const logicGateID = typeof logicGate?.logic_gate_id === "string" ? logicGate.logic_gate_id : (typeof data.logic_gate_id === "string" ? data.logic_gate_id : "");
            if (!logicGateID) return;
            invalidateKanbanBoardListCache(apiBase, companyID);
            invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
            const boardID = logicGateKanbanBoardID(logicGateID);
            const title = typeof logicGate?.header === "string" && logicGate.header.trim() ? logicGate.header.trim() : boardID;
            const nextBoards = boardsRef.current.map((board) => (board.board_id === boardID ? { ...board, title, updated_timestamp: new Date().toISOString() } : board));
            boardsRef.current = nextBoards;
            setBoards(nextBoards);
            if (activeBoardIDRef.current === boardID) setActiveLogicGateLabel(title);
            return;
          }
          if (envelope.type === "logic_gate_deleted") {
            const logicGateID = typeof data.logic_gate_id === "string" ? data.logic_gate_id : "";
            if (logicGateID) {
              invalidateKanbanBoardListCache(apiBase, companyID);
              invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
              removeBoardFromList(logicGateKanbanBoardID(logicGateID));
            }
            return;
          }
          if (envelope.type === "kanban_column_created" || envelope.type === "kanban_column_updated") {
            const streamBoardID = typeof data.board_id === "string" ? data.board_id : "";
            const column = data.column as KanbanColumn | undefined;
            if (!streamBoardID) return;
            invalidateArenaViewForBoard(streamBoardID);
            invalidateKanbanBoardContentsCache(apiBase, companyID, streamBoardID);
            if (streamBoardID !== activeBoardIDRef.current || !column?.column_id) return;
            const nextColumns = sortColumns([...columnsRef.current.filter((item) => item.column_id !== column.column_id), column]);
            columnsRef.current = nextColumns;
            setColumns(nextColumns);
            syncNodeStatusesFromCards(cardsRef.current.filter((card) => card.column_id === column.column_id), nextColumns);
            return;
          }
          if (envelope.type === "kanban_column_deleted") {
            const streamBoardID = typeof data.board_id === "string" ? data.board_id : "";
            const columnID = typeof data.column_id === "string" ? data.column_id : "";
            if (!streamBoardID || !columnID) return;
            invalidateArenaViewForBoard(streamBoardID);
            invalidateKanbanBoardContentsCache(apiBase, companyID, streamBoardID);
            if (streamBoardID !== activeBoardIDRef.current) return;
            const nextColumns = columnsRef.current.filter((column) => column.column_id !== columnID);
            const nextCards = cardsRef.current.filter((card) => card.column_id !== columnID);
            columnsRef.current = nextColumns;
            cardsRef.current = nextCards;
            setColumns(nextColumns);
            setCards(nextCards);
            return;
          }
          if (envelope.type === "kanban_card_upserted" || envelope.type === "kanban_card_moved") {
            const streamBoardID = typeof data.board_id === "string" ? data.board_id : "";
            const card = data.card as KanbanCard | undefined;
            if (!streamBoardID) return;
            invalidateArenaViewForBoard(streamBoardID, card?.logic_gate_id ?? "");
            invalidateKanbanBoardContentsCache(apiBase, companyID, streamBoardID);
            if (streamBoardID !== activeBoardIDRef.current || !card?.card_id) return;
            const nextCards = [...cardsRef.current.filter((item) => item.card_id !== card.card_id), card];
            cardsRef.current = nextCards;
            setCards(nextCards);
            syncNodeStatusesFromCards([card]);
            return;
          }
          if (envelope.type === "kanban_card_deleted") {
            const streamBoardID = typeof data.board_id === "string" ? data.board_id : "";
            const cardID = typeof data.card_id === "string" ? data.card_id : "";
            if (!streamBoardID || !cardID) return;
            invalidateArenaViewForBoard(streamBoardID);
            invalidateKanbanBoardContentsCache(apiBase, companyID, streamBoardID);
            if (streamBoardID !== activeBoardIDRef.current) return;
            const nextCards = cardsRef.current.filter((card) => card.card_id !== cardID);
            cardsRef.current = nextCards;
            setCards(nextCards);
            setSelectedCardIDs((previous) => new Set(Array.from(previous).filter((selectedCardID) => selectedCardID !== cardID)));
            setSelectionAnchorCardID((current) => current === cardID ? "" : current);
            return;
          }
          if (envelope.type === "node_updated") {
            const node = data.node as NodeRecord | undefined;
            const nodeID = typeof node?.node_id === "string" ? node.node_id : (typeof data.node_id === "string" ? data.node_id : "");
            if (!nodeID) return;
            if (node?.node_id && shouldRefreshKanbanBoardForNodeStatusChange({ node, columns: columnsRef.current, cards: cardsRef.current })) {
              const currentBoardID = activeBoardIDRef.current;
              invalidateArenaViewForBoard(currentBoardID);
              invalidateKanbanBoardContentsCache(apiBase, companyID, currentBoardID);
              void refreshBoard(currentBoardID);
            }
            return;
          }
          if (envelope.type === "node_deleted") {
            const nodeID = typeof data.node_id === "string" ? data.node_id : "";
            if (!nodeID) return;
            const currentBoardID = activeBoardIDRef.current;
            invalidateArenaViewForBoard(currentBoardID);
            invalidateKanbanBoardContentsCache(apiBase, companyID, currentBoardID);
            const removedCardIDs = new Set(cardsRef.current.filter((card) => card.node_id === nodeID).map((card) => card.card_id));
            const nextCards = cardsRef.current.filter((card) => card.node_id !== nodeID);
            cardsRef.current = nextCards;
            setCards(nextCards);
            setSelectedCardIDs((previous) => {
              return new Set(Array.from(previous).filter((selectedCardID) => !removedCardIDs.has(selectedCardID)));
            });
            setSelectionAnchorCardID((current) => (removedCardIDs.has(current) ? "" : current));
            setHighlightedEntity((current) => (current?.nodeID === nodeID ? null : current));
            setNodeEditorOverlay((current) => (current?.nodeID === nodeID ? null : current));
            return;
          }
          if (envelope.type === "company_explorer_folder_item_assigned") {
            const folderItem = data.folder_item as CompanyExplorerFolderItem | undefined;
            if (!folderItem || folderItem.item_type !== "kanban") return;
            setExplorerFolderItems((previous) => previous.some((item) => item.item_type === "kanban" && item.item_id === folderItem.item_id)
              ? previous.map((item) => (item.item_type === "kanban" && item.item_id === folderItem.item_id ? folderItem : item))
              : [...previous, folderItem]);
            return;
          }
          if (envelope.type === "company_explorer_folder_item_removed") {
            const itemType = typeof data.item_type === "string" ? data.item_type : "";
            const itemID = typeof data.item_id === "string" ? data.item_id : "";
            if (itemType === "kanban" && itemID) {
              setExplorerFolderItems((previous) => previous.filter((item) => item.item_type !== "kanban" || item.item_id !== itemID));
            }
          }
        } catch {
          // The list can still be manually refreshed from the header.
        }
      },
    });
  }, [apiBase, companyID, invalidateArenaViewForBoard, refreshBoard, removeBoardFromList, syncNodeStatusesFromCards, upsertBoardInList]);

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
    const applyNodeGraphChange = () => {
      setNodeGraphRevision((revision) => revision + 1);
      syncCardTitlesFromNodeGraph();
    };
    applyNodeGraphChange();
    return subscribeNodeRelationshipGraph(apiBase, companyID, applyNodeGraphChange);
  }, [apiBase, companyID, syncCardTitlesFromNodeGraph]);

  useEffect(() => {
    const applyLiveSelection = (selection: LiveSelectionChange) => {
      if (selection.companyID !== companyID || selection.sourceFrameID === frameID) return;
      if (selection.entityKind === "kanban" && selection.entityID.trim()) {
        if (lastLocalBoardSelectionChangedAtRef.current > 0 && selection.changedAt > 0 && selection.changedAt < lastLocalBoardSelectionChangedAtRef.current) return;
        const logicGateID = logicGateIDFromKanbanBoardID(selection.entityID);
        activeBoardIDRef.current = selection.entityID.trim();
        setSelectedCardIDs(new Set());
        setSelectionAnchorCardID("");
        setHighlightedEntity(null);
        setActiveLogicGateID(logicGateID);
        setActiveLogicGateLabel(logicGateID ? (selection.label?.trim() || "Logic Gate Kanban") : "");
        setNodeEditorOverlay(null);
        setActiveBoardID(selection.entityID.trim());
        if (logicGateID) loadLogicGateArenaView(logicGateID, selection.entityID.trim());
        return;
      }
      if (selection.entityKind === "logic_gate" && selection.entityID.trim()) {
        if (lastLocalBoardSelectionChangedAtRef.current > 0 && selection.changedAt > 0 && selection.changedAt < lastLocalBoardSelectionChangedAtRef.current) return;
        const logicGateID = selection.entityID.trim();
        const nextBoardID = logicGateKanbanBoardID(logicGateID);
        activeBoardIDRef.current = nextBoardID;
        setSelectedCardIDs(new Set());
        setSelectionAnchorCardID("");
        setHighlightedEntity(null);
        setActiveLogicGateID(logicGateID);
        setActiveLogicGateLabel(selection.label?.trim() || "Logic Gate Kanban");
        setNodeEditorOverlay(null);
        setActiveBoardID(nextBoardID);
        const cachedBoard = boardsRef.current.find((board) => board.board_id === nextBoardID || board.logic_gate_id === logicGateID);
        if (cachedBoard) {
          upsertBoardInList(cachedBoard);
        }
        loadLogicGateArenaView(logicGateID, nextBoardID);
        return;
      }
      if (selection.entityKind === "node" && selection.entityID.trim()) {
        const selectedNodeIDs = new Set((selection.selectedEntityIDs?.length ? selection.selectedEntityIDs : [selection.entityID]).map((id) => id.trim()).filter(Boolean));
        const selectedCards = cardsRef.current.filter((card) => selectedNodeIDs.has(card.node_id));
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
  }, [companyID, frameID, loadLogicGateArenaView, upsertBoardInList]);

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
      const nextColumns = columns.map((column) => (column.column_id === columnID ? updated : column));
      setColumns(nextColumns);
      syncNodeStatusesFromCards(cards.filter((card) => card.column_id === columnID), nextColumns);
      setEditingColumnID("");
    } catch {
      setError("Column rename failed");
      refreshBoard();
    }
  }, [cards, columns, kanbanCommandContext, refreshBoard, syncNodeStatusesFromCards]);

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
        onOptimisticCards: (optimisticCards) => {
          setCards(optimisticCards);
          const movedIDs = new Set(cardIDs);
          syncNodeStatusesFromCards(optimisticCards.filter((card) => movedIDs.has(card.card_id)));
        },
      });
      const byID = new Map(result.persistedCards.map((card) => [card.card_id, card]));
      setCards((previous) => previous.map((card) => byID.get(card.card_id) ?? card));
      syncNodeStatusesFromCards(result.persistedCards);
    } catch {
      setError("Card reorder failed");
      refreshBoard();
    }
  }, [cards, kanbanCommandContext, refreshBoard, syncNodeStatusesFromCards]);

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

  const requestNodeDeleteFromCards = useCallback((cardIDs: string[]) => {
    const selectedCardIDSet = new Set(cardIDs);
    const nodeIDs = cards
      .filter((card) => selectedCardIDSet.has(card.card_id))
      .map((card) => card.node_id.trim())
      .filter(Boolean);
    const uniqueNodeIDs = Array.from(new Set(nodeIDs));
    if (uniqueNodeIDs.length === 0) return;
    setCardContextMenu(null);
    setColumnContextMenu(null);
    setDeleteNodeConfirmation({ nodeIDs: uniqueNodeIDs });
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

  const removeNodes = useCallback(async (nodeIDs: string[]) => {
    const ids = new Set(nodeIDs.map((nodeID) => nodeID.trim()).filter(Boolean));
    if (ids.size === 0) return;
    const previousCards = cards;
    const removedCardIDs = new Set(cards.filter((card) => ids.has(card.node_id)).map((card) => card.card_id));
    setCards((current) => current.filter((card) => !ids.has(card.node_id)));
    setSelectedCardIDs((current) => new Set(Array.from(current).filter((cardID) => !removedCardIDs.has(cardID))));
    setSelectionAnchorCardID((current) => (removedCardIDs.has(current) ? "" : current));
    setCardContextMenu(null);
    setError("");
    try {
      await Promise.all(Array.from(ids).map((nodeID) => requestJSON<{ status: string }>(`/v1/nodes/${encodeURIComponent(nodeID)}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      })));
      for (const nodeID of ids) {
        invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
        removeNodeRelationshipGraphNode(apiBase, companyID, nodeID);
      }
      invalidateKanbanBoardContentsCache(apiBase, companyID, boardID);
      setHighlightedEntity((current) => (current && ids.has(current.nodeID) ? null : current));
      setNodeEditorOverlay((current) => (current && ids.has(current.nodeID) ? null : current));
    } catch {
      setError("Node delete failed");
      setCards(previousCards);
    }
  }, [apiBase, boardID, cards, companyID, requestJSON]);

  const toggleCardIssue = useCallback(async (card: KanbanCard, isIssue: boolean) => {
    const previousCards = cards;
    setCards((current) => current.map((item) => (item.card_id === card.card_id ? { ...item, is_issue: isIssue } : item)));
    setCardContextMenu(null);
    setError("");
    try {
      const saved = await toggleKanbanCardIssueCommand({ context: kanbanCommandContext, card, isIssue });
      setCards((current) => current.map((item) => (item.card_id === saved.card_id ? saved : item)));
      syncNodeStatusesFromCards([saved]);
    } catch {
      setError("Issue status update failed");
      setCards(previousCards);
    }
  }, [cards, kanbanCommandContext, syncNodeStatusesFromCards]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (selectedCardIDs.size === 0 || isEditableKeyboardTarget(event.target)) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      // The shortcut only asks for confirmation. The API delete happens from
      // the modal Yes button so selection can never remove a card by itself.
      event.preventDefault();
      event.stopPropagation();
      if (deleteCardConfirmation || deleteNodeConfirmation) return;
      requestCardDelete(Array.from(selectedCardIDs));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [deleteCardConfirmation, deleteNodeConfirmation, requestCardDelete, selectedCardIDs]);

  const addEntitiesToColumn = useCallback(async (columnID: string, items: ExplorerEntityDragItem[]) => {
    try {
      const result = await addExplorerNodesToKanbanColumnCommand({
        context: kanbanCommandContext,
        cards,
        columnID,
        items,
        onOptimisticCards: (optimisticCards, nodeIDs) => {
          setCards((previous) => [...previous.filter((card) => !nodeIDs.has(card.node_id)), ...optimisticCards]);
          syncNodeStatusesFromCards(optimisticCards);
        },
      });
      if (result.savedCards.length === 0) return;
      setCards((previous) => [...previous.filter((card) => !result.optimisticCardIDs.has(card.card_id) && !result.nodeIDs.has(card.node_id)), ...result.savedCards]);
      syncNodeStatusesFromCards(result.savedCards);
    } catch {
      setError("Drop failed");
      refreshBoard();
    }
  }, [cards, kanbanCommandContext, refreshBoard, syncNodeStatusesFromCards]);

  const createNodeInColumn = useCallback(async (columnID: string) => {
    setError("");
    try {
      const node = await requestJSON<NodeRecord>("/v1/nodes", {
        method: "POST",
        body: JSON.stringify({ company_id: companyID, title: "new node" }),
      });
      upsertNodeRelationshipGraphNode(apiBase, companyID, node);
      const label = getNodeTitle(node) || node.node_id;
      const result = await addExplorerNodesToKanbanColumnCommand({
        context: kanbanCommandContext,
        cards,
        columnID,
        items: [{ nodeID: node.node_id, label }],
        onOptimisticCards: (optimisticCards, nodeIDs) => {
          setCards((previous) => [...previous.filter((card) => !nodeIDs.has(card.node_id)), ...optimisticCards]);
          syncNodeStatusesFromCards(optimisticCards);
        },
      });
      const createdCard = result.savedCards[0];
      if (!createdCard) return;
      setCards((previous) => [...previous.filter((card) => !result.optimisticCardIDs.has(card.card_id) && !result.nodeIDs.has(card.node_id)), ...result.savedCards]);
      syncNodeStatusesFromCards(result.savedCards);
      setSelectedCardIDs(new Set([createdCard.card_id]));
      setSelectionAnchorCardID(createdCard.card_id);
      setHighlightedEntity({ nodeID: createdCard.node_id });
      publishKanbanSelectionToLinkedFrames(companyID, frameID, createdCard.node_id, createdCard.node_title, [createdCard.node_id]);
      setNodeEditorOverlay({ nodeID: createdCard.node_id, nodeTitle: createdCard.node_title });
    } catch {
      setError("Node create failed");
      refreshBoard();
    }
  }, [apiBase, cards, companyID, frameID, kanbanCommandContext, refreshBoard, requestJSON, syncNodeStatusesFromCards]);

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
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setNodeEditorOverlay({ nodeID: card.node_id, nodeTitle: card.node_title });
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
  const contextCardSelectionIDs = contextCard
    ? (selectedCardIDs.has(contextCard.card_id) ? Array.from(selectedCardIDs) : [contextCard.card_id])
    : [];

  const selectArenaYGroupBy = useCallback((field: KanbanGroupField) => {
    setArenaYGroupBy(field);
    setArenaYSortDirection(getDefaultKanbanYAxisSortDirection(field));
  }, []);

  const renderArenaGroupSelect = (
    value: KanbanGroupField,
    onChange: (value: KanbanGroupField) => void,
    label: "X-Axis" | "Y-axis",
    axis: "x" | "y",
    sortDirection: KanbanGroupSortDirection,
    onToggleSortDirection: () => void,
    layout: "inline" | "compact" = "inline",
  ) => {
    const selectedField = KANBAN_GROUP_FIELDS.find((field) => field.value === value) ?? KANBAN_GROUP_FIELDS[0];
    const menuOpen = arenaGroupMenuOpen === axis;
    const groupMenuAccent = theme === "light" ? "rgb(255, 136, 32)" : "rgb(255, 136, 32)";
    const selectedBackground = isDark ? "rgba(255, 136, 32, 0.18)" : "rgba(255, 136, 32, 0.22)";
    const hoveredBackground = "rgba(255, 136, 32, 0.14)";
    const menuText = "#24120a";
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
          onClick={() => setArenaGroupMenuOpen((open) => (open === axis ? null : axis))}
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
            boxShadow: menuOpen ? `0 0 0 2px rgba(255, 136, 32, 0.14)` : "none",
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
              border: `1px solid rgba(255, 136, 32, 0.34)`,
              borderRadius: 6,
              background: "#ffffff",
              boxShadow: "0 12px 28px rgba(0,16,20,0.18)",
              color: menuText,
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
                    setArenaGroupMenuOpen(null);
                  }}
                  style={{
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) 16px",
                    alignItems: "center",
                    gap: 8,
                    border: "none",
                    borderRadius: 4,
                    background: selected ? selectedBackground : "transparent",
                    color: selected ? groupMenuAccent : menuText,
                    font: "inherit",
                    fontSize: 11,
                    fontWeight: selected ? 600 : 500,
                    padding: "7px 8px",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={(event) => {
                    if (!selected) event.currentTarget.style.background = hoveredBackground;
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = selected ? selectedBackground : "transparent";
                  }}
                >
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{field.label}</span>
                  <span aria-hidden="true" style={{ display: "grid", placeItems: "center", color: groupMenuAccent }}>
                    {selected ? <KanbanCheckIcon color={groupMenuAccent} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </span>
    );

    if (compact) {
      return (
        <label style={{ width: "100%", minWidth: 0, display: "grid", gridTemplateRows: "20px 28px", alignItems: "end", gap: 4, fontSize: 11, fontWeight: 500 }}>
          <span style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: subtext }}>{label}</span>
            {sortButton}
          </span>
          {selectButton}
        </label>
      );
    }

    return (
      <label style={{ display: "inline-grid", gridTemplateColumns: "max-content minmax(136px, 190px) 56px", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 500 }}>
        <span style={{ color: subtext }}>{label}</span>
        {selectButton}
        {sortButton}
      </label>
    );
  };

  const renderArenaGroupingControls = () => {
    return (
      <div ref={arenaGroupControlsRef} data-arena-group-controls="true" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: arenaGroupingOpen ? 8 : 10 }}>
        <button
          type="button"
          onClick={() => setArenaGroupingOpen((open) => !open)}
          style={{ justifySelf: "start", height: 28, border: `1px solid ${arenaGroupingOpen ? accent : line}`, borderRadius: 6, background: arenaGroupingOpen ? `${accent}22` : cardBackground, color: arenaGroupingOpen ? accent : text, fontSize: 11, fontWeight: 500, cursor: "pointer", padding: "0 10px" }}
        >
          Group
        </button>
      </div>
    );
  };

  const renderArenaGroupedBoard = () => {
    const groupColumns = arenaGroupedBoard.columns;
    const groupRows = arenaGroupedBoard.rows;
    const columnCount = groupColumns.length;
    const rowCount = groupRows.length;
    if (columnCount === 0 || rowCount === 0) {
      return (
        <div style={{ minHeight: KANBAN_DEFAULT_COLUMN_HEIGHT_PX, display: "grid", placeItems: "center", color: subtext, fontSize: 12, fontWeight: 500, opacity: loading ? 0.72 : 1 }}>
          No grouped cards
        </div>
      );
    }
    const groupFrameBackground = ARENA_GROUP_FRAME_BACKGROUND;
    const glassBorder = isDark ? ARENA_GROUP_GLASS_BORDER_DARK : ARENA_GROUP_GLASS_BORDER_LIGHT;
    const groupFrameShadow = ARENA_GROUP_FRAME_SHADOW;
    const groupFrameText = "#24120a";
    const gridWidth = ARENA_GROUP_ROW_LABEL_WIDTH_PX + (columnCount * ARENA_GROUP_COLUMN_WIDTH_PX) + (columnCount * 8);
    const xAxisControlColumn = Math.min(columnCount, 2) + 1;
    const axisControlCellStyle: React.CSSProperties = {
      minWidth: 0,
      minHeight: 56,
      display: "grid",
      alignItems: "end",
      border: `1px solid ${glassBorder}`,
      background: groupFrameBackground,
      boxShadow: groupFrameShadow,
      padding: 6,
      zIndex: 3,
    };
    return (
      <div
        style={{
          minWidth: gridWidth,
          display: "grid",
          gridTemplateColumns: `${ARENA_GROUP_ROW_LABEL_WIDTH_PX}px repeat(${columnCount}, ${ARENA_GROUP_COLUMN_WIDTH_PX}px)`,
          gridTemplateRows: `minmax(56px, auto) minmax(56px, auto) repeat(${rowCount}, minmax(${ARENA_GROUP_MIN_CELL_HEIGHT_PX}px, auto))`,
          columnGap: 8,
          rowGap: 0,
          alignItems: "stretch",
          paddingBottom: 16,
          opacity: loading && columns.length === 0 && cards.length === 0 ? 0.72 : 1,
        }}
      >
        <div data-arena-group-controls="true" style={{ ...axisControlCellStyle, gridColumn: 1, gridRow: 2 }}>
          {renderArenaGroupSelect(arenaYGroupBy, selectArenaYGroupBy, "Y-axis", "y", arenaYSortDirection, () => setArenaYSortDirection((direction) => (direction === "asc" ? "desc" : "asc")), "compact")}
        </div>
        <div data-arena-group-controls="true" style={{ ...axisControlCellStyle, gridColumn: xAxisControlColumn, gridRow: 1 }}>
          {renderArenaGroupSelect(arenaXGroupBy, setArenaXGroupBy, "X-Axis", "x", arenaXSortDirection, () => setArenaXSortDirection((direction) => (direction === "asc" ? "desc" : "asc")), "compact")}
        </div>
        {groupColumns.map((groupColumn, columnIndex) => {
          const cardCount = groupColumn.cells.reduce((sum, cell) => sum + cell.cards.length, 0);
          return (
            <div
              key={groupColumn.key}
              style={{
                gridColumn: columnIndex + 2,
                gridRow: 2,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                border: `1px solid ${glassBorder}`,
                borderBottom: "none",
                borderTopLeftRadius: 8,
                borderTopRightRadius: 8,
                background: groupFrameBackground,
                color: groupFrameText,
                boxShadow: groupFrameShadow,
                padding: "0 9px",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span style={{ minWidth: 0, overflowWrap: "anywhere", whiteSpace: "normal", lineHeight: 1.2 }}>{groupColumn.label}</span>
              <span style={{ flexShrink: 0, color: subtext }}>{cardCount}</span>
            </div>
          );
        })}
        {groupRows.map((row, rowIndex) => (
          <div
            key={row.key}
            style={{
              gridColumn: 1,
              gridRow: rowIndex + 3,
              minHeight: ARENA_GROUP_MIN_CELL_HEIGHT_PX,
              minWidth: 0,
              display: "grid",
              alignItems: "start",
              borderTop: `1px solid ${line}`,
              color: subtext,
              fontSize: 10,
              fontWeight: 500,
              lineHeight: 1.2,
              padding: "9px 8px 9px 0",
              textAlign: "right",
              overflowWrap: "anywhere",
            }}
          >
            {row.label}
          </div>
        ))}
        {groupColumns.map((groupColumn, columnIndex) => groupColumn.cells.map((cell, rowIndex) => (
          <div
            key={`${groupColumn.key}:${cell.rowKey}`}
            style={{
              gridColumn: columnIndex + 2,
              gridRow: rowIndex + 3,
              minHeight: ARENA_GROUP_MIN_CELL_HEIGHT_PX,
              display: "grid",
              alignContent: "start",
              gap: 8,
              border: `1px solid ${glassBorder}`,
              borderTop: rowIndex === 0 ? `1px solid ${glassBorder}` : "none",
              borderBottomLeftRadius: rowIndex === rowCount - 1 ? 8 : 0,
              borderBottomRightRadius: rowIndex === rowCount - 1 ? 8 : 0,
              background: groupFrameBackground,
              boxShadow: groupFrameShadow,
              padding: 8,
            }}
          >
            {cell.cards.map((card) => renderCard(card))}
          </div>
        )))}
      </div>
    );
  };

  return (
    <div
      ref={boardRootRef}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      style={{ position: "relative", width: "100%", height: "100%", boxSizing: "border-box", paddingTop: topClearancePx, background: surface, color: text, overflow: "hidden" }}
    >
      <div style={{ position: "absolute", top: topClearancePx - 1, left: 0, right: 0, borderBottom: `1px solid ${line}`, pointerEvents: "none" }} />
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
        boardTitleReadOnly={!!activeBoard?.logic_gate_id || !!activeLogicGateID}
        headerLeftPaddingPx={boardHeaderLeftPaddingPx}
        topClearancePx={topClearancePx}
        onSetBoardTitleDraft={setBoardTitleDraft}
        onSetBoardSearchQuery={setBoardSearchQuery}
        onSetEditingBoardTitle={setEditingBoardTitle}
        onToggleAllBoards={() => {
          setAllBoardsOpen((open) => !open);
          void refreshBoards();
        }}
        onCloseAllBoards={() => {
          setAllBoardsOpen(false);
          setBoardSearchQuery("");
        }}
        onCommitBoardTitle={(title) => void commitBoardTitle(title)}
        onRefreshBoards={() => void refreshBoards()}
        onSaveCurrentBoardView={() => void saveCurrentBoardView()}
        onCreateNewBoardView={() => void createNewBoardView()}
        onSelectBoard={(nextBoardID) => {
          setSelectedCardIDs(new Set());
          setSelectionAnchorCardID("");
          setHighlightedEntity(null);
          setNodeEditorOverlay(null);
          lastLocalBoardSelectionChangedAtRef.current = Date.now();
          activeBoardIDRef.current = nextBoardID;
          setActiveBoardID(nextBoardID);
          setAllBoardsOpen(false);
          setBoardSearchQuery("");
          const selectedBoard = boardRows.find((board) => board.board_id === nextBoardID);
          const selectedLogicGateID = selectedBoard?.logic_gate_id ?? logicGateIDFromKanbanBoardID(nextBoardID);
          setActiveLogicGateID(selectedLogicGateID);
          setActiveLogicGateLabel(selectedLogicGateID && selectedBoard ? getKanbanBoardDisplayTitle(selectedBoard) : "");
          publishKanbanBoardSelectionToLinkedFrames(companyID, frameID, nextBoardID, selectedBoard ? getKanbanBoardDisplayTitle(selectedBoard) : nextBoardID);
          void refreshBoard(nextBoardID);
        }}
      />
      <div className="kanban-board-scroll" style={{ height: "100%", overflow: "auto", padding: arenaMode ? "8px 8px 14px 4px" : "12px 12px 14px", boxSizing: "border-box", ["--kanban-board-scroll-accent" as string]: theme === "light" ? "rgb(255, 136, 32)" : accent, ["--kanban-board-scroll-track" as string]: isDark ? "rgba(255,255,255,0.08)" : "rgba(255, 136, 32, 0.08)" }}>
        {error && <div style={{ marginBottom: 8, color: "#c62828", fontSize: 11, fontWeight: 700 }}>{error}</div>}
        {arenaMode && renderArenaGroupingControls()}
        {arenaMode && arenaGroupingOpen ? renderArenaGroupedBoard() : (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: KANBAN_DEFAULT_COLUMN_HEIGHT_PX + 18, paddingBottom: 16, width: arenaMode ? "100%" : undefined, opacity: loading && columns.length === 0 && cards.length === 0 ? 0.72 : 1 }}>
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
                onCreateNodeInColumn={(columnID) => void createNodeInColumn(columnID)}
                onDropColumn={onDropColumn}
                dataTransferIncludes={dataTransferIncludes}
                showCreateNodeButton={!arenaMode}
              />
            );
          })}
          {!arenaMode && <button
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
          </button>}
        </div>
        )}
      </div>
      {contextColumn && columnContextMenu && (
        <FrameRightClickMenu x={columnContextMenu.x} y={columnContextMenu.y} onClose={() => setColumnContextMenu(null)}>
          <button
            type="button"
            style={contextMenuButtonStyle}
            onClick={() => {
              setColumnContextMenu(null);
              void createNodeInColumn(contextColumn.column_id);
            }}
            {...contextMenuHoverHandlers}
          >
            Create new node
          </button>
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
            <span>Column color</span>
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
          {!arenaMode && (
            <button
              type="button"
              style={contextMenuButtonStyle}
              onClick={() => void toggleCardIssue(contextCard, !contextCard.is_issue)}
              {...contextMenuHoverHandlers}
            >
              {contextCard.is_issue ? "Clear Issue" : "Mark Issue"}
            </button>
          )}
          <button
            type="button"
            style={{ ...contextMenuButtonStyle, color: "#c62828" }}
            onClick={() => requestNodeDeleteFromCards(contextCardSelectionIDs)}
            {...contextMenuHoverHandlers}
          >
            Delete node
          </button>
          <button
            type="button"
            style={contextMenuButtonStyle}
            onClick={() => requestCardDelete(contextCardSelectionIDs)}
            {...contextMenuHoverHandlers}
          >
            Remove node from Kanban Board
          </button>
        </FrameRightClickMenu>
      )}
      {nodeEditorOverlay && (
        <div
          data-frame-interactive="true"
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            zIndex: 40,
            top: "6%",
            left: "50%",
            width: `${Math.round(nodeEditorOverlayRatio.width * 1000) / 10}%`,
            height: `${Math.round(nodeEditorOverlayRatio.height * 1000) / 10}%`,
            maxWidth: "calc(100% - 44px)",
            maxHeight: "calc(100% - 64px)",
            transform: "translateX(-50%)",
            minWidth: "min(420px, calc(100% - 44px))",
            minHeight: "min(320px, calc(100% - 64px))",
            border: "1px solid rgba(255, 136, 32, 0.54)",
            borderRadius: 16,
            background: "#ffffff",
            boxShadow: "0 18px 42px rgba(36, 18, 10, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.72)",
            overflow: "hidden",
            cursor: "default",
          }}
        >
          <button
            type="button"
            title="Close node editor"
            onClick={() => setNodeEditorOverlay(null)}
            style={{
              position: "absolute",
              top: 7,
              right: 8,
              zIndex: 8,
              width: 24,
              height: 24,
              border: "1px solid #8b0000",
              borderRadius: 4,
              background: "#ff1f1f",
              color: "#ffffff",
              fontSize: 16,
              fontWeight: 600,
              lineHeight: "20px",
              cursor: "pointer",
            }}
          >
            X
          </button>
          <EditorContent
            accent={accent}
            widgetId={`${frameID}:node-editor-overlay:${nodeEditorOverlay.nodeID}`}
            theme={theme}
            forcedEntityKind="node"
            forcedEntityID={nodeEditorOverlay.nodeID}
            forcedLabel={nodeEditorOverlay.nodeTitle}
          />
          {nodeEditorOverlayResizeHandles.map((handle) => (
            <span
              key={handle.key}
              aria-hidden="true"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                nodeEditorOverlayResizeRef.current = {
                  edges: handle.edges,
                  startX: event.clientX,
                  startY: event.clientY,
                  startWidth: (boardRootRef.current?.getBoundingClientRect().width ?? window.innerWidth) * nodeEditorOverlayRatio.width,
                  startHeight: (boardRootRef.current?.getBoundingClientRect().height ?? window.innerHeight) * nodeEditorOverlayRatio.height,
                  boardWidth: boardRootRef.current?.getBoundingClientRect().width ?? window.innerWidth,
                  boardHeight: boardRootRef.current?.getBoundingClientRect().height ?? window.innerHeight,
                };
              }}
              style={{
                position: "absolute",
                zIndex: 9,
                cursor: handle.cursor,
                ...handle.style,
              }}
            />
          ))}
        </div>
      )}
      {deleteNodeConfirmation && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center" }}>
          <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(255,136,32,0.45)", background: "rgba(255,255,255,0.95)", padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#111111" }}>
              Are you sure you want to delete {deleteNodeConfirmation.nodeIDs.length} node{deleteNodeConfirmation.nodeIDs.length === 1 ? "" : "s"}?
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.35, color: "#2e2e2e" }}>
              This deletes the underlying node data and removes its Kanban placements.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  void removeNodes(deleteNodeConfirmation.nodeIDs);
                  setDeleteNodeConfirmation(null);
                }}
                style={{ border: "1px solid rgba(255,136,32,0.45)", background: "#fff", cursor: "pointer", fontWeight: 700 }}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setDeleteNodeConfirmation(null)}
                style={{ border: "1px solid #ff3d7f", boxShadow: "inset 0 0 0 1px rgba(255,130,170,0.25), 0 0 10px rgba(255,61,127,0.18)", color: "#8b123f", background: "#fff", cursor: "pointer", fontWeight: 700 }}
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteCardConfirmation && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center" }}>
          <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(255,136,32,0.45)", background: "rgba(255,255,255,0.95)", padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#111111" }}>
              Are you sure you want to remove {deleteCardConfirmation.cardIDs.length} node{deleteCardConfirmation.cardIDs.length === 1 ? "" : "s"} from this Kanban Board?
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.35, color: "#2e2e2e" }}>
              The underlying node{deleteCardConfirmation.cardIDs.length === 1 ? "" : "s"} will continue to exist outside this board.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  void removeCards(deleteCardConfirmation.cardIDs);
                  setDeleteCardConfirmation(null);
                }}
                style={{ border: "1px solid rgba(255,136,32,0.45)", background: "#fff", cursor: "pointer", fontWeight: 700 }}
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
          <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(255,136,32,0.45)", background: "rgba(255,255,255,0.95)", padding: 12, display: "grid", gap: 10 }}>
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
                style={{ border: "1px solid rgba(255,136,32,0.45)", background: "#fff", cursor: "pointer", fontWeight: 700 }}
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
