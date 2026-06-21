export const MY_WORK_DEBUG_STORAGE_KEY = "mangorts.debug.myWork";
export const MY_WORK_DEBUG_URL_PARAM = "debug_my_work";
export const HOME_VIEW_STORAGE_PREFIX = "mangorts.app.home-view.v1";

export type MyWorkDebugTreeStats = {
  topLevel: number;
  total: number;
  maxDepth: number;
  projects: number;
  logicGates: number;
  nodes: number;
};

export type MyWorkDebugGroupStats = {
  topLevel: number;
  total: number;
  maxDepth: number;
};

export type MyWorkDebugCacheSummary = {
  cacheKey: string;
  hit: string;
  loading: boolean;
  stale: boolean;
  hasValue: boolean;
  ageMs: number | null;
  cellCount: number;
  failureCount: number;
  targetUserCount: number;
  targetUserIDs: string[];
};

export type MyWorkDebugCellTiming = {
  priority: string | number;
  role: string;
  rows: number;
  totalRows: number;
  groups: number;
  filterMs: number;
  sortMs: number;
  groupMs: number;
  totalMs: number;
};

export type MyWorkDebugTimings = {
  matrixFetchCacheLoadMs?: number;
  rowsFromMatrixMs?: number;
  topLevelGroupingMs?: number;
  groupingSignatureMs?: number;
  defaultExpansionMs?: number;
  matrixRenderCommitMs?: number;
  perCellFilterMs?: number;
  perCellSortMs?: number;
  perCellGroupingMs?: number;
};

export type MyWorkDebugMatrixRender = {
  renderID: number;
  rows: number;
  totalRows: number;
  expandedGroupCount: number;
  groupings: string[];
  nonEmptyCells: number;
  cellRows: number;
  cellTotalRows: number;
  slowestCells: MyWorkDebugCellTiming[];
};

export type MyWorkDebugRecentCause = {
  at: string;
  cause: string;
  detail?: Record<string, unknown>;
};

export type MyWorkDebugEvent = {
  at: string;
  label: string;
  payload: Record<string, unknown>;
};

export type MyWorkPerformanceDebugSnapshot = {
  enabled: boolean;
  updatedAt: string;
  debugFlag: string;
  activeHomeView?: string;
  companyID?: string;
  currentUserID?: string;
  selectedScope?: unknown;
  selectedScopeLabel?: string;
  targetUserCount?: number;
  targetUserIDs?: string[];
  cache?: MyWorkDebugCacheSummary;
  matrixPayloadStats?: MyWorkDebugTreeStats;
  rowStats?: MyWorkDebugTreeStats;
  topLevelGroupStats?: MyWorkDebugGroupStats;
  timings?: MyWorkDebugTimings;
  matrixRender?: MyWorkDebugMatrixRender;
  recentRefreshCauses: MyWorkDebugRecentCause[];
  lastEvent?: MyWorkDebugEvent;
};

export type MyWorkBrowserDebugContext = {
  route: {
    pathname: string;
    search: string;
    hash: string;
    href: string;
  };
  homeViewStorage: Array<{ key: string; value: string }>;
  memory: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  } | null;
};

type MyWorkDebugWindow = Window & {
  __MANGO_MY_WORK_DEBUG?: boolean;
  __MANGO_MY_WORK_LAST_STATS?: MyWorkDebugEvent;
};

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
    jsHeapSizeLimit?: number;
  };
};

type MyWorkDebugPatch = Partial<Omit<MyWorkPerformanceDebugSnapshot, "enabled" | "updatedAt" | "debugFlag" | "recentRefreshCauses">> & {
  timings?: MyWorkDebugTimings;
};

const DEBUG_ENABLED = resolveMyWorkDebugEnabled();
const listeners = new Set<() => void>();
let currentSnapshot: MyWorkPerformanceDebugSnapshot = {
  enabled: DEBUG_ENABLED,
  updatedAt: new Date().toISOString(),
  debugFlag: MY_WORK_DEBUG_STORAGE_KEY,
  recentRefreshCauses: [],
};

export function myWorkDebugEnabled(): boolean {
  return DEBUG_ENABLED;
}

export function myWorkDebugTimestampMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function myWorkDebugDurationMs(startMs: number): number {
  return Math.round((myWorkDebugTimestampMs() - startMs) * 10) / 10;
}

export function myWorkDebugLog(label: string, payload: Record<string, unknown> = {}): void {
  if (!DEBUG_ENABLED) return;
  const event: MyWorkDebugEvent = {
    label,
    payload,
    at: new Date().toISOString(),
  };
  const win = myWorkDebugWindow();
  if (win) win.__MANGO_MY_WORK_LAST_STATS = event;
  currentSnapshot = {
    ...currentSnapshot,
    updatedAt: event.at,
    lastEvent: event,
  };
  notifyMyWorkDebugListeners();
  console.debug("%c[MyWork] " + label, "color:#3b6df6;font-weight:700", { at: event.at, ...payload });
}

