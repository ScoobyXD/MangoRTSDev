import type { FrameDataModel } from "../types";
import { FRAME_REGISTRY_KEY } from "../modules/linkingGraph";
import { createDefaultNodeViewFrames, createHomeViewFrames, createLogicGateArenaFrames, LEGACY_DEFAULT_NODE_VIEW_FRAME_IDS } from "./DefaultViews";
import {
  FRAME_LINKS_KEY,
  sanitizeFrameLinks,
  type FrameLinkEdge,
} from "./frameLinking";
import {
  COLORWAYS,
  DEFAULT_COLORWAY,
  MIN_H,
  MIN_W,
  createFrameId,
  snapToHalfStep,
  type ColorwayKey,
  type ViewTab,
} from "./frameLayoutTypes";

const VIEWS_KEY = "grid-dashboard-views-v1";
const SETTINGS_KEY = "grid-dashboard-settings";
const LEGACY_DEFAULT_NODE_VIEW_FRAME_ID_SET = new Set<string>(Object.values(LEGACY_DEFAULT_NODE_VIEW_FRAME_IDS));
const SUPPORTED_PERSISTED_FRAME_KINDS = new Set<string>([
  "company-explorer",
  "communications",
  "editor",
  "home",
  "kanban",
  "logic-map",
  "map",
  "nodes",
  "nodes-map",
]);

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

function isLegacyDefaultSetting(value: unknown, legacyDefaults: string[]): boolean {
  return typeof value === "string" && legacyDefaults.some((legacy) => legacy.toLowerCase() === value.toLowerCase());
}

