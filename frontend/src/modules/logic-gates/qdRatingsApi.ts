import { realtimeEditorJSONScope, subscribeRealtimeScope } from "../realtime/realtimeWebSocket.js";

export const QD_BUSINESS_TIME_ZONE = "America/Los_Angeles";

export type QDRatingValue = "green" | "yellow" | "red";
export type QDRatingMetric = "quality" | "cost" | "delivery";

export type QDRating = {
  company_id: string;
  qd_rating_id: string;
  logic_gate_id: string;
  quality_rating: QDRatingValue | null;
  cost_rating: QDRatingValue | null;
  delivery_rating: QDRatingValue | null;
  rated_by_user_id: string | null;
  rated_by_display_name: string;
  rated_created_timestamp: string;
  rated_updated_timestamp: string;
};

export type QDRatingsRequestJSON = <T>(
  path: string,
  init?: RequestInit & { json?: unknown },
) => Promise<T>;

export type QDBusinessDate = {
  year: number;
  month: number;
  day: number;
  monthKey: string;
  dateKey: string;
};

export type QDRatingsSnapshot = {
  ratings: readonly QDRating[];
  loaded: boolean;
  loading: boolean;
  error: string;
};

type CacheEntry = {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  month: string;
  snapshot: QDRatingsSnapshot;
  listeners: Set<() => void>;
  loadPromise?: Promise<void>;
  version: number;
  refreshAfterLoad: boolean;
};

const EMPTY_SNAPSHOT: QDRatingsSnapshot = Object.freeze({
  ratings: Object.freeze([]) as readonly QDRating[],
  loaded: false,
  loading: false,
  error: "",
});

const businessDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: QD_BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const businessClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: QD_BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const cache = new Map<string, CacheEntry>();

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function cacheKey(apiBase: string, companyID: string, logicGateID: string, month: string): string {
  return `${apiBase.trim()}|${companyID.trim()}|${logicGateID.trim()}|${month.trim()}`;
}

function cacheEntry(apiBase: string, companyID: string, logicGateID: string, month: string): CacheEntry {
  const key = cacheKey(apiBase, companyID, logicGateID, month);
  const existing = cache.get(key);
  if (existing) return existing;
  const created: CacheEntry = {
    apiBase: apiBase.trim(),
    companyID: companyID.trim(),
    logicGateID: logicGateID.trim(),
    month: month.trim(),
    snapshot: EMPTY_SNAPSHOT,
    listeners: new Set(),
    version: 0,
    refreshAfterLoad: false,
  };
  cache.set(key, created);
  return created;
}

function publish(entry: CacheEntry, snapshot: QDRatingsSnapshot): void {
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) listener();
}

function messageFromError(cause: unknown): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : "Could not load QDC ratings";
}

function normalizedRating(value: QDRating): QDRating {
  return {
    ...value,
    quality_rating: value.quality_rating ?? null,
    cost_rating: value.cost_rating ?? null,
    delivery_rating: value.delivery_rating ?? null,
    rated_by_display_name: value.rated_by_display_name?.trim() ?? "",
  };
}

function sortRatings(values: readonly QDRating[]): QDRating[] {
  return [...values].map(normalizedRating).sort((left, right) => (
    left.rated_created_timestamp.localeCompare(right.rated_created_timestamp)
    || left.qd_rating_id.localeCompare(right.qd_rating_id)
  ));
}

function ratingDateKey(rating: QDRating): string {
  const instant = new Date(rating.rated_created_timestamp);
  return Number.isNaN(instant.getTime()) ? "" : getQDBusinessDate(instant).dateKey;
}

function replaceDayRating(values: readonly QDRating[], dateKey: string, committed: QDRating | null): QDRating[] {
  const retained = values.filter((rating) => ratingDateKey(rating) !== dateKey);
  return sortRatings(committed ? [...retained, committed] : retained);
}

export function getQDBusinessDate(instant = new Date()): QDBusinessDate {
  const parts = businessDateFormatter.formatToParts(instant);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? 0);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 0);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 0);
  const monthKey = `${year}-${twoDigits(month)}`;
  return { year, month, day, monthKey, dateKey: `${monthKey}-${twoDigits(day)}` };
}

export function qdRatingDateKey(rating: QDRating): string {
  return ratingDateKey(rating);
}

