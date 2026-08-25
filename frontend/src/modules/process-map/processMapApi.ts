import { getAuthSessionCacheGeneration } from "../../auth/cognitoAuth.js";
import { requestJSON, requestJSONWithMeta } from "../api/requestJSON.js";
import {
  normalizeProcessMapRoutePoints,
  type ProcessMapGridPoint,
  type ProcessMapResourceType,
} from "./processMapGeometry.js";

export type ProcessMapResourceRef = {
  resource_type: ProcessMapResourceType;
  resource_id: string;
};

export type ProcessMapVisiblePlacement = {
  restricted: false;
  resource_type: ProcessMapResourceType;
  resource_id: string;
  name: string;
  grid_x: number;
  grid_y: number;
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

export type ProcessMapPlacementWriteResponse = {
  resource_type: ProcessMapResourceType;
  resource_id: string;
  map_parent_folder_id: string | null;
  grid_x: number;
  grid_y: number;
  revision: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProcessMapTrace = {
  resource_operational_relationship_id: string;
  source: ProcessMapResourceRef;
  target: ProcessMapResourceRef;
  route_points: ProcessMapGridPoint[];
  revision: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProcessMapTraceWriteResponse = Omit<ProcessMapTrace, "source" | "target">;

export type ProcessMapLayer =
  | { kind: "root" }
  | { kind: "folder"; folder_id: string; name: string };

export type ProcessMapLayerResponse = {
  layer: ProcessMapLayer;
  placements: ProcessMapPlacement[];
  traces: ProcessMapTrace[];
};

export type ProcessMapOperationalRelationship = {
  resource_operational_relationship_id: string;
  source: ProcessMapResourceRef;
  target: ProcessMapResourceRef;
  created_timestamp: string;
};

export type ProcessMapRelationshipDirection = "incoming" | "outgoing" | "both";

export type ProcessMapRelationshipWriteResponse = {
  relationship: ProcessMapOperationalRelationship;
  trace?: ProcessMapTraceWriteResponse;
  relationship_created: boolean;
  trace_changed: boolean;
};

type LayerCacheEntry = {
  response: ProcessMapLayerResponse;
  etag?: string;
};

type LayerInflightEntry = {
  key: string;
  controller: AbortController;
  promise: Promise<ProcessMapLayerResponse>;
  callers: Set<symbol>;
  settled: boolean;
  abortTimer?: ReturnType<typeof setTimeout>;
};

const layerCache = new Map<string, LayerCacheEntry>();
const layerInflight = new Map<string, LayerInflightEntry>();

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

function resourceType(value: unknown): ProcessMapResourceType {
  if (value !== "company_explorer_folder" && value !== "logic_gate") {
    throw new Error("invalid_process_map_resource_type");
  }
  return value;
}

function resourceRef(value: unknown): ProcessMapResourceRef {
  if (!isRecord(value)) throw new Error("invalid_process_map_resource_ref");
  return {
    resource_type: resourceType(value.resource_type),
    resource_id: requiredString(value.resource_id, "invalid_process_map_resource_id"),
  };
}

function normalizePlacement(value: unknown): ProcessMapPlacement {
  if (!isRecord(value)) throw new Error("invalid_process_map_placement");
  const gridX = requiredInteger(value.grid_x, "invalid_process_map_grid_x");
  const gridY = requiredInteger(value.grid_y, "invalid_process_map_grid_y");
  if (value.restricted === true) {
    return { restricted: true, grid_x: gridX, grid_y: gridY };
  }
  if (value.restricted !== false) throw new Error("invalid_process_map_restricted_flag");
  return {
    restricted: false,
    resource_type: resourceType(value.resource_type),
    resource_id: requiredString(value.resource_id, "invalid_process_map_resource_id"),
    name: requiredString(value.name, "invalid_process_map_name"),
    grid_x: gridX,
    grid_y: gridY,
    revision: requiredInteger(value.revision, "invalid_process_map_revision"),
    created_timestamp: requiredString(value.created_timestamp, "invalid_process_map_created_timestamp"),
    updated_timestamp: requiredString(value.updated_timestamp, "invalid_process_map_updated_timestamp"),
  };
}

function normalizePlacementWriteResponse(value: unknown): ProcessMapPlacementWriteResponse {
  if (!isRecord(value)) throw new Error("invalid_process_map_placement_response");
  const mapParentFolderID = value.map_parent_folder_id === null
    ? null
    : requiredString(value.map_parent_folder_id, "invalid_process_map_parent_folder_id");
  return {
    resource_type: resourceType(value.resource_type),
    resource_id: requiredString(value.resource_id, "invalid_process_map_resource_id"),
    map_parent_folder_id: mapParentFolderID,
    grid_x: requiredInteger(value.grid_x, "invalid_process_map_grid_x"),
    grid_y: requiredInteger(value.grid_y, "invalid_process_map_grid_y"),
    revision: requiredInteger(value.revision, "invalid_process_map_revision"),
    created_timestamp: requiredString(value.created_timestamp, "invalid_process_map_created_timestamp"),
    updated_timestamp: requiredString(value.updated_timestamp, "invalid_process_map_updated_timestamp"),
  };
}

function normalizeTrace(value: unknown): ProcessMapTrace {
  const trace = normalizeTraceWriteResponse(value);
  if (!isRecord(value)) throw new Error("invalid_process_map_trace");
  return {
    ...trace,
    source: resourceRef(value.source),
    target: resourceRef(value.target),
  };
}

function normalizeTraceWriteResponse(value: unknown): ProcessMapTraceWriteResponse {
  if (!isRecord(value) || !Array.isArray(value.route_points)) throw new Error("invalid_process_map_trace");
  const routePoints = value.route_points.map((point) => {
    if (!isRecord(point) || Object.keys(point).length !== 2) throw new Error("invalid_process_map_route_point");
    return {
      x: requiredInteger(point.x, "invalid_process_map_route_x"),
      y: requiredInteger(point.y, "invalid_process_map_route_y"),
    };
  });
  if (routePoints.length > 256) throw new Error("process_map_route_too_large");
  return {
    resource_operational_relationship_id: requiredString(
      value.resource_operational_relationship_id,
      "invalid_process_map_relationship_id",
    ),
    route_points: routePoints,
    revision: requiredInteger(value.revision, "invalid_process_map_trace_revision"),
    created_timestamp: requiredString(value.created_timestamp, "invalid_process_map_created_timestamp"),
    updated_timestamp: requiredString(value.updated_timestamp, "invalid_process_map_updated_timestamp"),
  };
}

function normalizeLayerResponse(value: unknown): ProcessMapLayerResponse {
  if (!isRecord(value) || !isRecord(value.layer) || !Array.isArray(value.placements) || !Array.isArray(value.traces)) {
    throw new Error("invalid_process_map_layer_response");
  }
  const layer: ProcessMapLayer = value.layer.kind === "root"
    ? { kind: "root" }
    : value.layer.kind === "folder"
      ? {
          kind: "folder",
          folder_id: requiredString(value.layer.folder_id, "invalid_process_map_folder_id"),
          name: requiredString(value.layer.name, "invalid_process_map_folder_name"),
        }
      : (() => { throw new Error("invalid_process_map_layer"); })();
  const placements = value.placements.map(normalizePlacement);
  const visibleResources = new Set(placements.flatMap((placement) => placement.restricted
    ? []
    : [`${placement.resource_type}\u0000${placement.resource_id}`]));
  const traces = value.traces
    .map(normalizeTrace)
    .filter((trace) => visibleResources.has(`${trace.source.resource_type}\u0000${trace.source.resource_id}`)
      && visibleResources.has(`${trace.target.resource_type}\u0000${trace.target.resource_id}`));
  return {
    layer,
    placements,
    traces,
  };
}

function normalizeRelationship(value: unknown): ProcessMapOperationalRelationship {
  if (!isRecord(value)) throw new Error("invalid_process_map_relationship");
  return {
    resource_operational_relationship_id: requiredString(
      value.resource_operational_relationship_id,
      "invalid_process_map_relationship_id",
    ),
    source: resourceRef(value.source),
    target: resourceRef(value.target),
    created_timestamp: requiredString(value.created_timestamp, "invalid_process_map_created_timestamp"),
  };
}

function cloneLayerResponse(response: ProcessMapLayerResponse): ProcessMapLayerResponse {
  return {
    layer: { ...response.layer },
    placements: response.placements.map((placement) => ({ ...placement })),
    traces: response.traces.map((trace) => ({
      ...trace,
      source: { ...trace.source },
      target: { ...trace.target },
      route_points: trace.route_points.map((point) => ({ ...point })),
    })),
  };
}

function layerPath(companyID: string, folderID?: string): string {
  const params = new URLSearchParams({ company_id: companyID.trim() });
  if (folderID?.trim()) params.set("folder_id", folderID.trim());
  return `/v1/process-map/layer?${params.toString()}`;
}

function layerKey(apiBase: string, companyID: string, folderID?: string): string {
  return [getAuthSessionCacheGeneration(), apiBase, companyID.trim(), folderID?.trim() ?? ""].join("\u0000");
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("The request was aborted.", "AbortError");
}

function subscribeLayerInflight(entry: LayerInflightEntry, signal?: AbortSignal): Promise<ProcessMapLayerResponse> {
  const caller = Symbol("process-map-layer-caller");
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
          if (entry.settled || entry.callers.size > 0) return;
          if (layerInflight.get(entry.key) === entry) layerInflight.delete(entry.key);
          entry.controller.abort();
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
      (response) => settle(() => resolve(cloneLayerResponse(response))),
      (cause) => settle(() => reject(cause)),
    );
  });
}

