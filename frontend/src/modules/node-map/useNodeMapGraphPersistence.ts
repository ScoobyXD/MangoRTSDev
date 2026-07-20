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
import type { NodeMapRelationshipRole } from "./NodeMapContextMenus";
import { restoreMyTeraCardStates, restoreNodeMapRelationshipRoleColors, restoreNodeSizes, type MyTeraCardStateByNodeID } from "./mapAppearancePersistence";


type UseNodeMapGraphPersistenceInput = {
  companyID: string;
  mapStateKey: string;
  fallbackMapStateKey: string;
  mapAppearanceStateKey: string;
  restoredViewport: boolean;
  zoom: number;
  pan: { x: number; y: number };
  selectedNodeID: string;
  nodePositions: Record<string, NodePosition>;
  nodes: NodeRecord[];
  nodeSizes: Record<string, { w: number; h: number }>;
  myTeraCards: MyTeraCardStateByNodeID;
  relationshipColorsEnabled: boolean;
  relationshipRoleColors: Record<NodeMapRelationshipRole, string>;
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
  setNodeSizes: React.Dispatch<React.SetStateAction<Record<string, { w: number; h: number }>>>;
  setMyTeraCards: React.Dispatch<React.SetStateAction<MyTeraCardStateByNodeID>>;
  setRelationshipColorsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setRelationshipRoleColors: React.Dispatch<React.SetStateAction<Record<NodeMapRelationshipRole, string>>>;
  layoutPersistenceReadyRef: React.MutableRefObject<boolean>;
  lastPersistedNodePositionsRef: React.MutableRefObject<Record<string, NodePosition>>;
  layoutInteractionActiveRef: React.MutableRefObject<boolean>;
  requestJSON: <T>(path: string, init?: RequestInit) => Promise<T>;
};

export function useNodeMapGraphPersistence({
  companyID,
  mapStateKey,
  fallbackMapStateKey,
  restoredViewport,
  mapAppearanceStateKey,
  zoom,
  pan,
  selectedNodeID,
  nodePositions,
  nodes,
  relationshipColorsEnabled,
  nodeSizes,
  myTeraCards,
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
  setNodeSizes,
  setMyTeraCards,
  setRelationshipRoleColors,
  layoutPersistenceReadyRef,
  lastPersistedNodePositionsRef,
  layoutInteractionActiveRef,
  requestJSON,
}: UseNodeMapGraphPersistenceInput) {
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
    const parseState = (raw: string | null): Partial<NodeMapState> | null => {
      if (!raw) return null;
      try {
        return JSON.parse(raw) as Partial<NodeMapState>;
      } catch {
        return null;
      }
    };
    const cachedViewport = SESSION_NODE_MAP_STATE.get(mapStateKey) ?? SESSION_NODE_MAP_STATE.get(fallbackMapStateKey);
    const parsedViewport = cachedViewport
      ? null
      : parseState(localStorage.getItem(mapStateKey) ?? localStorage.getItem(fallbackMapStateKey));
    const viewportState = cachedViewport ?? parsedViewport;

    if (viewportState) {
      if (typeof viewportState.zoom === "number" && Number.isFinite(viewportState.zoom)) {
        setZoom(clamp(viewportState.zoom, NODE_MAP_MIN_ZOOM, NODE_MAP_MAX_ZOOM));
      }
      if (viewportState.pan && typeof viewportState.pan.x === "number" && typeof viewportState.pan.y === "number") {
        setPan({ x: viewportState.pan.x, y: viewportState.pan.y });
        setPanInitialized(true);
      }
      if (typeof viewportState.selectedNodeID === "string") {
        restoredSelectionRef.current = viewportState.selectedNodeID;
        selectedNodeIDRef.current = viewportState.selectedNodeID;
        suppressNextSelectionBroadcastRef.current = true;
        setSelectedNodeID(viewportState.selectedNodeID);
        setSelectedNodeIDs(viewportState.selectedNodeID ? new Set([viewportState.selectedNodeID]) : new Set());
      }
      if (viewportState.nodePositions && typeof viewportState.nodePositions === "object") {
        const sanitized: Record<string, NodePosition> = {};
        for (const [key, value] of Object.entries(viewportState.nodePositions)) {
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
    }

    const appearanceState = SESSION_NODE_MAP_STATE.get(mapAppearanceStateKey)
      ?? parseState(localStorage.getItem(mapAppearanceStateKey))
      ?? viewportState;
    if (appearanceState) {
      if (typeof appearanceState.relationshipColorsEnabled === "boolean") {
        setRelationshipColorsEnabled(appearanceState.relationshipColorsEnabled);
      }
      setRelationshipRoleColors(restoreNodeMapRelationshipRoleColors(appearanceState.relationshipRoleColors));
      setNodeSizes(restoreNodeSizes(appearanceState.nodeSizes, worldWidth, worldHeight));
      setMyTeraCards(restoreMyTeraCardStates(appearanceState.myTeraCards, worldHeight));
    }
    setRestoredViewport(true);
  }, [
    fallbackMapStateKey,
    mapAppearanceStateKey,
    mapStateKey,
    restoredSelectionRef,
    selectedNodeIDRef,
    suppressNextSelectionBroadcastRef,
    setMyTeraCards,
    setNodePositions,
    setNodeSizes,
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
        const appearanceState: NodeMapState = {
          zoom,
          pan,
          selectedNodeID,
          nodePositions: {},
          nodeSizes,
          myTeraCards,
          relationshipColorsEnabled,
          relationshipRoleColors,
        };
        SESSION_NODE_MAP_STATE.set(mapAppearanceStateKey, appearanceState);
        localStorage.setItem(mapAppearanceStateKey, JSON.stringify(appearanceState));

      } catch {
        // ignore local storage quota/security errors
      }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [fallbackMapStateKey, mapAppearanceStateKey, mapStateKey, myTeraCards, nodeSizes, pan, relationshipColorsEnabled, relationshipRoleColors, restoredViewport, selectedNodeID, zoom]);

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
