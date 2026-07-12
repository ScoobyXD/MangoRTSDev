export type ProjectWorkPanelTab = "critical-path" | "relationships";

export type ProjectLogicGateReturnContext = {
  projectID: string;
  workPanelTab: ProjectWorkPanelTab;
};

type ProjectWorkPanelHistoryLike = {
  state: unknown;
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
};

const PROJECT_WORK_PANEL_HISTORY_STATE_KEY = "mangortsProjectWorkPanel";
export const DEFAULT_PROJECT_WORK_PANEL_TAB: ProjectWorkPanelTab = "critical-path";

function historyStateRecord(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  return state as Record<string, unknown>;
}

export function projectWorkPanelTabFromHistoryState(
  state: unknown,
  projectID: string,
): ProjectWorkPanelTab {
  const cleanProjectID = projectID.trim();
  const marker = historyStateRecord(state)[PROJECT_WORK_PANEL_HISTORY_STATE_KEY];
  if (!cleanProjectID || !marker || typeof marker !== "object" || Array.isArray(marker)) {
    return DEFAULT_PROJECT_WORK_PANEL_TAB;
  }
  const value = marker as { projectID?: unknown; workPanelTab?: unknown };
  if (value.projectID !== cleanProjectID) return DEFAULT_PROJECT_WORK_PANEL_TAB;
  return value.workPanelTab === "relationships" || value.workPanelTab === "critical-path"
    ? value.workPanelTab
    : DEFAULT_PROJECT_WORK_PANEL_TAB;
}

export function buildProjectWorkPanelHistoryState(
  state: unknown,
  context: ProjectLogicGateReturnContext,
): Record<string, unknown> {
  const cleanProjectID = context.projectID.trim();
  const base = { ...historyStateRecord(state) };
  if (!cleanProjectID) return base;
  return {
    ...base,
    [PROJECT_WORK_PANEL_HISTORY_STATE_KEY]: {
      projectID: cleanProjectID,
      workPanelTab: context.workPanelTab,
    },
  };
}

export function replaceProjectWorkPanelHistoryState(
  history: ProjectWorkPanelHistoryLike,
  url: string,
  context: ProjectLogicGateReturnContext,
): void {
  history.replaceState(buildProjectWorkPanelHistoryState(history.state, context), "", url);
}
