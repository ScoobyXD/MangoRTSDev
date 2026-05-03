import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getNodeTitle, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, NodeRecord } from "../node-map/shared";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, getNodeTitle as getLogicGateTitle, LogicGateRecord as LogicGateApiRecord, NodeRecord as LogicGateRecord, toLogicGateCanvasRecord } from "../logic-gate-map/shared";
import { emitDashboardEvent, EVENT_EXPLORER_CONTEXT_UPDATED, EVENT_FRAME_LINK_GRAPH_UPDATED, EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { getNodeRelationshipGraphSnapshot, refreshNodeRelationshipGraphSnapshot, removeCompanyExplorerFolderInNodeRelationshipGraph, removeNodeRelationshipGraphNode, subscribeNodeRelationshipGraph, upsertCompanyExplorerFolderInNodeRelationshipGraph, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../node-map/NodeRelationshipGraph";
import { getLogicGateRelationshipGraphSnapshot, refreshLogicGateRelationshipGraphSnapshot, removeCompanyExplorerFolderInLogicGateRelationshipGraph, removeLogicGateRelationshipGraphNode, subscribeLogicGateRelationshipGraph, upsertCompanyExplorerFolderInLogicGateRelationshipGraph, upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../logic-gate-map/LogicGateRelationshipGraph";
import { classifyFrameKind, FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveDirectLinkedTargets, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";
import { shouldApplyMapSelection, shouldBroadcastSelection, type ExplorerSelectionState } from "./explorerSync";
import { hasSequenceGap, isNewerSequence, readIncomingSequence, type ContextMutationEnvelope } from "../contextSyncContract";
import { type CompanyExplorerFolder, type CompanyExplorerFolderItem, type CompanyExplorerFolderKind } from "../folders/companyExplorerFolders";
import { EXPLORER_ENTITY_DRAG_MIME, serializeExplorerEntityDragPayload } from "../kanban/shared";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { EXPLORER_DEFAULT_EXPANDED_ROW_IDS, EXPLORER_ROOT_ROW_LABELS, EXPLORER_ROOT_ROW_ORDER, formatExplorerFolderLabel, resolveExplorerCreationTargets, resolveExplorerDeleteTarget, type ExplorerCreationTargets } from "./treePresentation";

type ExplorerTreeNode = {
  id: string;
  label: string;
  depth: number;
  kind: "folder" | "node" | "logic_gate";
  nodeID?: string;
  logicGateID?: string;
  folderID?: string;
  folderKind?: CompanyExplorerFolderKind;
  folderLabel?: string;
  scopeLevel: number;
};

type ExplorerDragPayload = {
  kind: "folder" | "node" | "logic_gate";
  folderID?: string;
  folderKind?: CompanyExplorerFolderKind;
  itemID?: string;
  itemType?: CompanyExplorerFolderKind;
};

type ExplorerDeleteTarget = NonNullable<ReturnType<typeof resolveExplorerDeleteTarget>>;

const EXPLORER_DRAG_MIME = "application/x-mangoos-company-explorer-row";
const TREE_INDENT_PX = 16;
const TREE_BASE_LEFT_PX = 10;
const TREE_TOGGLE_SLOT_PX = 18;

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
  return null;
}

function readExplorerDragPayload(dataTransfer: DataTransfer): ExplorerDragPayload | null {
  try {
    const raw = dataTransfer.getData(EXPLORER_DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExplorerDragPayload;
    if (parsed.kind === "folder" && parsed.folderID && parsed.folderKind) return parsed;
    if ((parsed.kind === "node" || parsed.kind === "logic_gate") && parsed.itemID && parsed.itemType) return parsed;
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

  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [logicGates, setLogicGates] = useState<LogicGateRecord[]>([]);
  const [folders, setFolders] = useState<CompanyExplorerFolder[]>([]);
  const [folderItems, setFolderItems] = useState<CompanyExplorerFolderItem[]>([]);
  const [selectedTreeID, setSelectedTreeID] = useState("folder-logic");
  const [selectedNodeID, setSelectedNodeID] = useState("");
  const [selectedLogicGateID, setSelectedLogicGateID] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(EXPLORER_DEFAULT_EXPANDED_ROW_IDS));
  const treeViewportRef = useRef<HTMLDivElement | null>(null);
  const [treeScrollTop, setTreeScrollTop] = useState(0);
  const [treeViewportHeight, setTreeViewportHeight] = useState(480);
  const [draggingTreeID, setDraggingTreeID] = useState("");
  const [dragOverTreeID, setDragOverTreeID] = useState("");
  const [dragPayload, setDragPayload] = useState<ExplorerDragPayload | null>(null);
  const [explorerContextMenu, setExplorerContextMenu] = useState<{ x: number; y: number; targets: ExplorerCreationTargets; deleteTarget: ExplorerDeleteTarget | null } | null>(null);
  const [linkRevision, setLinkRevision] = useState(0);
  const [linkedMapFrameID, setLinkedMapFrameID] = useState("");
  const [linkedLogicMapFrameID, setLinkedLogicMapFrameID] = useState("");
  const lastMapSelectionRevisionRef = useRef(0);
  const lastLogicMapSelectionRevisionRef = useRef(0);
  const suppressNextExplorerBroadcastRef = useRef(false);
  const previousBroadcastSelectionRef = useRef({ selectedNodeID: "", selectedTreeID: "" });
  const latestSelectionRef = useRef<ExplorerSelectionState>({ selectedNodeID: "", selectedTreeID: "" });
  const latestLogicGateSelectionRef = useRef({ selectedLogicGateID: "", selectedTreeID: "" });
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

  // Build a file-explorer tree from durable folder rows plus one placement row per item.
  // Folder selection is recursive for map scope, but the tree shows immediate children
  // at each level so the hierarchy stays predictable for users and headless agents.
  const treeRows = useMemo<ExplorerTreeNode[]>(() => {
    const rows: ExplorerTreeNode[] = [];
    const nodeByID = new Map(nodes.map((node) => [node.node_id, node]));
    const logicGateByID = new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
    const assignedNodes = new Set(folderItems.filter((item) => item.item_type === "node").map((item) => item.item_id));
    const assignedLogicGates = new Set(folderItems.filter((item) => item.item_type === "logic_gate").map((item) => item.item_id));
    const foldersByParent = new Map<string, CompanyExplorerFolder[]>();
    for (const folder of folders) {
      const key = `${folder.folder_kind}:${folder.parent_folder_id ?? ""}`;
      const bucket = foldersByParent.get(key) ?? [];
      bucket.push(folder);
      foldersByParent.set(key, bucket);
    }
    for (const bucket of foldersByParent.values()) {
      bucket.sort((a, b) => a.name.localeCompare(b.name) || a.created_timestamp.localeCompare(b.created_timestamp));
    }
    const itemsByFolder = new Map<string, CompanyExplorerFolderItem[]>();
    for (const item of folderItems) {
      const key = `${item.item_type}:${item.folder_id}`;
      const bucket = itemsByFolder.get(key) ?? [];
      bucket.push(item);
      itemsByFolder.set(key, bucket);
    }

    const pushFolderBranch = (folderKind: CompanyExplorerFolderKind, parentFolderID: string, depth: number) => {
      const childFolders = foldersByParent.get(`${folderKind}:${parentFolderID}`) ?? [];
      for (const folder of childFolders) {
        const directItems = itemsByFolder.get(`${folderKind}:${folder.folder_id}`) ?? [];
        const rowID = `workspace-folder-${folder.folder_id}`;
        rows.push({
          id: rowID,
          label: formatExplorerFolderLabel(folder.name),
          depth,
          kind: "folder",
          folderID: folder.folder_id,
          folderKind,
          folderLabel: folder.name,
          scopeLevel: depth,
        });
        if (!expanded.has(rowID)) continue;
        pushFolderBranch(folderKind, folder.folder_id, depth + 1);
        for (const item of directItems) {
          if (folderKind === "node") {
            const node = nodeByID.get(item.item_id);
            if (node) {
              rows.push({
                id: `node-${node.node_id}`,
                label: getNodeTitle(node) || node.node_id,
                depth: depth + 1,
                kind: "node",
                nodeID: node.node_id,
                folderID: folder.folder_id,
                folderKind,
                folderLabel: folder.name,
                scopeLevel: depth + 1,
              });
            }
          } else {
            const logicGate = logicGateByID.get(item.item_id);
            if (logicGate) {
              rows.push({
                id: `logic-gate-${logicGate.logic_gate_id}`,
                label: getLogicGateTitle(logicGate) || logicGate.logic_gate_id,
                depth: depth + 1,
                kind: "logic_gate",
                logicGateID: logicGate.logic_gate_id,
                folderID: folder.folder_id,
                folderKind,
                folderLabel: folder.name,
                scopeLevel: depth + 1,
              });
            }
          }
        }
      }
    };

    for (const rootRowID of EXPLORER_ROOT_ROW_ORDER) {
      if (rootRowID === "folder-root") {
        rows.push({ id: "folder-root", label: EXPLORER_ROOT_ROW_LABELS["folder-root"], depth: 0, kind: "folder", scopeLevel: 0 });
        continue;
      }
      if (rootRowID === "folder-logic") {
        rows.push({ id: "folder-logic", label: EXPLORER_ROOT_ROW_LABELS["folder-logic"], depth: 1, kind: "folder", folderKind: "logic_gate", folderLabel: EXPLORER_ROOT_ROW_LABELS["folder-logic"], scopeLevel: 1 });
        if (expanded.has("folder-logic")) {
          pushFolderBranch("logic_gate", "", 2);
          for (const logicGate of logicGates) {
            if (!assignedLogicGates.has(logicGate.logic_gate_id)) {
              rows.push({
                id: `logic-gate-${logicGate.logic_gate_id}`,
                label: getLogicGateTitle(logicGate) || logicGate.logic_gate_id,
                depth: 2,
                kind: "logic_gate",
                logicGateID: logicGate.logic_gate_id,
                scopeLevel: 2,
              });
            }
          }
        }
        continue;
      }

      rows.push({ id: "folder-nodes", label: EXPLORER_ROOT_ROW_LABELS["folder-nodes"], depth: 1, kind: "folder", folderKind: "node", folderLabel: EXPLORER_ROOT_ROW_LABELS["folder-nodes"], scopeLevel: 1 });
      if (expanded.has("folder-nodes")) {
        pushFolderBranch("node", "", 2);
        for (const node of nodes) {
          if (!assignedNodes.has(node.node_id)) rows.push({ id: `node-${node.node_id}`, label: getNodeTitle(node) || node.node_id, depth: 2, kind: "node", nodeID: node.node_id, scopeLevel: 2 });
        }
      }
    }

    return rows;
  }, [expanded, nodes, logicGates, folders, folderItems]);

  const selectedTree = useMemo(() => treeRows.find((row) => row.id === selectedTreeID) ?? treeRows[0], [selectedTreeID, treeRows]);
  const selectedFolderKind = selectedTree?.folderKind;
  const selectedFolderID = selectedTree?.folderID ?? "";
  const selectedFolderLabel = selectedTree?.folderLabel ?? (selectedTree?.folderKind ? selectedTree.label : "");

  useEffect(() => {
    latestSelectionRef.current = { selectedNodeID, selectedTreeID };
  }, [selectedNodeID, selectedTreeID]);

  useEffect(() => {
    latestLogicGateSelectionRef.current = { selectedLogicGateID, selectedTreeID };
  }, [selectedLogicGateID, selectedTreeID]);

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
        next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : (folderKind === "logic_gate" ? "folder-logic" : "folder-nodes"));
        next.add(`workspace-folder-${folder.folder_id}`);
        return next;
      });
      if (folder.folder_kind === "logic_gate") upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folder);
      else upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folder);
      setSelectedTreeID(`workspace-folder-${folder.folder_id}`);
      setSelectedNodeID("");
      setSelectedLogicGateID("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_folder");
    }
  }, [apiBase, companyID, requestJSON]);

  const assignItemToFolder = useCallback(async (targetFolderID: string, itemType: CompanyExplorerFolderKind, itemID: string) => {
    if (!targetFolderID || !itemID) return;
    setError("");
    try {
      const item = await requestJSON<CompanyExplorerFolderItem>("/v1/company-explorer/folder-items", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          folder_id: targetFolderID,
          item_type: itemType,
          item_id: itemID,
        }),
      });
      setFolderItems((previous) => {
        const exists = previous.some((row) => row.item_type === item.item_type && row.item_id === item.item_id);
        return exists
          ? previous.map((row) => (row.item_type === item.item_type && row.item_id === item.item_id ? item : row))
          : [...previous, item];
      });
      if (item.item_type === "logic_gate") upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, item);
      else upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, item);
      setExpanded((previous) => {
        const next = new Set(previous);
        next.add(`workspace-folder-${targetFolderID}`);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_move_item");
    }
  }, [apiBase, companyID, requestJSON]);

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
      if (parentFolderID) await assignItemToFolder(parentFolderID, "node", node.node_id);
      setExpanded((previous) => {
        const next = new Set(previous);
        next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-nodes");
        return next;
      });
      setSelectedTreeID(`node-${node.node_id}`);
      setSelectedNodeID(node.node_id);
      setSelectedLogicGateID("");
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
      if (parentFolderID) await assignItemToFolder(parentFolderID, "logic_gate", logicGate.logic_gate_id);
      setExpanded((previous) => {
        const next = new Set(previous);
        next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-logic");
        return next;
      });
      setSelectedTreeID(`logic-gate-${logicGate.logic_gate_id}`);
      setSelectedLogicGateID(logicGate.logic_gate_id);
      setSelectedNodeID("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_logic_gate");
    }
  }, [apiBase, assignItemToFolder, companyID, requestJSON]);

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
          : target.folderKind === "logic_gate" ? "folder-logic" : "folder-nodes";
        setSelectedTreeID(parentTreeID);
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        return;
      }

      if (target.kind === "node") {
        await requestJSON<{ status: string }>(`/v1/nodes/${target.id}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
        setNodes((previous) => previous.filter((node) => node.node_id !== target.id));
        setFolderItems((previous) => previous.filter((item) => item.item_type !== "node" || item.item_id !== target.id));
        removeNodeRelationshipGraphNode(apiBase, companyID, target.id);
        setSelectedTreeID("folder-nodes");
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        return;
      }

      await requestJSON<{ status: string }>(`/v1/logic-gates/${target.id}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
      setLogicGates((previous) => previous.filter((logicGate) => logicGate.logic_gate_id !== target.id));
      setFolderItems((previous) => previous.filter((item) => item.item_type !== "logic_gate" || item.item_id !== target.id));
      removeLogicGateRelationshipGraphNode(apiBase, companyID, target.id);
      setSelectedTreeID("folder-logic");
      setSelectedNodeID("");
      setSelectedLogicGateID("");
    } catch (err) {
      setError(err instanceof Error ? err.message : `failed_to_delete_${target.kind}`);
    }
  }, [apiBase, companyID, folders, requestJSON]);

  const moveFolder = useCallback(async (folderID: string, parentFolderID: string) => {
    if (!folderID || folderID === parentFolderID) return;
    setError("");
    try {
      const folder = await requestJSON<CompanyExplorerFolder>(`/v1/company-explorer/folders/${folderID}`, {
        method: "PUT",
        body: JSON.stringify({
          company_id: companyID,
          parent_folder_id: parentFolderID,
        }),
      });
      setFolders((previous) => previous.map((item) => (item.folder_id === folder.folder_id ? folder : item)));
      setExpanded((previous) => {
        const next = new Set(previous);
        next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : (folder.folder_kind === "logic_gate" ? "folder-logic" : "folder-nodes"));
        next.add(`workspace-folder-${folder.folder_id}`);
        return next;
      });
      if (folder.folder_kind === "logic_gate") upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folder);
      else upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_move_folder");
    }
  }, [apiBase, companyID, requestJSON]);

  const selectTreeRow = useCallback((row: ExplorerTreeNode) => {
    setSelectedTreeID(row.id);
    if (row.kind === "node") {
      setSelectedNodeID(row.nodeID ?? "");
      setSelectedLogicGateID("");
      return;
    }
    if (row.kind === "logic_gate") {
      setSelectedLogicGateID(row.logicGateID ?? "");
      setSelectedNodeID("");
      return;
    }
    setSelectedNodeID("");
    setSelectedLogicGateID("");
  }, []);

  const canDropOnRow = useCallback((target: ExplorerTreeNode, payload: ExplorerDragPayload | null) => {
    if (!payload || target.kind !== "folder" || !target.folderKind) return false;
    if (payload.kind === "folder") {
      return payload.folderKind === target.folderKind && payload.folderID !== target.folderID;
    }
    return !!target.folderID && payload.itemType === target.folderKind;
  }, []);

  const openExplorerContextMenu = useCallback((event: React.MouseEvent, row?: ExplorerTreeNode | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (row) selectTreeRow(row);
    setExplorerContextMenu({
      x: event.clientX,
      y: event.clientY,
      targets: resolveExplorerCreationTargets(row ?? null),
      deleteTarget: resolveExplorerDeleteTarget(row ?? null),
    });
  }, [selectTreeRow]);

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
    const applyMapSelection = (selectedFromMap: string) => {
      const current = latestSelectionRef.current;
      if (!shouldApplyMapSelection(current, selectedFromMap)) return;
      suppressNextExplorerBroadcastRef.current = true;
      setSelectedNodeID(selectedFromMap);
      setSelectedLogicGateID("");
      setSelectedTreeID(`node-${selectedFromMap}`);
      setExpanded((previous) => {
        if (previous.has("folder-root") && previous.has("folder-nodes")) return previous;
        const next = new Set(previous);
        next.add("folder-root");
        next.add("folder-nodes");
        return next;
      });
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
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; revision?: number; envelope?: ContextMutationEnvelope }>).detail;
      if (!detail || detail.mapWidgetID !== linkedMapFrameID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastMapSelectionRevisionRef.current, revision)) return;
      if (revision > 0 && hasSequenceGap(lastMapSelectionRevisionRef.current, revision)) readFromMapState();
      if (revision > 0) lastMapSelectionRevisionRef.current = revision;
      if (typeof detail.selectedNodeID !== "string") return;
      applyMapSelection(detail.selectedNodeID);
    };
    window.addEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelectionUpdated);
    return () => {
      window.removeEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelectionUpdated);
    };
  }, [companyID, linkedMapFrameID]);

  useEffect(() => {
    const applyLogicGateMapSelection = (selectedFromMap: string) => {
      if (!selectedFromMap) return;
      const nextTreeID = `logic-gate-${selectedFromMap}`;
      const current = latestLogicGateSelectionRef.current;
      if (current.selectedLogicGateID === selectedFromMap && current.selectedTreeID === nextTreeID) return;
      suppressNextExplorerBroadcastRef.current = true;
      setSelectedLogicGateID(selectedFromMap);
      setSelectedNodeID("");
      setSelectedTreeID(nextTreeID);
      setExpanded((previous) => {
        if (previous.has("folder-root") && previous.has("folder-logic")) return previous;
        const next = new Set(previous);
        next.add("folder-root");
        next.add("folder-logic");
        return next;
      });
    };
    const readFromLogicMapState = () => {
      if (!linkedLogicMapFrameID) return;
      const mapStateKey = `logic-gate-map-state-v1:${companyID}:${linkedLogicMapFrameID}`;
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
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; selectedLogicGateID?: string; revision?: number; envelope?: ContextMutationEnvelope }>).detail;
      if (!detail || detail.mapWidgetID !== linkedLogicMapFrameID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastLogicMapSelectionRevisionRef.current, revision)) return;
      if (revision > 0 && hasSequenceGap(lastLogicMapSelectionRevisionRef.current, revision)) readFromLogicMapState();
      if (revision > 0) lastLogicMapSelectionRevisionRef.current = revision;
      const selected = typeof detail.selectedLogicGateID === "string" ? detail.selectedLogicGateID : detail.selectedNodeID;
      if (typeof selected !== "string") return;
      applyLogicGateMapSelection(selected);
    };
    window.addEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapSelectionUpdated);
    return () => {
      window.removeEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapSelectionUpdated);
    };
  }, [companyID, linkedLogicMapFrameID]);

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
      const targetIDs = new Set(resolveDirectLinkedTargets({ sourceFrameID: scope, edges: graph }));
      if (targetIDs.size === 0) return;

      explorerContextSequenceRef.current += 1;
      for (const targetID of targetIDs) {
        if (!targetID) continue;
        const registry = readFrameRegistryFromStorage();
        const targetKind = classifyFrameKind(registry[targetID]?.kind ?? "");
        const isLogicGateContext = selectedLogicGateID.trim().length > 0 || selectedFolderKind === "logic_gate" || (!selectedNodeID && !selectedFolderKind && targetKind === "logic-map");
        const payload = {
          sourceExplorerID: scope,
          selectedNodeID,
          selectedLogicGateID,
          selectedFolderID,
          selectedFolderKind,
          selectedFolderLabel,
          selectedTreeID,
          scopeLevel: selectedTree?.scopeLevel ?? 0,
          selectedLabel: selectedTree?.label ?? "",
          ts: Date.now(),
          envelope: {
            context_id: `explorer_navigation_context:${companyID}:${targetID}`,
            source_module_id: scope,
            sequence: explorerContextSequenceRef.current,
            timestamp: new Date().toISOString(),
            user_action_type: "explorer_selection_changed",
          } satisfies ContextMutationEnvelope,
        };
        const keyPrefix = isLogicGateContext ? LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX : NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX;
        const key = `${keyPrefix}:${companyID}:${targetID}`;
        localStorage.setItem(key, JSON.stringify(payload));
        emitDashboardEvent(EVENT_EXPLORER_CONTEXT_UPDATED, { key, sourceExplorerID: scope, targetID });
      }
    } catch {
      // ignore local storage failures
    }
  }, [companyID, scope, selectedNodeID, selectedLogicGateID, selectedFolderID, selectedFolderKind, selectedFolderLabel, selectedTreeID, selectedTree, linkRevision]);

  const isDarkTheme = theme === "dark";
  const surfaceBackground = isDarkTheme ? "#0f1216" : "#ffffff";
  const surfaceText = isDarkTheme ? "#f4f7fa" : "#0f1f23";
  const ruleColor = isDarkTheme ? "rgba(255,255,255,0.16)" : "rgba(3,25,30,0.14)";
  const rowRuleColor = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(3,25,30,0.06)";
  const selectedRowBackground = isDarkTheme ? "rgba(0,233,255,0.2)" : "rgba(0, 233, 255, 0.28)";
  const dropRowBackground = isDarkTheme ? "rgba(109, 240, 211, 0.18)" : "rgba(30, 160, 120, 0.16)";
  const folderToggleColor = isDarkTheme ? "#95c7d1" : "#326872";
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
        onScroll={(event) => setTreeScrollTop((event.currentTarget as HTMLDivElement).scrollTop)}
        onMouseDownCapture={(event) => {
          if (event.button === 0) setExplorerContextMenu(null);
        }}
        onContextMenu={(event) => openExplorerContextMenu(event)}
        style={{ overflow: "auto", minWidth: 0, ["--company-explorer-scroll-accent" as string]: accent }}
      >
        <div style={{ padding: "9px 10px", borderBottom: `1px solid ${ruleColor}`, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>Company Explorer</div>
        {error && <div style={{ padding: "7px 10px", borderBottom: `1px solid ${ruleColor}`, color: "#b00020", fontSize: 11, fontWeight: 700 }}>Error: {error}</div>}
        <div style={{ height: virtualizedTree.topSpacer }} />
        {virtualizedTree.rows.map((row) => {
          const isFolder = row.kind === "folder";
          const isOpen = expanded.has(row.id);
          const isSelected = selectedTreeID === row.id;
          const rowDragPayload = getExplorerDragPayload(row);
          const isDragging = draggingTreeID === row.id;
          const isDropTarget = dragOverTreeID === row.id;
          return (
            <div
              key={row.id}
              draggable={!!rowDragPayload}
              onClick={() => selectTreeRow(row)}
              onContextMenu={(event) => openExplorerContextMenu(event, row)}
              onDragStart={(event) => {
                if (!rowDragPayload) {
                  event.preventDefault();
                  return;
                }
                selectTreeRow(row);
                setDraggingTreeID(row.id);
                setDragPayload(rowDragPayload);
                event.dataTransfer.effectAllowed = row.kind === "folder" ? "move" : "copyMove";
                const serialized = JSON.stringify(rowDragPayload);
                event.dataTransfer.setData(EXPLORER_DRAG_MIME, serialized);
                if (row.kind === "node" && rowDragPayload.itemID && rowDragPayload.itemType === "node") {
                  const kanbanPayload = serializeExplorerEntityDragPayload({
                    itemType: rowDragPayload.itemType,
                    itemID: rowDragPayload.itemID,
                    label: row.label,
                  });
                  event.dataTransfer.setData(EXPLORER_ENTITY_DRAG_MIME, kanbanPayload);
                }
                event.dataTransfer.setData("text/plain", row.label);
              }}
              onDragEnd={() => {
                setDraggingTreeID("");
                setDragOverTreeID("");
                setDragPayload(null);
              }}
              onDragOver={(event) => {
                const payload = dragPayload ?? readExplorerDragPayload(event.dataTransfer);
                if (!canDropOnRow(row, payload)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverTreeID(row.id);
              }}
              onDragLeave={() => {
                setDragOverTreeID((current) => (current === row.id ? "" : current));
              }}
              onDrop={(event) => {
                const payload = dragPayload ?? readExplorerDragPayload(event.dataTransfer);
                setDragOverTreeID("");
                if (!canDropOnRow(row, payload) || !payload) return;
                event.preventDefault();
                setExpanded((previous) => {
                  const next = new Set(previous);
                  next.add(row.id);
                  return next;
                });
                if (payload.kind === "folder" && payload.folderID) {
                  void moveFolder(payload.folderID, row.folderID ?? "");
                  return;
                }
                if (payload.itemID && payload.itemType && row.folderID) {
                  void assignItemToFolder(row.folderID, payload.itemType, payload.itemID);
                }
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
                cursor: rowDragPayload ? "grab" : "pointer",
                opacity: isDragging ? 0.55 : 1,
                background: isDropTarget ? dropRowBackground : (isSelected ? selectedRowBackground : "transparent"),
                borderBottom: `1px solid ${rowRuleColor}`,
              }}
            >
              {isFolder ? (
                <button
                  draggable={false}
                  onMouseDown={(event) => event.stopPropagation()}
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
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
            </div>
          );
        })}
        <div style={{ height: virtualizedTree.bottomSpacer }} />
      </div>

      {explorerContextMenu && (
        <FrameRightClickMenu x={explorerContextMenu.x} y={explorerContextMenu.y} onClose={() => setExplorerContextMenu(null)}>
          <button
            style={{ ...explorerMenuButtonStyle, color: "#111111" }}
            onClick={() => {
              void createFolder(explorerContextMenu.targets.folderKind, explorerContextMenu.targets.folderParentID);
              setExplorerContextMenu(null);
            }}
          >
            Create folder
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
              void createLogicGateAtFolder(explorerContextMenu.targets.logicGateParentFolderID);
              setExplorerContextMenu(null);
            }}
          >
            Create logic gate
          </button>
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
