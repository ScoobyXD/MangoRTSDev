import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OrthographicView,
  type InteractionState,
  type Layer,
  type OrthographicViewState,
  type PickingInfo,
  type UpdateParameters,
  type ViewStateChangeParameters,
} from "@deck.gl/core";
import { TileLayer, type TileLayerProps } from "@deck.gl/geo-layers";
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import DeckGL, { type DeckGLRef } from "@deck.gl/react";
import { getAuthSessionCacheGeneration } from "../../auth/cognitoAuth.js";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../icons/index.js";
import { createRequestJSON, isAbortError } from "../api/requestJSON.js";
import { EXPLORER_DRAG_MIME, readExplorerDragPayload } from "../company-explorer/companyExplorerDragDrop.js";
import {
  fetchCompanyExplorerChildren,
  fetchCompanyExplorerRoots,
  type CompanyExplorerV2Row,
} from "../company-explorer/companyExplorerLazyApi.js";
import { createCoalescedCanonicalRefresh } from "../realtime/coalescedCanonicalRefresh.js";
import { getCurrentRealtimeConnectionID, subscribeRealtimeScope } from "../realtime/realtimeWebSocket.js";
import { ProcessMapQDCard } from "./ProcessMapQDCard.js";
import {
  deleteProcessMapPlacement,
  deleteProcessMapRelationship,
  fetchProcessMapScene,
  fetchProcessMapTile,
  invalidateProcessMapReadCaches,
  postProcessMapRelationship,
  putProcessMapPlacement,
  putProcessMapTrace,
  type ProcessMapMutationEnvelope,
  type ProcessMapPlacement,
  type ProcessMapResourceRef,
  type ProcessMapSceneResponse,
  type ProcessMapTileResponse,
  type ProcessMapTrace,
  type ProcessMapVisiblePlacement,
} from "./processMapApi.js";
import {
  PROCESS_MAP_DEFAULT_HEIGHT,
  PROCESS_MAP_DEFAULT_WIDTH,
  PROCESS_MAP_MAX_CAMERA_ZOOM,
  PROCESS_MAP_MAX_TILE_REQUESTS,
  PROCESS_MAP_MIN_CAMERA_ZOOM,
  PROCESS_MAP_RESTRICTED_HEIGHT,
  PROCESS_MAP_RESTRICTED_WIDTH,
  PROCESS_MAP_SETTLE_DELAY_MS,
  PROCESS_MAP_TILE_CACHE_BYTES,
  PROCESS_MAP_TILE_DEBOUNCE_MS,
  fitProcessMapViewState,
  insertProcessMapRoutePoint,
  normalizeProcessMapRoutePoints,
  processMapBoundsContain,
  processMapDeckTileSize,
  processMapDeepestContainingFolder,
  processMapInputAnchor,
  processMapOrthogonalPathPoints,
  processMapOutputAnchor,
  processMapPlacementBounds,
  processMapPlacementDisplayLOD,
  snapProcessMapGridCoordinate,
  type ProcessMapBounds,
  type ProcessMapGridPoint,
  type ProcessMapViewState,
} from "./processMapGeometry.js";
import {
  createProcessMapSettlementGate,
  decideProcessMapExplorerDrop,
  processMapResourceNodeID,
  processMapTrayCandidates,
  shouldApplyProcessMapCommit,
  shouldApplyProcessMapMutationAck,
  transparentVectorRefinementStrategy,
} from "./processMapInteraction.js";
import "./processMap.css";

const PROCESS_MAP_REALTIME_SCOPE = "process-map:company";
const PROCESS_MAP_TRAY_COLLAPSED_STORAGE_KEY = "mangorts.process-map.placement-tray-collapsed.v1";
const PROCESS_MAP_DOUBLE_CLICK_MS = 300;
const COLOR_FOLDER: [number, number, number, number] = [249, 115, 22, 230];
const COLOR_PROCESS: [number, number, number, number] = [25, 240, 122, 235];
const COLOR_TRACE_START: [number, number, number, number] = [51, 221, 213, 220];
const COLOR_TRACE_END: [number, number, number, number] = [25, 168, 255, 220];
const COLOR_TEXT: [number, number, number, number] = [30, 41, 59, 245];

export class ProcessMapProtectedTileLayer extends TileLayer<ProcessMapTileResponse, { protectedGeneration: number }> {
  static override layerName = "ProcessMapProtectedTileLayer";

  override updateState(params: UpdateParameters<this>): void {
    if (
      this.state.tileset
      && params.oldProps.protectedGeneration !== params.props.protectedGeneration
    ) {
      this.state.tileset.finalize();
      this.setState({ tileset: null, isLoaded: false });
    }
    super.updateState(params);
  }
}

type ProcessMapSelection = { kind: "placement" | "trace"; id: string } | null;
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

export type ProcessMapPresentationState = {
  placements: Map<string, ProcessMapVisiblePlacement>;
  traces: Map<string, ProcessMapTrace>;
  removedPlacementKeys: Set<string>;
};

export type ProcessMapEditOverlayModel = {
  placements: ProcessMapVisiblePlacement[];
  traces: ProcessMapTrace[];
  selectedPlacementKey: string | null;
  selectedTraceID: string | null;
  connectionPreview: { source: ProcessMapVisiblePlacement; point: ProcessMapGridPoint } | null;
  highlightedFolderKey: string | null;
  connectionSourceKey: string | null;
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
  settled: boolean;
  settledPixelsPerGridUnit: number;
  presentation: ProcessMapPresentationState;
  editedPlacementKeys: ReadonlySet<string>;
  editedTraceIDs: ReadonlySet<string>;
  editOverlay: ProcessMapEditOverlayModel;
  getTileData: (request: ProcessMapTileLoadRequest) => Promise<ProcessMapTileResponse | null>;
  onTileLoad: (tileID: string, data: ProcessMapTileResponse, protectedGeneration: number) => void;
  onTileUnload: (tileID: string, readVersion: number, protectedGeneration: number) => void;
  onViewportLoad?: (protectedGeneration: number) => void;
  onTileError?: (cause: unknown) => void;
};

