import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getNodeTitle, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, NodeRecord } from "../node-map/shared";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, getNodeTitle as getLogicGateTitle, LogicGateRecord as LogicGateApiRecord, NodeRecord as LogicGateRecord, toLogicGateCanvasRecord } from "../logic-gate-map/shared";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_FIND_REQUESTED, EVENT_EXPLORER_CONTEXT_UPDATED, EVENT_FRAME_LINK_GRAPH_UPDATED, EVENT_LOGIC_GATE_MAP_FOCUS_REQUESTED, EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, EVENT_NODE_MAP_FOCUS_REQUESTED, EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { getNodeRelationshipGraphSnapshot, refreshNodeRelationshipGraphSnapshot, removeCompanyExplorerFolderInNodeRelationshipGraph, removeNodeRelationshipGraphNode, removeNodeRelationshipGraphRelationshipsForNode, subscribeNodeRelationshipGraph, upsertCompanyExplorerFolderInNodeRelationshipGraph, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../node-map/NodeRelationshipGraph";
import { getLogicGateRelationshipGraphSnapshot, refreshLogicGateRelationshipGraphSnapshot, removeCompanyExplorerFolderInLogicGateRelationshipGraph, removeLogicGateRelationshipGraphNode, removeLogicGateRelationshipGraphRelationshipsForLogicGate, subscribeLogicGateRelationshipGraph, upsertCompanyExplorerFolderInLogicGateRelationshipGraph, upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../logic-gate-map/LogicGateRelationshipGraph";
import { classifyFrameKind, FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveConnectedFrameTargets, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";
import { shouldApplyMapSelection, shouldBroadcastSelection, shouldIgnoreSelfOriginatedMapSelection, shouldReadMapStateForSelectionEvent, type ExplorerSelectionState } from "./explorerSync";
import { hasSequenceGap, isNewerSequence, readIncomingSequence, type ContextMutationEnvelope } from "../contextSyncContract";
import { type CompanyExplorerFolder, type CompanyExplorerFolderItem, type CompanyExplorerFolderKind, type CompanyExplorerItemType } from "../folders/companyExplorerFolders";
import { createKanbanBoard, deleteKanbanBoard, listKanbanBoards, updateKanbanBoard } from "../kanban/kanbanApi";
import { attachStackedDragPreview, EXPLORER_ENTITY_DRAG_MIME, getKanbanBoardDisplayTitle, KANBAN_DEFAULT_COLUMN_ITEM_COLOR, serializeExplorerEntityDragPayload, type ExplorerEntityDragItem, type KanbanBoard } from "../kanban/shared";
import { publishLiveSelection, readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange, type SelectionIntent } from "../selectionCoordinator";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { EXPLORER_DEFAULT_EXPANDED_ROW_IDS, EXPLORER_ROOT_ROW_LABELS, EXPLORER_ROOT_ROW_ORDER, buildExplorerFindSelection, buildExplorerRowBatchReorderPlan, buildExplorerRowReorderPlan, formatExplorerFolderLabel, getExplorerDropPayloadItemType, getExplorerDropPayloadItems, resolveExplorerClickSelection, resolveExplorerCreationTargets, resolveExplorerDeleteTarget, resolveExplorerDropTarget, resolveExplorerKeyboardNavigation, resolveExplorerPublishedSelection, resolveExplorerRenameTarget, resolveExplorerRootDropTarget, shouldAcceptMapSelectionAfterExplorerSelection, type ExplorerCreationTargets, type ExplorerDropPayload, type ExplorerFindEntity, type ExplorerRowDropPlacement, type ExplorerSelectionDomain } from "./treePresentation";

type ExplorerTreeNode = {
  id: string;
  label: string;
  depth: number;
  kind: "folder" | "node" | "logic_gate" | "kanban";
  nodeID?: string;
  logicGateID?: string;
  kanbanBoardID?: string;
  folderID?: string;
  parentFolderID?: string;
  folderKind?: CompanyExplorerFolderKind;
  folderLabel?: string;
  scopeLevel: number;
  position: number;
  createdTimestamp: string;
};

type ExplorerDragPayload = ExplorerDropPayload;

type ExplorerDeleteTarget = NonNullable<ReturnType<typeof resolveExplorerDeleteTarget>>;
type ExplorerRenameTarget = NonNullable<ReturnType<typeof resolveExplorerRenameTarget>>;
type ExplorerRenameDraft = { treeID: string; target: ExplorerRenameTarget; value: string };
type ExplorerRowOrderUpdate = { row: ExplorerTreeNode; position: number };
type ExplorerFindTarget = { kind: "node"; id: string } | { kind: "logic_gate"; id: string };
type CompanyExplorerFindRequestDetail = {
  companyID?: string;
  sourceFrameID?: string;
  targetFrameIDs?: string[];
  entities?: Array<{ kind?: string; id?: string }>;
  changedAt?: number;
};

const EXPLORER_DRAG_MIME = "application/x-mangoos-company-explorer-row";
const TREE_INDENT_PX = 16;
const TREE_BASE_LEFT_PX = 10;
const TREE_TOGGLE_SLOT_PX = 18;
const TREE_ROW_POSITION_STEP = 1000;

function getExplorerDragPayload(row: ExplorerTreeNode): ExplorerDragPayload | null {
  if (row.kind === "folder" && row.folderID && row.folderKind) {
    return { kind: "folder", folderID: row.folderID, folderKind: row.folderKind };
  }
  if (row.kind === "node" && row.nodeID) {
    return { kind: "node", itemID: row.nodeID, itemType: "node" };
  }
  if (row.kind === "logic_gate" && row.logicGateID) {
    return { kind: "logic_gate", itemID: row.logicGateID, itemType: "logic_gate" };
  }
  if (row.kind === "kanban" && row.kanbanBoardID) {
    return { kind: "kanban", itemID: row.kanbanBoardID, itemType: "kanban" };
  }
  return null;
}

function getExplorerItemPayload(row: ExplorerTreeNode): { itemID: string; itemType: CompanyExplorerItemType } | null {
  if (row.kind === "node" && row.nodeID) return { itemID: row.nodeID, itemType: "node" };
  if (row.kind === "logic_gate" && row.logicGateID) return { itemID: row.logicGateID, itemType: "logic_gate" };
  if (row.kind === "kanban" && row.kanbanBoardID) return { itemID: row.kanbanBoardID, itemType: "kanban" };
  return null;
}

function getExplorerDragPayloadForSelection(row: ExplorerTreeNode, selectedIDs: Set<string>, rows: ExplorerTreeNode[]): ExplorerDragPayload | null {
  const basePayload = getExplorerDragPayload(row);
  const baseItem = getExplorerItemPayload(row);
  if (!basePayload || !baseItem) return basePayload;

  const dragIDs = selectedIDs.has(row.id) ? selectedIDs : new Set([row.id]);
  const items: { itemID: string; itemType: CompanyExplorerItemType }[] = [];
  const seen = new Set<string>();
  for (const candidate of rows) {
    if (!dragIDs.has(candidate.id)) continue;
    const item = getExplorerItemPayload(candidate);
    if (!item || item.itemType !== baseItem.itemType || seen.has(item.itemID)) continue;
    seen.add(item.itemID);
    items.push(item);
  }
  return items.length > 1 ? { kind: "batch", itemType: baseItem.itemType, items } : basePayload;
}

function readExplorerDragPayload(dataTransfer: DataTransfer): ExplorerDragPayload | null {
  try {
    const raw = dataTransfer.getData(EXPLORER_DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExplorerDragPayload;
    if (parsed.kind === "folder" && parsed.folderID && parsed.folderKind) return parsed;
    if ((parsed.kind === "node" || parsed.kind === "logic_gate" || parsed.kind === "kanban") && parsed.itemID && parsed.itemType) return parsed;
    if (parsed.kind === "batch") {
      const itemType = getExplorerDropPayloadItemType(parsed);
      const items = getExplorerDropPayloadItems(parsed);
      if (itemType && items.length > 0) return { kind: "batch", itemType, items };
    }
  } catch {
    // Drag payloads can come from outside the app; ignore anything we do not own.
  }
  return null;
}

function collectFolderSubtreeIDs(folders: CompanyExplorerFolder[], rootFolderID: string): Set<string> {
  const deleted = new Set<string>();
  if (!rootFolderID || !folders.some((folder) => folder.folder_id === rootFolderID)) return deleted;
  deleted.add(rootFolderID);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (!folder.parent_folder_id || !deleted.has(folder.parent_folder_id) || deleted.has(folder.folder_id)) continue;
      deleted.add(folder.folder_id);
      changed = true;
    }
  }
  return deleted;
}

function explorerRowOrder(row: ExplorerTreeNode): { position: number; createdTimestamp: string; id: string } {
  return { id: row.id, position: row.position || TREE_ROW_POSITION_STEP, createdTimestamp: row.createdTimestamp || "" };
}

function sortExplorerRowsByPosition(rows: ExplorerTreeNode[]): ExplorerTreeNode[] {
  return [...rows].sort((a, b) => a.position - b.position || a.createdTimestamp.localeCompare(b.createdTimestamp) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

function getExplorerRowContainerID(row: ExplorerTreeNode): string | null {
  if (row.kind === "folder") return row.parentFolderID ?? "";
  if (row.folderKind) return row.folderID ?? "";
  return null;
}

function getExplorerRowOrderKind(row: ExplorerTreeNode): CompanyExplorerItemType | CompanyExplorerFolderKind | null {
  if (row.kind === "folder") return row.folderKind ?? null;
  return row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : row.kind === "kanban" ? "kanban" : null;
}

function getExplorerSelectionDomain(row?: ExplorerTreeNode | null): ExplorerSelectionDomain {
  if (!row) return "root";
  if (row.kind === "node") return "node";
  if (row.kind === "logic_gate") return "logic_gate";
  if (row.kind === "kanban") return "kanban";
  return row.folderKind ?? "root";
}

function getExplorerFindTarget(row?: ExplorerTreeNode | null): ExplorerFindTarget | null {
  if (row?.kind === "node" && row.nodeID) return { kind: "node", id: row.nodeID };
  if (row?.kind === "logic_gate" && row.logicGateID) return { kind: "logic_gate", id: row.logicGateID };
  return null;
}

function isExplorerTextInputTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.closest("input, textarea, [contenteditable='true']"));
}

function getExplorerDropIntent(event: React.DragEvent<HTMLElement>): ExplorerRowDropPlacement | "inside" {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = event.clientY - rect.top;
  if (y < rect.height * 0.25) return "before";
  if (y > rect.height * 0.75) return "after";
  return "inside";
}

function getExplorerRowReorderPlacement(event: React.DragEvent<HTMLElement>): ExplorerRowDropPlacement {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function readExpandedRowsFromStorage(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set(EXPLORER_DEFAULT_EXPANDED_ROW_IDS);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set(EXPLORER_DEFAULT_EXPANDED_ROW_IDS);
    const ids = parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return new Set(ids.length > 0 ? ids : EXPLORER_DEFAULT_EXPANDED_ROW_IDS);
  } catch {
    return new Set(EXPLORER_DEFAULT_EXPANDED_ROW_IDS);
  }
}

function readScrollTopFromStorage(key: string): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function readRootRowOrderFromStorage(key: string): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: Record<string, number> = {};
    for (const [rowID, value] of Object.entries(parsed)) {
      if (typeof rowID === "string" && typeof value === "number" && Number.isFinite(value) && value > 0) next[rowID] = value;
    }
    return next;
  } catch {
    return {};
  }
}

