import type {
  CompanyExplorerFolder,
  CompanyExplorerFolderItem,
} from "../folders/companyExplorerFolders";
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
type CacheEntry = {
  snapshot: LogicGateRelationshipGraphSnapshot;
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

const EMPTY_SNAPSHOT: LogicGateRelationshipGraphSnapshot = { nodes: [], relationships: [] };
const logicGateRelationshipGraphCache = new Map<string, CacheEntry>();

function getEntry(key: string): CacheEntry {
  const existing = logicGateRelationshipGraphCache.get(key);
  if (existing) return existing;
  const created: CacheEntry = { snapshot: EMPTY_SNAPSHOT, subscribers: new Set(), loading: false };
  logicGateRelationshipGraphCache.set(key, created);
  return created;
}

function notify(entry: CacheEntry): void {
  for (const subscriber of entry.subscribers) subscriber();
}

function isNonLogicGateGraphWorkspaceEvent(eventType: string): boolean {
  return eventType === "logic_gate_information_created";
}

export function upsertLogicGateRelationshipGraphNode(apiBase: string, companyID: string, logicGate: NodeRecord): void {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  const currentNodes = entry.snapshot.nodes ?? [];
  const exists = currentNodes.some((item) => item.node_id === logicGate.node_id);
  entry.snapshot = {
    nodes: exists ? currentNodes.map((item) => (item.node_id === logicGate.node_id ? logicGate : item)) : [...currentNodes, logicGate],
    relationships: entry.snapshot.relationships ?? [],
    folders: entry.snapshot.folders ?? [],
    folder_items: entry.snapshot.folder_items ?? [],
    generated_at: new Date().toISOString(),
  };
  notify(entry);
}

export function removeLogicGateRelationshipGraphNode(apiBase: string, companyID: string, logicGateID: string): void {
  if (!logicGateID) return;
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  const currentNodes = entry.snapshot.nodes ?? [];
  const currentRelationships = entry.snapshot.relationships ?? [];
  const nextNodes = currentNodes.filter((item) => item.node_id !== logicGateID);
  const nextRelationships = currentRelationships.filter((item) => item.node_id_a !== logicGateID && item.node_id_b !== logicGateID);
  if (nextNodes.length === currentNodes.length && nextRelationships.length === currentRelationships.length) return;
  entry.snapshot = {
    nodes: nextNodes,
    relationships: nextRelationships,
    folders: entry.snapshot.folders ?? [],
    folder_items: (entry.snapshot.folder_items ?? []).filter((item) => item.item_type !== "logic_gate" || item.item_id !== logicGateID),
    generated_at: new Date().toISOString(),
  };
  notify(entry);
}

export function upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase: string, companyID: string, item: CompanyExplorerFolderItem): void {
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

export function upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase: string, companyID: string, folder: CompanyExplorerFolder): void {
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

export function removeCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase: string, companyID: string, folderID: string): void {
  if (!folderID) return;
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  const folders = entry.snapshot.folders ?? [];
  const deletedFolderIDs = collectDeletedFolderIDs(folders, folderID);
  if (deletedFolderIDs.size === 0) return;
  entry.snapshot = {
    ...entry.snapshot,
    folders: folders.filter((folder) => !deletedFolderIDs.has(folder.folder_id)),
    folder_items: (entry.snapshot.folder_items ?? []).filter((item) => !deletedFolderIDs.has(item.folder_id)),
    generated_at: new Date().toISOString(),
  };
  notify(entry);
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
  const currentNodes = entry.snapshot.nodes ?? [];
  const currentRelationships = entry.snapshot.relationships ?? [];
  const data = envelope.data ?? {};

  if (envelope.type === "logic_gate_created") {
    const logicGate = asLogicGateRecord(data.logic_gate);
    if (!logicGate) return false;
    const exists = currentNodes.some((item) => item.node_id === logicGate.node_id);
    entry.snapshot = {
      nodes: exists ? currentNodes.map((item) => (item.node_id === logicGate.node_id ? logicGate : item)) : [...currentNodes, logicGate],
      relationships: currentRelationships,
      folders: entry.snapshot.folders ?? [],
      folder_items: entry.snapshot.folder_items ?? [],
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
      nodes: currentNodes.map((item) => (item.node_id === logicGate.node_id ? logicGate : item)),
      relationships: currentRelationships,
      folders: entry.snapshot.folders ?? [],
      folder_items: entry.snapshot.folder_items ?? [],
      generated_at: envelope.ts,
    };
    return true;
  }
  if (envelope.type === "logic_gate_deleted") {
    const logicGateID = typeof data.logic_gate_id === "string" ? data.logic_gate_id : "";
    if (!logicGateID) return false;
    entry.snapshot = {
      nodes: currentNodes.filter((item) => item.node_id !== logicGateID),
      relationships: currentRelationships.filter((item) => item.node_id_a !== logicGateID && item.node_id_b !== logicGateID),
      folders: entry.snapshot.folders ?? [],
      folder_items: (entry.snapshot.folder_items ?? []).filter((item) => item.item_type !== "logic_gate" || item.item_id !== logicGateID),
      generated_at: envelope.ts,
    };
    return true;
  }
  if (envelope.type === "logic_gate_relationship_created") {
    const relationship = asLogicGateRelationship(data.logic_gate_relationship);
    if (!relationship) return false;
    const exists = currentRelationships.some((item) => item.node_relationship_id === relationship.node_relationship_id);
    entry.snapshot = {
      nodes: currentNodes,
      relationships: exists
        ? currentRelationships.map((item) => (item.node_relationship_id === relationship.node_relationship_id ? relationship : item))
        : [...currentRelationships, relationship],
      folders: entry.snapshot.folders ?? [],
      folder_items: entry.snapshot.folder_items ?? [],
      generated_at: envelope.ts,
    };
    return true;
  }
  if (envelope.type === "logic_gate_relationship_deleted") {
    const relationshipID = typeof data.logic_gate_relationship_id === "string" ? data.logic_gate_relationship_id : "";
    if (!relationshipID) return false;
    entry.snapshot = {
      nodes: currentNodes,
      relationships: currentRelationships.filter((item) => item.node_relationship_id !== relationshipID),
      folders: entry.snapshot.folders ?? [],
      folder_items: entry.snapshot.folder_items ?? [],
      generated_at: envelope.ts,
    };
    return true;
  }
  if (envelope.type === "company_explorer_folder_created" || envelope.type === "company_explorer_folder_moved") {
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

export async function refreshLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string): Promise<void> {
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
    const payload = (await response.json()) as LogicGateRelationshipGraphSnapshot;
    const nextEtag = response.headers.get("ETag");
    if (nextEtag && entry.etag === nextEtag) return;
    if (nextEtag) entry.etag = nextEtag;
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
  source.addEventListener("workspace", (event) => {
    const payload = (event as MessageEvent).data;
    if (typeof payload !== "string" || payload.length === 0) {
      void refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID);
      return;
    }
    try {
      const envelope = JSON.parse(payload) as WorkspaceStreamEnvelope;
      if (envelope.company_id !== companyID) return;
      if (isNonLogicGateGraphWorkspaceEvent(envelope.type)) return;
      if (!envelope.type.startsWith("logic_gate_") && !envelope.type.startsWith("company_explorer_folder_")) return;
      const applied = applyLogicGateRelationshipGraphDelta(entry, envelope);
      if (applied) notify(entry);
      else void refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID);
    } catch {
      void refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID);
    }
  });
  source.onerror = () => {
    // Browser EventSource reconnects by itself; keep this source reference stable.
  };
  entry.source = source;
}

export function subscribeLogicGateRelationshipGraph(apiBase: string, companyID: string, subscriber: Subscriber): () => void {
  const key = `${apiBase}:${companyID}`;
  const entry = getEntry(key);
  entry.subscribers.add(subscriber);
  if (entry.snapshot.nodes.length === 0 && entry.snapshot.relationships.length === 0) {
    void refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID);
  }
  ensureStream(apiBase, companyID);
  return () => {
    const current = logicGateRelationshipGraphCache.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
  };
}

export function getLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string): LogicGateRelationshipGraphSnapshot {
  const key = `${apiBase}:${companyID}`;
  return getEntry(key).snapshot;
}
