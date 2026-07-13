import type { MyWorkMatrixResponse, MyWorkMatrixRow } from "../../modules/work-items/workItemReadApi.js";
import type { MyWorkSelectedScope } from "./myWorkGrouping.js";
import { foldCommittedEntityTitlesSince, readCommittedEntityTitleVersion, type CommittedEntityTitleUpdate } from "../../modules/realtime/committedEntityTitleUpdates.js";
import {
  myWorkDebugDurationMs,
  myWorkDebugEnabled,
  myWorkDebugLog,
  myWorkDebugTimestampMs,
  publishMyWorkDebugSnapshot,
  recordMyWorkDebugCause,
  type MyWorkDebugCacheSummary,
} from "./myWorkPerformanceDebug.js";

export { MY_WORK_DEBUG_STORAGE_KEY, myWorkDebugDurationMs, myWorkDebugEnabled, myWorkDebugLog, myWorkDebugTimestampMs } from "./myWorkPerformanceDebug.js";

export type MyWorkMatrixCellWithUser = MyWorkMatrixRow & { companyID: string; userID: string };

export type MyWorkMatrixLoadFailure = {
  userID: string;
  message: string;
};

type MyWorkMatrixLoadResult = {
  cells: MyWorkMatrixCellWithUser[];
  failures: MyWorkMatrixLoadFailure[];
};

type MyWorkMatrixPatch = {
  companyID: string;
  rows: MyWorkMatrixRow[];
  removedProjectionRowIDs: string[];
  targetUserIDs?: string[];
  titleVersionAtStart: number;
};


type MyWorkMatrixFetcher = (targetUserID: string) => Promise<MyWorkMatrixResponse>;

type MyWorkMatrixCacheState = MyWorkMatrixLoadResult & {
  companyID: string;
  targetUserIDs: string[];
  loading: boolean;
  stale: boolean;
  hasValue: boolean;
  fetchedAt: number;
  promise?: Promise<MyWorkMatrixLoadResult>;
};

const MY_WORK_MATRIX_CACHE_TTL_MS = 30_000;
const MY_WORK_MATRIX_CACHE_MAX_ENTRIES = 30;
const myWorkMatrixCache = new Map<string, MyWorkMatrixCacheState>();

export async function loadMyWorkMatrixCellsForUsers({
  companyID,
  targetUserIDs,
  fetchMatrix,
}: {
  companyID: string;
  targetUserIDs: string[];
  fetchMatrix: MyWorkMatrixFetcher;
}): Promise<MyWorkMatrixLoadResult> {
  const cleanCompanyID = companyID.trim();
  const cleanTargetUserIDs = uniqueNonEmptyStrings(targetUserIDs);
  if (!cleanCompanyID || cleanTargetUserIDs.length === 0) return { cells: [], failures: [] };

  const results = await Promise.all(cleanTargetUserIDs.map(async (targetUserID) => {
    try {
      const payload = await fetchMatrix(targetUserID);
      return {
        ok: true as const,
        cells: (payload.rows ?? []).map((cell) => ({
          ...cell,
          companyID: payload.company_id?.trim() || cleanCompanyID,
          userID: payload.user_id?.trim() || targetUserID,
        })),
      };
    } catch (error) {
      return {
        ok: false as const,
        failure: {
          userID: targetUserID,
          message: error instanceof Error && error.message.trim() ? error.message.trim() : "Failed to load My Work",
        },
      };
    }
  }));

  const cells: MyWorkMatrixCellWithUser[] = [];
  const failures: MyWorkMatrixLoadFailure[] = [];
  for (const result of results) {
    if (result.ok) cells.push(...result.cells);
    else failures.push(result.failure);
  }
  return { cells, failures };
}

export function uniqueMyWorkTargetUserIDs(values: string[]): string[] {
  return uniqueNonEmptyStrings(values);
}

export function readMyWorkMatrixCache(cacheKey: string): MyWorkMatrixCacheState | null {
  const entry = myWorkMatrixCache.get(cacheKey.trim());
  return entry ? cloneMyWorkMatrixCacheState(entry) : null;
}

