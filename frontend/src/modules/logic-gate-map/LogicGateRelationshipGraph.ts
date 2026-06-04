import type {
  CompanyExplorerFolder,
  CompanyExplorerFolderItem,
} from "../folders/companyExplorerFolders";
import { fetchWorkspaceSnapshot } from "../workspace/workspaceSnapshotCache";
import { logicGateGraphRealtimeScope, subscribeWorkspaceUserRealtime, type WorkspaceStreamGapSignal } from "../workspace/workspaceRealtime";
import {
  LogicGateRecord,
  LogicGateRelationship,
  NodeRecord,
  NodeRelationship,
  PersistedMapPosition,
  toLogicGateCanvasRecord,
  toLogicGateCanvasRelationship,
} from "./shared";

export type LogicGateRelationshipGraphSnapshot = {
  nodes: NodeRecord[];
  relationships: NodeRelationship[];
  logic_gates?: LogicGateRecord[];
  logic_gate_relationships?: LogicGateRelationship[];
  folders?: CompanyExplorerFolder[];
  folder_items?: CompanyExplorerFolderItem[];
  logic_gate_map_positions?: PersistedMapPosition[];
  generated_at?: string;
};

type Subscriber = () => void;
type LogicGateRelationshipGraphScopeOptions = {
  folderID?: string;
};
type CacheEntry = {
  snapshot: LogicGateRelationshipGraphSnapshot;
  subscribers: Set<Subscriber>;
  loading: boolean;
  hydrated: boolean;
  folderID: string;
};
type StreamEntry = {
  unsubscribeStream?: () => void;
  refreshAfterStreamReconnect?: boolean;
};

type WorkspaceStreamEnvelope = {
  company_id: string;
  type: string;
  ts: string;
  data?: Record<string, unknown>;
};

const EMPTY_SNAPSHOT: LogicGateRelationshipGraphSnapshot = { nodes: [], relationships: [] };
const logicGateRelationshipGraphCache = new Map<string, CacheEntry>();
const logicGateRelationshipGraphStreams = new Map<string, StreamEntry>();

function normalizeGraphFolderID(options: LogicGateRelationshipGraphScopeOptions = {}): string {
  return options.folderID?.trim() ?? "";
}

function graphCacheKey(apiBase: string, companyID: string, options: LogicGateRelationshipGraphScopeOptions = {}): string {
  return `${apiBase}:${companyID}:logic_gate_map:${encodeURIComponent(normalizeGraphFolderID(options))}`;
}

function graphStreamKey(apiBase: string, companyID: string): string {
  return `${apiBase}:${companyID}:logic_gate_map`;
}

function getEntry(apiBase: string, companyID: string, options: LogicGateRelationshipGraphScopeOptions = {}): CacheEntry {
  const folderID = normalizeGraphFolderID(options);
  const key = graphCacheKey(apiBase, companyID, { folderID });
  const existing = logicGateRelationshipGraphCache.get(key);
  if (existing) return existing;
  const created: CacheEntry = { snapshot: EMPTY_SNAPSHOT, subscribers: new Set(), loading: false, hydrated: false, folderID };
  logicGateRelationshipGraphCache.set(key, created);
  return created;
}

function getCompanyEntries(apiBase: string, companyID: string): CacheEntry[] {
  const prefix = `${apiBase}:${companyID}:logic_gate_map:`;
  return Array.from(logicGateRelationshipGraphCache.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([, entry]) => entry);
}

function getMutationEntries(apiBase: string, companyID: string): CacheEntry[] {
  const entries = getCompanyEntries(apiBase, companyID);
  return entries.length > 0 ? entries : [getEntry(apiBase, companyID)];
}

function notify(entry: CacheEntry): void {
  for (const subscriber of entry.subscribers) subscriber();
}

export function invalidateLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string): void {
  for (const entry of getCompanyEntries(apiBase, companyID)) {
    entry.hydrated = false;
    if (entry.subscribers.size > 0) void refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID, { folderID: entry.folderID });
  }
}

