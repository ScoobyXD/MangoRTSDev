import type { FrameDataModel } from "../types.js";
import type { ViewTab } from "./frameLayoutTypes.js";

export const HOT_DASHBOARD_MODULE_KINDS = ["map", "company-explorer", "editor", "kanban", "home"];
export const DEFAULT_DASHBOARD_MODULE_KINDS = ["map", "company-explorer", "editor"];
export const LOGIC_GATE_ARENA_MODULE_KINDS = ["editor", "kanban"];
export const HOME_MODULE_KINDS = ["home"];
export const PROJECT_MANAGEMENT_MODULE_KINDS = ["project-management"];

export type DashboardRouteSurface = "home" | "logic-gate-arena" | "project-management";

export type DashboardPreloadPlan = {
  moduleKinds: string[];
  routeSurfaces: DashboardRouteSurface[];
};

function uniqueKinds(frames: Iterable<Pick<FrameDataModel, "kind">>): string[] {
  const kinds: string[] = [];
  const seen = new Set<string>();
  for (const frame of frames) {
    const kind = frame.kind.trim();
    if (!kind || seen.has(kind)) continue;
    seen.add(kind);
    kinds.push(kind);
  }
  return kinds;
}

export function planLikelyDashboardPreload(activeTab: ({ page?: ViewTab["page"]; frames: Iterable<Pick<FrameDataModel, "kind">> }) | null | undefined): DashboardPreloadPlan {
  if (!activeTab) return { moduleKinds: DEFAULT_DASHBOARD_MODULE_KINDS, routeSurfaces: [] };
  if (activeTab.page === "logic-gate-arena") {
    return { moduleKinds: LOGIC_GATE_ARENA_MODULE_KINDS, routeSurfaces: ["logic-gate-arena"] };
  }
  if (activeTab.page === "home" || activeTab.page === "communications") {
    return { moduleKinds: HOME_MODULE_KINDS, routeSurfaces: ["home"] };
  }
  if (activeTab.page === "project-management") {
    return { moduleKinds: PROJECT_MANAGEMENT_MODULE_KINDS, routeSurfaces: ["project-management"] };
  }
  const moduleKinds = uniqueKinds(activeTab.frames);
  return {
    moduleKinds: moduleKinds.length > 0 ? moduleKinds : DEFAULT_DASHBOARD_MODULE_KINDS,
    routeSurfaces: [],
  };
}
