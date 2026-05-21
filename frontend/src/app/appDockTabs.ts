import { humanLabelOrFallback } from "../modules/entityLabels.js";
export type AppDockTabKind = "node" | "logic_gate_arena";

export type AppDockTab = {
  id: string;
  kind: AppDockTabKind;
  entityID: string;
  label: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
};

export type AppDockTabInput = {
  kind: AppDockTabKind;
  entityID: string;
  label: string;
};

export const EVENT_APP_DOCK_TAB_REQUESTED = "mangorts:app-dock-tab-requested";

const APP_DOCK_TABS_STORAGE_PREFIX = "mangorts.app-taskbar.tabs.v1";
const DEFAULT_TAB_LABEL: Record<AppDockTabKind, string> = {
  node: "Node",
  logic_gate_arena: "Logic Gate Arena",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeLabel(kind: AppDockTabKind, label: string): string {
  const normalized = label.trim().replace(/\s+/g, " ");
  if (kind === "logic_gate_arena") return humanLabelOrFallback(normalized, DEFAULT_TAB_LABEL[kind]);
  return normalized || DEFAULT_TAB_LABEL[kind];
}

function scopePart(value: string, fallback: string): string {
  return encodeURIComponent(value.trim() || fallback);
}

export function appTaskbarStorageScope(userID: string, companyID: string): string {
  return `user:${scopePart(userID, "local")}:company:${scopePart(companyID, "global")}`;
}

function storageKey(scope: string): string {
  return `${APP_DOCK_TABS_STORAGE_PREFIX}:${scope.trim() || "user:local:company:global"}`;
}

export function appDockTabID(kind: AppDockTabKind, entityID: string): string {
  return `app-dock-tab:${kind}:${entityID.trim() || "default"}`;
}

function coerceAppDockTab(value: unknown): AppDockTab | null {
  if (!isObject(value)) return null;
  const kind = value.kind === "node" || value.kind === "logic_gate_arena" ? value.kind : null;
  if (!kind) return null;
  const entityID = typeof value.entityID === "string" ? value.entityID.trim() : "";
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : appDockTabID(kind, entityID);
  return {
    id,
    kind,
    entityID,
    label: normalizeLabel(kind, typeof value.label === "string" ? value.label : ""),
    pinned: value.pinned === true,
    createdAt: typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  };
}

export function readAppDockTabs(scope: string): AppDockTab[] {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const tabs: AppDockTab[] = [];
    for (const item of parsed) {
      const tab = coerceAppDockTab(item);
      if (!tab || seen.has(tab.id)) continue;
      seen.add(tab.id);
      tabs.push(tab);
    }
    return tabs;
  } catch {
    return [];
  }
}

export function saveAppDockTabs(scope: string, tabs: AppDockTab[]): void {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(tabs));
  } catch {
    // App tabs are convenience UI state; storage failure should not block work.
  }
}

export function upsertAppDockTab(tabs: AppDockTab[], input: AppDockTabInput): { tabs: AppDockTab[]; tabID: string } {
  const entityID = input.entityID.trim();
  const tabID = appDockTabID(input.kind, entityID);
  const now = Date.now();
  const label = normalizeLabel(input.kind, input.label);
  const existing = tabs.find((tab) => tab.id === tabID);
  if (existing) {
    return {
      tabID,
      tabs: tabs.map((tab) => (
        tab.id === tabID
          ? { ...tab, entityID, label, updatedAt: now }
          : tab
      )),
    };
  }
  return {
    tabID,
    tabs: [...tabs, {
      id: tabID,
      kind: input.kind,
      entityID,
      label,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    }],
  };
}
export function requestAppDockTab(input: AppDockTabInput): void {
  if (typeof window === "undefined") return;
  const entityID = input.entityID.trim();
  if (!entityID) return;
  window.dispatchEvent(new CustomEvent<AppDockTabInput>(EVENT_APP_DOCK_TAB_REQUESTED, {
    detail: {
      kind: input.kind,
      entityID,
      label: input.label.trim() || DEFAULT_TAB_LABEL[input.kind],
    },
  }));
}
