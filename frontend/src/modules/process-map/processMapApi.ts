import { getAuthSessionCacheGeneration } from "../../auth/cognitoAuth.js";
import { requestJSON, requestJSONWithMeta } from "../api/requestJSON.js";
import { getCurrentRealtimeConnectionCorrelation } from "../realtime/realtimeWebSocket.js";
import {
  PROCESS_MAP_MAX_ROUTE_POINTS,
  PROCESS_MAP_TILE_CACHE_BYTES,
  normalizeProcessMapRoutePoints,
  type ProcessMapBounds,
  type ProcessMapGridPoint,
  type ProcessMapPlacementLOD,
  type ProcessMapResourceType,
} from "./processMapGeometry.js";

export type ProcessMapResourceRef = {
  resource_type: ProcessMapResourceType;
  resource_id: string;
};

export type ProcessMapPresentation = ProcessMapPlacementLOD;

export type ProcessMapVisiblePlacement = {
  restricted: false;
  presentation: ProcessMapPresentation;
  resource_type: ProcessMapResourceType;
  resource_id: string;
  name: string;
  map_parent_folder_id: string | null;
  grid_x: number;
  grid_y: number;
  grid_width: number;
  grid_height: number;
  can_edit: true;
  revision: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProcessMapRestrictedPlacement = {
  restricted: true;
  grid_x: number;
  grid_y: number;
};

export type ProcessMapPlacement = ProcessMapVisiblePlacement | ProcessMapRestrictedPlacement;

export type ProcessMapCommittedPlacement = {
  company_id: string;
  resource_type: ProcessMapResourceType;
  resource_id: string;
  map_parent_folder_id: string | null;
  grid_x: number;
  grid_y: number;
  grid_width: number;
  grid_height: number;
  revision: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProcessMapTrace = {
  presentation: ProcessMapPresentation;
  resource_operational_relationship_id: string;
  source: ProcessMapResourceRef;
  target: ProcessMapResourceRef;
  route_points: ProcessMapGridPoint[];
  path_fragments: ProcessMapGridPoint[][];
  revision: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProcessMapCommittedTrace = {
  resource_operational_relationship_id: string;
  route_points: ProcessMapGridPoint[];
  revision: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProcessMapOperationalRelationship = {
  resource_operational_relationship_id: string;
  source: ProcessMapResourceRef;
  target: ProcessMapResourceRef;
  created_timestamp: string;
};

export type ProcessMapSceneResponse = {
  bounds: ProcessMapBounds | null;
  process_map_read_version: number;
  tile_size: number;
  min_tile_zoom: number;
  max_tile_zoom: number;
};

export type ProcessMapTileResponse = {
  z: number;
  x: number;
  y: number;
  process_map_read_version: number;
  placements: ProcessMapPlacement[];
  traces: ProcessMapTrace[];
  byteLength: number;
};

export type ProcessMapMutationEnvelope = {
  placements: ProcessMapCommittedPlacement[];
  traces: ProcessMapCommittedTrace[];
  deleted_trace_ids: string[];
  process_map_read_version: number;
  relationship?: ProcessMapOperationalRelationship;
  created?: boolean;
  changed?: boolean;
};

type CacheEntry<T> = { response: T; etag?: string };

type InflightEntry<T> = {
  key: string;
  controller: AbortController;
  promise: Promise<T>;
  callers: Set<symbol>;
  settled: boolean;
  cacheable: boolean;
  abortTimer?: ReturnType<typeof setTimeout>;
};

const PROCESS_MAP_REALTIME_CONNECTION_HEADER = "X-Mango-Realtime-Connection-ID";
const sceneCache = new Map<string, CacheEntry<ProcessMapSceneResponse>>();
const tileCache = new Map<string, CacheEntry<ProcessMapTileResponse>>();
const sceneInflight = new Map<string, InflightEntry<ProcessMapSceneResponse>>();
const tileInflight = new Map<string, InflightEntry<ProcessMapTileResponse>>();
let tileCacheBytes = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function requiredInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(code);
  return value;
}

function requiredFiniteNumber(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(code);
  return value;
}

function resourceType(value: unknown): ProcessMapResourceType {
  if (value !== "company_explorer_folder" && value !== "logic_gate") throw new Error("invalid_process_map_resource_type");
  return value;
}

function resourceRef(value: unknown): ProcessMapResourceRef {
  if (!isRecord(value)) throw new Error("invalid_process_map_resource_ref");
  return {
    resource_type: resourceType(value.resource_type),
    resource_id: requiredString(value.resource_id, "invalid_process_map_resource_id"),
  };
}

function mapParent(value: unknown): string | null {
  return value === null ? null : requiredString(value, "invalid_process_map_parent_folder_id");
}

function presentation(value: unknown): ProcessMapPresentation {
  if (value !== "whole" && value !== "normal" && value !== "editing") throw new Error("invalid_process_map_presentation");
  return value;
}

function normalizePlacement(value: unknown): ProcessMapPlacement {
  if (!isRecord(value)) throw new Error("invalid_process_map_placement");
  const gridX = requiredInteger(value.grid_x, "invalid_process_map_grid_x");
  const gridY = requiredInteger(value.grid_y, "invalid_process_map_grid_y");
  if (value.restricted === true) return { restricted: true, grid_x: gridX, grid_y: gridY };
  if (value.restricted !== false) throw new Error("invalid_process_map_restricted_flag");
  const maxPresentation = presentation(value.presentation);
  const gridWidth = requiredInteger(value.grid_width, "invalid_process_map_grid_width");
  const gridHeight = requiredInteger(value.grid_height, "invalid_process_map_grid_height");
  if (gridWidth <= 0 || gridHeight <= 0) throw new Error("invalid_process_map_dimensions");
  if (value.can_edit !== true) throw new Error("invalid_process_map_edit_capability");
  return {
    restricted: false,
    presentation: maxPresentation,
    resource_type: resourceType(value.resource_type),
    resource_id: requiredString(value.resource_id, "invalid_process_map_resource_id"),
    name: maxPresentation === "whole" && value.name === undefined
      ? ""
      : requiredString(value.name, "invalid_process_map_name"),
    map_parent_folder_id: mapParent(value.map_parent_folder_id),
    grid_x: gridX,
    grid_y: gridY,
    grid_width: gridWidth,
    grid_height: gridHeight,
    can_edit: true,
    revision: requiredInteger(value.revision, "invalid_process_map_revision"),
    created_timestamp: requiredString(value.created_timestamp, "invalid_process_map_created_timestamp"),
    updated_timestamp: requiredString(value.updated_timestamp, "invalid_process_map_updated_timestamp"),
  };
}

function normalizeCommittedPlacement(value: unknown): ProcessMapCommittedPlacement {
  if (!isRecord(value)) throw new Error("invalid_process_map_committed_placement");
  const gridWidth = requiredInteger(value.grid_width, "invalid_process_map_grid_width");
  const gridHeight = requiredInteger(value.grid_height, "invalid_process_map_grid_height");
  if (gridWidth <= 0 || gridHeight <= 0) throw new Error("invalid_process_map_dimensions");
  return {
    company_id: requiredString(value.company_id, "invalid_process_map_company_id"),
    resource_type: resourceType(value.resource_type),
    resource_id: requiredString(value.resource_id, "invalid_process_map_resource_id"),
    map_parent_folder_id: mapParent(value.map_parent_folder_id),
    grid_x: requiredInteger(value.grid_x, "invalid_process_map_grid_x"),
    grid_y: requiredInteger(value.grid_y, "invalid_process_map_grid_y"),
    grid_width: gridWidth,
    grid_height: gridHeight,
    revision: requiredInteger(value.revision, "invalid_process_map_revision"),
    created_timestamp: requiredString(value.created_timestamp, "invalid_process_map_created_timestamp"),
    updated_timestamp: requiredString(value.updated_timestamp, "invalid_process_map_updated_timestamp"),
  };
}

function normalizePoint(value: unknown, integers: boolean): ProcessMapGridPoint {
  if (!isRecord(value) || Object.keys(value).length !== 2) throw new Error("invalid_process_map_path_point");
  return {
    x: integers ? requiredInteger(value.x, "invalid_process_map_route_x") : requiredFiniteNumber(value.x, "invalid_process_map_path_x"),
    y: integers ? requiredInteger(value.y, "invalid_process_map_route_y") : requiredFiniteNumber(value.y, "invalid_process_map_path_y"),
  };
}

function normalizeTrace(value: unknown): ProcessMapTrace {
  if (!isRecord(value)) throw new Error("invalid_process_map_trace");
  const maxPresentation = presentation(value.presentation);
  if (value.route_points !== undefined && !Array.isArray(value.route_points)) throw new Error("invalid_process_map_trace");
  if (maxPresentation === "editing" && !Array.isArray(value.route_points)) throw new Error("invalid_process_map_trace");
  const routePoints = Array.isArray(value.route_points) ? value.route_points.map((point) => normalizePoint(point, true)) : [];
  if (routePoints.length > PROCESS_MAP_MAX_ROUTE_POINTS) throw new Error("process_map_route_too_large");
  if (!Array.isArray(value.path_fragments)) throw new Error("invalid_process_map_path_fragments");
  const rawFragments = value.path_fragments;
  const pathFragments = rawFragments.map((fragment) => {
    if (!Array.isArray(fragment)) throw new Error("invalid_process_map_path_fragment");
    return fragment.map((point) => normalizePoint(point, false));
  }).filter((fragment) => fragment.length >= 2);
  return {
    presentation: maxPresentation,
    resource_operational_relationship_id: requiredString(value.resource_operational_relationship_id, "invalid_process_map_relationship_id"),
    source: resourceRef(value.source),
    target: resourceRef(value.target),
    route_points: routePoints,
    path_fragments: pathFragments,
    revision: requiredInteger(value.revision, "invalid_process_map_trace_revision"),
    created_timestamp: requiredString(value.created_timestamp, "invalid_process_map_created_timestamp"),
    updated_timestamp: requiredString(value.updated_timestamp, "invalid_process_map_updated_timestamp"),
  };
}

function normalizeCommittedTrace(value: unknown): ProcessMapCommittedTrace {
  if (!isRecord(value) || !Array.isArray(value.route_points)) throw new Error("invalid_process_map_committed_trace");
  const routePoints = value.route_points.map((point) => normalizePoint(point, true));
  if (routePoints.length > PROCESS_MAP_MAX_ROUTE_POINTS) throw new Error("process_map_route_too_large");
  return {
    resource_operational_relationship_id: requiredString(value.resource_operational_relationship_id, "invalid_process_map_relationship_id"),
    route_points: routePoints,
    revision: requiredInteger(value.revision, "invalid_process_map_trace_revision"),
    created_timestamp: requiredString(value.created_timestamp, "invalid_process_map_created_timestamp"),
    updated_timestamp: requiredString(value.updated_timestamp, "invalid_process_map_updated_timestamp"),
  };
}

function normalizeBounds(value: unknown): ProcessMapBounds | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("invalid_process_map_bounds");
  const bounds = {
    min_x: requiredFiniteNumber(value.min_x, "invalid_process_map_min_x"),
    min_y: requiredFiniteNumber(value.min_y, "invalid_process_map_min_y"),
    max_x: requiredFiniteNumber(value.max_x, "invalid_process_map_max_x"),
    max_y: requiredFiniteNumber(value.max_y, "invalid_process_map_max_y"),
  };
  if (bounds.max_x < bounds.min_x || bounds.max_y < bounds.min_y) throw new Error("invalid_process_map_bounds");
  return bounds;
}

function normalizeScene(value: unknown): ProcessMapSceneResponse {
  if (!isRecord(value)) throw new Error("invalid_process_map_scene");
  const minTileZoom = requiredInteger(value.min_tile_zoom, "invalid_process_map_min_tile_zoom");
  const maxTileZoom = requiredInteger(value.max_tile_zoom, "invalid_process_map_max_tile_zoom");
  if (minTileZoom > maxTileZoom) throw new Error("invalid_process_map_tile_zoom_range");
  const tileSize = requiredInteger(value.tile_size, "invalid_process_map_tile_size");
  if (tileSize <= 0) throw new Error("invalid_process_map_tile_size");
  return {
    bounds: normalizeBounds(value.bounds),
    process_map_read_version: requiredInteger(value.process_map_read_version, "invalid_process_map_read_version"),
    tile_size: tileSize,
    min_tile_zoom: minTileZoom,
    max_tile_zoom: maxTileZoom,
  };
}

function encodedByteLength(value: unknown): number {
  const text = JSON.stringify(value);
  return typeof TextEncoder === "undefined" ? text.length * 2 : new TextEncoder().encode(text).byteLength;
}

function normalizeTile(value: unknown): ProcessMapTileResponse {
  if (!isRecord(value) || !Array.isArray(value.placements) || !Array.isArray(value.traces)) throw new Error("invalid_process_map_tile");
  const placements = value.placements.map(normalizePlacement);
  // A clipped trace may cross this tile while both endpoints are in other
  // tiles. The server already owns endpoint permission filtering.
  const traces = value.traces.map(normalizeTrace);
  const normalized = {
    z: requiredInteger(value.z, "invalid_process_map_tile_z"),
    x: requiredInteger(value.x, "invalid_process_map_tile_x"),
    y: requiredInteger(value.y, "invalid_process_map_tile_y"),
    process_map_read_version: requiredInteger(value.process_map_read_version, "invalid_process_map_read_version"),
    placements,
    traces,
  };
  return { ...normalized, byteLength: encodedByteLength(normalized) };
}

function normalizeMutationEnvelope(value: unknown): ProcessMapMutationEnvelope {
  if (
    !isRecord(value)
    || !Array.isArray(value.placements)
    || !Array.isArray(value.traces)
    || !Array.isArray(value.deleted_trace_ids)
    || (value.created !== undefined && typeof value.created !== "boolean")
    || (value.changed !== undefined && typeof value.changed !== "boolean")
  ) {
    throw new Error("invalid_process_map_mutation_envelope");
  }
  return {
    placements: value.placements.map(normalizeCommittedPlacement),
    traces: value.traces.map(normalizeCommittedTrace),
    deleted_trace_ids: value.deleted_trace_ids.map((id) => requiredString(id, "invalid_process_map_deleted_trace_id")),
    process_map_read_version: requiredInteger(value.process_map_read_version, "invalid_process_map_read_version"),
    ...(value.relationship === undefined ? {} : { relationship: normalizeOperationalRelationship(value.relationship) }),
    ...(typeof value.created === "boolean" ? { created: value.created } : {}),
    ...(typeof value.changed === "boolean" ? { changed: value.changed } : {}),
  };
}

function normalizeOperationalRelationship(value: unknown): ProcessMapOperationalRelationship {
  if (!isRecord(value)) throw new Error("invalid_process_map_relationship");
  return {
    resource_operational_relationship_id: requiredString(value.resource_operational_relationship_id, "invalid_process_map_relationship_id"),
    source: resourceRef(value.source),
    target: resourceRef(value.target),
    created_timestamp: requiredString(value.created_timestamp, "invalid_process_map_created_timestamp"),
  };
}

function clonePlacement(placement: ProcessMapPlacement): ProcessMapPlacement {
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

function cloneScene(scene: ProcessMapSceneResponse): ProcessMapSceneResponse {
  return { ...scene, bounds: scene.bounds ? { ...scene.bounds } : null };
}

function cloneTile(tile: ProcessMapTileResponse): ProcessMapTileResponse {
  return { ...tile, placements: tile.placements.map(clonePlacement), traces: tile.traces.map(cloneTrace) };
}

function cloneEnvelope(envelope: ProcessMapMutationEnvelope): ProcessMapMutationEnvelope {
  return {
    ...envelope,
    placements: envelope.placements.map((placement) => ({ ...placement })),
    traces: envelope.traces.map((trace) => ({
      ...trace,
      route_points: trace.route_points.map((point) => ({ ...point })),
    })),
    deleted_trace_ids: [...envelope.deleted_trace_ids],
    ...(envelope.relationship ? {
      relationship: {
        ...envelope.relationship,
        source: { ...envelope.relationship.source },
        target: { ...envelope.relationship.target },
      },
    } : {}),
  };
}

function cachePrefix(apiBase: string, companyID: string): string {
  return `${getAuthSessionCacheGeneration()}\u0000${apiBase}\u0000${companyID.trim()}\u0000`;
}

function sceneKey(apiBase: string, companyID: string): string {
  return `${cachePrefix(apiBase, companyID)}scene`;
}

function tileKey(apiBase: string, companyID: string, readVersion: number, z: number, x: number, y: number): string {
  return `${cachePrefix(apiBase, companyID)}${readVersion}\u0000${z}\u0000${x}\u0000${y}`;
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("The request was aborted.", "AbortError");
}

export function combineProcessMapAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener("abort", () => abort(signal), { once: true });
  }
  return controller.signal;
}

function subscribeInflight<T>(entry: InflightEntry<T>, signal: AbortSignal | undefined, clone: (response: T) => T): Promise<T> {
  const caller = Symbol("process-map-read-caller");
  if (entry.abortTimer !== undefined) {
    clearTimeout(entry.abortTimer);
    entry.abortTimer = undefined;
  }
  entry.callers.add(caller);
  return new Promise((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      entry.callers.delete(caller);
      if (!entry.settled && entry.callers.size === 0 && entry.abortTimer === undefined) {
        entry.abortTimer = setTimeout(() => {
          entry.abortTimer = undefined;
          if (!entry.settled && entry.callers.size === 0) entry.controller.abort();
        }, 0);
      }
    };
    const settle = (callback: () => void) => {
      if (finished) return;
      release();
      callback();
    };
    const onAbort = () => settle(() => reject(abortReason(signal)));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (response) => settle(() => resolve(clone(response))),
      (cause) => settle(() => reject(cause)),
    );
  });
}

