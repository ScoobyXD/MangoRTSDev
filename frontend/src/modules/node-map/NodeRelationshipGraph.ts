// Node relationship graph cache/sync plane for Node Map + Company Explorer.
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import { fetchWorkspaceSnapshot } from "../workspace/workspaceSnapshotCache";
import { NodeRecord, NodeRelationship, PersistedMapPosition } from "./shared";

export type NodeRelationshipGraphSnapshot = {
  nodes: NodeRecord[];
  relationships: NodeRelationship[];
  folders?: CompanyExplorerFolder[];
  folder_items?: CompanyExplorerFolderItem[];
  node_map_positions?: PersistedMapPosition[];
  generated_at?: string;
};

type Subscriber = () => void;
type NodeRelationshipGraphScopeOptions = {
  folderID?: string;
};
type CacheEntry = {
  snapshot: NodeRelationshipGraphSnapshot;
  subscribers: Set<Subscriber>;
  loading: boolean;
  hydrated: boolean;
  folderID: string;
};
// Initial cache snapshot so subscribers always receive a consistent shape.
const EMPTY_SNAPSHOT: NodeRelationshipGraphSnapshot = { nodes: [], relationships: [] };
const nodeRelationshipGraphCache = new Map<string, CacheEntry>();

// Cache entry resolver: creates per-company workspace cache bucket on demand.
function normalizeGraphFolderID(options: NodeRelationshipGraphScopeOptions = {}): string {
  return options.folderID?.trim() ?? "";
}

function graphCacheKey(apiBase: string, companyID: string, options: NodeRelationshipGraphScopeOptions = {}): string {
  return `${apiBase}:${companyID}:node_map:${encodeURIComponent(normalizeGraphFolderID(options))}`;
}

function getEntry(apiBase: string, companyID: string, options: NodeRelationshipGraphScopeOptions = {}): CacheEntry {
  const folderID = normalizeGraphFolderID(options);
  const key = graphCacheKey(apiBase, companyID, { folderID });
  const existing = nodeRelationshipGraphCache.get(key);
  if (existing) return existing;
  const created: CacheEntry = { snapshot: EMPTY_SNAPSHOT, subscribers: new Set(), loading: false, hydrated: false, folderID };
  nodeRelationshipGraphCache.set(key, created);
  return created;
}

function getCompanyEntries(apiBase: string, companyID: string): CacheEntry[] {
  const prefix = `${apiBase}:${companyID}:node_map:`;
  return Array.from(nodeRelationshipGraphCache.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([, entry]) => entry);
}

function getMutationEntries(apiBase: string, companyID: string): CacheEntry[] {
  const entries = getCompanyEntries(apiBase, companyID);
  return entries.length > 0 ? entries : [getEntry(apiBase, companyID)];
}

// Fan-out notifier for Company Explorer / Node Map subscribers.
function notify(entry: CacheEntry): void {
  for (const subscriber of entry.subscribers) subscriber();
}

export function invalidateNodeRelationshipGraphSnapshot(apiBase: string, companyID: string): void {
  for (const entry of getCompanyEntries(apiBase, companyID)) {
    entry.hydrated = false;
    if (entry.subscribers.size > 0) void refreshNodeRelationshipGraphSnapshot(apiBase, companyID, { folderID: entry.folderID });
  }
}

