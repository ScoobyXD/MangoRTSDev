import type { FrameDataModel } from "../types";
import { preloadModuleKinds, preloadModulesForFrames } from "../modules";
import { preloadAccountManagerPage, preloadEntitiesPage, preloadHomePage, preloadLogicGateArenaPage, preloadProcessMapPage, preloadProjectManagementPage, preloadTeamsPage } from "../pages/lazyPages";
import { loadViews } from "./useFramePersistence";
import {
  ACCOUNT_MANAGER_MODULE_KINDS,
  DEFAULT_DASHBOARD_MODULE_KINDS,
  HOME_MODULE_KINDS,
  LOGIC_GATE_ARENA_MODULE_KINDS,
  PROJECT_MANAGEMENT_MODULE_KINDS,
  PROCESS_MAP_MODULE_KINDS,
  ENTITIES_MODULE_KINDS,
  TEAMS_MODULE_KINDS,
  planLikelyDashboardPreload,
  type DashboardPreloadPlan,
} from "./preloadDashboardPlan";

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

export function preloadProjectManagementSurface(): void {
  preloadProjectManagementPage();
  preloadModuleKinds(PROJECT_MANAGEMENT_MODULE_KINDS);
}

export function preloadAccountManagerSurface(): void {
  preloadAccountManagerPage();
  preloadModuleKinds(ACCOUNT_MANAGER_MODULE_KINDS);
}

export function preloadTeamsSurface(): void {
  preloadTeamsPage();
  preloadModuleKinds(TEAMS_MODULE_KINDS);
}

export function preloadEntitiesSurface(): void {
  preloadEntitiesPage();
  preloadModuleKinds(ENTITIES_MODULE_KINDS);
}

export function preloadProcessMapSurface(): void {
  preloadProcessMapPage();
  preloadModuleKinds(PROCESS_MAP_MODULE_KINDS);
}

export function preloadVisibleFrameModules(frames: Iterable<Pick<FrameDataModel, "kind">>): void {
  preloadModulesForFrames(frames);
}

function preloadDashboardPlan(plan: DashboardPreloadPlan): void {
  for (const surface of plan.routeSurfaces) {
    if (surface === "logic-gate-arena") preloadLogicGateArenaPage();
    if (surface === "home") preloadHomePage();
    if (surface === "project-management") preloadProjectManagementPage();
    if (surface === "account-manager") preloadAccountManagerPage();
    if (surface === "teams") preloadTeamsPage();
    if (surface === "entities") preloadEntitiesPage();
    if (surface === "process-map") preloadProcessMapPage();
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
