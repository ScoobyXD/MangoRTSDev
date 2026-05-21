export type AppTimelineEntityKind = "node" | "logic_gate";

export type AppTimelineItem = {
  id: string;
  kind: AppTimelineEntityKind;
  entityID: string;
  label: string;
  startMinute: number;
  endMinute: number;
  createdAt: number;
  updatedAt: number;
};

export type AppTimelineState = {
  startMinute: number;
  endMinute: number;
  items: AppTimelineItem[];
};

export type AppTimelineDropInput = {
  kind: AppTimelineEntityKind;
  entityID: string;
  label: string;
};

export const APP_TIMELINE_STEP_MINUTES = 15;
export const APP_TIMELINE_DEFAULT_DURATION_MINUTES = 60;
const APP_TIMELINE_MIN_RANGE_MINUTES = 60;
const APP_TIMELINE_DAY_LAST_MINUTE = 23 * 60 + 45;
const APP_TIMELINE_STORAGE_PREFIX = "mangorts.app-timeline.v1";
const DEFAULT_START_MINUTE = 8 * 60;
const DEFAULT_END_MINUTE = 17 * 60;
const DEFAULT_LABEL: Record<AppTimelineEntityKind, string> = {
  node: "Node",
  logic_gate: "Logic Gate",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function storageKey(companyID: string): string {
  const scope = companyID.trim() || "global";
  return `${APP_TIMELINE_STORAGE_PREFIX}:${scope}`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  return {
    id,
    kind,
    entityID,
    label: normalizeLabel(kind, typeof value.label === "string" ? value.label : ""),
    startMinute: Math.min(startMinute, endMinute - APP_TIMELINE_STEP_MINUTES),
    endMinute: Math.max(endMinute, startMinute + APP_TIMELINE_STEP_MINUTES),
    createdAt: typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  };
}

export function createDefaultAppTimelineState(): AppTimelineState {
  return { startMinute: DEFAULT_START_MINUTE, endMinute: DEFAULT_END_MINUTE, items: [] };
}

export function coerceAppTimelineState(value: unknown): AppTimelineState {
  if (!isObject(value)) return createDefaultAppTimelineState();
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
  return {
    ...range,
    items: sortTimelineItems(items),
  };
}

export function readAppTimelineState(companyID: string): AppTimelineState {
  try {
    const raw = localStorage.getItem(storageKey(companyID));
    if (!raw) return createDefaultAppTimelineState();
    return coerceAppTimelineState(JSON.parse(raw) as unknown);
  } catch {
    return createDefaultAppTimelineState();
  }
}

export function saveAppTimelineState(companyID: string, state: AppTimelineState): void {
  try {
    localStorage.setItem(storageKey(companyID), JSON.stringify(coerceAppTimelineState(state)));
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
  return coerceAppTimelineState({ ...state, ...range });
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

export function deleteTimelineItem(state: AppTimelineState, itemID: string): AppTimelineState {
  const nextItems = state.items.filter((item) => item.id !== itemID);
  return nextItems.length === state.items.length ? state : { ...state, items: nextItems };
}