type ProcessMapSpatialLayerBuildOptions = Omit<ProcessMapLayerBuildOptions, "presentation" | "editOverlay" | "settled"> & {
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
  baseTraces: Map<string, ProcessMapTrace>;
  horizontal?: "west" | "east";
  vertical?: "north" | "south";
  moved: boolean;
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
type ProcessMapGesture = PlacementGesture | ConnectionGesture | WaypointGesture;
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
type TextDatum = { position: [number, number]; text: string; size: number };
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

export function reconcileProcessMapKnownMappedKeys(
  current: ReadonlySet<string>,
  additions: readonly ProcessMapResourceRef[],
  removals: readonly ProcessMapResourceRef[] = [],
): Set<string> {
  const next = new Set(current);
  for (const resource of additions) next.add(placementKey(resource));
  for (const resource of removals) next.delete(placementKey(resource));
  return next;
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

function segmentColor(index: number, count: number): [number, number, number, number] {
  const ratio = count <= 1 ? 0.5 : index / (count - 1);
  return [
    Math.round(COLOR_TRACE_START[0] + (COLOR_TRACE_END[0] - COLOR_TRACE_START[0]) * ratio),
    Math.round(COLOR_TRACE_START[1] + (COLOR_TRACE_END[1] - COLOR_TRACE_START[1]) * ratio),
    Math.round(COLOR_TRACE_START[2] + (COLOR_TRACE_END[2] - COLOR_TRACE_START[2]) * ratio),
    220,
  ];
}

function staticTraceSegments(
  fragments: readonly ProcessMapGridPoint[][],
  width: number,
  pick?: ProcessMapPick,
): PathDatum[] {
  const pairs = fragments.flatMap((fragment) => fragment.slice(1).map((point, index) => [fragment[index], point] as const));
  const halves = pairs.flatMap(([start, end]) => {
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return [[start, midpoint], [midpoint, end]] as const;
  });
  return halves.map((pair, index) => ({
    path: pair.map((point) => [point.x, point.y]),
    color: segmentColor(index, halves.length),
    width,
    pick,
  }));
}

function traceSegments(trace: ProcessMapTrace, width = 3): PathDatum[] {
  const pick: TracePick = { kind: "trace", id: trace.resource_operational_relationship_id, trace };
  return staticTraceSegments(trace.path_fragments, width, pick);
}

function placementBounds(placement: ProcessMapPlacement): ProcessMapBounds {
  return placement.restricted ? {
    min_x: placement.grid_x,
    min_y: placement.grid_y,
    max_x: placement.grid_x + PROCESS_MAP_RESTRICTED_WIDTH,
    max_y: placement.grid_y + PROCESS_MAP_RESTRICTED_HEIGHT,
  } : processMapPlacementBounds(placement);
}

function renderTileSubLayers(
  props: Parameters<NonNullable<TileLayerProps<ProcessMapTileResponse>["renderSubLayers"]>>[0],
  options: ProcessMapSpatialLayerBuildOptions,
): Layer[] {
  if (!props.data) return [];
  const tile = tileBounds(props.tile.boundingBox);
  const fences: PathDatum[] = [];
  const traces: PathDatum[] = [];
  const bodies: PolygonDatum[] = [];
  const restricted: PolygonDatum[] = [];
  const processPerimeters: PathDatum[] = [];
  const restrictedPerimeters: PathDatum[] = [];
  const labels: TextDatum[] = [];
  for (const placement of props.data.placements) {
    const bounds = placementBounds(placement);
    const clipped = clipRectangle(bounds, tile);
    if (!clipped) continue;
    if (placement.restricted) {
      restricted.push({ polygon: boundsPolygon(clipped), fill: [226, 232, 240, 245], line: [100, 116, 139, 210], lineWidth: 0 });
      for (const path of processMapPerimeterSegments(bounds, tile)) restrictedPerimeters.push({ path, color: [100, 116, 139, 210], width: 1 });
      const center = { x: (bounds.min_x + bounds.max_x) / 2, y: (bounds.min_y + bounds.max_y) / 2 };
      if (ownsCoordinate(center, tile)) labels.push({ position: [center.x, center.y], text: "?", size: 13 });
      continue;
    }
    const key = placementKey(placement);
    if (options.editedPlacementKeys.has(key) || options.selectedPlacementKey === key) continue;
    const pick: PlacementPick = { kind: "placement", key, placement };
    const lod = processMapPlacementDisplayLOD(placement, options.settledPixelsPerGridUnit);
    if (placement.resource_type === "company_explorer_folder") {
      for (const path of processMapPerimeterSegments(bounds, tile)) fences.push({ path, color: COLOR_FOLDER, width: lod === "editing" ? 2.5 : 1.5, pick });
    } else {
      bodies.push({
        polygon: boundsPolygon(clipped),
        fill: lod === "whole" ? [226, 232, 240, 238] : [255, 255, 255, 238],
        line: COLOR_PROCESS,
        lineWidth: 0,
        pick,
      });
      for (const path of processMapPerimeterSegments(bounds, tile)) processPerimeters.push({ path, color: COLOR_PROCESS, width: lod === "editing" ? 2.5 : 1.5, pick });
    }
    const center = { x: (bounds.min_x + bounds.max_x) / 2, y: (bounds.min_y + bounds.max_y) / 2 };
    if (lod !== "whole") {
      const labelPosition: [number, number] = placement.resource_type === "company_explorer_folder"
        ? [center.x, bounds.min_y + (lod === "editing" ? 18 : 10) / options.settledPixelsPerGridUnit]
        : [center.x, center.y];
      if (ownsCoordinate({ x: labelPosition[0], y: labelPosition[1] }, tile)) labels.push({
        position: labelPosition,
        text: lod === "editing" ? `${placement.resource_type === "company_explorer_folder" ? "Folder" : "Process"}\n${placement.name}` : placement.name,
        size: lod === "editing" ? 13 : 11,
      });
    }
  }
  for (const trace of props.data.traces) {
    const id = trace.resource_operational_relationship_id;
    if (!options.editedTraceIDs.has(id) && options.selectedTraceID !== id) traces.push(...traceSegments(trace));
  }
  return [
    new PathLayer<PathDatum>({ id: `${props.id}-traces`, data: traces, pickable: true, positionFormat: "XY", widthUnits: "pixels", widthMinPixels: 2, getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
    new PathLayer<PathDatum>({ id: `${props.id}-folder-fences`, data: fences, pickable: true, positionFormat: "XY", widthUnits: "pixels", widthMinPixels: 1, getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
    new PolygonLayer<PolygonDatum>({ id: `${props.id}-placements`, data: bodies, pickable: true, filled: true, stroked: false, getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill }),
    new PolygonLayer<PolygonDatum>({ id: `${props.id}-restricted`, data: restricted, pickable: false, filled: true, stroked: false, getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill }),
    new PathLayer<PathDatum>({ id: `${props.id}-process-perimeters`, data: processPerimeters, pickable: true, positionFormat: "XY", widthUnits: "pixels", widthMinPixels: 1, getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
    new PathLayer<PathDatum>({ id: `${props.id}-restricted-perimeters`, data: restrictedPerimeters, pickable: false, positionFormat: "XY", widthUnits: "pixels", widthMinPixels: 1, getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
    new TextLayer<TextDatum>({ id: `${props.id}-labels`, data: labels, pickable: false, billboard: true, sizeUnits: "pixels", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", fontWeight: 700, getPosition: (item) => item.position, getText: (item) => item.text, getSize: (item) => item.size, getColor: COLOR_TEXT, getTextAnchor: "middle", getAlignmentBaseline: "center" }),
  ];
}

function editTraceLayers(options: ProcessMapLayerBuildOptions): { path: Layer; waypoints: Layer } {
  const paths: PathDatum[] = [];
  const waypoints: PointDatum[] = [];
  for (const trace of options.editOverlay.traces) {
    const fullPath = tracePath(trace, options.presentation.placements);
    const pathFragments = fullPath ? [fullPath] : trace.path_fragments;
    paths.push(...traceSegments({ ...trace, path_fragments: pathFragments }, 4));
    if (trace.presentation !== "editing" || options.editOverlay.selectedTraceID !== trace.resource_operational_relationship_id) continue;
    const source = options.presentation.placements.get(placementKey(trace.source));
    const target = options.presentation.placements.get(placementKey(trace.target));
    if (
      !source
      || !target
      || processMapPlacementDisplayLOD(source, options.settledPixelsPerGridUnit) !== "editing"
      || processMapPlacementDisplayLOD(target, options.settledPixelsPerGridUnit) !== "editing"
    ) continue;
    trace.route_points.forEach((point, index) => waypoints.push({
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
    paths.push(...staticTraceSegments([processMapOrthogonalPathPoints(start, [], end)], 3));
  }
  return {
    path: new PathLayer<PathDatum>({ id: "process-map-edit-traces", data: paths, pickable: true, positionFormat: "XY", widthUnits: "pixels", widthMinPixels: 2, getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
    waypoints: new ScatterplotLayer<PointDatum>({ id: "process-map-edit-waypoints", data: waypoints, pickable: true, radiusUnits: "pixels", lineWidthUnits: "pixels", stroked: true, getPosition: (item) => item.position, getRadius: (item) => item.radius, getFillColor: (item) => item.fill, getLineColor: (item) => item.line, getLineWidth: 2 }),
  };
}

function editPlacementLayers(options: ProcessMapLayerBuildOptions): Layer[] {
  const bodies: PolygonDatum[] = [];
  const fences: PathDatum[] = [];
  const labels: TextDatum[] = [];
  const handles: PointDatum[] = [];
  const anchors: PointDatum[] = [];
  for (const placement of options.editOverlay.placements) {
    const key = placementKey(placement);
    const bounds = processMapPlacementBounds(placement);
    const pick: PlacementPick = { kind: "placement", key, placement };
    if (placement.resource_type === "company_explorer_folder") {
      const color = options.editOverlay.highlightedFolderKey === key ? [14, 165, 233, 250] as const : COLOR_FOLDER;
      const perimeter = [
        [[bounds.min_x, bounds.min_y], [bounds.max_x, bounds.min_y]],
        [[bounds.max_x, bounds.min_y], [bounds.max_x, bounds.max_y]],
        [[bounds.max_x, bounds.max_y], [bounds.min_x, bounds.max_y]],
        [[bounds.min_x, bounds.max_y], [bounds.min_x, bounds.min_y]],
      ];
      for (const path of perimeter) fences.push({ path, color: [...color], width: options.editOverlay.highlightedFolderKey === key ? 4 : 3, pick });
    } else {
      bodies.push({ polygon: boundsPolygon(bounds), fill: [255, 255, 255, 244], line: COLOR_PROCESS, lineWidth: 3, pick });
    }
    const lod = processMapPlacementDisplayLOD(placement, options.settledPixelsPerGridUnit);
    if (lod !== "whole") labels.push({
      position: [
        (bounds.min_x + bounds.max_x) / 2,
        placement.resource_type === "company_explorer_folder"
          ? bounds.min_y + (lod === "editing" ? 18 : 10) / options.settledPixelsPerGridUnit
          : (bounds.min_y + bounds.max_y) / 2,
      ],
      text: lod === "editing" ? `${placement.resource_type === "company_explorer_folder" ? "Folder" : "Process"}\n${placement.name}` : placement.name,
      size: 13,
    });
    if (!options.settled || options.editOverlay.selectedPlacementKey !== key || lod !== "editing") continue;
    const corners: Array<[ResizePick["horizontal"], ResizePick["vertical"], [number, number]]> = [
      ["west", "north", [bounds.min_x, bounds.min_y]], ["east", "north", [bounds.max_x, bounds.min_y]],
      ["east", "south", [bounds.max_x, bounds.max_y]], ["west", "south", [bounds.min_x, bounds.max_y]],
    ];
    for (const [horizontal, vertical, position] of corners) handles.push({ position, radius: 5, fill: [255, 255, 255, 255], line: placement.resource_type === "company_explorer_folder" ? COLOR_FOLDER : COLOR_PROCESS, pick: { kind: "resize", horizontal, vertical, key, placement } });
  }
  if (options.settled) {
    for (const placement of options.presentation.placements.values()) {
      const key = placementKey(placement);
      if (processMapPlacementDisplayLOD(placement, options.settledPixelsPerGridUnit) !== "editing") continue;
      const input = processMapInputAnchor(placement);
      const output = processMapOutputAnchor(placement);
      if (options.editOverlay.connectionSourceKey) {
        if (key === options.editOverlay.connectionSourceKey) {
          anchors.push({ position: [output.x, output.y], radius: 7, fill: [14, 165, 233, 255], line: [255, 255, 255, 255], pick: { kind: "anchor", anchor: "output", key, placement } });
        } else {
          anchors.push({ position: [input.x, input.y], radius: 8, fill: [236, 254, 255, 255], line: [25, 168, 255, 255], pick: { kind: "anchor", anchor: "input", key, placement } });
        }
        continue;
      }
      if (options.editOverlay.selectedPlacementKey !== key) continue;
      anchors.push({ position: [input.x, input.y], radius: 6, fill: [255, 255, 255, 255], line: [14, 165, 233, 255], pick: { kind: "anchor", anchor: "input", key, placement } });
      anchors.push({ position: [output.x, output.y], radius: 6, fill: [14, 165, 233, 255], line: [255, 255, 255, 255], pick: { kind: "anchor", anchor: "output", key, placement } });
    }
  }
  return [
    new PathLayer<PathDatum>({ id: "process-map-edit-folder-fences", data: fences, pickable: true, positionFormat: "XY", widthUnits: "pixels", getPath: (item) => item.path.flat(), getColor: (item) => item.color, getWidth: (item) => item.width }),
    new PolygonLayer<PolygonDatum>({ id: "process-map-edit-placement-bodies", data: bodies, pickable: true, filled: true, stroked: true, lineWidthUnits: "pixels", getPolygon: (item) => item.polygon, getFillColor: (item) => item.fill, getLineColor: (item) => item.line, getLineWidth: (item) => item.lineWidth }),
    new TextLayer<TextDatum>({ id: "process-map-edit-labels", data: labels, pickable: false, billboard: true, sizeUnits: "pixels", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", fontWeight: 700, getPosition: (item) => item.position, getText: (item) => item.text, getSize: (item) => item.size, getColor: COLOR_TEXT, getTextAnchor: "middle", getAlignmentBaseline: "center" }),
    new ScatterplotLayer<PointDatum>({ id: "process-map-edit-resize-handles", data: handles, pickable: true, radiusUnits: "pixels", lineWidthUnits: "pixels", stroked: true, getPosition: (item) => item.position, getRadius: (item) => item.radius, getFillColor: (item) => item.fill, getLineColor: (item) => item.line, getLineWidth: 2 }),
    new ScatterplotLayer<PointDatum>({ id: "process-map-edit-anchors", data: anchors, pickable: true, radiusUnits: "pixels", lineWidthUnits: "pixels", stroked: true, getPosition: (item) => item.position, getRadius: (item) => item.radius, getFillColor: (item) => item.fill, getLineColor: (item) => item.line, getLineWidth: 2 }),
  ];
}

function buildProcessMapSpatialLayers(options: ProcessMapSpatialLayerBuildOptions): ProcessMapSpatialLayers {
  const sceneBounds = options.scene.bounds;
  const backgroundBounds = sceneBounds ?? { min_x: -1, min_y: -1, max_x: 1, max_y: 1 };
  const background = new PolygonLayer<PolygonDatum>({
    id: "process-map-background",
    data: [{ polygon: boundsPolygon(backgroundBounds), fill: [255, 255, 255, 255], line: [255, 255, 255, 0], lineWidth: 0 }],
    pickable: false,
    filled: true,
    stroked: false,
    getPolygon: (item) => item.polygon,
    getFillColor: (item) => item.fill,
  });
  const tile = sceneBounds ? new ProcessMapProtectedTileLayer({
    id: "process-map-spatial-tiles",
    protectedGeneration: options.protectedGeneration,
    data: `${options.scene.process_map_read_version}:${options.protectedGeneration}`,
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
  return [spatial.background, editTraces.path, ...(spatial.tile ? [spatial.tile] : []), editTraces.waypoints, ...editPlacementLayers(options)];
}

export function buildProcessMapLayers(options: ProcessMapLayerBuildOptions): Layer[] {
  const spatial = buildProcessMapSpatialLayers({
    ...options,
    selectedPlacementKey: options.editOverlay.selectedPlacementKey,
    selectedTraceID: options.editOverlay.selectedTraceID,
  });
  return composeProcessMapLayers(options, spatial);
}

function readTrayCollapsed(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(PROCESS_MAP_TRAY_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function storeTrayCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(PROCESS_MAP_TRAY_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // Browser storage is only a view preference.
  }
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

function pointFromInfo(info: PickingInfo): ProcessMapGridPoint | null {
  return info.coordinate && info.coordinate.length >= 2 ? { x: info.coordinate[0], y: info.coordinate[1] } : null;
}

function descendantsForMove(
  root: ProcessMapVisiblePlacement,
  placements: ReadonlyMap<string, ProcessMapVisiblePlacement>,
): Map<string, ProcessMapVisiblePlacement> {
  const result = new Map<string, ProcessMapVisiblePlacement>([[placementKey(root), clonePlacement(root)]]);
  if (root.resource_type !== "company_explorer_folder") return result;
  for (let changed = true; changed;) {
    changed = false;
    for (const placement of placements.values()) {
      const key = placementKey(placement);
      if (result.has(key) || !placement.map_parent_folder_id) continue;
      const hasParent = [...result.values()].some((parent) => (
        parent.resource_type === "company_explorer_folder" && parent.resource_id === placement.map_parent_folder_id
      ));
      if (!hasParent) continue;
      result.set(key, clonePlacement(placement));
      changed = true;
    }
  }
  return result;
}

function folderContainsItsChildren(
  folder: ProcessMapVisiblePlacement,
  placements: ReadonlyMap<string, ProcessMapVisiblePlacement>,
): boolean {
  const descendants = descendantsForMove(folder, placements);
  descendants.delete(placementKey(folder));
  return [...descendants.values()].every((placement) => (
    processMapBoundsContain(processMapPlacementBounds(folder), processMapPlacementBounds(placement))
  ));
}

function translatedTraces(
  traces: ReadonlyMap<string, ProcessMapTrace>,
  movedKeys: ReadonlySet<string>,
  dx: number,
  dy: number,
): Map<string, ProcessMapTrace> {
  const result = new Map<string, ProcessMapTrace>();
  for (const trace of traces.values()) {
    if (!movedKeys.has(placementKey(trace.source)) || !movedKeys.has(placementKey(trace.target))) continue;
    result.set(trace.resource_operational_relationship_id, {
      ...cloneTrace(trace),
      route_points: trace.route_points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      path_fragments: trace.path_fragments.map((fragment) => fragment.map((point) => ({ x: point.x + dx, y: point.y + dy }))),
    });
  }
  return result;
}

export function ProcessMapSurface({ apiBase, companyID, hoverModeEnabled = false, onOpenLogicGate }: ProcessMapSurfaceProps) {
  const authGeneration = getAuthSessionCacheGeneration();
  const knownMappedScope = `${apiBase.trim()}\u0000${companyID.trim()}\u0000${authGeneration}`;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const deckRef = useRef<DeckGLRef<OrthographicView> | null>(null);
  const [scene, setScene] = useState<ProcessMapSceneResponse | null>(null);
  const [viewState, setViewState] = useState<ProcessMapViewState>(() => fitProcessMapViewState(null, { width: 1, height: 1 }));
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [settled, setSettled] = useState(false);
  const [protectedGeneration, setProtectedGeneration] = useState(0);
  const [protectedScope, setProtectedScope] = useState(knownMappedScope);
  const [settledViewState, setSettledViewState] = useState(viewState);
  const [loadedTiles, setLoadedTiles] = useState<Map<string, ProcessMapTileResponse>>(new Map());
  const [committedOverlay, setCommittedOverlay] = useState<ProcessMapPresentationState>(emptyPresentation);
  const [previewPlacements, setPreviewPlacements] = useState<Map<string, ProcessMapVisiblePlacement>>(new Map());
  const [previewTraces, setPreviewTraces] = useState<Map<string, ProcessMapTrace>>(new Map());
  const [removedTraceIDs, setRemovedTraceIDs] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<ProcessMapSelection>(null);
  const [hoveredProcessID, setHoveredProcessID] = useState<string | null>(null);
  const [pinnedProcessID, setPinnedProcessID] = useState<string | null>(null);
  const [gesture, setGesture] = useState<ProcessMapGesture | null>(null);
  const [externalDropPoint, setExternalDropPoint] = useState<ProcessMapGridPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trayCollapsed, setTrayCollapsed] = useState(readTrayCollapsed);
  const [trayRows, setTrayRows] = useState<CompanyExplorerV2Row[]>([]);
  const [trayPath, setTrayPath] = useState<Array<{ id: string; label: string }>>([]);
  const [trayLoading, setTrayLoading] = useState(false);
  const [trayError, setTrayError] = useState("");
  const trayListID = React.useId();
  const [knownMapped, setKnownMapped] = useState<{ scope: string; keys: Set<string> }>(() => ({ scope: knownMappedScope, keys: new Set() }));
  const protectedScopeCurrent = protectedScope === knownMappedScope;
  const activeScene = protectedScopeCurrent ? scene : null;
  const knownMappedPlacementKeys = knownMapped.scope === knownMappedScope ? knownMapped.keys : new Set<string>();

  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const viewRef = useRef(viewState);
  const sceneRef = useRef(activeScene);
  const presentationRef = useRef<ProcessMapPresentationState>(emptyPresentation());
  const committedOverlayRef = useRef(committedOverlay);
  const removedTraceIDsRef = useRef(removedTraceIDs);
  const gestureRef = useRef<ProcessMapGesture | null>(null);
  const settlementGateRef = useRef<ReturnType<typeof createProcessMapSettlementGate> | null>(null);
  const sceneAbortRef = useRef<AbortController | null>(null);
  const fittedSceneRef = useRef(false);
  const canonicalGenerationRef = useRef(0);
  const operationGenerationRef = useRef(new Map<string, number>());
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const lastClickRef = useRef<{ id: string; at: number } | null>(null);
  viewRef.current = viewState;
  sceneRef.current = activeScene;
  gestureRef.current = gesture;
  committedOverlayRef.current = committedOverlay;
  removedTraceIDsRef.current = removedTraceIDs;

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

  useEffect(() => {
    setKnownMapped((current) => current.scope === knownMappedScope ? current : { scope: knownMappedScope, keys: new Set() });
  }, [knownMappedScope]);

  const updateKnownMapped = useCallback((additions: readonly ProcessMapResourceRef[], removals: readonly ProcessMapResourceRef[] = []) => {
    setKnownMapped((current) => ({
      scope: knownMappedScope,
      keys: reconcileProcessMapKnownMappedKeys(current.scope === knownMappedScope ? current.keys : new Set(), additions, removals),
    }));
  }, [knownMappedScope]);

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

  const loadScene = useCallback(async (purgeProtectedGeometry: boolean) => {
    if (!companyID.trim()) return;
    if (purgeProtectedGeometry) {
      setScene(null);
      setProtectedScope(knownMappedScope);
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
      setExternalDropPoint(null);
      setSelection(null);
      setHoveredProcessID(null);
      setPinnedProcessID(null);
    }
    sceneAbortRef.current?.abort();
    const controller = new AbortController();
    sceneAbortRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const nextScene = await fetchProcessMapScene(apiBase, companyID, controller.signal);
      if (controller.signal.aborted) return;
      setScene(nextScene);
      setLoading(false);
      markUnsettled();
    } catch (cause) {
      if (isAbortError(cause)) return;
      setLoading(false);
      setError(errorMessage(cause, "Process Map could not be loaded."));
    }
  }, [advanceProtectedGeneration, apiBase, companyID, knownMappedScope, markUnsettled]);

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
    setHoveredProcessID(null);
    setPinnedProcessID(null);
    markUnsettled();
  }, [activeScene, markUnsettled, viewportSize]);

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
    const folderID = trayPath[trayPath.length - 1]?.id;
    const read = folderID
      ? fetchCompanyExplorerChildren(apiBase, companyID, "all", folderID)
      : fetchCompanyExplorerRoots(apiBase, companyID, "all");
    void read.then((snapshot) => {
      if (active) setTrayRows(snapshot.rows ?? []);
    }).catch((cause) => {
      if (active) setTrayError(errorMessage(cause, "Placement choices are unavailable."));
    }).finally(() => {
      if (active) setTrayLoading(false);
    });
    return () => { active = false; };
  }, [apiBase, companyID, trayCollapsed, trayPath]);

  useEffect(() => {
    const coalesced = createCoalescedCanonicalRefresh(
      () => loadScene(true),
      (cause) => setError(errorMessage(cause, "Process Map could not refresh.")),
    );
    const unsubscribe = subscribeRealtimeScope(apiBase, companyID, PROCESS_MAP_REALTIME_SCOPE, {
      onProcessMapChanged: (message) => {
        if (message.origin_connection_id && message.origin_connection_id === getCurrentRealtimeConnectionID(apiBase, companyID)) return;
        coalesced.request();
      },
      onRecover: () => { coalesced.request(); },
      onRejected: () => {
        advanceProtectedGeneration();
        invalidateProcessMapReadCaches(apiBase, companyID);
        sceneAbortRef.current?.abort();
        setSettled(false);
        setLoadedTiles(new Map());
        setCommittedOverlay(emptyPresentation());
        setPreviewPlacements(new Map());
        setPreviewTraces(new Map());
        setRemovedTraceIDs(new Set());
        setKnownMapped({ scope: knownMappedScope, keys: new Set() });
        gestureRef.current = null;
        setSelection(null);
        setGesture(null);
        setExternalDropPoint(null);
        setHoveredProcessID(null);
        setPinnedProcessID(null);
        setScene(null);
        setError("Process Map access changed. Refresh after your permissions are restored.");
      },
    });
    return () => {
      coalesced.dispose();
      unsubscribe();
    };
  }, [advanceProtectedGeneration, apiBase, companyID, knownMappedScope, loadScene]);

  const guardedGetTileData = useCallback(async (request: ProcessMapTileLoadRequest): Promise<ProcessMapTileResponse | null> => {
    const currentScene = sceneRef.current;
    if (!currentScene || request.z < currentScene.min_tile_zoom || request.z > currentScene.max_tile_zoom) return null;
    try {
      const tile = await fetchProcessMapTile(apiBase, companyID, currentScene.process_map_read_version, request.z, request.x, request.y, request.signal);
      if (request.signal?.aborted || tile.process_map_read_version !== sceneRef.current?.process_map_read_version) return null;
      return tile;
    } catch (cause) {
      if (isAbortError(cause)) return null;
      throw cause;
    }
  }, [apiBase, companyID]);

  const handleTileLoad = useCallback((tileID: string, data: ProcessMapTileResponse, generation: number) => {
    if (generation !== canonicalGenerationRef.current || data.process_map_read_version !== sceneRef.current?.process_map_read_version) return;
    setLoadedTiles((current) => new Map(current).set(tileID, data));
    updateKnownMapped(data.placements.filter((placement): placement is ProcessMapVisiblePlacement => !placement.restricted));
    setLoading(false);
  }, [updateKnownMapped]);

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
    const retired = retireProcessMapMutationMasks({
      committedOverlay: committedOverlayRef.current,
      removedTraceIDs: removedTraceIDsRef.current,
    }, true);
    setCommittedOverlay(retired.committedOverlay);
    setRemovedTraceIDs(retired.removedTraceIDs);
  }, []);

  const refreshAfterMutation = useCallback((readVersion: number) => {
    setScene((current) => current && readVersion >= current.process_map_read_version ? { ...current, process_map_read_version: readVersion } : current);
    setLoadedTiles(new Map());
    markUnsettled();
    void loadScene(false);
  }, [loadScene, markUnsettled]);

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
    updateKnownMapped(envelope.placements);
    refreshAfterMutation(envelope.process_map_read_version);
  }, [refreshAfterMutation, updateKnownMapped]);

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
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(key) ?? 0)) return;
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
  }, [apiBase, applyEnvelope, companyID, nextOperation]);

  const saveTrace = useCallback(async (trace: ProcessMapTrace, routePoints: readonly ProcessMapGridPoint[]) => {
    const id = trace.resource_operational_relationship_id;
    const key = `trace:${id}`;
    const canonicalGeneration = canonicalGenerationRef.current;
    const operationGeneration = nextOperation(key);
    const preview = { ...cloneTrace(trace), route_points: normalizeProcessMapRoutePoints(routePoints) };
    setPreviewTraces((current) => new Map(current).set(id, preview));
    try {
      const envelope = await putProcessMapTrace(apiBase, companyID, id, preview.route_points);
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(key) ?? 0)) return;
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
  }, [apiBase, applyEnvelope, companyID, nextOperation]);

  const folders = useMemo(() => [...presentation.placements.values()].filter((placement) => placement.resource_type === "company_explorer_folder"), [presentation.placements]);
  const highlightedFolder = useMemo(() => {
    let bounds: ProcessMapBounds | null = null;
    let excludedFolderID: string | undefined;
    const activePlacement = gesture && (gesture.kind === "move" || gesture.kind === "resize") ? previewPlacements.get(gesture.key) : null;
    if (activePlacement) {
      bounds = processMapPlacementBounds(activePlacement);
      if (activePlacement.resource_type === "company_explorer_folder") excludedFolderID = activePlacement.resource_id;
    } else if (externalDropPoint) {
      const x = snapProcessMapGridCoordinate(externalDropPoint.x);
      const y = snapProcessMapGridCoordinate(externalDropPoint.y);
      bounds = { min_x: x, min_y: y, max_x: x + PROCESS_MAP_DEFAULT_WIDTH, max_y: y + PROCESS_MAP_DEFAULT_HEIGHT };
    }
    return bounds ? processMapDeepestContainingFolder(bounds, folders, excludedFolderID) : null;
  }, [externalDropPoint, folders, gesture, previewPlacements]);

  const selectedPlacement = selection?.kind === "placement" ? presentation.placements.get(selection.id) ?? null : null;
  const editedPlacementKeys = useMemo(() => new Set([
    ...committedOverlay.placements.keys(),
    ...previewPlacements.keys(),
    ...(selection?.kind === "placement" ? [selection.id] : []),
  ]), [committedOverlay.placements, previewPlacements, selection]);
  const editedTraceIDs = useMemo(() => new Set([
    ...committedOverlay.traces.keys(),
    ...previewTraces.keys(),
    ...removedTraceIDs,
    ...(selection?.kind === "trace" ? [selection.id] : []),
  ]), [committedOverlay.traces, previewTraces, removedTraceIDs, selection]);
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
    selectedPlacementKey: selection?.kind === "placement" ? selection.id : null,
    selectedTraceID: selection?.kind === "trace" ? selection.id : null,
    connectionPreview: gesture?.kind === "connection" ? { source: gesture.source, point: gesture.point } : null,
    highlightedFolderKey: highlightedFolder ? placementKey(highlightedFolder) : null,
    connectionSourceKey: gesture?.kind === "connection" ? placementKey(gesture.source) : null,
  }), [gesture, highlightedFolder, overlayPlacements, overlayTraces, selection]);

  const editedPlacementMembership = [...editedPlacementKeys].sort().join("\0");
  const editedTraceMembership = [...editedTraceIDs].sort().join("\0");
  const spatialEditedPlacementKeys = useMemo(
    () => new Set(editedPlacementMembership ? editedPlacementMembership.split("\0") : []),
    [editedPlacementMembership],
  );
  const spatialEditedTraceIDs = useMemo(
    () => new Set(editedTraceMembership ? editedTraceMembership.split("\0") : []),
    [editedTraceMembership],
  );
  const selectedPlacementKey = selection?.kind === "placement" ? selection.id : null;
  const selectedTraceID = selection?.kind === "trace" ? selection.id : null;

  const spatialLayers = useMemo(() => activeScene ? buildProcessMapSpatialLayers({
    scene: activeScene,
    protectedGeneration,
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
  }) : null, [activeScene, guardedGetTileData, handleTileLoad, handleTileUnload, handleViewportLoad, protectedGeneration, selectedPlacementKey, selectedTraceID, settledViewState.zoom, spatialEditedPlacementKeys, spatialEditedTraceIDs]);

  const layers = useMemo(() => activeScene && spatialLayers ? composeProcessMapLayers({
    scene: activeScene,
    protectedGeneration,
    settled,
    settledPixelsPerGridUnit: 2 ** settledViewState.zoom,
    presentation,
    editedPlacementKeys,
    editedTraceIDs,
    editOverlay,
    getTileData: guardedGetTileData,
    onTileLoad: handleTileLoad,
    onTileUnload: handleTileUnload,
    onViewportLoad: handleViewportLoad,
    onTileError: (cause) => setNotice(errorMessage(cause, "A map tile could not be loaded. Move or zoom to retry.")),
  }, spatialLayers) : [], [activeScene, editOverlay, editedPlacementKeys, editedTraceIDs, guardedGetTileData, handleTileLoad, handleTileUnload, handleViewportLoad, presentation, protectedGeneration, settled, settledViewState.zoom, spatialLayers]);

  const handleViewStateChange = useCallback(<ViewStateT extends OrthographicViewState,>(params: ViewStateChangeParameters<ViewStateT>): ViewStateT => {
    if (gestureRef.current?.kind === "connection") {
      gestureRef.current = null;
      setGesture(null);
      setSelection(null);
    }
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
    if (processMapPlacementDisplayLOD(pick.placement, 2 ** settledViewState.zoom) !== "editing") return;
    const basePlacements = pick.kind === "placement" ? descendantsForMove(pick.placement, presentationRef.current.placements) : new Map([[pick.key, clonePlacement(pick.placement)]]);
    const baseTraces = translatedTraces(presentationRef.current.traces, new Set(basePlacements.keys()), 0, 0);
    const next: PlacementGesture = {
      kind: pick.kind === "resize" ? "resize" : "move",
      key: pick.key,
      start: point,
      basePlacements,
      baseTraces,
      ...(pick.kind === "resize" ? { horizontal: pick.horizontal, vertical: pick.vertical } : {}),
      moved: false,
    };
    setSelection({ kind: "placement", id: pick.key });
    setGesture(next);
    setPreviewPlacements((current) => replaceProcessMapPreviewEntries(current, basePlacements.keys(), basePlacements));
    setPreviewTraces((current) => replaceProcessMapPreviewEntries(current, baseTraces.keys(), baseTraces));
  }, [settledViewState.zoom]);

  const handleDragStart = useCallback((info: PickingInfo, event: { stopPropagation: () => void }) => {
    const point = pointFromInfo(info);
    const pick = pickFromObject(info.object);
    if (!point || !pick) return;
    event.stopPropagation();
    suppressClickRef.current = true;
    if (pick.kind === "placement" || pick.kind === "resize") startPlacementGesture(pick, point);
    else if (pick.kind === "anchor" && pick.anchor === "output") setGesture({ kind: "connection", source: pick.placement, point, moved: false });
    else if (pick.kind === "waypoint") setGesture({ kind: "waypoint", trace: pick.trace, index: pick.index, startingRoute: pick.trace.route_points.map((routePoint) => ({ ...routePoint })), moved: false });
  }, [startPlacementGesture]);

  const handleDrag = useCallback((info: PickingInfo) => {
    const point = pointFromInfo(info);
    const current = gestureRef.current;
    if (!point || !current) return;
    if (current.kind === "connection") {
      setGesture({ ...current, point, moved: true });
      return;
    }
    if (current.kind === "waypoint") {
      const route = current.startingRoute.map((routePoint) => ({ ...routePoint }));
      route[current.index] = { x: snapProcessMapGridCoordinate(point.x), y: snapProcessMapGridCoordinate(point.y) };
      const id = current.trace.resource_operational_relationship_id;
      setPreviewTraces((previews) => replaceProcessMapPreviewEntries(previews, [id], new Map([[id, { ...cloneTrace(current.trace), route_points: route }]])));
      setGesture({ ...current, moved: true });
      return;
    }
    const dx = snapProcessMapGridCoordinate(point.x - current.start.x);
    const dy = snapProcessMapGridCoordinate(point.y - current.start.y);
    if (current.kind === "move") {
      const next = new Map<string, ProcessMapVisiblePlacement>();
      for (const [key, placement] of current.basePlacements) next.set(key, { ...placement, grid_x: placement.grid_x + dx, grid_y: placement.grid_y + dy });
      const nextTraces = translatedTraces(current.baseTraces, new Set(next.keys()), dx, dy);
      setPreviewPlacements((previews) => replaceProcessMapPreviewEntries(previews, current.basePlacements.keys(), next));
      setPreviewTraces((previews) => replaceProcessMapPreviewEntries(previews, current.baseTraces.keys(), nextTraces));
    } else {
      const base = current.basePlacements.get(current.key);
      if (!base) return;
      let minX = base.grid_x;
      let minY = base.grid_y;
      let maxX = base.grid_x + base.grid_width;
      let maxY = base.grid_y + base.grid_height;
      if (current.horizontal === "west") minX = Math.min(maxX - 1, minX + dx);
      else maxX = Math.max(minX + 1, maxX + dx);
      if (current.vertical === "north") minY = Math.min(maxY - 1, minY + dy);
      else maxY = Math.max(minY + 1, maxY + dy);
      const next = new Map([[current.key, { ...base, grid_x: minX, grid_y: minY, grid_width: maxX - minX, grid_height: maxY - minY }]]);
      setPreviewPlacements((previews) => replaceProcessMapPreviewEntries(previews, current.basePlacements.keys(), next));
    }
    setGesture({ ...current, moved: current.moved || dx !== 0 || dy !== 0 });
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
        if (key === sourceKey || processMapPlacementDisplayLOD(placement, settledPixelsPerGridUnit) !== "editing") continue;
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
    if (!target) return;
    const operationKey = `relationship:${sourceKey}:${targetKey}`;
    const canonicalGeneration = canonicalGenerationRef.current;
    const operationGeneration = nextOperation(operationKey);
    try {
      const envelope = await postProcessMapRelationship(apiBase, companyID, current.source, target, []);
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(operationKey) ?? 0)) return;
      applyEnvelope(envelope, new Map());
      if (envelope.relationship) setSelection({ kind: "trace", id: envelope.relationship.resource_operational_relationship_id });
      setNotice(envelope.created === false ? "Existing operational trace selected." : "Operational trace created.");
    } catch (cause) {
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(operationKey) ?? 0)) return;
      setNotice(errorMessage(cause, "Operational trace was not created."));
    }
  }, [apiBase, applyEnvelope, companyID, nextOperation, settledViewState.zoom]);

  const handleDragEnd = useCallback((info: PickingInfo) => {
    const current = gestureRef.current;
    setTimeout(() => { suppressClickRef.current = false; }, 0);
    if (!current) return;
    if (current.kind === "connection") {
      void finishConnection(current, info);
      return;
    }
    if (current.kind === "waypoint") {
      const trace = previewTraces.get(current.trace.resource_operational_relationship_id) ?? current.trace;
      setGesture(null);
      if (current.moved) void saveTrace(trace, trace.route_points);
      else setPreviewTraces((previews) => replaceProcessMapPreviewEntries(previews, [current.trace.resource_operational_relationship_id], new Map()));
      return;
    }
    const placement = previewPlacements.get(current.key);
    setGesture(null);
    if (!placement || !current.moved) {
      setPreviewPlacements((previews) => replaceProcessMapPreviewEntries(previews, current.basePlacements.keys(), new Map()));
      setPreviewTraces((previews) => replaceProcessMapPreviewEntries(previews, current.baseTraces.keys(), new Map()));
      return;
    }
    const parent = processMapDeepestContainingFolder(processMapPlacementBounds(placement), folders, placement.resource_type === "company_explorer_folder" ? placement.resource_id : undefined);
    const saved = { ...placement, map_parent_folder_id: parent?.resource_id ?? null };
    const pending = new Map<string, ProcessMapVisiblePlacement>();
    for (const key of current.basePlacements.keys()) {
      const preview = previewPlacements.get(key);
      if (preview) pending.set(key, preview);
    }
    pending.set(current.key, saved);
    if (current.kind === "resize" && saved.resource_type === "company_explorer_folder" && !folderContainsItsChildren(saved, presentationRef.current.placements)) {
      setPreviewPlacements((previews) => replaceProcessMapPreviewEntries(previews, current.basePlacements.keys(), new Map()));
      setPreviewTraces((previews) => replaceProcessMapPreviewEntries(previews, current.baseTraces.keys(), new Map()));
      setNotice("Folder resize was restored because every contained placement must remain inside its fence.");
      return;
    }
    setPreviewPlacements((previews) => replaceProcessMapPreviewEntries(previews, current.basePlacements.keys(), pending));
    void savePlacement(saved, pending, new Set(current.baseTraces.keys()));
  }, [finishConnection, folders, previewPlacements, previewTraces, savePlacement, saveTrace]);

  const fitFolder = useCallback((placement: ProcessMapVisiblePlacement) => {
    const next = fitProcessMapViewState(processMapPlacementBounds(placement), viewportSize, { padding: 80 });
    viewRef.current = next;
    setViewState(next);
    markUnsettled();
  }, [markUnsettled, viewportSize]);

  const openProcess = useCallback((placement: ProcessMapVisiblePlacement) => {
    if (
      placement.resource_type !== "logic_gate"
      || processMapPlacementDisplayLOD(placement, 2 ** settledViewState.zoom) !== "editing"
    ) return;
    clearHoverTimer();
    setHoveredProcessID(null);
    setPinnedProcessID(null);
    onOpenLogicGate(placement.resource_id, placement.name);
  }, [clearHoverTimer, onOpenLogicGate, settledViewState.zoom]);

  const handleClick = useCallback((info: PickingInfo) => {
    surfaceRef.current?.focus();
    if (suppressClickRef.current) return;
    const pick = pickFromObject(info.object);
    if (!pick) {
      setSelection(null);
      setPinnedProcessID(null);
      setHoveredProcessID(null);
      return;
    }
    const now = Date.now();
    const clickID = pick.kind === "placement" || pick.kind === "anchor" || pick.kind === "resize"
      ? `placement:${pick.key}`
      : `trace:${pick.id}${pick.kind === "waypoint" ? `:${pick.index}` : ""}`;
    const doubleClick = lastClickRef.current?.id === clickID && now - lastClickRef.current.at <= PROCESS_MAP_DOUBLE_CLICK_MS;
    lastClickRef.current = { id: clickID, at: now };
    if (pick.kind === "placement") {
      setSelection({ kind: "placement", id: pick.key });
      if (doubleClick) {
        if (pick.placement.resource_type === "company_explorer_folder") fitFolder(pick.placement);
        else if (processMapPlacementDisplayLOD(pick.placement, 2 ** settledViewState.zoom) === "editing") openProcess(pick.placement);
      } else if (pick.placement.resource_type === "logic_gate" && processMapPlacementDisplayLOD(pick.placement, 2 ** settledViewState.zoom) === "editing") {
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
    if (pick?.kind === "placement" && pick.placement.resource_type === "logic_gate" && processMapPlacementDisplayLOD(pick.placement, 2 ** settledViewState.zoom) === "editing") {
      showHoverCard(pick.placement.resource_id);
    } else if (hoveredProcessID) {
      scheduleHoverClose(hoveredProcessID);
    }
  }, [hoveredProcessID, scheduleHoverClose, settledViewState.zoom, showHoverCard]);

  const removeSelection = useCallback(async () => {
    if (!selection) return;
    gestureRef.current = null;
    setGesture(null);
    if (selection.kind === "trace") {
      const trace = presentationRef.current.traces.get(selection.id);
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
        if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(operationKey) ?? 0)) return;
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
    const placement = presentationRef.current.placements.get(selection.id);
    if (!placement) return;
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
      ? new Set(descendantsForMove(placement, presentationRef.current.placements).keys())
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
      placements.delete(key);
      return { placements, traces: new Map(current.traces), removedPlacementKeys: new Set(current.removedPlacementKeys).add(key) };
    });
    const incident = [...presentationRef.current.traces.values()].filter((trace) => placementKey(trace.source) === key || placementKey(trace.target) === key).map((trace) => trace.resource_operational_relationship_id);
    setRemovedTraceIDs((current) => new Set([...current, ...incident]));
    setSelection(null);
    if (placement.resource_type === "logic_gate") setPinnedProcessID((current) => current === placement.resource_id ? null : current);
    try {
      const envelope = await deleteProcessMapPlacement(apiBase, companyID, placement);
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(key) ?? 0)) return;
      updateKnownMapped([], [placement]);
      applyEnvelope(envelope, new Map(), affectedTraceIDs, expectedOperationGenerations);
      setNotice("Placement removed. Its source resource is unchanged.");
    } catch (cause) {
      if (!shouldApplyProcessMapMutationAck(canonicalGeneration, canonicalGenerationRef.current, operationGeneration, operationGenerationRef.current.get(key) ?? 0)) return;
      setCommittedOverlay((current) => {
        const removedPlacementKeys = new Set(current.removedPlacementKeys);
        removedPlacementKeys.delete(key);
        return { ...current, removedPlacementKeys };
      });
      setRemovedTraceIDs((current) => {
        const next = new Set(current);
        incident.forEach((id) => next.delete(id));
        return next;
      });
      invalidateProcessMapReadCaches(apiBase, companyID);
      setLoadedTiles(new Map());
      markUnsettled();
      void loadScene(false);
      setNotice(errorMessage(cause, "Placement removal was rolled back."));
    }
  }, [apiBase, applyEnvelope, companyID, loadScene, markUnsettled, nextOperation, refreshAfterMutation, selection, updateKnownMapped]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!selection) return;
      event.preventDefault();
      void removeSelection();
    } else if ((event.key === "Enter" || event.key === " ") && selectedPlacement?.resource_type === "logic_gate") {
      event.preventDefault();
      openProcess(selectedPlacement);
    } else if (event.key === "Escape") {
      const current = gestureRef.current;
      if (current?.kind === "waypoint") {
        setPreviewTraces((previews) => replaceProcessMapPreviewEntries(previews, [current.trace.resource_operational_relationship_id], new Map()));
      } else if (current && current.kind !== "connection") {
        setPreviewPlacements((previews) => replaceProcessMapPreviewEntries(previews, current.basePlacements.keys(), new Map()));
        setPreviewTraces((previews) => replaceProcessMapPreviewEntries(previews, current.baseTraces.keys(), new Map()));
      }
      gestureRef.current = null;
      setGesture(null);
      setSelection(null);
    }
  }, [openProcess, removeSelection, selectedPlacement, selection]);

  const worldPointFromClient = useCallback((clientX: number, clientY: number): ProcessMapGridPoint | null => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const viewport = deckRef.current?.deck?.getViewports()[0];
    if (!rect || !viewport) return null;
    const point = viewport.unproject([clientX - rect.left, clientY - rect.top]);
    return point.length >= 2 ? { x: point[0], y: point[1] } : null;
  }, []);

  const handleExternalDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const hit = typeof document === "undefined" ? null : document.elementFromPoint(event.clientX, event.clientY);
    if (loading || error || hit?.closest("[data-process-map-fixed-overlay='true']")) {
      setExternalDropPoint(null);
      return;
    }
    const decision = decideProcessMapExplorerDrop(readExplorerDragPayload(event.dataTransfer));
    const point = worldPointFromClient(event.clientX, event.clientY);
    setExternalDropPoint(null);
    if (decision.kind !== "place" || !point) return;
    const key = placementKey(decision.resource);
    if (knownMappedPlacementKeys.has(key) || presentationRef.current.placements.has(key)) {
      setNotice("That authorized resource is already placed on the Process Map.");
      return;
    }
    const now = new Date().toISOString();
    const pending: ProcessMapVisiblePlacement = {
      restricted: false,
      presentation: "editing",
      ...decision.resource,
      name: decision.label,
      map_parent_folder_id: null,
      grid_x: snapProcessMapGridCoordinate(point.x),
      grid_y: snapProcessMapGridCoordinate(point.y),
      grid_width: PROCESS_MAP_DEFAULT_WIDTH,
      grid_height: PROCESS_MAP_DEFAULT_HEIGHT,
      can_edit: true,
      revision: 0,
      created_timestamp: now,
      updated_timestamp: now,
    };
    pending.map_parent_folder_id = processMapDeepestContainingFolder(processMapPlacementBounds(pending), folders)?.resource_id ?? null;
    const pendingMap = new Map([[placementKey(pending), pending]]);
    setPreviewPlacements((current) => replaceProcessMapPreviewEntries(current, [placementKey(pending)], pendingMap));
    setSelection({ kind: "placement", id: placementKey(pending) });
    void savePlacement(pending, pendingMap);
  }, [error, folders, knownMappedPlacementKeys, loading, savePlacement, worldPointFromClient]);

  const guardFixedOverlayDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setExternalDropPoint(null);
  }, []);

  const unavailableTrayIDs = useMemo(() => new Set([...knownMappedPlacementKeys, ...presentation.placements.keys()]), [knownMappedPlacementKeys, presentation.placements]);
  const trayCandidates = useMemo(() => processMapTrayCandidates(trayRows, unavailableTrayIDs), [trayRows, unavailableTrayIDs]);
  const qdPlacement = useMemo(() => {
    const id = pinnedProcessID ?? (hoverModeEnabled ? hoveredProcessID : null);
    return id ? [...presentation.placements.values()].find((placement) => placement.resource_type === "logic_gate" && placement.resource_id === id) ?? null : null;
  }, [hoverModeEnabled, hoveredProcessID, pinnedProcessID, presentation.placements]);
  const qdVisible = qdPlacement && processMapPlacementDisplayLOD(qdPlacement, 2 ** settledViewState.zoom) === "editing";
  const qdPosition = useMemo(() => {
    if (!qdVisible || !qdPlacement) return null;
    const scale = 2 ** viewState.zoom;
    return {
      left: viewportSize.width / 2 + (qdPlacement.grid_x + qdPlacement.grid_width - viewState.target[0]) * scale + 22,
      top: viewportSize.height / 2 + (qdPlacement.grid_y - viewState.target[1]) * scale,
    };
  }, [qdPlacement, qdVisible, viewState, viewportSize]);
  const currentTrayFolder = trayPath[trayPath.length - 1] ?? null;
  const trayBackLabel = trayPath.length > 1 ? trayPath[trayPath.length - 2].label : "Root Folders";
  const cameraDragEnabled = gesture === null;
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
      aria-label={selectedPlacement ? `Process Map. Selected ${selectedPlacement.name}.` : "Process Map company canvas"}
      onKeyDown={handleKeyDown}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(EXPLORER_DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        const point = worldPointFromClient(event.clientX, event.clientY);
        if (point) setExternalDropPoint(point);
      }}
      onDragLeave={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setExternalDropPoint(null);
      }}
      onDrop={handleExternalDrop}
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
        getCursor={({ isDragging, isHovering }) => isDragging ? "grabbing" : isHovering ? "pointer" : "grab"}
      />

      <aside data-process-map-fixed-overlay="true" className={`process-map-placement-tray${trayCollapsed ? " is-collapsed" : ""}`} aria-label="Process Map placement tray" onDragOver={guardFixedOverlayDrop} onDrop={guardFixedOverlayDrop}>
        <button type="button" className="process-map-placement-tray__toggle" aria-expanded={!trayCollapsed} aria-controls={trayListID} title={trayCollapsed ? "Expand placement tray" : "Collapse placement tray"} onClick={() => {
          const next = !trayCollapsed;
          setTrayCollapsed(next);
          storeTrayCollapsed(next);
        }}>
          {!trayCollapsed && <>
            <span className="process-map-placement-tray__heading">{currentTrayFolder?.label ?? "Root Folders"}</span>
            <span className="process-map-placement-tray__hint">Drag to place</span>
          </>}
          <span className="process-map-placement-tray__disclosure" aria-hidden="true"><ExplorerDisclosureIcon open={false} color="#64748b" /></span>
        </button>
        {!trayCollapsed && <div id={trayListID} className="process-map-placement-tray__body company-explorer-scroll">
          {currentTrayFolder && <button type="button" className="process-map-placement-tray__back" onClick={() => setTrayPath((current) => current.slice(0, -1))}>← Back to {trayBackLabel}</button>}
          {trayLoading && <p className="process-map-placement-tray__status">Loading authorized choices…</p>}
          {trayError && <p className="process-map-placement-tray__status is-error" role="alert">{trayError}</p>}
          {!trayLoading && !trayError && trayCandidates.length === 0 && <p className="process-map-placement-tray__status">No unplaced choices in this branch.</p>}
          {!trayLoading && !trayError && trayCandidates.length > 0 && <div className="process-map-placement-tray__list" role="list">
            {trayCandidates.map((candidate) => {
              const row = trayRows.find((item) => item.entity_id === candidate.resource.resource_id || item.resource_id === candidate.resource.resource_id);
              const folder = candidate.resource.resource_type === "company_explorer_folder";
              return <div className="process-map-placement-tray__row" role="listitem" key={placementKey(candidate.resource)}>
                <button type="button" draggable className={`process-map-placement-tray__card is-${folder ? "folder" : "process"}`} aria-label={folder ? `Browse or drag Folder: ${candidate.label}` : `Drag Process: ${candidate.label}`} title={folder ? "Click to browse or drag onto the map" : "Drag onto the map to place"} onClick={() => {
                  if (!folder) return;
                  setTrayPath((current) => [...current, { id: row?.entity_id ?? candidate.resource.resource_id, label: candidate.label }]);
                }} onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(candidate.dragPayload));
                }}>
                  <span className="process-map-placement-tray__icon"><ExplorerRowIcon kind={folder ? "folder" : "logic_gate"} /></span>
                  <span className="process-map-placement-tray__card-copy">
                    <span className="process-map-placement-tray__card-kind">{folder ? "Folder" : "Process"}</span>
                    <span className="process-map-placement-tray__card-label">{candidate.label}</span>
                  </span>
                  {folder && <span className="process-map-placement-tray__card-disclosure" aria-hidden="true"><ExplorerDisclosureIcon open={false} color="#64748b" /></span>}
                </button>
              </div>;
            })}
          </div>}
        </div>}
      </aside>

      {selection && <div data-process-map-fixed-overlay="true" className="process-map-toolbar" onPointerDown={(event) => event.stopPropagation()} onDragOver={guardFixedOverlayDrop} onDrop={guardFixedOverlayDrop}>
        <span>{selection.kind === "placement" ? "Placement selected" : "Operational trace selected"}</span>
        <button type="button" onClick={() => void removeSelection()}>{selection.kind === "placement" ? "Remove from map" : "Delete relationship"}</button>
      </div>}

      {qdPosition && qdPlacement && <div data-process-map-fixed-overlay="true" className="process-map-qd-overlay" style={qdPosition} onDragOver={guardFixedOverlayDrop} onDrop={guardFixedOverlayDrop}>
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
      {loading && <div data-process-map-fixed-overlay="true" className="process-map-loading" role="status" onDragOver={guardFixedOverlayDrop} onDrop={guardFixedOverlayDrop}>Loading Process Map…</div>}
      {error && <div data-process-map-fixed-overlay="true" className="process-map-message is-error" role="alert" onDragOver={guardFixedOverlayDrop} onDrop={guardFixedOverlayDrop}><span>{error}</span><button type="button" onClick={() => void loadScene(true)}>Retry</button></div>}
      {!error && notice && <div data-process-map-fixed-overlay="true" className="process-map-message" role="status" onDragOver={guardFixedOverlayDrop} onDrop={guardFixedOverlayDrop}>{notice}</div>}
    </div>
  );
}