function storeTileCache(key: string, entry: CacheEntry<ProcessMapTileResponse>): void {
  const previous = tileCache.get(key);
  if (previous) tileCacheBytes -= previous.response.byteLength;
  tileCache.delete(key);
  tileCache.set(key, entry);
  tileCacheBytes += entry.response.byteLength;
  while (tileCacheBytes > PROCESS_MAP_TILE_CACHE_BYTES && tileCache.size > 0) {
    const oldestKey = tileCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = tileCache.get(oldestKey);
    tileCache.delete(oldestKey);
    if (oldest) tileCacheBytes -= oldest.response.byteLength;
  }
}

function touchTileCache(key: string, entry: CacheEntry<ProcessMapTileResponse>): void {
  tileCache.delete(key);
  tileCache.set(key, entry);
}

export function fetchProcessMapScene(
  apiBase: string,
  companyID: string,
  signal?: AbortSignal,
): Promise<ProcessMapSceneResponse> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  const key = sceneKey(apiBase, companyID);
  const existing = sceneInflight.get(key);
  if (existing) return subscribeInflight(existing, signal, cloneScene);
  const cached = sceneCache.get(key);
  const controller = new AbortController();
  const headers = new Headers();
  if (cached?.etag) headers.set("If-None-Match", cached.etag);
  let entry: InflightEntry<ProcessMapSceneResponse>;
  const params = new URLSearchParams({ company_id: companyID.trim() });
  const promise = requestJSONWithMeta<unknown>(apiBase, `/v1/process-map/scene?${params}`, {
    headers,
    signal: controller.signal,
  }).then((response) => {
    if (response.notModified) {
      if (!cached) throw new Error("process_map_etag_without_cached_scene");
      return cached.response;
    }
    const normalized = normalizeScene(response.body);
    if (entry.cacheable) sceneCache.set(key, { response: normalized, etag: response.etag });
    return normalized;
  }).finally(() => {
    entry.settled = true;
    if (entry.abortTimer !== undefined) clearTimeout(entry.abortTimer);
    if (sceneInflight.get(key) === entry) sceneInflight.delete(key);
  });
  entry = { key, controller, promise, callers: new Set(), settled: false, cacheable: true };
  sceneInflight.set(key, entry);
  return subscribeInflight(entry, signal, cloneScene);
}

