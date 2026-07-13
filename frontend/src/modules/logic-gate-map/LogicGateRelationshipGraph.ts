import { foldCommittedEntityTitlesSince, readCommittedEntityTitleVersion, type CommittedEntityTitleUpdate } from "../realtime/committedEntityTitleUpdates.js";
import type {
  CompanyExplorerFolder,
  CompanyExplorerFolderItem,
} from "../folders/companyExplorerFolders.js";
import { reconcileCommittedLogicGateRecordTitles } from "../map/committedTitleSnapshotReconciliation.js";
import { fetchWorkspaceSnapshot } from "../workspace/workspaceSnapshotCache.js";
import {
  LogicGateRecord,
  LogicGateRelationship,
  NodeRecord,
  NodeRelationship,
  PersistedMapPosition,
  toLogicGateCanvasRecord,
  toLogicGateCanvasRelationship,
} from "./shared.js";

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
};
const EMPTY_SNAPSHOT: LogicGateRelationshipGraphSnapshot = { nodes: [], relationships: [] };
const logicGateRelationshipGraphCache = new Map<string, CacheEntry>();

function normalizeGraphFolderID(options: LogicGateRelationshipGraphScopeOptions = {}): string {
  return options.folderID?.trim() ?? "";
}

function graphCacheKey(apiBase: string, companyID: string, options: LogicGateRelationshipGraphScopeOptions = {}): string {
  return `${apiBase}:${companyID}:logic_gate_map:${encodeURIComponent(normalizeGraphFolderID(options))}`;
}

function getEntry(apiBase: string, companyID: string, options: LogicGateRelationshipGraphScopeOptions = {}): CacheEntry {
  const folderID = normalizeGraphFolderID(options);
  const key = graphCacheKey(apiBase, companyID, { folderID });
  const existing = logicGateRelationshipGraphCache.get(key);
  if (existing) return existing;
  const created: CacheEntry = { snapshot: EMPTY_SNAPSHOT, subscribers: new Set(), loading: false, hydrated: false };
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

export function reconcileLogicGateRelationshipGraphTitle(
  apiBase: string,
  companyID: string,
  update: CommittedEntityTitleUpdate,
): void {
  for (const entry of getCompanyEntries(apiBase, companyID)) {
    const currentLogicGates = entry.snapshot.logic_gates ?? [];
    const logicGates = reconcileCommittedLogicGateRecordTitles(currentLogicGates, update);
    if (logicGates === currentLogicGates) continue;
    entry.snapshot = {
      ...entry.snapshot,
      logic_gates: logicGates,
      nodes: logicGates.map(toLogicGateCanvasRecord),
    };
    notify(entry);
  }
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

export async function refreshLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string, options: LogicGateRelationshipGraphScopeOptions = {}): Promise<void> {
  const folderID = normalizeGraphFolderID(options);
  const entry = getEntry(apiBase, companyID, { folderID });
  if (entry.loading) return;
  const requestStartTitleVersion = readCommittedEntityTitleVersion();
  entry.loading = true;
  try {
    const result = await fetchWorkspaceSnapshot(apiBase, companyID, {
      scope: "logic_gate_map",
      folderID: folderID || undefined,
    });
    if (!result.payload) return;
    if (!result.changed && entry.hydrated && readCommittedEntityTitleVersion() === requestStartTitleVersion) {
      entry.hydrated = true;
      return;
    }
    const payload = result.payload as LogicGateRelationshipGraphSnapshot;
    const logicGates = foldCommittedEntityTitlesSince(
      payload.logic_gates ?? [],
      companyID,
      requestStartTitleVersion,
      reconcileCommittedLogicGateRecordTitles,
    );
    entry.snapshot = {
      nodes: logicGates.map(toLogicGateCanvasRecord),
      relationships: (payload.logic_gate_relationships ?? []).map(toLogicGateCanvasRelationship),
      logic_gates: logicGates,
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

export function subscribeLogicGateRelationshipGraph(apiBase: string, companyID: string, subscriber: Subscriber, options: LogicGateRelationshipGraphScopeOptions = {}): () => void {
  const folderID = normalizeGraphFolderID(options);
  const key = graphCacheKey(apiBase, companyID, { folderID });
  const entry = getEntry(apiBase, companyID, { folderID });
  entry.subscribers.add(subscriber);
  if (!entry.hydrated) {
    void refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID, { folderID });
  }
  return () => {
    const current = logicGateRelationshipGraphCache.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
  };
}

export function getLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string, options: LogicGateRelationshipGraphScopeOptions = {}): LogicGateRelationshipGraphSnapshot {
  return getEntry(apiBase, companyID, options).snapshot;
}

export function hasLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string, options: LogicGateRelationshipGraphScopeOptions = {}): boolean {
  return getEntry(apiBase, companyID, options).hydrated;
}
