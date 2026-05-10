import type { FrameDataModel } from "../types";
import { preloadModuleKinds, preloadModulesForFrames } from "../modules";
import { preloadCommunicationsPage, preloadLogicGateArenaPage } from "../pages/lazyPages";
import { loadViews } from "./useFramePersistence";

const HOT_DASHBOARD_MODULE_KINDS = ["map", "company-explorer", "editor", "kanban", "communications"];
const DEFAULT_DASHBOARD_MODULE_KINDS = ["map", "company-explorer", "editor"];
const LOGIC_GATE_ARENA_MODULE_KINDS = ["company-explorer", "editor", "kanban"];
const COMMUNICATIONS_MODULE_KINDS = ["communications"];

export function preloadHotDashboardModules(): void {
  preloadLogicGateArenaPage();
  preloadCommunicationsPage();
  preloadModuleKinds(HOT_DASHBOARD_MODULE_KINDS);
}

export function preloadDefaultDashboardModules(): void {
  preloadModuleKinds(DEFAULT_DASHBOARD_MODULE_KINDS);
}

export function preloadLogicGateArenaSurface(): void {
  preloadLogicGateArenaPage();
  preloadModuleKinds(LOGIC_GATE_ARENA_MODULE_KINDS);
}

export function preloadCommunicationsSurface(): void {
  preloadCommunicationsPage();
  preloadModuleKinds(COMMUNICATIONS_MODULE_KINDS);
}

export function preloadVisibleFrameModules(frames: Iterable<Pick<FrameDataModel, "kind">>): void {
  preloadModulesForFrames(frames);
}

export function preloadLikelyDashboardModules(): void {
  preloadHotDashboardModules();
  try {
    const views = loadViews();
    const activeTab = views.tabs.find((tab) => tab.id === views.activeId) ?? views.tabs[0];
    if (!activeTab) return;
    if (activeTab.page === "logic-gate-arena") preloadLogicGateArenaPage();
    if (activeTab.page === "communications") preloadCommunicationsPage();
    if (activeTab.frames.length > 0) preloadVisibleFrameModules(activeTab.frames);
  } catch {
    preloadDefaultDashboardModules();
  }
}