export function fetchProcessMapTile(
  apiBase: string,
  companyID: string,
  readVersion: number,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ProcessMapTileResponse> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  const key = tileKey(apiBase, companyID, readVersion, z, x, y);
  const cached = tileCache.get(key);
  if (cached) {
    touchTileCache(key, cached);
    return Promise.resolve(cloneTile(cached.response));
  }
  const existing = tileInflight.get(key);
  if (existing) return subscribeInflight(existing, signal, cloneTile);
  const controller = new AbortController();
  let entry: InflightEntry<ProcessMapTileResponse>;
  const params = new URLSearchParams({ company_id: companyID.trim() });
  const promise = requestJSONWithMeta<unknown>(
    apiBase,
    `/v1/process-map/tiles/${encodeURIComponent(String(z))}/${encodeURIComponent(String(x))}/${encodeURIComponent(String(y))}?${params}`,
    { signal: controller.signal },
  ).then((response) => {
    if (response.notModified) throw new Error("process_map_tile_unexpected_304");
    const normalized = normalizeTile(response.body);
    if (normalized.process_map_read_version !== readVersion || normalized.z !== z || normalized.x !== x || normalized.y !== y) {
      throw new Error("stale_process_map_tile");
    }
    if (entry.cacheable) storeTileCache(key, { response: normalized, etag: response.etag });
    return normalized;
  }).finally(() => {
    entry.settled = true;
    if (entry.abortTimer !== undefined) clearTimeout(entry.abortTimer);
    if (tileInflight.get(key) === entry) tileInflight.delete(key);
  });
  entry = { key, controller, promise, callers: new Set(), settled: false, cacheable: true };
  tileInflight.set(key, entry);
  return subscribeInflight(entry, signal, cloneTile);
}