function isNonLogicGateGraphWorkspaceEvent(eventType: string): boolean {
  return eventType === "logic_gate_information_created";
}

function gapTouchesLogicGateRelationshipGraph(gap: WorkspaceStreamGapSignal): boolean {
  return gap.scopes.some((scope) => (
    scope.kind === "logic_gate_graph" ||
    scope.kind === "workspace" ||
    (scope.kind === "company_explorer" && (scope.folderKind === "logic_gate" || scope.itemType === "logic_gate"))
  ));
}

export function upsertLogicGateRelationshipGraphNode(apiBase: string, companyID: string, logicGate: NodeRecord): void {
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const currentNodes = entry.snapshot.nodes ?? [];
    const exists = currentNodes.some((item) => item.node_id === logicGate.node_id);
    entry.snapshot = {
      ...entry.snapshot,
      nodes: exists ? currentNodes.map((item) => (item.node_id === logicGate.node_id ? logicGate : item)) : [...currentNodes, logicGate],
      relationships: entry.snapshot.relationships ?? [],
      folders: entry.snapshot.folders ?? [],
      folder_items: entry.snapshot.folder_items ?? [],
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

export function removeLogicGateRelationshipGraphNode(apiBase: string, companyID: string, logicGateID: string): void {
  if (!logicGateID) return;
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const currentNodes = entry.snapshot.nodes ?? [];
    const currentRelationships = entry.snapshot.relationships ?? [];
    const nextNodes = currentNodes.filter((item) => item.node_id !== logicGateID);
    const nextRelationships = currentRelationships.filter((item) => item.node_id_a !== logicGateID && item.node_id_b !== logicGateID);
    if (nextNodes.length === currentNodes.length && nextRelationships.length === currentRelationships.length) continue;
    entry.snapshot = {
      ...entry.snapshot,
      nodes: nextNodes,
      relationships: nextRelationships,
      folders: entry.snapshot.folders ?? [],
      folder_items: (entry.snapshot.folder_items ?? []).filter((item) => item.item_type !== "logic_gate" || item.item_id !== logicGateID),
      logic_gate_map_positions: (entry.snapshot.logic_gate_map_positions ?? []).filter((position) => (position.logic_gate_id || position.entity_id) !== logicGateID),
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

export function removeLogicGateRelationshipGraphRelationshipsForLogicGate(apiBase: string, companyID: string, logicGateID: string): void {
  if (!logicGateID) return;
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const currentRelationships = entry.snapshot.relationships ?? [];
    const nextRelationships = currentRelationships.filter((item) => item.node_id_a !== logicGateID && item.node_id_b !== logicGateID);
    if (nextRelationships.length === currentRelationships.length) continue;
    entry.snapshot = {
      ...entry.snapshot,
      relationships: nextRelationships,
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

export function upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase: string, companyID: string, item: CompanyExplorerFolderItem): void {
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

export function upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase: string, companyID: string, folder: CompanyExplorerFolder): void {
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

export function removeCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase: string, companyID: string, folderID: string): void {
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

function asLogicGateRecord(candidate: unknown): NodeRecord | null {
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Partial<LogicGateRecord>;
  if (typeof value.company_id !== "string" || typeof value.logic_gate_id !== "string" || typeof value.header !== "string") return null;
  return toLogicGateCanvasRecord({
    company_id: value.company_id,
    logic_gate_id: value.logic_gate_id,
    header: value.header,
    created_timestamp: typeof value.created_timestamp === "string" ? value.created_timestamp : new Date().toISOString(),
  });
}

function asLogicGateRelationship(candidate: unknown): NodeRelationship | null {
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Partial<LogicGateRelationship>;
  if (
    typeof value.company_id !== "string" ||
    typeof value.logic_gate_relationship_id !== "string" ||
    typeof value.logic_gate_id_a !== "string" ||
    typeof value.logic_gate_id_b !== "string" ||
    typeof value.a_position !== "string" ||
    typeof value.b_position !== "string"
  ) return null;
  return toLogicGateCanvasRelationship({
    company_id: value.company_id,
    logic_gate_relationship_id: value.logic_gate_relationship_id,
    logic_gate_id_a: value.logic_gate_id_a,
    logic_gate_id_b: value.logic_gate_id_b,
    a_position: value.a_position as LogicGateRelationship["a_position"],
    b_position: value.b_position as LogicGateRelationship["b_position"],
    created_timestamp: typeof value.created_timestamp === "string" ? value.created_timestamp : new Date().toISOString(),
  });
}

function applyLogicGateRelationshipGraphDelta(entry: CacheEntry, envelope: WorkspaceStreamEnvelope): boolean {
  const previous = entry.snapshot;
  const currentNodes = entry.snapshot.nodes ?? [];
  const currentRelationships = entry.snapshot.relationships ?? [];
  const data = envelope.data ?? {};

  if (envelope.type === "logic_gate_created") {
    const logicGate = asLogicGateRecord(data.logic_gate);
    if (!logicGate) return false;
    const exists = currentNodes.some((item) => item.node_id === logicGate.node_id);
    entry.snapshot = {
      ...previous,
      nodes: exists ? currentNodes.map((item) => (item.node_id === logicGate.node_id ? logicGate : item)) : [...currentNodes, logicGate],
      relationships: currentRelationships,
      folders: previous.folders ?? [],
      folder_items: previous.folder_items ?? [],
      generated_at: envelope.ts,
    };
    return true;
  }
  if (envelope.type === "logic_gate_updated") {
    const logicGate = asLogicGateRecord(data.logic_gate);
    if (!logicGate) return false;
    const exists = currentNodes.some((item) => item.node_id === logicGate.node_id);
    if (!exists) return false;
    entry.snapshot = {
      ...previous,
      nodes: currentNodes.map((item) => (item.node_id === logicGate.node_id ? logicGate : item)),
      relationships: currentRelationships,
      folders: previous.folders ?? [],
      folder_items: previous.folder_items ?? [],
      generated_at: envelope.ts,
    };
    return true;
  }
  if (envelope.type === "logic_gate_deleted") {
    const logicGateID = typeof data.logic_gate_id === "string" ? data.logic_gate_id : "";
    if (!logicGateID) return false;
    entry.snapshot = {
      ...previous,
      nodes: currentNodes.filter((item) => item.node_id !== logicGateID),
      relationships: currentRelationships.filter((item) => item.node_id_a !== logicGateID && item.node_id_b !== logicGateID),
      folders: previous.folders ?? [],
      folder_items: (previous.folder_items ?? []).filter((item) => item.item_type !== "logic_gate" || item.item_id !== logicGateID),
      logic_gate_map_positions: (previous.logic_gate_map_positions ?? []).filter((position) => (position.logic_gate_id || position.entity_id) !== logicGateID),
      generated_at: envelope.ts,
    };
    return true;
  }
  if (envelope.type === "logic_gate_relationship_created") {
    const relationship = asLogicGateRelationship(data.logic_gate_relationship);
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
  if (envelope.type === "logic_gate_relationship_deleted") {
    const relationshipID = typeof data.logic_gate_relationship_id === "string" ? data.logic_gate_relationship_id : "";
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
    const currentFolders = entry.snapshot.folders ?? [];
    entry.snapshot = {
      ...entry.snapshot,
      folders: currentFolders.some((item) => item.folder_id === folder.folder_id)
        ? currentFolders.map((item) => (item.folder_id === folder.folder_id ? folder : item))
        : [...currentFolders, folder],
      generated_at: envelope.ts,
    };
    return true;
  }
  if (envelope.type === "company_explorer_folder_deleted") {
    const folderID = typeof data.folder_id === "string" ? data.folder_id : "";
    const deletedFolderIDs = collectDeletedFolderIDs(entry.snapshot.folders ?? [], folderID);
    if (deletedFolderIDs.size === 0 && folderID) deletedFolderIDs.add(folderID);
    if (deletedFolderIDs.size === 0) return false;
    entry.snapshot = {
      ...entry.snapshot,
      folders: (entry.snapshot.folders ?? []).filter((folder) => !deletedFolderIDs.has(folder.folder_id)),
      folder_items: (entry.snapshot.folder_items ?? []).filter((item) => !deletedFolderIDs.has(item.folder_id)),
      generated_at: envelope.ts,
    };
    return true;
  }
  if (envelope.type === "company_explorer_folder_item_assigned") {
    const folderItem = data.folder_item as CompanyExplorerFolderItem | undefined;
    if (!folderItem || typeof folderItem.item_id !== "string" || typeof folderItem.item_type !== "string") return false;
    const currentItems = entry.snapshot.folder_items ?? [];
    entry.snapshot = {
      ...entry.snapshot,
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
      ...entry.snapshot,
      folder_items: (entry.snapshot.folder_items ?? []).filter((item) => item.item_type !== itemType || item.item_id !== itemID),
      generated_at: envelope.ts,
    };
    return true;
  }
  if (envelope.type === "logic_gate_map_positions_updated") {
    const positions = Array.isArray(data.positions) ? data.positions : [];
    const nextByID = new Map((entry.snapshot.logic_gate_map_positions ?? []).map((position) => [position.logic_gate_id || position.entity_id || "", position]));
    for (const candidate of positions) {
      if (!candidate || typeof candidate !== "object") continue;
      const value = candidate as Partial<PersistedMapPosition>;
      const id = typeof value.logic_gate_id === "string" ? value.logic_gate_id : typeof value.entity_id === "string" ? value.entity_id : "";
      if (!id || typeof value.x !== "number" || typeof value.y !== "number") continue;
      nextByID.set(id, {
        entity_id: id,
        logic_gate_id: id,
        x: value.x,
        y: value.y,
        updated_timestamp: typeof value.updated_timestamp === "string" ? value.updated_timestamp : envelope.ts,
      });
    }
    entry.snapshot = {
      ...entry.snapshot,
      logic_gate_map_positions: Array.from(nextByID.values()).filter((position) => position.logic_gate_id || position.entity_id),
      generated_at: envelope.ts,
    };
    return true;
  }
  return false;
}

export async function refreshLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string, options: LogicGateRelationshipGraphScopeOptions = {}): Promise<void> {
  const folderID = normalizeGraphFolderID(options);
  const entry = getEntry(apiBase, companyID, { folderID });
  if (entry.loading) return;
  entry.loading = true;
  try {
    const result = await fetchWorkspaceSnapshot(apiBase, companyID, {
      scope: "logic_gate_map",
      folderID: folderID || undefined,
    });
    if (!result.payload) return;
    if (!result.changed && entry.hydrated) {
      entry.hydrated = true;
      return;
    }
    const payload = result.payload as LogicGateRelationshipGraphSnapshot;
    entry.snapshot = {
      nodes: (payload.logic_gates ?? []).map(toLogicGateCanvasRecord),
      relationships: (payload.logic_gate_relationships ?? []).map(toLogicGateCanvasRelationship),
      logic_gates: payload.logic_gates ?? [],
      logic_gate_relationships: payload.logic_gate_relationships ?? [],
      folders: payload.folders ?? [],
      folder_items: payload.folder_items ?? [],
      logic_gate_map_positions: payload.logic_gate_map_positions ?? [],
      generated_at: payload.generated_at,
    };
    entry.hydrated = true;
    notify(entry);
  } finally {
    entry.loading = false;
  }
}

function refreshSubscribedLogicGateRelationshipGraphSnapshots(apiBase: string, companyID: string): void {
  for (const entry of getCompanyEntries(apiBase, companyID)) {
    if (entry.subscribers.size > 0) void refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID, { folderID: entry.folderID });
  }
}

function hasLogicGateRelationshipGraphSubscribers(apiBase: string, companyID: string): boolean {
  return getCompanyEntries(apiBase, companyID).some((entry) => entry.subscribers.size > 0);
}

function closeLogicGateRelationshipGraphStreamIfIdle(apiBase: string, companyID: string): void {
  if (hasLogicGateRelationshipGraphSubscribers(apiBase, companyID)) return;
  const key = graphStreamKey(apiBase, companyID);
  const stream = logicGateRelationshipGraphStreams.get(key);
  stream?.unsubscribeStream?.();
  logicGateRelationshipGraphStreams.delete(key);
}

function ensureStream(apiBase: string, companyID: string): void {
  const key = graphStreamKey(apiBase, companyID);
  let stream = logicGateRelationshipGraphStreams.get(key);
  if (!stream) {
    stream = {};
    logicGateRelationshipGraphStreams.set(key, stream);
  }
  if (stream.unsubscribeStream) return;
  stream.unsubscribeStream = subscribeWorkspaceUserRealtime(apiBase, companyID, logicGateGraphRealtimeScope, {
    onEvent(event, context) {
      if (context.replayBoundary) {
        if (stream?.refreshAfterStreamReconnect) {
          stream.refreshAfterStreamReconnect = false;
          refreshSubscribedLogicGateRelationshipGraphSnapshots(apiBase, companyID);
        }
        return;
      }
      if (event.event !== "workspace") return;
      const payload = event.data;
      if (payload.length === 0) {
        refreshSubscribedLogicGateRelationshipGraphSnapshots(apiBase, companyID);
        return;
      }
      try {
        const envelope = JSON.parse(payload) as WorkspaceStreamEnvelope;
        if (envelope.company_id !== companyID) return;
        if (isNonLogicGateGraphWorkspaceEvent(envelope.type)) return;
        if (!envelope.type.startsWith("logic_gate_") && !envelope.type.startsWith("company_explorer_folder_")) return;
        for (const entry of getCompanyEntries(apiBase, companyID)) {
          const applied = applyLogicGateRelationshipGraphDelta(entry, envelope);
          if (applied) notify(entry);
          else if (entry.subscribers.size > 0) void refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID, { folderID: entry.folderID });
        }
      } catch {
        refreshSubscribedLogicGateRelationshipGraphSnapshots(apiBase, companyID);
      }
    },
    onGap(gap) {
      if (gap.companyID !== companyID || !gapTouchesLogicGateRelationshipGraph(gap)) return;
      refreshSubscribedLogicGateRelationshipGraphSnapshots(apiBase, companyID);
    },
    onError() {
      if (stream) stream.refreshAfterStreamReconnect = true;
    },
  });
}

export function subscribeLogicGateRelationshipGraph(apiBase: string, companyID: string, subscriber: Subscriber, options: LogicGateRelationshipGraphScopeOptions = {}): () => void {
  const folderID = normalizeGraphFolderID(options);
  const key = graphCacheKey(apiBase, companyID, { folderID });
  const entry = getEntry(apiBase, companyID, { folderID });
  entry.subscribers.add(subscriber);
  if (!entry.hydrated) {
    void refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID, { folderID });
  }
  ensureStream(apiBase, companyID);
  return () => {
    const current = logicGateRelationshipGraphCache.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
    closeLogicGateRelationshipGraphStreamIfIdle(apiBase, companyID);
  };
}

export function getLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string, options: LogicGateRelationshipGraphScopeOptions = {}): LogicGateRelationshipGraphSnapshot {
  return getEntry(apiBase, companyID, options).snapshot;
}

export function hasLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string, options: LogicGateRelationshipGraphScopeOptions = {}): boolean {
  return getEntry(apiBase, companyID, options).hydrated;
}
