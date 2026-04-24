import React, { useEffect, useMemo, useRef, useState } from "react";
import { INFO_TYPES, MINI_GRID, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, NODE_H, NODE_W, PANEL_MIN_HEIGHT, PANEL_MIN_WIDTH, panelResizeHandles, PanelEdge, NodeMapState, NodeDetails, NodeDirection, NodeInformation, NodePosition, NodeRecord, NodeRelationship, RelationshipAnchor, SESSION_NODE_MAP_STATE, clamp, divider, snapToGrid, trimOrEmpty } from "./shared";
import { emitDashboardEvent, EVENT_EXPLORER_CONTEXT_UPDATED, EVENT_NODE_MAP_STATE_UPDATED } from "./eventbus";
import { getWorkspaceSnapshot, refreshWorkspaceSnapshot, subscribeWorkspace } from "./workspaceStore";
import { buildExistingNodeRelationshipPayload, buildLinkedNodePayloadFromSourceSide, projectRelationshipVisual } from "./relationshipProjection";

export const NodesContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean }> = ({ accent, widgetId, hideTopControls: _hideTopControls }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const mapScope = widgetId?.trim() ? widgetId : "global";
  const mapStateKey = `node-map-state-v1:${companyID}:${mapScope}`;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const relationshipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 560 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panInitialized, setPanInitialized] = useState(false);
  const [restoredViewport, setRestoredViewport] = useState(false);

  const WORLD_W = 3200;
  const WORLD_H = 2200;

  const [nodePositions, setNodePositions] = useState<Record<string, NodePosition>>({});
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [relationships, setRelationships] = useState<NodeRelationship[]>([]);
  const [relationshipAnchors, setRelationshipAnchors] = useState<Record<string, RelationshipAnchor>>({});
  const [selectedNodeID, setSelectedNodeID] = useState<string>("");
  const [selectedNodeIDs, setSelectedNodeIDs] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<NodeDetails | null>(null);
  const [newNodeHeader, setNewNodeHeader] = useState("");
  const [infoType, setInfoType] = useState<(typeof INFO_TYPES)[number]>("Text box");
  const [infoDraft, setInfoDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailsPanelNodeID, setDetailsPanelNodeID] = useState<string>("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<{ x: number; y: number; nodeID: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ nodeIDs: string[] } | null>(null);
  const [canvasActive, setCanvasActive] = useState(false);
  const [panelRect, setPanelRect] = useState({ x: 0, y: 10, width: 340, height: 360 });
  const [panelDrag, setPanelDrag] = useState<{ pointerID: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [panelResize, setPanelResize] = useState<{
    pointerID: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
    edges: Partial<Record<PanelEdge, true>>;
  } | null>(null);

  const [dragState, setDragState] = useState<{ nodeIDs: string[]; pointerID: number; offsets: Record<string, { x: number; y: number }> } | null>(null);
  const [panState, setPanState] = useState<{ pointerID: number; startMouseX: number; startMouseY: number; startPanX: number; startPanY: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number; active: boolean }>({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    active: false,
  });
  const [selectionPointerID, setSelectionPointerID] = useState<number | null>(null);
  const restoredSelectionRef = useRef<string>("");
  const explorerContextRef = useRef<number>(0);
  const [relationshipColorsEnabled, setRelationshipColorsEnabled] = useState(false);
  const [relationshipRoleColors, setRelationshipRoleColors] = useState({ parent: "#ff8a00", peer: "#0095ff", child: "#6f5cff" });
  const [relationshipDraft, setRelationshipDraft] = useState<{ sourceNodeID: string; sourceSide: NodeDirection; cursor: { x: number; y: number } } | null>(null);
  const [selectedRelationshipIDs, setSelectedRelationshipIDs] = useState<Set<string>>(new Set());

  useEffect(() => {
    const cached = SESSION_NODE_MAP_STATE.get(mapStateKey);
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
      const raw = localStorage.getItem(mapStateKey);
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
  }, [mapStateKey]);

  const requestJSON = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      let reason = `request_failed_${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.error) reason = payload.error;
      } catch {
        // no-op
      }
      throw new Error(reason);
    }

    if (response.status === 204) {
      return {} as T;
    }
    return response.json() as Promise<T>;
  };

  const loadNodes = async () => {
    setLoading(true);
    setError("");
    try {
      await refreshWorkspaceSnapshot(apiBase, companyID);
      const nextNodes = getWorkspaceSnapshot(apiBase, companyID).nodes ?? [];
      setNodes(nextNodes);

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

  const loadGraphRelationships = async (graphNodes: NodeRecord[]) => {
    if (graphNodes.length === 0) {
      setRelationships([]);
      return;
    }
    try {
      await refreshWorkspaceSnapshot(apiBase, companyID);
      const payload = getWorkspaceSnapshot(apiBase, companyID);
      const allowed = new Set(graphNodes.map((node) => node.node_id));
      setRelationships((payload.relationships ?? []).filter((relationship) => allowed.has(relationship.node_id_a) && allowed.has(relationship.node_id_b)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_load_relationships");
    }
  };

  const loadDetails = async (nodeID: string) => {
    if (!nodeID) {
      setDetails(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await requestJSON<NodeDetails>(`/v1/nodes/${nodeID}?company_id=${encodeURIComponent(companyID)}`);
      setDetails(payload);
    } catch (err) {
      setDetails(null);
      setError(err instanceof Error ? err.message : "failed_to_load_node");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNodes();
  }, []);

  useEffect(() => {
    return subscribeWorkspace(apiBase, companyID, () => {
      const snapshot = getWorkspaceSnapshot(apiBase, companyID);
      setNodes(snapshot.nodes ?? []);
      const allowed = new Set((snapshot.nodes ?? []).map((node) => node.node_id));
      setRelationships((snapshot.relationships ?? []).filter((relationship) => allowed.has(relationship.node_id_a) && allowed.has(relationship.node_id_b)));
    });
  }, [apiBase, companyID]);

  useEffect(() => {
    void loadGraphRelationships(nodes);
  }, [nodes]);

  useEffect(() => {
    setSelectedRelationshipIDs((previous) => {
      if (previous.size === 0) return previous;
      const available = new Set(relationships.map((relationship) => relationship.node_relationship_id));
      const next = new Set(Array.from(previous).filter((id) => available.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [relationships]);

  useEffect(() => {
    if (!relationshipDraft) return;
    if (nodes.some((node) => node.node_id === relationshipDraft.sourceNodeID)) return;
    setRelationshipDraft(null);
  }, [nodes, relationshipDraft]);

  useEffect(() => {
    void loadDetails(selectedNodeID);
  }, [selectedNodeID]);

  useEffect(() => {
    if (!detailsPanelNodeID) return;
    void loadDetails(detailsPanelNodeID);
  }, [detailsPanelNodeID]);

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
    try {
      const nextState: NodeMapState = {
        zoom,
        pan,
        selectedNodeID,
        nodePositions,
        relationshipColorsEnabled,
        relationshipRoleColors,
      };
      SESSION_NODE_MAP_STATE.set(mapStateKey, nextState);
      localStorage.setItem(mapStateKey, JSON.stringify(nextState));
      emitDashboardEvent(EVENT_NODE_MAP_STATE_UPDATED, { mapWidgetID: mapScope, selectedNodeID });
    } catch {
      // ignore local storage quota/security errors
    }
  }, [mapScope, mapStateKey, restoredViewport, zoom, pan, selectedNodeID, nodePositions, relationshipColorsEnabled, relationshipRoleColors]);

  useEffect(() => {
    setNodePositions((previous) => {
      if (nodes.length === 0) return previous;
      const next: Record<string, NodePosition> = {};
      for (const [index, node] of nodes.entries()) {
        const existing = previous[node.node_id];
        if (existing) {
          next[node.node_id] = {
            x: clamp(snapToGrid(existing.x), 0, WORLD_W - NODE_W),
            y: clamp(snapToGrid(existing.y), 0, WORLD_H - NODE_H),
          };
          continue;
        }
        const perRow = Math.max(1, Math.floor(canvasSize.width / (NODE_W + 40)));
        const x = snapToGrid((index % perRow) * (NODE_W + 26) + 100);
        const y = snapToGrid(Math.floor(index / perRow) * (NODE_H + 26) + 120);
        next[node.node_id] = { x: clamp(x, 0, WORLD_W - NODE_W), y: clamp(y, 0, WORLD_H - NODE_H) };
      }
      return next;
    });
  }, [nodes, canvasSize.width]);

  useEffect(() => {
    if (!dragState) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerID || !viewportRef.current) return;
      const bounds = viewportRef.current.getBoundingClientRect();
      const mouseX = event.clientX - bounds.left;
      const mouseY = event.clientY - bounds.top;
      setNodePositions((previous) => {
        const next = { ...previous };
        for (const nodeID of dragState.nodeIDs) {
          const offset = dragState.offsets[nodeID];
          if (!offset) continue;
          const worldX = (mouseX - pan.x) / zoom - offset.x;
          const worldY = (mouseY - pan.y) / zoom - offset.y;
          next[nodeID] = {
            x: clamp(snapToGrid(worldX), 0, WORLD_W - NODE_W),
            y: clamp(snapToGrid(worldY), 0, WORLD_H - NODE_H),
          };
        }
        return next;
      });
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId === dragState.pointerID) setDragState(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragState, pan.x, pan.y, zoom]);

  useEffect(() => {
    const explorerKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${mapScope}`;
    const applyExplorerContext = () => {
      try {
        const raw = localStorage.getItem(explorerKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { selectedNodeID?: string; ts?: number };
        if (typeof parsed.ts !== "number" || parsed.ts <= explorerContextRef.current) return;
        explorerContextRef.current = parsed.ts;
        if (!parsed.selectedNodeID) return;
        const exists = nodes.some((node) => node.node_id === parsed.selectedNodeID);
        if (!exists) return;
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
  }, [companyID, mapScope, nodes]);

  useEffect(() => {
    if (!panState) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== panState.pointerID) return;
      const dx = event.clientX - panState.startMouseX;
      const dy = event.clientY - panState.startMouseY;
      setPan({ x: panState.startPanX + dx, y: panState.startPanY + dy });
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId === panState.pointerID) setPanState(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [panState]);

  useEffect(() => {
    if (selectionPointerID === null || !selectionBox.active) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== selectionPointerID) return;
      if (!viewportRef.current) return;
      const bounds = viewportRef.current.getBoundingClientRect();
      setSelectionBox((previous) => ({
        ...previous,
        currentX: clamp(event.clientX - bounds.left, 0, bounds.width),
        currentY: clamp(event.clientY - bounds.top, 0, bounds.height),
      }));
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== selectionPointerID || !viewportRef.current) return;
      const minX = Math.min(selectionBox.startX, selectionBox.currentX);
      const maxX = Math.max(selectionBox.startX, selectionBox.currentX);
      const minY = Math.min(selectionBox.startY, selectionBox.currentY);
      const maxY = Math.max(selectionBox.startY, selectionBox.currentY);

      const selected = nodes.filter((node) => {
        const pos = nodePositions[node.node_id];
        if (!pos) return false;
        const left = pos.x * zoom + pan.x;
        const top = pos.y * zoom + pan.y;
        const right = left + NODE_W * zoom;
        const bottom = top + NODE_H * zoom;
        return right >= minX && left <= maxX && bottom >= minY && top <= maxY;
      });

      const nextSet = new Set(selected.map((item) => item.node_id));
      setSelectedNodeIDs(nextSet);
      if (selected.length > 0) setSelectedNodeID(selected[0].node_id);
      setSelectionPointerID(null);
      setSelectionBox((previous) => ({ ...previous, active: false }));
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [selectionPointerID, selectionBox, nodes, nodePositions, zoom, pan.x, pan.y]);

  useEffect(() => {
    const onWindowPointerDown = () => {
      setContextMenu(null);
      setNodeContextMenu(null);
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

  useEffect(() => {
    if (!relationshipDraft) return;
    const onMove = (event: PointerEvent) => {
      if (!viewportRef.current) return;
      const bounds = viewportRef.current.getBoundingClientRect();
      const localX = clamp(event.clientX - bounds.left, 0, bounds.width);
      const localY = clamp(event.clientY - bounds.top, 0, bounds.height);
      const worldX = clamp((localX - pan.x) / zoom, 0, WORLD_W);
      const worldY = clamp((localY - pan.y) / zoom, 0, WORLD_H);
      setRelationshipDraft((previous) => (previous ? { ...previous, cursor: { x: worldX, y: worldY } } : previous));
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [relationshipDraft, pan.x, pan.y, zoom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setRelationshipDraft(null);
      setSelectedRelationshipIDs(new Set());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!widgetId) return;
    const eventName = `nodes:create:${widgetId}`;
    const onCreate = (event: Event) => {
      const custom = event as CustomEvent<{ header?: string }>;
      const header = trimOrEmpty(custom.detail?.header ?? "");
      if (!header) return;
      void createNode(header);
    };
    window.addEventListener(eventName, onCreate as EventListener);
    return () => window.removeEventListener(eventName, onCreate as EventListener);
  }, [widgetId]);

  const createNode = async (header: string, worldPos?: { x: number; y: number }): Promise<NodeRecord | null> => {
    const value = trimOrEmpty(header);
    if (!value) return null;
    setError("");
    try {
      const node = await requestJSON<NodeRecord>("/v1/nodes", {
        method: "POST",
        body: JSON.stringify({ company_id: companyID, header: value }),
      });
      await loadNodes();
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

    const node = await createNode(`${sourceNode.header} ${direction}`);
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
      const gap = 170;
      const shift =
        direction === "left" ? { x: -gap, y: 0 }
          : direction === "right" ? { x: gap, y: 0 }
            : direction === "top" ? { x: 0, y: -130 }
              : { x: 0, y: 130 };

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

      await loadDetails(sourceNodeID);
      await loadGraphRelationships([...nodes, node]);
      setSelectedNodeID(node.node_id);
      setSelectedNodeIDs(new Set([node.node_id]));
      setDetailsPanelNodeID(node.node_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_node_relationship");
    }
  };

  const commitRelationshipBetweenNodes = async (sourceNodeID: string, sourceSide: NodeDirection, targetNodeID: string, targetSide: NodeDirection) => {
    if (!sourceNodeID || !targetNodeID || sourceNodeID === targetNodeID) return;
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
    await loadGraphRelationships(nodes);
    await loadDetails(selectedNodeID);
    if (detailsPanelNodeID) await loadDetails(detailsPanelNodeID);
  };

  const deleteNode = async (nodeID: string) => {
    if (!nodeID) return;
    setError("");
    try {
      await requestJSON<{ status: string }>(`/v1/nodes/${nodeID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      });
      setDetails((current) => (current?.node.node_id === nodeID ? null : current));
      if (detailsPanelNodeID === nodeID) setDetailsPanelNodeID("");
      await loadNodes();
      setSelectedNodeIDs((previous) => {
        const next = new Set(previous);
        next.delete(nodeID);
        return next;
      });
      setNodePositions((previous) => {
        const next = { ...previous };
        delete next[nodeID];
        return next;
      });
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
      setDetails((current) => (current && unique.includes(current.node.node_id) ? null : current));
      if (detailsPanelNodeID && unique.includes(detailsPanelNodeID)) setDetailsPanelNodeID("");
      await loadNodes();
      setSelectedNodeID("");
      setSelectedNodeIDs(new Set());
      setNodePositions((previous) => {
        const next = { ...previous };
        for (const id of unique) delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_delete_node");
    }
  };

  const deleteRelationships = async (relationshipIDs: string[]) => {
    const unique = Array.from(new Set(relationshipIDs.filter(Boolean)));
    if (unique.length === 0) return;
    setError("");
    try {
      await Promise.all(unique.map((relationshipID) => requestJSON<{ status: string }>(`/v1/node-relationships/${relationshipID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      })));
      setSelectedRelationshipIDs(new Set());
      setRelationshipAnchors((previous) => {
        const next = { ...previous };
        for (const id of unique) delete next[id];
        return next;
      });
      await loadGraphRelationships(nodes);
      await loadDetails(selectedNodeID);
      if (detailsPanelNodeID) await loadDetails(detailsPanelNodeID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_delete_relationship");
    }
  };

  const addInformation = async (nodeID: string) => {
    if (!nodeID || !trimOrEmpty(infoDraft)) return;
    setError("");
    try {
      await requestJSON<NodeInformation>(`/v1/nodes/${nodeID}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: infoType,
          information: trimOrEmpty(infoDraft),
        }),
      });
      setInfoDraft("");
      await loadDetails(nodeID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_add_node_information");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!canvasActive) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const relationshipIDs = Array.from(selectedRelationshipIDs);
      if (relationshipIDs.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        void deleteRelationships(relationshipIDs);
        return;
      }
      const nodeIDs = selectedNodeIDs.size > 0 ? Array.from(selectedNodeIDs) : (selectedNodeID ? [selectedNodeID] : []);
      if (nodeIDs.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      setConfirmDelete({ nodeIDs });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [canvasActive, selectedNodeID, selectedNodeIDs, selectedRelationshipIDs]);

  useEffect(() => {
    if (!panelDrag) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== panelDrag.pointerID || !viewportRef.current) return;
      const dx = event.clientX - panelDrag.startX;
      const dy = event.clientY - panelDrag.startY;
      const bounds = viewportRef.current.getBoundingClientRect();
      const maxX = Math.max(0, bounds.width - panelRect.width - 8);
      const maxY = Math.max(0, bounds.height - 56);
      setPanelRect((previous) => ({ ...previous, x: clamp(panelDrag.originX + dx, 0, maxX), y: clamp(panelDrag.originY + dy, 8, maxY) }));
    };
    const onUp = (event: PointerEvent) => { if (event.pointerId === panelDrag.pointerID) setPanelDrag(null); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [panelDrag, panelRect.width]);

  useEffect(() => {
    if (!panelResize) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== panelResize.pointerID || !viewportRef.current) return;
      const bounds = viewportRef.current.getBoundingClientRect();
      const dx = event.clientX - panelResize.startX;
      const dy = event.clientY - panelResize.startY;
      const maxX = Math.max(0, bounds.width - 8);
      const maxY = Math.max(8, bounds.height - 8);

      let nextX = panelResize.originX;
      let nextY = panelResize.originY;
      let nextW = panelResize.originW;
      let nextH = panelResize.originH;

      if (panelResize.edges.right) nextW = panelResize.originW + dx;
      if (panelResize.edges.bottom) nextH = panelResize.originH + dy;
      if (panelResize.edges.left) {
        nextX = panelResize.originX + dx;
        nextW = panelResize.originW - dx;
      }
      if (panelResize.edges.top) {
        nextY = panelResize.originY + dy;
        nextH = panelResize.originH - dy;
      }

      nextW = clamp(nextW, PANEL_MIN_WIDTH, maxX);
      nextH = clamp(nextH, PANEL_MIN_HEIGHT, maxY - 8);
      nextX = clamp(nextX, 0, maxX - nextW);
      nextY = clamp(nextY, 8, maxY - nextH);

      if (panelResize.edges.left) nextX = panelResize.originX + (panelResize.originW - nextW);
      if (panelResize.edges.top) nextY = panelResize.originY + (panelResize.originH - nextH);
      nextX = clamp(nextX, 0, maxX - nextW);
      nextY = clamp(nextY, 8, maxY - nextH);

      setPanelRect({ x: nextX, y: nextY, width: nextW, height: nextH });
    };
    const onUp = (event: PointerEvent) => { if (event.pointerId === panelResize.pointerID) setPanelResize(null); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [panelResize]);

  const detailsPanelNode = useMemo(() => nodes.find((item) => item.node_id === detailsPanelNodeID) ?? null, [nodes, detailsPanelNodeID]);
  const nodeByID = useMemo(() => Object.fromEntries(nodes.map((node) => [node.node_id, node])), [nodes]);
  const activeRoleNodeID = useMemo(() => {
    if (selectedNodeIDs.size === 1) return Array.from(selectedNodeIDs)[0] ?? "";
    return selectedNodeID;
  }, [selectedNodeIDs, selectedNodeID]);

  useEffect(() => {
    if (!detailsPanelNode || !viewportRef.current) return;
    const bounds = viewportRef.current.getBoundingClientRect();
    setPanelRect((previous) => ({
      ...previous,
      x: previous.x === 0 ? Math.max(0, bounds.width - previous.width - 12) : clamp(previous.x, 0, Math.max(0, bounds.width - previous.width - 8)),
      y: clamp(previous.y, 8, Math.max(8, bounds.height - 56)),
    }));
  }, [detailsPanelNode]);

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

  const draftPath = useMemo(() => {
    if (!relationshipDraft) return null;
    const from = getAnchorPoint(relationshipDraft.sourceNodeID, relationshipDraft.sourceSide);
    if (!from) return null;
    return [from, relationshipDraft.cursor];
  }, [relationshipDraft, nodePositions]);

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

  return (
    <div style={{ fontSize: 11, height: "100%" }}>
      <div
        ref={viewportRef}
        style={{
          position: "relative",
          overflow: "hidden",
          height: "100%",
          width: "100%",
          backgroundColor: "rgba(255,255,255,0.78)",
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setCanvasActive(true);
          setNodeContextMenu(null);
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
          setSelectedRelationshipIDs(new Set());
          const bounds = viewportRef.current.getBoundingClientRect();
          const localX = clamp(event.clientX - bounds.left, 0, bounds.width);
          const localY = clamp(event.clientY - bounds.top, 0, bounds.height);

          if (event.ctrlKey || event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            setSelectionPointerID(event.pointerId);
            setSelectionBox({ startX: localX, startY: localY, currentX: localX, currentY: localY, active: true });
            return;
          }

          if (!(event.target as HTMLElement).closest("[data-node-card='true']")) {
            setSelectedNodeIDs(new Set());
            setSelectedNodeID("");
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
            backgroundImage: `linear-gradient(to right, rgba(17,17,17,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(17,17,17,0.08) 1px, transparent 1px)`,
            backgroundSize: `${MINI_GRID}px ${MINI_GRID}px`,
            backgroundPosition: "-1px -1px",
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
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  setRelationshipDraft(null);
                  if (event.shiftKey || event.ctrlKey) {
                    setSelectedRelationshipIDs((previous) => {
                      const next = new Set(previous);
                      if (next.has(path.id)) next.delete(path.id);
                      else next.add(path.id);
                      return next;
                    });
                    return;
                  }
                  setSelectedRelationshipIDs(new Set([path.id]));
                }}
              />
            ))}
          </svg>

          {visibleNodes.map((node) => {
            const position = nodePositions[node.node_id] ?? { x: 120, y: 120 };
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
                  width: NODE_W,
                  height: NODE_H,
                  borderRadius: 8,
                  border: `1px solid ${isSelected ? accent : "#505050"}`,
                  background: isSelected ? "#ffffff" : "rgba(252,252,252,0.93)",
                  outline: isSelected ? `2px solid ${accent}` : "none",
                  outlineOffset: isSelected ? 1 : 0,
                  display: "grid",
                  gridTemplateRows: "auto 1fr auto",
                  boxShadow: isSelected ? "0 0 0 3px rgba(111,231,238,0.32), 0 8px 20px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.12)",
                  userSelect: "none",
                  cursor: dragState?.nodeIDs.includes(node.node_id) ? "grabbing" : "grab",
                  zIndex: isPrimary ? 5 : 4,
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setDetailsPanelNodeID(node.node_id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setCanvasActive(true);
                  setSelectedRelationshipIDs(new Set());
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
                <div style={{ borderBottom: "1px solid currentColor", padding: "8px 8px 7px", fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>
                  <div style={{ whiteSpace: "normal", overflowWrap: "anywhere", maxHeight: 28, overflow: "hidden" }}>{node.header}</div>
                </div>
                {isSelected && (
                  <div style={{ position: "absolute", top: 6, right: 6, width: 12, height: 12, borderRadius: 999, background: accent, opacity: 0.85 }} />
                )}
                <div style={{ padding: "5px 8px", fontSize: 10, display: "grid", gap: 2 }}>
                  <div>ID: {node.node_id.slice(0, 8)}</div>
                  <div>Info: {details?.node.node_id === node.node_id ? details.information.length : "-"}</div>
                  <div>Rel: {details?.node.node_id === node.node_id ? details.relationships.length : "-"}</div>
                </div>
                <div style={{ padding: "4px 8px", fontSize: 9, opacity: 0.7 }}>drag to move · double-click for details</div>

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
                          setRelationshipDraft(null);
                          void createLinkedNode(node.node_id, direction);
                        }}
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 999,
                          border: `1px solid ${accent}`,
                          background: "#ffffff",
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
                          if (relationshipDraft) {
                            if (relationshipDraft.sourceNodeID === node.node_id) return;
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
                          borderRadius: 999,
                          border: `1px solid ${accent}`,
                          background: isSource ? accent : "#ffffff",
                          color: isSource ? "#ffffff" : accent,
                          display: "grid",
                          placeItems: "center",
                          cursor: relationshipDraft?.sourceNodeID === node.node_id ? "not-allowed" : "pointer",
                          padding: 0,
                        }}
                      >
                        {isDrafting ? "◎" : (direction === "top" ? "↑" : direction === "right" ? "→" : direction === "bottom" ? "↓" : "←")}
                      </button>
                    </div>
                  );
                })}
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
              background: "rgba(255,255,255,0.95)",
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
                background: "rgba(255,255,255,0.8)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                padding: "7px 8px",
                textAlign: "left",
                borderRadius: 0,
              }}
              onClick={() => {
                const title = trimOrEmpty(newNodeHeader) || "New node";
                void createNode(title, { x: contextMenu.worldX, y: contextMenu.worldY });
                if (!trimOrEmpty(newNodeHeader)) setNewNodeHeader("");
                setContextMenu(null);
              }}
            >
              Create new node
            </button>
            <button
              style={{
                width: "100%",
                border: "1px solid rgba(0,0,0,0.16)",
                background: "rgba(255,255,255,0.8)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                padding: "7px 8px",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                color: "#111111",
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
                    background: "#ffffff",
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
                    background: "rgba(255,255,255,0.72)",
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
              background: "rgba(255,255,255,0.95)",
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
            <button style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "6px 8px", textAlign: "left" }} onClick={() => { setDetailsPanelNodeID(nodeContextMenu.nodeID); setNodeContextMenu(null); }}>
              Edit node
            </button>
            <button style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "6px 8px", color: "#a20026", textAlign: "left" }} onClick={() => { const ids = selectedNodeIDs.size > 0 ? Array.from(selectedNodeIDs) : [nodeContextMenu.nodeID]; setConfirmDelete({ nodeIDs: ids }); setNodeContextMenu(null); }}>
              Delete node
            </button>
          </div>
        )}

        {!!detailsPanelNode && (
          <div
            className="node-details-panel"
            style={{
              position: "absolute",
              top: panelRect.y,
              left: panelRect.x,
              width: panelRect.width,
              height: panelRect.height,
              boxSizing: "border-box",
              overflowY: "auto",
              overflowX: "hidden",
              zIndex: 35,
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.35)",
              backgroundColor: "rgba(157, 224, 227, 0.72)",
              background: `
                linear-gradient(
                  135deg,
                  rgba(255,255,255,0.18) 0%,
                  rgba(255,255,255,0.08) 50%,
                  rgba(255,255,255,0.14) 100%
                )
              `,
              backdropFilter: "blur(30px) saturate(180%)",
              WebkitBackdropFilter: "blur(30px) saturate(180%)",
              boxShadow: `
                0 8px 32px rgba(0,0,0,0.18),
                inset 0 1px 0 rgba(255,255,255,0.6),
                inset 0 -1px 0 rgba(255,255,255,0.15)
              `,
              padding: 12,
              display: "grid",
              gap: 8,
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              color: "#1a1a1a",
              letterSpacing: "0.01em",
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "move" }}
              onPointerDown={(event) => {
                event.stopPropagation();
                setPanelDrag({ pointerID: event.pointerId, startX: event.clientX, startY: event.clientY, originX: panelRect.x, originY: panelRect.y });
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em" }}>{detailsPanelNode.header}</div>
              <button onClick={() => setDetailsPanelNodeID("")} style={{ border: "1px solid rgba(0,0,0,0.15)", background: "rgba(255,255,255,0.4)", borderRadius: 6, cursor: "pointer", width: 22, height: 22, fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, fontWeight: 500, opacity: 0.6, letterSpacing: "0.02em" }}>ID: {detailsPanelNode.node_id}</div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 6, alignItems: "center", minWidth: 0 }}>
              <input value={infoDraft} onChange={(e) => setInfoDraft(e.target.value)} placeholder="Add node information" style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 400, padding: "6px 10px", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 6, background: "rgba(255,255,255,0.45)", outline: "none", minWidth: 0, width: "100%" }} />
              <select value={infoType} onChange={(e) => setInfoType(e.target.value as (typeof INFO_TYPES)[number])} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 500, padding: "6px 8px", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 6, background: "rgba(255,255,255,0.45)", cursor: "pointer", maxWidth: "100%" }}>
                {INFO_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <button onClick={() => { void addInformation(detailsPanelNode.node_id); }} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 600, padding: "6px 10px", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 6, background: "rgba(255,255,255,0.55)", cursor: "pointer", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>Info</button>
            </div>
            <button onClick={() => { void deleteNode(detailsPanelNode.node_id); }} style={{ justifySelf: "start", fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 600, padding: "6px 12px", border: "1px solid rgba(180,0,30,0.25)", borderRadius: 6, background: "rgba(255,255,255,0.45)", color: "#b00020", cursor: "pointer", letterSpacing: "0.02em" }}>Delete node</button>
            {loading && <div style={{ ...divider, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>Syncing with API...</div>}
            {error && <div style={{ ...divider, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "#b00020" }}>Error: {error}</div>}
            <div>
              <div style={{ ...divider, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.7, marginBottom: 4 }}>[ relationships ]</div>
              <div style={{ display: "grid", gap: 2, maxHeight: 110, overflow: "auto" }}>
                {(details?.node.node_id === detailsPanelNode.node_id ? details.relationships : []).length === 0
                  ? <div style={{ ...divider, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, opacity: 0.55 }}>No relationships</div>
                  : (details?.relationships ?? []).map((rel) => (
                    <div key={rel.node_relationship_id} style={{ ...divider, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", columnGap: 8 }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {rel.node_id_a.slice(0, 6)}({rel.a_position}) → {rel.node_id_b.slice(0, 6)}({rel.b_position})
                      </div>
                      <button
                        onClick={() => { void deleteRelationships([rel.node_relationship_id]); }}
                        style={{ border: "1px solid rgba(180,0,30,0.25)", background: "rgba(255,255,255,0.55)", color: "#b00020", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "2px 6px" }}
                      >
                        Snip
                      </button>
                    </div>
                  ))}
              </div>
            </div>
            <div>
              <div style={{ ...divider, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.7, marginBottom: 4 }}>[ information ]</div>
              <div style={{ display: "grid", gap: 2, maxHeight: 130, overflow: "auto" }}>
                {(details?.node.node_id === detailsPanelNode.node_id ? details.information : []).length === 0
                  ? <div style={{ ...divider, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, opacity: 0.55 }}>No information</div>
                  : (details?.information ?? []).map((info) => (
                    <div key={info.information_id} style={{ ...divider, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 500, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                      {info.type}: {info.information}
                    </div>
                  ))}
              </div>
            </div>
            {panelResizeHandles.map((handle) => (
              <div
                key={handle.key}
                style={{ position: "absolute", ...handle.style, cursor: handle.cursor, zIndex: 2 }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setPanelResize({
                    pointerID: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: panelRect.x,
                    originY: panelRect.y,
                    originW: panelRect.width,
                    originH: panelRect.height,
                    edges: handle.edges,
                  });
                }}
              />
            ))}
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

        {confirmDelete && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 60, display: "grid", placeItems: "center" }}>
            <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: `1px solid ${accent}`, background: "rgba(255,255,255,0.92)", padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Are you sure you want to delete {confirmDelete.nodeIDs.length} node{confirmDelete.nodeIDs.length === 1 ? "" : "s"}?</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button onClick={() => { void deleteNodes(confirmDelete.nodeIDs); setConfirmDelete(null); }} style={{ border: `1px solid ${accent}`, background: "#d8fff6", cursor: "pointer", fontWeight: 700 }}>Yes</button>
                <button onClick={() => setConfirmDelete(null)} style={{ border: `1px solid ${accent}`, background: "#fff", cursor: "pointer", fontWeight: 700 }}>No</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
