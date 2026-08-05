import type { CommittedEntityTitleUpdate } from "../realtime/committedEntityTitleUpdates.js";
import type { LogicGateRecord } from "../logic-gates/types.js";
import type { NodeRecord } from "../nodes/types.js";
import {
  reconcileCommittedLogicGateRecordTitles,
  reconcileCommittedNodeTitleInSnapshot,
} from "../realtime/committedTitleSnapshotReconciliation.js";

type ProjectManagementWorkspaceTitleState = {
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
};

type ProjectResourceDisplayTitleRecord = {
  company_id: string;
  resource_type?: "node" | "logic_gate" | "";
  resource_id?: string;
  node_id?: string | null;
  logic_gate_id?: string | null;
  display_title?: string;
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

export function reconcileProjectResourceDisplayTitles<T extends ProjectResourceDisplayTitleRecord>(
  records: T[],
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): T[] {
  const clean = cleanUpdate(update, activeCompanyID);
  if (!clean) return records;
  let changed = false;
  const next = records.map((record) => {
    const resourceID = update.entityType === "node"
      ? record.node_id?.trim() || record.resource_id?.trim() || ""
      : record.logic_gate_id?.trim() || record.resource_id?.trim() || "";
    if (
      record.company_id.trim() !== clean.companyID
      || record.resource_type !== update.entityType
      || resourceID !== clean.resourceID
      || record.display_title === clean.title
    ) return record;
    changed = true;
    return { ...record, display_title: clean.title };
  });
  return changed ? next : records;
}

export function reconcileProjectManagementWorkspaceTitles<T extends ProjectManagementWorkspaceTitleState>(
  workspace: T,
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): T {
  const clean = cleanUpdate(update, activeCompanyID);
  if (!clean) return workspace;
  const nodes = reconcileCommittedNodeTitleInSnapshot(workspace.nodes, update);
  const logicGates = reconcileCommittedLogicGateRecordTitles(workspace.logicGates, update);
  return nodes !== workspace.nodes || logicGates !== workspace.logicGates
    ? { ...workspace, nodes, logicGates }
    : workspace;
}


export function reconcileSelectedNodeTitle<T extends { nodeID: string; title: string }>(
  selection: T | null,
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): T | null {
  const clean = cleanUpdate(update, activeCompanyID);
  if (!selection || !clean || update.entityType !== "node" || selection.nodeID.trim() !== clean.resourceID || selection.title === clean.title) return selection;
  return { ...selection, title: clean.title };
}

export function reconcileRelationshipContextTitle<T extends { resourceType: "node" | "logic_gate"; resourceID: string; displayTitle: string }>(
  target: T | undefined,
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): T | undefined {
  const clean = cleanUpdate(update, activeCompanyID);
  if (
    !target
    || !clean
    || target.resourceType !== update.entityType
    || target.resourceID.trim() !== clean.resourceID
    || target.displayTitle === clean.title
  ) return target;
  return { ...target, displayTitle: clean.title };
}