export function fetchProcessMapLayer(
  apiBase: string,
  companyID: string,
  folderID?: string,
  signal?: AbortSignal,
): Promise<ProcessMapLayerResponse> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  const key = layerKey(apiBase, companyID, folderID);
  const existing = layerInflight.get(key);
  if (existing) return subscribeLayerInflight(existing, signal);

  const cached = layerCache.get(key);
  const controller = new AbortController();
  let entry: LayerInflightEntry;
  const headers = new Headers();
  if (cached?.etag) headers.set("If-None-Match", cached.etag);
  const promise = requestJSONWithMeta<unknown>(apiBase, layerPath(companyID, folderID), {
    headers,
    signal: controller.signal,
  }).then((response) => {
    if (response.notModified) {
      if (!cached) throw new Error("process_map_etag_without_cached_layer");
      return cached.response;
    }
    const normalized = normalizeLayerResponse(response.body);
    layerCache.set(key, { response: normalized, etag: response.etag });
    return normalized;
  }).finally(() => {
    entry.settled = true;
    if (entry.abortTimer !== undefined) clearTimeout(entry.abortTimer);
    if (layerInflight.get(key) === entry) layerInflight.delete(key);
  });
  entry = { key, controller, promise, callers: new Set(), settled: false };
  layerInflight.set(key, entry);
  return subscribeLayerInflight(entry, signal);
}

