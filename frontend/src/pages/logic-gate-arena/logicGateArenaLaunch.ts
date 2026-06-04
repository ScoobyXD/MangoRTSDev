export type PendingLogicGateArenaSelection = {
  companyID: string;
  logicGateID: string;
  label: string;
  nodeID?: string;
  informationID?: string;
  suppressWorkspaceStream?: boolean;
  createdAt: number;
};

const PENDING_SELECTION_STORAGE_KEY_PREFIX = "mangorts.logic-gate-arena.pending-selection.v1";

function pendingSelectionStorageKey(companyID: string): string {
  return `${PENDING_SELECTION_STORAGE_KEY_PREFIX}:${companyID.trim() || "default"}`;
}

function parsePendingLogicGateArenaSelection(companyID: string, raw: string): PendingLogicGateArenaSelection | null {
  const parsed = JSON.parse(raw) as Partial<PendingLogicGateArenaSelection>;
  const logicGateID = typeof parsed.logicGateID === "string" ? parsed.logicGateID.trim() : "";
  if (!logicGateID) return null;
  return {
    companyID,
    logicGateID,
    label: typeof parsed.label === "string" ? parsed.label.trim() : "",
    nodeID: typeof parsed.nodeID === "string" ? parsed.nodeID.trim() : undefined,
    informationID: typeof parsed.informationID === "string" ? parsed.informationID.trim() : undefined,
    suppressWorkspaceStream: parsed.suppressWorkspaceStream === true,
    createdAt: typeof parsed.createdAt === "number" && Number.isFinite(parsed.createdAt) ? parsed.createdAt : Date.now(),
  };
}

export function writePendingLogicGateArenaSelection(selection: Omit<PendingLogicGateArenaSelection, "createdAt">): void {
  const logicGateID = selection.logicGateID.trim();
  if (!logicGateID) return;
  try {
    localStorage.setItem(pendingSelectionStorageKey(selection.companyID), JSON.stringify({
      companyID: selection.companyID,
      logicGateID,
      label: selection.label.trim(),
      nodeID: selection.nodeID?.trim() || undefined,
      informationID: selection.informationID?.trim() || undefined,
      suppressWorkspaceStream: selection.suppressWorkspaceStream === true || undefined,
      createdAt: Date.now(),
    }));
  } catch {
    // Navigation should still work if localStorage is unavailable.
  }
}

export function readPendingLogicGateArenaSelection(companyID: string): PendingLogicGateArenaSelection | null {
  const key = pendingSelectionStorageKey(companyID);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return parsePendingLogicGateArenaSelection(companyID, raw);
  } catch {
    return null;
  }
}

export function consumePendingLogicGateArenaSelection(companyID: string): PendingLogicGateArenaSelection | null {
  const key = pendingSelectionStorageKey(companyID);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    localStorage.removeItem(key);
    return parsePendingLogicGateArenaSelection(companyID, raw);
  } catch {
    return null;
  }
}
