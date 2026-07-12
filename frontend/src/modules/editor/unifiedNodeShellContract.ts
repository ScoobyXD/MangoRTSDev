export const UNIFIED_NODE_SHELL_BEHAVIOR_SOURCE = "UnifiedNodeShell";

export type UnifiedNodeShellSurfaceID =
  | "home-node-popup"
  | "app-sidebar-node-popup"
  | "dock-restored-node-popup"
  | "updates-node-panel"
  | "kanban-my-work-node-overlay"
  | "project-critical-path-inline-node"
  | "project-relationships-node-panel";

export type UnifiedNodeShellActionID =
  | "close"
  | "fullscreen"
  | "minimize"
  | "open-in-new-tab"
  | "pin"
  | "delete";

export type UnifiedNodeShellBodyID = "node-workspace";
export type UnifiedNodeShellPersistenceBoundary = "node-information-projection";

export type UnifiedNodeShellSurfaceContract = {
  id: UnifiedNodeShellSurfaceID;
  body: UnifiedNodeShellBodyID;
  persistenceBoundary: UnifiedNodeShellPersistenceBoundary;
  openerState: "opener-owned";
  chatPane: "separate";
  actions: readonly UnifiedNodeShellActionID[];
};

export const UNIFIED_NODE_SHELL_TOP_RIGHT_ACTION_ORDER: readonly UnifiedNodeShellActionID[] = [
  "close",
  "fullscreen",
  "minimize",
  "open-in-new-tab",
  "pin",
  "delete",
] as const;

export const UNIFIED_NODE_SHELL_SURFACE_CONTRACTS: readonly UnifiedNodeShellSurfaceContract[] = [
  {
    id: "home-node-popup",
    body: "node-workspace",
    persistenceBoundary: "node-information-projection",
    openerState: "opener-owned",
    chatPane: "separate",
    actions: ["close", "fullscreen", "minimize", "pin", "delete"],
  },
  {
    id: "app-sidebar-node-popup",
    body: "node-workspace",
    persistenceBoundary: "node-information-projection",
    openerState: "opener-owned",
    chatPane: "separate",
    actions: ["close", "fullscreen", "minimize", "open-in-new-tab", "pin", "delete"],
  },
  {
    id: "dock-restored-node-popup",
    body: "node-workspace",
    persistenceBoundary: "node-information-projection",
    openerState: "opener-owned",
    chatPane: "separate",
    actions: ["close", "fullscreen", "minimize", "open-in-new-tab", "pin", "delete"],
  },
  {
    id: "updates-node-panel",
    body: "node-workspace",
    persistenceBoundary: "node-information-projection",
    openerState: "opener-owned",
    chatPane: "separate",
    actions: ["close", "open-in-new-tab", "pin"],
  },
  {
    id: "kanban-my-work-node-overlay",
    body: "node-workspace",
    persistenceBoundary: "node-information-projection",
    openerState: "opener-owned",
    chatPane: "separate",
    actions: ["close", "fullscreen", "minimize", "open-in-new-tab", "pin", "delete"],
  },
  {
    id: "project-critical-path-inline-node",
    body: "node-workspace",
    persistenceBoundary: "node-information-projection",
    openerState: "opener-owned",
    chatPane: "separate",
    actions: ["close", "open-in-new-tab", "pin"],
  },
  {
    id: "project-relationships-node-panel",
    body: "node-workspace",
    persistenceBoundary: "node-information-projection",
    openerState: "opener-owned",
    chatPane: "separate",
    actions: ["close", "fullscreen", "open-in-new-tab", "pin"],
  },
] as const;
