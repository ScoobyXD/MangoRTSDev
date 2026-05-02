// Node relationship graph cache/sync plane for Node Map + Company Explorer.
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import { NodeRecord, NodeRelationship } from "./shared";

export type NodeRelationshipGraphSnapshot = {
  nodes: NodeRecord[];
  relationships: NodeRelationship[];
  folders?: CompanyExplorerFolder[];
  folder_items?: CompanyExplorerFolderItem[];
  generated_at?: string;
};

type Subscriber = () => void;
type CacheEntry = {
  snapshot: NodeRelationshipGraphSnapshot;
  subscribers: Set<Subscriber>;
  loading: boolean;
  source?: EventSource;
  etag?: string;
};

type NodeRelationshipGraphStreamEnvelope = {
  company_id: string;
  type: string;
  ts: string;
  data?: Record<string, unknown>;
};

// Initial cache snapshot so subscribers always receive a consistent shape.
const EMPTY_SNAPSHOT: NodeRelationshipGraphSnapshot = { nodes: [], relationships: [] };
const nodeRelationshipGraphCache = new Map<string, CacheEntry>();

// Cache entry resolver: creates per-company workspace cache bucket on demand.
function getEntry(key: string): CacheEntry {
  const existing = nodeRelationshipGraphCache.get(key);
  if (existing) return existing;
  const created: CacheEntry = { snapshot: EMPTY_SNAPSHOT, subscribers: new Set(), loading: false };
  nodeRelationshipGraphCache.set(key, created);
  return created;
}

// Fan-out notifier for Company Explorer / Node Map subscribers.
function notify(entry: CacheEntry): void {
  for (const subscriber of entry.subscribers) subscriber();
}

// Some graph events are intentionally non-relationship mutations (e.g. node information writes).
// For those, refreshing the graph snapshot is unnecessary and adds avoidable hot-path GET load.
function isNonGraphWorkspaceEvent(eventType: string): boolean {
  return eventType === "node_information_created" || eventType.startsWith("logic_gate_");
}

// Local mutation helper: lets hot-path UI actions apply immediate cache updates without
// forcing a full snapshot refetch. SSE + periodic snapshot refresh remain the source of truth.
export function upsertNodeRelationshipGraphNode(apiBase: string, companyID: string, node: NodeRecord): void {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  const currentNodes = entry.snapshot.nodes ?? [];
  const exists = currentNodes.some((item) => item.node_id === node.node_id);
  entry.snapshot = {
    nodes: exists ? currentNodes.map((item) => (item.node_id === node.node_id ? node : item)) : [...currentNodes, node],
    relationships: entry.snapshot.relationships ?? [],
    folders: entry.snapshot.folders ?? [],
    folder_items: entry.snapshot.folder_items ?? [],
    generated_at: new Date().toISOString(),
  };
  notify(entry);
}

// Local mutation helper for delete flows so successful node deletes converge immediately without
// forcing a full snapshot reload on hot paths.
export function removeNodeRelationshipGraphNode(apiBase: string, companyID: string, nodeID: string): void {
  if (!nodeID) return;
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  const currentNodes = entry.snapshot.nodes ?? [];
  const nextNodes = currentNodes.filter((item) => item.node_id !== nodeID);
  const nextRelationships = (entry.snapshot.relationships ?? []).filter((item) => item.node_id_a !== nodeID && item.node_id_b !== nodeID);
  const nextFolderItems = (entry.snapshot.folder_items ?? []).filter((item) => item.item_type !== "node" || item.item_id !== nodeID);
  if (nextNodes.length === currentNodes.length && nextRelationships.length === (entry.snapshot.relationships ?? []).length) return;
  entry.snapshot = {
    nodes: nextNodes,
    relationships: nextRelationships,
    folders: entry.snapshot.folders ?? [],
    folder_items: nextFolderItems,
    generated_at: new Date().toISOString(),
  };
  notify(entry);
}

export function upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase: string, companyID: string, item: CompanyExplorerFolderItem): void {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  const current = entry.snapshot.folder_items ?? [];
  const exists = current.some((row) => row.item_type === item.item_type && row.item_id === item.item_id);
  entry.snapshot = {
    ...entry.snapshot,
    folder_items: exists
      ? current.map((row) => (row.item_type === item.item_type && row.item_id === item.item_id ? item : row))
      : [...current, item],
    generated_at: new Date().toISOString(),
  };
  notify(entry);
}

export function upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase: string, companyID: string, folder: CompanyExplorerFolder): void {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  const current = entry.snapshot.folders ?? [];
  const exists = current.some((row) => row.folder_id === folder.folder_id);
  entry.snapshot = {
    ...entry.snapshot,
    folders: exists ? current.map((row) => (row.folder_id === folder.folder_id ? folder : row)) : [...current, folder],
    generated_at: new Date().toISOString(),
  };
  notify(entry);
}

