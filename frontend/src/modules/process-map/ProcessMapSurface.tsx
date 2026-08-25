import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import {
  ExplorerDisclosureIcon,
  ExplorerRowIcon,
  NODE_ICON_GRADIENT_END,
  NODE_ICON_GRADIENT_START,
} from "../../icons/index.js";
import { readExplorerDragPayload, EXPLORER_DRAG_MIME } from "../company-explorer/companyExplorerDragDrop.js";
import {
  fetchCompanyExplorerChildren,
  fetchCompanyExplorerRoots,
  type CompanyExplorerV2Row,
} from "../company-explorer/companyExplorerLazyApi.js";
import { createCoalescedCanonicalRefresh } from "../realtime/coalescedCanonicalRefresh.js";
import { getCurrentRealtimeConnectionID, subscribeRealtimeScope } from "../realtime/realtimeWebSocket.js";
import { isAbortError } from "../api/requestJSON.js";
import {
  deleteProcessMapPlacement,
  deleteProcessMapRelationship,
  fetchProcessMapLayer,
  invalidateProcessMapLayers,
  postProcessMapRelationship,
  putProcessMapPlacement,
  putProcessMapTrace,
  type ProcessMapLayerResponse,
  type ProcessMapPlacement,
  type ProcessMapResourceRef,
  type ProcessMapTrace,
} from "./processMapApi.js";
import {
  PROCESS_MAP_GRID_PX,
  defaultProcessMapRoutePoints,
  insertProcessMapRoutePoint,
  orthogonalizeProcessMapRoutePoints,
  processMapFlowToRoutePoint,
  processMapFlowToGridPosition,
  processMapFootprint,
  processMapGridPointToFlowPosition,
  processMapGridToFlowPosition,
  processMapInputAnchor,
  processMapOutputAnchor,
  processMapRoutePointToSurfaceCenter,
  processMapTracePath,
  type ProcessMapGridPoint,
  type ProcessMapResourceType,
} from "./processMapGeometry.js";
import {
  decideProcessMapExplorerDrop,
  isValidProcessMapConnection,
  processMapFolderDrillTarget,
  processMapResourceNodeID,
  processMapTrayCandidates,
  shouldApplyProcessMapCommit,
  shouldApplyProcessMapMutationAck,
} from "./processMapInteraction.js";
import "./processMap.css";

const PROCESS_MAP_REALTIME_SCOPE = "process-map:company";

type ProcessMapNodeData = {
  restricted: false;
  resourceType: ProcessMapResourceType;
  resourceID: string;
  label: string;
  gridX: number;
  gridY: number;
  revision: number;
  createdTimestamp: string;
  updatedTimestamp: string;
} | {
  restricted: true;
  gridX: number;
  gridY: number;
};

type ProcessMapVisibleNodeData = Extract<ProcessMapNodeData, { restricted: false }>;

type ProcessMapNode = Node<ProcessMapNodeData, "processMapCard">;

type ReplaceTraceRoute = (
  relationshipID: string,
  routePoints: ProcessMapGridPoint[],
) => void;

type MoveTraceWaypoint = (
  relationshipID: string,
  waypointIndex: number,
  clientPoint: ProcessMapGridPoint | null,
  startingRoutePoints: ProcessMapGridPoint[],
  action: "preview" | "commit" | "cancel",
  canonicalGeneration: number,
) => void;

type ProcessMapEdgeData = {
  routePoints: ProcessMapGridPoint[];
  committedRoutePoints: ProcessMapGridPoint[];
  revision: number;
  createdTimestamp: string;
  updatedTimestamp: string;
  onMoveWaypoint: MoveTraceWaypoint;
  onReplaceRoute: ReplaceTraceRoute;
  getCanonicalGeneration: () => number;
};

type ProcessMapEdge = Edge<ProcessMapEdgeData, "processMapTrace">;

type ProcessMapSelection =
  | { kind: "placement"; id: string }
  | { kind: "trace"; id: string }
  | null;

export type ProcessMapSurfaceProps = {
  apiBase: string;
  companyID: string;
  folderID?: string;
  onOpenFolder: (folderID: string) => void;
  onLayerChange?: (layer: ProcessMapLayerResponse["layer"] | null) => void;
};

function resourceFromNode(node: ProcessMapNode | undefined): ProcessMapResourceRef | null {
  if (!node || node.data.restricted) return null;
  return { resource_type: node.data.resourceType, resource_id: node.data.resourceID };
}

function processMapNodeFromPlacement(placement: ProcessMapPlacement, index: number): ProcessMapNode {
  const footprint = processMapFootprint(placement.restricted ? undefined : placement.resource_type, placement.restricted);
  const position = processMapGridToFlowPosition({ x: placement.grid_x, y: placement.grid_y });
  if (placement.restricted) {
    return {
      id: `restricted:${index}`,
      type: "processMapCard",
      position,
      data: { restricted: true, gridX: placement.grid_x, gridY: placement.grid_y },
      style: { width: footprint.width * PROCESS_MAP_GRID_PX, height: footprint.height * PROCESS_MAP_GRID_PX },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      deletable: false,
    };
  }
  return {
    id: processMapResourceNodeID({ resource_type: placement.resource_type, resource_id: placement.resource_id }),
    type: "processMapCard",
    position,
    data: {
      restricted: false,
      resourceType: placement.resource_type,
      resourceID: placement.resource_id,
      label: placement.name,
      gridX: placement.grid_x,
      gridY: placement.grid_y,
      revision: placement.revision,
      createdTimestamp: placement.created_timestamp,
      updatedTimestamp: placement.updated_timestamp,
    },
    style: { width: footprint.width * PROCESS_MAP_GRID_PX, height: footprint.height * PROCESS_MAP_GRID_PX },
    draggable: true,
    selectable: true,
    connectable: true,
    focusable: true,
    deletable: false,
  };
}

