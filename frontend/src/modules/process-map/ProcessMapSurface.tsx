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
import { readExplorerDragPayload, EXPLORER_DRAG_MIME } from "../company-explorer/companyExplorerDragDrop.js";
import { createCoalescedCanonicalRefresh } from "../realtime/coalescedCanonicalRefresh.js";
import { subscribeRealtimeScope } from "../realtime/realtimeWebSocket.js";
import { isAbortError } from "../api/requestJSON.js";
import {
  deleteProcessMapPlacement,
  deleteProcessMapRelationship,
  fetchProcessMapLayer,
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
  PROCESS_MAP_LARGE_GRID_DIVISOR,
  defaultProcessMapRoutePoints,
  insertProcessMapRoutePoint,
  orthogonalizeProcessMapRoutePoints,
  processMapFlowToGridPosition,
  processMapFootprint,
  processMapGridToFlowPosition,
  processMapInputAnchor,
  processMapOutputAnchor,
  processMapTracePath,
  type ProcessMapGridPoint,
  type ProcessMapResourceType,
} from "./processMapGeometry.js";
import {
  decideProcessMapExplorerDrop,
  isValidProcessMapConnection,
  processMapFolderDrillTarget,
  processMapSelectionTarget,
  shouldApplyProcessMapCommit,
  shouldRollbackProcessMapOptimisticSave,
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
  clientPoint: ProcessMapGridPoint,
  startingRoutePoints: ProcessMapGridPoint[],
  commit: boolean,
) => void;

