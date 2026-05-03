import React, { useEffect, useMemo, useRef, useState } from "react";
import { INFO_TYPES, MINI_GRID, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, NODE_H, NODE_W, PANEL_MIN_HEIGHT, PANEL_MIN_WIDTH, panelResizeHandles, NodeMapState, NodeDetails, NodeDirection, NodeInformation, NodePosition, NodeRecord, NodeRelationship, RelationshipAnchor, SESSION_NODE_MAP_STATE, changedPersistedMapPositions, clamp, divider, getNodeTitle, persistedMapPositionsToNodePositions, reconcileNodeMapPositions, snapToGrid, trimOrEmpty } from "./shared";
import { emitDashboardEvent, EVENT_EXPLORER_CONTEXT_UPDATED, EVENT_NODE_MAP_SELECTION_UPDATED } from "./eventbus";
import { type ContextMutationEnvelope } from "../contextSyncContract";
import { getNodeRelationshipGraphSnapshot, refreshNodeRelationshipGraphSnapshot, removeNodeRelationshipGraphNode, subscribeNodeRelationshipGraph, upsertNodeRelationshipGraphNode, upsertCompanyExplorerFolderItemInNodeRelationshipGraph } from "./NodeRelationshipGraph";
import { buildExistingNodeRelationshipPayload, buildLinkedNodePayloadFromSourceSide, isLegalRelationshipSidePair, projectRelationshipVisual } from "./relationshipProjection";
import { summarizeRelationshipDeleteResults } from "./relationshipDeleteSummary";
import { invalidateNodeRecordStoreCaches } from "./NodeRecordStore";
import { beginNodeMapMultiSelectSession, NodeMapDragState, NodeMapMultiSelectBox, NodeMapPanState, NodeMapPanelDragState, NodeMapPanelResizeState, useNodeMapDeleteKeyboardControl, useNodeMapDragControls, useNodeMapMultiSelectControls, useNodeMapPanelControls, useNodeMapPanControls, useNodeMapRelationshipDraftControls } from "./NodeMapControls";
import { filterNodeGraphToFolderScope, type CompanyExplorerFolder, type CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";

// Node Map module: graph canvas, relationship editing, and detail panel workflows.
export const NodeMapContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }> = ({ accent, widgetId, hideTopControls: _hideTopControls, theme = "teal" }) => {
  const SELECTION_CYAN = "rgb(0, 233, 255)";
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const mapScope = widgetId?.trim() ? widgetId : "global";
  const mapStateKey = `node-map-state-v1:${companyID}:${mapScope}`;
  const fallbackMapStateKey = `node-map-state-v1:${companyID}:last-opened-map`;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const relationshipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 560 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panInitialized, setPanInitialized] = useState(false);
  const [restoredViewport, setRestoredViewport] = useState(false);

  const WORLD_W = 6400;
  const WORLD_H = 4400;

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
  const explorerContextRef = useRef<number>(0);
  const layoutPersistenceReadyRef = useRef(false);
  const lastPersistedNodePositionsRef = useRef<Record<string, NodePosition>>({});
  const [relationshipColorsEnabled, setRelationshipColorsEnabled] = useState(false);
  const [relationshipRoleColors, setRelationshipRoleColors] = useState({ parent: "#ff8a00", peer: "#0095ff", child: "#6f5cff" });
  const [relationshipDraft, setRelationshipDraft] = useState<{ sourceNodeID: string; sourceSide: NodeDirection; cursor: { x: number; y: number } } | null>(null);
  const [selectedRelationshipIDs, setSelectedRelationshipIDs] = useState<Set<string>>(new Set());
  const [editingNodeTitleNodeID, setEditingNodeTitleNodeID] = useState<string | null>(null);
  const editingNodeTitleDraftRef = useRef("");
  const editingNodeTitleElementRef = useRef<HTMLDivElement | null>(null);
  const connectionPathsRef = useRef<Array<{ id: string; points: { x: number; y: number }[] }>>([]);
  const suppressNextRelationshipLineClickRef = useRef(false);
  const selectionRevisionRef = useRef(0);
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
    folderID = activeFolderID,
  ) => {
    const scoped = filterNodeGraphToFolderScope({
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

  const applyServerMapPositions = (positions: Parameters<typeof persistedMapPositionsToNodePositions>[0]["positions"]) => {
    const serverPositions = persistedMapPositionsToNodePositions({
      positions,
      worldWidth: WORLD_W,
      worldHeight: WORLD_H,
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
    });
    lastPersistedNodePositionsRef.current = { ...lastPersistedNodePositionsRef.current, ...serverPositions };
    if (Object.keys(serverPositions).length > 0) {
      setNodePositions((previous) => ({ ...previous, ...serverPositions }));
    }
    layoutPersistenceReadyRef.current = true;
  };

  useEffect(() => {
    const cached = SESSION_NODE_MAP_STATE.get(mapStateKey) ?? SESSION_NODE_MAP_STATE.get(fallbackMapStateKey);
    if (cached) {
      setZoom(clamp(cached.zoom, 0.45, 2.7));
      setPan(cached.pan);
      setPanInitialized(true);
      restoredSelectionRef.current = cached.selectedNodeID;
      setSelectedNodeID(cached.selectedNodeID);
      setSelectedNodeIDs(cached.selectedNodeID ? new Set([cached.selectedNodeID]) : new Set());
      setNodePositions(cached.nodePositions);
      setRelationshipColorsEnabled(!!cached.relationshipColorsEnabled);
      if (cached.relationshipRoleColors) {
        setRelationshipRoleColors({
          parent: cached.relationshipRoleColors.parent ?? "#ff8a00",
          peer: cached.relationshipRoleColors.peer ?? "#0095ff",
          child: cached.relationshipRoleColors.child ?? "#6f5cff",
        });
      }
      setRestoredViewport(true);
      return;
    }
    try {
      const raw = localStorage.getItem(mapStateKey) ?? localStorage.getItem(fallbackMapStateKey);
      if (!raw) {
        setRestoredViewport(true);
        return;
      }
      const parsed = JSON.parse(raw) as {
        zoom?: number;
        pan?: { x?: number; y?: number };
        selectedNodeID?: string;
        nodePositions?: Record<string, { x?: number; y?: number }>;
        relationshipColorsEnabled?: boolean;
        relationshipRoleColors?: { parent?: string; peer?: string; child?: string };
      };
      if (typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom)) {
        setZoom(clamp(parsed.zoom, 0.45, 2.7));
      }
      if (parsed.pan && typeof parsed.pan.x === "number" && typeof parsed.pan.y === "number") {
        setPan({ x: parsed.pan.x, y: parsed.pan.y });
        setPanInitialized(true);
      }
      if (typeof parsed.selectedNodeID === "string") {
        restoredSelectionRef.current = parsed.selectedNodeID;
        setSelectedNodeID(parsed.selectedNodeID);
        setSelectedNodeIDs(parsed.selectedNodeID ? new Set([parsed.selectedNodeID]) : new Set());
      }
      if (parsed.nodePositions && typeof parsed.nodePositions === "object") {
        const sanitized: Record<string, NodePosition> = {};
        for (const [key, value] of Object.entries(parsed.nodePositions)) {
          if (!value) continue;
          const x = typeof value.x === "number" ? value.x : 0;
          const y = typeof value.y === "number" ? value.y : 0;
          sanitized[key] = {
            x: clamp(snapToGrid(x), 0, WORLD_W - NODE_W),
            y: clamp(snapToGrid(y), 0, WORLD_H - NODE_H),
          };
        }
        setNodePositions(sanitized);
      }
      if (typeof parsed.relationshipColorsEnabled === "boolean") {
        setRelationshipColorsEnabled(parsed.relationshipColorsEnabled);
      }
      if (parsed.relationshipRoleColors && typeof parsed.relationshipRoleColors === "object") {
        setRelationshipRoleColors({
          parent: typeof parsed.relationshipRoleColors.parent === "string" ? parsed.relationshipRoleColors.parent : "#ff8a00",
          peer: typeof parsed.relationshipRoleColors.peer === "string" ? parsed.relationshipRoleColors.peer : "#0095ff",
          child: typeof parsed.relationshipRoleColors.child === "string" ? parsed.relationshipRoleColors.child : "#6f5cff",
        });
      }
    } catch {
      // ignore local cache parse errors
    } finally {
      setRestoredViewport(true);
    }
  }, [fallbackMapStateKey, mapStateKey]);

  // Shared API request helper for node CRUD, details, and relationship operations.
  const requestJSON = async <T,>(path: string, init?: RequestInit): Promise<T> => {
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
  };

  // Snapshot-driven node loader that also restores/maintains active selection.
  const loadNodes = async () => {
    setLoading(true);
    setError("");
    try {
      await refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      const nextNodes = applyFolderScope(snapshot.nodes ?? [], snapshot.relationships ?? [], snapshot.folders ?? [], snapshot.folder_items ?? []);
      applyServerMapPositions(snapshot.node_map_positions ?? []);

      const hasSelection = selectedNodeID && nextNodes.some((item) => item.node_id === selectedNodeID);
      if (hasSelection) return;

      const restoredSelection = restoredSelectionRef.current;
      if (restoredSelection && nextNodes.some((item) => item.node_id === restoredSelection)) {
        setSelectedNodeID(restoredSelection);
        setSelectedNodeIDs(new Set([restoredSelection]));
        return;
      }

      const fallback = nextNodes[0]?.node_id ?? "";
      setSelectedNodeID(fallback);
      setSelectedNodeIDs(fallback ? new Set([fallback]) : new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_load_nodes");
    } finally {
      setLoading(false);
    }
  };

  // Load relationship set scoped to nodes currently available in the local workspace snapshot cache.
  // IMPORTANT: this intentionally does not fetch. Fetching here created a hot-path feedback loop:
  // nodes changed -> refresh snapshot -> subscription setNodes -> nodes changed again.
  const loadGraphRelationshipsFromSnapshot = (graphNodes: NodeRecord[]) => {
    if (graphNodes.length === 0) {
      setRelationships([]);
      return;
    }
    const payload = getNodeRelationshipGraphSnapshot(apiBase, companyID);
    setRelationships(projectVisibleRelationships(graphNodes, payload.relationships ?? []));
  };


  useEffect(() => {
    void loadNodes();
  }, []);

  useEffect(() => {
    return subscribeNodeRelationshipGraph(apiBase, companyID, () => {
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      applyFolderScope(snapshot.nodes ?? [], snapshot.relationships ?? [], snapshot.folders ?? [], snapshot.folder_items ?? []);
      applyServerMapPositions(snapshot.node_map_positions ?? []);
    });
  }, [apiBase, companyID, activeFolderID]);

  useEffect(() => {
    const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
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

  useEffect(() => {
    if (!selectedNodeID) return;
    if (nodes.some((node) => node.node_id === selectedNodeID)) return;
    const fallback = nodes[0]?.node_id ?? "";
    setSelectedNodeID(fallback);
    setSelectedNodeIDs(fallback ? new Set([fallback]) : new Set());
  }, [nodes, selectedNodeID]);

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
    const timeout = window.setTimeout(() => {
      try {
        const nextState: NodeMapState = {
          zoom,
          pan,
          selectedNodeID,
          // Positions can be huge and are shared by every user/agent. Keep the
          // browser cache small; the database-backed map-layout API owns geometry.
          nodePositions: {},
          relationshipColorsEnabled,
          relationshipRoleColors,
        };
        SESSION_NODE_MAP_STATE.set(mapStateKey, nextState);
        SESSION_NODE_MAP_STATE.set(fallbackMapStateKey, nextState);
        const serializedState = JSON.stringify(nextState);
        localStorage.setItem(mapStateKey, serializedState);
        localStorage.setItem(fallbackMapStateKey, serializedState);
      } catch {
        // ignore local storage quota/security errors
      }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [fallbackMapStateKey, mapStateKey, restoredViewport, zoom, pan, selectedNodeID, relationshipColorsEnabled, relationshipRoleColors]);

  useEffect(() => {
    if (!restoredViewport || !layoutPersistenceReadyRef.current) return;
    const timeout = window.setTimeout(() => {
      const changed = changedPersistedMapPositions({
        previous: lastPersistedNodePositionsRef.current,
        current: nodePositions,
        entityIDs: new Set(nodes.map((node) => node.node_id)),
      });
      if (changed.length === 0) return;

      const persist = async () => {
        try {
          for (let index = 0; index < changed.length; index += 500) {
            const chunk = changed.slice(index, index + 500);
            const payload = await requestJSON<{ positions: Array<{ node_id?: string; entity_id?: string; x: number; y: number }> }>("/v1/map-layout", {
              method: "PUT",
              body: JSON.stringify({
                company_id: companyID,
                map_type: "node",
                positions: chunk,
              }),
            });
            const savedPositions = persistedMapPositionsToNodePositions({
              positions: payload.positions,
              worldWidth: WORLD_W,
              worldHeight: WORLD_H,
              nodeWidth: NODE_W,
              nodeHeight: NODE_H,
            });
            lastPersistedNodePositionsRef.current = { ...lastPersistedNodePositionsRef.current, ...savedPositions };
          }
        } catch {
          // Keep local interaction responsive if the layout write is temporarily unavailable.
          // The next drag/resize or snapshot refresh gets another chance to converge.
        }
      };

      // Fire and forget by design: layout is an eventually consistent projection.
      // Local drag stays instant; the API write catches up after pointer activity settles.
      void persist();
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [companyID, nodePositions, nodes, restoredViewport]);

  useEffect(() => {
    if (!restoredViewport) return;
    selectionRevisionRef.current += 1;
    const envelope: ContextMutationEnvelope = {
      context_id: `active_node_selection:${companyID}:${mapScope}`,
      source_module_id: mapScope,
      sequence: selectionRevisionRef.current,
      timestamp: new Date().toISOString(),
      user_action_type: "node_selection_changed",
    };
    emitDashboardEvent(EVENT_NODE_MAP_SELECTION_UPDATED, {
      mapWidgetID: mapScope,
      selectedNodeID,
      revision: selectionRevisionRef.current,
      changedAt: Date.now(),
      envelope,
    });
  }, [mapScope, restoredViewport, selectedNodeID]);

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
      });
    });
  }, [nodes, canvasSize.width]);

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
  });

  useEffect(() => {
    const explorerKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${mapScope}`;
    const applyExplorerContext = () => {
      try {
        const raw = localStorage.getItem(explorerKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { selectedNodeID?: string; selectedFolderID?: string; selectedFolderKind?: string; selectedFolderLabel?: string; selectedLabel?: string; ts?: number };
        if (typeof parsed.ts !== "number" || parsed.ts <= explorerContextRef.current) return;
        explorerContextRef.current = parsed.ts;
        if (parsed.selectedFolderKind === "node") {
          setActiveFolderID(typeof parsed.selectedFolderID === "string" ? parsed.selectedFolderID : "");
          setActiveFolderLabel(typeof parsed.selectedFolderLabel === "string" ? parsed.selectedFolderLabel : (typeof parsed.selectedLabel === "string" ? parsed.selectedLabel : ""));
          const selected = typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "";
          if (selected && allNodes.some((node) => node.node_id === selected)) {
            setSelectedNodeID(selected);
            setSelectedNodeIDs(new Set([selected]));
          } else {
            setSelectedNodeID("");
            setSelectedNodeIDs(new Set());
          }
          return;
        }
        if (!parsed.selectedNodeID) return;
        const exists = allNodes.some((node) => node.node_id === parsed.selectedNodeID);
        if (!exists) return;
        setActiveFolderID("");
        setActiveFolderLabel("");
        setSelectedNodeID(parsed.selectedNodeID);
        setSelectedNodeIDs(new Set([parsed.selectedNodeID]));
      } catch {
        // ignore malformed explorer context payload
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== explorerKey) return;
      applyExplorerContext();
    };
    const onExplorerContextUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (!detail || detail.key !== explorerKey) return;
      applyExplorerContext();
    };
    applyExplorerContext();
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContextUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContextUpdated);
    };
  }, [companyID, mapScope, allNodes]);

  useNodeMapPanControls({ panState, setPan, setPanState });

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
    const eventName = `nodes:create:${widgetId}`;
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
    try {
      const node = await requestJSON<NodeRecord>("/v1/nodes", {
        method: "POST",
        body: JSON.stringify({ company_id: companyID, title: value }),
      });
      // Hot-path rule: avoid full snapshot refetch on create.
      // Apply optimistic node insertion via NodeRelationshipGraph so all subscribers (Node Map + Explorer)
      // get immediate convergence without issuing a snapshot GET.
      upsertNodeRelationshipGraphNode(apiBase, companyID, node);
      if (activeFolderID) {
        const folderItem = await requestJSON<CompanyExplorerFolderItem>("/v1/company-explorer/folder-items", {
          method: "POST",
          body: JSON.stringify({ company_id: companyID, folder_id: activeFolderID, item_type: "node", item_id: node.node_id }),
        });
        // Folder placement is a separate API row so agents can move items headlessly.
        // Updating the graph cache here keeps filtered folder maps responsive.
        upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, folderItem);
      }
      setSelectedNodeID(node.node_id);
      setSelectedNodeIDs(new Set([node.node_id]));
      if (worldPos) {
        setNodePositions((previous) => ({
          ...previous,
          [node.node_id]: {
            x: clamp(snapToGrid(worldPos.x - NODE_W / 2), 0, WORLD_W - NODE_W),
            y: clamp(snapToGrid(worldPos.y - NODE_H / 2), 0, WORLD_H - NODE_H),
          },
        }));
      }
      return node;
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_node");
      return null;
    }
  };

  const createLinkedNode = async (sourceNodeID: string, direction: NodeDirection) => {
    const sourceNode = nodes.find((node) => node.node_id === sourceNodeID);
    if (!sourceNode) return;

    const node = await createNode("new node");
    if (!node) return;

    try {
      const payload = buildLinkedNodePayloadFromSourceSide(direction);
      const relationship = await requestJSON<NodeRelationship>("/v1/node-relationships", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          node_id_a: sourceNodeID,
          node_id_b: node.node_id,
          a_position: payload.a_position,
          b_position: payload.b_position,
        }),
      });

      const origin = nodePositions[sourceNodeID] ?? { x: 120, y: 120 };
      const linkedNodeClearance = MINI_GRID * 4;
      const horizontalGap = NODE_W + linkedNodeClearance;
      const verticalGap = NODE_H + linkedNodeClearance;
      const shift =
        direction === "left" ? { x: -horizontalGap, y: 0 }
          : direction === "right" ? { x: horizontalGap, y: 0 }
            : direction === "top" ? { x: 0, y: -verticalGap }
              : { x: 0, y: verticalGap };

      setNodePositions((previous) => ({
        ...previous,
        [node.node_id]: {
          x: clamp(snapToGrid(origin.x + shift.x), 0, WORLD_W - NODE_W),
          y: clamp(snapToGrid(origin.y + shift.y), 0, WORLD_H - NODE_H),
        },
      }));

      setRelationshipAnchors((previous) => ({
        ...previous,
        [relationship.node_relationship_id]: payload.anchor,
      }));

      loadGraphRelationshipsFromSnapshot([...nodes, node]);
      setSelectedNodeID(node.node_id);
      setSelectedNodeIDs(new Set([node.node_id]));
      setDetailsPanelNodeID(node.node_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_node_relationship");
    }
  };

  const updateNodeTitle = async (nodeID: string, nextTitle: string) => {
    const value = trimOrEmpty(nextTitle);
    if (!value) return;
    setError("");
    try {
      const updated = await requestJSON<NodeRecord>(`/v1/nodes/${nodeID}`, {
        method: "PUT",
        body: JSON.stringify({ company_id: companyID, title: value }),
      });
      // Latency rule: update in-memory graph cache directly so we avoid a snapshot re-fetch.
      upsertNodeRelationshipGraphNode(apiBase, companyID, updated);
      if (details?.node.node_id === nodeID) {
        setDetails((previous) => (previous ? { ...previous, node: updated } : previous));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_node");
    }
  };

  const commitRelationshipBetweenNodes = async (sourceNodeID: string, sourceSide: NodeDirection, targetNodeID: string, targetSide: NodeDirection) => {
    if (!sourceNodeID || !targetNodeID || sourceNodeID === targetNodeID) return;
    if (!isLegalRelationshipSidePair(sourceSide, targetSide)) {
      setError("illegal_relationship_pair");
      return;
    }
    const payload = buildExistingNodeRelationshipPayload(sourceSide, targetSide);
    const relationship = await requestJSON<NodeRelationship>("/v1/node-relationships", {
      method: "POST",
      body: JSON.stringify({
        company_id: companyID,
        node_id_a: sourceNodeID,
        node_id_b: targetNodeID,
        a_position: payload.a_position,
        b_position: payload.b_position,
      }),
    });
    setRelationshipAnchors((previous) => ({
      ...previous,
      [relationship.node_relationship_id]: payload.anchor,
    }));
    loadGraphRelationshipsFromSnapshot(nodes);
  };

  // Delete-node action with selection/context cleanup and snapshot refresh.
  const deleteNode = async (nodeID: string) => {
    if (!nodeID) return;
    setError("");
    try {
      await requestJSON<{ status: string }>(`/v1/nodes/${nodeID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      });
      removeNodeRelationshipGraphNode(apiBase, companyID, nodeID);
      setDetails((current) => (current?.node.node_id === nodeID ? null : current));
      if (detailsPanelNodeID === nodeID) setDetailsPanelNodeID("");
      setSelectedNodeIDs((previous) => {
        const next = new Set(previous);
        next.delete(nodeID);
        return next;
      });
      setSelectedNodeID((previous) => {
        if (previous !== nodeID) return previous;
        const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
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
      setError(err instanceof Error ? err.message : "failed_to_delete_node");
    }
  };

  const deleteNodes = async (nodeIDs: string[]) => {
    const unique = Array.from(new Set(nodeIDs.filter(Boolean)));
    if (unique.length === 0) return;
    setError("");
    try {
      await Promise.all(unique.map((nodeID) => requestJSON<{ status: string }>(`/v1/nodes/${nodeID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      })));
      for (const id of unique) removeNodeRelationshipGraphNode(apiBase, companyID, id);
      setDetails((current) => (current && unique.includes(current.node.node_id) ? null : current));
      if (detailsPanelNodeID && unique.includes(detailsPanelNodeID)) setDetailsPanelNodeID("");
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
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
      setError(err instanceof Error ? err.message : "failed_to_delete_node");
    }
  };

  const deleteRelationships = async (relationshipIDs: string[]) => {
    const unique = Array.from(new Set(relationshipIDs.filter(Boolean)));
    if (unique.length === 0) return;
    setError("");
    setStatusMessage(`Deleting ${unique.length} relationship line${unique.length === 1 ? "" : "s"}...`);
    try {
      const settled = await Promise.allSettled(unique.map((relationshipID) => requestJSON<{ status: string }>(`/v1/node-relationships/${relationshipID}?company_id=${encodeURIComponent(companyID)}`, {
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
        if (failure?.reason === "relationship_not_found" || failure?.reason.startsWith("request_failed_404")) {
          await refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
          const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
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


  const getAnchorPoint = (nodeID: string, side: NodeDirection) => {
    const pos = nodePositions[nodeID];
    if (!pos) return null;
    if (side === "left") return { x: pos.x, y: pos.y + NODE_H / 2 };
    if (side === "right") return { x: pos.x + NODE_W, y: pos.y + NODE_H / 2 };
    if (side === "top") return { x: pos.x + NODE_W / 2, y: pos.y };
    return { x: pos.x + NODE_W / 2, y: pos.y + NODE_H };
  };

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

  const relationshipRoutingGrid = useMemo(() => {
    const step = MINI_GRID;
    const cols = Math.floor(WORLD_W / step) + 1;
    const rows = Math.floor(WORLD_H / step) + 1;
    const blocked = new Uint8Array(cols * rows);
    const margin = step;

    for (const node of nodes) {
      const pos = nodePositions[node.node_id];
      if (!pos) continue;
      const minX = Math.max(0, Math.floor((pos.x - margin) / step));
      const maxX = Math.min(cols - 1, Math.ceil((pos.x + NODE_W + margin) / step));
      const minY = Math.max(0, Math.floor((pos.y - margin) / step));
      const maxY = Math.min(rows - 1, Math.ceil((pos.y + NODE_H + margin) / step));
      for (let gy = minY; gy <= maxY; gy += 1) {
        for (let gx = minX; gx <= maxX; gx += 1) {
          blocked[gy * cols + gx] = 1;
        }
      }
    }

    return { step, cols, rows, blocked };
  }, [WORLD_H, WORLD_W, nodes, nodePositions]);

  const routeOrthogonalPath = (
    from: { x: number; y: number },
    fromOut: { x: number; y: number },
    toIn: { x: number; y: number },
    to: { x: number; y: number },
    sourceNodeID: string,
    targetNodeID: string,
  ) => {
    const { step, cols, rows, blocked } = relationshipRoutingGrid;
    const toCell = (point: { x: number; y: number }) => ({
      gx: clamp(Math.round(point.x / step), 0, cols - 1),
      gy: clamp(Math.round(point.y / step), 0, rows - 1),
    });
    const toPoint = (gx: number, gy: number) => ({ x: gx * step, y: gy * step });
    const key = (gx: number, gy: number) => gy * cols + gx;
    const sourcePos = nodePositions[sourceNodeID];
    const targetPos = nodePositions[targetNodeID];

    const isBlocked = (gx: number, gy: number) => {
      const idx = key(gx, gy);
      if (!blocked[idx]) return false;
      const worldX = gx * step;
      const worldY = gy * step;
      const isInsideSource = sourcePos && worldX >= sourcePos.x - step && worldX <= sourcePos.x + NODE_W + step && worldY >= sourcePos.y - step && worldY <= sourcePos.y + NODE_H + step;
      if (isInsideSource) return false;
      const isInsideTarget = targetPos && worldX >= targetPos.x - step && worldX <= targetPos.x + NODE_W + step && worldY >= targetPos.y - step && worldY <= targetPos.y + NODE_H + step;
      if (isInsideTarget) return false;
      return true;
    };

    const start = toCell(fromOut);
    const goal = toCell(toIn);
    const startKey = key(start.gx, start.gy);
    const goalKey = key(goal.gx, goal.gy);
    const queue = [startKey];
    const cameFrom = new Int32Array(cols * rows).fill(-1);
    const visited = new Uint8Array(cols * rows);
    visited[startKey] = 1;
    let found = false;

    for (let pointer = 0; pointer < queue.length; pointer += 1) {
      const current = queue[pointer];
      if (current === goalKey) {
        found = true;
        break;
      }
      const gx = current % cols;
      const gy = Math.floor(current / cols);
      const neighbors = [
        { gx: gx + 1, gy },
        { gx: gx - 1, gy },
        { gx, gy: gy + 1 },
        { gx, gy: gy - 1 },
      ];
      for (const next of neighbors) {
        if (next.gx < 0 || next.gx >= cols || next.gy < 0 || next.gy >= rows) continue;
        const nextKey = key(next.gx, next.gy);
        if (visited[nextKey]) continue;
        if (isBlocked(next.gx, next.gy) && nextKey !== goalKey) continue;
        visited[nextKey] = 1;
        cameFrom[nextKey] = current;
        queue.push(nextKey);
      }
    }

    const fallback = [from, fromOut, { x: toIn.x, y: fromOut.y }, toIn, to];
    if (!found) return fallback.map((point) => ({ x: snapToGrid(point.x), y: snapToGrid(point.y) }));

    const cells: number[] = [];
    let current = goalKey;
    while (current !== -1) {
      cells.push(current);
      if (current === startKey) break;
      current = cameFrom[current];
    }
    cells.reverse();

    const routed = cells.map((cell) => toPoint(cell % cols, Math.floor(cell / cols)));
    const collapsed = [from, fromOut, ...routed, toIn, to].filter((point, index, list) => {
      if (index === 0) return true;
      const prev = list[index - 1];
      return prev.x !== point.x || prev.y !== point.y;
    });

    const simplified = [collapsed[0]];
    for (let i = 1; i < collapsed.length - 1; i += 1) {
      const prev = simplified[simplified.length - 1];
      const currentPoint = collapsed[i];
      const next = collapsed[i + 1];
      const sameLine = (prev.x === currentPoint.x && currentPoint.x === next.x) || (prev.y === currentPoint.y && currentPoint.y === next.y);
      if (!sameLine) simplified.push(currentPoint);
    }
    simplified.push(collapsed[collapsed.length - 1]);
    return simplified.map((point) => ({ x: snapToGrid(point.x), y: snapToGrid(point.y) }));
  };

  // Draft relationship routing uses the same orthogonal-grid obstacle strategy as committed lines.
  // This keeps the in-progress arrow preview faithful to final path wrapping behavior.
  const routeDraftPath = (
    from: { x: number; y: number },
    fromOut: { x: number; y: number },
    cursor: { x: number; y: number },
    sourceNodeID: string,
  ) => {
    const { step, cols, rows, blocked } = relationshipRoutingGrid;
    const toCell = (point: { x: number; y: number }) => ({
      gx: clamp(Math.round(point.x / step), 0, cols - 1),
      gy: clamp(Math.round(point.y / step), 0, rows - 1),
    });
    const toPoint = (gx: number, gy: number) => ({ x: gx * step, y: gy * step });
    const key = (gx: number, gy: number) => gy * cols + gx;
    const sourcePos = nodePositions[sourceNodeID];

    const isBlocked = (gx: number, gy: number) => {
      const idx = key(gx, gy);
      if (!blocked[idx]) return false;
      const worldX = gx * step;
      const worldY = gy * step;
      const isInsideSource = sourcePos && worldX >= sourcePos.x - step && worldX <= sourcePos.x + NODE_W + step && worldY >= sourcePos.y - step && worldY <= sourcePos.y + NODE_H + step;
      if (isInsideSource) return false;
      return true;
    };

    const start = toCell(fromOut);
    const goal = toCell(cursor);
    const startKey = key(start.gx, start.gy);
    const goalKey = key(goal.gx, goal.gy);
    const queue = [startKey];
    const cameFrom = new Int32Array(cols * rows).fill(-1);
    const visited = new Uint8Array(cols * rows);
    visited[startKey] = 1;
    let found = false;

    for (let pointer = 0; pointer < queue.length; pointer += 1) {
      const current = queue[pointer];
      if (current === goalKey) {
        found = true;
        break;
      }
      const gx = current % cols;
      const gy = Math.floor(current / cols);
      const neighbors = [
        { gx: gx + 1, gy },
        { gx: gx - 1, gy },
        { gx, gy: gy + 1 },
        { gx, gy: gy - 1 },
      ];
      for (const next of neighbors) {
        if (next.gx < 0 || next.gx >= cols || next.gy < 0 || next.gy >= rows) continue;
        const nextKey = key(next.gx, next.gy);
        if (visited[nextKey]) continue;
        if (isBlocked(next.gx, next.gy) && nextKey !== goalKey) continue;
        visited[nextKey] = 1;
        cameFrom[nextKey] = current;
        queue.push(nextKey);
      }
    }

    const snappedCursor = { x: snapToGrid(cursor.x), y: snapToGrid(cursor.y) };
    const fallback = [from, fromOut, { x: snappedCursor.x, y: fromOut.y }, snappedCursor];
    if (!found) return fallback;

    const cells: number[] = [];
    let current = goalKey;
    while (current !== -1) {
      cells.push(current);
      if (current === startKey) break;
      current = cameFrom[current];
    }
    cells.reverse();
    const routed = cells.map((cell) => toPoint(cell % cols, Math.floor(cell / cols)));
    const collapsed = [from, fromOut, ...routed, snappedCursor].filter((point, index, list) => {
      if (index === 0) return true;
      const prev = list[index - 1];
      return prev.x !== point.x || prev.y !== point.y;
    });

    const simplified = [collapsed[0]];
    for (let i = 1; i < collapsed.length - 1; i += 1) {
      const prev = simplified[simplified.length - 1];
      const currentPoint = collapsed[i];
      const next = collapsed[i + 1];
      const sameLine = (prev.x === currentPoint.x && currentPoint.x === next.x) || (prev.y === currentPoint.y && currentPoint.y === next.y);
      if (!sameLine) simplified.push(currentPoint);
    }
    simplified.push(collapsed[collapsed.length - 1]);
    return simplified.map((point) => ({ x: snapToGrid(point.x), y: snapToGrid(point.y) }));
  };

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
      const shouldShowRelationshipColors = relationshipColorsEnabled || selectedNodeIDs.size > 0;
      context.strokeStyle = shouldShowRelationshipColors ? path.stroke : accent;
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
  }, [WORLD_H, WORLD_W, accent, connectionPaths, relationshipColorsEnabled, draftPath, selectedNodeIDs]);

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

  return (
    <div style={{ fontSize: 11, height: "100%", color: panelText }}>
      <div
        ref={viewportRef}
        style={{
          position: "relative",
          overflow: "hidden",
          height: "100%",
          width: "100%",
          backgroundColor: "transparent",
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setCanvasActive(true);
          setNodeContextMenu(null);
          setRelationshipContextMenu(null);
          if (!viewportRef.current) return;
          const bounds = viewportRef.current.getBoundingClientRect();
          const localX = clamp(event.clientX - bounds.left, 0, bounds.width);
          const localY = clamp(event.clientY - bounds.top, 0, bounds.height);
          const worldX = clamp((localX - pan.x) / zoom, 0, WORLD_W);
          const worldY = clamp((localY - pan.y) / zoom, 0, WORLD_H);
          const menuWidth = 232;
          const menuHeight = 188;
          const clampedX = clamp(localX, 8, Math.max(8, bounds.width - menuWidth - 8));
          const clampedY = clamp(localY, 8, Math.max(8, bounds.height - menuHeight - 8));
          setContextMenu({ x: clampedX, y: clampedY, worldX, worldY });
        }}
        onWheel={(event) => {
          event.preventDefault();
          if (!viewportRef.current) return;
          const bounds = viewportRef.current.getBoundingClientRect();
          const cursorX = event.clientX - bounds.left;
          const cursorY = event.clientY - bounds.top;
          const worldX = (cursorX - pan.x) / zoom;
          const worldY = (cursorY - pan.y) / zoom;
          const delta = event.deltaY < 0 ? 1.1 : 0.9;
          const nextZoom = clamp(zoom * delta, 0.45, 2.7);
          setZoom(nextZoom);
          setPan({ x: cursorX - worldX * nextZoom, y: cursorY - worldY * nextZoom });
        }}
        onPointerDown={(event) => {
          if (!viewportRef.current) return;
          setCanvasActive(true);
          setContextMenu(null);
          setNodeContextMenu(null);
          setRelationshipContextMenu(null);
          setSelectedRelationshipIDs(new Set());
          const bounds = viewportRef.current.getBoundingClientRect();
          const localX = clamp(event.clientX - bounds.left, 0, bounds.width);
          const localY = clamp(event.clientY - bounds.top, 0, bounds.height);

          if (event.ctrlKey || event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            startNodeMapMultiSelect(event.pointerId, event.clientX, event.clientY, true);
            return;
          }

          if (relationshipDraft) setRelationshipDraft(null);
          setPanState({
            pointerID: event.pointerId,
            startMouseX: event.clientX,
            startMouseY: event.clientY,
            startPanX: pan.x,
            startPanY: pan.y,
          });
        }}
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
          }}
        >
          <canvas
            ref={relationshipCanvasRef}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}
          />
          <svg
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "auto", zIndex: 2 }}
            viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
          >
            {connectionPaths.map((path) => (
              <polyline
                key={path.id}
                points={path.points.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                style={{ cursor: "pointer" }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setCanvasActive(true);
                  setRelationshipContextMenu(null);
                  if (event.ctrlKey || event.shiftKey) {
                    event.preventDefault();
                    suppressNextRelationshipLineClickRef.current = true;
                    startNodeMapMultiSelect(event.pointerId, event.clientX, event.clientY, true);
                  }
                }}
                onClick={(event) => {
                  if (suppressNextRelationshipLineClickRef.current) {
                    suppressNextRelationshipLineClickRef.current = false;
                    return;
                  }
                  event.stopPropagation();
                  setRelationshipDraft(null);
                  setRelationshipContextMenu(null);
                  setError("");
                  if (event.shiftKey || event.ctrlKey) {
                    setSelectedRelationshipIDs((previous) => {
                      const next = new Set(previous);
                      if (next.has(path.id)) next.delete(path.id);
                      else next.add(path.id);
                      return next;
                    });
                    return;
                  }
                  setSelectedNodeIDs(new Set());
                  setSelectedNodeID("");
                  setSelectedRelationshipIDs(new Set([path.id]));
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setRelationshipDraft(null);
                  setRelationshipContextMenu(null);
                  void deleteRelationships([path.id]);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!viewportRef.current) return;
                  const bounds = viewportRef.current.getBoundingClientRect();
                  const localX = clamp(event.clientX - bounds.left, 0, bounds.width);
                  const localY = clamp(event.clientY - bounds.top, 0, bounds.height);
                  const menuWidth = 188;
                  const menuHeight = 56;
                  const clampedX = clamp(localX, 8, Math.max(8, bounds.width - menuWidth - 8));
                  const clampedY = clamp(localY, 8, Math.max(8, bounds.height - menuHeight - 8));
                  setCanvasActive(true);
                  setRelationshipDraft(null);
                  setContextMenu(null);
                  setNodeContextMenu(null);
                  setSelectedNodeIDs(new Set());
                  setSelectedNodeID("");
                  setSelectedRelationshipIDs((previous) => {
                    if (previous.has(path.id)) return previous;
                    return new Set([path.id]);
                  });
                  setRelationshipContextMenu({ x: clampedX, y: clampedY, relationshipID: path.id });
                }}
              />
            ))}
          </svg>

          {visibleNodes.map((node) => {
            const position = nodePositions[node.node_id] ?? { x: 120, y: 120 };
            const size = nodeSizes[node.node_id] ?? { w: NODE_W, h: NODE_H };
            const isSelected = selectedNodeIDs.has(node.node_id);
            const isPrimary = node.node_id === selectedNodeID;

            return (
              <div
                key={node.node_id}
                data-node-card="true"
                style={{
                  position: "absolute",
                  left: position.x,
                  top: position.y,
                  width: size.w,
                  height: size.h,
                  borderRadius: 8,
                  border: `1px solid ${isSelected ? SELECTION_CYAN : nodeCardBorder}`,
                  background: isSelected ? nodeCardSelectedBackground : nodeCardBackground,
                  outline: isSelected ? `2px solid ${SELECTION_CYAN}` : "none",
                  outlineOffset: isSelected ? 1 : 0,
                  display: "grid",
                  gridTemplateRows: "1fr",
                  boxShadow: isSelected ? "0 0 0 3px rgba(0,233,255,0.35), 0 8px 20px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.12)",
                  userSelect: "none",
                  color: nodeCardText,
                  cursor: editingNodeTitleNodeID === node.node_id ? "text" : (dragState?.nodeIDs.includes(node.node_id) ? "grabbing" : "grab"),
                  zIndex: isPrimary ? 5 : 4,
                  overflow: "visible",
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  // legacy details popup removed
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setCanvasActive(true);
                  setSelectedRelationshipIDs(new Set());
                  setRelationshipContextMenu(null);
                  const bounds = viewportRef.current?.getBoundingClientRect();
                  if (!bounds) return;
                  const nextIDs = selectedNodeIDs.has(node.node_id) ? Array.from(selectedNodeIDs) : [node.node_id];
                  setSelectedNodeID(node.node_id);
                  setSelectedNodeIDs(new Set(nextIDs));
                  setContextMenu(null);
                  setNodeContextMenu({
                    x: clamp(event.clientX - bounds.left, 0, bounds.width),
                    y: clamp(event.clientY - bounds.top, 0, bounds.height),
                    nodeID: node.node_id,
                  });
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (event.ctrlKey || event.shiftKey) {
                    event.preventDefault();
                    const next = new Set(selectedNodeIDs);
                    if (next.has(node.node_id)) next.delete(node.node_id);
                    else next.add(node.node_id);
                    setSelectedNodeIDs(next);
                    setSelectedNodeID(next.has(node.node_id) ? node.node_id : (Array.from(next)[0] ?? ""));
                    return;
                  }
                  setContextMenu(null);
                  setNodeContextMenu(null);
                  setRelationshipContextMenu(null);
                  setSelectedRelationshipIDs(new Set());
                  const bounds = (event.currentTarget as HTMLDivElement).getBoundingClientRect();

                  const nextIDs = selectedNodeIDs.has(node.node_id) ? Array.from(selectedNodeIDs) : [node.node_id];
                  setSelectedNodeID(node.node_id);
                  setSelectedNodeIDs(new Set(nextIDs));

                  const offsets: Record<string, { x: number; y: number }> = {};
                  for (const id of nextIDs) {
                    const pos = nodePositions[id] ?? { x: 0, y: 0 };
                    const pointerWorldX = (event.clientX - bounds.left) / zoom + position.x;
                    const pointerWorldY = (event.clientY - bounds.top) / zoom + position.y;
                    offsets[id] = { x: pointerWorldX - pos.x, y: pointerWorldY - pos.y };
                  }
                  setDragState({ nodeIDs: nextIDs, pointerID: event.pointerId, offsets });
                }}
              >
                <div
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: "100%",
                    height: "100%",
                    textAlign: "center",
                    padding: "10px",
                  }}
                >
                  {/* Latency-obsession alignment: keep node-card render minimal.
                      We only render the title so no extra metadata fetch/render churn appears on the hot canvas path. */}
                  {editingNodeTitleNodeID === node.node_id ? (
                    <div
                      ref={editingNodeTitleElementRef}
                      contentEditable
                      suppressContentEditableWarning
                      onPointerDown={(event) => event.stopPropagation()}
                      onInput={(event) => {
                        editingNodeTitleDraftRef.current = event.currentTarget.textContent ?? "";
                      }}
                      onBlur={() => {
                        void updateNodeTitle(node.node_id, editingNodeTitleDraftRef.current);
                        setEditingNodeTitleNodeID(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void updateNodeTitle(node.node_id, editingNodeTitleDraftRef.current);
                          setEditingNodeTitleNodeID(null);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          if (editingNodeTitleElementRef.current) editingNodeTitleElementRef.current.textContent = getNodeTitle(node);
                          setEditingNodeTitleNodeID(null);
                        }
                      }}
                      /*
                        Gold-standard inline edit behavior: keep exact read-mode typography and box
                        metrics so only the caret appears when entering title edit mode.
                      */
                      style={{
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        overflow: "hidden",
                        width: "100%",
                        maxWidth: "100%",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        cursor: "text",
                        textAlign: "center",
                        fontSize: 18,
                        fontWeight: 800,
                        lineHeight: 1.15,
                        letterSpacing: "0.03em",
                        fontFamily: "'IBM Plex Mono', monospace",
                        outline: "none",
                      }}
                    >
                      {getNodeTitle(node)}
                    </div>
                  ) : (
                    <div
                      style={{
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        overflow: "hidden",
                        maxWidth: "100%",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        fontSize: 18,
                        fontWeight: 800,
                        lineHeight: 1.15,
                        letterSpacing: "0.03em",
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}
                    >
                      {getNodeTitle(node)}
                    </div>
                  )}
                </div>
                {isSelected && (
                  <div style={{ position: "absolute", top: 6, right: 6, width: 12, height: 12, borderRadius: 999, background: SELECTION_CYAN, opacity: 0.92 }} />
                )}

                {([
                  ["left", { left: -12, top: "50%", transform: "translate(-50%, -50%)", flexDirection: "column" }],
                  ["right", { right: -12, top: "50%", transform: "translate(50%, -50%)", flexDirection: "column" }],
                  ["top", { top: -12, left: "50%", transform: "translate(-50%, -50%)", flexDirection: "row" }],
                  ["bottom", { bottom: -12, left: "50%", transform: "translate(-50%, 50%)", flexDirection: "row" }],
                ] as const).map(([direction, sideStyle]) => {
                  const isDrafting = !!relationshipDraft;
                  const isSource = relationshipDraft?.sourceNodeID === node.node_id && relationshipDraft.sourceSide === direction;
                  return (
                    <div
                      key={direction}
                      style={{
                        position: "absolute",
                        ...sideStyle,
                        display: isPrimary || isDrafting ? "flex" : "none",
                        gap: 4,
                      }}
                    >
                      <button
                        title={`Create ${direction} node`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setError("");
                          setRelationshipDraft(null);
                          void createLinkedNode(node.node_id, direction);
                        }}
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 4,
                          border: `1px solid ${accent}`,
                          background: panelSurface,
                          color: accent,
                          display: isDrafting ? "none" : "grid",
                          placeItems: "center",
                          fontSize: 14,
                          lineHeight: 1,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        +
                      </button>
                      <button
                        title={isDrafting ? `Attach relationship on ${direction}` : `Create relationship from ${direction}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setError("");
                          if (relationshipDraft) {
                            if (relationshipDraft.sourceNodeID === node.node_id) return;
                            if (!isLegalRelationshipSidePair(relationshipDraft.sourceSide, direction)) {
                              setError("illegal_relationship_pair");
                              return;
                            }
                            void commitRelationshipBetweenNodes(relationshipDraft.sourceNodeID, relationshipDraft.sourceSide, node.node_id, direction);
                            setRelationshipDraft(null);
                            return;
                          }
                          const start = getAnchorPoint(node.node_id, direction);
                          if (!start) return;
                          setSelectedRelationshipIDs(new Set());
                          setRelationshipDraft({ sourceNodeID: node.node_id, sourceSide: direction, cursor: start });
                        }}
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 4,
                          border: `1px solid ${accent}`,
                          background: isSource ? accent : panelSurface,
                          color: isSource ? "#ffffff" : accent,
                          display: "grid",
                          placeItems: "center",
                          cursor: relationshipDraft?.sourceNodeID === node.node_id || (relationshipDraft && !isLegalRelationshipSidePair(relationshipDraft.sourceSide, direction)) ? "not-allowed" : "pointer",
                          opacity: relationshipDraft && !isLegalRelationshipSidePair(relationshipDraft.sourceSide, direction) ? 0.35 : 1,
                          padding: 0,
                        }}
                      >
                        {isDrafting ? (
                          <svg aria-hidden="true" width="12" height="13" viewBox="0 0 17 19" style={{ display: "block" }}>
                            <polygon points="8.5,1.5 15.5,5.5 15.5,13.5 8.5,17.5 1.5,13.5 1.5,5.5" fill="none" stroke={isSource ? "#ffffff" : accent} strokeWidth="1.8" />
                          </svg>
                        ) : (direction === "top" ? "↑" : direction === "right" ? "→" : direction === "bottom" ? "↓" : "←")}
                      </button>
                    </div>
                  );
                })}
                {[
                  { key: "tl", edges: { left: true, top: true }, cursor: "nwse-resize", style: { left: -6, top: -6, width: 12, height: 12 } },
                  { key: "tr", edges: { right: true, top: true }, cursor: "nesw-resize", style: { right: -6, top: -6, width: 12, height: 12 } },
                  { key: "bl", edges: { left: true, bottom: true }, cursor: "nesw-resize", style: { left: -6, bottom: -6, width: 12, height: 12 } },
                  { key: "br", edges: { right: true, bottom: true }, cursor: "nwse-resize", style: { right: -6, bottom: -6, width: 12, height: 12 } },
                  { key: "l", edges: { left: true }, cursor: "ew-resize", style: { left: -4, top: 12, bottom: 12, width: 8 } },
                  { key: "r", edges: { right: true }, cursor: "ew-resize", style: { right: -4, top: 12, bottom: 12, width: 8 } },
                  { key: "t", edges: { top: true }, cursor: "ns-resize", style: { top: -4, left: 12, right: 12, height: 8 } },
                  { key: "b", edges: { bottom: true }, cursor: "ns-resize", style: { bottom: -4, left: 12, right: 12, height: 8 } },
                ].map((handle) => (
                  <div
                    key={handle.key}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDragState(null);
                      setNodeResizeState({
                        nodeID: node.node_id,
                        pointerID: event.pointerId,
                        startMouseX: event.clientX,
                        startMouseY: event.clientY,
                        startX: position.x,
                        startY: position.y,
                        startW: size.w,
                        startH: size.h,
                        edges: handle.edges,
                      });
                    }}
                    style={{ position: "absolute", ...handle.style, cursor: handle.cursor, zIndex: 9 }}
                  />
                ))}
              </div>
            );
          })}
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

        {contextMenu && (
          <div
            style={{
              position: "absolute",
              left: contextMenu.x,
              top: contextMenu.y,
              background: panelSurface,
              border: `1px solid ${accent}`,
              borderRadius: 8,
              padding: 8,
              width: 232,
              boxSizing: "border-box",
              display: "grid",
              gap: 0,
              zIndex: 40,
              boxShadow: "0 8px 22px rgba(0,0,0,0.16)",
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              style={{
                width: "100%",
                border: "1px solid rgba(0,0,0,0.16)",
                background: panelSubtleSurface,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                padding: "7px 8px",
                textAlign: "left",
                color: panelText,
                borderRadius: 0,
              }}
              onClick={() => {
                const title = trimOrEmpty(newNodeTitle) || "new node";
                void createNode(title, { x: contextMenu.worldX, y: contextMenu.worldY });
                if (!trimOrEmpty(newNodeTitle)) setNewNodeTitle("");
                setContextMenu(null);
              }}
            >
              Create new node
            </button>
            <button
              style={{
                width: "100%",
                border: "1px solid rgba(0,0,0,0.16)",
                background: panelSubtleSurface,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                padding: "7px 8px",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                color: panelText,
                borderRadius: 0,
              }}
              onClick={() => setRelationshipColorsEnabled((previous) => !previous)}
            >
              <span>Enable relationship colors</span>
              <span
                aria-hidden="true"
                style={{
                  width: 28,
                  height: 18,
                  borderRadius: 999,
                  background: relationshipColorsEnabled ? "#34c759" : "#b7c0c7",
                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: relationshipColorsEnabled ? "flex-end" : "flex-start",
                  padding: 2,
                  boxSizing: "border-box",
                  flexShrink: 0,
                  transition: "background 120ms ease",
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: panelSurface,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
                  }}
                />
              </span>
            </button>
            <div
              style={{
                display: "grid",
                marginLeft: 16,
                gap: 0,
                opacity: relationshipColorsEnabled ? 1 : 0.68,
              }}
            >
              {([
                ["Parent", "parent"],
                ["Peer", "peer"],
                ["Child", "child"],
              ] as const).map(([label, key], index) => (
                <label
                  key={key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    alignItems: "center",
                    columnGap: 8,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "6px 8px",
                    border: "1px solid rgba(0,0,0,0.16)",
                    borderTop: index === 0 ? "1px solid rgba(0,0,0,0.16)" : "0",
                    borderRadius: 0,
                    background: panelSubtleSurface,
                  }}
                >
                  <span>{label}</span>
                  <input
                    type="color"
                    value={relationshipRoleColors[key]}
                    onChange={(event) => setRelationshipRoleColors((previous) => ({ ...previous, [key]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {nodeContextMenu && (
          <div
            style={{
              position: "absolute",
              left: nodeContextMenu.x,
              top: nodeContextMenu.y,
              transform: "translate(8px, 8px)",
              background: panelSurface,
              border: `1px solid ${accent}`,
              borderRadius: 8,
              padding: 4,
              zIndex: 41,
              boxShadow: "0 8px 22px rgba(0,0,0,0.16)",
              display: "grid",
              gap: 2,
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button style={contextMenuButtonStyle} onClick={() => {
              const current = nodes.find((node) => node.node_id === nodeContextMenu.nodeID);
              editingNodeTitleDraftRef.current = current ? getNodeTitle(current) : "new node";
              setEditingNodeTitleNodeID(nodeContextMenu.nodeID);
              setNodeContextMenu(null);
            }}>
              Rename node
            </button>
            <button style={contextMenuDangerButtonStyle} onClick={() => { const ids = selectedNodeIDs.size > 0 ? Array.from(selectedNodeIDs) : [nodeContextMenu.nodeID]; setConfirmDelete({ nodeIDs: ids, relationshipIDs: [] }); setNodeContextMenu(null); }}>
              Delete node
            </button>
          </div>
        )}

        {relationshipContextMenu && (
          <div
            style={{
              position: "absolute",
              left: relationshipContextMenu.x,
              top: relationshipContextMenu.y,
              transform: "translate(8px, 8px)",
              background: panelSurface,
              border: `1px solid ${accent}`,
              borderRadius: 8,
              padding: 4,
              zIndex: 41,
              boxShadow: "0 8px 22px rgba(0,0,0,0.16)",
              display: "grid",
              gap: 2,
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              style={contextMenuDangerButtonStyle}
              onClick={() => {
                const relationshipIDs = selectedRelationshipIDs.has(relationshipContextMenu.relationshipID)
                  ? Array.from(selectedRelationshipIDs)
                  : [relationshipContextMenu.relationshipID];
                void deleteRelationships(relationshipIDs);
                setRelationshipContextMenu(null);
              }}
            >
              Delete relationship{selectedRelationshipIDs.size > 1 ? "s" : ""}
            </button>
          </div>
        )}



        {selectedNodeIDs.size > 1 && !selectionBox.active && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              zIndex: 30,
              background: "rgba(0,0,0,0.75)",
              color: "#fff",
              padding: "4px 8px",
              borderRadius: 6,
              fontSize: 10,
            }}
          >
            Group selected: {selectedNodeIDs.size}
          </div>
        )}

        {(statusMessage || error) && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 31,
              maxWidth: 420,
              borderRadius: 8,
              padding: "6px 8px",
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              background: error ? "rgba(178, 0, 32, 0.9)" : "rgba(0, 0, 0, 0.78)",
              color: "#ffffff",
              boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
            }}
          >
            {error ? `Error: ${error}` : statusMessage}
          </div>
        )}

        {confirmDelete && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center" }}>
            <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(0,233,255,0.45)", background: panelSurface, color: panelText, padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                Are you sure you want to delete {confirmDelete.nodeIDs.length} node{confirmDelete.nodeIDs.length === 1 ? "" : "s"}
                {confirmDelete.relationshipIDs.length > 0 ? ` and ${confirmDelete.relationshipIDs.length} relationship line${confirmDelete.relationshipIDs.length === 1 ? "" : "s"}` : ""}?
              </div>
              <div style={{ fontSize: 11, lineHeight: 1.35, color: panelMutedText }}>
                This removes the selected node data immediately. Use Undo (Ctrl/Cmd + Z) if this was accidental.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button onClick={() => {
                  if (confirmDelete.relationshipIDs.length > 0) void deleteRelationships(confirmDelete.relationshipIDs);
                  if (confirmDelete.nodeIDs.length > 0) void deleteNodes(confirmDelete.nodeIDs);
                  setConfirmDelete(null);
                }} style={{ border: "1px solid rgba(0,233,255,0.45)", background: dialogButtonBackground, color: dialogPrimaryButtonText, cursor: "pointer", fontWeight: 700 }}>Yes</button>
                <button onClick={() => setConfirmDelete(null)} style={{ border: "1px solid #ff3d7f", boxShadow: "inset 0 0 0 1px rgba(255,130,170,0.25), 0 0 10px rgba(255,61,127,0.18)", color: dialogCancelButtonText, background: dialogButtonBackground, cursor: "pointer", fontWeight: 700 }}>No</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
