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
};

const EMPTY_SNAPSHOT: WorkspaceSnapshot = { nodes: [], relationships: [] };
const workspaceCache = new Map<string, CacheEntry>();

function getEntry(key: string): CacheEntry {
  const existing = workspaceCache.get(key);
  if (existing) return existing;
  const created: CacheEntry = { snapshot: EMPTY_SNAPSHOT, subscribers: new Set(), loading: false };
  workspaceCache.set(key, created);
  return created;
}

function notify(entry: CacheEntry): void {
  for (const subscriber of entry.subscribers) subscriber();
}

export async function refreshWorkspaceSnapshot(apiBase: string, companyID: string): Promise<void> {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  if (entry.loading) return;
  entry.loading = true;
  try {
    const response = await fetch(`${apiBase}/v1/workspace/snapshot?company_id=${encodeURIComponent(companyID)}`);
    if (!response.ok) return;
    const payload = (await response.json()) as WorkspaceSnapshot;
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

function ensureStream(apiBase: string, companyID: string): void {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  if (entry.source) return;
  const source = new EventSource(`${apiBase}/v1/workspace/stream?company_id=${encodeURIComponent(companyID)}`);
  source.addEventListener("workspace", () => {
    void refreshWorkspaceSnapshot(apiBase, companyID);
  });
  source.onerror = () => {
    // Browser will auto-retry EventSource; keep current source reference.
  };
  entry.source = source;
}

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

export function getWorkspaceSnapshot(apiBase: string, companyID: string): WorkspaceSnapshot {
  const key = `${apiBase}:${companyID}`;
  return getEntry(key).snapshot;
}