type ProcessMapEdgeData = {
  routePoints: ProcessMapGridPoint[];
  committedRoutePoints: ProcessMapGridPoint[];
  revision: number;
  createdTimestamp: string;
  updatedTimestamp: string;
  onMoveWaypoint: MoveTraceWaypoint;
  onReplaceRoute: ReplaceTraceRoute;
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

function resourceNodeID(resource: ProcessMapResourceRef): string {
  return `${resource.resource_type}:${resource.resource_id}`;
}

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
    id: resourceNodeID({ resource_type: placement.resource_type, resource_id: placement.resource_id }),
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

function ProcessMapTraceEdge({ id, sourceX, sourceY, targetX, targetY, selected, data }: EdgeProps<ProcessMapEdge>) {
  const routePoints = data?.routePoints ?? [];
  const path = processMapTracePath(
    { x: sourceX / PROCESS_MAP_GRID_PX, y: sourceY / PROCESS_MAP_GRID_PX },
    routePoints,
    { x: targetX / PROCESS_MAP_GRID_PX, y: targetY / PROCESS_MAP_GRID_PX },
  );
  return (
    <>
      <BaseEdge id={id} path={path} className={`process-map-trace${selected ? " is-selected" : ""}`} />
      {selected && data && (
        <EdgeLabelRenderer>
          {routePoints.map((point, index) => {
            const flowPoint = processMapGridToFlowPosition(point);
            return (
              <button
                type="button"
                key={`${index}:${point.x}:${point.y}`}
                className="nodrag nopan process-map-waypoint"
                aria-label={`Trace waypoint ${index + 1}`}
                title="Drag to move. Double-click to remove."
                style={{ transform: `translate(-50%, -50%) translate(${flowPoint.x}px, ${flowPoint.y}px)` }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  data.onReplaceRoute(id, routePoints.filter((_, routeIndex) => routeIndex !== index));
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const startingRoutePoints = routePoints.map((item) => ({ ...item }));
                  const pointerID = event.pointerId;
                  const onMove = (moveEvent: PointerEvent) => {
                    if (moveEvent.pointerId !== pointerID) return;
                    data.onMoveWaypoint(id, index, { x: moveEvent.clientX, y: moveEvent.clientY }, startingRoutePoints, false);
                  };
                  const onUp = (upEvent: PointerEvent) => {
                    if (upEvent.pointerId !== pointerID) return;
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                    window.removeEventListener("pointercancel", onUp);
                    data.onMoveWaypoint(id, index, { x: upEvent.clientX, y: upEvent.clientY }, startingRoutePoints, true);
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp);
                  window.addEventListener("pointercancel", onUp);
                }}
              />
            );
          })}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { processMapCard: ProcessMapCard };
const edgeTypes = { processMapTrace: ProcessMapTraceEdge };

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
  const reactFlow = useReactFlow<ProcessMapNode, ProcessMapEdge>();
  const dragStartRef = useRef<{ id: string; position: ProcessMapGridPoint } | null>(null);
  const layerRequestGenerationRef = useRef(0);
  const canonicalRefreshGenerationRef = useRef(0);
  const activeLayerKeyRef = useRef("");
  const refreshResolversRef = useRef(new Set<() => void>());
  const traceSaveGenerationRef = useRef(new Map<string, number>());
  const placementSaveGenerationRef = useRef(new Map<string, number>());
  const deletedRelationshipIDsRef = useRef(new Set<string>());
  const committedPlacementRef = useRef(new Map<string, {
    position: ProcessMapGridPoint;
    data: ProcessMapVisibleNodeData;
  }>());

  const requestRefresh = useCallback(() => new Promise<void>((resolve) => {
    canonicalRefreshGenerationRef.current += 1;
    refreshResolversRef.current.add(resolve);
    setRefreshVersion((version) => version + 1);
  }), []);

  useEffect(() => () => {
    for (const resolve of refreshResolversRef.current) resolve();
    refreshResolversRef.current.clear();
  }, []);

  const replaceTraceRoute = useCallback<ReplaceTraceRoute>((relationshipID, routePoints) => {
    const nextRoute = orthogonalizeProcessMapRoutePoints(routePoints);
    const saveGeneration = (traceSaveGenerationRef.current.get(relationshipID) ?? 0) + 1;
    traceSaveGenerationRef.current.set(relationshipID, saveGeneration);
    setEdges((current) => current.map((edge) => edge.id === relationshipID && edge.data
      ? { ...edge, data: { ...edge.data, routePoints: nextRoute } }
      : edge));
    setError("");
    void putProcessMapTrace(apiBase, companyID, relationshipID, nextRoute)
      .then((trace) => {
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
        if (!shouldRollbackProcessMapOptimisticSave(
          saveGeneration,
          traceSaveGenerationRef.current.get(relationshipID) ?? 0,
        )) return;
        setEdges((current) => current.map((edge) => edge.id === relationshipID && edge.data
          ? { ...edge, data: { ...edge.data, routePoints: edge.data.committedRoutePoints.map((point) => ({ ...point })) } }
          : edge));
        setError(processMapErrorMessage(cause, "Failed to save trace route"));
      });
  }, [apiBase, companyID]);

  const moveTraceWaypoint = useCallback<MoveTraceWaypoint>((relationshipID, waypointIndex, clientPoint, startingRoutePoints, commit) => {
    if (waypointIndex < 0 || waypointIndex >= startingRoutePoints.length) return;
    const flowPoint = reactFlow.screenToFlowPosition(clientPoint, { snapToGrid: true });
    const gridPoint = processMapFlowToGridPosition(flowPoint);
    const next = startingRoutePoints.map((point, index) => index === waypointIndex ? gridPoint : point);
    setEdges((current) => current.map((edge) => edge.id === relationshipID && edge.data
      ? { ...edge, data: { ...edge.data, routePoints: next } }
      : edge));
    if (commit) replaceTraceRoute(relationshipID, next);
  }, [reactFlow, replaceTraceRoute]);

  const edgeFromTrace = useCallback((trace: ProcessMapTrace): ProcessMapEdge => ({
    id: trace.resource_operational_relationship_id,
    type: "processMapTrace",
    source: resourceNodeID(trace.source),
    target: resourceNodeID(trace.target),
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
    },
    selectable: true,
    focusable: true,
    deletable: false,
    zIndex: 0,
  }), [moveTraceWaypoint, replaceTraceRoute]);

  useEffect(() => {
    const layerKey = `${companyID.trim()}:${folderID?.trim() ?? ""}`;
    const layerChanged = activeLayerKeyRef.current !== layerKey;
    activeLayerKeyRef.current = layerKey;
    const requestGeneration = layerRequestGenerationRef.current + 1;
    layerRequestGenerationRef.current = requestGeneration;
    const controller = new AbortController();
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
        if (controller.signal.aborted || layerRequestGenerationRef.current !== requestGeneration || activeLayerKeyRef.current !== layerKey) return;
        const nextNodes = response.placements.map(processMapNodeFromPlacement);
        const visibleNodeIDs = new Set(nextNodes.filter((node) => !node.data.restricted).map((node) => node.id));
        for (const node of nextNodes) {
          if (node.data.restricted) continue;
          committedPlacementRef.current.set(node.id, {
            position: { x: node.data.gridX, y: node.data.gridY },
            data: { ...node.data },
          });
        }
        setNodes(nextNodes);
        setEdges(response.traces
          .map(edgeFromTrace)
          .filter((edge) => visibleNodeIDs.has(edge.source) && visibleNodeIDs.has(edge.target)));
        onLayerChange?.(response.layer);
      })
      .catch((cause) => {
        if (controller.signal.aborted || isAbortError(cause) || layerRequestGenerationRef.current !== requestGeneration) return;
        setNodes([]);
        setEdges([]);
        committedPlacementRef.current.clear();
        onLayerChange?.(null);
        setError(processMapErrorMessage(cause, "Failed to load Process Map layer"));
      })
      .finally(() => {
        if (controller.signal.aborted || layerRequestGenerationRef.current !== requestGeneration) return;
        setLoading(false);
        for (const resolve of refreshResolversRef.current) resolve();
        refreshResolversRef.current.clear();
      });
    return () => controller.abort();
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
      clearLayer();
      refresh.request();
    };
    const unsubscribe = subscribeRealtimeScope(apiBase, companyID, PROCESS_MAP_REALTIME_SCOPE, {
      onProcessMapChanged: clearLayerAndRefresh,
      onRecover: clearLayerAndRefresh,
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
    const saveGeneration = (placementSaveGenerationRef.current.get(node.id) ?? 0) + 1;
    placementSaveGenerationRef.current.set(node.id, saveGeneration);
    setError("");
    void putProcessMapPlacement(apiBase, companyID, {
      resource_type: node.data.resourceType,
      resource_id: node.data.resourceID,
    }, {
      map_parent_folder_id: folderID?.trim() || null,
      grid_x: gridPosition.x,
      grid_y: gridPosition.y,
    }).then((saved) => {
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
      if (!shouldRollbackProcessMapOptimisticSave(
        saveGeneration,
        placementSaveGenerationRef.current.get(node.id) ?? 0,
      )) return;
      const committed = committedPlacementRef.current.get(node.id);
      if (committed) {
        setNodes((current) => current.map((item) => item.id === node.id
          ? {
              ...item,
              position: processMapGridToFlowPosition(committed.position),
              data: { ...committed.data },
            }
          : item));
      } else {
        void requestRefresh();
      }
      setError(processMapErrorMessage(cause, "Failed to save placement"));
    });
  }, [apiBase, companyID, folderID, requestRefresh]);

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
        if (response.trace) {
          const trace = { ...response.trace, source, target };
          if (
            canonicalRefreshGenerationRef.current !== responseGeneration
            || deletedRelationshipIDsRef.current.has(trace.resource_operational_relationship_id)
          ) {
            setEdges((current) => current.filter((edge) => edge.id !== pendingID));
            void requestRefresh();
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
          void requestRefresh();
        }
      })
      .catch((cause) => {
        if (canonicalRefreshGenerationRef.current !== responseGeneration) return;
        setEdges((current) => current.filter((edge) => edge.id !== pendingID));
        setError(processMapErrorMessage(cause, "Failed to create trace"));
      });
  }, [apiBase, companyID, edgeFromTrace, moveTraceWaypoint, nodes, replaceTraceRoute, requestRefresh]);

  const removeSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === "trace") {
      const removed = edges.find((edge) => edge.id === selection.id);
      if (!removed || removed.id.startsWith("pending:")) return;
      deletedRelationshipIDsRef.current.add(removed.id);
      setEdges((current) => current.filter((edge) => edge.id !== removed.id));
      setSelection(null);
      setError("");
      void deleteProcessMapRelationship(apiBase, companyID, removed.id).catch((cause) => {
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
    void deleteProcessMapPlacement(apiBase, companyID, resource).catch((cause) => {
      setError(processMapErrorMessage(cause, "Failed to remove placement"));
      void requestRefresh();
    });
  }, [apiBase, companyID, edges, nodes, requestRefresh, selection]);

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
    setNotice("Saving placement…");
    setError("");
    void putProcessMapPlacement(apiBase, companyID, decision.resource, {
      map_parent_folder_id: decision.mapParentFolderID,
      grid_x: gridPosition.x,
      grid_y: gridPosition.y,
    }).then(() => {
      setNotice("");
      void requestRefresh();
    }).catch((cause) => {
      setNotice("");
      setError(processMapErrorMessage(cause, "Failed to add placement"));
    });
  }, [apiBase, companyID, folderID, reactFlow, requestRefresh]);

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

  return (
    <section
      className="process-map-surface"
      aria-label="Process Map canvas"
      tabIndex={0}
      onDragOver={acceptsExplorerDrop}
      onDrop={handleDrop}
      onKeyDown={(event) => {
        if ((event.key !== "Delete" && event.key !== "Backspace") || !selection) return;
        event.preventDefault();
        event.stopPropagation();
        removeSelection();
      }}
    >
      <div className="process-map-toolbar" aria-label="Process Map tools">
        <span>Drag a Folder or Process from Explorer to place it.</span>
        {selection?.kind === "trace" && <span>Double-click the trace to add a waypoint.</span>}
        {selection && (
          <button type="button" onClick={removeSelection}>
            {selection.kind === "trace" ? "Delete trace" : `Remove ${selectedLabel || "placement"}`}
          </button>
        )}
      </div>
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
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={(_, node) => {
          const selectedNodeID = processMapSelectionTarget(node.id, node.data.restricted);
          if (!selectedNodeID) return;
          setSelection({ kind: "placement", id: selectedNodeID });
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
          const point = processMapFlowToGridPosition(reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: true }));
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
          id="process-map-small-grid"
          variant={BackgroundVariant.Lines}
          gap={PROCESS_MAP_GRID_PX}
          size={0.55}
          color="rgba(148, 163, 184, 0.16)"
        />
        <Background
          id="process-map-large-grid"
          variant={BackgroundVariant.Lines}
          gap={PROCESS_MAP_GRID_PX * PROCESS_MAP_LARGE_GRID_DIVISOR}
          size={1.05}
          color="rgba(100, 116, 139, 0.2)"
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
