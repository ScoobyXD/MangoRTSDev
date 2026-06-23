import { apiFetchJSON } from "../../auth/cognitoAuth.js";
import type { Account } from "../accounts/accountsApi.js";

export type ProjectManagementEntityType = "node" | "logic_gate";
export type ProjectHealth = "On Track" | "AT RISK" | "Off Track";

export type ProjectManagementTimelineRow = {
  company_id: string;
  item_id: string;
  user_id: string;
  resource_type: ProjectManagementEntityType;
  resource_id: string;
  logic_gate_id?: string | null;
  node_id?: string;
  display_title: string;
  status?: string | null;
  due_date?: string | null;
  priority?: number | null;
  accounts?: Account[];
  start_date: string;
  end_date: string;
  duration_days: number;
  position?: number;
  resource_created_timestamp?: string;
  created_timestamp?: string;
  updated_timestamp?: string;
  projection_updated_timestamp?: string;
};

export type ProjectManagementTimelineResponse = {
  company_id: string;
  user_id: string;
  projection: "project_management_timeline";
  projection_scope?: string;
  realtime_scope?: string;
  projection_sequence?: number;
  rows: ProjectManagementTimelineRow[];
};

export type ProjectManagementTimelineMutationResponse = {
  item?: ProjectManagementTimelineRow;
  deleted_item_id?: string;
  user_id?: string;
};

export type ProjectRecord = {
  company_id: string;
  project_id: string;
  name: string;
  status: string;
  health?: ProjectHealth | string;
  default_access?: string;
  accounts?: Account[];
  teams?: ProjectTeam[];
  effective_access_level?: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProjectTeam = {
  company_id: string;
  group_id: string;
  parent_group_id?: string | null;
  name: string;
  position?: number;
  created_timestamp: string;
  updated_timestamp?: string;
};

export type ProjectInformation = {
  company_id: string;
  project_id: string;
  information_id: string;
  type: string;
  information: string;
  author_user_id?: string;
  created_timestamp: string;
};

export type ProjectProjection = {
  company_id: string;
  project_id: string;
  information_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProjectRelationshipProjection = {
  company_id: string;
  project_id: string;
  project_name?: string;
  relationship_id: string;
  resource_type: "logic_gate" | "node";
  resource_id: string;
  logic_gate_id?: string | null;
  node_id?: string | null;
  display_title: string;
  status?: string | null;
  position: number;
  resource_created_timestamp: string;
  relationship_created_timestamp: string;
  relationship_updated_timestamp: string;
  projection_updated_timestamp: string;
};

export type ProjectCriticalPathStep = {
  company_id: string;
  project_id: string;
  step_id: string;
  name: string;
  relationship_id?: string | null;
  resource_type?: "logic_gate" | "node" | "";
  resource_id?: string;
  logic_gate_id?: string | null;
  node_id?: string | null;
  display_title?: string;
  status?: string | null;
  due_date?: string | null;
  owner_type?: "user" | "group" | "";
  owner_id?: string | null;
  owner_label?: string;
  position: number;
  is_current: boolean;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProjectView = {
  company_id: string;
  project_id: string;
  project: ProjectRecord;
  information: ProjectInformation[];
  projections: ProjectProjection[];
  relationships: ProjectRelationshipProjection[];
  critical_path?: ProjectCriticalPathStep[];
  information_count?: number;
  projection_count?: number;
  critical_path_count?: number;
  can_view?: boolean;
  can_edit?: boolean;
  can_admin?: boolean;
};

export type ProjectMutationResponse = {
  project?: ProjectRecord;
  folder_item?: {
    folder_id: string;
    item_type: string;
    item_id: string;
  };
  deleted_id?: string;
};

export type ProjectRelationshipMutationResponse = {
  relationship?: ProjectRelationshipProjection;
  deleted_id?: string;
};

export async function fetchProjectManagementTimeline(companyID: string, userID: string, limit = 1000): Promise<ProjectManagementTimelineResponse> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  params.set("target_user_id", userID);
  params.set("limit", String(limit));
  return apiFetchJSON<ProjectManagementTimelineResponse>(`/v1/project-management/timeline?${params.toString()}`);
}

export async function createProjectManagementTimelineItem(input: {
  companyID: string;
  userID: string;
  entityType: ProjectManagementEntityType;
  entityID: string;
  startDate: string;
  durationDays: number;
  position: number;
}): Promise<ProjectManagementTimelineMutationResponse> {
  return apiFetchJSON<ProjectManagementTimelineMutationResponse>("/v1/project-management/timeline-items", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      target_user_id: input.userID,
      entity_type: input.entityType,
      entity_id: input.entityID,
      start_date: input.startDate,
      duration_days: input.durationDays,
      position: input.position,
    }),
  });
}