// Storage migration guard: sanitize persisted frame payloads from localStorage.
function coerceFrame(value: unknown): FrameDataModel | null {
  if (!isObject(value)) return null;
  const { id, kind, parentId, theme, x, y, w, h, title, color, accent } = value;
  if (
    typeof id !== "string" || typeof kind !== "string" || typeof x !== "number" || typeof y !== "number" ||
    typeof w !== "number" || typeof h !== "number" || typeof title !== "string" || typeof color !== "string" || typeof accent !== "string"
  ) return null;

  const normalizedKind = kind === "node-doc" ? "editor" : kind === "communications" ? "home" : kind;
  const normalizedTitle = normalizedKind === "kanban" && title === "Kanban"
    ? "Kanban board"
    : normalizedKind === "company-explorer" && title === "Company Explorer"
      ? "Explorer"
      : title;
  if (!SUPPORTED_PERSISTED_FRAME_KINDS.has(normalizedKind)) return null;

  const normalizedTheme: ColorwayKey = isColorway(theme)
    ? theme
    : theme === "white" ? "light"
      : theme === "black" ? "dark"
        : theme === "orange" ? "mango"
          : DEFAULT_COLORWAY;
  const swatch = COLORWAYS[normalizedTheme];

  return {
    id,
    kind: normalizedKind,
    parentId: typeof parentId === "string" && parentId.trim() ? parentId : undefined,
    theme: normalizedTheme,
    x: Math.max(0, snapToHalfStep(x)),
    y: Math.max(0, snapToHalfStep(y)),
    w: Math.max(MIN_W, Math.round(w)),
    h: Math.max(MIN_H, Math.round(h)),
    title: normalizedTitle,
    color: swatch.color || color,
    accent: swatch.accent || accent,
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

function sanitizePage(value: unknown): ViewTab["page"] {
  if (value === "communications") return "home";
  return value === "logic-gate-arena" || value === "home" ? value : undefined;
}

function createUniqueFrameID(usedFrameIDs: Set<string>): string {
  let nextID = createFrameId();
  while (usedFrameIDs.has(nextID) || LEGACY_DEFAULT_NODE_VIEW_FRAME_ID_SET.has(nextID)) {
    nextID = createFrameId();
  }
  return nextID;
}

function isCommunicationsTab(tab: ViewTab): boolean {
  return tab.page === "home" || tab.page === "communications" || /^(home|communications?)$/i.test(tab.name.trim());
}

function isLogicGateArenaTab(tab: ViewTab): boolean {
  return tab.page === "logic-gate-arena" || /^logic gate arena$/i.test(tab.name.trim());
}

function isPrimaryMapTab(tab: ViewTab): boolean {
  return !tab.page && /^(default node view|default map view|map)$/i.test(tab.name.trim());
}

function normalizePrimaryTab(tab: ViewTab): ViewTab {
  if (isCommunicationsTab(tab)) return { ...tab, name: "Home", page: "home" };
  if (isLogicGateArenaTab(tab)) return { ...tab, name: "Logic Gate Arena", page: "logic-gate-arena" };
  if (isPrimaryMapTab(tab)) return { ...tab, name: "Map", page: undefined };
  return tab;
}

function createPrimaryTabs(): ViewTab[] {
  return [
    { id: "view-home", name: "Home", page: "home", frames: createHomeViewFrames() },
    { id: "view-logic-gate-arena", name: "Logic Gate Arena", page: "logic-gate-arena", frames: createLogicGateArenaFrames() },
    { id: "view-default", name: "Map", frames: createDefaultNodeViewFrames() },
  ];
}

function ensurePrimaryHeaderTabs(tabs: ViewTab[]): ViewTab[] {
  const normalized = tabs.map(normalizePrimaryTab);
  const next = [...normalized];
  const defaults = createPrimaryTabs();
  if (!next.some(isCommunicationsTab)) next.push(defaults[0]);
  if (!next.some(isLogicGateArenaTab)) next.push(defaults[1]);
  if (!next.some(isPrimaryMapTab)) next.push(defaults[2]);

  return next
    .map((tab, index) => ({ tab, index }))
    .sort((a, b) => {
      const rank = (tab: ViewTab) => isCommunicationsTab(tab) ? 0 : isLogicGateArenaTab(tab) ? 1 : isPrimaryMapTab(tab) ? 2 : 3;
      const rankDelta = rank(a.tab) - rank(b.tab);
      return rankDelta || a.index - b.index;
    })
    .map(({ tab }) => tab);
}

function ensureGloballyUniqueFrameIDs(tabs: ViewTab[]): ViewTab[] {
  const usedFrameIDs = new Set<string>();
  return tabs.map((tab) => {
    const frameIDMap = new Map<string, string>();
    const tabFrameIDs = new Set<string>();

    for (const frame of tab.frames) {
      const shouldRemap = usedFrameIDs.has(frame.id) || LEGACY_DEFAULT_NODE_VIEW_FRAME_ID_SET.has(frame.id);
      const nextID = shouldRemap ? createUniqueFrameID(usedFrameIDs) : frame.id;
      frameIDMap.set(frame.id, nextID);
      usedFrameIDs.add(nextID);
      tabFrameIDs.add(nextID);
    }

    const frames = tab.frames.map((frame) => {
      const id = frameIDMap.get(frame.id) ?? frame.id;
      const parentId = frame.parentId ? frameIDMap.get(frame.parentId) : undefined;
      return {
        ...frame,
        id,
        parentId: parentId && tabFrameIDs.has(parentId) ? parentId : undefined,
      };
    });
    return { ...tab, frames };
  });
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
  const fallbackTabs = createPrimaryTabs();
  const fallback = { tabs: fallbackTabs, activeId: "view-default" };
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || !Array.isArray(parsed.tabs) || typeof parsed.activeId !== "string") return fallback;

    const tabs = parsed.tabs
      .map((tab): ViewTab | null => {
        if (!isObject(tab) || typeof tab.id !== "string" || typeof tab.name !== "string") return null;
        const frames = sanitizeFrames((tab as { frames?: unknown; widgets?: unknown }).frames ?? tab.widgets);
        const page = sanitizePage(tab.page);
        return { id: tab.id, name: tab.name, ...(page ? { page } : {}), frames };
      })
      .filter((tab): tab is ViewTab => !!tab);

    if (tabs.length === 0) return fallback;
    const normalizedTabs = ensurePrimaryHeaderTabs(ensureGloballyUniqueFrameIDs(tabs));
    const activeId = normalizedTabs.some((tab) => tab.id === parsed.activeId) ? parsed.activeId : (normalizedTabs.find(isPrimaryMapTab)?.id ?? normalizedTabs[0].id);
    return { tabs: normalizedTabs, activeId };
  } catch {
    return fallback;
  }
}

export function saveViews(tabs: ViewTab[], activeId: string) {
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify({ tabs, activeId }));
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
      bgColor: isHexColor(parsed.bgColor) && !isLegacyDefaultSetting(parsed.bgColor, ["#f7fffe", "#ffffff"]) ? parsed.bgColor : undefined,
      crossColor: isHexColor(parsed.crossColor) && !isLegacyDefaultSetting(parsed.crossColor, ["#00a8b8", "#ff8820"]) ? parsed.crossColor : undefined,
      headerBgColor: isHexColor(parsed.headerBgColor) && !isLegacyDefaultSetting(parsed.headerBgColor, ["#00e9ff", "#ff8820"]) ? parsed.headerBgColor : undefined,
      headerTextColor: isHexColor(parsed.headerTextColor) ? parsed.headerTextColor : undefined,
      tabBgColor: isHexColor(parsed.tabBgColor) ? parsed.tabBgColor : undefined,
      tabTextColor: isHexColor(parsed.tabTextColor) && !isLegacyDefaultSetting(parsed.tabTextColor, ["#08343a", "#24120a"]) ? parsed.tabTextColor : undefined,
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
