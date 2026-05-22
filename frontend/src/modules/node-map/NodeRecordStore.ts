import { requestJSON } from "../api/requestJSON.js";
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
};

const detailsCache = new Map<string, NodeDetails>();
const detailsInflight = new Map<string, Promise<NodeDetails>>();

const projectionCache = new Map<string, NodeProjectionItem[]>();
const projectionInflight = new Map<string, Promise<NodeProjectionItem[]>>();

function key(apiBase: string, companyID: string, nodeID: string): string {
  return `${apiBase}:${companyID}:${nodeID}`;
}

function cacheNodeViewPayload(cacheKey: string, payload: NodeViewResponse): NodeDetails {
  const details: NodeDetails = {
    node: payload.node,
    information: payload.information ?? [],
    relationships: payload.relationships ?? [],
    information_count: payload.information_count,
    relationships_count: payload.relationships_count,
  };
  detailsCache.set(cacheKey, details);
  projectionCache.set(cacheKey, payload.projections ?? []);
  return details;
}

export function invalidateNodeRecordStoreCaches(apiBase: string, companyID: string, nodeID: string): void {
  const cacheKey = key(apiBase, companyID, nodeID);
  detailsCache.delete(cacheKey);
  projectionCache.delete(cacheKey);
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
  }
}

export async function getNodeRecordSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<NodeDetails> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const cached = detailsCache.get(cacheKey);
  if (cached) return cached;
  const inflight = detailsInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = requestJSON<NodeViewResponse>(apiBase, `/v2/nodes/${encodeURIComponent(nodeID)}/view?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      const details = cacheNodeViewPayload(cacheKey, payload);
      detailsInflight.delete(cacheKey);
      return details;
    })
    .catch((error) => {
      detailsInflight.delete(cacheKey);
      throw error;
    });
  detailsInflight.set(cacheKey, promise);
  return promise;
}

export async function getNodeInformationProjectionSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<NodeProjectionItem[]> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const cached = projectionCache.get(cacheKey);
  if (cached) return cached;
  const inflight = projectionInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = requestJSON<NodeViewResponse>(apiBase, `/v2/nodes/${encodeURIComponent(nodeID)}/view?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      cacheNodeViewPayload(cacheKey, payload);
      const items = payload.projections ?? [];
      projectionInflight.delete(cacheKey);
      return items;
    })
    .catch((error) => {
      projectionInflight.delete(cacheKey);
      throw error;
    });
  projectionInflight.set(cacheKey, promise);
  return promise;
}
