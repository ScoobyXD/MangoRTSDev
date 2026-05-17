import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type NodeRecord } from "../node-map/shared";
import { LogicGateRecord as LogicGateApiRecord, NodeRecord as LogicGateRecord, toLogicGateCanvasRecord } from "../logic-gate-map/shared";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, EVENT_LOGIC_GATE_MAP_FOCUS_REQUESTED, EVENT_NODE_MAP_FOCUS_REQUESTED } from "../node-map/eventbus";
import { getNodeRelationshipGraphSnapshot, hasNodeRelationshipGraphSnapshot, refreshNodeRelationshipGraphSnapshot, removeCompanyExplorerFolderInNodeRelationshipGraph, removeNodeRelationshipGraphNode, removeNodeRelationshipGraphRelationshipsForNode, subscribeNodeRelationshipGraph, upsertCompanyExplorerFolderInNodeRelationshipGraph, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../node-map/NodeRelationshipGraph";
import { getLogicGateRelationshipGraphSnapshot, hasLogicGateRelationshipGraphSnapshot, refreshLogicGateRelationshipGraphSnapshot, removeCompanyExplorerFolderInLogicGateRelationshipGraph, removeLogicGateRelationshipGraphNode, removeLogicGateRelationshipGraphRelationshipsForLogicGate, subscribeLogicGateRelationshipGraph, upsertCompanyExplorerFolderInLogicGateRelationshipGraph, upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../logic-gate-map/LogicGateRelationshipGraph";
import { type ExplorerSelectionState } from "./explorerSync";
import { type CompanyExplorerFolder, type CompanyExplorerFolderItem, type CompanyExplorerFolderKind, type CompanyExplorerItemType, type CompanyExplorerSystemFolderKey } from "../folders/companyExplorerFolders";
import { invalidateKanbanBoardListCache, listKanbanBoards } from "../kanban/kanbanApi";
import { EVENT_KANBAN_BOARDS_UPDATED, logicGateKanbanBoardID, type ExplorerEntityDragItem, type KanbanBoard, type KanbanBoardsUpdatedDetail } from "../kanban/shared";
import { type SelectionIntent } from "../selectionCoordinator";
import { subscribeWorkspaceStream } from "../workspace/workspaceStream";
import { createMapEntityBatchClientID, createMapEntityBatchCommand } from "../node-map/nodeMapCommands";
import { buildExplorerFindSelection, buildExplorerRowBatchReorderPlan, buildExplorerRowReorderPlan, buildExplorerSearchResults, getExplorerDropPayloadItemType, getExplorerDropPayloadItems, getExplorerScrollTopForRow, isExplorerSystemFolderKey, resolveExplorerClickSelection, resolveExplorerCreationTargets, resolveExplorerDeleteTarget, resolveExplorerRenameTarget, type ExplorerFindEntity } from "./treePresentation";
import { CompanyExplorerContextMenu } from "./CompanyExplorerContextMenu";
import { CompanyExplorerDeleteBlockedDialog, CompanyExplorerDeleteConfirmationDialog, CompanyExplorerFolderShareDialogView } from "./CompanyExplorerDialogs";
import { CompanyExplorerTree } from "./CompanyExplorerTree";
import {
  collectFolderSubtreeIDs,
  explorerRowOrder,
  getExplorerFindTarget,
  getExplorerItemPayload,
  getExplorerRowContainerID,
  getExplorerRowOrderKind,
  getExplorerSelectionDomain,
  readExpandedRowsFromStorage,
  readRootRowOrderFromStorage,
  readScrollTopFromStorage,
  TREE_ROW_POSITION_STEP,
} from "./companyExplorerDragDrop";
import {
  type CompanyExplorerContextMenuState,
  type ExplorerDeleteTargetWithLabel,
  type ExplorerDragPayload,
  type ExplorerFindTarget,
  type ExplorerRenameDraft,
  type ExplorerRowDropPlacement,
  type ExplorerRowOrderUpdate,
  type ExplorerSelectionDomain,
  type ExplorerTreeNode,
} from "./companyExplorerTypes";
import { useCompanyExplorerKeyboard } from "./useCompanyExplorerKeyboard";
import { useCompanyExplorerSelectionBridge } from "./useCompanyExplorerSelectionBridge";
import { useCompanyExplorerTreeModel } from "./useCompanyExplorerTreeModel";
import { COMPANY_EXPLORER_TREE_ROW_HEIGHT, useCompanyExplorerVirtualTree } from "./useCompanyExplorerVirtualTree";
import { buildCompanyExplorerTreeRows, buildScopedCompanyExplorerTreeRows, findCompanyExplorerRootFolderByName } from "./companyExplorerTreeRows";
import { useCompanyExplorerFolderShares } from "./useCompanyExplorerFolderShares";
import { getActiveCompanyID } from "../../auth/currentCompany";
import {
  buildDeleteConfirmationSummary,
  findProtectedSystemFolderInDeleteTargets,
  getSystemFolderKeyForTreeRowID,
  type CompanyExplorerContentProps,
  type CompanyExplorerDeleteBatchResponse,
  type CompanyExplorerFolderItemAssignment,
  type CompanyExplorerFolderItemsBatchResponse,
  type CompanyExplorerMapEntityBatchResponse,
  type WorkspaceStreamEnvelope,
} from "./CompanyExplorerContentModel";

const scopedRootCreationKeys = new Set<string>();

// Company Explorer module: tree navigation + node context handoff into Node Map and Editor.
export const CompanyExplorerContent: React.FC<CompanyExplorerContentProps> = ({
  accent,
  widgetId,
  hideTopControls = false,
  theme = "mango",
  selectionTargetFrameIDs,
  scopedRootFolderKind,
  scopedRootFolderName = "",
}) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = getActiveCompanyID();
  const scope = widgetId?.trim() ? widgetId : "global";
  const normalizedSelectionTargetFrameIDs = useMemo(() => (
    Array.from(new Set((selectionTargetFrameIDs ?? []).map((id) => id.trim()).filter(Boolean)))
  ), [selectionTargetFrameIDs]);
  const expandedStorageKey = `company-explorer-expanded-v1:${companyID}:${scope}`;
  const scrollStorageKey = `company-explorer-scroll-v1:${companyID}:${scope}`;
  const rootOrderStorageKey = `company-explorer-root-order-v1:${companyID}:${scope}`;

  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [logicGates, setLogicGates] = useState<LogicGateRecord[]>([]);
  const [kanbanBoards, setKanbanBoards] = useState<KanbanBoard[]>([]);
  const [folders, setFolders] = useState<CompanyExplorerFolder[]>([]);
  const [folderItems, setFolderItems] = useState<CompanyExplorerFolderItem[]>([]);
  const [folderSnapshotLoaded, setFolderSnapshotLoaded] = useState(false);
  const [selectedTreeID, setSelectedTreeID] = useState("folder-root");
  const [selectedTreeIDs, setSelectedTreeIDs] = useState<Set<string>>(new Set(["folder-root"]));
  const [selectionAnchorTreeID, setSelectionAnchorTreeID] = useState("folder-root");
  const [selectedNodeID, setSelectedNodeID] = useState("");
  const [selectedLogicGateID, setSelectedLogicGateID] = useState("");
  const [selectedKanbanBoardID, setSelectedKanbanBoardID] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpandedRowsFromStorage(expandedStorageKey));
  const selectedTreeIDRef = useRef(selectedTreeID);
  const expandedRef = useRef(expanded);
  const defaultExpansionAppliedRef = useRef(false);
  const treeRowsRef = useRef<ExplorerTreeNode[]>([]);
  const pendingScrollTreeIDRef = useRef("");
  const [renaming, setRenaming] = useState<ExplorerRenameDraft | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const cancelRenameOnBlurRef = useRef(false);
  const renameCommitInFlightRef = useRef(false);
  const treeViewportRef = useRef<HTMLDivElement | null>(null);
  const treeKeyboardActiveRef = useRef(false);
  const [treeScrollTop, setTreeScrollTop] = useState(() => readScrollTopFromStorage(scrollStorageKey));
  const [treeViewportHeight, setTreeViewportHeight] = useState(480);
  const [rootRowOrder, setRootRowOrder] = useState<Record<string, number>>(() => readRootRowOrderFromStorage(rootOrderStorageKey));
  const [draggingTreeID, setDraggingTreeID] = useState("");
  const [dragOverTreeID, setDragOverTreeID] = useState("");
  const [dragOverPlacement, setDragOverPlacement] = useState<ExplorerRowDropPlacement | null>(null);
  const [dragPayload, setDragPayload] = useState<ExplorerDragPayload | null>(null);
  const [explorerContextMenu, setExplorerContextMenu] = useState<CompanyExplorerContextMenuState | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ targets: ExplorerDeleteTargetWithLabel[] } | null>(null);
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState("");
  const [deleteFolderAcknowledged, setDeleteFolderAcknowledged] = useState(false);
  const [explorerSearchQuery, setExplorerSearchQuery] = useState("");
  const [explorerSearchFocused, setExplorerSearchFocused] = useState(false);
  const [linkRevision, setLinkRevision] = useState(0);
  const [linkedMapFrameID, setLinkedMapFrameID] = useState("");
  const [linkedLogicMapFrameID, setLinkedLogicMapFrameID] = useState("");
  const lastMapSelectionRevisionRef = useRef(0);
  const lastLogicMapSelectionRevisionRef = useRef(0);
  const suppressNextExplorerBroadcastRef = useRef(false);
  const previousBroadcastSelectionRef = useRef({ selectedNodeID: "", selectedTreeID: "" });
  const latestSelectionRef = useRef<ExplorerSelectionState>({ selectedNodeID: "", selectedTreeID: "" });
  const latestLogicGateSelectionRef = useRef({ selectedLogicGateID: "", selectedTreeID: "" });
  const latestExplorerDomainRef = useRef<ExplorerSelectionDomain>("root");
  const lastLocalExplorerSelectionRef = useRef<{ domain: ExplorerSelectionDomain; changedAt: number }>({ domain: "root", changedAt: 0 });
  const pendingExplorerSelectionIntentRef = useRef<SelectionIntent>("activate");
  const explorerContextSequenceRef = useRef(0);
  const pendingScrollAlignRef = useRef<"nearest" | "center">("nearest");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!hasNodeRelationshipGraphSnapshot(apiBase, companyID)) {
          await refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
        }
        if (cancelled) return;
        const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
        setNodes(snapshot.nodes ?? []);
        setFolders(snapshot.folders ?? []);
        setFolderItems(snapshot.folder_items ?? []);
        setFolderSnapshotLoaded(true);
      } catch {
        // ignore initial load failures; subscription updates can still hydrate state later
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, companyID]);

  useEffect(() => {
    return subscribeNodeRelationshipGraph(apiBase, companyID, () => {
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      setNodes(snapshot.nodes ?? []);
      setFolders(snapshot.folders ?? []);
      setFolderItems(snapshot.folder_items ?? []);
      setFolderSnapshotLoaded(true);
    });
  }, [apiBase, companyID]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!hasLogicGateRelationshipGraphSnapshot(apiBase, companyID)) {
          await refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID);
        }
        if (cancelled) return;
        const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
        setLogicGates(snapshot.nodes ?? []);
        if ((snapshot.folders ?? []).length > 0 || (snapshot.folder_items ?? []).length > 0) {
          setFolders(snapshot.folders ?? []);
          setFolderItems(snapshot.folder_items ?? []);
        }
        setFolderSnapshotLoaded(true);
      } catch {
        // Logic Gate Map has its own graph cache; subscription updates can still hydrate later.
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, companyID]);

  useEffect(() => {
    return subscribeLogicGateRelationshipGraph(apiBase, companyID, () => {
      const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
      setLogicGates(snapshot.nodes ?? []);
      if ((snapshot.folders ?? []).length > 0 || (snapshot.folder_items ?? []).length > 0) {
        setFolders(snapshot.folders ?? []);
        setFolderItems(snapshot.folder_items ?? []);
      }
      setFolderSnapshotLoaded(true);
    });
  }, [apiBase, companyID]);

  const refreshKanbanBoards = useCallback(async () => {
    try {
      // The Explorer tree renders a bounded first window. Board creation and
      // placement stay API-first so headless agents use the same commands.
      setKanbanBoards(await listKanbanBoards(apiBase, companyID, 200));
    } catch {
      // Keep Explorer usable even if Kanban endpoints are temporarily offline.
    }
  }, [apiBase, companyID]);

  useEffect(() => {
    void refreshKanbanBoards();
  }, [refreshKanbanBoards]);

  useEffect(() => {
    const onKanbanBoardsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<KanbanBoardsUpdatedDetail>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      invalidateKanbanBoardListCache(apiBase, companyID);
      if (detail?.deletedBoardID) {
        setKanbanBoards((previous) => previous.filter((board) => board.board_id !== detail.deletedBoardID));
        setFolderItems((previous) => previous.filter((item) => item.item_type !== "kanban" || item.item_id !== detail.deletedBoardID));
        return;
      }
      if (detail?.board) {
        setKanbanBoards((previous) => {
          const next = [
            ...previous.filter((board) => board.board_id !== detail.board!.board_id),
            detail.board!,
          ];
          return next.sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp) || a.board_id.localeCompare(b.board_id));
        });
        return;
      }
      void refreshKanbanBoards();
    };
    window.addEventListener(EVENT_KANBAN_BOARDS_UPDATED, onKanbanBoardsUpdated);
    return () => window.removeEventListener(EVENT_KANBAN_BOARDS_UPDATED, onKanbanBoardsUpdated);
  }, [apiBase, companyID, refreshKanbanBoards]);

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
            setKanbanBoards((previous) => {
              const next = [
                ...previous.filter((item) => item.board_id !== board.board_id),
                board,
              ];
              return next.sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp) || a.board_id.localeCompare(b.board_id));
            });
            return;
          }
          if (envelope.type === "kanban_board_deleted") {
            const boardID = typeof data.board_id === "string" ? data.board_id : "";
            if (!boardID) return;
            invalidateKanbanBoardListCache(apiBase, companyID);
            setKanbanBoards((previous) => previous.filter((board) => board.board_id !== boardID));
            setFolderItems((previous) => previous.filter((item) => item.item_type !== "kanban" || item.item_id !== boardID));
          }
        } catch {
          // The stream is best-effort UI sync; the explicit refresh path remains available.
        }
      },
    });
  }, [apiBase, companyID]);

  const scopedRootName = scopedRootFolderName.trim();
  const scopedKind = scopedRootName ? (scopedRootFolderKind ?? "logic_gate") : undefined;
  const scopedExplorerActive = Boolean(scopedKind && scopedRootName);
  const scopedRootFolder = useMemo(() => (
    scopedKind && scopedRootName
      ? findCompanyExplorerRootFolderByName(folders, scopedKind, scopedRootName)
      : null
  ), [folders, scopedKind, scopedRootName]);
  const scopedRootTreeID = scopedRootFolder ? `workspace-folder-${scopedRootFolder.folder_id}` : "";
  const effectiveExpanded = useMemo(() => {
    if (!scopedRootTreeID || expanded.has(scopedRootTreeID)) return expanded;
    return new Set(expanded).add(scopedRootTreeID);
  }, [expanded, scopedRootTreeID]);

  const {
    treeRows: fullTreeRows,
    selectedTree: fullSelectedTree,
    rowByID: fullRowByID,
    selectedFolderKind,
    selectedFolderID,
    selectedFolderLabel,
    selectedKanbanBoardLabel,
  } = useCompanyExplorerTreeModel({
    expanded: effectiveExpanded,
    nodes,
    logicGates,
    kanbanBoards,
    folders,
    folderItems,
    rootRowOrder,
    selectedTreeID,
    treeViewportHeight,
    treeScrollTop,
  });
  const scopedRootRow = scopedRootTreeID ? fullRowByID.get(scopedRootTreeID) : undefined;
  const treeRows = useMemo(() => (
    scopedExplorerActive
      ? (scopedRootFolder ? buildScopedCompanyExplorerTreeRows(fullTreeRows, scopedRootFolder.folder_id) : [])
      : fullTreeRows
  ), [fullTreeRows, scopedExplorerActive, scopedRootFolder]);
  const rowByID = useMemo(() => new Map(treeRows.map((row) => [row.id, row])), [treeRows]);
  const selectedTree = rowByID.get(selectedTreeID) ?? (scopedRootFolder ? scopedRootRow : fullSelectedTree);
  const virtualizedTree = useCompanyExplorerVirtualTree(treeRows, treeViewportHeight, treeScrollTop);
  const scopedAllowedItemType: CompanyExplorerItemType | "" = scopedKind ?? "";
  const systemFolderTreeIDByKey = useMemo(() => {
    const items = new Map<CompanyExplorerSystemFolderKey, string>();
    for (const folder of folders) {
      if (isExplorerSystemFolderKey(folder.system_key)) {
        items.set(folder.system_key, `workspace-folder-${folder.folder_id}`);
      }
    }
    return items;
  }, [folders]);

  const explorerSearchResults = useMemo(() => {
    const expandedForSearch = new Set<string>(["folder-root"]);
    for (const folder of folders) expandedForSearch.add(`workspace-folder-${folder.folder_id}`);
    const rows = buildCompanyExplorerTreeRows({
      expanded: expandedForSearch,
      nodes,
      logicGates,
      kanbanBoards,
      folders,
      folderItems,
      rootRowOrder,
    });
    const searchRows = scopedExplorerActive
      ? (scopedRootFolder ? buildScopedCompanyExplorerTreeRows(rows, scopedRootFolder.folder_id) : [])
      : rows;
    return buildExplorerSearchResults({ rows: searchRows, selectedRowID: selectedTreeID, query: explorerSearchQuery, limit: 16 });
  }, [explorerSearchQuery, folderItems, folders, kanbanBoards, logicGates, nodes, rootRowOrder, scopedExplorerActive, scopedRootFolder, selectedTreeID]);
  const explorerSearchOpen = explorerSearchFocused && explorerSearchQuery.trim().length > 0;

  useEffect(() => {
    selectedTreeIDRef.current = selectedTreeID;
  }, [selectedTreeID]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    treeRowsRef.current = treeRows;
  }, [treeRows]);

  useEffect(() => {
    latestSelectionRef.current = { selectedNodeID, selectedTreeID };
  }, [selectedNodeID, selectedTreeID]);

  useEffect(() => {
    latestLogicGateSelectionRef.current = { selectedLogicGateID, selectedTreeID };
  }, [selectedLogicGateID, selectedTreeID]);

  const renamingTreeID = renaming?.treeID ?? "";

  useEffect(() => {
    if (!renamingTreeID || !renameInputRef.current) return;
    const input = renameInputRef.current;
    input.focus();
    input.select();
  }, [renamingTreeID]);

  useEffect(() => {
    if (!treeViewportRef.current) return;
    const measure = () => {
      const height = treeViewportRef.current?.clientHeight ?? 0;
      if (height > 0) setTreeViewportHeight(height);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (defaultExpansionAppliedRef.current) return;
    try {
      if (localStorage.getItem(expandedStorageKey) != null) {
        defaultExpansionAppliedRef.current = true;
        return;
      }
    } catch {
      // If local storage is blocked, still apply the first-open default.
    }
    const logicGateDefaultsRoot = folders.find((folder) =>
      folder.folder_kind === "logic_gate"
      && !folder.parent_folder_id
      && folder.name.trim().toLowerCase() === "logic gates"
    );
    if (!logicGateDefaultsRoot) return;
    defaultExpansionAppliedRef.current = true;
    setExpanded((previous) => {
      const next = new Set(previous);
      next.add(`workspace-folder-${logicGateDefaultsRoot.folder_id}`);
      return next;
    });
  }, [expandedStorageKey, folders]);

  useEffect(() => {
    if (!scopedRootTreeID) return;
    setExpanded((previous) => previous.has(scopedRootTreeID) ? previous : new Set(previous).add(scopedRootTreeID));
  }, [scopedRootTreeID]);

  useEffect(() => {
    try {
      localStorage.setItem(expandedStorageKey, JSON.stringify([...expanded]));
    } catch {
      // Expanded rows are per-device UI state; storage failure should not block navigation.
    }
  }, [expanded, expandedStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(scrollStorageKey, String(Math.max(0, Math.round(treeScrollTop))));
    } catch {
      // Scroll position is a local convenience only.
    }
  }, [scrollStorageKey, treeScrollTop]);

  useEffect(() => {
    try {
      localStorage.setItem(rootOrderStorageKey, JSON.stringify(rootRowOrder));
    } catch {
      // Root-level order for unplaced rows is intentionally per-device view state.
    }
  }, [rootOrderStorageKey, rootRowOrder]);

  useEffect(() => {
    const viewport = treeViewportRef.current;
    if (!viewport) return;
    const nextScrollTop = Math.max(0, Math.round(treeScrollTop));
    if (Math.abs(viewport.scrollTop - nextScrollTop) > 1) viewport.scrollTop = nextScrollTop;
  }, [treeRows.length, treeScrollTop]);

  const requestJSON = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiBase}${path}`, { ...init, headers });
    if (!response.ok) {
      let reason = `request_failed_${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.error) reason = payload.error;
      } catch {
        // keep status fallback
      }
      throw new Error(reason);
    }
    return response.json() as Promise<T>;
  }, [apiBase]);

  const {
    closeFolderShareDialog,
    folderShareDialog,
    openFolderShareDialog,
    refreshFolderShares,
    removeFolderShare,
    submitFolderShare,
    updateFolderShareEmail,
  } = useCompanyExplorerFolderShares(companyID, requestJSON);

  useEffect(() => {
    if (!companyID || !folderSnapshotLoaded || !scopedKind || !scopedRootName || scopedRootFolder) return;
    const creationKey = `${companyID}:${scopedKind}:${scopedRootName.toLowerCase()}`;
    if (scopedRootCreationKeys.has(creationKey)) return;
    let cancelled = false;
    scopedRootCreationKeys.add(creationKey);
    setError("");
    requestJSON<CompanyExplorerFolder>("/v1/company-explorer/folders", {
      method: "POST",
      body: JSON.stringify({
        company_id: companyID,
        parent_folder_id: "",
        folder_kind: scopedKind,
        name: scopedRootName,
      }),
    }).then((folder) => {
      upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folder);
      upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folder);
      if (cancelled) return;
      setFolders((previous) => previous.some((item) => item.folder_id === folder.folder_id) ? previous : [...previous, folder]);
      setExpanded((previous) => new Set(previous).add(`workspace-folder-${folder.folder_id}`));
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "failed_to_create_scoped_folder");
    }).finally(() => {
      scopedRootCreationKeys.delete(creationKey);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, companyID, folderSnapshotLoaded, requestJSON, scopedKind, scopedRootFolder, scopedRootName]);

  const createFolder = useCallback(async (folderKind: CompanyExplorerFolderKind, parentFolderID: string, position?: number) => {
    setError("");
    try {
      let folder = await requestJSON<CompanyExplorerFolder>("/v1/company-explorer/folders", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          parent_folder_id: parentFolderID,
          folder_kind: folderKind,
          name: "New Folder",
        }),
      });
      if (position && position > 0) {
        folder = await requestJSON<CompanyExplorerFolder>(`/v1/company-explorer/folders/${folder.folder_id}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, position }),
        });
      }
      setFolders((previous) => previous.some((item) => item.folder_id === folder.folder_id) ? previous : [...previous, folder]);
      setExpanded((previous) => {
        const next = new Set(previous);
        next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root");
        next.add(`workspace-folder-${folder.folder_id}`);
        return next;
      });
      upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folder);
      upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folder);
      lastLocalExplorerSelectionRef.current = { domain: folderKind, changedAt: Date.now() };
      pendingExplorerSelectionIntentRef.current = "activate";
      setSelectedTreeID(`workspace-folder-${folder.folder_id}`);
      setSelectedTreeIDs(new Set([`workspace-folder-${folder.folder_id}`]));
      setSelectionAnchorTreeID(`workspace-folder-${folder.folder_id}`);
      setSelectedNodeID("");
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_folder");
    }
  }, [apiBase, companyID, requestJSON]);

  const assignItemsToFolders = useCallback(async (assignments: CompanyExplorerFolderItemAssignment[], options: { expandTarget?: boolean } = {}) => {
    const normalizedAssignments = assignments.filter((assignment) => assignment.folder_id && assignment.item_id && assignment.item_type);
    if (normalizedAssignments.length === 0) return true;
    const previousFolderIDByKey = new Map(folderItems.map((row) => [`${row.item_type}:${row.item_id}`, row.folder_id]));
    setError("");
    try {
      const payload = await requestJSON<CompanyExplorerFolderItemsBatchResponse>("/v1/company-explorer/folder-items/batch", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          assignments: normalizedAssignments,
        }),
      });
      const items = payload.folder_items ?? [];
      setFolderItems((previous) => {
        let next = previous;
        for (const item of items) {
          const exists = next.some((row) => row.item_type === item.item_type && row.item_id === item.item_id);
          next = exists
            ? next.map((row) => (row.item_type === item.item_type && row.item_id === item.item_id ? item : row))
            : [...next, item];
        }
        return next;
      });
      for (const item of items) {
        upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, item);
        upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, item);
        if (previousFolderIDByKey.get(`${item.item_type}:${item.item_id}`) !== item.folder_id) {
          // Moving between folder levels starts a new local context. Drop stale
          // edges immediately; the API performs the same cleanup canonically.
          if (item.item_type === "node") removeNodeRelationshipGraphRelationshipsForNode(apiBase, companyID, item.item_id);
          else if (item.item_type === "logic_gate") removeLogicGateRelationshipGraphRelationshipsForLogicGate(apiBase, companyID, item.item_id);
        }
      }
      if (options.expandTarget) {
        setExpanded((previous) => {
          const next = new Set(previous);
          for (const assignment of normalizedAssignments) next.add(`workspace-folder-${assignment.folder_id}`);
          return next;
        });
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_move_item");
      return false;
    }
  }, [apiBase, companyID, folderItems, requestJSON]);

  const upsertOptimisticFolderItem = useCallback((item: CompanyExplorerFolderItem) => {
    setFolderItems((previous) => {
      const exists = previous.some((row) => row.item_type === item.item_type && row.item_id === item.item_id);
      return exists
        ? previous.map((row) => (row.item_type === item.item_type && row.item_id === item.item_id ? item : row))
        : [...previous, item];
    });
    upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, item);
    upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, item);
  }, [apiBase, companyID]);

  const expandCreatedItemTarget = useCallback((parentFolderID: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root");
      return next;
    });
  }, []);

  const createNodeAtFolder = useCallback(async (parentFolderID: string, position?: number) => {
    setError("");
    try {
      const response = await createMapEntityBatchCommand<CompanyExplorerMapEntityBatchResponse>({
        companyID,
        entityKind: "node",
        folderID: parentFolderID,
        items: [{
          client_id: createMapEntityBatchClientID("explorer-node"),
          title: "new node",
          x: 120,
          y: 120,
          position,
        }],
        requestJSON,
      });
      const node = response.nodes?.[0];
      if (!node) throw new Error("node_batch_create_missing_node");
      for (const item of response.folder_items ?? []) upsertOptimisticFolderItem(item);
      setNodes((previous) => previous.some((item) => item.node_id === node.node_id) ? previous : [...previous, node]);
      upsertNodeRelationshipGraphNode(apiBase, companyID, node);
      if (!parentFolderID && position && position > 0) {
        setRootRowOrder((previous) => ({ ...previous, [`node-${node.node_id}`]: position }));
      }
      expandCreatedItemTarget(parentFolderID);
      lastLocalExplorerSelectionRef.current = { domain: "node", changedAt: Date.now() };
      pendingExplorerSelectionIntentRef.current = "activate";
      setSelectedTreeID(`node-${node.node_id}`);
      setSelectedTreeIDs(new Set([`node-${node.node_id}`]));
      setSelectionAnchorTreeID(`node-${node.node_id}`);
      setSelectedNodeID(node.node_id);
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_node");
    }
  }, [apiBase, companyID, expandCreatedItemTarget, requestJSON, upsertOptimisticFolderItem]);

  const createLogicGateAtFolder = useCallback(async (parentFolderID: string, position?: number) => {
    setError("");
    try {
      const response = await createMapEntityBatchCommand<CompanyExplorerMapEntityBatchResponse>({
        companyID,
        entityKind: "logic_gate",
        folderID: parentFolderID,
        items: [{
          client_id: createMapEntityBatchClientID("explorer-logic-gate"),
          title: "new logic gate",
          x: 120,
          y: 120,
          position,
        }],
        requestJSON,
      });
      const created = response.logic_gates?.[0];
      if (!created) throw new Error("logic_gate_batch_create_missing_gate");
      const logicGate = toLogicGateCanvasRecord(created);
      for (const item of response.folder_items ?? []) upsertOptimisticFolderItem(item);
      setLogicGates((previous) => previous.some((item) => item.logic_gate_id === logicGate.logic_gate_id) ? previous : [...previous, logicGate]);
      upsertLogicGateRelationshipGraphNode(apiBase, companyID, logicGate);
      if (!parentFolderID && position && position > 0) {
        setRootRowOrder((previous) => ({ ...previous, [`logic-gate-${logicGate.logic_gate_id}`]: position }));
      }
      expandCreatedItemTarget(parentFolderID);
      lastLocalExplorerSelectionRef.current = { domain: "logic_gate", changedAt: Date.now() };
      pendingExplorerSelectionIntentRef.current = "activate";
      setSelectedTreeID(`logic-gate-${logicGate.logic_gate_id}`);
      setSelectedTreeIDs(new Set([`logic-gate-${logicGate.logic_gate_id}`]));
      setSelectionAnchorTreeID(`logic-gate-${logicGate.logic_gate_id}`);
      setSelectedLogicGateID(logicGate.logic_gate_id);
      setSelectedNodeID("");
      setSelectedKanbanBoardID("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_logic_gate");
    }
  }, [apiBase, companyID, expandCreatedItemTarget, requestJSON, upsertOptimisticFolderItem]);

  // Delete through one canonical batch request, then patch local/shared caches
  // once so multi-select deletes do not visibly collapse one row at a time.
  const deleteExplorerTargets = useCallback(async (targets: ExplorerDeleteTargetWithLabel[]) => {
    const seen = new Set<string>();
    const selectedLogicGateBoardIDs = new Set(
      targets
        .filter((target) => target.kind === "logic_gate")
        .map((target) => logicGateKanbanBoardID(target.id)),
    );
    const normalizedTargets = targets.filter((target) => {
      if (target.kind === "kanban" && selectedLogicGateBoardIDs.has(target.id)) return false;
      const key = `${target.kind}:${target.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (normalizedTargets.length === 0) return;

    const deletedFolderIDs = new Set<string>();
    const deletedNodeIDs = new Set<string>();
    const deletedLogicGateIDs = new Set<string>();
    const deletedKanbanBoardIDs = new Set<string>();

    for (const target of normalizedTargets) {
      if (target.kind === "folder") {
        for (const id of collectFolderSubtreeIDs(folders, target.id)) deletedFolderIDs.add(id);
      } else if (target.kind === "node") {
        deletedNodeIDs.add(target.id);
      } else if (target.kind === "logic_gate") {
        deletedLogicGateIDs.add(target.id);
        deletedKanbanBoardIDs.add(logicGateKanbanBoardID(target.id));
      } else {
        deletedKanbanBoardIDs.add(target.id);
      }
    }
    for (const item of folderItems) {
      if (!deletedFolderIDs.has(item.folder_id)) continue;
      if (item.item_type === "node") {
        deletedNodeIDs.add(item.item_id);
      } else if (item.item_type === "logic_gate") {
        deletedLogicGateIDs.add(item.item_id);
        deletedKanbanBoardIDs.add(logicGateKanbanBoardID(item.item_id));
      } else if (item.item_type === "kanban") {
        deletedKanbanBoardIDs.add(item.item_id);
      }
    }
    for (const board of kanbanBoards) {
      if (board.logic_gate_id && deletedLogicGateIDs.has(board.logic_gate_id)) {
        deletedKanbanBoardIDs.add(board.board_id);
      }
    }

    const previousFolders = folders;
    const previousNodes = nodes;
    const previousLogicGates = logicGates;
    const previousKanbanBoards = kanbanBoards;
    const previousFolderItems = folderItems;

    setError("");
    setFolders((previous) => previous.filter((folder) => !deletedFolderIDs.has(folder.folder_id)));
    setNodes((previous) => previous.filter((node) => !deletedNodeIDs.has(node.node_id)));
    setLogicGates((previous) => previous.filter((logicGate) => !deletedLogicGateIDs.has(logicGate.logic_gate_id)));
    setKanbanBoards((previous) => previous.filter((board) => !deletedKanbanBoardIDs.has(board.board_id)));
    setFolderItems((previous) => previous.filter((item) =>
      !deletedFolderIDs.has(item.folder_id)
      && (item.item_type !== "node" || !deletedNodeIDs.has(item.item_id))
      && (item.item_type !== "logic_gate" || !deletedLogicGateIDs.has(item.item_id))
      && (item.item_type !== "kanban" || !deletedKanbanBoardIDs.has(item.item_id))
    ));
    try {
      await requestJSON<CompanyExplorerDeleteBatchResponse>("/v1/company-explorer/delete-batch", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          targets: normalizedTargets.map((target) => ({
            kind: target.kind,
            id: target.id,
            folder_kind: target.kind === "folder" ? target.folderKind : undefined,
          })),
        }),
      });

      if (deletedFolderIDs.size > 0) {
        for (const folderID of deletedFolderIDs) {
          removeCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folderID);
          removeCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folderID);
        }
      }
      if (deletedNodeIDs.size > 0) {
        for (const nodeID of deletedNodeIDs) removeNodeRelationshipGraphNode(apiBase, companyID, nodeID);
      }
      if (deletedLogicGateIDs.size > 0) {
        for (const logicGateID of deletedLogicGateIDs) removeLogicGateRelationshipGraphNode(apiBase, companyID, logicGateID);
      }
      if (deletedKanbanBoardIDs.size > 0) {
        for (const boardID of deletedKanbanBoardIDs) {
          window.dispatchEvent(new CustomEvent<KanbanBoardsUpdatedDetail>(EVENT_KANBAN_BOARDS_UPDATED, { detail: { companyID, deletedBoardID: boardID } }));
        }
      }

      lastLocalExplorerSelectionRef.current = { domain: "root", changedAt: Date.now() };
      pendingExplorerSelectionIntentRef.current = "navigate";
      setSelectedTreeID("folder-root");
      setSelectedTreeIDs(new Set(["folder-root"]));
      setSelectionAnchorTreeID("folder-root");
      setSelectedNodeID("");
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
    } catch (err) {
      setFolders(previousFolders);
      setNodes(previousNodes);
      setLogicGates(previousLogicGates);
      setKanbanBoards(previousKanbanBoards);
      setFolderItems(previousFolderItems);
      setError(err instanceof Error ? err.message : "failed_to_delete_selection");
    }
  }, [apiBase, companyID, folderItems, folders, kanbanBoards, logicGates, nodes, requestJSON]);

  const getDeleteTargetsForRows = useCallback((rows: ExplorerTreeNode[]): ExplorerDeleteTargetWithLabel[] => {
    const selectedFolderIDs = new Set(rows.filter((row) => row.kind === "folder" && row.folderID).map((row) => row.folderID!));
    const isFolderCoveredBySelectedAncestor = (folderID: string): boolean => {
      let currentFolderID = folderID;
      const seen = new Set<string>();
      while (currentFolderID && !seen.has(currentFolderID)) {
        if (selectedFolderIDs.has(currentFolderID)) return true;
        seen.add(currentFolderID);
        currentFolderID = folders.find((folder) => folder.folder_id === currentFolderID)?.parent_folder_id ?? "";
      }
      return false;
    };
    const isCoveredBySelectedAncestor = (row: ExplorerTreeNode): boolean => {
      if (row.kind === "folder") return Boolean(row.parentFolderID && isFolderCoveredBySelectedAncestor(row.parentFolderID));
      return Boolean(row.folderID && isFolderCoveredBySelectedAncestor(row.folderID));
    };
    const targets: ExplorerDeleteTargetWithLabel[] = [];
    const seenTargets = new Set<string>();
    for (const row of rows) {
      if (isCoveredBySelectedAncestor(row)) continue;
      const target = resolveExplorerDeleteTarget(row);
      if (!target) continue;
      const key = `${target.kind}:${target.id}`;
      if (seenTargets.has(key)) continue;
      seenTargets.add(key);
      targets.push({ ...target, label: row.label, treeID: row.id });
    }
    return targets;
  }, [folders]);

  const requestDeleteTargets = useCallback((targets: ExplorerDeleteTargetWithLabel[]) => {
    if (targets.length === 0) return;
    const protectedFolder = findProtectedSystemFolderInDeleteTargets(targets, folders);
    if (protectedFolder) {
      setExplorerContextMenu(null);
      setDeleteBlockedMessage(`We can't delete this folder because it contains the special folder: ${protectedFolder.name}`);
      return;
    }
    setExplorerContextMenu(null);
    setDeleteFolderAcknowledged(false);
    setDeleteConfirmation({ targets });
  }, [folders]);

  const requestDeleteSelection = useCallback(() => {
    if (deleteConfirmation) return;
    const selectedRows = treeRows.filter((row) => selectedTreeIDs.has(row.id));
    const targets = getDeleteTargetsForRows(selectedRows.length > 0 ? selectedRows : (selectedTree ? [selectedTree] : []));
    requestDeleteTargets(targets);
  }, [deleteConfirmation, getDeleteTargetsForRows, requestDeleteTargets, selectedTree, selectedTreeIDs, treeRows]);

  const commitRename = useCallback(async (draft?: ExplorerRenameDraft) => {
    const activeRename = draft ?? renaming;
    if (!activeRename || renameCommitInFlightRef.current) return;
    const value = activeRename.value.trim();
    if (!value) {
      setRenaming(null);
      return;
    }
    renameCommitInFlightRef.current = true;
    setError("");
    try {
      if (activeRename.target.kind === "folder") {
        const folder = await requestJSON<CompanyExplorerFolder>(`/v1/company-explorer/folders/${activeRename.target.id}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, name: value }),
        });
        setFolders((previous) => previous.map((item) => (item.folder_id === folder.folder_id ? folder : item)));
        upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folder);
        upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folder);
      } else if (activeRename.target.kind === "node") {
        const node = await requestJSON<NodeRecord>(`/v1/nodes/${activeRename.target.id}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, title: value }),
        });
        setNodes((previous) => previous.map((item) => (item.node_id === node.node_id ? node : item)));
        upsertNodeRelationshipGraphNode(apiBase, companyID, node);
      } else if (activeRename.target.kind === "logic_gate") {
        const updated = await requestJSON<LogicGateApiRecord>(`/v1/logic-gates/${activeRename.target.id}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, header: value }),
        });
        const logicGate = toLogicGateCanvasRecord(updated);
        setLogicGates((previous) => previous.map((item) => (item.logic_gate_id === logicGate.logic_gate_id ? logicGate : item)));
        upsertLogicGateRelationshipGraphNode(apiBase, companyID, logicGate);
      }
      setRenaming((current) => (current?.treeID === activeRename.treeID ? null : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : `failed_to_rename_${activeRename.target.kind}`);
    } finally {
      renameCommitInFlightRef.current = false;
    }
  }, [apiBase, companyID, renaming, requestJSON]);

  const moveFolder = useCallback(async (folderID: string, parentFolderID: string | undefined, options: { position?: number; expandTarget?: boolean; parentProvided?: boolean; targetExpanded?: boolean } = {}) => {
    if (!folderID || folderID === parentFolderID) return;
    setError("");
    try {
      const body: { company_id: string; parent_folder_id?: string; position?: number } = { company_id: companyID };
      if (options.parentProvided !== false) body.parent_folder_id = parentFolderID ?? "";
      if (options.position && options.position > 0) body.position = options.position;
      const folder = await requestJSON<CompanyExplorerFolder>(`/v1/company-explorer/folders/${folderID}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setFolders((previous) => previous.map((item) => (item.folder_id === folder.folder_id ? folder : item)));
      if (typeof options.targetExpanded === "boolean") {
        setExpanded((previous) => {
          const next = new Set(previous);
          const targetTreeID = parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root";
          if (options.targetExpanded) next.add(targetTreeID);
          else next.delete(targetTreeID);
          return next;
        });
      } else if (options.expandTarget) {
        setExpanded((previous) => {
          const next = new Set(previous);
          next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root");
          return next;
        });
      }
      upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folder);
      upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_move_folder");
    }
  }, [apiBase, companyID, requestJSON]);

  const focusTreeRow = useCallback((row: ExplorerTreeNode, options: { localIntent?: boolean; selectionIntent?: SelectionIntent } = {}) => {
    if (options.localIntent !== false) {
      lastLocalExplorerSelectionRef.current = { domain: getExplorerSelectionDomain(row), changedAt: Date.now() };
    }
    pendingExplorerSelectionIntentRef.current = options.selectionIntent ?? "activate";
    selectedTreeIDRef.current = row.id;
    setSelectedTreeID(row.id);
    if (row.kind === "node") {
      setSelectedNodeID(row.nodeID ?? "");
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
      return;
    }
    if (row.kind === "logic_gate") {
      setSelectedLogicGateID(row.logicGateID ?? "");
      setSelectedNodeID("");
      setSelectedKanbanBoardID("");
      return;
    }
    if (row.kind === "kanban") {
      setSelectedKanbanBoardID(row.kanbanBoardID ?? "");
      setSelectedNodeID("");
      setSelectedLogicGateID("");
      return;
    }
    setSelectedNodeID("");
    setSelectedLogicGateID("");
    setSelectedKanbanBoardID("");
  }, []);

  const selectSingleTreeRow = useCallback((row: ExplorerTreeNode) => {
    treeKeyboardActiveRef.current = true;
    treeViewportRef.current?.focus({ preventScroll: true });
    setSelectedTreeID(row.id);
    setSelectedTreeIDs(new Set([row.id]));
    setSelectionAnchorTreeID(row.id);
    focusTreeRow(row, { selectionIntent: "navigate" });
  }, [focusTreeRow]);

  const emitExplorerEntityActivation = useCallback((row: ExplorerTreeNode) => {
    const kind = row.kind === "node" || row.kind === "logic_gate" ? row.kind : "";
    const id = kind === "node" ? (row.nodeID ?? "") : kind === "logic_gate" ? (row.logicGateID ?? "") : "";
    const cleanID = id.trim();
    if (!kind || !cleanID) return;
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
      companyID,
      sourceFrameID: scope,
      kind,
      id: cleanID,
      label: row.label,
      selectedTreeID: row.id,
      changedAt: Date.now(),
    });
  }, [companyID, scope]);

  const selectTreeRow = useCallback((row: ExplorerTreeNode, event?: React.MouseEvent, options: { selectionIntent?: SelectionIntent } = {}) => {
    const orderedIDs = treeRows.map((item) => item.id);
    treeKeyboardActiveRef.current = true;
    treeViewportRef.current?.focus({ preventScroll: true });
    const selected = resolveExplorerClickSelection({
      orderedIDs,
      previousSelectedIDs: selectedTreeIDs,
      anchorID: selectionAnchorTreeID,
      clickedID: row.id,
      shiftKey: !!event?.shiftKey,
      ctrlKey: !!event?.ctrlKey || !!event?.metaKey,
    });
    if (selected.selectedIDs.size === 0) selected.selectedIDs.add(row.id);
    const orderedSelectedIDs = orderedIDs.filter((id) => selected.selectedIDs.has(id));
    const primaryID = selected.selectedIDs.has(row.id) ? row.id : (orderedSelectedIDs[0] ?? row.id);
    const primaryRow = rowByID.get(primaryID) ?? row;
    const selectionIntent = options.selectionIntent ?? "activate";
    setSelectedTreeIDs(new Set(orderedSelectedIDs));
    setSelectionAnchorTreeID(selected.anchorID);
    focusTreeRow(primaryRow, { selectionIntent });
    if (selectionIntent === "activate" && !event?.shiftKey && !event?.ctrlKey && !event?.metaKey) {
      emitExplorerEntityActivation(primaryRow);
    }
  }, [emitExplorerEntityActivation, focusTreeRow, rowByID, selectedTreeIDs, selectionAnchorTreeID, treeRows]);

  const expandTreeIDs = useCallback((treeIDs: string[]) => {
    const folderByID = new Map(folders.map((folder) => [folder.folder_id, folder]));
    const addFolderPath = (next: Set<string>, folderID: string) => {
      let currentID = folderID;
      const seen = new Set<string>();
      while (currentID && !seen.has(currentID)) {
        seen.add(currentID);
        next.add(`workspace-folder-${currentID}`);
        currentID = folderByID.get(currentID)?.parent_folder_id ?? "";
      }
    };
    setExpanded((previous) => {
      const next = new Set(previous);
      next.add("folder-root");
      for (const treeID of treeIDs) {
        const systemFolderKey = getSystemFolderKeyForTreeRowID(treeID);
        if (systemFolderKey) {
          const systemFolderTreeID = systemFolderTreeIDByKey.get(systemFolderKey);
          if (systemFolderTreeID) next.add(systemFolderTreeID);
          continue;
        }
        if (treeID.startsWith("workspace-folder-")) {
          addFolderPath(next, treeID.slice("workspace-folder-".length));
          continue;
        }
        const itemType = treeID.startsWith("node-") ? "node"
          : treeID.startsWith("logic-gate-") ? "logic_gate"
            : treeID.startsWith("kanban-") ? "kanban"
              : "";
        const itemID = itemType === "node" ? treeID.slice("node-".length)
          : itemType === "logic_gate" ? treeID.slice("logic-gate-".length)
            : itemType === "kanban" ? treeID.slice("kanban-".length)
              : "";
        if (!itemType || !itemID) continue;
        const placement = folderItems.find((item) => item.item_type === itemType && item.item_id === itemID);
        if (placement) addFolderPath(next, placement.folder_id);
      }
      return next;
    });
  }, [folderItems, folders, systemFolderTreeIDByKey]);

  const startRenamingRow = useCallback((row: ExplorerTreeNode) => {
    const target = resolveExplorerRenameTarget(row);
    if (!target) return;
    setSelectedTreeID(row.id);
    setSelectedTreeIDs(new Set([row.id]));
    setSelectionAnchorTreeID(row.id);
    focusTreeRow(row, { selectionIntent: "navigate" });
    cancelRenameOnBlurRef.current = false;
    setRenaming({ treeID: row.id, target, value: row.label });
  }, [focusTreeRow]);

  const scrollTreeRowIntoView = useCallback((rowID: string, options: { align?: "nearest" | "center" } = {}) => {
    const index = treeRows.findIndex((row) => row.id === rowID);
    const viewport = treeViewportRef.current;
    if (index < 0 || !viewport) return;
    const rowsStart = viewport.querySelector<HTMLElement>('[data-company-explorer-tree-rows-start="true"]');
    const currentTop = viewport.scrollTop;
    const viewportHeight = viewport.clientHeight || treeViewportHeight;
    const nextScrollTop = getExplorerScrollTopForRow({
      rowIndex: index,
      rowHeight: COMPANY_EXPLORER_TREE_ROW_HEIGHT,
      rowsTopOffset: rowsStart?.offsetTop ?? 0,
      currentScrollTop: currentTop,
      viewportHeight,
      maxScrollTop: Math.max(0, viewport.scrollHeight - viewportHeight),
      bottomPadding: COMPANY_EXPLORER_TREE_ROW_HEIGHT * 2,
      align: options.align,
    });
    if (nextScrollTop === currentTop) return;
    viewport.scrollTop = nextScrollTop;
    setTreeScrollTop(nextScrollTop);
  }, [treeRows, treeViewportHeight]);

  const applyExplorerFindSelection = useCallback((entities: ExplorerFindEntity[]) => {
    const plan = buildExplorerFindSelection({
      entities,
      folders,
      folderItems,
      nodeIDs: nodes.map((node) => node.node_id),
      logicGateIDs: logicGates.map((logicGate) => logicGate.logic_gate_id),
      currentExpandedIDs: expandedRef.current,
    });
    if (!plan.primaryTreeID || !plan.primaryEntity) return;

    suppressNextExplorerBroadcastRef.current = true;
    treeKeyboardActiveRef.current = true;
    treeViewportRef.current?.focus({ preventScroll: true });
    expandedRef.current = plan.expandedTreeIDs;
    setExpanded(plan.expandedTreeIDs);
    setSelectedTreeID(plan.primaryTreeID);
    setSelectedTreeIDs(new Set(plan.selectedTreeIDs));
    setSelectionAnchorTreeID(plan.primaryTreeID);
    if (plan.primaryEntity.kind === "node") {
      setSelectedNodeID(plan.primaryEntity.id);
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
    } else {
      setSelectedLogicGateID(plan.primaryEntity.id);
      setSelectedNodeID("");
      setSelectedKanbanBoardID("");
    }
    pendingScrollAlignRef.current = "center";
    pendingScrollTreeIDRef.current = plan.primaryTreeID;
  }, [folderItems, folders, logicGates, nodes]);

  const selectExplorerSearchResult = useCallback((row: ExplorerTreeNode) => {
    setExplorerSearchQuery("");
    setExplorerSearchFocused(false);
    treeKeyboardActiveRef.current = true;
    treeViewportRef.current?.focus({ preventScroll: true });
    expandTreeIDs([row.id]);
    setSelectedTreeID(row.id);
    setSelectedTreeIDs(new Set([row.id]));
    setSelectionAnchorTreeID(row.id);
    focusTreeRow(row, { selectionIntent: "activate" });
    emitExplorerEntityActivation(row);
    pendingScrollAlignRef.current = "center";
    pendingScrollTreeIDRef.current = row.id;
  }, [emitExplorerEntityActivation, expandTreeIDs, focusTreeRow]);

  useEffect(() => {
    const rowID = pendingScrollTreeIDRef.current;
    if (!rowID || !treeRows.some((row) => row.id === rowID)) return;
    const align = pendingScrollAlignRef.current;
    pendingScrollTreeIDRef.current = "";
    pendingScrollAlignRef.current = "nearest";
    window.requestAnimationFrame(() => scrollTreeRowIntoView(rowID, { align }));
  }, [scrollTreeRowIntoView, treeRows]);

  const handleTreeKeyDown = useCompanyExplorerKeyboard({
    treeViewportRef,
    treeKeyboardActiveRef,
    selectedTreeIDRef,
    expandedRef,
    treeRowsRef,
    setExpanded,
    selectSingleTreeRow,
    scrollTreeRowIntoView,
    onRequestDeleteSelection: requestDeleteSelection,
  });

  const getExplorerItemRowsForPayload = useCallback((payload: ExplorerDragPayload | null): ExplorerTreeNode[] => {
    const payloadItems = getExplorerDropPayloadItems(payload);
    if (payloadItems.length === 0) return [];
    const sourceTreeIDs = new Set<string>();
    if (payload?.sourceTreeID) sourceTreeIDs.add(payload.sourceTreeID);
    for (const item of payloadItems) {
      if (item.treeID) sourceTreeIDs.add(item.treeID);
    }
    if (sourceTreeIDs.size > 0) {
      return treeRows.filter((row) => sourceTreeIDs.has(row.id));
    }
    const keys = new Set(payloadItems.map((item) => `${item.itemType}:${item.itemID}`));
    const seen = new Set<string>();
    const rows: ExplorerTreeNode[] = [];
    for (const row of treeRows) {
      const item = getExplorerItemPayload(row);
      if (!item) continue;
      const key = `${item.itemType}:${item.itemID}`;
      if (!keys.has(key) || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    return rows;
  }, [treeRows]);

  const canPlaceExplorerItemsAtTarget = useCallback((payload: ExplorerDragPayload | null, target: ExplorerTreeNode): boolean => {
    const itemType = getExplorerDropPayloadItemType(payload);
    if (scopedAllowedItemType && itemType !== scopedAllowedItemType) return false;
    const targetKind = getExplorerRowOrderKind(target);
    const targetAcceptsItem = Boolean(itemType && targetKind);
    if (!itemType || !targetAcceptsItem) return false;
    const itemRows = getExplorerItemRowsForPayload(payload);
    if (itemRows.length === 0 || itemRows.some((row) => row.id === target.id)) return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (targetContainer == null) return false;
    return targetContainer !== "" || itemRows.every((row) => getExplorerRowContainerID(row) === "");
  }, [getExplorerItemRowsForPayload, scopedAllowedItemType]);

  const isFolderDescendantOf = useCallback((candidateFolderID: string, ancestorFolderID: string): boolean => {
    if (!candidateFolderID || !ancestorFolderID) return false;
    let currentFolderID = candidateFolderID;
    const seen = new Set<string>();
    while (currentFolderID && !seen.has(currentFolderID)) {
      if (currentFolderID === ancestorFolderID) return true;
      seen.add(currentFolderID);
      const folder = folders.find((item) => item.folder_id === currentFolderID);
      currentFolderID = folder?.parent_folder_id ?? "";
    }
    return false;
  }, [folders]);

  const canPlaceExplorerFolderAtTarget = useCallback((source: ExplorerTreeNode | undefined, target: ExplorerTreeNode): boolean => {
    if (!source || source.kind !== "folder" || !source.folderID || !source.folderKind || source.id === target.id) return false;
    if (getExplorerRowOrderKind(target) !== source.folderKind) return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (targetContainer == null) return false;
    if (targetContainer === source.folderID || isFolderDescendantOf(targetContainer, source.folderID)) return false;
    return true;
  }, [isFolderDescendantOf]);

  const getReorderRowsForTarget = useCallback((source: ExplorerTreeNode, target: ExplorerTreeNode): ExplorerTreeNode[] => {
    const sourceContainer = getExplorerRowContainerID(source);
    const targetContainer = getExplorerRowContainerID(target);
    const sourceKind = getExplorerRowOrderKind(source);
    const targetKind = getExplorerRowOrderKind(target);
    if (sourceContainer == null || targetContainer == null || sourceContainer !== targetContainer || !sourceKind || !targetKind) return [];
    if (sourceContainer === "" && targetContainer === "") {
      return treeRows.filter((row) => getExplorerRowContainerID(row) === "" && Boolean(getExplorerRowOrderKind(row)));
    }
    return treeRows.filter((row) => getExplorerRowContainerID(row) === sourceContainer && Boolean(getExplorerRowOrderKind(row)));
  }, [treeRows]);

  const reorderExplorerRows = useCallback(async (source: ExplorerTreeNode, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => {
    const siblings = getReorderRowsForTarget(source, target);
    if (siblings.length < 2) return false;
    const plan = buildExplorerRowReorderPlan(siblings.map(explorerRowOrder), source.id, target.id, placement);
    if (plan.updates.length === 0) return false;
    const rowByID = new Map(siblings.map((row) => [row.id, row]));
    const updates: ExplorerRowOrderUpdate[] = [];
    for (const update of plan.updates) {
      const row = rowByID.get(update.rowID);
      if (row) updates.push({ row, position: update.position });
    }
    if (updates.length === 0) return false;

    const localRootUpdates = updates.filter(({ row }) => getExplorerRowContainerID(row) === "");
    if (localRootUpdates.length > 0) {
      setRootRowOrder((previous) => {
        const next = { ...previous };
        for (const { row, position } of localRootUpdates) next[row.id] = position;
        return next;
      });
    }

    const itemAssignments: CompanyExplorerFolderItemAssignment[] = [];
    const folderMoves: Array<Promise<void>> = [];
    for (const { row, position } of updates) {
      if (row.kind === "folder" && row.folderID) {
        folderMoves.push(moveFolder(row.folderID, row.parentFolderID ?? "", { position, parentProvided: false }));
        continue;
      }
      const itemType: CompanyExplorerItemType | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : row.kind === "kanban" ? "kanban" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.kind === "logic_gate" ? row.logicGateID : row.kanbanBoardID;
      if (row.folderID && itemType && itemID) itemAssignments.push({ folder_id: row.folderID, item_type: itemType, item_id: itemID, position });
    }
    await Promise.all(folderMoves);
    if (itemAssignments.length > 0) await assignItemsToFolders(itemAssignments);
    return true;
  }, [assignItemsToFolders, getReorderRowsForTarget, moveFolder]);

  const placeExplorerFolderAtTarget = useCallback(async (source: ExplorerTreeNode, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => {
    if (!source.folderID || !source.folderKind || !canPlaceExplorerFolderAtTarget(source, target)) return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (targetContainer == null) return false;

    const targetRows = treeRows.filter((row) => getExplorerRowContainerID(row) === targetContainer && getExplorerRowOrderKind(row) === source.folderKind);
    const targetRowIDs = new Set(targetRows.map((row) => row.id));
    const rowsForPlan = targetRowIDs.has(source.id) ? targetRows : [...targetRows, source];
    const plan = buildExplorerRowBatchReorderPlan(rowsForPlan.map(explorerRowOrder), [source.id], target.id, placement);
    if (plan.updates.length === 0) return false;

    const rowByPlanID = new Map(rowsForPlan.map((row) => [row.id, row]));
    const updates: ExplorerRowOrderUpdate[] = [];
    for (const update of plan.updates) {
      const row = rowByPlanID.get(update.rowID);
      if (row) updates.push({ row, position: update.position });
    }
    if (updates.length === 0) return false;

    if (targetContainer === "") {
      setRootRowOrder((previous) => {
        const next = { ...previous };
        for (const { row, position } of updates) next[row.id] = position;
        return next;
      });
    }

    const itemAssignments: CompanyExplorerFolderItemAssignment[] = [];
    const folderMoves: Array<Promise<void>> = [];
    for (const { row, position } of updates) {
      if (row.kind === "folder" && row.folderID) {
        const parentFolderID = row.id === source.id ? targetContainer : (row.parentFolderID ?? "");
        folderMoves.push(moveFolder(row.folderID, parentFolderID, { position, parentProvided: row.id === source.id }));
        continue;
      }
      const rowItemType: CompanyExplorerFolderKind | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.logicGateID;
      if (targetContainer && rowItemType && itemID) itemAssignments.push({ folder_id: targetContainer, item_type: rowItemType, item_id: itemID, position });
    }
    await Promise.all(folderMoves);
    if (itemAssignments.length > 0) await assignItemsToFolders(itemAssignments);
    return true;
  }, [assignItemsToFolders, canPlaceExplorerFolderAtTarget, moveFolder, treeRows]);

  const placeExplorerItemsAtTarget = useCallback(async (payload: ExplorerDragPayload | null, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => {
    const itemType = getExplorerDropPayloadItemType(payload);
    const targetContainer = getExplorerRowContainerID(target);
    if (!itemType || targetContainer == null || !canPlaceExplorerItemsAtTarget(payload, target)) return false;

    const itemRows = getExplorerItemRowsForPayload(payload);
    const targetRows = treeRows.filter((row) => {
      if (getExplorerRowContainerID(row) !== targetContainer) return false;
      const rowKind = getExplorerRowOrderKind(row);
      return Boolean(rowKind);
    });
    const targetRowIDs = new Set(targetRows.map((row) => row.id));
    const rowsForPlan = [
      ...targetRows,
      ...itemRows.filter((row) => !targetRowIDs.has(row.id)),
    ];
    const plan = buildExplorerRowBatchReorderPlan(rowsForPlan.map(explorerRowOrder), itemRows.map((row) => row.id), target.id, placement);
    if (plan.updates.length === 0) return false;

    const rowByPlanID = new Map(rowsForPlan.map((row) => [row.id, row]));
    const updates: ExplorerRowOrderUpdate[] = [];
    for (const update of plan.updates) {
      const row = rowByPlanID.get(update.rowID);
      if (row) updates.push({ row, position: update.position });
    }
    if (updates.length === 0) return false;

    if (targetContainer === "") {
      setRootRowOrder((previous) => {
        const next = { ...previous };
        for (const { row, position } of updates) next[row.id] = position;
        return next;
      });
    }

    const itemAssignments: CompanyExplorerFolderItemAssignment[] = [];
    const folderMoves: Array<Promise<void>> = [];
    for (const { row, position } of updates) {
      if (row.kind === "folder" && row.folderID) {
        folderMoves.push(moveFolder(row.folderID, row.parentFolderID ?? "", { position, parentProvided: false }));
        continue;
      }
      const rowItemType: CompanyExplorerItemType | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : row.kind === "kanban" ? "kanban" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.kind === "logic_gate" ? row.logicGateID : row.kanbanBoardID;
      if (targetContainer && rowItemType && itemID) itemAssignments.push({ folder_id: targetContainer, item_type: rowItemType, item_id: itemID, position });
    }
    await Promise.all(folderMoves);
    if (itemAssignments.length > 0) await assignItemsToFolders(itemAssignments);
    return true;
  }, [assignItemsToFolders, canPlaceExplorerItemsAtTarget, getExplorerItemRowsForPayload, moveFolder, treeRows]);

  const assignExplorerPayloadItemsToFolder = useCallback(async (targetFolderID: string, itemType: CompanyExplorerItemType, payload: ExplorerDragPayload) => {
    if (scopedAllowedItemType && itemType !== scopedAllowedItemType) return;
    const items = getExplorerDropPayloadItems(payload).filter((item) => item.itemType === itemType);
    if (!targetFolderID || items.length === 0) return;
    const existingRows = treeRows.filter((row) => {
      if (getExplorerRowContainerID(row) !== targetFolderID) return false;
      const rowKind = getExplorerRowOrderKind(row);
      return Boolean(rowKind);
    });
    let position = existingRows.reduce((max, row) => Math.max(max, row.position || 0), 0);
    const assignments: CompanyExplorerFolderItemAssignment[] = [];
    for (const item of items) {
      position += TREE_ROW_POSITION_STEP;
      assignments.push({ folder_id: targetFolderID, item_type: itemType, item_id: item.itemID, position });
    }
    await assignItemsToFolders(assignments, { expandTarget: true });
  }, [assignItemsToFolders, scopedAllowedItemType, treeRows]);

  const requestMapFind = useCallback((target: ExplorerFindTarget) => {
    if (target.kind === "node") {
      emitDashboardEvent(EVENT_NODE_MAP_FOCUS_REQUESTED, {
        mapWidgetID: linkedMapFrameID,
        nodeID: target.id,
        sourceExplorerID: scope,
      });
      return;
    }
    emitDashboardEvent(EVENT_LOGIC_GATE_MAP_FOCUS_REQUESTED, {
      mapWidgetID: linkedLogicMapFrameID || linkedMapFrameID,
      logicGateID: target.id,
      sourceExplorerID: scope,
    });
  }, [linkedLogicMapFrameID, linkedMapFrameID, scope]);

  const getContextCreatePosition = useCallback((row: ExplorerTreeNode | null | undefined, event: React.MouseEvent): number => {
    if (!row) return 0;
    if (row.kind === "folder") return 0;
    const targetContainer = getExplorerRowContainerID(row);
    if (targetContainer == null) return 0;
    const siblingRows = treeRows.filter((candidate) => {
      if (getExplorerRowContainerID(candidate) !== targetContainer) return false;
      const rowKind = getExplorerRowOrderKind(candidate);
      return Boolean(rowKind);
    });
    const targetIndex = siblingRows.findIndex((candidate) => candidate.id === row.id);
    if (targetIndex < 0) return 0;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect?.();
    const placement: ExplorerRowDropPlacement = bounds && event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
    const previousRow = placement === "before" ? siblingRows[targetIndex - 1] : siblingRows[targetIndex];
    const nextRow = placement === "before" ? siblingRows[targetIndex] : siblingRows[targetIndex + 1];
    if (previousRow && nextRow && nextRow.position - previousRow.position > 1) return Math.floor((previousRow.position + nextRow.position) / 2);
    if (previousRow) return previousRow.position + TREE_ROW_POSITION_STEP;
    if (nextRow) return Math.max(1, nextRow.position - TREE_ROW_POSITION_STEP);
    return 0;
  }, [treeRows]);

  const openExplorerContextMenu = useCallback((event: React.MouseEvent, row?: ExplorerTreeNode | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (row) {
      if (selectedTreeIDs.has(row.id)) focusTreeRow(row, { selectionIntent: "navigate" });
      else selectTreeRow(row, undefined, { selectionIntent: "navigate" });
    }
    const creationRow = row ?? scopedRootRow;
    const contextKind: CompanyExplorerFolderKind | null = creationRow?.folderKind ?? (creationRow?.kind === "node" ? "node" : creationRow?.kind === "logic_gate" ? "logic_gate" : null);
    const targets = resolveExplorerCreationTargets(creationRow ?? null);
    const deleteRows = row ? (selectedTreeIDs.has(row.id) ? treeRows.filter((candidate) => selectedTreeIDs.has(candidate.id)) : [row]) : [];
    const deleteTargets = getDeleteTargetsForRows(deleteRows);
    const shareTarget = row?.kind === "folder" && row.folderID && !row.systemKey
      ? { folderID: row.folderID, label: row.label }
      : null;
    setExplorerContextMenu({
      x: event.clientX,
      y: event.clientY,
      targets,
      deleteTarget: deleteTargets[0] ?? resolveExplorerDeleteTarget(row ?? null),
      deleteTargets,
      renameTarget: resolveExplorerRenameTarget(row ?? null),
      findTarget: getExplorerFindTarget(row ?? null),
      shareTarget,
      renameTreeID: row?.id ?? "",
      renameLabel: row?.label ?? "",
      contextKind,
      createPosition: getContextCreatePosition(row, event),
      canCreateBothFolderTypes: !contextKind && !scopedKind,
      canCreateFolder: !scopedKind || Boolean(scopedRootFolder),
      canCreateNode: !scopedKind,
      canCreateLogicGate: scopedKind ? scopedKind === "logic_gate" && Boolean(scopedRootFolder) : true,
    });
  }, [focusTreeRow, getContextCreatePosition, getDeleteTargetsForRows, scopedKind, scopedRootFolder, scopedRootRow, selectTreeRow, selectedTreeIDs, treeRows]);

  // Kanban accepts node cards only. A mixed Explorer selection is still valid
  // for navigation, but the drag payload intentionally exports node rows only.
  const getKanbanDragItemsForRow = useCallback((row: ExplorerTreeNode): ExplorerEntityDragItem[] => {
    const dragIDs = selectedTreeIDs.has(row.id) ? selectedTreeIDs : new Set([row.id]);
    const items: ExplorerEntityDragItem[] = [];
    const seen = new Set<string>();
    for (const item of treeRows) {
      if (!dragIDs.has(item.id) || item.kind !== "node" || !item.nodeID || seen.has(item.nodeID)) continue;
      seen.add(item.nodeID);
      items.push({ nodeID: item.nodeID, label: item.label });
    }
    if (items.length === 0 && row.kind === "node" && row.nodeID) {
      items.push({ nodeID: row.nodeID, label: row.label });
    }
    return items;
  }, [selectedTreeIDs, treeRows]);

  useCompanyExplorerSelectionBridge({
    companyID,
    scope,
    linkedMapFrameID,
    linkedLogicMapFrameID,
    selectedNodeID,
    selectedLogicGateID,
    selectedKanbanBoardID,
    selectedFolderID,
    selectedFolderKind,
    selectedFolderLabel,
    selectedKanbanBoardLabel,
    selectedTreeID,
    selectedTreeIDs,
    selectedTree,
    selectionTargetFrameIDs: normalizedSelectionTargetFrameIDs,
    linkRevision,
    lastMapSelectionRevisionRef,
    lastLogicMapSelectionRevisionRef,
    suppressNextExplorerBroadcastRef,
    previousBroadcastSelectionRef,
    latestSelectionRef,
    latestLogicGateSelectionRef,
    latestExplorerDomainRef,
    lastLocalExplorerSelectionRef,
    pendingExplorerSelectionIntentRef,
    explorerContextSequenceRef,
    setLinkedMapFrameID,
    setLinkedLogicMapFrameID,
    setLinkRevision,
    setSelectedTreeID,
    setSelectedTreeIDs,
    setSelectionAnchorTreeID,
    setSelectedNodeID,
    setSelectedLogicGateID,
    setSelectedKanbanBoardID,
    expandTreeIDs,
    applyExplorerFindSelection,
  });

  const deleteSummary = useMemo(() => (
    deleteConfirmation
      ? buildDeleteConfirmationSummary({ targets: deleteConfirmation.targets, folders, folderItems })
      : null
  ), [deleteConfirmation, folderItems, folders]);

  const isDarkTheme = theme === "dark";
  const surfaceBackground = isDarkTheme ? "#0f1216" : "#ffffff";
  const surfaceText = isDarkTheme ? "#f4f7fa" : "#24120a";
  const ruleColor = isDarkTheme ? "rgba(255,255,255,0.16)" : "rgba(36,18,10,0.14)";
  const rowRuleColor = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(36,18,10,0.06)";
  const selectedRowBackground = isDarkTheme ? "rgba(255,136,32,0.2)" : "rgba(255, 136, 32, 0.28)";
  const dropRowBackground = isDarkTheme ? "rgba(109, 240, 211, 0.18)" : "rgba(30, 160, 120, 0.16)";
  const folderToggleColor = isDarkTheme ? "#fbb152" : "#8a3b10";
  const rowIconColor = isDarkTheme ? "#ffd8a6" : "#8a3b10";
  const scrollbarAccent = theme === "light" ? "rgb(255, 136, 32)" : accent;
  const scrollbarTrack = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(255, 136, 32, 0.08)";
  const explorerMenuButtonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: "9px 14px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "var(--mango-font-family)",
    fontSize: 12,
    fontWeight: 700,
    textAlign: "left",
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", background: surfaceBackground, color: surfaceText, overflow: "hidden", minWidth: 0 }}>
      <CompanyExplorerTree
        error={error}
        accent={accent}
        surfaceBackground={surfaceBackground}
        surfaceText={surfaceText}
        rowIconColor={rowIconColor}
        dropRowBackground={dropRowBackground}
        selectedRowBackground={selectedRowBackground}
        rowRuleColor={rowRuleColor}
        ruleColor={ruleColor}
        folderToggleColor={folderToggleColor}
        scrollbarAccent={scrollbarAccent}
        scrollbarTrack={scrollbarTrack}
        isDarkTheme={isDarkTheme}
        hideTopControls={hideTopControls}
        treeViewportRef={treeViewportRef}
        treeKeyboardActiveRef={treeKeyboardActiveRef}
        treeRows={treeRows}
        virtualizedTree={virtualizedTree}
        expanded={expanded}
        selectedTreeID={selectedTreeID}
        selectedTreeIDs={selectedTreeIDs}
        explorerSearchQuery={explorerSearchQuery}
        explorerSearchResults={explorerSearchResults}
        explorerSearchOpen={explorerSearchOpen}
        draggingTreeID={draggingTreeID}
        dragOverTreeID={dragOverTreeID}
        dragOverPlacement={dragOverPlacement}
        dragPayload={dragPayload}
        renaming={renaming}
        renameInputRef={renameInputRef}
        cancelRenameOnBlurRef={cancelRenameOnBlurRef}
        onTreeKeyDown={handleTreeKeyDown}
        onScrollTopChange={setTreeScrollTop}
        onCloseContextMenu={() => setExplorerContextMenu(null)}
        onOpenContextMenu={openExplorerContextMenu}
        onSetExplorerSearchQuery={setExplorerSearchQuery}
        onSetExplorerSearchFocused={setExplorerSearchFocused}
        onSelectExplorerSearchResult={selectExplorerSearchResult}
        onSelectTreeRow={selectTreeRow}
        onStartRenamingRow={startRenamingRow}
        onCommitRename={commitRename}
        onSetRenaming={setRenaming}
        onSetExpanded={setExpanded}
        onSetDraggingTreeID={setDraggingTreeID}
        onSetDragOverTreeID={setDragOverTreeID}
        onSetDragOverPlacement={setDragOverPlacement}
        onSetDragPayload={setDragPayload}
        getKanbanDragItemsForRow={getKanbanDragItemsForRow}
        getExplorerItemRowsForPayload={getExplorerItemRowsForPayload}
        getReorderRowsForTarget={getReorderRowsForTarget}
        canPlaceExplorerFolderAtTarget={canPlaceExplorerFolderAtTarget}
        canPlaceExplorerItemsAtTarget={canPlaceExplorerItemsAtTarget}
        reorderExplorerRows={reorderExplorerRows}
        placeExplorerFolderAtTarget={placeExplorerFolderAtTarget}
        placeExplorerItemsAtTarget={placeExplorerItemsAtTarget}
        moveFolder={moveFolder}
        assignExplorerPayloadItemsToFolder={assignExplorerPayloadItemsToFolder}
      />

      <CompanyExplorerContextMenu
        menu={explorerContextMenu}
        buttonStyle={explorerMenuButtonStyle}
        onClose={() => setExplorerContextMenu(null)}
        onCreateFolder={(folderKind, parentFolderID, position) => {
          void createFolder(folderKind, parentFolderID, position);
          setExplorerContextMenu(null);
        }}
        onCreateNode={(parentFolderID, position) => {
          void createNodeAtFolder(parentFolderID, position);
          setExplorerContextMenu(null);
        }}
        onCreateLogicGate={(parentFolderID, position) => {
          void createLogicGateAtFolder(parentFolderID, position);
          setExplorerContextMenu(null);
        }}
        onFindTarget={(target) => {
          setExplorerContextMenu(null);
          requestMapFind(target);
        }}
        onShareFolder={(target) => {
          setExplorerContextMenu(null);
          openFolderShareDialog(target);
        }}
        onRenameTarget={(treeID, target, value) => {
          setExplorerContextMenu(null);
          cancelRenameOnBlurRef.current = false;
          setSelectedTreeID(treeID);
          setSelectedTreeIDs(new Set([treeID]));
          setSelectionAnchorTreeID(treeID);
          setRenaming({ treeID, target, value });
        }}
        onDeleteTargets={requestDeleteTargets}
      />

      {folderShareDialog && (
        <CompanyExplorerFolderShareDialogView
          dialog={folderShareDialog}
          isDarkTheme={isDarkTheme}
          ruleColor={ruleColor}
          rowRuleColor={rowRuleColor}
          onEmailChange={updateFolderShareEmail}
          onSubmit={() => void submitFolderShare()}
          onRemoveShare={(share) => void removeFolderShare(share)}
          onClose={closeFolderShareDialog}
          onRefresh={refreshFolderShares}
        />
      )}

      {deleteBlockedMessage && (
        <CompanyExplorerDeleteBlockedDialog
          message={deleteBlockedMessage}
          isDarkTheme={isDarkTheme}
          onClose={() => setDeleteBlockedMessage("")}
        />
      )}

      {deleteConfirmation && deleteSummary && (
        <CompanyExplorerDeleteConfirmationDialog
          targets={deleteConfirmation.targets}
          summary={deleteSummary}
          acknowledged={deleteFolderAcknowledged}
          isDarkTheme={isDarkTheme}
          onAcknowledgedChange={setDeleteFolderAcknowledged}
          onConfirm={(targets) => {
            setDeleteConfirmation(null);
            setDeleteFolderAcknowledged(false);
            void deleteExplorerTargets(targets);
          }}
          onCancel={() => {
            setDeleteConfirmation(null);
            setDeleteFolderAcknowledged(false);
          }}
        />
      )}
    </div>
  );
};
