export const EVENT_EDITOR_LINKS_UPDATED = "mangoos:editor-links-updated";
export const EVENT_NODE_MAP_STATE_UPDATED = "mangoos:node-map-state-updated";
export const EVENT_EXPLORER_CONTEXT_UPDATED = "mangoos:explorer-context-updated";

export function emitDashboardEvent<T>(eventName: string, detail: T): void {
  window.dispatchEvent(new CustomEvent<T>(eventName, { detail }));
}
