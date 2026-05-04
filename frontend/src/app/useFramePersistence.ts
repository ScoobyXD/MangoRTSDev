import type { FrameDataModel } from "../types";
import { FRAME_REGISTRY_KEY } from "../modules/linkingGraph";
import { createDefaultNodeViewFrames } from "./DefaultViews";
import {
  FRAME_LINKS_KEY,
  sanitizeFrameLinks,
  type FrameLinkEdge,
} from "./frameLinking";
import {
  COLORWAYS,
  MIN_H,
  MIN_W,
  snapToHalfStep,
  type ColorwayKey,
  type ViewTab,
} from "./frameLayoutTypes";

const VIEWS_KEY = "grid-dashboard-views-v1";
const SETTINGS_KEY = "grid-dashboard-settings";

export interface DashboardSettings {
  bgColor?: string;
  crossColor?: string;
  headerBgColor?: string;
  headerTextColor?: string;
  tabBgColor?: string;
  tabTextColor?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isColorway(value: unknown): value is ColorwayKey {
  return typeof value === "string" && value in COLORWAYS;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-F]{6}$/i.test(value);
}

// Storage migration guard: sanitize persisted frame payloads from localStorage.
function coerceFrame(value: unknown): FrameDataModel | null {
  if (!isObject(value)) return null;
  const { id, kind, parentId, theme, x, y, w, h, title, color, accent } = value;
  if (
    typeof id !== "string" || typeof kind !== "string" || typeof x !== "number" || typeof y !== "number" ||
    typeof w !== "number" || typeof h !== "number" || typeof title !== "string" || typeof color !== "string" || typeof accent !== "string"
  ) return null;

  const normalizedKind = kind === "node-doc" ? "editor" : kind;
  const normalizedTitle = normalizedKind === "kanban" && title === "Kanban" ? "Kanban board" : title;

  return {
    id,
    kind: normalizedKind,
    parentId: typeof parentId === "string" && parentId.trim() ? parentId : undefined,
    theme: isColorway(theme) ? theme : theme === "white" ? "light" : theme === "black" ? "dark" : theme === "orange" ? "light" : "teal",
    x: Math.max(0, snapToHalfStep(x)),
    y: Math.max(0, snapToHalfStep(y)),
    w: Math.max(MIN_W, Math.round(w)),
    h: Math.max(MIN_H, Math.round(h)),
    title: normalizedTitle,
    color,
    accent,
  };
}

function sanitizeFrames(value: unknown): FrameDataModel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const cleaned: FrameDataModel[] = [];
  for (const item of value) {
    const widget = coerceFrame(item);
    if (!widget || seen.has(widget.id)) continue;
    seen.add(widget.id);
    cleaned.push(widget);
  }
  return cleaned;
}

export function loadFrameLinks(): FrameLinkEdge[] {
  try {
    const raw = localStorage.getItem(FRAME_LINKS_KEY);
    if (!raw) return [];
    return sanitizeFrameLinks(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function persistFrameLinks(next: FrameLinkEdge[]) {
  try { localStorage.setItem(FRAME_LINKS_KEY, JSON.stringify(next)); } catch {}
}

// Load saved dashboard views/tabs with legacy widget compatibility fallback.
export function loadViews(): { tabs: ViewTab[]; activeId: string } {
  const fallback = { tabs: [{ id: "view-default", name: "Default Node View", frames: createDefaultNodeViewFrames() }], activeId: "view-default" };
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || !Array.isArray(parsed.tabs) || typeof parsed.activeId !== "string") return fallback;

    const tabs = parsed.tabs
      .map((tab) => {
        if (!isObject(tab) || typeof tab.id !== "string" || typeof tab.name !== "string") return null;
        const frames = sanitizeFrames((tab as { frames?: unknown; widgets?: unknown }).frames ?? tab.widgets);
        return { id: tab.id, name: tab.name, frames } satisfies ViewTab;
      })
      .filter((tab): tab is ViewTab => !!tab);

    if (tabs.length === 0) return fallback;
    const activeId = tabs.some((tab) => tab.id === parsed.activeId) ? parsed.activeId : tabs[0].id;
    return { tabs, activeId };
  } catch {
    return fallback;
  }
}

export function saveViews(tabs: ViewTab[], activeId: string) {
  try {
    const serializedTabs = tabs.map((tab) => ({ ...tab, widgets: tab.frames }));
    localStorage.setItem(VIEWS_KEY, JSON.stringify({ tabs: serializedTabs, activeId }));
  } catch {}
}

// Load persisted theme settings for canvas/header/tab color customization.
export function loadSettings(): DashboardSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return {};
    return {
      bgColor: isHexColor(parsed.bgColor) ? parsed.bgColor : undefined,
      crossColor: isHexColor(parsed.crossColor) ? parsed.crossColor : undefined,
      headerBgColor: isHexColor(parsed.headerBgColor) ? parsed.headerBgColor : undefined,
      headerTextColor: isHexColor(parsed.headerTextColor) ? parsed.headerTextColor : undefined,
      tabBgColor: isHexColor(parsed.tabBgColor) ? parsed.tabBgColor : undefined,
      tabTextColor: isHexColor(parsed.tabTextColor) ? parsed.tabTextColor : undefined,
    };
  } catch {
    return {};
  }
}

export function saveSettings(s: { bgColor: string; crossColor: string; headerBgColor: string; headerTextColor: string; tabBgColor: string; tabTextColor: string }) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

export function persistFrameRegistry(next: Record<string, { kind: string }>) {
  try { localStorage.setItem(FRAME_REGISTRY_KEY, JSON.stringify(next)); } catch {}
}
