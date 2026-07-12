import {
  clearResourceMissing,
  markResourceMissing,
  TerminalResourceNotFoundError,
  throwIfResourceMarkedMissing,
} from "../api/missingResources.js";
import { getAuthSessionCacheGeneration } from "../../auth/cognitoAuth.js";
import { requestJSON, requestJSONWithMeta } from "../api/requestJSON.js";
import { isHTTPNotFoundError } from "../api/requestJSON.js";
import type { NodeContentChange } from "../editor/nodeContentChanges.js";
import type { LogicGateGVICAssignment } from "../logic-gate-map/shared.js";
import type { NodeDetails, NodeRecord, NodeRelationship } from "./shared.js";

export type NodeProjectionItem = {
  company_id: string;
  node_id: string;
  information_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

type NodeViewResponse = NodeDetails & {
  company_id?: string;
  node_id?: string;
  projections?: NodeProjectionItem[];
  content_changes?: NodeContentChange[];
  gvic_assignments?: LogicGateGVICAssignment[];
};

const viewCache = new Map<string, NodeViewResponse>();
const viewInflight = new Map<string, Promise<NodeViewResponse>>();
const viewGeneration = new Map<string, number>();
const viewETag = new Map<string, string>();
const viewFresh = new Set<string>();
const anchorCleanInflight = new Map<string, Promise<void>>();
const anchorCleanSucceededETag = new Map<string, string>();
const anchorCleanRetryState = new Map<string, { attempts: number; etag: string }>();
const anchorCleanRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ANCHOR_CLEAN_RETRY_DELAYS_MS = [250, 1_000] as const;
let nodeRecordStoreAuthGeneration = getAuthSessionCacheGeneration();

const detailsCache = new Map<string, NodeDetails>();

const projectionCache = new Map<string, NodeProjectionItem[]>();

const contentChangeCache = new Map<string, NodeContentChange[]>();
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
  anchorCleanInflight.clear();
  anchorCleanSucceededETag.clear();
  anchorCleanRetryState.clear();
  anchorCleanRetryTimers.forEach((timer) => clearTimeout(timer));
  anchorCleanRetryTimers.clear();
  detailsCache.clear();
  projectionCache.clear();
  contentChangeCache.clear();
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
  contentChangeCache.set(cacheKey, payload.content_changes ?? []);
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
    can_view: payload.can_view,
    can_edit: payload.can_edit,
    can_admin: payload.can_admin,
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
      if (responseETag && !response.notModified) {
        scheduleNodeProjectionAnchorClean(apiBase, companyID, nodeID, cacheKey, responseETag);
      }
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

function scheduleNodeProjectionAnchorClean(
  apiBase: string,
  companyID: string,
  nodeID: string,
  cacheKey: string,
  etag: string,
): void {
  const anchorKey = `${cacheKey}\u0000${etag}`;
  if (anchorCleanSucceededETag.get(cacheKey) === etag || anchorCleanInflight.has(anchorKey) || anchorCleanRetryTimers.has(cacheKey)) return;
  const authGeneration = nodeRecordStoreAuthGeneration;
  const retryState = anchorCleanRetryState.get(cacheKey);
  if (!retryState || retryState.etag !== etag) anchorCleanRetryState.set(cacheKey, { attempts: 0, etag });
  const promise = requestJSON<{ status?: string }>(apiBase, `/v1/nodes/${encodeURIComponent(nodeID)}/changes/anchor-clean`, {
    method: "POST",
    json: { company_id: companyID },
  }).then(() => {
    if (getAuthSessionCacheGeneration() !== authGeneration) return;
    anchorCleanSucceededETag.set(cacheKey, etag);
    anchorCleanRetryState.delete(cacheKey);
  }).catch(() => {
    if (getAuthSessionCacheGeneration() !== authGeneration || viewETag.get(cacheKey) !== etag || !viewFresh.has(cacheKey)) return;
    const current = anchorCleanRetryState.get(cacheKey) ?? { attempts: 0, etag };
    const retryDelay = ANCHOR_CLEAN_RETRY_DELAYS_MS[current.attempts];
    if (retryDelay === undefined) return;
    anchorCleanRetryState.set(cacheKey, { attempts: current.attempts + 1, etag });
    const timer = setTimeout(() => {
      if (anchorCleanRetryTimers.get(cacheKey) === timer) anchorCleanRetryTimers.delete(cacheKey);
      if (getAuthSessionCacheGeneration() === authGeneration && viewETag.get(cacheKey) === etag && viewFresh.has(cacheKey)) {
        scheduleNodeProjectionAnchorClean(apiBase, companyID, nodeID, cacheKey, etag);
      }
    }, retryDelay);
    anchorCleanRetryTimers.set(cacheKey, timer);
  }).finally(() => {
    if (anchorCleanInflight.get(anchorKey) === promise) anchorCleanInflight.delete(anchorKey);
  });
  anchorCleanInflight.set(anchorKey, promise);
}

export function invalidateNodeRecordStoreCaches(apiBase: string, companyID: string, nodeID: string): void {
  const cacheKey = key(apiBase, companyID, nodeID);
  bumpViewGeneration(cacheKey);
  viewInflight.delete(cacheKey);
  viewFresh.delete(cacheKey);
  detailsCache.delete(cacheKey);
  projectionCache.delete(cacheKey);
  contentChangeCache.delete(cacheKey);
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
    anchorCleanSucceededETag.delete(cacheKey);
    anchorCleanRetryState.delete(cacheKey);
    const anchorRetryTimer = anchorCleanRetryTimers.get(cacheKey);
    if (anchorRetryTimer) clearTimeout(anchorRetryTimer);
    anchorCleanRetryTimers.delete(cacheKey);
    detailsCache.set(cacheKey, {
      node: entry.node,
      information: [],
      relationships: entry.relationships ?? [],
      information_count: 0,
      relationships_count: entry.relationships?.length ?? 0,
      effective_access_level: entry.node.effective_access_level,
      can_view: entry.node.can_view,
      can_edit: entry.node.can_edit,
      can_admin: entry.node.can_admin,
    });
    projectionCache.set(cacheKey, entry.projections ?? []);
    contentChangeCache.set(cacheKey, []);
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

export async function getNodeContentChangesSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<NodeContentChange[]> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const cached = contentChangeCache.get(cacheKey);
  if (cached) return cached;
  const payload = await getNodeViewPayloadSingleFlight(apiBase, companyID, nodeID);
  return payload.content_changes ?? [];
}

export async function getNodeGVICAssignmentsSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<LogicGateGVICAssignment[]> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const cached = gvicAssignmentCache.get(cacheKey);
  if (cached) return cached;
  const payload = await getNodeViewPayloadSingleFlight(apiBase, companyID, nodeID);
  return payload.gvic_assignments ?? [];
}