// Local mutation helper: lets hot-path UI actions apply immediate cache updates without
// forcing a full snapshot refetch. Canonical snapshot reads remain the source of truth.
export function upsertNodeRelationshipGraphNode(apiBase: string, companyID: string, node: NodeRecord): void {
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const currentNodes = entry.snapshot.nodes ?? [];
    const exists = currentNodes.some((item) => item.node_id === node.node_id);
    entry.snapshot = {
      ...entry.snapshot,
      nodes: exists ? currentNodes.map((item) => (item.node_id === node.node_id ? node : item)) : [...currentNodes, node],
      relationships: entry.snapshot.relationships ?? [],
      folders: entry.snapshot.folders ?? [],
      folder_items: entry.snapshot.folder_items ?? [],
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
      folders: entry.snapshot.folders ?? [],
      folder_items: entry.snapshot.folder_items ?? [],
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
    const nextFolderItems = (entry.snapshot.folder_items ?? []).filter((item) => item.item_type !== "node" || item.item_id !== nodeID);
    if (nextNodes.length === currentNodes.length && nextRelationships.length === currentRelationships.length) continue;
    entry.snapshot = {
      ...entry.snapshot,
      nodes: nextNodes,
      relationships: nextRelationships,
      folders: entry.snapshot.folders ?? [],
      folder_items: nextFolderItems,
      node_map_positions: (entry.snapshot.node_map_positions ?? []).filter((position) => (position.node_id || position.entity_id) !== nodeID),
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

export function removeNodeRelationshipGraphRelationshipsForNode(apiBase: string, companyID: string, nodeID: string): void {
  if (!nodeID) return;
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const currentRelationships = entry.snapshot.relationships ?? [];
    const nextRelationships = currentRelationships.filter((item) => item.node_id_a !== nodeID && item.node_id_b !== nodeID);
    if (nextRelationships.length === currentRelationships.length) continue;
    entry.snapshot = {
      ...entry.snapshot,
      relationships: nextRelationships,
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

export function upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase: string, companyID: string, item: CompanyExplorerFolderItem): void {
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const current = entry.snapshot.folder_items ?? [];
    const exists = current.some((row) => row.item_type === item.item_type && row.item_id === item.item_id);
    entry.snapshot = {
      ...entry.snapshot,
      folder_items: exists
        ? current.map((row) => (row.item_type === item.item_type && row.item_id === item.item_id ? item : row))
        : [...current, item],
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

export function upsertNodeMapPositionsInNodeRelationshipGraph(apiBase: string, companyID: string, positions: PersistedMapPosition[]): void {
  if (positions.length === 0) return;
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const nextByID = new Map((entry.snapshot.node_map_positions ?? []).map((position) => [position.node_id || position.entity_id || "", position]));
    for (const position of positions) {
      const id = position.node_id || position.entity_id || "";
      if (!id || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
      nextByID.set(id, {
        entity_id: id,
        node_id: id,
        x: position.x,
        y: position.y,
        updated_timestamp: position.updated_timestamp ?? generatedAt,
      });
    }
    entry.snapshot = {
      ...entry.snapshot,
      node_map_positions: Array.from(nextByID.values()).filter((position) => position.node_id || position.entity_id),
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

export function upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase: string, companyID: string, folder: CompanyExplorerFolder): void {
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const current = entry.snapshot.folders ?? [];
    const exists = current.some((row) => row.folder_id === folder.folder_id);
    entry.snapshot = {
      ...entry.snapshot,
      folders: exists ? current.map((row) => (row.folder_id === folder.folder_id ? folder : row)) : [...current, folder],
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

export function removeCompanyExplorerFolderInNodeRelationshipGraph(apiBase: string, companyID: string, folderID: string): void {
  if (!folderID) return;
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const folders = entry.snapshot.folders ?? [];
    const deletedFolderIDs = collectDeletedFolderIDs(folders, folderID);
    if (deletedFolderIDs.size === 0) continue;
    entry.snapshot = {
      ...entry.snapshot,
      folders: folders.filter((folder) => !deletedFolderIDs.has(folder.folder_id)),
      folder_items: (entry.snapshot.folder_items ?? []).filter((item) => !deletedFolderIDs.has(item.folder_id)),
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

function collectDeletedFolderIDs(folders: CompanyExplorerFolder[], rootFolderID: string): Set<string> {
  const deleted = new Set<string>();
  if (!rootFolderID || !folders.some((folder) => folder.folder_id === rootFolderID)) return deleted;
  deleted.add(rootFolderID);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (!folder.parent_folder_id || !deleted.has(folder.parent_folder_id) || deleted.has(folder.folder_id)) continue;
      deleted.add(folder.folder_id);
      changed = true;
    }
  }
  return deleted;
}

// Runtime payload guard for SSE delta events -> NodeRecord contract.
// Snapshot fetcher with ETag support; keeps hot-path reads light and cache-friendly.
export async function refreshNodeRelationshipGraphSnapshot(apiBase: string, companyID: string, options: NodeRelationshipGraphScopeOptions = {}): Promise<void> {
  const folderID = normalizeGraphFolderID(options);
  const entry = getEntry(apiBase, companyID, { folderID });
  if (entry.loading) return;
  entry.loading = true;
  try {
    const result = await fetchWorkspaceSnapshot(apiBase, companyID, {
      scope: "node_map",
      folderID: folderID || undefined,
    });
    if (!result.payload) return;
    if (!result.changed && entry.hydrated) {
      entry.hydrated = true;
      return;
    }
    const payload = result.payload as NodeRelationshipGraphSnapshot;
    entry.snapshot = {
      nodes: payload.nodes ?? [],
      relationships: payload.relationships ?? [],
      folders: payload.folders ?? [],
      folder_items: payload.folder_items ?? [],
      node_map_positions: payload.node_map_positions ?? [],
      generated_at: payload.generated_at,
    };
    entry.hydrated = true;
    notify(entry);
  } finally {
    entry.loading = false;
  }
}

// Public subscription API used by mounted UI modules for canonical snapshot updates.
export function subscribeNodeRelationshipGraph(apiBase: string, companyID: string, subscriber: Subscriber, options: NodeRelationshipGraphScopeOptions = {}): () => void {
  const folderID = normalizeGraphFolderID(options);
  const key = graphCacheKey(apiBase, companyID, { folderID });
  const entry = getEntry(apiBase, companyID, { folderID });
  entry.subscribers.add(subscriber);
  if (!entry.hydrated) {
    void refreshNodeRelationshipGraphSnapshot(apiBase, companyID, { folderID });
  }
  return () => {
    const current = nodeRelationshipGraphCache.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
  };
}

// Synchronous snapshot getter for render paths that need latest cached workspace data.
export function getNodeRelationshipGraphSnapshot(apiBase: string, companyID: string, options: NodeRelationshipGraphScopeOptions = {}): NodeRelationshipGraphSnapshot {
  return getEntry(apiBase, companyID, options).snapshot;
}

export function hasNodeRelationshipGraphSnapshot(apiBase: string, companyID: string, options: NodeRelationshipGraphScopeOptions = {}): boolean {
  return getEntry(apiBase, companyID, options).hydrated;
}
