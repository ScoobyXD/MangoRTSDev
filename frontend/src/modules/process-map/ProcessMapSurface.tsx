import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OrthographicView,
  type InteractionState,
  type Layer,
  type OrthographicViewState,
  type PickingInfo,
  type ViewStateChangeParameters,
} from "@deck.gl/core";
import { type TileLayerProps } from "@deck.gl/geo-layers";
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import DeckGL, { type DeckGLRef } from "@deck.gl/react";
import { getAuthSessionCacheGeneration } from "../../auth/cognitoAuth.js";
import { createRequestJSON, isAbortError } from "../api/requestJSON.js";
import { getQDBusinessDate, millisecondsUntilNextQDBusinessDay } from "../logic-gates/qdRatingsApi.js";
import { createCoalescedCanonicalRefresh } from "../realtime/coalescedCanonicalRefresh.js";
import { getCurrentRealtimeConnectionID, subscribeRealtimeScope } from "../realtime/realtimeWebSocket.js";
import { ProcessMapQDCard } from "./ProcessMapQDCard.js";
import { ProcessMapProtectedTileLayer, type ProcessMapValidatedTile } from "./processMapTileLayer.js";
import {
  applyProcessMapCacheValidation,
  deleteProcessMapPlacement,
  deleteProcessMapRelationship,
  fetchProcessMapScene,
  fetchProcessMapChanges,
  fetchProcessMapTile,
  invalidateProcessMapReadCaches,
  postProcessMapRelationship,
  processMapTileVersionKey,
  putProcessMapPlacement,
  putProcessMapTrace,
  type ProcessMapMutationEnvelope,
  type ProcessMapChangesResponse,
  type ProcessMapPlacement,
  type ProcessMapResourceRef,
  type ProcessMapSceneResponse,
  type ProcessMapTileResponse,
  type ProcessMapTrace,
  type ProcessMapVisiblePlacement,
} from "./processMapApi.js";
import {
  PROCESS_MAP_MAX_CAMERA_ZOOM,
  PROCESS_MAP_MAX_TILE_REQUESTS,
  PROCESS_MAP_MIN_CAMERA_ZOOM,
  PROCESS_MAP_RESTRICTED_HEIGHT,
  PROCESS_MAP_RESTRICTED_WIDTH,
  PROCESS_MAP_SETTLE_DELAY_MS,
  PROCESS_MAP_TILE_CACHE_BYTES,
  PROCESS_MAP_TILE_DEBOUNCE_MS,
  defaultProcessMapRoutePoints,
  fitProcessMapViewState,
  insertProcessMapRoutePoint,
  normalizeProcessMapRoutePoints,
  processMapDeckTileSize,
  processMapBoundsContain,
  processMapOrderFoldersForContainment,
  processMapInputAnchor,
  processMapOrthogonalPathPoints,
  processMapOutputAnchor,
  processMapPlacementBounds,
  processMapPlacementDisplayLOD,
  resizeProcessMapPlacement,
  scaleProcessMapGridPoint,
  scaleProcessMapPlacement,
  snapProcessMapGridCoordinate,
  type ProcessMapBounds,
  type ProcessMapGridPoint,
  type ProcessMapPlacementGeometry,
  type ProcessMapViewState,
} from "./processMapGeometry.js";
import {
  createProcessMapSettlementGate,
  processMapDragSelectionBounds,
  processMapPlacementsInsideBounds,
  processMapResourceNodeID,
  shouldApplyProcessMapCommit,
  shouldApplyProcessMapMutationAck,
  transparentVectorRefinementStrategy,
} from "./processMapInteraction.js";
import "./processMap.css";

const PROCESS_MAP_REALTIME_SCOPE = "process-map:company";
const COLOR_FOLDER: [number, number, number, number] = [249, 115, 22, 230];
const COLOR_PROCESS: [number, number, number, number] = [25, 240, 122, 235];
const COLOR_TRACE: [number, number, number, number] = [38, 195, 234, 220];
const PROCESS_MAP_TRACE_WIDTH_PX = 3;
const PROCESS_MAP_SELECTED_TRACE_WIDTH_PX = 4;
const COLOR_MAP_BACKGROUND: [number, number, number, number] = [255, 255, 255, 255];
const COLOR_TEXT: [number, number, number, number] = [30, 41, 59, 245];
const COLOR_PROCESS_SURFACE: [number, number, number, number] = [248, 250, 252, 252];
const COLOR_FOLDER_SURFACE: [number, number, number, number] = [255, 247, 237, 190];
const COLOR_SHADOW: [number, number, number, number] = [100, 116, 139, 42];
const COLOR_RESTRICTED_SURFACE: [number, number, number, number] = [226, 232, 240, 245];
const COLOR_RESTRICTED_BORDER: [number, number, number, number] = [100, 116, 139, 210];
const COLOR_SELECTION: [number, number, number, number] = [14, 165, 233, 255];
const COLOR_SELECTION_SURFACE: [number, number, number, number] = [14, 165, 233, 28];
const COLOR_SCORE_GREEN: [number, number, number, number] = [104, 184, 78, 255];
const COLOR_SCORE_YELLOW: [number, number, number, number] = [242, 193, 79, 255];
const COLOR_SCORE_RED: [number, number, number, number] = [223, 83, 83, 255];
const COLOR_SCORE_NEUTRAL: [number, number, number, number] = [100, 116, 139, 255];
const COLOR_RESPONSIBLE: [number, number, number, number] = [240, 138, 36, 255];
const COLOR_ACCOUNTABLE: [number, number, number, number] = [25, 200, 121, 255];

type ProcessMapSingularSelection = { kind: "placement" | "trace"; id: string };
type ProcessMapSelection = ProcessMapSingularSelection | { kind: "placements"; ids: ReadonlySet<string> } | null;
type ProcessMapSelectionTileCoverage = {
  identity: string;
  readVersion: number;
  tileIDs: Set<string>;
};
type PlacementPick = { kind: "placement"; key: string; placement: ProcessMapVisiblePlacement };
type TracePick = { kind: "trace"; id: string; trace: ProcessMapTrace };
type AnchorPick = {
  kind: "anchor";
  anchor: "input" | "output";
  key: string;
  placement: ProcessMapVisiblePlacement;
};
type ResizePick = {
  kind: "resize";
  horizontal: "west" | "east";
  vertical: "north" | "south";
  key: string;
  placement: ProcessMapVisiblePlacement;
};
type WaypointPick = { kind: "waypoint"; id: string; index: number; trace: ProcessMapTrace };
type ProcessMapPick = PlacementPick | TracePick | AnchorPick | ResizePick | WaypointPick;

function processMapResizeCursor(horizontal: ResizePick["horizontal"], vertical: ResizePick["vertical"]): "nwse-resize" | "nesw-resize" {
  return (horizontal === "west") === (vertical === "north") ? "nwse-resize" : "nesw-resize";
}

export type ProcessMapPresentationState = {
  placements: Map<string, ProcessMapVisiblePlacement>;
  traces: Map<string, ProcessMapTrace>;
  removedPlacementKeys: Set<string>;
};

export type ProcessMapEditOverlayModel = {
  placements: ProcessMapVisiblePlacement[];
  traces: ProcessMapTrace[];
  selectedPlacementKey: string | null;
  selectedPlacementKeys?: ReadonlySet<string>;
  hoveredPlacementKey: string | null;
  selectedTraceID: string | null;
  connectionPreview: { source: ProcessMapVisiblePlacement; point: ProcessMapGridPoint } | null;
  highlightedFolderKey: string | null;
  connectionSourceKey: string | null;
  placementTransform: ProcessMapPlacementTransform | null;
  dragSelectionBounds?: ProcessMapBounds | null;
};

export type ProcessMapPlacementTransform = {
  kind: "move" | "resize";
  key: string;
  placementKeys: ReadonlySet<string>;
  traceIDs: ReadonlySet<string>;
  basePlacements: ReadonlyMap<string, ProcessMapVisiblePlacement>;
  deltaX: number;
  deltaY: number;
  horizontal?: "west" | "east";
  vertical?: "north" | "south";
};

export type ProcessMapTileLoadRequest = {
  tileID: string;
  z: number;
  x: number;
  y: number;
  signal?: AbortSignal;
};

export type ProcessMapLayerBuildOptions = {
  scene: ProcessMapSceneResponse;
  protectedGeneration: number;
  scoreCardBusinessDate: string;
  validatedTiles: ReadonlyMap<string, ProcessMapValidatedTile> | null;
  settled: boolean;
  settledPixelsPerGridUnit: number;
  presentation: ProcessMapPresentationState;
  folderChildTops: ReadonlyMap<string, readonly ProcessMapVisiblePlacement[]>;
  editedPlacementKeys: ReadonlySet<string>;
  editedTraceIDs: ReadonlySet<string>;
  editOverlay: ProcessMapEditOverlayModel;
  getTileData: (request: ProcessMapTileLoadRequest) => Promise<ProcessMapTileResponse | null>;
  onTileLoad: (tileID: string, data: ProcessMapTileResponse, protectedGeneration: number) => void;
  onTileUnload: (tileID: string, readVersion: number, protectedGeneration: number) => void;
  onViewportLoad?: (protectedGeneration: number) => void;
  onTileError?: (cause: unknown) => void;
};

type ProcessMapSpatialLayerBuildOptions = Omit<ProcessMapLayerBuildOptions, "presentation" | "folderChildTops" | "editOverlay" | "settled"> & {
  selectedPlacementKey: string | null;
  selectedTraceID: string | null;
};

type ProcessMapSpatialLayers = {
  background: Layer;
  tile: Layer | null;
};

export type ProcessMapSurfaceProps = {
  apiBase: string;
  companyID: string;
  hoverModeEnabled?: boolean;
  onOpenLogicGate: (logicGateID: string, label: string) => void;
};

type PlacementGesture = {
  kind: "move" | "resize";
  key: string;
  start: ProcessMapGridPoint;
  basePlacements: Map<string, ProcessMapVisiblePlacement>;
  basePlacementKeys: ReadonlySet<string>;
  baseTraces: Map<string, ProcessMapTrace>;
  baseTraceIDs: ReadonlySet<string>;
  deltaX: number;
  deltaY: number;
  horizontal?: "west" | "east";
  vertical?: "north" | "south";
  moved: boolean;
};
type DragSelectionGesture = {
  kind: "drag-selection";
  start: ProcessMapGridPoint;
  point: ProcessMapGridPoint;
};
type ProcessMapDragStartEvent = {
  stopPropagation: () => void;
  shiftKey?: boolean;
  srcEvent?: { shiftKey?: boolean };
};
type ConnectionGesture = {
  kind: "connection";
  source: ProcessMapVisiblePlacement;
  point: ProcessMapGridPoint;
  moved: boolean;
};
type WaypointGesture = {
  kind: "waypoint";
  trace: ProcessMapTrace;
  index: number;
  startingRoute: ProcessMapGridPoint[];
  moved: boolean;
};
type ProcessMapGesture = PlacementGesture | DragSelectionGesture | ConnectionGesture | WaypointGesture;
type TileBounds = { minX: number; minY: number; maxX: number; maxY: number };
type PolygonDatum = {
  polygon: number[][];
  fill: [number, number, number, number];
  line: [number, number, number, number];
  lineWidth: number;
  pick?: ProcessMapPick;
};
type PathDatum = {
  path: number[][];
  color: [number, number, number, number];
  width: number;
  pick?: ProcessMapPick;
};
type TextDatum = {
  position: [number, number];
  text: string;
  size: number;
  contentBox?: [number, number, number, number];
  color?: [number, number, number, number];
  textAnchor?: "start" | "middle" | "end";
  alignmentBaseline?: "top" | "center" | "bottom";
  pick?: ProcessMapPick;
};
type PointDatum = {
  position: [number, number];
  radius: number;
  fill: [number, number, number, number];
  line: [number, number, number, number];
  pick?: ProcessMapPick;
};

function placementKey(resource: ProcessMapResourceRef): string {
  return processMapResourceNodeID(resource);
}

function processMapSelectionIdentity(selection: ProcessMapSingularSelection): string {
  return `${selection.kind}\u0000${selection.id}`;
}

function processMapTileContainsSelection(tile: ProcessMapTileResponse, selection: ProcessMapSingularSelection): boolean {
  return selection.kind === "placement"
    ? tile.placements.some((placement) => !placement.restricted && placementKey(placement) === selection.id)
    : tile.traces.some((trace) => trace.resource_operational_relationship_id === selection.id);
}

function processMapSelectionTileCoverage(
  tiles: ReadonlyMap<string, ProcessMapTileResponse>,
  selection: ProcessMapSingularSelection,
): ProcessMapSelectionTileCoverage | null {
  let readVersion = -1;
  const tileIDs = new Set<string>();
  for (const [tileID, tile] of tiles) {
    if (!processMapTileContainsSelection(tile, selection)) continue;
    if (tile.process_map_read_version > readVersion) {
      readVersion = tile.process_map_read_version;
      tileIDs.clear();
    }
    if (tile.process_map_read_version === readVersion) tileIDs.add(tileID);
  }
  return tileIDs.size > 0 ? { identity: processMapSelectionIdentity(selection), readVersion, tileIDs } : null;
}

function isProcessMapPick(value: unknown): value is ProcessMapPick {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "placement" || kind === "trace" || kind === "anchor" || kind === "resize" || kind === "waypoint";
}

function pickFromObject(value: unknown): ProcessMapPick | null {
  if (isProcessMapPick(value)) return value;
  if (!value || typeof value !== "object") return null;
  const pick = (value as { pick?: unknown }).pick;
  return isProcessMapPick(pick) ? pick : null;
}

function clonePlacement(placement: ProcessMapVisiblePlacement): ProcessMapVisiblePlacement {
  return { ...placement };
}

function cloneTrace(trace: ProcessMapTrace): ProcessMapTrace {
  return {
    ...trace,
    source: { ...trace.source },
    target: { ...trace.target },
    route_points: trace.route_points.map((point) => ({ ...point })),
    path_fragments: trace.path_fragments.map((fragment) => fragment.map((point) => ({ ...point }))),
  };
}

function tracePath(
  trace: ProcessMapTrace,
  placements: ReadonlyMap<string, ProcessMapVisiblePlacement>,
): ProcessMapGridPoint[] | null {
  if (trace.presentation !== "editing") return null;
  const source = placements.get(placementKey(trace.source));
  const target = placements.get(placementKey(trace.target));
  return source && target
    ? processMapOrthogonalPathPoints(processMapOutputAnchor(source), trace.route_points, processMapInputAnchor(target))
    : null;
}

