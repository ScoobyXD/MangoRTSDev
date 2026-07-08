import {
  clearResourceMissing,
  markResourceMissing,
  TerminalResourceNotFoundError,
  throwIfResourceMarkedMissing,
} from "../api/missingResources.js";
import { requestJSON } from "../api/requestJSON.js";
import { isHTTPNotFoundError } from "../api/requestJSON.js";
import type { NodeContentChange } from "../editor/nodeContentChanges.js";
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
  editor_sequence?: number | string;
};

const viewCache = new Map<string, NodeViewResponse>();
const viewInflight = new Map<string, Promise<NodeViewResponse>>();
const viewGeneration = new Map<string, number>();

const detailsCache = new Map<string, NodeDetails>();

const projectionCache = new Map<string, NodeProjectionItem[]>();

const contentChangeCache = new Map<string, NodeContentChange[]>();

function key(apiBase: string, companyID: string, nodeID: string): string {
  return `${apiBase}:${companyID}:${nodeID}`;
}

function readViewGeneration(cacheKey: string): number {
  return viewGeneration.get(cacheKey) ?? 0;
}

function bumpViewGeneration(cacheKey: string): void {
  viewGeneration.set(cacheKey, readViewGeneration(cacheKey) + 1);
}

function cacheNodeViewPayload(cacheKey: string, payload: NodeViewResponse): NodeDetails {
  viewCache.set(cacheKey, payload);
  const details: NodeDetails = {
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
  detailsCache.set(cacheKey, details);
  projectionCache.set(cacheKey, payload.projections ?? []);
  contentChangeCache.set(cacheKey, payload.content_changes ?? []);
  return details;
}

async function getNodeViewPayloadSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<NodeViewResponse> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const resourceKey = { apiBase, companyID, resourceType: "node" as const, resourceID: nodeID };
  throwIfResourceMarkedMissing(resourceKey);
  const cached = viewCache.get(cacheKey);
  if (cached) return cached;
  const inflight = viewInflight.get(cacheKey);
  if (inflight) return inflight;
  const generation = readViewGeneration(cacheKey);
  const promise = requestJSON<NodeViewResponse>(apiBase, `/v2/nodes/${encodeURIComponent(nodeID)}/view?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      if (readViewGeneration(cacheKey) === generation) cacheNodeViewPayload(cacheKey, payload);
      if (viewInflight.get(cacheKey) === promise) viewInflight.delete(cacheKey);
      return payload;
    })
    .catch((error) => {
      if (viewInflight.get(cacheKey) === promise) viewInflight.delete(cacheKey);
      if (isHTTPNotFoundError(error)) {
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
  viewCache.delete(cacheKey);
  detailsCache.delete(cacheKey);
  projectionCache.delete(cacheKey);
  contentChangeCache.delete(cacheKey);
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
  }
}

export async function getNodeRecordSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<NodeDetails> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const cached = detailsCache.get(cacheKey);
  if (cached) return cached;
  const payload = await getNodeViewPayloadSingleFlight(apiBase, companyID, nodeID);
  return cacheNodeViewPayload(cacheKey, payload);
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

export async function getNodeEditorSequenceSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<number> {
  const payload = await getNodeViewPayloadSingleFlight(apiBase, companyID, nodeID);
  return parseEditorSequence(payload.editor_sequence);
}

function parseEditorSequence(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}
