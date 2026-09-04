import { requestJSON } from "../api/requestJSON.js";
import { emitExplorerContextUpdated } from "../dashboardEvents.js";
import type { Account } from "../accounts/accountsApi.js";
import type { CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import type { LogicGateRACIRole, LogicGateRecord } from "../logic-gates/types.js";
import type { NodeRecord } from "../nodes/types.js";
import type { ProcessNodeAssignment, ProcessStep, ProcessStepRelationship } from "./processWork.js";
import { invalidateLogicGateArenaViewCache } from "./ProcessWorkStore.js";
export * from "./processWork.js";
export { getProcessWorkSingleFlight, getCachedProcessWork, invalidateLogicGateArenaViewCache, reconcileProcessWorkTitles, clearProcessWorkCache } from "./ProcessWorkStore.js";

export const PROCESS_WORK_UPDATED_EVENT = "mangorts:process-work-updated";
export function dispatchLogicGateWorkUpdated(companyID: string, logicGateID: string): void {
  if (typeof window !== "undefined" && logicGateID) window.dispatchEvent(new CustomEvent(PROCESS_WORK_UPDATED_EVENT, { detail: { companyID, logicGateID } }));
}

export type ProcessNodeStatePatch = {
  status?: string;
  process_step_id?: string | null;
  is_issue?: boolean;
  priority?: number | null;
  position?: number;
};

export async function changeProcessNodeState(apiBase: string, companyID: string, logicGateID: string, nodeID: string, patch: ProcessNodeStatePatch): Promise<LogicGateAssignmentCommandResult> {
  const result = await requestJSON<LogicGateAssignmentCommandResult>(apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/nodes/${encodeURIComponent(nodeID)}/state`, {
    method: "PUT", json: { company_id: companyID, ...patch, mutation_origin: "kanban" },
  });
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
  dispatchLogicGateWorkUpdated(companyID, logicGateID);
  return result;
}

export async function createProcessNode(apiBase: string, companyID: string, logicGateID: string, name: string, patch: ProcessNodeStatePatch): Promise<LogicGateAssignmentCommandResult> {
  const result = await requestJSON<LogicGateAssignmentCommandResult>(apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/nodes`, {
    method: "POST", json: { company_id: companyID, create_node_title: name, ...patch, mutation_origin: "kanban" },
  });
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
  dispatchLogicGateWorkUpdated(companyID, logicGateID);
  return result;
}

async function mutateProcess<T>(apiBase: string, companyID: string, logicGateID: string, suffix: string, method: "POST" | "PATCH" | "DELETE", body?: object): Promise<T> {
  const query = method === "DELETE" ? `?${new URLSearchParams({ company_id: companyID })}` : "";
  const result = await requestJSON<T>(apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/${suffix}${query}`, { method, ...(method !== "DELETE" ? { json: { company_id: companyID, ...body } } : {}) });
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
  dispatchLogicGateWorkUpdated(companyID, logicGateID);
  return result;
}

export type ProcessStepMutationResult = { step?: ProcessStep; relationship?: ProcessStepRelationship; position_updates?: Record<string, number> };
export function createProcessStep(apiBase: string, companyID: string, logicGateID: string, name: string, afterProcessStepID?: string): Promise<ProcessStepMutationResult> {
  return mutateProcess(apiBase, companyID, logicGateID, "steps", "POST", { name, after_process_step_id: afterProcessStepID });
}
export function updateProcessStep(apiBase: string, companyID: string, logicGateID: string, stepID: string, patch: { name?: string; position?: number }): Promise<ProcessStepMutationResult> {
  return mutateProcess(apiBase, companyID, logicGateID, `steps/${encodeURIComponent(stepID)}`, "PATCH", patch);
}
export function deleteProcessStep(apiBase: string, companyID: string, logicGateID: string, stepID: string): Promise<void> {
  return mutateProcess(apiBase, companyID, logicGateID, `steps/${encodeURIComponent(stepID)}`, "DELETE");
}
export function createProcessStepRelationship(apiBase: string, companyID: string, logicGateID: string, sourceID: string, targetID: string): Promise<ProcessStepMutationResult> {
  return mutateProcess(apiBase, companyID, logicGateID, "step-relationships", "POST", { source: { resource_type: "process_step", resource_id: sourceID }, target: { resource_type: "process_step", resource_id: targetID } });
}
export function deleteProcessStepRelationship(apiBase: string, companyID: string, logicGateID: string, relationshipID: string): Promise<void> {
  return mutateProcess(apiBase, companyID, logicGateID, `step-relationships/${encodeURIComponent(relationshipID)}`, "DELETE");
}
function reconcileCommittedCrossLogicGateAssignment(args: { apiBase: string; companyID: string; logicGateID: string; fromLogicGateID: string; nodeID: string }): void {
  for (const processID of new Set([args.logicGateID, args.fromLogicGateID])) {
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, processID);
    dispatchLogicGateWorkUpdated(args.companyID, processID);
  }
}
export type RACIMatrixProjectionRow = {
  company_id: string;
  projection_row_id: string;
  user_id: string;
  node_name: string;
  gvic_assignment?: string;
  responsible_user_ids?: string[];
  priority?: number;
  project_id?: string;
  project_name?: string;
  logic_gate_id?: string;
  logic_gate_name?: string;
  node_id: string;
  status?: string;
  due_date?: string;
  accounts?: Account[];
  created_timestamp: string;
  updated_timestamp: string;
  sort_order?: number;
};

export type LogicGateAssignmentCommandResult = { assignment: ProcessNodeAssignment; node: NodeRecord; gvic_projection_rows: RACIMatrixProjectionRow[] };
type LogicGateAssignmentMutationOrigin = "company_explorer" | "kanban" | "matrix";

export type RACIMatrixNodeCreateResult = {
  node: NodeRecord;
  logic_gate?: LogicGateRecord;

  assignment?: ProcessNodeAssignment;
  folder_items?: CompanyExplorerFolderItem[];
  gvic_projection_rows: RACIMatrixProjectionRow[];
};

type LogicGateAssignmentCommandPayload = Omit<LogicGateAssignmentCommandResult, "gvic_projection_rows"> & {
  gvic_projection_rows?: RACIMatrixProjectionRow[] | null;
};

type RACIMatrixNodeCreatePayload = Omit<RACIMatrixNodeCreateResult, "gvic_projection_rows"> & {
  gvic_projection_rows?: RACIMatrixProjectionRow[] | null;
};

function normalizeRACIMatrixProjectionRows(rows?: RACIMatrixProjectionRow[] | null): RACIMatrixProjectionRow[] {
  return Array.isArray(rows) ? rows : [];
}

function normalizeLogicGateAssignmentCommandResult(payload: LogicGateAssignmentCommandPayload): LogicGateAssignmentCommandResult {
  return {
    assignment: { ...payload.assignment },
    node: { ...payload.node },
    gvic_projection_rows: normalizeRACIMatrixProjectionRows(payload.gvic_projection_rows),
  };
}

export async function createRACIMatrixNode(args: {
  apiBase: string;
  companyID: string;
  name: string;
  logicGateID?: string;
  createLogicGateHeader?: string;
  creatorLogicGateRACIRole?: LogicGateRACIRole;
  status?: string;
  processStepID?: string | null;
  priority?: number | null;
  position?: number;
  isIssue?: boolean;
}): Promise<RACIMatrixNodeCreateResult> {
  const payload = await requestJSON<RACIMatrixNodeCreatePayload>(args.apiBase, "/v2/gvic-matrix/nodes", {
    method: "POST",
    json: {
      company_id: args.companyID,
      name: args.name,
      logic_gate_id: args.logicGateID,
      create_logic_gate_header: args.createLogicGateHeader,
      creator_logic_gate_gvic_role: args.creatorLogicGateRACIRole,
      mutation_origin: "matrix",
      status: args.status,
      process_step_id: args.processStepID,
      priority: args.priority,
      position: args.position,
      is_issue: args.isIssue,
    },
  });
  if (payload.logic_gate?.logic_gate_id) {
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, payload.logic_gate.logic_gate_id);
  }
  dispatchLogicGateWorkUpdated(args.companyID, payload.logic_gate?.logic_gate_id ?? payload.assignment?.logic_gate_id ?? args.logicGateID ?? "");
  return {
    ...payload,
    gvic_projection_rows: normalizeRACIMatrixProjectionRows(payload.gvic_projection_rows),
  };
}

export async function assignNodeToLogicGateStatus(args: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  nodeID: string;
  status?: string;
  processStepID?: string | null;
  priority?: number | null;
  nodeTitle?: string;
  createNodeTitle?: string;
  position?: number;
  isIssue?: boolean;
  mutationOrigin?: LogicGateAssignmentMutationOrigin;
}): Promise<LogicGateAssignmentCommandResult> {
  const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/logic-gates/${encodeURIComponent(args.logicGateID)}/nodes`, {
    method: "POST",
    json: {
      company_id: args.companyID,
      node_id: args.nodeID,
      status: args.status,
      process_step_id: args.processStepID,
      priority: args.priority,
      node_title: args.nodeTitle,
      create_node_title: args.createNodeTitle,
      mutation_origin: args.mutationOrigin ?? "matrix",
      position: args.position,
      is_issue: args.isIssue,
    },
  });
  invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, args.logicGateID);
  dispatchLogicGateWorkUpdated(args.companyID, args.logicGateID);
  emitExplorerContextUpdated({ companyID: args.companyID, kind: "company_explorer" });
  return normalizeLogicGateAssignmentCommandResult(payload);
}