export function applyProcessMapMutationEnvelope(
  current: ProcessMapPresentationState,
  envelope: ProcessMapMutationEnvelope,
  pending: ReadonlyMap<string, ProcessMapVisiblePlacement> = new Map(),
): ProcessMapPresentationState {
  const placements = new Map([...current.placements].map(([key, placement]) => [key, clonePlacement(placement)]));
  const traces = new Map([...current.traces].map(([id, trace]) => [id, cloneTrace(trace)]));
  const removedPlacementKeys = new Set(current.removedPlacementKeys);
  for (const committed of envelope.placements) {
    const key = placementKey(committed);
    const existing = pending.get(key) ?? placements.get(key);
    if (!existing || !shouldApplyProcessMapCommit(existing.revision, committed.revision)) continue;
    placements.set(key, {
      ...existing,
      map_parent_folder_id: committed.map_parent_folder_id,
      grid_x: committed.grid_x,
      grid_y: committed.grid_y,
      grid_width: committed.grid_width,
      grid_height: committed.grid_height,
      revision: committed.revision,
      created_timestamp: committed.created_timestamp,
      updated_timestamp: committed.updated_timestamp,
    });
    removedPlacementKeys.delete(key);
  }
  for (const committed of envelope.traces) {
    const existing = traces.get(committed.resource_operational_relationship_id);
    const relationship = envelope.relationship?.resource_operational_relationship_id === committed.resource_operational_relationship_id
      ? envelope.relationship
      : null;
    if (!existing && !relationship) continue;
    if (existing && !shouldApplyProcessMapCommit(existing.revision, committed.revision)) continue;
    const source = existing?.source ?? relationship?.source;
    const target = existing?.target ?? relationship?.target;
    if (!source || !target) continue;
    const next: ProcessMapTrace = {
      presentation: existing?.presentation ?? "editing",
      resource_operational_relationship_id: committed.resource_operational_relationship_id,
      source: { ...source },
      target: { ...target },
      route_points: committed.route_points.map((point) => ({ ...point })),
      path_fragments: existing?.path_fragments.map((fragment) => fragment.map((point) => ({ ...point }))) ?? [],
      revision: committed.revision,
      created_timestamp: committed.created_timestamp,
      updated_timestamp: committed.updated_timestamp,
    };
    const fullPath = tracePath(next, new Map([...pending, ...placements]));
    if (fullPath) next.path_fragments = [fullPath];
    traces.set(next.resource_operational_relationship_id, next);
  }
  for (const deletedTraceID of envelope.deleted_trace_ids) traces.delete(deletedTraceID);
  return { placements, traces, removedPlacementKeys };
}

function emptyPresentation(): ProcessMapPresentationState {
  return { placements: new Map(), traces: new Map(), removedPlacementKeys: new Set() };
}

export type ProcessMapViewportTile = {
  isLoaded: boolean;
  content?: ProcessMapTileResponse | null;
};

export function processMapViewportHasCompleteCoverage(
  tiles: readonly ProcessMapViewportTile[],
  processMapReadVersion: number,
): boolean {
  return tiles.length > 0 && tiles.every((tile) => (
    tile.isLoaded
    && tile.content != null
    && tile.content.process_map_read_version === processMapReadVersion
  ));
}

export type ProcessMapMutationMasks = {
  committedOverlay: ProcessMapPresentationState;
  removedTraceIDs: Set<string>;
};

export function retireProcessMapMutationMasks(
  current: ProcessMapMutationMasks,
  completeCoverage: boolean,
): ProcessMapMutationMasks {
  if (!completeCoverage) return current;
  return { committedOverlay: emptyPresentation(), removedTraceIDs: new Set() };
}

export function processMapCurrentOperationKeys(
  keys: Iterable<string>,
  expectedGenerations: ReadonlyMap<string, number> | undefined,
  currentGenerations: ReadonlyMap<string, number>,
  operationPrefix = "",
): Set<string> {
  const currentKeys = new Set<string>();
  for (const key of keys) {
    if (!expectedGenerations) {
      currentKeys.add(key);
      continue;
    }
    const operationKey = `${operationPrefix}${key}`;
    const expected = expectedGenerations.get(operationKey);
    if (expected !== undefined && currentGenerations.get(operationKey) === expected) currentKeys.add(key);
  }
  return currentKeys;
}

export function replaceProcessMapPreviewEntries<T>(
  current: ReadonlyMap<string, T>,
  ownedKeys: Iterable<string>,
  replacements: ReadonlyMap<string, T>,
): Map<string, T> {
  const next = new Map(current);
  for (const key of ownedKeys) next.delete(key);
  for (const [key, value] of replacements) next.set(key, value);
  return next;
}

function processMapPresentationRank(value: ProcessMapTrace["presentation"]): number {
  return value === "editing" ? 2 : value === "normal" ? 1 : 0;
}

function mergeTilePresentation(tiles: ReadonlyMap<string, ProcessMapTileResponse>): ProcessMapPresentationState {
  const placements = new Map<string, ProcessMapVisiblePlacement>();
  const traces = new Map<string, ProcessMapTrace>();
  const fragmentKeys = new Map<string, Set<string>>();
  for (const tile of tiles.values()) {
    for (const placement of tile.placements) {
      if (placement.restricted) continue;
      const key = placementKey(placement);
      const current = placements.get(key);
      if (
        !current
        || placement.revision > current.revision
        || (placement.revision === current.revision && processMapPresentationRank(placement.presentation) > processMapPresentationRank(current.presentation))
      ) placements.set(key, clonePlacement(placement));
    }
    for (const trace of tile.traces) {
      const id = trace.resource_operational_relationship_id;
      const current = traces.get(id);
      if (
        !current
        || trace.revision > current.revision
        || (trace.revision === current.revision && processMapPresentationRank(trace.presentation) > processMapPresentationRank(current.presentation))
      ) {
        traces.set(id, { ...cloneTrace(trace), path_fragments: [] });
        fragmentKeys.set(id, new Set());
      }
      const merged = traces.get(id);
      const seen = fragmentKeys.get(id);
      if (!merged || !seen || merged.revision !== trace.revision) continue;
      for (const fragment of trace.path_fragments) {
        const key = fragment.map((point) => `${point.x},${point.y}`).join(";");
        if (seen.has(key)) continue;
        seen.add(key);
        merged.path_fragments.push(fragment.map((point) => ({ ...point })));
      }
    }
  }
  return { placements, traces, removedPlacementKeys: new Set() };
}

export function mergeProcessMapPresentation(
  base: ProcessMapPresentationState,
  committed: ProcessMapPresentationState,
  previewPlacements: ReadonlyMap<string, ProcessMapVisiblePlacement>,
  previewTraces: ReadonlyMap<string, ProcessMapTrace>,
  removedTraceIDs: ReadonlySet<string>,
): ProcessMapPresentationState {
  const placements = new Map(base.placements);
  for (const entry of committed.placements) placements.set(...entry);
  for (const entry of previewPlacements) placements.set(...entry);
  for (const key of committed.removedPlacementKeys) placements.delete(key);
  const traces = new Map(base.traces);
  for (const entry of committed.traces) traces.set(...entry);
  for (const entry of previewTraces) traces.set(...entry);
  for (const id of removedTraceIDs) traces.delete(id);
  return { placements, traces, removedPlacementKeys: new Set(committed.removedPlacementKeys) };
}

export function validateProcessMapLoadedTiles(
  tiles: ReadonlyMap<string, ProcessMapTileResponse>,
  changes: ProcessMapChangesResponse,
): Map<string, ProcessMapValidatedTile> {
  const result = new Map<string, ProcessMapValidatedTile>();
  if (changes.protected_geometry_changed) return result;
  const validated = new Set(changes.validated_tiles.map(processMapTileVersionKey));
  for (const [id, previous] of tiles) {
    if (validated.has(processMapTileVersionKey(previous))) {
      result.set(id, { previous, current: { ...previous, process_map_read_version: changes.process_map_read_version } });
    }
  }
  return result;
}

function tileBounds(bounds: [number[], number[]]): TileBounds {
  return {
    minX: Math.min(bounds[0][0], bounds[1][0]),
    minY: Math.min(bounds[0][1], bounds[1][1]),
    maxX: Math.max(bounds[0][0], bounds[1][0]),
    maxY: Math.max(bounds[0][1], bounds[1][1]),
  };
}

function clipRectangle(bounds: ProcessMapBounds, tile: TileBounds): ProcessMapBounds | null {
  const clipped = {
    min_x: Math.max(bounds.min_x, tile.minX),
    min_y: Math.max(bounds.min_y, tile.minY),
    max_x: Math.min(bounds.max_x, tile.maxX),
    max_y: Math.min(bounds.max_y, tile.maxY),
  };
  return clipped.max_x > clipped.min_x && clipped.max_y > clipped.min_y ? clipped : null;
}

function boundsPolygon(bounds: ProcessMapBounds): number[][] {
  return [
    [bounds.min_x, bounds.min_y],
    [bounds.max_x, bounds.min_y],
    [bounds.max_x, bounds.max_y],
    [bounds.min_x, bounds.max_y],
  ];
}

function ownsCoordinate(point: ProcessMapGridPoint, tile: TileBounds): boolean {
  return point.x >= tile.minX && point.x < tile.maxX && point.y >= tile.minY && point.y < tile.maxY;
}

export function processMapPerimeterSegments(bounds: ProcessMapBounds, tile: TileBounds): number[][][] {
  const result: number[][][] = [];
  const horizontal = (y: number, edge: "min" | "max") => {
    const owned = edge === "min"
      ? y >= tile.minY && y < tile.maxY
      : y > tile.minY && y <= tile.maxY;
    if (!owned) return;
    const start = Math.max(bounds.min_x, tile.minX);
    const end = Math.min(bounds.max_x, tile.maxX);
    if (end > start) result.push([[start, y], [end, y]]);
  };
  const vertical = (x: number, edge: "min" | "max") => {
    const owned = edge === "min"
      ? x >= tile.minX && x < tile.maxX
      : x > tile.minX && x <= tile.maxX;
    if (!owned) return;
    const start = Math.max(bounds.min_y, tile.minY);
    const end = Math.min(bounds.max_y, tile.maxY);
    if (end > start) result.push([[x, start], [x, end]]);
  };
  horizontal(bounds.min_y, "min");
  horizontal(bounds.max_y, "max");
  vertical(bounds.min_x, "min");
  vertical(bounds.max_x, "max");
  return result;
}

function staticTracePaths(
  fragments: readonly ProcessMapGridPoint[][],
  width: number,
  pick?: ProcessMapPick,
): PathDatum[] {
  return fragments.filter((fragment) => fragment.length >= 2).map((fragment) => ({
    path: fragment.map((point) => [point.x, point.y] as [number, number]),
    color: COLOR_TRACE,
    width,
    pick,
  }));
}

function tracePaths(trace: ProcessMapTrace, width = PROCESS_MAP_TRACE_WIDTH_PX): PathDatum[] {
  const pick: TracePick = { kind: "trace", id: trace.resource_operational_relationship_id, trace };
  return staticTracePaths(trace.path_fragments, width, pick);
}

function placementBounds(placement: ProcessMapPlacement): ProcessMapBounds {
  return placement.restricted ? {
    min_x: placement.grid_x,
    min_y: placement.grid_y,
    max_x: placement.grid_x + PROCESS_MAP_RESTRICTED_WIDTH,
    max_y: placement.grid_y + PROCESS_MAP_RESTRICTED_HEIGHT,
  } : processMapPlacementBounds(placement);
}

const PROCESS_MAP_LABEL_INSET_PX = 6;
const PROCESS_MAP_UNCLIPPED_TEXT_BOX: [number, number, number, number] = [0, 0, -1, -1];

function processMapPlacementLabelContentBox(
  bounds: ProcessMapBounds,
  position: [number, number],
  pixelsPerGridUnit: number,
): [number, number, number, number] {
  const inset = PROCESS_MAP_LABEL_INSET_PX / Math.max(Number.MIN_VALUE, pixelsPerGridUnit);
  return [
    bounds.min_x + inset - position[0],
    0,
    Math.max(0, bounds.max_x - bounds.min_x - inset * 2),
    -1,
  ];
}

function processMapFolderLabelY(
  bounds: ProcessMapBounds,
  pixelsPerGridUnit: number,
  editing: boolean,
  labelSize: number,
  childTop: number | undefined,
): number | null {
  const scale = Math.max(Number.MIN_VALUE, pixelsPerGridUnit);
  const titleBandHeight = Math.min(
    Math.max(1, Math.floor((bounds.max_y - bounds.min_y) / 8)),
    childTop === undefined ? Number.POSITIVE_INFINITY : childTop - bounds.min_y,
  );
  if (titleBandHeight * scale < labelSize) return null;
  const preferredOffset = (editing ? 18 : 10) / scale;
  return bounds.min_y + Math.min(titleBandHeight / 2, preferredOffset);
}

function processMapChildTopByFolder(
  placements: Iterable<ProcessMapPlacement>,
  transform: ProcessMapPlacementTransform | null,
): Map<string, number> {
  const childTopByFolder = new Map<string, number>();
  for (const placement of placements) {
    if (placement.restricted || !placement.map_parent_folder_id) continue;
    const geometry = processMapPlacementGeometryForTransform(placement, transform);
    const parentID = placement.map_parent_folder_id;
    childTopByFolder.set(parentID, Math.min(childTopByFolder.get(parentID) ?? Number.POSITIVE_INFINITY, geometry.grid_y));
  }
  return childTopByFolder;
}

// Only the two lowest direct children are needed: a gesture transforms either
// every child of a moved Folder, or just its root among unchanged siblings.
export function processMapFolderChildTops(placements: Iterable<ProcessMapVisiblePlacement>): Map<string, ProcessMapVisiblePlacement[]> {
  const result = new Map<string, ProcessMapVisiblePlacement[]>();
  for (const placement of placements) {
    if (!placement.map_parent_folder_id) continue;
    const children = result.get(placement.map_parent_folder_id) ?? [];
    if (!children[0] || placement.grid_y < children[0].grid_y) children.unshift(placement);
    else if (!children[1] || placement.grid_y < children[1].grid_y) children.splice(1, 0, placement);
    if (children.length > 2) children.length = 2;
    result.set(placement.map_parent_folder_id, children);
  }
  return result;
}

function processMapOverlayChildTop(folderID: string, options: ProcessMapLayerBuildOptions): number | undefined {
  const children = options.folderChildTops.get(folderID);
  if (!children?.length) return undefined;
  const transform = options.editOverlay.placementTransform;
  const root = transform?.basePlacements.get(transform.key);
  if (root?.map_parent_folder_id === folderID) {
    const unchanged = children.find((child) => placementKey(child) !== transform!.key);
    return Math.min(unchanged?.grid_y ?? Infinity, processMapPlacementGeometryForTransform(root, transform).grid_y);
  }
  return processMapPlacementGeometryForTransform(children[0], transform).grid_y;
}