export async function updateProjectManagementTimelineItem(input: {
  companyID: string;
  itemID: string;
  startDate: string;
  durationDays: number;
  position: number;
}): Promise<ProjectManagementTimelineMutationResponse> {
  return apiFetchJSON<ProjectManagementTimelineMutationResponse>(`/v1/project-management/timeline-items/${encodeURIComponent(input.itemID)}`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: input.companyID,
      start_date: input.startDate,
      duration_days: input.durationDays,
      position: input.position,
    }),
  });
}

export async function deleteProjectManagementTimelineItem(companyID: string, itemID: string): Promise<ProjectManagementTimelineMutationResponse> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<ProjectManagementTimelineMutationResponse>(`/v1/project-management/timeline-items/${encodeURIComponent(itemID)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function listProjects(companyID: string): Promise<{ projects: ProjectRecord[] }> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<{ projects: ProjectRecord[] }>(`/v1/projects?${params.toString()}`);
}

export async function createProject(input: {
  companyID: string;
  name: string;
  status?: string;
  health?: ProjectHealth;
  accountIDs?: string[];
  teamIDs?: string[];
  skipCompanyExplorerDefaultPlacement?: boolean;
}): Promise<ProjectMutationResponse> {
  const body: Record<string, unknown> = {
    company_id: input.companyID,
    name: input.name,
    status: input.status ?? "Active",
    health: input.health ?? "On Track",
  };
  if (input.accountIDs !== undefined) body.account_ids = input.accountIDs;
  if (input.teamIDs !== undefined) body.team_ids = input.teamIDs;
  if (input.skipCompanyExplorerDefaultPlacement) body.skip_company_explorer_default_placement = true;
  return apiFetchJSON<ProjectMutationResponse>("/v1/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateProject(input: {
  companyID: string;
  projectID: string;
  name: string;
  status: string;
  health?: ProjectHealth | string;
  accountIDs?: string[];
  teamIDs?: string[];
}): Promise<ProjectMutationResponse> {
  const body: Record<string, unknown> = {
    company_id: input.companyID,
    name: input.name,
    status: input.status,
    health: input.health ?? "On Track",
  };
  if (input.accountIDs !== undefined) body.account_ids = input.accountIDs;
  if (input.teamIDs !== undefined) body.team_ids = input.teamIDs;
  return apiFetchJSON<ProjectMutationResponse>(`/v1/projects/${encodeURIComponent(input.projectID)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteProject(companyID: string, projectID: string): Promise<ProjectMutationResponse & { deleted_project_id?: string }> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<ProjectMutationResponse & { deleted_project_id?: string }>(`/v1/projects/${encodeURIComponent(projectID)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function fetchProjectView(companyID: string, projectID: string): Promise<ProjectView> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<ProjectView>(`/v1/projects/${encodeURIComponent(projectID)}?${params.toString()}`);
}

export async function addProjectInformation(input: {
  companyID: string;
  projectID: string;
  informationID: string;
  type: string;
  information: string;
}): Promise<{ information: ProjectInformation; projection: ProjectProjection }> {
  return apiFetchJSON<{ information: ProjectInformation; projection: ProjectProjection }>(`/v1/projects/${encodeURIComponent(input.projectID)}/information`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      information_id: input.informationID,
      type: input.type,
      information: input.information,
    }),
  });
}

export async function deleteProjectProjection(input: {
  companyID: string;
  projectID: string;
  informationID: string;
}): Promise<{ status: string }> {
  const params = new URLSearchParams();
  params.set("company_id", input.companyID);
  return apiFetchJSON<{ status: string }>(`/v1/projects/${encodeURIComponent(input.projectID)}/projection/${encodeURIComponent(input.informationID)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function upsertProjectCriticalPathStep(input: {
  companyID: string;
  projectID: string;
  stepID?: string;
  name: string;
  relationshipID?: string;
  dueDate?: string;
  ownerType?: "user" | "group" | "";
  ownerID?: string;
  position: number;
  isCurrent: boolean;
}): Promise<{ step: ProjectCriticalPathStep }> {
  return apiFetchJSON<{ step: ProjectCriticalPathStep }>(`/v1/projects/${encodeURIComponent(input.projectID)}/critical-path`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      step_id: input.stepID,
      name: input.name,
      relationship_id: input.relationshipID ?? "",
      due_date: input.dueDate ?? "",
      owner_type: input.ownerType ?? "",
      owner_id: input.ownerID ?? "",
      position: input.position,
      is_current: input.isCurrent,
    }),
  });
}

export async function deleteProjectCriticalPathStep(input: {
  companyID: string;
  projectID: string;
  stepID: string;
}): Promise<{ deleted_step_id: string }> {
  const params = new URLSearchParams();
  params.set("company_id", input.companyID);
  return apiFetchJSON<{ deleted_step_id: string }>(`/v1/projects/${encodeURIComponent(input.projectID)}/critical-path/${encodeURIComponent(input.stepID)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function upsertProjectRelationship(input: {
  companyID: string;
  projectID: string;
  resourceType: "logic_gate" | "node";
  resourceID: string;
  relationshipID?: string;
  position?: number;
}): Promise<ProjectRelationshipMutationResponse> {
  return apiFetchJSON<ProjectRelationshipMutationResponse>(`/v1/projects/${encodeURIComponent(input.projectID)}/relationships`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      relationship_id: input.relationshipID,
      resource_type: input.resourceType,
      resource_id: input.resourceID,
      position: input.position ?? 0,
    }),
  });
}

export async function createProjectNode(input: {
  companyID: string;
  projectID: string;
  title: string;
  position?: number;
  logicGateID?: string;
}): Promise<{ node?: unknown; relationship?: ProjectRelationshipProjection }> {
  const logicGateID = input.logicGateID?.trim() ?? "";
  return apiFetchJSON<{ node?: unknown; relationship?: ProjectRelationshipProjection }>(`/v1/projects/${encodeURIComponent(input.projectID)}/nodes`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      title: input.title,
      position: input.position ?? 0,
      initial_assignment: logicGateID ? { logic_gate_id: logicGateID, position: input.position ?? 0, priority: 3 } : undefined,
    }),
  });
}

export async function createProjectLogicGate(input: {
  companyID: string;
  projectID: string;
  header: string;
  position?: number;
}): Promise<{ logic_gate?: unknown; relationship?: ProjectRelationshipProjection }> {
  return apiFetchJSON<{ logic_gate?: unknown; relationship?: ProjectRelationshipProjection }>(`/v1/projects/${encodeURIComponent(input.projectID)}/logic-gates`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      header: input.header,
      position: input.position ?? 0,
    }),
  });
}

export async function deleteProjectRelationship(input: {
  companyID: string;
  projectID: string;
  relationshipID: string;
}): Promise<ProjectRelationshipMutationResponse> {
  const params = new URLSearchParams();
  params.set("company_id", input.companyID);
  return apiFetchJSON<ProjectRelationshipMutationResponse>(`/v1/projects/${encodeURIComponent(input.projectID)}/relationships/${encodeURIComponent(input.relationshipID)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function listProjectRelationshipsForResource(input: {
  companyID: string;
  resourceType: "logic_gate" | "node";
  resourceID: string;
}): Promise<{ relationships: ProjectRelationshipProjection[] }> {
  const params = new URLSearchParams();
  params.set("company_id", input.companyID);
  params.set("resource_type", input.resourceType);
  params.set("resource_id", input.resourceID);
  return apiFetchJSON<{ relationships: ProjectRelationshipProjection[] }>(`/v1/projects/relationships?${params.toString()}`);
}

export async function deleteProjectManagementNode(companyID: string, nodeID: string): Promise<{ status: string }> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<{ status: string }>(`/v1/nodes/${encodeURIComponent(nodeID)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function deleteProjectManagementLogicGate(companyID: string, logicGateID: string): Promise<{ status: string }> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<{ status: string }>(`/v1/logic-gates/${encodeURIComponent(logicGateID)}?${params.toString()}`, {
    method: "DELETE",
  });
}
