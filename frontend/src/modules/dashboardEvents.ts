export const EVENT_FRAME_LINK_GRAPH_UPDATED = "mangorts:frame-link-graph-updated";
export const EVENT_EXPLORER_CONTEXT_UPDATED = "mangorts:explorer-context-updated";
export const EVENT_COMPANY_EXPLORER_FIND_REQUESTED = "mangorts:company-explorer-find-requested";
export const EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED = "mangorts:company-explorer-entity-activated";
export const EVENT_HUDDLE_EXPLORER_FIND_REQUESTED = "mangorts:huddle-explorer-find-requested";

export type ExplorerContextUpdatedDetail = {
  companyID: string;
  kind: "company_explorer" | "huddle_explorer";
};

export function emitDashboardEvent<T>(eventName: string, detail: T): void {
  window.dispatchEvent(new CustomEvent<T>(eventName, { detail }));
}

export function emitExplorerContextUpdated(detail: ExplorerContextUpdatedDetail): void {
  if (typeof window === "undefined") return;
  emitDashboardEvent(EVENT_EXPLORER_CONTEXT_UPDATED, detail);
}