export function invalidateProcessMapLayers(apiBase: string, companyID: string): void {
  const prefix = `${getAuthSessionCacheGeneration()}\u0000${apiBase}\u0000${companyID.trim()}\u0000`;
  for (const key of layerCache.keys()) {
    if (key.startsWith(prefix)) layerCache.delete(key);
  }
  for (const [key, entry] of layerInflight) {
    if (!key.startsWith(prefix)) continue;
    layerInflight.delete(key);
    if (!entry.settled) entry.controller.abort();
  }
}

export async function fetchProcessMapOperationalRelationships(
  apiBase: string,
  companyID: string,
  resource: ProcessMapResourceRef,
  direction: ProcessMapRelationshipDirection = "both",
  signal?: AbortSignal,
): Promise<ProcessMapOperationalRelationship[]> {
  const params = new URLSearchParams({
    company_id: companyID.trim(),
    resource_type: resource.resource_type,
    resource_id: resource.resource_id.trim(),
    direction,
  });
  const payload = await requestJSON<unknown>(apiBase, `/v1/process-map/operational-relationships?${params}`, { signal });
  if (!isRecord(payload) || !Array.isArray(payload.resource_operational_relationships)) {
    throw new Error("invalid_process_map_relationship_response");
  }
  return payload.resource_operational_relationships.map(normalizeRelationship);
}