function businessTimeZoneOffset(instant: Date): number {
  const values = Object.fromEntries(
    businessClockFormatter.formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const representedAsUTC = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
  return representedAsUTC - Math.floor(instant.getTime() / 1_000) * 1_000;
}

export function millisecondsUntilNextQDBusinessDay(instant = new Date()): number {
  const businessDate = getQDBusinessDate(instant);
  const nextMidnightWallClock = Date.UTC(businessDate.year, businessDate.month - 1, businessDate.day + 1, 0, 0, 1);
  const firstGuess = new Date(nextMidnightWallClock - businessTimeZoneOffset(instant));
  const nextMidnightInstant = nextMidnightWallClock - businessTimeZoneOffset(firstGuess);
  return Math.max(1_000, nextMidnightInstant - instant.getTime());
}

export function readQDRatingsSnapshot(
  apiBase: string,
  companyID: string,
  logicGateID: string,
  month: string,
): QDRatingsSnapshot {
  return cacheEntry(apiBase, companyID, logicGateID, month).snapshot;
}

export function subscribeQDRatings(
  apiBase: string,
  companyID: string,
  logicGateID: string,
  month: string,
  listener: () => void,
): () => void {
  const key = cacheKey(apiBase, companyID, logicGateID, month);
  const entry = cacheEntry(apiBase, companyID, logicGateID, month);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size !== 0 || cache.get(key) !== entry) return;
    entry.version += 1;
    entry.refreshAfterLoad = false;
    cache.delete(key);
  };
}

export async function loadQDRatings(input: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  month: string;
  requestJSON: QDRatingsRequestJSON;
  refresh?: boolean;
}): Promise<void> {
  const entry = cacheEntry(input.apiBase, input.companyID, input.logicGateID, input.month);
  if (!input.refresh && entry.snapshot.loaded) return;
  if (entry.loadPromise) {
    if (input.refresh) entry.refreshAfterLoad = true;
    return entry.loadPromise;
  }
  const version = entry.version;
  publish(entry, { ...entry.snapshot, loading: true, error: "" });
  const params = new URLSearchParams({ company_id: input.companyID.trim(), month: input.month.trim() });
  const request = input.requestJSON<{ qd_ratings?: QDRating[] }>(
    `/v1/logic-gates/${encodeURIComponent(input.logicGateID.trim())}/qd-ratings?${params.toString()}`,
    { cache: "no-store" },
  ).then((response) => {
    if (entry.version !== version) return;
    publish(entry, { ratings: sortRatings(response.qd_ratings ?? []), loaded: true, loading: false, error: "" });
  }).catch((cause: unknown) => {
    if (entry.version !== version) return;
    publish(entry, { ...entry.snapshot, loaded: true, loading: false, error: messageFromError(cause) });
  }).finally(() => {
    if (entry.loadPromise === request) entry.loadPromise = undefined;
    if (entry.refreshAfterLoad) {
      entry.refreshAfterLoad = false;
      void loadQDRatings({ ...input, refresh: true });
    }
  });
  entry.loadPromise = request;
  return request;
}

export async function setQDRating(input: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  metric: QDRatingMetric;
  rating: QDRatingValue | null;
  requestJSON: QDRatingsRequestJSON;
  now?: Date;
}): Promise<QDRating | null> {
  const response = await input.requestJSON<{ qd_rating: QDRating | null }>(
    `/v1/logic-gates/${encodeURIComponent(input.logicGateID.trim())}/qd-ratings/${input.metric}`,
    { method: "PUT", json: { company_id: input.companyID.trim(), rating: input.rating } },
  );
  const committed = response.qd_rating ? normalizedRating(response.qd_rating) : null;
  const changedDate = committed ? ratingDateKey(committed) : getQDBusinessDate(input.now).dateKey;
  for (const entry of cache.values()) {
    if (entry.apiBase !== input.apiBase.trim() || entry.companyID !== input.companyID.trim() || entry.logicGateID !== input.logicGateID.trim()) continue;
    if (entry.month !== changedDate.slice(0, 7)) continue;
    entry.version += 1;
    publish(entry, {
      ...entry.snapshot,
      ratings: replaceDayRating(entry.snapshot.ratings, changedDate, committed),
      loaded: true,
      loading: false,
      error: "",
    });
  }
  return committed;
}

export function subscribeQDRatingsRealtime(input: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  requestJSON: QDRatingsRequestJSON;
}): () => void {
  if (typeof WebSocket === "undefined") return () => undefined;
  const refreshActiveMonths = () => {
    for (const entry of cache.values()) {
      if (entry.apiBase !== input.apiBase.trim() || entry.companyID !== input.companyID.trim() || entry.logicGateID !== input.logicGateID.trim()) continue;
      if (entry.listeners.size === 0) continue;
      void loadQDRatings({ ...entry, requestJSON: input.requestJSON, refresh: true });
    }
  };
  return subscribeRealtimeScope(
    input.apiBase,
    input.companyID,
    realtimeEditorJSONScope("logic_gate", input.logicGateID, "qd-ratings"),
    {
      onLogicGateQDRatingUpdated: (message) => {
        if (message.logic_gate_id === input.logicGateID.trim()) refreshActiveMonths();
      },
      onRecover: refreshActiveMonths,
    },
  );
}

export function clearQDRatingsCache(): void {
  cache.clear();
}
