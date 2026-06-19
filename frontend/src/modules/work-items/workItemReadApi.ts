import { requestJSON } from "../api/requestJSON.js";
import type { GVICMatrixProjectionRow } from "../kanban/kanbanApi.js";
import type { LogicGateGVICRole, LogicGateRecord } from "../logic-gate-map/shared.js";
import type { NodeRecord } from "../node-map/shared.js";

export type WorkItemInboxReadParams = {
  apiBase: string;
  companyID: string;
  targetUserID?: string;
  limit?: number;
};

export type WorkItemLogicGateInboxItem = LogicGateRecord & {
  roles: LogicGateGVICRole[];
};

export type GeneratedInboxNodesResponse = {
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

export type GVICMatrixProjectionResponse = {
  company_id: string;
  user_id: string;
  limit: number;
  projection?: "gvic_matrix";
  projection_sequence?: number | string;
  rows: GVICMatrixProjectionRow[];
};

export type MyWorkMatrixRow = GVICMatrixProjectionRow & {
  role: LogicGateGVICRole;
  project_id?: string;
  project_name?: string;
};

export type MyWorkResourceTree = {
  kind: "project" | "logic_gate" | "node";
  resource_id: string;
  project_id?: string;
  logic_gate_id?: string;
  node_id?: string;
  name: string;
  status?: string | null;
  due_date?: string | null;
  priority?: number | null;
  accounts?: GVICMatrixProjectionRow["accounts"];
  resource_created_timestamp?: string;
  children: MyWorkResourceTree[];
};

export type MyWorkMatrixCell = {
  priority: number | null;
  role: LogicGateGVICRole;
  roots: MyWorkResourceTree[];
};

export type MyWorkMatrixResponse = {
  company_id: string;
  user_id: string;
  cells: MyWorkMatrixCell[];
};

export async function listGeneratedInboxNodes(params: WorkItemInboxReadParams): Promise<GeneratedInboxNodesResponse> {
  return fetchWorkItemInboxRead<GeneratedInboxNodesResponse>(params, "/v1/work-items/generated-inbox");
}

export async function listACIInboxLogicGates(params: WorkItemInboxReadParams): Promise<ACIInboxLogicGatesResponse> {
  return fetchWorkItemInboxRead<ACIInboxLogicGatesResponse>(params, "/v1/work-items/gvic-inbox");
}

export async function listMyNodes(params: WorkItemInboxReadParams): Promise<MyNodesResponse> {
  return fetchWorkItemInboxRead<MyNodesResponse>(params, "/v1/work-items/my-nodes");
}

export async function listMyLogicGates(params: WorkItemInboxReadParams): Promise<MyLogicGatesResponse> {
  return fetchWorkItemInboxRead<MyLogicGatesResponse>(params, "/v1/work-items/my-logic-gates");
}

export async function listGVICMatrixProjectionRows(params: WorkItemInboxReadParams): Promise<GVICMatrixProjectionResponse> {
  return fetchWorkItemInboxRead<GVICMatrixProjectionResponse>(params, "/v1/work-items/gvic-matrix-projection");
}

export async function listMyWorkMatrixRows(params: WorkItemInboxReadParams): Promise<MyWorkMatrixResponse> {
  return fetchWorkItemInboxRead<MyWorkMatrixResponse>(params, "/v1/work-items/my-work-matrix");
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
