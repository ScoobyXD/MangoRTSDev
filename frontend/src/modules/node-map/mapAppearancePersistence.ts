export type NodeMapRelationshipRoleColors = {
  parent: string;
  peer: string;
  child: string;
};

export type LogicGateMapRelationshipRoleColors = {
  input: string;
  output: string;
};

export type MyTeraCardState = {
  expanded: boolean;
  enabled: boolean;
  rules: string;
  exclusions: string;
  relatedControls: string[];
  panelHeight?: number;
};

export type MyTeraCardStateByNodeID = Record<string, MyTeraCardState>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_MYTERA_TEXT_LENGTH = 8000;

const DEFAULT_NODE_MAP_ROLE_COLORS: NodeMapRelationshipRoleColors = {
  parent: "#64748b",
  peer: "#475569",
  child: "#64748b",
};

const DEFAULT_LOGIC_GATE_MAP_ROLE_COLORS: LogicGateMapRelationshipRoleColors = {
  input: "#475569",
  output: "#64748b",
};

export function createDefaultMyTeraCardState(): MyTeraCardState {
  return {
    expanded: false,
    enabled: false,
    rules: "",
    exclusions: "",
    relatedControls: [],
  };
}

export function effectiveMyTeraCardSize(
  baseSize: { w: number; h: number },
  state: MyTeraCardState | undefined,
  options: { minimumExpandedWidth?: number; minimumPanelHeight?: number } = {},
): { w: number; h: number } {
  if (!state?.enabled || !state.expanded) return { ...baseSize };
  const minimumExpandedWidth = options.minimumExpandedWidth ?? 300;
  const minimumPanelHeight = options.minimumPanelHeight ?? 228;
  const panelHeight = Math.max(minimumPanelHeight, state.panelHeight ?? minimumPanelHeight);
  return {
    w: Math.max(baseSize.w, minimumExpandedWidth),
    h: baseSize.h + panelHeight,
  };
}

function restoredColor(candidate: string | undefined, fallback: string): string {
  const value = candidate?.trim();
  return value && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

export function restoreNodeMapRelationshipRoleColors(
  saved: Partial<NodeMapRelationshipRoleColors> | null | undefined,
): NodeMapRelationshipRoleColors {
  return {
    parent: restoredColor(saved?.parent, DEFAULT_NODE_MAP_ROLE_COLORS.parent),
    peer: restoredColor(saved?.peer, DEFAULT_NODE_MAP_ROLE_COLORS.peer),
    child: restoredColor(saved?.child, DEFAULT_NODE_MAP_ROLE_COLORS.child),
  };
}

export function restoreLogicGateMapRelationshipRoleColors(
  saved: Partial<LogicGateMapRelationshipRoleColors> | null | undefined,
): LogicGateMapRelationshipRoleColors {
  return {
    input: restoredColor(saved?.input, DEFAULT_LOGIC_GATE_MAP_ROLE_COLORS.input),
    output: restoredColor(saved?.output, DEFAULT_LOGIC_GATE_MAP_ROLE_COLORS.output),
  };
}

export function restoreNodeSizes(
  saved: Record<string, { w?: number; h?: number }> | null | undefined,
  worldWidth: number,
  worldHeight: number,
): Record<string, { w: number; h: number }> {
  const restored: Record<string, { w: number; h: number }> = Object.create(null);
  for (const [nodeID, size] of Object.entries(saved ?? {}).slice(0, 2000)) {
    if (!nodeID || !size || !Number.isFinite(size.w) || !Number.isFinite(size.h)) continue;
    if (isReservedRecordKey(nodeID)) continue;
    restored[nodeID] = {
      w: snapClamp(size.w!, 108, worldWidth),
      h: snapClamp(size.h!, 72, worldHeight),
    };
  }
  return restored;
}

export function restoreMyTeraCardStates(
  saved: Record<string, Partial<MyTeraCardState> | null | undefined> | null | undefined,
  worldHeight: number,
): MyTeraCardStateByNodeID {
  const restored: MyTeraCardStateByNodeID = Object.create(null);
  for (const [nodeID, state] of Object.entries(saved ?? {}).slice(0, 2000)) {
    if (!nodeID || !state || typeof state !== "object") continue;
    if (isReservedRecordKey(nodeID)) continue;
    const relatedControls = Array.isArray(state.relatedControls)
      ? Array.from(new Set(state.relatedControls
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().slice(0, 64))
        .filter(Boolean)))
        .slice(0, 16)
      : [];
    restored[nodeID] = {
      expanded: state.expanded === true,
      rules: cleanText(state.rules),
      exclusions: cleanText(state.exclusions),
      enabled: state.enabled === true,
      relatedControls,
      ...(Number.isFinite(state.panelHeight)
        ? { panelHeight: snapClamp(state.panelHeight!, 96, worldHeight) }
        : {}),
    };
  }
  return restored;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_MYTERA_TEXT_LENGTH) : "";
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function snapClamp(value: number, minimum: number, maximum: number): number {
  return clampNumber(Math.round(value / 12) * 12, minimum, maximum);
}

function isReservedRecordKey(value: string): boolean {
  return value === "__proto__" || value === "constructor" || value === "prototype";
}
