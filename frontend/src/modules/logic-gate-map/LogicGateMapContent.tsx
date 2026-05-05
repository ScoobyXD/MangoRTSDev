import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INFO_TYPES, LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, LOGIC_GATE_MAP_STATE_KEY_PREFIX, LogicGateRecord, LogicGateRelationship, MINI_GRID, NODE_H, NODE_W, PANEL_MIN_HEIGHT, PANEL_MIN_WIDTH, panelResizeHandles, NodeMapState, NodeDetails, NodeDirection, NodeInformation, NodePosition, NodeRecord, NodeRelationship, RelationshipAnchor, SESSION_NODE_MAP_STATE, buildPlusGridBackgroundStyle, changedPersistedMapPositions, clamp, divider, getNodeTitle, persistedMapPositionsToNodePositions, reconcileNodeMapPositions, resolveOpenNodeMapPosition, snapToGrid, toLogicGateCanvasRecord, toLogicGateCanvasRelationship, trimOrEmpty } from "./shared";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_FIND_REQUESTED, EVENT_LOGIC_GATE_MAP_FOCUS_REQUESTED, EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { hasExplicitExplorerSelectionContext, hasPendingContextStorageUpdate, nextLocalContextSequence, type ContextMutationEnvelope } from "../contextSyncContract";
import { getLogicGateRelationshipGraphSnapshot, refreshLogicGateRelationshipGraphSnapshot, removeLogicGateRelationshipGraphNode, subscribeLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode, upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph } from "./LogicGateRelationshipGraph";
import { buildExistingNodeRelationshipPayload, buildLinkedNodePayloadFromSourceSide, canStartRelationshipFromSide, isLegalRelationshipSidePair, projectRelationshipVisual } from "./relationshipProjection";
import { summarizeRelationshipDeleteResults } from "../node-map/relationshipDeleteSummary";
import { invalidateLogicGateRecordStoreCaches } from "./LogicGateRecordStore";
import { NODE_MAP_CLIPBOARD_STORAGE_KEY, beginNodeMapMultiSelectSession, buildNodeMapClipboardPayload, parseNodeMapClipboardPayload, shouldIgnoreMapDeleteKeyTarget, NodeMapDragState, NodeMapMultiSelectBox, NodeMapPanState, NodeMapPanelDragState, NodeMapPanelResizeState, resolveNodeMapDragStartSelection, resolveNodeMapPointerSelection, useNodeMapDeleteKeyboardControl, useNodeMapDragControls, useNodeMapMultiSelectControls, useNodeMapPanelControls, useNodeMapPanControls, useNodeMapRelationshipDraftControls } from "../node-map/NodeMapControls";
import { filterLogicGateGraphToFolderScope, resolveMapSelectionAfterGraphLoad, resolveScopedMapSelectionFallback, type CompanyExplorerFolder, type CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import { classifyFrameKind, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveConnectedFrameTargets } from "../linkingGraph";
import { publishLiveSelection, readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../selectionCoordinator";
import { LogicGateMapContextMenus } from "./LogicGateMapContextMenus";
import { LogicGateMapNodeCard } from "./LogicGateMapNodeCard";
import { LogicGateMapRelationshipHitLines } from "./LogicGateMapRelationshipHitLines";
import { buildLogicGateMapRelationshipRoutingGrid, getLogicGateMapAnchorPoint, routeLogicGateMapDraftPath, routeLogicGateMapOrthogonalPath } from "./logicGateMapRouting";
import { useLogicGateMapGraphPersistence } from "./useLogicGateMapGraphPersistence";
import { useLogicGateMapViewportHandlers } from "./useLogicGateMapViewportHandlers";

type ExplorerSelectionOrigin = {
  sourceExplorerID: string;
  sourceExplorerContextSequence: number;
  sourceExplorerSelectedTreeID: string;
  selectedEntityID: string;
};

// Logic Gate Map module: node-map canvas behavior with logic-gate persistence and Input/Output edges.

export const LogicGateMapContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }> = ({ accent, widgetId, hideTopControls: _hideTopControls, theme = "teal" }) => {
  const SELECTION_CYAN = "rgb(0, 233, 255)";
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const mapScope = widgetId?.trim() ? widgetId : "global";
  const mapStateKey = `${LOGIC_GATE_MAP_STATE_KEY_PREFIX}:${companyID}:${mapScope}`;
  const fallbackMapStateKey = `${LOGIC_GATE_MAP_STATE_KEY_PREFIX}:${companyID}:last-opened-map`;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const relationshipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 560 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panInitialized, setPanInitialized] = useState(false);
  const [restoredViewport, setRestoredViewport] = useState(false);

  const WORLD_W = 12800;
  const WORLD_H = 8800;

  const [nodePositions, setNodePositions] = useState<Record<string, NodePosition>>({});
  const [nodeSizes, setNodeSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [allNodes, setAllNodes] = useState<NodeRecord[]>([]);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [relationships, setRelationships] = useState<NodeRelationship[]>([]);
  const [folders, setFolders] = useState<CompanyExplorerFolder[]>([]);
  const [folderItems, setFolderItems] = useState<CompanyExplorerFolderItem[]>([]);
  const [activeFolderID, setActiveFolderID] = useState("");
  const [activeFolderLabel, setActiveFolderLabel] = useState("");
  const [relationshipAnchors, setRelationshipAnchors] = useState<Record<string, RelationshipAnchor>>({});
  const [selectedNodeID, setSelectedNodeID] = useState<string>("");
  const [selectedNodeIDs, setSelectedNodeIDs] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<NodeDetails | null>(null);
  const [newNodeTitle, setNewNodeTitle] = useState("");
  const [infoType, setInfoType] = useState<(typeof INFO_TYPES)[number]>("Text box");
  const [infoDraft, setInfoDraft] = useState("");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailsPanelNodeID, setDetailsPanelNodeID] = useState<string>("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<{ x: number; y: number; nodeID: string } | null>(null);
  const [relationshipContextMenu, setRelationshipContextMenu] = useState<{ x: number; y: number; relationshipID: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ nodeIDs: string[]; relationshipIDs: string[] } | null>(null);
  const [canvasActive, setCanvasActive] = useState(false);
  const [panelRect, setPanelRect] = useState({ x: 0, y: 10, width: 340, height: 360 });
  const [panelDrag, setPanelDrag] = useState<NodeMapPanelDragState | null>(null);
  const [panelResize, setPanelResize] = useState<NodeMapPanelResizeState | null>(null);

  const [dragState, setDragState] = useState<NodeMapDragState | null>(null);
  const [nodeResizeState, setNodeResizeState] = useState<{
    nodeID: string;
    pointerID: number;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
  } | null>(null);
  const [panState, setPanState] = useState<NodeMapPanState | null>(null);
  const [selectionBox, setSelectionBox] = useState<NodeMapMultiSelectBox>({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    active: false,
    additive: false,
  });
  const [selectionPointerID, setSelectionPointerID] = useState<number | null>(null);
  const selectionBoxRef = useRef(selectionBox);
  const restoredSelectionRef = useRef<string>("");
  const selectedNodeIDRef = useRef("");
  const activeFolderIDRef = useRef("");
  const explorerContextRef = useRef<number>(0);
  const explorerSelectionOriginRef = useRef<ExplorerSelectionOrigin | null>(null);
  const suppressNextSelectionBroadcastRef = useRef(false);
  const pendingFocusNodeIDRef = useRef("");
  const layoutPersistenceReadyRef = useRef(false);
  const lastPersistedNodePositionsRef = useRef<Record<string, NodePosition>>({});
  const [relationshipColorsEnabled, setRelationshipColorsEnabled] = useState(true);
  const [relationshipRoleColors, setRelationshipRoleColors] = useState({ input: "#0095ff", output: "#ff8a00" });
  const [relationshipDraft, setRelationshipDraft] = useState<{ sourceNodeID: string; sourceSide: NodeDirection; cursor: { x: number; y: number } } | null>(null);
  const [selectedRelationshipIDs, setSelectedRelationshipIDs] = useState<Set<string>>(new Set());
  const [editingNodeTitleNodeID, setEditingNodeTitleNodeID] = useState<string | null>(null);
  const editingNodeTitleDraftRef = useRef("");
  const editingNodeTitleElementRef = useRef<HTMLDivElement | null>(null);
  const connectionPathsRef = useRef<Array<{ id: string; points: { x: number; y: number }[] }>>([]);
  const suppressNextRelationshipLineClickRef = useRef(false);
  const isDarkTheme = theme === "dark";
  const nodeCardBackground = isDarkTheme ? "rgba(20,26,32,0.95)" : "rgba(252,252,252,0.93)";
  const nodeCardSelectedBackground = isDarkTheme ? "rgba(32,40,49,0.98)" : "#ffffff";
  const nodeCardBorder = isDarkTheme ? "rgba(201,220,233,0.42)" : "#505050";
  const nodeCardText = isDarkTheme ? "#f3f7fb" : "#101010";
  const panelSurface = isDarkTheme ? "rgba(19,24,31,0.96)" : "rgba(255,255,255,0.95)";
  const panelSubtleSurface = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.8)";
  const panelText = isDarkTheme ? "#f3f7fb" : "#111111";
  const panelMutedText = isDarkTheme ? "rgba(243,247,251,0.72)" : "#2e2e2e";
  const panelDangerText = isDarkTheme ? "#ff6f98" : "#a20026";
  const dialogButtonBackground = isDarkTheme ? "rgba(255,255,255,0.08)" : "#ffffff";
  const dialogPrimaryButtonText = isDarkTheme ? panelText : "#111111";
  const dialogCancelButtonText = isDarkTheme ? "#ff8aab" : "#8b123f";
  const contextMenuButtonStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    color: panelText,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 700,
    padding: "6px 8px",
    textAlign: "left",
  };
  const contextMenuDangerButtonStyle: React.CSSProperties = {
    ...contextMenuButtonStyle,
    color: panelDangerText,
  };
  const gridBackgroundStyle = useMemo(
    () => buildPlusGridBackgroundStyle({ zoom, accent, theme: isDarkTheme ? "dark" : "light" }),
    [accent, isDarkTheme, zoom],
  );
  const visibleInsertionPosition = useMemo(() => ({
    x: clamp(snapToGrid((canvasSize.width / 2 - pan.x) / zoom - NODE_W / 2), 0, WORLD_W - NODE_W),
    y: clamp(snapToGrid((canvasSize.height / 2 - pan.y) / zoom - NODE_H / 2), 0, WORLD_H - NODE_H),
  }), [WORLD_H, WORLD_W, canvasSize.height, canvasSize.width, pan.x, pan.y, zoom]);

  const centerNodeInViewport = (nodeID: string): boolean => {
    const position = nodePositions[nodeID];
    const isVisible = nodes.some((node) => node.node_id === nodeID);
    const isKnown = isVisible || allNodes.some((node) => node.node_id === nodeID);
    if (!nodeID || !isKnown || !isVisible || !position) return false;
    const size = nodeSizes[nodeID] ?? { w: NODE_W, h: NODE_H };
    pendingFocusNodeIDRef.current = "";
    setSelectedRelationshipIDs(new Set());
    setSelectedNodeID(nodeID);
    setSelectedNodeIDs(new Set([nodeID]));
    setPan({
      x: canvasSize.width / 2 - (position.x + size.w / 2) * zoom,
      y: canvasSize.height / 2 - (position.y + size.h / 2) * zoom,
    });
    setCanvasActive(true);
    return true;
  };

  const selectedNodeLabel = useMemo(() => {
    if (!selectedNodeID) return "";
    const selected = allNodes.find((node) => node.node_id === selectedNodeID) ?? nodes.find((node) => node.node_id === selectedNodeID);
    return selected ? getNodeTitle(selected) : "";
  }, [allNodes, nodes, selectedNodeID]);

  const readLiveSelectionTargets = () => {
    const edges = readFrameLinksFromStorage();
    const registry = readFrameRegistryFromStorage();
    return resolveConnectedFrameTargets({ sourceFrameID: mapScope, edges, registry });
  };

  const rememberLiveExplorerSelectionOrigin = (selection: LiveSelectionChange, selectedEntityID: string) => {
    if (selection.sourceModule !== "company-explorer") {
      explorerSelectionOriginRef.current = null;
      return;
    }
    explorerSelectionOriginRef.current = {
      sourceExplorerID: selection.sourceFrameID,
      sourceExplorerContextSequence: selection.sequence,
      sourceExplorerSelectedTreeID: selection.selectedTreeID ?? "",
      selectedEntityID,
    };
  };

  const readCompanyExplorerFrameTargets = () => {
    const registry = readFrameRegistryFromStorage();
    return Object.entries(registry)
      .filter(([, item]) => classifyFrameKind(item.kind) === "explorer")
      .map(([frameID]) => frameID);
  };

  const requestFindLogicGatesOnCompanyExplorer = (logicGateIDs: string[]) => {
    const uniqueLogicGateIDs = Array.from(new Set(logicGateIDs.map((id) => id.trim()).filter(Boolean)));
    if (uniqueLogicGateIDs.length === 0) return;
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, {
      companyID,
      sourceFrameID: mapScope,
      sourceModule: "logic-gate-map",
      targetFrameIDs: readCompanyExplorerFrameTargets(),
      entities: uniqueLogicGateIDs.map((id) => ({ kind: "logic_gate", id })),
      changedAt: Date.now(),
    });
  };

  useEffect(() => {
    selectedNodeIDRef.current = selectedNodeID;
  }, [selectedNodeID]);

  useEffect(() => {
    activeFolderIDRef.current = activeFolderID;
  }, [activeFolderID]);

  // Keep relationship projection derivation centralized so callers can reuse the exact same
  // filtering logic without triggering additional network calls.
  const projectVisibleRelationships = (snapshotNodes: NodeRecord[], snapshotRelationships: NodeRelationship[]) => {
    const allowed = new Set(snapshotNodes.map((node) => node.node_id));
    return snapshotRelationships.filter((relationship) => allowed.has(relationship.node_id_a) && allowed.has(relationship.node_id_b));
  };

  const applyFolderScope = (
    snapshotNodes: NodeRecord[],
    snapshotRelationships: NodeRelationship[],
    snapshotFolders: CompanyExplorerFolder[],
    snapshotFolderItems: CompanyExplorerFolderItem[],
    folderID = activeFolderIDRef.current,
  ) => {
    const scoped = filterLogicGateGraphToFolderScope({
      nodes: snapshotNodes,
      relationships: snapshotRelationships,
      folders: snapshotFolders,
      folderItems: snapshotFolderItems,
      folderID,
    });
    setAllNodes(snapshotNodes);
    setFolders(snapshotFolders);
    setFolderItems(snapshotFolderItems);
    setNodes(scoped.nodes);
    setRelationships(scoped.relationships);
    return scoped.nodes;
  };

  const startNodeMapMultiSelect = (pointerID: number, clientX: number, clientY: number, additive: boolean) => {
    const started = beginNodeMapMultiSelectSession(viewportRef.current, pointerID, clientX, clientY, additive);
    if (!started) return;
    const nextSelectionBox = started.multiSelectBox;
    selectionBoxRef.current = nextSelectionBox;
    setSelectionPointerID(started.pointerID);
    setSelectionBox(nextSelectionBox);
  };

  useEffect(() => {
    const pendingNodeID = pendingFocusNodeIDRef.current;
    if (pendingNodeID) centerNodeInViewport(pendingNodeID);
  }, [canvasSize.height, canvasSize.width, nodePositions, nodeSizes, nodes, allNodes, zoom]);

  useEffect(() => {
    const onFocusRequested = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; logicGateID?: string; nodeID?: string }>).detail;
      const logicGateID = detail?.logicGateID || detail?.nodeID || "";
      if (!detail || detail.mapWidgetID !== mapScope || !logicGateID) return;
      pendingFocusNodeIDRef.current = logicGateID;
      centerNodeInViewport(logicGateID);
    };
    window.addEventListener(EVENT_LOGIC_GATE_MAP_FOCUS_REQUESTED, onFocusRequested);
    return () => window.removeEventListener(EVENT_LOGIC_GATE_MAP_FOCUS_REQUESTED, onFocusRequested);
  }, [canvasSize.height, canvasSize.width, mapScope, nodePositions, nodeSizes, nodes, allNodes, zoom]);

  // Shared API request helper for logic-gate CRUD, details, and relationship operations.
  const requestJSON = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    // Avoid setting Content-Type on GET/HEAD requests; this reduces cross-origin preflights.
    if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      let reason = `request_failed_${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.error) reason = payload.error;
      } catch {
        try {
          const fallbackText = (await response.text()).trim();
          if (fallbackText) reason = `${reason}:${fallbackText.slice(0, 120)}`;
        } catch {
          // no-op
        }
      }
      throw new Error(reason);
    }

    if (response.status === 204) {
      return {} as T;
    }
    return response.json() as Promise<T>;
  }, [apiBase]);

  const applyServerMapPositions = useLogicGateMapGraphPersistence({
    companyID,
    mapStateKey,
    fallbackMapStateKey,
    restoredViewport,
    zoom,
    pan,
    selectedNodeID,
    nodePositions,
    nodes,
    relationshipColorsEnabled,
    relationshipRoleColors,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    setZoom,
    setPan,
    setPanInitialized,
    setRestoredViewport,
    restoredSelectionRef,
    selectedNodeIDRef,
    suppressNextSelectionBroadcastRef,
    setSelectedNodeID,
    setSelectedNodeIDs,
    setNodePositions,
    setRelationshipColorsEnabled,
    setRelationshipRoleColors,
    layoutPersistenceReadyRef,
    lastPersistedNodePositionsRef,
    requestJSON,
  });

  // Snapshot-driven logic-gate loader that also restores/maintains active selection.
  const loadNodes = async () => {
    setLoading(true);
    setError("");
    try {
      await refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID);
      const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
      const snapshotNodes = snapshot.nodes ?? [];
      const nextNodes = applyFolderScope(snapshotNodes, snapshot.relationships ?? [], snapshot.folders ?? [], snapshot.folder_items ?? [], activeFolderIDRef.current);
      applyServerMapPositions(snapshot.logic_gate_map_positions ?? []);

      const nextSelection = resolveMapSelectionAfterGraphLoad({
        currentSelectedID: selectedNodeIDRef.current,
        restoredSelectedID: restoredSelectionRef.current,
        visibleItemIDs: nextNodes.map((item) => item.node_id),
        knownItemIDs: snapshotNodes.map((item) => item.node_id),
        explorerRequestedID: explorerSelectionOriginRef.current?.selectedEntityID,
        hasExplorerNavigationIntent: !!explorerSelectionOriginRef.current,
      });
      if (nextSelection === null) return;
      suppressNextSelectionBroadcastRef.current = true;
      selectedNodeIDRef.current = nextSelection;
      setSelectedNodeID(nextSelection);
      setSelectedNodeIDs(nextSelection ? new Set([nextSelection]) : new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_load_logic_gates");
    } finally {
      setLoading(false);
    }
  };

  // Load relationship set scoped to logic gates currently available in the local workspace snapshot cache.
  // IMPORTANT: this intentionally does not fetch. Fetching here created a hot-path feedback loop:
  // gates changed -> refresh snapshot -> subscription setNodes -> gates changed again.
  const loadGraphRelationshipsFromSnapshot = (graphNodes: NodeRecord[]) => {
    if (graphNodes.length === 0) {
      setRelationships([]);
      return;
    }
    const payload = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
    setRelationships(projectVisibleRelationships(graphNodes, payload.relationships ?? []));
  };


  useEffect(() => {
    void loadNodes();
  }, []);

  useEffect(() => {
    return subscribeLogicGateRelationshipGraph(apiBase, companyID, () => {
      const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
      applyFolderScope(snapshot.nodes ?? [], snapshot.relationships ?? [], snapshot.folders ?? [], snapshot.folder_items ?? []);
      applyServerMapPositions(snapshot.logic_gate_map_positions ?? []);
    });
  }, [apiBase, companyID, activeFolderID]);

  useEffect(() => {
    const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
    applyFolderScope(snapshot.nodes ?? allNodes, snapshot.relationships ?? [], snapshot.folders ?? folders, snapshot.folder_items ?? folderItems);
  }, [activeFolderID]);

  useEffect(() => {
    setSelectedRelationshipIDs((previous) => {
      if (previous.size === 0) return previous;
      const available = new Set(relationships.map((relationship) => relationship.node_relationship_id));
      const next = new Set(Array.from(previous).filter((id) => available.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [relationships]);

  const scopedNodeIDSet = useMemo(() => new Set(nodes.map((node) => node.node_id)), [nodes]);
  const knownGraphNodeIDSet = useMemo(() => new Set(allNodes.map((node) => node.node_id)), [allNodes]);

  useEffect(() => {
    const fallback = resolveScopedMapSelectionFallback({
      selectedID: selectedNodeID,
      visibleItemIDs: scopedNodeIDSet,
      knownItemIDs: knownGraphNodeIDSet,
      explorerRequestedID: explorerSelectionOriginRef.current?.selectedEntityID,
    });
    if (fallback === null) return;
    suppressNextSelectionBroadcastRef.current = true;
    selectedNodeIDRef.current = fallback;
    setSelectedNodeID(fallback);
    setSelectedNodeIDs(fallback ? new Set([fallback]) : new Set());
  }, [knownGraphNodeIDSet, scopedNodeIDSet, selectedNodeID]);

  useEffect(() => {
    if (!relationshipDraft) return;
    if (nodes.some((node) => node.node_id === relationshipDraft.sourceNodeID)) return;
    setRelationshipDraft(null);
  }, [nodes, relationshipDraft]);


  useEffect(() => {
    if (!nodeResizeState) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== nodeResizeState.pointerID) return;
      event.preventDefault();
      const dx = (event.clientX - nodeResizeState.startMouseX) / zoom;
      const dy = (event.clientY - nodeResizeState.startMouseY) / zoom;
      const minW = 112;
      const minH = 74;
      let nextW = nodeResizeState.startW;
      let nextH = nodeResizeState.startH;
      let nextX = nodeResizeState.startX;
      let nextY = nodeResizeState.startY;
      if (nodeResizeState.edges.right) nextW = Math.max(minW, nodeResizeState.startW + dx);
      if (nodeResizeState.edges.bottom) nextH = Math.max(minH, nodeResizeState.startH + dy);
      if (nodeResizeState.edges.left) {
        nextW = Math.max(minW, nodeResizeState.startW - dx);
        nextX = nodeResizeState.startX + (nodeResizeState.startW - nextW);
      }
      if (nodeResizeState.edges.top) {
        nextH = Math.max(minH, nodeResizeState.startH - dy);
        nextY = nodeResizeState.startY + (nodeResizeState.startH - nextH);
      }
      setNodeSizes((previous) => ({ ...previous, [nodeResizeState.nodeID]: { w: snapToGrid(nextW), h: snapToGrid(nextH) } }));
      setNodePositions((previous) => ({ ...previous, [nodeResizeState.nodeID]: { x: clamp(snapToGrid(nextX), 0, WORLD_W - NODE_W), y: clamp(snapToGrid(nextY), 0, WORLD_H - NODE_H) } }));
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== nodeResizeState.pointerID) return;
      setNodeResizeState(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [nodeResizeState, zoom]);

  useEffect(() => {
    const resize = () => {
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setCanvasSize({ width: Math.max(420, Math.floor(bounds.width)), height: Math.max(360, Math.floor(bounds.height)) });
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (panInitialized || !restoredViewport) return;
    const centeredX = canvasSize.width / 2 - (WORLD_W * zoom) / 2;
    const centeredY = canvasSize.height / 2 - (WORLD_H * zoom) / 2;
    setPan({ x: centeredX, y: centeredY });
    setPanInitialized(true);
  }, [panInitialized, restoredViewport, canvasSize.width, canvasSize.height, zoom]);

  useEffect(() => {
    if (!restoredViewport) return;
    if (suppressNextSelectionBroadcastRef.current) {
      suppressNextSelectionBroadcastRef.current = false;
      return;
    }
    if (!selectedNodeID) return;
    const explorerKey = `${LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${mapScope}`;
    if (hasPendingContextStorageUpdate(localStorage.getItem(explorerKey), explorerContextRef.current)) return;
    const contextID = `active_logic_gate_selection:${companyID}:${mapScope}`;
    const sequence = nextLocalContextSequence(contextID);
    const explorerOrigin = explorerSelectionOriginRef.current;
    const echoedExplorerSelection = explorerOrigin?.selectedEntityID === selectedNodeID ? explorerOrigin : null;
    const envelope: ContextMutationEnvelope = {
      context_id: contextID,
      source_module_id: mapScope,
      sequence,
      timestamp: new Date().toISOString(),
      user_action_type: "logic_gate_selection_changed",
    };
    if (!echoedExplorerSelection) {
      publishLiveSelection({
        companyID,
        entityKind: "logic_gate",
        entityID: selectedNodeID,
        label: selectedNodeLabel,
        sourceFrameID: mapScope,
        sourceModule: "logic-gate-map",
        targetFrameIDs: readLiveSelectionTargets(),
        changedAt: Date.now(),
        sequence,
      });
    }
    emitDashboardEvent(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, {
      mapWidgetID: mapScope,
      selectedNodeID,
      selectedLogicGateID: selectedNodeID,
      revision: sequence,
      changedAt: Date.now(),
      sourceExplorerID: echoedExplorerSelection?.sourceExplorerID,
      sourceExplorerContextSequence: echoedExplorerSelection?.sourceExplorerContextSequence,
      sourceExplorerSelectedTreeID: echoedExplorerSelection?.sourceExplorerSelectedTreeID,
      envelope,
    });
    if (explorerOrigin && explorerOrigin.selectedEntityID !== selectedNodeID) {
      explorerSelectionOriginRef.current = null;
    }
  }, [companyID, mapScope, restoredViewport, selectedNodeID, selectedNodeLabel]);

  useEffect(() => {
    setNodePositions((previous) => {
      return reconcileNodeMapPositions({
        previous,
        nodes,
        canvasWidth: canvasSize.width,
        worldWidth: WORLD_W,
        worldHeight: WORLD_H,
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
        defaultPosition: visibleInsertionPosition,
      });
    });
  }, [nodes, canvasSize.width, visibleInsertionPosition]);

  useNodeMapDragControls({
    dragState,
    viewportRef,
    pan,
    zoom,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    setNodePositions,
    setDragState,
    setSelectedNodeID,
    setSelectedNodeIDs,
    setSelectedRelationshipIDs,
  });

  useEffect(() => {
    const explorerKey = `${LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${mapScope}`;
    const rememberExplorerSelectionOrigin = (parsed: { sourceExplorerID?: string; selectedTreeID?: string; envelope?: ContextMutationEnvelope }, selectedEntityID: string) => {
      if (!parsed.sourceExplorerID) {
        explorerSelectionOriginRef.current = null;
        return;
      }
      // This marks the next map selection event as an Explorer-caused echo.
      // Explorer can then ignore its own echo while still accepting real map clicks.
      explorerSelectionOriginRef.current = {
        sourceExplorerID: parsed.sourceExplorerID,
        sourceExplorerContextSequence: parsed.envelope?.sequence ?? 0,
        sourceExplorerSelectedTreeID: parsed.selectedTreeID ?? "",
        selectedEntityID,
      };
    };
    const applyExplorerContext = () => {
      try {
        const raw = localStorage.getItem(explorerKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { sourceExplorerID?: string; selectedNodeID?: string; selectedLogicGateID?: string; selectedFolderID?: string; selectedFolderKind?: string; selectedFolderLabel?: string; selectedLabel?: string; selectedTreeID?: string; ts?: number; envelope?: ContextMutationEnvelope };
        if (typeof parsed.ts !== "number" || parsed.ts <= explorerContextRef.current) return;
        explorerContextRef.current = parsed.ts;
        if (parsed.selectedFolderKind === "logic_gate") {
          const nextFolderID = typeof parsed.selectedFolderID === "string" ? parsed.selectedFolderID : "";
          activeFolderIDRef.current = nextFolderID;
          setActiveFolderID(nextFolderID);
          setActiveFolderLabel(typeof parsed.selectedFolderLabel === "string" ? parsed.selectedFolderLabel : (typeof parsed.selectedLabel === "string" ? parsed.selectedLabel : ""));
          const selected = parsed.selectedLogicGateID || parsed.selectedNodeID || "";
          rememberExplorerSelectionOrigin(parsed, selected);
          suppressNextSelectionBroadcastRef.current = true;
          selectedNodeIDRef.current = selected;
          if (selected) {
            // Explorer owns navigation intent. A map can momentarily have stale
            // all-node data during mode/scope switches, so accept the Explorer
            // selected gate and let the filtered projection catch up.
            setSelectedNodeID(selected);
            setSelectedNodeIDs(new Set([selected]));
          } else {
            setSelectedNodeID("");
            setSelectedNodeIDs(new Set());
          }
          return;
        }
        const selectedLogicGateID = parsed.selectedLogicGateID || parsed.selectedNodeID || "";
        if (!selectedLogicGateID) {
          if (!hasExplicitExplorerSelectionContext(parsed)) return;
          rememberExplorerSelectionOrigin(parsed, "");
          suppressNextSelectionBroadcastRef.current = true;
          activeFolderIDRef.current = "";
          setActiveFolderID("");
          setActiveFolderLabel("");
          selectedNodeIDRef.current = "";
          setSelectedNodeID("");
          setSelectedNodeIDs(new Set());
          return;
        }
        rememberExplorerSelectionOrigin(parsed, selectedLogicGateID);
        suppressNextSelectionBroadcastRef.current = true;
        activeFolderIDRef.current = "";
        setActiveFolderID("");
        setActiveFolderLabel("");
        selectedNodeIDRef.current = selectedLogicGateID;
        setSelectedNodeID(selectedLogicGateID);
        setSelectedNodeIDs(new Set([selectedLogicGateID]));
      } catch {
        // ignore malformed explorer context payload
      }
    };
    // Startup/remount restore only. Live Explorer clicks arrive through
    // SelectionCoordinator below so we never infer a live selection from storage.
    applyExplorerContext();
  }, [companyID, mapScope, allNodes]);

  useEffect(() => {
    const applyLiveSelection = (selection: LiveSelectionChange) => {
      if (selection.companyID !== companyID || selection.sourceFrameID === mapScope) return;
      if (selection.entityKind === "kanban") return;
      if (selection.entityKind === "node" || selection.folderKind === "node") return;

      explorerContextRef.current = Math.max(explorerContextRef.current, selection.changedAt);
      suppressNextSelectionBroadcastRef.current = true;
      const nextFolderID = selection.folderKind === "logic_gate" || selection.entityKind === "folder" ? (selection.folderID ?? selection.entityID) : "";
      activeFolderIDRef.current = nextFolderID;
      setActiveFolderID(nextFolderID);
      setActiveFolderLabel(nextFolderID ? (selection.folderLabel ?? selection.label) : "");

      const nextLogicGateID = selection.entityKind === "logic_gate" ? selection.entityID : "";
      rememberLiveExplorerSelectionOrigin(selection, nextLogicGateID);
      selectedNodeIDRef.current = nextLogicGateID;
      setSelectedNodeID(nextLogicGateID);
      setSelectedNodeIDs(nextLogicGateID ? new Set([nextLogicGateID]) : new Set());
    };

    const liveSelection = readLiveSelectionForFrame(companyID, mapScope);
    if (liveSelection) applyLiveSelection(liveSelection);
    return subscribeLiveSelection(mapScope, applyLiveSelection);
  }, [companyID, mapScope]);

  useNodeMapPanControls({ panState, setPan, setPanState, setSelectedNodeID, setSelectedNodeIDs, setSelectedRelationshipIDs });

  useNodeMapMultiSelectControls({
    selectionPointerID,
    multiSelectBox: selectionBox,
    multiSelectBoxRef: selectionBoxRef,
    viewportRef,
    nodes,
    nodePositions,
    relationshipPathsRef: connectionPathsRef,
    zoom,
    pan,
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    selectedNodeIDs,
    selectedRelationshipIDs,
    selectedNodeID,
    setSelectedNodeIDs,
    setSelectedRelationshipIDs,
    setSelectedNodeID,
    setSelectionPointerID,
    setMultiSelectBox: setSelectionBox,
  });

  useEffect(() => {
    const onWindowPointerDown = () => {
      setContextMenu(null);
      setNodeContextMenu(null);
      setRelationshipContextMenu(null);
    };
    window.addEventListener("pointerdown", onWindowPointerDown);
    return () => window.removeEventListener("pointerdown", onWindowPointerDown);
  }, []);

  useEffect(() => {
    const onWindowPointerDown = (event: PointerEvent) => {
      if (viewportRef.current?.contains(event.target as Node)) return;
      setCanvasActive(false);
    };
    window.addEventListener("pointerdown", onWindowPointerDown, true);
    return () => window.removeEventListener("pointerdown", onWindowPointerDown, true);
  }, []);

  useNodeMapRelationshipDraftControls({
    relationshipDraft,
    viewportRef,
    pan,
    zoom,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    setRelationshipDraft,
    setSelectedRelationshipIDs,
  });

  useEffect(() => {
    if (!widgetId) return;
    const eventName = `logic-gates:create:${widgetId}`;
    const onCreate = (event: Event) => {
      const custom = event as CustomEvent<{ title?: string }>;
      const title = trimOrEmpty(custom.detail?.title ?? "");
      if (!title) return;
      void createNode(title);
    };
    window.addEventListener(eventName, onCreate as EventListener);
    return () => window.removeEventListener(eventName, onCreate as EventListener);
  }, [widgetId]);

  const createNode = async (title: string, worldPos?: { x: number; y: number }): Promise<NodeRecord | null> => {
    const value = trimOrEmpty(title);
    if (!value) return null;
    setError("");
    const desiredPosition = worldPos
      ? { x: worldPos.x - NODE_W / 2, y: worldPos.y - NODE_H / 2 }
      : visibleInsertionPosition;
    try {
      const created = await requestJSON<LogicGateRecord>("/v1/logic-gates", {
        method: "POST",
        body: JSON.stringify({ company_id: companyID, header: value }),
      });
      const node = toLogicGateCanvasRecord(created);
      setNodePositions((previous) => ({
        ...previous,
        [node.node_id]: resolveOpenNodeMapPosition({
          desired: desiredPosition,
          occupied: previous,
          worldWidth: WORLD_W,
          worldHeight: WORLD_H,
          nodeWidth: NODE_W,
          nodeHeight: NODE_H,
        }),
      }));
      // Hot-path rule: avoid full snapshot refetch on create.
      // Apply optimistic logic-gate insertion through the shared graph cache so subscribers
      // get immediate convergence without issuing a snapshot GET.
      upsertLogicGateRelationshipGraphNode(apiBase, companyID, node);
      if (activeFolderID) {
        const folderItem = await requestJSON<CompanyExplorerFolderItem>("/v1/company-explorer/folder-items", {
          method: "POST",
          body: JSON.stringify({ company_id: companyID, folder_id: activeFolderID, item_type: "logic_gate", item_id: node.node_id }),
        });
        // Folder placement is durable API state, not local UI state. Updating the
        // cache here keeps folder-filtered maps responsive after creation.
        upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, folderItem);
      }
      setSelectedNodeID(node.node_id);
      setSelectedNodeIDs(new Set([node.node_id]));
      return node;
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_logic_gate");
      return null;
    }
  };

  const createLinkedNode = async (sourceNodeID: string, direction: NodeDirection) => {
    if (!canStartRelationshipFromSide(direction)) return;
    const sourceNode = nodes.find((node) => node.node_id === sourceNodeID);
    if (!sourceNode) return;

    const origin = nodePositions[sourceNodeID] ?? { x: 120, y: 120 };
    const linkedNodeClearance = MINI_GRID * 4;
    const horizontalGap = NODE_W + linkedNodeClearance;
    const verticalGap = NODE_H + linkedNodeClearance;
    const shift =
      direction === "left" ? { x: -horizontalGap, y: 0 }
        : direction === "right" ? { x: horizontalGap, y: 0 }
          : direction === "top" ? { x: 0, y: -verticalGap }
            : { x: 0, y: verticalGap };
    const linkedPosition = {
      x: origin.x + shift.x,
      y: origin.y + shift.y,
    };

    const node = await createNode("new logic gate", { x: linkedPosition.x + NODE_W / 2, y: linkedPosition.y + NODE_H / 2 });
    if (!node) return;

    try {
      const payload = buildLinkedNodePayloadFromSourceSide(direction);
      const createdRelationship = await requestJSON<LogicGateRelationship>("/v1/logic-gate-relationships", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          logic_gate_id_a: sourceNodeID,
          logic_gate_id_b: node.node_id,
          a_position: payload.a_position,
          b_position: payload.b_position,
        }),
      });
      const relationship = toLogicGateCanvasRelationship(createdRelationship);

      setRelationshipAnchors((previous) => ({
        ...previous,
        [relationship.node_relationship_id]: payload.anchor,
      }));
      setRelationships((previous) => (
        previous.some((item) => item.node_relationship_id === relationship.node_relationship_id)
          ? previous
          : [...previous, relationship]
      ));

      setSelectedNodeID(node.node_id);
      setSelectedNodeIDs(new Set([node.node_id]));
      setDetailsPanelNodeID(node.node_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_logic_gate_relationship");
    }
  };

  const updateNodeTitle = async (nodeID: string, nextTitle: string) => {
    const value = trimOrEmpty(nextTitle);
    if (!value) return;
    setError("");
    try {
      const updatedRecord = await requestJSON<LogicGateRecord>(`/v1/logic-gates/${nodeID}`, {
        method: "PUT",
        body: JSON.stringify({ company_id: companyID, header: value }),
      });
      const updated = toLogicGateCanvasRecord(updatedRecord);
      // Latency rule: update in-memory graph cache directly so we avoid a snapshot re-fetch.
      upsertLogicGateRelationshipGraphNode(apiBase, companyID, updated);
      if (details?.node.node_id === nodeID) {
        setDetails((previous) => (previous ? { ...previous, node: updated } : previous));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_logic_gate");
    }
  };

  const commitRelationshipBetweenNodes = async (sourceNodeID: string, sourceSide: NodeDirection, targetNodeID: string, targetSide: NodeDirection) => {
    if (!sourceNodeID || !targetNodeID || sourceNodeID === targetNodeID) return;
    if (!isLegalRelationshipSidePair(sourceSide, targetSide)) {
      setError("illegal_relationship_pair");
      return;
    }
    const payload = buildExistingNodeRelationshipPayload(sourceSide, targetSide);
    const createdRelationship = await requestJSON<LogicGateRelationship>("/v1/logic-gate-relationships", {
      method: "POST",
      body: JSON.stringify({
        company_id: companyID,
        logic_gate_id_a: sourceNodeID,
        logic_gate_id_b: targetNodeID,
        a_position: payload.a_position,
        b_position: payload.b_position,
      }),
    });
    const relationship = toLogicGateCanvasRelationship(createdRelationship);
    setRelationshipAnchors((previous) => ({
      ...previous,
      [relationship.node_relationship_id]: payload.anchor,
    }));
    setRelationships((previous) => (
      previous.some((item) => item.node_relationship_id === relationship.node_relationship_id)
        ? previous
        : [...previous, relationship]
    ));
  };

  const copySelectedMapEntities = () => {
    const payload = buildNodeMapClipboardPayload({
      kind: "logic_gate",
      nodes,
      relationships,
      nodePositions,
      nodeSizes,
      relationshipAnchors,
      selectedNodeID,
      selectedNodeIDs,
    });
    if (!payload) return;
    const serialized = JSON.stringify(payload);
    try {
      localStorage.setItem(NODE_MAP_CLIPBOARD_STORAGE_KEY, serialized);
    } catch {
      // Clipboard is best-effort UI state.
    }
    void navigator.clipboard?.writeText(serialized).catch(() => undefined);
    setStatusMessage(`Copied ${payload.nodes.length} logic gate${payload.nodes.length === 1 ? "" : "s"} and ${payload.relationships.length} relationship line${payload.relationships.length === 1 ? "" : "s"}.`);
  };

  const pasteCopiedMapEntities = async () => {
    const payload = parseNodeMapClipboardPayload(localStorage.getItem(NODE_MAP_CLIPBOARD_STORAGE_KEY));
    if (!payload || payload.kind !== "logic_gate") return;
    const minX = Math.min(...payload.nodes.map((node) => node.x));
    const minY = Math.min(...payload.nodes.map((node) => node.y));
    const offset = { x: visibleInsertionPosition.x - minX, y: visibleInsertionPosition.y - minY };
    const nextIDByOldID = new Map<string, string>();
    const createdNodes: NodeRecord[] = [];
    const createdPositions: Record<string, NodePosition> = {};
    setError("");
    try {
      for (const copied of payload.nodes) {
        const node = await createNode(copied.title, {
          x: copied.x + offset.x + copied.w / 2,
          y: copied.y + offset.y + copied.h / 2,
        });
        if (!node) continue;
        nextIDByOldID.set(copied.oldID, node.node_id);
        createdNodes.push(node);
        createdPositions[node.node_id] = {
          x: clamp(snapToGrid(copied.x + offset.x), 0, WORLD_W - NODE_W),
          y: clamp(snapToGrid(copied.y + offset.y), 0, WORLD_H - NODE_H),
        };
        setNodeSizes((previous) => ({ ...previous, [node.node_id]: { w: copied.w, h: copied.h } }));
      }
      if (createdNodes.length === 0) return;
      setNodePositions((previous) => ({ ...previous, ...createdPositions }));
      const createdRelationships: NodeRelationship[] = [];
      const createdAnchors: Record<string, RelationshipAnchor> = {};
      for (const copied of payload.relationships) {
        const nodeIDA = nextIDByOldID.get(copied.nodeIDA);
        const nodeIDB = nextIDByOldID.get(copied.nodeIDB);
        if (!nodeIDA || !nodeIDB) continue;
        const createdRelationship = await requestJSON<LogicGateRelationship>("/v1/logic-gate-relationships", {
          method: "POST",
          body: JSON.stringify({
            company_id: companyID,
            logic_gate_id_a: nodeIDA,
            logic_gate_id_b: nodeIDB,
            a_position: copied.aPosition,
            b_position: copied.bPosition,
          }),
        });
        const relationship = toLogicGateCanvasRelationship(createdRelationship);
        createdRelationships.push(relationship);
        if (copied.anchor) createdAnchors[relationship.node_relationship_id] = copied.anchor;
      }
      if (createdRelationships.length > 0) {
        setRelationships((previous) => [...previous, ...createdRelationships]);
        setRelationshipAnchors((previous) => ({ ...previous, ...createdAnchors }));
      }
      const createdIDs = createdNodes.map((node) => node.node_id);
      setSelectedNodeID(createdIDs.length === 1 ? createdIDs[0] : "");
      setSelectedNodeIDs(new Set(createdIDs));
      setSelectedRelationshipIDs(new Set());
      setStatusMessage(`Pasted ${createdNodes.length} logic gate${createdNodes.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_paste_logic_gates");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((!event.ctrlKey && !event.metaKey) || (key !== "c" && key !== "v")) return;
      if (shouldIgnoreMapDeleteKeyTarget(event.target as HTMLElement | null)) return;
      if (!canvasActive) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === "c") {
        copySelectedMapEntities();
        return;
      }
      void pasteCopiedMapEntities();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [canvasActive, nodePositions, nodeSizes, nodes, relationships, relationshipAnchors, selectedNodeID, selectedNodeIDs, visibleInsertionPosition]);

  // Delete-node action with selection/context cleanup and snapshot refresh.
  const deleteNode = async (nodeID: string) => {
    if (!nodeID) return;
    setError("");
    try {
      await requestJSON<{ status: string }>(`/v1/logic-gates/${nodeID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      });
      removeLogicGateRelationshipGraphNode(apiBase, companyID, nodeID);
      setDetails((current) => (current?.node.node_id === nodeID ? null : current));
      if (detailsPanelNodeID === nodeID) setDetailsPanelNodeID("");
      setSelectedNodeIDs((previous) => {
        const next = new Set(previous);
        next.delete(nodeID);
        return next;
      });
      setSelectedNodeID((previous) => {
        if (previous !== nodeID) return previous;
        const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
        const fallback = (snapshot.nodes ?? [])[0]?.node_id ?? "";
        return fallback;
      });
      setNodePositions((previous) => {
        const next = { ...previous };
        delete next[nodeID];
        return next;
      });
      const persisted = { ...lastPersistedNodePositionsRef.current };
      delete persisted[nodeID];
      lastPersistedNodePositionsRef.current = persisted;
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_delete_logic_gate");
    }
  };

  const deleteNodes = async (nodeIDs: string[]) => {
    const unique = Array.from(new Set(nodeIDs.filter(Boolean)));
    if (unique.length === 0) return;
    setError("");
    try {
      await Promise.all(unique.map((nodeID) => requestJSON<{ status: string }>(`/v1/logic-gates/${nodeID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      })));
      for (const id of unique) removeLogicGateRelationshipGraphNode(apiBase, companyID, id);
      setDetails((current) => (current && unique.includes(current.node.node_id) ? null : current));
      if (detailsPanelNodeID && unique.includes(detailsPanelNodeID)) setDetailsPanelNodeID("");
      const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
      const fallback = (snapshot.nodes ?? [])[0]?.node_id ?? "";
      setSelectedNodeID(fallback);
      setSelectedNodeIDs(new Set());
      setNodePositions((previous) => {
        const next = { ...previous };
        for (const id of unique) delete next[id];
        return next;
      });
      const persisted = { ...lastPersistedNodePositionsRef.current };
      for (const id of unique) delete persisted[id];
      lastPersistedNodePositionsRef.current = persisted;
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_delete_logic_gate");
    }
  };

  const deleteRelationships = async (relationshipIDs: string[]) => {
    const unique = Array.from(new Set(relationshipIDs.filter(Boolean)));
    if (unique.length === 0) return;
    setError("");
    setStatusMessage(`Deleting ${unique.length} relationship line${unique.length === 1 ? "" : "s"}...`);
    try {
      const settled = await Promise.allSettled(unique.map((relationshipID) => requestJSON<{ status: string }>(`/v1/logic-gate-relationships/${relationshipID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      })));
      const summary = summarizeRelationshipDeleteResults(unique, settled);

      if (summary.succeededIDs.length > 0) {
        const deletedSet = new Set(summary.succeededIDs);
        setRelationships((previous) => previous.filter((relationship) => !deletedSet.has(relationship.node_relationship_id)));
      }
      setSelectedRelationshipIDs((previous) => {
        if (summary.succeededIDs.length === 0) return previous;
        const next = new Set(previous);
        for (const id of summary.succeededIDs) next.delete(id);
        return next;
      });
      setRelationshipAnchors((previous) => {
        if (summary.succeededIDs.length === 0) return previous;
        const next = { ...previous };
        for (const id of summary.succeededIDs) delete next[id];
        return next;
      });

      loadGraphRelationshipsFromSnapshot(nodes);

      if (summary.failed.length > 0) {
        const failure = summary.failed[0];
        if (failure?.reason === "logic_gate_relationship_not_found" || failure?.reason === "relationship_not_found" || failure?.reason.startsWith("request_failed_404")) {
          await refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID);
          const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
          setRelationships(projectVisibleRelationships(nodes, snapshot.relationships ?? []));
        }
        setError(failure?.reason ?? "failed_to_delete_relationship");
        setStatusMessage(
          `Deleted ${summary.succeededIDs.length}/${unique.length} relationship lines. First failure (${failure?.relationshipID ?? "unknown"}): ${failure?.reason ?? "failed_to_delete_relationship"}`,
        );
        return;
      }

      setStatusMessage(`Deleted ${summary.succeededIDs.length} relationship line${summary.succeededIDs.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_delete_relationship");
      setStatusMessage("Delete relationship line request failed.");
    }
  };

  useNodeMapDeleteKeyboardControl({
    canvasActive,
    selectedNodeID,
    selectedNodeIDs,
    selectedRelationshipIDs,
    setConfirmDelete,
  });

  const nodeByID = useMemo(() => Object.fromEntries(nodes.map((node) => [node.node_id, node])), [nodes]);
  const activeRoleNodeID = useMemo(() => {
    if (selectedNodeIDs.size === 1) return Array.from(selectedNodeIDs)[0] ?? "";
    return selectedNodeID;
  }, [selectedNodeIDs, selectedNodeID]);


  const getAnchorPoint = (nodeID: string, side: NodeDirection) => getLogicGateMapAnchorPoint({ nodeID, side, nodePositions });

  const visibleNodeIDSet = useMemo(() => {
    const minX = (-pan.x) / zoom;
    const minY = (-pan.y) / zoom;
    const maxX = minX + canvasSize.width / zoom;
    const maxY = minY + canvasSize.height / zoom;
    const pad = 180;
    const visible = new Set<string>();
    for (const node of nodes) {
      const position = nodePositions[node.node_id] ?? { x: 120, y: 120 };
      const inView = position.x + NODE_W >= minX - pad && position.x <= maxX + pad && position.y + NODE_H >= minY - pad && position.y <= maxY + pad;
      if (inView) visible.add(node.node_id);
    }
    return visible;
  }, [nodes, nodePositions, pan.x, pan.y, zoom, canvasSize.width, canvasSize.height]);

  const relationshipRoutingGrid = useMemo(
    () => buildLogicGateMapRelationshipRoutingGrid({ nodes, nodePositions, worldWidth: WORLD_W, worldHeight: WORLD_H }),
    [WORLD_H, WORLD_W, nodes, nodePositions],
  );

  const routeOrthogonalPath = (
    from: { x: number; y: number },
    fromOut: { x: number; y: number },
    toIn: { x: number; y: number },
    to: { x: number; y: number },
    sourceNodeID: string,
    targetNodeID: string,
  ) => routeLogicGateMapOrthogonalPath({
    from,
    fromOut,
    toIn,
    to,
    sourceNodeID,
    targetNodeID,
    nodePositions,
    routingGrid: relationshipRoutingGrid,
  });

  const routeDraftPath = (
    from: { x: number; y: number },
    fromOut: { x: number; y: number },
    cursor: { x: number; y: number },
    sourceNodeID: string,
  ) => routeLogicGateMapDraftPath({
    from,
    fromOut,
    cursor,
    sourceNodeID,
    nodePositions,
    routingGrid: relationshipRoutingGrid,
  });

  const connectionPaths = useMemo(() => {
    return relationships
      .filter((rel) => nodeByID[rel.node_id_a] && nodeByID[rel.node_id_b] && nodePositions[rel.node_id_a] && nodePositions[rel.node_id_b])
      .filter((rel) => visibleNodeIDSet.has(rel.node_id_a) || visibleNodeIDSet.has(rel.node_id_b))
      .map((rel) => {
        const projection = projectRelationshipVisual(rel, {
          activeNodeID: activeRoleNodeID,
          relationshipColorsEnabled,
          relationshipRoleColors,
          accent,
          rememberedAnchor: relationshipAnchors[rel.node_relationship_id],
          nodePositions,
        });
        const from = getAnchorPoint(projection.sourceNodeID, projection.sourceAnchor);
        const to = getAnchorPoint(projection.targetNodeID, projection.targetAnchor);
        if (!from || !to) return null;
        const lane = MINI_GRID * 2;
        const fromOut = projection.sourceAnchor === "left" ? { x: from.x - lane, y: from.y }
          : projection.sourceAnchor === "right" ? { x: from.x + lane, y: from.y }
            : projection.sourceAnchor === "top" ? { x: from.x, y: from.y - lane }
              : { x: from.x, y: from.y + lane };
        const toIn = projection.targetAnchor === "left" ? { x: to.x - lane, y: to.y }
          : projection.targetAnchor === "right" ? { x: to.x + lane, y: to.y }
            : projection.targetAnchor === "top" ? { x: to.x, y: to.y - lane }
              : { x: to.x, y: to.y + lane };
        const points = routeOrthogonalPath(from, fromOut, toIn, to, rel.node_id_a, rel.node_id_b);
        return {
          id: rel.node_relationship_id,
          points,
          stroke: projection.strokeColor,
          alpha: projection.alpha,
          selected: selectedRelationshipIDs.has(rel.node_relationship_id),
        };
      })
      .filter((path): path is { id: string; points: { x: number; y: number }[]; stroke: string; alpha: number; selected: boolean } => !!path);
  }, [relationships, nodeByID, nodePositions, relationshipAnchors, visibleNodeIDSet, relationshipRoutingGrid, activeRoleNodeID, relationshipRoleColors, accent, relationshipColorsEnabled, selectedRelationshipIDs]);

  useEffect(() => {
    connectionPathsRef.current = connectionPaths.map((path) => ({ id: path.id, points: path.points }));
  }, [connectionPaths]);

  const draftPath = useMemo(() => {
    if (!relationshipDraft) return null;
    const from = getAnchorPoint(relationshipDraft.sourceNodeID, relationshipDraft.sourceSide);
    if (!from) return null;
    const lane = MINI_GRID * 2;
    const fromOut = relationshipDraft.sourceSide === "left" ? { x: from.x - lane, y: from.y }
      : relationshipDraft.sourceSide === "right" ? { x: from.x + lane, y: from.y }
        : relationshipDraft.sourceSide === "top" ? { x: from.x, y: from.y - lane }
          : { x: from.x, y: from.y + lane };
    return routeDraftPath(from, fromOut, relationshipDraft.cursor, relationshipDraft.sourceNodeID);
  }, [relationshipDraft, nodePositions, relationshipRoutingGrid]);

  const visibleNodes = useMemo(() => nodes.filter((node) => visibleNodeIDSet.has(node.node_id)), [nodes, visibleNodeIDSet]);

  useEffect(() => {
    const canvas = relationshipCanvasRef.current;
    if (!canvas) return;
    const width = WORLD_W;
    const height = WORLD_H;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, width, height);
    context.lineCap = "round";
    context.lineJoin = "round";

    for (const path of connectionPaths) {
      if (path.points.length === 0) continue;
      context.lineWidth = path.selected ? 3.4 : 1.6;
      context.strokeStyle = relationshipColorsEnabled ? path.stroke : accent;
      context.globalAlpha = path.alpha;
      context.beginPath();
      context.moveTo(path.points[0].x, path.points[0].y);
      for (const point of path.points.slice(1)) {
        context.lineTo(point.x, point.y);
      }
      context.stroke();
    }
    if (draftPath && draftPath.length > 1) {
      context.lineWidth = 2.1;
      context.strokeStyle = accent;
      context.globalAlpha = 0.9;
      context.setLineDash([7, 5]);
      context.beginPath();
      context.moveTo(draftPath[0].x, draftPath[0].y);
      for (const point of draftPath.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
      context.setLineDash([]);
    }
    context.globalAlpha = 1;
  }, [WORLD_H, WORLD_W, accent, connectionPaths, relationshipColorsEnabled, draftPath]);

  useEffect(() => {
    if (!editingNodeTitleNodeID || !editingNodeTitleElementRef.current) return;
    const element = editingNodeTitleElementRef.current;
    element.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [editingNodeTitleNodeID]);

  const viewportHandlers = useLogicGateMapViewportHandlers({
    viewportRef,
    pan,
    zoom,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    relationshipDraft,
    selectedNodeIDs,
    selectedRelationshipIDs,
    startNodeMapMultiSelect,
    setCanvasActive,
    setContextMenu,
    setNodeContextMenu,
    setRelationshipContextMenu,
    setRelationshipDraft,
    setZoom,
    setPan,
    setPanState,
  });

  return (
    <div style={{ fontSize: 11, height: "100%", color: panelText }}>
      <div
        ref={viewportRef}
        data-node-map-viewport="true"
        style={{
          position: "relative",
          overflow: "hidden",
          height: "100%",
          width: "100%",
          backgroundColor: "transparent",
        }}
        {...viewportHandlers}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: WORLD_W,
            height: WORLD_H,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            ...gridBackgroundStyle,
          }}
        >
          <canvas
            ref={relationshipCanvasRef}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}
          />
          <LogicGateMapRelationshipHitLines
            worldWidth={WORLD_W}
            worldHeight={WORLD_H}
            paths={connectionPaths}
            viewportRef={viewportRef}
            suppressNextRelationshipLineClickRef={suppressNextRelationshipLineClickRef}
            onStartMultiSelect={startNodeMapMultiSelect}
            onDeleteRelationships={(relationshipIDs) => {
              void deleteRelationships(relationshipIDs);
            }}
            onSetCanvasActive={setCanvasActive}
            onSetContextMenu={setContextMenu}
            onSetNodeContextMenu={setNodeContextMenu}
            onSetRelationshipContextMenu={setRelationshipContextMenu}
            onSetRelationshipDraft={setRelationshipDraft}
            onSetError={setError}
            onSetSelectedNodeID={setSelectedNodeID}
            onSetSelectedNodeIDs={setSelectedNodeIDs}
            onSetSelectedRelationshipIDs={setSelectedRelationshipIDs}
          />

          {visibleNodes.map((node) => (
            <LogicGateMapNodeCard
              key={node.node_id}
              node={node}
              position={nodePositions[node.node_id] ?? { x: 120, y: 120 }}
              size={nodeSizes[node.node_id] ?? { w: NODE_W, h: NODE_H }}
              selectedNodeID={selectedNodeID}
              selectedNodeIDs={selectedNodeIDs}
              editingNodeTitleNodeID={editingNodeTitleNodeID}
              editingNodeTitleElementRef={editingNodeTitleElementRef}
              editingNodeTitleDraftRef={editingNodeTitleDraftRef}
              dragState={dragState}
              relationshipDraft={relationshipDraft}
              nodePositions={nodePositions}
              zoom={zoom}
              accent={accent}
              panelSurface={panelSurface}
              nodeCardBackground={nodeCardBackground}
              nodeCardSelectedBackground={nodeCardSelectedBackground}
              nodeCardBorder={nodeCardBorder}
              nodeCardText={nodeCardText}
              selectionColor={SELECTION_CYAN}
              onSetCanvasActive={setCanvasActive}
              onSetContextMenu={setContextMenu}
              onSetNodeContextMenu={setNodeContextMenu}
              onSetRelationshipContextMenu={setRelationshipContextMenu}
              onSetSelectedRelationshipIDs={setSelectedRelationshipIDs}
              onSetSelectedNodeID={setSelectedNodeID}
              onSetSelectedNodeIDs={setSelectedNodeIDs}
              onSetDragState={setDragState}
              onSetRelationshipDraft={setRelationshipDraft}
              onSetEditingNodeTitleNodeID={setEditingNodeTitleNodeID}
              onSetError={setError}
              onCreateLinkedNode={createLinkedNode}
              onCommitRelationshipBetweenNodes={commitRelationshipBetweenNodes}
              onUpdateNodeTitle={updateNodeTitle}
              onGetAnchorPoint={getAnchorPoint}
              onStartResize={(nodeID, pointerID, startMouseX, startMouseY, startX, startY, startW, startH, edges) => {
                setNodeResizeState({
                  nodeID,
                  pointerID,
                  startMouseX,
                  startMouseY,
                  startX,
                  startY,
                  startW,
                  startH,
                  edges,
                });
              }}
            />
          ))}
        </div>

        {selectionBox.active && (
          <div
            style={{
              position: "absolute",
              left: Math.min(selectionBox.startX, selectionBox.currentX),
              top: Math.min(selectionBox.startY, selectionBox.currentY),
              width: Math.abs(selectionBox.currentX - selectionBox.startX),
              height: Math.abs(selectionBox.currentY - selectionBox.startY),
              border: `1px dashed ${accent}`,
              backgroundColor: "rgba(111,231,238,0.2)",
              pointerEvents: "none",
              zIndex: 20,
            }}
          />
        )}

        <LogicGateMapContextMenus
          contextMenu={contextMenu}
          nodeContextMenu={nodeContextMenu}
          relationshipContextMenu={relationshipContextMenu}
          confirmDelete={confirmDelete}
          accent={accent}
          panelSurface={panelSurface}
          panelSubtleSurface={panelSubtleSurface}
          panelText={panelText}
          panelMutedText={panelMutedText}
          dialogButtonBackground={dialogButtonBackground}
          dialogPrimaryButtonText={dialogPrimaryButtonText}
          dialogCancelButtonText={dialogCancelButtonText}
          relationshipColorsEnabled={relationshipColorsEnabled}
          relationshipRoleColors={relationshipRoleColors}
          selectedNodeIDs={selectedNodeIDs}
          selectedRelationshipIDs={selectedRelationshipIDs}
          contextMenuButtonStyle={contextMenuButtonStyle}
          contextMenuDangerButtonStyle={contextMenuDangerButtonStyle}
          selectionBoxActive={selectionBox.active}
          statusMessage={statusMessage}
          error={error}
          onCreateNodeAtContext={(worldX, worldY) => {
            const title = trimOrEmpty(newNodeTitle) || "new logic gate";
            void createNode(title, { x: worldX, y: worldY });
            if (!trimOrEmpty(newNodeTitle)) setNewNodeTitle("");
            setContextMenu(null);
          }}
          onToggleRelationshipColors={() => setRelationshipColorsEnabled((previous) => !previous)}
          onRelationshipRoleColorChange={(role, color) => setRelationshipRoleColors((previous) => ({ ...previous, [role]: color }))}
          onFindNodeSelection={(nodeID) => {
            const ids = selectedNodeIDs.has(nodeID) ? Array.from(selectedNodeIDs) : [nodeID];
            requestFindLogicGatesOnCompanyExplorer(ids);
            setNodeContextMenu(null);
          }}
          onRenameNode={(nodeID) => {
            const current = nodes.find((node) => node.node_id === nodeID);
            editingNodeTitleDraftRef.current = current ? getNodeTitle(current) : "new logic gate";
            setEditingNodeTitleNodeID(nodeID);
            setNodeContextMenu(null);
          }}
          onRequestDeleteNodes={(nodeIDs) => {
            setConfirmDelete({ nodeIDs, relationshipIDs: [] });
            setNodeContextMenu(null);
          }}
          onDeleteRelationships={(relationshipIDs) => {
            void deleteRelationships(relationshipIDs);
            setRelationshipContextMenu(null);
          }}
          onConfirmDelete={() => {
            if (confirmDelete?.relationshipIDs.length) void deleteRelationships(confirmDelete.relationshipIDs);
            if (confirmDelete?.nodeIDs.length) void deleteNodes(confirmDelete.nodeIDs);
            setConfirmDelete(null);
          }}
          onCancelDelete={() => setConfirmDelete(null)}
        />
      </div>
    </div>
  );
};

