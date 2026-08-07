import { requestJSON } from "../api/requestJSON.js";
import type { RACIMatrixProjectionRow } from "../kanban/kanbanApi.js";
import type { LogicGateRACIRole, LogicGateRecord } from "../logic-gates/types.js";
import type { NodeRecord } from "../nodes/types.js";

export type WorkItemInboxReadParams = {
  apiBase: string;
  companyID: string;
  targetUserID?: string;
  limit?: number;
};

export type WorkItemLogicGateInboxItem = LogicGateRecord & {
  roles: LogicGateRACIRole[];
};

export type ResponsibleInboxNodesResponse = {
  company_id: string;
  user_id: string;
  limit: number;
  nodes: NodeRecord[];
};

export type ACIInboxLogicGatesResponse = {
  company_id: string;
  user_id: string;
  limit: number;
  logic_gates: WorkItemLogicGateInboxItem[];
};

export type MyNodesResponse = {
  company_id: string;
  user_id: string;
  limit: number;
  nodes: NodeRecord[];
};

export type MyLogicGatesResponse = {
  company_id: string;
  user_id: string;
  limit: number;
  logic_gates: WorkItemLogicGateInboxItem[];
};

export type RACIMatrixProjectionResponse = {
  company_id: string;
  user_id: string;
  limit: number;
  rows: RACIMatrixProjectionRow[];
};

export type MyWorkMatrixRow = RACIMatrixProjectionRow & {
  gvic_assignment?: LogicGateRACIRole | string;
  project_id?: string;
  project_name?: string;
  logic_gate_id?: string;
  logic_gate_name?: string;
};

export type MyWorkMatrixResponse = {
  company_id: string;
  user_id: string;
  rows: MyWorkMatrixRow[];
};

export type MyWorkNodeMoveResult = {
  company_id: string;
  node: NodeRecord;
  gvic_projection_rows: RACIMatrixProjectionRow[];
  removed_projection_row_ids: string[];
};

export async function listResponsibleInboxNodes(params: WorkItemInboxReadParams): Promise<ResponsibleInboxNodesResponse> {
  return fetchWorkItemInboxRead<ResponsibleInboxNodesResponse>(params, "/v1/work-items/responsible-inbox");
}

export async function listACIInboxLogicGates(params: WorkItemInboxReadParams): Promise<ACIInboxLogicGatesResponse> {
  return fetchWorkItemInboxRead<ACIInboxLogicGatesResponse>(params, "/v1/work-items/aci-inbox");
}

export async function listMyNodes(params: WorkItemInboxReadParams): Promise<MyNodesResponse> {
  return fetchWorkItemInboxRead<MyNodesResponse>(params, "/v1/work-items/my-nodes");
}

export async function listMyLogicGates(params: WorkItemInboxReadParams): Promise<MyLogicGatesResponse> {
  return fetchWorkItemInboxRead<MyLogicGatesResponse>(params, "/v1/work-items/my-logic-gates");
}

export async function listRACIMatrixProjectionRows(params: WorkItemInboxReadParams): Promise<RACIMatrixProjectionResponse> {
  return fetchWorkItemInboxRead<RACIMatrixProjectionResponse>(params, "/v1/work-items/gvic-matrix-projection");
}

export async function listMyWorkMatrixRows(params: WorkItemInboxReadParams): Promise<MyWorkMatrixResponse> {
  return fetchWorkItemInboxRead<MyWorkMatrixResponse>(params, "/v1/work-items/my-work-matrix");
}

export async function moveMyWorkNodeToCell(params: {
  apiBase: string;
  companyID: string;
  nodeID: string;
  targetUserID?: string;
  targetRACIRole: LogicGateRACIRole;
  priority?: number | null;
  logicGateID?: string;
  fromLogicGateID?: string;
}): Promise<MyWorkNodeMoveResult> {
  const payload = await requestJSON<Partial<MyWorkNodeMoveResult> & { node: NodeRecord }>(params.apiBase, `/v1/work-items/my-work-matrix/nodes/${encodeURIComponent(params.nodeID)}/move`, {
    method: "POST",
    json: {
      company_id: params.companyID,
      target_user_id: params.targetUserID,
      target_gvic_role: params.targetRACIRole,
      priority: params.priority,
      logic_gate_id: params.logicGateID,
      from_logic_gate_id: params.fromLogicGateID,
    },
  });
  return {
    company_id: payload.company_id ?? params.companyID,
    node: payload.node,
    gvic_projection_rows: Array.isArray(payload.gvic_projection_rows) ? payload.gvic_projection_rows : [],
    removed_projection_row_ids: Array.isArray(payload.removed_projection_row_ids) ? payload.removed_projection_row_ids : [],
  };
}

async function fetchWorkItemInboxRead<T>(params: WorkItemInboxReadParams, path: string): Promise<T> {
  const query = workItemInboxReadQuery(params);
  return requestJSON<T>(params.apiBase, `${path}?${query}`);
}

function workItemInboxReadQuery(params: WorkItemInboxReadParams): string {
  const query = new URLSearchParams({
    company_id: params.companyID.trim(),
  });
  const targetUserID = params.targetUserID?.trim();
  if (targetUserID) query.set("target_user_id", targetUserID);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  return query.toString();
}