export function invalidateProcessMapReadCaches(apiBase: string, companyID: string): void {
  const belongsToCompany = (key: string) => {
    const parts = key.split("\u0000");
    return parts[1] === apiBase && parts[2] === companyID.trim();
  };
  // Scan every auth generation so an actor/session generation change cannot
  // leave the previous viewer's protected geometry resident.
  for (const key of sceneCache.keys()) if (belongsToCompany(key)) sceneCache.delete(key);
  for (const [key, cached] of tileCache) {
    if (!belongsToCompany(key)) continue;
    tileCache.delete(key);
    tileCacheBytes -= cached.response.byteLength;
  }
  for (const [key, entry] of sceneInflight) {
    if (!belongsToCompany(key)) continue;
    entry.cacheable = false;
    sceneInflight.delete(key);
    entry.controller.abort();
  }
  for (const [key, entry] of tileInflight) {
    if (!belongsToCompany(key)) continue;
    entry.cacheable = false;
    tileInflight.delete(key);
    entry.controller.abort();
  }
  tileCacheBytes = Math.max(0, tileCacheBytes);
}

export function getProcessMapReadCacheStats(): {
  scene_entries: number;
  tile_entries: number;
  tile_bytes: number;
  inflight_reads: number;
} {
  return {
    scene_entries: sceneCache.size,
    tile_entries: tileCache.size,
    tile_bytes: tileCacheBytes,
    inflight_reads: sceneInflight.size + tileInflight.size,
  };
}