export async function moveLogicGateAssignment(args: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  nodeID: string;
  fromLogicGateID?: string;
  status?: string;
  processStepID?: string | null;
  position?: number;
  priority?: number | null;
  mutationOrigin?: LogicGateAssignmentMutationOrigin;
}): Promise<LogicGateAssignmentCommandResult> {
  const logicGateID = args.logicGateID.trim();
  const fromLogicGateID = args.fromLogicGateID?.trim() ?? "";
  if (!fromLogicGateID || fromLogicGateID === logicGateID) {
    const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/logic-gates/${encodeURIComponent(args.logicGateID)}/nodes/${encodeURIComponent(args.nodeID)}/state`, {
      method: "PUT",
      json: {
        company_id: args.companyID,
        status: args.status,
      process_step_id: args.processStepID,
        mutation_origin: args.mutationOrigin ?? "matrix",
        position: args.position,
        priority: args.priority,
      },
    });
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, args.logicGateID);
    dispatchLogicGateWorkUpdated(args.companyID, args.logicGateID);
    return normalizeLogicGateAssignmentCommandResult(payload);
  }
  const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/gvic-matrix/nodes/${encodeURIComponent(args.nodeID)}/move`, {
    method: "POST",
    json: {
      company_id: args.companyID,
      to_logic_gate_id: logicGateID,
      from_logic_gate_id: fromLogicGateID,
      status: args.status,
      process_step_id: args.processStepID,
      mutation_origin: args.mutationOrigin ?? "matrix",
      position: args.position,
      priority: args.priority,
    },
  });
  reconcileCommittedCrossLogicGateAssignment({
    apiBase: args.apiBase,
    companyID: args.companyID,
    logicGateID,
    fromLogicGateID,
    nodeID: args.nodeID,
  });
  emitExplorerContextUpdated({ companyID: args.companyID, kind: "company_explorer" });
  return normalizeLogicGateAssignmentCommandResult(payload);
}

