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