function processMapMutationHeaders(apiBase: string, companyID: string): HeadersInit | undefined {
  const connectionCorrelation = getCurrentRealtimeConnectionCorrelation(apiBase, companyID);
  return connectionCorrelation ? { [PROCESS_MAP_REALTIME_CONNECTION_HEADER]: connectionCorrelation } : undefined;
}

async function committedMutation(
  apiBase: string,
  companyID: string,
  path: string,
  init: RequestInit & { json?: unknown },
): Promise<ProcessMapMutationEnvelope> {
  const payload = await requestJSON<unknown>(apiBase, path, {
    ...init,
    headers: processMapMutationHeaders(apiBase, companyID),
  });
  const envelope = normalizeMutationEnvelope(payload);
  invalidateProcessMapReadCaches(apiBase, companyID);
  return cloneEnvelope(envelope);
}

export function putProcessMapPlacement(
  apiBase: string,
  companyID: string,
  resource: ProcessMapResourceRef,
  placement: {
    map_parent_folder_id: string | null;
    grid_x: number;
    grid_y: number;
    grid_width: number;
    grid_height: number;
  },
): Promise<ProcessMapMutationEnvelope> {
  const params = new URLSearchParams({ company_id: companyID.trim() });
  return committedMutation(
    apiBase,
    companyID,
    `/v1/process-map/placements/${encodeURIComponent(resource.resource_type)}/${encodeURIComponent(resource.resource_id)}?${params}`,
    {
      method: "PUT",
      json: {
        map_parent_folder_id: placement.map_parent_folder_id?.trim() || null,
        grid_x: Math.round(placement.grid_x),
        grid_y: Math.round(placement.grid_y),
        grid_width: Math.max(1, Math.round(placement.grid_width)),
        grid_height: Math.max(1, Math.round(placement.grid_height)),
      },
    },
  );
}