export function readMyWorkMatrixCacheSummary(cacheKey: string, hit = "unknown"): MyWorkDebugCacheSummary {
  const cleanCacheKey = cacheKey.trim();
  return summarizeMyWorkMatrixCache(cleanCacheKey, cleanCacheKey ? myWorkMatrixCache.get(cleanCacheKey) : undefined, hit);
}

export function patchMyWorkMatrixCells(cells: MyWorkMatrixCellWithUser[], patch: MyWorkMatrixPatch): MyWorkMatrixCellWithUser[] {
  const cleanCompanyID = patch.companyID.trim();
  const targetUsers = new Set(uniqueNonEmptyStrings(patch.targetUserIDs ?? []));
  const removedIDs = new Set(uniqueNonEmptyStrings(patch.removedProjectionRowIDs));
  const byProjectionID = new Map<string, MyWorkMatrixCellWithUser>();
  const passthrough: MyWorkMatrixCellWithUser[] = [];
  for (const cell of cells) {
    const projectionRowID = cell.projection_row_id?.trim() ?? "";
    if (projectionRowID && removedIDs.has(projectionRowID)) continue;
    if (projectionRowID) byProjectionID.set(projectionRowID, cell);
    else passthrough.push(cell);
  }
  for (const row of patch.rows ?? []) {
    const userID = row.user_id?.trim() ?? "";
    if (!userID || (targetUsers.size > 0 && !targetUsers.has(userID))) continue;
    const projectionRowID = row.projection_row_id?.trim() ?? "";
    if (!projectionRowID) continue;
    byProjectionID.set(projectionRowID, {
      ...row,
      companyID: row.company_id?.trim() || cleanCompanyID,
      userID,
    });
  }
  const next = [...passthrough, ...byProjectionID.values()];
  next.sort(sortMyWorkMatrixCells);
  return foldCommittedEntityTitlesSince(
    next,
    cleanCompanyID,
    patch.titleVersionAtStart,
    patchMyWorkMatrixCellsForCommittedTitle,
  );
}

export function patchMyWorkMatrixCacheEntry(cacheKey: string, patch: MyWorkMatrixPatch): void {
  const cleanCacheKey = cacheKey.trim();
  if (!cleanCacheKey) return;
  const entry = myWorkMatrixCache.get(cleanCacheKey);
  if (!entry?.hasValue) return;
  const next: MyWorkMatrixCacheState = {
    ...entry,
    cells: patchMyWorkMatrixCells(entry.cells, { ...patch, targetUserIDs: patch.targetUserIDs ?? entry.targetUserIDs }),
    stale: false,
    fetchedAt: Date.now(),
    promise: undefined,
  };
  myWorkMatrixCache.set(cleanCacheKey, next);
  publishMyWorkMatrixCacheSummary(cleanCacheKey, next, "patched", next.targetUserIDs);
  myWorkDebugLog("cache.patch", {
    cacheKey: cleanCacheKey,
    rows: patch.rows.length,
    removedProjectionRowIDs: patch.removedProjectionRowIDs.length,
    cells: next.cells.length,
  });
}

export function patchMyWorkMatrixCellsForCommittedTitle(
  cells: MyWorkMatrixCellWithUser[],
  patch: CommittedEntityTitleUpdate,
): MyWorkMatrixCellWithUser[] {
  const companyID = patch.companyID.trim();
  const resourceID = patch.resourceID.trim();
  const title = patch.title.trim();
  if (!companyID || !resourceID || !title) return cells;
  let changed = false;
  const next = cells.map((cell) => {
    const cellCompanyID = cell.companyID?.trim() || cell.company_id?.trim() || "";
    if (cellCompanyID && cellCompanyID !== companyID) return cell;
    if (patch.entityType === "node") {
      if (cell.node_id?.trim() !== resourceID || cell.node_name === title) return cell;
      changed = true;
      return { ...cell, node_name: title };
    }
    if (cell.logic_gate_id?.trim() !== resourceID || cell.logic_gate_name === title) return cell;
    changed = true;
    return { ...cell, logic_gate_name: title };
  });
  return changed ? next : cells;
}