// Runtime payload guard for SSE delta events -> NodeRecord contract.
function asNodeRecord(candidate: unknown): NodeRecord | null {
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Partial<NodeRecord>;
  if (typeof value.company_id !== "string" || typeof value.node_id !== "string" || typeof value.title !== "string") return null;
  return {
    company_id: value.company_id,
    node_id: value.node_id,
    title: value.title,
    created_timestamp: typeof value.created_timestamp === "string" ? value.created_timestamp : new Date().toISOString(),
  };
}

// Runtime payload guard for SSE delta events -> NodeRelationship contract.
function asRelationship(candidate: unknown): NodeRelationship | null {
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Partial<NodeRelationship>;
  if (
    typeof value.company_id !== "string" ||
    typeof value.node_relationship_id !== "string" ||
    typeof value.node_id_a !== "string" ||
    typeof value.node_id_b !== "string" ||
    typeof value.a_position !== "string" ||
    typeof value.b_position !== "string"
  ) return null;
  return {
    company_id: value.company_id,
    node_relationship_id: value.node_relationship_id,
    node_id_a: value.node_id_a,
    node_id_b: value.node_id_b,
    a_position: value.a_position as NodeRelationship["a_position"],
    b_position: value.b_position as NodeRelationship["b_position"],
    created_timestamp: typeof value.created_timestamp === "string" ? value.created_timestamp : new Date().toISOString(),
  };
}

// Delta reducer: applies streaming graph events without full snapshot reload.
function applyNodeRelationshipGraphDelta(entry: CacheEntry, envelope: NodeRelationshipGraphStreamEnvelope): boolean {
  const previous = entry.snapshot;
  const currentNodes = previous.nodes ?? [];
  const currentRelationships = previous.relationships ?? [];
  const data = envelope.data ?? {};

  if (envelope.type === "node_created") {
    const node = asNodeRecord(data.node);
    if (!node) return false;
    const exists = currentNodes.some((item) => item.node_id === node.node_id);
    entry.snapshot = {
      nodes: exists ? currentNodes.map((item) => (item.node_id === node.node_id ? node : item)) : [...currentNodes, node],
      relationships: currentRelationships,
      folders: previous.folders ?? [],
      folder_items: previous.folder_items ?? [],
      generated_at: envelope.ts,
    };
    return true;
  }
  if (envelope.type === "node_updated") {
    const node = asNodeRecord(data.node);
    if (!node) return false;
    const exists = currentNodes.some((item) => item.node_id === node.node_id);
    if (!exists) return false;
    entry.snapshot = {
      nodes: currentNodes.map((item) => (item.node_id === node.node_id ? node : item)),
      relationships: currentRelationships,
      folders: previous.folders ?? [],
      folder_items: previous.folder_items ?? [],
      generated_at: envelope.ts,
    };
    return true;
  }

  if (envelope.type === "node_deleted") {
    const nodeID = typeof data.node_id === "string" ? data.node_id : "";
    if (!nodeID) return false;
    entry.snapshot = {
      nodes: currentNodes.filter((item) => item.node_id !== nodeID),
      relationships: currentRelationships.filter((item) => item.node_id_a !== nodeID && item.node_id_b !== nodeID),
      folders: previous.folders ?? [],
      folder_items: (previous.folder_items ?? []).filter((item) => item.item_type !== "node" || item.item_id !== nodeID),
      generated_at: envelope.ts,
    };
    return true;
  }

  if (envelope.type === "relationship_created") {
    const relationship = asRelationship(data.relationship);
    if (!relationship) return false;
    const exists = currentRelationships.some((item) => item.node_relationship_id === relationship.node_relationship_id);
    entry.snapshot = {
      nodes: currentNodes,
      relationships: exists
        ? currentRelationships.map((item) => (item.node_relationship_id === relationship.node_relationship_id ? relationship : item))
        : [...currentRelationships, relationship],
      folders: previous.folders ?? [],
      folder_items: previous.folder_items ?? [],
      generated_at: envelope.ts,
    };
    return true;
  }

  if (envelope.type === "relationship_deleted") {
    const relationshipID = typeof data.node_relationship_id === "string" ? data.node_relationship_id : "";
    if (!relationshipID) return false;
    entry.snapshot = {
      nodes: currentNodes,
      relationships: currentRelationships.filter((item) => item.node_relationship_id !== relationshipID),
      folders: previous.folders ?? [],
      folder_items: previous.folder_items ?? [],
      generated_at: envelope.ts,
    };
    return true;
  }

  if (envelope.type === "company_explorer_folder_created" || envelope.type === "company_explorer_folder_moved") {
    const folder = data.folder as CompanyExplorerFolder | undefined;
    if (!folder || typeof folder.folder_id !== "string") return false;
    const currentFolders = previous.folders ?? [];
    entry.snapshot = {
      ...previous,
      folders: currentFolders.some((item) => item.folder_id === folder.folder_id)
        ? currentFolders.map((item) => (item.folder_id === folder.folder_id ? folder : item))
        : [...currentFolders, folder],
      generated_at: envelope.ts,
    };
    return true;
  }

  if (envelope.type === "company_explorer_folder_item_assigned") {
    const folderItem = data.folder_item as CompanyExplorerFolderItem | undefined;
    if (!folderItem || typeof folderItem.item_id !== "string" || typeof folderItem.item_type !== "string") return false;
    const currentItems = previous.folder_items ?? [];
    entry.snapshot = {
      ...previous,
      folder_items: currentItems.some((item) => item.item_type === folderItem.item_type && item.item_id === folderItem.item_id)
        ? currentItems.map((item) => (item.item_type === folderItem.item_type && item.item_id === folderItem.item_id ? folderItem : item))
        : [...currentItems, folderItem],
      generated_at: envelope.ts,
    };
    return true;
  }

  if (envelope.type === "company_explorer_folder_item_removed") {
    const itemType = typeof data.item_type === "string" ? data.item_type : "";
    const itemID = typeof data.item_id === "string" ? data.item_id : "";
    if (!itemType || !itemID) return false;
    entry.snapshot = {
      ...previous,
      folder_items: (previous.folder_items ?? []).filter((item) => item.item_type !== itemType || item.item_id !== itemID),
      generated_at: envelope.ts,
    };
    return true;
  }

  return false;
}