function scoreCardTextColor(rating: "green" | "yellow" | "red" | null | undefined): [number, number, number, number] {
  if (rating === "green") return COLOR_SCORE_GREEN;
  if (rating === "yellow") return COLOR_SCORE_YELLOW;
  if (rating === "red") return COLOR_SCORE_RED;
  return COLOR_SCORE_NEUTRAL;
}

const PROCESS_MAP_ASSIGNMENT_SUMMARY_MAX_CHARS = 13;

function processMapAssignmentSummary(names: string[] | undefined): string {
  if (!names?.length) return "Unassigned";
  let summary = "";
  for (let index = 0; index < names.length; index += 1) {
    const candidate = summary ? `${summary}, ${names[index]}` : names[index];
    const remaining = names.length - index - 1;
    const suffix = remaining > 0 ? ` +${remaining}` : "";
    if (candidate.length + suffix.length <= PROCESS_MAP_ASSIGNMENT_SUMMARY_MAX_CHARS) {
      summary = candidate;
      continue;
    }
    if (summary) return `${summary} +${names.length - index}`;
    const visibleLength = Math.max(1, PROCESS_MAP_ASSIGNMENT_SUMMARY_MAX_CHARS - suffix.length - 1);
    return `${names[index].slice(0, visibleLength)}…${suffix}`;
  }
  return summary;
}

function processCardTextDatums(
  placement: ProcessMapVisiblePlacement,
  geometry: ProcessMapPlacementGeometry,
  bounds: ProcessMapBounds,
  pixelsPerGridUnit: number,
  pick: PlacementPick,
): TextDatum[] {
  if (
    placement.resource_type !== "logic_gate"
    || processMapPlacementDisplayLOD({
      grid_width: geometry.grid_width,
      grid_height: geometry.grid_height,
      presentation: placement.presentation,
    }, pixelsPerGridUnit) !== "editing"
  ) return [];
  const scale = Math.max(Number.MIN_VALUE, pixelsPerGridUnit);
  const top = bounds.min_y + 7 / scale;
  const left = bounds.min_x + 8 / scale;
  const right = bounds.max_x - 8 / scale;
  const roleLeft = Math.max(left + 48 / scale, right - 104 / scale);
  const roleNameLeft = roleLeft + 16 / scale;
  const responsibleNames = processMapAssignmentSummary(placement.responsible_names);
  const accountableNames = processMapAssignmentSummary(placement.accountable_names);
  const scoreCard = placement.score_card;
  const cardText: TextDatum[] = [
    { position: [left, top], text: "Q", size: 14, color: scoreCardTextColor(scoreCard?.quality_rating), textAnchor: "start", alignmentBaseline: "top", pick },
    { position: [left + 17 / scale, top], text: "C", size: 14, color: scoreCardTextColor(scoreCard?.cost_rating), textAnchor: "start", alignmentBaseline: "top", pick },
    { position: [left + 34 / scale, top], text: "D", size: 14, color: scoreCardTextColor(scoreCard?.delivery_rating), textAnchor: "start", alignmentBaseline: "top", pick },
    { position: [roleLeft, top], text: "R", size: 13, color: COLOR_RESPONSIBLE, textAnchor: "start", alignmentBaseline: "top", pick },
    { position: [roleNameLeft, top], text: responsibleNames, size: 11, color: COLOR_TEXT, textAnchor: "start", alignmentBaseline: "top", pick },
    { position: [roleLeft, top + 15 / scale], text: "A", size: 13, color: COLOR_ACCOUNTABLE, textAnchor: "start", alignmentBaseline: "top", pick },
    { position: [roleNameLeft, top + 15 / scale], text: accountableNames, size: 11, color: COLOR_TEXT, textAnchor: "start", alignmentBaseline: "top", pick },
  ];
  return cardText.map((item) => ({
    ...item,
    contentBox: processMapPlacementLabelContentBox(bounds, item.position, pixelsPerGridUnit),
  }));
}

function processMapTextLayer(id: string, data: TextDatum[]): TextLayer<TextDatum> {
  return new TextLayer<TextDatum>({
    id,
    data,
    pickable: true,
    billboard: true,
    sizeUnits: "pixels",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontWeight: 700,
    getPosition: (item) => item.position,
    getText: (item) => item.text,
    getSize: (item) => item.size,
    getContentBox: (item) => item.contentBox ?? PROCESS_MAP_UNCLIPPED_TEXT_BOX,
    getColor: (item) => item.color ?? COLOR_TEXT,
    getTextAnchor: (item) => item.textAnchor ?? "middle",
    getAlignmentBaseline: (item) => item.alignmentBaseline ?? "center",
  });
}

function processShadowBounds(bounds: ProcessMapBounds, pixelsPerGridUnit: number): ProcessMapBounds {
  const scale = Math.max(Number.MIN_VALUE, pixelsPerGridUnit);
  const spread = 1 / scale;
  const offset = 3 / scale;
  return {
    min_x: bounds.min_x - spread + offset,
    min_y: bounds.min_y - spread + offset,
    max_x: bounds.max_x + spread + offset,
    max_y: bounds.max_y + spread + offset,
  };
}