export function patchMyWorkMatrixCachesForCommittedTitle(patch: CommittedEntityTitleUpdate): void {
  const companyID = patch.companyID.trim();
  if (!companyID) return;
  for (const [cacheKey, entry] of myWorkMatrixCache.entries()) {
    if (entry.companyID !== companyID) continue;
    const cells = patchMyWorkMatrixCellsForCommittedTitle(entry.cells, patch);
    if (cells === entry.cells) continue;
    const next = { ...entry, cells };
    myWorkMatrixCache.set(cacheKey, next);
    publishMyWorkMatrixCacheSummary(cacheKey, next, "title-patched", next.targetUserIDs);
  }
}
export function resetMyWorkMatrixLoaderForTests(): void {
  myWorkMatrixCache.clear();
}

export function markMyWorkMatrixCacheStale(cacheKey: string): void {
  const cleanCacheKey = cacheKey.trim();
  if (!cleanCacheKey) return;
  const entry = myWorkMatrixCache.get(cleanCacheKey);
  if (entry) {
    const next = { ...entry, stale: true };
    myWorkMatrixCache.set(cleanCacheKey, next);
    recordMyWorkDebugCause("cache stale", { cacheKey: cleanCacheKey, targetUserCount: next.targetUserIDs.length });
    publishMyWorkMatrixCacheSummary(cleanCacheKey, next, "stale");
    myWorkDebugLog("cache.markStale.exact", { cacheKey: cleanCacheKey, hadValue: entry.hasValue, targetUserIDs: entry.targetUserIDs });
  }
}

export function markMyWorkMatrixCachesStaleForCompany(companyID: string): void {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return;
  let matched = 0;
  for (const [cacheKey, entry] of myWorkMatrixCache.entries()) {
    if (entry.companyID !== cleanCompanyID) continue;
    matched += 1;
    const next = { ...entry, stale: true };
    myWorkMatrixCache.set(cacheKey, next);
    publishMyWorkMatrixCacheSummary(cacheKey, next, "stale");
  }
  recordMyWorkDebugCause("cache stale", { companyID: cleanCompanyID, matched });
  myWorkDebugLog("cache.markStale.company", { companyID: cleanCompanyID, matched });
}

export function markMyWorkMatrixCachesStaleForTargetUsers(targetUserIDs: string[]): void {
  const targets = new Set(uniqueNonEmptyStrings(targetUserIDs));
  if (targets.size === 0) return;
  let matched = 0;
  for (const [cacheKey, entry] of myWorkMatrixCache.entries()) {
    if (!entryAffectsTargetUsers(entry, targets)) continue;
    matched += 1;
    const next = { ...entry, stale: true };
    myWorkMatrixCache.set(cacheKey, next);
    publishMyWorkMatrixCacheSummary(cacheKey, next, "stale");
  }
  recordMyWorkDebugCause("cache stale", { targetUserIDs: Array.from(targets), matched });
  myWorkDebugLog("cache.markStale.targets", { targetUserIDs: Array.from(targets), matched });
}