const ExplorerRowIcon: React.FC<{ kind: ExplorerTreeNode["kind"] }> = ({ kind }) => {
  if (kind === "folder") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
        <path d="M1.4 4.3h4.8l1.1 1.35h7.1v6.35a1.45 1.45 0 0 1-1.45 1.45H2.85A1.45 1.45 0 0 1 1.4 12z" fill="#f6c944" stroke="#9d7412" strokeWidth="1.15" strokeLinejoin="round" />
        <path d="M1.4 5.65V3.9c0-.8.65-1.45 1.45-1.45h3.1L7.2 4.3" fill="#ffd85a" stroke="#9d7412" strokeWidth="1.15" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "node") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
        <path d="M3.7 1.7h5.45l3.15 3.15v9.45H3.7z" fill="#ffffff" stroke="#101010" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M9.15 1.7v3.15h3.15M5.55 7.25h4.9M5.55 9.55h4.9M5.55 11.85h3.25" fill="none" stroke="#101010" strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "kanban") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
        <rect x="1.6" y="2.2" width="12.8" height="11.6" rx="1.1" fill="#fffaf0" stroke="#7a5b12" strokeWidth="1.15" />
        <path d="M5.6 2.2v11.6M10.4 2.2v11.6" stroke="#7a5b12" strokeWidth="1" />
        <rect x="2.8" y="4" width="1.8" height="3.1" fill="#f2c94c" />
        <rect x="6.8" y="4" width="2" height="5.1" fill="#2f7d62" />
        <rect x="11.2" y="4" width="1.9" height="2.4" fill="#245c9f" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
      <path d="M1.4 5.25h3.05M1.4 10.75h3.05M11.7 8h2.9" fill="none" stroke="#0c8f47" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M4.35 3.55h3.35c2.45 0 4.45 1.95 4.45 4.45s-2 4.45-4.45 4.45H4.35z" fill="#e8fff1" stroke="#0c8f47" strokeWidth="1.25" strokeLinejoin="round" />
      <circle cx="4.35" cy="5.25" r="0.85" fill="#16b85f" />
      <circle cx="4.35" cy="10.75" r="0.85" fill="#16b85f" />
      <circle cx="12.15" cy="8" r="0.85" fill="#16b85f" />
    </svg>
  );
};

