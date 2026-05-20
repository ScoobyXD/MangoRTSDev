import type { FrameDataModel } from "../types";
import { preloadModuleKinds, preloadModulesForFrames } from "../modules";
import { preloadHomePage, preloadLogicGateArenaPage } from "../pages/lazyPages";
import { loadViews } from "./useFramePersistence";
import {
  DEFAULT_DASHBOARD_MODULE_KINDS,
  HOME_MODULE_KINDS,
  HOT_DASHBOARD_MODULE_KINDS,
  LOGIC_GATE_ARENA_MODULE_KINDS,
  planLikelyDashboardPreload,
  type DashboardPreloadPlan,
} from "./preloadDashboardPlan";

export function preloadHotDashboardModules(): void {
  preloadLogicGateArenaPage();
  preloadHomePage();
  preloadModuleKinds(HOT_DASHBOARD_MODULE_KINDS);
}

export function preloadDefaultDashboardModules(): void {
  preloadModuleKinds(DEFAULT_DASHBOARD_MODULE_KINDS);
}

export function preloadLogicGateArenaSurface(): void {
  preloadLogicGateArenaPage();
  preloadModuleKinds(LOGIC_GATE_ARENA_MODULE_KINDS);
}

export function preloadHomeSurface(): void {
  preloadHomePage();
  preloadModuleKinds(HOME_MODULE_KINDS);
}

export function preloadVisibleFrameModules(frames: Iterable<Pick<FrameDataModel, "kind">>): void {
  preloadModulesForFrames(frames);
}

function preloadDashboardPlan(plan: DashboardPreloadPlan): void {
  for (const surface of plan.routeSurfaces) {
    if (surface === "logic-gate-arena") preloadLogicGateArenaPage();
    if (surface === "home") preloadHomePage();
  }
  preloadModuleKinds(plan.moduleKinds);
}

export function preloadLikelyDashboardModules(): void {
  try {
    const views = loadViews();
    const activeTab = views.tabs.find((tab) => tab.id === views.activeId) ?? views.tabs[0];
    preloadDashboardPlan(planLikelyDashboardPreload(activeTab));
  } catch {
    preloadDefaultDashboardModules();
  }
}
