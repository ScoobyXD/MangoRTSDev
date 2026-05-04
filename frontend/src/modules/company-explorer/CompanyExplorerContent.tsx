import React, { useCallback, useEffect, useRef, useState } from "react";
import { type NodeRecord } from "../node-map/shared";
import { LogicGateRecord as LogicGateApiRecord, NodeRecord as LogicGateRecord, toLogicGateCanvasRecord } from "../logic-gate-map/shared";
import { emitDashboardEvent, EVENT_LOGIC_GATE_MAP_FOCUS_REQUESTED, EVENT_NODE_MAP_FOCUS_REQUESTED } from "../node-map/eventbus";
import { getNodeRelationshipGraphSnapshot, refreshNodeRelationshipGraphSnapshot, removeCompanyExplorerFolderInNodeRelationshipGraph, removeNodeRelationshipGraphNode, removeNodeRelationshipGraphRelationshipsForNode, subscribeNodeRelationshipGraph, upsertCompanyExplorerFolderInNodeRelationshipGraph, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../node-map/NodeRelationshipGraph";
import { getLogicGateRelationshipGraphSnapshot, refreshLogicGateRelationshipGraphSnapshot, removeCompanyExplorerFolderInLogicGateRelationshipGraph, removeLogicGateRelationshipGraphNode, removeLogicGateRelationshipGraphRelationshipsForLogicGate, subscribeLogicGateRelationshipGraph, upsertCompanyExplorerFolderInLogicGateRelationshipGraph, upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../logic-gate-map/LogicGateRelationshipGraph";
import { type ExplorerSelectionState } from "./explorerSync";
import { type CompanyExplorerFolder, type CompanyExplorerFolderItem, type CompanyExplorerFolderKind, type CompanyExplorerItemType } from "../folders/companyExplorerFolders";
import { createKanbanBoard, deleteKanbanBoard, listKanbanBoards, updateKanbanBoard } from "../kanban/kanbanApi";
import { type ExplorerEntityDragItem, type KanbanBoard } from "../kanban/shared";
import { type SelectionIntent } from "../selectionCoordinator";
import { buildExplorerFindSelection, buildExplorerRowBatchReorderPlan, buildExplorerRowReorderPlan, getExplorerDropPayloadItemType, getExplorerDropPayloadItems, resolveExplorerClickSelection, resolveExplorerCreationTargets, resolveExplorerDeleteTarget, resolveExplorerRenameTarget, type ExplorerFindEntity } from "./treePresentation";
import { CompanyExplorerContextMenu } from "./CompanyExplorerContextMenu";
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
  type ExplorerDeleteTarget,
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
import { COMPANY_EXPLORER_TREE_ROW_HEIGHT } from "./useCompanyExplorerVirtualTree";

// Company Explorer module: tree navigation + node context handoff into Node Map and Editor.
export const CompanyExplorerContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }> = ({ accent, widgetId, theme = "teal" }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const scope = widgetId?.trim() ? widgetId : "global";
  const expandedStorageKey = `company-explorer-expanded-v1:${companyID}:${scope}`;
  const scrollStorageKey = `company-explorer-scroll-v1:${companyID}:${scope}`;
  const rootOrderStorageKey = `company-explorer-root-order-v1:${companyID}:${scope}`;

  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [logicGates, setLogicGates] = useState<LogicGateRecord[]>([]);
  const [kanbanBoards, setKanbanBoards] = useState<KanbanBoard[]>([]);
  const [folders, setFolders] = useState<CompanyExplorerFolder[]>([]);
  const [folderItems, setFolderItems] = useState<CompanyExplorerFolderItem[]>([]);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
        if (cancelled) return;
        const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
        setNodes(snapshot.nodes ?? []);
        setFolders(snapshot.folders ?? []);
        setFolderItems(snapshot.folder_items ?? []);
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
    });
  }, [apiBase, companyID]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID);
        if (cancelled) return;
        const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
        setLogicGates(snapshot.nodes ?? []);
        if ((snapshot.folders ?? []).length > 0 || (snapshot.folder_items ?? []).length > 0) {
          setFolders(snapshot.folders ?? []);
          setFolderItems(snapshot.folder_items ?? []);
        }
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

  const {
    treeRows,
    selectedTree,
    rowByID,
    selectedFolderKind,
    selectedFolderID,
    selectedFolderLabel,
    selectedKanbanBoardLabel,
    virtualizedTree,
  } = useCompanyExplorerTreeModel({
    expanded,
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

  useEffect(() => {
    if (!renaming || !renameInputRef.current) return;
    const input = renameInputRef.current;
    input.focus();
    input.setSelectionRange(renaming.value.length, renaming.value.length);
  }, [renaming]);

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
    if (!treeViewportRef.current || treeScrollTop <= 0) return;
    treeViewportRef.current.scrollTop = treeScrollTop;
  }, [treeScrollTop]);

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

  const createFolder = useCallback(async (folderKind: CompanyExplorerFolderKind, parentFolderID: string) => {
    setError("");
    try {
      const folder = await requestJSON<CompanyExplorerFolder>("/v1/company-explorer/folders", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          parent_folder_id: parentFolderID,
          folder_kind: folderKind,
          name: "New Folder",
        }),
      });
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

  const assignItemToFolder = useCallback(async (targetFolderID: string, itemType: CompanyExplorerItemType, itemID: string, options: { position?: number; expandTarget?: boolean } = {}) => {
    if (!targetFolderID || !itemID) return;
    const previousFolderID = folderItems.find((row) => row.item_type === itemType && row.item_id === itemID)?.folder_id ?? "";
    setError("");
    try {
      const item = await requestJSON<CompanyExplorerFolderItem>("/v1/company-explorer/folder-items", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          folder_id: targetFolderID,
          item_type: itemType,
          item_id: itemID,
          position: options.position,
        }),
      });
      setFolderItems((previous) => {
        const exists = previous.some((row) => row.item_type === item.item_type && row.item_id === item.item_id);
        return exists
          ? previous.map((row) => (row.item_type === item.item_type && row.item_id === item.item_id ? item : row))
          : [...previous, item];
      });
      upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, item);
      upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, item);
      if (previousFolderID !== item.folder_id) {
        // Moving between folder levels starts a new local context. Drop stale
        // edges immediately; the API performs the same cleanup canonically.
        if (itemType === "node") removeNodeRelationshipGraphRelationshipsForNode(apiBase, companyID, itemID);
        else removeLogicGateRelationshipGraphRelationshipsForLogicGate(apiBase, companyID, itemID);
      }
      if (options.expandTarget) {
        setExpanded((previous) => {
          const next = new Set(previous);
          next.add(`workspace-folder-${targetFolderID}`);
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_move_item");
    }
  }, [apiBase, companyID, folderItems, requestJSON]);

  const createNodeAtFolder = useCallback(async (parentFolderID: string) => {
    setError("");
    try {
      const node = await requestJSON<NodeRecord>("/v1/nodes", {
        method: "POST",
        body: JSON.stringify({ company_id: companyID, title: "new node" }),
      });
      // Create is API-first, then we patch the shared graph cache so Explorer,
      // Node Map, and future headless agents converge without a snapshot refetch.
      setNodes((previous) => previous.some((item) => item.node_id === node.node_id) ? previous : [...previous, node]);
      upsertNodeRelationshipGraphNode(apiBase, companyID, node);
      if (parentFolderID) await assignItemToFolder(parentFolderID, "node", node.node_id, { expandTarget: true });
      setExpanded((previous) => {
        const next = new Set(previous);
        next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root");
        return next;
      });
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
  }, [apiBase, assignItemToFolder, companyID, requestJSON]);

  const createLogicGateAtFolder = useCallback(async (parentFolderID: string) => {
    setError("");
    try {
      const created = await requestJSON<LogicGateApiRecord>("/v1/logic-gates", {
        method: "POST",
        body: JSON.stringify({ company_id: companyID, header: "new logic gate" }),
      });
      const logicGate = toLogicGateCanvasRecord(created);
      // Same hot-path pattern as nodes: the REST write is canonical, and the
      // local cache patch keeps linked modules responsive under large workspaces.
      setLogicGates((previous) => previous.some((item) => item.logic_gate_id === logicGate.logic_gate_id) ? previous : [...previous, logicGate]);
      upsertLogicGateRelationshipGraphNode(apiBase, companyID, logicGate);
      if (parentFolderID) await assignItemToFolder(parentFolderID, "logic_gate", logicGate.logic_gate_id, { expandTarget: true });
      setExpanded((previous) => {
        const next = new Set(previous);
        next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root");
        return next;
      });
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
  }, [apiBase, assignItemToFolder, companyID, requestJSON]);

  const createKanbanAtFolder = useCallback(async (parentFolderID: string) => {
    setError("");
    try {
      const board = await createKanbanBoard(apiBase, companyID, "New Kanban board");
      setKanbanBoards((previous) => previous.some((item) => item.board_id === board.board_id) ? previous : [...previous, board]);
      if (parentFolderID) await assignItemToFolder(parentFolderID, "kanban", board.board_id, { expandTarget: true });
      setExpanded((previous) => {
        const next = new Set(previous);
        next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root");
        return next;
      });
      const treeID = `kanban-${board.board_id}`;
      lastLocalExplorerSelectionRef.current = { domain: "kanban", changedAt: Date.now() };
      setSelectedTreeID(treeID);
      setSelectedTreeIDs(new Set([treeID]));
      setSelectionAnchorTreeID(treeID);
      setSelectedKanbanBoardID(board.board_id);
      setSelectedNodeID("");
      setSelectedLogicGateID("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_kanban");
    }
  }, [apiBase, assignItemToFolder, companyID]);

  // Delete through canonical REST APIs first, then patch local/shared caches so
  // Explorer and linked maps converge immediately without a full snapshot GET.
  const deleteExplorerTarget = useCallback(async (target: ExplorerDeleteTarget) => {
    setError("");
    try {
      if (target.kind === "folder") {
        const deletedFolder = folders.find((folder) => folder.folder_id === target.id);
        await requestJSON<{ status: string }>(`/v1/company-explorer/folders/${target.id}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
        const deletedFolderIDs = collectFolderSubtreeIDs(folders, target.id);
        setFolders((previous) => previous.filter((folder) => !deletedFolderIDs.has(folder.folder_id)));
        setFolderItems((previous) => previous.filter((item) => !deletedFolderIDs.has(item.folder_id)));
        removeCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, target.id);
        removeCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, target.id);
        const parentTreeID = deletedFolder?.parent_folder_id
          ? `workspace-folder-${deletedFolder.parent_folder_id}`
          : "folder-root";
        lastLocalExplorerSelectionRef.current = { domain: parentTreeID === "folder-root" ? "root" : target.folderKind, changedAt: Date.now() };
        pendingExplorerSelectionIntentRef.current = "navigate";
        setSelectedTreeID(parentTreeID);
        setSelectedTreeIDs(new Set([parentTreeID]));
        setSelectionAnchorTreeID(parentTreeID);
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        setSelectedKanbanBoardID("");
        return;
      }

      if (target.kind === "node") {
        await requestJSON<{ status: string }>(`/v1/nodes/${target.id}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
        setNodes((previous) => previous.filter((node) => node.node_id !== target.id));
        setFolderItems((previous) => previous.filter((item) => item.item_type !== "node" || item.item_id !== target.id));
        removeNodeRelationshipGraphNode(apiBase, companyID, target.id);
        lastLocalExplorerSelectionRef.current = { domain: "root", changedAt: Date.now() };
        pendingExplorerSelectionIntentRef.current = "navigate";
        setSelectedTreeID("folder-root");
        setSelectedTreeIDs(new Set(["folder-root"]));
        setSelectionAnchorTreeID("folder-root");
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        setSelectedKanbanBoardID("");
        return;
      }

      if (target.kind === "kanban") {
        await deleteKanbanBoard(apiBase, companyID, target.id);
        setKanbanBoards((previous) => previous.filter((board) => board.board_id !== target.id));
        setFolderItems((previous) => previous.filter((item) => item.item_type !== "kanban" || item.item_id !== target.id));
        lastLocalExplorerSelectionRef.current = { domain: "root", changedAt: Date.now() };
        setSelectedTreeID("folder-root");
        setSelectedTreeIDs(new Set(["folder-root"]));
        setSelectionAnchorTreeID("folder-root");
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        setSelectedKanbanBoardID("");
        return;
      }

      await requestJSON<{ status: string }>(`/v1/logic-gates/${target.id}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
      setLogicGates((previous) => previous.filter((logicGate) => logicGate.logic_gate_id !== target.id));
      setFolderItems((previous) => previous.filter((item) => item.item_type !== "logic_gate" || item.item_id !== target.id));
      removeLogicGateRelationshipGraphNode(apiBase, companyID, target.id);
      lastLocalExplorerSelectionRef.current = { domain: "root", changedAt: Date.now() };
      pendingExplorerSelectionIntentRef.current = "navigate";
      setSelectedTreeID("folder-root");
      setSelectedTreeIDs(new Set(["folder-root"]));
      setSelectionAnchorTreeID("folder-root");
      setSelectedNodeID("");
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
    } catch (err) {
      setError(err instanceof Error ? err.message : `failed_to_delete_${target.kind}`);
    }
  }, [apiBase, companyID, folders, requestJSON]);

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
      } else {
        const board = await updateKanbanBoard(apiBase, companyID, activeRename.target.id, value);
        setKanbanBoards((previous) => previous.map((item) => (item.board_id === board.board_id ? board : item)));
      }
      setRenaming((current) => (current?.treeID === activeRename.treeID ? null : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : `failed_to_rename_${activeRename.target.kind}`);
    } finally {
      renameCommitInFlightRef.current = false;
    }
  }, [apiBase, companyID, renaming, requestJSON]);

  const moveFolder = useCallback(async (folderID: string, parentFolderID: string | undefined, options: { position?: number; expandTarget?: boolean; parentProvided?: boolean } = {}) => {
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
      if (options.expandTarget) {
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
    setSelectedTreeIDs(new Set(orderedSelectedIDs));
    setSelectionAnchorTreeID(selected.anchorID);
    focusTreeRow(rowByID.get(primaryID) ?? row, { selectionIntent: options.selectionIntent ?? "activate" });
  }, [focusTreeRow, rowByID, selectedTreeIDs, selectionAnchorTreeID, treeRows]);

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
  }, [folderItems, folders]);

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

  const scrollTreeRowIntoView = useCallback((rowID: string) => {
    const index = treeRows.findIndex((row) => row.id === rowID);
    const viewport = treeViewportRef.current;
    if (index < 0 || !viewport) return;
    const rowTop = index * COMPANY_EXPLORER_TREE_ROW_HEIGHT;
    const rowBottom = rowTop + COMPANY_EXPLORER_TREE_ROW_HEIGHT;
    const currentTop = viewport.scrollTop;
    const currentBottom = currentTop + treeViewportHeight;
    let nextScrollTop = currentTop;
    if (rowTop < currentTop) nextScrollTop = rowTop;
    else if (rowBottom > currentBottom) nextScrollTop = rowBottom - treeViewportHeight;
    nextScrollTop = Math.max(0, nextScrollTop);
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
    } else {
      setSelectedLogicGateID(plan.primaryEntity.id);
      setSelectedNodeID("");
    }
    pendingScrollTreeIDRef.current = plan.primaryTreeID;
  }, [folderItems, folders, logicGates, nodes]);

  useEffect(() => {
    const rowID = pendingScrollTreeIDRef.current;
    if (!rowID || !treeRows.some((row) => row.id === rowID)) return;
    pendingScrollTreeIDRef.current = "";
    window.requestAnimationFrame(() => scrollTreeRowIntoView(rowID));
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
  });

  const getExplorerItemRowsForPayload = useCallback((payload: ExplorerDragPayload | null): ExplorerTreeNode[] => {
    const payloadItems = getExplorerDropPayloadItems(payload);
    if (payloadItems.length === 0) return [];
    const keys = new Set(payloadItems.map((item) => `${item.itemType}:${item.itemID}`));
    return treeRows.filter((row) => {
      const item = getExplorerItemPayload(row);
      return item ? keys.has(`${item.itemType}:${item.itemID}`) : false;
    });
  }, [treeRows]);

  const canPlaceExplorerItemsAtTarget = useCallback((payload: ExplorerDragPayload | null, target: ExplorerTreeNode): boolean => {
    const itemType = getExplorerDropPayloadItemType(payload);
    const targetKind = getExplorerRowOrderKind(target);
    const targetAcceptsItem = itemType === targetKind
      || itemType === "kanban"
      || (target.kind === "kanban" && target.folderKind === itemType);
    if (!itemType || !targetAcceptsItem) return false;
    const itemRows = getExplorerItemRowsForPayload(payload);
    if (itemRows.length === 0 || itemRows.some((row) => row.id === target.id)) return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (targetContainer == null) return false;
    return targetContainer !== "" || itemRows.every((row) => getExplorerRowContainerID(row) === "");
  }, [getExplorerItemRowsForPayload]);

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
    if (sourceContainer == null || targetContainer == null || sourceContainer !== targetContainer || !sourceKind || sourceKind !== targetKind) return [];
    return treeRows.filter((row) => getExplorerRowContainerID(row) === sourceContainer && getExplorerRowOrderKind(row) === sourceKind);
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

    const localRootUpdates = updates.filter(({ row }) => row.kind !== "folder" && row.folderID === "");
    if (localRootUpdates.length > 0) {
      setRootRowOrder((previous) => {
        const next = { ...previous };
        for (const { row, position } of localRootUpdates) next[row.id] = position;
        return next;
      });
    }

    await Promise.all(updates.map(({ row, position }) => {
      if (row.kind === "folder" && row.folderID) {
        return moveFolder(row.folderID, row.parentFolderID ?? "", { position, parentProvided: false });
      }
      const itemType: CompanyExplorerItemType | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : row.kind === "kanban" ? "kanban" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.kind === "logic_gate" ? row.logicGateID : row.kanbanBoardID;
      if (row.folderID && itemType && itemID) return assignItemToFolder(row.folderID, itemType, itemID, { position });
      return Promise.resolve();
    }));
    return true;
  }, [assignItemToFolder, getReorderRowsForTarget, moveFolder]);

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
        for (const { row, position } of updates) {
          if (row.kind !== "folder") next[row.id] = position;
        }
        return next;
      });
    }

    await Promise.all(updates.map(({ row, position }) => {
      if (row.kind === "folder" && row.folderID) {
        const parentFolderID = row.id === source.id ? targetContainer : (row.parentFolderID ?? "");
        return moveFolder(row.folderID, parentFolderID, { position, parentProvided: row.id === source.id });
      }
      const rowItemType: CompanyExplorerFolderKind | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.logicGateID;
      if (targetContainer && rowItemType && itemID) return assignItemToFolder(targetContainer, rowItemType, itemID, { position });
      return Promise.resolve();
    }));
    return true;
  }, [assignItemToFolder, canPlaceExplorerFolderAtTarget, moveFolder, treeRows]);

  const placeExplorerItemsAtTarget = useCallback(async (payload: ExplorerDragPayload | null, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => {
    const itemType = getExplorerDropPayloadItemType(payload);
    const targetContainer = getExplorerRowContainerID(target);
    if (!itemType || targetContainer == null || !canPlaceExplorerItemsAtTarget(payload, target)) return false;

    const itemRows = getExplorerItemRowsForPayload(payload);
    const targetRows = treeRows.filter((row) => {
      if (getExplorerRowContainerID(row) !== targetContainer) return false;
      const rowKind = getExplorerRowOrderKind(row);
      return rowKind === itemType || rowKind === "kanban" || itemType === "kanban";
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
        for (const { row, position } of updates) {
          if (row.kind !== "folder") next[row.id] = position;
        }
        return next;
      });
    }

    await Promise.all(updates.map(({ row, position }) => {
      if (row.kind === "folder" && row.folderID) {
        return moveFolder(row.folderID, row.parentFolderID ?? "", { position, parentProvided: false });
      }
      const rowItemType: CompanyExplorerItemType | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : row.kind === "kanban" ? "kanban" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.kind === "logic_gate" ? row.logicGateID : row.kanbanBoardID;
      if (targetContainer && rowItemType && itemID) return assignItemToFolder(targetContainer, rowItemType, itemID, { position });
      return Promise.resolve();
    }));
    return true;
  }, [assignItemToFolder, canPlaceExplorerItemsAtTarget, getExplorerItemRowsForPayload, moveFolder, treeRows]);

  const assignExplorerPayloadItemsToFolder = useCallback(async (targetFolderID: string, itemType: CompanyExplorerItemType, payload: ExplorerDragPayload) => {
    const items = getExplorerDropPayloadItems(payload).filter((item) => item.itemType === itemType);
    if (!targetFolderID || items.length === 0) return;
    const existingRows = treeRows.filter((row) => getExplorerRowContainerID(row) === targetFolderID && getExplorerRowOrderKind(row) === itemType);
    let position = existingRows.reduce((max, row) => Math.max(max, row.position || 0), 0);
    for (const item of items) {
      position += TREE_ROW_POSITION_STEP;
      await assignItemToFolder(targetFolderID, itemType, item.itemID, { position, expandTarget: true });
    }
  }, [assignItemToFolder, treeRows]);

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

  const openExplorerContextMenu = useCallback((event: React.MouseEvent, row?: ExplorerTreeNode | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (row) selectTreeRow(row, event, { selectionIntent: "navigate" });
    const contextKind: CompanyExplorerFolderKind | null = row?.folderKind ?? (row?.kind === "node" ? "node" : row?.kind === "logic_gate" ? "logic_gate" : null);
    const kanbanParentFolderID = row?.folderKind && row.folderID ? row.folderID : "";
    setExplorerContextMenu({
      x: event.clientX,
      y: event.clientY,
      targets: resolveExplorerCreationTargets(row ?? null),
      deleteTarget: resolveExplorerDeleteTarget(row ?? null),
      renameTarget: resolveExplorerRenameTarget(row ?? null),
      findTarget: getExplorerFindTarget(row ?? null),
      renameTreeID: row?.id ?? "",
      renameLabel: row?.label ?? "",
      contextKind,
      kanbanParentFolderID,
      canCreateBothFolderTypes: !contextKind,
    });
  }, [selectTreeRow]);

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

  const isDarkTheme = theme === "dark";
  const surfaceBackground = isDarkTheme ? "#0f1216" : "#ffffff";
  const surfaceText = isDarkTheme ? "#f4f7fa" : "#0f1f23";
  const ruleColor = isDarkTheme ? "rgba(255,255,255,0.16)" : "rgba(3,25,30,0.14)";
  const rowRuleColor = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(3,25,30,0.06)";
  const selectedRowBackground = isDarkTheme ? "rgba(0,233,255,0.2)" : "rgba(0, 233, 255, 0.28)";
  const dropRowBackground = isDarkTheme ? "rgba(109, 240, 211, 0.18)" : "rgba(30, 160, 120, 0.16)";
  const folderToggleColor = isDarkTheme ? "#95c7d1" : "#326872";
  const rowIconColor = isDarkTheme ? "#b8d9e1" : "#315f68";
  const scrollbarAccent = theme === "light" ? "rgb(0, 233, 255)" : accent;
  const scrollbarTrack = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(0, 233, 255, 0.08)";
  const explorerMenuButtonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: "9px 14px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    fontWeight: 700,
    textAlign: "left",
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "minmax(240px, 1fr)", background: surfaceBackground, color: surfaceText, overflow: "hidden", minWidth: 0 }}>
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
        treeViewportRef={treeViewportRef}
        treeKeyboardActiveRef={treeKeyboardActiveRef}
        treeRows={treeRows}
        virtualizedTree={virtualizedTree}
        expanded={expanded}
        selectedTreeID={selectedTreeID}
        selectedTreeIDs={selectedTreeIDs}
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
        onCreateFolder={(folderKind, parentFolderID) => {
          void createFolder(folderKind, parentFolderID);
          setExplorerContextMenu(null);
        }}
        onCreateNode={(parentFolderID) => {
          void createNodeAtFolder(parentFolderID);
          setExplorerContextMenu(null);
        }}
        onCreateLogicGate={(parentFolderID) => {
          void createLogicGateAtFolder(parentFolderID);
          setExplorerContextMenu(null);
        }}
        onCreateKanban={(parentFolderID) => {
          void createKanbanAtFolder(parentFolderID);
          setExplorerContextMenu(null);
        }}
        onFindTarget={(target) => {
          setExplorerContextMenu(null);
          requestMapFind(target);
        }}
        onRenameTarget={(treeID, target, value) => {
          setExplorerContextMenu(null);
          cancelRenameOnBlurRef.current = false;
          setSelectedTreeID(treeID);
          setSelectedTreeIDs(new Set([treeID]));
          setSelectionAnchorTreeID(treeID);
          setRenaming({ treeID, target, value });
        }}
        onDeleteTarget={(target) => {
          setExplorerContextMenu(null);
          void deleteExplorerTarget(target);
        }}
      />
    </div>
  );
};
