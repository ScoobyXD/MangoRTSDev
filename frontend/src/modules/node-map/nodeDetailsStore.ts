import { NodeDetails } from "./shared";

export type NodeEditorProjectionItem = {
  company_id: string;
  node_id: string;
  info_key: string;
  type: string;
  information: string;
  source_information_id: string;
  created_timestamp: string;
  updated_timestamp: string;
};

type NodeEditorProjectionResponse = {
  company_id: string;
  node_id: string;
  items: NodeEditorProjectionItem[];
};

const detailsCache = new Map<string, NodeDetails>();
const detailsInflight = new Map<string, Promise<NodeDetails>>();

const editorProjectionCache = new Map<string, NodeEditorProjectionItem[]>();
const editorProjectionInflight = new Map<string, Promise<NodeEditorProjectionItem[]>>();

function key(apiBase: string, companyID: string, nodeID: string): string {
  return `${apiBase}:${companyID}:${nodeID}`;
}

async function requestJSON<T>(apiBase: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function invalidateNodeCaches(apiBase: string, companyID: string, nodeID: string): void {
  const cacheKey = key(apiBase, companyID, nodeID);
  detailsCache.delete(cacheKey);
  editorProjectionCache.delete(cacheKey);
}

export async function getNodeDetailsSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<NodeDetails> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const cached = detailsCache.get(cacheKey);
  if (cached) return cached;
  const inflight = detailsInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = requestJSON<NodeDetails>(apiBase, `/v1/nodes/${nodeID}?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      detailsCache.set(cacheKey, payload);
      detailsInflight.delete(cacheKey);
      return payload;
    })
    .catch((error) => {
      detailsInflight.delete(cacheKey);
      throw error;
    });
  detailsInflight.set(cacheKey, promise);
  return promise;
}

export async function getNodeEditorProjectionSingleFlight(apiBase: string, companyID: string, nodeID: string): Promise<NodeEditorProjectionItem[]> {
  const cacheKey = key(apiBase, companyID, nodeID);
  const cached = editorProjectionCache.get(cacheKey);
  if (cached) return cached;
  const inflight = editorProjectionInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = requestJSON<NodeEditorProjectionResponse>(apiBase, `/v1/nodes/${nodeID}/editor-projection?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      const items = payload.items ?? [];
      editorProjectionCache.set(cacheKey, items);
      editorProjectionInflight.delete(cacheKey);
      return items;
    })
    .catch((error) => {
      editorProjectionInflight.delete(cacheKey);
      throw error;
    });
  editorProjectionInflight.set(cacheKey, promise);
  return promise;
}
