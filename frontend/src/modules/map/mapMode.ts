export type MapMode = "node" | "logic_gate";

type LiveSelectionLike = {
  companyID?: string;
  changedAt?: number;
  entityKind?: string;
  folderKind?: string;
};

export function contextTimestamp(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { ts?: unknown };
    return typeof parsed.ts === "number" && Number.isFinite(parsed.ts) ? parsed.ts : 0;
  } catch {
    return 0;
  }
}

export function resolveInitialMapMode({
  initialMode,
  nodeContextValue,
  logicGateContextValue,
}: {
  initialMode: MapMode;
  nodeContextValue: string | null;
  logicGateContextValue: string | null;
}): MapMode {
  const nodeTs = contextTimestamp(nodeContextValue);
  const logicGateTs = contextTimestamp(logicGateContextValue);
  if (logicGateTs <= 0 && nodeTs <= 0) return initialMode;
  return logicGateTs > nodeTs ? "logic_gate" : "node";
}

export function resolveMapModeFromLiveSelection(
  selection: LiveSelectionLike,
  {
    companyID,
    nodeContextValue,
    logicGateContextValue,
  }: {
    companyID: string;
    nodeContextValue: string | null;
    logicGateContextValue: string | null;
  },
): MapMode | null {
  if (selection.companyID !== companyID) return null;
  const latestExplorerContextTimestamp = Math.max(
    contextTimestamp(nodeContextValue),
    contextTimestamp(logicGateContextValue),
  );
  if (latestExplorerContextTimestamp > 0 && (selection.changedAt ?? 0) < latestExplorerContextTimestamp) {
    return null;
  }
  if (selection.entityKind === "logic_gate" || selection.folderKind === "logic_gate") return "logic_gate";
  if (selection.entityKind === "node" || selection.folderKind === "node") return "node";
  return null;
}