export async function removeLogicGateAssignment(args: {
  apiBase: string;
  companyID: string;
  logicGateID?: string;
  nodeID: string;
  fallbackStatus?: string | null;
}): Promise<LogicGateAssignmentCommandResult> {
  const logicGateID = args.logicGateID?.trim() ?? "";
  if (logicGateID) {
    const params = new URLSearchParams({ company_id: args.companyID });
    if (args.fallbackStatus) params.set("fallback_status", args.fallbackStatus);
    const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/nodes/${encodeURIComponent(args.nodeID)}?${params}`, {
      method: "DELETE",
    });
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, logicGateID);
    dispatchLogicGateWorkUpdated(args.companyID, logicGateID);
    emitExplorerContextUpdated({ companyID: args.companyID, kind: "company_explorer" });
    return normalizeLogicGateAssignmentCommandResult(payload);
  }
  const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, "/v1/work-items/logic-gate-assignments/remove", {
    method: "POST",
    json: {
      company_id: args.companyID,
      logic_gate_id: args.logicGateID,
      node_id: args.nodeID,
      fallback_status: args.fallbackStatus,
    },
  });
  invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, args.logicGateID);
  dispatchLogicGateWorkUpdated(args.companyID, args.logicGateID ?? "");
  emitExplorerContextUpdated({ companyID: args.companyID, kind: "company_explorer" });
  return normalizeLogicGateAssignmentCommandResult(payload);
}

export async function setLogicGateAssignmentIssue(args: {
  apiBase: string;
  companyID: string;
  logicGateID?: string;
  nodeID: string;
  isIssue: boolean;
}): Promise<LogicGateAssignmentCommandResult> {
  const logicGateID = args.logicGateID?.trim() ?? "";
  if (logicGateID) {
    const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/nodes/${encodeURIComponent(args.nodeID)}/state`, {
      method: "PUT",
      json: {
        company_id: args.companyID,
        is_issue: args.isIssue,
      },
    });
    invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, logicGateID);
    return normalizeLogicGateAssignmentCommandResult(payload);
  }
  const payload = await requestJSON<LogicGateAssignmentCommandPayload>(args.apiBase, "/v1/work-items/logic-gate-assignments/issue", {
    method: "POST",
    json: {
      company_id: args.companyID,
      logic_gate_id: args.logicGateID,
      node_id: args.nodeID,
      is_issue: args.isIssue,
    },
  });
  invalidateLogicGateArenaViewCache(args.apiBase, args.companyID, args.logicGateID);
  return normalizeLogicGateAssignmentCommandResult(payload);
}
