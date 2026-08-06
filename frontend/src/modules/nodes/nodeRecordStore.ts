import {
  clearResourceMissing,
  markResourceMissing,
  TerminalResourceNotFoundError,
  throwIfResourceMarkedMissing,
} from "../api/missingResources.js";
import { getAuthSessionCacheGeneration } from "../../auth/cognitoAuth.js";
import { requestJSONWithMeta } from "../api/requestJSON.js";
import { isHTTPNotFoundError } from "../api/requestJSON.js";
import type { LogicGateGVICAssignment } from "../logic-gates/types.js";
import type { NodeDetails, NodeRecord, NodeRelationship } from "./types.js";

export type NodeProjectionItem = {
  company_id: string;
  node_id: string;
  information_id: string;
  type: string;
  information: string;
  revision?: number;
  created_timestamp: string;
  updated_timestamp: string;
};

type NodeViewResponse = NodeDetails & {
  company_id?: string;
  node_id?: string;
  projections?: NodeProjectionItem[];
  gvic_assignments?: LogicGateGVICAssignment[];
};

const viewCache = new Map<string, NodeViewResponse>();
const viewInflight = new Map<string, Promise<NodeViewResponse>>();
const viewGeneration = new Map<string, number>();
const viewETag = new Map<string, string>();
const viewFresh = new Set<string>();
let nodeRecordStoreAuthGeneration = getAuthSessionCacheGeneration();

const detailsCache = new Map<string, NodeDetails>();

const projectionCache = new Map<string, NodeProjectionItem[]>();

const gvicAssignmentCache = new Map<string, LogicGateGVICAssignment[]>();

function key(apiBase: string, companyID: string, nodeID: string): string {
  ensureNodeRecordStoreAuthScope();
  return `${nodeRecordStoreAuthGeneration}\u0000${apiBase}\u0000${companyID}\u0000${nodeID}`;
}

function ensureNodeRecordStoreAuthScope(): void {
  const authGeneration = getAuthSessionCacheGeneration();
  if (authGeneration === nodeRecordStoreAuthGeneration) return;
  nodeRecordStoreAuthGeneration = authGeneration;
  viewCache.clear();
  viewInflight.clear();
  viewGeneration.clear();
  viewETag.clear();
  viewFresh.clear();
  detailsCache.clear();
  projectionCache.clear();
  gvicAssignmentCache.clear();
}

function readViewGeneration(cacheKey: string): number {
  return viewGeneration.get(cacheKey) ?? 0;
}

function bumpViewGeneration(cacheKey: string): void {
  viewGeneration.set(cacheKey, readViewGeneration(cacheKey) + 1);
}

function cacheNodeViewPayload(cacheKey: string, payload: NodeViewResponse): NodeDetails {
  viewCache.set(cacheKey, payload);
  const details = nodeDetailsFromViewPayload(payload);
  detailsCache.set(cacheKey, details);
  projectionCache.set(cacheKey, payload.projections ?? []);
  gvicAssignmentCache.set(cacheKey, payload.gvic_assignments ?? []);
  return details;
}

function nodeDetailsFromViewPayload(payload: NodeViewResponse): NodeDetails {
  return {
    node: payload.node,
    information: payload.information ?? [],
    relationships: payload.relationships ?? [],
    information_count: payload.information_count,
    relationships_count: payload.relationships_count,
    effective_access_level: payload.effective_access_level ?? payload.node?.effective_access_level,
    can_edit: payload.can_edit,
  };
}