export async function putProcessMapPlacement(
  apiBase: string,
  companyID: string,
  resource: ProcessMapResourceRef,
  placement: { map_parent_folder_id: string | null; grid_x: number; grid_y: number },
): Promise<ProcessMapPlacementWriteResponse> {
  const params = new URLSearchParams({ company_id: companyID.trim() });
  const payload = await requestJSON<unknown>(
    apiBase,
    `/v1/process-map/placements/${encodeURIComponent(resource.resource_type)}/${encodeURIComponent(resource.resource_id)}?${params}`,
    {
      method: "PUT",
      json: {
        map_parent_folder_id: placement.map_parent_folder_id?.trim() || null,
        grid_x: Math.round(placement.grid_x),
        grid_y: Math.round(placement.grid_y),
      },
    },
  );
  invalidateProcessMapLayers(apiBase, companyID);
  return normalizePlacementWriteResponse(payload);
}

export async function deleteProcessMapPlacement(
  apiBase: string,
  companyID: string,
  resource: ProcessMapResourceRef,
): Promise<void> {
  const params = new URLSearchParams({ company_id: companyID.trim() });
  await requestJSON<void>(
    apiBase,
    `/v1/process-map/placements/${encodeURIComponent(resource.resource_type)}/${encodeURIComponent(resource.resource_id)}?${params}`,
    { method: "DELETE" },
  );
  invalidateProcessMapLayers(apiBase, companyID);
}

export async function postProcessMapRelationship(
  apiBase: string,
  companyID: string,
  source: ProcessMapResourceRef,
  target: ProcessMapResourceRef,
  routePoints?: readonly ProcessMapGridPoint[],
): Promise<ProcessMapRelationshipWriteResponse> {
  const payload = await requestJSON<unknown>(apiBase, "/v1/process-map/operational-relationships", {
    method: "POST",
    json: {
      company_id: companyID.trim(),
      source,
      target,
      ...(routePoints ? { trace: { route_points: normalizeProcessMapRoutePoints(routePoints) } } : {}),
    },
  });
  invalidateProcessMapLayers(apiBase, companyID);
  if (!isRecord(payload)) throw new Error("invalid_process_map_relationship_write_response");
  return {
    relationship: normalizeRelationship(payload.relationship),
    ...(payload.trace ? { trace: normalizeTraceWriteResponse(payload.trace) } : {}),
    relationship_created: payload.relationship_created === true,
    trace_changed: payload.trace_changed === true,
  };
}

export async function putProcessMapTrace(
  apiBase: string,
  companyID: string,
  relationshipID: string,
  routePoints: readonly ProcessMapGridPoint[],
): Promise<ProcessMapTraceWriteResponse> {
  const params = new URLSearchParams({ company_id: companyID.trim() });
  const payload = await requestJSON<unknown>(
    apiBase,
    `/v1/process-map/operational-relationships/${encodeURIComponent(relationshipID.trim())}/trace?${params}`,
    { method: "PUT", json: { route_points: normalizeProcessMapRoutePoints(routePoints) } },
  );
  invalidateProcessMapLayers(apiBase, companyID);
  return normalizeTraceWriteResponse(payload);
}

export async function deleteProcessMapRelationship(
  apiBase: string,
  companyID: string,
  relationshipID: string,
): Promise<void> {
  const params = new URLSearchParams({ company_id: companyID.trim() });
  await requestJSON<void>(
    apiBase,
    `/v1/process-map/operational-relationships/${encodeURIComponent(relationshipID.trim())}?${params}`,
    { method: "DELETE" },
  );
  invalidateProcessMapLayers(apiBase, companyID);
}