function ProcessMapCard({ data, selected, isConnectable }: NodeProps<ProcessMapNode>) {
  if (data.restricted) {
    return (
      <div className="process-map-card process-map-card--restricted" aria-label="?">
        <span aria-hidden="true">?</span>
      </div>
    );
  }
  const isFolder = data.resourceType === "company_explorer_folder";
  return (
    <div
      className={`process-map-card process-map-card--${isFolder ? "folder" : "process"}${selected ? " is-selected" : ""}`}
      aria-label={`${isFolder ? "Folder" : "Process"}: ${data.label}`}
    >
      <Handle
        id="input"
        className="process-map-handle process-map-handle--input"
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
      />
      <div className="process-map-card__body">
        <span className="process-map-card__kind">{isFolder ? "Folder" : "Process"}</span>
        <span className="process-map-card__label">{data.label}</span>
      </div>
      <Handle
        id="output"
        className="process-map-handle process-map-handle--output"
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
      />
    </div>
  );
}

function ProcessMapTraceWaypoint({
  relationshipID,
  waypointIndex,
  point,
  routePoints,
  data,
}: {
  relationshipID: string;
  waypointIndex: number;
  point: ProcessMapGridPoint;
  routePoints: ProcessMapGridPoint[];
  data: ProcessMapEdgeData;
}) {
  const gestureRef = React.useRef<{
    pointerID: number;
    startingRoutePoints: ProcessMapGridPoint[];
    canonicalGeneration: number;
  } | null>(null);
  const flowPoint = processMapGridPointToFlowPosition(processMapRoutePointToSurfaceCenter(point));
  const finishGesture = (event: React.PointerEvent<HTMLButtonElement>, action: "commit" | "cancel") => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerID !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    data.onMoveWaypoint(
      relationshipID,
      waypointIndex,
      action === "commit" ? { x: event.clientX, y: event.clientY } : null,
      gesture.startingRoutePoints,
      action,
      gesture.canonicalGeneration,
    );
  };
  return (
    <button
      type="button"
      className="nodrag nopan process-map-waypoint"
      aria-label={`Trace waypoint ${waypointIndex + 1}`}
      title="Drag to move. Double-click to remove."
      style={{ transform: `translate(-50%, -50%) translate(${flowPoint.x}px, ${flowPoint.y}px)` }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        data.onReplaceRoute(relationshipID, routePoints.filter((_, routeIndex) => routeIndex !== waypointIndex));
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        gestureRef.current = {
          pointerID: event.pointerId,
          startingRoutePoints: routePoints.map((item) => ({ ...item })),
          canonicalGeneration: data.getCanonicalGeneration(),
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerID !== event.pointerId) return;
        data.onMoveWaypoint(
          relationshipID,
          waypointIndex,
          { x: event.clientX, y: event.clientY },
          gesture.startingRoutePoints,
          "preview",
          gesture.canonicalGeneration,
        );
      }}
      onPointerUp={(event) => finishGesture(event, "commit")}
      onPointerCancel={(event) => finishGesture(event, "cancel")}
      onLostPointerCapture={(event) => finishGesture(event, "cancel")}
    />
  );
}

