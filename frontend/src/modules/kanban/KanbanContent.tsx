import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountFilterControl, useCompanyAccounts } from "../accounts/AccountFilterControl";
import { entityMatchesAccountFilter, setNodeAccountAssignments } from "../accounts/accountsApi";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import { EXPLORER_DRAG_MIME } from "../company-explorer/companyExplorerDragDrop";
import { listCompanyUsers } from "../communications/communicationsApi";
import { getNodeTitle, type NodeRecord } from "../node-map/shared";
import { getNodeRelationshipGraphSnapshot, removeNodeRelationshipGraphNode, subscribeNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../node-map/NodeRelationshipGraph";
import { invalidateNodeRecordStoreCaches } from "../node-map/NodeRecordStore";
import { subscribeRealtimeScope, type RealtimeProjectionDeltaMessage } from "../realtime/realtimeWebSocket";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../selectionCoordinator";
import { subscribeWorkspaceUserRealtime, workspaceRealtimeScope, type WorkspaceStreamGapSignal } from "../workspace/workspaceRealtime";
import {
  assignNodeToLogicGateStatus,
  createKanbanBoard,
  getLogicGateArenaView,
  invalidateKanbanBoardListCache,
  invalidateLogicGateArenaViewCache,
  listKanbanBoards,
  moveKanbanCard,
  moveLogicGateAssignment,
  setLogicGateAssignmentIssue,
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
  persistKanbanColumnLayoutCommand,
  reorderKanbanCardsCommand,
  reorderKanbanColumnsCommand,
  toggleKanbanCardIssueCommand,
  type KanbanCommandContext,
} from "./kanbanCommands";
import { KanbanArenaGroupedBoard, KanbanArenaGroupingControls, type ArenaGroupMenuID, type KanbanArenaGroupedCellContext } from "./KanbanArenaGrouping";
import { KanbanBoardSidebar } from "./KanbanBoardSidebar";
import { KanbanCardView } from "./KanbanCardView";
import { KanbanColumnView } from "./KanbanColumnView";
import { KanbanAccountAssignmentModal, KanbanContextMenus, KanbanDeleteConfirmations, KanbanNodeEditorOverlay } from "./KanbanOverlays";
import {
  applyKanbanProjectionEnvelope,
  beginKanbanProjectionFallback,
  finishKanbanProjectionFallback,
  nextKanbanProjectionCursor,
  seedKanbanProjectionVersions,
  type KanbanProjectionEnvelope,
  type KanbanProjectionFallbackReason,
} from "./kanbanProjectionDeltas";
import {
  EXPLORER_ENTITY_DRAG_MIME,
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  EVENT_KANBAN_BOARDS_UPDATED,
  KANBAN_ARENA_DEFAULT_COLUMN_HEIGHT_PX,
  KANBAN_CARD_DRAG_MIME,
  KANBAN_COLUMN_DRAG_MIME,
  KANBAN_DEFAULT_BOARD_TITLE,
  KANBAN_DEFAULT_COLUMN_HEIGHT_PX,
  KANBAN_MODULE_TOP_CLEARANCE_PX,
  attachStackedDragPreview,
  buildKanbanGroupedBoardLayout,
  buildKanbanCardSelectionUpdate,
  clampColumnHeight,
  clampColumnWidth,
  createClientUUIDv7,
  getKanbanBoardDisplayTitle,
  getKanbanColumnDisplayColor,
  getKanbanConditionalColor,
  getColumnWidth,
  getDefaultKanbanYAxisSortDirection,
  getOrderedKanbanCardIDs,
  groupCardsByColumn,
  hydrateKanbanCardsFromNodes,
  isKanbanBottomLaneColumn,
  isKanbanRequestedColumn,
  logicGateKanbanBoardID,
  logicGateIDFromKanbanBoardID,
  nextCardPosition,
  parseExplorerEntityDragItems,
  parseKanbanCardDragPayload,
  parseKanbanColumnDragPayload,
  resolveKanbanGroupDropAssignment,
  serializeExplorerEntityDragPayload,
  sortColumns,
  sortKanbanBoards,
  type KanbanBoard,
  type KanbanBoardContentsUpdatedDetail,
  type KanbanBoardsUpdatedDetail,
  type KanbanCard,
  type KanbanCardDropPlacement,
  type KanbanColumn,
  type KanbanColumnDropPlacement,
  type KanbanGroupField,
  type KanbanGroupSortDirection,
  type ExplorerEntityDragItem,
} from "./shared";

type StoredLogicGateColumnLayout = {
  width_px?: number;
  height_px?: number;
  item_color?: string;
};

type StoredLogicGateColumnLayouts = Record<string, StoredLogicGateColumnLayout>;

const KANBAN_COLUMN_BOTTOM_BUFFER_HEIGHT_PX = 180;
const KANBAN_ARENA_BACKLOG_MIN_COLUMN_HEIGHT_PX = 280;
const KANBAN_ARENA_ACCOUNT_FILTER_WIDTH_PX = 220;
const KANBAN_ARENA_TOP_CONTROL_HEIGHT_PX = 48;
const KANBAN_REQUESTED_ACCEPT_COLUMN_ID = "pending";
const KANBAN_REQUESTED_DECLINE_COLUMN_ID = "backlog";

function logicGateColumnLayoutStorageKey(companyID: string, boardID: string): string {
  return `mango:kanban:logic-gate-column-layout:v1:${encodeURIComponent(companyID)}:${encodeURIComponent(boardID)}`;
}

function readStoredLogicGateColumnLayouts(companyID: string, boardID: string): StoredLogicGateColumnLayouts {
  if (typeof window === "undefined") return {};
  const cleanCompanyID = companyID.trim();
  const cleanBoardID = boardID.trim();
  if (!cleanCompanyID || !cleanBoardID) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(logicGateColumnLayoutStorageKey(cleanCompanyID, cleanBoardID)) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as StoredLogicGateColumnLayouts : {};
  } catch {
    return {};
  }
}

function writeStoredLogicGateColumnLayout(companyID: string, boardID: string, columnID: string, patch: StoredLogicGateColumnLayout): void {
  if (typeof window === "undefined") return;
  const cleanCompanyID = companyID.trim();
  const cleanBoardID = boardID.trim();
  const cleanColumnID = columnID.trim();
  if (!cleanCompanyID || !cleanBoardID || !cleanColumnID) return;
  const layouts = readStoredLogicGateColumnLayouts(cleanCompanyID, cleanBoardID);
  const current = layouts[cleanColumnID] ?? {};
  const next: StoredLogicGateColumnLayout = { ...current };
  if (patch.width_px !== undefined && Number.isFinite(patch.width_px)) {
    next.width_px = Math.max(1, Math.round(patch.width_px));
  }
  if (patch.height_px !== undefined && Number.isFinite(patch.height_px)) {
    next.height_px = clampColumnHeight(patch.height_px);
  }
  if (patch.item_color !== undefined) {
    const cleanColor = patch.item_color.trim();
    if (cleanColor) next.item_color = cleanColor;
  }
  layouts[cleanColumnID] = next;
  try {
    window.localStorage.setItem(logicGateColumnLayoutStorageKey(cleanCompanyID, cleanBoardID), JSON.stringify(layouts));
  } catch {
    // Local layout is a convenience overlay; the board should keep working if storage is unavailable.
  }
}

function applyStoredLogicGateColumnLayouts(companyID: string, boardID: string, columns: KanbanColumn[]): KanbanColumn[] {
  const layouts = readStoredLogicGateColumnLayouts(companyID, boardID);
  if (Object.keys(layouts).length === 0) return columns;
  return columns.map((column) => {
    const layout = layouts[column.column_id];
    if (!layout) return column;
    const widthPx = layout.width_px !== undefined && Number.isFinite(layout.width_px) ? Math.max(1, Math.round(layout.width_px)) : column.width_px;
    const heightPx = layout.height_px !== undefined && Number.isFinite(layout.height_px) ? clampColumnHeight(layout.height_px) : column.height_px;
    const itemColor = layout.item_color?.trim() || column.item_color;
    if (widthPx === column.width_px && heightPx === column.height_px && itemColor === column.item_color) return column;
    return { ...column, width_px: widthPx, height_px: heightPx, item_color: itemColor };
  });
}
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { requestAppDockTab } from "../../app/appDockTabs";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { requestAppSidebarPin } from "../../app/sidebarPins";
import { createRequestJSON } from "../api/requestJSON";
import { humanLabelOrFallback } from "../entityLabels.js";

import {
  cardDropPlacement,
  clampNodeEditorOverlayRatio,
  contextMenuButtonStyle,
  contextMenuHoverHandlers,
  dataTransferIncludes,
  formatKanbanLoadError,
  getNodeEditorOverlayMinLeftPx,
  isEditableKeyboardTarget,
  KANBAN_EDGE_FRAME,
  KANBAN_PANEL_BACKGROUND,
  KANBAN_PANEL_SHADOW,
  KANBAN_SOFT_BORDER,
  KANBAN_SURFACE,
  publishKanbanBoardSelectionToLinkedFrames,
  publishKanbanSelectionToLinkedFrames,
  readLinkedExplorerSelection,
  readNodeEditorOverlayRatio,
  storeNodeEditorOverlayRatio,
  type ColumnResizeState,
  type CompanyUser,
  type HighlightedEntity,
  type KanbanContentProps,
  type NodeEditorOverlayRatio,
  type NodeEditorOverlayState,
  type OverlayResizeState,
  type WorkspaceStreamEnvelope,
} from "./KanbanContentModel";

const KANBAN_NODE_PRIORITY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "1  URGENT(<1hr)" },
  { value: 2, label: "2  By end of day" },
  { value: 3, label: "3  Tomorrow" },
  { value: 4, label: "4  Sprint (1 week)" },
  { value: 5, label: "5  Later (low priority)" },
];

function sameNodeEditorOverlayRatio(a: NodeEditorOverlayRatio, b: NodeEditorOverlayRatio): boolean {
  return Math.abs(a.left - b.left) < 0.0001
    && Math.abs(a.top - b.top) < 0.0001
    && Math.abs(a.width - b.width) < 0.0001
    && Math.abs(a.height - b.height) < 0.0001;
}

type KanbanPriorityMenuState = {
  x: number;
  y: number;
  columnID: string;
  mode: "create" | "drop";
  items: ExplorerEntityDragItem[];
};

type KanbanArenaCellContextMenuState = {
  x: number;
  y: number;
  columnKey: string;
  rowKey: string;
};

type KanbanAccountAssignmentState = {
  cardID: string;
  nodeID: string;
  nodeTitle: string;
  accountIDs: string[];
};

function logicGateIDForKanbanCard(card: Pick<KanbanCard, "logic_gate_id" | "board_id">, fallbackBoardID: string): string {
  return (card.logic_gate_id ?? "").trim() || logicGateIDFromKanbanBoardID(card.board_id || fallbackBoardID);
}

