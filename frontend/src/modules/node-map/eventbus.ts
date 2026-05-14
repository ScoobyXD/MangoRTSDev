// Shared browser event names used for module-to-module synchronization.
export const EVENT_FRAME_LINK_GRAPH_UPDATED = "mangorts:frame-link-graph-updated";
export const EVENT_NODE_MAP_SELECTION_UPDATED = "mangorts:node-map-selection-updated";
export const EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED = "mangorts:logic-gate-map-selection-updated";
export const EVENT_EXPLORER_CONTEXT_UPDATED = "mangorts:explorer-context-updated";
export const EVENT_NODE_MAP_FOCUS_REQUESTED = "mangorts:node-map-focus-requested";
export const EVENT_LOGIC_GATE_MAP_FOCUS_REQUESTED = "mangorts:logic-gate-map-focus-requested";
export const EVENT_COMPANY_EXPLORER_FIND_REQUESTED = "mangorts:company-explorer-find-requested";
export const EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED = "mangorts:company-explorer-entity-activated";

// Typed CustomEvent emitter so modules can react without tight component coupling.
export function emitDashboardEvent<T>(eventName: string, detail: T): void {
  window.dispatchEvent(new CustomEvent<T>(eventName, { detail }));
}