const ExplorerDisclosureIcon: React.FC<{ open: boolean; color: string }> = ({ open, color }) => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style={{ display: "block" }}>
    <path
      d={open ? "M3.25 4.55 6 7.3l2.75-2.75" : "M4.55 3.25 7.3 6 4.55 8.75"}
      fill="none"
      stroke={color}
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

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
  const [explorerContextMenu, setExplorerContextMenu] = useState<{
    x: number;
    y: number;
    targets: ExplorerCreationTargets;
    deleteTarget: ExplorerDeleteTarget | null;
    renameTarget: ExplorerRenameTarget | null;
    findTarget: ExplorerFindTarget | null;
    renameTreeID: string;
    renameLabel: string;
    contextKind: CompanyExplorerFolderKind | null;
    kanbanParentFolderID: string;
    canCreateBothFolderTypes: boolean;
  } | null>(null);
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

  const TREE_ROW_HEIGHT = 30;
  const TREE_OVERSCAN = 8;

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

  // Build a file-explorer tree from durable folder rows plus one placement row per item.
  // Folder selection is recursive for map scope, but the tree shows immediate children
  // at each level so the hierarchy stays predictable for users and headless agents.
  const treeRows = useMemo<ExplorerTreeNode[]>(() => {
    const rows: ExplorerTreeNode[] = [];
    const nodeByID = new Map(nodes.map((node) => [node.node_id, node]));
    const logicGateByID = new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
    const kanbanBoardByID = new Map(kanbanBoards.map((board) => [board.board_id, board]));
    const folderLabelByID = new Map(folders.map((folder) => [folder.folder_id, folder.name]));
    const assignedNodes = new Set(folderItems.filter((item) => item.item_type === "node").map((item) => item.item_id));
    const assignedLogicGates = new Set(folderItems.filter((item) => item.item_type === "logic_gate").map((item) => item.item_id));
    const assignedKanbanBoards = new Set(folderItems.filter((item) => item.item_type === "kanban").map((item) => item.item_id));
    const foldersByParent = new Map<string, CompanyExplorerFolder[]>();
    for (const folder of folders) {
      const key = `${folder.folder_kind}:${folder.parent_folder_id ?? ""}`;
      const bucket = foldersByParent.get(key) ?? [];
      bucket.push(folder);
      foldersByParent.set(key, bucket);
    }
    const itemsByFolder = new Map<string, CompanyExplorerFolderItem[]>();
    for (const item of folderItems) {
      const key = item.folder_id;
      const bucket = itemsByFolder.get(key) ?? [];
      bucket.push(item);
      itemsByFolder.set(key, bucket);
    }

    const pushFolderBranch = (folderKind: CompanyExplorerFolderKind, parentFolderID: string, depth: number) => {
      const directItems = (itemsByFolder.get(parentFolderID) ?? []).filter((item) => item.item_type === folderKind || item.item_type === "kanban");
      const branchRows: ExplorerTreeNode[] = [];
      let syntheticRootPosition = 0;
      if (parentFolderID === "" && folderKind === "node") {
        for (const node of nodes) {
          if (assignedNodes.has(node.node_id)) continue;
          syntheticRootPosition += TREE_ROW_POSITION_STEP;
          const rowID = `node-${node.node_id}`;
          branchRows.push({
            id: rowID,
            label: getNodeTitle(node) || node.node_id,
            depth,
            kind: "node",
            nodeID: node.node_id,
            folderID: "",
            folderKind,
            scopeLevel: depth,
            position: rootRowOrder[rowID] ?? syntheticRootPosition,
            createdTimestamp: node.created_timestamp,
          });
        }
      }
      if (parentFolderID === "" && folderKind === "logic_gate") {
        for (const logicGate of logicGates) {
          if (assignedLogicGates.has(logicGate.logic_gate_id)) continue;
          syntheticRootPosition += TREE_ROW_POSITION_STEP;
          const rowID = `logic-gate-${logicGate.logic_gate_id}`;
          branchRows.push({
            id: rowID,
            label: getLogicGateTitle(logicGate) || logicGate.logic_gate_id,
            depth,
            kind: "logic_gate",
            logicGateID: logicGate.logic_gate_id,
            folderID: "",
            folderKind,
            scopeLevel: depth,
            position: rootRowOrder[rowID] ?? syntheticRootPosition,
            createdTimestamp: logicGate.created_timestamp,
          });
        }
      }
      for (const item of directItems) {
        if (item.item_type === "node") {
          const node = nodeByID.get(item.item_id);
          if (node) {
            branchRows.push({
              id: `node-${node.node_id}`,
              label: getNodeTitle(node) || node.node_id,
              depth,
              kind: "node",
              nodeID: node.node_id,
              folderID: parentFolderID,
              folderKind,
              folderLabel: folderLabelByID.get(parentFolderID),
              scopeLevel: depth,
              position: item.position || TREE_ROW_POSITION_STEP,
              createdTimestamp: item.created_timestamp,
            });
          }
        } else if (item.item_type === "logic_gate") {
          const logicGate = logicGateByID.get(item.item_id);
          if (logicGate) {
            branchRows.push({
              id: `logic-gate-${logicGate.logic_gate_id}`,
              label: getLogicGateTitle(logicGate) || logicGate.logic_gate_id,
              depth,
              kind: "logic_gate",
              logicGateID: logicGate.logic_gate_id,
              folderID: parentFolderID,
              folderKind,
              folderLabel: folderLabelByID.get(parentFolderID),
              scopeLevel: depth,
              position: item.position || TREE_ROW_POSITION_STEP,
              createdTimestamp: item.created_timestamp,
            });
          }
        } else {
          const board = kanbanBoardByID.get(item.item_id);
          if (board) {
            branchRows.push({
              id: `kanban-${board.board_id}`,
              label: getKanbanBoardDisplayTitle(board),
              depth,
              kind: "kanban",
              kanbanBoardID: board.board_id,
              folderID: parentFolderID,
              folderKind,
              folderLabel: folderLabelByID.get(parentFolderID),
              scopeLevel: depth,
              position: item.position || TREE_ROW_POSITION_STEP,
              createdTimestamp: item.created_timestamp,
            });
          }
        }
      }

      const childFolders = foldersByParent.get(`${folderKind}:${parentFolderID}`) ?? [];
      for (const folder of childFolders) {
        const rowID = `workspace-folder-${folder.folder_id}`;
        branchRows.push({
          id: rowID,
          label: formatExplorerFolderLabel(folder.name),
          depth,
          kind: "folder",
          folderID: folder.folder_id,
          parentFolderID: folder.parent_folder_id ?? "",
          folderKind,
          folderLabel: folder.name,
          scopeLevel: depth,
          position: folder.position || TREE_ROW_POSITION_STEP,
          createdTimestamp: folder.created_timestamp,
        });
      }

      for (const row of sortExplorerRowsByPosition(branchRows)) {
        rows.push(row);
        if (row.kind !== "folder" || !expanded.has(row.id) || !row.folderID) continue;
        pushFolderBranch(folderKind, row.folderID, depth + 1);
      }
    };

    for (const rootRowID of EXPLORER_ROOT_ROW_ORDER) {
      if (rootRowID === "folder-root") {
        rows.push({ id: "folder-root", label: EXPLORER_ROOT_ROW_LABELS["folder-root"], depth: 0, kind: "folder", scopeLevel: 0, position: 0, createdTimestamp: "" });
      }
    }

    if (!expanded.has("folder-root")) return rows;

    // Durable folders/items share sparse positions inside each parent folder.
    // Unplaced root entities use local view positions until a folder placement
    // row exists, because their order is personal UI state rather than graph data.
    pushFolderBranch("node", "", 1);
    pushFolderBranch("logic_gate", "", 1);
    let syntheticBoardPosition = 0;
    for (const board of kanbanBoards) {
      if (assignedKanbanBoards.has(board.board_id)) continue;
      syntheticBoardPosition += TREE_ROW_POSITION_STEP;
      const rowID = `kanban-${board.board_id}`;
      rows.push({
        id: rowID,
        label: getKanbanBoardDisplayTitle(board),
        depth: 1,
        kind: "kanban",
        kanbanBoardID: board.board_id,
        folderID: "",
        scopeLevel: 1,
        position: rootRowOrder[rowID] ?? syntheticBoardPosition,
        createdTimestamp: board.created_timestamp,
      });
    }

    return rows;
  }, [expanded, nodes, logicGates, kanbanBoards, folders, folderItems, rootRowOrder]);

  const selectedTree = useMemo(() => treeRows.find((row) => row.id === selectedTreeID) ?? treeRows[0], [selectedTreeID, treeRows]);
  const rowByID = useMemo(() => new Map(treeRows.map((row) => [row.id, row])), [treeRows]);
  const selectedFolderKind = selectedTree?.folderKind;
  const selectedFolderID = selectedTree?.folderID ?? "";
  const selectedFolderLabel = selectedTree?.folderLabel ?? (selectedTree?.folderKind ? selectedTree.label : "");
  const selectedKanbanBoardLabel = selectedTree?.kind === "kanban" ? selectedTree.label : "";

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
    latestExplorerDomainRef.current = getExplorerSelectionDomain(selectedTree);
  }, [selectedTree]);

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

  // Virtualization window: keeps tree rendering fast when node counts grow.
  const virtualizedTree = useMemo(() => {
    const total = treeRows.length;
    if (total === 0) return { rows: [] as ExplorerTreeNode[], topSpacer: 0, bottomSpacer: 0 };
    const visibleCount = Math.max(1, Math.ceil(treeViewportHeight / TREE_ROW_HEIGHT));
    const start = Math.max(0, Math.floor(treeScrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN);
    const end = Math.min(total, start + visibleCount + TREE_OVERSCAN * 2);
    const rows = treeRows.slice(start, end);
    return {
      rows,
      topSpacer: start * TREE_ROW_HEIGHT,
      bottomSpacer: Math.max(0, (total - end) * TREE_ROW_HEIGHT),
    };
  }, [treeRows, treeViewportHeight, treeScrollTop]);

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
    const rowTop = index * TREE_ROW_HEIGHT;
    const rowBottom = rowTop + TREE_ROW_HEIGHT;
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

  const handleTreeKeyCommand = useCallback((event: React.KeyboardEvent<HTMLDivElement> | KeyboardEvent) => {
    if (isExplorerTextInputTarget(event.target) && event.target instanceof Node && treeViewportRef.current?.contains(event.target)) return;
    const activeTreeRows = treeRowsRef.current;
    const result = resolveExplorerKeyboardNavigation({
      rows: activeTreeRows.map((row) => ({ id: row.id, kind: row.kind })),
      selectedTreeID: selectedTreeIDRef.current,
      expandedIDs: expandedRef.current,
      key: event.key,
    });
    if (!result.handled) return;

    event.preventDefault();
    if (result.expandedIDs) {
      expandedRef.current = result.expandedIDs;
      setExpanded(result.expandedIDs);
    }
    if (result.selectedTreeID) {
      const next = activeTreeRows.find((row) => row.id === result.selectedTreeID);
      if (!next) return;
      selectSingleTreeRow(next);
      scrollTreeRowIntoView(next.id);
    }
  }, [scrollTreeRowIntoView, selectSingleTreeRow]);

  const handleTreeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    handleTreeKeyCommand(event);
  }, [handleTreeKeyCommand]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!treeKeyboardActiveRef.current || event.defaultPrevented) return;
      handleTreeKeyCommand(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTreeKeyCommand]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && treeViewportRef.current?.contains(target)) return;
      treeKeyboardActiveRef.current = false;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

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

  useEffect(() => {
    const refreshLinkedMap = () => {
      const edges = readFrameLinksFromStorage();
      const registry = readFrameRegistryFromStorage();
      const resolved = resolveLinkedFrameByKindFromGraph({
        startFrameID: scope,
        targetKind: "map",
        edges,
        registry,
      });
      const resolvedLogicMap = resolveLinkedFrameByKindFromGraph({
        startFrameID: scope,
        targetKind: "logic-map",
        edges,
        registry,
      });
      setLinkedMapFrameID(resolved);
      setLinkedLogicMapFrameID(resolvedLogicMap);
    };
    refreshLinkedMap();
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== FRAME_LINKS_KEY && event.key !== FRAME_REGISTRY_KEY) return;
      refreshLinkedMap();
    };
    const onGraphUpdated = () => refreshLinkedMap();
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    };
  }, [scope]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== FRAME_LINKS_KEY) return;
      setLinkRevision((value) => value + 1);
    };
    const onGraphUpdated = () => setLinkRevision((value) => value + 1);
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    };
  }, []);

  useEffect(() => {
    const applyLiveSelection = (selection: LiveSelectionChange) => {
      if (selection.companyID !== companyID || selection.sourceFrameID === scope) return;

      const applyTreeSelection = (treeID: string, treeIDs: string[] = [treeID]) => {
        const cleanTreeIDs = Array.from(new Set(treeIDs.map((id) => id.trim()).filter(Boolean)));
        if (cleanTreeIDs.length === 0) cleanTreeIDs.push(treeID);
        setSelectedTreeID(treeID);
        setSelectedTreeIDs(new Set(cleanTreeIDs));
        setSelectionAnchorTreeID(treeID);
        expandTreeIDs(cleanTreeIDs);
      };

      if (selection.entityKind === "folder") {
        suppressNextExplorerBroadcastRef.current = true;
        const treeID = selection.selectedTreeID || (selection.folderID || selection.entityID ? `workspace-folder-${selection.folderID || selection.entityID}` : "folder-root");
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        setSelectedKanbanBoardID("");
        applyTreeSelection(treeID);
        return;
      }

      if (selection.entityKind === "node") {
        if (!selection.entityID) {
          suppressNextExplorerBroadcastRef.current = true;
          setSelectedNodeID("");
          setSelectedLogicGateID("");
          setSelectedKanbanBoardID("");
          applyTreeSelection(selection.selectedTreeID || "folder-root");
          return;
        }
        const localSelection = lastLocalExplorerSelectionRef.current;
        if (!shouldAcceptMapSelectionAfterExplorerSelection({
          incomingDomain: "node",
          currentDomain: latestExplorerDomainRef.current,
          localSelectionChangedAt: localSelection.changedAt,
          incomingChangedAt: selection.changedAt,
          now: Date.now(),
        })) return;
        const nextTreeID = selection.selectedTreeID || `node-${selection.entityID}`;
        const current = latestSelectionRef.current;
        if (current.selectedNodeID === selection.entityID && current.selectedTreeID === nextTreeID) return;
        suppressNextExplorerBroadcastRef.current = true;
        setSelectedNodeID(selection.entityID);
        setSelectedLogicGateID("");
        setSelectedKanbanBoardID("");
        const selectedNodeTreeIDs = (selection.selectedEntityIDs?.length ? selection.selectedEntityIDs : [selection.entityID]).map((id) => `node-${id}`);
        applyTreeSelection(nextTreeID, selection.selectedTreeIDs?.length ? selection.selectedTreeIDs : selectedNodeTreeIDs);
        return;
      }

      if (selection.entityKind === "logic_gate") {
        if (!selection.entityID) {
          suppressNextExplorerBroadcastRef.current = true;
          setSelectedLogicGateID("");
          setSelectedNodeID("");
          setSelectedKanbanBoardID("");
          applyTreeSelection(selection.selectedTreeID || "folder-root");
          return;
        }
        const localSelection = lastLocalExplorerSelectionRef.current;
        if (!shouldAcceptMapSelectionAfterExplorerSelection({
          incomingDomain: "logic_gate",
          currentDomain: latestExplorerDomainRef.current,
          localSelectionChangedAt: localSelection.changedAt,
          incomingChangedAt: selection.changedAt,
          now: Date.now(),
        })) return;
        const nextTreeID = selection.selectedTreeID || `logic-gate-${selection.entityID}`;
        const current = latestLogicGateSelectionRef.current;
        if (current.selectedLogicGateID === selection.entityID && current.selectedTreeID === nextTreeID) return;
        suppressNextExplorerBroadcastRef.current = true;
        setSelectedLogicGateID(selection.entityID);
        setSelectedNodeID("");
        setSelectedKanbanBoardID("");
        applyTreeSelection(nextTreeID, selection.selectedTreeIDs?.length ? selection.selectedTreeIDs : [`logic-gate-${selection.entityID}`]);
        return;
      }

      if (selection.entityKind === "kanban") {
        const boardID = selection.entityID.trim();
        if (!boardID) return;
        const nextTreeID = selection.selectedTreeID || `kanban-${boardID}`;
        suppressNextExplorerBroadcastRef.current = true;
        setSelectedKanbanBoardID(boardID);
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        applyTreeSelection(nextTreeID, selection.selectedTreeIDs?.length ? selection.selectedTreeIDs : [nextTreeID]);
      }
    };

    const liveSelection = readLiveSelectionForFrame(companyID, scope);
    if (liveSelection) applyLiveSelection(liveSelection);
    return subscribeLiveSelection(scope, applyLiveSelection);
  }, [companyID, expandTreeIDs, scope]);

  useEffect(() => {
    const onFindRequested = (event: Event) => {
      const detail = (event as CustomEvent<CompanyExplorerFindRequestDetail>).detail;
      if (!detail || (detail.companyID && detail.companyID !== companyID)) return;
      if (detail.sourceFrameID === scope) return;
      const targetFrameIDs = Array.isArray(detail.targetFrameIDs) ? detail.targetFrameIDs : [];
      if (targetFrameIDs.length > 0 && !targetFrameIDs.includes(scope)) return;

      const entities: ExplorerFindEntity[] = [];
      for (const entity of detail.entities ?? []) {
        if ((entity.kind !== "node" && entity.kind !== "logic_gate") || !entity.id) continue;
        entities.push({ kind: entity.kind, id: entity.id });
      }
      if (entities.length === 0) return;
      applyExplorerFindSelection(entities);
    };

    window.addEventListener(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, onFindRequested);
    return () => window.removeEventListener(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, onFindRequested);
  }, [applyExplorerFindSelection, companyID, scope]);

  useEffect(() => {
    const applyMapSelection = (selectedFromMap: string, changedAt?: number) => {
      const current = latestSelectionRef.current;
      const localSelection = lastLocalExplorerSelectionRef.current;
      if (!shouldAcceptMapSelectionAfterExplorerSelection({
        incomingDomain: "node",
        currentDomain: latestExplorerDomainRef.current,
        localSelectionChangedAt: localSelection.changedAt,
        incomingChangedAt: changedAt,
        now: Date.now(),
      })) return;
      if (!shouldApplyMapSelection(current, selectedFromMap)) return;
      suppressNextExplorerBroadcastRef.current = true;
      setSelectedNodeID(selectedFromMap);
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
      const nextTreeID = `node-${selectedFromMap}`;
      setSelectedTreeID(nextTreeID);
      setSelectedTreeIDs(new Set([nextTreeID]));
      setSelectionAnchorTreeID(nextTreeID);
      expandTreeIDs([nextTreeID]);
    };
    const readFromMapState = () => {
      if (!linkedMapFrameID) return;
      const mapStateKey = `node-map-state-v1:${companyID}:${linkedMapFrameID}`;
      try {
        const raw = localStorage.getItem(mapStateKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { selectedNodeID?: string };
        if (typeof parsed.selectedNodeID === "string") applyMapSelection(parsed.selectedNodeID);
      } catch {
        // ignore malformed map state payload
      }
    };
    readFromMapState();
    const onMapSelectionUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; revision?: number; changedAt?: number; sourceExplorerID?: string; envelope?: ContextMutationEnvelope }>).detail;
      if (!detail || detail.mapWidgetID !== linkedMapFrameID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastMapSelectionRevisionRef.current, revision)) return;
      if (shouldIgnoreSelfOriginatedMapSelection(detail.sourceExplorerID, scope)) {
        if (revision > 0) lastMapSelectionRevisionRef.current = revision;
        return;
      }
      const eventSelectedNodeID = typeof detail.selectedNodeID === "string" ? detail.selectedNodeID : "";
      const eventHasSelection = typeof detail.selectedNodeID === "string";
      if (revision > 0 && shouldReadMapStateForSelectionEvent(hasSequenceGap(lastMapSelectionRevisionRef.current, revision), eventHasSelection)) readFromMapState();
      if (revision > 0) lastMapSelectionRevisionRef.current = revision;
      if (!eventHasSelection) return;
      applyMapSelection(eventSelectedNodeID, detail.changedAt);
    };
    window.addEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelectionUpdated);
    return () => {
      window.removeEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelectionUpdated);
    };
  }, [companyID, expandTreeIDs, linkedMapFrameID]);

  useEffect(() => {
    const applyLogicGateMapSelection = (selectedFromMap: string, changedAt?: number) => {
      if (!selectedFromMap) return;
      const localSelection = lastLocalExplorerSelectionRef.current;
      if (!shouldAcceptMapSelectionAfterExplorerSelection({
        incomingDomain: "logic_gate",
        currentDomain: latestExplorerDomainRef.current,
        localSelectionChangedAt: localSelection.changedAt,
        incomingChangedAt: changedAt,
        now: Date.now(),
      })) return;
      const nextTreeID = `logic-gate-${selectedFromMap}`;
      const current = latestLogicGateSelectionRef.current;
      if (current.selectedLogicGateID === selectedFromMap && current.selectedTreeID === nextTreeID) return;
      suppressNextExplorerBroadcastRef.current = true;
      setSelectedLogicGateID(selectedFromMap);
      setSelectedNodeID("");
      setSelectedKanbanBoardID("");
      setSelectedTreeID(nextTreeID);
      setSelectedTreeIDs(new Set([nextTreeID]));
      setSelectionAnchorTreeID(nextTreeID);
      expandTreeIDs([nextTreeID]);
    };
    const readFromLogicMapState = () => {
      const logicContextFrameID = linkedLogicMapFrameID || linkedMapFrameID;
      if (!logicContextFrameID) return;
      const mapStateKey = `logic-gate-map-state-v1:${companyID}:${logicContextFrameID}`;
      try {
        const raw = localStorage.getItem(mapStateKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { selectedNodeID?: string; selectedLogicGateID?: string };
        const selected = typeof parsed.selectedLogicGateID === "string" ? parsed.selectedLogicGateID : parsed.selectedNodeID;
        if (typeof selected === "string") applyLogicGateMapSelection(selected);
      } catch {
        // ignore malformed logic-gate map state payload
      }
    };
    readFromLogicMapState();
    const onLogicMapSelectionUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; selectedLogicGateID?: string; revision?: number; changedAt?: number; sourceExplorerID?: string; envelope?: ContextMutationEnvelope }>).detail;
      const logicContextFrameID = linkedLogicMapFrameID || linkedMapFrameID;
      if (!detail || detail.mapWidgetID !== logicContextFrameID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastLogicMapSelectionRevisionRef.current, revision)) return;
      if (shouldIgnoreSelfOriginatedMapSelection(detail.sourceExplorerID, scope)) {
        if (revision > 0) lastLogicMapSelectionRevisionRef.current = revision;
        return;
      }
      const selected = typeof detail.selectedLogicGateID === "string" ? detail.selectedLogicGateID : detail.selectedNodeID;
      const eventHasSelection = typeof selected === "string";
      if (revision > 0 && shouldReadMapStateForSelectionEvent(hasSequenceGap(lastLogicMapSelectionRevisionRef.current, revision), eventHasSelection)) readFromLogicMapState();
      if (revision > 0) lastLogicMapSelectionRevisionRef.current = revision;
      if (!eventHasSelection) return;
      applyLogicGateMapSelection(selected, detail.changedAt);
    };
    window.addEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapSelectionUpdated);
    return () => {
      window.removeEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapSelectionUpdated);
    };
  }, [companyID, expandTreeIDs, linkedLogicMapFrameID, linkedMapFrameID]);

  useEffect(() => {
    // Other modules can target the Explorer with node context. This lets a
    // linked Kanban card click highlight the matching Explorer row without a
    // special Kanban-only event bus.
    const applyTargetedExplorerSelection = (selectedFromContext: string) => {
      if (!selectedFromContext) return;
      const nextTreeID = `node-${selectedFromContext}`;
      const current = latestSelectionRef.current;
      if (current.selectedNodeID === selectedFromContext && current.selectedTreeID === nextTreeID) return;
      setSelectedNodeID(selectedFromContext);
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
      setSelectedTreeID(nextTreeID);
      setSelectedTreeIDs(new Set([nextTreeID]));
      setSelectionAnchorTreeID(nextTreeID);
      expandTreeIDs([nextTreeID]);
    };
    const readTargetedExplorerContext = () => {
      const key = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { selectedNodeID?: unknown };
        if (typeof parsed.selectedNodeID === "string") applyTargetedExplorerSelection(parsed.selectedNodeID);
      } catch {
        // ignore malformed cross-module context payloads
      }
    };
    readTargetedExplorerContext();
  }, [companyID, expandTreeIDs, scope]);

  useEffect(() => {
    const nextSelection = { selectedNodeID, selectedTreeID };
    if (!shouldBroadcastSelection(previousBroadcastSelectionRef.current, nextSelection)) return;
    previousBroadcastSelectionRef.current = nextSelection;

    if (suppressNextExplorerBroadcastRef.current) {
      suppressNextExplorerBroadcastRef.current = false;
      return;
    }
    try {
      const graph = readFrameLinksFromStorage();
      const registry = readFrameRegistryFromStorage();
      const targetIDs = new Set(resolveConnectedFrameTargets({ sourceFrameID: scope, edges: graph, registry }));
      if (targetIDs.size === 0) return;

      explorerContextSequenceRef.current += 1;
      const changedAt = Date.now();
      const targetFrameIDs = Array.from(targetIDs);
      const publishedSelection = resolveExplorerPublishedSelection({
        selectedTreeID,
        selectedNodeID,
        selectedLogicGateID,
        selectedKanbanBoardID,
        selectedFolderID,
        selectedFolderKind,
      });
      const selectedEntityIDs = Array.from(selectedTreeIDs).map((treeID) => {
        if (publishedSelection.entityKind === "node" && treeID.startsWith("node-")) return treeID.slice("node-".length);
        if (publishedSelection.entityKind === "logic_gate" && treeID.startsWith("logic-gate-")) return treeID.slice("logic-gate-".length);
        if (publishedSelection.entityKind === "kanban" && treeID.startsWith("kanban-")) return treeID.slice("kanban-".length);
        return "";
      }).filter(Boolean);
      const selectionIntent = pendingExplorerSelectionIntentRef.current;
      publishLiveSelection({
        companyID,
        entityKind: publishedSelection.entityKind,
        entityID: publishedSelection.entityID,
        label: selectedTree?.label || selectedKanbanBoardLabel || "",
        sourceFrameID: scope,
        sourceModule: "company-explorer",
        targetFrameIDs,
        selectedTreeID,
        selectedTreeIDs: Array.from(selectedTreeIDs),
        selectedEntityIDs,
        folderKind: selectedFolderKind,
        folderID: selectedFolderID,
        folderLabel: selectedFolderLabel,
        changedAt,
        sequence: explorerContextSequenceRef.current,
        selectionIntent,
      });
      if (publishedSelection.selectedKanbanBoardID) return;
      for (const targetID of targetIDs) {
        if (!targetID) continue;
        const targetKind = classifyFrameKind(registry[targetID]?.kind ?? "");
        const targetSelection = resolveExplorerPublishedSelection({
          selectedTreeID,
          selectedNodeID,
          selectedLogicGateID,
          selectedKanbanBoardID,
          selectedFolderID,
          selectedFolderKind,
          targetFrameKind: targetKind,
        });
        const payload = {
          sourceExplorerID: scope,
          // The tree row is the user's primary intent. Normalizing here keeps
          // stale opposite-domain state from sending a node click to a logic map.
          selectedNodeID: targetSelection.selectedNodeID,
          selectedLogicGateID: targetSelection.selectedLogicGateID,
          selectedFolderID,
          selectedFolderKind,
          selectedFolderLabel,
          selectedTreeID,
          scopeLevel: selectedTree?.scopeLevel ?? 0,
          selectedLabel: selectedTree?.label ?? "",
          selectionIntent,
          ts: changedAt,
          envelope: {
            context_id: `explorer_navigation_context:${companyID}:${targetID}`,
            source_module_id: scope,
            sequence: explorerContextSequenceRef.current,
            timestamp: new Date().toISOString(),
            user_action_type: "explorer_selection_changed",
          } satisfies ContextMutationEnvelope,
        };
        const keyPrefix = targetSelection.isLogicGateContext ? LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX : NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX;
        const key = `${keyPrefix}:${companyID}:${targetID}`;
        localStorage.setItem(key, JSON.stringify(payload));
        emitDashboardEvent(EVENT_EXPLORER_CONTEXT_UPDATED, { key, sourceExplorerID: scope, targetID });
      }
    } catch {
      // ignore local storage failures
    }
  }, [companyID, scope, selectedNodeID, selectedLogicGateID, selectedKanbanBoardID, selectedFolderID, selectedFolderKind, selectedFolderLabel, selectedKanbanBoardLabel, selectedTreeID, selectedTreeIDs, selectedTree, linkRevision]);

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
      <div
        className="company-explorer-scroll"
        ref={treeViewportRef}
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
        onScroll={(event) => setTreeScrollTop((event.currentTarget as HTMLDivElement).scrollTop)}
        onMouseEnter={() => {
          treeKeyboardActiveRef.current = true;
        }}
        onMouseDownCapture={(event) => {
          treeKeyboardActiveRef.current = true;
          treeViewportRef.current?.focus({ preventScroll: true });
          if (event.button === 0) setExplorerContextMenu(null);
        }}
        onContextMenu={(event) => openExplorerContextMenu(event)}
        style={{ overflowY: "auto", overflowX: "hidden", minWidth: 0, outline: "none", scrollbarGutter: "stable", ["--company-explorer-scroll-accent" as string]: scrollbarAccent, ["--company-explorer-scroll-track" as string]: scrollbarTrack }}
      >
        <div style={{ padding: "9px 10px", borderBottom: `1px solid ${ruleColor}`, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>Company Explorer</div>
        {error && <div style={{ padding: "7px 10px", borderBottom: `1px solid ${ruleColor}`, color: "#b00020", fontSize: 11, fontWeight: 700 }}>Error: {error}</div>}
        <div style={{ height: virtualizedTree.topSpacer }} />
        {virtualizedTree.rows.map((row) => {
          const isFolder = row.kind === "folder";
          const isOpen = expanded.has(row.id);
          const isSelected = selectedTreeID === row.id || selectedTreeIDs.has(row.id);
          const rowDragPayload = getExplorerDragPayloadForSelection(row, selectedTreeIDs, treeRows);
          const isDragging = draggingTreeID === row.id;
          const isDropTarget = dragOverTreeID === row.id;
          return (
            <div
              key={row.id}
              className="company-explorer-row"
              draggable={!!rowDragPayload && renaming?.treeID !== row.id}
              onClick={(event) => selectTreeRow(row, event)}
              onContextMenu={(event) => openExplorerContextMenu(event, row)}
              onDragStart={(event) => {
                if (!rowDragPayload) {
                  event.preventDefault();
                  return;
                }
                const kanbanDragItems = getKanbanDragItemsForRow(row);
                const explorerDragRows = getExplorerItemRowsForPayload(rowDragPayload);
                if (!selectedTreeIDs.has(row.id)) selectTreeRow(row, undefined, { selectionIntent: "navigate" });
                setDraggingTreeID(row.id);
                setDragPayload(rowDragPayload);
                event.dataTransfer.effectAllowed = row.kind === "folder" ? "move" : "copyMove";
                const serialized = JSON.stringify(rowDragPayload);
                event.dataTransfer.setData(EXPLORER_DRAG_MIME, serialized);
                if (kanbanDragItems.length > 0) {
                  const kanbanPayload = serializeExplorerEntityDragPayload(kanbanDragItems.length === 1
                    ? { itemType: "node", nodeID: kanbanDragItems[0].nodeID, label: kanbanDragItems[0].label }
                    : { itemType: "node_batch", nodes: kanbanDragItems });
                  event.dataTransfer.setData(EXPLORER_ENTITY_DRAG_MIME, kanbanPayload);
                  attachStackedDragPreview(
                    event.dataTransfer,
                    kanbanDragItems.map((item) => ({ label: item.label, color: rowIconColor })),
                    KANBAN_DEFAULT_COLUMN_ITEM_COLOR,
                    "Explorer nodes",
                  );
                } else if (explorerDragRows.length > 1) {
                  attachStackedDragPreview(
                    event.dataTransfer,
                    explorerDragRows.map((item) => ({ label: item.label, color: rowIconColor })),
                    rowIconColor,
                    row.kind === "logic_gate" ? "Explorer logic gates" : "Explorer items",
                  );
                }
                event.dataTransfer.setData("text/plain", kanbanDragItems.length > 1 ? `${kanbanDragItems.length} nodes` : row.label);
              }}
              onDragEnd={() => {
                setDraggingTreeID("");
                setDragOverTreeID("");
                setDragOverPlacement(null);
                setDragPayload(null);
              }}
              onDragOver={(event) => {
                const payload = dragPayload ?? readExplorerDragPayload(event.dataTransfer);
                const sourceRow = treeRows.find((item) => item.id === draggingTreeID);
                const placement = row.kind === "folder" ? getExplorerDropIntent(event) : getExplorerRowReorderPlacement(event);
                const isDraggedItemRow = payload?.kind !== "folder" && getExplorerItemRowsForPayload(payload).some((item) => item.id === row.id);
                if (isDraggedItemRow) return;
                if (payload?.kind === "folder" && placement !== "inside" && sourceRow && sourceRow.id !== row.id && getReorderRowsForTarget(sourceRow, row).length > 0) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverTreeID(row.id);
                  setDragOverPlacement(placement);
                  return;
                }
                if (payload?.kind === "folder" && placement !== "inside" && sourceRow && canPlaceExplorerFolderAtTarget(sourceRow, row)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverTreeID(row.id);
                  setDragOverPlacement(placement);
                  return;
                }
                if (payload?.kind !== "folder" && placement !== "inside" && canPlaceExplorerItemsAtTarget(payload, row)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverTreeID(row.id);
                  setDragOverPlacement(placement);
                  return;
                }
                const dropTarget = resolveExplorerDropTarget(row, payload) ?? resolveExplorerRootDropTarget(row, payload);
                if (!dropTarget) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverTreeID(row.id);
                setDragOverPlacement(null);
              }}
              onDragLeave={() => {
                setDragOverTreeID((current) => (current === row.id ? "" : current));
                setDragOverPlacement(null);
              }}
              onDrop={(event) => {
                const payload = dragPayload ?? readExplorerDragPayload(event.dataTransfer);
                const sourceRow = treeRows.find((item) => item.id === draggingTreeID);
                const placement = dragOverPlacement ?? (row.kind === "folder" ? getExplorerDropIntent(event) : getExplorerRowReorderPlacement(event));
                const dropTarget = resolveExplorerDropTarget(row, payload) ?? resolveExplorerRootDropTarget(row, payload);
                const isDraggedItemRow = payload?.kind !== "folder" && getExplorerItemRowsForPayload(payload).some((item) => item.id === row.id);
                setDragOverTreeID("");
                setDragOverPlacement(null);
                if (isDraggedItemRow) return;
                if (payload?.kind === "folder" && placement !== "inside" && sourceRow && sourceRow.id !== row.id && getReorderRowsForTarget(sourceRow, row).length > 0) {
                  event.preventDefault();
                  void reorderExplorerRows(sourceRow, row, placement);
                  return;
                }
                if (payload?.kind === "folder" && placement !== "inside" && sourceRow && canPlaceExplorerFolderAtTarget(sourceRow, row)) {
                  event.preventDefault();
                  void placeExplorerFolderAtTarget(sourceRow, row, placement);
                  return;
                }
                if (payload?.kind !== "folder" && placement !== "inside" && canPlaceExplorerItemsAtTarget(payload, row)) {
                  event.preventDefault();
                  void placeExplorerItemsAtTarget(payload, row, placement);
                  return;
                }
                if (!dropTarget || !payload) return;
                event.preventDefault();
                if (payload.kind === "folder" && payload.folderID) {
                  void moveFolder(payload.folderID, dropTarget.folderID);
                  return;
                }
                void assignExplorerPayloadItemsToFolder(dropTarget.folderID, getExplorerDropPayloadItemType(payload) ?? dropTarget.folderKind, payload);
              }}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 6,
                minHeight: TREE_ROW_HEIGHT,
                padding: "4px 8px",
                paddingLeft: TREE_BASE_LEFT_PX + row.depth * TREE_INDENT_PX,
                fontSize: 12,
                cursor: "default",
                opacity: isDragging ? 0.55 : 1,
                ["--company-explorer-hover-bg" as string]: isDarkTheme ? "rgba(255,255,255,0.07)" : "rgba(0, 233, 255, 0.13)",
                background: isDropTarget ? dropRowBackground : (isSelected ? selectedRowBackground : undefined),
                borderBottom: `1px solid ${rowRuleColor}`,
                boxShadow: isDropTarget && dragOverPlacement
                  ? (dragOverPlacement === "before" ? `inset 0 2px 0 ${accent}` : `inset 0 -2px 0 ${accent}`)
                  : undefined,
              }}
            >
              {isFolder ? (
                <button
                  draggable={false}
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    });
                  }}
                  style={{ border: "none", background: "transparent", width: TREE_TOGGLE_SLOT_PX, height: 20, cursor: "pointer", color: folderToggleColor, display: "grid", placeItems: "center", padding: 0, flexShrink: 0 }}
                >
                  <ExplorerDisclosureIcon open={isOpen} color={folderToggleColor} />
                </button>
              ) : <span style={{ width: TREE_TOGGLE_SLOT_PX, flexShrink: 0 }} />}
              <ExplorerRowIcon kind={row.kind} />
              {renaming?.treeID === row.id ? (
                <input
                  ref={renameInputRef}
                  value={renaming.value}
                  onChange={(event) => setRenaming((current) => (current ? { ...current, value: event.target.value } : current))}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.stopPropagation();
                      if (renaming) void commitRename({ ...renaming, value: event.currentTarget.value });
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      cancelRenameOnBlurRef.current = true;
                      setRenaming(null);
                    }
                  }}
                  onBlur={(event) => {
                    if (cancelRenameOnBlurRef.current) {
                      cancelRenameOnBlurRef.current = false;
                      return;
                    }
                    if (renaming) void commitRename({ ...renaming, value: event.currentTarget.value });
                  }}
                  style={{
                    minWidth: 0,
                    width: "100%",
                    border: `1px solid ${accent}`,
                    background: surfaceBackground,
                    color: surfaceText,
                    font: "inherit",
                    fontSize: 12,
                    padding: "1px 4px",
                    outline: "none",
                  }}
                />
              ) : (
                <span
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    startRenamingRow(row);
                  }}
                  style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "default", userSelect: "none" }}
                >
                  {row.label}
                </span>
              )}
            </div>
          );
        })}
        <div style={{ height: virtualizedTree.bottomSpacer }} />
      </div>

      {explorerContextMenu && (
        <FrameRightClickMenu x={explorerContextMenu.x} y={explorerContextMenu.y} onClose={() => setExplorerContextMenu(null)}>
          {explorerContextMenu.canCreateBothFolderTypes ? (
            <>
              <button
                style={{ ...explorerMenuButtonStyle, color: "#111111" }}
                onClick={() => {
                  void createFolder("node", explorerContextMenu.targets.nodeFolderParentID);
                  setExplorerContextMenu(null);
                }}
              >
                Create node folder
              </button>
              <button
                style={{ ...explorerMenuButtonStyle, color: "#111111" }}
                onClick={() => {
                  void createNodeAtFolder(explorerContextMenu.targets.nodeParentFolderID);
                  setExplorerContextMenu(null);
                }}
              >
                Create node
              </button>
              <button
                style={{ ...explorerMenuButtonStyle, color: "#111111" }}
                onClick={() => {
                  void createFolder("logic_gate", explorerContextMenu.targets.logicGateFolderParentID);
                  setExplorerContextMenu(null);
                }}
              >
                Create logic gate folder
              </button>
              <button
                style={{ ...explorerMenuButtonStyle, color: "#111111" }}
                onClick={() => {
                  void createLogicGateAtFolder(explorerContextMenu.targets.logicGateParentFolderID);
                  setExplorerContextMenu(null);
                }}
              >
                Create logic gate
              </button>
              <button
                style={{ ...explorerMenuButtonStyle, color: "#111111" }}
                onClick={() => {
                  void createKanbanAtFolder("");
                  setExplorerContextMenu(null);
                }}
              >
                Create new kanban
              </button>
            </>
          ) : (
            <>
              <button
                style={{ ...explorerMenuButtonStyle, color: "#111111" }}
                onClick={() => {
                  void createFolder(explorerContextMenu.targets.preferredFolderKind, explorerContextMenu.targets.preferredFolderParentID);
                  setExplorerContextMenu(null);
                }}
              >
                Create folder
              </button>
              {explorerContextMenu.contextKind !== "logic_gate" && (
                <button
                  style={{ ...explorerMenuButtonStyle, color: "#111111" }}
                  onClick={() => {
                    void createNodeAtFolder(explorerContextMenu.targets.nodeParentFolderID);
                    setExplorerContextMenu(null);
                  }}
                >
                  Create node
                </button>
              )}
              {explorerContextMenu.contextKind !== "node" && (
                <button
                  style={{ ...explorerMenuButtonStyle, color: "#111111" }}
                  onClick={() => {
                    void createLogicGateAtFolder(explorerContextMenu.targets.logicGateParentFolderID);
                    setExplorerContextMenu(null);
                  }}
                >
                  Create logic gate
                </button>
              )}
              <button
                style={{ ...explorerMenuButtonStyle, color: "#111111" }}
                onClick={() => {
                  void createKanbanAtFolder(explorerContextMenu.kanbanParentFolderID);
                  setExplorerContextMenu(null);
                }}
              >
                Create new kanban
              </button>
            </>
          )}
          {explorerContextMenu.findTarget && (
            <button
              style={{ ...explorerMenuButtonStyle, color: "#111111" }}
              onClick={() => {
                const target = explorerContextMenu.findTarget;
                setExplorerContextMenu(null);
                if (target) requestMapFind(target);
              }}
            >
              {explorerContextMenu.findTarget.kind === "logic_gate" ? "Find Logic Gate" : "Find Node"}
            </button>
          )}
          {explorerContextMenu.renameTarget && (
            <button
              style={{ ...explorerMenuButtonStyle, color: "#111111" }}
              onClick={() => {
                const target = explorerContextMenu.renameTarget;
                const treeID = explorerContextMenu.renameTreeID;
                const value = explorerContextMenu.renameLabel;
                setExplorerContextMenu(null);
                if (!target || !treeID) return;
                cancelRenameOnBlurRef.current = false;
                setSelectedTreeID(treeID);
                setSelectedTreeIDs(new Set([treeID]));
                setSelectionAnchorTreeID(treeID);
                setRenaming({ treeID, target, value });
              }}
            >
              Rename
            </button>
          )}
          {explorerContextMenu.deleteTarget && (
            <button
              style={{ ...explorerMenuButtonStyle, color: "#c62828" }}
              onClick={() => {
                const target = explorerContextMenu.deleteTarget;
                setExplorerContextMenu(null);
                if (target) void deleteExplorerTarget(target);
              }}
            >
              Delete
            </button>
          )}
        </FrameRightClickMenu>
      )}

    </div>
  );
};
