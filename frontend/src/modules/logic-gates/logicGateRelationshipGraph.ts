import { foldCommittedEntityTitlesSince, readCommittedEntityTitleVersion, type CommittedEntityTitleUpdate } from "../realtime/committedEntityTitleUpdates.js";
import { requestJSON } from "../api/requestJSON.js";
import { reconcileCommittedLogicGateRecordTitles } from "../realtime/committedTitleSnapshotReconciliation.js";
import {
  LogicGateRecord,
  LogicGateRelationship,
  LogicGateViewRecord,
  LogicGateViewRelationship,
  toLogicGateViewRecord,
  toLogicGateViewRelationship,
} from "./types.js";

export type LogicGateRelationshipGraphSnapshot = {
  nodes: LogicGateViewRecord[];
  relationships: LogicGateViewRelationship[];
  logic_gates?: LogicGateRecord[];
  logic_gate_relationships?: LogicGateRelationship[];
  generated_at?: string;
};

type Subscriber = () => void;
type CacheEntry = {
  snapshot: LogicGateRelationshipGraphSnapshot;
  subscribers: Set<Subscriber>;
  loading: boolean;
  hydrated: boolean;
};
const EMPTY_SNAPSHOT: LogicGateRelationshipGraphSnapshot = { nodes: [], relationships: [] };
const logicGateRelationshipGraphCache = new Map<string, CacheEntry>();

function graphCacheKey(apiBase: string, companyID: string): string {
  return `${apiBase}:${companyID}:logic_gate_relationships`;
}

function getEntry(apiBase: string, companyID: string): CacheEntry {
  const key = graphCacheKey(apiBase, companyID);
  const existing = logicGateRelationshipGraphCache.get(key);
  if (existing) return existing;
  const created: CacheEntry = { snapshot: EMPTY_SNAPSHOT, subscribers: new Set(), loading: false, hydrated: false };
  logicGateRelationshipGraphCache.set(key, created);
  return created;
}

function getCompanyEntries(apiBase: string, companyID: string): CacheEntry[] {
  const entry = logicGateRelationshipGraphCache.get(graphCacheKey(apiBase, companyID));
  return entry ? [entry] : [];
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
      nodes: logicGates.map(toLogicGateViewRecord),
    };
    notify(entry);
  }
}

export function upsertLogicGateRelationshipGraphNode(apiBase: string, companyID: string, logicGate: LogicGateViewRecord): void {
  const generatedAt = new Date().toISOString();
  for (const entry of getMutationEntries(apiBase, companyID)) {
    const currentNodes = entry.snapshot.nodes ?? [];
    const exists = currentNodes.some((item) => item.node_id === logicGate.node_id);
    entry.snapshot = {
      ...entry.snapshot,
      nodes: exists ? currentNodes.map((item) => (item.node_id === logicGate.node_id ? logicGate : item)) : [...currentNodes, logicGate],
      relationships: entry.snapshot.relationships ?? [],
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
      generated_at: generatedAt,
    };
    notify(entry);
  }
}

export async function refreshLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string): Promise<void> {
  const entry = getEntry(apiBase, companyID);
  if (entry.loading) return;
  const requestStartTitleVersion = readCommittedEntityTitleVersion();
  entry.loading = true;
  try {
    const query = new URLSearchParams({ company_id: companyID });
    const [logicGatePayload, relationshipsPayload] = await Promise.all([
      requestJSON<{ logic_gates?: LogicGateRecord[] }>(apiBase, `/v1/logic-gates?${query.toString()}`),
      requestJSON<{ logic_gate_relationships?: LogicGateRelationship[] }>(apiBase, `/v1/logic-gate-relationships?${query.toString()}`),
    ]);
    const logicGates = foldCommittedEntityTitlesSince(
      logicGatePayload.logic_gates ?? [],
      companyID,
      requestStartTitleVersion,
      reconcileCommittedLogicGateRecordTitles,
    );
    entry.snapshot = {
      nodes: logicGates.map(toLogicGateViewRecord),
      relationships: (relationshipsPayload.logic_gate_relationships ?? []).map(toLogicGateViewRelationship),
      logic_gates: logicGates,
      logic_gate_relationships: relationshipsPayload.logic_gate_relationships ?? [],
      generated_at: new Date().toISOString(),
    };
    entry.hydrated = true;
    notify(entry);
  } finally {
    entry.loading = false;
  }
}

export function subscribeLogicGateRelationshipGraph(apiBase: string, companyID: string, subscriber: Subscriber): () => void {
  const key = graphCacheKey(apiBase, companyID);
  const entry = getEntry(apiBase, companyID);
  entry.subscribers.add(subscriber);
  if (!entry.hydrated) {
    void refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID);
  }
  return () => {
    const current = logicGateRelationshipGraphCache.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
  };
}

export function getLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string): LogicGateRelationshipGraphSnapshot {
  return getEntry(apiBase, companyID).snapshot;
}

export function hasLogicGateRelationshipGraphSnapshot(apiBase: string, companyID: string): boolean {
  return getEntry(apiBase, companyID).hydrated;
}