export function loadMyWorkMatrixCacheEntry({
  cacheKey,
  companyID,
  targetUserIDs,
  fetchMatrix,
  force = false,
  now = Date.now(),
}: {
  cacheKey: string;
  companyID: string;
  targetUserIDs: string[];
  fetchMatrix: MyWorkMatrixFetcher;
  force?: boolean;
  now?: number;
}): Promise<MyWorkMatrixLoadResult> {
  const cleanCacheKey = cacheKey.trim();
  const cleanCompanyID = companyID.trim();
  const cleanTargetUserIDs = uniqueNonEmptyStrings(targetUserIDs);
  const current = cleanCacheKey ? myWorkMatrixCache.get(cleanCacheKey) : undefined;
  const debugEnabled = myWorkDebugEnabled();
  if (current?.promise) {
    recordMyWorkDebugCause("in-flight request joined", { cacheKey: cleanCacheKey, targetUserCount: cleanTargetUserIDs.length });
    publishMyWorkMatrixCacheSummary(cleanCacheKey, current, "in-flight request joined", cleanTargetUserIDs);
    myWorkDebugLog("cache.load.joinInFlight", { cacheKey: cleanCacheKey, targetUserIDs: cleanTargetUserIDs, hasValue: current.hasValue });
    return current.promise;
  }
  if (!force && current?.hasValue && !current.stale && now - current.fetchedAt < MY_WORK_MATRIX_CACHE_TTL_MS) {
    recordMyWorkDebugCause("cache fresh hit", { cacheKey: cleanCacheKey, ageMs: Math.round(now - current.fetchedAt) });
    publishMyWorkMatrixCacheSummary(cleanCacheKey, current, "fresh hit", cleanTargetUserIDs);
    myWorkDebugLog("cache.load.freshHit", {
      cacheKey: cleanCacheKey,
      targetUserIDs: cleanTargetUserIDs,
      ageMs: Math.round(now - current.fetchedAt),
      cells: current.cells.length,
      failures: current.failures.length,
    });
    return Promise.resolve({ cells: current.cells, failures: current.failures });
  }

  const startedAt = debugEnabled ? myWorkDebugTimestampMs() : 0;
  const loadCause = current?.hasValue && current.stale ? "cache stale" : "cache miss";
  recordMyWorkDebugCause(loadCause, { cacheKey: cleanCacheKey, targetUserCount: cleanTargetUserIDs.length, force });
  myWorkDebugLog("cache.load.start", {
    cacheKey: cleanCacheKey,
    targetUserIDs: cleanTargetUserIDs,
    targetUserCount: cleanTargetUserIDs.length,
    hadValue: current?.hasValue ?? false,
    stale: current?.stale ?? true,
    force,
  });
  const titleCommitVersionAtStart = readCommittedEntityTitleVersion();
  const promise = loadMyWorkMatrixCellsForUsers({
    companyID,
    targetUserIDs: cleanTargetUserIDs,
    fetchMatrix,
  }).then((result) => {
    const durationMs = debugEnabled ? myWorkDebugDurationMs(startedAt) : 0;
    const reconciledResult = {
      ...result,
      cells: foldCommittedEntityTitlesSince(
        result.cells,
        cleanCompanyID,
        titleCommitVersionAtStart,
        patchMyWorkMatrixCellsForCommittedTitle,
      ),
    };
    if (cleanCacheKey) {
      myWorkMatrixCache.set(cleanCacheKey, {
        ...reconciledResult,
        companyID: cleanCompanyID,
        targetUserIDs: cleanTargetUserIDs,
        loading: false,
        stale: false,
        hasValue: true,
        fetchedAt: Date.now(),
      });
      pruneMyWorkMatrixCache();
      publishMyWorkMatrixCacheSummary(cleanCacheKey, myWorkMatrixCache.get(cleanCacheKey), "loaded", cleanTargetUserIDs);
    }
    if (debugEnabled) publishMyWorkDebugSnapshot({ timings: { matrixFetchCacheLoadMs: durationMs } });
    myWorkDebugLog("cache.load.done", {
      cacheKey: cleanCacheKey,
      durationMs,
      cells: reconciledResult.cells.length,
      failures: reconciledResult.failures.length,
      targetUserCount: cleanTargetUserIDs.length,
    });
    return reconciledResult;
  }).catch((error) => {
    const durationMs = debugEnabled ? myWorkDebugDurationMs(startedAt) : 0;
    if (cleanCacheKey) {
      const latest = myWorkMatrixCache.get(cleanCacheKey);
      if (latest) {
        const next = {
          ...latest,
          loading: false,
          stale: true,
          promise: undefined,
        };
        myWorkMatrixCache.set(cleanCacheKey, next);
        publishMyWorkMatrixCacheSummary(cleanCacheKey, next, "error", cleanTargetUserIDs);
      }
    }
    myWorkDebugLog("cache.load.error", {
      cacheKey: cleanCacheKey,
      durationMs,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  });

  if (cleanCacheKey) {
    const fallback = current ?? { cells: [], failures: [], companyID: cleanCompanyID, targetUserIDs: cleanTargetUserIDs, fetchedAt: 0, stale: true, hasValue: false, loading: false };
    const next = {
      ...fallback,
      companyID: cleanCompanyID,
      targetUserIDs: cleanTargetUserIDs,
      loading: true,
      stale: force ? true : fallback.stale,
      promise,
    };
    myWorkMatrixCache.set(cleanCacheKey, next);
    publishMyWorkMatrixCacheSummary(cleanCacheKey, next, loadCause, cleanTargetUserIDs);
  }
  return promise;
}

export function myWorkMatrixCacheKey({
  companyID,
  selectedScope,
  targetUserIDs,
}: {
  companyID: string;
  selectedScope: MyWorkSelectedScope;
  targetUserIDs: string[];
}): string {
  const cleanCompanyID = companyID.trim() || "company";
  const level = selectedScope.level.trim() || "scope";
  const subjectType = selectedScope.subject_type.trim() || "subject";
  const subjectID = selectedScope.subject_id.trim() || "subject";
  const targets = uniqueNonEmptyStrings(targetUserIDs).join(",");
  return "my_work:" + cleanCompanyID + ":" + level + ":" + subjectType + ":" + subjectID + ":targets:" + targets;
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function cloneMyWorkMatrixCacheState(entry: MyWorkMatrixCacheState): MyWorkMatrixCacheState {
  return {
    ...entry,
    cells: entry.cells,
    failures: entry.failures,
  };
}

function publishMyWorkMatrixCacheSummary(cacheKey: string, entry: MyWorkMatrixCacheState | undefined, hit: string, targetUserIDs: string[] = []): void {
  if (!myWorkDebugEnabled()) return;
  publishMyWorkDebugSnapshot({ cache: summarizeMyWorkMatrixCache(cacheKey, entry, hit, targetUserIDs) });
}

function summarizeMyWorkMatrixCache(cacheKey: string, entry: MyWorkMatrixCacheState | undefined, hit: string, targetUserIDs: string[] = []): MyWorkDebugCacheSummary {
  const cleanTargets = uniqueNonEmptyStrings(targetUserIDs);
  const entryTargets = entry?.targetUserIDs ?? cleanTargets;
  return {
    cacheKey,
    hit,
    loading: entry?.loading ?? false,
    stale: entry?.stale ?? true,
    hasValue: entry?.hasValue ?? false,
    ageMs: entry?.fetchedAt ? Math.max(0, Math.round(Date.now() - entry.fetchedAt)) : null,
    cellCount: entry?.cells.length ?? 0,
    failureCount: entry?.failures.length ?? 0,
    targetUserCount: entryTargets.length,
    targetUserIDs: entryTargets,
  };
}

function entryAffectsTargetUsers(entry: MyWorkMatrixCacheState, targetUsers: Set<string>): boolean {
  if (entry.targetUserIDs.some((userID) => targetUsers.has(userID.trim()))) return true;
  if (entry.cells.some((cell) => targetUsers.has(cell.userID.trim()))) return true;
  return entry.failures.some((failure) => targetUsers.has(failure.userID.trim()));
}

function pruneMyWorkMatrixCache(): void {
  if (myWorkMatrixCache.size <= MY_WORK_MATRIX_CACHE_MAX_ENTRIES) return;
  const entries = Array.from(myWorkMatrixCache.entries())
    .sort((left, right) => left[1].fetchedAt - right[1].fetchedAt);
  for (const [cacheKey, entry] of entries) {
    if (myWorkMatrixCache.size <= MY_WORK_MATRIX_CACHE_MAX_ENTRIES) return;
    if (entry.loading) continue;
    myWorkMatrixCache.delete(cacheKey);
  }
}

function sortMyWorkMatrixCells(left: MyWorkMatrixCellWithUser, right: MyWorkMatrixCellWithUser): number {
  if (left.userID !== right.userID) return left.userID.localeCompare(right.userID);
  const leftRole = left.gvic_assignment?.trim() ?? "";
  const rightRole = right.gvic_assignment?.trim() ?? "";
  if (leftRole !== rightRole) return leftRole.localeCompare(rightRole);
  const leftPriority = Number.isFinite(Number(left.priority)) ? Number(left.priority) : 99;
  const rightPriority = Number.isFinite(Number(right.priority)) ? Number(right.priority) : 99;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const leftSort = Number.isFinite(Number(left.sort_order)) ? Number(left.sort_order) : 0;
  const rightSort = Number.isFinite(Number(right.sort_order)) ? Number(right.sort_order) : 0;
  if (leftSort !== rightSort) return leftSort - rightSort;
  return (left.projection_row_id ?? "").localeCompare(right.projection_row_id ?? "");
}
