import { requestJSON } from "../api/requestJSON.js";
import type { NodeContentChange } from "../editor/nodeContentChanges.js";
import { NodeDetails, NodeRecord, NodeRelationship } from "./shared";

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
};

const viewCache = new Map<string, NodeViewResponse>();
const viewInflight = new Map<string, Promise<NodeViewResponse>>();

const detailsCache = new Map<string, NodeDetails>();

const projectionCache = new Map<string, NodeProjectionItem[]>();

const contentChangeCache = new Map<string, NodeContentChange[]>();

function key(apiBase: string, companyID: string, nodeID: string): string {
  return `${apiBase}:${companyID}:${nodeID}`;
}

function cacheNodeViewPayload(cacheKey: string, payload: NodeViewResponse): NodeDetails {
  viewCache.set(cacheKey, payload);
  const details: NodeDetails = {
    node: payload.node,
    information: payload.information ?? [],
    relationships: payload.relationships ?? [],
    information_count: payload.information_count,
    relationships_count: payload.relationships_count,
  };
  detailsCache.set(cacheKey, details);
  projectionCache.set(cacheKey, payload.projections ?? []);
  contentChangeCache.set(cacheKey, payload.content_changes ?? []);
  return details;
}

async function getNodeViewPayloadSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<NodeViewResponse> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const cached = viewCache.get(cacheKey);
  if (cached) return cached;
  const inflight = viewInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = requestJSON<NodeViewResponse>(apiBase, `/v2/nodes/${encodeURIComponent(nodeID)}/view?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      cacheNodeViewPayload(cacheKey, payload);
      viewInflight.delete(cacheKey);
      return payload;
    })
    .catch((error) => {
      viewInflight.delete(cacheKey);
      throw error;
    });
  viewInflight.set(cacheKey, promise);
  return promise;
}

export function invalidateNodeRecordStoreCaches(apiBase: string, companyID: string, nodeID: string): void {
  const cacheKey = key(apiBase, companyID, nodeID);
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
    detailsCache.set(cacheKey, {
      node: entry.node,
      information: [],
      relationships: entry.relationships ?? [],
      information_count: 0,
      relationships_count: entry.relationships?.length ?? 0,
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