export const KanbanContent: React.FC<KanbanContentProps> = ({
  accent,
  widgetId,
  theme = "mango",
  arenaMode = false,
  forcedLogicGateID = "",
  forcedLogicGateLabel = "",
  forcedHighlightedNodeID = "",
  forcedOpenNodeID = "",
  controlForcedOpenNode = false,
  suppressLegacyWorkspaceStream = false,
  onCollapseArenaToTab,
  onNodeEditorOverlayOpen,
  onNodeEditorOverlayClose,
}) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = getActiveCompanyID();
  const frameBoardID = widgetId?.trim() ? widgetId : "global-kanban";
  const initialArenaLogicGateID = arenaMode ? forcedLogicGateID.trim() : "";
  const initialBoardID = initialArenaLogicGateID ? logicGateKanbanBoardID(initialArenaLogicGateID) : frameBoardID;
  const initialLogicGateID = initialArenaLogicGateID || logicGateIDFromKanbanBoardID(initialBoardID);
  const [activeBoardID, setActiveBoardID] = useState(initialBoardID);
  const [activeLogicGateID, setActiveLogicGateID] = useState(initialLogicGateID);
  const [activeLogicGateLabel, setActiveLogicGateLabel] = useState(() => initialArenaLogicGateID ? humanLabelOrFallback(forcedLogicGateLabel, "Logic Gate") : "");
  const [allBoardsOpen, setAllBoardsOpen] = useState(false);
  const [contentSearchQuery, setContentSearchQuery] = useState("");
  const [kanbanAccountFilterIDs, setKanbanAccountFilterIDs] = useState<string[]>([]);
  const [arenaGroupingOpen, setArenaGroupingOpen] = useState(false);
  const [arenaGroupMenuOpen, setArenaGroupMenuOpen] = useState<ArenaGroupMenuID | null>(null);
  const [arenaXGroupBy, setArenaXGroupBy] = useState<KanbanGroupField>("status");
  const [arenaYGroupBy, setArenaYGroupBy] = useState<KanbanGroupField>("priority");
  const [arenaXSortDirection, setArenaXSortDirection] = useState<KanbanGroupSortDirection>("asc");
  const [arenaYSortDirection, setArenaYSortDirection] = useState<KanbanGroupSortDirection>(() => getDefaultKanbanYAxisSortDirection("priority"));
  const [editingBoardTitle, setEditingBoardTitle] = useState(false);
  const [boardTitleDraft, setBoardTitleDraft] = useState("");
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [currentUserID, setCurrentUserID] = useState<string | null>(null);
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
  const [draggingColumnID, setDraggingColumnID] = useState("");
  const [dragOverColumnID, setDragOverColumnID] = useState("");
  const [dragOverCard, setDragOverCard] = useState<{ cardID: string; placement: KanbanCardDropPlacement } | null>(null);
  const [selectedCardIDs, setSelectedCardIDs] = useState<Set<string>>(() => new Set());
  const [selectionAnchorCardID, setSelectionAnchorCardID] = useState("");
  const [addColumnHover, setAddColumnHover] = useState(false);
  const [columnContextMenu, setColumnContextMenu] = useState<{ x: number; y: number; columnID: string } | null>(null);
  const [cardContextMenu, setCardContextMenu] = useState<{ x: number; y: number; cardID: string } | null>(null);
  const [priorityMenu, setPriorityMenu] = useState<KanbanPriorityMenuState | null>(null);
  const [arenaCellContextMenu, setArenaCellContextMenu] = useState<KanbanArenaCellContextMenuState | null>(null);
  const [nodeEditorOverlay, setNodeEditorOverlay] = useState<NodeEditorOverlayState | null>(null);
  const [nodeEditorOverlayRatio, setNodeEditorOverlayRatio] = useState<NodeEditorOverlayRatio>(() => readNodeEditorOverlayRatio(companyID, frameID));
  const [deleteCardConfirmation, setDeleteCardConfirmation] = useState<{ cardIDs: string[] } | null>(null);
  const [deleteNodeConfirmation, setDeleteNodeConfirmation] = useState<{ nodeIDs: string[] } | null>(null);
  const [renameNodeDraft, setRenameNodeDraft] = useState<{ cardID: string; nodeID: string; title: string } | null>(null);
  const [accountAssignmentModal, setAccountAssignmentModal] = useState<KanbanAccountAssignmentState | null>(null);
  const [accountAssignmentBusy, setAccountAssignmentBusy] = useState(false);
  const [requestedCardActionID, setRequestedCardActionID] = useState("");
  const [kanbanProjectionSnapshotBoardID, setKanbanProjectionSnapshotBoardID] = useState("");
  const boardRootRef = useRef<HTMLDivElement | null>(null);
  const arenaGroupControlsRef = useRef<HTMLDivElement | null>(null);
  const renameNodeInputRef = useRef<HTMLInputElement | null>(null);
  const cancelRenameNodeOnBlurRef = useRef(false);
  const renameNodeCommitInFlightRef = useRef(false);
  const resizeRef = useRef<ColumnResizeState | null>(null);
  const nodeEditorOverlayResizeRef = useRef<OverlayResizeState | null>(null);
  const nodeEditorOverlayRatioRef = useRef(nodeEditorOverlayRatio);
  const activeBoardIDRef = useRef(activeBoardID);
  const frameBoardIDRef = useRef(frameBoardID);
  const boardsRef = useRef<KanbanBoard[]>([]);
  const columnsRef = useRef<KanbanColumn[]>([]);
  const cardsRef = useRef<KanbanCard[]>([]);
  const boardRefreshRequestRef = useRef(0);
  const localBoardMutationSeqRef = useRef(0);
  const pendingBoardMutationsRef = useRef(new Map<string, number>());
  const kanbanProjectionVersionsRef = useRef(new Map<string, number>());
  const kanbanProjectionSequenceRef = useRef<number | undefined>(undefined);
  const kanbanProjectionFallbackBoardsInFlightRef = useRef(new Set<string>());
  const lastLocalBoardSelectionChangedAtRef = useRef(0);
  const arenaViewLoadKeyRef = useRef("");

  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const { accounts: companyAccounts } = useCompanyAccounts(companyID);

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser()
      .then((current) => {
        if (!cancelled) setCurrentUserID(current.user.user_id.trim());
      })
      .catch(() => {
        if (!cancelled) setCurrentUserID("");
      });
    return () => { cancelled = true; };
  }, []);

  const usesLocalColumnLayout = useCallback((targetBoardID: string): boolean => {
    const cleanBoardID = targetBoardID.trim();
    if (!cleanBoardID) return false;
    return !!logicGateIDFromKanbanBoardID(cleanBoardID) || (cleanBoardID === activeBoardIDRef.current && !!activeLogicGateID);
  }, [activeLogicGateID]);

  const applyLocalColumnLayout = useCallback((nextColumns: KanbanColumn[], targetBoardID: string = activeBoardIDRef.current): KanbanColumn[] => {
    return usesLocalColumnLayout(targetBoardID) ? applyStoredLogicGateColumnLayouts(companyID, targetBoardID, nextColumns) : nextColumns;
  }, [companyID, usesLocalColumnLayout]);

  const storeLocalColumnLayout = useCallback((columnID: string, patch: StoredLogicGateColumnLayout, targetBoardID: string = activeBoardIDRef.current): boolean => {
    if (!usesLocalColumnLayout(targetBoardID)) return false;
    writeStoredLogicGateColumnLayout(companyID, targetBoardID, columnID, patch);
    return true;
  }, [companyID, usesLocalColumnLayout]);

  const applyColumns = useCallback((next: React.SetStateAction<KanbanColumn[]>) => {
    const resolved = typeof next === "function" ? next(columnsRef.current) : next;
    const withLocalLayout = applyLocalColumnLayout(resolved);
    columnsRef.current = withLocalLayout;
    setColumns(withLocalLayout);
  }, [applyLocalColumnLayout]);

  const applyCards = useCallback((next: React.SetStateAction<KanbanCard[]>) => {
    const resolved = typeof next === "function" ? next(cardsRef.current) : next;
    cardsRef.current = resolved;
    setCards(resolved);
  }, []);

  const beginLocalBoardMutation = useCallback((mutationBoardID = activeBoardIDRef.current, logicGateID = "") => {
    const cleanBoardID = mutationBoardID.trim();
    if (!cleanBoardID) return () => undefined;
    localBoardMutationSeqRef.current += 1;
    boardRefreshRequestRef.current += 1;
    pendingBoardMutationsRef.current.set(cleanBoardID, (pendingBoardMutationsRef.current.get(cleanBoardID) ?? 0) + 1);
    const cleanLogicGateID = logicGateID.trim() || logicGateIDFromKanbanBoardID(cleanBoardID);
    if (cleanLogicGateID) invalidateLogicGateArenaViewCache(apiBase, companyID, cleanLogicGateID);
    invalidateKanbanBoardContentsCache(apiBase, companyID, cleanBoardID);
    return () => {
      const current = pendingBoardMutationsRef.current.get(cleanBoardID) ?? 0;
      if (current <= 1) pendingBoardMutationsRef.current.delete(cleanBoardID);
      else pendingBoardMutationsRef.current.set(cleanBoardID, current - 1);
    };
  }, [apiBase, companyID]);

  useEffect(() => {
    let cancelled = false;
    if (!companyID) {
      setCompanyUsers([]);
      return;
    }
    (async () => {
      try {
        const users = await listCompanyUsers(companyID);
        if (!cancelled) setCompanyUsers(users);
      } catch {
        if (!cancelled) setCompanyUsers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [companyID]);

  useEffect(() => {
    setKanbanAccountFilterIDs((current) => current.filter((accountID) => companyAccounts.some((account) => account.account_id === accountID)));
  }, [companyAccounts]);

  const isDark = theme === "dark";
  const surface = isDark ? "#11161b" : KANBAN_PANEL_BACKGROUND;
  const text = isDark ? "#f6f8fb" : "#111827";
  const subtext = isDark ? "#b8c4cc" : "#475569";
  const line = isDark ? "rgba(255,255,255,0.16)" : "rgba(148, 163, 184, 0.18)";
  const laneBackground = isDark ? "#1a2229" : "rgba(255, 255, 255, 0.62)";
  const laneBorder = isDark ? "rgba(255,255,255,0.18)" : KANBAN_SOFT_BORDER;
  const laneShadow = isDark ? "none" : KANBAN_PANEL_SHADOW;
  const cardBackground = isDark ? "#101418" : KANBAN_SURFACE;
  const topClearancePx = arenaMode ? 0 : KANBAN_MODULE_TOP_CLEARANCE_PX;
  const boardHeaderLeftPaddingPx = arenaMode ? 0 : 162;
  const boardMinColumnHeightPx = arenaMode ? KANBAN_ARENA_DEFAULT_COLUMN_HEIGHT_PX : KANBAN_DEFAULT_COLUMN_HEIGHT_PX;

  useEffect(() => {
    if (arenaMode) {
      setNodeEditorOverlayRatio(readNodeEditorOverlayRatio(companyID, frameBoardID));
      return;
    }
    const nextLogicGateID = logicGateIDFromKanbanBoardID(frameBoardID);
    setActiveBoardID(frameBoardID);
    setActiveLogicGateID(nextLogicGateID);
    setActiveLogicGateLabel("");
    setNodeEditorOverlay(null);
    setNodeEditorOverlayRatio(readNodeEditorOverlayRatio(companyID, frameBoardID));
  }, [arenaMode, companyID, frameBoardID]);

  useEffect(() => {
    nodeEditorOverlayRatioRef.current = nodeEditorOverlayRatio;
  }, [nodeEditorOverlayRatio]);

  useEffect(() => {
    if (!nodeEditorOverlay) return;
    const reclampOverlay = () => {
      const boardBounds = boardRootRef.current?.getBoundingClientRect();
      const boardWidth = Math.max(1, boardBounds?.width ?? 1);
      const minLeftPx = getNodeEditorOverlayMinLeftPx(boardRootRef.current, false);
      const minLeft = minLeftPx / boardWidth;
      setNodeEditorOverlayRatio((current) => {
        const next = clampNodeEditorOverlayRatio(current, { minLeft });
        nodeEditorOverlayRatioRef.current = next;
        return sameNodeEditorOverlayRatio(current, next) ? current : next;
      });
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reclampOverlay);
    if (boardRootRef.current) resizeObserver?.observe(boardRootRef.current);
    if (typeof document !== "undefined") {
      for (const selector of ["[data-app-sidebar=\"primary\"]", "[data-app-sidebar-resize-handle=\"primary\"]"]) {
        const element = document.querySelector<HTMLElement>(selector);
        if (element) resizeObserver?.observe(element);
      }
    }
    window.addEventListener("resize", reclampOverlay);
    reclampOverlay();
    return () => {
      window.removeEventListener("resize", reclampOverlay);
      resizeObserver?.disconnect();
    };
  }, [nodeEditorOverlay]);

  useEffect(() => {
    activeBoardIDRef.current = activeBoardID;
    kanbanProjectionSequenceRef.current = undefined;
    kanbanProjectionVersionsRef.current = new Map();
    setKanbanProjectionSnapshotBoardID("");
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
    seedKanbanProjectionVersions(cards, kanbanProjectionVersionsRef.current);
  }, [cards]);

  useEffect(() => {
    if (!arenaGroupingOpen) setArenaGroupMenuOpen(null);
  }, [arenaGroupingOpen]);

  const openNodeEditorOverlay = useCallback((nodeID: string, nodeTitle: string, notifyRoute = true) => {
    const cleanNodeID = nodeID.trim();
    if (!cleanNodeID) return;
    const cleanNodeTitle = humanLabelOrFallback(nodeTitle, cleanNodeID);
    setNodeEditorOverlay((current) => (
      current?.nodeID === cleanNodeID && current.nodeTitle === cleanNodeTitle
        ? current
        : { nodeID: cleanNodeID, nodeTitle: cleanNodeTitle }
    ));
    if (notifyRoute) onNodeEditorOverlayOpen?.(cleanNodeID);
  }, [onNodeEditorOverlayOpen]);

  const closeNodeEditorOverlay = useCallback((notifyRoute = true) => {
    setNodeEditorOverlay(null);
    if (notifyRoute) onNodeEditorOverlayClose?.();
  }, [onNodeEditorOverlayClose]);

  const collapseNodeEditorOverlayToTab = useCallback(() => {
    if (!nodeEditorOverlay) return;
    requestAppDockTab({ kind: "node", entityID: nodeEditorOverlay.nodeID, label: nodeEditorOverlay.nodeTitle });
    closeNodeEditorOverlay();
  }, [closeNodeEditorOverlay, nodeEditorOverlay]);

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
      const boardWidth = Math.max(1, state.boardWidth);
      const boardHeight = Math.max(1, state.boardHeight);
      let width = state.startWidth;
      let height = state.startHeight;
      if (state.edges.right) width += dx;
      if (state.edges.left) width -= dx;
      if (state.edges.bottom) height += dy;
      if (state.edges.top) height -= dy;
      const nextSize = clampNodeEditorOverlayRatio({
        ...nodeEditorOverlayRatioRef.current,
        width: width / boardWidth,
        height: height / boardHeight,
      });
      let nextWidth = nextSize.width;
      let left = state.edges.left
        ? state.startLeft + state.startWidth - nextSize.width * boardWidth
        : state.startLeft;
      const top = state.edges.top
        ? state.startTop + state.startHeight - nextSize.height * boardHeight
        : state.startTop;
      if (state.edges.left && left < state.minLeft) {
        left = state.minLeft;
        nextWidth = Math.max(0, (state.startLeft + state.startWidth - left) / boardWidth);
      }
      const resizeMinLeftRatio = state.edges.left ? state.minLeft / boardWidth : undefined;
      const nextRatio = clampNodeEditorOverlayRatio({
        left: left / boardWidth,
        top: top / boardHeight,
        width: nextWidth,
        height: nextSize.height,
      }, { minLeft: resizeMinLeftRatio });
      nodeEditorOverlayRatioRef.current = nextRatio;
      setNodeEditorOverlayRatio(nextRatio);
    };
    const onEnd = () => {
      if (nodeEditorOverlayResizeRef.current) {
        storeNodeEditorOverlayRatio(companyID, frameID, nodeEditorOverlayRatioRef.current);
      }
      nodeEditorOverlayResizeRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
    };
  }, [companyID, frameID]);

  const orderedColumns = useMemo(() => sortColumns(columns), [columns]);
  const columnColorByID = useMemo(() => new Map(orderedColumns.map((column) => [column.column_id, getKanbanColumnDisplayColor(column)])), [orderedColumns]);
  const columnTitleByID = useMemo(() => new Map(orderedColumns.map((column) => [column.column_id, column.title.trim().toLowerCase()])), [orderedColumns]);
  const arenaUserByID = useMemo(() => new Map(companyUsers.map((user) => [user.user_id.trim(), user])), [companyUsers]);
  const arenaNodeByID = useMemo(() => {
    const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
    const nodeByID = new Map<string, NodeRecord>((snapshot.nodes ?? []).map((node) => [node.node_id, node]));
    for (const card of cards) {
      const existing = nodeByID.get(card.node_id);
      nodeByID.set(card.node_id, {
        company_id: existing?.company_id ?? card.company_id,
        node_id: card.node_id,
        name: existing?.name ?? card.node_title,
        created_timestamp: existing?.created_timestamp ?? card.created_timestamp,
        ...existing,
        due_date: card.due_date ?? existing?.due_date ?? null,
        priority: card.priority ?? existing?.priority ?? null,
        accounts: card.accounts ?? existing?.accounts ?? [],
      });
    }
    return nodeByID;
  }, [apiBase, cards, columns, companyID, nodeGraphRevision]);
  const normalizedContentSearchQuery = contentSearchQuery.trim().toLowerCase();
  const contentMatchedCards = useMemo(() => {
    if (!normalizedContentSearchQuery) return cards;
    const matchingColumnIDs = new Set(orderedColumns
      .filter((column) => column.column_id.toLowerCase().includes(normalizedContentSearchQuery) || column.title.toLowerCase().includes(normalizedContentSearchQuery))
      .map((column) => column.column_id));
    return cards.filter((card) => {
      if (matchingColumnIDs.has(card.column_id)) return true;
      const node = arenaNodeByID.get(card.node_id);
      const fields = [
        card.node_title,
        card.description_snapshot,
        card.node_id,
        card.card_id,
        card.logic_gate_id ?? "",
        card.is_issue ? "issue" : "",
        card.due_date ?? "",
        card.priority != null ? String(card.priority) : "",
        ...(card.accounts ?? []).flatMap((account) => [account.name, account.account_id]),
        columnTitleByID.get(card.column_id) ?? "",
        node?.name ?? "",
        node?.status ?? "",
        node?.due_date ?? "",
        node?.priority != null ? String(node.priority) : "",
        ...(node?.accounts ?? []).flatMap((account) => [account.name, account.account_id]),
      ];
      return fields.some((field) => field.trim().toLowerCase().includes(normalizedContentSearchQuery));
    });
  }, [arenaNodeByID, cards, columnTitleByID, normalizedContentSearchQuery, orderedColumns]);
  const searchedCards = useMemo(() => (
    kanbanAccountFilterIDs.length > 0
      ? contentMatchedCards.filter((card) => entityMatchesAccountFilter(card.accounts?.length ? card : arenaNodeByID.get(card.node_id), kanbanAccountFilterIDs))
      : contentMatchedCards
  ), [arenaNodeByID, contentMatchedCards, kanbanAccountFilterIDs]);
  const cardsByColumn = useMemo(() => groupCardsByColumn(searchedCards), [searchedCards]);
  const arenaGroupedBoard = useMemo(() => buildKanbanGroupedBoardLayout({
    columns: orderedColumns,
    cards: searchedCards,
    xGroupBy: arenaXGroupBy,
    yGroupBy: arenaYGroupBy,
    xSortDirection: arenaXSortDirection,
    ySortDirection: arenaYSortDirection,
    nodeByID: arenaNodeByID,
    userByID: arenaUserByID,
  }), [arenaNodeByID, arenaUserByID, arenaXGroupBy, arenaXSortDirection, arenaYGroupBy, arenaYSortDirection, searchedCards, orderedColumns]);
  const orderedBoards = useMemo(() => sortKanbanBoards(boards), [boards]);
  const activeBoard = useMemo(() => orderedBoards.find((board) => board.board_id === boardID) ?? null, [boardID, orderedBoards]);
  const activeBoardIsLogicGate = !!(activeLogicGateID || logicGateIDFromKanbanBoardID(boardID));
  const bottomLaneColumns = useMemo(() => (activeBoardIsLogicGate ? orderedColumns.filter(isKanbanBottomLaneColumn) : []), [activeBoardIsLogicGate, orderedColumns]);
  const mainBoardColumns = useMemo(() => (activeBoardIsLogicGate ? orderedColumns.filter((column) => !isKanbanBottomLaneColumn(column)) : orderedColumns), [activeBoardIsLogicGate, orderedColumns]);
  const useBottomLaneLayout = activeBoardIsLogicGate && bottomLaneColumns.length > 0;
  const boardColumnsMinWidth = useMemo(() => {
    const columnsForWidth = useBottomLaneLayout ? mainBoardColumns : orderedColumns;
    const topWidth = columnsForWidth.reduce((total, column) => total + getColumnWidth(column), 0) + Math.max(0, columnsForWidth.length - 1) * 10;
    const bottomWidth = useBottomLaneLayout
      ? bottomLaneColumns.reduce((total, column) => total + getColumnWidth(column), 0) + Math.max(0, bottomLaneColumns.length - 1) * 10
      : 0;
    return Math.max(topWidth, bottomWidth);
  }, [bottomLaneColumns, mainBoardColumns, orderedColumns, useBottomLaneLayout]);
  const bottomLaneGridTemplateColumns = useMemo(() => (
    bottomLaneColumns.map((column) => (
      isKanbanRequestedColumn(column)
        ? `minmax(${Math.min(getColumnWidth(column), 360)}px, ${getColumnWidth(column)}px)`
        : "minmax(260px, 1fr)"
    )).join(" ")
  ), [bottomLaneColumns]);
  const arenaAccountFilterLeftPx = useMemo(() => {
    if (!arenaMode || mainBoardColumns.length === 0) return 0;
    const doneIndex = mainBoardColumns.findIndex((column) => column.title.trim().toLowerCase().replace(/[\s_-]+/g, " ") === "done");
    const targetIndex = doneIndex >= 0 ? doneIndex : mainBoardColumns.length - 1;
    const targetRight = mainBoardColumns
      .slice(0, targetIndex + 1)
      .reduce((total, column, index) => total + getColumnWidth(column) + (index > 0 ? 10 : 0), 0);
    return Math.max(0, targetRight - KANBAN_ARENA_ACCOUNT_FILTER_WIDTH_PX);
  }, [arenaMode, mainBoardColumns]);
  const activeBoardTitle = activeLogicGateID ? (activeLogicGateLabel || (activeBoard ? getKanbanBoardDisplayTitle(activeBoard) : "Logic Gate")) : (activeBoard ? getKanbanBoardDisplayTitle(activeBoard) : KANBAN_DEFAULT_BOARD_TITLE);
  const boardRows = useMemo<KanbanBoard[]>(() => {
    if (activeBoard) return orderedBoards;
    return [{
      company_id: companyID,
      board_id: boardID,
      logic_gate_id: activeLogicGateID || null,
      title: activeLogicGateID ? (activeLogicGateLabel || "Logic Gate") : (activeLogicGateLabel || `${KANBAN_DEFAULT_BOARD_TITLE} (unsaved)`),
      position: 0,
      created_timestamp: "",
      updated_timestamp: "",
    }, ...orderedBoards];
  }, [activeBoard, activeLogicGateID, activeLogicGateLabel, boardID, companyID, orderedBoards]);
  const filteredBoardRows = boardRows;
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
    const nodeByID = new Map((getNodeRelationshipGraphSnapshot(apiBase, companyID).nodes ?? []).map((node) => [node.node_id, node]));
    const seenNodeIDs = new Set<string>();
    for (const card of statusCards) {
      if (seenNodeIDs.has(card.node_id)) continue;
      seenNodeIDs.add(card.node_id);
      const node = nodeByID.get(card.node_id);
      if (!node) continue;
      const column = columnByID.get(card.column_id);
      const status = card.is_issue ? "Issue" : (column?.title.trim() || "Unknown");
      invalidateNodeRecordStoreCaches(apiBase, companyID, card.node_id);
      upsertNodeRelationshipGraphNode(apiBase, companyID, {
        ...node,
        status,
        due_date: card.due_date ?? node.due_date ?? null,
        priority: card.priority ?? node.priority ?? null,
      });
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
    const mutationSeqAtStart = localBoardMutationSeqRef.current;
    if ((pendingBoardMutationsRef.current.get(expectedBoardID) ?? 0) > 0) return;
    setLoading(!hasKanbanBoardContentsCache(apiBase, companyID, expectedBoardID));
    void getLogicGateArenaView(apiBase, companyID, logicGateID)
      .then((view) => {
        if (activeBoardIDRef.current !== expectedBoardID) return;
        if (localBoardMutationSeqRef.current !== mutationSeqAtStart) return;
        const logicGateLabel = humanLabelOrFallback(view.logic_gate?.header, "Logic Gate");
        const board = { ...view.board, logic_gate_id: view.board.logic_gate_id ?? logicGateID, title: logicGateLabel };
        upsertBoardInList(board);
        setActiveLogicGateLabel(logicGateLabel);
        const nextColumns = sortColumns(view.columns ?? []);
        const nextCards = hydrateKanbanCardsFromNodes(view.cards ?? [], view.nodes ?? []);
        kanbanProjectionSequenceRef.current = nextKanbanProjectionCursor(kanbanProjectionSequenceRef.current, view.projection_sequence);
        applyColumns(nextColumns);
        applyCards(nextCards);
        setKanbanProjectionSnapshotBoardID(expectedBoardID);
        primeKanbanBoardContentsCache(apiBase, companyID, board.board_id, { columns: nextColumns, cards: nextCards, projectionSequence: kanbanProjectionSequenceRef.current });
        setError("");
        setLoading(false);
      })
      .catch((err) => {
        if (activeBoardIDRef.current !== expectedBoardID) return;
        setError(formatKanbanLoadError(err, "Logic gate arena API unavailable"));
        setLoading(false);
      });
  }, [apiBase, applyCards, applyColumns, companyID, upsertBoardInList]);

  useEffect(() => {
    if (!arenaMode) return;
    const logicGateID = forcedLogicGateID.trim();
    if (!logicGateID) {
      arenaViewLoadKeyRef.current = "";
      if (activeLogicGateID) {
        setActiveLogicGateID("");
        setActiveLogicGateLabel("");
      }
      return;
    }
    const nextBoardID = logicGateKanbanBoardID(logicGateID);
    const loadKey = `${logicGateID}\x1f${nextBoardID}`;
    const nextLabel = humanLabelOrFallback(forcedLogicGateLabel, "Logic Gate");
    const nextHighlightedEntity = forcedHighlightedNodeID.trim() ? { nodeID: forcedHighlightedNodeID.trim() } : null;
    if (activeBoardIDRef.current === nextBoardID && activeLogicGateID === logicGateID) {
      setHighlightedEntity(nextHighlightedEntity);
      setActiveLogicGateLabel(nextLabel);
      if (arenaViewLoadKeyRef.current !== loadKey) {
        arenaViewLoadKeyRef.current = loadKey;
        loadLogicGateArenaView(logicGateID, nextBoardID);
      }
      return;
    }
    activeBoardIDRef.current = nextBoardID;
    setSelectedCardIDs(new Set());
    setSelectionAnchorCardID("");
    setHighlightedEntity(nextHighlightedEntity);
    setActiveLogicGateID(logicGateID);
    setActiveLogicGateLabel(nextLabel);
    setNodeEditorOverlay(null);
    setActiveBoardID(nextBoardID);
    const cachedBoard = boardsRef.current.find((board) => board.board_id === nextBoardID || board.logic_gate_id === logicGateID);
    if (cachedBoard) upsertBoardInList(cachedBoard);
    if (arenaViewLoadKeyRef.current !== loadKey) {
      arenaViewLoadKeyRef.current = loadKey;
      loadLogicGateArenaView(logicGateID, nextBoardID);
    }
  }, [activeLogicGateID, arenaMode, forcedHighlightedNodeID, forcedLogicGateID, forcedLogicGateLabel, loadLogicGateArenaView, upsertBoardInList]);

  useEffect(() => {
    if (!arenaMode) return;
    const nodeID = forcedHighlightedNodeID.trim();
    if (!nodeID) return;
    const logicGateID = forcedLogicGateID.trim();
    const expectedBoardID = logicGateID ? logicGateKanbanBoardID(logicGateID) : "";
    const matchingCards = cards.filter((card) => {
      if (card.node_id !== nodeID) return false;
      if (!logicGateID) return true;
      return card.logic_gate_id === logicGateID || card.board_id === expectedBoardID;
    });
    setHighlightedEntity({ nodeID });
    setSelectedCardIDs(new Set(matchingCards.map((card) => card.card_id)));
    setSelectionAnchorCardID(matchingCards[0]?.card_id ?? "");
  }, [arenaMode, cards, forcedHighlightedNodeID, forcedLogicGateID]);

  useEffect(() => {
    if (!arenaMode || !controlForcedOpenNode) return;
    const nodeID = forcedOpenNodeID.trim();
    if (!nodeID) {
      closeNodeEditorOverlay(false);
      return;
    }
    const logicGateID = forcedLogicGateID.trim();
    const expectedBoardID = logicGateID ? logicGateKanbanBoardID(logicGateID) : "";
    const matchingCard = cards.find((card) => {
      if (card.node_id !== nodeID) return false;
      if (!logicGateID) return true;
      return card.logic_gate_id === logicGateID || card.board_id === expectedBoardID;
    });
    openNodeEditorOverlay(nodeID, matchingCard?.node_title || nodeID, false);
  }, [arenaMode, cards, closeNodeEditorOverlay, controlForcedOpenNode, forcedLogicGateID, forcedOpenNodeID, openNodeEditorOverlay]);

  const refreshBoards = useCallback(async () => {
    setBoardsLoading(true);
    try {
      const nextBoards = await listKanbanBoards(apiBase, companyID, 200);
      const sortedBoards = sortKanbanBoards(nextBoards);
      boardsRef.current = sortedBoards;
      setBoards(sortedBoards);
      setExplorerFolders([]);
      setExplorerFolderItems([]);
      const currentBoardID = activeBoardIDRef.current;
      const currentBoardVisible = sortedBoards.some((board) => board.board_id === currentBoardID);
      if ((!logicGateIDFromKanbanBoardID(currentBoardID) || !currentBoardVisible) && sortedBoards.length > 0) {
        const nextBoard = sortedBoards[0];
        const nextLogicGateID = nextBoard.logic_gate_id?.trim() || logicGateIDFromKanbanBoardID(nextBoard.board_id);
        activeBoardIDRef.current = nextBoard.board_id;
        setSelectedCardIDs(new Set());
        setSelectionAnchorCardID("");
        setHighlightedEntity(null);
        setActiveLogicGateID(nextLogicGateID);
        setActiveLogicGateLabel(nextLogicGateID ? getKanbanBoardDisplayTitle(nextBoard) : "");
        setNodeEditorOverlay(null);
        setActiveBoardID(nextBoard.board_id);
      } else if (!currentBoardVisible && sortedBoards.length === 0 && !logicGateIDFromKanbanBoardID(currentBoardID)) {
        setColumns([]);
        setCards([]);
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
    const mutationSeqAtStart = localBoardMutationSeqRef.current;
    const requestedBoardID = requestedBoardIDOverride?.trim() || boardID;
    if ((pendingBoardMutationsRef.current.get(requestedBoardID) ?? 0) > 0) {
      setLoading(false);
      return;
    }
    setLoading(!hasKanbanBoardContentsCache(apiBase, companyID, requestedBoardID));
    setError("");
    if (!logicGateIDFromKanbanBoardID(requestedBoardID) && !boardsRef.current.some((board) => board.board_id === requestedBoardID)) {
      applyColumns([]);
      applyCards([]);
      setLoading(false);
      return;
    }
    try {
      // The UI renders a bounded first window. Headless agents should page by
      // column through the cards API instead of loading company-scale boards.
      const { columns: nextColumns, cards: nextCards, projectionSequence } = await getKanbanBoardContentsSingleFlight(apiBase, companyID, requestedBoardID, 500);
      if (boardRefreshRequestRef.current !== requestID || activeBoardIDRef.current !== requestedBoardID) return;
      if (localBoardMutationSeqRef.current !== mutationSeqAtStart) return;
      kanbanProjectionSequenceRef.current = nextKanbanProjectionCursor(kanbanProjectionSequenceRef.current, projectionSequence);
      applyColumns(sortColumns(nextColumns));
      applyCards(nextCards);
      setKanbanProjectionSnapshotBoardID(requestedBoardID);
    } catch {
      if (boardRefreshRequestRef.current !== requestID) return;
      if (columnsRef.current.length === 0 && cardsRef.current.length === 0 && !logicGateIDFromKanbanBoardID(requestedBoardID)) {
        setError("Kanban board API unavailable");
      }
    } finally {
      if (boardRefreshRequestRef.current === requestID) setLoading(false);
    }
  }, [apiBase, applyCards, applyColumns, boardID, companyID]);

  useEffect(() => {
    if (arenaMode) return;
    refreshBoard();
  }, [arenaMode, refreshBoard]);

  useEffect(() => {
    primeKanbanBoardContentsCache(apiBase, companyID, boardID, { columns, cards, projectionSequence: kanbanProjectionSequenceRef.current });
  }, [apiBase, boardID, cards, columns, companyID]);

  useEffect(() => {
    if (arenaMode) return;
    refreshBoards();
  }, [arenaMode, refreshBoards]);

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
      if (!arenaMode) void refreshBoards();
    };
    window.addEventListener(EVENT_KANBAN_BOARDS_UPDATED, onKanbanBoardsUpdated);
    return () => window.removeEventListener(EVENT_KANBAN_BOARDS_UPDATED, onKanbanBoardsUpdated);
  }, [apiBase, arenaMode, companyID, invalidateArenaViewForBoard, refreshBoards, removeBoardFromList, upsertBoardInList]);

  useEffect(() => {
    const onKanbanBoardContentsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<KanbanBoardContentsUpdatedDetail>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      const streamBoardID = detail?.boardID?.trim() ?? "";
      if (!streamBoardID) return;
      invalidateArenaViewForBoard(streamBoardID, detail.logicGateID ?? "");
      invalidateKanbanBoardContentsCache(apiBase, companyID, streamBoardID);
      if (streamBoardID === activeBoardIDRef.current) void refreshBoard(streamBoardID);
    };
    window.addEventListener(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, onKanbanBoardContentsUpdated);
    return () => window.removeEventListener(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, onKanbanBoardContentsUpdated);
  }, [apiBase, companyID, invalidateArenaViewForBoard, refreshBoard]);

  const reconcileKanbanGap = useCallback((gap: WorkspaceStreamGapSignal) => {
    if (gap.companyID !== companyID) return;
    const boardRefreshes = new Map<string, string>();
    const nodeIDs = new Set<string>();
    let refreshBoardList = false;

    const addBoardRefresh = (streamBoardID: string | undefined, logicGateID = "") => {
      const cleanBoardID = streamBoardID?.trim() ?? "";
      if (!cleanBoardID) return;
      boardRefreshes.set(cleanBoardID, logicGateID || boardRefreshes.get(cleanBoardID) || "");
    };

    for (const scope of gap.scopes) {
      if (scope.kind === "kanban_board") {
        addBoardRefresh(scope.boardID, scope.logicGateID);
      } else if (scope.kind === "kanban_board_list") {
        refreshBoardList = true;
        addBoardRefresh(scope.boardID, scope.logicGateID);
      } else if (scope.kind === "work_item_assignment") {
        const streamBoardID = scope.boardID || (scope.logicGateID ? logicGateKanbanBoardID(scope.logicGateID) : "");
        addBoardRefresh(streamBoardID, scope.logicGateID);
        if (scope.nodeID) nodeIDs.add(scope.nodeID);
      } else if (scope.kind === "node_graph" && scope.nodeID) {
        if (cardsRef.current.some((card) => card.node_id === scope.nodeID)) addBoardRefresh(activeBoardIDRef.current);
        nodeIDs.add(scope.nodeID);
      } else if (scope.kind === "company_explorer" && scope.itemType === "kanban") {
        refreshBoardList = true;
        addBoardRefresh(scope.itemID);
      } else if (scope.kind === "workspace") {
        refreshBoardList = true;
        addBoardRefresh(activeBoardIDRef.current);
      }
    }

    for (const nodeID of nodeIDs) invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
    if (refreshBoardList && !arenaMode) {
      invalidateKanbanBoardListCache(apiBase, companyID);
      void refreshBoards();
    }
    for (const [streamBoardID, logicGateID] of boardRefreshes.entries()) {
      invalidateArenaViewForBoard(streamBoardID, logicGateID);
      invalidateKanbanBoardContentsCache(apiBase, companyID, streamBoardID);
      if (streamBoardID === activeBoardIDRef.current) void refreshBoard(streamBoardID);
    }
  }, [apiBase, arenaMode, companyID, invalidateArenaViewForBoard, refreshBoard, refreshBoards]);

  const requestKanbanProjectionFallback = useCallback((reason: KanbanProjectionFallbackReason, streamBoardID = activeBoardIDRef.current, logicGateID = "") => {
    void reason;
    const cleanBoardID = streamBoardID.trim();
    if (!cleanBoardID) return;
    if (!beginKanbanProjectionFallback(kanbanProjectionFallbackBoardsInFlightRef.current, cleanBoardID)) return;
    invalidateArenaViewForBoard(cleanBoardID, logicGateID);
    invalidateKanbanBoardContentsCache(apiBase, companyID, cleanBoardID);
    if (cleanBoardID === activeBoardIDRef.current) {
      void refreshBoard(cleanBoardID).finally(() => {
        finishKanbanProjectionFallback(kanbanProjectionFallbackBoardsInFlightRef.current, cleanBoardID);
      });
      return;
    }
    finishKanbanProjectionFallback(kanbanProjectionFallbackBoardsInFlightRef.current, cleanBoardID);
  }, [apiBase, companyID, invalidateArenaViewForBoard, refreshBoard]);

  const removeCardsFromLocalSelection = useCallback((removedCardIDs: string[]) => {
    if (removedCardIDs.length === 0) return;
    const removed = new Set(removedCardIDs);
    setSelectedCardIDs((previous) => new Set(Array.from(previous).filter((selectedCardID) => !removed.has(selectedCardID))));
    setSelectionAnchorCardID((current) => (removed.has(current) ? "" : current));
  }, []);

  const applyRealtimeKanbanProjectionDelta = useCallback((message: RealtimeProjectionDeltaMessage) => {
    const envelope = message as unknown as KanbanProjectionEnvelope;
    if (envelope.company_id !== companyID || envelope.projection !== "kanban_board") return;
    const result = applyKanbanProjectionEnvelope({
      envelope,
      companyID,
      boardID: activeBoardIDRef.current,
      cards: cardsRef.current,
      versions: kanbanProjectionVersionsRef.current,
      lastSequence: kanbanProjectionSequenceRef.current,
    });
    if (result.fallback) {
      requestKanbanProjectionFallback(result.fallbackReason ?? "invalid_delta");
      return;
    }
    kanbanProjectionSequenceRef.current = result.lastSequence;
    if (!result.changed) return;
    applyCards(result.cards);
    removeCardsFromLocalSelection(result.removedCardIDs);
    syncNodeStatusesFromCards(result.upsertedCards);
  }, [applyCards, companyID, removeCardsFromLocalSelection, requestKanbanProjectionFallback, syncNodeStatusesFromCards]);

  useEffect(() => {
    const streamBoardID = activeBoardID.trim();
    if (!companyID || !streamBoardID) return undefined;
    const streamLogicGateID = logicGateIDFromKanbanBoardID(streamBoardID);
    if (arenaMode && !streamLogicGateID) return undefined;
    if (kanbanProjectionSnapshotBoardID !== streamBoardID) return undefined;
    const scope = `board:${streamBoardID}`;
    return subscribeRealtimeScope(apiBase, companyID, scope, {
      getAfterSequence: () => kanbanProjectionSequenceRef.current,
      onRejected: () => requestKanbanProjectionFallback("invalid_envelope", streamBoardID, streamLogicGateID),
      onRefetch: () => requestKanbanProjectionFallback("sequence_gap", streamBoardID, streamLogicGateID),
      onPermissionRevoked: () => requestKanbanProjectionFallback("permission_revoked", streamBoardID, streamLogicGateID),
      onError: () => requestKanbanProjectionFallback("invalid_envelope", streamBoardID, streamLogicGateID),
      onDelta: applyRealtimeKanbanProjectionDelta,
    });
  }, [activeBoardID, apiBase, applyRealtimeKanbanProjectionDelta, arenaMode, companyID, kanbanProjectionSnapshotBoardID, requestKanbanProjectionFallback]);

  useEffect(() => {
    if (arenaMode && suppressLegacyWorkspaceStream) return undefined;
    const streamBoardID = activeBoardID.trim();
    if (!streamBoardID) return undefined;
    if (arenaMode) {
      const logicGateID = activeLogicGateID.trim();
      if (!logicGateID || streamBoardID !== logicGateKanbanBoardID(logicGateID)) return undefined;
    }
    return subscribeWorkspaceUserRealtime(apiBase, companyID, workspaceRealtimeScope, {
      onGap: reconcileKanbanGap,
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
          if (envelope.type === "logic_gate_created") {
            invalidateKanbanBoardListCache(apiBase, companyID);
            if (!arenaMode) void refreshBoards();
            return;
          }
          if (envelope.type === "logic_gate_updated") {
            const logicGate = data.logic_gate as { logic_gate_id?: unknown; header?: unknown } | undefined;
            const logicGateID = typeof logicGate?.logic_gate_id === "string" ? logicGate.logic_gate_id : (typeof data.logic_gate_id === "string" ? data.logic_gate_id : "");
            if (!logicGateID) return;
            invalidateKanbanBoardListCache(apiBase, companyID);
            invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
            const boardID = logicGateKanbanBoardID(logicGateID);
            const title = humanLabelOrFallback(typeof logicGate?.header === "string" ? logicGate.header : "", "Logic Gate");
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
            return;
          }
          if (envelope.type === "kanban_card_deleted") {
            const streamBoardID = typeof data.board_id === "string" ? data.board_id : "";
            const cardID = typeof data.card_id === "string" ? data.card_id : "";
            if (!streamBoardID || !cardID) return;
            invalidateArenaViewForBoard(streamBoardID);
            invalidateKanbanBoardContentsCache(apiBase, companyID, streamBoardID);
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
  }, [activeBoardID, activeLogicGateID, apiBase, arenaMode, companyID, invalidateArenaViewForBoard, reconcileKanbanGap, refreshBoard, removeBoardFromList, suppressLegacyWorkspaceStream, upsertBoardInList]);

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
    if (arenaMode) return;
    const applyNodeGraphChange = () => {
      setNodeGraphRevision((revision) => revision + 1);
      syncCardTitlesFromNodeGraph();
    };
    applyNodeGraphChange();
    return subscribeNodeRelationshipGraph(apiBase, companyID, applyNodeGraphChange);
  }, [apiBase, arenaMode, companyID, syncCardTitlesFromNodeGraph]);

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
        setActiveLogicGateLabel(logicGateID ? humanLabelOrFallback(selection.label, "Logic Gate") : "");
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
        setActiveLogicGateLabel(humanLabelOrFallback(selection.label, "Logic Gate"));
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
      void refreshBoards();
    } catch {
      setError("Column create failed");
    }
  }, [columns, kanbanCommandContext, refreshBoards]);

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
    if (storeLocalColumnLayout(columnID, { width_px: size.widthPx, height_px: size.heightPx })) {
      setError("");
      return;
    }
    setError("");
    try {
      const updated = await persistKanbanColumnLayoutCommand({ context: kanbanCommandContext, columnID, ...size });
      setColumns((previous) => previous.map((column) => (column.column_id === updated.column_id ? updated : column)));
    } catch {
      setError("Column resize failed");
      refreshBoard();
    }
  }, [kanbanCommandContext, refreshBoard, storeLocalColumnLayout]);

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
      const heightPx = Math.max(resize.minHeight ?? 0, clampColumnHeight(resize.startHeight + event.clientY - resize.startY));
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
    const mutationBoardID = boardID;
    const endMutation = beginLocalBoardMutation(mutationBoardID, logicGateIDFromKanbanBoardID(mutationBoardID));
    let shouldRefresh = false;
    try {
      const result = await reorderKanbanCardsCommand({
        context: kanbanCommandContext,
        cards: cardsRef.current,
        cardIDs,
        columnID,
        targetCardID,
        placement,
        onOptimisticCards: (optimisticCards) => {
          applyCards(optimisticCards);
          const movedIDs = new Set(cardIDs);
          syncNodeStatusesFromCards(optimisticCards.filter((card) => movedIDs.has(card.card_id)));
        },
      });
      const byID = new Map(result.persistedCards.map((card) => [card.card_id, card]));
      applyCards((previous) => previous.map((card) => byID.get(card.card_id) ?? card));
      syncNodeStatusesFromCards(result.persistedCards);
    } catch {
      setError("Card reorder failed");
      shouldRefresh = true;
    } finally {
      endMutation();
    }
    if (shouldRefresh) void refreshBoard(mutationBoardID);
  }, [applyCards, beginLocalBoardMutation, boardID, kanbanCommandContext, refreshBoard, syncNodeStatusesFromCards]);

  const resolveRequestedCard = useCallback(async (card: KanbanCard, accept: boolean) => {
    setRequestedCardActionID(card.card_id);
    try {
      await reorderCards([card.card_id], accept ? KANBAN_REQUESTED_ACCEPT_COLUMN_ID : KANBAN_REQUESTED_DECLINE_COLUMN_ID, null, "after");
    } finally {
      setRequestedCardActionID((current) => (current === card.card_id ? "" : current));
    }
  }, [reorderCards]);

  const moveCardsToArenaGroupCell = useCallback(async (
    cardIDs: string[],
    columnGroupKey: string,
    rowGroupKey: string,
    targetCardID: string | null = null,
    placement: KanbanCardDropPlacement = "before",
  ) => {
    setDragOverCard(null);
    setError("");
    const uniqueCardIDs = Array.from(new Set(cardIDs.map((cardID) => cardID.trim()).filter(Boolean)));
    if (uniqueCardIDs.length === 0) return;
    const cardByID = new Map(cardsRef.current.map((card) => [card.card_id, card]));
    const targetCards = uniqueCardIDs
      .map((cardID) => cardByID.get(cardID))
      .filter((card): card is KanbanCard => Boolean(card));
    if (targetCards.length === 0) return;

    const assignment = resolveKanbanGroupDropAssignment({
      columns: columnsRef.current,
      xGroupBy: arenaXGroupBy,
      xGroupKey: columnGroupKey,
      yGroupBy: arenaYGroupBy,
      yGroupKey: rowGroupKey,
    });
    const issueWasSet = Object.prototype.hasOwnProperty.call(assignment, "isIssue");
    const priorityWasSet = Object.prototype.hasOwnProperty.call(assignment, "priority");
    const dueDateWasSet = Object.prototype.hasOwnProperty.call(assignment, "dueDate");
    const hasAnyAssignment = !!assignment.columnID || issueWasSet || priorityWasSet || dueDateWasSet;
    if (!hasAnyAssignment) return;
    if (priorityWasSet && assignment.priority == null && targetCards.some((card) => logicGateIDForKanbanCard(card, boardID))) {
      setError("Priority is required");
      return;
    }

    const mutationBoardID = boardID;
    const endMutation = beginLocalBoardMutation(mutationBoardID, logicGateIDFromKanbanBoardID(mutationBoardID));
    let shouldRefresh = false;
    try {
      const savedCards: KanbanCard[] = [];
      const updatedNodes = new Map<string, NodeRecord>();
      const nextPositionByColumnID = new Map<string, number>();
      const allocatePosition = (columnID: string): number => {
        const next = nextPositionByColumnID.get(columnID) ?? nextCardPosition(cardsRef.current, columnID);
        nextPositionByColumnID.set(columnID, next + 1000);
        return next;
      };

      for (const card of targetCards) {
        let savedCard = card;
        let updatedNode: NodeRecord | null = null;
        const logicGateID = logicGateIDForKanbanCard(card, boardID);
        const targetColumnID = assignment.columnID ?? card.column_id;
        const columnChanged = targetColumnID !== card.column_id;
        const issueChanged = issueWasSet && Boolean(card.is_issue) !== Boolean(assignment.isIssue);
        const position = columnChanged ? allocatePosition(targetColumnID) : undefined;

        if (logicGateID) {
          if (columnChanged || priorityWasSet) {
            const result = await moveLogicGateAssignment({
              apiBase,
              companyID,
              logicGateID,
              nodeID: card.node_id,
              columnID: targetColumnID,
              mutationOrigin: "kanban",
              position,
              priority: priorityWasSet ? assignment.priority : undefined,
            });
            savedCard = result.card;
            updatedNode = result.node;
          }
          if (issueChanged) {
            const result = await setLogicGateAssignmentIssue({
              apiBase,
              companyID,
              logicGateID,
              nodeID: card.node_id,
              isIssue: Boolean(assignment.isIssue),
            });
            savedCard = result.card;
            updatedNode = result.node;
          }
        } else if (columnChanged || issueChanged) {
          savedCard = await moveKanbanCard({
            apiBase,
            companyID,
            boardID: card.board_id || boardID,
            cardID: card.card_id,
            columnID: columnChanged ? targetColumnID : undefined,
            position,
            isIssue: issueChanged ? Boolean(assignment.isIssue) : undefined,
          });
        }

        const nodePatch: Partial<Pick<NodeRecord, "priority" | "due_date">> = {};
        if (dueDateWasSet) nodePatch.due_date = assignment.dueDate ?? null;
        if (priorityWasSet && !logicGateID) nodePatch.priority = assignment.priority ?? null;
        if (Object.keys(nodePatch).length > 0) {
          updatedNode = await requestJSON<NodeRecord>(`/v1/nodes/${encodeURIComponent(card.node_id)}`, {
            method: "PUT",
            json: { company_id: companyID, ...nodePatch },
          });
        }

        savedCards.push(savedCard);
        if (updatedNode) updatedNodes.set(updatedNode.node_id, updatedNode);
      }

      let cardsForOrdering = cardsRef.current;
      if (savedCards.length > 0) {
        const savedCardByID = new Map(savedCards.map((card) => [card.card_id, card]));
        cardsForOrdering = cardsRef.current.map((card) => savedCardByID.get(card.card_id) ?? card);
        applyCards(() => cardsForOrdering);
        syncNodeStatusesFromCards(savedCards);
      }
      const reorderTargetCardID = targetCardID?.trim() ?? "";
      if (reorderTargetCardID && !uniqueCardIDs.includes(reorderTargetCardID)) {
        const reorderTarget = cardsForOrdering.find((card) => card.card_id === reorderTargetCardID);
        const reorderColumnID = assignment.columnID ?? reorderTarget?.column_id ?? targetCards[0]?.column_id ?? "";
        if (reorderColumnID) {
          const result = await reorderKanbanCardsCommand({
            context: kanbanCommandContext,
            cards: cardsForOrdering,
            cardIDs: uniqueCardIDs,
            columnID: reorderColumnID,
            targetCardID: reorderTargetCardID,
            placement,
            onOptimisticCards: applyCards,
          });
          if (result.persistedCards.length > 0) {
            const byID = new Map(result.persistedCards.map((card) => [card.card_id, card]));
            applyCards((previous) => previous.map((card) => byID.get(card.card_id) ?? card));
            syncNodeStatusesFromCards(result.persistedCards);
          }
        }
      }
      if (updatedNodes.size > 0) {
        for (const node of updatedNodes.values()) {
          invalidateNodeRecordStoreCaches(apiBase, companyID, node.node_id);
          upsertNodeRelationshipGraphNode(apiBase, companyID, node);
        }
        setNodeGraphRevision((revision) => revision + 1);
      }
    } catch {
      setError("Grouped cell drop failed");
      shouldRefresh = true;
    } finally {
      endMutation();
    }
    if (shouldRefresh) void refreshBoard(mutationBoardID);
  }, [apiBase, applyCards, arenaXGroupBy, arenaYGroupBy, beginLocalBoardMutation, boardID, companyID, kanbanCommandContext, refreshBoard, requestJSON, syncNodeStatusesFromCards]);

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
    setArenaCellContextMenu(null);
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
    setArenaCellContextMenu(null);
    setDeleteNodeConfirmation({ nodeIDs: uniqueNodeIDs });
  }, [cards]);

  const requestNodeRename = useCallback((card: KanbanCard) => {
    setCardContextMenu(null);
    setColumnContextMenu(null);
    setArenaCellContextMenu(null);
    cancelRenameNodeOnBlurRef.current = false;
    setRenameNodeDraft({ cardID: card.card_id, nodeID: card.node_id, title: card.node_title });
  }, []);

  const commitNodeRename = useCallback(async (nodeID: string, title: string) => {
    if (renameNodeCommitInFlightRef.current) return;
    const cleanTitle = title.trim();
    if (!nodeID || !cleanTitle) {
      setRenameNodeDraft(null);
      return;
    }
    const currentTitle = cardsRef.current.find((card) => card.node_id === nodeID)?.node_title.trim() ?? "";
    if (currentTitle === cleanTitle) {
      setRenameNodeDraft(null);
      return;
    }
    renameNodeCommitInFlightRef.current = true;
    setError("");
    try {
      const updated = await requestJSON<NodeRecord>(`/v1/nodes/${encodeURIComponent(nodeID)}`, {
        method: "PUT",
        json: { company_id: companyID, name: cleanTitle },
      });
      const updatedTitle = getNodeTitle(updated) || cleanTitle;
      invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
      upsertNodeRelationshipGraphNode(apiBase, companyID, updated);
      applyCards((previous) => previous.map((card) => (card.node_id === nodeID ? { ...card, node_title: updatedTitle } : card)));
      setNodeEditorOverlay((current) => (current?.nodeID === nodeID ? { ...current, nodeTitle: updatedTitle } : current));
      if (highlightedEntity?.nodeID === nodeID) {
        const selectedNodeIDs = Array.from(new Set(cardsRef.current
          .filter((card) => selectedCardIDs.has(card.card_id))
          .map((card) => card.node_id)));
        publishKanbanSelectionToLinkedFrames(companyID, frameID, nodeID, updatedTitle, selectedNodeIDs.length > 0 ? selectedNodeIDs : [nodeID]);
      }
      setRenameNodeDraft(null);
    } catch {
      setError("Node rename failed");
    } finally {
      renameNodeCommitInFlightRef.current = false;
    }
  }, [apiBase, applyCards, companyID, frameID, highlightedEntity?.nodeID, requestJSON, selectedCardIDs]);

  useEffect(() => {
    if (!renameNodeDraft || !renameNodeInputRef.current) return;
    const input = renameNodeInputRef.current;
    input.focus();
    input.setSelectionRange(0, input.value.length, "forward");
  }, [renameNodeDraft?.cardID]);

  const removeCards = useCallback(async (cardIDs: string[]) => {
    const ids = new Set(cardIDs);
    if (ids.size === 0) return;
    const previousCards = cards;
    setCards((current) => current.filter((card) => !ids.has(card.card_id)));
    setSelectedCardIDs((current) => new Set(Array.from(current).filter((cardID) => !ids.has(cardID))));
    setSelectionAnchorCardID((current) => (ids.has(current) ? "" : current));
    setCardContextMenu(null);
    setArenaCellContextMenu(null);
    setError("");
    try {
      await deleteKanbanCardsCommand({ context: kanbanCommandContext, cards, cardIDs: Array.from(ids) });
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
    setArenaCellContextMenu(null);
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
    setArenaCellContextMenu(null);
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

  const addEntitiesToColumn = useCallback(async (columnID: string, items: ExplorerEntityDragItem[], priority?: number) => {
    setError("");
    const logicGateID = logicGateIDFromKanbanBoardID(boardID);
    const hasValidPriority = typeof priority === "number" && Number.isInteger(priority) && priority >= 1 && priority <= 5;
    if (logicGateID && !hasValidPriority) {
      setError("Priority is required");
      return;
    }
    const mutationBoardID = boardID;
    const endMutation = beginLocalBoardMutation(mutationBoardID, logicGateIDFromKanbanBoardID(mutationBoardID));
    let shouldRefresh = false;
    try {
      const result = await addExplorerNodesToKanbanColumnCommand({
        context: kanbanCommandContext,
        cards: cardsRef.current,
        columnID,
        items,
        priority,
        onOptimisticCards: (optimisticCards, nodeIDs) => {
          applyCards((previous) => [...previous.filter((card) => !nodeIDs.has(card.node_id)), ...optimisticCards]);
          syncNodeStatusesFromCards(optimisticCards);
        },
      });
      if (result.savedCards.length === 0) return;
      applyCards((previous) => [...previous.filter((card) => !result.optimisticCardIDs.has(card.card_id) && !result.nodeIDs.has(card.node_id)), ...result.savedCards]);
      syncNodeStatusesFromCards(result.savedCards);
    } catch {
      setError("Drop failed");
      shouldRefresh = true;
    } finally {
      endMutation();
    }
    if (shouldRefresh) void refreshBoard(mutationBoardID);
  }, [applyCards, beginLocalBoardMutation, boardID, kanbanCommandContext, refreshBoard, syncNodeStatusesFromCards]);

  const createNodeInColumn = useCallback(async (columnID: string, priority: number) => {
    setError("");
    const logicGateID = logicGateIDFromKanbanBoardID(boardID);
    if (!logicGateID) {
      setError("Select a Logic Gate board first");
      return;
    }
    const nodeID = createClientUUIDv7();
    const title = "new node";
    const position = nextCardPosition(cardsRef.current, columnID);
    const endMutation = beginLocalBoardMutation(boardID, logicGateID);
    let shouldRefresh = false;
    try {
      const result = await assignNodeToLogicGateStatus({
        apiBase,
        companyID,
        logicGateID,
        nodeID,
        columnID,
        nodeTitle: title,
        createNodeTitle: title,
        mutationOrigin: "kanban",
        position,
        priority,
      });
      upsertNodeRelationshipGraphNode(apiBase, companyID, result.node);
      applyCards((previous) => [...previous.filter((card) => card.node_id !== nodeID), result.card]);
      syncNodeStatusesFromCards([result.card]);
      setSelectedCardIDs(new Set([result.card.card_id]));
      setSelectionAnchorCardID(result.card.card_id);
      setHighlightedEntity({ nodeID: result.card.node_id });
      cancelRenameNodeOnBlurRef.current = false;
      setRenameNodeDraft({ cardID: result.card.card_id, nodeID: result.card.node_id, title: result.card.node_title });
    } catch {
      setError("Node create failed");
      removeNodeRelationshipGraphNode(apiBase, companyID, nodeID);
      setHighlightedEntity((current) => (current?.nodeID === nodeID ? null : current));
      shouldRefresh = true;
    } finally {
      endMutation();
    }
    if (shouldRefresh) void refreshBoard(boardID);
  }, [apiBase, applyCards, beginLocalBoardMutation, boardID, companyID, refreshBoard, syncNodeStatusesFromCards]);

  const createNodeInArenaGroupCell = useCallback((columnGroupKey: string, rowGroupKey: string) => {
    setError("");
    setArenaCellContextMenu(null);
    const assignment = resolveKanbanGroupDropAssignment({
      columns: columnsRef.current,
      xGroupBy: arenaXGroupBy,
      xGroupKey: columnGroupKey,
      yGroupBy: arenaYGroupBy,
      yGroupKey: rowGroupKey,
    });
    if (!assignment.columnID) {
      setError("Status is required");
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(assignment, "priority") || assignment.priority == null) {
      setError("Priority is required");
      return;
    }
    void createNodeInColumn(assignment.columnID, assignment.priority);
  }, [arenaXGroupBy, arenaYGroupBy, createNodeInColumn]);

  const requestAddEntitiesToColumn = useCallback((columnID: string, items: ExplorerEntityDragItem[], anchor?: { x: number; y: number }) => {
    setError("");
    setArenaCellContextMenu(null);
    const logicGateID = logicGateIDFromKanbanBoardID(boardID);
    if (!logicGateID) {
      void addEntitiesToColumn(columnID, items);
      return;
    }
    const fallbackRect = boardRootRef.current?.getBoundingClientRect();
    setPriorityMenu({
      columnID,
      mode: "drop",
      items,
      x: anchor?.x ?? Math.round((fallbackRect?.left ?? 0) + 48),
      y: anchor?.y ?? Math.round((fallbackRect?.top ?? 0) + 72),
    });
  }, [addEntitiesToColumn, boardID]);

  const requestCreateNodeInColumn = useCallback((columnID: string, anchor?: { x: number; y: number }) => {
    setError("");
    setArenaCellContextMenu(null);
    const logicGateID = logicGateIDFromKanbanBoardID(boardID);
    if (!logicGateID) {
      setError("Select a Logic Gate board first");
      return;
    }
    const fallbackRect = boardRootRef.current?.getBoundingClientRect();
    setPriorityMenu({
      columnID,
      mode: "create",
      items: [],
      x: anchor?.x ?? Math.round((fallbackRect?.left ?? 0) + 48),
      y: anchor?.y ?? Math.round((fallbackRect?.top ?? 0) + 72),
    });
  }, [boardID]);

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
      requestAddEntitiesToColumn(columnID, explorerItems, { x: event.clientX, y: event.clientY });
    }
  }, [reorderCards, reorderColumn, requestAddEntitiesToColumn]);

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

  const setCardNodeCopyDragData = useCallback((dataTransfer: DataTransfer, cardIDs: string[]) => {
    const byCardID = new Map(cardsRef.current.map((item) => [item.card_id, item]));
    const seenNodeIDs = new Set<string>();
    const items: ExplorerEntityDragItem[] = [];
    for (const cardID of cardIDs) {
      const card = byCardID.get(cardID);
      const nodeID = card?.node_id.trim() ?? "";
      if (!card || !nodeID || seenNodeIDs.has(nodeID)) continue;
      seenNodeIDs.add(nodeID);
      items.push({ nodeID, label: card.node_title.trim() || nodeID });
    }
    if (items.length === 0) return;

    const explorerPayload = items.length === 1
      ? { kind: "node" as const, itemID: items[0].nodeID, itemType: "node" as const, sourceTreeID: `node-${items[0].nodeID}` }
      : {
        kind: "batch" as const,
        itemType: "node" as const,
        items: items.map((item) => ({ itemID: item.nodeID, itemType: "node" as const, treeID: `node-${item.nodeID}` })),
      };
    const entityPayload = items.length === 1
      ? { itemType: "node" as const, nodeID: items[0].nodeID, label: items[0].label }
      : { itemType: "node_batch" as const, nodes: items };

    dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(explorerPayload));
    dataTransfer.setData(EXPLORER_ENTITY_DRAG_MIME, serializeExplorerEntityDragPayload(entityPayload));
    dataTransfer.setData("text/plain", items.length === 1 ? items[0].label : `${items.length} nodes`);
  }, []);

  const renderCard = (card: KanbanCard, groupedCell?: KanbanArenaGroupedCellContext): React.ReactNode => {
    const highlighted = highlightedEntity?.nodeID === card.node_id;
    const selected = selectedCardIDs.has(card.card_id);
    const dragBefore = dragOverCard?.cardID === card.card_id && dragOverCard.placement === "before";
    const dragAfter = dragOverCard?.cardID === card.card_id && dragOverCard.placement === "after";
    const color = getKanbanConditionalColor(card, columnColorByID);
    const isRequestedCard = activeBoardIsLogicGate && isKanbanRequestedColumn({ column_id: card.column_id, title: columnTitleByID.get(card.column_id) ?? "" });
    const isRequestedForCurrentUser = false;
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
        text={text}
        subtext={subtext}
        accent={accent}
        editingTitle={renameNodeDraft?.cardID === card.card_id}
        renameTitleDraft={renameNodeDraft?.cardID === card.card_id ? renameNodeDraft.title : card.node_title}
        renameInputRef={renameNodeInputRef}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          selectCard(card.card_id, event);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openNodeEditorOverlay(card.node_id, card.node_title);
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
          setArenaCellContextMenu(null);
          setCardContextMenu({ x: event.clientX, y: event.clientY, cardID: card.card_id });
        }}
        onSetRenameTitleDraft={(title) => setRenameNodeDraft((current) => (current && current.cardID === card.card_id ? { ...current, title } : current))}
        onCommitRenameTitle={(title) => {
          if (cancelRenameNodeOnBlurRef.current) {
            cancelRenameNodeOnBlurRef.current = false;
            return;
          }
          void commitNodeRename(card.node_id, title);
        }}
        onCancelRenameTitle={() => {
          cancelRenameNodeOnBlurRef.current = true;
          setRenameNodeDraft(null);
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
          setArenaCellContextMenu(null);
          event.dataTransfer.effectAllowed = "copyMove";
          event.dataTransfer.setData(KANBAN_CARD_DRAG_MIME, JSON.stringify({ cardID: dragCardIDs[0], cardIDs: dragCardIDs, sourceColumnID: card.column_id }));
          setCardNodeCopyDragData(event.dataTransfer, dragCardIDs);
          attachStackedDragPreview(event.dataTransfer, getCardDragPreviewItems(dragCardIDs), color, "Kanban cards");
        }}
        onDragEnd={() => setDragOverCard(null)}
        onDragOver={(event) => {
          if (!dataTransferIncludes(event, KANBAN_CARD_DRAG_MIME) && !dataTransferIncludes(event, EXPLORER_ENTITY_DRAG_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          setDragOverCard({
            cardID: card.card_id,
            placement: dataTransferIncludes(event, KANBAN_CARD_DRAG_MIME) ? cardDropPlacement(event) : "after",
          });
        }}
        onDragLeave={() => setDragOverCard((previous) => (previous?.cardID === card.card_id ? null : previous))}
        onDrop={(event) => {
          const cardPayload = parseKanbanCardDragPayload(event.dataTransfer.getData(KANBAN_CARD_DRAG_MIME));
          if (cardPayload) {
            event.preventDefault();
            event.stopPropagation();
            if (groupedCell) {
              void moveCardsToArenaGroupCell(cardPayload.cardIDs, groupedCell.columnKey, groupedCell.rowKey, card.card_id, cardDropPlacement(event));
            } else {
              void reorderCards(cardPayload.cardIDs, card.column_id, card.card_id, cardDropPlacement(event));
            }
            return;
          }
          const explorerItems = parseExplorerEntityDragItems(event.dataTransfer.getData(EXPLORER_ENTITY_DRAG_MIME));
          if (explorerItems.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          setDragOverCard(null);
          requestAddEntitiesToColumn(card.column_id, explorerItems, { x: event.clientX, y: event.clientY });
        }}
        requestedActions={isRequestedForCurrentUser ? {
          busy: requestedCardActionID === card.card_id,
          onAccept: () => void resolveRequestedCard(card, true),
          onDecline: () => void resolveRequestedCard(card, false),
        } : undefined}
        requestedStatusText={isRequestedCard && currentUserID !== null && !isRequestedForCurrentUser ? "Request pending" : undefined}
      />
    );
  };

  const renderColumnView = (column: KanbanColumn, layout: "column" | "backlog" = "column"): React.ReactNode => {
    const columnCards = cardsByColumn.get(column.column_id) ?? [];
    return (
      <KanbanColumnView
        key={column.column_id}
        column={column}
        columnCards={columnCards}
        renderedCards={[
          ...columnCards.map((card) => renderCard(card)),
          <button
            key={`${column.column_id}-bottom-buffer`}
            type="button"
            aria-label={`Create node in ${column.title || "column"}`}
            title={`Create node in ${column.title || "column"}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              requestCreateNodeInColumn(column.column_id, { x: event.clientX, y: event.clientY });
            }}
            onDragOver={(event) => {
              if (!dataTransferIncludes(event, KANBAN_CARD_DRAG_MIME) && !dataTransferIncludes(event, EXPLORER_ENTITY_DRAG_MIME)) return;
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={(event) => {
              const cardPayload = parseKanbanCardDragPayload(event.dataTransfer.getData(KANBAN_CARD_DRAG_MIME));
              if (cardPayload) {
                event.preventDefault();
                event.stopPropagation();
                setDragOverCard(null);
                void reorderCards(cardPayload.cardIDs, column.column_id, null, "after");
                return;
              }
              const explorerItems = parseExplorerEntityDragItems(event.dataTransfer.getData(EXPLORER_ENTITY_DRAG_MIME));
              if (explorerItems.length === 0) return;
              event.preventDefault();
              event.stopPropagation();
              requestAddEntitiesToColumn(column.column_id, explorerItems, { x: event.clientX, y: event.clientY });
            }}
            style={{
              gridColumn: layout === "backlog" ? "1 / -1" : undefined,
              width: "100%",
              minHeight: KANBAN_COLUMN_BOTTOM_BUFFER_HEIGHT_PX,
              border: "1px dashed transparent",
              borderRadius: 8,
              background: "transparent",
              boxShadow: "none",
              cursor: "cell",
              flex: "0 0 auto",
              padding: 0,
            }}
          />,
        ]}
        accent={accent}
        line={line}
        subtext={subtext}
        text={text}
        laneBackground={laneBackground}
        laneBorder={laneBorder}
        laneShadow={laneShadow}
        draggingColumnID={draggingColumnID}
        dragOverColumnID={dragOverColumnID}
        resizeRef={resizeRef}
        onBlankMouseDown={clearCardSelectionFromBlankClick}
        onSetCardContextMenu={setCardContextMenu}
        onSetColumnContextMenu={setColumnContextMenu}
        onSetDraggingColumnID={setDraggingColumnID}
        onSetDragOverColumnID={setDragOverColumnID}
        onCreateNodeInColumn={(columnID, anchor) => requestCreateNodeInColumn(columnID, anchor)}
        onDropColumn={onDropColumn}
        dataTransferIncludes={dataTransferIncludes}
        showCreateNodeButton
        layout={layout}
        minimumColumnHeightPx={layout === "backlog" ? KANBAN_ARENA_BACKLOG_MIN_COLUMN_HEIGHT_PX : (arenaMode ? KANBAN_ARENA_DEFAULT_COLUMN_HEIGHT_PX : undefined)}
        stretchHeight={arenaMode && layout === "backlog"}
      />
    );
  };

  const contextColumn = columnContextMenu ? columns.find((column) => column.column_id === columnContextMenu.columnID) : null;
  const contextCard = cardContextMenu ? cards.find((card) => card.card_id === cardContextMenu.cardID) : null;
  const contextCardSelectionIDs = contextCard
    ? (selectedCardIDs.has(contextCard.card_id) ? Array.from(selectedCardIDs) : [contextCard.card_id])
    : [];
  const selectedCardsByID = useMemo(() => new Map(cards.map((card) => [card.card_id, card])), [cards]);
  const arenaCellContextSelectionIDs = arenaCellContextMenu
    ? Array.from(selectedCardIDs).filter((cardID) => selectedCardsByID.has(cardID))
    : [];
  const arenaCellContextCard = arenaCellContextMenu && arenaCellContextSelectionIDs.length > 0
    ? selectedCardsByID.get(arenaCellContextSelectionIDs.includes(selectionAnchorCardID) ? selectionAnchorCardID : arenaCellContextSelectionIDs[0]) ?? null
    : null;

  const openAccountAssignment = useCallback((card: KanbanCard) => {
    const node = arenaNodeByID.get(card.node_id);
    setCardContextMenu(null);
    setArenaCellContextMenu(null);
    setAccountAssignmentModal({
      cardID: card.card_id,
      nodeID: card.node_id,
      nodeTitle: card.node_title,
      accountIDs: (card.accounts?.length ? card.accounts : node?.accounts ?? []).map((account) => account.account_id),
    });
  }, [arenaNodeByID]);

  const saveAccountAssignment = useCallback(async () => {
    const modal = accountAssignmentModal;
    if (!modal || accountAssignmentBusy) return;
    const accountIDs = Array.from(new Set(modal.accountIDs.map((id) => id.trim()).filter(Boolean)));
    const nextAccounts = companyAccounts.filter((account) => accountIDs.includes(account.account_id));
    const previousCards = cardsRef.current;
    const previousNode = arenaNodeByID.get(modal.nodeID);
    setAccountAssignmentBusy(true);
    applyCards((current) => current.map((card) => (
      card.node_id === modal.nodeID ? { ...card, accounts: nextAccounts } : card
    )));
    if (previousNode) {
      upsertNodeRelationshipGraphNode(apiBase, companyID, { ...previousNode, accounts: nextAccounts });
    }
    try {
      const result = await setNodeAccountAssignments({
        companyID,
        nodeID: modal.nodeID,
        accountIDs,
      });
      const savedNode = result.node as NodeRecord | undefined;
      const savedAccounts = savedNode?.accounts ?? nextAccounts;
      applyCards((current) => current.map((card) => (
        card.node_id === modal.nodeID ? { ...card, accounts: savedAccounts } : card
      )));
      if (savedNode?.node_id) {
        upsertNodeRelationshipGraphNode(apiBase, companyID, savedNode);
        invalidateNodeRecordStoreCaches(apiBase, companyID, savedNode.node_id);
      }
      setAccountAssignmentModal(null);
    } catch (assignmentError) {
      applyCards(previousCards);
      if (previousNode) upsertNodeRelationshipGraphNode(apiBase, companyID, previousNode);
      setError(assignmentError instanceof Error ? assignmentError.message : "Account assignment failed");
    } finally {
      setAccountAssignmentBusy(false);
    }
  }, [accountAssignmentBusy, accountAssignmentModal, apiBase, applyCards, arenaNodeByID, companyAccounts, companyID]);

  const selectArenaYGroupBy = useCallback((field: KanbanGroupField) => {
    setArenaYGroupBy(field);
    setArenaYSortDirection(getDefaultKanbanYAxisSortDirection(field));
  }, []);

  const toggleArenaGroupingOpen = useCallback(() => {
    setArenaGroupMenuOpen(null);
    setArenaGroupingOpen((open) => !open);
  }, []);

  const accountFilterControl = (
    <AccountFilterControl
      accounts={companyAccounts}
      selectedAccountIDs={kanbanAccountFilterIDs}
      onChange={setKanbanAccountFilterIDs}
      label="Accounts"
      placeholder="Filter accounts"
      compact
      showLabel={!arenaMode}
      style={arenaMode ? { width: KANBAN_ARENA_ACCOUNT_FILTER_WIDTH_PX, maxWidth: KANBAN_ARENA_ACCOUNT_FILTER_WIDTH_PX } : { maxWidth: "min(420px, 100%)" }}
    />
  );

  return (
    <div
      ref={boardRootRef}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      style={{ position: "relative", width: "100%", height: "100%", boxSizing: "border-box", paddingTop: topClearancePx, background: surface, color: text, overflow: arenaMode ? "visible" : "hidden" }}
    >
      {topClearancePx > 0 && <div style={{ position: "absolute", top: topClearancePx - 1, left: 0, right: 0, borderBottom: `1px solid ${line}`, pointerEvents: "none" }} />}
      <KanbanBoardSidebar
        activeBoardTitle={activeBoardTitle}
        boardID={boardID}
        boardTitleDraft={boardTitleDraft}
        contentSearchQuery={contentSearchQuery}
        contentSearchPlaceholder={activeBoardIsLogicGate ? "Search this Logic Gate" : "Search this board"}
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
        compactArenaHeader={arenaMode}
        onSetBoardTitleDraft={setBoardTitleDraft}
        onSetContentSearchQuery={setContentSearchQuery}
        onSetEditingBoardTitle={setEditingBoardTitle}
        onToggleAllBoards={() => {
          setAllBoardsOpen((open) => !open);
          void refreshBoards();
        }}
        onCloseAllBoards={() => {
          setAllBoardsOpen(false);
        }}
        onCommitBoardTitle={(title) => void commitBoardTitle(title)}
        onRefreshBoards={() => void refreshBoards()}
        onSaveCurrentBoardView={() => void saveCurrentBoardView()}
        onCreateNewBoardView={() => void createNewBoardView()}
        onCollapseToTab={arenaMode ? onCollapseArenaToTab : undefined}
        timelineDragEntity={activeLogicGateID ? { kind: "logic_gate", id: activeLogicGateID, label: activeBoardTitle } : undefined}
        onSelectBoard={(nextBoardID) => {
          setSelectedCardIDs(new Set());
          setSelectionAnchorCardID("");
          setHighlightedEntity(null);
          setNodeEditorOverlay(null);
          lastLocalBoardSelectionChangedAtRef.current = Date.now();
          activeBoardIDRef.current = nextBoardID;
          setActiveBoardID(nextBoardID);
          setAllBoardsOpen(false);
          setContentSearchQuery("");
          const selectedBoard = boardRows.find((board) => board.board_id === nextBoardID);
          const selectedLogicGateID = selectedBoard?.logic_gate_id ?? logicGateIDFromKanbanBoardID(nextBoardID);
          setActiveLogicGateID(selectedLogicGateID);
          setActiveLogicGateLabel(selectedLogicGateID && selectedBoard ? getKanbanBoardDisplayTitle(selectedBoard) : "");
          publishKanbanBoardSelectionToLinkedFrames(companyID, frameID, nextBoardID, selectedBoard ? getKanbanBoardDisplayTitle(selectedBoard) : nextBoardID);
          void refreshBoard(nextBoardID);
        }}
      />
      <div className="kanban-board-scroll" style={{ position: "relative", height: "100%", overflow: "auto", padding: arenaMode ? "0 8px 14px 4px" : "12px 12px 14px", boxSizing: "border-box", background: isDark ? "transparent" : "linear-gradient(135deg, rgba(255,255,255,0.34), rgba(240,249,255,0.24) 44%, rgba(245,243,255,0.30))", display: arenaMode ? "flex" : undefined, flexDirection: arenaMode ? "column" : undefined, alignItems: arenaMode ? "stretch" : undefined, ["--kanban-board-scroll-accent" as string]: theme === "light" ? "rgb(71, 85, 105)" : accent, ["--kanban-board-scroll-track" as string]: isDark ? "rgba(255,255,255,0.08)" : "rgba(100, 116, 139, 0.08)" }}>
        {error && <div style={{ marginBottom: 8, color: "#b00020", fontSize: 11, fontWeight: 700 }}>{error}</div>}
        {!arenaMode && (
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "flex-end", minWidth: 0 }}>
            {accountFilterControl}
          </div>
        )}
        {arenaMode && (
          <div style={{ position: "relative", minWidth: boardColumnsMinWidth > 0 ? boardColumnsMinWidth : undefined, minHeight: KANBAN_ARENA_TOP_CONTROL_HEIGHT_PX, display: "flex", alignItems: "end", zIndex: 8 }}>
            <KanbanArenaGroupingControls controlsRef={arenaGroupControlsRef} groupingOpen={arenaGroupingOpen} onToggleGroupingOpen={toggleArenaGroupingOpen} xGroupBy={arenaXGroupBy} yGroupBy={arenaYGroupBy} xSortDirection={arenaXSortDirection} ySortDirection={arenaYSortDirection} menuOpen={arenaGroupMenuOpen} onSetMenuOpen={setArenaGroupMenuOpen} onSetXGroupBy={setArenaXGroupBy} onSetYGroupBy={selectArenaYGroupBy} onToggleXSortDirection={() => setArenaXSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))} onToggleYSortDirection={() => setArenaYSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))} isDark={isDark} line={line} cardBackground={cardBackground} text={text} />
            <div style={{ position: "absolute", bottom: 4, left: arenaAccountFilterLeftPx, width: KANBAN_ARENA_ACCOUNT_FILTER_WIDTH_PX, zIndex: 9 }}>
              {accountFilterControl}
            </div>
          </div>
        )}
        {arenaMode && arenaGroupingOpen ? <KanbanArenaGroupedBoard groupedBoard={arenaGroupedBoard} xGroupBy={arenaXGroupBy} yGroupBy={arenaYGroupBy} isDark={isDark} text={text} renderCard={renderCard} onDropCardIDsToCell={(cardIDs, columnKey, rowKey) => void moveCardsToArenaGroupCell(cardIDs, columnKey, rowKey)} onCreateNodeInCell={createNodeInArenaGroupCell} onCellContextMenu={(columnKey, rowKey, event) => {
          setCardContextMenu(null);
          setColumnContextMenu(null);
          setPriorityMenu(null);
          setArenaCellContextMenu({ x: event.clientX, y: event.clientY, columnKey, rowKey });
        }} /> : (
        <div style={{ display: "grid", alignItems: "start", gap: useBottomLaneLayout ? 12 : 0, gridTemplateRows: arenaMode && useBottomLaneLayout ? `${boardMinColumnHeightPx + 18}px minmax(${KANBAN_ARENA_BACKLOG_MIN_COLUMN_HEIGHT_PX}px, 1fr)` : undefined, minWidth: boardColumnsMinWidth > 0 ? boardColumnsMinWidth : undefined, width: arenaMode ? "100%" : undefined, flex: arenaMode ? "1 0 auto" : undefined, minHeight: arenaMode ? 0 : undefined, opacity: loading && columns.length === 0 && cards.length === 0 ? 0.72 : 1 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: boardMinColumnHeightPx + 18, paddingBottom: useBottomLaneLayout ? 0 : 16 }}>
            {mainBoardColumns.map((column) => renderColumnView(column))}
            {!arenaMode && !activeBoardIsLogicGate && <button
            className="mango-elevated-action"
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
              border: "1px solid transparent",
              borderRadius: 16,
              background: `${KANBAN_SURFACE} padding-box, ${KANBAN_EDGE_FRAME} border-box`,
              color: "#111111",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              fontSize: 34,
              fontWeight: 500,
              lineHeight: 1,
              boxShadow: addColumnHover ? "0 12px 28px rgba(15, 23, 42, 0.14), 0 0 16px rgba(183, 124, 255, 0.22), inset 1px 1px 0 rgba(255,255,255,0.86)" : "7px 7px 16px rgba(174, 174, 192, 0.22), -7px -7px 16px rgba(255, 255, 255, 0.88), inset 1px 1px 0 rgba(255,255,255,0.86)",
              transition: "box-shadow 120ms ease, transform 120ms ease",
              transform: addColumnHover ? "translateY(-1px)" : "none",
            }}
          >
            +
            </button>}
          </div>
          {useBottomLaneLayout && (
            <div style={{ display: "grid", gridTemplateColumns: bottomLaneGridTemplateColumns || undefined, gap: 10, alignItems: arenaMode ? "stretch" : "start", height: arenaMode ? "100%" : undefined, paddingBottom: 16, boxSizing: "border-box" }}>
              {bottomLaneColumns.map((column) => renderColumnView(column, "backlog"))}
            </div>
          )}
        </div>
        )}
      </div>
      <KanbanContextMenus
        contextColumn={contextColumn ?? null}
        columnContextMenu={columnContextMenu}
        contextCard={contextCard ?? null}
        cardContextMenu={cardContextMenu}
        arenaMode={arenaMode}
        contextCardSelectionIDs={contextCardSelectionIDs}
        onCloseColumnMenu={() => setColumnContextMenu(null)}
        onCloseCardMenu={() => setCardContextMenu(null)}
        onCreateNodeInColumn={(columnID, anchor) => {
          setColumnContextMenu(null);
          requestCreateNodeInColumn(columnID, anchor);
        }}
        onToggleCardIssue={(card, isIssue) => void toggleCardIssue(card, isIssue)}
        onAssignAccounts={openAccountAssignment}
        onRenameNode={requestNodeRename}
        onRequestNodeDeleteFromCards={requestNodeDeleteFromCards}
        onRequestCardDelete={requestCardDelete}
      />
      {arenaCellContextMenu && (
        <FrameRightClickMenu x={arenaCellContextMenu.x} y={arenaCellContextMenu.y} onClose={() => setArenaCellContextMenu(null)}>
          <button
            type="button"
            style={contextMenuButtonStyle}
            onClick={() => {
              const menu = arenaCellContextMenu;
              setArenaCellContextMenu(null);
              createNodeInArenaGroupCell(menu.columnKey, menu.rowKey);
            }}
            {...contextMenuHoverHandlers}
          >
            Create new node
          </button>
          {arenaCellContextCard && (
            <>
              <button
                type="button"
                style={contextMenuButtonStyle}
                onClick={() => {
                  requestAppSidebarPin({ kind: "node", id: arenaCellContextCard.node_id, label: arenaCellContextCard.node_title });
                  setArenaCellContextMenu(null);
                }}
                {...contextMenuHoverHandlers}
              >
                Pin Node
              </button>
              <button type="button" style={contextMenuButtonStyle} onClick={() => requestNodeRename(arenaCellContextCard)} {...contextMenuHoverHandlers}>
                Rename node
              </button>
              <button type="button" style={contextMenuButtonStyle} onClick={() => openAccountAssignment(arenaCellContextCard)} {...contextMenuHoverHandlers}>
                Assign accounts
              </button>
              <button type="button" style={{ ...contextMenuButtonStyle, color: "#334155" }} onClick={() => requestNodeDeleteFromCards(arenaCellContextSelectionIDs)} {...contextMenuHoverHandlers}>
                {arenaCellContextSelectionIDs.length > 1 ? "Delete nodes" : "Delete node"}
              </button>
              <button type="button" style={contextMenuButtonStyle} onClick={() => requestCardDelete(arenaCellContextSelectionIDs)} {...contextMenuHoverHandlers}>
                {arenaCellContextSelectionIDs.length > 1 ? "Remove nodes from Kanban Board" : "Remove node from Kanban Board"}
              </button>
            </>
          )}
        </FrameRightClickMenu>
      )}
      {priorityMenu && (
        <FrameRightClickMenu x={priorityMenu.x} y={priorityMenu.y} onClose={() => setPriorityMenu(null)}>
          {KANBAN_NODE_PRIORITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              style={contextMenuButtonStyle}
              onClick={() => {
                const menu = priorityMenu;
                setPriorityMenu(null);
                if (menu.mode === "create") {
                  void createNodeInColumn(menu.columnID, option.value);
                } else {
                  void addEntitiesToColumn(menu.columnID, menu.items, option.value);
                }
              }}
              {...contextMenuHoverHandlers}
            >
              {option.label}
            </button>
          ))}
        </FrameRightClickMenu>
      )}
      {nodeEditorOverlay && (
        <KanbanNodeEditorOverlay
          overlay={nodeEditorOverlay}
          ratio={nodeEditorOverlayRatio}
          boardRootRef={boardRootRef}
          resizeRef={nodeEditorOverlayResizeRef}
          frameID={frameID}
          accent={accent}
          theme={theme}
          onClose={() => closeNodeEditorOverlay()}
          onCollapseToTab={collapseNodeEditorOverlayToTab}
        />
      )}
      {accountAssignmentModal && (
        <KanbanAccountAssignmentModal
          title={accountAssignmentModal.nodeTitle}
          accounts={companyAccounts}
          selectedAccountIDs={accountAssignmentModal.accountIDs}
          busy={accountAssignmentBusy}
          onChange={(accountIDs) => setAccountAssignmentModal((current) => current ? { ...current, accountIDs } : current)}
          onSave={() => void saveAccountAssignment()}
          onCancel={() => setAccountAssignmentModal(null)}
        />
      )}
      <KanbanDeleteConfirmations
        deleteNodeConfirmation={deleteNodeConfirmation}
        deleteCardConfirmation={deleteCardConfirmation}
        onRemoveNodes={(nodeIDs) => {
          void removeNodes(nodeIDs);
          setDeleteNodeConfirmation(null);
        }}
        onRemoveCards={(cardIDs) => {
          void removeCards(cardIDs);
          setDeleteCardConfirmation(null);
        }}
        onCancelNodeDelete={() => setDeleteNodeConfirmation(null)}
        onCancelCardDelete={() => setDeleteCardConfirmation(null)}
      />
    </div>
  );
};
