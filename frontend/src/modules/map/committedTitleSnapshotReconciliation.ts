import type { CommittedEntityTitleUpdate } from "../company-explorer/companyExplorerLocalEntityUpdates.js";

export function reconcileCommittedNodeTitleInSnapshot<T extends { node_id: string; name?: string }>(
  nodes: T[],
  update: CommittedEntityTitleUpdate,
): T[] {
  if (update.entityType !== "node") return nodes;
  const resourceID = update.resourceID.trim();
  const title = update.title.trim();
  if (!resourceID || !title) return nodes;
  let changed = false;
  const next = nodes.map((node) => {
    if (node.node_id !== resourceID || node.name === title) return node;
    changed = true;
    return { ...node, name: title };
  });
  return changed ? next : nodes;
}

export function reconcileCommittedLogicGateTitleInSnapshot<T extends {
  node_id: string;
  header?: string;
  title?: string;
}>(
  nodes: T[],
  update: CommittedEntityTitleUpdate,
): T[] {
  if (update.entityType !== "logic_gate") return nodes;
  const resourceID = update.resourceID.trim();
  const title = update.title.trim();
  if (!resourceID || !title) return nodes;
  let changed = false;
  const next = nodes.map((node) => {
    if (node.node_id !== resourceID || (node.header === title && node.title === title)) return node;
    changed = true;
    return { ...node, header: title, title };
  });
  return changed ? next : nodes;
}

export function reconcileCommittedLogicGateRecordTitles<T extends { logic_gate_id: string; header: string }>(
  logicGates: T[],
  update: CommittedEntityTitleUpdate,
): T[] {
  if (update.entityType !== "logic_gate") return logicGates;
  const resourceID = update.resourceID.trim();
  const title = update.title.trim();
  if (!resourceID || !title) return logicGates;
  let changed = false;
  const next = logicGates.map((logicGate) => {
    if (logicGate.logic_gate_id !== resourceID || logicGate.header === title) return logicGate;
    changed = true;
    return { ...logicGate, header: title };
  });
  return changed ? next : logicGates;
}
