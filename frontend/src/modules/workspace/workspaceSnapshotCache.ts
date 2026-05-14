export type WorkspaceSnapshotPayload = {
  nodes?: unknown[];
  relationships?: unknown[];
  logic_gates?: unknown[];
  logic_gate_relationships?: unknown[];
  folders?: unknown[];
  folder_items?: unknown[];
  node_map_positions?: unknown[];
  logic_gate_map_positions?: unknown[];
  kanban_boards?: unknown[];
  generated_at?: string;
};

export type WorkspaceSnapshotResult = {
  payload: WorkspaceSnapshotPayload | null;
  changed: boolean;
};

type WorkspaceSnapshotEntry = {
  payload: WorkspaceSnapshotPayload | null;
  etag?: string;
  fetchedAt?: number;
  inflight?: Promise<WorkspaceSnapshotResult>;
};

type FetchWorkspaceSnapshotOptions = {
  force?: boolean;
  maxAgeMs?: number;
};

const workspaceSnapshots = new Map<string, WorkspaceSnapshotEntry>();

function key(apiBase: string, companyID: string): string {
  return `${apiBase}:${companyID}`;
}

function getEntry(apiBase: string, companyID: string): WorkspaceSnapshotEntry {
  const cacheKey = key(apiBase, companyID);
  const existing = workspaceSnapshots.get(cacheKey);
  if (existing) return existing;
  const created: WorkspaceSnapshotEntry = { payload: null };
  workspaceSnapshots.set(cacheKey, created);
  return created;
}

export function getCachedWorkspaceSnapshot(apiBase: string, companyID: string): WorkspaceSnapshotPayload | null {
  return getEntry(apiBase, companyID).payload;
}

export function invalidateWorkspaceSnapshot(apiBase?: string, companyID?: string): void {
  const cleanApiBase = apiBase?.trim() ?? "";
  const cleanCompanyID = companyID?.trim() ?? "";
  if (cleanApiBase && cleanCompanyID) {
    workspaceSnapshots.delete(key(cleanApiBase, cleanCompanyID));
    return;
  }
  workspaceSnapshots.clear();
}

export async function fetchWorkspaceSnapshot(apiBase: string, companyID: string, options: FetchWorkspaceSnapshotOptions = {}): Promise<WorkspaceSnapshotResult> {
  const entry = getEntry(apiBase, companyID);
  const maxAgeMs = Math.max(0, options.maxAgeMs ?? 0);
  if (!options.force && maxAgeMs > 0 && entry.payload && entry.fetchedAt && Date.now() - entry.fetchedAt <= maxAgeMs) {
    return { payload: entry.payload, changed: false };
  }
  if (entry.inflight) return entry.inflight;

  entry.inflight = fetch(`${apiBase}/v1/workspace/snapshot?company_id=${encodeURIComponent(companyID)}`, {
    cache: "no-store",
    headers: entry.etag ? { "If-None-Match": entry.etag } : undefined,
  }).then(async (response): Promise<WorkspaceSnapshotResult> => {
    if (response.status === 304) {
      entry.fetchedAt = Date.now();
      return { payload: entry.payload, changed: false };
    }
    if (!response.ok) return { payload: entry.payload, changed: false };
    const payload = (await response.json()) as WorkspaceSnapshotPayload;
    const nextEtag = response.headers.get("ETag") ?? undefined;
    const changed = !nextEtag || entry.etag !== nextEtag;
    entry.payload = payload;
    entry.fetchedAt = Date.now();
    if (nextEtag) entry.etag = nextEtag;
    return { payload, changed };
  }).catch((error) => {
    if (entry.payload) return { payload: entry.payload, changed: false };
    throw error;
  }).finally(() => {
    entry.inflight = undefined;
  });

  return entry.inflight;
}