// Snapshot fetcher with ETag support; keeps hot-path reads light and cache-friendly.
export async function refreshNodeRelationshipGraphSnapshot(apiBase: string, companyID: string): Promise<void> {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  if (entry.loading) return;
  entry.loading = true;
  try {
    const response = await fetch(`${apiBase}/v1/workspace/snapshot?company_id=${encodeURIComponent(companyID)}`, {
      cache: "no-store",
      headers: entry.etag ? { "If-None-Match": entry.etag } : undefined,
    });
    if (response.status === 304) return;
    if (!response.ok) return;
    const payload = (await response.json()) as NodeRelationshipGraphSnapshot;
    const nextEtag = response.headers.get("ETag");
    // If the backend says the payload hash is identical to what we already hold, skip
    // subscriber fan-out entirely. This protects hot paths from unnecessary rerender churn.
    if (nextEtag && entry.etag === nextEtag) return;
    if (nextEtag) entry.etag = nextEtag;
    entry.snapshot = {
      nodes: payload.nodes ?? [],
      relationships: payload.relationships ?? [],
      folders: payload.folders ?? [],
      folder_items: payload.folder_items ?? [],
      generated_at: payload.generated_at,
    };
    notify(entry);
  } finally {
    entry.loading = false;
  }
}

// SSE stream bootstrap: keeps modules synchronized in near real-time without polling loops.
function ensureStream(apiBase: string, companyID: string): void {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  if (entry.source) return;
  const source = new EventSource(`${apiBase}/v1/workspace/stream?company_id=${encodeURIComponent(companyID)}`);
  source.addEventListener("workspace", (event) => {
    const payload = (event as MessageEvent).data;
    if (typeof payload !== "string" || payload.length === 0) {
      void refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
      return;
    }
    try {
      const envelope = JSON.parse(payload) as NodeRelationshipGraphStreamEnvelope;
      if (envelope.company_id !== companyID) return;
      if (isNonGraphWorkspaceEvent(envelope.type)) return;
      const applied = applyNodeRelationshipGraphDelta(entry, envelope);
      if (applied) notify(entry);
      else void refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
    } catch {
      void refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
    }
  });
  source.onerror = () => {
    // Browser will auto-retry EventSource; keep current source reference.
  };
  entry.source = source;
}

// Public subscription API used by UI modules for workspace snapshot updates.
export function subscribeNodeRelationshipGraph(apiBase: string, companyID: string, subscriber: Subscriber): () => void {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  entry.subscribers.add(subscriber);
  if (entry.snapshot.nodes.length === 0 && entry.snapshot.relationships.length === 0) {
    void refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
  }
  ensureStream(apiBase, companyID);
  return () => {
    const current = nodeRelationshipGraphCache.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
  };
}

// Synchronous snapshot getter for render paths that need latest cached workspace data.
export function getNodeRelationshipGraphSnapshot(apiBase: string, companyID: string): NodeRelationshipGraphSnapshot {
  const key = `${apiBase}:${companyID}`;
  return getEntry(key).snapshot;
}
