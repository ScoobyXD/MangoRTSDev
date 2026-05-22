export type AppTimelineEntityKind = "node" | "logic_gate";

export type AppTimelineItem = {
  id: string;
  kind: AppTimelineEntityKind;
  entityID: string;
  label: string;
  startMinute: number;
  endMinute: number;
  completed: boolean;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type AppTimelineDay = {
  date: string;
  startMinute: number;
  endMinute: number;
  items: AppTimelineItem[];
};

export type AppTimelineState = {
  currentDate: string;
  startMinute: number;
  endMinute: number;
  items: AppTimelineItem[];
  history: AppTimelineDay[];
};

export type AppTimelineDropInput = {
  kind: AppTimelineEntityKind;
  entityID: string;
  label: string;
};

export const APP_TIMELINE_STEP_MINUTES = 5;
export const APP_TIMELINE_DEFAULT_DURATION_MINUTES = 60;
const APP_TIMELINE_MIN_RANGE_MINUTES = 60;
const APP_TIMELINE_DAY_LAST_MINUTE = 23 * 60 + 45;
const APP_TIMELINE_HISTORY_LIMIT = 30;
const APP_TIMELINE_STORAGE_PREFIX = "mangorts.app-taskbar.timeline.v1";
const DEFAULT_START_MINUTE = 8 * 60;
const DEFAULT_END_MINUTE = 17 * 60;
const DEFAULT_LABEL: Record<AppTimelineEntityKind, string> = {
  node: "Node",
  logic_gate: "Logic Gate",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function storageKey(scope: string): string {
  return `${APP_TIMELINE_STORAGE_PREFIX}:${scope.trim() || "user:local:company:global"}`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeDateKey(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
}

export function timelineDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function alignTimelineMinute(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / APP_TIMELINE_STEP_MINUTES) * APP_TIMELINE_STEP_MINUTES;
}

function normalizeLabel(kind: AppTimelineEntityKind, label: string): string {
  return label.trim().replace(/\s+/g, " ") || DEFAULT_LABEL[kind];
}

function timelineItemID(kind: AppTimelineEntityKind, entityID: string): string {
  return `app-timeline-item:${kind}:${entityID.trim() || "default"}`;
}

export function normalizeTimelineRange(startMinute: number, endMinute: number): Pick<AppTimelineState, "startMinute" | "endMinute"> {
  const latestStart = APP_TIMELINE_DAY_LAST_MINUTE - APP_TIMELINE_MIN_RANGE_MINUTES;
  const start = clampNumber(alignTimelineMinute(startMinute), 0, latestStart);
  const end = clampNumber(
    alignTimelineMinute(endMinute),
    start + APP_TIMELINE_MIN_RANGE_MINUTES,
    APP_TIMELINE_DAY_LAST_MINUTE,
  );
  return { startMinute: start, endMinute: end };
}

export function clampTimelineStart(value: number, state: Pick<AppTimelineState, "startMinute" | "endMinute">): number {
  return clampNumber(alignTimelineMinute(value), state.startMinute, state.endMinute - APP_TIMELINE_STEP_MINUTES);
}

export function clampTimelineEnd(value: number, state: Pick<AppTimelineState, "startMinute" | "endMinute">): number {
  return clampNumber(alignTimelineMinute(value), state.startMinute + APP_TIMELINE_STEP_MINUTES, state.endMinute);
}

function normalizeTimelineItem(value: unknown, range: Pick<AppTimelineState, "startMinute" | "endMinute">): AppTimelineItem | null {
  if (!isObject(value)) return null;
  const kind = value.kind === "node" || value.kind === "logic_gate" ? value.kind : null;
  if (!kind) return null;
  const entityID = typeof value.entityID === "string" ? value.entityID.trim() : "";
  if (!entityID) return null;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : timelineItemID(kind, entityID);
  const startMinute = clampTimelineStart(typeof value.startMinute === "number" ? value.startMinute : range.startMinute, range);
  const endMinute = clampTimelineEnd(typeof value.endMinute === "number" ? value.endMinute : startMinute + APP_TIMELINE_DEFAULT_DURATION_MINUTES, range);
  const completed = value.completed === true;
  const completedAt = typeof value.completedAt === "number" && Number.isFinite(value.completedAt) ? value.completedAt : undefined;
  return {
    id,
    kind,
    entityID,
    label: normalizeLabel(kind, typeof value.label === "string" ? value.label : ""),
    startMinute: Math.min(startMinute, endMinute - APP_TIMELINE_STEP_MINUTES),
    endMinute: Math.max(endMinute, startMinute + APP_TIMELINE_STEP_MINUTES),
    completed,
    completedAt: completed ? completedAt : undefined,
    createdAt: typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  };
}

function normalizeTimelineDay(value: unknown, fallbackDate: string): AppTimelineDay | null {
  if (!isObject(value)) return null;
  const date = normalizeDateKey(value.date, fallbackDate);
  const range = normalizeTimelineRange(
    typeof value.startMinute === "number" ? value.startMinute : DEFAULT_START_MINUTE,
    typeof value.endMinute === "number" ? value.endMinute : DEFAULT_END_MINUTE,
  );
  const seen = new Set<string>();
  const items: AppTimelineItem[] = [];
  const rawItems = Array.isArray(value.items) ? value.items : [];
  for (const rawItem of rawItems) {
    const item = normalizeTimelineItem(rawItem, range);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  if (items.length === 0) return null;
  return {
    date,
    ...range,
    items: sortTimelineItems(items),
  };
}

function normalizeHistory(rawHistory: unknown, currentDate: string): AppTimelineDay[] {
  if (!Array.isArray(rawHistory)) return [];
  const byDate = new Map<string, AppTimelineDay>();
  for (const rawDay of rawHistory) {
    const day = normalizeTimelineDay(rawDay, currentDate);
    if (!day || day.date === currentDate || byDate.has(day.date)) continue;
    byDate.set(day.date, day);
  }
  return Array.from(byDate.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, APP_TIMELINE_HISTORY_LIMIT);
}

export function createDefaultAppTimelineState(date = timelineDateKey()): AppTimelineState {
  return {
    currentDate: normalizeDateKey(date, timelineDateKey()),
    startMinute: DEFAULT_START_MINUTE,
    endMinute: DEFAULT_END_MINUTE,
    items: [],
    history: [],
  };
}

export function rollTimelineStateToDate(state: AppTimelineState, date = timelineDateKey()): AppTimelineState {
  const nextDate = normalizeDateKey(date, timelineDateKey());
  if (state.currentDate === nextDate) return state;
  const previousDay: AppTimelineDay | null = state.items.length > 0
    ? {
      date: state.currentDate,
      startMinute: state.startMinute,
      endMinute: state.endMinute,
      items: sortTimelineItems(state.items),
    }
    : null;
  const history = [
    ...(previousDay ? [previousDay] : []),
    ...state.history.filter((day) => day.date !== state.currentDate && day.date !== nextDate),
  ].slice(0, APP_TIMELINE_HISTORY_LIMIT);
  return {
    ...state,
    currentDate: nextDate,
    items: [],
    history,
  };
}

export function coerceAppTimelineState(value: unknown, date = timelineDateKey()): AppTimelineState {
  if (!isObject(value)) return createDefaultAppTimelineState(date);
  const currentDate = normalizeDateKey(value.currentDate, date);
  const range = normalizeTimelineRange(
    typeof value.startMinute === "number" ? value.startMinute : DEFAULT_START_MINUTE,
    typeof value.endMinute === "number" ? value.endMinute : DEFAULT_END_MINUTE,
  );
  const seen = new Set<string>();
  const items: AppTimelineItem[] = [];
  const rawItems = Array.isArray(value.items) ? value.items : [];
  for (const rawItem of rawItems) {
    const item = normalizeTimelineItem(rawItem, range);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return rollTimelineStateToDate({
    currentDate,
    ...range,
    items: sortTimelineItems(items),
    history: normalizeHistory(value.history, currentDate),
  }, date);
}

export function readAppTimelineState(scope: string): AppTimelineState {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return createDefaultAppTimelineState();
    return coerceAppTimelineState(JSON.parse(raw) as unknown);
  } catch {
    return createDefaultAppTimelineState();
  }
}

export function saveAppTimelineState(scope: string, state: AppTimelineState): void {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(coerceAppTimelineState(state)));
  } catch {
    // Timeline layout is convenience UI state; storage failure should not block work.
  }
}

export function timeInputFromTimelineMinute(minute: number): string {
  const clean = clampNumber(alignTimelineMinute(minute), 0, APP_TIMELINE_DAY_LAST_MINUTE);
  const hours = Math.floor(clean / 60);
  const minutes = clean % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function timelineMinuteFromTimeInput(value: string, fallback: number): number {
  const [rawHours, rawMinutes] = value.trim().split(":");
  const hours = Number.parseInt(rawHours ?? "", 10);
  const minutes = Number.parseInt(rawMinutes ?? "", 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return alignTimelineMinute(fallback);
  return clampNumber(alignTimelineMinute(hours * 60 + minutes), 0, APP_TIMELINE_DAY_LAST_MINUTE);
}

export function formatTimelineTime(minute: number): string {
  const clean = clampNumber(Math.round(minute), 0, APP_TIMELINE_DAY_LAST_MINUTE);
  const hours24 = Math.floor(clean / 60);
  const minutes = clean % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function formatTimelineTimeRange(startMinute: number, endMinute: number): string {
  return `${formatTimelineTime(startMinute)} to ${formatTimelineTime(endMinute)}`;
}

export function formatTimelineDate(date: string): string {
  const [rawYear, rawMonth, rawDay] = date.split("-");
  const year = Number.parseInt(rawYear ?? "", 10);
  const month = Number.parseInt(rawMonth ?? "", 10);
  const day = Number.parseInt(rawDay ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return date;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function shortTimelineLabel(label: string, maxLength = 4): string {
  const compact = label.trim().replace(/\s+/g, "");
  return (compact || "Item").slice(0, Math.max(1, maxLength));
}

export function sortTimelineItems(items: AppTimelineItem[]): AppTimelineItem[] {
  return [...items].sort((a, b) => (
    a.startMinute - b.startMinute
    || a.endMinute - b.endMinute
    || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })
    || a.id.localeCompare(b.id)
  ));
}

export function setTimelineRange(state: AppTimelineState, startMinute: number, endMinute: number): AppTimelineState {
  const range = normalizeTimelineRange(startMinute, endMinute);
  return coerceAppTimelineState({ ...state, ...range }, state.currentDate);
}

export function upsertTimelineDropsAt(state: AppTimelineState, drops: AppTimelineDropInput[], startMinute: number): AppTimelineState {
  const cleanDrops = drops
    .map((drop) => ({
      kind: drop.kind,
      entityID: drop.entityID.trim(),
      label: normalizeLabel(drop.kind, drop.label),
    }))
    .filter((drop) => drop.entityID);
  if (cleanDrops.length === 0) return state;

  const now = Date.now();
  const byID = new Map(state.items.map((item) => [item.id, item]));
  cleanDrops.forEach((drop, index) => {
    const duration = Math.min(APP_TIMELINE_DEFAULT_DURATION_MINUTES, state.endMinute - state.startMinute);
    const proposedStart = startMinute + index * duration;
    const itemStart = clampTimelineStart(proposedStart, state);
    const itemEnd = clampTimelineEnd(Math.min(itemStart + duration, state.endMinute), state);
    const id = timelineItemID(drop.kind, drop.entityID);
    const existing = byID.get(id);
    byID.set(id, {
      id,
      kind: drop.kind,
      entityID: drop.entityID,
      label: drop.label,
      startMinute: Math.min(itemStart, itemEnd - APP_TIMELINE_STEP_MINUTES),
      endMinute: itemEnd,
      completed: existing?.completed ?? false,
      completedAt: existing?.completedAt,
      createdAt: existing?.createdAt ?? now + index,
      updatedAt: now + index,
    });
  });

  return {
    ...state,
    items: sortTimelineItems(Array.from(byID.values())),
  };
}

export function updateTimelineItemTiming(state: AppTimelineState, itemID: string, startMinute: number, endMinute: number): AppTimelineState {
  const item = state.items.find((candidate) => candidate.id === itemID);
  if (!item) return state;
  const nextStart = clampTimelineStart(startMinute, state);
  const nextEnd = clampTimelineEnd(endMinute, state);
  const safeStart = Math.min(nextStart, nextEnd - APP_TIMELINE_STEP_MINUTES);
  const safeEnd = Math.max(nextEnd, safeStart + APP_TIMELINE_STEP_MINUTES);
  return {
    ...state,
    items: sortTimelineItems(state.items.map((candidate) => (
      candidate.id === itemID
        ? { ...candidate, startMinute: safeStart, endMinute: safeEnd, updatedAt: Date.now() }
        : candidate
    ))),
  };
}

export function updateTimelineItemCompleted(state: AppTimelineState, itemID: string, completed: boolean): AppTimelineState {
  const item = state.items.find((candidate) => candidate.id === itemID);
  if (!item || item.completed === completed) return state;
  const now = Date.now();
  return {
    ...state,
    items: sortTimelineItems(state.items.map((candidate) => (
      candidate.id === itemID
        ? { ...candidate, completed, completedAt: completed ? now : undefined, updatedAt: now }
        : candidate
    ))),
  };
}

export function deleteTimelineItem(state: AppTimelineState, itemID: string): AppTimelineState {
  const nextItems = state.items.filter((item) => item.id !== itemID);
  return nextItems.length === state.items.length ? state : { ...state, items: nextItems };
}
