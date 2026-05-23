import type React from "react";
import { useCallback, useEffect } from "react";
import {
  NODE_H,
  NODE_MAP_MAX_ZOOM,
  NODE_MAP_MIN_ZOOM,
  NODE_W,
  type NodeMapState,
  type NodePosition,
  type NodeRecord,
  type PersistedMapPosition,
  SESSION_NODE_MAP_STATE,
  changedPersistedMapPositions,
  clamp,
  persistedMapPositionsToNodePositions,
  snapToGrid,
} from "./shared";
import type { LogicGateMapRelationshipRole } from "./LogicGateMapContextMenus";

const DEFAULT_RELATIONSHIP_ROLE_COLORS: Record<LogicGateMapRelationshipRole, string> = {
  input: "#475569",
  output: "#64748b",
};

type UseLogicGateMapGraphPersistenceInput = {
  companyID: string;
  mapStateKey: string;
  fallbackMapStateKey: string;
  restoredViewport: boolean;
  zoom: number;
  pan: { x: number; y: number };
  selectedNodeID: string;
  nodePositions: Record<string, NodePosition>;
  nodes: NodeRecord[];
  relationshipColorsEnabled: boolean;
  relationshipRoleColors: Record<LogicGateMapRelationshipRole, string>;
  worldWidth: number;
  worldHeight: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  setPanInitialized: React.Dispatch<React.SetStateAction<boolean>>;
  setRestoredViewport: React.Dispatch<React.SetStateAction<boolean>>;
  restoredSelectionRef: React.MutableRefObject<string>;
  selectedNodeIDRef: React.MutableRefObject<string>;
  suppressNextSelectionBroadcastRef: React.MutableRefObject<boolean>;
  setSelectedNodeID: React.Dispatch<React.SetStateAction<string>>;
  setSelectedNodeIDs: React.Dispatch<React.SetStateAction<Set<string>>>;
  setNodePositions: React.Dispatch<React.SetStateAction<Record<string, NodePosition>>>;
  setRelationshipColorsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setRelationshipRoleColors: React.Dispatch<React.SetStateAction<Record<LogicGateMapRelationshipRole, string>>>;
  layoutPersistenceReadyRef: React.MutableRefObject<boolean>;
  lastPersistedNodePositionsRef: React.MutableRefObject<Record<string, NodePosition>>;
  layoutInteractionActiveRef: React.MutableRefObject<boolean>;
  requestJSON: <T>(path: string, init?: RequestInit) => Promise<T>;
};

export function useLogicGateMapGraphPersistence({
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
  worldWidth,
  worldHeight,
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
  layoutInteractionActiveRef,
  requestJSON,
}: UseLogicGateMapGraphPersistenceInput) {
  const applyServerMapPositions = useCallback((positions: PersistedMapPosition[]) => {
    const serverPositions = persistedMapPositionsToNodePositions({
      positions,
      worldWidth,
      worldHeight,
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
    });
    if (layoutInteractionActiveRef.current) {
      layoutPersistenceReadyRef.current = true;
      return;
    }
    lastPersistedNodePositionsRef.current = { ...lastPersistedNodePositionsRef.current, ...serverPositions };
    if (Object.keys(serverPositions).length > 0) {
      setNodePositions((previous) => ({ ...previous, ...serverPositions }));
    }
    layoutPersistenceReadyRef.current = true;
  }, [lastPersistedNodePositionsRef, layoutInteractionActiveRef, layoutPersistenceReadyRef, setNodePositions, worldHeight, worldWidth]);

  useEffect(() => {
    const cached = SESSION_NODE_MAP_STATE.get(mapStateKey) ?? SESSION_NODE_MAP_STATE.get(fallbackMapStateKey);
    if (cached) {
      setZoom(clamp(cached.zoom, NODE_MAP_MIN_ZOOM, NODE_MAP_MAX_ZOOM));
      setPan(cached.pan);
      setPanInitialized(true);
      restoredSelectionRef.current = cached.selectedNodeID;
      selectedNodeIDRef.current = cached.selectedNodeID;
      suppressNextSelectionBroadcastRef.current = true;
      setSelectedNodeID(cached.selectedNodeID);
      setSelectedNodeIDs(cached.selectedNodeID ? new Set([cached.selectedNodeID]) : new Set());
      setNodePositions(cached.nodePositions);
      setRelationshipColorsEnabled(cached.relationshipColorsEnabled !== false);
      if (cached.relationshipRoleColors) {
        setRelationshipRoleColors(DEFAULT_RELATIONSHIP_ROLE_COLORS);
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
        relationshipRoleColors?: { input?: string; output?: string };
      };
      if (typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom)) {
        setZoom(clamp(parsed.zoom, NODE_MAP_MIN_ZOOM, NODE_MAP_MAX_ZOOM));
      }
      if (parsed.pan && typeof parsed.pan.x === "number" && typeof parsed.pan.y === "number") {
        setPan({ x: parsed.pan.x, y: parsed.pan.y });
        setPanInitialized(true);
      }
      if (typeof parsed.selectedNodeID === "string") {
        restoredSelectionRef.current = parsed.selectedNodeID;
        selectedNodeIDRef.current = parsed.selectedNodeID;
        suppressNextSelectionBroadcastRef.current = true;
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
            x: clamp(snapToGrid(x), 0, worldWidth - NODE_W),
            y: clamp(snapToGrid(y), 0, worldHeight - NODE_H),
          };
        }
        setNodePositions(sanitized);
      }
      if (typeof parsed.relationshipColorsEnabled === "boolean") {
        setRelationshipColorsEnabled(parsed.relationshipColorsEnabled);
      }
      if (parsed.relationshipRoleColors && typeof parsed.relationshipRoleColors === "object") {
        setRelationshipRoleColors(DEFAULT_RELATIONSHIP_ROLE_COLORS);
      }
    } catch {
      // ignore local cache parse errors
    } finally {
      setRestoredViewport(true);
    }
  }, [
    fallbackMapStateKey,
    mapStateKey,
    restoredSelectionRef,
    selectedNodeIDRef,
    suppressNextSelectionBroadcastRef,
    setNodePositions,
    setPan,
    setPanInitialized,
    setRelationshipColorsEnabled,
    setRelationshipRoleColors,
    setRestoredViewport,
    setSelectedNodeID,
    setSelectedNodeIDs,
    setZoom,
    worldHeight,
    worldWidth,
  ]);

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
  }, [fallbackMapStateKey, mapStateKey, pan, relationshipColorsEnabled, relationshipRoleColors, restoredViewport, selectedNodeID, zoom]);

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
            const payload = await requestJSON<{ positions: Array<{ logic_gate_id?: string; entity_id?: string; x: number; y: number }> }>("/v1/map-layout", {
              method: "PUT",
              body: JSON.stringify({
                company_id: companyID,
                map_type: "logic_gate",
                positions: chunk,
              }),
            });
            const savedPositions = persistedMapPositionsToNodePositions({
              positions: payload.positions,
              worldWidth,
              worldHeight,
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
  }, [
    companyID,
    lastPersistedNodePositionsRef,
    layoutPersistenceReadyRef,
    nodePositions,
    nodes,
    requestJSON,
    restoredViewport,
    worldHeight,
    worldWidth,
  ]);

  return applyServerMapPositions;
}
