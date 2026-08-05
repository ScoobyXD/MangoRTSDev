export const EVENT_FRAME_LINK_GRAPH_UPDATED = "mangorts:frame-link-graph-updated";
export const EVENT_EXPLORER_CONTEXT_UPDATED = "mangorts:explorer-context-updated";
export const EVENT_COMPANY_EXPLORER_FIND_REQUESTED = "mangorts:company-explorer-find-requested";
export const EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED = "mangorts:company-explorer-entity-activated";

export function emitDashboardEvent<T>(eventName: string, detail: T): void {
  window.dispatchEvent(new CustomEvent<T>(eventName, { detail }));
}
