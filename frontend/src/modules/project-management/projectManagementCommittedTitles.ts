import type { CommittedEntityTitleUpdate } from "../company-explorer/companyExplorerLocalEntityUpdates.js";
import type { CompanyExplorerSearchResult } from "../company-explorer/companyExplorerLazyApi.js";
import type { LogicGateRecord } from "../logic-gate-map/shared.js";
import type { NodeRecord } from "../node-map/shared.js";
import type {
  ProjectCriticalPathStep,
  ProjectManagementTimelineRow,
  ProjectRelationshipProjection,
} from "./projectManagementApi.js";

export type ProjectManagementWorkspaceTitleState = {
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
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

function timelineRowMatches(row: ProjectManagementTimelineRow, update: CommittedEntityTitleUpdate, resourceID: string): boolean {
  if (row.resource_type !== update.entityType) return false;
  if (update.entityType === "node") return (row.node_id?.trim() || row.resource_id.trim()) === resourceID;
  return (row.logic_gate_id?.trim() || row.resource_id.trim()) === resourceID;
}

function relationshipMatches(row: ProjectRelationshipProjection, update: CommittedEntityTitleUpdate, resourceID: string): boolean {
  if (row.resource_type !== update.entityType) return false;
  if (update.entityType === "node") return (row.node_id?.trim() || row.resource_id.trim()) === resourceID;
  return (row.logic_gate_id?.trim() || row.resource_id.trim()) === resourceID;
}

function criticalPathStepMatches(step: ProjectCriticalPathStep, update: CommittedEntityTitleUpdate, resourceID: string): boolean {
  if (step.resource_type !== update.entityType) return false;
  if (update.entityType === "node") return (step.node_id?.trim() || step.resource_id?.trim() || "") === resourceID;
  return (step.logic_gate_id?.trim() || step.resource_id?.trim() || "") === resourceID;
}

export function reconcileProjectManagementTimelineTitles(
  rows: ProjectManagementTimelineRow[],
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): ProjectManagementTimelineRow[] {
  const clean = cleanUpdate(update, activeCompanyID);
  if (!clean) return rows;
  let changed = false;
  const next = rows.map((row) => {
    if (row.company_id.trim() !== clean.companyID || !timelineRowMatches(row, update, clean.resourceID) || row.display_title === clean.title) return row;
    changed = true;
    return { ...row, display_title: clean.title };
  });
  return changed ? next : rows;
}

export function reconcileProjectManagementWorkspaceTitles<T extends ProjectManagementWorkspaceTitleState>(
  workspace: T,
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): T {
  const clean = cleanUpdate(update, activeCompanyID);
  if (!clean) return workspace;
  let nodesChanged = false;
  let logicGatesChanged = false;
  const nodes = update.entityType === "node" ? workspace.nodes.map((node) => {
    if (node.company_id.trim() !== clean.companyID || node.node_id.trim() !== clean.resourceID || node.name === clean.title) return node;
    nodesChanged = true;
    return { ...node, name: clean.title };
  }) : workspace.nodes;
  const logicGates = update.entityType === "logic_gate" ? workspace.logicGates.map((gate) => {
    if (gate.company_id.trim() !== clean.companyID || gate.logic_gate_id.trim() !== clean.resourceID || gate.header === clean.title) return gate;
    logicGatesChanged = true;
    return { ...gate, header: clean.title };
  }) : workspace.logicGates;
  return nodesChanged || logicGatesChanged ? { ...workspace, nodes, logicGates } : workspace;
}

export function reconcileProjectRelationshipTitles(
  relationships: ProjectRelationshipProjection[],
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): ProjectRelationshipProjection[] {
  const clean = cleanUpdate(update, activeCompanyID);
  if (!clean) return relationships;
  let changed = false;
  const next = relationships.map((relationship) => {
    if (
      relationship.company_id.trim() !== clean.companyID
      || !relationshipMatches(relationship, update, clean.resourceID)
      || relationship.display_title === clean.title
    ) return relationship;
    changed = true;
    return { ...relationship, display_title: clean.title };
  });
  return changed ? next : relationships;
}

export function reconcileProjectCriticalPathTitles(
  steps: ProjectCriticalPathStep[],
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): ProjectCriticalPathStep[] {
  const clean = cleanUpdate(update, activeCompanyID);
  if (!clean) return steps;
  let changed = false;
  const next = steps.map((step) => {
    if (
      step.company_id.trim() !== clean.companyID
      || !criticalPathStepMatches(step, update, clean.resourceID)
      || step.display_title === clean.title
    ) return step;
    changed = true;
    return { ...step, display_title: clean.title };
  });
  return changed ? next : steps;
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

export function reconcileProjectNodePickerTitles(
  results: CompanyExplorerSearchResult[],
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): CompanyExplorerSearchResult[] {
  const clean = cleanUpdate(update, activeCompanyID);
  if (!clean || update.entityType !== "node") return results;
  let changed = false;
  const next = results.map((result) => {
    if (result.company_id.trim() !== clean.companyID) return result;
    const matchesResult = result.resource_type === "node" && result.resource_id.trim() === clean.resourceID;
    let pathChanged = false;
    const locationPath = result.location_path.map((segment) => {
      if (
        segment.entity_type !== "node"
        || (segment.resource_id?.trim() || segment.entity_id.trim()) !== clean.resourceID
        || segment.name === clean.title
      ) return segment;
      pathChanged = true;
      return { ...segment, name: clean.title };
    });
    if (!matchesResult && !pathChanged) return result;
    if (matchesResult && result.display_name !== clean.title || pathChanged) changed = true;
    return {
      ...result,
      display_name: matchesResult ? clean.title : result.display_name,
      location_path: pathChanged ? locationPath : result.location_path,
    };
  });
  return changed ? next : results;
}
