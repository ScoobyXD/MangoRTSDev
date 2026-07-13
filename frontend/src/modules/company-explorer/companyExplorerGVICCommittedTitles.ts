import type { GVICMatrixProjectionRow } from "../kanban/kanbanApi.js";
import type { CommittedEntityTitleUpdate } from "./companyExplorerLocalEntityUpdates.js";

export type GVICProjectionLogicGateTitleRecord = {
  company_id: string;
  logic_gate_id: string;
  header: string;
  title?: string;
};

export type GVICProjectionTitleCacheEntry<TLogicGate extends GVICProjectionLogicGateTitleRecord> = {
  rows: GVICMatrixProjectionRow[];
  logicGates: TLogicGate[];
  loaded: boolean;
};

function cleanUpdate(update: CommittedEntityTitleUpdate, activeCompanyID: string): {
  companyID: string;
  resourceID: string;
  title: string;
} | null {
  const companyID = activeCompanyID.trim();
  const resourceID = update.resourceID.trim();
  const title = update.title.trim();
  if (!companyID || update.companyID.trim() !== companyID || !resourceID || !title) return null;
  return { companyID, resourceID, title };
}

export function reconcileGVICProjectionRowTitles(
  rows: GVICMatrixProjectionRow[],
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): GVICMatrixProjectionRow[] {
  const clean = cleanUpdate(update, activeCompanyID);
  if (!clean) return rows;
  let changed = false;
  const next = rows.map((row) => {
    if (row.company_id.trim() !== clean.companyID) return row;
    if (update.entityType === "node") {
      if (row.node_id.trim() !== clean.resourceID || row.node_name === clean.title) return row;
      changed = true;
      return { ...row, node_name: clean.title };
    }
    if (row.logic_gate_id?.trim() !== clean.resourceID || row.logic_gate_name === clean.title) return row;
    changed = true;
    return { ...row, logic_gate_name: clean.title };
  });
  return changed ? next : rows;
}

export function reconcileGVICProjectionLogicGateTitles<TLogicGate extends GVICProjectionLogicGateTitleRecord>(
  logicGates: TLogicGate[],
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): TLogicGate[] {
  const clean = cleanUpdate(update, activeCompanyID);
  if (!clean || update.entityType !== "logic_gate") return logicGates;
  let changed = false;
  const next = logicGates.map((logicGate) => {
    if (
      logicGate.company_id.trim() !== clean.companyID
      || logicGate.logic_gate_id.trim() !== clean.resourceID
      || logicGate.header === clean.title && logicGate.title === clean.title
    ) return logicGate;
    changed = true;
    return { ...logicGate, header: clean.title, title: clean.title };
  });
  return changed ? next : logicGates;
}

export function reconcileGVICProjectionTitlesByUserID<TLogicGate extends GVICProjectionLogicGateTitleRecord>(
  projectionByUserID: Record<string, GVICProjectionTitleCacheEntry<TLogicGate>>,
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): Record<string, GVICProjectionTitleCacheEntry<TLogicGate>> {
  let changed = false;
  const next: Record<string, GVICProjectionTitleCacheEntry<TLogicGate>> = {};
  for (const [userID, entry] of Object.entries(projectionByUserID)) {
    const rows = reconcileGVICProjectionRowTitles(entry.rows, update, activeCompanyID);
    const logicGates = reconcileGVICProjectionLogicGateTitles(entry.logicGates, update, activeCompanyID);
    if (rows === entry.rows && logicGates === entry.logicGates) next[userID] = entry;
    else {
      changed = true;
      next[userID] = { ...entry, rows, logicGates };
    }
  }
  return changed ? next : projectionByUserID;
}