function renderTileSubLayers(
  props: Parameters<NonNullable<TileLayerProps<ProcessMapTileResponse>["renderSubLayers"]>>[0],
  options: ProcessMapSpatialLayerBuildOptions,
): Layer[] {
  if (!props.data) return [];
  const tile = tileBounds(props.tile.boundingBox);
  const childTopByFolder = processMapChildTopByFolder(props.data.placements, null);
  const folderShadows: PolygonDatum[] = [];
  const folderSurfaces: PolygonDatum[] = [];
  const fences: PathDatum[] = [];
  const traces: PathDatum[] = [];
  const processShadows: PolygonDatum[] = [];
  const bodies: PolygonDatum[] = [];
  const restricted: PolygonDatum[] = [];
  const processPerimeters: PathDatum[] = [];
  const restrictedPerimeters: PathDatum[] = [];
  const labels: TextDatum[] = [];
  const processCardText: TextDatum[] = [];
  for (const placement of props.data.placements) {
    const bounds = placementBounds(placement);
    const clipped = clipRectangle(bounds, tile);
    if (!clipped) continue;
    if (placement.restricted) {
      restricted.push({ polygon: boundsPolygon(clipped), fill: COLOR_RESTRICTED_SURFACE, line: COLOR_RESTRICTED_BORDER, lineWidth: 0 });
      for (const path of processMapPerimeterSegments(bounds, tile)) restrictedPerimeters.push({ path, color: COLOR_RESTRICTED_BORDER, width: 1 });
      const center = { x: (bounds.min_x + bounds.max_x) / 2, y: (bounds.min_y + bounds.max_y) / 2 };
      if (ownsCoordinate(center, tile)) labels.push({ position: [center.x, center.y], text: "?", size: 13 });
      continue;
    }
    const key = placementKey(placement);
    if (options.editedPlacementKeys.has(key) || options.selectedPlacementKey === key) continue;
    const pick: PlacementPick = { kind: "placement", key, placement };
    const lod = processMapPlacementDisplayLOD(placement, options.settledPixelsPerGridUnit);
    if (placement.resource_type === "company_explorer_folder") {
      const shadow = clipRectangle(processShadowBounds(bounds, options.settledPixelsPerGridUnit), tile);
      if (shadow) folderShadows.push({ polygon: boundsPolygon(shadow), fill: COLOR_SHADOW, line: COLOR_SHADOW, lineWidth: 0 });
      folderSurfaces.push({ polygon: boundsPolygon(clipped), fill: COLOR_FOLDER_SURFACE, line: COLOR_FOLDER, lineWidth: 0 });
      for (const path of processMapPerimeterSegments(bounds, tile)) fences.push({ path, color: COLOR_FOLDER, width: lod === "editing" ? 2.5 : 1.5, pick });
    } else {
      if (lod !== "whole") {
        const shadow = clipRectangle(processShadowBounds(bounds, options.settledPixelsPerGridUnit), tile);
        if (shadow) processShadows.push({ polygon: boundsPolygon(shadow), fill: COLOR_SHADOW, line: COLOR_SHADOW, lineWidth: 0 });
      }
      bodies.push({
        polygon: boundsPolygon(clipped),
        fill: COLOR_PROCESS_SURFACE,
        line: COLOR_PROCESS,
        lineWidth: 0,
        pick,
      });
      for (const path of processMapPerimeterSegments(bounds, tile)) processPerimeters.push({ path, color: COLOR_PROCESS, width: lod === "editing" ? 2.5 : 1.5, pick });
    }
    const center = { x: (bounds.min_x + bounds.max_x) / 2, y: (bounds.min_y + bounds.max_y) / 2 };
    if (lod !== "whole") {
      const labelSize = lod === "editing" ? 13 : 11;
      const folderLabelY = placement.resource_type === "company_explorer_folder"
        ? processMapFolderLabelY(bounds, options.settledPixelsPerGridUnit, lod === "editing", labelSize, childTopByFolder.get(placement.resource_id))
        : null;
      if (placement.resource_type !== "company_explorer_folder" || folderLabelY !== null) {
        const labelPosition: [number, number] = placement.resource_type === "company_explorer_folder"
          ? [center.x, folderLabelY!]
          : [center.x, center.y];
        if (ownsCoordinate({ x: labelPosition[0], y: labelPosition[1] }, tile)) labels.push({
          position: labelPosition,
          text: placement.name,
          size: labelSize,
          contentBox: processMapPlacementLabelContentBox(bounds, labelPosition, options.settledPixelsPerGridUnit),
          pick,
        });
      }
    }
    processCardText.push(...processCardTextDatums(placement, placement, bounds, options.settledPixelsPerGridUnit, pick).filter((item) => (
      ownsCoordinate({ x: item.position[0], y: item.position[1] }, tile)
    )));
  }
  for (const trace of props.data.traces) {
    const id = trace.resource_operational_relationship_id;
    if (!options.editedTraceIDs.has(id) && options.selectedTraceID !== id) traces.push(...tracePaths(trace));
  }
  return [
    new PolygonLayer<PolygonDatum>({ id: `${props.id}-folder-shadows`, data: folderShadows, pickable: false, filled: true, stroked: false, getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill }),
    new PolygonLayer<PolygonDatum>({ id: `${props.id}-folder-surfaces`, data: folderSurfaces, pickable: false, filled: true, stroked: false, getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill }),
    new PathLayer<PathDatum>({ id: `${props.id}-traces`, data: traces, pickable: true, positionFormat: "XY", widthUnits: "pixels", widthMinPixels: 2, getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
    new PathLayer<PathDatum>({ id: `${props.id}-folder-fences`, data: fences, pickable: true, positionFormat: "XY", widthUnits: "pixels", widthMinPixels: 1, getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
    new PolygonLayer<PolygonDatum>({ id: `${props.id}-process-shadows`, data: processShadows, pickable: false, filled: true, stroked: false, getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill }),
    new PolygonLayer<PolygonDatum>({ id: `${props.id}-placements`, data: bodies, pickable: true, filled: true, stroked: false, getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill }),
    new PolygonLayer<PolygonDatum>({ id: `${props.id}-restricted`, data: restricted, pickable: false, filled: true, stroked: false, getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill }),
    new PathLayer<PathDatum>({ id: `${props.id}-process-perimeters`, data: processPerimeters, pickable: true, positionFormat: "XY", widthUnits: "pixels", widthMinPixels: 1, getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
    new PathLayer<PathDatum>({ id: `${props.id}-restricted-perimeters`, data: restrictedPerimeters, pickable: false, positionFormat: "XY", widthUnits: "pixels", widthMinPixels: 1, getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
    processMapTextLayer(`${props.id}-labels`, labels),
    processMapTextLayer(`${props.id}-process-card-text`, processCardText),
  ];
}

function editTraceLayers(options: ProcessMapLayerBuildOptions): { path: Layer; waypoints: Layer } {
  const paths: PathDatum[] = [];
  const waypoints: PointDatum[] = [];
  for (const trace of options.editOverlay.traces) {
    const traceID = trace.resource_operational_relationship_id;
    const transform = options.editOverlay.placementTransform?.traceIDs.has(traceID)
      ? options.editOverlay.placementTransform
      : null;
    const transformed = transform
      ? transformedTraces(new Map([[traceID, trace]]), transform).get(traceID) ?? trace
      : trace;
    const source = options.presentation.placements.get(placementKey(trace.source));
    const target = options.presentation.placements.get(placementKey(trace.target));
    const sourceGeometry = source ? processMapPlacementGeometryForTransform(source, transform) : null;
    const targetGeometry = target ? processMapPlacementGeometryForTransform(target, transform) : null;
    const fullPath = transformed.presentation === "editing" && sourceGeometry && targetGeometry
      ? processMapOrthogonalPathPoints(processMapOutputAnchor(sourceGeometry), transformed.route_points, processMapInputAnchor(targetGeometry))
      : null;
    paths.push(...tracePaths({ ...transformed, path_fragments: fullPath ? [fullPath] : transformed.path_fragments }, PROCESS_MAP_SELECTED_TRACE_WIDTH_PX));
    if (trace.presentation !== "editing" || options.editOverlay.selectedTraceID !== traceID) continue;
    if (
      !source
      || !target
      || processMapPlacementDisplayLOD(source, options.settledPixelsPerGridUnit) !== "editing"
      || processMapPlacementDisplayLOD(target, options.settledPixelsPerGridUnit) !== "editing"
    ) continue;
    transformed.route_points.forEach((point, index) => waypoints.push({
      position: [point.x, point.y],
      radius: 5,
      fill: [255, 255, 255, 255],
      line: [14, 165, 233, 255],
      pick: { kind: "waypoint", id: trace.resource_operational_relationship_id, index, trace },
    }));
  }
  if (options.editOverlay.connectionPreview) {
    const start = processMapOutputAnchor(options.editOverlay.connectionPreview.source);
    const end = options.editOverlay.connectionPreview.point;
    const route = defaultProcessMapRoutePoints(options.editOverlay.connectionPreview.source, {
      grid_x: end.x, grid_y: end.y, grid_width: 0, grid_height: 0,
    });
    paths.push(...staticTracePaths(
      [processMapOrthogonalPathPoints(start, route, end)],
      PROCESS_MAP_TRACE_WIDTH_PX,
    ));
  }
  return {
    path: new PathLayer<PathDatum>({ id: "process-map-edit-traces", data: paths, pickable: true, positionFormat: "XY", widthUnits: "pixels", widthMinPixels: 2, getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
    waypoints: new ScatterplotLayer<PointDatum>({ id: "process-map-edit-waypoints", data: waypoints, pickable: true, radiusUnits: "pixels", lineWidthUnits: "pixels", stroked: true, getPosition: (item) => item.position, getRadius: (item) => item.radius, getFillColor: (item) => item.fill, getLineColor: (item) => item.line, getLineWidth: 2 }),
  };
}

function editPlacementLayers(options: ProcessMapLayerBuildOptions): { backdrops: Layer[]; foreground: Layer[] } {
  const folderShadows: PolygonDatum[] = [];
  const folderSurfaces: PolygonDatum[] = [];
  const processShadows: PolygonDatum[] = [];
  const processBodies: PolygonDatum[] = [];
  const fences: PathDatum[] = [];
  const labels: TextDatum[] = [];
  const processCardText: TextDatum[] = [];
  const handles: PointDatum[] = [];
  const anchors: PointDatum[] = [];
  for (const placement of options.editOverlay.placements) {
    const key = placementKey(placement);
    const geometry = processMapPlacementGeometryForTransform(placement, options.editOverlay.placementTransform);
    const bounds = processMapPlacementBounds(geometry);
    const pick: PlacementPick = { kind: "placement", key, placement };
    if (placement.resource_type === "company_explorer_folder") {
      if (options.editedPlacementKeys.has(key)) {
        folderShadows.push({ polygon: boundsPolygon(processShadowBounds(bounds, options.settledPixelsPerGridUnit)), fill: COLOR_SHADOW, line: COLOR_SHADOW, lineWidth: 0 });
        folderSurfaces.push({ polygon: boundsPolygon(bounds), fill: COLOR_FOLDER_SURFACE, line: COLOR_FOLDER, lineWidth: 0 });
      }
      const selected = options.editOverlay.selectedPlacementKeys?.has(key) ?? false;
      const color = options.editOverlay.highlightedFolderKey === key ? COLOR_SELECTION : COLOR_FOLDER;
      const perimeter = [
        [[bounds.min_x, bounds.min_y], [bounds.max_x, bounds.min_y]],
        [[bounds.max_x, bounds.min_y], [bounds.max_x, bounds.max_y]],
        [[bounds.max_x, bounds.max_y], [bounds.min_x, bounds.max_y]],
        [[bounds.min_x, bounds.max_y], [bounds.min_x, bounds.min_y]],
      ];
      for (const path of perimeter) fences.push({ path, color: [...color], width: options.editOverlay.highlightedFolderKey === key || selected ? 4 : 3, pick });
    } else {
      if (processMapPlacementDisplayLOD(placement, options.settledPixelsPerGridUnit) !== "whole") {
        processShadows.push({ polygon: boundsPolygon(processShadowBounds(bounds, options.settledPixelsPerGridUnit)), fill: COLOR_SHADOW, line: COLOR_SHADOW, lineWidth: 0 });
      }
      processBodies.push({
        polygon: boundsPolygon(bounds),
        fill: COLOR_PROCESS_SURFACE,
        line: COLOR_PROCESS,
        lineWidth: options.editOverlay.selectedPlacementKeys?.has(key) ? 4 : 3,
        pick,
      });
    }
    const lod = processMapPlacementDisplayLOD({
      grid_width: geometry.grid_width,
      grid_height: geometry.grid_height,
      presentation: placement.presentation,
    }, options.settledPixelsPerGridUnit);
    if (lod !== "whole") {
      const labelSize = lod === "editing" ? 13 : 11;
      const folderLabelY = placement.resource_type === "company_explorer_folder"
        ? processMapFolderLabelY(bounds, options.settledPixelsPerGridUnit, lod === "editing", labelSize, processMapOverlayChildTop(placement.resource_id, options))
        : null;
      if (placement.resource_type !== "company_explorer_folder" || folderLabelY !== null) {
        const labelPosition: [number, number] = [
          (bounds.min_x + bounds.max_x) / 2,
          placement.resource_type === "company_explorer_folder"
            ? folderLabelY!
            : (bounds.min_y + bounds.max_y) / 2,
        ];
        labels.push({
          position: labelPosition,
          text: placement.name,
          size: labelSize,
          contentBox: processMapPlacementLabelContentBox(bounds, labelPosition, options.settledPixelsPerGridUnit),
          pick,
        });
      }
    }
    processCardText.push(...processCardTextDatums(placement, geometry, bounds, options.settledPixelsPerGridUnit, pick));
  }
  if (options.settled && !options.editOverlay.connectionSourceKey) {
    const handleKeys = new Set([
      options.editOverlay.selectedPlacementKey,
      options.editOverlay.hoveredPlacementKey,
    ].filter((key): key is string => Boolean(key)));
    for (const key of handleKeys) {
      const placement = options.presentation.placements.get(key);
      if (!placement) continue;
      const geometry = processMapPlacementGeometryForTransform(placement, options.editOverlay.placementTransform);
      if (processMapPlacementDisplayLOD({
        grid_width: geometry.grid_width,
        grid_height: geometry.grid_height,
        presentation: placement.presentation,
      }, options.settledPixelsPerGridUnit) === "whole") continue;
      const bounds = processMapPlacementBounds(geometry);
      const corners: Array<[ResizePick["horizontal"], ResizePick["vertical"], [number, number]]> = [
        ["west", "north", [bounds.min_x, bounds.min_y]], ["east", "north", [bounds.max_x, bounds.min_y]],
        ["east", "south", [bounds.max_x, bounds.max_y]], ["west", "south", [bounds.min_x, bounds.max_y]],
      ];
      for (const [horizontal, vertical, position] of corners) handles.push({ position, radius: 5, fill: [255, 255, 255, 255], line: placement.resource_type === "company_explorer_folder" ? COLOR_FOLDER : COLOR_PROCESS, pick: { kind: "resize", horizontal, vertical, key, placement } });
    }
  }
  if (options.settled) {
    const anchorPlacements = options.editOverlay.connectionSourceKey
      ? options.presentation.placements.values()
      : [...new Set([options.editOverlay.selectedPlacementKey, options.editOverlay.hoveredPlacementKey])]
        .flatMap((key) => {
          const placement = key ? options.presentation.placements.get(key) : undefined;
          return placement ? [placement] : [];
        });
    for (const placement of anchorPlacements) {
      const key = placementKey(placement);
      const geometry = processMapPlacementGeometryForTransform(placement, options.editOverlay.placementTransform);
      if (processMapPlacementDisplayLOD({
        grid_width: geometry.grid_width,
        grid_height: geometry.grid_height,
        presentation: placement.presentation,
      }, options.settledPixelsPerGridUnit) === "whole") continue;
      const input = processMapInputAnchor(geometry);
      const output = processMapOutputAnchor(geometry);
      if (options.editOverlay.connectionSourceKey) {
        if (key === options.editOverlay.connectionSourceKey) {
          anchors.push({ position: [output.x, output.y], radius: 7, fill: [14, 165, 233, 255], line: [255, 255, 255, 255], pick: { kind: "anchor", anchor: "output", key, placement } });
        } else {
          anchors.push({ position: [input.x, input.y], radius: 8, fill: [236, 254, 255, 255], line: [25, 168, 255, 255], pick: { kind: "anchor", anchor: "input", key, placement } });
        }
        continue;
      }
      anchors.push({ position: [input.x, input.y], radius: 6, fill: [255, 255, 255, 255], line: [14, 165, 233, 255], pick: { kind: "anchor", anchor: "input", key, placement } });
      anchors.push({ position: [output.x, output.y], radius: 6, fill: [14, 165, 233, 255], line: [255, 255, 255, 255], pick: { kind: "anchor", anchor: "output", key, placement } });
    }
  }
  const dragSelection = options.editOverlay.dragSelectionBounds;
  const selectionBox = dragSelection ? [{
    polygon: boundsPolygon(dragSelection),
    fill: COLOR_SELECTION_SURFACE,
    line: COLOR_SELECTION,
    lineWidth: 2,
  }] : [];
  return {
    backdrops: [
      new PolygonLayer<PolygonDatum>({ id: "process-map-edit-folder-shadows", data: folderShadows, pickable: false, filled: true, stroked: false, getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill }),
      new PolygonLayer<PolygonDatum>({ id: "process-map-edit-folder-surfaces", data: folderSurfaces, pickable: false, filled: true, stroked: false, getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill }),
    ],
    foreground: [
      new PathLayer<PathDatum>({ id: "process-map-edit-folder-fences", data: fences, pickable: true, positionFormat: "XY", widthUnits: "pixels", getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
      new PolygonLayer<PolygonDatum>({ id: "process-map-edit-placement-shadows", data: processShadows, pickable: false, filled: true, stroked: false, getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill }),
      new PolygonLayer<PolygonDatum>({ id: "process-map-edit-placement-bodies", data: processBodies, pickable: true, filled: true, stroked: true, lineWidthUnits: "pixels", getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill, getLineColor: (item) => item.line, getLineWidth: (item) => item.lineWidth }),
      processMapTextLayer("process-map-edit-labels", labels),
      processMapTextLayer("process-map-edit-process-card-text", processCardText),
      new ScatterplotLayer<PointDatum>({ id: "process-map-edit-resize-handles", data: handles, pickable: true, radiusUnits: "pixels", lineWidthUnits: "pixels", stroked: true, getPosition: (item) => item.position, getRadius: (item) => item.radius, getFillColor: (item) => item.fill, getLineColor: (item) => item.line, getLineWidth: 2 }),
      new ScatterplotLayer<PointDatum>({ id: "process-map-edit-anchors", data: anchors, pickable: true, radiusUnits: "pixels", lineWidthUnits: "pixels", stroked: true, getPosition: (item) => item.position, getRadius: (item) => item.radius, getFillColor: (item) => item.fill, getLineColor: (item) => item.line, getLineWidth: 2 }),
      new PolygonLayer<PolygonDatum>({ id: "process-map-edit-drag-selection", data: selectionBox, pickable: false, filled: true, stroked: true, lineWidthUnits: "pixels", getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill, getLineColor: (item) => item.line, getLineWidth: (item) => item.lineWidth }),
    ],
  };
}

function buildProcessMapSpatialLayers(options: ProcessMapSpatialLayerBuildOptions): ProcessMapSpatialLayers {
  const sceneBounds = options.scene.bounds;
  const backgroundBounds = sceneBounds ?? { min_x: -1, min_y: -1, max_x: 1, max_y: 1 };
  const background = new PolygonLayer<PolygonDatum>({
    id: "process-map-background",
    data: [{ polygon: boundsPolygon(backgroundBounds), fill: COLOR_MAP_BACKGROUND, line: COLOR_MAP_BACKGROUND, lineWidth: 0 }],
    pickable: false,
    filled: true,
    stroked: false,
    getPolygon: (item) => item.polygon,
    getFillColor: (item) => item.fill,
  });
  const tile = sceneBounds ? new ProcessMapProtectedTileLayer({
    id: "process-map-spatial-tiles",
    protectedGeneration: options.protectedGeneration,
    readVersion: options.scene.process_map_read_version,
    validatedTiles: options.validatedTiles,
    renderState: {
      settledPixelsPerGridUnit: options.settledPixelsPerGridUnit,
      editedPlacementKeys: options.editedPlacementKeys,
      editedTraceIDs: options.editedTraceIDs,
      selectedPlacementKey: options.selectedPlacementKey,
      selectedTraceID: options.selectedTraceID,
    },
    data: `${options.scene.process_map_read_version}:${options.protectedGeneration}:${options.scoreCardBusinessDate}`,
    extent: [sceneBounds.min_x, sceneBounds.min_y, sceneBounds.max_x, sceneBounds.max_y],
    tileSize: processMapDeckTileSize(options.scene.tile_size, options.scene.max_tile_zoom),
    minZoom: options.scene.min_tile_zoom,
    maxZoom: options.scene.max_tile_zoom,
    zoomOffset: options.scene.max_tile_zoom,
    maxCacheByteSize: PROCESS_MAP_TILE_CACHE_BYTES,
    maxRequests: PROCESS_MAP_MAX_TILE_REQUESTS,
    debounceTime: PROCESS_MAP_TILE_DEBOUNCE_MS,
    refinementStrategy: (headers) => transparentVectorRefinementStrategy(headers),
    updateTriggers: {
      renderSubLayers: [options.settledPixelsPerGridUnit, options.editedPlacementKeys, options.editedTraceIDs, options.selectedPlacementKey, options.selectedTraceID],
    },
    getTileData: ((props) => options.getTileData({ tileID: props.id, z: props.index.z, x: props.index.x, y: props.index.y, signal: props.signal })) as TileLayerProps<ProcessMapTileResponse>["getTileData"],
    onTileLoad: (tile) => { if (tile.content) options.onTileLoad(tile.id, tile.content, options.protectedGeneration); },
    onTileUnload: (tile) => {
      if (tile.content) options.onTileUnload(tile.id, tile.content.process_map_read_version, options.protectedGeneration);
    },
    onViewportLoad: (headers) => {
      if (processMapViewportHasCompleteCoverage(headers, options.scene.process_map_read_version)) options.onViewportLoad?.(options.protectedGeneration);
    },
    onTileError: (cause) => options.onTileError?.(cause),
    renderSubLayers: (props) => renderTileSubLayers(props, options),
  }) : null;
  return { background, tile };
}

function composeProcessMapLayers(options: ProcessMapLayerBuildOptions, spatial: ProcessMapSpatialLayers): Layer[] {
  const editTraces = editTraceLayers(options);
  const editPlacements = editPlacementLayers(options);
  return [
    spatial.background,
    ...editPlacements.backdrops,
    editTraces.path,
    ...(spatial.tile ? [spatial.tile] : []),
    editTraces.waypoints,
    ...editPlacements.foreground,
  ];
}

export function buildProcessMapLayers(options: ProcessMapLayerBuildOptions): Layer[] {
  const spatial = buildProcessMapSpatialLayers({
    ...options,
    selectedPlacementKey: options.editOverlay.selectedPlacementKey,
    selectedTraceID: options.editOverlay.selectedTraceID,
  });
  return composeProcessMapLayers(options, spatial);
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

function pointFromInfo(info: PickingInfo): ProcessMapGridPoint | null {
  return info.coordinate && info.coordinate.length >= 2 ? { x: info.coordinate[0], y: info.coordinate[1] } : null;
}

export function processMapPlacementSubtree(
  root: ProcessMapVisiblePlacement,
  placements: ReadonlyMap<string, ProcessMapVisiblePlacement>,
): Map<string, ProcessMapVisiblePlacement> {
  const result = new Map<string, ProcessMapVisiblePlacement>([[placementKey(root), root]]);
  if (root.resource_type !== "company_explorer_folder") return result;

  const childrenByParent = new Map<string, ProcessMapVisiblePlacement[]>();
  for (const placement of placements.values()) {
    if (!placement.map_parent_folder_id) continue;
    const children = childrenByParent.get(placement.map_parent_folder_id) ?? [];
    children.push(placement);
    childrenByParent.set(placement.map_parent_folder_id, children);
  }
  const pendingFolderIDs = [root.resource_id];
  for (let index = 0; index < pendingFolderIDs.length; index += 1) {
    for (const placement of childrenByParent.get(pendingFolderIDs[index]) ?? []) {
      const key = placementKey(placement);
      if (result.has(key)) continue;
      result.set(key, placement);
      if (placement.resource_type === "company_explorer_folder") pendingFolderIDs.push(placement.resource_id);
    }
  }
  return result;
}

function processMapResizeTransformBounds(transform: ProcessMapPlacementTransform): { source: ProcessMapBounds; target: ProcessMapBounds } | null {
  if (transform.kind !== "resize") return null;
  const root = transform.basePlacements.get(transform.key);
  if (!root) return null;
  return {
    source: processMapPlacementBounds(root),
    target: processMapPlacementBounds(resizeProcessMapPlacement(
      root,
      root.resource_type,
      transform.deltaX,
      transform.deltaY,
      transform.horizontal!,
      transform.vertical!,
    )),
  };
}

function processMapGridPointForTransform(point: ProcessMapGridPoint, transform: ProcessMapPlacementTransform): ProcessMapGridPoint {
  if (transform.kind === "move") return { x: point.x + transform.deltaX, y: point.y + transform.deltaY };
  const bounds = processMapResizeTransformBounds(transform);
  return bounds ? scaleProcessMapGridPoint(point, bounds.source, bounds.target) : point;
}

function transformedTraces(
  traces: ReadonlyMap<string, ProcessMapTrace>,
  transform: ProcessMapPlacementTransform,
): Map<string, ProcessMapTrace> {
  const result = new Map<string, ProcessMapTrace>();
  for (const trace of traces.values()) {
    result.set(trace.resource_operational_relationship_id, {
      ...cloneTrace(trace),
      route_points: trace.route_points.map((point) => processMapGridPointForTransform(point, transform)),
      path_fragments: trace.path_fragments.map((fragment) => fragment.map((point) => processMapGridPointForTransform(point, transform))),
    });
  }
  return result;
}

export function processMapInternalTracesForTransform(
  traces: ReadonlyMap<string, ProcessMapTrace>,
  movedKeys: ReadonlySet<string>,
): Map<string, ProcessMapTrace> {
  const result = new Map<string, ProcessMapTrace>();
  for (const trace of traces.values()) {
    if (!movedKeys.has(placementKey(trace.source)) || !movedKeys.has(placementKey(trace.target))) continue;
    result.set(trace.resource_operational_relationship_id, trace);
  }
  return result;
}

function processMapPlacementGeometryForTransform(
  placement: ProcessMapVisiblePlacement,
  transform: ProcessMapPlacementTransform | null,
): ProcessMapPlacementGeometry {
  const key = placementKey(placement);
  if (!transform?.placementKeys.has(key)) return placement;
  if (transform.kind === "move") {
    return {
      grid_x: placement.grid_x + transform.deltaX,
      grid_y: placement.grid_y + transform.deltaY,
      grid_width: placement.grid_width,
      grid_height: placement.grid_height,
    };
  }
  const bounds = processMapResizeTransformBounds(transform);
  if (!bounds) return placement;
  return key === transform.key
    ? {
        grid_x: bounds.target.min_x,
        grid_y: bounds.target.min_y,
        grid_width: bounds.target.max_x - bounds.target.min_x,
        grid_height: bounds.target.max_y - bounds.target.min_y,
      }
    : scaleProcessMapPlacement(placement, bounds.source, bounds.target);
}

export function materializeProcessMapPlacementTransform(
  placements: ReadonlyMap<string, ProcessMapVisiblePlacement>,
  transform: ProcessMapPlacementTransform,
): Map<string, ProcessMapVisiblePlacement> {
  const result = new Map<string, ProcessMapVisiblePlacement>();
  for (const [key, placement] of placements) {
    result.set(key, { ...placement, ...processMapPlacementGeometryForTransform(placement, transform) });
  }
  return result;
}

export function ProcessMapSurface({ apiBase, companyID, hoverModeEnabled = false, onOpenLogicGate }: ProcessMapSurfaceProps) {
  const authGeneration = getAuthSessionCacheGeneration();
  const protectedScopeKey = `${apiBase.trim()}\u0000${companyID.trim()}\u0000${authGeneration}`;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const deckRef = useRef<DeckGLRef<OrthographicView> | null>(null);
  const [scene, setScene] = useState<ProcessMapSceneResponse | null>(null);
  const [viewState, setViewState] = useState<ProcessMapViewState>(() => fitProcessMapViewState(null, { width: 1, height: 1 }));
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [settled, setSettled] = useState(false);
  const [protectedGeneration, setProtectedGeneration] = useState(0);
  const [scoreCardBusinessDate, setScoreCardBusinessDate] = useState(() => getQDBusinessDate().dateKey);
  const [protectedScope, setProtectedScope] = useState(protectedScopeKey);
  const [settledViewState, setSettledViewState] = useState(viewState);
  const [loadedTiles, setLoadedTiles] = useState<Map<string, ProcessMapTileResponse>>(new Map());
  const [validatedTiles, setValidatedTiles] = useState<ReadonlyMap<string, ProcessMapValidatedTile> | null>(null);
  const [committedOverlay, setCommittedOverlay] = useState<ProcessMapPresentationState>(emptyPresentation);
  const [previewPlacements, setPreviewPlacements] = useState<Map<string, ProcessMapVisiblePlacement>>(new Map());
  const [previewTraces, setPreviewTraces] = useState<Map<string, ProcessMapTrace>>(new Map());
  const [removedTraceIDs, setRemovedTraceIDs] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<ProcessMapSelection>(null);
  const [confirmedMissingSelectionIdentity, setConfirmedMissingSelectionIdentity] = useState<string | null>(null);
  const [hoveredPlacementKey, setHoveredPlacementKey] = useState<string | null>(null);
  const [hoveredResizePick, setHoveredResizePick] = useState<ResizePick | null>(null);
  const [hoveredProcessID, setHoveredProcessID] = useState<string | null>(null);
  const [pinnedProcessID, setPinnedProcessID] = useState<string | null>(null);
  const [gesture, setGesture] = useState<ProcessMapGesture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const protectedScopeCurrent = protectedScope === protectedScopeKey;
  const activeScene = protectedScopeCurrent ? scene : null;

  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const viewRef = useRef(viewState);
  const sceneRef = useRef(activeScene);
  const minimumReadVersionRef = useRef(0);
  const loadedTilesRef = useRef(loadedTiles);
  const presentationRef = useRef<ProcessMapPresentationState>(emptyPresentation());
  const committedOverlayRef = useRef(committedOverlay);
  const previewPlacementsRef = useRef(previewPlacements);
  const previewTracesRef = useRef(previewTraces);
  const removedTraceIDsRef = useRef(removedTraceIDs);
  const selectionRef = useRef(selection);
  const selectionTileCoverageRef = useRef<ProcessMapSelectionTileCoverage | null>(null);
  const gestureRef = useRef<ProcessMapGesture | null>(null);
  const settlementGateRef = useRef<ReturnType<typeof createProcessMapSettlementGate> | null>(null);
  const sceneAbortRef = useRef<AbortController | null>(null);
  const fittedSceneRef = useRef(false);
  const canonicalGenerationRef = useRef(0);
  const operationGenerationRef = useRef(new Map<string, number>());
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  viewRef.current = viewState;
  sceneRef.current = activeScene;
  loadedTilesRef.current = loadedTiles;
  gestureRef.current = gesture;
  committedOverlayRef.current = committedOverlay;
  previewPlacementsRef.current = previewPlacements;
  previewTracesRef.current = previewTraces;
  removedTraceIDsRef.current = removedTraceIDs;
  selectionRef.current = selection;

  const tilePresentation = useMemo(
    () => protectedScopeCurrent ? mergeTilePresentation(loadedTiles) : emptyPresentation(),
    [loadedTiles, protectedScopeCurrent],
  );
  const presentation = useMemo(() => protectedScopeCurrent
    ? mergeProcessMapPresentation(tilePresentation, committedOverlay, previewPlacements, previewTraces, removedTraceIDs)
    : emptyPresentation(), [
    committedOverlay,
    previewPlacements,
    previewTraces,
    removedTraceIDs,
    protectedScopeCurrent,
    tilePresentation,
  ]);
  presentationRef.current = presentation;
  const folderChildTops = useMemo(() => processMapFolderChildTops(presentation.placements.values()), [presentation.placements]);

  const advanceProtectedGeneration = useCallback(() => {
    const next = canonicalGenerationRef.current + 1;
    canonicalGenerationRef.current = next;
    setProtectedGeneration(next);
  }, []);

  const settleNow = useCallback(() => {
    setSettled(true);
    setSettledViewState({ ...viewRef.current, target: [...viewRef.current.target] as [number, number, number] });
  }, []);

  useEffect(() => {
    const gate = createProcessMapSettlementGate({ delayMs: PROCESS_MAP_SETTLE_DELAY_MS, onSettle: settleNow });
    settlementGateRef.current = gate;
    return () => {
      if (settlementGateRef.current === gate) settlementGateRef.current = null;
      gate.dispose();
    };
  }, [settleNow]);

  const markUnsettled = useCallback(() => {
    settlementGateRef.current?.onViewStateChange();
  }, []);

  const purgeProtectedScene = useCallback(() => {
    sceneAbortRef.current?.abort();
    setScene(null);
    sceneRef.current = null;
    minimumReadVersionRef.current = 0;
    setValidatedTiles(null);
    setProtectedScope(protectedScopeKey);
    advanceProtectedGeneration();
    invalidateProcessMapReadCaches(apiBase, companyID);
    setSettled(false);
    setLoadedTiles(new Map());
    setCommittedOverlay(emptyPresentation());
    setPreviewPlacements(new Map());
    setPreviewTraces(new Map());
    setRemovedTraceIDs(new Set());
    gestureRef.current = null;
    setGesture(null);
    setSelection(null);
    setConfirmedMissingSelectionIdentity(null);
    selectionTileCoverageRef.current = null;
    setHoveredPlacementKey(null);
    setHoveredResizePick(null);
    setHoveredProcessID(null);
    setPinnedProcessID(null);
    setLoading(true);
  }, [advanceProtectedGeneration, apiBase, companyID, protectedScopeKey]);

  const loadScene = useCallback(async (purgeProtectedGeometry: boolean) => {
    if (!companyID.trim()) return;
    if (purgeProtectedGeometry) purgeProtectedScene();
    sceneAbortRef.current?.abort();
    const controller = new AbortController();
    sceneAbortRef.current = controller;
    setError("");
    try {
      const previousScene = sceneRef.current;
      const changes = previousScene && !purgeProtectedGeometry
        ? await fetchProcessMapChanges(apiBase, companyID, previousScene.process_map_read_version, [...loadedTilesRef.current.values()], controller.signal)
        : null;
      const nextScene = changes ?? await fetchProcessMapScene(apiBase, companyID, controller.signal);
      if (controller.signal.aborted) return;
      if (nextScene.process_map_read_version < minimumReadVersionRef.current) return;
      if (changes?.protected_geometry_changed) {
        purgeProtectedScene();
      } else if (changes) {
        const certified = validateProcessMapLoadedTiles(loadedTilesRef.current, changes);
        const nextTiles = new Map(loadedTilesRef.current);
        for (const [id, { current }] of certified) nextTiles.set(id, current);
        applyProcessMapCacheValidation(apiBase, companyID, changes);
        loadedTilesRef.current = nextTiles;
        setLoadedTiles(nextTiles);
        setValidatedTiles(certified);
      } else {
        setValidatedTiles(null);
      }
      minimumReadVersionRef.current = nextScene.process_map_read_version;
      sceneRef.current = nextScene;
      setScene(nextScene);
      setLoading(false);
      markUnsettled();
    } catch (cause) {
      if (isAbortError(cause)) return;
      setLoading(false);
      setError(errorMessage(cause, "Process Map could not be loaded."));
    }
  }, [apiBase, companyID, markUnsettled, purgeProtectedScene]);

  const canonicalRefreshRef = useRef<ReturnType<typeof createCoalescedCanonicalRefresh> | null>(null);
  useEffect(() => {
    const refresh = createCoalescedCanonicalRefresh(
      () => loadScene(false),
      (cause) => setError(errorMessage(cause, "Process Map could not refresh.")),
    );
    canonicalRefreshRef.current = refresh;
    return () => {
      refresh.dispose();
      canonicalRefreshRef.current = null;
    };
  }, [loadScene]);
  const requestCanonicalRefresh = useCallback(() => canonicalRefreshRef.current?.request(), []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshBusinessDate = () => {
      setScoreCardBusinessDate(getQDBusinessDate().dateKey);
      void loadScene(true);
      timer = setTimeout(refreshBusinessDate, millisecondsUntilNextQDBusinessDay());
    };
    timer = setTimeout(refreshBusinessDate, millisecondsUntilNextQDBusinessDay());
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [loadScene]);

  useEffect(() => {
    fittedSceneRef.current = false;
    setScene(null);
    void loadScene(true);
    return () => {
      sceneAbortRef.current?.abort();
      invalidateProcessMapReadCaches(apiBase, companyID);
    };
  }, [apiBase, companyID, loadScene]);

  useEffect(() => {
    if (!activeScene || fittedSceneRef.current || viewportSize.width <= 1 || viewportSize.height <= 1) return;
    fittedSceneRef.current = true;
    const fitted = fitProcessMapViewState(activeScene.bounds, viewportSize);
    viewRef.current = fitted;
    setViewState(fitted);
    setSelection(null);
    setHoveredPlacementKey(null);
    setHoveredResizePick(null);
    setHoveredProcessID(null);
    setPinnedProcessID(null);
    markUnsettled();
  }, [activeScene, markUnsettled, viewportSize]);

  useEffect(() => {
    const requestRefresh = (purge: boolean) => {
      if (purge) purgeProtectedScene();
      requestCanonicalRefresh();
    };
    const unsubscribe = subscribeRealtimeScope(apiBase, companyID, PROCESS_MAP_REALTIME_SCOPE, {
      onProcessMapChanged: (message) => {
        if (!message.protected_geometry_changed && message.origin_connection_id && message.origin_connection_id === getCurrentRealtimeConnectionID(apiBase, companyID)) return;
        requestRefresh(message.protected_geometry_changed);
      },
      onRecover: () => { requestRefresh(true); },
      onRejected: () => {
        purgeProtectedScene();
        setLoading(false);
        setError("Process Map access changed. Refresh after your permissions are restored.");
      },
    });
    return () => {
      unsubscribe();
    };
  }, [apiBase, companyID, purgeProtectedScene, requestCanonicalRefresh]);

  const guardedGetTileData = useCallback(async (request: ProcessMapTileLoadRequest): Promise<ProcessMapTileResponse | null> => {
    const currentScene = sceneRef.current;
    if (!currentScene || request.z < currentScene.min_tile_zoom || request.z > currentScene.max_tile_zoom) return null;
    const canonicalGeneration = canonicalGenerationRef.current;
    let tile: ProcessMapTileResponse | null = null;
    try {
      tile = await fetchProcessMapTile(apiBase, companyID, currentScene.process_map_read_version, request.z, request.x, request.y, request.signal, scoreCardBusinessDate);
    } catch (cause) {
      if (!isAbortError(cause)) throw cause;
    }
    if (
      canonicalGeneration !== canonicalGenerationRef.current || !sceneRef.current
      || scoreCardBusinessDate !== getQDBusinessDate().dateKey
    ) return null;
    if (tile && !request.signal?.aborted && tile.process_map_read_version === sceneRef.current.process_map_read_version) return tile;
    // deck.gl clears a header's content on null before its replacement loader
    // may start. Keep only this exact tile's already authorized coverage.
    const retained = loadedTilesRef.current.get(request.tileID);
    return retained && retained.z === request.z && retained.x === request.x && retained.y === request.y
      ? retained
      : null;
  }, [apiBase, companyID, scoreCardBusinessDate]);

  const handleTileLoad = useCallback((tileID: string, data: ProcessMapTileResponse, generation: number) => {
    if (generation !== canonicalGenerationRef.current || data.process_map_read_version !== sceneRef.current?.process_map_read_version) return;
    const currentSelection = selectionRef.current;
    if (currentSelection && currentSelection.kind !== "placements" && processMapTileContainsSelection(data, currentSelection)) {
      const identity = processMapSelectionIdentity(currentSelection);
      const currentCoverage = selectionTileCoverageRef.current;
      if (!currentCoverage || currentCoverage.identity !== identity || data.process_map_read_version > currentCoverage.readVersion) {
        selectionTileCoverageRef.current = { identity, readVersion: data.process_map_read_version, tileIDs: new Set([tileID]) };
      } else if (data.process_map_read_version === currentCoverage.readVersion) {
        currentCoverage.tileIDs.add(tileID);
      }
    }
    setLoadedTiles((current) => new Map(current).set(tileID, data));
    setLoading(false);
  }, []);

  const handleTileUnload = useCallback((tileID: string, readVersion: number, generation: number) => {
    if (generation !== canonicalGenerationRef.current) return;
    setLoadedTiles((current) => {
      if (current.get(tileID)?.process_map_read_version !== readVersion) return current;
      const next = new Map(current);
      next.delete(tileID);
      return next;
    });
  }, []);

  const handleViewportLoad = useCallback((generation: number) => {
    if (generation !== canonicalGenerationRef.current) return;
    const readVersion = sceneRef.current?.process_map_read_version;
    if (readVersion === undefined || readVersion < minimumReadVersionRef.current) return;
    if (readVersion !== undefined) {
      setLoadedTiles((current) => {
        if ([...current.values()].every((tile) => tile.process_map_read_version === readVersion)) return current;
        return new Map([...current].filter(([, tile]) => tile.process_map_read_version === readVersion));
      });
    }
    const retired = retireProcessMapMutationMasks({
      committedOverlay: committedOverlayRef.current,
      removedTraceIDs: removedTraceIDsRef.current,
    }, true);
    setCommittedOverlay(retired.committedOverlay);
    setRemovedTraceIDs(retired.removedTraceIDs);
  }, []);

  const refreshAfterMutation = useCallback((readVersion: number) => {
    minimumReadVersionRef.current = Math.max(minimumReadVersionRef.current, readVersion);
    markUnsettled();
    requestCanonicalRefresh();
  }, [markUnsettled, requestCanonicalRefresh]);

  const applyEnvelope = useCallback((
    envelope: ProcessMapMutationEnvelope,
    pending: ReadonlyMap<string, ProcessMapVisiblePlacement>,
    pendingTraceIDs: Iterable<string> = [],
    expectedOperationGenerations?: ReadonlyMap<string, number>,
  ) => {
    setCommittedOverlay((current) => {
      const seeded: ProcessMapPresentationState = {
        placements: new Map(current.placements),
        traces: new Map(current.traces),
        removedPlacementKeys: new Set(current.removedPlacementKeys),
      };
      for (const row of envelope.placements) {
        const key = placementKey(row);
        const existing = pending.get(key) ?? presentationRef.current.placements.get(key);
        if (existing && !seeded.placements.has(key)) seeded.placements.set(key, existing);
      }
      for (const row of envelope.traces) {
        const existing = presentationRef.current.traces.get(row.resource_operational_relationship_id);
        if (existing && !seeded.traces.has(row.resource_operational_relationship_id)) seeded.traces.set(row.resource_operational_relationship_id, existing);
      }
      return applyProcessMapMutationEnvelope(seeded, envelope, pending);
    });
    if (envelope.deleted_trace_ids.length > 0) {
      setRemovedTraceIDs((current) => new Set([...current, ...envelope.deleted_trace_ids]));
    }
    const placementKeys = new Set([...pending.keys(), ...envelope.placements.map((placement) => placementKey(placement))]);
    const traceIDs = new Set([
      ...pendingTraceIDs,
      ...envelope.traces.map((trace) => trace.resource_operational_relationship_id),
      ...envelope.deleted_trace_ids,
    ]);
    const currentPlacementKeys = processMapCurrentOperationKeys(
      placementKeys,
      expectedOperationGenerations,
      operationGenerationRef.current,
    );
    const currentTraceIDs = processMapCurrentOperationKeys(
      traceIDs,
      expectedOperationGenerations,
      operationGenerationRef.current,
      "trace:",
    );
    setPreviewPlacements((current) => replaceProcessMapPreviewEntries(current, currentPlacementKeys, new Map()));
    setPreviewTraces((current) => replaceProcessMapPreviewEntries(current, currentTraceIDs, new Map()));
    refreshAfterMutation(envelope.process_map_read_version);
  }, [refreshAfterMutation]);

  const nextOperation = useCallback((key: string) => {
    const next = (operationGenerationRef.current.get(key) ?? 0) + 1;
    operationGenerationRef.current.set(key, next);
    return next;
  }, []);

  const savePlacement = useCallback(async (
    placement: ProcessMapVisiblePlacement,
    pending: ReadonlyMap<string, ProcessMapVisiblePlacement>,
    pendingTraceIDs: ReadonlySet<string> = new Set(),
  ) => {
    const key = placementKey(placement);
    const canonicalGeneration = canonicalGenerationRef.current;
    const expectedOperationGenerations = new Map<string, number>();
    for (const pendingKey of pending.keys()) {
      expectedOperationGenerations.set(pendingKey, nextOperation(pendingKey));
    }
    if (!expectedOperationGenerations.has(key)) expectedOperationGenerations.set(key, nextOperation(key));
    for (const traceID of pendingTraceIDs) {
      const operationKey = `trace:${traceID}`;
      expectedOperationGenerations.set(operationKey, nextOperation(operationKey));
    }
    const operationGeneration = expectedOperationGenerations.get(key)!;
    setNotice("Saving placement…");
    try {
      const envelope = await putProcessMapPlacement(apiBase, companyID, placement, placement);
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(key) ?? 0)) {
        if (canonicalGeneration === canonicalGenerationRef.current) refreshAfterMutation(envelope.process_map_read_version);
        return;
      }
      applyEnvelope(envelope, pending, pendingTraceIDs, expectedOperationGenerations);
      setNotice("Placement saved.");
    } catch (cause) {
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(key) ?? 0)) return;
      const currentPlacementKeys = processMapCurrentOperationKeys(
        pending.keys(),
        expectedOperationGenerations,
        operationGenerationRef.current,
      );
      const currentTraceIDs = processMapCurrentOperationKeys(
        pendingTraceIDs,
        expectedOperationGenerations,
        operationGenerationRef.current,
        "trace:",
      );
      setPreviewPlacements((current) => replaceProcessMapPreviewEntries(current, currentPlacementKeys, new Map()));
      setPreviewTraces((current) => replaceProcessMapPreviewEntries(current, currentTraceIDs, new Map()));
      setNotice(errorMessage(cause, "Placement was restored because it could not be saved."));
    }
  }, [apiBase, applyEnvelope, companyID, nextOperation, refreshAfterMutation]);

  const saveTrace = useCallback(async (trace: ProcessMapTrace, routePoints: readonly ProcessMapGridPoint[]) => {
    const id = trace.resource_operational_relationship_id;
    const key = `trace:${id}`;
    const canonicalGeneration = canonicalGenerationRef.current;
    const operationGeneration = nextOperation(key);
    const preview = { ...cloneTrace(trace), route_points: normalizeProcessMapRoutePoints(routePoints) };
    setPreviewTraces((current) => new Map(current).set(id, preview));
    try {
      const envelope = await putProcessMapTrace(apiBase, companyID, id, preview.route_points);
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(key) ?? 0)) {
        if (canonicalGeneration === canonicalGenerationRef.current) refreshAfterMutation(envelope.process_map_read_version);
        return;
      }
      applyEnvelope(envelope, new Map());
      setNotice(envelope.changed === false ? "Trace route was already current." : "Trace route saved.");
    } catch (cause) {
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(key) ?? 0)) return;
      setPreviewTraces((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      setNotice(errorMessage(cause, "Trace route was restored because it could not be saved."));
    }
  }, [apiBase, applyEnvelope, companyID, nextOperation, refreshAfterMutation]);

  const placementGesture = gesture && (gesture.kind === "move" || gesture.kind === "resize") ? gesture : null;
  const placementTransform = useMemo<ProcessMapPlacementTransform | null>(() => placementGesture ? {
    kind: placementGesture.kind,
    key: placementGesture.key,
    placementKeys: placementGesture.basePlacementKeys,
    traceIDs: placementGesture.baseTraceIDs,
    basePlacements: placementGesture.basePlacements,
    deltaX: placementGesture.deltaX,
    deltaY: placementGesture.deltaY,
    horizontal: placementGesture.horizontal,
    vertical: placementGesture.vertical,
  } : null, [placementGesture]);
  const folders = useMemo(() => [...presentation.placements.values()].filter((placement) => placement.resource_type === "company_explorer_folder"), [presentation.placements]);
  const gestureRoot = placementGesture?.basePlacements.get(placementGesture.key);
  const excludedFolderID = gestureRoot?.resource_type === "company_explorer_folder" ? gestureRoot.resource_id : undefined;
  const destinationFolders = useMemo(() => processMapOrderFoldersForContainment(folders, excludedFolderID), [folders, excludedFolderID]);
  const highlightedFolder = useMemo(() => {
    let bounds: ProcessMapBounds | null = null;
    const activePlacement = placementGesture?.basePlacements.get(placementGesture.key) ?? null;
    if (activePlacement) {
      bounds = processMapPlacementBounds(processMapPlacementGeometryForTransform(activePlacement, placementTransform));
    }
    return bounds ? destinationFolders.find((folder) => processMapBoundsContain(processMapPlacementBounds(folder), bounds!)) ?? null : null;
  }, [destinationFolders, placementGesture, placementTransform]);

  const singularSelection = selection?.kind === "placements" ? null : selection;
  const selectionIdentity = singularSelection ? processMapSelectionIdentity(singularSelection) : null;
  useEffect(() => {
    if (!singularSelection) {
      selectionTileCoverageRef.current = null;
      return;
    }
    if (selectionTileCoverageRef.current?.identity !== processMapSelectionIdentity(singularSelection)) {
      selectionTileCoverageRef.current = processMapSelectionTileCoverage(loadedTilesRef.current, singularSelection);
    }
  }, [singularSelection]);
  const selectedPlacement = singularSelection?.kind === "placement" ? presentation.placements.get(singularSelection.id) ?? null : null;
  const selectedTrace = singularSelection?.kind === "trace" ? presentation.traces.get(singularSelection.id) ?? null : null;
  const selectedPlacementKeys = useMemo(() => selection?.kind === "placements"
    ? new Set(selection.ids)
    : selectedPlacement
      ? new Set([placementKey(selectedPlacement)])
      : new Set<string>(), [selectedPlacement, selection]);
  const selectionExists = selectedPlacement !== null || selectedTrace !== null;
  const selectionConfirmedMissing = selectionIdentity !== null && confirmedMissingSelectionIdentity === selectionIdentity;
  const selectionHasCanonicalCoverage = selectionIdentity !== null
    && selectionTileCoverageRef.current?.identity === selectionIdentity
    && selectionTileCoverageRef.current.tileIDs.size > 0
    && [...selectionTileCoverageRef.current.tileIDs].every((tileID) => (
      loadedTiles.get(tileID)?.process_map_read_version === activeScene?.process_map_read_version
    ));
  const selectionVisible = selection?.kind === "placements"
    ? selection.ids.size > 0
    : selection !== null && (selectionExists || !selectionConfirmedMissing);
  const visibleSelection = selectionVisible ? selection : null;
  useEffect(() => {
    if (!selectionIdentity) {
      setConfirmedMissingSelectionIdentity(null);
      return;
    }
    if (selectionExists) {
      setConfirmedMissingSelectionIdentity((current) => current === selectionIdentity ? null : current);
      return;
    }
    if (selectionHasCanonicalCoverage) {
      setConfirmedMissingSelectionIdentity(selectionIdentity);
    }
  }, [selectionExists, selectionHasCanonicalCoverage, selectionIdentity]);
  const gesturePlacementKeys = placementGesture?.basePlacementKeys ?? null;
  const gestureTraceIDs = placementGesture?.baseTraceIDs ?? null;
  const editedPlacementKeys = useMemo(() => new Set([
    ...committedOverlay.placements.keys(),
    ...committedOverlay.removedPlacementKeys,
    ...previewPlacements.keys(),
    ...(gesturePlacementKeys ?? []),
    ...selectedPlacementKeys,
  ]), [committedOverlay.placements, committedOverlay.removedPlacementKeys, gesturePlacementKeys, previewPlacements, selectedPlacementKeys]);
  const editedTraceIDs = useMemo(() => new Set([
    ...committedOverlay.traces.keys(),
    ...previewTraces.keys(),
    ...removedTraceIDs,
    ...(gestureTraceIDs ?? []),
    ...(visibleSelection?.kind === "trace" ? [visibleSelection.id] : []),
  ]), [committedOverlay.traces, gestureTraceIDs, previewTraces, removedTraceIDs, visibleSelection]);
  const overlayPlacements = useMemo(() => {
    const result = new Map<string, ProcessMapVisiblePlacement>();
    for (const key of editedPlacementKeys) {
      const placement = presentation.placements.get(key);
      if (placement) result.set(key, placement);
    }
    if (highlightedFolder) result.set(placementKey(highlightedFolder), highlightedFolder);
    return [...result.values()];
  }, [editedPlacementKeys, highlightedFolder, presentation.placements]);
  const overlayTraces = useMemo(() => {
    const result: ProcessMapTrace[] = [];
    for (const id of editedTraceIDs) {
      const trace = presentation.traces.get(id);
      if (trace) result.push(trace);
    }
    return result;
  }, [editedTraceIDs, presentation.traces]);
  const editOverlay = useMemo<ProcessMapEditOverlayModel>(() => ({
    placements: overlayPlacements,
    traces: overlayTraces,
    selectedPlacementKey: visibleSelection?.kind === "placement" ? visibleSelection.id : null,
    selectedPlacementKeys,
    hoveredPlacementKey,
    selectedTraceID: visibleSelection?.kind === "trace" ? visibleSelection.id : null,
    connectionPreview: gesture?.kind === "connection" ? { source: gesture.source, point: gesture.point } : null,
    highlightedFolderKey: highlightedFolder ? placementKey(highlightedFolder) : null,
    connectionSourceKey: gesture?.kind === "connection" ? placementKey(gesture.source) : null,
    placementTransform,
    dragSelectionBounds: gesture?.kind === "drag-selection" ? processMapDragSelectionBounds(gesture.start, gesture.point) : null,
  }), [gesture, highlightedFolder, hoveredPlacementKey, overlayPlacements, overlayTraces, placementTransform, selectedPlacementKeys, visibleSelection]);

  const editedPlacementMembership = useMemo(() => [...editedPlacementKeys].sort().join("\0"), [editedPlacementKeys]);
  const editedTraceMembership = useMemo(() => [...editedTraceIDs].sort().join("\0"), [editedTraceIDs]);
  const spatialEditedPlacementKeys = useMemo(
    () => new Set(editedPlacementMembership ? editedPlacementMembership.split("\0") : []),
    [editedPlacementMembership],
  );
  const spatialEditedTraceIDs = useMemo(
    () => new Set(editedTraceMembership ? editedTraceMembership.split("\0") : []),
    [editedTraceMembership],
  );
  const selectedPlacementKey = visibleSelection?.kind === "placement" ? visibleSelection.id : null;
  const selectedTraceID = visibleSelection?.kind === "trace" ? visibleSelection.id : null;

  const spatialLayers = useMemo(() => activeScene ? buildProcessMapSpatialLayers({
    scene: activeScene,
    validatedTiles,
    protectedGeneration,
    scoreCardBusinessDate,
    settledPixelsPerGridUnit: 2 ** settledViewState.zoom,
    editedPlacementKeys: spatialEditedPlacementKeys,
    editedTraceIDs: spatialEditedTraceIDs,
    selectedPlacementKey,
    selectedTraceID,
    getTileData: guardedGetTileData,
    onTileLoad: handleTileLoad,
    onTileUnload: handleTileUnload,
    onViewportLoad: handleViewportLoad,
    onTileError: (cause) => setNotice(errorMessage(cause, "A map tile could not be loaded. Move or zoom to retry.")),
  }) : null, [activeScene, guardedGetTileData, handleTileLoad, handleTileUnload, handleViewportLoad, protectedGeneration, scoreCardBusinessDate, selectedPlacementKey, selectedTraceID, settledViewState.zoom, spatialEditedPlacementKeys, spatialEditedTraceIDs, validatedTiles]);

  const layers = useMemo(() => activeScene && spatialLayers ? composeProcessMapLayers({
    scene: activeScene,
    validatedTiles,
    protectedGeneration,
    scoreCardBusinessDate,
    settled,
    settledPixelsPerGridUnit: 2 ** settledViewState.zoom,
    presentation,
    folderChildTops,
    editedPlacementKeys,
    editedTraceIDs,
    editOverlay,
    getTileData: guardedGetTileData,
    onTileLoad: handleTileLoad,
    onTileUnload: handleTileUnload,
    onViewportLoad: handleViewportLoad,
    onTileError: (cause) => setNotice(errorMessage(cause, "A map tile could not be loaded. Move or zoom to retry.")),
  }, spatialLayers) : [], [activeScene, editOverlay, editedPlacementKeys, editedTraceIDs, folderChildTops, guardedGetTileData, handleTileLoad, handleTileUnload, handleViewportLoad, presentation, protectedGeneration, scoreCardBusinessDate, settled, settledViewState.zoom, spatialLayers, validatedTiles]);

  const handleViewStateChange = useCallback(<ViewStateT extends OrthographicViewState,>(params: ViewStateChangeParameters<ViewStateT>): ViewStateT => {
    if (gestureRef.current?.kind === "connection") {
      gestureRef.current = null;
      setGesture(null);
      setSelection(null);
    }
    setHoveredPlacementKey(null);
    setHoveredResizePick(null);
    const proposed: ProcessMapViewState = {
      target: [params.viewState.target?.[0] ?? viewRef.current.target[0], params.viewState.target?.[1] ?? viewRef.current.target[1], 0],
      zoom: typeof params.viewState.zoom === "number" ? params.viewState.zoom : viewRef.current.zoom,
      minZoom: PROCESS_MAP_MIN_CAMERA_ZOOM,
      maxZoom: PROCESS_MAP_MAX_CAMERA_ZOOM,
    };
    viewRef.current = proposed;
    setViewState(proposed);
    settlementGateRef.current?.onViewStateChange();
    return proposed as ViewStateT;
  }, []);

  const clearHoverTimer = useCallback(() => {
    if (hoverCloseTimerRef.current === null) return;
    clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = null;
  }, []);
  const showHoverCard = useCallback((id: string) => {
    clearHoverTimer();
    if (hoverModeEnabled) setHoveredProcessID(id);
  }, [clearHoverTimer, hoverModeEnabled]);
  const scheduleHoverClose = useCallback((id: string) => {
    clearHoverTimer();
    hoverCloseTimerRef.current = setTimeout(() => {
      setHoveredProcessID((current) => current === id ? null : current);
      hoverCloseTimerRef.current = null;
    }, 80);
  }, [clearHoverTimer]);
  useEffect(() => {
    if (!hoverModeEnabled) {
      clearHoverTimer();
      setHoveredProcessID(null);
    }
  }, [clearHoverTimer, hoverModeEnabled]);
  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  const startPlacementGesture = useCallback((pick: PlacementPick | ResizePick, point: ProcessMapGridPoint) => {
    if (processMapPlacementDisplayLOD(pick.placement, 2 ** settledViewState.zoom) === "whole") return;
    const subtree = processMapPlacementSubtree(pick.placement, presentationRef.current.placements);
    const basePlacements = subtree;
    const basePlacementKeys = new Set(basePlacements.keys());
    const baseTraces = basePlacements.size > 1
      ? processMapInternalTracesForTransform(presentationRef.current.traces, basePlacementKeys)
      : new Map<string, ProcessMapTrace>();
    const next: PlacementGesture = {
      kind: pick.kind === "resize" ? "resize" : "move",
      key: pick.key,
      start: point,
      basePlacements,
      basePlacementKeys,
      baseTraces,
      baseTraceIDs: new Set(baseTraces.keys()),
      deltaX: 0,
      deltaY: 0,
      ...(pick.kind === "resize" ? { horizontal: pick.horizontal, vertical: pick.vertical } : {}),
      moved: false,
    };
    gestureRef.current = next;
    setSelection({ kind: "placement", id: pick.key });
    setGesture(next);
  }, [settledViewState.zoom]);

  const handleDragStart = useCallback((info: PickingInfo, event: ProcessMapDragStartEvent) => {
    const point = pointFromInfo(info);
    const pick = pickFromObject(info.object);
    if (!point) return;
    if (!pick && (event.shiftKey || event.srcEvent?.shiftKey)) {
      event.stopPropagation();
      suppressClickRef.current = true;
      const next: DragSelectionGesture = { kind: "drag-selection", start: point, point };
      gestureRef.current = next;
      setSelection(null);
      setHoveredPlacementKey(null);
      setHoveredResizePick(null);
      setPinnedProcessID(null);
      setGesture(next);
      return;
    }
    if (!pick) return;
    event.stopPropagation();
    suppressClickRef.current = true;
    if (pick.kind === "placement" || pick.kind === "resize") {
      if (pick.kind === "resize") setHoveredResizePick(pick);
      startPlacementGesture(pick, point);
    }
    else if (pick.kind === "anchor" && pick.anchor === "output") {
      const next: ConnectionGesture = { kind: "connection", source: pick.placement, point, moved: false };
      gestureRef.current = next;
      setHoveredPlacementKey(null);
      setHoveredResizePick(null);
      setSelection({ kind: "placement", id: pick.key });
      setGesture(next);
    } else if (pick.kind === "waypoint") {
      const next: WaypointGesture = { kind: "waypoint", trace: pick.trace, index: pick.index, startingRoute: pick.trace.route_points.map((routePoint) => ({ ...routePoint })), moved: false };
      gestureRef.current = next;
      setGesture(next);
    }
  }, [startPlacementGesture]);

  const handleDrag = useCallback((info: PickingInfo) => {
    const point = pointFromInfo(info);
    const current = gestureRef.current;
    if (!point || !current) return;
    if (current.kind === "drag-selection") {
      const next = { ...current, point };
      gestureRef.current = next;
      setGesture(next);
      return;
    }
    if (current.kind === "connection") {
      const next = { ...current, point, moved: true };
      gestureRef.current = next;
      setGesture(next);
      return;
    }
    if (current.kind === "waypoint") {
      const snapped = { x: snapProcessMapGridCoordinate(point.x), y: snapProcessMapGridCoordinate(point.y) };
      const previous = previewTracesRef.current.get(current.trace.resource_operational_relationship_id)?.route_points[current.index]
        ?? current.startingRoute[current.index];
      if (previous?.x === snapped.x && previous.y === snapped.y) return;
      const route = current.startingRoute.map((routePoint) => ({ ...routePoint }));
      route[current.index] = snapped;
      const id = current.trace.resource_operational_relationship_id;
      const nextPreviews = replaceProcessMapPreviewEntries(previewTracesRef.current, [id], new Map([[id, { ...cloneTrace(current.trace), route_points: route }]]));
      const next = { ...current, moved: true };
      previewTracesRef.current = nextPreviews;
      gestureRef.current = next;
      setPreviewTraces(nextPreviews);
      setGesture(next);
      return;
    }
    const dx = snapProcessMapGridCoordinate(point.x - current.start.x);
    const dy = snapProcessMapGridCoordinate(point.y - current.start.y);
    if (dx === current.deltaX && dy === current.deltaY) return;
    const next = {
      ...current,
      deltaX: dx,
      deltaY: dy,
      moved: current.moved || dx !== 0 || dy !== 0,
    };
    gestureRef.current = next;
    setGesture(next);
  }, []);

  const finishConnection = useCallback(async (current: ConnectionGesture, info: PickingInfo) => {
    const point = pointFromInfo(info);
    const sourceKey = placementKey(current.source);
    const settledPixelsPerGridUnit = 2 ** settledViewState.zoom;
    let target: ProcessMapVisiblePlacement | null = null;
    let targetKey = "";
    let nearestDistancePixels = Number.POSITIVE_INFINITY;
    if (point) {
      for (const placement of presentationRef.current.placements.values()) {
        const key = placementKey(placement);
        if (key === sourceKey || processMapPlacementDisplayLOD(placement, settledPixelsPerGridUnit) === "whole") continue;
        const input = processMapInputAnchor(placement);
        const distancePixels = Math.hypot(input.x - point.x, input.y - point.y) * settledPixelsPerGridUnit;
        if (distancePixels > 14) continue;
        if (distancePixels < nearestDistancePixels || (distancePixels === nearestDistancePixels && key.localeCompare(targetKey) < 0)) {
          target = placement;
          targetKey = key;
          nearestDistancePixels = distancePixels;
        }
      }
    }
    gestureRef.current = null;
    setGesture(null);
    setSelection(null);
    setHoveredPlacementKey(null);
    if (!target) return;
    const operationKey = `relationship:${sourceKey}:${targetKey}`;
    const canonicalGeneration = canonicalGenerationRef.current;
    const operationGeneration = nextOperation(operationKey);
    const routePoints = defaultProcessMapRoutePoints(
      current.source,
      target,
    );
    try {
      const envelope = await postProcessMapRelationship(apiBase, companyID, current.source, target, routePoints);
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(operationKey) ?? 0)) {
        if (canonicalGeneration === canonicalGenerationRef.current) refreshAfterMutation(envelope.process_map_read_version);
        return;
      }
      applyEnvelope(envelope, new Map());
      if (envelope.relationship) setSelection({ kind: "trace", id: envelope.relationship.resource_operational_relationship_id });
      setNotice(envelope.created === false ? "Existing operational trace selected." : "Operational trace created.");
    } catch (cause) {
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(operationKey) ?? 0)) return;
      setNotice(errorMessage(cause, "Operational trace was not created."));
    }
  }, [apiBase, applyEnvelope, companyID, nextOperation, refreshAfterMutation, settledViewState.zoom]);

  const handleDragEnd = useCallback((info: PickingInfo) => {
    const current = gestureRef.current;
    setTimeout(() => { suppressClickRef.current = false; }, 0);
    if (!current) return;
    if (current.kind === "drag-selection") {
      gestureRef.current = null;
      setGesture(null);
      const selected = processMapPlacementsInsideBounds(
        presentationRef.current.placements.values(),
        processMapDragSelectionBounds(current.start, pointFromInfo(info) ?? current.point),
      );
      if (selected.size === 0) setSelection(null);
      else if (selected.size === 1) setSelection({ kind: "placement", id: selected.values().next().value! });
      else setSelection({ kind: "placements", ids: selected });
      return;
    }
    if (current.kind === "connection") {
      void finishConnection(current, info);
      return;
    }
    if (current.kind === "waypoint") {
      const trace = previewTracesRef.current.get(current.trace.resource_operational_relationship_id) ?? current.trace;
      setGesture(null);
      if (current.moved) void saveTrace(trace, trace.route_points);
      else setPreviewTraces((previews) => replaceProcessMapPreviewEntries(previews, [current.trace.resource_operational_relationship_id], new Map()));
      return;
    }
    setGesture(null);
    if (!current.moved) return;
    const transform: ProcessMapPlacementTransform = {
      kind: current.kind,
      key: current.key,
      placementKeys: current.basePlacementKeys,
      traceIDs: current.baseTraceIDs,
      basePlacements: current.basePlacements,
      deltaX: current.deltaX,
      deltaY: current.deltaY,
      horizontal: current.horizontal,
      vertical: current.vertical,
    };
    const pending = materializeProcessMapPlacementTransform(current.basePlacements, transform);
    if ([...pending.values()].some((item) => item.grid_width < 1 || item.grid_height < 1)) {
      setNotice("Folder resize was restored because its contents cannot be shrunk any further.");
      return;
    }
    const placement = pending.get(current.key);
    if (!placement) return;
    const parent = destinationFolders.find((folder) => processMapBoundsContain(processMapPlacementBounds(folder), processMapPlacementBounds(placement))) ?? null;
    const saved = { ...placement, map_parent_folder_id: parent?.resource_id ?? null };
    pending.set(current.key, saved);
    const nextPlacementPreviews = replaceProcessMapPreviewEntries(previewPlacementsRef.current, current.basePlacementKeys, pending);
    previewPlacementsRef.current = nextPlacementPreviews;
    setPreviewPlacements(nextPlacementPreviews);
    if (current.baseTraces.size > 0) {
      const transformed = transformedTraces(current.baseTraces, transform);
      const nextTracePreviews = replaceProcessMapPreviewEntries(previewTracesRef.current, current.baseTraceIDs, transformed);
      previewTracesRef.current = nextTracePreviews;
      setPreviewTraces(nextTracePreviews);
    }
    void savePlacement(saved, pending, current.baseTraceIDs);
  }, [destinationFolders, finishConnection, savePlacement, saveTrace]);

  const fitFolder = useCallback((placement: ProcessMapVisiblePlacement) => {
    const next = fitProcessMapViewState(processMapPlacementBounds(placement), viewportSize, { padding: 80 });
    viewRef.current = next;
    setViewState(next);
    markUnsettled();
  }, [markUnsettled, viewportSize]);

  const openProcess = useCallback((placement: ProcessMapVisiblePlacement) => {
    if (placement.resource_type !== "logic_gate") return;
    clearHoverTimer();
    setHoveredPlacementKey(null);
    setHoveredResizePick(null);
    setHoveredProcessID(null);
    setPinnedProcessID(null);
    onOpenLogicGate(placement.resource_id, placement.name);
  }, [clearHoverTimer, onOpenLogicGate]);

  const handleClick = useCallback((info: PickingInfo, event: { type: string }) => {
    surfaceRef.current?.focus();
    if (suppressClickRef.current) return;
    const pick = pickFromObject(info.object);
    if (!pick) {
      setSelection(null);
      setHoveredPlacementKey(null);
      setHoveredResizePick(null);
      setPinnedProcessID(null);
      setHoveredProcessID(null);
      return;
    }
    const doubleClick = event.type === "dblclick";
    if (pick.kind === "placement") {
      setSelection({ kind: "placement", id: pick.key });
      if (doubleClick) {
        if (pick.placement.resource_type === "company_explorer_folder") fitFolder(pick.placement);
        else openProcess(pick.placement);
      } else if (pick.placement.resource_type === "logic_gate" && processMapPlacementDisplayLOD(pick.placement, 2 ** settledViewState.zoom) !== "whole") {
        setPinnedProcessID(pick.placement.resource_id);
        setHoveredProcessID(null);
      }
      return;
    }
    if (pick.kind === "trace") {
      setSelection({ kind: "trace", id: pick.id });
      if (doubleClick && pick.trace.presentation === "editing") {
        const point = pointFromInfo(info);
        const source = presentationRef.current.placements.get(placementKey(pick.trace.source));
        const target = presentationRef.current.placements.get(placementKey(pick.trace.target));
        if (point && source && target) void saveTrace(pick.trace, insertProcessMapRoutePoint(processMapOutputAnchor(source), pick.trace.route_points, processMapInputAnchor(target), point));
      }
      return;
    }
    if (pick.kind === "waypoint" && pick.trace.presentation === "editing" && doubleClick) void saveTrace(pick.trace, pick.trace.route_points.filter((_, index) => index !== pick.index));
  }, [fitFolder, openProcess, saveTrace, settledViewState.zoom]);

  const handleHover = useCallback((info: PickingInfo) => {
    const pick = pickFromObject(info.object);
    const anchorPlacement = pick && (pick.kind === "placement" || pick.kind === "anchor" || pick.kind === "resize")
      ? pick.placement
      : null;
    if (!gestureRef.current && anchorPlacement && processMapPlacementDisplayLOD(anchorPlacement, 2 ** settledViewState.zoom) !== "whole") {
      setHoveredPlacementKey(placementKey(anchorPlacement));
      setHoveredResizePick(pick?.kind === "resize" ? pick : null);
    } else if (!gestureRef.current) {
      setHoveredPlacementKey(null);
      setHoveredResizePick(null);
    }
    if (pick?.kind === "placement" && pick.placement.resource_type === "logic_gate" && processMapPlacementDisplayLOD(pick.placement, 2 ** settledViewState.zoom) !== "whole") {
      showHoverCard(pick.placement.resource_id);
    } else if (hoveredProcessID) {
      scheduleHoverClose(hoveredProcessID);
    }
  }, [hoveredProcessID, scheduleHoverClose, settledViewState.zoom, showHoverCard]);

  const removeSelection = useCallback(async () => {
    if (!visibleSelection) return;
    if (visibleSelection.kind === "placements") {
      setNotice("Multiple placements are selected. Move or delete them one at a time.");
      return;
    }
    if (visibleSelection.kind === "trace") {
      gestureRef.current = null;
      setGesture(null);
      setHoveredPlacementKey(null);
      setHoveredResizePick(null);
      const trace = presentationRef.current.traces.get(visibleSelection.id);
      if (!trace) return;
      const id = trace.resource_operational_relationship_id;
      const operationKey = `trace:${id}`;
      const canonicalGeneration = canonicalGenerationRef.current;
      const operationGeneration = nextOperation(operationKey);
      setPreviewTraces((current) => replaceProcessMapPreviewEntries(current, [id], new Map()));
      setRemovedTraceIDs((current) => new Set(current).add(id));
      setSelection(null);
      try {
        const envelope = await deleteProcessMapRelationship(apiBase, companyID, id);
        if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(operationKey) ?? 0)) {
          if (canonicalGeneration === canonicalGenerationRef.current) refreshAfterMutation(envelope.process_map_read_version);
          return;
        }
        refreshAfterMutation(envelope.process_map_read_version);
        setNotice("Operational relationship removed.");
      } catch (cause) {
        if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(operationKey) ?? 0)) return;
        setRemovedTraceIDs((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setNotice(errorMessage(cause, "Operational relationship could not be removed."));
      }
      return;
    }
    const placement = presentationRef.current.placements.get(visibleSelection.id);
    if (!placement) return;
    const confirmed = window.confirm(placement.resource_type === "logic_gate"
      ? `Delete \"${placement.name}\" from Company Explorer? This removes only its Company Explorer placement. The Process and its data will remain.`
      : `Delete Company Explorer Folder \"${placement.name}\" and its subtree? Existing Company Explorer deletion rules apply.`);
    if (!confirmed) return;
    gestureRef.current = null;
    setGesture(null);
    setHoveredPlacementKey(null);
    setHoveredResizePick(null);
    const key = placementKey(placement);
    const canonicalGeneration = canonicalGenerationRef.current;
    const expectedOperationGenerations = new Map<string, number>();
    const reserveOperation = (operationKey: string) => {
      const generation = nextOperation(operationKey);
      expectedOperationGenerations.set(operationKey, generation);
      return generation;
    };
    const operationGeneration = reserveOperation(key);
    const removalPlacementKeys = placement.resource_type === "company_explorer_folder"
      ? new Set(processMapPlacementSubtree(placement, presentationRef.current.placements).keys())
      : new Set([key]);
    for (const affectedKey of removalPlacementKeys) {
      if (affectedKey !== key) reserveOperation(affectedKey);
    }
    const affectedTraceIDs = new Set(
      [...presentationRef.current.traces.values()]
        .filter((trace) => removalPlacementKeys.has(placementKey(trace.source)) || removalPlacementKeys.has(placementKey(trace.target)))
        .map((trace) => trace.resource_operational_relationship_id),
    );
    for (const traceID of affectedTraceIDs) reserveOperation(`trace:${traceID}`);
    setPreviewPlacements((current) => replaceProcessMapPreviewEntries(current, removalPlacementKeys, new Map()));
    setPreviewTraces((current) => replaceProcessMapPreviewEntries(current, affectedTraceIDs, new Map()));
    setCommittedOverlay((current) => {
      const placements = new Map(current.placements);
      const removedPlacementKeys = new Set(current.removedPlacementKeys);
      for (const affectedKey of removalPlacementKeys) {
        placements.delete(affectedKey);
        removedPlacementKeys.add(affectedKey);
      }
      return { placements, traces: new Map(current.traces), removedPlacementKeys };
    });
    setRemovedTraceIDs((current) => new Set([...current, ...affectedTraceIDs]));
    setSelection(null);
    if (placement.resource_type === "logic_gate") setPinnedProcessID((current) => current === placement.resource_id ? null : current);
    try {
      const envelope = await deleteProcessMapPlacement(apiBase, companyID, placement);
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(key) ?? 0)) {
        if (canonicalGeneration === canonicalGenerationRef.current) refreshAfterMutation(envelope.process_map_read_version);
        return;
      }
      applyEnvelope(envelope, new Map(), affectedTraceIDs, expectedOperationGenerations);
      setNotice(placement.resource_type === "logic_gate"
        ? "Company Explorer placement removed. The Process and its data remain."
        : "Company Explorer Folder and its subtree were removed.");
    } catch (cause) {
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(key) ?? 0)) return;
      setCommittedOverlay((current) => {
        const removedPlacementKeys = new Set(current.removedPlacementKeys);
        for (const affectedKey of removalPlacementKeys) removedPlacementKeys.delete(affectedKey);
        return { ...current, removedPlacementKeys };
      });
      setRemovedTraceIDs((current) => {
        const next = new Set(current);
        affectedTraceIDs.forEach((id) => next.delete(id));
        return next;
      });
      invalidateProcessMapReadCaches(apiBase, companyID);
      markUnsettled();
      void loadScene(false);
      setNotice(errorMessage(cause, "Company Explorer deletion was rolled back."));
    }
  }, [apiBase, applyEnvelope, companyID, loadScene, markUnsettled, nextOperation, refreshAfterMutation, visibleSelection]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!selectionVisible) return;
      event.preventDefault();
      void removeSelection();
    } else if ((event.key === "Enter" || event.key === " ") && selectedPlacement?.resource_type === "logic_gate") {
      event.preventDefault();
      openProcess(selectedPlacement);
    } else if (event.key === "Escape") {
      const current = gestureRef.current;
      if (current?.kind === "waypoint") {
        setPreviewTraces((previews) => replaceProcessMapPreviewEntries(previews, [current.trace.resource_operational_relationship_id], new Map()));
      }
      gestureRef.current = null;
      setGesture(null);
      setSelection(null);
      setHoveredPlacementKey(null);
      setHoveredResizePick(null);
    }
  }, [openProcess, removeSelection, selectedPlacement, selectionVisible]);

  const qdPlacement = useMemo(() => {
    const id = pinnedProcessID ?? (hoverModeEnabled ? hoveredProcessID : null);
    return id ? presentation.placements.get(`logic_gate:${id}`) ?? null : null;
  }, [hoverModeEnabled, hoveredProcessID, pinnedProcessID, presentation.placements]);
  const qdGeometry = qdPlacement ? processMapPlacementGeometryForTransform(qdPlacement, placementTransform) : null;
  const qdVisible = qdPlacement && qdGeometry && processMapPlacementDisplayLOD({
    grid_width: qdGeometry.grid_width,
    grid_height: qdGeometry.grid_height,
    presentation: qdPlacement.presentation,
  }, 2 ** settledViewState.zoom) !== "whole";
  const qdPosition = useMemo(() => {
    if (!qdVisible || !qdGeometry) return null;
    const scale = 2 ** viewState.zoom;
    return {
      left: viewportSize.width / 2 + (qdGeometry.grid_x + qdGeometry.grid_width - viewState.target[0]) * scale + 22,
      top: viewportSize.height / 2 + (qdGeometry.grid_y - viewState.target[1]) * scale,
    };
  }, [qdGeometry, qdVisible, viewState, viewportSize]);
  const cameraDragEnabled = gesture === null;
  const resizeCursor = gesture?.kind === "resize"
    ? processMapResizeCursor(gesture.horizontal!, gesture.vertical!)
    : hoveredResizePick
      ? processMapResizeCursor(hoveredResizePick.horizontal, hoveredResizePick.vertical)
      : null;
  const dragSelectionActive = gesture?.kind === "drag-selection";
  const orthographicView = useMemo(() => new OrthographicView({
    id: "process-map",
    flipY: true,
    controller: {
      dragPan: cameraDragEnabled,
      dragRotate: false,
      scrollZoom: true,
      doubleClickZoom: false,
      touchRotate: false,
      keyboard: false,
      inertia: false,
    },
  }), [cameraDragEnabled]);

  return (
    <div
      ref={surfaceRef}
      className="process-map-surface"
      tabIndex={0}
      role="application"
      aria-label={selection?.kind === "placements"
        ? `Process Map. ${selection.ids.size} placements selected.`
        : selectedPlacement
          ? `Process Map. Selected ${selectedPlacement.name}.`
          : "Process Map company canvas"}
      onKeyDown={handleKeyDown}
    >
      <DeckGL
        ref={deckRef}
        views={orthographicView}
        viewState={viewState}
        layers={layers}
        pickingRadius={4}
        useDevicePixels
        onResize={({ width, height }) => setViewportSize({ width, height })}
        onViewStateChange={handleViewStateChange}
        onInteractionStateChange={(state: InteractionState) => settlementGateRef.current?.onInteractionStateChange(state)}
        onHover={handleHover}
        onClick={handleClick}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        onError={(cause) => setNotice(errorMessage(cause, "Process Map drawing failed."))}
        getCursor={({ isDragging, isHovering }) => dragSelectionActive ? "crosshair" : resizeCursor ?? (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
      />

      {qdPosition && qdPlacement && <div data-process-map-fixed-overlay="true" className="process-map-qd-overlay" style={qdPosition}>
        <ProcessMapQDCard
          apiBase={apiBase}
          companyID={companyID}
          logicGateID={qdPlacement.resource_id}
          processName={qdPlacement.name}
          pinned={pinnedProcessID === qdPlacement.resource_id}
          requestJSON={requestJSON}
          onClose={() => {
            setPinnedProcessID(null);
            setHoveredProcessID(null);
          }}
          onPointerEnter={() => showHoverCard(qdPlacement.resource_id)}
          onPointerLeave={() => scheduleHoverClose(qdPlacement.resource_id)}
        />
      </div>}
      {loading && <div data-process-map-fixed-overlay="true" className="process-map-loading" role="status">Loading Process Map…</div>}
      {error && <div data-process-map-fixed-overlay="true" className="process-map-message is-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadScene(true)}>Retry</button></div>}
      {!error && notice && <div data-process-map-fixed-overlay="true" className="process-map-message" role="status">{notice}</div>}
    </div>
  );
}