export function deleteProcessMapPlacement(
  apiBase: string,
  companyID: string,
  resource: ProcessMapResourceRef,
): Promise<ProcessMapMutationEnvelope> {
  const params = new URLSearchParams({ company_id: companyID.trim() });
  return committedMutation(
    apiBase,
    companyID,
    `/v1/process-map/placements/${encodeURIComponent(resource.resource_type)}/${encodeURIComponent(resource.resource_id)}?${params}`,
    { method: "DELETE" },
  );
}

export function postProcessMapRelationship(
  apiBase: string,
  companyID: string,
  source: ProcessMapResourceRef,
  target: ProcessMapResourceRef,
  routePoints?: readonly ProcessMapGridPoint[],
): Promise<ProcessMapMutationEnvelope> {
  return committedMutation(apiBase, companyID, "/v1/process-map/operational-relationships", {
    method: "POST",
    json: {
      company_id: companyID.trim(),
      source,
      target,
      ...(routePoints ? { trace: { route_points: normalizeProcessMapRoutePoints(routePoints) } } : {}),
    },
  });
}

export function putProcessMapTrace(
  apiBase: string,
  companyID: string,
  relationshipID: string,
  routePoints: readonly ProcessMapGridPoint[],
): Promise<ProcessMapMutationEnvelope> {
  const params = new URLSearchParams({ company_id: companyID.trim() });
  return committedMutation(
    apiBase,
    companyID,
    `/v1/process-map/operational-relationships/${encodeURIComponent(relationshipID.trim())}/trace?${params}`,
    { method: "PUT", json: { route_points: normalizeProcessMapRoutePoints(routePoints).slice(0, PROCESS_MAP_MAX_ROUTE_POINTS) } },
  );
}

export function deleteProcessMapRelationship(
  apiBase: string,
  companyID: string,
  relationshipID: string,
): Promise<ProcessMapMutationEnvelope> {
  const params = new URLSearchParams({ company_id: companyID.trim() });
  return committedMutation(
    apiBase,
    companyID,
    `/v1/process-map/operational-relationships/${encodeURIComponent(relationshipID.trim())}?${params}`,
    { method: "DELETE" },
  );
}