export function publishMyWorkDebugSnapshot(patch: MyWorkDebugPatch): void {
  if (!DEBUG_ENABLED) return;
  currentSnapshot = {
    ...currentSnapshot,
    ...patch,
    timings: patch.timings ? { ...currentSnapshot.timings, ...patch.timings } : currentSnapshot.timings,
    updatedAt: new Date().toISOString(),
  };
  notifyMyWorkDebugListeners();
}

export function recordMyWorkDebugCause(cause: string, detail?: Record<string, unknown>): void {
  if (!DEBUG_ENABLED) return;
  const cleanCause = cause.trim() || "unknown";
  const entry: MyWorkDebugRecentCause = {
    at: new Date().toISOString(),
    cause: cleanCause,
    detail,
  };
  currentSnapshot = {
    ...currentSnapshot,
    updatedAt: entry.at,
    recentRefreshCauses: [entry, ...currentSnapshot.recentRefreshCauses].slice(0, 12),
  };
  notifyMyWorkDebugListeners();
}

export function getMyWorkDebugSnapshot(): MyWorkPerformanceDebugSnapshot {
  return currentSnapshot;
}

export function subscribeMyWorkDebugSnapshot(listener: () => void): () => void {
  if (!DEBUG_ENABLED) return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function readMyWorkBrowserDebugContext(): MyWorkBrowserDebugContext {
  const win = myWorkDebugWindow();
  if (!win) {
    return {
      route: { pathname: "", search: "", hash: "", href: "" },
      homeViewStorage: [],
      memory: null,
    };
  }
  const homeViewStorage: Array<{ key: string; value: string }> = [];
  try {
    for (let index = 0; index < win.localStorage.length; index += 1) {
      const key = win.localStorage.key(index) ?? "";
      if (!key.startsWith(HOME_VIEW_STORAGE_PREFIX)) continue;
      homeViewStorage.push({ key, value: win.localStorage.getItem(key) ?? "" });
    }
    homeViewStorage.sort((left, right) => left.key.localeCompare(right.key));
  } catch {}

  const perf = typeof performance !== "undefined" ? performance as PerformanceWithMemory : null;
  const memory = perf?.memory ? {
    usedJSHeapSize: Number(perf.memory.usedJSHeapSize ?? 0),
    totalJSHeapSize: Number(perf.memory.totalJSHeapSize ?? 0),
    jsHeapSizeLimit: Number(perf.memory.jsHeapSizeLimit ?? 0),
  } : null;

  return {
    route: {
      pathname: win.location.pathname,
      search: win.location.search,
      hash: win.location.hash,
      href: win.location.href,
    },
    homeViewStorage,
    memory,
  };
}

export function clearRestoredHomeViewStorage(): number {
  const win = myWorkDebugWindow();
  if (!win) return 0;
  const keys: string[] = [];
  try {
    for (let index = 0; index < win.localStorage.length; index += 1) {
      const key = win.localStorage.key(index) ?? "";
      if (key.startsWith(HOME_VIEW_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) win.localStorage.removeItem(key);
  } catch {
    return 0;
  }
  return keys.length;
}

export function disableMyWorkDebugAndReload(): void {
  const win = myWorkDebugWindow();
  if (!win) return;
  try { win.localStorage.removeItem(MY_WORK_DEBUG_STORAGE_KEY); } catch {}
  try {
    const url = new URL(win.location.href);
    if (url.searchParams.has(MY_WORK_DEBUG_URL_PARAM)) {
      url.searchParams.delete(MY_WORK_DEBUG_URL_PARAM);
      win.location.replace(url.toString());
      return;
    }
  } catch {}
  win.location.reload();
}

function resolveMyWorkDebugEnabled(): boolean {
  const win = myWorkDebugWindow();
  if (!win) return false;
  if (win.__MANGO_MY_WORK_DEBUG === true) return true;
  try {
    const params = new URLSearchParams(win.location.search);
    const urlValue = params.get(MY_WORK_DEBUG_URL_PARAM)?.trim().toLowerCase();
    if (urlValue === "1" || urlValue === "true" || urlValue === "yes") return true;
  } catch {}
  try {
    const stored = win.localStorage.getItem(MY_WORK_DEBUG_STORAGE_KEY)?.trim().toLowerCase();
    return stored === "1" || stored === "true" || stored === "yes";
  } catch {
    return false;
  }
}

function myWorkDebugWindow(): MyWorkDebugWindow | null {
  return typeof window === "undefined" ? null : window as MyWorkDebugWindow;
}

function notifyMyWorkDebugListeners(): void {
  for (const listener of listeners) listener();
}