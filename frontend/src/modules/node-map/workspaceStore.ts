// Workspace data-plane cache for Node Map + Company Explorer real-time synchronization.
import { NodeRecord, NodeRelationship } from "./shared";

export type WorkspaceSnapshot = {
  nodes: NodeRecord[];
  relationships: NodeRelationship[];
  generated_at?: string;
};

type Subscriber = () => void;
type CacheEntry = {
  snapshot: WorkspaceSnapshot;
  subscribers: Set<Subscriber>;
  loading: boolean;
  source?: EventSource;
  etag?: string;
};

type WorkspaceStreamEnvelope = {
  company_id: string;
  type: string;
  ts: string;
  data?: Record<string, unknown>;
};

// Initial cache snapshot so subscribers always receive a consistent shape.
const EMPTY_SNAPSHOT: WorkspaceSnapshot = { nodes: [], relationships: [] };
const workspaceCache = new Map<string, CacheEntry>();

// Cache entry resolver: creates per-company workspace cache bucket on demand.
function getEntry(key: string): CacheEntry {
  const existing = workspaceCache.get(key);
  if (existing) return existing;
  const created: CacheEntry = { snapshot: EMPTY_SNAPSHOT, subscribers: new Set(), loading: false };
  workspaceCache.set(key, created);
  return created;
}

// Fan-out notifier for Company Explorer / Node Map subscribers.
function notify(entry: CacheEntry): void {
  for (const subscriber of entry.subscribers) subscriber();
}

// Local mutation helper: lets hot-path UI actions apply immediate cache updates without
// forcing a full snapshot refetch. SSE + periodic snapshot refresh remain the source of truth.
export function upsertWorkspaceNode(apiBase: string, companyID: string, node: NodeRecord): void {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  const currentNodes = entry.snapshot.nodes ?? [];
  const exists = currentNodes.some((item) => item.node_id === node.node_id);
  entry.snapshot = {
    nodes: exists ? currentNodes.map((item) => (item.node_id === node.node_id ? node : item)) : [...currentNodes, node],
    relationships: entry.snapshot.relationships ?? [],
    generated_at: new Date().toISOString(),
  };
  notify(entry);
}

// Runtime payload guard for SSE delta events -> NodeRecord contract.
function asNodeRecord(candidate: unknown): NodeRecord | null {
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Partial<NodeRecord>;
  if (typeof value.company_id !== "string" || typeof value.node_id !== "string" || typeof value.header !== "string") return null;
  return {
    company_id: value.company_id,
    node_id: value.node_id,
    header: value.header,
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

// Delta reducer: applies streaming workspace events without full snapshot reload.
function applyWorkspaceDelta(entry: CacheEntry, envelope: WorkspaceStreamEnvelope): boolean {
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
      generated_at: envelope.ts,
    };
    return true;
  }

  return false;
}

// Snapshot fetcher with ETag support; keeps hot-path reads light and cache-friendly.
export async function refreshWorkspaceSnapshot(apiBase: string, companyID: string): Promise<void> {
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
    const payload = (await response.json()) as WorkspaceSnapshot;
    const nextEtag = response.headers.get("ETag");
    // If the backend says the payload hash is identical to what we already hold, skip
    // subscriber fan-out entirely. This protects hot paths from unnecessary rerender churn.
    if (nextEtag && entry.etag === nextEtag) return;
    if (nextEtag) entry.etag = nextEtag;
    entry.snapshot = {
      nodes: payload.nodes ?? [],
      relationships: payload.relationships ?? [],
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
      void refreshWorkspaceSnapshot(apiBase, companyID);
      return;
    }
    try {
      const envelope = JSON.parse(payload) as WorkspaceStreamEnvelope;
      if (envelope.company_id !== companyID) return;
      const applied = applyWorkspaceDelta(entry, envelope);
      if (applied) notify(entry);
      else void refreshWorkspaceSnapshot(apiBase, companyID);
    } catch {
      void refreshWorkspaceSnapshot(apiBase, companyID);
    }
  });
  source.onerror = () => {
    // Browser will auto-retry EventSource; keep current source reference.
  };
  entry.source = source;
}

// Public subscription API used by UI modules for workspace snapshot updates.
export function subscribeWorkspace(apiBase: string, companyID: string, subscriber: Subscriber): () => void {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  entry.subscribers.add(subscriber);
  if (entry.snapshot.nodes.length === 0 && entry.snapshot.relationships.length === 0) {
    void refreshWorkspaceSnapshot(apiBase, companyID);
  }
  ensureStream(apiBase, companyID);
  return () => {
    const current = workspaceCache.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
  };
}

// Synchronous snapshot getter for render paths that need latest cached workspace data.
export function getWorkspaceSnapshot(apiBase: string, companyID: string): WorkspaceSnapshot {
  const key = `${apiBase}:${companyID}`;
  return getEntry(key).snapshot;
}
