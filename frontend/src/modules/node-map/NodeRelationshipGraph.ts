// Node relationship graph cache/sync plane for Node Map + Company Explorer.
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import { fetchWorkspaceSnapshot } from "../workspace/workspaceSnapshotCache";
import { subscribeWorkspaceStream, type WorkspaceStreamGapSignal } from "../workspace/workspaceStream";
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
type StreamEntry = {
  unsubscribeStream?: () => void;
  refreshAfterStreamReconnect?: boolean;
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
const nodeRelationshipGraphStreams = new Map<string, StreamEntry>();

// Cache entry resolver: creates per-company workspace cache bucket on demand.
function normalizeGraphFolderID(options: NodeRelationshipGraphScopeOptions = {}): string {
  return options.folderID?.trim() ?? "";
}

function graphCacheKey(apiBase: string, companyID: string, options: NodeRelationshipGraphScopeOptions = {}): string {
  return `${apiBase}:${companyID}:node_map:${encodeURIComponent(normalizeGraphFolderID(options))}`;
}

function graphStreamKey(apiBase: string, companyID: string): string {
  return `${apiBase}:${companyID}:node_map`;
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

// Some graph events are intentionally non-relationship mutations (e.g. node information writes).
// For those, refreshing the graph snapshot is unnecessary and adds avoidable hot-path GET load.
function isNonGraphWorkspaceEvent(eventType: string): boolean {
  return eventType === "node_information_created" || eventType.startsWith("logic_gate_") || eventType.startsWith("kanban_");
}

function gapTouchesNodeRelationshipGraph(gap: WorkspaceStreamGapSignal): boolean {
  return gap.scopes.some((scope) => (
    scope.kind === "node_graph" ||
    scope.kind === "work_item_assignment" ||
    scope.kind === "workspace" ||
    (scope.kind === "company_explorer" && (scope.folderKind === "node" || scope.itemType === "node"))
  ));
}

// Local mutation helper: lets hot-path UI actions apply immediate cache updates without
// forcing a full snapshot refetch. SSE + periodic snapshot refresh remain the source of truth.
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
function asNodeRecord(candidate: unknown): NodeRecord | null {
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Partial<NodeRecord>;
  if (typeof value.company_id !== "string" || typeof value.node_id !== "string" || typeof value.title !== "string") return null;
  return {
    company_id: value.company_id,
    node_id: value.node_id,
    title: value.title,
    status: typeof value.status === "string" || value.status === null ? value.status : undefined,
    due_date: typeof value.due_date === "string" || value.due_date === null ? value.due_date : undefined,
    priority: typeof value.priority === "number" || value.priority === null ? value.priority : undefined,
    assignee_user_id: typeof value.assignee_user_id === "string" || value.assignee_user_id === null ? value.assignee_user_id : undefined,
    logic_gate_ids: Array.isArray(value.logic_gate_ids) ? value.logic_gate_ids.filter((item): item is string => typeof item === "string") : undefined,
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
      ...previous,
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
      ...previous,
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
      ...previous,
      nodes: currentNodes.filter((item) => item.node_id !== nodeID),
      relationships: currentRelationships.filter((item) => item.node_id_a !== nodeID && item.node_id_b !== nodeID),
      folders: previous.folders ?? [],
      folder_items: (previous.folder_items ?? []).filter((item) => item.item_type !== "node" || item.item_id !== nodeID),
      node_map_positions: (previous.node_map_positions ?? []).filter((position) => (position.node_id || position.entity_id) !== nodeID),
      generated_at: envelope.ts,
    };
    return true;
  }

  if (envelope.type === "relationship_created") {
    const relationship = asRelationship(data.relationship);
    if (!relationship) return false;
    const exists = currentRelationships.some((item) => item.node_relationship_id === relationship.node_relationship_id);
    entry.snapshot = {
      ...previous,
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
      ...previous,
      nodes: currentNodes,
      relationships: currentRelationships.filter((item) => item.node_relationship_id !== relationshipID),
      folders: previous.folders ?? [],
      folder_items: previous.folder_items ?? [],
      generated_at: envelope.ts,
    };
    return true;
  }

  if (envelope.type === "company_explorer_folder_created" || envelope.type === "company_explorer_folder_moved" || envelope.type === "company_explorer_folder_updated") {
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

  if (envelope.type === "company_explorer_folder_deleted") {
    const folderID = typeof data.folder_id === "string" ? data.folder_id : "";
    const deletedFolderIDs = collectDeletedFolderIDs(previous.folders ?? [], folderID);
    if (deletedFolderIDs.size === 0 && folderID) deletedFolderIDs.add(folderID);
    if (deletedFolderIDs.size === 0) return false;
    entry.snapshot = {
      ...previous,
      folders: (previous.folders ?? []).filter((folder) => !deletedFolderIDs.has(folder.folder_id)),
      folder_items: (previous.folder_items ?? []).filter((item) => !deletedFolderIDs.has(item.folder_id)),
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

  if (envelope.type === "node_map_positions_updated") {
    const positions = Array.isArray(data.positions) ? data.positions : [];
    const nextByID = new Map((entry.snapshot.node_map_positions ?? []).map((position) => [position.node_id || position.entity_id || "", position]));
    for (const candidate of positions) {
      if (!candidate || typeof candidate !== "object") continue;
      const value = candidate as Partial<PersistedMapPosition>;
      const id = typeof value.node_id === "string" ? value.node_id : typeof value.entity_id === "string" ? value.entity_id : "";
      if (!id || typeof value.x !== "number" || typeof value.y !== "number") continue;
      nextByID.set(id, {
        entity_id: id,
        node_id: id,
        x: value.x,
        y: value.y,
        updated_timestamp: typeof value.updated_timestamp === "string" ? value.updated_timestamp : envelope.ts,
      });
    }
    entry.snapshot = {
      ...entry.snapshot,
      node_map_positions: Array.from(nextByID.values()).filter((position) => position.node_id || position.entity_id),
      generated_at: envelope.ts,
    };
    return true;
  }

  return false;
}

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

// SSE stream bootstrap: keeps modules synchronized in near real-time without polling loops.
function refreshSubscribedNodeRelationshipGraphSnapshots(apiBase: string, companyID: string): void {
  for (const entry of getCompanyEntries(apiBase, companyID)) {
    if (entry.subscribers.size > 0) void refreshNodeRelationshipGraphSnapshot(apiBase, companyID, { folderID: entry.folderID });
  }
}

function hasNodeRelationshipGraphSubscribers(apiBase: string, companyID: string): boolean {
  return getCompanyEntries(apiBase, companyID).some((entry) => entry.subscribers.size > 0);
}

function closeNodeRelationshipGraphStreamIfIdle(apiBase: string, companyID: string): void {
  if (hasNodeRelationshipGraphSubscribers(apiBase, companyID)) return;
  const key = graphStreamKey(apiBase, companyID);
  const stream = nodeRelationshipGraphStreams.get(key);
  stream?.unsubscribeStream?.();
  nodeRelationshipGraphStreams.delete(key);
}

// SSE stream bootstrap: keeps modules synchronized in near real-time without polling loops.
function ensureStream(apiBase: string, companyID: string): void {
  const key = graphStreamKey(apiBase, companyID);
  let stream = nodeRelationshipGraphStreams.get(key);
  if (!stream) {
    stream = {};
    nodeRelationshipGraphStreams.set(key, stream);
  }
  if (stream.unsubscribeStream) return;
  stream.unsubscribeStream = subscribeWorkspaceStream(apiBase, companyID, {
    onEvent(event) {
      if (event.event === "ready") {
        if (stream?.refreshAfterStreamReconnect) {
          stream.refreshAfterStreamReconnect = false;
          refreshSubscribedNodeRelationshipGraphSnapshots(apiBase, companyID);
        }
        return;
      }
      if (event.event !== "workspace") return;
      const payload = event.data;
      if (payload.length === 0) {
        refreshSubscribedNodeRelationshipGraphSnapshots(apiBase, companyID);
        return;
      }
      try {
        const envelope = JSON.parse(payload) as NodeRelationshipGraphStreamEnvelope;
        if (envelope.company_id !== companyID) return;
        if (isNonGraphWorkspaceEvent(envelope.type)) return;
        for (const entry of getCompanyEntries(apiBase, companyID)) {
          const applied = applyNodeRelationshipGraphDelta(entry, envelope);
          if (applied) notify(entry);
          else if (entry.subscribers.size > 0) void refreshNodeRelationshipGraphSnapshot(apiBase, companyID, { folderID: entry.folderID });
        }
      } catch {
        refreshSubscribedNodeRelationshipGraphSnapshots(apiBase, companyID);
      }
    },
    onGap(gap) {
      if (gap.companyID !== companyID || !gapTouchesNodeRelationshipGraph(gap)) return;
      refreshSubscribedNodeRelationshipGraphSnapshots(apiBase, companyID);
    },
    onError() {
      if (stream) stream.refreshAfterStreamReconnect = true;
    },
  });
}

// Public subscription API used by UI modules for workspace snapshot updates.
export function subscribeNodeRelationshipGraph(apiBase: string, companyID: string, subscriber: Subscriber, options: NodeRelationshipGraphScopeOptions = {}): () => void {
  const folderID = normalizeGraphFolderID(options);
  const key = graphCacheKey(apiBase, companyID, { folderID });
  const entry = getEntry(apiBase, companyID, { folderID });
  entry.subscribers.add(subscriber);
  if (!entry.hydrated) {
    void refreshNodeRelationshipGraphSnapshot(apiBase, companyID, { folderID });
  }
  ensureStream(apiBase, companyID);
  return () => {
    const current = nodeRelationshipGraphCache.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
    closeNodeRelationshipGraphStreamIfIdle(apiBase, companyID);
  };
}

// Synchronous snapshot getter for render paths that need latest cached workspace data.
export function getNodeRelationshipGraphSnapshot(apiBase: string, companyID: string, options: NodeRelationshipGraphScopeOptions = {}): NodeRelationshipGraphSnapshot {
  return getEntry(apiBase, companyID, options).snapshot;
}

export function hasNodeRelationshipGraphSnapshot(apiBase: string, companyID: string, options: NodeRelationshipGraphScopeOptions = {}): boolean {
  return getEntry(apiBase, companyID, options).hydrated;
}