async function getNodeViewPayloadSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<NodeViewResponse> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const resourceKey = { apiBase, companyID, resourceType: "node" as const, resourceID: nodeID };
  throwIfResourceMarkedMissing(resourceKey);
  const cached = viewCache.get(cacheKey);
  if (cached && viewFresh.has(cacheKey)) return cached;
  const inflight = viewInflight.get(cacheKey);
  if (inflight) return inflight;
  const generation = readViewGeneration(cacheKey);
  const authGeneration = nodeRecordStoreAuthGeneration;
  const etag = viewETag.get(cacheKey) ?? "";
  const headers = new Headers();
  if (etag) headers.set("If-None-Match", etag);
  const promise = requestJSONWithMeta<NodeViewResponse>(apiBase, `/v2/nodes/${encodeURIComponent(nodeID)}/view?company_id=${encodeURIComponent(companyID)}`, { headers })
    .then((response) => {
      const payload = response.notModified ? cached : response.body;
      if (!payload) throw new Error("node_view_304_without_cached_payload");
      if (getAuthSessionCacheGeneration() !== authGeneration || readViewGeneration(cacheKey) !== generation) {
        throw new DOMException("The node view became stale.", "AbortError");
      }
      const responseETag = response.etag?.trim() || etag;
      if (responseETag) viewETag.set(cacheKey, responseETag);
      cacheNodeViewPayload(cacheKey, payload);
      viewFresh.add(cacheKey);
      if (viewInflight.get(cacheKey) === promise) viewInflight.delete(cacheKey);
      return payload;
    })
    .catch((error) => {
      if (viewInflight.get(cacheKey) === promise) viewInflight.delete(cacheKey);
      if (getAuthSessionCacheGeneration() === authGeneration && isHTTPNotFoundError(error)) {
        markResourceMissing(resourceKey);
        invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
        throw new TerminalResourceNotFoundError("node", nodeID);
      }
      throw error;
    });
  viewInflight.set(cacheKey, promise);
  return promise;
}

export function invalidateNodeRecordStoreCaches(apiBase: string, companyID: string, nodeID: string): void {
  const cacheKey = key(apiBase, companyID, nodeID);
  bumpViewGeneration(cacheKey);
  viewInflight.delete(cacheKey);
  viewFresh.delete(cacheKey);
  detailsCache.delete(cacheKey);
  projectionCache.delete(cacheKey);
  gvicAssignmentCache.delete(cacheKey);
}

export function primeNodeRecordStoreCaches(apiBase: string, companyID: string, entries: Array<{
  node: NodeRecord;
  relationships?: NodeRelationship[];
  projections?: NodeProjectionItem[];
}>): void {
  for (const entry of entries) {
    const cacheKey = key(apiBase, companyID, entry.node.node_id);
    clearResourceMissing({ apiBase, companyID, resourceType: "node", resourceID: entry.node.node_id });
    bumpViewGeneration(cacheKey);
    viewInflight.delete(cacheKey);
    viewCache.delete(cacheKey);
    viewETag.delete(cacheKey);
    viewFresh.delete(cacheKey);
    detailsCache.set(cacheKey, {
      node: entry.node,
      information: [],
      relationships: entry.relationships ?? [],
      information_count: 0,
      relationships_count: entry.relationships?.length ?? 0,
      effective_access_level: entry.node.effective_access_level,
      can_edit: entry.node.can_edit,
    });
    projectionCache.set(cacheKey, entry.projections ?? []);
    gvicAssignmentCache.set(cacheKey, []);
  }
}

export async function getNodeRecordSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<NodeDetails> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const cached = detailsCache.get(cacheKey);
  if (cached) return cached;
  const payload = await getNodeViewPayloadSingleFlight(apiBase, companyID, nodeID);
  return detailsCache.get(cacheKey) ?? nodeDetailsFromViewPayload(payload);
}

export async function getNodeInformationProjectionSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<NodeProjectionItem[]> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const cached = projectionCache.get(cacheKey);
  if (cached) return cached;
  const payload = await getNodeViewPayloadSingleFlight(apiBase, companyID, nodeID);
  return payload.projections ?? [];
}

export async function getNodeGVICAssignmentsSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<LogicGateGVICAssignment[]> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const cached = gvicAssignmentCache.get(cacheKey);
  if (cached) return cached;
  const payload = await getNodeViewPayloadSingleFlight(apiBase, companyID, nodeID);
  return payload.gvic_assignments ?? [];
}
