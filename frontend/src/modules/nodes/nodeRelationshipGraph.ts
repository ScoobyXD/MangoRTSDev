// Shared Node relationship cache used by editors, Home, Kanban, and Company Explorer.
import { foldCommittedEntityTitlesSince, readCommittedEntityTitleVersion, type CommittedEntityTitleUpdate } from "../realtime/committedEntityTitleUpdates.js";
import { reconcileCommittedNodeTitleInSnapshot } from "../realtime/committedTitleSnapshotReconciliation.js";
import { requestJSON } from "../api/requestJSON.js";
import type { NodeRecord, NodeRelationship } from "./types.js";

export type NodeRelationshipGraphSnapshot = {
  nodes: NodeRecord[];
  relationships: NodeRelationship[];
  generated_at?: string;
};

type Subscriber = () => void;
type CacheEntry = {
  snapshot: NodeRelationshipGraphSnapshot;
  subscribers: Set<Subscriber>;
  loading: boolean;
  hydrated: boolean;
};
// Initial cache snapshot so subscribers always receive a consistent shape.
const EMPTY_SNAPSHOT: NodeRelationshipGraphSnapshot = { nodes: [], relationships: [] };
const nodeRelationshipGraphCache = new Map<string, CacheEntry>();

// Cache entry resolver: creates one per-company relationship cache bucket on demand.
function graphCacheKey(apiBase: string, companyID: string): string {
  return `${apiBase}:${companyID}:node_relationships`;
}

function getEntry(apiBase: string, companyID: string): CacheEntry {
  const key = graphCacheKey(apiBase, companyID);
  const existing = nodeRelationshipGraphCache.get(key);
  if (existing) return existing;
  const created: CacheEntry = { snapshot: EMPTY_SNAPSHOT, subscribers: new Set(), loading: false, hydrated: false };
  nodeRelationshipGraphCache.set(key, created);
  return created;
}

function getCompanyEntries(apiBase: string, companyID: string): CacheEntry[] {
  const entry = nodeRelationshipGraphCache.get(graphCacheKey(apiBase, companyID));
  return entry ? [entry] : [];
}

function getMutationEntries(apiBase: string, companyID: string): CacheEntry[] {
  const entries = getCompanyEntries(apiBase, companyID);
  return entries.length > 0 ? entries : [getEntry(apiBase, companyID)];
}

// Fan-out notifier for relationship-cache subscribers.
function notify(entry: CacheEntry): void {
  for (const subscriber of entry.subscribers) subscriber();
}

// Local mutation helper: lets hot-path UI actions apply immediate cache updates without
// forcing a full snapshot refetch. Canonical snapshot reads remain the source of truth.
export function reconcileNodeRelationshipGraphTitle(
  apiBase: string,
  companyID: string,
  update: CommittedEntityTitleUpdate,
): void {
  for (const entry of getCompanyEntries(apiBase, companyID)) {
    const nodes = reconcileCommittedNodeTitleInSnapshot(entry.snapshot.nodes ?? [], update);
    if (nodes === entry.snapshot.nodes) continue;
    entry.snapshot = { ...entry.snapshot, nodes };
    notify(entry);
  }
}

export function upsertNodeRelationshipGraphNode(apiBase: string, companyID: string, node: NodeRecord): void {
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const currentNodes = entry.snapshot.nodes ?? [];
    const exists = currentNodes.some((item) => item.node_id === node.node_id);
    entry.snapshot = {
      ...entry.snapshot,
      nodes: exists ? currentNodes.map((item) => (item.node_id === node.node_id ? node : item)) : [...currentNodes, node],
      relationships: entry.snapshot.relationships ?? [],
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

export function upsertNodeRelationshipGraphRelationship(apiBase: string, companyID: string, relationship: NodeRelationship): void {
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const currentRelationships = entry.snapshot.relationships ?? [];
    const exists = currentRelationships.some((item) => item.node_relationship_id === relationship.node_relationship_id);
    entry.snapshot = {
      ...entry.snapshot,
      nodes: entry.snapshot.nodes ?? [],
      relationships: exists
        ? currentRelationships.map((item) => (item.node_relationship_id === relationship.node_relationship_id ? relationship : item))
        : [...currentRelationships, relationship],
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

// Local mutation helper for delete flows so successful node deletes converge immediately without
// forcing a full snapshot reload on hot paths.
export function removeNodeRelationshipGraphNode(apiBase: string, companyID: string, nodeID: string): void {
  if (!nodeID) return;
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const currentNodes = entry.snapshot.nodes ?? [];
    const currentRelationships = entry.snapshot.relationships ?? [];
    const nextNodes = currentNodes.filter((item) => item.node_id !== nodeID);
    const nextRelationships = currentRelationships.filter((item) => item.node_id_a !== nodeID && item.node_id_b !== nodeID);
    if (nextNodes.length === currentNodes.length && nextRelationships.length === currentRelationships.length) continue;
    entry.snapshot = {
      ...entry.snapshot,
      nodes: nextNodes,
      relationships: nextRelationships,
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

// Canonical company-scoped Node and relationship refresh.
export async function refreshNodeRelationshipGraphSnapshot(apiBase: string, companyID: string): Promise<void> {
  const entry = getEntry(apiBase, companyID);
  if (entry.loading) return;
  const requestStartTitleVersion = readCommittedEntityTitleVersion();
  entry.loading = true;
  try {
    const query = new URLSearchParams({ company_id: companyID });
    const [nodesPayload, relationshipsPayload] = await Promise.all([
      requestJSON<{ nodes?: NodeRecord[] }>(apiBase, `/v1/nodes?${query.toString()}`),
      requestJSON<{ relationships?: NodeRelationship[] }>(apiBase, `/v1/node-relationships?${query.toString()}`),
    ]);
    const nodes = foldCommittedEntityTitlesSince(
      nodesPayload.nodes ?? [],
      companyID,
      requestStartTitleVersion,
      reconcileCommittedNodeTitleInSnapshot,
    );
    entry.snapshot = {
      nodes,
      relationships: relationshipsPayload.relationships ?? [],
      generated_at: new Date().toISOString(),
    };
    entry.hydrated = true;
    notify(entry);
  } finally {
    entry.loading = false;
  }
}

// Public subscription API used by mounted UI modules for canonical snapshot updates.
export function subscribeNodeRelationshipGraph(apiBase: string, companyID: string, subscriber: Subscriber): () => void {
  const key = graphCacheKey(apiBase, companyID);
  const entry = getEntry(apiBase, companyID);
  entry.subscribers.add(subscriber);
  if (!entry.hydrated) {
    void refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
  }
  return () => {
    const current = nodeRelationshipGraphCache.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
  };
}

// Synchronous snapshot getter for render paths that need latest cached workspace data.
export function getNodeRelationshipGraphSnapshot(apiBase: string, companyID: string): NodeRelationshipGraphSnapshot {
  return getEntry(apiBase, companyID).snapshot;
}

export function hasNodeRelationshipGraphSnapshot(apiBase: string, companyID: string): boolean {
  return getEntry(apiBase, companyID).hydrated;
}
