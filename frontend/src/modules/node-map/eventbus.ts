// Shared browser event names used for module-to-module synchronization.
export const EVENT_FRAME_LINK_GRAPH_UPDATED = "mangoos:frame-link-graph-updated";
export const EVENT_NODE_MAP_SELECTION_UPDATED = "mangoos:node-map-selection-updated";
export const EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED = "mangoos:logic-gate-map-selection-updated";
export const EVENT_EXPLORER_CONTEXT_UPDATED = "mangoos:explorer-context-updated";
export const EVENT_NODE_MAP_FOCUS_REQUESTED = "mangoos:node-map-focus-requested";
export const EVENT_LOGIC_GATE_MAP_FOCUS_REQUESTED = "mangoos:logic-gate-map-focus-requested";
export const EVENT_COMPANY_EXPLORER_FIND_REQUESTED = "mangoos:company-explorer-find-requested";

// Typed CustomEvent emitter so modules can react without tight component coupling.
export function emitDashboardEvent<T>(eventName: string, detail: T): void {
  window.dispatchEvent(new CustomEvent<T>(eventName, { detail }));
}