function ProcessMapTraceEdge({ id, sourceX, sourceY, targetX, targetY, selected, data }: EdgeProps<ProcessMapEdge>) {
  const routePoints = data?.routePoints ?? [];
  const gradientID = `process-map-trace-gradient-${React.useId().replace(/:/g, "")}`;
  const physicalSourceX = sourceX - PROCESS_MAP_HANDLE_RADIUS_PX;
  const physicalTargetX = targetX + PROCESS_MAP_HANDLE_RADIUS_PX;
  const path = processMapTracePath(
    { x: physicalSourceX / PROCESS_MAP_GRID_PX, y: sourceY / PROCESS_MAP_GRID_PX },
    routePoints,
    { x: physicalTargetX / PROCESS_MAP_GRID_PX, y: targetY / PROCESS_MAP_GRID_PX },
  );
  return (
    <>
      <defs>
        <linearGradient id={gradientID} x1={physicalSourceX} y1={sourceY} x2={physicalTargetX} y2={targetY} gradientUnits="userSpaceOnUse">
          <stop stopColor={NODE_ICON_GRADIENT_START} />
          <stop offset="1" stopColor={NODE_ICON_GRADIENT_END} />
        </linearGradient>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        className={`process-map-trace${selected ? " is-selected" : ""}`}
        interactionWidth={PROCESS_MAP_GRID_PX}
        style={{
          stroke: `url(#${gradientID})`,
          strokeWidth: PROCESS_MAP_GRID_PX,
          strokeLinecap: "butt",
          strokeLinejoin: "miter",
        }}
      />
      <path d={path} className="process-map-trace__flow" aria-hidden="true" pointerEvents="none" />
      {selected && data && (
        <EdgeLabelRenderer>
          {routePoints.map((point, index) => (
            <ProcessMapTraceWaypoint
              key={index}
              relationshipID={id}
              waypointIndex={index}
              point={point}
              routePoints={routePoints}
              data={data}
            />
          ))}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { processMapCard: ProcessMapCard };
const edgeTypes = { processMapTrace: ProcessMapTraceEdge };
const PROCESS_MAP_HANDLE_RADIUS_PX = 6;
const PROCESS_MAP_TRAY_COLLAPSED_STORAGE_KEY = "mangorts.process-map.placement-tray-collapsed.v1";

function readProcessMapTrayCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(PROCESS_MAP_TRAY_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function storeProcessMapTrayCollapsed(collapsed: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROCESS_MAP_TRAY_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {}
}

function processMapErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return fallback;
}

function ProcessMapSurfaceInner({ apiBase, companyID, folderID, onOpenFolder, onLayerChange }: ProcessMapSurfaceProps) {
  const [nodes, setNodes] = useState<ProcessMapNode[]>([]);
  const [edges, setEdges] = useState<ProcessMapEdge[]>([]);
  const [selection, setSelection] = useState<ProcessMapSelection>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [trayRows, setTrayRows] = useState<CompanyExplorerV2Row[]>([]);
  const [trayLoading, setTrayLoading] = useState(true);
  const [trayError, setTrayError] = useState("");
  const [trayCollapsed, setTrayCollapsed] = useState(readProcessMapTrayCollapsed);
  const reactFlow = useReactFlow<ProcessMapNode, ProcessMapEdge>();
  const trayListID = React.useId();
  const dragStartRef = useRef<{ id: string; position: ProcessMapGridPoint } | null>(null);
  const layerRequestGenerationRef = useRef(0);
  const activeLayerReadRef = useRef<number | null>(null);
  const localMutationGenerationRef = useRef(0);
  const canonicalRefreshGenerationRef = useRef(0);
  const activeLayerKeyRef = useRef("");
  const refreshResolversRef = useRef(new Set<() => void>());
  const traceSaveGenerationRef = useRef(new Map<string, number>());
  const placementOperationGenerationRef = useRef(new Map<string, number>());
  const deletedRelationshipIDsRef = useRef(new Set<string>());
  const trayBranchReadRef = useRef<Promise<void> | null>(null);
  const committedPlacementRef = useRef(new Map<string, {
    position: ProcessMapGridPoint;
    data: ProcessMapVisibleNodeData;
  }>());

  useEffect(() => {
    if (trayCollapsed) {
      setTrayRows([]);
      setTrayLoading(false);
      setTrayError("");
      return undefined;
    }
    let active = true;
    setTrayRows([]);
    setTrayLoading(true);
    setTrayError("");
    const loadBranch = () => folderID?.trim()
      ? fetchCompanyExplorerChildren(apiBase, companyID, "all", folderID.trim())
      : fetchCompanyExplorerRoots(apiBase, companyID, "all");
    const previousRead = refreshVersion > 0 ? trayBranchReadRef.current : null;
    const request = (async () => {
      if (previousRead) await previousRead;
      if (!active) return undefined;
      return loadBranch();
    })();
    trayBranchReadRef.current = request.then(() => undefined, () => undefined);
    void request.then((snapshot) => {
      if (active && snapshot) setTrayRows(snapshot.rows ?? []);
    }).catch((cause) => {
      if (!active) return;
      setTrayError(processMapErrorMessage(cause, "Failed to load available items"));
    }).finally(() => {
      if (active) setTrayLoading(false);
    });
    return () => {
      active = false;
    };
  }, [apiBase, companyID, folderID, refreshVersion, trayCollapsed]);

  const requestRefresh = useCallback(() => new Promise<void>((resolve) => {
    canonicalRefreshGenerationRef.current += 1;
    refreshResolversRef.current.add(resolve);
    setRefreshVersion((version) => version + 1);
  }), []);

  const markLocalMutationCommitted = useCallback((): boolean => {
    localMutationGenerationRef.current += 1;
    if (!activeLayerReadRef.current) return false;
    activeLayerReadRef.current = null;
    layerRequestGenerationRef.current += 1;
    void requestRefresh();
    return true;
  }, [requestRefresh]);

  useEffect(() => () => {
    for (const resolve of refreshResolversRef.current) resolve();
    refreshResolversRef.current.clear();
  }, []);

  const replaceTraceRoute = useCallback<ReplaceTraceRoute>((relationshipID, routePoints) => {
    const nextRoute = orthogonalizeProcessMapRoutePoints(routePoints);
    const saveGeneration = (traceSaveGenerationRef.current.get(relationshipID) ?? 0) + 1;
    traceSaveGenerationRef.current.set(relationshipID, saveGeneration);
    const responseGeneration = canonicalRefreshGenerationRef.current;
    setEdges((current) => current.map((edge) => edge.id === relationshipID && edge.data
      ? { ...edge, data: { ...edge.data, routePoints: nextRoute } }
      : edge));
    setError("");
    void putProcessMapTrace(apiBase, companyID, relationshipID, nextRoute)
      .then((trace) => {
        const responseWasSuperseded = !shouldApplyProcessMapMutationAck(
          responseGeneration,
          canonicalRefreshGenerationRef.current,
          saveGeneration,
          traceSaveGenerationRef.current.get(relationshipID) ?? 0,
        );
        const refreshQueued = markLocalMutationCommitted();
        if (responseWasSuperseded) {
          if (!refreshQueued) void requestRefresh();
          return;
        }
        setEdges((current) => current.map((edge) => edge.id === relationshipID && edge.data
          && shouldApplyProcessMapCommit(edge.data.revision, trace.revision)
          ? {
              ...edge,
              data: {
                ...edge.data,
                routePoints: trace.route_points,
                committedRoutePoints: trace.route_points.map((point) => ({ ...point })),
                revision: trace.revision,
                createdTimestamp: trace.created_timestamp,
                updatedTimestamp: trace.updated_timestamp,
              },
            }
          : edge));
      })
      .catch((cause) => {
        if (!shouldApplyProcessMapMutationAck(
          responseGeneration,
          responseGeneration,
          saveGeneration,
          traceSaveGenerationRef.current.get(relationshipID) ?? 0,
        )) return;
        if (canonicalRefreshGenerationRef.current !== responseGeneration) {
          setError(processMapErrorMessage(cause, "Failed to save trace route"));
          void requestRefresh();
          return;
        }
        setEdges((current) => current.map((edge) => edge.id === relationshipID && edge.data
          ? { ...edge, data: { ...edge.data, routePoints: edge.data.committedRoutePoints.map((point) => ({ ...point })) } }
          : edge));
        setError(processMapErrorMessage(cause, "Failed to save trace route"));
        void requestRefresh();
      });
  }, [apiBase, companyID, markLocalMutationCommitted, requestRefresh]);

  const currentCanonicalGeneration = useCallback(() => canonicalRefreshGenerationRef.current, []);

  const moveTraceWaypoint = useCallback<MoveTraceWaypoint>((relationshipID, waypointIndex, clientPoint, startingRoutePoints, action, canonicalGeneration) => {
    if (canonicalRefreshGenerationRef.current !== canonicalGeneration) return;
    if (waypointIndex < 0 || waypointIndex >= startingRoutePoints.length) return;
    if (action === "cancel") {
      setEdges((current) => current.map((edge) => edge.id === relationshipID && edge.data
        ? { ...edge, data: { ...edge.data, routePoints: startingRoutePoints.map((point) => ({ ...point })) } }
        : edge));
      return;
    }
    if (!clientPoint) return;
    const flowPoint = reactFlow.screenToFlowPosition(clientPoint, { snapToGrid: false });
    const gridPoint = processMapFlowToRoutePoint(flowPoint);
    const next = startingRoutePoints.map((point, index) => index === waypointIndex ? gridPoint : point);
    setEdges((current) => current.map((edge) => edge.id === relationshipID && edge.data
      ? { ...edge, data: { ...edge.data, routePoints: next } }
      : edge));
    const startingPoint = startingRoutePoints[waypointIndex];
    if (action === "commit" && (gridPoint.x !== startingPoint.x || gridPoint.y !== startingPoint.y)) {
      replaceTraceRoute(relationshipID, next);
    }
  }, [reactFlow, replaceTraceRoute]);

  const edgeFromTrace = useCallback((trace: ProcessMapTrace): ProcessMapEdge => ({
    id: trace.resource_operational_relationship_id,
    type: "processMapTrace",
    source: processMapResourceNodeID(trace.source),
    target: processMapResourceNodeID(trace.target),
    sourceHandle: "output",
    targetHandle: "input",
    data: {
      routePoints: trace.route_points.map((point) => ({ ...point })),
      committedRoutePoints: trace.route_points.map((point) => ({ ...point })),
      revision: trace.revision,
      createdTimestamp: trace.created_timestamp,
      updatedTimestamp: trace.updated_timestamp,
      onMoveWaypoint: moveTraceWaypoint,
      onReplaceRoute: replaceTraceRoute,
      getCanonicalGeneration: currentCanonicalGeneration,
    },
    selectable: true,
    focusable: true,
    deletable: false,
    zIndex: 0,
  }), [currentCanonicalGeneration, moveTraceWaypoint, replaceTraceRoute]);

  useEffect(() => {
    const layerKey = `${companyID.trim()}:${folderID?.trim() ?? ""}`;
    const layerChanged = activeLayerKeyRef.current !== layerKey;
    activeLayerKeyRef.current = layerKey;
    const requestGeneration = layerRequestGenerationRef.current + 1;
    layerRequestGenerationRef.current = requestGeneration;
    const mutationGeneration = localMutationGenerationRef.current;
    const canonicalGeneration = canonicalRefreshGenerationRef.current;
    const refreshResolvers = [...refreshResolversRef.current];
    refreshResolversRef.current.clear();
    activeLayerReadRef.current = requestGeneration;
    const controller = new AbortController();
    let responseApplied = false;
    setLoading(true);
    setError("");
    setNotice("");
    setSelection(null);
    if (layerChanged) {
      setNodes([]);
      setEdges([]);
      committedPlacementRef.current.clear();
    }
    void fetchProcessMapLayer(apiBase, companyID, folderID, controller.signal)
      .then((response) => {
        if (
          controller.signal.aborted
          || layerRequestGenerationRef.current !== requestGeneration
          || localMutationGenerationRef.current !== mutationGeneration
          || canonicalRefreshGenerationRef.current !== canonicalGeneration
          || activeLayerKeyRef.current !== layerKey
        ) return;
        const nextNodes = response.placements.map(processMapNodeFromPlacement);
        for (const node of nextNodes) {
          if (node.data.restricted) continue;
          committedPlacementRef.current.set(node.id, {
            position: { x: node.data.gridX, y: node.data.gridY },
            data: { ...node.data },
          });
        }
        setNodes(nextNodes);
        setEdges(response.traces.map(edgeFromTrace));
        onLayerChange?.(response.layer);
        responseApplied = true;
      })
      .catch((cause) => {
        if (
          controller.signal.aborted
          || isAbortError(cause)
          || layerRequestGenerationRef.current !== requestGeneration
          || localMutationGenerationRef.current !== mutationGeneration
          || canonicalRefreshGenerationRef.current !== canonicalGeneration
        ) return;
        setNodes([]);
        setEdges([]);
        committedPlacementRef.current.clear();
        onLayerChange?.(null);
        setError(processMapErrorMessage(cause, "Failed to load Process Map layer"));
      })
      .finally(() => {
        if (
          !controller.signal.aborted
          && layerRequestGenerationRef.current === requestGeneration
          && localMutationGenerationRef.current === mutationGeneration
          && canonicalRefreshGenerationRef.current === canonicalGeneration
        ) {
          if (responseApplied && activeLayerReadRef.current === requestGeneration) {
            activeLayerReadRef.current = null;
          }
          setLoading(false);
        }
        for (const resolve of refreshResolvers) resolve();
      });
    return () => {
      if (activeLayerReadRef.current === requestGeneration) activeLayerReadRef.current = null;
      controller.abort();
    };
  }, [apiBase, companyID, edgeFromTrace, folderID, onLayerChange, refreshVersion]);

  useEffect(() => {
    const clearLayer = () => {
      canonicalRefreshGenerationRef.current += 1;
      setNodes([]);
      setEdges([]);
      setSelection(null);
      committedPlacementRef.current.clear();
      onLayerChange?.(null);
      setLoading(true);
    };
    const refresh = createCoalescedCanonicalRefresh(() => {
      clearLayer();
      return requestRefresh();
    }, (cause) => {
      setError(processMapErrorMessage(cause, "Failed to refresh Process Map"));
    });
    const clearLayerAndRefresh = () => {
      invalidateProcessMapLayers(apiBase, companyID);
      clearLayer();
      refresh.request();
    };
    const unsubscribe = subscribeRealtimeScope(apiBase, companyID, PROCESS_MAP_REALTIME_SCOPE, {
      onProcessMapChanged: (message) => {
        const connectionID = getCurrentRealtimeConnectionID(apiBase, companyID);
        if (message.origin_connection_id && connectionID === message.origin_connection_id) return;
        clearLayerAndRefresh();
      },
      onAccepted: () => {
        clearLayerAndRefresh();
      },
      onRejected: clearLayerAndRefresh,
    });
    return () => {
      refresh.dispose();
      unsubscribe();
    };
  }, [apiBase, companyID, onLayerChange, requestRefresh]);

  const handleNodesChange = useCallback((changes: NodeChange<ProcessMapNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const handleEdgesChange = useCallback((changes: EdgeChange<ProcessMapEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const handleNodeDragStart = useCallback((_: MouseEvent | TouchEvent, node: ProcessMapNode) => {
    if (node.data.restricted) return;
    dragStartRef.current = {
      id: node.id,
      position: { x: node.data.gridX, y: node.data.gridY },
    };
  }, []);

  const handleNodeDragStop = useCallback((_: MouseEvent | TouchEvent, node: ProcessMapNode) => {
    if (node.data.restricted) return;
    const original = dragStartRef.current?.id === node.id ? dragStartRef.current : null;
    dragStartRef.current = null;
    const gridPosition = processMapFlowToGridPosition(node.position);
    const snappedPosition = processMapGridToFlowPosition(gridPosition);
    const optimisticData: ProcessMapNodeData = { ...node.data, gridX: gridPosition.x, gridY: gridPosition.y };
    setNodes((current) => current.map((item) => item.id === node.id
      ? { ...item, position: snappedPosition, data: optimisticData }
      : item));
    if (original && original.position.x === gridPosition.x && original.position.y === gridPosition.y) return;
    const operationGeneration = (placementOperationGenerationRef.current.get(node.id) ?? 0) + 1;
    placementOperationGenerationRef.current.set(node.id, operationGeneration);
    setError("");
    const responseGeneration = canonicalRefreshGenerationRef.current;
    void putProcessMapPlacement(apiBase, companyID, {
      resource_type: node.data.resourceType,
      resource_id: node.data.resourceID,
    }, {
      map_parent_folder_id: folderID?.trim() || null,
      grid_x: gridPosition.x,
      grid_y: gridPosition.y,
    }).then((saved) => {
      const responseWasSuperseded = !shouldApplyProcessMapMutationAck(
        responseGeneration,
        canonicalRefreshGenerationRef.current,
        operationGeneration,
        placementOperationGenerationRef.current.get(node.id) ?? 0,
      );
      const refreshQueued = markLocalMutationCommitted();
      if (responseWasSuperseded) {
        if (!refreshQueued) void requestRefresh();
        return;
      }
      setNodes((current) => current.map((item) => item.id === node.id && !item.data.restricted
        && shouldApplyProcessMapCommit(item.data.revision, saved.revision)
        ? (() => {
            const nextData: ProcessMapVisibleNodeData = {
              ...item.data,
              gridX: saved.grid_x,
              gridY: saved.grid_y,
              revision: saved.revision,
              createdTimestamp: saved.created_timestamp,
              updatedTimestamp: saved.updated_timestamp,
            };
            const nextPosition = { x: saved.grid_x, y: saved.grid_y };
            committedPlacementRef.current.set(node.id, { position: nextPosition, data: { ...nextData } });
            return { ...item, position: processMapGridToFlowPosition(nextPosition), data: nextData };
          })()
        : item));
    }).catch((cause) => {
      if (!shouldApplyProcessMapMutationAck(
        responseGeneration,
        responseGeneration,
        operationGeneration,
        placementOperationGenerationRef.current.get(node.id) ?? 0,
      )) return;
      if (canonicalRefreshGenerationRef.current !== responseGeneration) {
        setError(processMapErrorMessage(cause, "Failed to save placement"));
        void requestRefresh();
        return;
      }
      const committed = committedPlacementRef.current.get(node.id);
      if (committed) {
        setNodes((current) => current.map((item) => item.id === node.id
          ? {
              ...item,
              position: processMapGridToFlowPosition(committed.position),
              data: { ...committed.data },
            }
          : item));
      }
      setError(processMapErrorMessage(cause, "Failed to save placement"));
      void requestRefresh();
    });
  }, [apiBase, companyID, folderID, markLocalMutationCommitted, requestRefresh]);

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode || sourceNode.data.restricted || targetNode.data.restricted) return;
    const source = resourceFromNode(sourceNode);
    const target = resourceFromNode(targetNode);
    if (!source || !target) return;
    const sourceAnchor = processMapOutputAnchor(
      { x: sourceNode.data.gridX, y: sourceNode.data.gridY },
      sourceNode.data.resourceType,
    );
    const targetAnchor = processMapInputAnchor(
      { x: targetNode.data.gridX, y: targetNode.data.gridY },
      targetNode.data.resourceType,
    );
    const routePoints = defaultProcessMapRoutePoints(sourceAnchor, targetAnchor);
    const pendingID = `pending:${sourceNode.id}:${targetNode.id}`;
    setEdges((current) => [...current.filter((edge) => edge.id !== pendingID), {
      id: pendingID,
      type: "processMapTrace",
      source: sourceNode.id,
      target: targetNode.id,
      sourceHandle: "output",
      targetHandle: "input",
      data: {
        routePoints,
        committedRoutePoints: routePoints.map((point) => ({ ...point })),
        revision: 0,
        createdTimestamp: "",
        updatedTimestamp: "",
        onMoveWaypoint: moveTraceWaypoint,
        onReplaceRoute: replaceTraceRoute,
        getCanonicalGeneration: currentCanonicalGeneration,
      },
      selectable: false,
      focusable: false,
      deletable: false,
      animated: true,
      zIndex: 0,
    }]);
    setError("");
    const responseGeneration = canonicalRefreshGenerationRef.current;
    void postProcessMapRelationship(apiBase, companyID, source, target, routePoints)
      .then((response) => {
        const responseWasSuperseded = canonicalRefreshGenerationRef.current !== responseGeneration;
        const refreshQueued = markLocalMutationCommitted();
        if (response.trace) {
          const trace = { ...response.trace, source, target };
          if (
            responseWasSuperseded
            || deletedRelationshipIDsRef.current.has(trace.resource_operational_relationship_id)
          ) {
            setEdges((current) => current.filter((edge) => edge.id !== pendingID));
            if (!refreshQueued) void requestRefresh();
            return;
          }
          const committedEdge = edgeFromTrace(trace);
          setEdges((current) => {
            const withoutPending = current.filter((edge) => edge.id !== pendingID);
            const existing = withoutPending.find((edge) => edge.id === trace.resource_operational_relationship_id);
            if (existing?.data && !shouldApplyProcessMapCommit(existing.data.revision, trace.revision)) {
              return withoutPending;
            }
            return [
              ...withoutPending.filter((edge) => edge.id !== trace.resource_operational_relationship_id),
              committedEdge,
            ];
          });
        } else {
          setEdges((current) => current.filter((edge) => edge.id !== pendingID));
          if (!refreshQueued) void requestRefresh();
        }
      })
      .catch((cause) => {
        setEdges((current) => current.filter((edge) => edge.id !== pendingID));
        setError(processMapErrorMessage(cause, "Failed to create trace"));
        void requestRefresh();
      });
  }, [apiBase, companyID, currentCanonicalGeneration, edgeFromTrace, markLocalMutationCommitted, moveTraceWaypoint, nodes, replaceTraceRoute, requestRefresh]);

  const removeSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === "trace") {
      const removed = edges.find((edge) => edge.id === selection.id);
      if (!removed || removed.id.startsWith("pending:")) return;
      deletedRelationshipIDsRef.current.add(removed.id);
      setEdges((current) => current.filter((edge) => edge.id !== removed.id));
      setSelection(null);
      setError("");
      void deleteProcessMapRelationship(apiBase, companyID, removed.id)
        .then(() => {
          markLocalMutationCommitted();
          setEdges((current) => current.filter((edge) => edge.id !== removed.id));
        })
        .catch((cause) => {
          setError(processMapErrorMessage(cause, "Failed to delete trace"));
          void requestRefresh();
        });
      return;
    }
    const removed = nodes.find((node) => node.id === selection.id);
    const resource = resourceFromNode(removed);
    if (!removed || !resource) return;
    setNodes((current) => current.filter((node) => node.id !== removed.id));
    setEdges((current) => current.filter((edge) => edge.source !== removed.id && edge.target !== removed.id));
    setSelection(null);
    setError("");
    const operationGeneration = (placementOperationGenerationRef.current.get(removed.id) ?? 0) + 1;
    placementOperationGenerationRef.current.set(removed.id, operationGeneration);
    const responseGeneration = canonicalRefreshGenerationRef.current;
    void deleteProcessMapPlacement(apiBase, companyID, resource)
      .then(() => {
        const responseWasSuperseded = !shouldApplyProcessMapMutationAck(
          responseGeneration,
          canonicalRefreshGenerationRef.current,
          operationGeneration,
          placementOperationGenerationRef.current.get(removed.id) ?? 0,
        );
        const refreshQueued = markLocalMutationCommitted();
        if (responseWasSuperseded) {
          if (!refreshQueued) void requestRefresh();
          return;
        }
        setNodes((current) => current.filter((node) => node.id !== removed.id));
        setEdges((current) => current.filter((edge) => edge.source !== removed.id && edge.target !== removed.id));
      })
      .catch((cause) => {
        setError(processMapErrorMessage(cause, "Failed to remove placement"));
        void requestRefresh();
      });
  }, [apiBase, companyID, edges, markLocalMutationCommitted, nodes, requestRefresh, selection]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const payload = readExplorerDragPayload(event.dataTransfer);
    const decision = decideProcessMapExplorerDrop(payload, folderID);
    if (decision.kind === "ignore") return;
    event.preventDefault();
    event.stopPropagation();
    if (decision.kind === "reject") {
      setNotice(decision.message);
      return;
    }
    const flowPosition = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: true });
    const gridPosition = processMapFlowToGridPosition(flowPosition);
    const nodeID = processMapResourceNodeID(decision.resource);
    const operationGeneration = (placementOperationGenerationRef.current.get(nodeID) ?? 0) + 1;
    placementOperationGenerationRef.current.set(nodeID, operationGeneration);
    setNotice("Saving placement…");
    setError("");
    const responseGeneration = canonicalRefreshGenerationRef.current;
    void putProcessMapPlacement(apiBase, companyID, decision.resource, {
      map_parent_folder_id: decision.mapParentFolderID,
      grid_x: gridPosition.x,
      grid_y: gridPosition.y,
    }).then((saved) => {
      const responseWasSuperseded = !shouldApplyProcessMapMutationAck(
        responseGeneration,
        canonicalRefreshGenerationRef.current,
        operationGeneration,
        placementOperationGenerationRef.current.get(nodeID) ?? 0,
      );
      const refreshQueued = markLocalMutationCommitted();
      if (responseWasSuperseded) {
        if (operationGeneration === (placementOperationGenerationRef.current.get(nodeID) ?? 0)) setNotice("");
        if (!refreshQueued) void requestRefresh();
        return;
      }
      const placement: ProcessMapPlacement = {
        restricted: false,
        resource_type: saved.resource_type,
        resource_id: saved.resource_id,
        name: decision.label,
        grid_x: saved.grid_x,
        grid_y: saved.grid_y,
        revision: saved.revision,
        created_timestamp: saved.created_timestamp,
        updated_timestamp: saved.updated_timestamp,
      };
      const added = processMapNodeFromPlacement(placement, 0);
      const addedData = added.data;
      if (addedData.restricted) {
        void requestRefresh();
        return;
      }
      setNodes((current) => {
        const existing = current.find((node) => node.id === added.id);
        if (existing && !existing.data.restricted && !shouldApplyProcessMapCommit(existing.data.revision, addedData.revision)) {
          return current;
        }
        committedPlacementRef.current.set(added.id, {
          position: { x: addedData.gridX, y: addedData.gridY },
          data: { ...addedData },
        });
        return [...current.filter((node) => node.id !== added.id), added];
      });
      if (operationGeneration === (placementOperationGenerationRef.current.get(nodeID) ?? 0)) setNotice("");
    }).catch((cause) => {
      if (!shouldApplyProcessMapMutationAck(
        responseGeneration,
        responseGeneration,
        operationGeneration,
        placementOperationGenerationRef.current.get(nodeID) ?? 0,
      )) return;
      setNotice("");
      setError(processMapErrorMessage(cause, "Failed to add placement"));
      void requestRefresh();
    });
  }, [apiBase, companyID, folderID, markLocalMutationCommitted, reactFlow, requestRefresh]);

  const acceptsExplorerDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes(EXPLORER_DRAG_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const selectedLabel = useMemo(() => {
    if (selection?.kind === "trace") return "trace";
    if (selection?.kind !== "placement") return "";
    const node = nodes.find((item) => item.id === selection.id);
    return node && !node.data.restricted ? node.data.label : "";
  }, [nodes, selection]);

  const trayCandidates = useMemo(() => {
    const unavailableNodeIDs = new Set<string>();
    for (const node of nodes) {
      if (!node.data.restricted) unavailableNodeIDs.add(node.id);
    }
    return processMapTrayCandidates(trayRows, folderID, unavailableNodeIDs);
  }, [folderID, nodes, trayRows]);

  return (
    <section
      className="process-map-surface"
      aria-label="Process Map canvas"
      tabIndex={0}
      onKeyDown={(event) => {
        if ((event.key !== "Delete" && event.key !== "Backspace") || !selection) return;
        event.preventDefault();
        event.stopPropagation();
        removeSelection();
      }}
    >
      <div className="process-map-toolbar" aria-label="Process Map tools">
        <span>Drag a card onto the map to place it.</span>
        {selection?.kind === "trace" && <span>Double-click the trace to add a waypoint.</span>}
        {selection && (
          <button type="button" onClick={removeSelection}>
            {selection.kind === "trace" ? "Delete trace" : `Remove ${selectedLabel || "placement"}`}
          </button>
        )}
      </div>
      <aside
        className={`process-map-placement-tray${trayCollapsed ? " is-collapsed" : ""}`}
        aria-label="Process Map placement tray"
      >
        <button
          type="button"
          className="process-map-placement-tray__toggle"
          aria-expanded={!trayCollapsed}
          aria-controls={trayListID}
          title={trayCollapsed ? "Expand placement tray" : "Collapse placement tray"}
          onClick={() => {
            setTrayCollapsed((current) => {
              const next = !current;
              storeProcessMapTrayCollapsed(next);
              return next;
            });
          }}
        >
          <span className="process-map-placement-tray__heading">
            {folderID ? "Inside this Folder" : "Root Folders"}
          </span>
          {!trayCollapsed && <span className="process-map-placement-tray__hint">Drag to place</span>}
          <ExplorerDisclosureIcon open={!trayCollapsed} color="#64748b" />
        </button>
        <div id={trayListID} className="process-map-placement-tray__body" hidden={trayCollapsed}>
          {(trayLoading || loading) && <p className="process-map-placement-tray__status">Loading available items…</p>}
          {!trayLoading && !loading && trayError && (
            <p className="process-map-placement-tray__status is-error" role="alert">{trayError}</p>
          )}
          {!trayLoading && !loading && !trayError && trayCandidates.length === 0 && (
            <p className="process-map-placement-tray__status">Nothing left to place in this layer.</p>
          )}
          {!trayLoading && !loading && !trayError && trayCandidates.length > 0 && (
            <div className="process-map-placement-tray__list" role="list">
              {trayCandidates.map((candidate) => {
                const isFolder = candidate.resource.resource_type === "company_explorer_folder";
                return (
                  <div
                    key={processMapResourceNodeID(candidate.resource)}
                    className={`process-map-placement-tray__card is-${isFolder ? "folder" : "process"}`}
                    role="listitem"
                    draggable
                    aria-label={`Drag ${isFolder ? "Folder" : "Process"}: ${candidate.label}`}
                    title="Drag onto the map to place"
                    onDragStart={(event) => {
                      event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(candidate.dragPayload));
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <span className="process-map-placement-tray__icon">
                      <ExplorerRowIcon kind={isFolder ? "folder" : "logic_gate"} />
                    </span>
                    <span className="process-map-placement-tray__card-copy">
                      <span className="process-map-placement-tray__card-kind">{isFolder ? "Folder" : "Process"}</span>
                      <span className="process-map-placement-tray__card-label">{candidate.label}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
      {(error || notice) && (
        <div className={`process-map-message${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
          {error || notice}
        </div>
      )}
      {loading && <div className="process-map-loading" aria-busy="true">Loading layer…</div>}
      <ReactFlow<ProcessMapNode, ProcessMapEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onDragOver={acceptsExplorerDrop}
        onDrop={handleDrop}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={(_, node) => {
          if (node.data.restricted) return;
          setSelection({ kind: "placement", id: node.id });
          setNodes((current) => current.map((item) => ({ ...item, selected: item.id === node.id })));
          setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
        }}
        onNodeDoubleClick={(_, node) => {
          const folderTarget = processMapFolderDrillTarget(resourceFromNode(node));
          if (folderTarget) onOpenFolder(folderTarget);
        }}
        onEdgeClick={(_, edge) => {
          setSelection({ kind: "trace", id: edge.id });
          setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
          setEdges((current) => current.map((item) => ({ ...item, selected: item.id === edge.id })));
        }}
        onEdgeDoubleClick={(event, edge) => {
          event.preventDefault();
          if (!edge.data || edge.id.startsWith("pending:")) return;
          const point = processMapFlowToRoutePoint(reactFlow.screenToFlowPosition(
            { x: event.clientX, y: event.clientY },
            { snapToGrid: false },
          ));
          const sourceNode = nodes.find((node) => node.id === edge.source);
          const targetNode = nodes.find((node) => node.id === edge.target);
          if (!sourceNode || !targetNode || sourceNode.data.restricted || targetNode.data.restricted) return;
          const sourceAnchor = processMapOutputAnchor(
            { x: sourceNode.data.gridX, y: sourceNode.data.gridY },
            sourceNode.data.resourceType,
          );
          const targetAnchor = processMapInputAnchor(
            { x: targetNode.data.gridX, y: targetNode.data.gridY },
            targetNode.data.resourceType,
          );
          replaceTraceRoute(
            edge.id,
            insertProcessMapRoutePoint(sourceAnchor, edge.data.routePoints, targetAnchor, point),
          );
        }}
        onPaneClick={() => {
          setSelection(null);
          setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
          setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
        }}
        onConnect={handleConnect}
        isValidConnection={isValidProcessMapConnection}
        snapToGrid
        snapGrid={[PROCESS_MAP_GRID_PX, PROCESS_MAP_GRID_PX]}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        nodesConnectable
        nodesDraggable
        elementsSelectable
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        minZoom={0.2}
        maxZoom={2.5}
        elevateEdgesOnSelect={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          id="process-map-grid"
          variant={BackgroundVariant.Lines}
          gap={PROCESS_MAP_GRID_PX}
          lineWidth={0.5}
          color="rgba(148, 163, 184, 0.12)"
        />
      </ReactFlow>
    </section>
  );
}

export function ProcessMapSurface(props: ProcessMapSurfaceProps) {
  const layerIdentity = `${props.apiBase.trim()}\u0000${props.companyID.trim()}\u0000${props.folderID?.trim() ?? ""}`;
  return (
    <ReactFlowProvider key={layerIdentity}>
      <ProcessMapSurfaceInner {...props} />
    </ReactFlowProvider>
  );
}
