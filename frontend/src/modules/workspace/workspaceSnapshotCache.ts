export type WorkspaceSnapshotPayload = {
  scope?: string;
  company_id?: string;
  folder_id?: string;
  folder_kind?: string;
  board_id?: string;
  nodes?: unknown[];
  relationships?: unknown[];
  logic_gates?: unknown[];
  logic_gate_relationships?: unknown[];
  folders?: unknown[];
  folder_items?: unknown[];
  node_map_positions?: unknown[];
  logic_gate_map_positions?: unknown[];
  kanban_boards?: unknown[];
  columns?: unknown[];
  cards?: unknown[];
  cards_limit?: number;
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

export type WorkspaceSnapshotScope = "company_explorer" | "node_map" | "logic_gate_map" | "kanban" | "full";

type FetchWorkspaceSnapshotOptions = {
  force?: boolean;
  maxAgeMs?: number;
  scope?: WorkspaceSnapshotScope;
  folderID?: string;
  folderKind?: string;
  boardID?: string;
  columnID?: string;
  limit?: number;
  afterPosition?: number;
};

const DEFAULT_WORKSPACE_SNAPSHOT_SCOPE: WorkspaceSnapshotScope = "company_explorer";
const workspaceSnapshots = new Map<string, WorkspaceSnapshotEntry>();

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function snapshotQuery(companyID: string, options: FetchWorkspaceSnapshotOptions): URLSearchParams {
  const params = new URLSearchParams({ company_id: companyID, scope: options.scope ?? DEFAULT_WORKSPACE_SNAPSHOT_SCOPE });
  const folderID = clean(options.folderID);
  const folderKind = clean(options.folderKind);
  const boardID = clean(options.boardID);
  const columnID = clean(options.columnID);
  if (folderID) params.set("folder_id", folderID);
  if (folderKind) params.set("folder_kind", folderKind);
  if (boardID) params.set("board_id", boardID);
  if (columnID) params.set("column_id", columnID);
  if (typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0) params.set("limit", String(Math.floor(options.limit)));
  if (typeof options.afterPosition === "number" && Number.isFinite(options.afterPosition) && options.afterPosition > 0) params.set("after_position", String(Math.floor(options.afterPosition)));
  return params;
}

function key(apiBase: string, companyID: string, options: FetchWorkspaceSnapshotOptions = {}): string {
  return `${apiBase}:${companyID}:${snapshotQuery(companyID, options).toString()}`;
}

function getEntry(apiBase: string, companyID: string, options: FetchWorkspaceSnapshotOptions = {}): WorkspaceSnapshotEntry {
  const cacheKey = key(apiBase, companyID, options);
  const existing = workspaceSnapshots.get(cacheKey);
  if (existing) return existing;
  const created: WorkspaceSnapshotEntry = { payload: null };
  workspaceSnapshots.set(cacheKey, created);
  return created;
}

function deleteMatchingEntries(apiBase?: string, companyID?: string): void {
  const cleanApiBase = clean(apiBase);
  const cleanCompanyID = clean(companyID);
  if (!cleanApiBase && !cleanCompanyID) {
    workspaceSnapshots.clear();
    return;
  }
  const prefix = cleanApiBase && cleanCompanyID ? `${cleanApiBase}:${cleanCompanyID}:` : cleanApiBase ? `${cleanApiBase}:` : "";
  for (const cacheKey of Array.from(workspaceSnapshots.keys())) {
    if (!prefix || cacheKey.startsWith(prefix)) workspaceSnapshots.delete(cacheKey);
  }
}

export function getCachedWorkspaceSnapshot(apiBase: string, companyID: string, options: FetchWorkspaceSnapshotOptions = {}): WorkspaceSnapshotPayload | null {
  return getEntry(apiBase, companyID, options).payload;
}

export function invalidateWorkspaceSnapshot(apiBase?: string, companyID?: string): void {
  deleteMatchingEntries(apiBase, companyID);
}

export function markWorkspaceSnapshotStale(apiBase?: string, companyID?: string): void {
  const cleanApiBase = clean(apiBase);
  const cleanCompanyID = clean(companyID);
  if (!cleanApiBase && !cleanCompanyID) {
    for (const entry of workspaceSnapshots.values()) entry.fetchedAt = undefined;
    return;
  }
  const prefix = cleanApiBase && cleanCompanyID ? `${cleanApiBase}:${cleanCompanyID}:` : cleanApiBase ? `${cleanApiBase}:` : "";
  for (const [cacheKey, entry] of workspaceSnapshots.entries()) {
    if (!prefix || cacheKey.startsWith(prefix)) entry.fetchedAt = undefined;
  }
}

export function markWorkspaceSnapshotScopeStale(apiBase: string, companyID: string, options: FetchWorkspaceSnapshotOptions = {}): void {
  const prefix = `${clean(apiBase)}:${clean(companyID)}:`;
  const expectedScope = options.scope ?? DEFAULT_WORKSPACE_SNAPSHOT_SCOPE;
  const expectedFolderID = clean(options.folderID);
  const expectedFolderKind = clean(options.folderKind);
  const expectedBoardID = clean(options.boardID);
  for (const [cacheKey, entry] of workspaceSnapshots.entries()) {
    if (!cacheKey.startsWith(prefix)) continue;
    const params = new URLSearchParams(cacheKey.slice(prefix.length));
    if ((params.get("scope") ?? DEFAULT_WORKSPACE_SNAPSHOT_SCOPE) !== expectedScope) continue;
    if (expectedFolderID && (params.get("folder_id") ?? "") !== expectedFolderID) continue;
    if (expectedFolderKind && (params.get("folder_kind") ?? "") !== expectedFolderKind) continue;
    if (expectedBoardID && (params.get("board_id") ?? "") !== expectedBoardID) continue;
    entry.fetchedAt = undefined;
  }
}

export async function fetchWorkspaceSnapshot(apiBase: string, companyID: string, options: FetchWorkspaceSnapshotOptions = {}): Promise<WorkspaceSnapshotResult> {
  const query = snapshotQuery(companyID, options);
  const entry = getEntry(apiBase, companyID, options);
  const maxAgeMs = Math.max(0, options.maxAgeMs ?? 0);
  if (!options.force && maxAgeMs > 0 && entry.payload && entry.fetchedAt && Date.now() - entry.fetchedAt <= maxAgeMs) {
    return { payload: entry.payload, changed: false };
  }
  if (entry.inflight) return entry.inflight;

  entry.inflight = fetch(`${apiBase}/v1/workspace/snapshot?${query.toString()}`, {
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